//! Geographic and metric geometry.
//!
//! The engine keeps two representations of every object (plan §5):
//! a geographic one (WGS84 lat/lon, used for every physical calculation) and a
//! schematic one (metric plane, snapped to a grid and to 45° angles, used for
//! rendering). Both live in the same local metric projection so converting
//! between them is cheap and lossless.

use serde::{Deserialize, Serialize};

/// Mean Earth radius in metres (WGS84 authalic radius).
pub const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// Default projection origin: roughly the Hamburg Rathaus.
///
/// The metric plane is a local equirectangular projection around one point.
/// Within ~60 km of it the error is well under a metre — far below the
/// precision of any of our cost models — but 240 km away, in Berlin, the
/// east-west scale would be out by three per cent. So the origin is a property
/// of the city being modelled, not of the code, and every dataset carries its
/// own. These constants are only the fallback for a network loaded without one.
pub const ORIGIN_LAT: f64 = 53.550_34;
pub const ORIGIN_LON: f64 = 9.992_47;

static DEFAULT_ORIGIN: std::sync::RwLock<(f64, f64)> =
    std::sync::RwLock::new((ORIGIN_LAT, ORIGIN_LON));

thread_local! {
    /// Set while a calculation runs for a specific city. A server holding two
    /// cities at once must not have one process-wide origin — the numbers for
    /// whichever city lost the race would be silently wrong.
    static SCOPED_ORIGIN: std::cell::Cell<Option<(f64, f64)>> =
        const { std::cell::Cell::new(None) };
}

/// The origin in force, as (lat, lon).
#[inline]
pub fn projection_origin() -> (f64, f64) {
    if let Some(o) = SCOPED_ORIGIN.with(|c| c.get()) {
        return o;
    }
    *DEFAULT_ORIGIN.read().unwrap_or_else(|e| e.into_inner())
}

/// Set the origin used when no scope is active.
///
/// This is the browser's and the CLI's case: one process, one city, set once
/// when the dataset is loaded.
pub fn set_projection_origin(lat: f64, lon: f64) {
    if let Ok(mut w) = DEFAULT_ORIGIN.write() {
        *w = (lat, lon);
    }
}

/// Run `f` with the projection pinned to one city.
///
/// Used by anything that may hold more than one city at a time. The previous
/// origin is restored afterwards, including when `f` panics is *not* required
/// here — a panic unwinds out of the request anyway — but restoring keeps
/// nested scopes honest.
pub fn with_origin<T>(lat: f64, lon: f64, f: impl FnOnce() -> T) -> T {
    let previous = SCOPED_ORIGIN.with(|c| c.replace(Some((lat, lon))));
    let out = f();
    SCOPED_ORIGIN.with(|c| c.set(previous));
    out
}

/// A geographic position (WGS84).
///
/// Serialises as `{ "lat": …, "lon": … }` and also accepts the compact GeoJSON
/// form `[lon, lat]`. The compact form matters: a city's worth of street
/// geometry is a third smaller as arrays. Without an explicit implementation
/// serde would read a two-element array into the struct *positionally* — so
/// `[lon, lat]` would silently become `lat = 9.9`, and every spatial query
/// would quietly return nothing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct LatLon {
    pub lat: f64,
    pub lon: f64,
}

impl<'de> Deserialize<'de> for LatLon {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde::de::{self, MapAccess, SeqAccess, Visitor};
        use std::fmt;

        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = LatLon;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("{ lat, lon } or the GeoJSON pair [lon, lat]")
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<LatLon, A::Error> {
                let lon: f64 = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(0, &self))?;
                let lat: f64 = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(1, &self))?;
                Ok(LatLon { lat, lon })
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<LatLon, A::Error> {
                let mut lat = None;
                let mut lon = None;
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "lat" => lat = Some(map.next_value()?),
                        "lon" | "lng" => lon = Some(map.next_value()?),
                        _ => {
                            let _: serde::de::IgnoredAny = map.next_value()?;
                        }
                    }
                }
                Ok(LatLon {
                    lat: lat.ok_or_else(|| de::Error::missing_field("lat"))?,
                    lon: lon.ok_or_else(|| de::Error::missing_field("lon"))?,
                })
            }
        }
        d.deserialize_any(V)
    }
}

impl LatLon {
    pub const fn new(lat: f64, lon: f64) -> Self {
        Self { lat, lon }
    }

    /// Great-circle distance in metres.
    pub fn distance_to(&self, other: &LatLon) -> f64 {
        let (p1, p2) = (self.lat.to_radians(), other.lat.to_radians());
        let dp = p2 - p1;
        let dl = (other.lon - self.lon).to_radians();
        let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
        2.0 * EARTH_RADIUS_M * a.sqrt().asin()
    }

    pub fn to_metric(self) -> Point {
        Point::from_latlon(self)
    }
}

/// A point in the local metric plane. `x` grows east, `y` grows north, metres.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

fn lon_scale() -> f64 {
    EARTH_RADIUS_M * projection_origin().0.to_radians().cos()
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn from_latlon(ll: LatLon) -> Self {
        let (lat0, lon0) = projection_origin();
        Self {
            x: (ll.lon - lon0).to_radians() * lon_scale(),
            y: (ll.lat - lat0).to_radians() * EARTH_RADIUS_M,
        }
    }

    pub fn to_latlon(self) -> LatLon {
        let (lat0, lon0) = projection_origin();
        LatLon {
            lat: lat0 + (self.y / EARTH_RADIUS_M).to_degrees(),
            lon: lon0 + (self.x / lon_scale()).to_degrees(),
        }
    }

    pub fn distance_to(&self, o: &Point) -> f64 {
        ((self.x - o.x).powi(2) + (self.y - o.y).powi(2)).sqrt()
    }

    pub fn sub(&self, o: &Point) -> Point {
        Point::new(self.x - o.x, self.y - o.y)
    }

    pub fn add(&self, o: &Point) -> Point {
        Point::new(self.x + o.x, self.y + o.y)
    }

    pub fn scale(&self, f: f64) -> Point {
        Point::new(self.x * f, self.y * f)
    }

    pub fn length(&self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    pub fn normalized(&self) -> Point {
        let l = self.length();
        if l < 1e-9 {
            Point::new(0.0, 0.0)
        } else {
            self.scale(1.0 / l)
        }
    }

    /// Bearing in degrees, 0 = east, counter-clockwise positive.
    pub fn angle_deg(&self) -> f64 {
        self.y.atan2(self.x).to_degrees()
    }

    pub fn lerp(&self, o: &Point, t: f64) -> Point {
        Point::new(self.x + (o.x - self.x) * t, self.y + (o.y - self.y) * t)
    }
}

/// An axis-aligned bounding box in the metric plane.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bbox {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Bbox {
    pub fn empty() -> Self {
        Self {
            min_x: f64::MAX,
            min_y: f64::MAX,
            max_x: f64::MIN,
            max_y: f64::MIN,
        }
    }

    pub fn from_points(points: &[Point]) -> Self {
        let mut b = Self::empty();
        for p in points {
            b.extend(*p);
        }
        b
    }

    pub fn extend(&mut self, p: Point) {
        self.min_x = self.min_x.min(p.x);
        self.min_y = self.min_y.min(p.y);
        self.max_x = self.max_x.max(p.x);
        self.max_y = self.max_y.max(p.y);
    }

    pub fn is_empty(&self) -> bool {
        self.min_x > self.max_x
    }

    pub fn grow(&self, m: f64) -> Self {
        Self {
            min_x: self.min_x - m,
            min_y: self.min_y - m,
            max_x: self.max_x + m,
            max_y: self.max_y + m,
        }
    }

    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.min_x && p.x <= self.max_x && p.y >= self.min_y && p.y <= self.max_y
    }

    pub fn intersects(&self, o: &Bbox) -> bool {
        self.min_x <= o.max_x
            && o.min_x <= self.max_x
            && self.min_y <= o.max_y
            && o.min_y <= self.max_y
    }

    pub fn center(&self) -> Point {
        Point::new(
            (self.min_x + self.max_x) / 2.0,
            (self.min_y + self.max_y) / 2.0,
        )
    }
}

/// Closest point on segment `a`–`b` to `p`, returned together with the
/// parameter `t ∈ [0,1]` along the segment and the distance.
pub fn project_on_segment(p: Point, a: Point, b: Point) -> (Point, f64, f64) {
    let ab = b.sub(&a);
    let len2 = ab.x * ab.x + ab.y * ab.y;
    if len2 < 1e-12 {
        return (a, 0.0, p.distance_to(&a));
    }
    let t = (((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2).clamp(0.0, 1.0);
    let q = Point::new(a.x + ab.x * t, a.y + ab.y * t);
    (q, t, p.distance_to(&q))
}

/// Result of projecting a point onto a polyline.
#[derive(Debug, Clone, Copy)]
pub struct PolylineProjection {
    pub point: Point,
    /// Index of the segment the projection falls on.
    pub segment: usize,
    /// Parameter within that segment.
    pub t: f64,
    /// Distance from the query point to the polyline, metres.
    pub distance: f64,
    /// Distance from the polyline start to the projection, metres.
    pub along: f64,
}

pub fn project_on_polyline(p: Point, line: &[Point]) -> Option<PolylineProjection> {
    if line.len() < 2 {
        return line.first().map(|a| PolylineProjection {
            point: *a,
            segment: 0,
            t: 0.0,
            distance: p.distance_to(a),
            along: 0.0,
        });
    }
    let mut best: Option<PolylineProjection> = None;
    let mut acc = 0.0;
    for i in 0..line.len() - 1 {
        let (q, t, d) = project_on_segment(p, line[i], line[i + 1]);
        let seg_len = line[i].distance_to(&line[i + 1]);
        if best.map_or(true, |b| d < b.distance) {
            best = Some(PolylineProjection {
                point: q,
                segment: i,
                t,
                distance: d,
                along: acc + seg_len * t,
            });
        }
        acc += seg_len;
    }
    best
}

pub fn polyline_length(points: &[Point]) -> f64 {
    points.windows(2).map(|w| w[0].distance_to(&w[1])).sum()
}

pub fn polyline_length_geo(points: &[LatLon]) -> f64 {
    points.windows(2).map(|w| w[0].distance_to(&w[1])).sum()
}

/// Point at `distance` metres along a polyline (clamped to the ends).
pub fn point_at_distance(points: &[Point], distance: f64) -> Point {
    if points.is_empty() {
        return Point::new(0.0, 0.0);
    }
    if distance <= 0.0 {
        return points[0];
    }
    let mut acc = 0.0;
    for w in points.windows(2) {
        let l = w[0].distance_to(&w[1]);
        if acc + l >= distance {
            let t = if l < 1e-9 { 0.0 } else { (distance - acc) / l };
            return w[0].lerp(&w[1], t);
        }
        acc += l;
    }
    *points.last().unwrap()
}

/// Split a polyline at a distance from its start, returning both halves.
pub fn split_polyline(points: &[Point], distance: f64) -> (Vec<Point>, Vec<Point>) {
    let total = polyline_length(points);
    if points.len() < 2 || distance <= 0.0 {
        return (vec![points[0]; 2.min(points.len())], points.to_vec());
    }
    if distance >= total {
        return (points.to_vec(), vec![*points.last().unwrap(); 2]);
    }
    let mut head = vec![points[0]];
    let mut acc = 0.0;
    let mut idx = 0;
    let mut cut = points[0];
    for i in 0..points.len() - 1 {
        let l = points[i].distance_to(&points[i + 1]);
        if acc + l >= distance {
            let t = if l < 1e-9 { 0.0 } else { (distance - acc) / l };
            cut = points[i].lerp(&points[i + 1], t);
            idx = i;
            break;
        }
        acc += l;
        head.push(points[i + 1]);
    }
    head.push(cut);
    let mut tail = vec![cut];
    tail.extend_from_slice(&points[idx + 1..]);
    (head, tail)
}

/// Segment intersection. Returns the intersection point and both parameters.
pub fn segment_intersection(
    a1: Point,
    a2: Point,
    b1: Point,
    b2: Point,
) -> Option<(Point, f64, f64)> {
    let r = a2.sub(&a1);
    let s = b2.sub(&b1);
    let denom = r.x * s.y - r.y * s.x;
    if denom.abs() < 1e-12 {
        return None; // parallel or collinear
    }
    let qp = b1.sub(&a1);
    let t = (qp.x * s.y - qp.y * s.x) / denom;
    let u = (qp.x * r.y - qp.y * r.x) / denom;
    if (-1e-9..=1.0 + 1e-9).contains(&t) && (-1e-9..=1.0 + 1e-9).contains(&u) {
        Some((
            Point::new(a1.x + r.x * t, a1.y + r.y * t),
            t.clamp(0.0, 1.0),
            u.clamp(0.0, 1.0),
        ))
    } else {
        None
    }
}

/// All intersections between two polylines, with the along-distance on each.
pub fn polyline_intersections(a: &[Point], b: &[Point]) -> Vec<(Point, f64, f64)> {
    let mut out = Vec::new();
    let mut acc_a = 0.0;
    for i in 0..a.len().saturating_sub(1) {
        let la = a[i].distance_to(&a[i + 1]);
        let mut acc_b = 0.0;
        for j in 0..b.len().saturating_sub(1) {
            let lb = b[j].distance_to(&b[j + 1]);
            if let Some((p, t, u)) = segment_intersection(a[i], a[i + 1], b[j], b[j + 1]) {
                out.push((p, acc_a + la * t, acc_b + lb * u));
            }
            acc_b += lb;
        }
        acc_a += la;
    }
    out
}

/// Douglas–Peucker simplification. Used to keep rendering geometry compact.
pub fn simplify(points: &[Point], tolerance: f64) -> Vec<Point> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut stack = vec![(0usize, points.len() - 1)];
    while let Some((s, e)) = stack.pop() {
        if e <= s + 1 {
            continue;
        }
        let mut max_d = 0.0;
        let mut max_i = s;
        for i in s + 1..e {
            let (_, _, d) = project_on_segment(points[i], points[s], points[e]);
            if d > max_d {
                max_d = d;
                max_i = i;
            }
        }
        if max_d > tolerance {
            keep[max_i] = true;
            stack.push((s, max_i));
            stack.push((max_i, e));
        }
    }
    points
        .iter()
        .zip(keep)
        .filter(|(_, k)| *k)
        .map(|(p, _)| *p)
        .collect()
}

/// Replace sharp corners with circular arcs.
///
/// Track does not turn on a point. A polyline drawn between a handful of
/// positions has hard corners that read as "someone joined dots on a map";
/// filleting them with the smallest radius the mode can actually run makes the
/// alignment look — and measure — like real infrastructure.
///
/// * `radius` — the arc radius to aim for, metres.
/// * `max_deviation` — how far the arc may sit from the original corner. This
///   is what keeps a station that sits on a corner still sitting on the track.
/// * `step_deg` — angular sampling of the arc.
pub fn round_corners(
    points: &[Point],
    radius: f64,
    max_deviation: f64,
    step_deg: f64,
) -> Vec<Point> {
    if points.len() < 3 || radius <= 0.0 {
        return points.to_vec();
    }
    let mut out: Vec<Point> = vec![points[0]];
    for i in 1..points.len() - 1 {
        let (a, b, c) = (points[i - 1], points[i], points[i + 1]);
        let u = a.sub(&b);
        let w = c.sub(&b);
        let (lu, lw) = (u.length(), w.length());
        if lu < 1e-6 || lw < 1e-6 {
            continue;
        }
        let u = u.scale(1.0 / lu);
        let w = w.scale(1.0 / lw);
        let cos = (u.x * w.x + u.y * w.y).clamp(-1.0, 1.0);
        let theta = cos.acos(); // interior angle at b
                                // Nearly straight, or a full reversal we cannot fillet sensibly.
        if theta > 174.0_f64.to_radians() || theta < 6.0_f64.to_radians() {
            out.push(b);
            continue;
        }
        let half = theta / 2.0;
        let mut t = radius / half.tan();
        // Never eat more than half of either leg, or adjacent corners collide.
        t = t.min(0.45 * lu).min(0.45 * lw);
        // Keep the arc close to the original corner.
        let deviation_limit = max_deviation / (1.0 / half.sin() - 1.0).max(1e-6);
        let mut r = t * half.tan();
        if r > deviation_limit {
            r = deviation_limit;
            t = r / half.tan();
        }
        if t < 1.0 || r < 1.0 {
            out.push(b);
            continue;
        }
        let p1 = b.add(&u.scale(t));
        let p2 = b.add(&w.scale(t));
        let bisector = u.add(&w).normalized();
        if bisector.length() < 1e-6 {
            out.push(b);
            continue;
        }
        let centre = b.add(&bisector.scale(r / half.sin()));
        let a1 = p1.sub(&centre).angle_deg().to_radians();
        let a2 = p2.sub(&centre).angle_deg().to_radians();
        let mut sweep = a2 - a1;
        while sweep > std::f64::consts::PI {
            sweep -= std::f64::consts::TAU;
        }
        while sweep < -std::f64::consts::PI {
            sweep += std::f64::consts::TAU;
        }
        let steps = ((sweep.abs().to_degrees() / step_deg.max(1.0)).ceil() as usize).max(1);
        out.push(p1);
        for k in 1..steps {
            let ang = a1 + sweep * (k as f64 / steps as f64);
            out.push(Point::new(
                centre.x + r * ang.cos(),
                centre.y + r * ang.sin(),
            ));
        }
        out.push(p2);
    }
    out.push(*points.last().unwrap());
    out.dedup_by(|a, b| a.distance_to(b) < 0.5);
    out
}

/// Signed area of a ring (positive = counter-clockwise).
pub fn ring_area(ring: &[Point]) -> f64 {
    let mut a = 0.0;
    for i in 0..ring.len() {
        let j = (i + 1) % ring.len();
        a += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
    }
    a / 2.0
}

/// Point-in-polygon (ray casting) for a simple ring.
pub fn point_in_ring(p: Point, ring: &[Point]) -> bool {
    let mut inside = false;
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let mut j = n - 1;
    for i in 0..n {
        let (pi, pj) = (ring[i], ring[j]);
        if (pi.y > p.y) != (pj.y > p.y) {
            let x = pi.x + (p.y - pi.y) / (pj.y - pi.y) * (pj.x - pi.x);
            if x > p.x {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

/// Smallest absolute difference between two angles in degrees.
pub fn angle_difference(a: f64, b: f64) -> f64 {
    let mut d = (a - b) % 360.0;
    if d > 180.0 {
        d -= 360.0;
    }
    if d < -180.0 {
        d += 360.0;
    }
    d.abs()
}

/// Interior angle at `b` of the corner a–b–c, in degrees (180° = straight).
pub fn corner_angle(a: Point, b: Point, c: Point) -> f64 {
    let v1 = a.sub(&b);
    let v2 = c.sub(&b);
    let (l1, l2) = (v1.length(), v2.length());
    if l1 < 1e-6 || l2 < 1e-6 {
        return 180.0;
    }
    let cos = ((v1.x * v2.x + v1.y * v2.y) / (l1 * l2)).clamp(-1.0, 1.0);
    cos.acos().to_degrees()
}

/// Radius of the circle through three points. `f64::INFINITY` if collinear.
pub fn curve_radius(a: Point, b: Point, c: Point) -> f64 {
    let ab = a.distance_to(&b);
    let bc = b.distance_to(&c);
    let ca = c.distance_to(&a);
    let area2 = ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).abs();
    if area2 < 1e-6 {
        return f64::INFINITY;
    }
    ab * bc * ca / (2.0 * area2)
}

/// The tightest curve an alignment actually contains, metres.
///
/// Measuring the circumradius of three *consecutive vertices* measures how the
/// line was digitised, not how it was designed: three points two metres apart
/// with half a metre of noise return a radius of three metres, which made the
/// buildability check condemn perfectly ordinary tunnels. Sampling at a fixed
/// chord length instead measures curvature at the scale a train cares about.
///
/// Returns `f64::INFINITY` for a line with no measurable curvature.
pub fn min_curve_radius(points: &[Point], chord_m: f64) -> f64 {
    let total = polyline_length(points);
    let chord = chord_m.max(5.0);
    if points.len() < 3 || total < 2.0 * chord {
        return f64::INFINITY;
    }
    let n = (total / chord).floor() as usize;
    let sampled: Vec<Point> = (0..=n)
        .map(|i| point_at_distance(points, (i as f64) * chord))
        .collect();
    sampled
        .windows(3)
        .map(|w| curve_radius(w[0], w[1], w[2]))
        .fold(f64::INFINITY, f64::min)
}

/// Where along `points` the tightest curve sits, for reporting.
pub fn tightest_curve(points: &[Point], chord_m: f64) -> Option<(f64, Point, f64)> {
    let total = polyline_length(points);
    let chord = chord_m.max(5.0);
    if points.len() < 3 || total < 2.0 * chord {
        return None;
    }
    let n = (total / chord).floor() as usize;
    let mut best: Option<(f64, Point, f64)> = None;
    for i in 0..n.saturating_sub(1) {
        let a = point_at_distance(points, i as f64 * chord);
        let b = point_at_distance(points, (i + 1) as f64 * chord);
        let c = point_at_distance(points, (i + 2) as f64 * chord);
        let r = curve_radius(a, b, c);
        if best.map_or(true, |(br, _, _)| r < br) {
            best = Some((r, b, corner_angle(a, b, c)));
        }
    }
    best
}

pub fn to_metric(points: &[LatLon]) -> Vec<Point> {
    points.iter().map(|p| p.to_metric()).collect()
}

pub fn to_geo(points: &[Point]) -> Vec<LatLon> {
    points.iter().map(|p| p.to_latlon()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinates_read_from_both_forms() {
        let object: LatLon = serde_json::from_str(r#"{"lat":53.55,"lon":9.99}"#).unwrap();
        let pair: LatLon = serde_json::from_str("[9.99, 53.55]").unwrap();
        assert_eq!(object, pair, "the GeoJSON pair is [lon, lat]");
        assert_eq!(object.lat, 53.55);
        assert_eq!(object.lon, 9.99);
        // And the object form is what we write.
        assert_eq!(
            serde_json::to_string(&object).unwrap(),
            r#"{"lat":53.55,"lon":9.99}"#
        );
        // Nested in a list, which is how geometry arrives.
        let line: Vec<LatLon> = serde_json::from_str("[[9.9,53.5],[10.0,53.6]]").unwrap();
        assert_eq!(line[1].lat, 53.6);
        assert!(serde_json::from_str::<LatLon>("[9.99]").is_err());
    }

    #[test]
    fn roundtrip_projection_is_lossless() {
        for (lat, lon) in [(53.55, 9.99), (53.70, 10.20), (53.40, 9.70), (53.80, 10.35)] {
            let ll = LatLon::new(lat, lon);
            let back = ll.to_metric().to_latlon();
            assert!((back.lat - lat).abs() < 1e-9, "lat {} -> {}", lat, back.lat);
            assert!((back.lon - lon).abs() < 1e-9, "lon {} -> {}", lon, back.lon);
        }
    }

    #[test]
    fn metric_distance_matches_haversine_within_a_metre() {
        // Hauptbahnhof -> Altona, roughly 5.6 km.
        let a = LatLon::new(53.5528, 10.0067);
        let b = LatLon::new(53.5525, 9.9350);
        let hav = a.distance_to(&b);
        let met = a.to_metric().distance_to(&b.to_metric());
        assert!((hav - met).abs() < 1.0, "haversine {hav} vs metric {met}");
        assert!(hav > 4500.0 && hav < 5200.0, "unexpected distance {hav}");
    }

    #[test]
    fn projection_onto_polyline() {
        let line = vec![
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            Point::new(100.0, 100.0),
        ];
        let pr = project_on_polyline(Point::new(50.0, 20.0), &line).unwrap();
        assert!((pr.distance - 20.0).abs() < 1e-6);
        assert!((pr.along - 50.0).abs() < 1e-6);
        let pr2 = project_on_polyline(Point::new(130.0, 50.0), &line).unwrap();
        assert!((pr2.distance - 30.0).abs() < 1e-6);
        assert!((pr2.along - 150.0).abs() < 1e-6);
    }

    #[test]
    fn splitting_a_polyline_preserves_total_length() {
        let line = vec![
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            Point::new(100.0, 100.0),
        ];
        let (h, t) = split_polyline(&line, 150.0);
        assert!((polyline_length(&h) - 150.0).abs() < 1e-6);
        assert!((polyline_length(&t) - 50.0).abs() < 1e-6);
        assert_eq!(h.last().unwrap(), t.first().unwrap());
    }

    #[test]
    fn segments_intersect_where_expected() {
        let hit = segment_intersection(
            Point::new(-10.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, -10.0),
            Point::new(0.0, 10.0),
        );
        let (p, t, u) = hit.expect("should intersect");
        assert!(p.x.abs() < 1e-9 && p.y.abs() < 1e-9);
        assert!((t - 0.5).abs() < 1e-9 && (u - 0.5).abs() < 1e-9);
        assert!(segment_intersection(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, 5.0),
            Point::new(10.0, 5.0)
        )
        .is_none());
    }

    #[test]
    fn simplification_keeps_endpoints_and_drops_noise() {
        let line: Vec<Point> = (0..=100)
            .map(|i| Point::new(i as f64 * 10.0, (i % 2) as f64 * 0.4))
            .collect();
        let s = simplify(&line, 2.0);
        assert_eq!(s.first(), line.first());
        assert_eq!(s.last(), line.last());
        assert!(
            s.len() < 5,
            "expected aggressive simplification, got {}",
            s.len()
        );
    }

    #[test]
    fn curve_radius_of_a_right_angle_is_small() {
        let r = curve_radius(
            Point::new(-100.0, 0.0),
            Point::new(0.0, 0.0),
            Point::new(0.0, 100.0),
        );
        assert!(r < 100.0, "radius {r}");
        assert!(curve_radius(
            Point::new(-100.0, 0.0),
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0)
        )
        .is_infinite());
    }

    #[test]
    fn rounding_removes_the_hard_corner() {
        let sharp = vec![
            Point::new(0.0, 0.0),
            Point::new(1000.0, 0.0),
            Point::new(1000.0, 1000.0),
        ];
        assert!(
            corner_angle(sharp[0], sharp[1], sharp[2]) < 91.0,
            "fixture should be a right-angle corner"
        );
        let rounded = round_corners(&sharp, 200.0, 500.0, 8.0);
        assert!(rounded.len() > sharp.len(), "no arc was inserted");
        assert_eq!(rounded.first(), sharp.first(), "the start must not move");
        assert_eq!(rounded.last(), sharp.last(), "the end must not move");
        // No corner anywhere along the result is anything like as tight.
        let sharpest = rounded
            .windows(3)
            .map(|w| corner_angle(w[0], w[1], w[2]))
            .fold(180.0_f64, f64::min);
        assert!(
            sharpest > 150.0,
            "sharpest corner after rounding is {sharpest}°"
        );
        // The arc itself has the radius we asked for.
        let mid = rounded.len() / 2;
        let r = curve_radius(rounded[mid - 1], rounded[mid], rounded[mid + 1]);
        assert!(
            (r - 200.0).abs() < 20.0,
            "arc radius is {r}, expected about 200"
        );
    }

    #[test]
    fn rounding_leaves_a_straight_line_alone() {
        let straight = vec![
            Point::new(0.0, 0.0),
            Point::new(500.0, 0.0),
            Point::new(1000.0, 0.0),
        ];
        let rounded = round_corners(&straight, 200.0, 500.0, 8.0);
        assert_eq!(
            rounded, straight,
            "a straight line must come back unchanged"
        );
    }

    #[test]
    fn rounding_respects_the_deviation_cap() {
        let sharp = vec![
            Point::new(0.0, 0.0),
            Point::new(1000.0, 0.0),
            Point::new(1000.0, 1000.0),
        ];
        let corner = sharp[1];
        for cap in [5.0, 25.0, 100.0] {
            let rounded = round_corners(&sharp, 400.0, cap, 8.0);
            let nearest = rounded
                .iter()
                .map(|p| p.distance_to(&corner))
                .fold(f64::INFINITY, f64::min);
            assert!(
                nearest <= cap + 1.0,
                "cap {cap} m, but the track is {nearest} m from the corner"
            );
        }
    }

    #[test]
    fn rounding_never_overruns_a_short_leg() {
        // A long leg, a very short one, then long again: the fillets must not
        // consume the short leg or the geometry folds back on itself.
        let pts = vec![
            Point::new(0.0, 0.0),
            Point::new(1000.0, 0.0),
            Point::new(1040.0, 60.0),
            Point::new(1040.0, 1000.0),
        ];
        let rounded = round_corners(&pts, 300.0, 200.0, 8.0);
        let total = polyline_length(&rounded);
        assert!(
            total > 1500.0 && total < polyline_length(&pts) + 50.0,
            "length {total}"
        );
        assert!(rounded.windows(2).all(|w| w[0].distance_to(&w[1]) > 0.0));
    }

    #[test]
    fn rounding_shortens_slightly_and_stays_close() {
        let pts = vec![
            Point::new(0.0, 0.0),
            Point::new(2000.0, 0.0),
            Point::new(2000.0, 2000.0),
        ];
        let rounded = round_corners(&pts, 300.0, 200.0, 6.0);
        let before = polyline_length(&pts);
        let after = polyline_length(&rounded);
        assert!(
            after < before,
            "a fillet cuts the corner: {after} vs {before}"
        );
        assert!(
            after > before * 0.9,
            "but only slightly: {after} vs {before}"
        );
    }

    #[test]
    fn point_in_ring_works() {
        let ring = vec![
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            Point::new(100.0, 100.0),
            Point::new(0.0, 100.0),
        ];
        assert!(point_in_ring(Point::new(50.0, 50.0), &ring));
        assert!(!point_in_ring(Point::new(150.0, 50.0), &ring));
        assert!(ring_area(&ring) > 0.0);
    }
}
