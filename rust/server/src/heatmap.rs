//! Where people are asking for connections that do not exist.
//!
//! Every published plan is one person's answer to "what is missing". Laid over
//! each other they become a different kind of statement: not a proposal, but a
//! map of where the proposals agree. Two dozen people drawing their own line
//! through Eimsbüttel is evidence about Eimsbüttel, and no single one of those
//! plans says it.
//!
//! What counts is only what would be *built*. A plan carries the existing
//! network with it, and counting that would draw a heat map of the network
//! Hamburg already has, which nobody needs.

use crate::error::ApiResult;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use hh_core::model::{BuildStatus, NodeId, Source};
use hh_core::scenario::ScenarioDocument;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::{HashMap, HashSet};

/// Edge length of a cell, in metres.
///
/// Three hundred metres is about the distance people will walk to a stop
/// without thinking about it, which makes it the scale at which "here" means
/// something. Finer, and two people drawing the same corridor on opposite sides
/// of a street look like disagreement; coarser, and a line through a district
/// says nothing about where in it.
const CELL_M: f64 = 300.0;

/// Spacing at which a line is sampled along its course.
///
/// Half a cell, so a segment cannot step over one. Sampling at the cell size
/// left gaps on diagonals: a line running north-east skipped every other cell
/// and came out dotted.
const STEP_M: f64 = CELL_M / 2.0;

/// Extra weight for a station, over and above the track leading to it.
///
/// A station is where a line stops being a line somebody drew and becomes a
/// place somebody can leave from, so it carries more of the wish than the track
/// between. Not much more, though: at six the map came out as a string of beads
/// with the corridors between them barely visible, and the corridor is the part
/// that shows where several people agree.
const STATION_WEIGHT: f64 = 2.5;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatQuery {
    /// Count only plans with at least this many votes, for looking past the
    /// long tail of first drafts.
    #[serde(default, alias = "min_votes")]
    pub min_votes: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heatmap {
    pub city: String,
    /// How many published plans went into this.
    pub scenarios: usize,
    /// The heaviest cell, so the client can scale its colours against something
    /// real rather than guessing.
    pub max_weight: f64,
    /// `[lon, lat, weight]`, rounded, because five decimal places is a metre
    /// and the rest is transfer.
    pub cells: Vec<(f64, f64, f64)>,
    /// The lines people drew most often, by name, as a plain list to read.
    pub themes: Vec<Theme>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub label: String,
    pub count: usize,
    pub km: f64,
}

/// How much one plan's wishes count.
///
/// Votes raise it, but through a logarithm: one plan that went round a forum
/// should not bury twenty that did not, and the question being asked is where
/// people want connections, not which plan won.
fn weight_of(votes: i32, forks: i32) -> f64 {
    1.0 + ((1 + votes.max(0) + forks.max(0)) as f64).ln()
}

/// Metres per degree of longitude at this latitude, and of latitude.
fn scale_at(lat: f64) -> (f64, f64) {
    let lat_m = 111_132.0;
    let lon_m = 111_320.0 * lat.to_radians().cos();
    (lon_m.max(1.0), lat_m)
}

/// How long a computed map is served before it is computed again. A plan
/// published now shows up within two minutes, which nobody looking at an
/// aggregate of hundreds will notice, and the database is read once per window
/// instead of once per visitor.
const CACHE_SECONDS: i64 = 120;

/// Documents read per round trip. A document can run to megabytes; holding two
/// thousand of them at once to answer one anonymous GET would hand anybody who
/// can reload a page a way to exhaust the server's memory.
const BATCH: i64 = 50;
const MAX_SCENARIOS: i64 = 2000;

/// One computation at a time. A cold cache under load would otherwise start the
/// same scan once per waiting request; behind this lock the second one finds
/// the first one's result.
static COMPUTING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn heatmap(
    State(state): State<AppState>,
    Path(city): Path<String>,
    Query(q): Query<HeatQuery>,
) -> ApiResult<Response> {
    let city = city.to_lowercase();
    // Only cities that exist: the name is part of the cache key, and a key per
    // made-up city would be a way to fill the cache with nothing.
    state.city(&city)?;
    let min_votes = q.min_votes.unwrap_or(0).clamp(0, 1000);
    let key = format!("wuensche:{city}:{min_votes}");

    if let Some(body) = state.cache.get(&key) {
        return Ok(json_response(body));
    }
    let _guard = COMPUTING.lock().await;
    if let Some(body) = state.cache.get(&key) {
        return Ok(json_response(body));
    }
    let map = compute(&state, &city, min_votes).await?;
    let body = serde_json::to_string(&map)?;
    state.cache.put(&key, body.clone(), CACHE_SECONDS);
    Ok(json_response(body))
}

fn json_response(body: String) -> Response {
    ([(header::CONTENT_TYPE, "application/json")], body).into_response()
}

async fn compute(state: &AppState, city: &str, min_votes: i32) -> ApiResult<Heatmap> {
    // Keyed on integer cell coordinates rather than on rounded degrees: at this
    // latitude a degree of longitude is 6/10 of a degree of latitude, so
    // rounding both the same way makes rectangles out of squares.
    let mut grid: HashMap<(i32, i32), f64> = HashMap::new();
    let mut themes: HashMap<String, (usize, f64)> = HashMap::new();
    let mut counted = 0usize;

    let mut offset = 0;
    while offset < MAX_SCENARIOS {
        let rows = sqlx::query(
            "SELECT document, votes, forks FROM scenarios
              WHERE visibility = 'public' AND hidden_at IS NULL
                AND document->>'city' = $1 AND votes >= $2
              ORDER BY created_at DESC, id
              LIMIT $3 OFFSET $4",
        )
        .bind(city)
        .bind(min_votes)
        .bind(BATCH)
        .bind(offset)
        .fetch_all(&state.db)
        .await?;
        let fetched = rows.len() as i64;
        for row in rows {
            let Ok(doc) = serde_json::from_value::<ScenarioDocument>(row.get("document")) else {
                // A document this build cannot read is not a reason to fail the
                // whole map; it is one plan missing from an aggregate of many.
                continue;
            };
            counted += 1;
            add_plan(
                &mut grid,
                &mut themes,
                &doc,
                weight_of(row.get("votes"), row.get("forks")),
            );
        }
        if fetched < BATCH {
            break;
        }
        offset += BATCH;
    }

    let max_weight = grid.values().copied().fold(0.0_f64, f64::max);
    let mut cells: Vec<(f64, f64, f64)> = grid
        .into_iter()
        .map(|((cx, cy), w)| {
            let lat = (cy as f64 + 0.5) * (CELL_M / 111_132.0);
            let (lon_m, _) = scale_at(lat);
            let lon = (cx as f64 + 0.5) * (CELL_M / lon_m);
            (
                (lon * 100_000.0).round() / 100_000.0,
                (lat * 100_000.0).round() / 100_000.0,
                (w * 100.0).round() / 100.0,
            )
        })
        .collect();
    cells.sort_by(|a, b| b.2.total_cmp(&a.2));

    let mut themes: Vec<Theme> = themes
        .into_iter()
        .map(|(label, (count, km))| Theme {
            label,
            count,
            km: (km * 10.0).round() / 10.0,
        })
        .collect();
    themes.sort_by(|a, b| b.count.cmp(&a.count).then(b.km.total_cmp(&a.km)));
    themes.truncate(12);

    Ok(Heatmap {
        city: city.to_string(),
        scenarios: counted,
        max_weight,
        cells,
        themes,
    })
}

/// What one plan asks for, added to the map once.
///
/// Each cell counts a plan at most once, for its track and once more for a
/// station. Adding per sample instead weighted a line by how it was drawn: a
/// hand-drawn curve has a vertex every few metres, every short segment brought
/// both of its ends, and the curve came out ten times as wanted as a straight
/// line through the same streets. Two lines of one plan sharing a trunk are
/// also still one person asking once.
fn add_plan(
    grid: &mut HashMap<(i32, i32), f64>,
    themes: &mut HashMap<String, (usize, f64)>,
    doc: &ScenarioDocument,
    weight: f64,
) {
    let mut track: HashSet<(i32, i32)> = HashSet::new();
    let mut stations: HashSet<(i32, i32)> = HashSet::new();
    // Nodes on lines this plan actually runs; a station on a line the author
    // switched off is not part of what they are asking for.
    let mut served: HashSet<NodeId> = HashSet::new();

    for line in doc.network.lines.values() {
        if !line.included {
            continue;
        }
        let mut drawn_km = 0.0;
        for eid in &line.edges {
            let Some(edge) = doc.network.edges.get(eid) else {
                continue;
            };
            served.insert(edge.from);
            served.insert(edge.to);
            // Only what this author would build. The decided projects — the
            // U5, the S4 — travel in nearly every document as planned track,
            // and counting them made the U5 the most wished-for line in the
            // city, by people who had not touched it.
            if edge.status != BuildStatus::ToBuild || !is_wish(edge.source) {
                continue;
            }
            drawn_km += edge.length_m / 1000.0;
            sample_edge(&mut track, &edge.geo);
        }
        if drawn_km > 0.01 {
            let entry = themes.entry(line.label.clone()).or_insert((0, 0.0));
            entry.0 += 1;
            entry.1 += drawn_km;
        }
    }

    // Stations that would be built, each a wish for a place to get on —
    // including one added to a line that already runs, which is a wish with
    // no new track at all.
    for node in doc.network.nodes.values() {
        if node.status == BuildStatus::ToBuild && is_wish(node.source) && served.contains(&node.id) {
            stations.insert(cell_of(node.geo.lon, node.geo.lat));
        }
    }

    for cell in track {
        *grid.entry(cell).or_insert(0.0) += weight;
    }
    for cell in stations {
        *grid.entry(cell).or_insert(0.0) += weight * STATION_WEIGHT;
    }
}

/// Drawn by the author or picked from the proposals — not carried along.
fn is_wish(source: Source) -> bool {
    matches!(source, Source::User | Source::Proposal)
}

fn cell_of(lon: f64, lat: f64) -> (i32, i32) {
    let (lon_m, lat_m) = scale_at(lat);
    (
        (lon * lon_m / CELL_M).floor() as i32,
        (lat * lat_m / CELL_M).floor() as i32,
    )
}

/// Walks a polyline at a fixed spacing and collects every cell it crosses.
///
/// Taking only the vertices would miss the cells between two far-apart points
/// and land several times in a cell where the line happens to bend.
fn sample_edge(cells: &mut HashSet<(i32, i32)>, geo: &[hh_core::geo::LatLon]) {
    for pair in geo.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let (lon_m, lat_m) = scale_at((a.lat + b.lat) / 2.0);
        let dx = (b.lon - a.lon) * lon_m;
        let dy = (b.lat - a.lat) * lat_m;
        let len = (dx * dx + dy * dy).sqrt();
        let steps = (len / STEP_M).ceil().max(1.0) as usize;
        for i in 0..=steps {
            let t = i as f64 / steps as f64;
            cells.insert(cell_of(a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hh_core::geo::LatLon;

    #[test]
    fn popularity_counts_but_does_not_dominate() {
        let quiet = weight_of(0, 0);
        let popular = weight_of(100, 0);
        assert!(popular > quiet, "Stimmen zählen gar nicht");
        assert!(
            popular < quiet * 6.0,
            "ein beliebter Entwurf ({popular:.2}) überdeckt {:.0} stille",
            popular / quiet
        );
    }

    #[test]
    fn a_line_heats_every_cell_it_passes() {
        let mut grid = HashSet::new();
        // Two kilometres due east: at 300 m cells that is seven or so.
        let a = LatLon { lat: 53.55, lon: 9.99 };
        let b = LatLon {
            lat: 53.55,
            lon: 9.99 + 2000.0 / scale_at(53.55).0,
        };
        sample_edge(&mut grid, &[a, b]);
        assert!(
            grid.len() >= 6 && grid.len() <= 9,
            "{} Zellen für zwei Kilometer",
            grid.len()
        );
        // And no gaps: the cells it touches have to be consecutive.
        let mut xs: Vec<i32> = grid.iter().map(|(x, _)| *x).collect();
        xs.sort_unstable();
        xs.dedup();
        for pair in xs.windows(2) {
            assert_eq!(pair[1] - pair[0], 1, "Lücke in der Spur bei {pair:?}");
        }
    }

    #[test]
    fn a_diagonal_line_leaves_no_gaps() {
        // The failure that set the sampling step: at one sample per cell a
        // diagonal skipped every other one and the line came out dotted.
        let mut grid = HashSet::new();
        let (lon_m, lat_m) = scale_at(53.55);
        let a = LatLon { lat: 53.55, lon: 9.99 };
        let b = LatLon {
            lat: 53.55 + 3000.0 / lat_m,
            lon: 9.99 + 3000.0 / lon_m,
        };
        sample_edge(&mut grid, &[a, b]);
        let mut cells: Vec<(i32, i32)> = grid.iter().copied().collect();
        cells.sort();
        for pair in cells.windows(2) {
            let (dx, dy) = (pair[1].0 - pair[0].0, (pair[1].1 - pair[0].1).abs());
            assert!(dx <= 1 && dy <= 1, "Sprung von {:?} nach {:?}", pair[0], pair[1]);
        }
    }

    #[test]
    fn a_finely_drawn_curve_counts_no_more_than_a_straight_line() {
        // The same kilometre, once as two points and once as two hundred.
        let a = LatLon { lat: 53.55, lon: 9.99 };
        let b = LatLon {
            lat: 53.55,
            lon: 9.99 + 1000.0 / scale_at(53.55).0,
        };
        let dense: Vec<LatLon> = (0..=200)
            .map(|i| LatLon {
                lat: a.lat,
                lon: a.lon + (b.lon - a.lon) * i as f64 / 200.0,
            })
            .collect();
        let (mut straight, mut curve) = (HashSet::new(), HashSet::new());
        sample_edge(&mut straight, &[a, b]);
        sample_edge(&mut curve, &dense);
        assert_eq!(straight, curve);
    }
}
