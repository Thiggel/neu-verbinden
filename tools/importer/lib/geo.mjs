// Geometry helpers shared by the importers. Metric plane matches
// rust/core/src/geo.rs exactly so both sides agree on coordinates.
export const EARTH_R = 6371008.8;
const D2R = Math.PI / 180;

// The metric plane is anchored on one point per city, and the engine reads the
// same value out of the dataset. Getting these two out of step would put every
// schematic coordinate somewhere else, so the origin is set once per import
// and never guessed.
let originLat = 53.55034;
let originLon = 9.99247;
let lonScale = EARTH_R * Math.cos(originLat * D2R);

export const ORIGIN_LAT = originLat;
export const ORIGIN_LON = originLon;

export function setOrigin(lat, lon) {
  originLat = lat;
  originLon = lon;
  lonScale = EARTH_R * Math.cos(lat * D2R);
}

export const toMetric = ([lon, lat]) => [
  (lon - originLon) * D2R * lonScale,
  (lat - originLat) * D2R * EARTH_R,
];
export const toGeo = ([x, y]) => [
  originLon + (x / lonScale) / D2R,
  originLat + (y / EARTH_R) / D2R,
];

export function haversine(a, b) {
  const p1 = a[1] * D2R;
  const p2 = b[1] * D2R;
  const dp = p2 - p1;
  const dl = (b[0] - a[0]) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export const lineLength = (pts) => pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);

/** Closest point on a polyline; returns {distance, along, index, t}. */
export function projectOnLine(p, line) {
  let best = null;
  let acc = 0;
  const P = toMetric(p);
  const M = line.map(toMetric);
  for (let i = 0; i < M.length - 1; i++) {
    const [ax, ay] = M[i];
    const [bx, by] = M[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 < 1e-12 ? 0 : ((P[0] - ax) * dx + (P[1] - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const d = Math.hypot(P[0] - qx, P[1] - qy);
    const segLen = Math.sqrt(len2);
    if (!best || d < best.distance) best = { distance: d, along: acc + segLen * t, index: i, t };
    acc += segLen;
  }
  return best;
}

/**
 * Every place where `line` passes within `maxDistance` of `p`.
 *
 * `projectOnLine` answers with the single nearest point, which is the right
 * question for a line that goes somewhere and the wrong one for a line that
 * comes back: Hamburg's U3 leaves Barmbek, runs the whole ring and calls at
 * Barmbek again. Both of its Barmbek stops then projected onto the same pass,
 * were merged as one, and the other pass was left without a stop — a train
 * from Wandsbek-Gartenstadt ran through Barmbek to Dehnhaide on 2.9 km of
 * track that existed twice.
 *
 * A pass is a stretch of consecutive segments that stay within range; each
 * contributes its own nearest point. Sorted by position along the line.
 */
export function projectAllOnLine(p, line, maxDistance) {
  const out = [];
  let run = null;
  let acc = 0;
  const P = toMetric(p);
  const M = line.map(toMetric);
  for (let i = 0; i < M.length - 1; i++) {
    const [ax, ay] = M[i];
    const [bx, by] = M[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 < 1e-12 ? 0 : ((P[0] - ax) * dx + (P[1] - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(P[0] - (ax + dx * t), P[1] - (ay + dy * t));
    const segLen = Math.sqrt(len2);
    if (d <= maxDistance) {
      if (!run || d < run.distance) run = { distance: d, along: acc + segLen * t, index: i, t };
    } else if (run) {
      out.push(run);
      run = null;
    }
    acc += segLen;
  }
  if (run) out.push(run);
  return out;
}

/** Cut a geographic polyline at metric distances measured from its start. */
export function cutLine(line, distances) {
  const M = line.map(toMetric);
  const cuts = [...distances].sort((a, b) => a - b);
  const out = [];
  let current = [M[0]];
  let acc = 0;
  let ci = 0;
  for (let i = 0; i < M.length - 1; i++) {
    const [ax, ay] = M[i];
    const [bx, by] = M[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    while (ci < cuts.length && cuts[ci] <= acc + segLen) {
      const t = segLen < 1e-9 ? 0 : (cuts[ci] - acc) / segLen;
      const q = [ax + (bx - ax) * t, ay + (by - ay) * t];
      current.push(q);
      out.push(current.map(toGeo));
      current = [q];
      ci++;
    }
    current.push([bx, by]);
    acc += segLen;
  }
  out.push(current.map(toGeo));
  return out;
}

/** Douglas–Peucker on geographic coordinates, tolerance in metres. */
export function simplify(line, tolerance) {
  if (line.length < 3) return line;
  const M = line.map(toMetric);
  const keep = new Array(M.length).fill(false);
  keep[0] = keep[M.length - 1] = true;
  const stack = [[0, M.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e <= s + 1) continue;
    let maxD = 0;
    let maxI = s;
    const [ax, ay] = M[s];
    const [bx, by] = M[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = M[i];
      let t = len2 < 1e-12 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tolerance) {
      keep[maxI] = true;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/**
 * Douglas–Peucker for a closed ring, tolerance in metres.
 *
 * Running the open-line version on a ring anchors it on the duplicated
 * first/last vertex, so the whole outline hangs off a single point: narrow
 * inlets collapse into chords and bends get cut across, which visibly moves
 * shorelines and *enlarges* the water. Anchoring on the two points farthest
 * apart and simplifying each arc separately keeps the outline where it is.
 *
 * The tolerance is also capped by the size of the feature — 25 m is fine for
 * the Elbe and far too coarse for a three-hectare pond.
 *
 * Pass `digits` to round the output here rather than afterwards. Rounding is
 * part of the geometry: at five decimals it moves a vertex by up to a metre,
 * which is enough to push two edges that merely came close into an actual
 * crossing. Checked before rounding, the ring is clean and ships broken.
 */
const RING_AREA_ERROR = 0.15;

/**
 * Does a ring cross itself?
 *
 * Douglas–Peucker keeps every simplified arc within the tolerance of the
 * original, which is a promise about distance and not about topology: two arcs
 * that both stayed in bounds can still end up crossing. The result looks like a
 * shoreline that jumps the river and swallows the land behind it — the water
 * body appears to grow, which is exactly the artefact this guards against.
 *
 * Checking the area does not catch it: a crossed ring loses on one side of the
 * knot roughly what it gains on the other, so it passes an area tolerance
 * comfortably while looking obviously wrong.
 */
export function ringSelfIntersects(ring) {
  const n = ring.length;
  if (n < 5) return false;
  const M = ring.map(toMetric);
  const crosses = (p1, p2, p3, p4) => {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
  };
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      // Neighbouring segments share a vertex, and on a closed ring the first
      // and last do too — touching there is the ring closing, not a crossing.
      if (i === 0 && j === n - 2) continue;
      if (crosses(M[i], M[i + 1], M[j], M[j + 1])) return true;
    }
  }
  return false;
}

export function simplifyRing(ring, tolerance, digits = null) {
  const finish = (r) => (digits == null ? r : roundLine(r, digits));
  const closed =
    ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  if (open.length < 5) return finish(ring);

  // Douglas–Peucker moves the outline by up to `t`, so the area it gains or
  // loses is roughly `t × perimeter`. Bounding that by a small share of the
  // area itself keeps narrow canals narrow and stops small ponds inflating.
  const M = open.map(toMetric);
  const area = Math.abs(ringArea(open));
  let perimeter = 0;
  for (let i = 0; i < M.length; i++) {
    const a = M[i];
    const b = M[(i + 1) % M.length];
    perimeter += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  const t = Math.max(0.8, Math.min(tolerance, (RING_AREA_ERROR * area) / Math.max(perimeter, 1)));

  // Two-pass diameter approximation: farthest from the centroid, then
  // farthest from that. Good enough to place the anchors on opposite sides.
  const cx = M.reduce((s, m) => s + m[0], 0) / M.length;
  const cy = M.reduce((s, m) => s + m[1], 0) / M.length;
  const farthest = (fx, fy) => {
    let best = 0;
    let bi = 0;
    for (let i = 0; i < M.length; i++) {
      const d = Math.hypot(M[i][0] - fx, M[i][1] - fy);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    return bi;
  };
  const a = farthest(cx, cy);
  const b = farthest(M[a][0], M[a][1]);
  const [lo, hi] = a < b ? [a, b] : [b, a];

  const arc1 = open.slice(lo, hi + 1);
  const arc2 = open.slice(hi).concat(open.slice(0, lo + 1));

  // Back off until the outline stops crossing itself. Halving converges fast
  // because the artefact needs a long chord to appear at all, and the original
  // ring is the floor: if OSM itself hands over a crossed outline, that is not
  // something simplification can repair, and pretending otherwise would hide
  // it.
  for (let attempt = 0, tol = t; attempt < 6; attempt++, tol /= 2) {
    const s1 = simplify(arc1, tol);
    const s2 = simplify(arc2, tol);
    const out = s1.concat(s2.slice(1, -1));
    if (out.length < 4) break;
    const full = finish(closed ? out.concat([out[0]]) : out);
    if (!ringSelfIntersects(full)) return full;
  }
  // Nothing simplified cleanly. The original outline is always available and
  // always correct, and a few hundred extra vertices on one lake cost less
  // than a shoreline drawn across dry land.
  const plain = finish(ring);
  return ringSelfIntersects(plain) ? ring : plain;
}

export const round = (v, digits = 5) => Number(v.toFixed(digits));
export const roundLine = (line, digits = 5) => line.map(([a, b]) => [round(a, digits), round(b, digits)]);

/** Shoelace area in m² of a geographic ring. */
export function ringArea(ring) {
  const M = ring.map(toMetric);
  let a = 0;
  for (let i = 0; i < M.length; i++) {
    const j = (i + 1) % M.length;
    a += M[i][0] * M[j][1] - M[j][0] * M[i][1];
  }
  return Math.abs(a / 2);
}

export function ringCentroid(ring) {
  const M = ring.map(toMetric);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < M.length; i++) {
    const j = (i + 1) % M.length;
    const f = M[i][0] * M[j][1] - M[j][0] * M[i][1];
    a += f;
    cx += (M[i][0] + M[j][0]) * f;
    cy += (M[i][1] + M[j][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return toGeo(M[0]);
  return toGeo([cx / (3 * a), cy / (3 * a)]);
}

export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Assemble Overpass `out geom` way/relation elements into GeoJSON polygons.
 *
 * An open way is a line, not an area. Closing one "just in case" turns the
 * centreline of the Bille into a lake over Aumühle and the Dove Elbe into an
 * inland sea over Kirchwerder — so open ways are skipped, not repaired.
 */
export function assemblePolygons(elements, { minAreaM2 = 0 } = {}) {
  const polys = [];
  let openSkipped = 0;
  for (const el of elements) {
    if (el.type === 'way' && el.geometry) {
      const ring = el.geometry.map((g) => [g.lon, g.lat]);
      if (ring.length < 4) continue;
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
        openSkipped++;
        continue;
      }
      if (ringArea(ring) < minAreaM2) continue;
      polys.push({ tags: el.tags || {}, id: `w${el.id}`, rings: [ring] });
    } else if (el.type === 'relation' && el.members) {
      const outers = stitch(el.members.filter((m) => m.role !== 'inner' && m.geometry));
      const inners = stitch(el.members.filter((m) => m.role === 'inner' && m.geometry));
      for (const o of outers) {
        if (o.length < 4) continue;
        if (ringArea(o) < minAreaM2) continue;
        const holes = inners.filter((h) => h.length >= 4 && pointInRing(h[0], o));
        polys.push({ tags: el.tags || {}, id: `r${el.id}`, rings: [o, ...holes] });
      }
    }
  }
  if (openSkipped) console.log(`      (${openSkipped} offene Wege übersprungen — Linien, keine Flächen)`);
  return polys;
}

/** Join way fragments into closed rings. */
function stitch(members) {
  const frags = members.map((m) => m.geometry.map((g) => [g.lon, g.lat])).filter((f) => f.length > 1);
  const rings = [];
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const open = [...frags];
  while (open.length) {
    let cur = open.pop();
    let changed = true;
    while (changed && key(cur[0]) !== key(cur.at(-1))) {
      changed = false;
      for (let i = 0; i < open.length; i++) {
        const f = open[i];
        if (key(cur.at(-1)) === key(f[0])) {
          cur = cur.concat(f.slice(1));
        } else if (key(cur.at(-1)) === key(f.at(-1))) {
          cur = cur.concat(f.slice(0, -1).reverse());
        } else if (key(cur[0]) === key(f.at(-1))) {
          cur = f.slice(0, -1).concat(cur);
        } else if (key(cur[0]) === key(f[0])) {
          cur = f.slice(1).reverse().concat(cur);
        } else {
          continue;
        }
        open.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (key(cur[0]) === key(cur.at(-1)) && cur.length >= 4) rings.push(cur);
  }
  return rings;
}

/** Join way fragments into the longest possible continuous lines. */
export function stitchLines(fragments) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const open = fragments.filter((f) => f.length > 1);
  const out = [];
  while (open.length) {
    let cur = open.pop();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < open.length; i++) {
        const f = open[i];
        if (key(cur.at(-1)) === key(f[0])) cur = cur.concat(f.slice(1));
        else if (key(cur.at(-1)) === key(f.at(-1))) cur = cur.concat(f.slice(0, -1).reverse());
        else if (key(cur[0]) === key(f.at(-1))) cur = f.slice(0, -1).concat(cur);
        else if (key(cur[0]) === key(f[0])) cur = f.slice(1).reverse().concat(cur);
        else continue;
        open.splice(i, 1);
        changed = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}
