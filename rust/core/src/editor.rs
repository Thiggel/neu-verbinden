//! The command-based editor (plan §50, §51, §76).
//!
//! Every change to the network is a semantic command — "extend this line",
//! "split this edge" — never a raw geometry edit. Applying a command produces
//! a diff for the renderer and an inverse patch for undo, so the history stays
//! small, meaningful, replayable and validatable on the server.

use crate::city::CityData;
use crate::geo::{point_at_distance, polyline_length, split_polyline, LatLon, Point};
use crate::model::{
    BuildStatus, Edge, EdgeId, Infrastructure, Line, LineId, Mode, Network, Node, NodeId, NodeKind,
    ServicePattern, Source, StationDepth,
};
use crate::params::Params;
use crate::snap::snap_to_grid;
use crate::stations;
use serde::{Deserialize, Serialize};

/// Which end of a line an operation applies to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum End {
    Start,
    Finish,
}

/// A semantic editor command.
///
/// `rename_all_fields` matters as much as `rename_all`: without it the variant
/// names are camelCase but their fields stay snake_case, so `alongM` from the
/// browser arrives as a missing `along_m` — and a field with a default, like
/// `autoStations`, is silently ignored rather than reported.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    /// Draw a new line along a polyline, generating stations automatically.
    DrawLine {
        mode: Mode,
        infrastructure: Option<Infrastructure>,
        /// Geographic points of the drawn corridor, at least two.
        points: Vec<LatLon>,
        label: Option<String>,
        color: Option<String>,
        /// Place stations automatically; otherwise only the given points become stations.
        #[serde(default = "yes")]
        auto_stations: bool,
        /// Positions the user actually pointed at. Each becomes a station; the
        /// engine only decides what goes between them. Absent when `points` is
        /// a routed corridor rather than a list of clicks.
        #[serde(default)]
        anchors: Option<Vec<LatLon>>,
    },
    /// Extend an existing line beyond one of its ends.
    ExtendLine {
        line: LineId,
        end: End,
        points: Vec<LatLon>,
        #[serde(default = "yes")]
        auto_stations: bool,
        #[serde(default)]
        anchors: Option<Vec<LatLon>>,
    },
    /// Remove the outermost `count` stations from one end of a line.
    ShortenLine {
        line: LineId,
        end: End,
        count: usize,
    },
    /// Insert a station on an edge, splitting it.
    SplitEdge {
        edge: EdgeId,
        along_m: f64,
        name: Option<String>,
    },
    /// Merge two edges that meet at a node of degree two, removing the node.
    MergeAtNode { node: NodeId },
    /// Remove a station, whatever shape the network has around it.
    ///
    /// A terminus loses its last segment, an intermediate stop is merged out,
    /// and anything else says why it cannot go — "remove this stop" should not
    /// depend on the user knowing the node's degree.
    RemoveStation { node: NodeId },
    /// Move a node; the adjacent edge geometry follows.
    MoveNode { node: NodeId, to: LatLon },
    /// Delete an edge (and any node left orphaned).
    DeleteEdge { edge: EdgeId },
    /// Delete a whole line; edges used by other lines survive.
    DeleteLine { line: LineId },
    /// Connect two nodes with a new edge, creating a junction or shared track.
    ConnectNodes {
        a: NodeId,
        b: NodeId,
        mode: Mode,
        infrastructure: Option<Infrastructure>,
    },
    /// Change the construction type of an edge.
    ChangeInfrastructure {
        edge: EdgeId,
        infrastructure: Infrastructure,
    },
    /// Include or exclude a line from the scenario (plan §12).
    SetLineIncluded { line: LineId, included: bool },
    /// Rename a station.
    RenameNode { node: NodeId, name: String },
    /// Turn a waypoint into a station or the other way round.
    SetNodeKind { node: NodeId, kind: NodeKind },
    /// Change a line's service pattern.
    SetService {
        line: LineId,
        service: ServicePattern,
    },
    /// Rename or recolour a line.
    SetLineStyle {
        line: LineId,
        label: Option<String>,
        name: Option<String>,
        color: Option<String>,
    },
    /// Regenerate the automatic stations of a line.
    RegenerateStations { line: LineId },
}

fn yes() -> bool {
    true
}

impl Command {
    /// A short German description for the history panel.
    pub fn label_de(&self) -> String {
        match self {
            Command::DrawLine { mode, .. } => format!("{} gezeichnet", mode.label_de()),
            Command::ExtendLine { .. } => "Linie verlängert".into(),
            Command::ShortenLine { .. } => "Linie gekürzt".into(),
            Command::SplitEdge { .. } => "Station eingefügt".into(),
            Command::MergeAtNode { .. } => "Station entfernt".into(),
            Command::RemoveStation { .. } => "Station entfernt".into(),
            Command::MoveNode { .. } => "Station verschoben".into(),
            Command::DeleteEdge { .. } => "Abschnitt gelöscht".into(),
            Command::DeleteLine { .. } => "Linie gelöscht".into(),
            Command::ConnectNodes { .. } => "Verbindung hergestellt".into(),
            Command::ChangeInfrastructure { .. } => "Bauweise geändert".into(),
            Command::SetLineIncluded { included, .. } => {
                if *included {
                    "Linie aktiviert".into()
                } else {
                    "Linie deaktiviert".into()
                }
            }
            Command::RenameNode { .. } => "Station umbenannt".into(),
            Command::SetNodeKind { .. } => "Knotentyp geändert".into(),
            Command::SetService { .. } => "Takt geändert".into(),
            Command::SetLineStyle { .. } => "Linie angepasst".into(),
            Command::RegenerateStations { .. } => "Stationen neu gesetzt".into(),
        }
    }
}

/// A primitive mutation. Commands decompose into these, and the inverse list is
/// exactly what undo replays.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Patch {
    PutNode(Node),
    DelNode(NodeId),
    PutEdge(Edge),
    DelEdge(EdgeId),
    PutLine(Line),
    DelLine(LineId),
    SetNextId(u32),
}

impl Patch {
    fn apply(self, net: &mut Network) {
        match self {
            Patch::PutNode(n) => {
                net.nodes.insert(n.id, n);
            }
            Patch::DelNode(id) => {
                net.nodes.remove(&id);
            }
            Patch::PutEdge(e) => {
                net.edges.insert(e.id, e);
            }
            Patch::DelEdge(id) => {
                net.edges.remove(&id);
            }
            Patch::PutLine(l) => {
                net.lines.insert(l.id, l);
            }
            Patch::DelLine(id) => {
                net.lines.remove(&id);
            }
            Patch::SetNextId(v) => net.next_id = v,
        }
    }
}

/// What changed, so the renderer can update only what it must (plan §64).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub nodes_changed: Vec<NodeId>,
    pub nodes_removed: Vec<NodeId>,
    pub edges_changed: Vec<EdgeId>,
    pub edges_removed: Vec<EdgeId>,
    pub lines_changed: Vec<LineId>,
    pub lines_removed: Vec<LineId>,
}

impl Diff {
    fn merge(&mut self, o: Diff) {
        self.nodes_changed.extend(o.nodes_changed);
        self.nodes_removed.extend(o.nodes_removed);
        self.edges_changed.extend(o.edges_changed);
        self.edges_removed.extend(o.edges_removed);
        self.lines_changed.extend(o.lines_changed);
        self.lines_removed.extend(o.lines_removed);
    }

    fn dedup(mut self) -> Self {
        for v in [&mut self.nodes_changed, &mut self.nodes_removed] {
            v.sort();
            v.dedup();
        }
        self.edges_changed.sort();
        self.edges_changed.dedup();
        self.edges_removed.sort();
        self.edges_removed.dedup();
        self.lines_changed.sort();
        self.lines_changed.dedup();
        self.lines_removed.sort();
        self.lines_removed.dedup();
        self
    }
}

#[derive(Debug, thiserror::Error)]
pub enum EditError {
    #[error("Unbekannte Linie {0}")]
    UnknownLine(LineId),
    #[error("Unbekannte Kante {0}")]
    UnknownEdge(EdgeId),
    #[error("Unbekannter Knoten {0}")]
    UnknownNode(NodeId),
    #[error("Die Geometrie braucht mindestens zwei Punkte")]
    TooFewPoints,
    #[error("{0}")]
    Invalid(String),
}

struct HistoryEntry {
    command: Command,
    inverse: Vec<Patch>,
    diff: Diff,
}

/// The editor: a network plus its command history.
pub struct Editor {
    pub network: Network,
    pub city: CityData,
    pub params: Params,
    undo_stack: Vec<HistoryEntry>,
    redo_stack: Vec<HistoryEntry>,
}

impl Editor {
    pub fn new(network: Network, city: CityData, params: Params) -> Self {
        Self {
            network,
            city,
            params,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    /// Walking catchment radius for a mode, exposed for previews.
    pub fn editor_catchment_radius(&self, mode: Mode) -> f64 {
        self.params.demand.catchment_radius_m.get(mode)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// Labels of the history, oldest first.
    pub fn history(&self) -> Vec<String> {
        self.undo_stack
            .iter()
            .map(|e| e.command.label_de())
            .collect()
    }

    /// What has been done and what has been taken back, oldest first.
    ///
    /// The history is semantic — "Linie gezeichnet", "Station entfernt" — not a
    /// list of geometry snapshots, which is what lets the interface show it as
    /// a list of decisions someone can step back through.
    pub fn history_full(&self) -> (Vec<String>, Vec<String>) {
        (
            self.undo_stack
                .iter()
                .map(|e| e.command.label_de())
                .collect(),
            self.redo_stack
                .iter()
                .map(|e| e.command.label_de())
                .collect(),
        )
    }

    pub fn apply(&mut self, cmd: Command) -> Result<Diff, EditError> {
        let before = self.network.clone();
        let diff = self.run(&cmd)?;
        // Saving rounds coordinates to make the file byte-stable. Rounding the
        // live network too means the figures on screen are exactly the figures
        // that get saved and published — otherwise a scenario quietly changed
        // by a few thousand euro the moment it was written out.
        self.network.round_coordinates();
        let inverse = invert(&before, &self.network);
        self.undo_stack.push(HistoryEntry {
            command: cmd,
            inverse,
            diff: diff.clone(),
        });
        self.redo_stack.clear();
        Ok(diff)
    }

    pub fn undo(&mut self) -> Option<Diff> {
        let entry = self.undo_stack.pop()?;
        let before = self.network.clone();
        for p in entry.inverse.clone() {
            p.apply(&mut self.network);
        }
        let redo_inverse = invert(&before, &self.network);
        let diff = entry.diff.clone();
        self.redo_stack.push(HistoryEntry {
            command: entry.command,
            inverse: redo_inverse,
            diff: diff.clone(),
        });
        Some(diff)
    }

    pub fn redo(&mut self) -> Option<Diff> {
        let entry = self.redo_stack.pop()?;
        let before = self.network.clone();
        for p in entry.inverse.clone() {
            p.apply(&mut self.network);
        }
        let undo_inverse = invert(&before, &self.network);
        let diff = entry.diff.clone();
        self.undo_stack.push(HistoryEntry {
            command: entry.command,
            inverse: undo_inverse,
            diff: diff.clone(),
        });
        Some(diff)
    }

    // ----------------------------------------------------------- commands --

    fn run(&mut self, cmd: &Command) -> Result<Diff, EditError> {
        match cmd.clone() {
            Command::DrawLine {
                mode,
                infrastructure,
                points,
                label,
                color,
                auto_stations,
                anchors,
            } => self.draw_line(
                mode,
                infrastructure,
                points,
                label,
                color,
                auto_stations,
                anchors,
            ),
            Command::ExtendLine {
                line,
                end,
                points,
                auto_stations,
                anchors,
            } => self.extend_line(line, end, points, auto_stations, anchors),
            Command::ShortenLine { line, end, count } => self.shorten_line(line, end, count),
            Command::SplitEdge {
                edge,
                along_m,
                name,
            } => self.split_edge(edge, along_m, name),
            Command::MergeAtNode { node } => self.merge_at_node(node),
            Command::RemoveStation { node } => self.remove_station(node),
            Command::MoveNode { node, to } => self.move_node(node, to),
            Command::DeleteEdge { edge } => self.delete_edge(edge),
            Command::DeleteLine { line } => self.delete_line(line),
            Command::ConnectNodes {
                a,
                b,
                mode,
                infrastructure,
            } => self.connect_nodes(a, b, mode, infrastructure),
            Command::ChangeInfrastructure {
                edge,
                infrastructure,
            } => {
                let e = self
                    .network
                    .edges
                    .get_mut(&edge)
                    .ok_or(EditError::UnknownEdge(edge))?;
                if !Infrastructure::allowed_for(e.mode).contains(&infrastructure) {
                    return Err(EditError::Invalid(format!(
                        "{} ist für {} nicht zulässig",
                        infrastructure.label_de(),
                        e.mode.label_de()
                    )));
                }
                e.infrastructure = infrastructure;
                if e.status == BuildStatus::InService {
                    e.status = BuildStatus::ToBuild;
                }
                let (from, to) = (e.from, e.to);
                for n in [from, to] {
                    if let Some(node) = self.network.nodes.get_mut(&n) {
                        node.depth = StationDepth::for_infrastructure(infrastructure);
                    }
                }
                Ok(Diff {
                    edges_changed: vec![edge],
                    nodes_changed: vec![from, to],
                    ..Default::default()
                })
            }
            Command::SetLineIncluded { line, included } => {
                let l = self
                    .network
                    .lines
                    .get_mut(&line)
                    .ok_or(EditError::UnknownLine(line))?;
                l.included = included;
                Ok(Diff {
                    lines_changed: vec![line],
                    ..Default::default()
                })
            }
            Command::RenameNode { node, name } => {
                let n = self
                    .network
                    .nodes
                    .get_mut(&node)
                    .ok_or(EditError::UnknownNode(node))?;
                n.name = name;
                Ok(Diff {
                    nodes_changed: vec![node],
                    ..Default::default()
                })
            }
            Command::SetNodeKind { node, kind } => {
                let n = self
                    .network
                    .nodes
                    .get_mut(&node)
                    .ok_or(EditError::UnknownNode(node))?;
                n.kind = kind;
                Ok(Diff {
                    nodes_changed: vec![node],
                    ..Default::default()
                })
            }
            Command::SetService { line, service } => {
                let l = self
                    .network
                    .lines
                    .get_mut(&line)
                    .ok_or(EditError::UnknownLine(line))?;
                l.service = service;
                Ok(Diff {
                    lines_changed: vec![line],
                    ..Default::default()
                })
            }
            Command::SetLineStyle {
                line,
                label,
                name,
                color,
            } => {
                let l = self
                    .network
                    .lines
                    .get_mut(&line)
                    .ok_or(EditError::UnknownLine(line))?;
                if let Some(v) = label {
                    l.label = v;
                }
                if let Some(v) = name {
                    l.name = v;
                }
                if let Some(v) = color {
                    l.color = v;
                }
                Ok(Diff {
                    lines_changed: vec![line],
                    ..Default::default()
                })
            }
            Command::RegenerateStations { line } => self.regenerate_stations(line),
        }
    }

    // ------------------------------------------------------------ helpers --

    fn new_node(
        &mut self,
        geo: LatLon,
        name: String,
        kind: NodeKind,
        depth: StationDepth,
    ) -> NodeId {
        let id = NodeId(self.network.fresh_id());
        let grid = self.params.geometry.grid_size_m;
        let node = Node {
            id,
            kind,
            name,
            geo,
            schematic: snap_to_grid(geo.to_metric(), grid * 0.25),
            source: Source::User,
            status: BuildStatus::ToBuild,
            interchange: false,
            accessible: true,
            depth,
            external_id: None,
        };
        self.network.nodes.insert(id, node);
        id
    }

    fn new_edge(
        &mut self,
        from: NodeId,
        to: NodeId,
        mode: Mode,
        infra: Infrastructure,
        geo: Vec<LatLon>,
    ) -> EdgeId {
        let id = EdgeId(self.network.fresh_id());
        let schematic: Vec<Point> = geo.iter().map(|p| p.to_metric()).collect();
        let mut e = Edge {
            id,
            from,
            to,
            mode,
            infrastructure: infra,
            source: Source::User,
            status: BuildStatus::ToBuild,
            geo,
            schematic,
            length_m: 0.0,
            tracks: 2,
            design_speed_kmh: match mode {
                Mode::Ubahn => 80.0,
                Mode::Sbahn => 100.0,
                Mode::Tram => 50.0,
                Mode::Regional => 140.0,
            },
            external_id: None,
        };
        e.recompute_length();
        self.network.edges.insert(id, e);
        id
    }

    /// Build the station chain for a corridor and wire it up as edges.
    /// How a section would actually be built.
    ///
    /// Drawing a line and getting one construction type for all of it is what
    /// made a drawn line unrealistic: a corridor that crosses a river, runs
    /// under the city centre and then out into open country is three different
    /// pieces of engineering at three very different prices. This picks per
    /// section from what is actually there — water, how built-up it is, and
    /// whether an existing railway already occupies the corridor.
    ///
    /// It is a default, not a verdict: the inspector can override any section.
    /// The construction type a section would plausibly need, from the ground
    /// it crosses.
    pub fn choose_infrastructure(&self, geo: &[LatLon], mode: Mode) -> Infrastructure {
        choose_infrastructure(&self.city, &self.params, geo, mode)
    }

    /// Whether a section has a water crossing that dictates its structure.
    fn section_crosses_water(&self, geo: &[LatLon]) -> bool {
        let pts: Vec<Point> = geo.iter().map(|p| p.to_metric()).collect();
        self.city.water_crossing_length(&pts) > 40.0
    }

    fn materialise(
        &mut self,
        corridor: &[Point],
        mode: Mode,
        requested: Option<Infrastructure>,
        auto_stations: bool,
        start_node: Option<NodeId>,
        anchors: &[Point],
    ) -> Result<(Vec<NodeId>, Vec<EdgeId>, Diff), EditError> {
        if corridor.len() < 2 {
            return Err(EditError::TooFewPoints);
        }
        // Fillet the corners first, then lay out stations along the smoothed
        // alignment: the stops end up exactly on the track, and the track looks
        // like track rather than a line joining dots.
        let corridor = &round_corridor(corridor, mode, &self.params);
        let mut diff = Diff::default();
        let picks = if auto_stations {
            stations::auto_place(
                corridor,
                mode,
                &self.network,
                &self.city,
                &self.params.stations,
                &self.params.demand,
                anchors,
            )
        } else {
            let total = polyline_length(corridor);
            corridor
                .iter()
                .enumerate()
                .map(|(i, p)| {
                    let along = polyline_length(&corridor[..=i]);
                    stations::StationCandidate {
                        along_m: if i + 1 == corridor.len() {
                            total
                        } else {
                            along
                        },
                        point: *p,
                        name: stations::name_for(*p, &self.city, &self.params.stations),
                        origin: stations::CandidateOrigin::Terminus,
                        score: 1.0,
                        catchment_population: 0.0,
                        catchment_jobs: 0.0,
                        existing_node: None,
                        interchange: false,
                        forced: true,
                        alternatives: Vec::new(),
                    }
                })
                .collect()
        };
        if picks.len() < 2 {
            return Err(EditError::Invalid("Zu kurz für eine eigene Strecke".into()));
        }

        // Provisional: once the sections exist, each station takes the depth
        // of the track that actually meets it.
        let depth = StationDepth::for_infrastructure(
            requested.unwrap_or_else(|| Infrastructure::default_for(mode)),
        );
        let merge_r = self.params.geometry.merge_node_radius_m;

        let mut node_ids: Vec<NodeId> = Vec::new();
        for (i, c) in picks.iter().enumerate() {
            // Reuse the node the caller started from.
            if i == 0 {
                if let Some(n) = start_node {
                    node_ids.push(n);
                    continue;
                }
            }
            // Reuse an existing station, which is what creates the interchange.
            let existing = c.existing_node.or_else(|| {
                self.network
                    .nodes
                    .values()
                    .filter(|n| n.kind == NodeKind::Station)
                    .map(|n| (n.id, n.geo.to_metric().distance_to(&c.point)))
                    .filter(|(_, d)| *d < merge_r)
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(id, _)| id)
            });
            match existing {
                Some(id) => {
                    if let Some(n) = self.network.nodes.get_mut(&id) {
                        n.interchange = true;
                        diff.nodes_changed.push(id);
                    }
                    node_ids.push(id);
                }
                None => {
                    let id = self.new_node(
                        c.point.to_latlon(),
                        c.name.clone(),
                        NodeKind::Station,
                        depth,
                    );
                    diff.nodes_changed.push(id);
                    node_ids.push(id);
                }
            }
        }

        let mut edge_ids = Vec::new();
        // Build the section geometry first, choose how each is built, then
        // smooth the choice before anything is created — see below.
        let mut sections: Vec<(usize, Vec<LatLon>)> = Vec::new();
        for i in 0..node_ids.len() - 1 {
            if node_ids[i] == node_ids[i + 1] {
                continue;
            }
            let (a, b) = (picks[i].along_m, picks[i + 1].along_m);
            let mut geo = slice_corridor(corridor, a, b);
            // A reused station keeps its own position, which can be a couple of
            // hundred metres off the drawn corridor. The track has to end at the
            // station, not near it, or the line visibly misses its own stops.
            if let (Some(from), Some(to)) = (
                self.network.nodes.get(&node_ids[i]),
                self.network.nodes.get(&node_ids[i + 1]),
            ) {
                let (fg, tg) = (from.geo, to.geo);
                if let Some(first) = geo.first_mut() {
                    *first = fg;
                }
                if let Some(last) = geo.last_mut() {
                    *last = tg;
                }
                geo.dedup_by(|x, y| x.distance_to(y) < 1.0);
                if geo.len() < 2 {
                    geo = vec![fg, tg];
                }
            }
            sections.push((i, geo));
        }

        // The construction type is per section, not per line: a corridor that
        // crosses a river, runs under the city centre and then out into open
        // country is three different pieces of engineering, and one price per
        // kilometre for all of it is what made a drawn line unrealistic.
        let mut kinds: Vec<Infrastructure> = sections
            .iter()
            .map(|(_, geo)| match requested {
                Some(fixed) => fixed,
                None => self.choose_infrastructure(geo, mode),
            })
            .collect();
        // Then smooth it. A line does not surface for one stop between two
        // tunnels — it would have to ramp up and down inside a few hundred
        // metres. A section between two identical neighbours joins them.
        if requested.is_none() {
            let wet: Vec<bool> = sections
                .iter()
                .map(|(_, geo)| self.section_crosses_water(geo))
                .collect();
            for i in 1..kinds.len().saturating_sub(1) {
                // A water crossing keeps whatever structure it needs; only an
                // odd section out gets pulled into line with its neighbours.
                if !wet[i] && kinds[i - 1] == kinds[i + 1] && kinds[i] != kinds[i - 1] {
                    kinds[i] = kinds[i - 1];
                }
            }
            settle_ramps(&mut kinds, &wet, mode, [false, false]);
        }

        for ((i, geo), kind) in sections.into_iter().zip(kinds) {
            let (from, to) = (node_ids[i], node_ids[i + 1]);
            // Two stops that ended up in the same place make no section.
            //
            // It happens where a drawn stop lands on an existing station that a
            // curated project also names: Berlin's Ostkreuz tram put a stop at
            // the exact coordinates of the merged Ostkreuz, and the section
            // between them came out zero metres long — which the network's own
            // validation rejects, so the whole city failed to import. A section
            // of no length is not something to build; it is two names for one
            // place.
            if from == to || polyline_length(&geo.iter().map(|p| p.to_metric()).collect::<Vec<_>>()) < 1.0
            {
                continue;
            }
            let id = self.new_edge(from, to, mode, kind, geo);
            diff.edges_changed.push(id);
            edge_ids.push(id);
        }
        // Now that the sections exist, each new station takes the depth of the
        // track that meets it — a stop where a tunnel surfaces is a tunnel
        // station, and one out in the open is not.
        for id in &node_ids {
            let deepest = self
                .network
                .edges_at(*id)
                .iter()
                .filter(|e| edge_ids.contains(e))
                .filter_map(|e| self.network.edges.get(e))
                .map(|e| StationDepth::for_infrastructure(e.infrastructure))
                .max_by_key(|d| d.rank());
            if let (Some(d), Some(n)) = (deepest, self.network.nodes.get_mut(id)) {
                if n.status != BuildStatus::InService {
                    n.depth = d;
                }
            }
        }

        if edge_ids.is_empty() {
            return Err(EditError::Invalid(
                "Es entsteht kein neuer Abschnitt".into(),
            ));
        }
        Ok((node_ids, edge_ids, diff))
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_line(
        &mut self,
        mode: Mode,
        infrastructure: Option<Infrastructure>,
        points: Vec<LatLon>,
        label: Option<String>,
        color: Option<String>,
        auto_stations: bool,
        anchors: Option<Vec<LatLon>>,
    ) -> Result<Diff, EditError> {
        if points.len() < 2 {
            return Err(EditError::TooFewPoints);
        }
        let corridor: Vec<Point> = points.iter().map(|p| p.to_metric()).collect();
        let anchors: Vec<Point> = anchors
            .unwrap_or_default()
            .iter()
            .map(|p| p.to_metric())
            .collect();
        let (nodes, edges, mut diff) = self.materialise(
            &corridor,
            mode,
            infrastructure,
            auto_stations,
            None,
            &anchors,
        )?;

        let id = LineId(self.network.fresh_id());
        let label = label.unwrap_or_else(|| self.next_label(mode));
        let from = self.network.nodes[nodes.first().unwrap()].name.clone();
        let to = self.network.nodes[nodes.last().unwrap()].name.clone();
        self.network.lines.insert(
            id,
            Line {
                construction_started_year: None,
                id,
                name: format!("{from} – {to}"),
                label,
                mode,
                color: color.unwrap_or_else(|| default_color(mode)),
                source: Source::User,
                edges,
                service: ServicePattern::default_for(mode),
                included: true,
                extends: None,
                note: String::new(),
                official_opening_year: None,
                official_cost_eur: None,
                external_id: None,
            },
        );
        diff.lines_changed.push(id);
        Ok(diff.dedup())
    }

    fn next_label(&self, mode: Mode) -> String {
        let prefix = match mode {
            Mode::Ubahn => "U",
            Mode::Sbahn => "S",
            Mode::Tram => "T",
            Mode::Regional => "R",
        };
        for i in 1..100 {
            let candidate = format!("{prefix}{i}");
            if !self.network.lines.values().any(|l| l.label == candidate) {
                return candidate;
            }
        }
        format!("{prefix}?")
    }

    fn extend_line(
        &mut self,
        line: LineId,
        end: End,
        points: Vec<LatLon>,
        auto_stations: bool,
        anchors: Option<Vec<LatLon>>,
    ) -> Result<Diff, EditError> {
        let l = self
            .network
            .line(line)
            .ok_or(EditError::UnknownLine(line))?
            .clone();
        let (start, finish) = self
            .network
            .line_endpoints(line)
            .ok_or(EditError::UnknownLine(line))?;
        let anchor = match end {
            End::Start => start,
            End::Finish => finish,
        };

        // Continuing an end that already has an extension.
        //
        // The parent keeps its own endpoints when an extension is split off, so
        // this end still looks free. Pointing at it a second time would hang a
        // second extension off the same node: a fork where the user meant to
        // carry on, and two entries in the list for one stretch of track.
        if self.network.line(line).map(|l| l.source) != Some(Source::User) {
            let parent = self.network.line(line).and_then(|l| l.extends).unwrap_or(line);
            let existing = self.network.lines.values().find_map(|c| {
                if c.extends != Some(parent) || c.id == line {
                    return None;
                }
                let (a, b) = self.network.line_endpoints(c.id)?;
                if a == anchor {
                    Some((c.id, End::Finish))
                } else if b == anchor {
                    Some((c.id, End::Start))
                } else {
                    None
                }
            });
            if let Some((continued, far)) = existing {
                return self.extend_line(continued, far, points, auto_stations, anchors);
            }
        }
        let anchor_geo = self
            .network
            .nodes
            .get(&anchor)
            .ok_or(EditError::UnknownNode(anchor))?
            .geo;
        let mut corridor: Vec<Point> = vec![anchor_geo.to_metric()];
        corridor.extend(points.iter().map(|p| p.to_metric()));
        corridor.dedup_by(|a, b| a.distance_to(b) < 1.0);
        let anchors: Vec<Point> = anchors
            .unwrap_or_default()
            .iter()
            .map(|p| p.to_metric())
            .collect();
        let (_, new_edges, mut diff) = self.materialise(
            &corridor,
            l.mode,
            None,
            auto_stations,
            Some(anchor),
            &anchors,
        )?;

        // Growing your own line, or continuing somebody else's?
        //
        // Your own simply grows: that is what drawing more of it means, and a
        // chain of separate objects for one line nobody else has touched would
        // be bookkeeping for its own sake.
        //
        // An existing line is different. Appending to it made the new track
        // part of the Bestand — indistinguishable from what already runs, not
        // listed among the things you drew, and impossible to switch off to see
        // what it was worth. So it becomes a line of its own that continues the
        // parent, which is also what it is in the world: the same service, one
        // stretch of it not built yet.
        if self.network.line(line).map(|l| l.source) == Some(Source::User) {
            let l = self
                .network
                .lines
                .get_mut(&line)
                .ok_or(EditError::UnknownLine(line))?;
            match end {
                End::Start => {
                    let mut e = new_edges;
                    e.reverse();
                    e.extend(l.edges.iter().copied());
                    l.edges = e;
                }
                End::Finish => l.edges.extend(new_edges),
            }
            diff.lines_changed.push(line);
            self.rename_line_from_endpoints(line);
            return Ok(diff.dedup());
        }

        // An extension of an extension keeps the same parent, so a route stays
        // one service however many times it is continued.
        let parent = l.extends.unwrap_or(line);
        let mut edges = new_edges;
        if matches!(end, End::Start) {
            edges.reverse();
        }
        let id = LineId(self.network.fresh_id());
        let parent_label = self
            .network
            .line(parent)
            .map(|p| p.label.clone())
            .unwrap_or_else(|| l.label.clone());
        self.network.lines.insert(
            id,
            Line {
                construction_started_year: None,
                id,
                // Named below, once the line exists and its far end can be
                // asked for rather than guessed at.
                name: format!("{parent_label}-Verlängerung"),
                // The parent's designation and colour, because on the map this
                // is that line continuing, not a new one beside it.
                label: parent_label,
                mode: l.mode,
                color: l.color.clone(),
                source: Source::User,
                edges,
                service: l.service.clone(),
                included: true,
                extends: Some(parent),
                note: String::new(),
                official_opening_year: None,
                official_cost_eur: None,
                external_id: None,
            },
        );
        // Where it goes, taken from the finished line.
        //
        // Reading it off the last edge's `to` was wrong: edges are undirected,
        // and one stored as (far, anchor) named the extension after the station
        // it starts from. "U3-Verlängerung nach Wandsbek-Gartenstadt" for a line
        // that leaves Wandsbek-Gartenstadt is worse than no name at all.
        let terminus = self
            .network
            .line_endpoints(id)
            .map(|(a, b)| if a == anchor { b } else { a })
            .and_then(|n| self.network.nodes.get(&n))
            .map(|n| n.name.clone())
            .filter(|n| !n.trim().is_empty());
        if let Some(terminus) = terminus {
            if let Some(l) = self.network.lines.get_mut(&id) {
                l.name = format!("{}-Verlängerung nach {terminus}", l.label);
            }
        }

        diff.lines_changed.push(id);
        Ok(diff.dedup())
    }

    fn rename_line_from_endpoints(&mut self, line: LineId) {
        if let Some((a, b)) = self.network.line_endpoints(line) {
            let (na, nb) = (
                self.network.nodes.get(&a).map(|n| n.name.clone()),
                self.network.nodes.get(&b).map(|n| n.name.clone()),
            );
            if let (Some(na), Some(nb)) = (na, nb) {
                if let Some(l) = self.network.lines.get_mut(&line) {
                    l.name = format!("{na} – {nb}");
                }
            }
        }
    }

    fn shorten_line(&mut self, line: LineId, end: End, count: usize) -> Result<Diff, EditError> {
        let l = self
            .network
            .line(line)
            .ok_or(EditError::UnknownLine(line))?
            .clone();
        if l.edges.len() <= count {
            return Err(EditError::Invalid("Die Linie wäre danach zu kurz".into()));
        }
        let removed: Vec<EdgeId> = match end {
            End::Start => l.edges[..count].to_vec(),
            End::Finish => l.edges[l.edges.len() - count..].to_vec(),
        };
        let keep: Vec<EdgeId> = match end {
            End::Start => l.edges[count..].to_vec(),
            End::Finish => l.edges[..l.edges.len() - count].to_vec(),
        };
        self.network.lines.get_mut(&line).unwrap().edges = keep;

        let mut diff = Diff {
            lines_changed: vec![line],
            ..Default::default()
        };
        for e in removed {
            // Only drop track no other line needs.
            if self.network.lines_on_edge(e).is_empty() {
                self.network.edges.remove(&e);
                diff.edges_removed.push(e);
            }
        }
        diff.nodes_removed = self.network.prune_orphan_nodes();
        self.rename_line_from_endpoints(line);
        Ok(diff.dedup())
    }

    fn split_edge(
        &mut self,
        edge: EdgeId,
        along_m: f64,
        name: Option<String>,
    ) -> Result<Diff, EditError> {
        let e = self
            .network
            .edge(edge)
            .ok_or(EditError::UnknownEdge(edge))?
            .clone();
        let pts: Vec<Point> = e.geo.iter().map(|p| p.to_metric()).collect();
        let total = polyline_length(&pts);
        if along_m <= 20.0 || along_m >= total - 20.0 {
            return Err(EditError::Invalid(
                "Der Teilungspunkt liegt zu nah am Ende".into(),
            ));
        }
        let (head, tail) = split_polyline(&pts, along_m);
        let cut = point_at_distance(&pts, along_m);
        let station_name =
            name.unwrap_or_else(|| stations::name_for(cut, &self.city, &self.params.stations));
        let depth = StationDepth::for_infrastructure(e.infrastructure);
        let mid = self.new_node(cut.to_latlon(), station_name, NodeKind::Station, depth);

        let a = self.new_edge(
            e.from,
            mid,
            e.mode,
            e.infrastructure,
            crate::geo::to_geo(&head),
        );
        let b = self.new_edge(
            mid,
            e.to,
            e.mode,
            e.infrastructure,
            crate::geo::to_geo(&tail),
        );
        for id in [a, b] {
            if let Some(x) = self.network.edges.get_mut(&id) {
                x.status = e.status;
                x.source = e.source;
                x.tracks = e.tracks;
                x.design_speed_kmh = e.design_speed_kmh;
            }
        }

        let mut diff = Diff {
            nodes_changed: vec![mid],
            edges_changed: vec![a, b],
            edges_removed: vec![edge],
            ..Default::default()
        };
        // Every line using the old edge now uses both halves, in order.
        let users = self.network.lines_on_edge(edge);
        for lid in users {
            let nodes = self.network.line_nodes(lid);
            let l = self.network.lines.get_mut(&lid).unwrap();
            let pos = l.edges.iter().position(|x| *x == edge).unwrap();
            let forward = nodes.get(pos).copied() == Some(e.from);
            let replacement = if forward { [a, b] } else { [b, a] };
            l.edges.splice(pos..=pos, replacement);
            diff.lines_changed.push(lid);
        }
        self.network.edges.remove(&edge);
        Ok(diff.dedup())
    }

    /// Remove a station in whatever way its surroundings allow.
    fn remove_station(&mut self, node: NodeId) -> Result<Diff, EditError> {
        let n = self
            .network
            .nodes
            .get(&node)
            .ok_or(EditError::UnknownNode(node))?
            .clone();
        // Only track that is part of *this scenario* counts. A stop that also
        // sits on a switched-off proposal is still an ordinary stop of the line
        // you are editing, and refusing to remove it — with an error naming
        // lines that are not even on the map — is nonsense.
        let active: std::collections::BTreeSet<EdgeId> =
            self.network.active_edges().into_iter().collect();
        let touching: Vec<EdgeId> = self
            .network
            .edges_at(node)
            .into_iter()
            .filter(|e| active.contains(e))
            .collect();
        let removable: Vec<EdgeId> = touching
            .iter()
            .copied()
            .filter(|e| {
                self.network
                    .edges
                    .get(e)
                    .map(|e| e.status != BuildStatus::InService)
                    .unwrap_or(false)
            })
            .collect();

        if touching.is_empty() {
            self.network.nodes.remove(&node);
            return Ok(Diff {
                nodes_removed: vec![node],
                ..Default::default()
            });
        }
        if removable.is_empty() {
            return Err(EditError::Invalid(format!(
                "„{}“ gehört zum Bestandsnetz und lässt sich nicht entfernen.",
                n.name
            )));
        }
        // A terminus: drop its last segment and the station goes with it.
        if touching.len() == 1 {
            return self.delete_edge(touching[0]);
        }
        if touching.len() == 2 {
            return self.merge_at_node(node);
        }
        let services = self.network.services_at_node(node);
        Err(EditError::Invalid(format!(
            "An „{}“ treffen {} Abschnitte zusammen ({}). Entferne zuerst eine der Linien.",
            n.name,
            touching.len(),
            services
                .iter()
                .map(|(l, _)| l.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )))
    }

    fn merge_at_node(&mut self, node: NodeId) -> Result<Diff, EditError> {
        // Same rule as `remove_station`: track belonging to a line that is
        // switched off in this scenario is not in the way.
        let active: std::collections::BTreeSet<EdgeId> =
            self.network.active_edges().into_iter().collect();
        let touching: Vec<EdgeId> = self
            .network
            .edges_at(node)
            .into_iter()
            .filter(|e| active.contains(e))
            .collect();
        if touching.len() != 2 {
            return Err(EditError::Invalid(
                "Nur ein Knoten mit genau zwei Abschnitten kann entfernt werden".into(),
            ));
        }
        let (e1, e2) = (
            self.network.edges[&touching[0]].clone(),
            self.network.edges[&touching[1]].clone(),
        );
        if e1.mode != e2.mode {
            return Err(EditError::Invalid(
                "Die beiden Abschnitte gehören zu verschiedenen Verkehrsmitteln.".into(),
            ));
        }
        let outer1 = e1.other_end(node).ok_or(EditError::UnknownNode(node))?;
        let outer2 = e2.other_end(node).ok_or(EditError::UnknownNode(node))?;

        let mut geo1 = e1.geo.clone();
        if e1.to != node {
            geo1.reverse();
        }
        let mut geo2 = e2.geo.clone();
        if e2.from != node {
            geo2.reverse();
        }
        geo1.extend(geo2.into_iter().skip(1));

        // Where the two differ, the more demanding construction type wins: a
        // merged section is not cheaper than its harder half.
        let infra =
            if station_depth_rank(e1.infrastructure) >= station_depth_rank(e2.infrastructure) {
                e1.infrastructure
            } else {
                e2.infrastructure
            };
        let merged = self.new_edge(outer1, outer2, e1.mode, infra, geo1);
        if let Some(x) = self.network.edges.get_mut(&merged) {
            x.status = if e1.status == e2.status {
                e1.status
            } else {
                BuildStatus::ToBuild
            };
            x.source = e1.source;
            x.tracks = e1.tracks.min(e2.tracks);
            x.design_speed_kmh = e1.design_speed_kmh.min(e2.design_speed_kmh);
        }

        let mut diff = Diff {
            edges_changed: vec![merged],
            edges_removed: vec![e1.id, e2.id],
            nodes_removed: vec![node],
            ..Default::default()
        };
        let lids: Vec<LineId> = self.network.lines.values().map(|l| l.id).collect();
        for lid in lids {
            let l = self.network.lines.get_mut(&lid).unwrap();
            if !l.edges.contains(&e1.id) && !l.edges.contains(&e2.id) {
                continue;
            }
            let mut out: Vec<EdgeId> = Vec::new();
            let mut inserted = false;
            for e in &l.edges {
                if *e == e1.id || *e == e2.id {
                    if !inserted {
                        out.push(merged);
                        inserted = true;
                    }
                } else {
                    out.push(*e);
                }
            }
            l.edges = out;
            diff.lines_changed.push(lid);
        }
        self.network.edges.remove(&e1.id);
        self.network.edges.remove(&e2.id);
        // The node only goes if nothing else still ends there. A stop that a
        // switched-off proposal also uses stays on the map for that proposal —
        // removing it would leave that line's track pointing at nothing.
        if self.network.edges_at(node).is_empty() {
            self.network.nodes.remove(&node);
        } else {
            diff.nodes_removed.retain(|n| *n != node);
            diff.nodes_changed.push(node);
        }
        Ok(diff.dedup())
    }

    fn move_node(&mut self, node: NodeId, to: LatLon) -> Result<Diff, EditError> {
        let grid = self.params.geometry.grid_size_m;
        {
            let n = self
                .network
                .nodes
                .get_mut(&node)
                .ok_or(EditError::UnknownNode(node))?;
            n.geo = to;
            n.schematic = snap_to_grid(to.to_metric(), grid * 0.25);
        }
        let touching = self.network.edges_at(node);
        for id in &touching {
            let e = self.network.edges.get_mut(id).unwrap();
            if e.from == node {
                e.geo[0] = to;
                e.schematic[0] = to.to_metric();
            }
            if e.to == node {
                let last = e.geo.len() - 1;
                e.geo[last] = to;
                e.schematic[last] = to.to_metric();
            }
            e.recompute_length();
        }
        Ok(Diff {
            nodes_changed: vec![node],
            edges_changed: touching,
            ..Default::default()
        })
    }

    fn delete_edge(&mut self, edge: EdgeId) -> Result<Diff, EditError> {
        if !self.network.edges.contains_key(&edge) {
            return Err(EditError::UnknownEdge(edge));
        }
        let mut diff = Diff {
            edges_removed: vec![edge],
            ..Default::default()
        };
        let lids: Vec<LineId> = self.network.lines.values().map(|l| l.id).collect();
        for lid in lids {
            let l = self.network.lines.get_mut(&lid).unwrap();
            if !l.edges.contains(&edge) {
                continue;
            }
            l.edges.retain(|e| *e != edge);
            diff.lines_changed.push(lid);
        }
        self.network.edges.remove(&edge);
        // A line that lost all its track disappears with it.
        let empty: Vec<LineId> = self
            .network
            .lines
            .values()
            .filter(|l| l.edges.is_empty())
            .map(|l| l.id)
            .collect();
        for l in empty {
            self.network.lines.remove(&l);
            diff.lines_removed.push(l);
        }
        diff.nodes_removed = self.network.prune_orphan_nodes();
        Ok(diff.dedup())
    }

    fn delete_line(&mut self, line: LineId) -> Result<Diff, EditError> {
        let l = self
            .network
            .lines
            .remove(&line)
            .ok_or(EditError::UnknownLine(line))?;
        let mut diff = Diff {
            lines_removed: vec![line],
            ..Default::default()
        };
        for e in l.edges {
            if self.network.lines_on_edge(e).is_empty() {
                self.network.edges.remove(&e);
                diff.edges_removed.push(e);
            }
        }
        diff.nodes_removed = self.network.prune_orphan_nodes();
        Ok(diff.dedup())
    }

    fn connect_nodes(
        &mut self,
        a: NodeId,
        b: NodeId,
        mode: Mode,
        infrastructure: Option<Infrastructure>,
    ) -> Result<Diff, EditError> {
        if a == b {
            return Err(EditError::Invalid(
                "Ein Knoten kann nicht mit sich selbst verbunden werden".into(),
            ));
        }
        let ga = self
            .network
            .nodes
            .get(&a)
            .ok_or(EditError::UnknownNode(a))?
            .geo;
        let gb = self
            .network
            .nodes
            .get(&b)
            .ok_or(EditError::UnknownNode(b))?
            .geo;
        // Distinct nodes, same place: there is no track to build between them.
        // Two stations can share a point when a curated project names a stop
        // that already exists under another name — Berlin's Ostkreuz, where the
        // tram project's stop sits on the merged station to the metre. Creating
        // the edge anyway produced a zero-length section, which the network's
        // own validation refuses, and the city then failed to import at all.
        if ga.to_metric().distance_to(&gb.to_metric()) < 1.0 {
            return Err(EditError::Invalid(
                "Diese beiden Halte liegen an derselben Stelle".into(),
            ));
        }
        let infra = infrastructure.unwrap_or_else(|| Infrastructure::default_for(mode));
        let id = self.new_edge(a, b, mode, infra, vec![ga, gb]);
        for n in [a, b] {
            if let Some(node) = self.network.nodes.get_mut(&n) {
                node.interchange = true;
            }
        }
        Ok(Diff {
            edges_changed: vec![id],
            nodes_changed: vec![a, b],
            ..Default::default()
        })
    }

    fn regenerate_stations(&mut self, line: LineId) -> Result<Diff, EditError> {
        let l = self
            .network
            .line(line)
            .ok_or(EditError::UnknownLine(line))?
            .clone();
        let corridor: Vec<Point> = self
            .network
            .line_geometry(line)
            .iter()
            .map(|p| p.to_metric())
            .collect();
        if corridor.len() < 2 {
            return Err(EditError::TooFewPoints);
        }
        let infra = l
            .edges
            .first()
            .and_then(|e| self.network.edges.get(e))
            .map(|e| e.infrastructure);

        // Drop the old track (keeping anything another line still uses) and lay
        // the corridor out again.
        let mut diff = self.delete_line(line)?;
        let (_, edges, sub) = self.materialise(&corridor, l.mode, infra, true, None, &[])?;
        diff.merge(sub);
        let id = LineId(self.network.fresh_id());
        self.network.lines.insert(id, Line { id, edges, ..l });
        diff.lines_changed.push(id);
        Ok(diff.dedup())
    }
}

/// How demanding a construction type is, for choosing between two.
fn station_depth_rank(i: Infrastructure) -> u8 {
    StationDepth::for_infrastructure(i).rank()
}

/// Fillet a drawn corridor with the tightest radius the mode can run.
pub fn round_corridor(points: &[Point], mode: Mode, params: &Params) -> Vec<Point> {
    let radius =
        params.feasibility.min_curve_radius_m.get(mode) * params.geometry.corner_radius_factor;
    crate::geo::round_corners(points, radius, params.geometry.corner_deviation_m, 7.0)
}

/// Fillet a corridor whose stations are already fixed.
///
/// A fillet cuts the corner, moving the alignment up to `corner_deviation_m`
/// off the original vertex. Where that vertex is a station, the track ends up
/// beside the platform and the line looks broken — which is exactly what the
/// U5 did between Sengelmannstraße and City Nord. Real alignments curve
/// *between* stops and run straight through them, so the corridor is cut at
/// every station and each piece filleted on its own.
pub fn round_corridor_through(
    points: &[Point],
    stops: &[Point],
    mode: Mode,
    params: &Params,
) -> Vec<Point> {
    if points.len() < 3 || stops.is_empty() {
        return round_corridor(points, mode, params);
    }
    let total = polyline_length(points);
    let mut cuts: Vec<f64> = stops
        .iter()
        .filter_map(|s| crate::geo::project_on_polyline(*s, points))
        .map(|pr| pr.along)
        .filter(|a| *a > 1.0 && *a < total - 1.0)
        .collect();
    cuts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    cuts.dedup_by(|a, b| (*a - *b).abs() < 1.0);

    let mut out: Vec<Point> = Vec::new();
    let mut last = 0.0;
    for cut in cuts.iter().copied().chain(std::iter::once(total)) {
        let (_, tail) = split_polyline(points, last);
        let (piece, _) = split_polyline(&tail, (cut - last).max(1.0));
        let rounded = round_corridor(&piece, mode, params);
        // The joins are the station positions themselves, so drop the
        // duplicated first vertex of every piece after the first.
        let start = usize::from(!out.is_empty());
        out.extend_from_slice(&rounded[start.min(rounded.len())..]);
        last = cut;
    }
    // The joins between the pieces are the stations themselves, and they are
    // still sharp. Real track does curve near a platform — just not by much,
    // because the platform has to stay on the alignment. A second, tightly
    // capped pass gives those corners a radius without moving the track off
    // the station.
    let radius =
        params.feasibility.min_curve_radius_m.get(mode) * params.geometry.corner_radius_factor;
    crate::geo::round_corners(
        &out,
        radius,
        params.geometry.station_corner_deviation_m,
        7.0,
    )
}

/// Cut the piece of `corridor` between two along-distances.
fn slice_corridor(corridor: &[Point], from_m: f64, to_m: f64) -> Vec<LatLon> {
    let (_, tail) = split_polyline(corridor, from_m);
    let (piece, _) = split_polyline(&tail, (to_m - from_m).max(1.0));
    let mut pts = piece;
    pts.dedup_by(|a, b| a.distance_to(b) < 0.5);
    if pts.len() < 2 {
        pts = vec![
            point_at_distance(corridor, from_m),
            point_at_distance(corridor, to_m),
        ];
    }
    crate::geo::to_geo(&pts)
}

/// Compute the patch list that turns `after` back into `before`.
fn invert(before: &Network, after: &Network) -> Vec<Patch> {
    let mut out = Vec::new();
    for (id, n) in &before.nodes {
        if after.nodes.get(id) != Some(n) {
            out.push(Patch::PutNode(n.clone()));
        }
    }
    for id in after.nodes.keys() {
        if !before.nodes.contains_key(id) {
            out.push(Patch::DelNode(*id));
        }
    }
    for (id, e) in &before.edges {
        if after.edges.get(id) != Some(e) {
            out.push(Patch::PutEdge(e.clone()));
        }
    }
    for id in after.edges.keys() {
        if !before.edges.contains_key(id) {
            out.push(Patch::DelEdge(*id));
        }
    }
    for (id, l) in &before.lines {
        if after.lines.get(id) != Some(l) {
            out.push(Patch::PutLine(l.clone()));
        }
    }
    for id in after.lines.keys() {
        if !before.lines.contains_key(id) {
            out.push(Patch::DelLine(*id));
        }
    }
    if before.next_id != after.next_id {
        out.push(Patch::SetNextId(before.next_id));
    }
    out
}

fn default_color(mode: Mode) -> String {
    match mode {
        Mode::Ubahn => "#2563EB",
        Mode::Sbahn => "#16A34A",
        Mode::Tram => "#DB2777",
        Mode::Regional => "#64748B",
    }
    .into()
}

/// The construction type a section would plausibly need, from the ground it
/// crosses: water, built-up density, and whether a rail corridor is already
/// there.
///
/// Free-standing rather than a method, because the importer needs the same
/// answer. A curated project whose construction method has not been published
/// should get this rather than an invented one — putting a method in the file
/// by hand would make the comparison column say something nobody claimed.
pub fn choose_infrastructure(
    city: &CityData,
    params: &Params,
    geo: &[LatLon],
    mode: Mode,
) -> Infrastructure {
        let pts: Vec<Point> = geo.iter().map(|p| p.to_metric()).collect();
        let len = polyline_length(&pts).max(1.0);
        let wet = city.water_crossing_length(&pts);
        let density = city.density_index(&pts);
        let f = &params.feasibility;
        // A crossing worth its own structure, rather than a canal clipped at
        // an angle. Whether it is bridged or tunnelled depends on what the
        // line is doing either side: under the dense city it stays under the
        // water too, out in the country it goes over — nobody bores under
        // every marshland canal.
        let crosses_water = wet > 40.0;
        // A wide crossing is a different problem from a canal: the Elbe is
        // several hundred metres of water and gets bored under, the Dove Elbe
        // out in the marshes gets a bridge like every road there has.
        let wide_water = city.crosses_major_water(&pts) && wet > 150.0;
        let _ = len;
        let underground = density > f.surface_density_limit;

        match mode {
            Mode::Tram => {
                if crosses_water {
                    Infrastructure::Bridge
                } else {
                    Infrastructure::TramReserved
                }
            }
            Mode::Ubahn => {
                if wide_water || (crosses_water && underground) {
                    Infrastructure::DeepTunnel
                } else if crosses_water {
                    Infrastructure::Bridge
                } else if density > f.surface_density_blocking {
                    Infrastructure::DeepTunnel
                } else if underground {
                    Infrastructure::CutAndCover
                } else {
                    Infrastructure::Elevated
                }
            }
            Mode::Sbahn | Mode::Regional => {
                let in_corridor = city.rail_corridor_share(&pts, f.rail_corridor_radius_m);
                if wide_water || (crosses_water && underground) {
                    Infrastructure::DeepTunnel
                } else if crosses_water {
                    Infrastructure::Bridge
                } else if in_corridor > 0.6 {
                    // Alongside an existing railway — the S4's own answer.
                    Infrastructure::Surface
                } else if density > f.surface_density_blocking {
                    Infrastructure::DeepTunnel
                } else if underground {
                    Infrastructure::CutAndCover
                } else {
                    Infrastructure::Surface
                }
            }
        }
    }

/// Remove the transitions a railway cannot actually build.
///
/// The construction type is chosen section by section from the ground, which is
/// right, but the sections are not independent: a metro does not climb out of a
/// bored tunnel onto a viaduct and dive straight back in. The ramp alone is
/// longer than such a stretch, and the two portals cost more than the saving.
///
/// So a run of elevated sections *enclosed* by tunnel becomes cut-and-cover —
/// still the cheaper of the two underground methods. Enclosed is the whole
/// rule: a metro that leaves the dense city and stays up until its terminus is
/// doing the ordinary thing, and an earlier version of this that converted any
/// elevated section merely *touching* a tunnel put the entire line underground,
/// one section at a time. `ends_in_tunnel` says whether the line joins existing
/// tunnel at each end — Berlin's U8 extension leaves the underground station at
/// Wittenau, so its first section is enclosed even though it is the first.
///
/// Water keeps whatever structure it needs, and the rule is for metros only: a
/// suburban railway that runs on the surface and dives once is normal.
pub fn settle_ramps(
    kinds: &mut [Infrastructure],
    wet: &[bool],
    mode: Mode,
    ends_in_tunnel: [bool; 2],
) {
    if mode != Mode::Ubahn || kinds.is_empty() {
        return;
    }
    let tunnelled =
        |k: Infrastructure| matches!(k, Infrastructure::DeepTunnel | Infrastructure::CutAndCover);
    let mut i = 0;
    while i < kinds.len() {
        if kinds[i] != Infrastructure::Elevated {
            i += 1;
            continue;
        }
        let start = i;
        while i < kinds.len() && kinds[i] == Infrastructure::Elevated {
            i += 1;
        }
        let before = if start == 0 {
            ends_in_tunnel[0]
        } else {
            tunnelled(kinds[start - 1])
        };
        let after = if i == kinds.len() {
            ends_in_tunnel[1]
        } else {
            tunnelled(kinds[i])
        };
        if before && after {
            for k in kinds.iter_mut().take(i).skip(start) {
                if !wet.get(start).copied().unwrap_or(false) {
                    *k = Infrastructure::CutAndCover;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{demo_city, demo_network};

    fn editor() -> Editor {
        Editor::new(demo_network(), demo_city(), Params::default())
    }

    fn pts(v: &[(f64, f64)]) -> Vec<LatLon> {
        v.iter()
            .map(|(x, y)| Point::new(*x, *y).to_latlon())
            .collect()
    }

    #[test]
    fn a_drawn_corner_comes_out_rounded() {
        let mut ed = editor();
        let diff = ed
            .apply(Command::DrawLine {
                mode: Mode::Ubahn,
                infrastructure: None,
                // A hard right angle.
                points: pts(&[(-6000.0, 9000.0), (0.0, 9000.0), (0.0, 15000.0)]),
                label: Some("U9".into()),
                color: None,
                auto_stations: true,
                anchors: None,
            })
            .unwrap();
        let line = diff.lines_changed[0];
        let geo: Vec<Point> = ed
            .network
            .line_geometry(line)
            .iter()
            .map(|p| p.to_metric())
            .collect();
        let sharpest = geo
            .windows(3)
            .map(|w| crate::geo::corner_angle(w[0], w[1], w[2]))
            .fold(180.0_f64, f64::min);
        assert!(
            sharpest > 140.0,
            "the alignment still has a {sharpest}° corner"
        );
        // Every station must sit on the alignment, not beside it.
        for n in ed.network.line_nodes(line) {
            let p = ed.network.nodes[&n].geo.to_metric();
            let d = crate::geo::project_on_polyline(p, &geo).unwrap().distance;
            assert!(
                d < 2.0,
                "station {} sits {d:.0} m off the track",
                ed.network.nodes[&n].name
            );
        }
    }

    #[test]
    fn track_ends_exactly_at_every_station() {
        // Drawing past an existing station reuses it, and that station keeps its
        // own position — the alignment has to meet it.
        let mut ed = editor();
        let n = ed
            .network
            .nodes
            .values()
            .find(|n| n.kind == NodeKind::Station)
            .unwrap()
            .clone();
        let p = n.geo.to_metric();
        let diff = ed
            .apply(Command::DrawLine {
                mode: Mode::Ubahn,
                infrastructure: None,
                // Deliberately offset so the corridor passes beside the station.
                points: pts(&[(p.x - 7000.0, p.y + 180.0), (p.x + 7000.0, p.y + 180.0)]),
                label: Some("U9".into()),
                color: None,
                auto_stations: true,
                anchors: None,
            })
            .unwrap();
        let line = diff.lines_changed[0];
        let nodes = ed.network.line_nodes(line);
        for (i, eid) in ed.network.lines[&line].edges.iter().enumerate() {
            let e = &ed.network.edges[eid];
            let (a, b) = (nodes[i], nodes[i + 1]);
            let ends = [*e.geo.first().unwrap(), *e.geo.last().unwrap()];
            for node in [a, b] {
                let g = ed.network.nodes[&node].geo;
                let d = ends
                    .iter()
                    .map(|p| p.distance_to(&g))
                    .fold(f64::INFINITY, f64::min);
                assert!(
                    d < 1.0,
                    "edge {eid} ends {d:.0} m from station {}",
                    ed.network.nodes[&node].name
                );
            }
        }
    }

    #[test]
    fn a_line_can_be_closed_into_a_ring() {
        let mut ed = editor();
        let diff = ed
            .apply(Command::DrawLine {
                mode: Mode::Ubahn,
                infrastructure: None,
                points: pts(&[
                    (0.0, 12000.0),
                    (5000.0, 12000.0),
                    (5000.0, 17000.0),
                    (0.0, 17000.0),
                    (0.0, 12000.0),
                ]),
                label: Some("U0".into()),
                color: None,
                auto_stations: true,
                anchors: None,
            })
            .expect("a ring must be drawable");
        let line = diff.lines_changed[0];
        let nodes = ed.network.line_nodes(line);
        assert!(nodes.len() > 4, "only {} stations on the ring", nodes.len());
        assert_eq!(nodes.first(), nodes.last(), "the ring must close on itself");
        assert!(
            ed.network.validate().is_empty(),
            "{:?}",
            ed.network.validate()
        );
    }

    #[test]
    fn drawing_onto_an_existing_station_joins_the_network() {
        let mut ed = editor();
        let target = ed
            .network
            .nodes
            .values()
            .find(|n| n.kind == NodeKind::Station && ed.network.edges_at(n.id).len() == 1)
            .unwrap()
            .clone();
        let p = target.geo.to_metric();
        let before = ed.network.edges_at(target.id).len();
        ed.apply(Command::DrawLine {
            mode: Mode::Ubahn,
            infrastructure: None,
            points: pts(&[(p.x, p.y + 9000.0), (p.x, p.y)]),
            label: Some("U9".into()),
            color: None,
            auto_stations: true,
            anchors: None,
        })
        .unwrap();
        assert!(
            ed.network.edges_at(target.id).len() > before,
            "the new line did not attach to the existing station"
        );
        assert!(
            ed.network.services_at_node(target.id).len() > 1,
            "no interchange formed"
        );
    }

    #[test]
    fn extending_twice_keeps_growing_the_same_extension() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        let before = ed.network.lines.len();
        // Both times pointing at the same end of the same existing line, which
        // is what someone does who is drawing one route outwards. The parent
        // keeps its own endpoints, so that end still looks free; without the
        // check for an extension already hanging there, the second click made a
        // fork and a second entry in the list for one stretch of track.
        for step in 1..=2 {
            let (_, finish) = ed.network.line_endpoints(line).unwrap();
            let end = ed.network.nodes[&finish].geo.to_metric();
            ed.apply(Command::ExtendLine {
                line,
                end: End::Finish,
                points: pts(&[(end.x + 3000.0 * step as f64, end.y + 1200.0 * step as f64)]),
                auto_stations: true,
                anchors: None,
            })
            .unwrap_or_else(|e| panic!("extension {step} failed: {e}"));
            assert_eq!(
                ed.network.lines.len(),
                before + 1,
                "extension {step} produced a second line instead of continuing the first"
            );
            let ext = ed
                .network
                .lines
                .values()
                .find(|l| l.extends == Some(line))
                .expect("no extension");
            let nodes = ed.network.line_nodes(ext.id);
            assert_eq!(
                nodes.len(),
                ext.edges.len() + 1,
                "the path broke after extension {step}"
            );
        }
        let ext = ed
            .network
            .lines
            .values()
            .find(|l| l.extends == Some(line))
            .unwrap();
        assert!(
            ext.edges.len() >= 2,
            "the second extension did not lengthen the first"
        );
    }

    #[test]
    fn drawing_a_line_creates_stations_and_edges() {
        let mut ed = editor();
        let before_lines = ed.network.lines.len();
        let diff = ed
            .apply(Command::DrawLine {
                mode: Mode::Ubahn,
                infrastructure: None,
                points: pts(&[(0.0, 6000.0), (7000.0, 6000.0)]),
                label: None,
                color: None,
                auto_stations: true,
                anchors: None,
            })
            .unwrap();
        assert_eq!(ed.network.lines.len(), before_lines + 1);
        assert!(diff.edges_changed.len() >= 3, "expected several segments");
        assert_eq!(diff.lines_changed.len(), 1);
        let l = ed.network.lines[&diff.lines_changed[0]].clone();
        assert_eq!(l.mode, Mode::Ubahn);
        assert!(ed.network.line_nodes(l.id).len() == l.edges.len() + 1);
        assert!(ed.network.validate().is_empty());
    }

    #[test]
    fn undo_restores_the_previous_state_exactly() {
        let mut ed = editor();
        let snapshot = ed.network.clone();
        ed.apply(Command::DrawLine {
            mode: Mode::Tram,
            infrastructure: None,
            points: pts(&[(0.0, -4000.0), (3000.0, -4000.0)]),
            label: None,
            color: None,
            auto_stations: true,
            anchors: None,
        })
        .unwrap();
        assert_ne!(ed.network, snapshot);
        ed.undo().unwrap();
        assert_eq!(
            ed.network, snapshot,
            "undo must restore the exact prior state"
        );
        ed.redo().unwrap();
        assert_ne!(ed.network, snapshot);
        ed.undo().unwrap();
        assert_eq!(ed.network, snapshot);
    }

    #[test]
    fn undo_redo_survives_a_long_session() {
        let mut ed = editor();
        let snapshot = ed.network.clone();
        for i in 0..6 {
            let y = -8000.0 + i as f64 * 900.0;
            ed.apply(Command::DrawLine {
                mode: Mode::Tram,
                infrastructure: None,
                points: pts(&[(0.0, y), (2600.0, y)]),
                label: None,
                color: None,
                auto_stations: true,
                anchors: None,
            })
            .unwrap();
        }
        for _ in 0..6 {
            ed.undo().unwrap();
        }
        assert_eq!(ed.network, snapshot);
        assert!(!ed.can_undo());
        for _ in 0..6 {
            ed.redo().unwrap();
        }
        assert_eq!(ed.network.lines.len(), snapshot.lines.len() + 6);
    }

    #[test]
    fn extending_a_line_keeps_the_path_connected() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        let (_, finish) = ed.network.line_endpoints(line).unwrap();
        let end = ed.network.nodes[&finish].geo.to_metric();
        let before = ed.network.lines[&line].edges.len();
        ed.apply(Command::ExtendLine {
            line,
            end: End::Finish,
            points: pts(&[(end.x + 3500.0, end.y + 500.0)]),
            auto_stations: true,
            anchors: None,
        })
        .unwrap();
        // The existing line is left alone; the new track is a line of its own.
        assert_eq!(ed.network.lines[&line].edges.len(), before);
        let ext = ed
            .network
            .lines
            .values()
            .find(|l| l.extends == Some(line))
            .expect("no extension was created");
        assert_eq!(ext.source, Source::User, "an extension is the author's work");
        assert!(ext.included, "an extension arrives switched on");

        // It has to be a path, and it has to start where the parent stopped.
        let nodes = ed.network.line_nodes(ext.id);
        assert_eq!(nodes.len(), ext.edges.len() + 1);
        for (i, eid) in ext.edges.iter().enumerate() {
            let e = &ed.network.edges[eid];
            let (a, b) = (nodes[i], nodes[i + 1]);
            assert!(
                (e.from == a && e.to == b) || (e.from == b && e.to == a),
                "break at edge {i}"
            );
        }
        assert!(
            nodes.first() == Some(&finish) || nodes.last() == Some(&finish),
            "the extension does not touch the line it continues"
        );

        // Named after where it goes, not where it leaves from. Edges are
        // undirected, and reading the terminus off the last edge's `to` once
        // produced "U3-Verlängerung nach Wandsbek-Gartenstadt" for a line that
        // starts at Wandsbek-Gartenstadt.
        let far = if nodes.first() == Some(&finish) {
            *nodes.last().unwrap()
        } else {
            *nodes.first().unwrap()
        };
        let far_name = ed.network.nodes[&far].name.clone();
        let anchor_name = ed.network.nodes[&finish].name.clone();
        assert!(
            ext.name.contains(&far_name),
            "the extension is called \"{}\" but ends at {far_name}",
            ext.name
        );
        assert!(
            anchor_name == far_name || !ext.name.contains(&anchor_name),
            "the extension is named after {anchor_name}, which is where it starts"
        );
    }

    #[test]
    fn an_extension_is_not_a_change_of_train() {
        use crate::travel::{TravelGraph, TRANSFER_PENALTY_MIN};
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        let (start, finish) = ed.network.line_endpoints(line).unwrap();
        let end = ed.network.nodes[&finish].geo.to_metric();
        ed.apply(Command::ExtendLine {
            line,
            end: End::Finish,
            points: pts(&[(end.x + 4000.0, end.y)]),
            auto_stations: true,
            anchors: None,
        })
        .unwrap();
        let ext = ed
            .network
            .lines
            .values()
            .find(|l| l.extends == Some(line))
            .expect("no extension");
        let far = {
            let nodes = ed.network.line_nodes(ext.id);
            if nodes.first() == Some(&finish) { *nodes.last().unwrap() } else { *nodes.first().unwrap() }
        };

        let ops = crate::params::Params::default().operations;
        let graph = TravelGraph::build(&ed.network, &ops, false);
        let through = *graph.times_from(start).get(&far).expect("no route through");

        // The same journey, with the extension made into an unrelated line.
        let mut apart = ed.network.clone();
        apart.lines.get_mut(&ext.id).unwrap().extends = None;
        let split = *TravelGraph::build(&apart, &ops, false)
            .times_from(start)
            .get(&far)
            .expect("no route when split");

        assert!(
            split - through > TRANSFER_PENALTY_MIN - 0.001,
            "riding onto the extension costs {through:.1} min through and {split:.1} min split; \
             the join is not being treated as the same service"
        );
    }

    #[test]
    fn extending_at_the_start_prepends() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        let (start, _) = ed.network.line_endpoints(line).unwrap();
        let p = ed.network.nodes[&start].geo.to_metric();
        ed.apply(Command::ExtendLine {
            line,
            end: End::Start,
            points: pts(&[(p.x - 3200.0, p.y)]),
            auto_stations: true,
            anchors: None,
        })
        .unwrap();
        let ext = ed
            .network
            .lines
            .values()
            .find(|l| l.extends == Some(line))
            .expect("no extension was created");
        let nodes = ed.network.line_nodes(ext.id);
        assert_eq!(nodes.len(), ext.edges.len() + 1);
        assert!(
            nodes.contains(&start),
            "the extension does not start at the line's old terminus"
        );
        let reach = nodes
            .iter()
            .map(|n| ed.network.nodes[n].geo.to_metric().x)
            .fold(f64::INFINITY, f64::min);
        assert!(reach < p.x - 1000.0, "the network should now reach further west");
    }

    #[test]
    fn splitting_an_edge_preserves_line_continuity_and_length() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        let edge = ed.network.lines[&line].edges[1];
        let len = ed.network.edges[&edge].length_m;
        let before_total = ed.network.line_length_m(line);
        ed.apply(Command::SplitEdge {
            edge,
            along_m: len / 2.0,
            name: Some("Testhalt".into()),
        })
        .unwrap();
        let after_total = ed.network.line_length_m(line);
        assert!(
            (before_total - after_total).abs() < 5.0,
            "{before_total} vs {after_total}"
        );
        let l = &ed.network.lines[&line];
        let nodes = ed.network.line_nodes(line);
        assert_eq!(nodes.len(), l.edges.len() + 1);
        assert!(ed.network.nodes.values().any(|n| n.name == "Testhalt"));
        assert!(ed.network.validate().is_empty());
    }

    #[test]
    fn a_terminus_can_be_removed() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        // Make the line removable, as a user-drawn one would be.
        for e in ed.network.lines[&line].edges.clone() {
            ed.network.edges.get_mut(&e).unwrap().status = BuildStatus::ToBuild;
        }
        let (_, finish) = ed.network.line_endpoints(line).unwrap();
        let before = ed.network.line_nodes(line).len();
        ed.apply(Command::RemoveStation { node: finish })
            .expect("a terminus must be removable");
        assert!(!ed.network.nodes.contains_key(&finish));
        assert_eq!(ed.network.line_nodes(line).len(), before - 1);
        assert!(ed.network.validate().is_empty());
    }

    #[test]
    fn an_intermediate_stop_is_merged_out() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        for e in ed.network.lines[&line].edges.clone() {
            ed.network.edges.get_mut(&e).unwrap().status = BuildStatus::ToBuild;
        }
        let nodes = ed.network.line_nodes(line);
        let middle = nodes[2];
        let before_km = ed.network.line_length_m(line);
        ed.apply(Command::RemoveStation { node: middle }).unwrap();
        assert!(!ed.network.nodes.contains_key(&middle));
        assert!(
            (ed.network.line_length_m(line) - before_km).abs() < 10.0,
            "length changed"
        );
        assert!(ed.network.validate().is_empty());
    }

    #[test]
    fn an_existing_station_says_why_it_cannot_go() {
        let mut ed = editor();
        let n = ed
            .network
            .nodes
            .values()
            .find(|n| n.status == BuildStatus::InService)
            .unwrap()
            .id;
        let err = ed.apply(Command::RemoveStation { node: n }).unwrap_err();
        assert!(
            err.to_string().contains("Bestandsnetz"),
            "unhelpful message: {err}"
        );
    }

    #[test]
    fn split_then_merge_round_trips_the_length() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        let edge = ed.network.lines[&line].edges[1];
        let len = ed.network.edges[&edge].length_m;
        let before = ed.network.line_length_m(line);
        ed.apply(Command::SplitEdge {
            edge,
            along_m: len * 0.4,
            name: Some("Zwischenhalt".into()),
        })
        .unwrap();
        let node = ed
            .network
            .nodes
            .values()
            .find(|n| n.name == "Zwischenhalt")
            .unwrap()
            .id;
        ed.apply(Command::MergeAtNode { node }).unwrap();
        assert!(!ed.network.nodes.contains_key(&node));
        let after = ed.network.line_length_m(line);
        assert!((before - after).abs() < 10.0, "{before} vs {after}");
        assert!(ed.network.validate().is_empty());
    }

    #[test]
    fn shortening_removes_track_and_renames_the_line() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        let before = ed.network.lines[&line].edges.len();
        ed.apply(Command::ShortenLine {
            line,
            end: End::Finish,
            count: 2,
        })
        .unwrap();
        assert_eq!(ed.network.lines[&line].edges.len(), before - 2);
        assert!(ed.network.validate().is_empty());
    }

    #[test]
    fn shortening_below_the_minimum_is_refused() {
        let mut ed = editor();
        let line = *ed.network.lines.keys().next().unwrap();
        let n = ed.network.lines[&line].edges.len();
        assert!(ed
            .apply(Command::ShortenLine {
                line,
                end: End::Finish,
                count: n
            })
            .is_err());
    }

    #[test]
    fn moving_a_node_drags_its_edges_along() {
        let mut ed = editor();
        let node = *ed.network.nodes.keys().next().unwrap();
        let touching = ed.network.edges_at(node);
        let target = Point::new(1234.0, 5678.0).to_latlon();
        ed.apply(Command::MoveNode { node, to: target }).unwrap();
        // Coordinates are rounded to seven decimals (about a centimetre) so
        // that what is on screen is exactly what gets saved.
        assert!((ed.network.nodes[&node].geo.lat - target.lat).abs() < 1e-6);
        for e in touching {
            let edge = &ed.network.edges[&e];
            let ends = [edge.geo[0], *edge.geo.last().unwrap()];
            assert!(ends.iter().any(|p| p.distance_to(&target) < 1.0));
            assert!(edge.length_m > 0.0);
        }
    }

    #[test]
    fn deleting_a_line_keeps_track_used_by_another_line() {
        let mut ed = editor();
        let a = *ed.network.lines.keys().next().unwrap();
        let shared = ed.network.lines[&a].edges[0];
        // A second line over the same edge.
        let b = LineId(ed.network.fresh_id());
        let mut l = ed.network.lines[&a].clone();
        l.id = b;
        l.label = "X9".into();
        l.edges = vec![shared];
        ed.network.lines.insert(b, l);
        ed.apply(Command::DeleteLine { line: a }).unwrap();
        assert!(
            ed.network.edges.contains_key(&shared),
            "shared track must survive"
        );
        assert!(ed.network.lines.contains_key(&b));
    }

    #[test]
    fn infrastructure_changes_are_validated() {
        let mut ed = editor();
        let edge = *ed.network.edges.keys().next().unwrap();
        ed.network.edges.get_mut(&edge).unwrap().mode = Mode::Ubahn;
        assert!(ed
            .apply(Command::ChangeInfrastructure {
                edge,
                infrastructure: Infrastructure::TramMixed
            })
            .is_err());
        assert!(ed
            .apply(Command::ChangeInfrastructure {
                edge,
                infrastructure: Infrastructure::Elevated
            })
            .is_ok());
        assert_eq!(
            ed.network.edges[&edge].infrastructure,
            Infrastructure::Elevated
        );
    }

    #[test]
    fn drawing_through_an_existing_station_reuses_it() {
        let mut ed = editor();
        let n = ed
            .network
            .nodes
            .values()
            .find(|n| n.kind == NodeKind::Station)
            .unwrap()
            .clone();
        let p = n.geo.to_metric();
        let before_nodes = ed.network.nodes.len();
        ed.apply(Command::DrawLine {
            mode: Mode::Ubahn,
            infrastructure: None,
            points: pts(&[(p.x, p.y - 5000.0), (p.x, p.y + 5000.0)]),
            label: Some("U9".into()),
            color: None,
            auto_stations: true,
            anchors: None,
        })
        .unwrap();
        assert!(
            ed.network.nodes[&n.id].interchange,
            "existing station must become an interchange"
        );
        assert!(ed.network.nodes.len() > before_nodes);
    }

    #[test]
    fn commands_serialise_for_the_wire() {
        let c = Command::DrawLine {
            mode: Mode::Tram,
            infrastructure: Some(Infrastructure::TramReserved),
            points: pts(&[(0.0, 0.0), (1000.0, 0.0)]),
            label: Some("T1".into()),
            color: None,
            auto_stations: true,
            anchors: None,
        };
        let s = serde_json::to_string(&c).unwrap();
        assert!(s.contains("\"type\":\"drawLine\""));
        let back: Command = serde_json::from_str(&s).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn every_command_field_is_camel_case_on_the_wire() {
        // The browser writes camelCase. A field that does not match is not an
        // error when it has a default — it is silently ignored, which is worse.
        let commands = vec![
            Command::SplitEdge {
                edge: EdgeId(1),
                along_m: 250.0,
                name: None,
            },
            Command::DrawLine {
                mode: Mode::Ubahn,
                infrastructure: None,
                points: pts(&[(0.0, 0.0), (100.0, 0.0)]),
                label: None,
                color: None,
                auto_stations: false,
                anchors: Some(pts(&[(0.0, 0.0)])),
            },
            Command::ExtendLine {
                line: LineId(1),
                end: End::Start,
                points: pts(&[(0.0, 0.0)]),
                auto_stations: false,
                anchors: None,
            },
            Command::SetLineIncluded {
                line: LineId(1),
                included: false,
            },
        ];
        for c in commands {
            let s = serde_json::to_string(&c).unwrap();
            assert!(!s.contains('_'), "snake_case leaked onto the wire: {s}");
            assert_eq!(
                serde_json::from_str::<Command>(&s).unwrap(),
                c,
                "round trip failed for {s}"
            );
        }
        // And the exact shape the TypeScript side sends must parse.
        let from_browser = r#"{"type":"splitEdge","edge":7,"alongM":250.0,"name":null}"#;
        assert!(matches!(
            serde_json::from_str::<Command>(from_browser).unwrap(),
            Command::SplitEdge { along_m, .. } if (along_m - 250.0).abs() < 1e-9
        ));
        let no_auto = r#"{"type":"drawLine","mode":"ubahn","infrastructure":null,"points":[],"label":null,"color":null,"autoStations":false,"anchors":null}"#;
        assert!(matches!(
            serde_json::from_str::<Command>(no_auto).unwrap(),
            Command::DrawLine {
                auto_stations: false,
                ..
            }
        ));
    }

    #[test]
    fn fillets_leave_the_stations_on_the_track() {
        // A corridor with a sharp corner exactly at the middle stop. Rounding
        // the whole thing would cut that corner and leave the station beside
        // the line — which is how the U5 came to look broken between
        // Sengelmannstraße and City Nord.
        let corridor = vec![
            Point::new(0.0, 0.0),
            Point::new(1000.0, 0.0),
            Point::new(1000.0, 1000.0),
        ];
        let stops = [Point::new(1000.0, 0.0)];
        let params = Params::default();
        let rounded = round_corridor_through(&corridor, &stops, Mode::Ubahn, &params);
        let off = crate::geo::project_on_polyline(stops[0], &rounded)
            .map(|pr| pr.distance)
            .unwrap_or(f64::MAX);
        assert!(off < 15.0, "Halt liegt {off:.0} m neben der Trasse");
    }

    /// A city whose eastern half is open country.
    fn half_empty_city() -> crate::city::CityData {
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
    fn the_construction_type_follows_the_ground() {
        let params = Params::default();
        let mut ed = Editor::new(Network::new(), half_empty_city(), params);
        // Straight east: dense city first, open country after.
        let pts: Vec<LatLon> = [-8000.0, -4000.0, 0.0, 6000.0, 12000.0, 18000.0]
            .iter()
            .map(|x| Point::new(*x, 0.0).to_latlon())
            .collect();
        ed.apply(Command::DrawLine {
            mode: Mode::Ubahn,
            infrastructure: None,
            points: pts.clone(),
            label: None,
            color: None,
            auto_stations: true,
            anchors: Some(pts),
        })
        .unwrap();
        let kinds: Vec<Infrastructure> = ed
            .network
            .edges
            .values()
            .map(|e| e.infrastructure)
            .collect();
        assert!(
            kinds.iter().any(|k| k.is_tunnel()),
            "kein Tunnel in der dichten Hälfte: {kinds:?}"
        );
        assert!(
            kinds.iter().any(|k| !k.is_tunnel()),
            "alles Tunnel, auch im Freien: {kinds:?}"
        );
        // And the stations follow the track they sit on.
        let mut depths: Vec<_> = ed.network.nodes.values().map(|n| n.depth.rank()).collect();
        depths.sort_unstable();
        depths.dedup();
        assert!(depths.len() > 1, "alle Stationen gleich tief");
    }

    #[test]
    fn an_explicit_construction_type_is_respected_everywhere() {
        let params = Params::default();
        let mut ed = Editor::new(Network::new(), half_empty_city(), params);
        let pts: Vec<LatLon> = [-8000.0, 0.0, 8000.0, 16000.0]
            .iter()
            .map(|x| Point::new(*x, 0.0).to_latlon())
            .collect();
        ed.apply(Command::DrawLine {
            mode: Mode::Ubahn,
            infrastructure: Some(Infrastructure::Elevated),
            points: pts.clone(),
            label: None,
            color: None,
            auto_stations: true,
            anchors: Some(pts),
        })
        .unwrap();
        assert!(
            ed.network
                .edges
                .values()
                .all(|e| e.infrastructure == Infrastructure::Elevated),
            "die ausdrückliche Bauweise wurde überschrieben"
        );
    }
}
