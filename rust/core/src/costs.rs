//! Segment-based construction cost and the itemised "invoice" (plan §27–§29).
//!
//! Every segment that still has to be built carries its own estimate; stations,
//! junctions and the indirect cost blocks are added on top, and the result is
//! reported as a range, never as a single falsely precise figure.

use crate::city::CityData;
use crate::model::{BuildStatus, EdgeId, Infrastructure, Mode, Network, NodeId};
use crate::params::Params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostItem {
    pub label: String,
    /// e.g. "2,4 km Tunnel (TVM)".
    pub detail: String,
    pub amount_eur: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    /// Where the number comes from, so the UI can label it (plan §28).
    pub basis: Basis,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
}

/// Provenance of a figure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Basis {
    /// Derived from a benchmark unit rate.
    Benchmark,
    /// A modelled share or factor.
    Modelled,
    /// An assumption with weak empirical support.
    Assumption,
}

impl Basis {
    pub fn label_de(&self) -> &'static str {
        match self {
            Basis::Benchmark => "Kennwert",
            Basis::Modelled => "modelliert",
            Basis::Assumption => "Annahme",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostCategory {
    pub key: String,
    pub label: String,
    pub amount_eur: f64,
    pub items: Vec<CostItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostResult {
    /// Point estimate in current prices, €.
    pub total_eur: f64,
    /// Lower and upper end of the reported range, €.
    pub low_eur: f64,
    pub high_eur: f64,
    /// Direct construction cost before indirect blocks.
    pub construction_eur: f64,
    /// Price escalation to the construction midpoint, already in `total_eur`.
    pub escalation_eur: f64,
    pub categories: Vec<CostCategory>,
    /// Cost of every segment that has to be built, for the map.
    pub segments: Vec<SegmentCost>,
    pub new_km: f64,
    pub new_stations: usize,
    pub upgraded_stations: usize,
    pub junctions: usize,
    pub tunnel_km: f64,
    pub surface_km: f64,
    pub elevated_km: f64,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentCost {
    pub edge: crate::model::EdgeId,
    pub line: String,
    pub from: String,
    pub to: String,
    pub mode: Mode,
    pub infrastructure: Infrastructure,
    pub length_km: f64,
    pub amount_eur: f64,
    pub water_crossing_m: f64,
    pub density_index: f64,
}

/// Cost of everything in the scenario that is not already in service.
pub fn calculate(
    net: &Network,
    city: &CityData,
    params: &Params,
    opening_year: Option<i32>,
) -> CostResult {
    let c = &params.cost;
    let mut track_items = Vec::new();
    let mut station_items = Vec::new();
    let mut junction_items = Vec::new();
    let mut segments = Vec::new();
    let mut vehicle_items = Vec::new();

    let mut construction = 0.0;
    let mut tunnel_km = 0.0;
    let mut surface_km = 0.0;
    let mut elevated_km = 0.0;
    let mut new_km = 0.0;
    // Which infrastructure dominates decides the indirect shares below.
    let mut km_by_infra: Vec<(Infrastructure, f64)> = Vec::new();

    let active = net.active_edges();
    let active_set: std::collections::BTreeSet<EdgeId> = active.iter().copied().collect();
    let adjacency = net.adjacency();
    let no_edges: Vec<EdgeId> = Vec::new();
    let at = |n: NodeId| adjacency.get(&n).unwrap_or(&no_edges);
    for eid in &active {
        let Some(e) = net.edges.get(eid) else {
            continue;
        };
        let share = e.status.cost_share();
        if share <= 0.0 {
            continue;
        }
        let pts: Vec<crate::geo::Point> = e.geo.iter().map(|p| p.to_metric()).collect();
        let density = city.density_index(&pts);
        let water_m = city.water_crossing_length(&pts);
        let km = e.length_km();

        let base = c.per_km_eur.get(e.infrastructure) * km;
        let track_factor = if e.tracks <= 1 {
            c.single_track_factor
        } else {
            1.0
        };
        let density_factor = 1.0 + c.urban_density_uplift * density;
        let ground = if e.infrastructure.is_tunnel() {
            c.ground_conditions_factor
        } else {
            1.0
        };
        let water = c.water_crossing_per_m_eur.get(e.infrastructure) * water_m;
        let amount = (base * track_factor * density_factor * ground + water) * share;

        construction += amount;
        new_km += km * share;
        match e.infrastructure {
            Infrastructure::DeepTunnel | Infrastructure::CutAndCover => tunnel_km += km,
            Infrastructure::Elevated => elevated_km += km,
            _ => surface_km += km,
        }
        match km_by_infra.iter_mut().find(|(i, _)| *i == e.infrastructure) {
            Some((_, v)) => *v += km,
            None => km_by_infra.push((e.infrastructure, km)),
        }

        let line = net
            .lines_on_edge(*eid)
            .first()
            .and_then(|l| net.lines.get(l))
            .map(|l| l.label.clone())
            .unwrap_or_default();
        let from = net
            .nodes
            .get(&e.from)
            .map(|n| n.name.clone())
            .unwrap_or_default();
        let to = net
            .nodes
            .get(&e.to)
            .map(|n| n.name.clone())
            .unwrap_or_default();

        track_items.push(CostItem {
            label: format!("{from} – {to}"),
            detail: format!(
                "{:.1} km · {}{}",
                km,
                e.infrastructure.label_de(),
                if water_m > 20.0 {
                    format!(" · {:.0} m Wasserquerung", water_m)
                } else {
                    String::new()
                }
            ),
            amount_eur: amount,
            quantity: Some(km),
            unit: Some("km".into()),
            basis: Basis::Benchmark,
            line: Some(line.clone()),
        });
        segments.push(SegmentCost {
            edge: *eid,
            line,
            from,
            to,
            mode: e.mode,
            infrastructure: e.infrastructure,
            length_km: km,
            amount_eur: amount,
            water_crossing_m: water_m,
            density_index: density,
        });
    }

    // Stations.
    let mut new_stations = 0usize;
    let mut upgraded = 0usize;
    for nid in net.active_stations() {
        let Some(n) = net.nodes.get(&nid) else {
            continue;
        };
        let share = n.status.cost_share();
        if share <= 0.0 {
            // An existing station that a new line now also serves still needs
            // work: passages, lifts, a second platform level.
            // Only edges that are actually part of the scenario count: a
            // station a switched-off proposal happens to touch must not be
            // charged for a rebuild.
            let touches_new = at(nid)
                .iter()
                .filter(|e| active_set.contains(e))
                .filter_map(|e| net.edges.get(e))
                .any(|e| e.status != BuildStatus::InService);
            if touches_new {
                // Extending a line past its own terminus only needs the
                // turnback taken out and the tunnel carried on; the platforms
                // are already there. A genuinely new service needs a new
                // platform level, passages and lifts.
                let extension = net.only_extends_existing_service(nid, &active_set);
                let share = if extension {
                    c.station_extension_share
                } else {
                    c.station_upgrade_share
                };
                let amount = c
                    .station_eur
                    .get(net.effective_depth_with(nid, &active_set))
                    * share;
                construction += amount;
                upgraded += 1;
                station_items.push(CostItem {
                    label: n.name.clone(),
                    detail: if extension {
                        "Anpassung Bestandsstation für die Verlängerung".into()
                    } else {
                        "Umbau Bestandsstation für neue Linie".to_string()
                    },
                    amount_eur: amount,
                    quantity: Some(1.0),
                    unit: Some("Station".into()),
                    basis: Basis::Modelled,
                    line: None,
                });
            }
            continue;
        }
        let interchange = net.services_at_node(nid).len() > 1;
        let depth = net.effective_depth_with(nid, &active_set);
        let mut amount = c.station_eur.get(depth) * share;
        if interchange {
            amount *= c.interchange_station_factor;
        }
        let density = city.density_index(&[n.geo.to_metric()]);
        amount *= 1.0 + c.urban_density_uplift * density * 0.6;
        construction += amount;
        new_stations += 1;
        station_items.push(CostItem {
            label: n.name.clone(),
            detail: format!(
                "{}{}",
                depth.label_de(),
                if interchange {
                    " · Umsteigebauwerk"
                } else {
                    ""
                }
            ),
            amount_eur: amount,
            quantity: Some(1.0),
            unit: Some("Station".into()),
            basis: Basis::Benchmark,
            line: None,
        });
    }

    // Junctions: nodes where more than two tracks meet and something is new.
    let mut junctions = 0usize;
    for n in net.nodes.values() {
        // Only where a service's own track actually branches. Two lines sharing
        // a station without a track connection is an interchange, not a
        // junction, and costing it as one invents hundreds of millions.
        if !net.is_branch_node(n.id) {
            continue;
        }
        let touching: Vec<_> = at(n.id)
            .iter()
            .filter(|e| active_set.contains(e))
            .filter_map(|e| net.edges.get(e))
            .collect();
        if touching.len() < 3 {
            continue;
        }
        if !touching.iter().any(|e| e.status != BuildStatus::InService) {
            continue;
        }
        let infra = touching
            .iter()
            .find(|e| e.status != BuildStatus::InService)
            .map(|e| e.infrastructure)
            .unwrap_or(Infrastructure::Surface);
        let amount = c.junction_eur.get(infra) * ((touching.len() - 2) as f64).min(2.0);
        construction += amount;
        junctions += 1;
        junction_items.push(CostItem {
            label: n.name.clone(),
            detail: format!(
                "{} Gleisverbindungen · {}",
                touching.len(),
                infra.label_de()
            ),
            amount_eur: amount,
            quantity: Some(1.0),
            unit: Some("Verzweigung".into()),
            basis: Basis::Modelled,
            line: None,
        });
    }

    // Rolling stock: derived from the service pattern, not a flat per-km rate.
    //
    // Grouped by service, not by stored line record. The U5 is five
    // construction stages in the data but one line in operation, and giving
    // each stage its own fleet would buy the trains five times over.
    let mut vehicles_total = 0.0;
    let mut services: Vec<(String, Mode)> = net
        .lines
        .values()
        .filter(|l| l.included)
        .map(|l| (l.label.clone(), l.mode))
        .collect();
    services.sort();
    services.dedup();

    for (label, mode) in services {
        let records: Vec<&crate::model::Line> = net
            .lines
            .values()
            .filter(|l| l.included && l.label == label && l.mode == mode)
            .collect();
        let mut edges: Vec<crate::model::EdgeId> = records
            .iter()
            .flat_map(|l| l.edges.iter().copied())
            .collect();
        edges.sort();
        edges.dedup();

        let new_share: f64 = edges
            .iter()
            .filter_map(|e| net.edges.get(e))
            .map(|e| e.length_km() * e.status.cost_share())
            .sum();
        if new_share <= 0.01 {
            continue;
        }
        let route_km: f64 = edges
            .iter()
            .filter_map(|e| net.edges.get(e))
            .map(|e| e.length_km())
            .sum();
        let headway = records
            .iter()
            .map(|l| l.service.headway_peak_min)
            .fold(f64::INFINITY, f64::min)
            .max(1.0);
        let cars_per_train = records
            .iter()
            .map(|l| l.service.cars_per_train)
            .max()
            .unwrap_or(3) as f64;
        let speed = params.operations.commercial_speed_kmh.get(mode).max(5.0);
        let round_trip_min = (route_km * 2.0 / speed) * 60.0 + 10.0;
        let trains = (round_trip_min / headway).ceil().max(2.0);
        let cars = trains * cars_per_train * (1.0 + c.vehicle_reserve_share);
        // Only the fleet attributable to the new part of the line is charged.
        let attributable = cars * (new_share / route_km.max(0.001)).clamp(0.0, 1.0);
        let amount =
            attributable * (c.vehicle_per_car_eur.get(mode) + c.depot_per_car_eur.get(mode));
        vehicles_total += amount;
        vehicle_items.push(CostItem {
            label: format!("{label} · {}", mode.label_de()),
            detail: format!(
                "{:.0} Wagen inkl. {:.0} % Reserve, Takt {:.1} min auf {:.1} km Laufweg",
                attributable,
                c.vehicle_reserve_share * 100.0,
                headway,
                route_km
            ),
            amount_eur: amount,
            quantity: Some(attributable),
            unit: Some("Wagen".into()),
            basis: Basis::Modelled,
            line: Some(label.clone()),
        });
    }

    // Indirect blocks, weighted by the infrastructure mix.
    let total_km: f64 = km_by_infra.iter().map(|(_, v)| *v).sum();
    let weighted = |f: &dyn Fn(Infrastructure) -> f64| -> f64 {
        if total_km <= 0.0 {
            return 0.0;
        }
        km_by_infra.iter().map(|(i, km)| f(*i) * km).sum::<f64>() / total_km
    };
    let land_share = weighted(&|i| c.land_and_utilities_share.get(i));
    let contingency_share = weighted(&|i| c.contingency_share.get(i));
    let uncertainty = if total_km > 0.0 {
        weighted(&|i| c.uncertainty_share.get(i))
    } else {
        0.28
    };

    let planning = construction * c.planning_share;
    let pm = construction * c.project_management_share;
    let land = construction * land_share;
    let subtotal = construction + planning + pm + land + vehicles_total;
    let contingency = subtotal * contingency_share;

    // Escalation to the midpoint of construction (plan §29: no false precision,
    // but also no pretence that a 2045 project is built at 2026 prices).
    let midpoint = opening_year.map(|y| (params.timeline.planning_start_year + y) as f64 / 2.0);
    let years = midpoint
        .map(|m| (m - params.price_base_year as f64).max(0.0))
        .unwrap_or(0.0);
    let before_escalation = subtotal + contingency;
    let escalation = before_escalation * ((1.0 + c.price_escalation_per_year).powf(years) - 1.0);
    let total = before_escalation + escalation;

    let mut categories = Vec::new();
    let track_total: f64 = track_items.iter().map(|i| i.amount_eur).sum();
    let station_total: f64 = station_items.iter().map(|i| i.amount_eur).sum();
    let junction_total: f64 = junction_items.iter().map(|i| i.amount_eur).sum();
    if track_total > 0.0 {
        track_items.sort_by(|a, b| b.amount_eur.total_cmp(&a.amount_eur));
        categories.push(CostCategory {
            key: "track".into(),
            label: "Strecke".into(),
            amount_eur: track_total,
            items: track_items,
        });
    }
    if station_total > 0.0 {
        station_items.sort_by(|a, b| b.amount_eur.total_cmp(&a.amount_eur));
        categories.push(CostCategory {
            key: "stations".into(),
            label: "Stationen".into(),
            amount_eur: station_total,
            items: station_items,
        });
    }
    if junction_total > 0.0 {
        categories.push(CostCategory {
            key: "junctions".into(),
            label: "Verzweigungen".into(),
            amount_eur: junction_total,
            items: junction_items,
        });
    }
    if vehicles_total > 0.0 {
        categories.push(CostCategory {
            key: "vehicles".into(),
            label: "Fahrzeuge und Betriebshöfe".into(),
            amount_eur: vehicles_total,
            items: vehicle_items,
        });
    }
    if planning > 0.0 {
        categories.push(CostCategory {
            key: "planning".into(),
            label: "Planung und Projektsteuerung".into(),
            amount_eur: planning + pm,
            items: vec![
                CostItem {
                    label: "Planung und Entwurf".into(),
                    detail: format!("{:.0} % der Baukosten", c.planning_share * 100.0),
                    amount_eur: planning,
                    quantity: None,
                    unit: None,
                    basis: Basis::Modelled,
                    line: None,
                },
                CostItem {
                    label: "Projektsteuerung Bauherr".into(),
                    detail: format!("{:.0} % der Baukosten", c.project_management_share * 100.0),
                    amount_eur: pm,
                    quantity: None,
                    unit: None,
                    basis: Basis::Modelled,
                    line: None,
                },
            ],
        });
    }
    if land > 0.0 {
        categories.push(CostCategory {
            key: "land".into(),
            label: "Grunderwerb und Leitungen".into(),
            amount_eur: land,
            items: vec![CostItem {
                label: "Grunderwerb, Leitungsumlegungen, Baustelleneinrichtung".into(),
                detail: format!("{:.1} % der Baukosten", land_share * 100.0),
                amount_eur: land,
                quantity: None,
                unit: None,
                basis: Basis::Modelled,
                line: None,
            }],
        });
    }
    if contingency > 0.0 {
        categories.push(CostCategory {
            key: "contingency".into(),
            label: "Risikovorsorge".into(),
            amount_eur: contingency,
            items: vec![CostItem {
                label: "Risiko- und Nachtragsvorsorge".into(),
                detail: format!("{:.0} % der bisherigen Summe", contingency_share * 100.0),
                amount_eur: contingency,
                quantity: None,
                unit: None,
                basis: Basis::Assumption,
                line: None,
            }],
        });
    }
    if escalation > 1.0 {
        categories.push(CostCategory {
            key: "escalation".into(),
            label: "Preissteigerung bis Bauende".into(),
            amount_eur: escalation,
            items: vec![CostItem {
                label: "Baupreisentwicklung".into(),
                detail: format!(
                    "{:.1} % p. a. über {:.0} Jahre bis zur Bauzeitmitte",
                    c.price_escalation_per_year * 100.0,
                    years
                ),
                amount_eur: escalation,
                quantity: None,
                unit: None,
                basis: Basis::Assumption,
                line: None,
            }],
        });
    }

    let mut notes = vec![
        "Die Kosten sind eine Modellschätzung und keine offizielle Kostenberechnung.".to_string(),
        format!(
            "Gerechnet wird in Preisen von {}, wobei die Kennwerte an veröffentlichten Projektkosten aus {} ausgerichtet sind.",
            params.price_base_year, params.calibrated_on
        ),
    ];
    if tunnel_km > 0.0 {
        notes.push("Weil Tunnelkosten stark vom Baugrund und von der Bebauung abhängen, ist die Spanne entsprechend breit.".into());
    }

    segments.sort_by(|a, b| b.amount_eur.total_cmp(&a.amount_eur));

    CostResult {
        total_eur: total,
        low_eur: total * (1.0 - uncertainty),
        high_eur: total * (1.0 + uncertainty),
        construction_eur: construction,
        escalation_eur: escalation,
        categories,
        segments,
        new_km,
        new_stations,
        upgraded_stations: upgraded,
        junctions,
        tunnel_km,
        surface_km,
        elevated_km,
        notes,
    }
}

/// Count of stations of each kind for the summary panel.
pub fn station_summary(net: &Network) -> (usize, usize) {
    let active = net.active_stations();
    let total = active.len();
    let interchanges = active
        .iter()
        .filter(|n| net.services_at_node(**n).len() > 1)
        .count();
    (total, interchanges)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{demo_city, demo_network};

    #[test]
    fn an_all_existing_network_costs_nothing() {
        let net = demo_network();
        let r = calculate(&net, &demo_city(), &Params::default(), None);
        assert_eq!(r.total_eur, 0.0);
        assert!(r.categories.is_empty());
    }

    #[test]
    fn a_tunnel_costs_more_than_a_tram() {
        let params = Params::default();
        let city = demo_city();
        let tunnel = crate::testing::demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 8.0);
        let tram = crate::testing::demo_new_line(Mode::Tram, Infrastructure::TramReserved, 8.0);
        let a = calculate(&tunnel, &city, &params, Some(2040));
        let b = calculate(&tram, &city, &params, Some(2040));
        assert!(
            a.total_eur > b.total_eur * 4.0,
            "{} vs {}",
            a.total_eur,
            b.total_eur
        );
    }

    #[test]
    fn cost_scales_with_length() {
        let params = Params::default();
        let city = demo_city();
        let short = calculate(
            &crate::testing::demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 4.0),
            &city,
            &params,
            None,
        );
        let long = calculate(
            &crate::testing::demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 12.0),
            &city,
            &params,
            None,
        );
        assert!(long.total_eur > short.total_eur * 2.0);
        assert!(long.new_km > short.new_km * 2.0);
    }

    #[test]
    fn the_range_brackets_the_point_estimate() {
        let net = crate::testing::demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 6.0);
        let r = calculate(&net, &demo_city(), &Params::default(), Some(2038));
        assert!(r.low_eur < r.total_eur && r.total_eur < r.high_eur);
        assert!(r.low_eur > 0.0);
    }

    #[test]
    fn categories_add_up_to_the_total() {
        let net = crate::testing::demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 9.0);
        let r = calculate(&net, &demo_city(), &Params::default(), Some(2042));
        let sum: f64 = r.categories.iter().map(|c| c.amount_eur).sum();
        assert!(
            (sum - r.total_eur).abs() < r.total_eur * 1e-6,
            "{sum} vs {}",
            r.total_eur
        );
        for c in &r.categories {
            let items: f64 = c.items.iter().map(|i| i.amount_eur).sum();
            assert!(
                (items - c.amount_eur).abs() < c.amount_eur.abs() * 1e-6 + 1.0,
                "category {}",
                c.key
            );
        }
    }

    #[test]
    fn a_switched_off_line_costs_nothing_even_where_it_touches_a_station() {
        // Regression: a proposal that shares a station with the existing
        // network must not be billed as a station rebuild while it is switched
        // off, or the untouched baseline appears to cost billions.
        let mut net = demo_network();
        let existing = net
            .nodes
            .values()
            .find(|n| n.kind == crate::model::NodeKind::Station)
            .unwrap()
            .id;
        let far = crate::geo::Point::new(20_000.0, 20_000.0).to_latlon();
        let outer = crate::model::NodeId(net.fresh_id());
        net.nodes.insert(
            outer,
            crate::model::Node {
                id: outer,
                kind: crate::model::NodeKind::Station,
                name: "Vorschlag".into(),
                geo: far,
                schematic: far.to_metric(),
                source: crate::model::Source::Proposal,
                status: BuildStatus::ToBuild,
                interchange: false,
                accessible: true,
                depth: crate::model::StationDepth::Stop,
                external_id: None,
            },
        );
        let eid = crate::model::EdgeId(net.fresh_id());
        let geo = vec![net.nodes[&existing].geo, far];
        let mut edge = crate::model::Edge {
            id: eid,
            from: existing,
            to: outer,
            mode: Mode::Tram,
            infrastructure: Infrastructure::TramReserved,
            source: crate::model::Source::Proposal,
            status: BuildStatus::ToBuild,
            schematic: geo.iter().map(|p| p.to_metric()).collect(),
            geo,
            length_m: 0.0,
            tracks: 2,
            design_speed_kmh: 50.0,
            external_id: None,
            rebuilt: false,
        };
        edge.recompute_length();
        net.edges.insert(eid, edge);
        let lid = crate::model::LineId(net.fresh_id());
        let mut line = net.lines.values().next().unwrap().clone();
        line.id = lid;
        line.label = "T1".into();
        line.mode = Mode::Tram;
        line.edges = vec![eid];
        line.included = false; // switched off
        net.lines.insert(lid, line);

        let off = calculate(&net, &demo_city(), &Params::default(), None);
        assert_eq!(off.total_eur, 0.0, "a switched-off line must cost nothing");

        net.lines.get_mut(&lid).unwrap().included = true;
        let on = calculate(&net, &demo_city(), &Params::default(), Some(2038));
        assert!(on.total_eur > 0.0);
        assert_eq!(on.upgraded_stations, 1, "the shared station is now rebuilt");
    }

    #[test]
    fn later_openings_carry_more_escalation() {
        let net = crate::testing::demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 6.0);
        let city = demo_city();
        let p = Params::default();
        let early = calculate(&net, &city, &p, Some(2030));
        let late = calculate(&net, &city, &p, Some(2050));
        assert!(late.escalation_eur > early.escalation_eur);
        assert!(late.total_eur > early.total_eur);
    }
}
