//! Ridership and accessibility (plan §32, §73).
//!
//! Two linked models:
//!
//! * a **catchment model** that turns residents and workplaces around each
//!   station into daily boardings, calibrated so the present-day Hamburg
//!   network reproduces observed ridership;
//! * an **accessibility model** that routes over the network graph and measures
//!   how much travel time the scenario saves compared with today's network.
//!
//! The travel-time saving is what the economic model monetises, so it has to be
//! derived from the graph rather than assumed.

use crate::city::CityData;
use crate::geo::Point;
use crate::model::{BuildStatus, Network, NodeId, NodeKind};
use crate::params::Params;
use crate::travel::{walk_minutes, TravelGraph};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationDemand {
    pub node: NodeId,
    pub name: String,
    pub boardings_per_day: f64,
    pub catchment_population: f64,
    pub catchment_jobs: f64,
    pub interchange: bool,
    pub is_new: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemandResult {
    /// Boardings on a normal weekday across the whole scenario network.
    pub boardings_per_day: f64,
    /// Boardings attributable to the newly built parts.
    pub new_boardings_per_day: f64,
    pub annual_rides: f64,
    pub passenger_km_per_year: f64,
    pub stations: Vec<StationDemand>,
    /// Residents within walking distance of a station, before and after.
    pub population_served_before: f64,
    pub population_served_after: f64,
    /// Weighted mean access time to the employment centres, minutes.
    pub access_time_before_min: f64,
    pub access_time_after_min: f64,
    /// Person-hours saved per weekday across the city and region.
    pub hours_saved_per_day: f64,
    /// Car trips removed per weekday.
    pub car_trips_replaced_per_day: f64,
    pub car_km_replaced_per_year: f64,
    /// Journeys between the parts of the city and the region.
    #[serde(default)]
    pub connectivity: crate::connectivity::ConnectivityResult,
    pub notes: Vec<String>,
}

/// Boardings for one station from its catchment.
fn station_boardings(
    p: Point,
    mode: crate::model::Mode,
    interchange: bool,
    central: bool,
    city: &CityData,
    params: &Params,
) -> (f64, f64, f64) {
    let d = &params.demand;
    let radius = d.catchment_radius_m.get(mode);
    let c = city.catchment(p, radius, d.catchment_decay);
    let mut v = c.weighted(d.job_weight) * d.boardings_per_catchment.get(mode);
    if interchange {
        v *= d.interchange_factor;
    }
    if central {
        v *= d.centrality_factor;
    }
    (v, c.population, c.jobs)
}

/// What the access measure charges when there is no rail service at all.
///
/// Used twice: for an employment centre a cell's stations cannot reach, and for
/// a cell with no station within walking distance. Both must be worse than any
/// journey the model can produce, or the measure punishes success — this was a
/// flat 75 minutes, which is less than a real ride from the edge of the region
/// into Hamburg, so connecting a town that had no rail at all *raised* the
/// average access time. A regional S-Bahn to Lüneburg scored zero travel-time
/// benefit, its largest item by far, for that reason alone.
///
/// It has to be a constant rather than something read off the data. Deriving it
/// from the longest journey in the current network makes the number mean
/// something different before and after, and the two are subtracted from each
/// other — the monotonicity test catches that immediately. As a fixed ceiling
/// it also bounds every cell's average, since each is a weighted mean of
/// per-centre times that are themselves capped here. So replacing the
/// placeholder with a real journey can only ever lower the average, which is
/// the property the measure needs.
const UNREACHABLE_MIN: f64 = 180.0;

/// Rides per year on whatever the network has switched on, without the
/// accessibility calculation.
///
/// The appraisal needs the operating result of today's network as its
/// comparison case, and for that only the fare revenue is missing — which is
/// boardings, not travel times.
pub fn annual_rides(net: &Network, city: &CityData, params: &Params) -> f64 {
    station_demand(net, city, params).1 * params.demand.annual_factor
}

/// Boardings station by station: the list, the total, and the part at stations
/// that are new or reached over new track.
fn station_demand(net: &Network, city: &CityData, params: &Params) -> (Vec<StationDemand>, f64, f64) {
    let mut stations = Vec::new();
    let mut total = 0.0;
    let mut new_total = 0.0;
    let active: std::collections::BTreeSet<crate::model::EdgeId> =
        net.active_edges().into_iter().collect();

    let centre = city
        .centres
        .iter()
        .find(|c| c.primary)
        .map(|c| c.geo.to_metric())
        .unwrap_or_else(|| city.center.to_metric());

    for nid in net.active_stations() {
        let Some(n) = net.nodes.get(&nid) else {
            continue;
        };
        // The services that call here *in this scenario*, by label.
        //
        // This counted line records, switched on or not. Two things followed.
        // A line stored as several records — the U1 with its two eastern
        // branches, the S1 to the airport and to Poppenbüttel — made every
        // station on the shared trunk an interchange with itself, and a
        // planned or proposed line made one of every station it would touch,
        // including in a scenario that leaves it out. Both multiplied the
        // boardings by the interchange factor, so the U1 carried half as much
        // again as a line that happens to be stored as one record.
        let services = net.services_at_node(nid);
        let mode = services
            .iter()
            .map(|(_, m)| *m)
            .min()
            .unwrap_or(crate::model::Mode::Ubahn);
        let p = n.geo.to_metric();
        let interchange = services.len() > 1;
        let central = p.distance_to(&centre) < 2500.0;
        let (b, pop, jobs) = station_boardings(p, mode, interchange, central, city, params);
        let is_new = n.status != BuildStatus::InService
            || net
                .edges_at(nid)
                .iter()
                .filter(|e| active.contains(e))
                .filter_map(|e| net.edges.get(e))
                .any(|e| e.status != BuildStatus::InService);
        total += b;
        if is_new {
            new_total += b;
        }
        stations.push(StationDemand {
            node: nid,
            name: n.name.clone(),
            boardings_per_day: b,
            catchment_population: pop,
            catchment_jobs: jobs,
            interchange,
            is_new,
        });
    }
    (stations, total, new_total)
}

pub fn calculate(net: &Network, city: &CityData, params: &Params) -> DemandResult {
    let d = &params.demand;
    let (mut stations, catchment_total, _) = station_demand(net, city, params);
    let today_total = station_demand(&net.today(), city, params).1;

    // ------------------------------------------------------- accessibility --

    let ops = &params.operations;
    let after = TravelGraph::build(net, ops, false);
    let before = TravelGraph::build(net, ops, true);

    let station_points = |g: &TravelGraph| -> Vec<(NodeId, Point)> {
        g.stations
            .iter()
            .filter_map(|n| net.nodes.get(n))
            .filter(|n| n.kind == NodeKind::Station)
            .map(|n| (n.id, n.geo.to_metric()))
            .collect()
    };
    let pts_after = station_points(&after);
    let pts_before = station_points(&before);

    // Every employment centre the city has, whether or not rail reaches it.
    //
    // The list must not depend on the network. Built from the stations that
    // exist, it gave the average a moving denominator: a scenario that brought
    // a new centre within reach of rail added a term to every cell's average —
    // at the unreachable penalty, for all the cells nowhere near it — and so
    // made the city's mean accessibility look *worse* for having built
    // something. A centre nobody can reach carries the penalty in both cases,
    // and reaching it then shows up as the improvement it is.
    let centres: Vec<(f64, Point)> = city
        .centres
        .iter()
        .map(|c| (c.jobs.max(1.0), c.geo.to_metric()))
        .collect();

    // Times from every employment centre to every station, weighted by jobs.
    //
    // Every station within walking distance of the centre is a way in, each
    // with its own walk. Taking only the nearest one made the measure
    // non-monotonic in the other direction too: a new stop that landed closer
    // to a centre than the interchange it displaced moved the whole centre onto
    // whatever branch the new stop was on.
    let centre_times = |g: &TravelGraph, pts: &[(NodeId, Point)]| -> Vec<HashMap<NodeId, f64>> {
        centres
            .iter()
            .map(|(_, cp)| {
                let starts: Vec<(NodeId, f64)> = pts
                    .iter()
                    .map(|(id, p)| (*id, p.distance_to(cp)))
                    .filter(|(_, dd)| *dd < 1800.0)
                    // Everyone still has to walk from the station to the centre.
                    .map(|(id, dd)| (id, walk_minutes(dd)))
                    .collect();
                g.times_from_any(&starts)
            })
            .collect()
    };
    let ct_after = centre_times(&after, &pts_after);
    let ct_before = centre_times(&before, &pts_before);
    let centre_weight: f64 = centres.iter().map(|(w, _)| *w).sum::<f64>().max(1.0);

    // For every populated cell: walk to the nearest station, then ride.
    //
    // Both rasters, not just the city one. Hamburg's fine grid stops 21 km from
    // the centre, and everything this loop skips is worth exactly nothing in
    // the appraisal — so a regional S-Bahn to Lüneburg, whose whole purpose is
    // to carry people from outside that square into the city, scored one saved
    // hour per day against twenty thousand new boardings. The coarse raster
    // covers the region; a cell is counted from whichever raster is finer where
    // it lies, never from both.
    let max_walk_m = 1200.0;

    let access = |pts: &[(NodeId, Point)],
                  ct: &[HashMap<NodeId, f64>],
                  p: Point|
     -> Option<(f64, f64)> {
        let near: Vec<(NodeId, f64)> = pts
            .iter()
            .map(|(id, q)| (*id, p.distance_to(q)))
            .filter(|(_, dd)| *dd <= max_walk_m)
            .collect();
        if near.is_empty() {
            return None;
        }
        let mut weighted = 0.0;
        for ((w, _), times) in centres.iter().zip(ct) {
            // Best combination of access station and ride.
            let best = near
                .iter()
                .filter_map(|(id, dd)| times.get(id).map(|t| walk_minutes(*dd) + *t))
                .fold(f64::INFINITY, f64::min);
            weighted += w * if best.is_finite() { best } else { UNREACHABLE_MIN };
        }
        let nearest = near.iter().map(|(_, dd)| *dd).fold(f64::INFINITY, f64::min);
        Some((weighted / centre_weight, nearest))
    };

    // Every populated cell, with what it can reach before and after.
    let mut cells: Vec<(f64, Option<f64>, Option<f64>)> = Vec::new();
    let mut collect = |grid: &crate::city::DemographicGrid, skip_covered: bool| {
        for row in 0..grid.rows {
            for col in 0..grid.cols {
                let i = grid.index(col, row);
                let pop = grid.population[i] as f64;
                if pop < 1.0 {
                    continue;
                }
                let p = grid.cell_center(col, row);
                // The coarse raster is zeroed inside the city's districts when
                // it is built, so a cell counts from one raster only. Its
                // extent still overlaps the fine one's: Pinneberg, Norderstedt
                // and Ahrensburg lie inside the fine raster's square but
                // outside the city, and their residents exist only here.
                if skip_covered && city.grid.population_at(p) > 0.0 {
                    continue;
                }
                cells.push((
                    pop,
                    access(&pts_after, &ct_after, p).map(|(t, _)| t),
                    access(&pts_before, &ct_before, p).map(|(t, _)| t),
                ));
            }
        }
    };
    collect(&city.grid, false);
    if let Some(region) = &city.region_grid {
        collect(region, true);
    }

    let mut pop_before = 0.0;
    let mut pop_after = 0.0;
    let mut wsum_before = 0.0;
    let mut wsum_after = 0.0;
    let mut weight_total = 0.0;
    for (pop, a, b) in &cells {
        if a.is_some() {
            pop_after += pop;
        }
        if b.is_some() {
            pop_before += pop;
        }
        wsum_after += a.unwrap_or(UNREACHABLE_MIN) * pop;
        wsum_before += b.unwrap_or(UNREACHABLE_MIN) * pop;
        weight_total += pop;
    }

    let access_after = if weight_total > 0.0 {
        wsum_after / weight_total
    } else {
        0.0
    };
    let access_before = if weight_total > 0.0 {
        wsum_before / weight_total
    } else {
        0.0
    };
    // Signed, not floored at zero.
    //
    // A scenario that takes existing lines away makes journeys longer, and that
    // is a real cost to real people. Flooring it meant such a scenario was
    // charged nothing for the damage while still collecting the benefits of
    // whatever it built: replacing Hamburg's whole network with four tram lines
    // lengthened the average journey by twenty minutes and still scored a
    // benefit-cost ratio near three. Building can only improve the measure, so
    // the sign only ever turns negative when something was removed.
    let saved_min = access_before - access_after;

    // Hours saved: from the change in the logsum of a destination and mode
    // choice model over every pair of zones, calibrated on today's network.
    // It counts the full saving for trips made anyway, about half for trips
    // the faster connection wins over, and a loss where lines are removed.
    let connectivity =
        crate::connectivity::compare(net, city, params, &before, &after, today_total);
    let hours_saved = connectivity.hours_saved_per_day;

    // New boardings: the increase over today's network, but no more than the
    // journeys the choice model sees switching to rail can carry.
    //
    // Counting every boarding at a station that new track touches would credit
    // an existing interchange's whole demand to the scenario, hence the
    // difference to today. The difference alone still overstates, because each
    // station counts its catchment as if no other station were near: two tram
    // stops 190 m apart between Holstenwall and Neustadt, in streets the U-Bahn
    // already serves, reached no one new and yet added 8 200 boardings a day,
    // which as replaced car trips and fares gave the stub a benefit-cost ratio
    // near four. Riders who merely walk to a nearer stop are not new riders;
    // the choice model, which compares door-to-door journeys over the whole
    // network, is what says how many there are.
    let catchment_new = (catchment_total - today_total).max(0.0);
    let boardings_per_journey = if connectivity.trips_before > 0.0 {
        today_total / connectivity.trips_before
    } else {
        1.0
    };
    let journeys_gained = (connectivity.trips_after - connectivity.trips_before).max(0.0);
    let new_total = if connectivity.trips_before > 0.0 {
        catchment_new.min(journeys_gained * boardings_per_journey)
    } else {
        catchment_new
    };
    let total = if catchment_total > today_total {
        today_total + new_total
    } else {
        catchment_total
    };

    let annual = total * d.annual_factor;
    let avg_trip_km = {
        // Mean ride length from the network: total route km per station gap.
        let km: f64 = net
            .active_edges()
            .iter()
            .filter_map(|e| net.edges.get(e))
            .map(|e| e.length_km())
            .sum();
        let n = stations.len().max(1) as f64;
        (km / n * 4.5).clamp(3.0, 14.0)
    };
    let car_trips = new_total * d.car_substitution_share;
    let car_km_year = car_trips * d.avg_replaced_car_trip_km * d.annual_factor;

    let mut notes = vec![
        "Die Nachfrage ist nicht gezählt, sondern aus Einzugsbereichen, Umsteigezuschlägen und den Reisezeiten im Netz berechnet."
            .to_string(),
    ];
    if catchment_new > new_total + 1.0 {
        notes.push(
            "Die neuen Haltestellen liegen zum Teil in Einzugsbereichen bestehender; als neue Fahrgäste zählen nur die Wege, die nach dem Wahlmodell neu auf die Bahn wechseln."
                .into(),
        );
    }
    if saved_min <= 0.0 {
        notes.push("Das Szenario verkürzt die mittlere Erreichbarkeit nicht messbar.".into());
    }

    stations.sort_by(|a, b| {
        b.boardings_per_day.total_cmp(&a.boardings_per_day)
    });

    DemandResult {
        boardings_per_day: total,
        new_boardings_per_day: new_total,
        annual_rides: annual,
        passenger_km_per_year: annual * avg_trip_km,
        stations,
        population_served_before: pop_before,
        population_served_after: pop_after,
        access_time_before_min: access_before,
        access_time_after_min: access_after,
        hours_saved_per_day: hours_saved,
        car_trips_replaced_per_day: car_trips,
        car_km_replaced_per_year: car_km_year,
        connectivity,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Infrastructure, Mode};
    use crate::testing::{demo_city, demo_network};

    #[test]
    fn a_network_with_no_stations_has_no_demand() {
        let net = Network::new();
        let r = calculate(&net, &demo_city(), &Params::default());
        assert_eq!(r.boardings_per_day, 0.0);
        assert!(r.stations.is_empty());
    }

    #[test]
    fn demand_grows_with_the_catchment() {
        let city = demo_city();
        let p = Params::default();
        let small = calculate(
            &crate::testing::demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 3.0),
            &city,
            &p,
        );
        let big = calculate(
            &crate::testing::demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 9.0),
            &city,
            &p,
        );
        assert!(big.boardings_per_day > small.boardings_per_day);
        assert!(big.stations.len() > small.stations.len());
    }

    #[test]
    fn interchanges_carry_more_than_plain_stops() {
        let city = demo_city();
        let p = Params::default();
        let pt = Point::new(0.0, 0.0);
        let (plain, _, _) = station_boardings(pt, Mode::Ubahn, false, false, &city, &p);
        let (inter, _, _) = station_boardings(pt, Mode::Ubahn, true, false, &city, &p);
        assert!(inter > plain);
    }

    #[test]
    fn a_new_line_improves_accessibility() {
        let city = demo_city();
        let p = Params::default();
        let mut net = demo_network();
        // Everything existing today.
        for e in net.edges.values_mut() {
            e.status = BuildStatus::InService;
        }
        for n in net.nodes.values_mut() {
            n.status = BuildStatus::InService;
        }
        let base = calculate(&net, &city, &p);
        assert!((base.access_time_after_min - base.access_time_before_min).abs() < 1e-6);

        let mut ed = crate::editor::Editor::new(net, city.clone(), p.clone());
        ed.apply(crate::editor::Command::DrawLine {
            mode: Mode::Ubahn,
            infrastructure: None,
            points: vec![
                Point::new(-6000.0, 5000.0).to_latlon(),
                Point::new(6000.0, 5000.0).to_latlon(),
            ],
            label: Some("U9".into()),
            color: None,
            auto_stations: true,
            anchors: None,
        })
        .unwrap();
        let after = calculate(&ed.network, &city, &p);
        assert!(
            after.access_time_after_min <= after.access_time_before_min + 1e-6,
            "the scenario network cannot be slower than today's"
        );
        assert!(after.new_boardings_per_day > 0.0);
    }

    /// Adding track must never make the city less accessible.
    ///
    /// The failure this pins down is specific: accessibility of an employment
    /// centre used to be measured from the single *nearest* station. A short
    /// stub built beside a centre — connected to nothing — became that nearest
    /// station and took the whole centre with it, so drawing a line made every
    /// measured journey longer and wiped out the travel-time benefit of the
    /// rest of the scenario. Nothing in the old test caught it, because it drew
    /// a line that happened not to displace anything.
    #[test]
    fn a_stub_beside_a_centre_cannot_make_the_city_slower() {
        let city = demo_city();
        let p = Params::default();
        let net = demo_network();
        let before = calculate(&net, &city, &p);

        let mut ed = crate::editor::Editor::new(net, city.clone(), p.clone());
        // A 700 m stub starting 200 m from the main centre, touching nothing.
        ed.apply(crate::editor::Command::DrawLine {
            mode: Mode::Tram,
            infrastructure: None,
            points: vec![
                Point::new(200.0, 150.0).to_latlon(),
                Point::new(900.0, 150.0).to_latlon(),
            ],
            label: Some("Stichbahn".into()),
            color: None,
            auto_stations: true,
            anchors: None,
        })
        .unwrap();
        let after = calculate(&ed.network, &city, &p);
        assert!(
            after.access_time_after_min <= before.access_time_after_min + 1e-6,
            "eine zusätzliche Strecke hat die Erreichbarkeit verschlechtert: \
             {:.2} min statt {:.2} min",
            after.access_time_after_min,
            before.access_time_after_min
        );
        assert!(
            after.access_time_after_min <= after.access_time_before_min + 1e-6,
            "das Szenarionetz kann nicht langsamer sein als der Bestand"
        );
        assert!(
            after.hours_saved_per_day >= 0.0,
            "negative Zeitersparnis: {}",
            after.hours_saved_per_day
        );
    }

    #[test]
    fn car_substitution_only_counts_new_demand() {
        let city = demo_city();
        let p = Params::default();
        let net = demo_network();
        let r = calculate(&net, &city, &p);
        // demo_network is entirely in service, so nothing is "new".
        assert_eq!(r.new_boardings_per_day, 0.0);
        assert_eq!(r.car_trips_replaced_per_day, 0.0);
    }
}
