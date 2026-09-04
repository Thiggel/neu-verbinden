//! Automatic station placement and naming (plan §14, §15, §16).
//!
//! The user draws infrastructure; the engine decides where the stations go.
//! Candidates come from existing stations, landmarks, streets and the
//! mode-specific target spacing, and the final set is chosen by a dynamic
//! program that maximises catchment value while penalising spacing that is too
//! tight or too loose. A station is therefore never created merely because a
//! fixed distance elapsed, and a genuinely important destination can override
//! the normal spacing — both explicit requirements of the plan.

use crate::city::{CityData, Landmark, LandmarkKind};
use crate::geo::{point_at_distance, polyline_length, Point};
use crate::model::{Mode, Network, NodeKind};
use crate::params::{DemandParams, StationParams};
use serde::{Deserialize, Serialize};

/// Why a station candidate exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CandidateOrigin {
    /// Forced: the drawn line starts or ends here.
    Terminus,
    /// An existing station of the network — an interchange opportunity.
    Interchange,
    /// A landmark within the search radius.
    Landmark,
    /// A named street crossing.
    Street,
    /// Purely spacing-driven.
    Spacing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationCandidate {
    /// Distance along the drawn line, metres.
    pub along_m: f64,
    pub point: Point,
    pub name: String,
    pub origin: CandidateOrigin,
    /// 0..1 attractiveness used by the selection.
    pub score: f64,
    /// Residents in the walking catchment.
    pub catchment_population: f64,
    pub catchment_jobs: f64,
    /// Existing node this candidate coincides with, if any.
    pub existing_node: Option<crate::model::NodeId>,
    pub interchange: bool,
    #[serde(default)]
    pub forced: bool,
    /// Other names this position could carry, best first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alternatives: Vec<String>,
}

/// Generate station candidates along a drawn polyline.
///
/// `anchors` are positions the user pointed at. Every one of them becomes a
/// station: a click is an instruction, not a hint. The engine only decides what
/// goes *between* them.
pub fn candidates(
    line: &[Point],
    mode: Mode,
    network: &Network,
    city: &CityData,
    sp: &StationParams,
    dp: &DemandParams,
    anchors: &[Point],
) -> Vec<StationCandidate> {
    let total = polyline_length(line);
    if total <= 0.0 || line.len() < 2 {
        return Vec::new();
    }
    let radius = dp.catchment_radius_m.get(mode);
    let mut out: Vec<StationCandidate> = Vec::new();

    let mut push = |along: f64,
                    name: String,
                    origin: CandidateOrigin,
                    base: f64,
                    node,
                    interchange,
                    forced| {
        let p = point_at_distance(line, along);
        let c = city.catchment(p, radius, dp.catchment_decay);
        let catch_score =
            (c.weighted(dp.job_weight) / sp.catchment_reference_population).clamp(0.0, 1.6);
        out.push(StationCandidate {
            along_m: along,
            point: p,
            name,
            origin,
            score: base + catch_score * sp.catchment_weight,
            catchment_population: c.population,
            catchment_jobs: c.jobs,
            existing_node: node,
            interchange,
            forced,
            alternatives: Vec::new(),
        });
    };

    // Both ends are always stations.
    push(
        0.0,
        String::new(),
        CandidateOrigin::Terminus,
        1.0,
        None,
        false,
        true,
    );
    push(
        total,
        String::new(),
        CandidateOrigin::Terminus,
        1.0,
        None,
        false,
        true,
    );

    // Everywhere the user clicked. Anchors closer together than the mode can
    // physically serve are thinned out — otherwise the spacing solver has no
    // feasible path at all and falls back to a bare terminus pair.
    let min_gap = sp.min_spacing_m.get(mode) * 0.6;
    let mut anchor_alongs: Vec<f64> = anchors
        .iter()
        .filter_map(|a| crate::geo::project_on_polyline(*a, line))
        .map(|pr| pr.along)
        .filter(|along| *along > min_gap && *along < total - min_gap)
        .collect();
    anchor_alongs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut last = 0.0;
    for along in anchor_alongs {
        if along - last < min_gap {
            continue;
        }
        last = along;
        push(
            along,
            String::new(),
            CandidateOrigin::Terminus,
            1.0,
            None,
            false,
            true,
        );
    }

    // Existing network stations within interchange distance (plan §16).
    for n in network.nodes.values() {
        if n.kind != NodeKind::Station {
            continue;
        }
        let p = n.geo.to_metric();
        if let Some(pr) = crate::geo::project_on_polyline(p, line) {
            if pr.distance <= sp.interchange_offer_radius_m {
                push(
                    pr.along,
                    n.name.clone(),
                    CandidateOrigin::Interchange,
                    sp.interchange_bonus,
                    Some(n.id),
                    true,
                    false,
                );
            }
        }
    }

    // Landmarks within the search radius (plan §14).
    let step = 120.0;
    let samples = ((total / step).ceil() as usize).max(1);
    let mut seen_landmarks: Vec<String> = Vec::new();
    for i in 0..=samples {
        let along = (i as f64 * step).min(total);
        let p = point_at_distance(line, along);
        for (l, d) in city.landmarks_near(p, sp.landmark_search_radius_m) {
            if l.kind == LandmarkKind::Station {
                continue; // handled through the network above
            }
            if seen_landmarks.contains(&l.name) {
                continue;
            }
            // Place the candidate at the point on the line nearest the landmark.
            let lp = l.geo.to_metric();
            let Some(pr) = crate::geo::project_on_polyline(lp, line) else {
                continue;
            };
            if pr.distance > sp.landmark_search_radius_m {
                continue;
            }
            seen_landmarks.push(l.name.clone());
            let _ = d;
            // A theatre is a good reason to put a stop somewhere and a poor
            // name for it. Only landmarks people actually navigate by carry
            // their name over; the rest go through the normal naming chain.
            let name = if l.weight >= sp.landmark_naming_weight {
                l.name.clone()
            } else {
                String::new()
            };
            push(
                pr.along,
                name,
                CandidateOrigin::Landmark,
                sp.landmark_bonus * l.weight * 2.0,
                None,
                false,
                false,
            );
        }
    }

    // Regular spacing candidates fill the gaps.
    let target = sp.target_spacing_m.get(mode);
    let n = (total / (target * 0.5)).floor() as usize;
    for i in 1..n {
        let along = i as f64 * target * 0.5;
        if along >= total {
            break;
        }
        push(
            along,
            String::new(),
            CandidateOrigin::Spacing,
            0.0,
            None,
            false,
            false,
        );
    }

    out.sort_by(|a, b| {
        a.along_m
            .partial_cmp(&b.along_m)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Collapse candidates that are effectively at the same place, keeping the
    // most informative one.
    let mut merged: Vec<StationCandidate> = Vec::new();
    for c in out {
        match merged.last_mut() {
            Some(prev) if (c.along_m - prev.along_m).abs() < 90.0 => {
                // Position and forcedness come from the user's click; identity
                // — name, interchange, the existing node — from whichever
                // candidate actually knows something. A terminus drawn on top
                // of Hauptbahnhof has to end up *being* Hauptbahnhof.
                let identity =
                    |c: &StationCandidate| (!c.name.is_empty(), std::cmp::Reverse(rank(&c.origin)));
                let take_new = identity(&c) > identity(prev)
                    || (identity(&c) == identity(prev) && c.score > prev.score);
                let forced = prev.forced || c.forced;
                let along = if prev.forced {
                    prev.along_m
                } else if c.forced || take_new {
                    c.along_m
                } else {
                    prev.along_m
                };
                if take_new {
                    *prev = StationCandidate {
                        along_m: along,
                        forced,
                        ..c
                    };
                } else {
                    prev.along_m = along;
                    prev.forced = forced;
                }
            }
            _ => merged.push(c),
        }
    }

    // Name anything still unnamed from its surroundings.
    for c in merged.iter_mut() {
        if c.name.is_empty() {
            c.alternatives = name_candidates(c.point, city, sp);
            c.name = c
                .alternatives
                .first()
                .cloned()
                .unwrap_or_else(|| "Neue Station".into());
        }
    }
    merged
}

fn rank(o: &CandidateOrigin) -> u8 {
    match o {
        CandidateOrigin::Terminus => 0,
        CandidateOrigin::Interchange => 1,
        CandidateOrigin::Landmark => 2,
        CandidateOrigin::Street => 3,
        CandidateOrigin::Spacing => 4,
    }
}

/// Candidate names for a station, best first.
///
/// German stops are named after the street or square they stand on, the
/// neighbourhood, or a landmark big enough that everyone knows it — roughly in
/// that order. Returning a list rather than one name lets the caller skip a
/// name that is already taken further along the line, which is how you avoid
/// "Lurup 2", "Lurup 3", "Lurup 4".
pub fn name_candidates(p: Point, city: &CityData, sp: &StationParams) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let near = city.landmarks_near(p, sp.landmark_search_radius_m);

    // Scoped so the mutable borrow of `out` ends before the rural fallback.
    {
        let mut push = |name: &str| {
            let n = name.trim();
            if !n.is_empty() && !out.iter().any(|x| x == n) {
                out.push(n.to_string());
            }
        };

        // The railway station this stop stands on.
        //
        // Nothing else names a place as precisely: a stop on the site of
        // Meckelfeld or Bardowick *is* Meckelfeld or Bardowick, and it has been
        // for a century. Before this, a regional line came out with stops
        // called "Bramweg" and "Hinter der Bahn" — the nearest field path —
        // while the station it was built on went unmentioned. Kept tight, so
        // this only fires when the stop really is at the station; a name
        // already used further along the line is skipped by the caller.
        if let Some((l, _)) = near
            .iter()
            .filter(|(l, d)| l.kind == LandmarkKind::Station && *d <= 250.0)
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        {
            push(&l.name);
        }

        // Something everyone in the city can name: airport, university, stadium.
        let major = near
            .iter()
            .filter(|(l, _)| l.kind == LandmarkKind::Poi && l.weight >= 0.6)
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        if let Some((l, _)) = major {
            push(&l.name);
        }

        // The street it stands on.
        if let Some((s, _)) = city.nearest_street(p, 220.0) {
            push(&s.name);
        }

        // The neighbourhood.
        if let Some((l, _)) = near
            .iter()
            .filter(|(l, _)| l.kind == LandmarkKind::Place)
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        {
            push(&l.name);
        }

        // A smaller but still public landmark: museum, hospital, town hall.
        for (l, _) in near
            .iter()
            .filter(|(l, _)| l.kind == LandmarkKind::Poi && l.weight >= 0.4)
        {
            push(&l.name);
        }

        // A street a little further out, then the district.
        if let Some((s, _)) = city.nearest_street(p, 450.0) {
            push(&s.name);
        }
        if let Some(d) = city.district_at(p) {
            push(&d.name);
        }

        // Out in the region there are no streets in the dataset and the nearest
        // village may be kilometres away — which is exactly what such a stop
        // would be named after ("Bissee", "Groß Kummerfeld").
    }

    if out.is_empty() {
        // Out in the region there are no streets in the dataset and the
        // nearest village may be kilometres away — which is exactly what such
        // a stop would be named after ("Bissee", "Groß Kummerfeld"). Prefer a
        // place that is both close and of some size: a small town 3 km away
        // beats a farmstead at 800 m.
        let mut places: Vec<(&Landmark, f64)> = city
            .landmarks_near(p, sp.rural_naming_radius_m)
            .into_iter()
            .filter(|(l, _)| l.kind == LandmarkKind::Place && !l.name.trim().is_empty())
            .collect();
        let score = |l: &Landmark, d: f64| l.weight * 2.0 - d / sp.rural_naming_radius_m;
        places.sort_by(|a, b| {
            score(b.0, b.1)
                .partial_cmp(&score(a.0, a.1))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for (l, _) in places.into_iter().take(3) {
            let n = l.name.trim().to_string();
            if !out.contains(&n) {
                out.push(n);
            }
        }
    }
    out
}

/// Name a station from its surroundings (plan §14).
pub fn name_for(p: Point, city: &CityData, sp: &StationParams) -> String {
    name_candidates(p, city, sp)
        .into_iter()
        .next()
        .unwrap_or_else(|| "Neue Station".into())
}

/// Drop stops that land on top of one another on the ground.
///
/// The selection measures spacing *along* the line, which is the right measure
/// for a line that goes somewhere. Where a corridor doubles back — station
/// approach tracks do this constantly — two stops can be kilometres apart along
/// the rails and metres apart in the world, and the gap rule sees nothing wrong.
/// The Lübeck proposal ended with "Lübeck Hauptbahnhof" and "Lübeck
/// Hauptbahnhof 2" ninety metres apart that way.
///
/// Consecutive pairs are already refused during selection; this catches the
/// rest, where the loop is wide enough that other stops fall between them. An
/// existing station outranks a new one — it is a real place with a real name —
/// and otherwise the better catchment wins.
fn thin_collisions(
    picks: Vec<StationCandidate>,
    mode: Mode,
    sp: &StationParams,
    closed: bool,
) -> Vec<StationCandidate> {
    let min_gap = sp.min_spacing_m.get(mode) * 0.6;
    let last = picks.len().saturating_sub(1);
    let mut kept: Vec<StationCandidate> = Vec::with_capacity(picks.len());
    for (idx, cand) in picks.into_iter().enumerate() {
        // On a ring the closing stop meets the opening one by design.
        if closed && idx == last && !kept.is_empty() {
            kept.push(cand);
            continue;
        }
        let clash = kept
            .iter()
            .position(|k| k.point.distance_to(&cand.point) < min_gap);

        match clash {
            None => kept.push(cand),
            Some(i) => {
                let incumbent = &kept[i];
                let better = match (incumbent.existing_node, cand.existing_node) {
                    (Some(_), None) => false,
                    (None, Some(_)) => true,
                    _ => cand.score > incumbent.score,
                };
                if better {
                    kept[i] = cand;
                }
            }
        }
    }
    // Replacing an entry can leave the list out of order along the line.
    kept.sort_by(|a, b| a.along_m.total_cmp(&b.along_m));
    kept
}

/// Select the final station set from the candidates (plan §15).
///
/// A dynamic program over candidates ordered along the line: the value of a
/// station is its catchment score, and every gap is charged a penalty that
/// grows with the deviation from the mode's target spacing. Gaps outside the
/// permitted range are forbidden outright, which is what keeps the result
/// physically sensible without hard-coding a fixed interval.
pub fn select(cands: &[StationCandidate], mode: Mode, sp: &StationParams) -> Vec<StationCandidate> {
    if cands.len() < 2 {
        return cands.to_vec();
    }
    let base_target = sp.target_spacing_m.get(mode);
    let base_min = sp.min_spacing_m.get(mode);
    let base_max = sp.max_spacing_m.get(mode);
    let n = cands.len();

    // The target spacings are city values. Out in the country a stop every
    // 1.9 km would serve empty fields, so the whole spacing band stretches
    // with how few people live along the gap. `stretch` is 1.0 wherever the
    // catchment reaches the reference population and grows towards
    // `rural_spacing_stretch` as it falls away.
    let stretch_at = |i: usize| -> f64 {
        let pop = cands[i].catchment_population.max(0.0);
        let ratio = (sp.catchment_reference_population / pop.max(120.0)).sqrt();
        ratio.clamp(1.0, sp.rural_spacing_stretch.get(mode))
    };
    let stretches: Vec<f64> = (0..n).map(stretch_at).collect();
    // Prefix sums let the gap between any two candidates use the mean stretch
    // of everything in between, not just its endpoints — the endpoints are by
    // construction the populated spots.
    let mut prefix = vec![0.0f64; n + 1];
    for i in 0..n {
        prefix[i + 1] = prefix[i] + stretches[i];
    }

    let gap_cost = |j: usize, i: usize| -> f64 {
        let d = cands[i].along_m - cands[j].along_m;
        let stretch = (prefix[i + 1] - prefix[j]) / ((i + 1 - j) as f64);
        let target = base_target * stretch;
        let min = base_min * stretch;
        let max = base_max * stretch;
        if d < base_min * 0.6 {
            return f64::INFINITY;
        }
        // Distance along the line is not distance on the ground.
        //
        // Where a corridor loops back on itself — station approach tracks do
        // this constantly — two stops can sit 2.2 km apart along the rails and
        // 91 m apart in the world. That is how the Lübeck line ended with
        // "Lübeck Hauptbahnhof" and "Lübeck Hauptbahnhof 2" beside each other,
        // and a hand-drawn line that doubles back would do the same. Only
        // consecutive stops are compared, which is what the dynamic program can
        // see; a loop tight enough to bring two *non*-adjacent stops together
        // would still slip through.
        if cands[i].point.distance_to(&cands[j].point) < base_min * 0.6 {
            return f64::INFINITY;
        }
        // Quadratic around the target, normalised so one target-length gap
        // costs nothing and a doubled gap costs about one station's worth.
        let rel = (d - target) / target;
        let mut c = rel * rel * 1.1;
        if d > max {
            c += ((d - max) / target) * 3.0 + 1.5;
        }
        if d < min {
            c += ((min - d) / target) * 3.0 + 1.0;
        }
        c
    };

    let mut best = vec![f64::NEG_INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    best[0] = cands[0].score;
    for i in 1..n {
        for j in 0..i {
            if !best[j].is_finite() {
                continue;
            }
            // A forced candidate between j and i may not be skipped.
            if cands[j + 1..i].iter().any(|c| c.forced) {
                continue;
            }
            let cost = gap_cost(j, i);
            if !cost.is_finite() {
                continue;
            }
            // Every station has to earn its keep: a stop that serves nobody
            // and connects to nothing is not worth building even where the
            // spacing would allow one. Stops the user explicitly asked for are
            // exempt — a click is an instruction.
            let worth = if cands[i].forced {
                0.0
            } else {
                sp.station_marginal_value
            };
            let v = best[j] + cands[i].score - worth - cost;
            if v > best[i] {
                best[i] = v;
                prev[i] = j;
            }
        }
    }

    // Walk back from the last candidate (the far terminus, always forced).
    let mut path = Vec::new();
    let mut i = n - 1;
    if !best[i].is_finite() {
        return vec![cands[0].clone(), cands[n - 1].clone()];
    }
    loop {
        path.push(cands[i].clone());
        if i == 0 {
            break;
        }
        let p = prev[i];
        if p == usize::MAX {
            break;
        }
        i = p;
    }
    path.reverse();

    // Two stops taking their name from the same street is common; giving the
    // second one its next-best name reads far better than numbering it.
    let mut seen: Vec<String> = Vec::new();
    for s in path.iter_mut() {
        if seen.contains(&s.name) {
            if let Some(alt) = s.alternatives.iter().find(|a| !seen.contains(a)) {
                s.name = alt.clone();
            }
        }
        if seen.contains(&s.name) {
            let base = s.name.clone();
            let mut k = 2;
            while seen.contains(&s.name) {
                s.name = format!("{base} {k}");
                k += 1;
            }
        }
        seen.push(s.name.clone());
    }
    path
}

/// Convenience: candidates + selection in one call.
pub fn auto_place(
    line: &[Point],
    mode: Mode,
    network: &Network,
    city: &CityData,
    sp: &StationParams,
    dp: &DemandParams,
    anchors: &[Point],
) -> Vec<StationCandidate> {
    let c = candidates(line, mode, network, city, sp, dp, anchors);
    // A ring is *supposed* to come back to where it started: its first and last
    // stop are the same place and get merged into one node further on. Only an
    // accidental doubling-back is a defect.
    let closed = line.len() > 2
        && line[0].distance_to(&line[line.len() - 1]) < sp.min_spacing_m.get(mode);
    thin_collisions(select(&c, mode, sp), mode, sp, closed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::city::CityData;
    use crate::testing::{demo_city, demo_network};

    fn straight(km: f64) -> Vec<Point> {
        vec![Point::new(0.0, 0.0), Point::new(km * 1000.0, 0.0)]
    }

    /// A city whose eastern half is empty countryside.
    fn half_empty_city() -> CityData {
        let mut city = demo_city();
        let g = &mut city.grid;
        for r in 0..g.rows {
            for c in 0..g.cols {
                let x = g.origin_x + (c as f64 + 0.5) * g.cell_m;
                if x > 4000.0 {
                    g.population[r * g.cols + c] = 4.0;
                    g.jobs[r * g.cols + c] = 1.0;
                }
            }
        }
        city.prepare();
        city
    }

    #[test]
    fn stops_thin_out_where_nobody_lives() {
        let net = Network::new();
        let city = half_empty_city();
        let sp = StationParams::default();
        let dp = DemandParams::default();
        // 24 km due east: the first 4 km through the city, the rest empty.
        let line = vec![Point::new(0.0, 0.0), Point::new(24_000.0, 0.0)];
        let stops = auto_place(&line, Mode::Sbahn, &net, &city, &sp, &dp, &[]);
        let gap = |a: &StationCandidate, b: &StationCandidate| b.along_m - a.along_m;
        let urban: Vec<f64> = stops
            .windows(2)
            .filter(|w| w[1].along_m <= 4_000.0)
            .map(|w| gap(&w[0], &w[1]))
            .collect();
        let rural: Vec<f64> = stops
            .windows(2)
            .filter(|w| w[0].along_m >= 8_000.0)
            .map(|w| gap(&w[0], &w[1]))
            .collect();
        assert!(
            !urban.is_empty() && !rural.is_empty(),
            "zu wenige Halte: {}",
            stops.len()
        );
        let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
        assert!(
            mean(&rural) > mean(&urban) * 1.8,
            "Abstände im Leeren {:.0} m gegen Stadt {:.0} m",
            mean(&rural),
            mean(&urban)
        );
        // But not beyond what the mode can stretch to.
        let cap =
            sp.max_spacing_m.get(Mode::Sbahn) * sp.rural_spacing_stretch.get(Mode::Sbahn) * 1.3;
        assert!(
            rural.iter().all(|g| *g < cap),
            "Abstand über der Obergrenze: {rural:?}"
        );
    }

    #[test]
    fn a_line_starting_at_an_existing_station_keeps_it() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        // "Halt 0" of the demo network sits exactly here.
        let start = Point::new(-6000.0, 0.0);
        let line = vec![start, Point::new(-6000.0, 5000.0)];
        let stops = auto_place(&line, Mode::Ubahn, &net, &city, &sp, &dp, &[]);
        let first = &stops[0];
        assert_eq!(first.name, "Halt 0", "Umstieg am Startpunkt verloren");
        assert!(
            first.existing_node.is_some(),
            "kein Bestandsknoten übernommen"
        );
        assert!(first.interchange);
        assert!(first.forced, "der Startpunkt muss ein Halt bleiben");
    }

    #[test]
    fn terminals_are_always_stations() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        let line = straight(6.0);
        let picked = auto_place(&line, Mode::Ubahn, &net, &city, &sp, &dp, &[]);
        assert!(picked.len() >= 2);
        assert!((picked.first().unwrap().along_m).abs() < 1.0);
        assert!((picked.last().unwrap().along_m - 6000.0).abs() < 1.0);
    }

    #[test]
    fn spacing_respects_the_mode() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        let line = straight(10.0);
        let ubahn = auto_place(&line, Mode::Ubahn, &net, &city, &sp, &dp, &[]);
        let tram = auto_place(&line, Mode::Tram, &net, &city, &sp, &dp, &[]);
        let sbahn = auto_place(&line, Mode::Sbahn, &net, &city, &sp, &dp, &[]);
        assert!(
            tram.len() > ubahn.len(),
            "tram {} vs u-bahn {}",
            tram.len(),
            ubahn.len()
        );
        assert!(
            ubahn.len() > sbahn.len(),
            "u-bahn {} vs s-bahn {}",
            ubahn.len(),
            sbahn.len()
        );
    }

    #[test]
    fn no_gap_is_shorter_than_the_minimum() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        for mode in [Mode::Ubahn, Mode::Sbahn, Mode::Tram] {
            let picked = auto_place(&straight(12.0), mode, &net, &city, &sp, &dp, &[]);
            let min = sp.min_spacing_m.get(mode) * 0.6;
            for w in picked.windows(2) {
                let d = w[1].along_m - w[0].along_m;
                assert!(d >= min - 1.0, "{mode:?}: gap {d} below {min}");
            }
        }
    }

    #[test]
    fn an_existing_station_on_the_route_becomes_an_interchange() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        // Draw straight through the first demo station.
        let n = net
            .nodes
            .values()
            .find(|n| n.kind == NodeKind::Station)
            .unwrap();
        let p = n.geo.to_metric();
        let line = vec![Point::new(p.x - 4000.0, p.y), Point::new(p.x + 4000.0, p.y)];
        let picked = auto_place(&line, Mode::Ubahn, &net, &city, &sp, &dp, &[]);
        assert!(
            picked.iter().any(|c| c.existing_node == Some(n.id)),
            "expected the existing station to be picked up as an interchange"
        );
    }

    #[test]
    fn every_station_gets_a_name() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        let picked = auto_place(&straight(8.0), Mode::Ubahn, &net, &city, &sp, &dp, &[]);
        assert!(picked.iter().all(|c| !c.name.trim().is_empty()));
        // Names must be unique so the UI can address them.
        let mut names: Vec<&str> = picked.iter().map(|c| c.name.as_str()).collect();
        names.sort();
        let before = names.len();
        names.dedup();
        assert_eq!(names.len(), before, "duplicate station names");
    }

    #[test]
    fn every_clicked_point_becomes_a_station() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        let line = straight(9.0);
        // Two deliberate points in the middle, at distances the spacing rule
        // would never choose on its own.
        let anchors = [Point::new(1300.0, 0.0), Point::new(7100.0, 0.0)];
        assert!(anchors.len() == 2);
        let picked = auto_place(&line, Mode::Ubahn, &net, &city, &sp, &dp, &anchors);
        for a in anchors {
            let hit = picked.iter().any(|c| (c.along_m - a.x).abs() < 40.0);
            assert!(
                hit,
                "no station near the click at {} m: {:?}",
                a.x,
                picked.iter().map(|c| c.along_m).collect::<Vec<_>>()
            );
        }
        // And the engine still fills in the long gap between them.
        assert!(
            picked.len() > 4,
            "expected intermediate stations, got {}",
            picked.len()
        );
    }

    #[test]
    fn anchors_too_close_together_do_not_break_the_layout() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        let line = straight(8.0);
        // A street-routed corridor supplies a vertex every few metres; those are
        // geometry, not intent, and must not each become a station.
        let dense: Vec<Point> = (0..400).map(|i| Point::new(i as f64 * 20.0, 0.0)).collect();
        let picked = auto_place(&line, Mode::Ubahn, &net, &city, &sp, &dp, &dense);
        assert!(
            picked.len() > 4,
            "layout collapsed to {} stations",
            picked.len()
        );
        for w in picked.windows(2) {
            let gap = w[1].along_m - w[0].along_m;
            assert!(gap >= sp.min_spacing_m.ubahn * 0.6 - 1.0, "gap of {gap} m");
        }
    }

    /// A corridor that doubles back must not stack two stops on one spot.
    ///
    /// Station approach tracks loop, so a line can run kilometres of rail and
    /// come back to where it started. Spacing measured along the line says the
    /// gap is fine; on the ground the two stops are metres apart. The Lübeck
    /// proposal ended with "Lübeck Hauptbahnhof" and "Lübeck Hauptbahnhof 2"
    /// this way, and a hand-drawn hairpin would do the same.
    #[test]
    fn a_corridor_that_doubles_back_does_not_stack_stations() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        // Out, back alongside, then away again — the shape of a station
        // approach. The two ends are 10 km apart, so this is not a ring; but
        // the outbound and returning legs run 120 m apart in the middle, which
        // is where two stops used to land on top of each other.
        let leg = |from: Point, to: Point, n: usize| -> Vec<Point> {
            (0..n)
                .map(move |i| {
                    let t = i as f64 / n as f64;
                    Point::new(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
                })
                .collect::<Vec<_>>()
        };
        let mut corridor = leg(Point::new(0.0, 0.0), Point::new(6000.0, 0.0), 20);
        corridor.extend(leg(Point::new(6000.0, 120.0), Point::new(3000.0, 120.0), 10));
        corridor.extend(leg(Point::new(3000.0, 240.0), Point::new(10000.0, 240.0), 24));
        corridor.push(Point::new(10000.0, 240.0));
        let picks = auto_place(&corridor, Mode::Sbahn, &net, &city, &sp, &dp, &[]);
        let min_gap = sp.min_spacing_m.get(Mode::Sbahn) * 0.6;
        for (i, a) in picks.iter().enumerate() {
            for b in picks.iter().skip(i + 1) {
                let d = a.point.distance_to(&b.point);
                assert!(
                    d >= min_gap,
                    "zwei Halte liegen {d:.0} m auseinander, erlaubt sind {min_gap:.0} m \
                     (entlang der Linie sieht der Abstand größer aus als er ist)"
                );
            }
        }
    }

    #[test]
    fn a_degenerate_line_yields_nothing() {
        let (net, city) = (demo_network(), demo_city());
        let sp = StationParams::default();
        let dp = DemandParams::default();
        assert!(auto_place(&[], Mode::Ubahn, &net, &city, &sp, &dp, &[]).is_empty());
        assert!(auto_place(
            &[Point::new(0.0, 0.0)],
            Mode::Ubahn,
            &net,
            &city,
            &sp,
            &dp,
            &[]
        )
        .is_empty());
    }
}
