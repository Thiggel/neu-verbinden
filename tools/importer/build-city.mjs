// Build the versioned city dataset consumed by the Rust engine, plus the
// stylised base-map layers consumed by MapLibre.
//
// The demographic surface is the analytically interesting part: official
// Statistikamt Nord population per Stadtteil is redistributed inside each
// district in proportion to modelled residential floor area (OSM building
// footprints × storeys, with residential land use as a fallback), which gives a
// 200 m raster that sums exactly to the official district totals.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, writeJson } from './overpass.mjs';
import {
  assemblePolygons, ringArea, ringCentroid, pointInRing, simplify, simplifyRing, ringSelfIntersects,
  stitchLines, setOrigin,
  toMetric, toGeo, roundLine, round, haversine, lineLength,
} from './lib/geo.mjs';
import { loadCity, rawName, distName } from './lib/city.mjs';

const DATA_VERSION = '2026-09';
const CITY = await loadCity();
// Everything below works in this city's metric plane.
setOrigin(CITY.projectionOrigin.lat, CITY.projectionOrigin.lon);
/** Jobs at the workplace, from the city configuration. */
const TOTAL_JOBS = CITY.jobs.total;
const CELL_M = 200;

/**
 * A raw dataset that may not have been fetched for this city.
 *
 * The regional detail tiers were built for Hamburg. Requiring them everywhere
 * made the Berlin build fail outright, and the publish step then quietly shipped
 * a manifest with one city in it. A dataset a city does not have is a reason to
 * draw less of that city, not to refuse to build it.
 */
const readRawOptional = async (name) => {
  try {
    return await readRaw(name);
  } catch {
    console.log(`  (${rawName(CITY, name)} nicht vorhanden — diese Ebene bleibt für ${CITY.id} leer)`);
    return { elements: [] };
  }
};

const readRaw = async (name) => {
  const prefixed = rawName(CITY, name);
  const fs = await import('node:fs/promises');
  // `data/raw/index.json` names the file belonging to the query as it stands
  // today. Without it the choice fell to whatever sorted first, so a rewritten
  // query kept returning the old answer.
  let f;
  try {
    f = JSON.parse(await readFile(resolve(ROOT, 'data/raw/index.json'), 'utf8'))[prefixed];
  } catch {}
  const list = await fs.readdir(resolve(ROOT, 'data/raw'));
  if (!f || !list.includes(f)) {
    // Older caches, from before the index existed: the most recent one is the
    // best guess, and better than the alphabetical one.
    const candidates = list.filter((x) => x.startsWith(prefixed + '.') && x.endsWith('.json'));
    const stats = await Promise.all(
      candidates.map(async (x) => [x, (await fs.stat(resolve(ROOT, 'data/raw', x))).mtimeMs])
    );
    stats.sort((a, b) => b[1] - a[1]);
    f = stats[0]?.[0];
    if (candidates.length > 1) {
      console.log(`  ! ${prefixed}: ${candidates.length} Fassungen im Cache, benutzt wird ${f}`);
    }
  }
  if (!f) throw new Error(`Rohdatensatz ${prefixed} fehlt — erst die fetch-Skripte laufen lassen`);
  return JSON.parse(await readFile(resolve(ROOT, 'data/raw', f), 'utf8'));
};

console.log(`${CITY.name}: Rohdaten laden …`);
const [waterRaw, greenRaw, roadsRaw, streetsRaw, landuseRaw, landmarkRaw, boundaryRaw, buildingRaw, railRaw] =
  await Promise.all([
    readRaw('geo-water'), readRaw('geo-green'), readRaw('geo-roads'), readRaw('geo-streets'),
    readRaw('geo-landuse'), readRaw('geo-landmarks'),
    // The city outline is only used for Hamburg's harbour/water trimming;
    // where it is not fetched, an empty set is the same thing as none.
    readRaw('geo-boundaries').catch(() => ({ elements: [] })),
    readRaw('geo-buildings_big'), readRaw('geo-railways'),
  ]);
// Hamburg's districts come from the statistical office as GeoJSON with the
// population already attached; Berlin's are OSM boundary relations carrying a
// population tag. Both are normalised to the same shape here.
const districtsGeo =
  CITY.districts.kind === 'geojson'
    ? JSON.parse(await readFile(resolve(ROOT, CITY.districts.file), 'utf8'))
    : await districtsFromOsm(await readRaw('districts'));
const avg = (g, k) => (g?.length ? g.reduce((a, p) => a + p[k], 0) / g.length : null);
const [regionPlaces, regionWater, regionRoads, regionRail, regionStations, regionWaterways, regionGreen,
  regionTowns] = await Promise.all([
  readRawOptional('region-places'), readRawOptional('region-water'),
  readRawOptional('region-roads'), readRawOptional('region-rail'),
  readRawOptional('region-stations'), readRawOptional('region-waterways'),
  readRawOptional('region-green'), readRawOptional('region-towns'),
]);
const network = JSON.parse(
  await readFile(resolve(ROOT, `data/raw/${CITY.id === 'hamburg' ? '' : CITY.id + '-'}network.osm.json`), 'utf8')
);

/**
 * OSM admin relations → the same feature shape the Hamburg file has.
 *
 * The population comes from the separate lookup the fetch step wrote (OSM
 * itself has the figure for only a handful of Berlin's Ortsteile).
 */
async function districtsFromOsm(raw) {
  const lookup = JSON.parse(
    await readFile(resolve(ROOT, `data/raw/${CITY.id}-district-population.json`), 'utf8')
  );
  const features = [];
  let withPopulation = 0;
  for (const p of assemblePolygons(raw.elements, { minAreaM2: 100_000 })) {
    const t = p.tags ?? {};
    if (!t.name) continue;
    const population = lookup.values[t.wikidata]?.population ?? 0;
    if (population) withPopulation++;
    features.push({
      type: 'Feature',
      properties: {
        id: String(t['ref:DE-BE:OT'] ?? t.name),
        name: t.name,
        borough: t.geographical_region ?? '',
        population,
        // Not published per Ortsteil; the employment surface is modelled from
        // the city total instead, as it is for Hamburg.
        employedResidents: 0,
        households: 0,
        areaHa: Math.round(Math.abs(ringArea(p.rings[0])) / 10_000),
        carsPer1000: 0,
      },
      geometry: { type: 'Polygon', coordinates: p.rings },
    });
  }
  console.log(
    `  Ortsteile: ${features.length}, davon ${withPopulation} mit Einwohnerzahl ` +
      `(${lookup.source})`
  );
  return { type: 'FeatureCollection', features, metadata: { referenceYear: lookup.retrieved?.slice(0, 4) } };
}

// ---------------------------------------------------------------- water ----

// Named waterways that count as major even where they are narrow. The size
// rule below (0.4 km²) already catches every big lake and river reach, in any
// city; this list is the local supplement, so it belongs in the city's own
// configuration. It used to default to Hamburg's names, which meant Berlin was
// quietly carrying them — harmless, because the size rule dominates, but
// exactly the shape of every other "written when there was one city" fault.
const MAJOR_WATER = new RegExp(CITY.majorWater ?? '(?!)', 'i');

// Only the elements that describe an area. Rivers, canals and the coastline
// are lines and are drawn separately as `waterways`.
const waterAreas = waterRaw.elements.filter((e) => {
  const t = e.tags ?? {};
  return t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'basin';
});
const waterPolys = assemblePolygons(waterAreas, { minAreaM2: 30_000 });
const water = waterPolys.map((p) => ({
  name: p.tags.name ?? '',
  rings: p.rings.map((r) => simplifyRing(r, 25, 5)),
  area: ringArea(p.rings[0]),
  major: MAJOR_WATER.test(p.tags.name ?? '') || ringArea(p.rings[0]) > 400_000,
}));

// Simplification must not move a shoreline enough to see. This used to fail
// silently: the ring simplifier cut across bends and inlets, so lakes and
// canals grew or shrank by tens of percent on the map.
{
  let worst = 0;
  let worstName = '';
  for (let i = 0; i < waterPolys.length; i++) {
    const raw = Math.abs(ringArea(waterPolys[i].rings[0]));
    if (raw <= 0) continue;
    const dev = Math.abs(Math.abs(ringArea(water[i].rings[0])) / raw - 1);
    if (dev > worst) {
      worst = dev;
      worstName = waterPolys[i].tags.name || `(ohne Namen, ${Math.round(raw / 10_000)} ha)`;
    }
  }
  console.log(`  Gewässer: größte Flächenabweichung durch Vereinfachung ${(worst * 100).toFixed(1)} % (${worstName})`);

  // Area alone does not see a shoreline that jumps the river: the ring loses on
  // one side of the knot what it gains on the other, so it passes the tolerance
  // above while drawing a lake over dry land. Three rings shipped that way.
  const crossed = water.filter((w) => w.rings.some((r) => ringSelfIntersects(r)));
  if (crossed.length) {
    const names = crossed.map((w) => w.name || '(ohne Namen)').slice(0, 5).join(', ');
    throw new Error(
      `${crossed.length} Gewässer überschneiden sich selbst (${names}) — die Vereinfachung hat die Umrisslinie über sich selbst gelegt.`
    );
  }
  console.log(`  Gewässer: ${water.length} Umrisse, keiner überschneidet sich selbst`);
  if (worst > 0.08) {
    throw new Error(`Vereinfachung verzerrt ein Gewässer um ${(worst * 100).toFixed(1)} % — Toleranz prüfen.`);
  }
}
// Rivers and canals as lines, for the thin blue threads on the map.
const waterways = waterRaw.elements
  .filter((e) => e.type === 'way' && /^(river|canal)$/.test(e.tags?.waterway ?? '') && e.geometry)
  .map((e) => ({
    name: e.tags.name ?? '',
    major: e.tags.waterway === 'river',
    geo: roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 15)),
  }))
  .filter((w) => lineLength(w.geo) > 250);
console.log(`  Wasser: ${water.length} Flächen, ${waterways.length} Läufe`);

// ---------------------------------------------------------------- green ----

const green = assemblePolygons(greenRaw.elements, { minAreaM2: 150_000 }).map((p) => ({
  name: p.tags.name ?? '',
  kind: p.tags.leisure === 'park' ? 'park' : p.tags.landuse === 'cemetery' ? 'cemetery' : 'green',
  rings: p.rings.map((r) => simplifyRing(r, 45, 5)),
}));
console.log(`  Grün: ${green.length} Flächen`);

// ----------------------------------------------------------------- roads ---

const roadClass = { motorway: 0, trunk: 0, primary: 1, secondary: 2 };
const roads = roadsRaw.elements
  .filter((e) => e.geometry?.length > 1)
  .map((e) => ({
    name: e.tags?.name ?? '',
    class: roadClass[e.tags?.highway] ?? 3,
    geo: roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 35), 5),
  }));
console.log(`  Hauptstraßen: ${roads.length}`);

// Named local streets, merged per name so the engine stores one corridor per
// street rather than a few hundred OSM fragments.
const byName = new Map();
for (const e of streetsRaw.elements) {
  const n = e.tags?.name;
  if (!n || !e.geometry?.length) continue;
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(e.geometry.map((g) => [g.lon, g.lat]));
}
const streets = [];
for (const [name, frags] of byName) {
  for (const line of stitchLines(frags)) {
    const s = simplify(line, 40);
    if (lineLength(s) < 120) continue;
    streets.push({ name, class: 3, geo: roundLine(s, 5) });
  }
}
for (const r of roads) if (r.name) streets.push({ name: r.name, class: r.class, geo: r.geo });
console.log(`  Straßenkorridore für Benennung: ${streets.length}`);
// Filled in further down, once the town data has been read: out in the region
// there are no streets at all, so a stop there is named after the nearest
// village rather than the road it stands on.

// ------------------------------------------------------------- landmarks ---

// Only things a stop could plausibly be named after. A tennis club, a dojo or
// a gallery is a real place, but nobody has ever announced it from a train.
const POI_WEIGHT = [
  [/aeroway=aerodrome/, 1.0, 'Flughafen'],
  [/amenity=university/, 0.8, 'Universität'],
  [/amenity=hospital/, 0.7, 'Krankenhaus'],
  [/leisure=stadium/, 0.65, 'Stadion'],
  // A mall is a good reason for a stop and a poor name for one — below the
  // "everyone can name it" threshold, so the street still wins.
  [/shop=mall/, 0.5, 'Einkaufszentrum'],
  [/tourism=zoo/, 0.6, 'Zoo'],
  [/amenity=townhall/, 0.55, 'Rathaus'],
  // Below the 0.4 cut on purpose: a museum or a theatre is a landmark, but a
  // stop is named after the street it stands in unless there is nothing else.
  [/tourism=museum/, 0.35, 'Museum'],
  [/amenity=theatre/, 0.35, 'Theater'],
  [/amenity=college/, 0.35, 'Hochschule'],
  [/amenity=ferry_terminal/, 0.38, 'Fähranleger'],
];

// Names that read as an address book entry rather than as a stop.
const NAME_REJECT =
  /\b(e\.\s?V\.|GmbH|mbH|AG|Verein|Club|Klub|Akademie|Academy|Galerie|Gallery|Filiale|Sportplatz|Turnhalle|Sporthalle|Softballplatz|Tennis|Fitness|Studio|Praxis|Kanzlei|Institut)\b/i;

/** Would a transit operator put this on a sign? */
function usableStopName(name) {
  if (!name) return false;
  if (name.length > 26) return false;
  if (NAME_REJECT.test(name)) return false;
  // Codes and product names rather than places.
  if (/[A-Z]\.[A-Z]\.|&|\bIII\b|\bW2\/|\bFSP\d/.test(name)) return false;
  return true;
}
const PLACE_WEIGHT = { city: 1.0, borough: 0.75, suburb: 0.7, quarter: 0.6, neighbourhood: 0.45, town: 0.6, village: 0.4 };

const landmarks = [];
const seenLandmark = new Set();
for (const e of landmarkRaw.elements) {
  const t = e.tags ?? {};
  const name = t.name ?? t['name:de'];
  if (!name) continue;
  let lon = e.lon;
  let lat = e.lat;
  if (lon == null && e.geometry?.length) {
    const c = ringCentroid(e.geometry.map((g) => [g.lon, g.lat]));
    [lon, lat] = c;
  }
  if (lon == null && e.members?.length) {
    const g = e.members.find((m) => m.geometry?.length);
    if (g) [lon, lat] = ringCentroid(g.geometry.map((q) => [q.lon, q.lat]));
  }
  if (lon == null || lat == null) continue;

  let kind = 'poi';
  let weight = 0.3;
  let category = '';
  if (t.railway === 'station' || t.public_transport === 'station' || t.railway === 'halt') {
    kind = 'station';
    weight = t.railway === 'station' ? 0.9 : 0.7;
    category = 'Station';
  } else if (t.place) {
    // The node for the city itself is not a stop name and not a neighbourhood.
    if (t.place === 'city') continue;
    kind = 'place';
    weight = PLACE_WEIGHT[t.place] ?? 0.4;
    category = 'Ortsteil';
  } else {
    const flat = Object.entries(t).map(([k, v]) => `${k}=${v}`).join(' ');
    const hit = POI_WEIGHT.find(([re]) => re.test(flat));
    if (!hit) continue;
    weight = hit[1];
    category = hit[2];
  }
  // Places and stations keep their names whatever they look like; only the
  // long tail of POIs is filtered, because that is where the noise is.
  if (kind === 'poi' && !usableStopName(name)) continue;
  const key = `${kind}|${name}|${lon.toFixed(3)}|${lat.toFixed(3)}`;
  if (seenLandmark.has(key)) continue;
  seenLandmark.add(key);
  landmarks.push({
    id: `${e.type[0]}${e.id}`,
    name,
    kind,
    geo: { lat: round(lat), lon: round(lon) },
    weight,
    modes: [],
    category,
  });
}
// Existing network stations are the strongest anchors of all.
for (const s of network.stations) {
  landmarks.push({
    id: `net-${s.id}`,
    name: s.name,
    kind: 'station',
    geo: { lat: s.lat, lon: s.lon },
    weight: 1.0,
    modes: s.modes,
    category: 'Bestandsstation',
  });
}
console.log(`  Landmarken: ${landmarks.length}`);

// ------------------------------------------------------------- districts ---

/** The city's own district boundaries in metric coordinates, computed once. */
let _cityRings = null;
const districtRingsMetric = () => {
  _cityRings ??= districts.map((d) => d.rings.map((r) => r.map(toMetric)));
  return _cityRings;
};

const districts = districtsGeo.features.map((f) => {
  const p = f.properties;
  const rings = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
    .map((poly) => poly[0])
    .filter((r) => r?.length > 3);
  return {
    id: p.id,
    name: p.name,
    borough: p.borough,
    population: p.population,
    employedResidents: p.employedResidents,
    households: p.households,
    areaKm2: round(p.areaHa / 100, 3),
    carsPer1000: p.carsPer1000,
    rings: rings.map((r) => simplifyRing(r, 60, 5)),
  };
});
console.log(`  Stadtteile: ${districts.length}`);

// ------------------------------------------------- demographic raster ------

// Grid extent: the union of all district geometry, padded.
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const d of districts) {
  for (const r of d.rings) {
    for (const p of r) {
      const [x, y] = toMetric(p);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
}
const originX = Math.floor((minX - 2000) / CELL_M) * CELL_M;
const originY = Math.floor((minY - 2000) / CELL_M) * CELL_M;
const cols = Math.ceil((maxX + 2000 - originX) / CELL_M);
const rows = Math.ceil((maxY + 2000 - originY) / CELL_M);
console.log(`  Raster: ${cols} × ${rows} Zellen à ${CELL_M} m`);

const cellIndex = (x, y) => {
  const c = Math.floor((x - originX) / CELL_M);
  const r = Math.floor((y - originY) / CELL_M);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
  return r * cols + c;
};

// Residential and non-residential floor area per cell.
const resArea = new Float64Array(cols * rows);
const jobArea = new Float64Array(cols * rows);

const NON_RESIDENTIAL = /^(commercial|office|retail|industrial|warehouse|hotel|hospital|university|school|college|civic|public|government|kindergarten|train_station|transportation)$/;
const RESIDENTIAL = /^(residential|apartments|house|detached|semidetached_house|terrace|dormitory|bungalow|yes)$/;

let counted = 0;
for (const b of buildingRaw.elements) {
  if (!b.geometry || b.geometry.length < 4) continue;
  const ring = b.geometry.map((g) => [g.lon, g.lat]);
  const area = ringArea(ring);
  if (area < 20 || area > 400_000) continue;
  const levels = Math.min(parseFloat(b.tags?.['building:levels']) || 1, 60);
  const floor = area * levels;
  const c = ringCentroid(ring);
  const [x, y] = toMetric(c);
  const i = cellIndex(x, y);
  if (i < 0) continue;
  const type = b.tags?.building ?? 'yes';
  if (NON_RESIDENTIAL.test(type)) jobArea[i] += floor;
  else if (RESIDENTIAL.test(type)) resArea[i] += floor;
  else {
    resArea[i] += floor * 0.5;
    jobArea[i] += floor * 0.5;
  }
  counted++;
}
console.log(`  Gebäude mit Geschosszahl ausgewertet: ${counted.toLocaleString('de-DE')}`);

// Land use gives a fallback weight where building data is thin, and carries the
// employment signal for large single-purpose sites (port, Airbus, industry).
const landusePolys = assemblePolygons(landuseRaw.elements, { minAreaM2: 5_000 });
const LU_RES = /^(residential)$/;
const LU_JOB = /^(commercial|retail|industrial|port)$/;
for (const p of landusePolys) {
  const lu = p.tags.landuse;
  const ring = p.rings[0];
  const area = ringArea(ring);
  // Sprinkle the polygon over the cells it covers by sampling its bounding box.
  const M = ring.map(toMetric);
  const bx0 = Math.min(...M.map((m) => m[0]));
  const bx1 = Math.max(...M.map((m) => m[0]));
  const by0 = Math.min(...M.map((m) => m[1]));
  const by1 = Math.max(...M.map((m) => m[1]));
  const cells = [];
  for (let x = bx0; x <= bx1 + CELL_M; x += CELL_M) {
    for (let y = by0; y <= by1 + CELL_M; y += CELL_M) {
      if (!pointInRing([x, y], M)) continue;
      const i = cellIndex(x, y);
      if (i >= 0) cells.push(i);
    }
  }
  if (!cells.length) {
    const [cx, cy] = toMetric(ringCentroid(ring));
    const i = cellIndex(cx, cy);
    if (i >= 0) cells.push(i);
  }
  const per = area / cells.length;
  for (const i of cells) {
    // A weak weight: 0.25 floors' worth, only to fill gaps in building data.
    if (LU_RES.test(lu)) resArea[i] += per * 0.25;
    else if (LU_JOB.test(lu)) jobArea[i] += per * 0.35;
  }
}

// Assign each cell to a district, then normalise to the official population.
const districtOfCell = new Int32Array(cols * rows).fill(-1);
districts.forEach((d, di) => {
  const ringsM = d.rings.map((r) => r.map(toMetric));
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const r of ringsM) for (const [x, y] of r) {
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x);
    by0 = Math.min(by0, y); by1 = Math.max(by1, y);
  }
  for (let x = Math.floor(bx0 / CELL_M) * CELL_M; x <= bx1; x += CELL_M) {
    for (let y = Math.floor(by0 / CELL_M) * CELL_M; y <= by1; y += CELL_M) {
      const i = cellIndex(x + CELL_M / 2, y + CELL_M / 2);
      if (i < 0 || districtOfCell[i] >= 0) continue;
      if (ringsM.some((r) => pointInRing([x + CELL_M / 2, y + CELL_M / 2], r))) districtOfCell[i] = di;
    }
  }
});

const population = new Float32Array(cols * rows);
const jobs = new Float32Array(cols * rows);

const cellsByDistrict = new Map();
for (let i = 0; i < districtOfCell.length; i++) {
  const d = districtOfCell[i];
  if (d < 0) continue;
  if (!cellsByDistrict.has(d)) cellsByDistrict.set(d, []);
  cellsByDistrict.get(d).push(i);
}

for (const [di, cells] of cellsByDistrict) {
  const d = districts[di];
  const total = cells.reduce((s, i) => s + resArea[i], 0);
  if (total > 0) {
    for (const i of cells) population[i] = (resArea[i] / total) * d.population;
  } else {
    for (const i of cells) population[i] = d.population / cells.length;
  }
}

// Jobs: distributed city-wide over non-residential floor area, with a
// city-centre multiplier reflecting the office density the footprints miss.
const CENTRE = toMetric([9.9937, 53.5511]);
let jobWeightTotal = 0;
const jobWeight = new Float64Array(cols * rows);
for (let i = 0; i < jobArea.length; i++) {
  if (jobArea[i] <= 0) continue;
  const c = i % cols;
  const r = Math.floor(i / cols);
  const x = originX + (c + 0.5) * CELL_M;
  const y = originY + (r + 0.5) * CELL_M;
  const dc = Math.hypot(x - CENTRE[0], y - CENTRE[1]);
  const centreBoost =
    1 + CITY.jobs.centreBoostFactor * Math.exp(-dc / CITY.jobs.centreBoostRadiusM);
  jobWeight[i] = jobArea[i] * centreBoost;
  jobWeightTotal += jobWeight[i];
}
for (let i = 0; i < jobWeight.length; i++) {
  if (jobWeight[i] > 0) jobs[i] = (jobWeight[i] / jobWeightTotal) * TOTAL_JOBS;
}

const sum = (a) => a.reduce((s, v) => s + v, 0);
console.log(
  `  Raster-Summen: ${Math.round(sum(Array.from(population))).toLocaleString('de-DE')} Einwohner, ` +
    `${Math.round(sum(Array.from(jobs))).toLocaleString('de-DE')} Arbeitsplätze`
);

// --------------------------------------------------- regional coverage ----

// Outside Hamburg there are no Stadtteil statistics, but OSM carries the
// population of most German places. That is enough to answer the question this
// extension is for: what would a regional line to Lüneburg, Kiel or Rostock
// actually reach? The raster is deliberately coarse — 1 km against the city's
// 200 m — because the data behind it is coarse.
const REGION_CELL = 1000;
/** Employed people at their workplace, as a share of residents. */
const REGION_JOB_RATIO = 0.42;

// `population` in OSM is user-maintained and occasionally holds the figure for
// the surrounding Amt or Kreis rather than the settlement: the node for Bad
// Bramstedt (a town of about 14,000) carries 154,390. A value far outside what
// its own place type allows is therefore discarded in favour of a typical size
// for that type — wrong by a factor of two beats wrong by a factor of ten.
const PLACE_POP_CAP = {
  city: 4_000_000, borough: 400_000, town: 120_000, suburb: 90_000,
  quarter: 40_000, village: 20_000, neighbourhood: 20_000, hamlet: 2_000,
  isolated_dwelling: 200, farm: 200,
};
const PLACE_POP_TYPICAL = {
  city: 120_000, borough: 60_000, town: 15_000, suburb: 8_000,
  quarter: 5_000, village: 1_200, neighbourhood: 2_000, hamlet: 200,
  isolated_dwelling: 20, farm: 20,
};

const regionAllPlaces = regionPlaces.elements
  .filter((p) => p.tags?.name && p.lon != null && p.tags.place)
  .map((p) => ({ name: p.tags.name, lon: p.lon, lat: p.lat, kind: p.tags.place }));

const regionCells = (() => {
  let corrected = 0;
  const places = regionPlaces.elements
    .filter((p) => p.tags?.name && p.lon != null)
    .map((p) => {
      const tagged = parseInt((p.tags.population ?? '').replace(/[^0-9]/g, ''), 10) || 0;
      const cap = PLACE_POP_CAP[p.tags.place] ?? 20_000;
      let population = tagged;
      if (tagged > cap) {
        population = PLACE_POP_TYPICAL[p.tags.place] ?? 1_200;
        corrected++;
      }
      return { name: p.tags.name, lon: p.lon, lat: p.lat, kind: p.tags.place, population };
    })
    .filter((p) => p.population > 0);
  if (corrected) console.log(`  Region: ${corrected} unplausible Einwohnerzahlen ersetzt`);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of places) {
    const [x, y] = toMetric([p.lon, p.lat]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 12_000;
  const ox = Math.floor((minX - pad) / REGION_CELL) * REGION_CELL;
  const oy = Math.floor((minY - pad) / REGION_CELL) * REGION_CELL;
  const cols = Math.ceil((maxX + pad - ox) / REGION_CELL);
  const rows = Math.ceil((maxY + pad - oy) / REGION_CELL);
  const pop = new Float64Array(cols * rows);

  // Each place is spread over a disc whose size follows from its population at
  // a plausible town density, with the weight falling off towards the edge.
  const DENSITY = 1800; // residents per km² inside the built-up area
  for (const p of places) {
    const [px, py] = toMetric([p.lon, p.lat]);
    const radius = Math.max(REGION_CELL * 0.75, Math.sqrt(p.population / (Math.PI * DENSITY)) * 1000);
    const reach = Math.ceil(radius / REGION_CELL);
    const c0 = Math.round((px - ox) / REGION_CELL);
    const r0 = Math.round((py - oy) / REGION_CELL);
    const hits = [];
    let weightSum = 0;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const cx = ox + (c + 0.5) * REGION_CELL;
        const cy = oy + (r + 0.5) * REGION_CELL;
        const d = Math.hypot(cx - px, cy - py);
        if (d > radius) continue;
        const w = 1 - (d / radius) ** 2;
        hits.push([r * cols + c, w]);
        weightSum += w;
      }
    }
    if (!weightSum) continue;
    for (const [i, w] of hits) pop[i] += (w / weightSum) * p.population;
  }

  // Anything inside a city district is already in the fine raster.
  const districtRings = districtRingsMetric();
  let cleared = 0;
  for (let i = 0; i < pop.length; i++) {
    if (pop[i] <= 0) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = ox + (c + 0.5) * REGION_CELL;
    const y = oy + (r + 0.5) * REGION_CELL;
    if (districtRings.some((rings) => rings.some((ring) => pointInRing([x, y], ring)))) {
      pop[i] = 0;
      cleared++;
    }
  }

  const total = pop.reduce((s, v) => s + v, 0);
  console.log(
    `  Region: ${places.length} Orte mit Einwohnerzahl, Raster ${cols} × ${rows} à ${REGION_CELL} m, ` +
      `${Math.round(total).toLocaleString('de-DE')} Einwohner (${cleared} Zellen im Stadtgebiet entfernt)`
  );
  return {
    cellM: REGION_CELL,
    originX: ox,
    originY: oy,
    cols,
    rows,
    population: Array.from(pop, (v) => round(v, 1)),
    jobs: Array.from(pop, (v) => round(v * REGION_JOB_RATIO, 1)),
    places,
  };
})();

// Regional landmarks: the towns themselves, so a station out there can be named.
// Places inside the city are skipped — it already has its own districts, and
// the OSM node for the city itself would otherwise name every station near the
// centre after the whole city.
// Every named settlement counts here, not just the ones carrying a population
// figure — a village without the tag is still what a stop out there would be
// named after.
const cityRings = districtRingsMetric();
let skippedPlaces = 0;
const REGION_PLACE_WEIGHT = {
  city: 0.85, borough: 0.7, town: 0.6, suburb: 0.5,
  village: 0.45, quarter: 0.4, neighbourhood: 0.35, hamlet: 0.3,
};
for (const p of regionAllPlaces) {
  const m = toMetric([p.lon, p.lat]);
  if (cityRings.some((rings) => rings.some((ring) => pointInRing(m, ring)))) {
    skippedPlaces++;
    continue;
  }
  const weight = REGION_PLACE_WEIGHT[p.kind];
  if (weight == null) continue; // isolated dwellings, farms: not stop names
  landmarks.push({
    id: `rp-${p.name}-${p.lon.toFixed(3)}`,
    name: p.name,
    kind: 'place',
    geo: { lat: round(p.lat), lon: round(p.lon) },
    weight,
    modes: [],
    category: 'Ort',
  });
}
// The region's own railway stations.
//
// Without these, a line drawn out to Lüneburg got its stops named after
// whatever happened to be lying around — "Bramweg", "Hinter der Bahn" — while
// Meckelfeld, Winsen and Bardowick, which are stations on that very line and
// have been for a century, were not in the data at all. Naming a stop after the
// station it replaces is the whole job. Weighted just below Hamburg's own
// stations: they anchor a corridor as firmly, but inside the city the network's
// own list is the better source.
let regionStops = 0;
for (const e of regionStations.elements ?? []) {
  const name = e.tags?.name;
  if (!name) continue;
  const lon = e.type === 'node' ? e.lon : avg(e.geometry, 'lon');
  const lat = e.type === 'node' ? e.lat : avg(e.geometry, 'lat');
  if (lon == null || lat == null) continue;
  const m = toMetric([lon, lat]);
  // Inside Hamburg the network's own stations already say this, better.
  if (cityRings.some((rings) => rings.some((ring) => pointInRing(m, ring)))) continue;
  landmarks.push({
    id: `rs-${e.type[0]}${e.id}`,
    name,
    kind: 'station',
    geo: { lat: round(lat), lon: round(lon) },
    weight: 0.9,
    modes: [],
    category: 'Bahnhof in der Region',
  });
  regionStops++;
}
console.log(`  Landmarken inkl. Region: ${landmarks.length} (${skippedPlaces} Orte im Stadtgebiet übersprungen, ${regionStops} Regionalbahnhöfe)`);

// Coarse regional base map. Only what orients you at that scale.
const regionWaterPolys = assemblePolygons(
  regionWater.elements.filter((e) => (e.tags ?? {}).natural === 'water'),
  { minAreaM2: 2_000_000 }
).map((p) => ({
  name: p.tags.name ?? '',
  major: true,
  rings: p.rings.map((r) => simplifyRing(r, 150, 4)),
}));
const coastline = regionWater.elements
  .filter((e) => e.tags?.natural === 'coastline' && e.geometry?.length > 1)
  .map((e) => roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 150), 4))
  .filter((l) => lineLength(l) > 3000);
// Rivers and woods for the region.
//
// Without them the map outside Hamburg's own box was coastline, motorways and
// place names on blank paper — the Elbe simply stopped near Geesthacht and
// Lüneburg sat in a void. Only what reads at regional zoom: rivers and canals
// as lines, woods above a size that is still a shape rather than a speck.
const regionWaterwayLines = regionWaterways.elements
  .filter((e) => e.geometry?.length > 1)
  .map((e) => roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 120), 4))
  .filter((l) => lineLength(l) > 4000);
const regionGreenPolys = assemblePolygons(regionGreen.elements, { minAreaM2: 3_000_000 }).map((p) => ({
  rings: [simplifyRing(p.rings[0], 200, 4)],
}));
console.log(
  `  Region-Detail: ${regionWaterwayLines.length} Flüsse/Kanäle, ${regionGreenPolys.length} Waldflächen`
);

// Town detail: what makes Lüneburg look like a town rather than a label.
//
// Same shapes as Hamburg's own base map, at a coarser tolerance, and only
// inside the fourteen town boxes. Streets keep their names because that is what
// names a station out there — the rest of the region has none, and a stop ends
// up called after the nearest village instead.
const townEls = regionTowns.elements ?? [];
const townWater = assemblePolygons(
  townEls.filter((e) => (e.tags ?? {}).natural === 'water'),
  { minAreaM2: 20_000 }
).map((p) => ({ name: p.tags.name ?? '', rings: [simplifyRing(p.rings[0], 30, 5)] }));
const townGreen = assemblePolygons(
  townEls.filter((e) => {
    const t = e.tags ?? {};
    return (
      t.leisure === 'park' ||
      t.natural === 'wood' ||
      /^(forest|grass|meadow|cemetery|allotments|recreation_ground)$/.test(t.landuse ?? '')
    );
  }),
  { minAreaM2: 40_000 }
).map((p) => ({ rings: [simplifyRing(p.rings[0], 40, 5)] }));
const townWaterways = townEls
  .filter((e) => /^(river|canal|stream)$/.test(e.tags?.waterway ?? '') && e.geometry?.length > 1)
  .map((e) => roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 25), 5))
  .filter((l) => lineLength(l) > 400);
const townRoads = townEls
  .filter((e) => e.tags?.highway && e.geometry?.length > 1)
  .map((e) => ({
    name: e.tags.name ?? '',
    major: /^(primary|secondary)$/.test(e.tags.highway),
    geo: roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 20), 5),
  }))
  .filter((r) => lineLength(r.geo) > 150);
let townNamed = 0;
for (const r of townRoads) {
  if (!r.name) continue;
  streets.push({ name: r.name, class: r.major ? 1 : 3, geo: r.geo });
  townNamed++;
}
console.log(
  `  Ortsdetail: ${townWater.length} Gewässer, ${townGreen.length} Grünflächen, ` +
    `${townWaterways.length} Läufe, ${townRoads.length} Straßen (${townNamed} benannt, für die Haltbenennung)`
);

const regionRoadLines = regionRoads.elements
  .filter((e) => e.geometry?.length > 1)
  .map((e) => roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 150), 4))
  .filter((l) => lineLength(l) > 3000);
const regionRailLines = regionRail.elements
  .filter((e) => e.geometry?.length > 1)
  .map((e) => roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 150), 4))
  .filter((l) => lineLength(l) > 3000);
console.log(
  `  Region-Karte: ${regionWaterPolys.length} Seen, ${coastline.length} Küstenlinien, ` +
    `${regionRoadLines.length} Autobahnen, ${regionRailLines.length} Bahnstrecken`
);

// ---------------------------------------------------------------- centres --

// Employment centres = local maxima of the jobs surface, named from the nearest
// landmark, so the accessibility model has real destinations to aim at.
const centres = [];
const smoothed = new Float64Array(cols * rows);
const R = 4; // 800 m smoothing
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let dr = -R; dr <= R; dr++) {
      for (let dc = -R; dc <= R; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        s += jobs[rr * cols + cc];
      }
    }
    smoothed[r * cols + c] = s;
  }
}
const order = Array.from({ length: cols * rows }, (_, i) => i).sort((a, b) => smoothed[b] - smoothed[a]);
for (const i of order) {
  if (centres.length >= 14) break;
  if (smoothed[i] <= 0) break;
  const c = i % cols, r = Math.floor(i / cols);
  const x = originX + (c + 0.5) * CELL_M;
  const y = originY + (r + 0.5) * CELL_M;
  if (centres.some((k) => Math.hypot(k.x - x, k.y - y) < 2600)) continue;
  const [lon, lat] = toGeo([x, y]);
  let best = null;
  for (const l of landmarks) {
    if (l.kind === 'poi') continue;
    const d = haversine([lon, lat], [l.geo.lon, l.geo.lat]);
    if (d < 1400 && (!best || l.weight > best.w + 1e-9 || (Math.abs(l.weight - best.w) < 1e-9 && d < best.d)))
      best = { name: l.name, w: l.weight, d };
  }
  const inDistrict = districts.find((d) =>
    d.rings.some((ring) => pointInRing([x, y], ring.map(toMetric)))
  );
  centres.push({
    name: best?.name ?? inDistrict?.name ?? `Zentrum ${centres.length + 1}`,
    geo: { lat: round(lat), lon: round(lon) },
    jobs: Math.round(smoothed[i]),
    primary: centres.length === 0,
    x, y,
  });
}
console.log('  Zentren:', centres.map((c) => `${c.name} (${Math.round(c.jobs / 1000)}k)`).join(', '));

// ------------------------------------------------------------------ emit ---

const sources = [
  {
    name: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org',
    licence: 'ODbL 1.0',
    retrieved: new Date().toISOString().slice(0, 10),
    note: 'Netzgeometrie, Gewässer, Grünflächen, Straßen, Gebäude, Landmarken',
  },
  CITY.statistics.kind === 'statistikamt-nord'
    ? {
        name: 'Statistikamt Nord — Regionalstatistische Daten der Stadtteile Hamburgs',
        url: 'https://api.hamburg.de/datasets/v1/regionalstatistische_daten_stadtteile',
        licence: 'Datenlizenz Deutschland Namensnennung 2.0',
        retrieved: new Date().toISOString().slice(0, 10),
        note: `Einwohner, Haushalte, Beschäftigte je Stadtteil, Stand ${districtsGeo.metadata?.referenceYear ?? '—'}`,
      }
    : {
        name: `Einwohnerzahlen der ${CITY.adjective} Ortsteile (OpenStreetMap)`,
        url: 'https://www.openstreetmap.org',
        licence: 'ODbL 1.0',
        retrieved: new Date().toISOString().slice(0, 10),
        note: CITY.statistics.note,
      },
  {
    name: 'Modellierte Arbeitsplatzverteilung',
    url: '',
    licence: 'eigene Berechnung',
    retrieved: new Date().toISOString().slice(0, 10),
    note: `${TOTAL_JOBS.toLocaleString('de-DE')} Erwerbstätige am Arbeitsort, verteilt nach Nichtwohn-Geschossfläche`,
  },
  {
    name: 'Einwohnerzahlen der Region',
    url: 'https://www.openstreetmap.org',
    licence: 'ODbL 1.0',
    retrieved: new Date().toISOString().slice(0, 10),
    note: 'population-Angaben an Orten zwischen Lüneburg, Kiel und Rostock, auf ein 1-km-Raster verteilt',
  },
];

await writeJson(distName(CITY, 'city', DATA_VERSION), {
  version: { id: DATA_VERSION, city: CITY.name, sources },
  // What the population raster was actually built from. The "i" explanation
  // quotes these counts; written out by hand they were Hamburg's, everywhere.
  provenance: {
    districtTerm: CITY.districtTerm ?? 'Stadtteile',
    districtCount: districts.length,
    buildingsCounted: counted,
    populationSource: CITY.statistics?.label ?? 'amtliche Statistik',
    officialPopulation: CITY.statistics?.kind !== 'osm-population',
  },
  center: CITY.center,
  // The metric plane every calculation runs in. It belongs to the dataset, not
  // to the engine: a second city 240 km away needs its own, or its east-west
  // distances come out three per cent short.
  projectionOrigin: CITY.projectionOrigin,
  landmarks,
  // Compact [lon, lat] pairs, which the engine reads explicitly as GeoJSON
  // order. Street geometry is the biggest single part of this file.
  streets,
  // Every existing surface railway. The buildability check uses it to tell a
  // line laid alongside an existing corridor (the S4 along the Lübecker Bahn)
  // from one cutting a new swathe through built-up city.
  // Stitched before filtering by length: inside a big station the tracks are
  // mapped as many short ways, and dropping those individually left Hamburg
  // Hauptbahnhof with no railway within 800 m — so a line running straight
  // along the Verbindungsbahn did not count as following a rail corridor.
  // `subway` belongs here as much as the rest: what the check asks is whether
  // trains already run along this alignment, and an elevated U-Bahn is exactly
  // that. Leaving it out meant a line drawn beside Berlin's U1 viaduct on the
  // Skalitzer Straße or Hamburg's U3 on the Hochbahn counted as cutting a new
  // swathe through the city. The tunnelled parts drop out on the next line, as
  // they should — a tunnel under a street is not a corridor above it.
  // Hamburg's own alignments in full detail, plus the main lines out through
  // the region. The regional half matters for cost: a regional line drawn along
  // the existing Hamburg–Lüneburg or Hamburg–Lübeck railway is an upgrade of a
  // corridor that is already there, and without these the engine saw open
  // country and priced it as cutting a new one. Coarser here on purpose — 60 m
  // is far below the accuracy anyone should read into a line drawn at this
  // scale, and it keeps the file honest about what it knows.
  rail: [
    ...stitchLines(
      railRaw.elements
        .filter(
          (e) => e.geometry?.length > 1 && /^(rail|light_rail|subway|narrow_gauge)$/.test(e.tags?.railway ?? '')
        )
        .filter((e) => (e.tags?.tunnel ?? 'no') === 'no')
        .map((e) => e.geometry.map((g) => [g.lon, g.lat]))
    )
      .map((line) => ({ name: '', geo: roundLine(simplify(line, 30), 5) }))
      .filter((l) => lineLength(l.geo) > 250),
    ...stitchLines(
      regionRail.elements
        .filter((e) => e.geometry?.length > 1 && (e.tags?.tunnel ?? 'no') === 'no')
        .map((e) => e.geometry.map((g) => [g.lon, g.lat]))
    )
      .map((line) => ({ name: '', geo: roundLine(simplify(line, 60), 5) }))
      .filter((l) => lineLength(l.geo) > 2000),
  ],
  water: water.map((w) => ({ name: w.name, ring: w.rings[0].map(([lon, lat]) => ({ lat, lon })), major: w.major })),
  districts: districts.map((d) => ({
    id: d.id,
    name: d.name,
    borough: d.borough,
    population: d.population,
    employedResidents: d.employedResidents,
    households: d.households,
    areaKm2: d.areaKm2,
    carsPer1000: d.carsPer1000,
    rings: d.rings.map((r) => r.map(([lon, lat]) => ({ lat, lon }))),
  })),
  regionGrid: {
    cellM: regionCells.cellM,
    originX: regionCells.originX,
    originY: regionCells.originY,
    cols: regionCells.cols,
    rows: regionCells.rows,
    population: regionCells.population,
    jobs: regionCells.jobs,
  },
  grid: {
    cellM: CELL_M,
    originX,
    originY,
    cols,
    rows,
    population: Array.from(population, (v) => round(v, 2)),
    jobs: Array.from(jobs, (v) => round(v, 2)),
  },
  centres: centres.map((c) => ({ name: c.name, geo: c.geo, jobs: c.jobs, primary: c.primary })),
});

// Streets, in their own file because they are only wanted close up.
//
// The map showed motorways and main roads and nothing else, so at street level
// a district was an empty field with a few names floating in it — you could not
// see where the Rentzelstraße runs, which is exactly what you need when placing
// a stop. These are the *ways* as OSM has them, not the name-merged corridors
// the engine uses for naming: those join every stretch that shares a name, so
// drawing them would streak straight lines across the city between unrelated
// pieces of "Gammer Weg". Checked before trusting them — 14 446 of the merged
// corridors contain jumps over 250 m.
//
// Simplified to 10 m and dropped below 45 m long, which takes Hamburg from
// 7.0 MB to 1.9 MB, and kept out of the base map so that nobody pays for it
// until they zoom in far enough to want it.
{
  const ways = [];
  for (const e of streetsRaw.elements ?? []) {
    if (!(e.geometry?.length > 1)) continue;
    const pts = e.geometry.map((g) => [g.lon, g.lat]);
    if (lineLength(pts) < 45) continue;
    ways.push({ n: e.tags?.name ?? '', g: roundLine(simplify(pts, 10), 5) });
  }
  // The bigger roads are already in the base map; these are what it lacks.
  await writeJson(distName(CITY, 'streets', DATA_VERSION), { version: DATA_VERSION, ways });
  console.log(`  Straßen für die Nahansicht: ${ways.length} Wege`);
}

await writeJson(distName(CITY, 'basemap', DATA_VERSION), {
  version: DATA_VERSION,
  water: water.map((w) => ({ name: w.name, major: w.major, rings: w.rings })),
  waterways,
  green,
  // Secondary roads are in, and drawn only from close up.
  //
  // They used to be cut here as "a lot of ink for no help", which was true of
  // the whole-city view and wrong of the view someone actually places a stop in:
  // the Rentzelstraße is a secondary road, so a reader looking for it found
  // nothing at any zoom. The layer they belong to fades them in at 13.
  roads: roads.filter((r) => r.class <= 2),
  districts: districts.map((d) => ({
    id: d.id,
    name: d.name,
    borough: d.borough,
    population: d.population,
    areaKm2: d.areaKm2,
    rings: d.rings,
    label: ringCentroid(d.rings[0]).map((v) => round(v)),
  })),
  places: landmarks
    .filter((l) => l.kind === 'place' && l.weight >= 0.45)
    .map((l) => ({ name: l.name, geo: [l.geo.lon, l.geo.lat], weight: l.weight })),
  regionWater: regionWaterPolys,
  coastline,
  regionRoads: regionRoadLines,
  regionRail: regionRailLines,
  regionWaterways: regionWaterwayLines,
  regionGreen: regionGreenPolys,
  townWater,
  townGreen,
  townWaterways,
  townRoads: townRoads.map((r) => ({ major: r.major, geo: r.geo })),
  regionPlaces: regionCells.places
    .filter((p) => p.population >= 8000)
    .map((p) => ({ name: p.name, geo: [round(p.lon), round(p.lat)], population: p.population })),
  rail: railRaw.elements
    .filter((e) => e.geometry?.length > 1 && e.tags?.railway === 'rail')
    .map((e) => roundLine(simplify(e.geometry.map((g) => [g.lon, g.lat]), 45), 5))
    .filter((l) => lineLength(l) > 1200),
});
console.log('fertig');
