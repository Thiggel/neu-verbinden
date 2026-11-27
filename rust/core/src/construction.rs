//! Construction programme and opening date (plan §30, §31).
//!
//! Phases run partly in parallel, construction output depends on how many
//! fronts a project can realistically open at once, and the result is reported
//! with a range rather than a single year.

use crate::fmt::de;
use crate::model::{BuildStatus, Infrastructure, Mode, Network};
use crate::params::Params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase {
    pub key: String,
    pub label: String,
    /// Fractional years, e.g. 2026.0 = start of 2026.
    pub start: f64,
    pub end: f64,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineResult {
    pub phases: Vec<Phase>,
    pub planning_start_year: i32,
    pub construction_start_year: i32,
    pub opening_year: i32,
    pub opening_year_low: i32,
    pub opening_year_high: i32,
    pub construction_years: f64,
    pub total_years: f64,
    /// True when nothing has to be built.
    pub nothing_to_build: bool,
    pub notes: Vec<String>,
}

pub fn calculate(net: &Network, city: &crate::city::CityData, params: &Params) -> TimelineResult {
    let t = &params.timeline;
    let start = t.planning_start_year;

    let active = net.active_edges();
    let active_set: std::collections::BTreeSet<crate::model::EdgeId> =
        active.iter().copied().collect();
    let adjacency = net.adjacency();
    let mut km_by_infra: Vec<(Infrastructure, f64)> = Vec::new();
    let mut total_km = 0.0;
    let mut dominant_mode = Mode::Tram;
    let mut mode_km: Vec<(Mode, f64)> = Vec::new();
    let mut started_km = 0.0;

    for eid in &active {
        let Some(e) = net.edges.get(eid) else {
            continue;
        };
        if e.status == BuildStatus::InService {
            continue;
        }
        let km = e.length_km() * e.status.cost_share();
        if e.status == BuildStatus::UnderConstruction {
            started_km += km;
        }
        total_km += km;
        match km_by_infra.iter_mut().find(|(i, _)| *i == e.infrastructure) {
            Some((_, v)) => *v += km,
            None => km_by_infra.push((e.infrastructure, km)),
        }
        match mode_km.iter_mut().find(|(m, _)| *m == e.mode) {
            Some((_, v)) => *v += km,
            None => mode_km.push((e.mode, km)),
        }
    }
    if let Some((m, _)) = mode_km.iter().max_by(|a, b| a.1.total_cmp(&b.1)) {
        dominant_mode = *m;
    }

    // Station effort, by depth class.
    let mut station_years = 0.0;
    let mut new_stations = 0usize;
    for nid in net.active_stations() {
        let Some(n) = net.nodes.get(&nid) else {
            continue;
        };
        if n.status == BuildStatus::InService {
            // Adapting a live station is slow but not a full station build.
            let touches_new = adjacency
                .get(&nid)
                .map(|es| {
                    es.iter()
                        .filter(|e| active_set.contains(e))
                        .filter_map(|e| net.edges.get(e))
                        .any(|e| e.status != BuildStatus::InService)
                })
                .unwrap_or(false);
            if touches_new {
                station_years += t
                    .years_per_station
                    .get(net.effective_depth_with(nid, &active_set))
                    * 0.4;
            }
            continue;
        }
        new_stations += 1;
        station_years += t
            .years_per_station
            .get(net.effective_depth_with(nid, &active_set))
            * n.status.cost_share();
    }

    // A new station on a running line is a project of its own, even though
    // no track is built, so only a scenario without either has nothing to do.
    if total_km <= 0.001 && station_years <= 0.0 {
        return TimelineResult {
            phases: Vec::new(),
            planning_start_year: start,
            construction_start_year: start,
            opening_year: start,
            opening_year_low: start,
            opening_year_high: start,
            construction_years: 0.0,
            total_years: 0.0,
            nothing_to_build: true,
            notes: vec!["Im Szenario ist nichts zu bauen.".into()],
        };
    }

    if total_km <= 0.001 {
        // Without new track the station's line decides the approval route.
        if let Some(m) = net
            .active_stations()
            .into_iter()
            .flat_map(|n| adjacency.get(&n).cloned().unwrap_or_default())
            .filter(|e| active_set.contains(e))
            .filter_map(|e| net.edges.get(&e))
            .map(|e| e.mode)
            .next()
        {
            dominant_mode = m;
        }
    }

    let track_years: f64 = km_by_infra
        .iter()
        .map(|(i, km)| t.years_per_km.get(*i) * km)
        .sum();
    // How much of the new track lies inside a railway that is already running.
    // That is what decides whether the work can be spread over many sites or
    // has to be sequenced around traffic.
    let (mut corridor_km, mut measured_km) = (0.0, 0.0);
    for eid in &active {
        let Some(e) = net.edges.get(eid) else { continue };
        if e.status == BuildStatus::InService {
            continue;
        }
        let km = e.length_km() * e.status.cost_share();
        let pts: Vec<crate::geo::Point> = e.geo.iter().map(|p| p.to_metric()).collect();
        corridor_km +=
            km * city.rail_corridor_share(&pts, params.feasibility.rail_corridor_radius_m);
        measured_km += km;
    }
    let in_corridor = if measured_km > 0.0 {
        (corridor_km / measured_km).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let parallelism = 1.0 - in_corridor * (1.0 - t.fronts_in_corridor);
    let fronts = (total_km / t.km_per_front * parallelism)
        .min(t.max_parallel_fronts * parallelism)
        .max(1.0);
    let setup = if total_km > 0.001 {
        km_by_infra
            .iter()
            .map(|(i, km)| t.construction_setup_years.get(*i) * km)
            .sum::<f64>()
            / total_km
    } else {
        0.0
    };
    let construction_years = setup + (track_years + station_years) / fronts;

    let approval = t.approval_years.get(dominant_mode);
    let commissioning = t.commissioning_years.get(dominant_mode);

    // Complexity scales the front-end phases: a 30 km tunnel is not planned in
    // the time a 3 km tram extension is.
    let complexity = (total_km / 8.0).clamp(0.6, 2.1);
    let prelim = t.preliminary_design_years * complexity;
    let design = t.detailed_design_years * complexity;
    let procurement = t.procurement_years * complexity.min(1.6);

    // Work already under way skips planning and approval — but only in
    // proportion. A scenario that adds eighty kilometres of new tram alongside
    // one tunnel already being dug does not inherit that tunnel's permits.
    let started_share = if total_km > 0.001 {
        (started_km / total_km).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let front_end = 1.0 - started_share;

    let mut cursor = start as f64;
    let mut phases: Vec<Phase> = Vec::new();
    fn add(
        phases: &mut Vec<Phase>,
        cursor: &mut f64,
        key: &str,
        label: &str,
        len: f64,
        desc: String,
    ) {
        if len <= 0.01 {
            return;
        }
        phases.push(Phase {
            key: key.into(),
            label: label.into(),
            start: *cursor,
            end: *cursor + len,
            description: desc,
        });
        *cursor += len;
    }

    if started_share > 0.01 {
        phases.push(Phase {
            key: "started".into(),
            label: "Bereits im Bau".into(),
            start: cursor,
            end: cursor,
            description: format!(
                "{:.0} % der Neubaustrecke ist bereits im Bau; dafür sind Planung und Genehmigung abgeschlossen.",
                started_share * 100.0
            ),
        });
    }
    if front_end > 0.01 {
        add(
            &mut phases,
            &mut cursor,
            "planning",
            "Vorplanung",
            prelim * front_end,
            "Grundlagenermittlung, Variantenvergleich, Vorentwurf".into(),
        );
        add(
            &mut phases,
            &mut cursor,
            "approval",
            "Planfeststellung",
            approval * (1.0 - t.design_overlap) * front_end,
            "Genehmigungsverfahren mit Öffentlichkeitsbeteiligung".into(),
        );
        add(
            &mut phases,
            &mut cursor,
            "design",
            "Entwurfs- und Ausführungsplanung",
            design * front_end,
            format!(
                "Läuft zu {:.0} % parallel zur Genehmigung",
                t.design_overlap * 100.0
            ),
        );
        add(
            &mut phases,
            &mut cursor,
            "procurement",
            "Vergabe",
            procurement * front_end,
            "Ausschreibung und Vergabe der Bauleistungen".into(),
        );
    }

    // Years of building already done. A project that broke ground in 2021 has
    // spent them, and charging the full build time again from today is how the
    // model came out four to six years later than the operators' own dates on
    // every Hamburg project that is actually under way. Never more than four
    // fifths: the last stretch of a tunnel is not the part that goes quickly,
    // and a line still under construction is by definition not finished.
    //
    // The years count per section, weighted by its share of the work, so a
    // long new line is not treated as half built because a short project that
    // broke ground years ago is part of the same scenario.
    let mut started: std::collections::BTreeMap<crate::model::EdgeId, i32> = Default::default();
    for l in net.lines.values().filter(|l| l.included) {
        let Some(y) = l.construction_started_year else {
            continue;
        };
        for e in &l.edges {
            let entry = started.entry(*e).or_insert(y);
            *entry = (*entry).min(y);
        }
    }
    let elapsed = (active
        .iter()
        .filter_map(|eid| net.edges.get(eid).map(|e| (eid, e)))
        .filter(|(_, e)| e.status != BuildStatus::InService)
        .filter_map(|(eid, e)| {
            started
                .get(eid)
                .map(|y| e.length_km() * e.status.cost_share() * (start - y).max(0) as f64)
        })
        .sum::<f64>()
        / total_km.max(0.001))
        .min(construction_years * 0.8);
    let remaining_construction = (construction_years - elapsed).max(0.5);

    let construction_start = cursor;
    add(
        &mut phases,
        &mut cursor,
        "construction",
        "Bauausführung",
        remaining_construction,
        format!(
            "{} km, {} neue Stationen, rechnerisch {} Baufelder parallel{}{}",
            de(total_km, 1),
            new_stations,
            de(fronts, 1),
            if in_corridor > 0.05 {
                format!(
                    " ({:.0} % im Bestandskorridor, dort wird unter laufendem Betrieb gebaut)",
                    in_corridor * 100.0
                )
            } else {
                String::new()
            },
            if elapsed > 0.05 {
                format!("; {elapsed:.0} Jahre davon bereits gebaut")
            } else {
                String::new()
            }
        ),
    );
    add(
        &mut phases,
        &mut cursor,
        "commissioning",
        "Test und Inbetriebnahme",
        commissioning,
        "Probebetrieb, Zulassung, Personalschulung".into(),
    );

    let opening = cursor;
    let spread = (opening - start as f64) * t.schedule_uncertainty;

    let mut notes = vec!["Der Termin ist eine Modellschätzung und kein Terminplan eines Vorhabenträgers.".to_string()];
    if started_share > 0.01 {
        notes.push(format!(
            "Weil {:.0} % der Strecke bereits im Bau sind, werden Planung und Genehmigung nur für den Rest angesetzt.",
            started_share * 100.0
        ));
    }
    if construction_years > 10.0 {
        notes.push(
            "Vorhaben mit sehr langer Bauzeit werden in der Praxis meist abschnittsweise eröffnet.".into(),
        );
    }

    TimelineResult {
        phases,
        planning_start_year: start,
        construction_start_year: construction_start.ceil() as i32,
        opening_year: opening.ceil() as i32,
        opening_year_low: (opening - spread).ceil() as i32,
        opening_year_high: (opening + spread * 1.6).ceil() as i32,
        construction_years,
        total_years: opening - start as f64,
        nothing_to_build: false,
        notes,
    }
}

/// Opening year of a single line, used when several lines open at once.
pub fn line_opening(
    net: &Network,
    city: &crate::city::CityData,
    line: crate::model::LineId,
    params: &Params,
) -> Option<i32> {
    let l = net.lines.get(&line)?;
    let mut sub = Network::new();
    sub.next_id = net.next_id;
    for e in &l.edges {
        if let Some(edge) = net.edges.get(e) {
            sub.edges.insert(*e, edge.clone());
            for n in [edge.from, edge.to] {
                if let Some(node) = net.nodes.get(&n) {
                    sub.nodes.insert(n, node.clone());
                }
            }
        }
    }
    sub.lines.insert(line, l.clone());
    let r = calculate(&sub, city, params);
    if r.nothing_to_build {
        None
    } else {
        Some(r.opening_year)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{demo_city, demo_new_line};

    /// Building inside a railway that keeps running takes longer.
    ///
    /// Not a stylistic preference: the S4 to Bad Oldesloe is 47 km almost
    /// entirely within the existing Lübecker Bahn and is being built from 2023
    /// to 2032. The context-free model gave it 3.1 years, because it assumed
    /// five work sites open at once — which you cannot have on a line carrying
    /// trains, where work happens in possessions sequenced around traffic.
    #[test]
    fn work_inside_a_live_corridor_takes_longer() {
        let p = Params::default();
        let city = demo_city();
        let net = demo_new_line(Mode::Sbahn, Infrastructure::Surface, 20.0);
        let plain = calculate(&net, &city, &p);

        // The same city, with a railway running along the line being built.
        let mut with_rail = city.clone();
        let geo: Vec<crate::geo::LatLon> = net
            .edges
            .values()
            .flat_map(|e| e.geo.iter().copied())
            .collect();
        with_rail.rail = vec![crate::city::RailCorridor {
            name: String::new(),
            geo,
        }];
        with_rail.prepare();
        let in_corridor = calculate(&net, &with_rail, &p);

        assert!(
            in_corridor.construction_years > plain.construction_years * 1.5,
            "im Bestandskorridor nicht länger: {:.1} gegen {:.1} Jahre",
            in_corridor.construction_years,
            plain.construction_years
        );
    }

    #[test]
    fn nothing_to_build_yields_no_programme() {
        let r = calculate(&crate::testing::demo_network(), &demo_city(), &Params::default());
        assert!(r.nothing_to_build);
        assert!(r.phases.is_empty());
    }

    #[test]
    fn a_tunnel_takes_longer_than_a_tram() {
        let p = Params::default();
        let a = calculate(&demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 10.0), &demo_city(), &p);
        let b = calculate(&demo_new_line(Mode::Tram, Infrastructure::TramReserved, 10.0), &demo_city(), &p);
        assert!(
            a.opening_year > b.opening_year,
            "{} vs {}",
            a.opening_year,
            b.opening_year
        );
        assert!(a.construction_years > b.construction_years);
    }

    #[test]
    fn phases_are_contiguous_and_ordered() {
        let r = calculate(&demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 12.0), &demo_city(), &Params::default());
        assert!(!r.phases.is_empty());
        for w in r.phases.windows(2) {
            assert!(
                (w[0].end - w[1].start).abs() < 1e-9,
                "gap between {} and {}",
                w[0].key,
                w[1].key
            );
        }
        assert!(r.phases.first().unwrap().start as i32 == r.planning_start_year);
        assert!(r.opening_year >= r.construction_start_year);
    }

    #[test]
    fn the_range_brackets_the_opening_year() {
        let r = calculate(&demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 12.0), &demo_city(), &Params::default());
        assert!(r.opening_year_low <= r.opening_year);
        assert!(r.opening_year_high >= r.opening_year);
    }

    #[test]
    fn longer_projects_open_later_but_sublinearly() {
        let p = Params::default();
        let short = calculate(&demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 5.0), &demo_city(), &p);
        let long = calculate(&demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 25.0), &demo_city(), &p);
        assert!(long.opening_year > short.opening_year);
        // Parallel construction fronts must stop it growing linearly.
        assert!(
            long.construction_years < short.construction_years * 5.0,
            "{} vs {}",
            long.construction_years,
            short.construction_years
        );
    }

    #[test]
    fn work_already_under_way_skips_the_approval_phases() {
        let p = Params::default();
        let mut net = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 6.0);
        let fresh = calculate(&net, &demo_city(), &p);
        for e in net.edges.values_mut() {
            e.status = BuildStatus::UnderConstruction;
        }
        for n in net.nodes.values_mut() {
            n.status = BuildStatus::UnderConstruction;
        }
        let started = calculate(&net, &demo_city(), &p);
        assert!(started.opening_year < fresh.opening_year);
        assert!(started.phases.iter().any(|p| p.key == "started"));
        assert!(
            !started.phases.iter().any(|p| p.key == "planning"),
            "nothing left to plan"
        );
    }

    #[test]
    fn one_started_section_does_not_exempt_a_whole_scenario() {
        // A short tunnel already being dug alongside a long new line must not
        // hand that new line a finished planning permission.
        let p = Params::default();
        let mut net = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 30.0);
        let all_fresh = calculate(&net, &demo_city(), &p);
        let first = *net.edges.keys().next().unwrap();
        net.edges.get_mut(&first).unwrap().status = BuildStatus::UnderConstruction;
        let mostly_fresh = calculate(&net, &demo_city(), &p);
        assert!(
            mostly_fresh.phases.iter().any(|p| p.key == "planning"),
            "the unbuilt majority still needs planning"
        );
        let drop = all_fresh.opening_year - mostly_fresh.opening_year;
        assert!(
            drop <= 1,
            "opening jumped forward by {drop} years for one started segment"
        );
    }
}
