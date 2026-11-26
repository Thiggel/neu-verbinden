// Resolve the curated project definitions against the OSM data of this vintage.
//
// Station names are curated (they come from the published project documents);
// coordinates are *not* typed in by hand — they are geocoded against the
// landmarks, places and street corridors of the same data version, so the
// projects stay consistent with the base data and move with it.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, writeJson } from './overpass.mjs';
import { haversine, projectOnLine, cutLine, simplify, stitchLines, roundLine, round, lineLength } from './lib/geo.mjs';
import { buildStreetGraph } from './lib/streetgraph.mjs';
import { loadCity, rawName, distName } from './lib/city.mjs';
import { readdir } from 'node:fs/promises';

const CITY = await loadCity();
const DATA_VERSION = '2026-09';

// Every path here used to name Hamburg's files outright, so running this for
// another city silently resolved that city's project list against Hamburg's
// map. It is now the same city throughout, and a city without a curated list
// produces an empty result rather than someone else's.
const rawFiles = await readdir(resolve(ROOT, 'data/raw'));
const rawIndex = await readFile(resolve(ROOT, 'data/raw/index.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => ({}));
/** The cached response for a dataset of this city, as the current query left it. */
const rawFile = (name) => {
  const prefixed = rawName(CITY, name);
  const indexed = rawIndex[prefixed];
  if (indexed && rawFiles.includes(indexed)) return `data/raw/${indexed}`;
  const f = rawFiles.find((x) => x.startsWith(prefixed + '.') && x.endsWith('.json'));
  return f ? `data/raw/${f}` : null;
};
/**
 * A normalised dataset, written under a fixed name by the fetch step.
 *
 * These are not Overpass responses and carry no query hash: `planned.json`,
 * `network.osm.json` and `stations.json` are the tidied output the fetchers
 * leave behind.
 */
const readFixed = async (file, fallback = null) => {
  const name = rawName(CITY, file);
  try {
    return JSON.parse(await readFile(resolve(ROOT, `data/raw/${name}`), 'utf8'));
  } catch {
    if (fallback !== null) return fallback;
    throw new Error(`Rohdatensatz ${name} fehlt — erst die fetch-Skripte laufen lassen`);
  }
};

const railFile = rawFile('geo-railways');
const city = JSON.parse(
  await readFile(resolve(ROOT, distName(CITY, 'city', DATA_VERSION)), 'utf8')
);
const curatedFile = CITY.id === 'hamburg' ? 'projects.json' : `projects-${CITY.id}.json`;
const curated = await readFile(resolve(ROOT, `data/curated/${curatedFile}`), 'utf8')
  .then(JSON.parse)
  .catch(() => ({ version: DATA_VERSION, note: '', projects: [], proposals: [] }));
const planned = await readFixed('planned.json', { ways: [], nodes: [] });
const network = await readFixed('network.osm.json');
const stationDump = await readFixed('stations.json', { elements: [] });

// ------------------------------------------------------------- geocoding ---

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const candidates = [];
for (const s of network.stations) {
  candidates.push({ name: s.name, lon: s.lon, lat: s.lat, rank: 0, kind: 'station' });
}
// Station objects from the wide-area query cover the S-Bahn/AKN catchment
// beyond the city map (Ahrensburg, Bargteheide, Bad Oldesloe, Stade …).
for (const e of stationDump.elements) {
  const t = e.tags ?? {};
  const isStation = /^(station|halt)$/.test(t.railway ?? '') || t.public_transport === 'station';
  // A stop area is the whole complex rather than one platform. Where OSM has
  // only that — Hamburg-Wandsbek on the Lübecker Bahn — it is still a far
  // better anchor for a railway station than the neighbourhood of the same
  // name, which is why it ranks just below a station and above a place.
  const isStopArea = t.public_transport === 'stop_area';
  if (!isStation && !isStopArea) continue;
  candidates.push({
    name: e.name,
    lon: e.lon,
    lat: e.lat,
    rank: isStation ? 0 : 0.5,
    kind: 'station',
  });
}
// Named objects on the planned alignments themselves (e.g. the Moldauhafen
// station box) are the best possible anchor for a new station.
for (const w of planned.ways) {
  const n = w.tags?.name;
  if (!n || !w.geo?.length) continue;
  const mid = w.geo[Math.floor(w.geo.length / 2)];
  candidates.push({ name: n, lon: mid[0], lat: mid[1], rank: 0, kind: 'geplant' });
}
for (const n of planned.nodes) {
  if (!n.tags?.name) continue;
  candidates.push({ name: n.tags.name, lon: n.lon, lat: n.lat, rank: 0, kind: 'geplant' });
}
for (const l of city.landmarks) {
  const rank = l.kind === 'station' ? 0 : l.kind === 'place' ? 1 : 2;
  candidates.push({ name: l.name, lon: l.geo.lon, lat: l.geo.lat, rank, kind: l.kind });
}
for (const st of city.streets) {
  const mid = st.geo[Math.floor(st.geo.length / 2)];
  candidates.push({ name: st.name, lon: mid[0], lat: mid[1], rank: 3, kind: 'street', geo: st.geo });
}

// OSM disambiguates stations with a parenthetical — "Sengelmannstraße (City
// Nord)", "Sternschanze (Messe)". That suffix is not part of the identity, and
// without stripping it a station loses to a street of the same name.
const stripQualifier = (s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

// German station names carry the municipality: "Hamburg-Tonndorf",
// "Ahrensburg Gartenholz". A project timetable calls the stop "Tonndorf", and
// without stripping the prefix the station loses to the *neighbourhood* of the
// same name — which is how the S4 came to run a straight line across Wandsbek
// instead of along the railway it actually uses.
const stripCity = (s) => s.replace(new RegExp(`^${CITY.name}[\\s-]+`, 'i'), '').trim();

/** Score a candidate against a wanted name: 0 = exact, higher = worse. */
function nameScore(want, have) {
  const a = norm(want);
  const candidates = [norm(have), norm(stripQualifier(have)), norm(stripCity(stripQualifier(have)))];
  let best = Infinity;
  for (const b of candidates) {
    let score = Infinity;
    if (a === b) score = 0;
    else if (b.startsWith(a + ' ') || b.endsWith(' ' + a)) score = 1;
    else if (b.includes(a)) score = 2;
    else if (a.includes(b)) score = 3;
    best = Math.min(best, score);
  }
  return best;
}

/**
 * Resolve a station name to a point.
 *
 * `minSeparation` keeps consecutive stations apart: projecting a street onto
 * the previous station's neighbourhood otherwise lands "City Nord" 170 m from
 * Sengelmannstraße, and the line comes out with a gap where two stops collapse
 * onto one node.
 */
function geocode(names, near, { maxDistance = 16000, minFrom = null, minSeparation = 0 } = {}) {
  const farEnough = (lon, lat) =>
    !minFrom || minSeparation <= 0 || haversine([lon, lat], minFrom) >= minSeparation;
  let best = null;
  for (const c of candidates) {
    let score = Infinity;
    for (const n of names) score = Math.min(score, nameScore(n, c.name));
    if (!isFinite(score)) continue;
    let d = haversine([c.lon, c.lat], near);
    let lon = c.lon;
    let lat = c.lat;
    // For a street corridor take the point closest to the anchor, not its middle.
    if (c.kind === 'street' && c.geo) {
      // Walk the street and take the point nearest the anchor that also keeps
      // its distance from the previous station.
      let onStreet = null;
      for (let i = 0; i < c.geo.length - 1; i++) {
        const [ax, ay] = c.geo[i];
        const [bx, by] = c.geo[i + 1];
        const steps = Math.max(1, Math.ceil(haversine(c.geo[i], c.geo[i + 1]) / 40));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const px = ax + (bx - ax) * t;
          const py = ay + (by - ay) * t;
          if (!farEnough(px, py)) continue;
          const dd = haversine([px, py], near);
          if (!onStreet || dd < onStreet.d) onStreet = { lon: px, lat: py, d: dd };
        }
      }
      if (!onStreet) continue;
      lon = onStreet.lon;
      lat = onStreet.lat;
      d = onStreet.d;
    } else if (!farEnough(lon, lat)) {
      continue;
    }
    if (d > maxDistance) continue;
    const total = score * 40_000 + c.rank * 6_000 + d;
    if (!best || total < best.total) best = { total, lon, lat, source: c.kind, matched: c.name, distance: d };
  }
  return best;
}

// --------------------------------------------------- planned OSM corridors --

// The under-construction / proposed subway alignments from OSM are used to
// shape the tunnel where they exist, so the U5 follows its real corridor.
const corridors = planned.ways
  .filter(
    (w) =>
      /^(subway)$/.test(w.tags['proposed:railway'] ?? w.tags['construction:railway'] ?? '') &&
      !/Werkstattgleis|wash/i.test(w.tags.name ?? '') &&
      w.geo.length > 1
  )
  .map((w) => w.geo);

// Existing heavy-rail alignments. Projects that upgrade a live corridor (S4)
// follow the real track rather than a straight line between stations.
const railRaw = JSON.parse(await readFile(resolve(ROOT, railFile), 'utf8'));
const railCorridors = stitchLines(
  railRaw.elements
    .filter((e) => e.geometry?.length > 1 && /^(rail)$/.test(e.tags?.railway ?? ''))
    .map((e) => e.geometry.map((g) => [g.lon, g.lat]))
).filter((l) => lineLength(l) > 800);

/** Route between two points along a corridor pool, when one connects them. */
function corridorPath(a, b, pool = corridors, tol = 260) {
  const near = (p) => pool.filter((c) => (projectOnLine(p, c)?.distance ?? 1e9) < tol);
  const shared = near(a).filter((c) => near(b).includes(c));
  for (const c of shared) {
    const pa = projectOnLine(a, c);
    const pb = projectOnLine(b, c);
    if (!pa || !pb) continue;
    const [i, j] = pa.along < pb.along ? [pa, pb] : [pb, pa];
    const slice = c.slice(i.index + 1, j.index + 1);
    if (!slice.length) continue;
    const pts = pa.along < pb.along ? slice : slice.reverse();
    return [a, ...pts, b];
  }
  return null;
}

// ---------------------------------------------------------------- resolve --

// A station name resolves to exactly one point, whichever project mentions it
// first. Without this the U5 stages disagree about where "City Nord" is — each
// stage projects the same street from a different anchor — and the line comes
// out in disconnected pieces.
const placed = new Map();

//
// `scope` keeps two networks apart that merely share a name. The tram study
// has a stop "Siemersplatz" at the bus stop on the street, and the U5 a
// station "Siemersplatz" underneath it; resolving both to one point would turn
// a kerbside tram stop into a deep underground station.
function resolveStations(list, anchor, minSeparation = 500, scope = '') {
  const out = [];
  let near = anchor;
  let previous = null;
  for (const s of list) {
    const key = scope + norm(s.name);
    const names = [s.name, s.alias, ...(s.aliases ?? [])].filter(Boolean);
    // A stop that brings its own coordinates is where its source says it is.
    const given =
      Number.isFinite(s.lon) && Number.isFinite(s.lat)
        ? { lon: s.lon, lat: s.lat, source: 'kuratiert', matched: s.name, distance: 0 }
        : null;
    const hit =
      placed.get(key) ?? given ?? geocode(names, near, { minFrom: previous, minSeparation });
    if (!hit) {
      console.warn(`    ! "${s.name}" konnte nicht verortet werden (Anker ${near})`);
      continue;
    }
    placed.set(key, hit);
    previous = [hit.lon, hit.lat];
    out.push({
      name: s.name,
      lon: round(hit.lon),
      lat: round(hit.lat),
      isNew: s.new !== false,
      geocode: {
        via: hit.source,
        matched: hit.matched,
        distanceM: Math.round(hit.distance),
        exact: names.some((n) => norm(n) === norm(hit.matched)),
      },
    });
    near = [hit.lon, hit.lat];
  }
  return out;
}

function buildSegments(stations, { rail = false, street = false, smooth = 12, tight = false } = {}) {
  const segs = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const a = [stations[i].lon, stations[i].lat];
    const b = [stations[i + 1].lon, stations[i + 1].lat];
    // A corridor that doubles back through a station throat produces a path
    // twice as long as the hop it is meant to cover, with a forty-metre curve
    // in it. Following a corridor is only worth it while it stays roughly on
    // the way.
    const direct = haversine(a, b);
    // Between two named stops a few hundred metres apart, a route much longer
    // than the straight line is the router finding its way round a one-way
    // street, not the tram's alignment — the stops themselves fix the course.
    const sane = (p) =>
      p &&
      lineLength(p) <=
        (tight ? Math.max(direct * 1.25, direct + 60) : Math.max(direct * 1.8, direct + 600));

    let via = 'gerade';
    let path = corridorPath(a, b);
    if (sane(path)) via = 'trasse';
    else path = null;
    if (!path && rail) {
      const railPath = corridorPath(a, b, railCorridors, 500);
      if (sane(railPath)) {
        path = railPath;
        via = 'bestandsgleis';
      }
    }
    if (!path && street) {
      const streetPath = streetGraph.route(a, b);
      if (sane(streetPath)) {
        path = streetPath;
        via = 'strasse';
      }
    }
    // How coarsely the routed path is thinned before the engine fillets it.
    // The fillet radius is limited by the length of the two legs at a corner,
    // so a path kept at twelve-metre spacing can only ever be rounded to a
    // few metres — which then reads as a forty-metre curve on a main line.
    // Rail gets long legs; a tram genuinely turns street corners.
    const geo = path ? simplify(path, smooth) : [a, b];
    segs.push({
      from: stations[i].name,
      to: stations[i + 1].name,
      geo: roundLine(geo),
      lengthM: Math.round(lineLength(geo)),
      viaCorridor: !!path,
      via,
    });
  }
  return segs;
}

// Street graph for the surface corridors of the proposals.
const roadsRawFile = rawFile('geo-roads');
const streetsRawFile = rawFile('geo-streets');
const roadsRaw = JSON.parse(await readFile(resolve(ROOT, roadsRawFile), 'utf8'));
const streetsRaw = JSON.parse(await readFile(resolve(ROOT, streetsRawFile), 'utf8'));
const streetGraph = buildStreetGraph([
  // A tram prefers a main road but may use a local street.
  { elements: roadsRaw.elements, penalty: 1.0 },
  { elements: streetsRaw.elements, penalty: 1.6 },
]);
console.log(`  Straßennetz für Trassierung: ${streetGraph.ways} Wege, ${streetGraph.size} Knoten`);

const projects = [];
for (const p of curated.projects) {
  const stations = resolveStations(p.stations, p.anchor, p.mode === 'tram' ? 250 : 550);
  const segments = buildSegments(stations, {
    rail: ['existing_rail', 'surface'].includes(p.infrastructure),
    smooth: p.mode === 'tram' ? 12 : 35,
  });
  const km = segments.reduce((s, x) => s + x.lengthM, 0) / 1000;
  projects.push({ ...p, stations, segments, lengthKm: round(km, 2) });
  console.log(
    `  ${p.id.padEnd(28)} ${stations.length} Halte, ${km.toFixed(1)} km` +
      `${segments.some((s) => s.viaCorridor) ? ' (Trasse aus OSM)' : ''}`
  );
  for (const st of stations) {
    if (!st.geocode.exact)
      console.log(`      ? ${st.name} → "${st.geocode.matched}" (${st.geocode.via})`);
  }
}

const proposals = [];
for (const pr of curated.proposals) {
  const lines = pr.lines.map((l) => {
    // A proposal that brings its own alignment keeps it.
    //
    // The street router is right for a tram and wrong for a railway: a regional
    // S-Bahn follows the track that is already there, and outside Hamburg the
    // street graph does not even reach. Such a line gives its corridor
    // explicitly and the engine spaces and names the stops along it.
    if (l.corridor?.length >= 2) {
      // Trim the alignment to its terminus stations.
      //
      // The corridor is lifted off the real track, so its ends are wherever the
      // nearest rail vertex happens to be — a few hundred metres past the last
      // station. The engine then placed one more stop out there, right beside
      // the terminus and with the same name, which is where "Lüneburg 2" came
      // from. A line ends at its last station.
      let geo = l.corridor.map(([lon, lat]) => [round(lon, 5), round(lat, 5)]);
      const ends = l.stations ?? [];
      if (ends.length >= 2) {
        const near = (p) => {
          let bi = 0;
          let bd = Infinity;
          geo.forEach((q, i) => {
            const d = haversine([p.lon, p.lat], q);
            if (d < bd) {
              bd = d;
              bi = i;
            }
          });
          return bi;
        };
        const a = near(ends[0]);
        const b = near(ends[ends.length - 1]);
        geo = a <= b ? geo.slice(a, b + 1) : geo.slice(b, a + 1).reverse();
        // The stations themselves are the true ends, not the nearest vertex.
        geo[0] = [round(ends[0].lon, 5), round(ends[0].lat, 5)];
        geo[geo.length - 1] = [round(ends[ends.length - 1].lon, 5), round(ends[ends.length - 1].lat, 5)];
      }
      if (l.namedStops) {
        // The line stops at its named stations and nowhere else, so the
        // alignment is cut at them: one section per pair, built like a planned
        // project. Left to the engine, the gaps were filled with stops at
        // regular spacing, named after whatever street was nearest — a halt
        // "Claudiusstraße" on a line described as calling at today's stations.
        const stops = (l.stations ?? []).map((st) => ({
          name: st.name,
          lon: st.lon,
          lat: st.lat,
          isNew: st.new !== false,
        }));
        const along = stops.map((st) => projectOnLine([st.lon, st.lat], geo).along);
        const pieces = cutLine(geo, along.slice(1, -1));
        const segments = pieces.map((piece, i) => ({
          from: stops[i].name,
          to: stops[i + 1].name,
          geo: roundLine(piece),
          lengthM: Math.round(lineLength(piece)),
          viaCorridor: true,
          via: 'schiene',
        }));
        return {
          ...l,
          stations: stops,
          segments,
          lengthKm: round(lineLength(geo) / 1000, 2),
          autoStations: false,
        };
      }
      const lengthM = lineLength(geo);
      return {
        ...l,
        // Kept as given: these are the stations the corridor is *for*, and the
        // engine is told to put stops on them rather than space its own evenly
        // and miss Winsen.
        stations: (l.stations ?? []).map((st) => ({ ...st, isNew: true })),
        segments: [{ from: '', to: '', geo, lengthM: round(lengthM), via: 'schiene' }],
        lengthKm: round(lengthM / 1000, 2),
        autoStations: true,
      };
    }
    const stations = resolveStations(
      // A proposal that names its stops may say which of them exist already.
      l.stations.map((s) => ({ ...s, new: l.namedStops ? s.new !== false : true })),
      l.anchor,
      l.namedStops ? 150 : 250,
      l.namedStops ? 'tram ' : ''
    );
    const segments = buildSegments(stations, { street: true, tight: !!l.namedStops });
    const km = segments.reduce((s, x) => s + x.lengthM, 0) / 1000;
    if (l.namedStops) {
      // Every stop is named by the source, so nothing is left for the engine
      // to space out.
      return { ...l, stations, segments, lengthKm: round(km, 2), autoStations: false };
    }
    // The published concept states stop counts, not stop names: the listed
    // points are corridor anchors and the engine fills in the tram-spaced
    // stops between them.
    return { ...l, stations, segments, lengthKm: round(km, 2), autoStations: true };
  });
  const totalKm = lines.reduce((s, l) => s + l.lengthKm, 0);
  const stops = lines.reduce((s, l) => s + l.stations.length, 0);
  proposals.push({ ...pr, lines, lengthKm: round(totalKm, 2), stops });
  const viaStreet = lines.flatMap((l) => l.segments).filter((s) => s.via === 'strasse').length;
  const straight = lines.flatMap((l) => l.segments).filter((s) => s.via === 'gerade').length;
  console.log(
    `  ${pr.id}: ${lines.length} Linien, ${totalKm.toFixed(1)} km, ${stops} Halte ` +
      `(angegeben: ${pr.claimedLengthKm} km / ${pr.claimedStops}); ${viaStreet} Abschnitte im Straßennetz, ${straight} gerade`
  );
}

// ---------------------------------------------------------------- checks --
// A silent gap in a line is worse than a loud failure: it looks like a
// deliberate design decision on the map.
const problems = [];
const seen = new Map();
for (const p of [...projects, ...proposals.flatMap((pr) => pr.lines)]) {
  for (const st of p.stations ?? []) {
    const key = (p.namedStops ? 'tram ' : '') + norm(st.name);
    const prev = seen.get(key);
    if (prev && (prev.lon !== st.lon || prev.lat !== st.lat)) {
      problems.push(`"${st.name}" liegt in ${prev.id} und ${p.id} an verschiedenen Stellen`);
    }
    seen.set(key, { ...st, id: p.id });
  }
  for (const sg of p.segments ?? []) {
    // These check the gap between two named stations. A corridor segment is not
    // that: it carries the whole alignment and the engine spaces the stops
    // along it, so its length says nothing about station spacing — and a
    // warning that always fires for a correct case teaches people to ignore
    // warnings.
    if (sg.via === 'schiene' && !sg.from && !sg.to) continue;
    // Tram stops stand closer together than railway stations do.
    if (sg.lengthM < (p.namedStops ? 120 : 250)) {
      problems.push(`${p.id}: ${sg.from} → ${sg.to} ist nur ${sg.lengthM} m lang`);
    }
    const longLimit = p.mode === 'sbahn' || p.mode === 'regional' ? 15000 : 9000;
    if (sg.lengthM > longLimit) {
      problems.push(`${p.id}: ${sg.from} → ${sg.to} ist ${(sg.lengthM / 1000).toFixed(1)} km lang`);
    }
  }
}
if (problems.length) {
  console.error('\n  Probleme in den Projektdaten:');
  for (const p of problems) console.error(`   ! ${p}`);
  process.exitCode = 1;
} else {
  console.log('  Projektdaten sind zusammenhängend und plausibel.');
}

await writeJson(distName(CITY, 'projects', DATA_VERSION), {
  version: DATA_VERSION,
  note: curated.note,
  projects,
  proposals,
  // Passed through untouched: these name projects, so they belong beside them
  // rather than in the importer, where one city's story became every city's.
  scenarios: curated.scenarios ?? [],
});
