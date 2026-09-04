//! Build the domain network from the imported datasets and check the models.

use crate::dataset::*;
use hh_core::city::CityData;
use hh_core::editor::{Command, Editor};
use hh_core::geo::LatLon;
use hh_core::model::*;
use hh_core::params::Params;
use hh_core::scenario::{ScenarioDocument, ScenarioTemplate};
use hh_core::simulation;
use std::collections::BTreeMap;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

type R<T> = Result<T, Box<dyn Error>>;

pub const DATA_VERSION: &str = "2026-09";

/// The city this run works on, and where its datasets live.
///
/// Hamburg's files sit directly in `data/dist` for historic reasons; every
/// other city has its own directory.
static CITY: std::sync::RwLock<String> = std::sync::RwLock::new(String::new());

pub fn set_city(city: &str) {
    if let Ok(mut w) = CITY.write() {
        *w = city.to_string();
    }
}

pub fn city() -> String {
    CITY.read()
        .ok()
        .map(|c| c.clone())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| "hamburg".into())
}

/// A path inside the city's dataset directory.
fn dist(name: &str) -> String {
    let c = city();
    if c == "hamburg" {
        format!("data/dist/{name}-{DATA_VERSION}.json")
    } else {
        format!("data/dist/{c}/{name}-{DATA_VERSION}.json")
    }
}

/// A path inside the city's raw directory.
fn raw(name: &str) -> String {
    let c = city();
    if c == "hamburg" {
        format!("data/raw/{name}")
    } else {
        format!("data/raw/{c}-{name}")
    }
}

fn path(root: &str, rel: &str) -> PathBuf {
    Path::new(root).join(rel)
}

pub fn load_city(root: &str) -> R<CityData> {
    let raw = fs::read_to_string(path(root, &dist("city")))?;
    let t_parse = Instant::now();
    let mut city: CityData = serde_json::from_str(&raw)?;
    let d_parse = t_parse.elapsed();
    let t_prep = Instant::now();
    city.prepare();
    let d_prep = t_prep.elapsed();
    // Startup is once per visit but it is the first thing anyone waits for, so
    // it is worth knowing which half costs what.
    if std::env::var("HH_TIME_LOAD").is_ok() {
        eprintln!(
            "  Laden: {:.0} ms lesen+parsen, {:.0} ms Index und Wassermaske",
            d_parse.as_secs_f64() * 1000.0,
            d_prep.as_secs_f64() * 1000.0
        );
    }
    let problems = city.validate();
    if !problems.is_empty() {
        for p in &problems {
            eprintln!("  ! {p}");
        }
        return Err(format!("Stadtdaten sind fehlerhaft ({} Probleme)", problems.len()).into());
    }
    Ok(city)
}

/// Load a previously imported domain network. Used by tooling built on top
/// of this crate rather than by the commands here.
#[allow(dead_code)]
pub fn load_network(root: &str) -> R<Network> {
    let raw = fs::read_to_string(path(root, &dist("network")))?;
    Ok(serde_json::from_str(&raw)?)
}

/// Which proposal lines a scenario switches on.
///
/// Naming ids is the precise form; the older `proposals: true` still means all
/// of them, which is only safe while every proposal belongs in every scenario
/// that wants any.
fn scenario_proposals(
    sc: &crate::dataset::ScenarioSpec,
    all: &[String],
    by_proposal: &std::collections::BTreeMap<String, Vec<String>>,
) -> Vec<String> {
    match &sc.proposal_ids {
        Some(ids) => ids
            .iter()
            .filter_map(|id| by_proposal.get(id))
            .flatten()
            .filter(|l| all.contains(l))
            .cloned()
            .collect(),
        None if sc.proposals => all.to_vec(),
        None => Vec::new(),
    }
}

fn mode_of(s: &str) -> Mode {
    match s {
        "ubahn" => Mode::Ubahn,
        "sbahn" => Mode::Sbahn,
        "tram" => Mode::Tram,
        _ => Mode::Regional,
    }
}

fn infra_of(s: &str) -> Infrastructure {
    match s {
        "deep_tunnel" => Infrastructure::DeepTunnel,
        "cut_and_cover" => Infrastructure::CutAndCover,
        "elevated" => Infrastructure::Elevated,
        "existing_rail" => Infrastructure::ExistingRail,
        "tram_reserved" => Infrastructure::TramReserved,
        "tram_mixed" => Infrastructure::TramMixed,
        "bridge" => Infrastructure::Bridge,
        _ => Infrastructure::Surface,
    }
}

fn status_of(s: &str) -> BuildStatus {
    match s {
        "under_construction" => BuildStatus::UnderConstruction,
        "in_service" => BuildStatus::InService,
        _ => BuildStatus::ToBuild,
    }
}

/// Build the complete baseline network: everything that exists today, plus the
/// official projects and the political proposals as switchable lines.
pub fn build(root: &str, city: &CityData) -> R<(Network, Vec<ScenarioTemplate>)> {
    // This city's own parameters, not the built-in defaults: the construction
    // type a section gets depends on them, and they differ between cities.
    let params: Params = serde_json::from_value(city_params(root)?)?;
    let osm: OsmNetwork =
        serde_json::from_str(&fs::read_to_string(path(root, &raw("network.osm.json")))?)?;
    // Curated projects are optional: a city without a documented pipeline of
    // official plans still has a network worth drawing on.
    let projects: Projects = match fs::read_to_string(path(root, &dist("projects"))) {
        Ok(text) => serde_json::from_str(&text)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            println!("  (keine kuratierten Vorhaben für diese Stadt)");
            Projects::default()
        }
        Err(e) => return Err(e.into()),
    };

    let mut net = Network::new();
    let mut node_by_ext: BTreeMap<String, NodeId> = BTreeMap::new();

    // -------------------------------------------------- existing stations --
    for s in &osm.stations {
        let id = NodeId(net.fresh_id());
        let geo = LatLon::new(s.lat, s.lon);
        net.nodes.insert(
            id,
            Node {
                id,
                kind: NodeKind::Station,
                name: s.name.clone(),
                geo,
                schematic: geo.to_metric(),
                source: Source::Existing,
                status: BuildStatus::InService,
                interchange: s.modes.len() > 1,
                accessible: true,
                depth: StationDepth::Surface,
                external_id: Some(s.id.clone()),
            },
        );
        node_by_ext.insert(s.id.clone(), id);
    }

    // ------------------------------------------------------ existing track --
    let mut edge_by_ext: BTreeMap<String, EdgeId> = BTreeMap::new();
    for e in &osm.edges {
        let (Some(&from), Some(&to)) = (node_by_ext.get(&e.from), node_by_ext.get(&e.to)) else {
            continue;
        };
        let mode = mode_of(&e.mode);
        let infra = if e.tunnel {
            Infrastructure::DeepTunnel
        } else if mode == Mode::Sbahn {
            Infrastructure::ExistingRail
        } else {
            Infrastructure::Surface
        };
        let geo: Vec<LatLon> = e.geo.iter().map(|p| LatLon::new(p[1], p[0])).collect();
        if geo.len() < 2 {
            continue;
        }
        let id = EdgeId(net.fresh_id());
        let mut edge = Edge {
            id,
            from,
            to,
            mode,
            infrastructure: infra,
            source: Source::Existing,
            status: BuildStatus::InService,
            schematic: geo.iter().map(|p| p.to_metric()).collect(),
            geo,
            length_m: 0.0,
            tracks: 2,
            design_speed_kmh: match mode {
                Mode::Ubahn => 80.0,
                Mode::Sbahn => 100.0,
                _ => 60.0,
            },
            external_id: Some(e.id.clone()),
        };
        edge.recompute_length();
        net.edges.insert(id, edge);
        edge_by_ext.insert(e.id.clone(), id);
    }
    // Stations in tunnel get the matching depth class.
    let deep: Vec<NodeId> = net
        .edges
        .values()
        .filter(|e| e.infrastructure == Infrastructure::DeepTunnel)
        .flat_map(|e| [e.from, e.to])
        .collect();
    for n in deep {
        if let Some(node) = net.nodes.get_mut(&n) {
            node.depth = StationDepth::Deep;
        }
    }

    // ------------------------------------------------------ existing lines --
    for l in &osm.lines {
        let edges: Vec<EdgeId> = l
            .edges
            .iter()
            .filter_map(|e| edge_by_ext.get(e))
            .copied()
            .collect();
        if edges.is_empty() {
            continue;
        }
        let id = LineId(net.fresh_id());
        let mode = mode_of(&l.mode);
        net.lines.insert(
            id,
            Line {
                id,
                label: l.label.clone(),
                name: l.name.clone(),
                mode,
                color: l.color.clone(),
                source: Source::Existing,
                edges,
                service: ServicePattern::default_for(mode),
                included: true,
                extends: None,
                note: if l.branch {
                    "Verstärker- oder Aststrecke".into()
                } else {
                    String::new()
                },
                official_opening_year: None,
                construction_started_year: None,
                official_cost_eur: None,
                external_id: Some(l.id.clone()),
            },
        );
    }

    // ---------------------------------------------------- planned projects --
    let mut project_ids: Vec<String> = Vec::new();
    for p in &projects.projects {
        let mode = mode_of(&p.mode);
        let stated_infra = p.infrastructure.as_deref().map(infra_of);
        let status = status_of(&p.status);

        let mut nodes: Vec<NodeId> = Vec::new();
        for s in &p.stations {
            let geo = LatLon::new(s.lat, s.lon);
            // Reuse a nearby existing station: that is what makes the project
            // connect to the real network rather than float beside it.
            let nearest = net
                .nodes
                .values()
                .filter(|n| n.kind == NodeKind::Station)
                .map(|n| (n.id, n.geo.distance_to(&geo)))
                .filter(|(_, d)| *d < 320.0)
                .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            // A "new" stop standing on an existing station is that station.
            //
            // The distinction below is right at the distance it was written for
            // — the Siemensbahn's new stop 194 m from the U7 is a second
            // platform, not the same one. It is not right at zero: Berlin's
            // Ostkreuz tram names a stop at the existing station's exact
            // coordinates, and honouring "new" there produced two Ostkreuz nodes
            // in the same spot and a section of no length between them, which
            // stopped the city importing at all.
            let on_top_of = nearest.filter(|(_, d)| *d < 40.0).map(|(id, _)| id);
            let existing = nearest.map(|(id, _)| id);
            match existing {
                Some(id) if on_top_of == Some(id) => {
                    net.nodes.get_mut(&id).unwrap().interchange = true;
                    nodes.push(id);
                }
                // The curated data says this stop *is* the existing station —
                // the U5's Hauptbahnhof, Sengelmannstraße on the U5 Ost. Then
                // it is that node, and the project connects to the real
                // network instead of floating beside it.
                Some(id) if !s.is_new => {
                    net.nodes.get_mut(&id).unwrap().interchange = true;
                    nodes.push(id);
                }
                // A *new* station that merely happens to be near an existing
                // one is not that station. Both arms used to do the same thing,
                // so the distinction above was decorative: the Siemensbahn's
                // new Siemensstadt stop was swallowed by the U7's Siemensdamm
                // 194 m away, took its name and its position, and ended up
                // beside its own viaduct. Two stops close enough to walk
                // between are an interchange, not one platform.
                Some(id) => {
                    net.nodes.get_mut(&id).unwrap().interchange = true;
                    let new_id = NodeId(net.fresh_id());
                    net.nodes.insert(
                        new_id,
                        Node {
                            id: new_id,
                            kind: NodeKind::Station,
                            name: s.name.clone(),
                            geo,
                            schematic: geo.to_metric(),
                            source: Source::Planned,
                            status,
                            interchange: true,
                            accessible: true,
                            depth: StationDepth::Surface,
                            external_id: Some(format!("{}-{}", p.id, s.name)),
                        },
                    );
                    nodes.push(new_id);
                }
                None => {
                    let id = NodeId(net.fresh_id());
                    net.nodes.insert(
                        id,
                        Node {
                            id,
                            kind: NodeKind::Station,
                            name: s.name.clone(),
                            geo,
                            schematic: geo.to_metric(),
                            source: Source::Planned,
                            status,
                            interchange: false,
                            accessible: true,
                            depth: StationDepth::Surface,
                            external_id: Some(format!("{}-{}", p.id, s.name)),
                        },
                    );
                    nodes.push(id);
                }
            }
        }

        // Fillet the whole alignment, then cut it at the stations again. Drawn
        // as straight hops between stops, a planned line turns on a point at
        // every stop; real track does not.
        let corridor: Vec<hh_core::geo::Point> = {
            let mut pts: Vec<hh_core::geo::Point> = Vec::new();
            for seg in &p.segments {
                for c in &seg.geo {
                    let q = LatLon::new(c[1], c[0]).to_metric();
                    if pts.last().map_or(true, |last: &hh_core::geo::Point| {
                        last.distance_to(&q) > 1.0
                    }) {
                        pts.push(q);
                    }
                }
            }
            // The stations are already fixed by the curated project data, so
            // the fillets have to go *between* them — otherwise a corner at a
            // station moves the track off the platform.
            let stops: Vec<hh_core::geo::Point> = nodes
                .iter()
                .filter_map(|n| net.nodes.get(n))
                .map(|n| n.geo.to_metric())
                .collect();
            hh_core::editor::round_corridor_through(&pts, &stops, mode, &params)
        };
        let station_along: Vec<f64> = nodes
            .iter()
            .filter_map(|n| net.nodes.get(n))
            .filter_map(|n| hh_core::geo::project_on_polyline(n.geo.to_metric(), &corridor))
            .map(|pr| pr.along)
            .collect();

        let mut edges = Vec::new();
        for (i, seg) in p.segments.iter().enumerate() {
            if i + 1 >= nodes.len() || nodes[i] == nodes[i + 1] {
                eprintln!(
                    "  ! {}: Abschnitt {} übersprungen (gleicher Knoten)",
                    p.id, i
                );
                continue;
            }
            let geo: Vec<LatLon> = match (station_along.get(i), station_along.get(i + 1)) {
                (Some(a), Some(b)) if b > a && corridor.len() > 1 => {
                    let (_, tail) = hh_core::geo::split_polyline(&corridor, *a);
                    let (piece, _) = hh_core::geo::split_polyline(&tail, b - a);
                    hh_core::geo::to_geo(&piece)
                }
                _ => seg.geo.iter().map(|c| LatLon::new(c[1], c[0])).collect(),
            };
            if geo.len() < 2 {
                continue;
            }
            // The track has to meet the platform. A curated corridor is routed
            // from the project's own coordinates; where a segment ends on a
            // station that already exists in the OSM network, the two can be
            // tens of metres apart and the line visibly detaches from the dot.
            let mut geo = geo;
            for (at_start, node) in [(true, nodes[i]), (false, nodes[i + 1])] {
                let Some(n) = net.nodes.get(&node) else {
                    continue;
                };
                let idx = if at_start { 0 } else { geo.len() - 1 };
                let gap = n.geo.to_metric().distance_to(&geo[idx].to_metric());
                // Two different things look the same here. At a station this
                // project *builds*, a gap means the curated coordinate and the
                // routed corridor disagree — worth knowing. At a station reused
                // from the existing network, the node is the whole complex's
                // one point: Hamburg Hauptbahnhof is a quarter of a kilometre
                // across, and a new deep platform under it is legitimately that
                // far from where a corridor through the streets above comes
                // out. Warning about it on every single import taught me to
                // read past the warnings, which is worse than not having them.
                // Measured before silencing it: new stations sit at most 12 m
                // from their alignment, so the 150 m limit has an order of
                // magnitude of headroom and would still catch a real
                // disagreement. Nothing was hiding behind the noise.
                let reused = n.source != Source::Planned;
                let limit = if reused { 400.0 } else { 150.0 };
                if gap > limit {
                    eprintln!(
                        "  ! {}: {} liegt {:.0} m neben der eigenen Trasse{}",
                        p.id,
                        n.name,
                        gap,
                        if reused {
                            " (Bestandsstation, Gleis wird an den Bahnsteig gezogen)"
                        } else {
                            ""
                        }
                    );
                }
                geo[idx] = n.geo;
                // Moving the endpoint onto the platform leaves the next vertex
                // a few metres away at an angle — a kink the curve check reads
                // as a forty-metre radius. Drop the vertices that are now too
                // close for the join to mean anything.
                // Wide enough that the first measured chord (55 m) is clear
                // of the join, or the kink simply moves one vertex along.
                const CLEAR_M: f64 = 130.0;
                let target = n.geo.to_metric();
                if at_start {
                    while geo.len() > 2 && geo[1].to_metric().distance_to(&target) < CLEAR_M {
                        geo.remove(1);
                    }
                } else {
                    while geo.len() > 2
                        && geo[geo.len() - 2].to_metric().distance_to(&target) < CLEAR_M
                    {
                        geo.remove(geo.len() - 2);
                    }
                }
            }
            // Two stops that resolved to the same place make no section.
            //
            // A curated project may name a stop that already exists under
            // another name, and once the two are recognised as one station the
            // section between them is zero metres long. The network's own
            // validation rejects that, so the whole city failed to import —
            // Berlin's Ostkreuz, after its five separate nodes were merged into
            // one. A section of no length is not track; it is one place named
            // twice.
            let degenerate = nodes[i] == nodes[i + 1]
                || hh_core::geo::polyline_length(
                    &geo.iter().map(|p| p.to_metric()).collect::<Vec<_>>(),
                ) < 1.0;
            if degenerate {
                continue;
            }
            let id = EdgeId(net.fresh_id());
            // Where the project states a construction method, that is what is
            // drawn: it is the sponsor's own claim, and the comparison column has
            // to answer it. Where it does not, the ground decides, section by
            // section — the same rule a line drawn in the editor gets.
            let infra = stated_infra
                .unwrap_or_else(|| {
                    hh_core::editor::choose_infrastructure(city, &params, &geo, mode)
                });
            let mut edge = Edge {
                id,
                from: nodes[i],
                to: nodes[i + 1],
                mode,
                infrastructure: infra,
                source: Source::Planned,
                status,
                schematic: geo.iter().map(|p| p.to_metric()).collect(),
                geo,
                length_m: 0.0,
                tracks: 2,
                design_speed_kmh: if mode == Mode::Sbahn { 120.0 } else { 80.0 },
                external_id: Some(format!("{}-{}", p.id, i)),
            };
            edge.recompute_length();
            net.edges.insert(id, edge);
            edges.push(id);
        }
        if edges.is_empty() {
            continue;
        }
        // A metro cannot ramp out of a bored tunnel onto a viaduct for one
        // section and dive back in. The choice is made section by section, so
        // that has to be settled once all of them are known. Only where the
        // project did not state a method — a stated one is the sponsor's claim
        // and is drawn as given.
        if stated_infra.is_none() {
            let mut kinds: Vec<Infrastructure> = edges
                .iter()
                .filter_map(|e| net.edges.get(e))
                .map(|e| e.infrastructure)
                .collect();
            // `choose_infrastructure` never answers Elevated for a water
            // crossing — that is a bridge — so no section here is wet.
            let wet = vec![false; kinds.len()];
            // Whether the project joins existing tunnel at each end. The U8
            // extension leaves the underground station at Wittenau, so its
            // first section is enclosed even though nothing precedes it.
            let end_depth = |n: Option<&NodeId>| {
                n.and_then(|n| net.nodes.get(n))
                    .map(|node| matches!(node.depth, StationDepth::Deep | StationDepth::Shallow))
                    .unwrap_or(false)
            };
            let ends = [end_depth(nodes.first()), end_depth(nodes.last())];
            hh_core::editor::settle_ramps(&mut kinds, &wet, mode, ends);
            for (e, kind) in edges.iter().zip(kinds) {
                if let Some(edge) = net.edges.get_mut(e) {
                    edge.infrastructure = kind;
                }
            }
        }
        // A station is as deep as the deepest section it sits on. Set here
        // rather than when the node was made, because with the construction
        // type chosen per section it is not known until the edges exist.
        for &n in &nodes {
            let depth = edges
                .iter()
                .filter_map(|e| net.edges.get(e))
                .filter(|e| e.from == n || e.to == n)
                .map(|e| StationDepth::for_infrastructure(e.infrastructure))
                .max_by_key(|d| match d {
                    StationDepth::Deep => 4,
                    StationDepth::Shallow => 3,
                    StationDepth::Elevated => 2,
                    StationDepth::Surface => 1,
                    StationDepth::Stop => 0,
                });
            if let (Some(d), Some(node)) = (depth, net.nodes.get_mut(&n)) {
                if node.source == Source::Planned {
                    node.depth = d;
                }
            }
        }
        let id = LineId(net.fresh_id());
        net.lines.insert(
            id,
            Line {
                id,
                label: p.label.clone(),
                name: p.name.clone(),
                mode,
                color: p.color.clone(),
                source: Source::Planned,
                edges,
                service: ServicePattern::default_for(mode),
                // Planned lines start switched off; the scenarios turn them on.
                included: false,
                extends: None,
                note: p.note.clone(),
                official_opening_year: p.opening_year,
                construction_started_year: p.construction_start_year,
                official_cost_eur: p.official_cost_eur,
                external_id: Some(p.id.clone()),
            },
        );
        project_ids.push(p.id.clone());
    }

    // ------------------------------------------------ political proposals --
    let mut proposal_ids: Vec<String> = Vec::new();
    let mut lines_by_proposal: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for pr in &projects.proposals {
        for l in &pr.lines {
            // A proposal that only gives corridor anchors gets its stops from
            // the engine, at tram spacing (plan §14).
            let corridor: Vec<LatLon> = {
                let mut pts: Vec<LatLon> = Vec::new();
                for seg in &l.segments {
                    for c in &seg.geo {
                        let p = LatLon::new(c[1], c[0]);
                        if pts
                            .last()
                            .map_or(true, |q: &LatLon| q.distance_to(&p) > 5.0)
                        {
                            pts.push(p);
                        }
                    }
                }
                pts
            };
            if corridor.len() < 2 {
                continue;
            }
            // Tram is the default because every proposal was one until the
            // regional S-Bahn corridors; a proposal that says otherwise gets
            // what it says.
            let mode = l.mode.as_deref().map(mode_of).unwrap_or(Mode::Tram);
            let infrastructure = match l.infrastructure.as_deref() {
                Some(s) => Some(infra_of(s)),
                None if mode == Mode::Tram => Some(Infrastructure::TramReserved),
                // Let the engine decide: a regional line mostly follows track
                // that is already there, and it knows where that is.
                None => None,
            };
            let mut ed = Editor::new(std::mem::take(&mut net), city.clone(), Params::default());
            let diff = ed.apply(Command::DrawLine {
                mode,
                infrastructure,
                points: corridor,
                label: Some(l.label.clone()),
                color: Some(l.color.clone()),
                auto_stations: l.auto_stations,
                // A proposal that names its stations gets stops on them; the
                // engine still fills in the gaps. Without this a 38 km regional
                // corridor was spaced evenly and simply missed Winsen, which is
                // the second-largest place on the line.
                anchors: if l.stations.is_empty() {
                    // A street-routed corridor is geometry, not a list of clicks.
                    None
                } else {
                    Some(
                        l.stations
                            .iter()
                            .map(|st| LatLon::new(st.lat, st.lon))
                            .collect(),
                    )
                },
            });
            net = ed.network;
            let diff = match diff {
                Ok(d) => d,
                Err(e) => {
                    // Silently dropping a proposal means the dataset quietly
                    // lacks a line someone put in the curated file, and nothing
                    // anywhere says so.
                    eprintln!("  Vorschlag {} ({}) nicht übernommen: {e}", l.id, l.name);
                    continue;
                }
            };
            if let Some(lid) = diff.lines_changed.first() {
                if let Some(line) = net.lines.get_mut(lid) {
                    line.name = l.name.clone();
                    line.source = Source::Proposal;
                    line.included = false;
                    line.note = pr.note.clone();
                    line.external_id = Some(l.id.clone());
                }
                for n in &diff.nodes_changed {
                    if let Some(node) = net.nodes.get_mut(n) {
                        if node.source == Source::User {
                            node.source = Source::Proposal;
                        }
                    }
                }
                for e in &diff.edges_changed {
                    if let Some(edge) = net.edges.get_mut(e) {
                        if edge.source == Source::User {
                            edge.source = Source::Proposal;
                        }
                    }
                }
            }
        }
        proposal_ids.push(pr.id.clone());
        lines_by_proposal.insert(
            pr.id.clone(),
            pr.lines.iter().map(|l| l.id.clone()).collect::<Vec<_>>(),
        );
    }

    net.round_coordinates();

    // ------------------------------------------------------------ scenarios --
    let existing: Vec<String> = net
        .lines
        .values()
        .filter(|l| l.source == Source::Existing)
        .filter_map(|l| l.external_id.clone())
        .collect();
    let planned: Vec<String> = net
        .lines
        .values()
        .filter(|l| l.source == Source::Planned)
        .filter_map(|l| l.external_id.clone())
        .collect();
    let proposal_lines: Vec<String> = net
        .lines
        .values()
        .filter(|l| l.source == Source::Proposal)
        .filter_map(|l| l.external_id.clone())
        .collect();

    // Scenario templates that reference specific projects only make sense where
    // those projects exist. A city imported without curated plans gets the two
    // that always apply.
    let mut templates = vec![
        ScenarioTemplate {
            id: "bestand".into(),
            title: "Bestand 2026".into(),
            summary: "Das heutige Netz.".into(),
            description: "Ausgangslage ohne jedes Vorhaben. Alle Kosten sind null, weil nichts gebaut werden muss.".into(),
            included_lines: existing.clone(),
            tags: vec!["Bestand".into()],
            sources: vec!["OpenStreetMap, Stand des Datenimports".into()],
        },
        ScenarioTemplate {
            id: "leer".into(),
            title: "Freies Netz".into(),
            summary: "Nur der Bestand, der Rest ist deine Sache.".into(),
            description: "Startpunkt für einen eigenen Entwurf.".into(),
            included_lines: existing.clone(),
            tags: vec!["Sandkasten".into()],
            sources: vec![],
        },
    ];
    if planned.is_empty() && proposal_lines.is_empty() {
        return Ok((net, templates));
    }
    templates.clear();
    // The labels of what is actually planned, so the summary names this city's
    // projects instead of Hamburg's.
    let planned_labels: Vec<String> = {
        let mut ls: Vec<String> = net
            .lines
            .values()
            .filter(|l| l.source == Source::Planned)
            .map(|l| l.label.clone())
            .collect();
        ls.sort();
        ls.dedup();
        ls
    };
    templates.push(ScenarioTemplate {
        id: "bestand".into(),
        title: "Bestand 2026".into(),
        summary: "Das heutige Netz.".into(),
        description: "Ausgangslage ohne jedes Vorhaben. Alle Kosten sind null, weil nichts gebaut werden muss.".into(),
        included_lines: existing.clone(),
        tags: vec!["Bestand".into()],
        sources: vec!["OpenStreetMap, Stand des Datenimports".into()],
    });
    if !planned.is_empty() {
        templates.push(ScenarioTemplate {
            id: "beschlossen".into(),
            title: "Beschlossene Vorhaben".into(),
            summary: format!(
                "Bestand plus alle offiziell geplanten Projekte: {}.",
                planned_labels.join(", ")
            ),
            description: "Der Referenzfall der laufenden Planung. Kosten und Termine sind Modellwerte, nicht die Angaben der Vorhabenträger.".into(),
            included_lines: existing.iter().chain(planned.iter()).cloned().collect(),
            tags: vec!["Offiziell".into()],
            sources: vec![],
        });
    }
    // Whatever this city's own project file describes.
    for sc in &projects.scenarios {
        let chosen: Vec<String> = match &sc.planned {
            Some(ids) => planned
                .iter()
                .filter(|p| ids.iter().any(|want| *p == want || p.starts_with(want.as_str())))
                .cloned()
                .collect(),
            None => planned.clone(),
        };
        templates.push(ScenarioTemplate {
            id: sc.id.clone(),
            title: sc.title.clone(),
            summary: sc.summary.clone(),
            description: sc.description.clone(),
            included_lines: existing
                .iter()
                .chain(chosen.iter())
                .chain(scenario_proposals(sc, &proposal_lines, &lines_by_proposal).iter())
                .cloned()
                .collect(),
            tags: sc.tags.clone(),
            sources: sc.sources.clone(),
        });
    }
    if !proposal_lines.is_empty() {
        templates.push(ScenarioTemplate {
            id: "alles".into(),
            title: "Alles gleichzeitig".into(),
            summary: "Jedes erfasste Vorhaben und jeden Vorschlag zusammen.".into(),
            description: "Zeigt, was passiert, wenn nichts gegeneinander abgewogen wird.".into(),
            included_lines: existing
                .iter()
                .chain(planned.iter())
                .chain(proposal_lines.iter())
                .cloned()
                .collect(),
            tags: vec!["Maximal".into()],
            sources: vec![],
        });
    }
    templates.extend([
        ScenarioTemplate {
            id: "leer".into(),
            title: "Freies Netz".into(),
            summary: "Nur der Bestand, der Rest ist deine Sache.".into(),
            description: "Startpunkt für einen eigenen Entwurf.".into(),
            included_lines: existing,
            tags: vec!["Sandkasten".into()],
            sources: vec![],
        },
    ]);

    Ok((net, templates))
}

pub fn run(root: &str) -> R<()> {
    let city = load_city(root)?;
    println!(
        "Stadtdaten {}: {} Landmarken, {} Straßen, {} Stadtteile, Raster {}×{}",
        city.version.id,
        city.landmarks.len(),
        city.streets.len(),
        city.districts.len(),
        city.grid.cols,
        city.grid.rows
    );
    println!(
        "  {:.0} Einwohner, {:.0} Arbeitsplätze im Raster",
        city.grid.total_population(),
        city.grid.total_jobs()
    );

    let (net, templates) = build(root, &city)?;
    let problems = net.validate();
    if !problems.is_empty() {
        for p in problems.iter().take(10) {
            eprintln!("  ! {p}");
        }
        return Err(format!("{} Strukturfehler im erzeugten Netz", problems.len()).into());
    }

    let km: f64 = net.edges.values().map(|e| e.length_km()).sum();
    println!(
        "Netz: {} Knoten, {} Kanten, {} Linien, {:.1} km",
        net.nodes.len(),
        net.edges.len(),
        net.lines.len(),
        km
    );
    for source in [Source::Existing, Source::Planned, Source::Proposal] {
        let lines: Vec<&Line> = net.lines.values().filter(|l| l.source == source).collect();
        let km: f64 = lines
            .iter()
            .flat_map(|l| l.edges.iter())
            .collect::<std::collections::BTreeSet<_>>()
            .iter()
            .filter_map(|e| net.edges.get(e))
            .map(|e| e.length_km())
            .sum();
        println!("  {:?}: {} Linien, {:.1} km", source, lines.len(), km);
    }

    let out = path(root, &dist("network"));
    fs::write(&out, serde_json::to_string(&net)?)?;
    println!("geschrieben: {}", out.display());

    let sout = path(root, &dist("scenarios"));
    fs::write(&sout, serde_json::to_string(&templates)?)?;
    println!(
        "geschrieben: {} ({} Szenarien)",
        sout.display(),
        templates.len()
    );

    let pout = path(root, &dist("params"));
    fs::write(&pout, serde_json::to_string(&city_params(root)?)?)?;
    println!("geschrieben: {}", pout.display());
    Ok(())
}

/// The model parameters for this city.
///
/// Most of the model is a statement about railways and is the same everywhere.
/// A few figures are statements about *this* city — its share of the Länder VAT
/// pot, what its subsoil costs to dig — and those live in
/// `data/cities/<id>.json` under `modelParams`, merged over the defaults here.
/// Left as one global constant they were quietly wrong for every city but the
/// one they were calibrated on.
fn city_params(root: &str) -> R<serde_json::Value> {
    let mut params = serde_json::to_value(Params::default())?;
    let cfg_path = path(root, &format!("data/cities/{}.json", city()));
    let cfg: serde_json::Value = serde_json::from_str(&fs::read_to_string(&cfg_path)?)?;
    if let Some(over) = cfg.get("modelParams") {
        // A typo in a key would otherwise add a field nobody reads and leave
        // the city on the default quietly — which is how Berlin ended up with
        // Hamburg's subsoil. Every override has to name a field that exists.
        let mut unknown = Vec::new();
        check_known(&params, over, "", &mut unknown);
        if !unknown.is_empty() {
            return Err(format!(
                "{}: modelParams kennt diese Felder nicht: {}",
                cfg_path.display(),
                unknown.join(", ")
            )
            .into());
        }
        merge(&mut params, over);
        // And the result still has to be a valid parameter set.
        let _: Params = serde_json::from_value(params.clone())?;
        println!("Stadtparameter aus {}", cfg_path.display());
    }
    Ok(params)
}

/// Collect every path in `patch` that `base` does not already have.
fn check_known(base: &serde_json::Value, patch: &serde_json::Value, at: &str, out: &mut Vec<String>) {
    let (Some(b), Some(p)) = (base.as_object(), patch.as_object()) else {
        return;
    };
    for (k, v) in p {
        let path = if at.is_empty() {
            k.clone()
        } else {
            format!("{at}.{k}")
        };
        match b.get(k) {
            None => out.push(path),
            Some(bv) => check_known(bv, v, &path, out),
        }
    }
}

/// Deep-merge `patch` into `base`, object by object. A scalar replaces a scalar.
fn merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(b), serde_json::Value::Object(p)) => {
            for (k, v) in p {
                merge(b.entry(k.clone()).or_insert(serde_json::Value::Null), v);
            }
        }
        (b, p) => *b = p.clone(),
    }
}

/// Apply a scenario template to the network.
pub fn apply_template(net: &mut Network, t: &ScenarioTemplate) {
    for l in net.lines.values_mut() {
        l.included = l
            .external_id
            .as_ref()
            .map(|e| t.included_lines.contains(e))
            .unwrap_or(false);
    }
}

/// Load the generated scenario templates from disk.
#[allow(dead_code)]
pub fn load_templates(root: &str) -> R<Vec<ScenarioTemplate>> {
    let raw = fs::read_to_string(path(root, &dist("scenarios")))?;
    Ok(serde_json::from_str(&raw)?)
}

fn eur(v: f64) -> String {
    if v.abs() >= 1e9 {
        format!("{:.2} Mrd. €", v / 1e9)
    } else if v.abs() >= 1e6 {
        format!("{:.0} Mio. €", v / 1e6)
    } else {
        format!("{:.0} €", v)
    }
}

/// Check the models against the published reference points (plan §29, §37).
pub fn calibrate(root: &str) -> R<()> {
    let city = load_city(root)?;
    let (net, templates) = build(root, &city)?;
    // This city's own parameters, not the built-in defaults: calibrating one
    // city against another's figures would be meaningless.
    let params: Params = serde_json::from_value(city_params(root)?)?;

    // Which published figures the sponsor stands behind but others contest.
    // The year each published figure is priced in, where it is known.
    let price_base: std::collections::HashMap<String, i32> =
        match fs::read_to_string(path(root, &dist("projects"))) {
            Ok(raw) => serde_json::from_str::<Projects>(&raw)
                .map(|ps| {
                    ps.projects
                        .iter()
                        .filter_map(|p| p.price_base_year.map(|y| (p.id.clone(), y)))
                        .collect()
                })
                .unwrap_or_default(),
            Err(_) => Default::default(),
        };

    let disputed: std::collections::HashSet<String> =
        match fs::read_to_string(path(root, &dist("projects"))) {
            Ok(raw) => serde_json::from_str::<Projects>(&raw)
                .map(|ps| {
                    ps.projects
                        .iter()
                        .filter(|p| p.cost_disputed)
                        .map(|p| p.id.clone())
                        .collect()
                })
                .unwrap_or_default(),
            Err(_) => Default::default(),
        };

    println!("Kalibrierung gegen veröffentlichte Referenzwerte\n");
    println!(
        "{:<44} {:>16} {:>16} {:>9}",
        "Referenz", "Modell", "veröffentlicht", "Abw."
    );
    println!("{}", "-".repeat(90));

    let mut checks: Vec<(String, f64, f64, String)> = Vec::new();
    let mut outdated: std::collections::HashSet<String> = Default::default();

    // Per-project costs against the officially communicated figures.
    for l in net.lines.values().filter(|l| l.official_cost_eur.is_some()) {
        // What a project appraisal actually costs: today's network plus this
        // one project. Switching everything else off would also switch off the
        // rest of the line being extended, so its own terminus would look like
        // a station that has to be rebuilt for a new service, and its fleet
        // would be sized for the extension alone.
        let mut sub = net.clone();
        for x in sub.lines.values_mut() {
            x.included = x.id == l.id || x.source == Source::Existing;
        }
        let r = simulation::run(&sub, &city, &params);
        let official = l.official_cost_eur.unwrap();
        let project_id = l.external_id.clone().unwrap_or_default();
        // The opening year is a headline figure on every plan the application
        // shows, and until now nothing compared it with the dates the sponsors
        // publish — the whole calibration was about money. A timeline model
        // that nobody checks is a number with a confident typeface and nothing
        // behind it.
        if let (Some(published), Some(modelled)) = (l.official_opening_year, r.headline.opening_year)
        {
            checks.push((
                format!("{} ({}), Eröffnung", l.label, project_id),
                modelled as f64,
                published as f64,
                "Jahr".into(),
            ));
        }
        let base = price_base.get(&project_id).copied();
        // A figure priced years ago cannot judge a model that computes in
        // today's prices: the gap is construction inflation, not calibration.
        if base.is_some_and(|y| y < params.price_base_year - 3) {
            outdated.insert(project_id.clone());
        }
        checks.push((
            format!(
                "{} ({}){}{}",
                l.label,
                project_id,
                base.map(|y| format!(" [{y}]")).unwrap_or_default(),
                if disputed.contains(&project_id) { " †" } else { "" }
            ),
            r.headline.investment_eur,
            official,
            "Kosten".into(),
        ));
    }

    // The tram concept against its own published headline figures.
    let tram_lines: Vec<LineId> = net
        .lines
        .values()
        .filter(|l| l.source == Source::Proposal)
        .map(|l| l.id)
        .collect();
    if !tram_lines.is_empty() {
        let mut sub = net.clone();
        for x in sub.lines.values_mut() {
            x.included = tram_lines.contains(&x.id);
        }
        let r = simulation::run(&sub, &city, &params);
        checks.push((
            "Straßenbahnkonzept*".into(),
            r.headline.investment_eur,
            1.5e9,
            "Kosten".into(),
        ));
        if std::env::var("HH_DEBUG").is_ok() {
            eprintln!("--- Straßenbahn Aufschlüsselung ---");
            for c in &r.cost.categories {
                eprintln!("  {:<32} {}", c.label, eur(c.amount_eur));
                for i in c.items.iter().take(6) {
                    eprintln!(
                        "      {:<38} {:>14}  {}",
                        i.label,
                        eur(i.amount_eur),
                        i.detail
                    );
                }
            }
        }
        checks.push((
            "Straßenbahnkonzept, Länge".into(),
            r.headline.new_km,
            44.0,
            "km".into(),
        ));
        checks.push((
            "Straßenbahnkonzept, Halte".into(),
            r.headline.new_stations as f64,
            91.0,
            "Halte".into(),
        ));
    }

    // The whole U5 against the €16.5 bn quoted in the 2026 debate.
    let u5: Vec<LineId> = net
        .lines
        .values()
        .filter(|l| {
            l.external_id
                .as_deref()
                .map(|e| e.starts_with("u5"))
                .unwrap_or(false)
        })
        .map(|l| l.id)
        .collect();
    if !u5.is_empty() {
        let mut sub = net.clone();
        for x in sub.lines.values_mut() {
            x.included = u5.contains(&x.id);
        }
        let r = simulation::run(&sub, &city, &params);
        checks.push((
            "U5 gesamt*".into(),
            r.headline.investment_eur,
            16.5e9,
            "Kosten".into(),
        ));
        checks.push((
            "U5 gesamt, Länge".into(),
            r.headline.new_km,
            24.0,
            "km".into(),
        ));
    }

    let mut worst = 0.0f64;
    let (mut judged, mut skipped) = (0usize, 0usize);
    let mut worst_years = 0.0f64;
    let mut judged_years = 0usize;
    for (name, model, official, unit) in &checks {
        let dev = if *official != 0.0 {
            (model - official) / official
        } else {
            0.0
        };
        // Figures marked * come from the political debate rather than from a
        // project sponsor's cost estimate; they are shown for comparison but
        // must not drive the calibration.
        // The price-base exclusion is about money only: that a cost figure is
        // from 2018 says nothing about whether the opening date is comparable.
        let stale_price = unit == "Kosten" && outdated.iter().any(|id| name.contains(id.as_str()));
        let excluded = name.ends_with('*') || name.ends_with('†') || stale_price;
        if unit == "Kosten" {
            if excluded {
                skipped += 1;
            } else {
                judged += 1;
                worst = worst.max(dev.abs());
            }
        }
        if unit == "Jahr" && !excluded {
            worst_years = worst_years.max((model - official).abs());
            judged_years += 1;
        }
        let fmt = |v: f64| match unit.as_str() {
            "Kosten" => eur(v),
            // A year is not a quantity to take a percentage of: "2049 against
            // 2045" is four years late, not 0.2 % off.
            "Jahr" => format!("{v:.0}"),
            _ => format!("{v:.1}"),
        };
        let deviation = if unit == "Jahr" {
            format!("{:>+7.0} a", model - official)
        } else {
            format!("{:>8.0}%", dev * 100.0)
        };
        println!(
            "{:<44} {:>16} {:>16} {}",
            name,
            fmt(*model),
            fmt(*official),
            deviation
        );
    }

    // Ridership of the present-day network against observed Hamburg figures.
    let mut today = net.clone();
    if let Some(t) = templates.iter().find(|t| t.id == "bestand") {
        apply_template(&mut today, t);
    }
    let r = simulation::run(&today, &city, &params);
    println!("\nNachfragemodell im Bestandsnetz");
    println!(
        "  Einsteiger je Werktag: {:.0}",
        r.headline.boardings_per_day
    );
    println!(
        "  Fahrten je Jahr:       {:.0} Mio.",
        r.demand.annual_rides / 1e6
    );
    // The observed range each city is held against. Everything else the
    // calibration checks is a published project figure, and a city without
    // curated projects still has to produce a plausible demand figure.
    let observed: Option<(f64, f64, &str)> = match crate::import::city().as_str() {
        "hamburg" => Some((
            1.3e6,
            1.5e6,
            "U-Bahn und S-Bahn Hamburg zusammen rund 1,3 bis 1,5 Mio. Einsteiger je Werktag",
        )),
        "berlin" => Some((
            2.4e6,
            3.2e6,
            "U-Bahn, S-Bahn und Straßenbahn Berlin zusammen rund 2,4 bis 3,2 Mio. Einsteiger je Werktag",
        )),
        _ => None,
    };
    if let Some((low, high, note)) = observed {
        let b = r.headline.boardings_per_day;
        println!(
            "  (Beobachtet: {note}.) {}",
            if b >= low && b <= high {
                "✓ im Bereich"
            } else {
                "✗ AUSSERHALB"
            }
        );
    }
    println!(
        "  Erschlossene Einwohner: {:.0} von {:.0}",
        r.demand.population_served_after,
        city.grid.total_population()
    );
    println!(
        "  Mittlere Erreichbarkeit der Zentren: {:.1} min",
        r.demand.access_time_after_min
    );
    println!(
        "  Betriebsergebnis: {} bei {:.0} % Kostendeckung",
        eur(r.operations.annual_result_eur),
        r.operations.cost_recovery_ratio * 100.0
    );

    println!("\n  * Wert aus der politischen Debatte, kein Kostenansatz eines Vorhabenträgers.");
    let stale: Vec<(&String, &i32)> = price_base
        .iter()
        .filter(|(_, y)| **y < params.price_base_year - 2)
        .collect();
    if !price_base.is_empty() {
        println!(
            "  [Jahr] Preisstand der veröffentlichten Angabe. Das Modell rechnet in Preisen von {}.",
            params.price_base_year
        );
    }
    if !stale.is_empty() {
        let oldest = stale.iter().map(|(_, y)| **y).min().unwrap_or_default();
        for line in [
            format!(
                "Bis zu {} Jahre liegen zwischen der ältesten Angabe ({oldest}) und heute. Ein Teil",
                params.price_base_year - oldest
            ),
            "der Abweichung ist deshalb Baupreissteigerung und kein Modellfehler, und zwar mehr,".into(),
            format!(
                "als die {:.0} % pro Jahr des Modells vermuten lassen: die deutschen Baupreise sind",
                params.cost.price_escalation_per_year * 100.0
            ),
            "zwischen 2021 und 2023 sprunghaft gestiegen. Umgerechnet wird hier nichts, weil dafür".into(),
            "der amtliche Baupreisindex nötig wäre und nicht die Vorausannahme des Modells.".into(),
            "Angaben mit einem Preisstand älter als drei Jahre bleiben aus dem Urteil heraus.".into(),
        ] {
            println!("  {line}");
        }
    }
    if !disputed.is_empty() {
        println!(
            "  † Vom Vorhabenträger veröffentlicht, aber öffentlich bestritten. Bleibt aus der\n  \
             Kalibrierung heraus: ein Modell, das der Kritik zustimmt statt der Zahl, ist nicht\n  \
             falsch geeicht, und es auf die bestrittene Zahl zu ziehen wäre der Fehler."
        );
    }
    println!(
        "  Hinweis: Das Modell rechnet in Preisen von {}. Für die veröffentlichten Werte ist\n  \
         der Preisstand nicht durchgängig angegeben; ein Teil der verbleibenden Abweichung\n  \
         ist deshalb reine Baupreissteigerung und kein Modellfehler.",
        params.price_base_year
    );
    println!(
        "\nGrößte Abweichung gegenüber Vorhabenträger-Angaben: {:.0} % ({} von {} Referenzen)",
        worst * 100.0,
        judged,
        judged + skipped
    );
    // A verdict has to say what it rests on. With every reference excluded the
    // figure was 0 %, which reads like a perfect result and means the opposite:
    // nothing was compared.
    if judged == 0 {
        println!("Keine Referenz konnte die Eichung prüfen: alle sind bestritten oder zu alt.");
        println!("Die Kennwerte sind damit für diese Stadt ungeprüft.");
    } else if worst > 0.6 {
        println!(
            "Hinweis: über 60 % Abweichung, die Kennwerte in params.rs sollten geprüft werden."
        );
    } else {
        println!("Alle geprüften Projektreferenzen liegen innerhalb der ausgewiesenen Unsicherheitsspanne.");
    }
    if judged_years > 0 {
        println!(
            "Größte Abweichung beim Eröffnungsjahr: {:.0} Jahre ({} Referenzen)",
            worst_years, judged_years
        );
        // Schedules of this size routinely move by years in reality; a
        // tighter bound would be false precision.
        if worst_years > 5.0 {
            println!(
                "Hinweis: über fünf Jahre, die Bauzeitkennwerte in params.rs sollten geprüft werden."
            );
        }
    }
    Ok(())
}

pub fn simulate(root: &str, scenario: Option<&str>) -> R<()> {
    let city = load_city(root)?;
    let (mut net, templates) = build(root, &city)?;
    let id = scenario.unwrap_or("beschlossen");
    let t = templates.iter().find(|t| t.id == id).ok_or_else(|| {
        format!(
            "Unbekanntes Szenario {id}; verfügbar: {}",
            templates
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;
    apply_template(&mut net, t);
    let params = Params::default();
    let r = simulation::run(&net, &city, &params);

    println!("Szenario: {}\n{}\n", t.title, t.summary);
    println!(
        "  Netzlänge              {:.1} km, davon {:.1} km neu",
        r.headline.network_km, r.headline.new_km
    );
    println!(
        "  Stationen              {} ({} neu, {} Umsteigepunkte)",
        r.headline.stations, r.headline.new_stations, r.headline.interchanges
    );
    println!(
        "  Investition            {} ({} – {})",
        eur(r.headline.investment_eur),
        eur(r.headline.investment_low_eur),
        eur(r.headline.investment_high_eur)
    );
    match r.headline.opening_year {
        Some(y) => println!(
            "  Eröffnung              {} ({}–{})",
            y, r.timeline.opening_year_low, r.timeline.opening_year_high
        ),
        None => println!("  Eröffnung                nichts zu bauen"),
    }
    println!(
        "  Jährlicher Nutzen      {}",
        eur(r.headline.annual_benefit_eur)
    );
    println!(
        "  Fiskaleffekt {:<10} {}/Jahr",
        city.version.city,
        eur(r.headline.annual_fiscal_eur)
    );
    println!(
        "  Betriebsergebnis       {}/Jahr",
        eur(r.headline.annual_operating_eur)
    );
    println!(
        "  Nutzen-Kosten          {:.2}",
        r.headline.benefit_cost_ratio
    );
    println!("  Barwert                {}", eur(r.appraisal.npv_eur));
    println!(
        "  Einsteiger/Werktag     {:.0}",
        r.headline.boardings_per_day
    );
    println!(
        "  CO₂-Einsparung         {:.0} t/Jahr",
        r.headline.co2_saved_t_per_year
    );
    println!(
        "  Baubarkeit             {} ({} Hinweise)",
        r.headline.feasibility,
        r.feasibility.findings.len()
    );

    println!("\n  Kostenaufstellung");
    for c in &r.cost.categories {
        println!("    {:<34} {:>14}", c.label, eur(c.amount_eur));
    }
    println!("    {:<34} {:>14}", "GESAMT", eur(r.cost.total_eur));

    if !r.feasibility.findings.is_empty() {
        println!("\n  Baubarkeit");
        for f in r.feasibility.findings.iter().take(6) {
            println!("    [{}] {}", f.severity.label_de(), f.title);
        }
    }
    Ok(())
}

/// Print the full derivation for one project, so the arithmetic can be checked
/// by hand against what the project sponsor has published.
pub fn audit(root: &str, which: Option<&str>) -> R<()> {
    let city = load_city(root)?;
    let (net, _) = build(root, &city)?;
    let params = Params::default();

    let targets: Vec<LineId> = net
        .lines
        .values()
        .filter(|l| l.source == Source::Planned || l.source == Source::Proposal)
        .filter(|l| match which {
            Some(w) => l
                .external_id
                .as_deref()
                .map(|e| e.contains(w))
                .unwrap_or(false),
            None => true,
        })
        .map(|l| l.id)
        .collect();
    if targets.is_empty() {
        return Err("Keine passende Linie gefunden".into());
    }

    for lid in targets {
        let mut sub = net.clone();
        for l in sub.lines.values_mut() {
            l.included = l.id == lid || l.source == Source::Existing;
        }
        // Cost only what this line adds, by differencing against the baseline.
        let mut baseline = net.clone();
        for l in baseline.lines.values_mut() {
            l.included = l.source == Source::Existing;
        }
        let line = net.lines.get(&lid).unwrap();
        let r = simulation::run(&sub, &city, &params);
        let base = simulation::run(&baseline, &city, &params);

        println!("\n{}", "=".repeat(78));
        println!(
            "{}  ({})",
            line.name,
            line.external_id.clone().unwrap_or_default()
        );
        println!("{}", "=".repeat(78));

        let km: f64 = line
            .edges
            .iter()
            .filter_map(|e| net.edges.get(e))
            .map(|e| e.length_km())
            .sum();
        println!(
            "  Strecke      {:.2} km über {} Abschnitte",
            km,
            line.edges.len()
        );
        let nodes = net.line_nodes(lid);
        let new_nodes = nodes
            .iter()
            .filter_map(|n| net.nodes.get(n))
            .filter(|n| n.status != BuildStatus::InService)
            .count();
        println!(
            "  Stationen    {} gesamt, davon {} neu",
            nodes.len(),
            new_nodes
        );
        for n in &nodes {
            if let Some(node) = net.nodes.get(n) {
                println!(
                    "                 {:<32} {:<28} {}",
                    node.name,
                    sub.effective_depth(*n).label_de(),
                    if node.status == BuildStatus::InService {
                        "Bestand"
                    } else {
                        "neu"
                    }
                );
            }
        }

        println!("\n  Kostenpositionen");
        for c in &r.cost.categories {
            println!("    {:<32} {:>14}", c.label, eur(c.amount_eur));
            for i in &c.items {
                if i.line.as_deref().map(|l| l != line.label).unwrap_or(false) {
                    continue;
                }
                println!(
                    "        {:<40} {:>12}  {}",
                    trim(&i.label, 40),
                    eur(i.amount_eur),
                    i.detail
                );
            }
        }
        println!(
            "    {:<32} {:>14}",
            "GESAMT (Szenario)",
            eur(r.cost.total_eur)
        );
        println!(
            "    {:<32} {:>14}   ({} – {})",
            "davon durch diese Linie",
            eur(r.cost.total_eur - base.cost.total_eur),
            eur(r.cost.low_eur - base.cost.low_eur),
            eur(r.cost.high_eur - base.cost.high_eur)
        );
        println!(
            "    {:<32} {:>14}",
            "je km",
            eur((r.cost.total_eur - base.cost.total_eur) / km.max(0.001))
        );
        if let Some(official) = line.official_cost_eur {
            let delta = (r.cost.total_eur - base.cost.total_eur - official) / official;
            println!(
                "    {:<32} {:>14}   Abweichung {:+.0} %",
                "veröffentlicht",
                eur(official),
                delta * 100.0
            );
        }
        println!(
            "\n  Eröffnung    {} ({}–{}), Bauzeit {:.1} Jahre",
            r.timeline.opening_year,
            r.timeline.opening_year_low,
            r.timeline.opening_year_high,
            r.timeline.construction_years
        );
        if let Some(y) = line.official_opening_year {
            println!("  veröffentlicht {y}");
        }
    }
    Ok(())
}

fn trim(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n - 1).collect::<String>())
    }
}

pub fn bench(root: &str) -> R<()> {
    let city = load_city(root)?;
    let (base, templates) = build(root, &city)?;
    let params = Params::default();

    println!("Laufzeiten (Release-Build messen, nicht Debug)\n");
    for t in &templates {
        let mut net = base.clone();
        apply_template(&mut net, t);
        let km: f64 = net
            .active_edges()
            .iter()
            .filter_map(|e| net.edges.get(e))
            .map(|e| e.length_km())
            .sum();
        let t0 = Instant::now();
        let quick = simulation::quick(&net, &city, &params);
        let dq = t0.elapsed();
        let t1 = Instant::now();
        let full = simulation::run(&net, &city, &params);
        let dfull = t1.elapsed();
        // The quick estimate runs on every pointer move while drawing, so a
        // total is not enough: it has three parts and only one of them is ever
        // the problem. Splitting them out is the difference between knowing the
        // scenario is slow and knowing why.
        let ms = |f: &dyn Fn()| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        };
        let d_timeline = ms(&|| {
            hh_core::construction::calculate(&net, &city, &params);
        });
        let d_cost = ms(&|| {
            hh_core::costs::calculate(&net, &city, &params, Some(2040));
        });
        let d_feas = ms(&|| {
            hh_core::feasibility::calculate(&net, &city, &params);
        });
        println!(
            "  {:<26} {:>7.1} km  {:>4} Stationen   quick {:>7.1} ms   voll {:>8.1} ms   \
             (Bauzeit {:.1} · Kosten {:.1} · Baubarkeit {:.1})",
            t.title,
            km,
            full.headline.stations,
            dq.as_secs_f64() * 1000.0,
            dfull.as_secs_f64() * 1000.0,
            d_timeline,
            d_cost,
            d_feas
        );
        let _ = quick;
    }

    // Drawing latency: what the user feels on every pointer move.
    let mut net = base.clone();
    if let Some(t) = templates.iter().find(|t| t.id == "bestand") {
        apply_template(&mut net, t);
    }
    let t0 = Instant::now();
    let n = 200;
    for i in 0..n {
        let a = hh_core::geo::Point::new(-6000.0 + i as f64 * 20.0, 2000.0);
        let _ = hh_core::snap::snap(
            hh_core::geo::Point::new(a.x + 3000.0, a.y + 800.0),
            Some(a),
            Mode::Ubahn,
            &net,
            &city,
            &params.geometry,
            3.0,
            false,
        );
    }
    println!(
        "\n  Snapping im Gesamtnetz: {:.2} ms je Zeigerbewegung",
        t0.elapsed().as_secs_f64() * 1000.0 / n as f64
    );

    let t0 = Instant::now();
    let doc = ScenarioDocument::new("Bench", net.clone(), DATA_VERSION);
    let json = doc.to_json()?;
    let ser = t0.elapsed();
    let t0 = Instant::now();
    let _ = ScenarioDocument::from_json(&json)?;
    println!(
        "  Szenario: {:.0} kB, serialisieren {:.1} ms, laden {:.1} ms",
        json.len() as f64 / 1024.0,
        ser.as_secs_f64() * 1000.0,
        t0.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}
