// Turn OpenStreetMap route relations into the domain network graph:
// stations become nodes, the track between consecutive stations becomes an
// edge, and a line is the ordered list of those edges. Lines that use the same
// physical track share the same edge, which is what gives the engine shared
// infrastructure, branches and interchanges for free.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, indexElements, writeJson } from './overpass.mjs';
import { loadCity } from './lib/city.mjs';
import {
  haversine, projectOnLine, cutLine, simplify, stitchLines, roundLine, round, lineLength, setOrigin,
} from './lib/geo.mjs';

/** Point halfway along a polyline by length, robust to differing vertex counts. */
function midpointByLength(line) {
  const half = lineLength(line) / 2;
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const l = haversine(line[i], line[i + 1]);
    if (acc + l >= half) {
      const t = l < 1e-9 ? 0 : (half - acc) / l;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
    }
    acc += l;
  }
  return line.at(-1);
}

const CITY = await loadCity();
// Everything below works in this city's metric plane.
setOrigin(CITY.projectionOrigin.lat, CITY.projectionOrigin.lon);
/** Station names are often prefixed with the city; that prefix is noise. */
const CITY_PREFIX = new RegExp(`^${CITY.name}[\\s-]+`, 'i');

const LINE_COLORS = {
  hamburg: {
    U1: '#0075BF', U2: '#EC1C24', U3: '#FFDD00', U4: '#00A5A8', U5: '#8B5CF6',
    S1: '#008B3C', S2: '#9B2C7E', S3: '#722581', S5: '#E30613', S6: '#0075BF',
    S7: '#F29400', S11: '#008B3C', S21: '#9B2C7E', S31: '#722581', S4: '#00A0DE',
    A1: '#009EE0', A2: '#009EE0', A3: '#009EE0',
  },
  // The BVG's own line colours, as used on every Berlin network map.
  berlin: {
    U1: '#7DAD4C', U2: '#DA421E', U3: '#16683D', U4: '#F0D722', U5: '#7E5330',
    U6: '#8C6DAB', U7: '#528DBA', U8: '#224F86', U9: '#F3791D',
    S1: '#DE4DA4', S2: '#005F27', S25: '#005F27', S26: '#005F27',
    S3: '#0A4D9C', S5: '#FF5900', S7: '#7E5AA6', S75: '#7E5AA6',
    S8: '#55A822', S85: '#55A822', S9: '#992746',
    S41: '#A23B1E', S42: '#BC5B1F', S45: '#CD9C53', S46: '#CD9C53', S47: '#CD9C53',
  },
}[CITY.id] ?? {};

const MODE_OF = { subway: 'ubahn', light_rail: 'sbahn', train: 'sbahn', tram: 'tram' };

const rawPrefix = CITY.id === 'hamburg' ? '' : `${CITY.id}-`;
const raw = JSON.parse(
  await readFile(resolve(ROOT, `data/raw/${rawPrefix}transit-routes.normalized.json`), 'utf8')
);
const stationDump = await (async () => {
  const dir = await readdir(resolve(ROOT, 'data/raw'));
  // The normalised file, not the raw Overpass cache next to it.
  const name = CITY.id === 'hamburg' ? 'stations.json' : `${CITY.id}-stations.json`;
  if (!dir.includes(name)) throw new Error(`data/raw/${name} fehlt — erst das fetch-Skript laufen lassen`);
  return JSON.parse(await readFile(resolve(ROOT, 'data/raw', name), 'utf8'));
})();
const { nodes, ways, rels } = indexElements(raw);

const nodeCoord = (id) => {
  const n = nodes.get(id);
  return n ? [n.lon, n.lat] : null;
};

// Many stop_position nodes carry no name; the name lives on the neighbouring
// station/halt/platform object. Build a lookup of every named transit object in
// the dump so an unnamed stop can borrow the closest one.
const namedStops = [];
for (const n of nodes.values()) {
  const t = n.tags || {};
  const name = t.name || t['name:de'];
  if (!name) continue;
  if (
    /^(station|halt|tram_stop)$/.test(t.railway || '') ||
    /^(station|stop_position|platform)$/.test(t.public_transport || '')
  ) {
    namedStops.push({ name, lon: n.lon, lat: n.lat });
  }
}
for (const w of ways.values()) {
  const t = w.tags || {};
  const name = t.name || t['name:de'];
  if (!name) continue;
  if (!/^(platform)$/.test(t.public_transport || '') && !/^(platform)$/.test(t.railway || '')) continue;
  const pts = (w.nodes ?? []).map(nodeCoord).filter(Boolean);
  if (!pts.length) continue;
  const mid = pts[Math.floor(pts.length / 2)];
  namedStops.push({ name, lon: mid[0], lat: mid[1] });
}

// Rail/metro station objects from a dedicated Overpass query, ranked so a
// railway=station beats a tram_stop when both are in range.
const stationRank = (t) =>
  t.railway === 'station' || t.public_transport === 'station' ? 0 : t.railway === 'halt' ? 1 : 2;
for (const e of stationDump.elements) {
  namedStops.push({ name: e.name, lon: e.lon, lat: e.lat, rank: stationRank(e.tags || {}) });
}

/**
 * The station object OSM considers canonical for this stop.
 *
 * A stop_position sits wherever the platform happens to start on one
 * particular track, which can be well over a hundred metres from the station
 * itself. The railway=station object is the real anchor.
 */
function canonicalStation(osmNode) {
  let best = null;
  for (const c of namedStops) {
    if ((c.rank ?? 3) > 1) continue; // stations and halts only
    const d = haversine([osmNode.lon, osmNode.lat], [c.lon, c.lat]);
    if (d > 400) continue;
    const score = (c.rank ?? 3) * 200 + d;
    if (!best || score < best.score) best = { lon: c.lon, lat: c.lat, name: c.name, score };
  }
  return best;
}

/** Whether two route members stand for the same stop. */
function samePlace(a, b) {
  const name = (n) => baseName(resolveName(n) || '').toLowerCase();
  const na = name(a);
  const nb = name(b);
  if (na && nb) return na === nb;
  // Without a name to go on, position is all there is.
  return haversine([a.lon, a.lat], [b.lon, b.lat]) < 60;
}

function resolveName(osmNode) {
  const own = osmNode.tags?.name || osmNode.tags?.['name:de'];
  if (own) return own;
  let best = null;
  for (const c of namedStops) {
    const d = haversine([osmNode.lon, osmNode.lat], [c.lon, c.lat]);
    if (d > 400) continue;
    // Prefer a proper station object, then proximity.
    const score = (c.rank ?? 3) * 200 + d;
    if (!best || score < best.score) best = { name: c.name, score };
  }
  return best?.name ?? 'Ohne Namen';
}

/** Ordered stop nodes of a route relation. */
function routeStops(rel) {
  const out = [];
  for (const m of rel.members) {
    if (m.type !== 'node') continue;
    if (!/^(stop|stop_entry_only|stop_exit_only)$/.test(m.role || '')) continue;
    const n = nodes.get(m.ref);
    if (!n) continue;
    out.push(n);
  }
  if (out.length) return out;
  // Fall back to platforms if the relation has no stop_positions.
  for (const m of rel.members) {
    if (!/^(platform|platform_entry_only|platform_exit_only)$/.test(m.role || '')) continue;
    if (m.type === 'node') {
      const n = nodes.get(m.ref);
      if (n) out.push(n);
    }
  }
  return out;
}

/**
 * Continuous track geometry of a route relation.
 *
 * The member ways rarely form one unbroken chain: a relation can have a gap at
 * a junction, a missing short connector, or a turning loop mapped separately.
 * Keeping only the longest connected piece — which is what this did — threw the
 * rest of the line away, and the stops out on the discarded parts then sat
 * kilometres from the geometry and were dropped in silence. Berlin's tram 63
 * came out with 16 of its 27 stops that way, and the shortened line was blamed
 * on OpenStreetMap.
 *
 * So the pieces are chained end to end instead, nearest endpoints first, as
 * long as the gap between them is small enough to be a mapping seam rather than
 * a different part of the city. In Berlin the eleven real gaps run from a few
 * metres to 59 m, so the limit sits well above them and still nowhere near a
 * distance that could draw a line straight across a block. `gaps` reports what
 * had to be bridged and what was left over, so a genuinely broken relation
 * still says so.
 */
const MAX_BRIDGE_M = 150;

function routeGeometry(rel, gaps) {
  const frags = [];
  for (const m of rel.members) {
    if (m.type !== 'way' || (m.role || '') !== '') continue;
    const w = ways.get(m.ref);
    if (!w?.nodes) continue;
    const pts = w.nodes.map(nodeCoord).filter(Boolean);
    if (pts.length > 1) frags.push(pts);
  }
  const stitched = stitchLines(frags).sort((a, b) => b.length - a.length);
  if (stitched.length <= 1) return stitched[0] ?? [];

  let chain = stitched.shift();
  for (;;) {
    // The piece that comes closest to either end of what we have so far.
    let best = null;
    for (let i = 0; i < stitched.length; i++) {
      const f = stitched[i];
      const options = [
        { d: haversine(chain.at(-1), f[0]), at: 'end', flip: false },
        { d: haversine(chain.at(-1), f.at(-1)), at: 'end', flip: true },
        { d: haversine(chain[0], f.at(-1)), at: 'start', flip: false },
        { d: haversine(chain[0], f[0]), at: 'start', flip: true },
      ];
      for (const o of options) {
        if (!best || o.d < best.d) best = { ...o, i };
      }
    }
    if (!best || best.d > MAX_BRIDGE_M) break;
    const [f] = stitched.splice(best.i, 1);
    const piece = best.flip ? f.slice().reverse() : f;
    chain = best.at === 'end' ? chain.concat(piece) : piece.concat(chain);
    if (gaps && best.d > 1) gaps.bridged.push(Math.round(best.d));
  }
  if (gaps) gaps.leftover = stitched.length;
  return chain;
}

/** Normalise station names so the two halves of a complex merge into one node. */
function baseName(name) {
  return (name || '')
    // "Hamburg Hauptbahnhof" and "Hauptbahnhof Süd" are the same complex.
    .replace(CITY_PREFIX, '')
    .replace(/^[US]\s+/, '')
    // Any trailing parenthetical, not a fixed list of them.
    //
    // The list used to be (Nord|Süd|Ost|West|oben|unten|U|S), which left Berlin
    // with five separate "Ostkreuz" nodes — (Ringbahn), (Ringbahn-F), (Ostbahn)
    // and two plain ones, two of them at *identical* coordinates. A parenthesis
    // after a station name says which platform or which line; it does not say
    // which station. The 450 m radius is what keeps this honest: two stops that
    // share a name and are further apart than that stay separate.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+(Nord|Süd|Ost|West)$/i, (m, g) => (/hauptbahnhof|bahnhof$/i.test(name.replace(m, '')) ? '' : m))
    .trim();
}

/** Prefer the shorter, cleaner spelling as the display name. */
function betterName(a, b) {
  if (!a) return b;
  if (!b) return a;
  const score = (n) => n.length + (CITY_PREFIX.test(n) ? 40 : 0) + (/\(/.test(n) ? -5 : 0);
  return score(b) < score(a) ? b : a;
}

// ---------------------------------------------------------------------------
// 1. Collect route variants and pick the canonical one per line.
// ---------------------------------------------------------------------------

const variants = new Map(); // ref -> [{rel, stops, geometry}]
const allBridged = [];
let leftoverFrags = 0;
for (const rel of rels.values()) {
  const t = rel.tags || {};
  const ref = t.ref;
  const mode = MODE_OF[t.route];
  if (!ref || !mode) continue;
  const stops = routeStops(rel);
  const gaps = { bridged: [], leftover: 0 };
  const geometry = routeGeometry(rel, gaps);
  if (gaps.bridged.length) allBridged.push(...gaps.bridged);
  if (gaps.leftover) leftoverFrags += gaps.leftover;
  if (stops.length < 2 || geometry.length < 2) continue;
  if (!variants.has(ref)) variants.set(ref, []);
  variants.get(ref).push({ rel, stops, geometry, mode, tags: t, gaps });
}

// ---------------------------------------------------------------------------
// 2. Build a shared station node table.
// ---------------------------------------------------------------------------

const stations = []; // {id, name, lon, lat, modes:Set, osm:Set}
const stationByKey = new Map();

function stationFor(osmNode, mode, at) {
  const name = resolveName(osmNode);
  const base = baseName(name);
  const coord = at ?? [osmNode.lon, osmNode.lat];
  // Merge into an existing station with the same base name close enough to be
  // the same complex (Hauptbahnhof Nord/Süd, Jungfernstieg U/S, …).
  let best = null;
  for (const s of stations) {
    if (s.base !== base) continue;
    const d = haversine(coord, [s.lon, s.lat]);
    if (d < 450 && (!best || d < best.d)) best = { s, d };
  }
  if (best) {
    best.s.modes.add(mode);
    best.s.osm.add(osmNode.id);
    best.s.members.push(coord);
    best.s.name = betterName(best.s.name, name);
    return best.s;
  }
  const s = {
    id: `st-${stations.length + 1}`,
    name: base || name,
    base,
    lon: coord[0],
    lat: coord[1],
    modes: new Set([mode]),
    osm: new Set([osmNode.id]),
    members: [coord],
  };
  stations.push(s);
  stationByKey.set(s.id, s);
  return s;
}

// ---------------------------------------------------------------------------
// 3. Build edges per line, reusing shared track.
// ---------------------------------------------------------------------------

const edges = [];
const edgeIndex = new Map(); // `${a}|${b}|${mode}` -> [edge]
const lines = [];
/** Lines whose relation declares termini we did not reach. */
const truncated = [];

const sortedRefs = [...variants.keys()].sort((a, b) => {
  const rank = (r) => (r[0] === 'U' ? 0 : r[0] === 'S' ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b, 'de', { numeric: true });
});

for (const ref of sortedRefs) {
  const vs = variants.get(ref);
  // Longest variant first: it becomes the trunk, later variants that add track
  // of their own become explicit branch lines (S1 to the airport, U1 short
  // workings, …). Variants that only run the other way round add no new edge
  // and are dropped.
  vs.sort((a, b) => b.stops.length - a.stops.length || b.geometry.length - a.geometry.length);
  let branchIndex = 0;

  for (const v of vs) {
    const mode = v.mode;

    // Project every stop onto the route geometry to obtain its order.
    // Position each stop by projecting the canonical station object onto this
    // route's own track: accurate to the real station, and still exactly on the
    // line so the map shows no kink.
    let droppedStops = 0;
    const droppedNames = [];
    const projected = v.stops
      .map((n) => {
        const canon = canonicalStation(n);
        const anchor = canon ? [canon.lon, canon.lat] : [n.lon, n.lat];
        let pr = projectOnLine(anchor, v.geometry);
        if (!pr || pr.distance > 400) pr = projectOnLine([n.lon, n.lat], v.geometry);
        if (!pr || pr.distance > 400) {
          droppedStops++;
          droppedNames.push(`${n.tags?.name ?? n.name ?? '?'}${pr ? ` (${pr.distance.toFixed(0)} m)` : ' (gar nicht)'}`);
          return null;
        }
        const seg = v.geometry[pr.index];
        const nxt = v.geometry[pr.index + 1];
        const at = [seg[0] + (nxt[0] - seg[0]) * pr.t, seg[1] + (nxt[1] - seg[1]) * pr.t];
        return { node: n, along: pr.along, at };
      })
      .filter(Boolean)
      .sort((a, b) => a.along - b.along);

    // A route relation lists a stop node and a platform way for the same place,
    // so two entries 60 m apart along the track are normally one stop. But
    // where the geometry ends before the last stop, both of the final stops
    // project onto the same end point — and dropping one of them as a duplicate
    // costs the line its terminus. Berlin's tram 16 ended at Traveplatz instead
    // of Frankfurter Allee for exactly that reason. So closeness alone is not
    // enough: they also have to be the same place by name.
    const seq = [];
    for (const p of projected) {
      const prev = seq.at(-1);
      if (prev && p.along - prev.along < 60 && samePlace(p.node, prev.node)) continue;
      seq.push(p);
    }
    if (seq.length < 2) continue;

    const head = seq[0].along;
    const tail = seq.at(-1).along;
    const trimmed = cutLine(v.geometry, [head, tail]);
    const spine = trimmed[1] ?? v.geometry;
    const innerCuts = seq.slice(1, -1).map((p) => p.along - head);
    const segs = innerCuts.length ? cutLine(spine, innerCuts) : [spine];

    const stationNodes = seq.map((p) => stationFor(p.node, mode, p.at));
    const lineEdges = [];
    let created = 0;
    for (let i = 0; i < stationNodes.length - 1; i++) {
      const a = stationNodes[i];
      const b = stationNodes[i + 1];
      if (a.id === b.id) continue;
      let geom = simplify(segs[i] ?? [[a.lon, a.lat], [b.lon, b.lat]], 8);
      if (geom.length < 2) geom = [[a.lon, a.lat], [b.lon, b.lat]];
      geom = [[a.lon, a.lat], ...geom.slice(1, -1), [b.lon, b.lat]];

      const key = [a.id, b.id].sort().join('|') + '|' + mode;
      const candidates = edgeIndex.get(key) ?? [];
      const mid = midpointByLength(geom);
      const shared = candidates.find((e) => haversine(mid, midpointByLength(e.geo)) < 150);
      if (shared) {
        lineEdges.push(shared.id);
        shared.lines.add(ref);
        continue;
      }
      const edge = {
        id: `e-${edges.length + 1}`,
        from: a.id,
        to: b.id,
        mode,
        geo: geom,
        lengthM: Math.round(geom.slice(1).reduce((s, p, k) => s + haversine(geom[k], p), 0)),
        lines: new Set([ref]),
        tunnel: false,
      };
      edges.push(edge);
      candidates.push(edge);
      edgeIndex.set(key, candidates);
      lineEdges.push(edge.id);
      created++;
    }

    const isTrunk = branchIndex === 0;
    // A later variant only earns its own line entry if it opens up track the
    // trunk does not already cover — that is exactly what a branch is.
    if (!isTrunk && created === 0) continue;

    const from = stationNodes[0].name;
    const to = stationNodes.at(-1).name;
    // The relation says where it runs from and to. When the stations we built
    // do not reach those, the relation is incomplete — Berlin's U6, for
    // instance, is tagged Alt-Tegel–Alt-Mariendorf but its members stop five
    // stations short. Better to say so than to publish a shortened line in
    // silence.
    if (isTrunk) {
      // "S+U Warschauer Straße" and "Wandsbek-Gartenstadt" are the same places
      // as "Warschauer Straße" and "Wandsbek Gartenstadt", and the tags are not
      // always in the direction we built. Only a genuinely different terminus
      // should be reported.
      // Berlin qualifies stop names with the district ("Weißensee,
      // Pasedagplatz") and with parentheses ("Hennigsdorf (bei Berlin)"), and
      // prefixes interchanges with "S+U". None of that makes it a different
      // place, so the comparison is on the bare name, and a match counts if
      // one contains the other.
      const key = (n) =>
        baseName(String(n))
          .replace(/^(S\+U|U\+S|[US])\s+/i, '')
          .replace(/^[^,]+,\s*/, '')
          .replace(/\s*\([^)]*\)\s*/g, '')
          .toLowerCase()
          .replace(/[\s-]+/g, '');
      const declared = [v.tags.from, v.tags.to].filter(Boolean).map(key);
      // Against *every* station on the line, not just its two ends.
      //
      // A relation regularly carries stops beyond the terminus it advertises:
      // the turning loop past the last platform (tram 16 ends at Frankfurter
      // Allee and carries on to Traveplatz), or an extension the from/to tag
      // has not caught up with (M5 and M8 now run past Hauptbahnhof). Comparing
      // only the ends called all of those "the relation is incomplete" and sent
      // people to fix OpenStreetMap where OpenStreetMap was right. What matters
      // is whether the declared terminus is served at all.
      const served = stationNodes.map((n) => key(n.name));
      const matches = (d) => served.some((b) => b === d || b.includes(d) || d.includes(b));
      if (declared.length === 2 && declared.some((d) => !matches(d))) {
        // Two different things look alike here, and calling both "the relation
        // is incomplete" sent people to fix OpenStreetMap where OpenStreetMap
        // was right. What we can actually tell apart:
        //
        //  * we built fewer stops than the relation lists — then either the
        //    relation stops short of its own tag, or we lost some;
        //  * we built every stop it lists and still ended somewhere else —
        //    then the members and the from/to tag disagree, and it is usually
        //    the tag that is out of date (Berlin's M1 has run to Museumsinsel
        //    since 2023; its tag still says Am Kupfergraben).
        const missing = declared
          .map((d, i) => (matches(d) ? null : [v.tags.from, v.tags.to][i]))
          .filter(Boolean);
        truncated.push(
          `${ref}: ${from} – ${to}; nicht bedient: ${missing.join(', ')}` +
          `  [${v.stops.length} Halte in der Relation, ${stationNodes.length} gebaut` +
          (droppedStops ? `, ${droppedStops} zu weit von der Trasse: ${droppedNames.slice(0, 4).join(', ')}` : '') +
          ']'
        );
      }
    }
    lines.push({
      id: isTrunk ? `line-${ref}` : `line-${ref}-b${branchIndex}`,
      label: ref,
      name: `${from} – ${to}`,
      mode,
      color: LINE_COLORS[ref] ?? v.tags.colour ?? '#666666',
      edges: lineEdges,
      operator: v.tags.operator ?? '',
      osmId: v.rel.id,
      branch: !isTrunk,
      ...(isTrunk ? {} : { parent: `line-${ref}` }),
    });
    branchIndex++;
  }
}

// ---------------------------------------------------------------------------
// 4. Detect which edges are in tunnel, from the underlying OSM ways.
// ---------------------------------------------------------------------------

const tunnelSegments = [];
for (const w of ways.values()) {
  if (!w.tags?.tunnel || w.tags.tunnel === 'no') continue;
  const pts = (w.nodes ?? []).map(nodeCoord).filter(Boolean);
  if (pts.length > 1) tunnelSegments.push(pts);
}
for (const e of edges) {
  const mid = midpointByLength(e.geo);
  e.tunnel = tunnelSegments.some((t) => {
    const pr = projectOnLine(mid, t);
    return pr && pr.distance < 40;
  });
}

// ---------------------------------------------------------------------------
// 5. Emit.
// ---------------------------------------------------------------------------

const out = {
  metadata: {
    source: 'OpenStreetMap contributors, via Overpass API',
    licence: 'ODbL 1.0',
    retrieved: new Date().toISOString().slice(0, 10),
  },
  stations: stations.map((s) => ({
    id: s.id,
    name: s.name,
    lon: round(s.lon),
    lat: round(s.lat),
    modes: [...s.modes].sort(),
    osmIds: [...s.osm],
  })),
  edges: edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    mode: e.mode,
    tunnel: e.tunnel,
    lengthM: e.lengthM,
    lines: [...e.lines].sort(),
    geo: roundLine(e.geo),
  })),
  lines,
};

// A station drawn 150 m from where it is reads as a bug to anyone who knows
// the city, so the placement is measured rather than assumed.
{
  // All candidates per name, not just the first: the station dump covers the
  // whole region, and station names repeat across it. Comparing against the
  // nearest namesake measures placement; comparing against an arbitrary one
  // measures how far apart two towns are.
  const canon = new Map();
  for (const e of stationDump.elements) {
    const t = e.tags ?? {};
    if (t.railway === 'station' || t.public_transport === 'station') {
      if (!canon.has(e.name)) canon.set(e.name, []);
      canon.get(e.name).push([e.lon, e.lat]);
    }
  }
  const errors = stations
    .map((s) => {
      const cs = canon.get(s.name);
      if (!cs?.length) return null;
      const d = Math.min(...cs.map((c) => haversine([s.lon, s.lat], c)));
      // Beyond a couple of kilometres it is a different place with the same
      // name (Berlin's "Sportforum" tram stop against a station 145 km away),
      // not a misplaced station.
      return d > 2_000 ? null : { d, name: s.name };
    })
    .filter(Boolean)
    .sort((a, b) => a.d - b.d);
  if (allBridged.length) {
    const srt = allBridged.slice().sort((a, b) => a - b);
    console.log(
      `  ${allBridged.length} Lücke(n) in Relationsgeometrien überbrückt: ` +
        `Median ${srt[Math.floor(srt.length / 2)]} m, größte ${srt.at(-1)} m` +
        (leftoverFrags ? `; ${leftoverFrags} Bruchstück(e) blieben unverbunden` : '')
    );
  }
  if (truncated.length) {
    console.log(
      `  ! ${truncated.length} Linie(n) bedienen einen in from/to genannten Endpunkt gar nicht — ` +
        'entweder ist die Relation dort unvollständig oder das Tag ist veraltet:'
    );
    for (const t of truncated) console.log(`      ${t}`);
  }
  const far = errors.filter((e) => e.d > 300);
  if (far.length) {
    console.log(
      `  ! ${far.length} Station(en) weit von ihrem Namensgeber: ` +
        far.slice(-3).map((e) => `${e.name} (${e.d.toFixed(0)} m)`).join(', ')
    );
  }
  if (errors.length) {
    const median = errors[Math.floor(errors.length / 2)].d;
    const p90 = errors[Math.floor(errors.length * 0.9)].d;
    console.log(
      `  Lagegenauigkeit gegen die OSM-Stationsobjekte: Median ${median.toFixed(0)} m, ` +
        `p90 ${p90.toFixed(0)} m, max ${errors.at(-1).d.toFixed(0)} m (${errors.length} Stationen)`
    );
    if (median > 40) {
      console.error('  ! Die Stationen liegen im Mittel zu weit daneben.');
      process.exitCode = 1;
    }
    for (const e of errors.slice(-3).filter((e) => e.d > 200)) {
      console.warn(`    ? ${e.name}: ${e.d.toFixed(0)} m`);
    }
  }
}

await writeJson(`data/raw/${rawPrefix}network.osm.json`, out);

const byMode = {};
for (const e of edges) byMode[e.mode] = (byMode[e.mode] ?? 0) + e.lengthM;
console.log(`  ${lines.length} Linien, ${stations.length} Stationen, ${edges.length} Kanten`);
for (const [m, l] of Object.entries(byMode)) console.log(`    ${m}: ${(l / 1000).toFixed(1)} km`);
console.log(`    Umsteigebahnhöfe: ${stations.filter((s) => s.modes.size > 1).length}`);
console.log(`    Tunnelkanten: ${edges.filter((e) => e.tunnel).length}`);
for (const l of lines)
  console.log(
    `    ${l.label.padEnd(4)}${l.branch ? '*' : ' '} ${String(l.edges.length + 1).padStart(3)} Halte  ${l.name}`
  );
