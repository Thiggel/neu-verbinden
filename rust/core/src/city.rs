//! The versioned city dataset the engine reasons about (plan §58, §63, §87).
//!
//! Everything real-world enters the engine through this struct: land use,
//! population and jobs as a raster, water bodies, street corridors, landmarks
//! and district boundaries. The engine never hard-codes a Hamburg fact, so a
//! new data vintage — or a different city — is a data swap, not a code change
//! (plan §88).

use crate::geo::{point_in_ring, project_on_polyline, Bbox, LatLon, Point};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataVersion {
    /// Identifier such as "2026-09".
    pub id: String,
    pub city: String,
    pub sources: Vec<DataSource>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSource {
    pub name: String,
    pub url: String,
    pub licence: String,
    pub retrieved: String,
    #[serde(default)]
    pub note: String,
}

/// Importance class of a landmark, used for station naming and scoring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LandmarkKind {
    /// Existing rail/metro station — the strongest naming and transfer anchor.
    Station,
    /// City, borough, quarter or neighbourhood name.
    Place,
    /// University, hospital, stadium, mall, museum, airport…
    Poi,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Landmark {
    pub id: String,
    pub name: String,
    pub kind: LandmarkKind,
    pub geo: LatLon,
    /// 0..1 importance used both for naming priority and station scoring.
    pub weight: f64,
    /// Modes already served here, if it is a station.
    #[serde(default)]
    pub modes: Vec<String>,
    #[serde(default)]
    pub category: String,
}

/// A named street corridor. Used for tram feasibility and station naming.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Street {
    pub name: String,
    /// Road class: 0 = motorway/trunk, 1 = primary, 2 = secondary, 3 = local.
    pub class: u8,
    pub geo: Vec<LatLon>,
}

/// An existing railway alignment.
///
/// Not part of the transit network — this is every piece of railway OSM knows,
/// including main lines and freight. It answers one question the buildability
/// check cannot answer otherwise: is a surface alignment cutting through the
/// city, or is it following a corridor that already carries trains?
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RailCorridor {
    #[serde(default)]
    pub name: String,
    pub geo: Vec<LatLon>,
}

/// A water body the network may have to cross.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterBody {
    pub name: String,
    /// Outer ring, geographic.
    pub ring: Vec<LatLon>,
    /// True for the Elbe and other navigable waterways with heavy constraints.
    #[serde(default)]
    pub major: bool,
}

/// Administrative district with official statistics attached.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct District {
    pub id: String,
    pub name: String,
    pub borough: String,
    pub population: f64,
    pub employed_residents: f64,
    pub households: f64,
    pub area_km2: f64,
    pub cars_per_1000: f64,
    /// Outer ring(s), geographic.
    pub rings: Vec<Vec<LatLon>>,
}

/// A regular raster of population and workplaces over the city.
///
/// Stored as a flat row-major grid in the local metric plane so catchment
/// queries are simple index arithmetic rather than polygon intersection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemographicGrid {
    /// Cell size in metres.
    pub cell_m: f64,
    /// Metric coordinate of the lower-left corner of cell (0,0).
    pub origin_x: f64,
    pub origin_y: f64,
    pub cols: usize,
    pub rows: usize,
    /// Residents per cell.
    pub population: Vec<f32>,
    /// Workplaces per cell.
    pub jobs: Vec<f32>,
}

impl DemographicGrid {
    pub fn empty() -> Self {
        Self {
            cell_m: 250.0,
            origin_x: 0.0,
            origin_y: 0.0,
            cols: 0,
            rows: 0,
            population: vec![],
            jobs: vec![],
        }
    }

    #[inline]
    pub fn index(&self, col: usize, row: usize) -> usize {
        row * self.cols + col
    }

    #[inline]
    fn cell_of(&self, p: Point) -> Option<(usize, usize)> {
        let c = ((p.x - self.origin_x) / self.cell_m).floor();
        let r = ((p.y - self.origin_y) / self.cell_m).floor();
        if c < 0.0 || r < 0.0 {
            return None;
        }
        let (c, r) = (c as usize, r as usize);
        if c >= self.cols || r >= self.rows {
            None
        } else {
            Some((c, r))
        }
    }

    pub fn cell_center(&self, col: usize, row: usize) -> Point {
        Point::new(
            self.origin_x + (col as f64 + 0.5) * self.cell_m,
            self.origin_y + (row as f64 + 0.5) * self.cell_m,
        )
    }

    pub fn population_at(&self, p: Point) -> f64 {
        self.cell_of(p)
            .map(|(c, r)| self.population[self.index(c, r)] as f64)
            .unwrap_or(0.0)
    }

    pub fn jobs_at(&self, p: Point) -> f64 {
        self.cell_of(p)
            .map(|(c, r)| self.jobs[self.index(c, r)] as f64)
            .unwrap_or(0.0)
    }

    pub fn total_population(&self) -> f64 {
        self.population.iter().map(|v| *v as f64).sum()
    }

    pub fn total_jobs(&self) -> f64 {
        self.jobs.iter().map(|v| *v as f64).sum()
    }

    /// Whether a point falls inside this raster's extent.
    pub fn covers(&self, p: Point) -> bool {
        self.cell_of(p).is_some()
    }

    /// Distance-decayed residents and workplaces around a point.
    ///
    /// The weight of a cell falls off as `exp(-decay · d / radius)` and is zero
    /// beyond the radius, which approximates observed walk-access curves far
    /// better than a hard circle.
    pub fn catchment(&self, center: Point, radius_m: f64, decay: f64) -> Catchment {
        let mut out = Catchment::default();
        if self.cols == 0 {
            return out;
        }
        let steps = (radius_m / self.cell_m).ceil() as i64;
        let Some((cc, cr)) = self.cell_of(center) else {
            return out;
        };
        for dr in -steps..=steps {
            for dc in -steps..=steps {
                let c = cc as i64 + dc;
                let r = cr as i64 + dr;
                if c < 0 || r < 0 || c >= self.cols as i64 || r >= self.rows as i64 {
                    continue;
                }
                let (c, r) = (c as usize, r as usize);
                let d = center.distance_to(&self.cell_center(c, r));
                if d > radius_m {
                    continue;
                }
                let w = (-decay * d / radius_m).exp();
                let i = self.index(c, r);
                out.population += self.population[i] as f64 * w;
                out.jobs += self.jobs[i] as f64 * w;
                out.raw_population += self.population[i] as f64;
                out.raw_jobs += self.jobs[i] as f64;
                out.area_km2 += (self.cell_m * self.cell_m) / 1.0e6;
            }
        }
        out
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catchment {
    /// Distance-decayed residents.
    pub population: f64,
    /// Distance-decayed workplaces.
    pub jobs: f64,
    /// Undecayed residents inside the radius.
    pub raw_population: f64,
    pub raw_jobs: f64,
    pub area_km2: f64,
}

impl Catchment {
    pub fn weighted(&self, job_weight: f64) -> f64 {
        self.population + self.jobs * job_weight
    }
}

/// The complete city dataset.
/// Where this city's population figures come from, in numbers the interface
/// can quote. Optional: datasets built before this existed do not have it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    /// "Stadtteile" in Hamburg, "Ortsteile" in Berlin.
    pub district_term: String,
    pub district_count: usize,
    pub buildings_counted: usize,
    pub population_source: String,
    /// Whether those figures are official statistics or a community dataset.
    pub official_population: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CityData {
    pub version: DataVersion,
    /// What the population raster was built from — the numbers the interface
    /// quotes when it explains where "erschlossene Einwohner" comes from.
    #[serde(default)]
    pub provenance: Option<Provenance>,
    /// Map centre and default camera.
    pub center: LatLon,
    /// Origin of the metric plane for this city. Absent in older datasets,
    /// which were all Hamburg and used the built-in default.
    #[serde(default)]
    pub projection_origin: Option<LatLon>,
    pub landmarks: Vec<Landmark>,
    pub streets: Vec<Street>,
    pub water: Vec<WaterBody>,
    pub districts: Vec<District>,
    /// Existing railway alignments, for the buildability check.
    #[serde(default)]
    pub rail: Vec<RailCorridor>,
    /// Fine population and workplace raster for the city itself.
    pub grid: DemographicGrid,
    /// Coarse raster for the wider region — the towns a regional line could
    /// reach. Cells covered by the fine grid are zeroed when it is built, so
    /// the two never count the same person twice.
    #[serde(default)]
    pub region_grid: Option<DemographicGrid>,
    /// Points of the central business district, used for centrality scoring.
    pub centres: Vec<Centre>,
    #[serde(skip)]
    index: Option<Box<SpatialIndex>>,
    #[serde(skip)]
    water_mask: Option<Box<WaterMask>>,
    #[serde(skip)]
    zones: Option<Box<crate::connectivity::Zones>>,
}

/// A major destination: the main centre, a sub-centre or an employment hub.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Centre {
    pub name: String,
    pub geo: LatLon,
    /// Workplaces attributed to this centre, used to weight accessibility.
    pub jobs: f64,
    /// Primary centre of the city.
    #[serde(default)]
    pub primary: bool,
}

/// A rasterised water mask.
///
/// Testing a polyline against several hundred water polygons point by point was
/// the single hottest thing in the engine. Rasterising the polygons once turns
/// every later query into an array lookup, which is what makes a cost estimate
/// cheap enough to run on every pointer release.
#[derive(Debug, Clone, PartialEq)]
struct WaterMask {
    cell: f64,
    min_x: f64,
    min_y: f64,
    cols: usize,
    rows: usize,
    /// bit 0 = water, bit 1 = major water.
    cells: Vec<u8>,
}

impl WaterMask {
    fn build(water: &[WaterBody], cell: f64) -> Self {
        let mut bbox = Bbox::empty();
        let rings: Vec<(Vec<Point>, bool)> = water
            .iter()
            .map(|w| {
                (
                    w.ring.iter().map(|p| p.to_metric()).collect::<Vec<_>>(),
                    w.major,
                )
            })
            .collect();
        for (r, _) in &rings {
            for p in r {
                bbox.extend(*p);
            }
        }
        if bbox.is_empty() {
            return Self {
                cell,
                min_x: 0.0,
                min_y: 0.0,
                cols: 0,
                rows: 0,
                cells: Vec::new(),
            };
        }
        bbox = bbox.grow(cell * 2.0);
        let cols = (((bbox.max_x - bbox.min_x) / cell).ceil() as usize).max(1);
        let rows = (((bbox.max_y - bbox.min_y) / cell).ceil() as usize).max(1);
        let mut cells = vec![0u8; cols * rows];
        // Filled by scanline, not by testing every cell against every ring.
        //
        // The obvious version asks `point_in_ring` for each cell in a ring's
        // bounding box, which walks the whole ring every time: for the Elbe that
        // is some 900 000 cells against 200 points, and it made up 197 of the
        // 209 ms the engine spent starting up — about 550 ms in the browser, the
        // single largest thing anyone waits for.
        //
        // A scanline crosses the ring once per row instead of once per cell.
        // Same even-odd rule, same cell centres, same result — for a wide
        // polygon it is three orders of magnitude less work.
        let mut xs: Vec<f64> = Vec::new();
        for (ring, major) in &rings {
            if ring.len() < 3 {
                continue;
            }
            let rb = Bbox::from_points(ring);
            let c0 = (((rb.min_x - bbox.min_x) / cell).floor().max(0.0)) as usize;
            let c1 = ((((rb.max_x - bbox.min_x) / cell).ceil()) as usize).min(cols);
            let r0 = (((rb.min_y - bbox.min_y) / cell).floor().max(0.0)) as usize;
            let r1 = ((((rb.max_y - bbox.min_y) / cell).ceil()) as usize).min(rows);
            let bit = 1u8 | if *major { 2 } else { 0 };
            for r in r0..r1 {
                let y = bbox.min_y + (r as f64 + 0.5) * cell;
                xs.clear();
                let n = ring.len();
                let mut j = n - 1;
                for i in 0..n {
                    let (pi, pj) = (ring[i], ring[j]);
                    if (pi.y > y) != (pj.y > y) {
                        xs.push(pi.x + (y - pi.y) / (pj.y - pi.y) * (pj.x - pi.x));
                    }
                    j = i;
                }
                if xs.len() < 2 {
                    continue;
                }
                xs.sort_by(f64::total_cmp);
                // Sorted crossings pair up: a point is inside the ring exactly
                // when it lies between an even-indexed crossing and the next.
                for span in xs.chunks_exact(2) {
                    let (xa, xb) = (span[0], span[1]);
                    let from = (((xa - bbox.min_x) / cell - 0.5).floor().max(0.0) as usize).max(c0);
                    let to = ((((xb - bbox.min_x) / cell - 0.5).ceil() as usize) + 1).min(c1);
                    for c in from..to {
                        let x = bbox.min_x + (c as f64 + 0.5) * cell;
                        // The bounds above only prune; this keeps the edge
                        // cells identical to the per-cell test.
                        if x > xa && x < xb {
                            cells[r * cols + c] |= bit;
                        }
                    }
                }
            }
        }
        Self {
            cell,
            min_x: bbox.min_x,
            min_y: bbox.min_y,
            cols,
            rows,
            cells,
        }
    }

    #[inline]
    fn at(&self, p: Point) -> u8 {
        if self.cols == 0 {
            return 0;
        }
        let c = ((p.x - self.min_x) / self.cell).floor();
        let r = ((p.y - self.min_y) / self.cell).floor();
        if c < 0.0 || r < 0.0 {
            return 0;
        }
        let (c, r) = (c as usize, r as usize);
        if c >= self.cols || r >= self.rows {
            0
        } else {
            self.cells[r * self.cols + c]
        }
    }
}

/// A simple uniform-bucket index over landmarks and streets.
#[derive(Debug, Clone, PartialEq)]
struct SpatialIndex {
    cell: f64,
    bbox: Bbox,
    cols: usize,
    rows: usize,
    landmarks: Vec<Vec<u32>>,
    landmark_points: Vec<Point>,
    street_points: Vec<Vec<Point>>,
    streets: Vec<Vec<u32>>,
    /// Existing railway alignments, indexed the same way and for the same
    /// reason: `distance_to_rail` used to walk every corridor in the city and
    /// re-project each of its vertices from degrees on every call. That is
    /// hundreds of kilometres of geometry per sampled point, and once the
    /// timeline started asking how much of a line lies in an existing corridor,
    /// it landed in the quick estimate — the one that has to answer while
    /// someone is still drawing.
    rail_points: Vec<Vec<Point>>,
    rail: Vec<Vec<u32>>,
}

impl SpatialIndex {
    fn build(city: &CityData) -> Self {
        let cell = 800.0;
        let mut bbox = Bbox::empty();
        let landmark_points: Vec<Point> =
            city.landmarks.iter().map(|l| l.geo.to_metric()).collect();
        for p in &landmark_points {
            bbox.extend(*p);
        }
        let street_points: Vec<Vec<Point>> = city
            .streets
            .iter()
            .map(|s| s.geo.iter().map(|p| p.to_metric()).collect())
            .collect();
        let rail_points: Vec<Vec<Point>> = city
            .rail
            .iter()
            .map(|r| r.geo.iter().map(|p| p.to_metric()).collect())
            .collect();
        for s in &street_points {
            for p in s {
                bbox.extend(*p);
            }
        }
        if bbox.is_empty() {
            bbox = Bbox {
                min_x: -1.0,
                min_y: -1.0,
                max_x: 1.0,
                max_y: 1.0,
            };
        }
        bbox = bbox.grow(cell);
        let cols = (((bbox.max_x - bbox.min_x) / cell).ceil() as usize).max(1);
        let rows = (((bbox.max_y - bbox.min_y) / cell).ceil() as usize).max(1);
        let mut landmarks = vec![Vec::new(); cols * rows];
        let mut streets = vec![Vec::new(); cols * rows];
        let mut rail = vec![Vec::new(); cols * rows];
        let idx = |p: Point| -> Option<usize> {
            let c = ((p.x - bbox.min_x) / cell).floor();
            let r = ((p.y - bbox.min_y) / cell).floor();
            if c < 0.0 || r < 0.0 {
                return None;
            }
            let (c, r) = (c as usize, r as usize);
            if c >= cols || r >= rows {
                None
            } else {
                Some(r * cols + c)
            }
        };
        for (i, p) in landmark_points.iter().enumerate() {
            if let Some(k) = idx(*p) {
                landmarks[k].push(i as u32);
            }
        }
        // Walk each street rather than indexing only its vertices: a
        // simplified straight road can run two kilometres between vertices, and
        // a point in the middle of it would otherwise find no street at all —
        // which is exactly where automatic station names come from.
        let step = cell / 2.0;
        for (i, pts) in street_points.iter().enumerate() {
            let mut seen: Vec<usize> = Vec::new();
            let mut mark = |p: Point, seen: &mut Vec<usize>| {
                if let Some(k) = idx(p) {
                    if !seen.contains(&k) {
                        seen.push(k);
                        streets[k].push(i as u32);
                    }
                }
            };
            for w in pts.windows(2) {
                let len = w[0].distance_to(&w[1]);
                let n = ((len / step).ceil() as usize).max(1);
                for k in 0..=n {
                    mark(w[0].lerp(&w[1], k as f64 / n as f64), &mut seen);
                }
            }
            if pts.len() == 1 {
                mark(pts[0], &mut seen);
            }
        }
        // The same walk for the railways: a corridor simplified to 30 m still
        // has long straight runs, and indexing only its vertices would leave
        // the middle of one invisible.
        for (i, pts) in rail_points.iter().enumerate() {
            let mut seen: Vec<usize> = Vec::new();
            for w in pts.windows(2) {
                let len = w[0].distance_to(&w[1]);
                let n = ((len / step).ceil() as usize).max(1);
                for k in 0..=n {
                    let p = w[0].lerp(&w[1], k as f64 / n as f64);
                    if let Some(cellk) = idx(p) {
                        if !seen.contains(&cellk) {
                            seen.push(cellk);
                            rail[cellk].push(i as u32);
                        }
                    }
                }
            }
        }
        Self {
            cell,
            bbox,
            cols,
            rows,
            landmarks,
            landmark_points,
            street_points,
            streets,
            rail_points,
            rail,
        }
    }

    fn cells_around(&self, p: Point, radius: f64) -> Vec<usize> {
        let steps = (radius / self.cell).ceil() as i64 + 1;
        let c0 = ((p.x - self.bbox.min_x) / self.cell).floor() as i64;
        let r0 = ((p.y - self.bbox.min_y) / self.cell).floor() as i64;
        let mut out = Vec::new();
        for dr in -steps..=steps {
            for dc in -steps..=steps {
                let (c, r) = (c0 + dc, r0 + dr);
                if c >= 0 && r >= 0 && (c as usize) < self.cols && (r as usize) < self.rows {
                    out.push(r as usize * self.cols + c as usize);
                }
            }
        }
        out
    }
}

/// Remembers which indices a spatial-index query has already looked at.
///
/// A query walks several cells and the same feature can sit in all of them, so
/// the projection is worth computing once. This used to be a `Vec` with
/// `contains`, which is a linear scan that grows as the query proceeds: in
/// central Hamburg a 400 m street query visits nine cells holding a few hundred
/// streets each, so the deduplication alone cost hundreds of thousands of
/// comparisons — and the feasibility check runs one such query per 250 m of
/// tram. It was 85 % of the estimate that runs while drawing.
#[derive(Default)]
struct Seen {
    marks: Vec<bool>,
}

impl Seen {
    fn with_capacity(n: usize) -> Self {
        Self {
            marks: vec![false; n],
        }
    }
    /// True the first time an index is offered, false afterwards.
    fn first_time(&mut self, i: u32) -> bool {
        let i = i as usize;
        if i >= self.marks.len() {
            self.marks.resize(i + 1, false);
        }
        if self.marks[i] {
            return false;
        }
        self.marks[i] = true;
        true
    }
}

impl CityData {
    pub fn empty() -> Self {
        Self {
            version: DataVersion {
                id: "empty".into(),
                city: "".into(),
                sources: vec![],
            },
            provenance: None,
            center: LatLon::new(53.55, 9.99),
            projection_origin: None,
            landmarks: vec![],
            streets: vec![],
            water: vec![],
            districts: vec![],
            rail: vec![],
            grid: DemographicGrid::empty(),
            region_grid: None,
            centres: vec![],
            index: None,
            water_mask: None,
            zones: None,
        }
    }

    /// Build the spatial indexes. Call once after loading.
    pub fn prepare(&mut self) {
        // The projection has to be fixed before anything is converted to the
        // metric plane — the spatial index below is the first thing that does.
        if let Some(o) = self.projection_origin {
            crate::geo::set_projection_origin(o.lat, o.lon);
        }
        // No timing instrumentation here, however tempting: this is compiled to
        // WebAssembly, where `Instant::now` panics with "time not implemented on
        // this platform" and takes the whole engine down on startup. Measure
        // from the CLI, which is native.
        self.index = Some(Box::new(SpatialIndex::build(self)));
        self.water_mask = Some(Box::new(WaterMask::build(&self.water, 30.0)));
        self.zones = Some(Box::new(crate::connectivity::Zones::build(self)));
    }

    /// The zones of the connectivity model, if [`Self::prepare`] has run.
    pub fn zones(&self) -> Option<&crate::connectivity::Zones> {
        self.zones.as_deref()
    }

    /// Structural check on a freshly loaded dataset.
    ///
    /// Serde reads a two-element array into a struct positionally, so a
    /// coordinate written as `[lon, lat]` loads as `lat = 9.9` without a word of
    /// complaint and every spatial query then quietly returns nothing. Cheap to
    /// check, extremely annoying to debug.
    pub fn validate(&self) -> Vec<String> {
        let mut problems = Vec::new();
        let plausible =
            |p: &LatLon| (-90.0..=90.0).contains(&p.lat) && (-180.0..=180.0).contains(&p.lon);
        let near_city = |p: &LatLon| p.distance_to(&self.center) < 200_000.0;

        let mut check = |what: &str, points: Vec<&LatLon>| {
            let bad = points
                .iter()
                .filter(|p| !plausible(p) || !near_city(p))
                .count();
            if bad > points.len() / 20 && bad > 0 {
                problems.push(format!(
                    "{what}: {bad} von {} Koordinaten liegen nicht im Stadtgebiet. Sind lat und lon vertauscht?",
                    points.len()
                ));
            }
        };
        check(
            "Landmarken",
            self.landmarks.iter().map(|l| &l.geo).collect(),
        );
        check(
            "Straßen",
            self.streets.iter().flat_map(|s| s.geo.iter()).collect(),
        );
        check(
            "Gewässer",
            self.water.iter().flat_map(|w| w.ring.iter()).collect(),
        );
        check(
            "Stadtteile",
            self.districts
                .iter()
                .flat_map(|d| d.rings.iter().flatten())
                .collect(),
        );
        check("Zentren", self.centres.iter().map(|c| &c.geo).collect());
        if self.grid.cols == 0 || self.grid.total_population() <= 0.0 {
            problems.push("Das Bevölkerungsraster ist leer.".into());
        }
        if let Some(r) = &self.region_grid {
            if r.cell_m < self.grid.cell_m {
                problems.push("Das Regionalraster ist feiner als das Stadtraster.".into());
            }
        }
        problems
    }

    fn index(&self) -> Option<&SpatialIndex> {
        self.index.as_deref()
    }

    /// Landmarks within `radius` metres of a point, nearest first.
    pub fn landmarks_near(&self, p: Point, radius: f64) -> Vec<(&Landmark, f64)> {
        let mut out: Vec<(&Landmark, f64)> = match self.index() {
            Some(ix) => {
                let mut seen = Vec::new();
                for cell in ix.cells_around(p, radius) {
                    for &i in &ix.landmarks[cell] {
                        let d = p.distance_to(&ix.landmark_points[i as usize]);
                        if d <= radius {
                            seen.push((&self.landmarks[i as usize], d));
                        }
                    }
                }
                seen
            }
            None => self
                .landmarks
                .iter()
                .filter_map(|l| {
                    let d = p.distance_to(&l.geo.to_metric());
                    (d <= radius).then_some((l, d))
                })
                .collect(),
        };
        out.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    /// Nearest named street, with the distance to it.
    pub fn nearest_street(&self, p: Point, radius: f64) -> Option<(&Street, f64)> {
        let ix = self.index()?;
        let mut best: Option<(usize, f64)> = None;
        let mut seen = Seen::with_capacity(self.streets.len());
        for cell in ix.cells_around(p, radius) {
            for &i in &ix.streets[cell] {
                if !seen.first_time(i) {
                    continue;
                }
                if let Some(pr) = project_on_polyline(p, &ix.street_points[i as usize]) {
                    if pr.distance <= radius && best.map_or(true, |b| pr.distance < b.1) {
                        best = Some((i as usize, pr.distance));
                    }
                }
            }
        }
        best.map(|(i, d)| (&self.streets[i], d))
    }

    /// Distance to the nearest street corridor of at most the given class.
    /// Distance to the nearest existing railway, if one is within `radius`.
    ///
    /// A linear scan with a cheap bounding-box reject: this runs a few dozen
    /// times per analysis, not per pointer move.
    pub fn distance_to_rail(&self, p: Point, radius: f64) -> Option<f64> {
        let ix = self.index()?;
        let mut best: Option<f64> = None;
        let mut seen = Seen::with_capacity(self.rail.len());
        for cell in ix.cells_around(p, radius) {
            for &i in &ix.rail[cell] {
                if !seen.first_time(i) {
                    continue;
                }
                if let Some(pr) = project_on_polyline(p, &ix.rail_points[i as usize]) {
                    if best.map_or(true, |b| pr.distance < b) {
                        best = Some(pr.distance);
                    }
                }
            }
        }
        best.filter(|d| *d <= radius)
    }

    /// Share of a polyline running within `radius` of an existing railway.
    pub fn rail_corridor_share(&self, line: &[Point], radius: f64) -> f64 {
        if line.len() < 2 || self.rail.is_empty() {
            return 0.0;
        }
        let total = crate::geo::polyline_length(line);
        if total <= 0.0 {
            return 0.0;
        }
        let step = 150.0;
        let n = ((total / step).ceil() as usize).max(1);
        let mut hits = 0usize;
        for i in 0..n {
            let p = crate::geo::point_at_distance(line, (i as f64 + 0.5) * step);
            if self.distance_to_rail(p, radius).is_some() {
                hits += 1;
            }
        }
        hits as f64 / n as f64
    }

    pub fn distance_to_street(&self, p: Point, max_class: u8, radius: f64) -> Option<f64> {
        let ix = self.index()?;
        let mut best: Option<f64> = None;
        let mut seen = Seen::with_capacity(self.streets.len());
        for cell in ix.cells_around(p, radius) {
            for &i in &ix.streets[cell] {
                // Class first: a street the caller cannot use is not worth
                // remembering, let alone projecting onto.
                if self.streets[i as usize].class > max_class {
                    continue;
                }
                if !seen.first_time(i) {
                    continue;
                }
                if let Some(pr) = project_on_polyline(p, &ix.street_points[i as usize]) {
                    if best.map_or(true, |b| pr.distance < b) {
                        best = Some(pr.distance);
                    }
                }
            }
        }
        best.filter(|d| *d <= radius)
    }

    pub fn district_at(&self, p: Point) -> Option<&District> {
        let ll = p.to_latlon();
        self.districts.iter().find(|d| {
            d.rings.iter().any(|r| {
                let ring: Vec<Point> = r.iter().map(|q| q.to_metric()).collect();
                point_in_ring(ll.to_metric(), &ring)
            })
        })
    }

    pub fn is_water(&self, p: Point) -> bool {
        match self.water_mask.as_deref() {
            Some(m) => m.at(p) & 1 != 0,
            None => self.water.iter().any(|w| {
                let ring: Vec<Point> = w.ring.iter().map(|q| q.to_metric()).collect();
                point_in_ring(p, &ring)
            }),
        }
    }

    /// Length of a polyline that falls inside water bodies, in metres.
    ///
    /// Sampled at 25 m, which is far finer than any structure we cost.
    pub fn water_crossing_length(&self, line: &[Point]) -> f64 {
        self.water_scan(line).0
    }

    /// Does the line cross a major (navigable) waterway?
    /// Whether the datasets say anything at all about this point.
    ///
    /// The fine city raster or, beyond it, the coarse regional one. Outside
    /// both there is no population, no water, no buildings and no railways —
    /// not "none there", but "none known", and the two must not be confused.
    pub fn covers(&self, p: Point) -> bool {
        self.grid.covers(p)
            || self
                .region_grid
                .as_ref()
                .is_some_and(|r| r.covers(p))
    }

    /// Covered only by the coarse regional raster, not by the city's own.
    ///
    /// Out there the population comes from the `population` tags of OSM place
    /// nodes on a one-kilometre grid, against two hundred metres and official
    /// statistics inside the city. Everything derived from residents — demand,
    /// benefit, the benefit-cost ratio — is correspondingly rougher, and the
    /// application should say so rather than present both with the same
    /// confidence.
    pub fn only_coarsely_covered(&self, p: Point) -> bool {
        // The fine raster's square reaches beyond the city — Pinneberg and
        // Norderstedt lie inside it — but holds residents only within it.
        let fine = self.grid.population_at(p) + self.grid.jobs_at(p);
        let Some(r) = self.region_grid.as_ref().filter(|r| r.covers(p)) else {
            return false;
        };
        !self.grid.covers(p) || (fine <= 0.0 && r.population_at(p) + r.jobs_at(p) > 0.0)
    }

    pub fn crosses_major_water(&self, line: &[Point]) -> bool {
        self.water_scan(line).1
    }

    /// Wet length in metres and whether a major waterway is involved.
    fn water_scan(&self, line: &[Point]) -> (f64, bool) {
        if line.len() < 2 || self.water.is_empty() {
            return (0.0, false);
        }
        let step = 25.0;
        let total = crate::geo::polyline_length(line);
        let n = (total / step).ceil() as usize;
        let mut wet = 0.0;
        let mut major = false;
        // Walk the polyline once instead of re-scanning it per sample.
        let mut seg = 0usize;
        let mut seg_start = 0.0;
        let mut seg_len = line[0].distance_to(&line[1]);
        for i in 0..n {
            let d = (i as f64 + 0.5) * step;
            while d > seg_start + seg_len && seg + 2 < line.len() {
                seg_start += seg_len;
                seg += 1;
                seg_len = line[seg].distance_to(&line[seg + 1]);
            }
            let t = if seg_len < 1e-9 {
                0.0
            } else {
                ((d - seg_start) / seg_len).clamp(0.0, 1.0)
            };
            let p = line[seg].lerp(&line[seg + 1], t);
            let bits = match self.water_mask.as_deref() {
                Some(m) => m.at(p),
                None => {
                    let mut b = 0u8;
                    for w in &self.water {
                        let ring: Vec<Point> = w.ring.iter().map(|q| q.to_metric()).collect();
                        if point_in_ring(p, &ring) {
                            b |= 1;
                            if w.major {
                                b |= 2;
                            }
                        }
                    }
                    b
                }
            };
            if bits & 1 != 0 {
                wet += step.min(total - i as f64 * step);
                if bits & 2 != 0 {
                    major = true;
                }
            }
        }
        (wet, major)
    }

    /// Population density index in 0..1 along a polyline, used as a cost driver.
    pub fn density_index(&self, line: &[Point]) -> f64 {
        if line.is_empty() || self.grid.cols == 0 {
            return 0.5;
        }
        let step = 200.0;
        let total = crate::geo::polyline_length(line).max(step);
        let n = ((total / step).ceil() as usize).max(1);
        let mut sum = 0.0;
        let mut seg = 0usize;
        let mut seg_start = 0.0;
        let mut seg_len = if line.len() > 1 {
            line[0].distance_to(&line[1])
        } else {
            0.0
        };
        for i in 0..n {
            let d = (i as f64 + 0.5) * step;
            let p = if line.len() > 1 {
                while d > seg_start + seg_len && seg + 2 < line.len() {
                    seg_start += seg_len;
                    seg += 1;
                    seg_len = line[seg].distance_to(&line[seg + 1]);
                }
                let t = if seg_len < 1e-9 {
                    0.0
                } else {
                    ((d - seg_start) / seg_len).clamp(0.0, 1.0)
                };
                line[seg].lerp(&line[seg + 1], t)
            } else {
                line[0]
            };
            // Residents+jobs per km² in the surrounding cell.
            let (pop, jobs, cell_km2) = self.cell_totals(p);
            let per_km2 = (pop + jobs) / cell_km2;
            // 14 000 per km² is roughly Eimsbüttel — treated as "fully urban".
            sum += (per_km2 / 14_000.0).clamp(0.0, 1.0);
        }
        sum / n as f64
    }

    /// Distance-weighted catchment around a point for the given mode radius.
    ///
    /// Sums the city raster and the regional one. A station in Hamburg draws on
    /// the fine grid; a station near Lüneburg draws on the coarse one; and no
    /// cell is in both.
    pub fn catchment(&self, p: Point, radius: f64, decay: f64) -> Catchment {
        let mut c = self.grid.catchment(p, radius, decay);
        if let Some(region) = &self.region_grid {
            let r = region.catchment(p, radius, decay);
            c.population += r.population;
            c.jobs += r.jobs;
            c.raw_population += r.raw_population;
            c.raw_jobs += r.raw_jobs;
            c.area_km2 += r.area_km2;
        }
        c
    }

    /// Residents and workplaces in the cell containing a point, from whichever
    /// raster covers it.
    fn cell_totals(&self, p: Point) -> (f64, f64, f64) {
        // The fine raster holds only the city itself; around it, inside its
        // square, the towns of the region exist only in the coarse raster.
        let fine = self.grid.population_at(p) + self.grid.jobs_at(p);
        let coarse = self
            .region_grid
            .as_ref()
            .map_or(0.0, |r| r.population_at(p) + r.jobs_at(p));
        if fine > 0.0 || (coarse <= 0.0 && self.grid.covers(p)) {
            let cell_km2 = (self.grid.cell_m * self.grid.cell_m) / 1.0e6;
            return (self.grid.population_at(p), self.grid.jobs_at(p), cell_km2);
        }
        match &self.region_grid {
            Some(r) => {
                let cell_km2 = (r.cell_m * r.cell_m) / 1.0e6;
                (r.population_at(p), r.jobs_at(p), cell_km2)
            }
            None => (0.0, 0.0, 1.0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid() -> DemographicGrid {
        // 4x4 grid of 250 m cells with 1000 residents each.
        DemographicGrid {
            cell_m: 250.0,
            origin_x: 0.0,
            origin_y: 0.0,
            cols: 4,
            rows: 4,
            population: vec![1000.0; 16],
            jobs: vec![500.0; 16],
        }
    }

    #[test]
    fn catchment_decays_with_distance() {
        let g = grid();
        let near = g.catchment(Point::new(500.0, 500.0), 600.0, 1.6);
        assert!(near.population > 0.0);
        assert!(
            near.population < near.raw_population,
            "decay must reduce the weight"
        );
        let tight = g.catchment(Point::new(500.0, 500.0), 200.0, 1.6);
        assert!(tight.population < near.population);
    }

    #[test]
    fn the_regional_raster_extends_the_catchment_without_double_counting() {
        let mut city = CityData::empty();
        city.grid = grid(); // 4x4 cells of 250 m at the origin
                            // A coarse raster covering a town well outside the city grid.
        city.region_grid = Some(DemographicGrid {
            cell_m: 1000.0,
            origin_x: 20_000.0,
            origin_y: 0.0,
            cols: 4,
            rows: 4,
            population: vec![5000.0; 16],
            jobs: vec![900.0; 16],
        });
        city.prepare();

        // Inside the city: only the fine raster contributes.
        let inner = city.catchment(Point::new(500.0, 500.0), 600.0, 1.6);
        assert!(inner.population > 0.0);
        // Out in the region: the coarse raster carries it.
        let outer = city.catchment(Point::new(21_500.0, 1_500.0), 1500.0, 1.6);
        assert!(
            outer.population > 1000.0,
            "regional catchment was {}",
            outer.population
        );
        // And between them, nothing.
        let between = city.catchment(Point::new(12_000.0, 500.0), 800.0, 1.6);
        assert_eq!(between.population, 0.0);
    }

    #[test]
    fn catchment_outside_the_grid_is_empty() {
        let g = grid();
        let c = g.catchment(Point::new(50_000.0, 50_000.0), 800.0, 1.6);
        assert_eq!(c.population, 0.0);
    }

    #[test]
    fn totals_are_consistent() {
        let g = grid();
        assert_eq!(g.total_population(), 16_000.0);
        assert_eq!(g.total_jobs(), 8_000.0);
    }

    #[test]
    fn water_crossing_is_measured() {
        let mut city = CityData::empty();
        city.water.push(WaterBody {
            name: "Testfluss".into(),
            ring: vec![
                Point::new(400.0, -1000.0).to_latlon(),
                Point::new(600.0, -1000.0).to_latlon(),
                Point::new(600.0, 1000.0).to_latlon(),
                Point::new(400.0, 1000.0).to_latlon(),
            ],
            major: true,
        });
        city.prepare();
        let line = vec![Point::new(0.0, 0.0), Point::new(1000.0, 0.0)];
        let wet = city.water_crossing_length(&line);
        assert!(
            (wet - 200.0).abs() < 30.0,
            "expected ~200 m of water, got {wet}"
        );
        assert!(city.crosses_major_water(&line));
        assert!(!city.crosses_major_water(&[Point::new(0.0, 0.0), Point::new(300.0, 0.0)]));
    }

    #[test]
    fn transposed_coordinates_are_caught() {
        let mut city = demo_city_for_validation();
        assert!(city.validate().is_empty(), "the fixture should be clean");
        for st in city.streets.iter_mut() {
            for p in st.geo.iter_mut() {
                std::mem::swap(&mut p.lat, &mut p.lon);
            }
        }
        let problems = city.validate();
        assert!(
            problems.iter().any(|p| p.contains("Straßen")),
            "{problems:?}"
        );
    }

    fn demo_city_for_validation() -> CityData {
        let mut city = CityData::empty();
        city.center = LatLon::new(53.55, 9.99);
        city.grid = grid();
        for i in 0..10 {
            city.streets.push(Street {
                name: format!("Straße {i}"),
                class: 3,
                geo: vec![
                    LatLon::new(53.55 + i as f64 * 0.001, 9.99),
                    LatLon::new(53.55 + i as f64 * 0.001, 10.0),
                ],
            });
        }
        city
    }

    #[test]
    fn a_long_straight_street_is_found_along_its_whole_length() {
        let mut city = CityData::empty();
        // Two vertices, ten kilometres apart — what simplification produces.
        city.streets.push(Street {
            name: "Lange Chaussee".into(),
            class: 3,
            geo: vec![
                Point::new(-5000.0, 0.0).to_latlon(),
                Point::new(5000.0, 0.0).to_latlon(),
            ],
        });
        city.prepare();
        for x in [-4000.0, -1500.0, 0.0, 2500.0, 4800.0] {
            let hit = city.nearest_street(Point::new(x, 30.0), 220.0);
            assert!(hit.is_some(), "no street found at x = {x}");
            assert_eq!(hit.unwrap().0.name, "Lange Chaussee");
        }
        assert!(city.nearest_street(Point::new(0.0, 900.0), 220.0).is_none());
    }

    #[test]
    fn landmark_search_uses_the_index() {
        let mut city = CityData::empty();
        for i in 0..500 {
            city.landmarks.push(Landmark {
                id: format!("l{i}"),
                name: format!("Ort {i}"),
                kind: LandmarkKind::Poi,
                geo: Point::new(i as f64 * 100.0, 0.0).to_latlon(),
                weight: 0.5,
                modes: vec![],
                category: String::new(),
            });
        }
        city.prepare();
        let near = city.landmarks_near(Point::new(1000.0, 0.0), 250.0);
        assert_eq!(near.len(), 5);
        assert_eq!(near[0].0.name, "Ort 10");
        assert!(
            near.windows(2).all(|w| w[0].1 <= w[1].1),
            "results must be sorted by distance"
        );
    }
    /// The scanline fill must agree with the reference test, cell for cell.
    ///
    /// The mask decides whether a line crosses water and how far, which drives
    /// bridges and tunnels and therefore the cost. It was rewritten from
    /// "ask `point_in_ring` for every cell" to a scanline because the old form
    /// was 197 of the 209 ms the engine took to start. A faster mask that
    /// answers differently would be worse than a slow one, so this compares
    /// every cell of a deliberately awkward shape against the rule it replaced.
    #[test]
    fn the_water_mask_matches_a_point_in_ring_test_everywhere() {
        // Concave, with a deep notch and a long thin arm: the shapes where a
        // span fill and a per-point test are most likely to disagree.
        let ring: Vec<Point> = [
            (0.0, 0.0),
            (1000.0, 0.0),
            (1000.0, 400.0),
            (600.0, 400.0),
            (600.0, 100.0),
            (400.0, 100.0),
            (400.0, 400.0),
            (1400.0, 400.0),
            (1400.0, 500.0),
            (0.0, 500.0),
        ]
        .iter()
        .map(|(x, y)| Point::new(*x, *y))
        .collect();
        let body = WaterBody {
            name: "Prüfform".into(),
            ring: ring.iter().map(|p| p.to_latlon()).collect(),
            major: true,
        };
        let cell = 10.0;
        let mask = WaterMask::build(std::slice::from_ref(&body), cell);
        let metric: Vec<Point> = body.ring.iter().map(|p| p.to_metric()).collect();

        let mut checked = 0;
        for r in 0..mask.rows {
            for c in 0..mask.cols {
                let p = Point::new(
                    mask.min_x + (c as f64 + 0.5) * cell,
                    mask.min_y + (r as f64 + 0.5) * cell,
                );
                let expected = point_in_ring(p, &metric);
                let got = mask.cells[r * mask.cols + c] & 1 != 0;
                assert_eq!(
                    got, expected,
                    "Zelle ({c}, {r}) bei ({:.0}, {:.0}): Maske sagt {got}, Punkttest {expected}",
                    p.x, p.y
                );
                checked += 1;
            }
        }
        assert!(checked > 5_000, "nur {checked} Zellen geprüft");
        // And the shape is actually filled, not empty by accident.
        let filled = mask.cells.iter().filter(|v| **v & 1 != 0).count();
        assert!(filled > 1_000, "nur {filled} Zellen als Wasser markiert");
    }
}
