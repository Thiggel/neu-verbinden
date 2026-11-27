//! Connections between parts of the city and the region.
//!
//! The access measure in [`crate::demand`] asks how quickly each place reaches
//! the employment centres. That misses most of what a new line does: a direct
//! tram from Rotherbaum to Altona shortens a journey between two quarters
//! neither of which is a centre, and it saves the two changes the journey takes
//! today. This module measures exactly that.
//!
//! * **Zones.** The city's districts, and beyond them square tiles of
//!   [`TILE_M`] over the region, each carrying the residents and workplaces of
//!   the raster cells inside it. The zones depend on the data only, never on
//!   the network, so both sides of a comparison use the same ones.
//! * **Journeys.** From every zone with a station in walking distance, a route
//!   search over the network gives the fastest journey to every other zone:
//!   walk, wait, ride, change and walk again, with the number of changes and
//!   the time on board.
//! * **Choice.** Where people travel and whether they take the train follows a
//!   logit model: a destination attracts in proportion to its residents and
//!   workplaces and repels with travel time, against a constant utility for
//!   every other way of making the trip.
//! * **Benefit.** The change in the logsum of that model, which is what a
//!   saved minute is worth to the people who travel: the full saving to those
//!   who rode anyway, about half of it to those the faster connection wins
//!   over. No separate share of induced trips is assumed.
//!
//! Two quantities calibrate the model on today's network. The constant for
//! other modes is set so that the trips it predicts produce today's boardings,
//! changes counted. The sensitivity to time is set so that public transport
//! demand responds to in-vehicle time with an elasticity of about −0.5, the
//! value Balcombe et al. (2004, TRL593, §3.2.4 and §6) report for urban
//! public transport.

use crate::city::CityData;
use crate::geo::{point_in_ring, Bbox, Point};
use crate::model::{Network, NodeId, NodeKind};
use crate::params::Params;
use crate::travel::{walk_minutes, Journey, TravelGraph};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Edge length of a regional tile, metres.
///
/// Small enough that a tile is roughly one town, large enough that the region
/// stays at a few hundred zones and a route search from each served one fits
/// into an interactive recalculation.
pub const TILE_M: f64 = 5000.0;

/// How far people walk to a station, metres. The same limit as the access
/// measure, so "served" means the same thing in both.
pub const MAX_WALK_M: f64 = 1200.0;

/// Ceiling on every reported journey, minutes. A place without a connection is
/// charged this, so connecting it can only ever shorten the mean.
pub const CAP_MIN: f64 = 180.0;

/// Door-to-door time for the reachability count, minutes.
pub const REACH_MIN: f64 = 45.0;

/// What the model compares between two networks, zone by zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoneKind {
    District,
    Region,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ZoneCell {
    p: Point,
    population: f64,
    jobs: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Zone {
    pub id: String,
    pub name: String,
    pub kind: ZoneKind,
    pub population: f64,
    pub jobs: f64,
    cells: Vec<ZoneCell>,
}

impl Zone {
    fn weight(&self) -> f64 {
        self.population + self.jobs
    }
}

/// The zones of a city, built once from its rasters.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Zones {
    pub zones: Vec<Zone>,
}

impl Zones {
    pub fn build(city: &CityData) -> Self {
        // Districts, with their rings converted once rather than per cell.
        let shapes: Vec<(Bbox, Vec<Vec<Point>>)> = city
            .districts
            .iter()
            .map(|d| {
                let rings: Vec<Vec<Point>> = d
                    .rings
                    .iter()
                    .map(|r| r.iter().map(|q| q.to_metric()).collect())
                    .collect();
                let all: Vec<Point> = rings.iter().flatten().copied().collect();
                (Bbox::from_points(&all), rings)
            })
            .collect();
        let mut zones: Vec<Zone> = city
            .districts
            .iter()
            .map(|d| Zone {
                id: d.id.clone(),
                name: d.name.clone(),
                kind: ZoneKind::District,
                population: 0.0,
                jobs: 0.0,
                cells: Vec::new(),
            })
            .collect();
        let district_of = |p: Point, hint: Option<usize>| -> Option<usize> {
            let inside = |i: usize| {
                let (bb, rings) = &shapes[i];
                bb.contains(p) && rings.iter().any(|r| point_in_ring(p, r))
            };
            // Neighbouring cells almost always share a district.
            if let Some(h) = hint {
                if inside(h) {
                    return Some(h);
                }
            }
            (0..shapes.len()).find(|&i| inside(i))
        };

        let mut tiles: BTreeMap<(i64, i64), Vec<ZoneCell>> = BTreeMap::new();
        let tile_of = |p: Point| ((p.x / TILE_M).floor() as i64, (p.y / TILE_M).floor() as i64);

        let g = &city.grid;
        let mut hint = None;
        for row in 0..g.rows {
            for col in 0..g.cols {
                let i = g.index(col, row);
                let (pop, jobs) = (g.population[i] as f64, g.jobs[i] as f64);
                if pop + jobs <= 0.0 {
                    continue;
                }
                let p = g.cell_center(col, row);
                let cell = ZoneCell {
                    p,
                    population: pop,
                    jobs,
                };
                match district_of(p, hint) {
                    Some(d) => {
                        hint = Some(d);
                        zones[d].cells.push(cell);
                    }
                    None => tiles.entry(tile_of(p)).or_default().push(cell),
                }
            }
        }
        if let Some(r) = &city.region_grid {
            for row in 0..r.rows {
                for col in 0..r.cols {
                    let i = r.index(col, row);
                    let (pop, jobs) = (r.population[i] as f64, r.jobs[i] as f64);
                    if pop + jobs <= 0.0 {
                        continue;
                    }
                    let p = r.cell_center(col, row);
                    // Cells inside the city are zeroed when the region raster
                    // is built. Those merely inside the fine raster's square —
                    // Pinneberg, Norderstedt, Ahrensburg — are not, and have no
                    // residents in the fine raster.
                    if g.population_at(p) > 0.0 {
                        continue;
                    }
                    tiles.entry(tile_of(p)).or_default().push(ZoneCell {
                        p,
                        population: pop,
                        jobs,
                    });
                }
            }
        }

        // Name a tile after its most important place, preferring towns to
        // quarters and, among equals, the one nearest the tile's centre of
        // population.
        let places: Vec<(Point, &str, f64, u8)> = city
            .landmarks
            .iter()
            .filter(|l| l.kind == crate::city::LandmarkKind::Place)
            .map(|l| {
                let rank = if l.category == "Ort" { 1 } else { 0 };
                (l.geo.to_metric(), l.name.as_str(), l.weight, rank)
            })
            .collect();
        let mut keys: Vec<(i64, i64)> = tiles.keys().copied().collect();
        keys.sort();
        let mut used: BTreeMap<String, usize> = BTreeMap::new();
        for z in &zones {
            used.insert(z.name.clone(), 1);
        }
        for key in keys {
            let cells = tiles.remove(&key).unwrap_or_default();
            let w: f64 = cells.iter().map(|c| c.population + c.jobs).sum();
            let centre = if w > 0.0 {
                Point::new(
                    cells.iter().map(|c| c.p.x * (c.population + c.jobs)).sum::<f64>() / w,
                    cells.iter().map(|c| c.p.y * (c.population + c.jobs)).sum::<f64>() / w,
                )
            } else {
                cells[0].p
            };
            let inside = places
                .iter()
                .filter(|(p, ..)| tile_of(*p) == key)
                .max_by(|a, b| {
                    (a.3, a.2)
                        .partial_cmp(&(b.3, b.2))
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| b.0.distance_to(&centre).total_cmp(&a.0.distance_to(&centre)))
                });
            let base = match inside {
                Some((_, name, ..)) => name.to_string(),
                None => places
                    .iter()
                    .min_by(|a, b| a.0.distance_to(&centre).total_cmp(&b.0.distance_to(&centre)))
                    .map(|(_, name, ..)| format!("bei {name}"))
                    .unwrap_or_else(|| format!("Kachel {} {}", key.0, key.1)),
            };
            // Two tiles can fall back on the same nearby place.
            let n = used.entry(base.clone()).or_insert(0);
            *n += 1;
            let name = if *n > 1 { format!("{base} ({n})") } else { base };
            zones.push(Zone {
                id: format!("r{}_{}", key.0, key.1),
                name,
                kind: ZoneKind::Region,
                population: 0.0,
                jobs: 0.0,
                cells,
            });
        }
        for z in &mut zones {
            z.population = z.cells.iter().map(|c| c.population).sum();
            z.jobs = z.cells.iter().map(|c| c.jobs).sum();
        }
        Zones { zones }
    }
}

/// How one zone reaches the network.
#[derive(Debug, Clone, Default)]
struct Access {
    /// Residents within walking distance of a station.
    served_population: f64,
    /// Residents and workplaces within walking distance of a station.
    served_weight: f64,
    /// Stations to start from, each with the mean walk of the residents who
    /// would use it.
    origin: Vec<(NodeId, f64)>,
    /// Stations to arrive at, each with the mean walk to the residents and
    /// workplaces around it.
    egress: Vec<(NodeId, f64)>,
}

fn access(zones: &Zones, g: &TravelGraph, net: &Network) -> Vec<Access> {
    let stations: Vec<(NodeId, Point)> = g
        .stations
        .iter()
        .filter_map(|n| net.nodes.get(n))
        .filter(|n| n.kind == NodeKind::Station)
        .map(|n| (n.id, n.geo.to_metric()))
        .collect();
    let bucket = |p: Point| {
        (
            (p.x / MAX_WALK_M).floor() as i64,
            (p.y / MAX_WALK_M).floor() as i64,
        )
    };
    let mut buckets: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
    for (i, (_, p)) in stations.iter().enumerate() {
        buckets.entry(bucket(*p)).or_default().push(i);
    }

    zones
        .zones
        .iter()
        .map(|z| {
            let mut a = Access::default();
            // Per station: Σ weight × walk and Σ weight, for residents and for
            // residents plus workplaces.
            let mut sums: BTreeMap<usize, (f64, f64, f64, f64)> = BTreeMap::new();
            for c in &z.cells {
                let (bx, by) = bucket(c.p);
                let mut any = false;
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        let Some(list) = buckets.get(&(bx + dx, by + dy)) else {
                            continue;
                        };
                        for &s in list {
                            let d = c.p.distance_to(&stations[s].1);
                            if d > MAX_WALK_M {
                                continue;
                            }
                            any = true;
                            let w = walk_minutes(d);
                            let e = sums.entry(s).or_insert((0.0, 0.0, 0.0, 0.0));
                            e.0 += c.population * w;
                            e.1 += c.population;
                            e.2 += (c.population + c.jobs) * w;
                            e.3 += c.population + c.jobs;
                        }
                    }
                }
                if any {
                    a.served_population += c.population;
                    a.served_weight += c.population + c.jobs;
                }
            }
            let mut sums: Vec<(usize, (f64, f64, f64, f64))> = sums.into_iter().collect();
            sums.sort_by_key(|(s, _)| *s);
            for (s, (pw, p, ww, w)) in sums {
                let id = stations[s].0;
                if p > 0.0 {
                    a.origin.push((id, pw / p));
                }
                if w > 0.0 {
                    a.egress.push((id, ww / w));
                }
            }
            a
        })
        .collect()
}

/// Everything about one network the comparison needs.
struct NetworkView {
    access: Vec<Access>,
    /// For each zone with served residents: the fastest journey to every
    /// other zone that can be reached, by zone index.
    journeys: BTreeMap<usize, Vec<(usize, Journey)>>,
}

fn view(zones: &Zones, g: &TravelGraph, net: &Network) -> NetworkView {
    let access = access(zones, g, net);
    let dests: Vec<usize> = (0..access.len())
        .filter(|&j| !access[j].egress.is_empty())
        .collect();
    let mut journeys = BTreeMap::new();
    for (i, a) in access.iter().enumerate() {
        if a.origin.is_empty() || a.served_population <= 0.0 {
            continue;
        }
        let reached = g.journeys_from_any(&a.origin);
        let mut row = Vec::new();
        for &j in &dests {
            if j == i {
                continue;
            }
            let best = access[j]
                .egress
                .iter()
                .filter_map(|(e, off)| {
                    reached.get(e).map(|r| Journey {
                        minutes: r.minutes + off,
                        ..*r
                    })
                })
                .min_by(|a, b| a.minutes.total_cmp(&b.minutes));
            if let Some(b) = best {
                row.push((j, b));
            }
        }
        journeys.insert(i, row);
    }
    NetworkView { access, journeys }
}

/// The calibrated destination and mode choice.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceModel {
    /// Utility per generalised minute.
    pub beta_per_min: f64,
    /// Utility of making the trip any other way.
    pub other_modes: f64,
    /// Elasticity of public transport demand to in-vehicle time the model
    /// reproduces on today's network.
    pub elasticity: f64,
    /// Share of the trips of residents near a station made by rail today.
    pub rail_share: f64,
}

/// Per origin: ln Σ_j A_j e^(−β t_ij), and the journeys behind it.
struct OriginChoice {
    zone: usize,
    served: f64,
    /// ln of the summed attraction of every reachable destination.
    log_sum: f64,
    /// Expected changes and in-vehicle minutes of a rail trip from here.
    changes: f64,
    in_vehicle: f64,
}

fn origins(v: &NetworkView, beta: f64) -> Vec<OriginChoice> {
    let mut out = Vec::new();
    let mut keys: Vec<&usize> = v.journeys.keys().collect();
    keys.sort();
    for &i in keys {
        let row = &v.journeys[&i];
        let terms: Vec<(f64, &Journey)> = row
            .iter()
            .filter(|(j, _)| v.access[*j].served_weight > 0.0)
            .map(|(j, jr)| (v.access[*j].served_weight.ln() - beta * jr.minutes, jr))
            .collect();
        if terms.is_empty() {
            continue;
        }
        let m = terms.iter().map(|(u, _)| *u).fold(f64::NEG_INFINITY, f64::max);
        let z: f64 = terms.iter().map(|(u, _)| (u - m).exp()).sum();
        let mut changes = 0.0;
        let mut ivt = 0.0;
        for (u, jr) in &terms {
            let p = (u - m).exp() / z;
            changes += p * jr.changes as f64;
            ivt += p * jr.in_vehicle_min;
        }
        out.push(OriginChoice {
            zone: i,
            served: v.access[i].served_population,
            log_sum: m + z.ln(),
            changes,
            in_vehicle: ivt,
        });
    }
    out
}

/// Share of trips by rail for an origin with log-sum `l`.
fn rail_share(l: f64, other: f64) -> f64 {
    1.0 / (1.0 + (other - l).exp())
}

/// ln(e^a + e^b) without overflow.
/// Logarithmic mean of two non-negative numbers, `(a − b) / (ln a − ln b)`.
fn log_mean(a: f64, b: f64) -> f64 {
    if a <= 0.0 || b <= 0.0 {
        return 0.0;
    }
    let d = a.ln() - b.ln();
    if d.abs() < 1e-9 {
        0.5 * (a + b)
    } else {
        (a - b) / d
    }
}

fn log_add(a: f64, b: f64) -> f64 {
    let m = a.max(b);
    m + ((a - m).exp() + (b - m).exp()).ln()
}

/// Fit the model to today's network.
///
/// The constant for other modes is found by bisection for a given time
/// sensitivity; the sensitivity is then rescaled towards the target
/// elasticity, and the two steps repeat until both hold. The elasticity of a
/// logit share with respect to a uniform change in in-vehicle time is
/// −β (1 − s) × the expected in-vehicle time, which is linear in β for a
/// fixed share — so the rescaling converges in a handful of rounds.
fn calibrate(v: &NetworkView, trips_per_person: f64, boardings: f64, target: f64) -> ChoiceModel {
    let mut beta = 0.05;
    let mut other = 0.0;
    let mut elasticity = 0.0;
    let mut share = 0.0;
    for _ in 0..30 {
        let o = origins(v, beta);
        if o.is_empty() || boardings <= 0.0 {
            break;
        }
        let boardings_at = |u0: f64| -> f64 {
            o.iter()
                .map(|c| c.served * trips_per_person * rail_share(c.log_sum, u0) * (1.0 + c.changes))
                .sum()
        };
        let (mut lo, mut hi) = (
            o.iter().map(|c| c.log_sum).fold(f64::INFINITY, f64::min) - 40.0,
            o.iter().map(|c| c.log_sum).fold(f64::NEG_INFINITY, f64::max) + 40.0,
        );
        for _ in 0..100 {
            let mid = 0.5 * (lo + hi);
            if boardings_at(mid) > boardings {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        other = 0.5 * (lo + hi);
        let trips: f64 = o
            .iter()
            .map(|c| c.served * rail_share(c.log_sum, other))
            .sum();
        let served: f64 = o.iter().map(|c| c.served).sum();
        share = if served > 0.0 { trips / served } else { 0.0 };
        elasticity = if trips > 0.0 {
            o.iter()
                .map(|c| {
                    let s = rail_share(c.log_sum, other);
                    c.served * s * (-beta * (1.0 - s) * c.in_vehicle)
                })
                .sum::<f64>()
                / trips
        } else {
            0.0
        };
        if elasticity >= 0.0 {
            break;
        }
        let next = beta * target / elasticity;
        let done = (next - beta).abs() < 1e-5 * beta;
        beta = next.clamp(1e-4, 1.0);
        if done {
            break;
        }
    }
    ChoiceModel {
        beta_per_min: beta,
        other_modes: other,
        elasticity,
        rail_share: share,
    }
}

/// One part of the city or the region, compared between the two networks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneConnectivity {
    pub id: String,
    pub name: String,
    pub kind: ZoneKind,
    pub population: f64,
    pub jobs: f64,
    pub served_before: f64,
    pub served_after: f64,
    /// Mean door-to-door time to the city's districts, weighted by their
    /// residents and workplaces, for the average resident. A resident without
    /// a station nearby, and a destination without one, count at [`CAP_MIN`].
    pub mean_min_before: f64,
    pub mean_min_after: f64,
    /// Residents and workplaces, city and region, that the average resident
    /// reaches within [`REACH_MIN`] by rail.
    pub reachable_before: f64,
    pub reachable_after: f64,
}

/// A journey between two zones on one network.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trip {
    pub minutes: f64,
    pub changes: u32,
    pub in_vehicle_min: f64,
}

impl From<Journey> for Trip {
    fn from(j: Journey) -> Self {
        Trip {
            minutes: j.minutes,
            changes: j.changes,
            in_vehicle_min: j.in_vehicle_min,
        }
    }
}

/// A relation whose journey the scenario changes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub from: String,
    pub from_name: String,
    pub to: String,
    pub to_name: String,
    pub before: Option<Trip>,
    pub after: Option<Trip>,
    /// Rail trips per weekday between the two, both directions, after.
    pub trips_per_day: f64,
    /// Hours saved per weekday on this relation (negative if lost).
    pub hours_per_day: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectivityResult {
    pub model: Option<ChoiceModel>,
    /// Hours saved per weekday, from the change in logsum.
    pub hours_saved_per_day: f64,
    /// Rail trips per weekday predicted on each network.
    pub trips_before: f64,
    pub trips_after: f64,
    /// Every district, and every regional tile with a station nearby on
    /// either network.
    pub zones: Vec<ZoneConnectivity>,
    /// The relations with the largest gains, then the largest losses.
    pub improved: Vec<Relation>,
    pub worsened: Vec<Relation>,
}

const TOP_IMPROVED: usize = 20;
const TOP_WORSENED: usize = 10;

/// Compare two networks for the same city.
///
/// `before` is today's network, on which the choice model is calibrated so
/// that it carries `boardings_today`.
pub fn compare(
    net: &Network,
    city: &CityData,
    params: &Params,
    before: &TravelGraph,
    after: &TravelGraph,
    boardings_today: f64,
) -> ConnectivityResult {
    let built;
    let zones = match city.zones() {
        Some(z) => z,
        None => {
            built = Zones::build(city);
            &built
        }
    };
    let d = &params.demand;
    let vb = view(zones, before, net);
    let va = view(zones, after, net);
    let model = calibrate(&vb, d.trips_per_person_day, boardings_today, -d.ivt_elasticity.abs());
    let beta = model.beta_per_min;
    let u0 = model.other_modes;
    let rate = d.trips_per_person_day;

    let ob = origins(&vb, beta);
    let oa = origins(&va, beta);
    let by_zone = |o: &[OriginChoice]| -> BTreeMap<usize, (f64, f64)> {
        o.iter().map(|c| (c.zone, (c.served, c.log_sum))).collect()
    };
    let lb = by_zone(&ob);
    let la = by_zone(&oa);

    // Consumer surplus per day, in minutes: rate / β × Σ served × ln(1 + e^(L − U0)).
    // Residents without a station keep the other modes in both cases and
    // drop out of the difference.
    let surplus = |m: &BTreeMap<usize, (f64, f64)>| -> f64 {
        m.values()
            .map(|(s, l)| s * (log_add(0.0, l - u0)))
            .sum::<f64>()
            * rate
            / beta
    };
    let calibrated = ob.iter().any(|c| c.served > 0.0) && boardings_today > 0.0;
    let hours = if calibrated {
        (surplus(&la) - surplus(&lb)) / 60.0
    } else {
        0.0
    };
    let trips = |o: &[OriginChoice]| -> f64 {
        o.iter()
            .map(|c| c.served * rate * rail_share(c.log_sum, u0))
            .sum()
    };

    // Rail trips between each pair, from the destination shares.
    let pair_trips = |v: &NetworkView, i: usize, l: f64| -> BTreeMap<usize, f64> {
        let a = &v.access[i];
        let total = a.served_population * rate * rail_share(l, u0);
        v.journeys
            .get(&i)
            .map(|row| {
                row.iter()
                    .filter(|(j, _)| v.access[*j].served_weight > 0.0)
                    .map(|(j, jr)| {
                        let u = v.access[*j].served_weight.ln() - beta * jr.minutes;
                        (*j, total * (u - l).exp())
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    // ---------------------------------------------------------- per zone --
    let districts: Vec<usize> = (0..zones.zones.len())
        .filter(|&j| zones.zones[j].kind == ZoneKind::District)
        .collect();
    let district_weight: f64 = districts.iter().map(|&j| zones.zones[j].weight()).sum();
    let summary = |v: &NetworkView, i: usize| -> (f64, f64) {
        let z = &zones.zones[i];
        let a = &v.access[i];
        let served_share = if z.population > 0.0 {
            (a.served_population / z.population).min(1.0)
        } else {
            0.0
        };
        let times: BTreeMap<usize, f64> = v
            .journeys
            .get(&i)
            .map(|row| row.iter().map(|(j, jr)| (*j, jr.minutes.min(CAP_MIN))).collect())
            .unwrap_or_default();
        let mut mean = CAP_MIN;
        if district_weight > 0.0 {
            let mut sum = 0.0;
            for &j in &districts {
                let zj = &zones.zones[j];
                let w = zj.weight();
                if w <= 0.0 {
                    continue;
                }
                let reached = (v.access[j].served_weight / w).min(1.0);
                let t = if j == i {
                    // Within the own district: no rail trip needed.
                    0.0
                } else {
                    times.get(&j).copied().unwrap_or(CAP_MIN)
                };
                let t = if j == i { t } else { reached * t + (1.0 - reached) * CAP_MIN };
                sum += w * t;
            }
            let rail = sum / district_weight;
            mean = served_share * rail + (1.0 - served_share) * CAP_MIN;
        }
        let reach: f64 = times
            .iter()
            .filter(|(_, t)| **t <= REACH_MIN)
            .map(|(j, _)| v.access[*j].served_weight)
            .sum::<f64>()
            * served_share
            // An empty sum is −0, which prints as "-0".
            + 0.0;
        (mean, reach)
    };
    let mut out_zones = Vec::new();
    for (i, z) in zones.zones.iter().enumerate() {
        let served_b = vb.access[i].served_population;
        let served_a = va.access[i].served_population;
        if z.kind == ZoneKind::Region && served_a <= 0.0 && served_b <= 0.0 {
            continue;
        }
        let (mb, rb) = summary(&vb, i);
        let (ma, ra) = summary(&va, i);
        out_zones.push(ZoneConnectivity {
            id: z.id.clone(),
            name: z.name.clone(),
            kind: z.kind,
            population: z.population,
            jobs: z.jobs,
            served_before: served_b,
            served_after: served_a,
            mean_min_before: mb,
            mean_min_after: ma,
            reachable_before: rb,
            reachable_after: ra,
        });
    }

    // --------------------------------------------------------- relations --
    let mut pairs: BTreeMap<(usize, usize), (Option<Journey>, Option<Journey>, f64, f64)> =
        BTreeMap::new();
    for (v, l, is_after) in [(&vb, &lb, false), (&va, &la, true)] {
        for (&i, row) in &v.journeys {
            let Some((_, li)) = l.get(&i) else { continue };
            let t = pair_trips(v, i, *li);
            for (j, jr) in row {
                let e = pairs.entry((i, *j)).or_insert((None, None, 0.0, 0.0));
                let n = t.get(j).copied().unwrap_or(0.0);
                if is_after {
                    e.1 = Some(*jr);
                    e.3 = n;
                } else {
                    e.0 = Some(*jr);
                    e.2 = n;
                }
            }
        }
    }
    // Both directions of a relation together, shown in the busier one.
    let mut relations: BTreeMap<(usize, usize), Relation> = BTreeMap::new();
    let mut keys: Vec<&(usize, usize)> = pairs.keys().collect();
    keys.sort();
    for &(i, j) in keys {
        let (b, a, nb, na) = pairs[&(i, j)];
        // Consumer surplus of the relation under the same logit as the total.
        // Trips fall off as e^(-β t), so the area under the demand curve
        // between the two times is the logarithmic mean of the trips times
        // the time saved; trips merely drawn to or from other destinations
        // count for nothing here. A relation that did not exist before gains
        // n_after / β, not n × (180 − t): the cap is a display convention,
        // not a travel time anyone pays.
        let hours = match (b, a) {
            (Some(b), Some(a)) => log_mean(nb, na) * (b.minutes - a.minutes) / 60.0,
            (None, Some(_)) if beta > 0.0 => na / beta / 60.0,
            (Some(_), None) if beta > 0.0 => -nb / beta / 60.0,
            _ => 0.0,
        };
        let key = (i.min(j), i.max(j));
        let entry = relations.entry(key).or_insert_with(|| Relation {
            from: zones.zones[i].id.clone(),
            from_name: zones.zones[i].name.clone(),
            to: zones.zones[j].id.clone(),
            to_name: zones.zones[j].name.clone(),
            before: b.map(Trip::from),
            after: a.map(Trip::from),
            trips_per_day: 0.0,
            hours_per_day: 0.0,
        });
        let busier = na > entry.trips_per_day - na;
        entry.trips_per_day += na;
        entry.hours_per_day += hours;
        if busier && entry.from != zones.zones[i].id {
            entry.from = zones.zones[i].id.clone();
            entry.from_name = zones.zones[i].name.clone();
            entry.to = zones.zones[j].id.clone();
            entry.to_name = zones.zones[j].name.clone();
            entry.before = b.map(Trip::from);
            entry.after = a.map(Trip::from);
        }
    }
    let mut rel: Vec<Relation> = relations.into_values().collect();
    rel.sort_by(|a, b| {
        b.hours_per_day
            .total_cmp(&a.hours_per_day)
            .then_with(|| a.from.cmp(&b.from))
            .then_with(|| a.to.cmp(&b.to))
    });
    let improved: Vec<Relation> = rel
        .iter()
        .filter(|r| r.hours_per_day > 0.01)
        .take(TOP_IMPROVED)
        .cloned()
        .collect();
    let worsened: Vec<Relation> = rel
        .iter()
        .rev()
        .filter(|r| r.hours_per_day < -0.01)
        .take(TOP_WORSENED)
        .cloned()
        .collect();

    ConnectivityResult {
        model: calibrated.then_some(model),
        hours_saved_per_day: hours,
        trips_before: trips(&ob),
        trips_after: trips(&oa),
        zones: out_zones,
        improved,
        worsened,
    }
}

/// The journey between two zones on both networks, for a lookup in the
/// interface.
pub fn journey_between(
    net: &Network,
    city: &CityData,
    graph: &TravelGraph,
    from: &str,
    to: &str,
) -> Option<Trip> {
    let built;
    let zones = match city.zones() {
        Some(z) => z,
        None => {
            built = Zones::build(city);
            &built
        }
    };
    let i = zones.zones.iter().position(|z| z.id == from)?;
    let j = zones.zones.iter().position(|z| z.id == to)?;
    let one = Zones {
        zones: vec![zones.zones[i].clone(), zones.zones[j].clone()],
    };
    let acc = access(&one, graph, net);
    if acc[0].origin.is_empty() {
        return None;
    }
    let reached = graph.journeys_from_any(&acc[0].origin);
    acc[1]
        .egress
        .iter()
        .filter_map(|(e, off)| {
            reached.get(e).map(|r| Journey {
                minutes: r.minutes + off,
                ..*r
            })
        })
        .min_by(|a, b| a.minutes.total_cmp(&b.minutes))
        .map(Trip::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::demo_city;

    #[test]
    fn every_resident_lands_in_exactly_one_zone() {
        let city = demo_city();
        let z = Zones::build(&city);
        let total: f64 = z.zones.iter().map(|z| z.population).sum();
        let grid = city.grid.total_population()
            + city
                .region_grid
                .as_ref()
                .map_or(0.0, |r| {
                    let mut s = 0.0;
                    for row in 0..r.rows {
                        for col in 0..r.cols {
                            if city.grid.population_at(r.cell_center(col, row)) <= 0.0 {
                                s += r.population[r.index(col, row)] as f64;
                            }
                        }
                    }
                    s
                });
        assert!((total - grid).abs() < 1.0, "{total} vs {grid}");
        let mut ids: Vec<&str> = z.zones.iter().map(|z| z.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), z.zones.len());
    }
}
