//! WebAssembly bindings.
//!
//! The browser owns no domain logic at all (plan §47, §65): it sends pointer
//! positions and semantic commands in, and gets snap results, diffs and
//! analysis out. Everything crosses the boundary as plain JS values so the
//! TypeScript side never has to know about Rust memory.

use hh_core::city::CityData;
use hh_core::editor::{Command, Editor, End};
use hh_core::geo::{LatLon, Point};
use hh_core::model::{EdgeId, LineId, Mode, Network, NodeId};
use hh_core::params::Params;
use hh_core::scenario::{ScenarioDocument, ScenarioTemplate};
use hh_core::{simulation, snap, stations};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// The city identifier used in scenario documents and on the server.
///
/// The dataset carries the display name ("Hamburg"); the key is its
/// lower-case, ASCII form, which is also the directory the data lives in.
fn city_key(name: &str) -> String {
    name.to_lowercase()
        .replace('ä', "ae")
        .replace('ö', "oe")
        .replace('ü', "ue")
        .replace('ß', "ss")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn from_js<T: serde::de::DeserializeOwned>(v: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(v).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Rendering-ready geometry for one line, in both representations (plan §5).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LineGeometry {
    id: u32,
    label: String,
    name: String,
    mode: String,
    color: String,
    source: String,
    included: bool,
    /// The line this one continues, where it is an extension of an existing
    /// route. The interface uses it to say so; the model uses it so the join
    /// does not read as a change of train.
    extends: Option<u32>,
    /// [lon, lat] pairs.
    geo: Vec<[f64; 2]>,
    /// Metric schematic coordinates.
    schematic: Vec<[f64; 2]>,
    length_km: f64,
    stations: Vec<u32>,
    note: String,
    official_opening_year: Option<i32>,
    official_cost_eur: Option<f64>,
    external_id: Option<String>,
    /// Per-edge status, so the renderer can dash what is not built yet.
    segments: Vec<SegmentGeometry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SegmentGeometry {
    id: u32,
    status: String,
    infrastructure: String,
    geo: Vec<[f64; 2]>,
    length_km: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StationGeometry {
    id: u32,
    name: String,
    lon: f64,
    lat: f64,
    x: f64,
    y: f64,
    kind: String,
    status: String,
    source: String,
    interchange: bool,
    depth: String,
    lines: Vec<String>,
    colors: Vec<String>,
    modes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderState {
    lines: Vec<LineGeometry>,
    stations: Vec<StationGeometry>,
}

fn mode_key(m: Mode) -> String {
    m.key().to_string()
}

fn status_key(s: hh_core::model::BuildStatus) -> String {
    match s {
        hh_core::model::BuildStatus::InService => "in_service",
        hh_core::model::BuildStatus::UnderConstruction => "under_construction",
        hh_core::model::BuildStatus::ToBuild => "to_build",
    }
    .into()
}

fn source_key(s: hh_core::model::Source) -> String {
    match s {
        hh_core::model::Source::Existing => "existing",
        hh_core::model::Source::Planned => "planned",
        hh_core::model::Source::Proposal => "proposal",
        hh_core::model::Source::User => "user",
    }
    .into()
}

fn depth_key(d: hh_core::model::StationDepth) -> String {
    use hh_core::model::StationDepth::*;
    match d {
        Stop => "stop",
        Surface => "surface",
        Elevated => "elevated",
        Shallow => "shallow",
        Deep => "deep",
    }
    .into()
}

fn build_render_state(net: &Network) -> RenderState {
    let mut lines = Vec::new();
    for l in net.lines.values() {
        let geo: Vec<[f64; 2]> = net
            .line_geometry(l.id)
            .iter()
            .map(|p| [p.lon, p.lat])
            .collect();
        let schematic: Vec<[f64; 2]> = net
            .line_schematic(l.id)
            .iter()
            .map(|p| [p.x, p.y])
            .collect();
        let nodes = net.line_nodes(l.id);
        let segments = l
            .edges
            .iter()
            .filter_map(|e| net.edges.get(e))
            .map(|e| SegmentGeometry {
                id: e.id.0,
                status: status_key(e.status),
                infrastructure: format!("{:?}", e.infrastructure),
                geo: e.geo.iter().map(|p| [p.lon, p.lat]).collect(),
                length_km: e.length_km(),
            })
            .collect();
        lines.push(LineGeometry {
            id: l.id.0,
            label: l.label.clone(),
            name: l.name.clone(),
            mode: mode_key(l.mode),
            color: l.color.clone(),
            source: source_key(l.source),
            included: l.included,
            extends: l.extends.map(|p| p.0),
            geo,
            schematic,
            length_km: net.line_length_m(l.id) / 1000.0,
            stations: nodes.iter().map(|n| n.0).collect(),
            note: l.note.clone(),
            official_opening_year: l.official_opening_year,
            official_cost_eur: l.official_cost_eur,
            external_id: l.external_id.clone(),
            segments,
        });
    }

    let mut stations = Vec::new();
    for n in net.nodes.values() {
        let ls = net.lines_at_node(n.id);
        let visible: Vec<&hh_core::model::Line> = ls
            .iter()
            .filter_map(|l| net.lines.get(l))
            .filter(|l| l.included)
            .collect();
        if visible.is_empty() {
            continue;
        }
        stations.push(StationGeometry {
            id: n.id.0,
            name: n.name.clone(),
            lon: n.geo.lon,
            lat: n.geo.lat,
            x: n.schematic.x,
            y: n.schematic.y,
            kind: match n.kind {
                hh_core::model::NodeKind::Station => "station",
                hh_core::model::NodeKind::Junction => "junction",
                hh_core::model::NodeKind::Waypoint => "waypoint",
            }
            .into(),
            status: status_key(n.status),
            source: source_key(n.source),
            // Only a station several lines actually call at. The stored flag is
            // set generously during import and would put a label on half the map.
            interchange: net.services_at_node(n.id).len() > 1,
            depth: depth_key(net.effective_depth(n.id)),
            lines: visible.iter().map(|l| l.label.clone()).collect(),
            colors: visible.iter().map(|l| l.color.clone()).collect(),
            modes: visible.iter().map(|l| mode_key(l.mode)).collect(),
        });
    }
    RenderState { lines, stations }
}

/// The whole engine, held by the browser for the lifetime of the session.
#[wasm_bindgen]
pub struct Engine {
    editor: Editor,
    templates: Vec<ScenarioTemplate>,
    baseline: Network,
    /// The loaded city's own parameter set, kept aside because a saved
    /// scenario carries the parameters it was computed with and replaces the
    /// editor's — so "recompute with today's model" has to have somewhere to
    /// get today's model from. `Params::default()` is not it: that is the
    /// built-in fallback, which for Berlin is Hamburg's figures.
    city_params: Params,
}

#[wasm_bindgen]
impl Engine {
    /// Create from the versioned datasets, all passed as JSON strings.
    #[wasm_bindgen(constructor)]
    pub fn new(
        city_json: &str,
        network_json: &str,
        templates_json: &str,
        params_json: Option<String>,
    ) -> Result<Engine, JsValue> {
        let mut city: CityData = serde_json::from_str(city_json)
            .map_err(|e| JsValue::from_str(&format!("Stadtdaten: {e}")))?;
        city.prepare();
        let network: Network = serde_json::from_str(network_json)
            .map_err(|e| JsValue::from_str(&format!("Netz: {e}")))?;
        let templates: Vec<ScenarioTemplate> = serde_json::from_str(templates_json)
            .map_err(|e| JsValue::from_str(&format!("Szenarien: {e}")))?;
        // The parameter set belongs to the city, not to the build: Hamburg's
        // share of the VAT pot and Hamburg's subsoil are not Berlin's. Without
        // this the published per-city file was decorative and every city was
        // quietly computed with the defaults.
        let params: Params = match params_json.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(json) => serde_json::from_str(json)
                .map_err(|e| JsValue::from_str(&format!("Parameter: {e}")))?,
            None => Params::default(),
        };
        let baseline = network.clone();
        Ok(Engine {
            editor: Editor::new(network, city, params.clone()),
            templates,
            baseline,
            city_params: params,
        })
    }

    /// Everything the renderer needs.
    #[wasm_bindgen(js_name = renderState)]
    pub fn render_state(&self) -> Result<JsValue, JsValue> {
        to_js(&build_render_state(&self.editor.network))
    }

    /// Cheap figures for the live readout (plan §62).
    #[wasm_bindgen(js_name = quickEstimate)]
    pub fn quick_estimate(&self) -> Result<JsValue, JsValue> {
        to_js(&simulation::quick(
            &self.editor.network,
            &self.editor.city,
            &self.editor.params,
        ))
    }

    /// The full analysis.
    pub fn simulate(&self) -> Result<JsValue, JsValue> {
        to_js(&simulation::run(
            &self.editor.network,
            &self.editor.city,
            &self.editor.params,
        ))
    }

    /// Resolve a pointer position into a snap target (plan §7).
    #[wasm_bindgen(js_name = snapPoint)]
    #[allow(clippy::too_many_arguments)]
    pub fn snap_point(
        &self,
        lon: f64,
        lat: f64,
        origin_lon: Option<f64>,
        origin_lat: Option<f64>,
        mode: &str,
        metres_per_pixel: f64,
        coarse_pointer: bool,
    ) -> Result<JsValue, JsValue> {
        let raw = LatLon::new(lat, lon).to_metric();
        let origin = match (origin_lon, origin_lat) {
            (Some(a), Some(b)) => Some(LatLon::new(b, a).to_metric()),
            _ => None,
        };
        let m = parse_mode(mode);
        let r = snap::snap(
            raw,
            origin,
            m,
            &self.editor.network,
            &self.editor.city,
            &self.editor.params.geometry,
            metres_per_pixel,
            coarse_pointer,
        );
        to_js(&r)
    }

    /// Station candidates for a corridor, without committing anything —
    /// this is what the ghost preview shows while drawing.
    #[wasm_bindgen(js_name = previewStations)]
    pub fn preview_stations(&self, points: JsValue, mode: &str) -> Result<JsValue, JsValue> {
        let pts: Vec<[f64; 2]> = from_js(points)?;
        let corridor: Vec<Point> = pts
            .iter()
            .map(|p| LatLon::new(p[1], p[0]).to_metric())
            .collect();
        if corridor.len() < 2 {
            return to_js(&Vec::<u8>::new());
        }
        let picks = stations::auto_place(
            &corridor,
            parse_mode(mode),
            &self.editor.network,
            &self.editor.city,
            &self.editor.params.stations,
            &self.editor.params.demand,
            &corridor,
        );
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Preview {
            lon: f64,
            lat: f64,
            name: String,
            origin: String,
            interchange: bool,
            catchment_population: f64,
        }
        let out: Vec<Preview> = picks
            .iter()
            .map(|c| {
                let g = c.point.to_latlon();
                Preview {
                    lon: g.lon,
                    lat: g.lat,
                    name: c.name.clone(),
                    origin: format!("{:?}", c.origin),
                    interchange: c.interchange,
                    catchment_population: c.catchment_population,
                }
            })
            .collect();
        to_js(&out)
    }

    /// What the line currently being drawn would add, without committing it.
    ///
    /// This is what makes drawing feel like a decision rather than a guess:
    /// the cost, the stations and the opening year move while the line grows.
    #[wasm_bindgen(js_name = previewLine)]
    pub fn preview_line(&self, points: JsValue, mode: &str) -> Result<JsValue, JsValue> {
        let pts: Vec<[f64; 2]> = from_js(points)?;
        #[derive(Serialize, Default)]
        #[serde(rename_all = "camelCase")]
        struct Preview {
            valid: bool,
            km: f64,
            stations: usize,
            interchanges: usize,
            investment_eur: f64,
            investment_low_eur: f64,
            investment_high_eur: f64,
            opening_year: Option<i32>,
            population_reached: f64,
            feasibility: String,
            warnings: Vec<String>,
        }
        if pts.len() < 2 {
            return to_js(&Preview::default());
        }
        let before =
            simulation::quick(&self.editor.network, &self.editor.city, &self.editor.params);
        let mut scratch = Editor::new(
            self.editor.network.clone(),
            self.editor.city.clone(),
            self.editor.params.clone(),
        );
        let cmd = Command::DrawLine {
            mode: parse_mode(mode),
            infrastructure: None,
            points: pts.iter().map(|p| LatLon::new(p[1], p[0])).collect(),
            label: Some("preview".into()),
            color: None,
            auto_stations: true,
            anchors: Some(pts.iter().map(|p| LatLon::new(p[1], p[0])).collect()),
        };
        if scratch.apply(cmd).is_err() {
            return to_js(&Preview::default());
        }
        let after = simulation::quick(&scratch.network, &scratch.city, &scratch.params);
        let feas =
            hh_core::feasibility::calculate(&scratch.network, &scratch.city, &scratch.params);
        let line = scratch
            .network
            .lines
            .values()
            .find(|l| l.label == "preview")
            .cloned();
        let line = line.as_ref();
        let (stations, interchanges, reached) = match line {
            Some(l) => {
                let nodes = scratch.network.line_nodes(l.id);
                let inter = nodes
                    .iter()
                    .filter(|n| scratch.network.services_at_node(**n).len() > 1)
                    .count();
                let radius = scratch.editor_catchment_radius(l.mode);
                let pop: f64 = nodes
                    .iter()
                    .filter_map(|n| scratch.network.nodes.get(n))
                    .map(|n| {
                        scratch
                            .city
                            .catchment(
                                n.geo.to_metric(),
                                radius,
                                scratch.params.demand.catchment_decay,
                            )
                            .population
                    })
                    .sum();
                (nodes.len(), inter, pop)
            }
            None => (0, 0, 0.0),
        };
        to_js(&Preview {
            valid: true,
            km: after.new_km - before.new_km,
            stations,
            interchanges,
            investment_eur: after.investment_eur - before.investment_eur,
            investment_low_eur: after.investment_low_eur - before.investment_low_eur,
            investment_high_eur: after.investment_high_eur - before.investment_high_eur,
            opening_year: after.opening_year,
            population_reached: reached,
            feasibility: feas.class.label_de().to_string(),
            // Only what is wrong with *this* line. The rest of the network has
            // its own problems and they are not the user's doing right now.
            warnings: feas
                .findings
                .iter()
                .filter(|f| f.severity >= hh_core::feasibility::Severity::Caution)
                .filter(|f| match (f.edge, line) {
                    (Some(e), Some(l)) => l.edges.contains(&e),
                    _ => false,
                })
                .map(|f| f.title.clone())
                .take(3)
                .collect(),
        })
    }

    /// Apply a semantic command; returns the diff (plan §50).
    pub fn apply(&mut self, command: JsValue) -> Result<JsValue, JsValue> {
        let cmd: Command = from_js(command)?;
        let diff = self
            .editor
            .apply(cmd)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        to_js(&diff)
    }

    pub fn undo(&mut self) -> Result<JsValue, JsValue> {
        match self.editor.undo() {
            Some(d) => to_js(&d),
            None => Ok(JsValue::NULL),
        }
    }

    pub fn redo(&mut self) -> Result<JsValue, JsValue> {
        match self.editor.redo() {
            Some(d) => to_js(&d),
            None => Ok(JsValue::NULL),
        }
    }

    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> bool {
        self.editor.can_undo()
    }

    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> bool {
        self.editor.can_redo()
    }

    pub fn history(&self) -> Result<JsValue, JsValue> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct History {
            /// Steps taken, oldest first.
            done: Vec<String>,
            /// Steps taken back and still redoable, oldest first.
            undone: Vec<String>,
        }
        let (done, undone) = self.editor.history_full();
        to_js(&History { done, undone })
    }

    pub fn templates(&self) -> Result<JsValue, JsValue> {
        to_js(&self.templates)
    }

    /// Reset to a predefined scenario (plan §13).
    #[wasm_bindgen(js_name = loadTemplate)]
    pub fn load_template(&mut self, id: &str) -> Result<JsValue, JsValue> {
        let t = self
            .templates
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| JsValue::from_str("Unbekanntes Szenario"))?
            .clone();
        let mut net = self.baseline.clone();
        for l in net.lines.values_mut() {
            l.included = l
                .external_id
                .as_ref()
                .map(|e| t.included_lines.contains(e))
                .unwrap_or(false);
        }
        self.editor = Editor::new(net, self.editor.city.clone(), self.editor.params.clone());
        to_js(&t)
    }

    /// Switch a line on or off without touching the history.
    #[wasm_bindgen(js_name = setLineIncluded)]
    pub fn set_line_included(&mut self, line: u32, included: bool) -> Result<JsValue, JsValue> {
        let diff = self
            .editor
            .apply(Command::SetLineIncluded {
                line: LineId(line),
                included,
            })
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        to_js(&diff)
    }

    /// Details of one station for the inspector / bottom sheet (plan §24).
    #[wasm_bindgen(js_name = stationDetail)]
    pub fn station_detail(&self, id: u32) -> Result<JsValue, JsValue> {
        let net = &self.editor.network;
        let node = net
            .nodes
            .get(&NodeId(id))
            .ok_or_else(|| JsValue::from_str("Unbekannte Station"))?;
        let lines: Vec<&hh_core::model::Line> = net
            .lines_at_node(node.id)
            .iter()
            .filter_map(|l| net.lines.get(l))
            .filter(|l| l.included)
            .collect();
        let p = node.geo.to_metric();
        let c = self.editor.city.catchment(
            p,
            self.editor
                .params
                .demand
                .catchment_radius_m
                .get(lines.first().map(|l| l.mode).unwrap_or(Mode::Ubahn)),
            self.editor.params.demand.catchment_decay,
        );
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Detail {
            id: u32,
            name: String,
            lon: f64,
            lat: f64,
            depth: String,
            depth_label: String,
            status: String,
            source: String,
            interchange: bool,
            accessible: bool,
            lines: Vec<(String, String, String)>,
            district: Option<String>,
            catchment_population: f64,
            catchment_jobs: f64,
            nearby: Vec<(String, f64)>,
        }
        to_js(&Detail {
            id,
            name: node.name.clone(),
            lon: node.geo.lon,
            lat: node.geo.lat,
            depth: depth_key(net.effective_depth(node.id)),
            depth_label: net.effective_depth(node.id).label_de().into(),
            status: status_key(node.status),
            source: source_key(node.source),
            // What calls here in this scenario. The stored flag is set for
            // every station a planned or proposed line would touch, whether
            // or not that line is switched on.
            interchange: net.services_at_node(node.id).len() > 1,
            accessible: node.accessible,
            lines: lines
                .iter()
                .map(|l| (l.label.clone(), l.color.clone(), mode_key(l.mode)))
                .collect(),
            district: self.editor.city.district_at(p).map(|d| d.name.clone()),
            catchment_population: c.population,
            catchment_jobs: c.jobs,
            nearby: self
                .editor
                .city
                .landmarks_near(p, 500.0)
                .iter()
                .take(8)
                .map(|(l, d)| (l.name.clone(), *d))
                .collect(),
        })
    }

    /// Details of one line.
    #[wasm_bindgen(js_name = lineDetail)]
    pub fn line_detail(&self, id: u32) -> Result<JsValue, JsValue> {
        let net = &self.editor.network;
        let l = net
            .lines
            .get(&LineId(id))
            .ok_or_else(|| JsValue::from_str("Unbekannte Linie"))?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Detail {
            id: u32,
            label: String,
            name: String,
            mode: String,
            color: String,
            source: String,
            included: bool,
            note: String,
            length_km: f64,
            stations: Vec<(u32, String, bool)>,
            /// How the line is built, by kilometres per construction type.
            /// The engine chooses this per section, so a single label would
            /// be a lie on any line that leaves the city centre.
            construction: Vec<(String, f64)>,
            headway_peak_min: f64,
            official_opening_year: Option<i32>,
            official_cost_eur: Option<f64>,
            opening_year: Option<i32>,
        }
        to_js(&Detail {
            id,
            label: l.label.clone(),
            name: l.name.clone(),
            mode: mode_key(l.mode),
            color: l.color.clone(),
            source: source_key(l.source),
            included: l.included,
            note: l.note.clone(),
            length_km: net.line_length_m(l.id) / 1000.0,
            stations: net
                .line_nodes(l.id)
                .iter()
                .filter_map(|n| net.nodes.get(n))
                .map(|n| {
                    (
                        n.id.0,
                        n.name.clone(),
                        n.status != hh_core::model::BuildStatus::InService,
                    )
                })
                .collect(),
            construction: {
                let mut by_kind: std::collections::BTreeMap<String, f64> = Default::default();
                for e in l.edges.iter().filter_map(|e| net.edges.get(e)) {
                    *by_kind
                        .entry(e.infrastructure.label_de().to_string())
                        .or_default() += e.length_m / 1000.0;
                }
                let mut out: Vec<(String, f64)> = by_kind.into_iter().collect();
                out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                out
            },
            headway_peak_min: l.service.headway_peak_min,
            official_opening_year: l.official_opening_year,
            official_cost_eur: l.official_cost_eur,
            opening_year: hh_core::construction::line_opening(net, &self.editor.city, l.id, &self.editor.params),
        })
    }

    /// Serialise the current scenario for saving or sharing.
    #[wasm_bindgen(js_name = toDocument)]
    pub fn to_document(&self, title: &str) -> Result<String, JsValue> {
        let mut doc = ScenarioDocument::for_city(
            title,
            self.editor.network.clone(),
            self.editor.city.version.id.clone(),
            city_key(&self.editor.city.version.city),
        );
        doc.params = Some(self.editor.params.clone());
        doc.to_json().map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Simulate a document without loading it.
    ///
    /// Publishing may narrow a plan to the lines its author drew, and the
    /// figures stored beside it have to be the figures of *that* network — the
    /// server recomputes from the document and the two must agree. Doing this by
    /// loading the narrowed document into the live editor and loading the old
    /// one back would drop the undo history on the floor for a read-only
    /// question, so this answers it on a scratch copy.
    ///
    /// The city's parameters are used, not the document's: this is a fresh
    /// calculation of what is about to be published, not the reproduction of an
    /// old one.
    #[wasm_bindgen(js_name = simulateDocument)]
    pub fn simulate_document(&self, json: &str) -> Result<JsValue, JsValue> {
        let doc =
            ScenarioDocument::from_json(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        to_js(&simulation::run(
            &doc.network,
            &self.editor.city,
            &self.city_params,
        ))
    }

    /// Load a saved scenario.
    #[wasm_bindgen(js_name = loadDocument)]
    pub fn load_document(&mut self, json: &str) -> Result<JsValue, JsValue> {
        let doc =
            ScenarioDocument::from_json(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let params = doc.params_or_default();
        self.editor = Editor::new(doc.network, self.editor.city.clone(), params);
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Info {
            title: String,
            description: String,
            calculation_version: String,
            data_version: String,
            current: bool,
        }
        to_js(&Info {
            title: doc.title,
            description: doc.description,
            current: doc.calculation_version == hh_core::CALCULATION_VERSION,
            calculation_version: doc.calculation_version,
            data_version: doc.data_version,
        })
    }

    /// Re-run a loaded scenario with today's model (plan §38).
    #[wasm_bindgen(js_name = recalculateWithCurrentModel)]
    pub fn recalculate_with_current_model(&mut self) -> Result<JsValue, JsValue> {
        self.editor.params = self.city_params.clone();
        self.simulate()
    }

    /// The parameter set, for the assumptions panel (plan §80).
    pub fn params(&self) -> Result<JsValue, JsValue> {
        to_js(&self.editor.params)
    }

    /// The parameters of the *city*, whatever document is currently loaded.
    ///
    /// `params()` reports what the calculation is running with, and loading a
    /// published plan deliberately replaces that with the plan's own set so the
    /// figures match what its author saw. That makes it the wrong thing to
    /// describe the city with: the explanations on a plan's page quoted the
    /// VAT share and subsoil of whichever document had been loaded last — or,
    /// for a plan that carries none, the built-in defaults, which are one
    /// city's figures. Berlin's page said its subsoil costs Hamburg's surcharge.
    #[wasm_bindgen(js_name = cityParams)]
    pub fn city_params(&self) -> Result<JsValue, JsValue> {
        to_js(&self.city_params)
    }

    /// Data provenance, for the sources panel (plan §63).
    #[wasm_bindgen(js_name = dataSources)]
    pub fn data_sources(&self) -> Result<JsValue, JsValue> {
        to_js(&self.editor.city.version)
    }

    /// What the population raster was built from, in figures the explanations
    /// quote — how many districts, how many buildings, and from whose numbers.
    pub fn provenance(&self) -> Result<JsValue, JsValue> {
        to_js(&self.editor.city.provenance)
    }

    /// Compare the current scenario with a saved one (plan §44).
    #[wasm_bindgen(js_name = compareWith)]
    pub fn compare_with(&self, json: &str) -> Result<JsValue, JsValue> {
        let doc =
            ScenarioDocument::from_json(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let a = simulation::run(&self.editor.network, &self.editor.city, &self.editor.params);
        let b = simulation::run(&doc.network, &self.editor.city, &doc.params_or_default());
        to_js(&simulation::compare(&a, &b))
    }

    /// Infrastructure choices allowed for a mode, for the inspector.
    #[wasm_bindgen(js_name = allowedInfrastructure)]
    pub fn allowed_infrastructure(&self, mode: &str) -> Result<JsValue, JsValue> {
        let list: Vec<(String, String)> =
            hh_core::model::Infrastructure::allowed_for(parse_mode(mode))
                .into_iter()
                .map(|i| (format!("{i:?}"), i.label_de().to_string()))
                .collect();
        to_js(&list)
    }

    /// Which edge is under the pointer, for selection.
    #[wasm_bindgen(js_name = pickEdge)]
    pub fn pick_edge(&self, lon: f64, lat: f64, radius_m: f64) -> Result<JsValue, JsValue> {
        let p = LatLon::new(lat, lon).to_metric();
        let active = self.editor.network.active_edges();
        let mut best: Option<(EdgeId, f64, f64)> = None;
        for eid in active {
            let Some(e) = self.editor.network.edges.get(&eid) else {
                continue;
            };
            let pts: Vec<Point> = e.geo.iter().map(|g| g.to_metric()).collect();
            if let Some(pr) = hh_core::geo::project_on_polyline(p, &pts) {
                if pr.distance <= radius_m && best.map_or(true, |b| pr.distance < b.1) {
                    best = Some((eid, pr.distance, pr.along));
                }
            }
        }
        match best {
            Some((id, d, along)) => to_js(&(id.0, d, along)),
            None => Ok(JsValue::NULL),
        }
    }
}

fn parse_mode(s: &str) -> Mode {
    match s {
        "sbahn" => Mode::Sbahn,
        "tram" => Mode::Tram,
        "regional" => Mode::Regional,
        _ => Mode::Ubahn,
    }
}

/// Helper so the TypeScript side can build an `ExtendLine` end without knowing
/// the serde representation.
#[wasm_bindgen(js_name = endValue)]
pub fn end_value(start: bool) -> String {
    serde_json::to_string(&if start { End::Start } else { End::Finish })
        .unwrap_or_default()
        .trim_matches('"')
        .to_string()
}
