#![allow(dead_code)]
//! Shapes of the JSON the importer pipeline produces.
//! Not every field is consumed by the importer — the structs mirror the files
//! so a schema change surfaces as a deserialisation error rather than a silent
//! misreading.
//!
//! Keeping them in one place means the TypeScript importers and the Rust engine
//! agree on a single contract; `hh import` fails loudly when they drift.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct OsmNetwork {
    pub stations: Vec<OsmStation>,
    pub edges: Vec<OsmEdge>,
    pub lines: Vec<OsmLine>,
}

#[derive(Debug, Deserialize)]
pub struct OsmStation {
    pub id: String,
    pub name: String,
    pub lon: f64,
    pub lat: f64,
    pub modes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsmEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub mode: String,
    pub tunnel: bool,
    pub geo: Vec<[f64; 2]>,
}

#[derive(Debug, Deserialize)]
pub struct OsmLine {
    pub id: String,
    pub label: String,
    pub name: String,
    pub mode: String,
    pub color: String,
    pub edges: Vec<String>,
    #[serde(default)]
    pub branch: bool,
}

#[derive(Debug, Default, Deserialize)]
pub struct Projects {
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub proposals: Vec<Proposal>,
    /// Scenarios that tell *this city's* story. "U5 im Vollausbau" and
    /// "Straßenbahn statt U5" were written into the importer, so Berlin was
    /// offered them too — one of them an exact duplicate of the existing
    /// network, the other of "Alles gleichzeitig". A scenario that names
    /// particular projects belongs beside those projects.
    #[serde(default)]
    pub scenarios: Vec<ScenarioSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSpec {
    pub id: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    /// Project ids to switch on. Empty means every planned project.
    #[serde(default)]
    pub planned: Option<Vec<String>>,
    /// Whether the counter-proposals are switched on too.
    ///
    /// `true` means all of them, which was fine while the only proposal was the
    /// tram concept. It stopped being fine the moment a second one existed: the
    /// regional S-Bahn lines landed inside the tram scenario, adding seventy
    /// kilometres nobody had asked for to a comparison that is specifically
    /// about tram versus U-Bahn.
    #[serde(default)]
    pub proposals: bool,
    /// Which proposals, by id. Takes precedence over `proposals`.
    #[serde(default)]
    pub proposal_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub label: String,
    pub name: String,
    pub mode: String,
    pub status: String,
    /// Absent where the construction method has not been published. Asserting
    /// one anyway would put a number in the comparison column that nobody ever
    /// claimed — the engine picks per section from the ground instead.
    #[serde(default)]
    pub infrastructure: Option<String>,
    pub color: String,
    #[serde(default)]
    pub opening_year: Option<i32>,
    #[serde(default)]
    pub official_cost_eur: Option<f64>,
    /// The sponsor published this figure, and it is publicly contested. Shown
    /// in the comparison, but kept out of the calibration verdict: a model that
    /// agrees with the criticism instead of the number is not miscalibrated,
    /// and treating it as an error would tune the model towards a figure others
    /// have already argued is too low.
    #[serde(default)]
    pub cost_disputed: bool,
    /// The year the published figure is priced in, where the source says so or
    /// can be dated. Without it a deviation cannot be read: the model computes
    /// in today's prices, and a figure from 2018 is not comparable to one from
    /// 2025 simply because both are in euros.
    #[serde(default)]
    pub price_base_year: Option<i32>,
    /// The year construction actually began, for a project already under way.
    #[serde(default)]
    pub construction_start_year: Option<i32>,
    #[serde(default)]
    pub note: String,
    pub stations: Vec<ProjectStation>,
    pub segments: Vec<Segment>,
    pub length_km: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStation {
    pub name: String,
    pub lon: f64,
    pub lat: f64,
    pub is_new: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub from: String,
    pub to: String,
    pub geo: Vec<[f64; 2]>,
    pub length_m: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub claimed_cost_eur: Option<f64>,
    #[serde(default)]
    pub claimed_length_km: Option<f64>,
    #[serde(default)]
    pub claimed_stops: Option<usize>,
    pub lines: Vec<ProposalLine>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLine {
    pub id: String,
    pub label: String,
    pub name: String,
    pub color: String,
    pub stations: Vec<ProjectStation>,
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub auto_stations: bool,
    /// The proposal names every stop itself. Such a line is built stop by stop
    /// like a planned project, instead of having the engine space stops along
    /// a corridor: a study that publishes 91 stop names should be shown with
    /// those 91 stops, not with however many the spacing rule happens to yield.
    #[serde(default)]
    pub named_stops: bool,
    #[serde(default)]
    pub note: String,
    /// Which mode the proposal is for. Absent means tram, which is what every
    /// proposal was until a regional S-Bahn needed to be one.
    #[serde(default)]
    pub mode: Option<String>,
    /// How the line is built where it is new. Absent lets the engine choose.
    #[serde(default)]
    pub infrastructure: Option<String>,
}
