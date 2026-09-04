//! Core domain objects (plan §9, §10).
//!
//! The network is a graph, not a bag of polylines: nodes are stations and
//! junctions, edges are physical track segments, and a line is a *path over
//! edges*. Shared track, branches and interchanges therefore fall out of the
//! model instead of having to be special-cased.

use crate::geo::{polyline_length, LatLon, Point};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

macro_rules! id_type {
    ($name:ident) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub u32);

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

id_type!(NodeId);
id_type!(EdgeId);
id_type!(LineId);

/// A network that exceeds the limits an analysis can carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SizeError(pub String);

impl std::fmt::Display for SizeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Netz überschreitet die zulässige Größe: {}", self.0)
    }
}

impl std::error::Error for SizeError {}

/// Transport mode (plan §11).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Ubahn,
    Sbahn,
    Tram,
    /// Regional/mainline rail: shown for context and usable as reusable corridor.
    Regional,
}

impl Mode {
    pub const ALL: [Mode; 4] = [Mode::Ubahn, Mode::Sbahn, Mode::Tram, Mode::Regional];

    pub fn label_de(&self) -> &'static str {
        match self {
            Mode::Ubahn => "U-Bahn",
            Mode::Sbahn => "S-Bahn",
            Mode::Tram => "Stadtbahn",
            Mode::Regional => "Regionalbahn",
        }
    }

    pub fn key(&self) -> &'static str {
        match self {
            Mode::Ubahn => "ubahn",
            Mode::Sbahn => "sbahn",
            Mode::Tram => "tram",
            Mode::Regional => "regional",
        }
    }

    /// Whether track built for `self` can carry a service of `other`.
    pub fn compatible_with(&self, other: Mode) -> bool {
        self == &other
            || matches!(
                (self, other),
                (Mode::Sbahn, Mode::Regional) | (Mode::Regional, Mode::Sbahn)
            )
    }
}

/// Physical construction type of an edge (plan §11).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Infrastructure {
    /// Bored tunnel, typically TBM, below existing infrastructure.
    DeepTunnel,
    /// Cut-and-cover / shallow tunnel in open construction.
    CutAndCover,
    /// Viaduct or elevated structure.
    Elevated,
    /// Own right of way at grade.
    Surface,
    /// Reuses an existing rail corridor (upgrade only).
    ExistingRail,
    /// Tram on its own reserved track in the street space.
    TramReserved,
    /// Tram running in mixed traffic.
    TramMixed,
    /// Bridge over water or a major barrier.
    Bridge,
}

impl Infrastructure {
    pub fn label_de(&self) -> &'static str {
        match self {
            Infrastructure::DeepTunnel => "Tiefliegender Tunnel (TVM)",
            Infrastructure::CutAndCover => "Tunnel in offener Bauweise",
            Infrastructure::Elevated => "Hochbahn / Viadukt",
            Infrastructure::Surface => "Oberirdisch, eigener Bahnkörper",
            Infrastructure::ExistingRail => "Bestandsstrecke (Ausbau)",
            Infrastructure::TramReserved => "Straßenbahn, besonderer Bahnkörper",
            Infrastructure::TramMixed => "Straßenbahn im Straßenraum",
            Infrastructure::Bridge => "Brücke",
        }
    }

    pub fn is_tunnel(&self) -> bool {
        matches!(
            self,
            Infrastructure::DeepTunnel | Infrastructure::CutAndCover
        )
    }

    pub fn is_surface(&self) -> bool {
        matches!(
            self,
            Infrastructure::Surface
                | Infrastructure::ExistingRail
                | Infrastructure::TramReserved
                | Infrastructure::TramMixed
        )
    }

    /// Default construction type when the user draws in a given mode.
    pub fn default_for(mode: Mode) -> Self {
        match mode {
            Mode::Ubahn => Infrastructure::DeepTunnel,
            Mode::Sbahn => Infrastructure::Surface,
            Mode::Tram => Infrastructure::TramReserved,
            Mode::Regional => Infrastructure::ExistingRail,
        }
    }

    pub fn allowed_for(mode: Mode) -> Vec<Infrastructure> {
        match mode {
            Mode::Ubahn => vec![
                Infrastructure::DeepTunnel,
                Infrastructure::CutAndCover,
                Infrastructure::Elevated,
                Infrastructure::Surface,
                Infrastructure::Bridge,
            ],
            Mode::Sbahn | Mode::Regional => vec![
                Infrastructure::Surface,
                Infrastructure::ExistingRail,
                Infrastructure::DeepTunnel,
                Infrastructure::CutAndCover,
                Infrastructure::Elevated,
                Infrastructure::Bridge,
            ],
            // Trams in tunnels are ordinary in Germany — the Stadtbahn tunnels
            // in Karlsruhe, Stuttgart and Bremen, and the short underpasses
            // Berlin's own network uses to cross railway lines.
            Mode::Tram => vec![
                Infrastructure::TramReserved,
                Infrastructure::TramMixed,
                Infrastructure::Bridge,
                Infrastructure::Surface,
                Infrastructure::CutAndCover,
                Infrastructure::DeepTunnel,
            ],
        }
    }
}

/// Where an object came from (plan §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// Exists today.
    Existing,
    /// Officially planned or under construction (U5, S4, …).
    Planned,
    /// A political proposal or alternative concept.
    Proposal,
    /// Created by the user in this scenario.
    User,
}

/// Build state of an object *within the scenario* (plan §10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuildStatus {
    /// In service today — costs nothing to "build".
    InService,
    /// Construction has already started in the real world.
    UnderConstruction,
    /// Has to be built in this scenario.
    ToBuild,
}

impl BuildStatus {
    /// Fraction of the investment still outstanding.
    pub fn cost_share(&self) -> f64 {
        match self {
            BuildStatus::InService => 0.0,
            // Sunk cost is excluded; roughly a third of these projects is built.
            BuildStatus::UnderConstruction => 0.65,
            BuildStatus::ToBuild => 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Station,
    /// Track connection without passenger access.
    Junction,
    /// Geometry vertex that is neither (line end without a station, portal…).
    Waypoint,
}

/// A graph node: station, junction or plain waypoint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub kind: NodeKind,
    pub name: String,
    /// Geographic position — the authoritative one for all calculations.
    pub geo: LatLon,
    /// Schematic position in the metric plane, used for rendering.
    pub schematic: Point,
    pub source: Source,
    pub status: BuildStatus,
    /// Set when the station is an interchange with pre-existing infrastructure.
    pub interchange: bool,
    /// Step-free access.
    pub accessible: bool,
    /// Depth class of the station box, drives its cost.
    pub depth: StationDepth,
    /// Original identifier in the imported dataset, when applicable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StationDepth {
    /// A tram stop: a platform in the street space, not a station building.
    Stop,
    Surface,
    Elevated,
    Shallow,
    Deep,
}

impl StationDepth {
    pub fn label_de(&self) -> &'static str {
        match self {
            StationDepth::Stop => "Haltestelle im Straßenraum",
            StationDepth::Surface => "oberirdisch",
            StationDepth::Elevated => "Hochlage",
            StationDepth::Shallow => "Tieflage (offene Bauweise)",
            StationDepth::Deep => "Tieflage (bergmännisch)",
        }
    }

    /// Ordering by construction effort; used to decide which infrastructure
    /// governs a station that several lines share.
    pub fn rank(&self) -> u8 {
        match self {
            StationDepth::Stop => 0,
            StationDepth::Surface => 1,
            StationDepth::Elevated => 2,
            StationDepth::Shallow => 3,
            StationDepth::Deep => 4,
        }
    }

    pub fn for_infrastructure(infra: Infrastructure) -> Self {
        match infra {
            Infrastructure::DeepTunnel => StationDepth::Deep,
            Infrastructure::CutAndCover => StationDepth::Shallow,
            Infrastructure::Elevated => StationDepth::Elevated,
            Infrastructure::TramReserved | Infrastructure::TramMixed => StationDepth::Stop,
            _ => StationDepth::Surface,
        }
    }
}

/// A physical track segment between two nodes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub id: EdgeId,
    pub from: NodeId,
    pub to: NodeId,
    pub mode: Mode,
    pub infrastructure: Infrastructure,
    pub source: Source,
    pub status: BuildStatus,
    /// Geographic polyline including both end nodes.
    pub geo: Vec<LatLon>,
    /// Schematic polyline including both end nodes.
    pub schematic: Vec<Point>,
    /// Length in metres, derived from `geo`.
    pub length_m: f64,
    /// Number of tracks; 1 = single track (cheaper, lower capacity).
    pub tracks: u8,
    /// Design speed in km/h; drives travel time and curve requirements.
    pub design_speed_kmh: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
}

impl Edge {
    pub fn length_km(&self) -> f64 {
        self.length_m / 1000.0
    }

    pub fn recompute_length(&mut self) {
        self.length_m = crate::geo::polyline_length_geo(&self.geo);
    }

    pub fn other_end(&self, n: NodeId) -> Option<NodeId> {
        if self.from == n {
            Some(self.to)
        } else if self.to == n {
            Some(self.from)
        } else {
            None
        }
    }

    pub fn schematic_length(&self) -> f64 {
        polyline_length(&self.schematic)
    }
}

/// Service pattern of a line, used for operating cost and capacity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServicePattern {
    /// Peak headway in minutes.
    pub headway_peak_min: f64,
    /// Off-peak headway in minutes.
    pub headway_offpeak_min: f64,
    /// Operating hours per day.
    pub service_hours: f64,
    /// Cars per train.
    pub cars_per_train: u8,
}

impl ServicePattern {
    pub fn default_for(mode: Mode) -> Self {
        match mode {
            Mode::Ubahn => Self {
                headway_peak_min: 3.3,
                headway_offpeak_min: 5.0,
                service_hours: 20.0,
                cars_per_train: 3,
            },
            Mode::Sbahn => Self {
                headway_peak_min: 5.0,
                headway_offpeak_min: 10.0,
                service_hours: 20.0,
                cars_per_train: 6,
            },
            Mode::Tram => Self {
                headway_peak_min: 5.0,
                headway_offpeak_min: 10.0,
                service_hours: 19.0,
                cars_per_train: 1,
            },
            Mode::Regional => Self {
                headway_peak_min: 20.0,
                headway_offpeak_min: 30.0,
                service_hours: 19.0,
                cars_per_train: 5,
            },
        }
    }
}

/// A named service running over a path of edges (plan §10).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub id: LineId,
    /// Short designation, e.g. "U5".
    pub label: String,
    /// Full name, e.g. "U5 Bramfeld – Arenen".
    pub name: String,
    pub mode: Mode,
    /// Hex colour used on the map.
    pub color: String,
    pub source: Source,
    /// Ordered edges. Consecutive edges must share a node.
    pub edges: Vec<EdgeId>,
    pub service: ServicePattern,
    /// Whether the line is part of the scenario (plan §12 toggles).
    pub included: bool,
    /// Free-text provenance, shown in the UI.
    #[serde(default)]
    pub note: String,
    /// Earliest realistic opening year of a real-world project, if known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub official_opening_year: Option<i32>,
    /// The year work actually started, for a line already being built.
    ///
    /// Without it the model starts the build clock today, so a project five
    /// years into construction is given its full build time again — Hamburg's
    /// U4 to the Horner Geest came out four to six years later than the
    /// operator's own date purely because the model did not know the digging
    /// had begun in 2021.
    #[serde(default)]
    pub construction_started_year: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub official_cost_eur: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
}

/// The whole network graph.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Network {
    pub nodes: BTreeMap<NodeId, Node>,
    pub edges: BTreeMap<EdgeId, Edge>,
    pub lines: BTreeMap<LineId, Line>,
    #[serde(default)]
    pub next_id: u32,
}

impl Network {
    pub fn new() -> Self {
        Self {
            next_id: 1,
            ..Default::default()
        }
    }

    pub fn fresh_id(&mut self) -> u32 {
        let id = self.next_id.max(1);
        self.next_id = id + 1;
        id
    }

    pub fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(&id)
    }

    pub fn edge(&self, id: EdgeId) -> Option<&Edge> {
        self.edges.get(&id)
    }

    pub fn line(&self, id: LineId) -> Option<&Line> {
        self.lines.get(&id)
    }

    /// Adjacency of every node, built once for hot loops.
    pub fn adjacency(&self) -> std::collections::BTreeMap<NodeId, Vec<EdgeId>> {
        let mut out: std::collections::BTreeMap<NodeId, Vec<EdgeId>> = Default::default();
        for e in self.edges.values() {
            out.entry(e.from).or_default().push(e.id);
            if e.to != e.from {
                out.entry(e.to).or_default().push(e.id);
            }
        }
        out
    }

    /// All edges touching a node.
    pub fn edges_at(&self, node: NodeId) -> Vec<EdgeId> {
        self.edges
            .values()
            .filter(|e| e.from == node || e.to == node)
            .map(|e| e.id)
            .collect()
    }

    /// All lines using an edge.
    pub fn lines_on_edge(&self, edge: EdgeId) -> Vec<LineId> {
        self.lines
            .values()
            .filter(|l| l.edges.contains(&edge))
            .map(|l| l.id)
            .collect()
    }

    /// Distinct services calling at a node, as (label, mode).
    ///
    /// A line can be stored as several records — the U5 is five construction
    /// stages that meet end to end — and those must not be mistaken for
    /// different lines meeting. An interchange is where you can change to a
    /// *different* service.
    pub fn services_at_node(&self, node: NodeId) -> Vec<(String, Mode)> {
        let mut out: Vec<(String, Mode)> = self
            .lines_at_node(node)
            .iter()
            .filter_map(|l| self.lines.get(l))
            .filter(|l| l.included)
            .map(|l| (l.label.clone(), l.mode))
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// Reject a network far larger than any real proposal.
    ///
    /// The accessibility model runs a Dijkstra from every station, so the cost
    /// of an analysis grows faster than the network does: at 20 000 stations a
    /// single published scenario costs eight seconds of server CPU, which is
    /// all an attacker needs. Hamburg's whole network is 247 stations; twelve
    /// times that is a generous ceiling for an ambitious plan and keeps the
    /// worst case at a quarter of a second.
    pub fn check_size(&self) -> Result<(), SizeError> {
        const MAX_NODES: usize = 3_000;
        const MAX_EDGES: usize = 4_500;
        const MAX_LINES: usize = 300;
        const MAX_VERTICES: usize = 400_000;
        if self.nodes.len() > MAX_NODES {
            return Err(SizeError(format!(
                "{} Knoten, höchstens {MAX_NODES} sind zulässig.",
                self.nodes.len()
            )));
        }
        if self.edges.len() > MAX_EDGES {
            return Err(SizeError(format!(
                "{} Kanten, höchstens {MAX_EDGES} sind zulässig.",
                self.edges.len()
            )));
        }
        if self.lines.len() > MAX_LINES {
            return Err(SizeError(format!(
                "{} Linien, höchstens {MAX_LINES} sind zulässig.",
                self.lines.len()
            )));
        }
        let vertices: usize = self.edges.values().map(|e| e.geo.len()).sum();
        if vertices > MAX_VERTICES {
            return Err(SizeError(format!(
                "{vertices} Stützpunkte, höchstens {MAX_VERTICES} sind zulässig."
            )));
        }
        Ok(())
    }

    /// Whether the services reaching this node over new track already call
    /// here today.
    ///
    /// Extending a line past its own terminus is not the same job as bringing
    /// a new line into an existing station. The first needs the turnback taken
    /// out and the tunnel carried on past platforms that already exist; the
    /// second needs a whole new platform level, passages and lifts. Charging
    /// both the same overstated the U4 to Horner Geest by about 60 Mio. €.
    pub fn only_extends_existing_service(&self, node: NodeId, active: &BTreeSet<EdgeId>) -> bool {
        let touching = self.edges_at(node);
        let mut existing: Vec<(String, Mode)> = Vec::new();
        let mut arriving: Vec<(String, Mode)> = Vec::new();
        for l in self.lines.values().filter(|l| l.included) {
            for e in l.edges.iter().filter(|e| touching.contains(e)) {
                if !active.contains(e) {
                    continue;
                }
                let Some(edge) = self.edges.get(e) else {
                    continue;
                };
                let key = (l.label.clone(), l.mode);
                if edge.status == BuildStatus::InService {
                    existing.push(key);
                } else {
                    arriving.push(key);
                }
            }
        }
        !arriving.is_empty() && arriving.iter().all(|a| existing.contains(a))
    }

    /// Whether track physically branches here.
    ///
    /// Two lines crossing at a shared station is not a junction: the U5 passes
    /// under the U3 at Borgweg with no track connection at all. A junction is
    /// where one service's own track splits into three or more directions.
    pub fn is_branch_node(&self, node: NodeId) -> bool {
        let touching = self.edges_at(node);
        self.lines
            .values()
            .filter(|l| l.included)
            .any(|l| l.edges.iter().filter(|e| touching.contains(e)).count() >= 3)
    }

    /// All lines calling at a node.
    pub fn lines_at_node(&self, node: NodeId) -> Vec<LineId> {
        let touching = self.edges_at(node);
        let mut out: Vec<LineId> = self
            .lines
            .values()
            .filter(|l| l.edges.iter().any(|e| touching.contains(e)))
            .map(|l| l.id)
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// The ordered node sequence of a line, following its edge path.
    pub fn line_nodes(&self, line: LineId) -> Vec<NodeId> {
        let Some(l) = self.lines.get(&line) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut prev: Option<NodeId> = None;
        for eid in &l.edges {
            let Some(e) = self.edges.get(eid) else {
                continue;
            };
            match prev {
                None => {
                    // Orient the first edge against the second one.
                    let start = l
                        .edges
                        .get(1)
                        .and_then(|n| self.edges.get(n))
                        .map(|next| {
                            if next.from == e.from || next.to == e.from {
                                e.to
                            } else {
                                e.from
                            }
                        })
                        .unwrap_or(e.from);
                    let end = if start == e.from { e.to } else { e.from };
                    out.push(start);
                    out.push(end);
                    prev = Some(end);
                }
                Some(p) => {
                    if let Some(next) = e.other_end(p) {
                        out.push(next);
                        prev = Some(next);
                    } else {
                        // Path break: restart from this edge.
                        out.push(e.from);
                        out.push(e.to);
                        prev = Some(e.to);
                    }
                }
            }
        }
        out
    }

    /// Geographic polyline of a line, edges stitched in path order.
    pub fn line_geometry(&self, line: LineId) -> Vec<LatLon> {
        let nodes = self.line_nodes(line);
        let Some(l) = self.lines.get(&line) else {
            return Vec::new();
        };
        let mut out: Vec<LatLon> = Vec::new();
        for (i, eid) in l.edges.iter().enumerate() {
            let Some(e) = self.edges.get(eid) else {
                continue;
            };
            let start = nodes.get(i).copied();
            let forward = start.map_or(true, |s| s == e.from);
            let mut pts = e.geo.clone();
            if !forward {
                pts.reverse();
            }
            if !out.is_empty() {
                pts.remove(0);
            }
            out.extend(pts);
        }
        out
    }

    pub fn line_schematic(&self, line: LineId) -> Vec<Point> {
        let nodes = self.line_nodes(line);
        let Some(l) = self.lines.get(&line) else {
            return Vec::new();
        };
        let mut out: Vec<Point> = Vec::new();
        for (i, eid) in l.edges.iter().enumerate() {
            let Some(e) = self.edges.get(eid) else {
                continue;
            };
            let forward = nodes.get(i).copied().map_or(true, |s| s == e.from);
            let mut pts = e.schematic.clone();
            if !forward {
                pts.reverse();
            }
            if !out.is_empty() {
                pts.remove(0);
            }
            out.extend(pts);
        }
        out
    }

    pub fn line_length_m(&self, line: LineId) -> f64 {
        self.lines
            .get(&line)
            .map(|l| {
                l.edges
                    .iter()
                    .filter_map(|e| self.edges.get(e))
                    .map(|e| e.length_m)
                    .sum()
            })
            .unwrap_or(0.0)
    }

    /// Terminal nodes of a line (its two ends).
    pub fn line_endpoints(&self, line: LineId) -> Option<(NodeId, NodeId)> {
        let nodes = self.line_nodes(line);
        match (nodes.first(), nodes.last()) {
            (Some(a), Some(b)) => Some((*a, *b)),
            _ => None,
        }
    }

    /// Edges that belong to at least one included line.
    pub fn active_edges(&self) -> Vec<EdgeId> {
        let mut out: Vec<EdgeId> = self
            .lines
            .values()
            .filter(|l| l.included)
            .flat_map(|l| l.edges.iter().copied())
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// Nodes served by at least one included line.
    pub fn active_stations(&self) -> Vec<NodeId> {
        let active = self.active_edges();
        let mut out: Vec<NodeId> = active
            .iter()
            .filter_map(|e| self.edges.get(e))
            .flat_map(|e| [e.from, e.to])
            .filter(|n| {
                self.nodes
                    .get(n)
                    .map(|n| n.kind == NodeKind::Station)
                    .unwrap_or(false)
            })
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// Remove nodes that no edge references any more.
    pub fn prune_orphan_nodes(&mut self) -> Vec<NodeId> {
        let used: std::collections::BTreeSet<NodeId> =
            self.edges.values().flat_map(|e| [e.from, e.to]).collect();
        let orphans: Vec<NodeId> = self
            .nodes
            .keys()
            .copied()
            .filter(|n| !used.contains(n))
            .collect();
        for n in &orphans {
            self.nodes.remove(n);
        }
        orphans
    }

    /// The station class a node is actually built to in this scenario.
    ///
    /// A node is shared by every line that calls there, so its cost cannot come
    /// from a stored field: a tram stop that happens to sit on top of a planned
    /// deep U-Bahn station must not be charged as a deep station unless that
    /// U-Bahn line is part of the scenario too.
    pub fn effective_depth(&self, node: NodeId) -> StationDepth {
        let active: std::collections::BTreeSet<EdgeId> = self.active_edges().into_iter().collect();
        self.effective_depth_with(node, &active)
    }

    /// As [`Network::effective_depth`], reusing a precomputed active-edge set.
    pub fn effective_depth_with(
        &self,
        node: NodeId,
        active: &std::collections::BTreeSet<EdgeId>,
    ) -> StationDepth {
        let stored = self
            .nodes
            .get(&node)
            .map(|n| n.depth)
            .unwrap_or(StationDepth::Surface);
        self.edges_at(node)
            .into_iter()
            .filter(|e| active.contains(e))
            .filter_map(|e| self.edges.get(&e))
            .filter(|e| e.status != BuildStatus::InService)
            .map(|e| StationDepth::for_infrastructure(e.infrastructure))
            .max_by_key(|d| d.rank())
            .unwrap_or(stored)
    }

    /// Round every coordinate to a fixed precision.
    ///
    /// Serialised floats do not always survive a JSON round trip bit-for-bit,
    /// and a published scenario has to be reproducible (plan §38). Seven
    /// decimal places is about one centimetre — far below anything the models
    /// can distinguish — and makes saved documents byte-stable.
    pub fn round_coordinates(&mut self) {
        fn r(v: f64, factor: f64) -> f64 {
            (v * factor).round() / factor
        }
        const GEO: f64 = 1.0e7;
        const METRIC: f64 = 1.0e2;
        for n in self.nodes.values_mut() {
            n.geo.lat = r(n.geo.lat, GEO);
            n.geo.lon = r(n.geo.lon, GEO);
            n.schematic.x = r(n.schematic.x, METRIC);
            n.schematic.y = r(n.schematic.y, METRIC);
        }
        for e in self.edges.values_mut() {
            for p in e.geo.iter_mut() {
                p.lat = r(p.lat, GEO);
                p.lon = r(p.lon, GEO);
            }
            for p in e.schematic.iter_mut() {
                p.x = r(p.x, METRIC);
                p.y = r(p.y, METRIC);
            }
            e.recompute_length();
            e.length_m = r(e.length_m, METRIC);
        }
    }

    /// Basic structural validation, used when accepting a network from a client.
    pub fn validate(&self) -> Vec<String> {
        let mut problems = Vec::new();
        for e in self.edges.values() {
            if !self.nodes.contains_key(&e.from) || !self.nodes.contains_key(&e.to) {
                problems.push(format!(
                    "Kante {} verweist auf einen unbekannten Knoten",
                    e.id
                ));
            }
            if e.geo.len() < 2 {
                problems.push(format!("Kante {} hat keine gültige Geometrie", e.id));
            }
            if !e.length_m.is_finite() || e.length_m <= 0.0 {
                // Naming the stations, not just the id: an id alone sends the
                // reader hunting through a generated file, and the answer is
                // almost always "these two ended up in the same place".
                let name = |id: NodeId| {
                    self.nodes
                        .get(&id)
                        .map(|n| n.name.clone())
                        .unwrap_or_else(|| format!("#{id}"))
                };
                problems.push(format!(
                    "Kante {} hat eine ungueltige Laenge ({} m) zwischen {} und {}",
                    e.id,
                    e.length_m,
                    name(e.from),
                    name(e.to)
                ));
            }
            if !Infrastructure::allowed_for(e.mode).contains(&e.infrastructure) {
                problems.push(format!(
                    "Kante {}: {} ist für {} nicht zulässig",
                    e.id,
                    e.infrastructure.label_de(),
                    e.mode.label_de()
                ));
            }
        }
        for n in self.nodes.values() {
            if !(-90.0..=90.0).contains(&n.geo.lat) || !(-180.0..=180.0).contains(&n.geo.lon) {
                problems.push(format!(
                    "Knoten {} liegt außerhalb gültiger Koordinaten",
                    n.id
                ));
            }
        }
        for l in self.lines.values() {
            for e in &l.edges {
                if !self.edges.contains_key(e) {
                    problems.push(format!(
                        "Linie {} verweist auf eine unbekannte Kante",
                        l.label
                    ));
                }
            }
        }
        problems
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{demo_crossing_network, demo_network};

    #[test]
    fn mode_compatibility() {
        assert!(Mode::Sbahn.compatible_with(Mode::Regional));
        assert!(!Mode::Ubahn.compatible_with(Mode::Tram));
        assert!(Mode::Tram.compatible_with(Mode::Tram));
    }

    #[test]
    fn line_nodes_follow_the_path() {
        let net = demo_network();
        let line = *net.lines.keys().next().unwrap();
        let nodes = net.line_nodes(line);
        assert_eq!(nodes.len(), net.lines[&line].edges.len() + 1);
        // Consecutive nodes must be joined by the corresponding edge.
        for (i, eid) in net.lines[&line].edges.iter().enumerate() {
            let e = &net.edges[eid];
            let (a, b) = (nodes[i], nodes[i + 1]);
            assert!((e.from == a && e.to == b) || (e.from == b && e.to == a));
        }
    }

    #[test]
    fn line_geometry_is_continuous() {
        let net = demo_network();
        let line = *net.lines.keys().next().unwrap();
        let geo = net.line_geometry(line);
        assert!(geo.len() >= 2);
        for w in geo.windows(2) {
            assert!(w[0].distance_to(&w[1]) > 0.0);
        }
    }

    #[test]
    fn two_stages_of_one_line_are_not_an_interchange() {
        let mut net = demo_network();
        // Split the demo line into two records with the same label, as the
        // importer does for the U5's construction stages.
        let a = *net.lines.keys().next().unwrap();
        let mut second = net.lines[&a].clone();
        let b = LineId(net.fresh_id());
        second.id = b;
        let half = net.lines[&a].edges.len() / 2;
        second.edges = net.lines[&a].edges[half..].to_vec();
        net.lines.get_mut(&a).unwrap().edges.truncate(half + 1);
        net.lines.insert(b, second);

        let shared = net.line_nodes(a).last().copied().unwrap();
        assert_eq!(net.lines_at_node(shared).len(), 2, "two records meet here");
        assert_eq!(
            net.services_at_node(shared).len(),
            1,
            "but it is one service"
        );
        assert!(
            !net.is_branch_node(shared),
            "an end-to-end join is not a branch"
        );
    }

    #[test]
    fn a_crossing_is_not_a_branch() {
        let net = demo_crossing_network();
        let hub = net
            .nodes
            .values()
            .find(|n| net.edges_at(n.id).len() == 4)
            .unwrap()
            .id;
        // Two different services cross here, but neither one branches.
        assert_eq!(net.services_at_node(hub).len(), 2);
        assert!(!net.is_branch_node(hub));
    }

    #[test]
    fn validation_accepts_a_sane_network() {
        assert!(demo_network().validate().is_empty());
    }

    #[test]
    fn validation_rejects_dangling_edges() {
        let mut net = demo_network();
        let eid = *net.edges.keys().next().unwrap();
        net.edges.get_mut(&eid).unwrap().from = NodeId(9999);
        assert!(!net.validate().is_empty());
    }

    #[test]
    fn pruning_removes_orphans_only() {
        let mut net = demo_network();
        let before = net.nodes.len();
        let id = NodeId(net.fresh_id());
        net.nodes.insert(
            id,
            Node {
                id,
                kind: NodeKind::Waypoint,
                name: "orphan".into(),
                geo: LatLon::new(53.5, 10.0),
                schematic: Point::new(0.0, 0.0),
                source: Source::User,
                status: BuildStatus::ToBuild,
                interchange: false,
                accessible: true,
                depth: StationDepth::Surface,
                external_id: None,
            },
        );
        let removed = net.prune_orphan_nodes();
        assert_eq!(removed, vec![id]);
        assert_eq!(net.nodes.len(), before);
    }
}
