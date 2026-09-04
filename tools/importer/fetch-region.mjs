// Coarse geography for the wider region: Lüneburg, Lauenburg, Kiel, Rostock.
//
// Deliberately thin. Hamburg keeps full detail — buildings, land use, every
// named street — because that is what the population surface and the station
// naming need. Out here the point is only to be able to draw a regional line
// and have it land on real towns along real rail corridors, so this fetches
// places with their population, the rail network, motorways, big water and the
// coastline, and nothing else.
import { overpass, writeJson } from './overpass.mjs';

// Hamburg to Kiel, Rostock, Lüneburg and Lauenburg, with margin.
export const REGION_BBOX = '53.00,9.10,54.55,12.55';

const q = (body) => `[out:json][timeout:900];\n(${body.trim().replace(/;?$/, ';')}\n);\nout geom;`;

const QUERIES = {
  places: q(`
  node["place"~"^(city|town|village)$"]["name"](${REGION_BBOX})`),

  water: q(`
  way["natural"="water"](${REGION_BBOX});
  relation["natural"="water"](${REGION_BBOX});
  way["natural"="coastline"](${REGION_BBOX})`),

  roads: q(`
  way["highway"~"^(motorway|trunk|primary)$"](${REGION_BBOX})`),

  rail: q(`
  way["railway"="rail"]["usage"~"^(main|branch)$"]["service"!~"."](${REGION_BBOX})`),

  // The middle tier. Hamburg's own box ends at 10.40 E — on Bad Oldesloe's
  // doorstep — and beyond it the map had only coastline, motorways and a
  // handful of place dots, so Lübeck, Lüneburg and Kiel sat on blank paper.
  // Rivers and woods are what make a map at this scale read as country rather
  // than as a diagram, and they are cheap: no buildings, no land use, no named
  // residential streets, and everything below a size that would show at
  // regional zoom is dropped at build time.
  // Where a regional line could actually stop. The Hamburg box ends at 10.40 E,
  // so Winsen, Lüneburg, Reinfeld and Lübeck Hbf had no coordinates at all and
  // a corridor out there could only be guessed between town centres.
  stations: q(`
  node["railway"~"^(station|halt)$"]["name"](${REGION_BBOX});
  way["railway"~"^(station|halt)$"]["name"](${REGION_BBOX})`),

  waterways: q(`
  way["waterway"~"^(river|canal)$"](${REGION_BBOX})`),

  green: q(`
  way["natural"="wood"](${REGION_BBOX});
  relation["natural"="wood"](${REGION_BBOX});
  way["landuse"="forest"](${REGION_BBOX});
  relation["landuse"="forest"](${REGION_BBOX});
  relation["leisure"="nature_reserve"](${REGION_BBOX})`),
};

/**
 * Split the region into a grid of boxes and merge the answers.
 *
 * Overpass answers the whole box for places and rail, and returns 504 for
 * rivers and woods: those are an order of magnitude more geometry, and the
 * public instances cap how long one query may run. Asking in pieces is the
 * difference between having the data and not.
 */
function tiles(bbox, nx, ny) {
  const [s, w, n, e] = bbox.split(',').map(Number);
  const out = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      out.push(
        [
          s + ((n - s) * j) / ny,
          w + ((e - w) * i) / nx,
          s + ((n - s) * (j + 1)) / ny,
          w + ((e - w) * (i + 1)) / nx,
        ]
          .map((v) => v.toFixed(4))
          .join(',')
      );
    }
  }
  return out;
}

/**
 * Detail around the towns a regional line could actually reach.
 *
 * The middle tier above gives the whole region rivers, woods and main roads —
 * enough that the country between places reads as country. It is not enough
 * standing in Lüneburg or Lübeck, where the map should look like a town.
 *
 * Doing that everywhere is not affordable: Hamburg's own box is 2 300 km² and
 * the region is thirty times larger. So it is done where anyone would look —
 * fourteen towns over 15 000 people, within 70 km, outside Hamburg's own box.
 * Together 725 km², under a third of Hamburg's area, and it buys the streets
 * that name a station and the water and green that make a place legible.
 */
const TOWNS = [
  ['Lübeck', 10.68, 53.87], ['Neumünster', 9.98, 54.08], ['Lüneburg', 10.41, 53.25],
  ['Stade', 9.48, 53.60], ['Itzehoe', 9.52, 53.92], ['Bad Oldesloe', 10.37, 53.81],
  ['Rotenburg (Wümme)', 9.40, 53.11], ['Kaltenkirchen', 9.96, 53.84],
  ['Bad Segeberg', 10.30, 53.94], ['Schneverdingen', 9.79, 53.12],
  ['Bremervörde', 9.14, 53.49], ['Mölln', 10.69, 53.63],
  ['Stockelsdorf', 10.64, 53.90], ['Bad Bramstedt', 9.88, 53.92],
];
const townBox = ([, lon, lat]) =>
  [lat - 0.035, lon - 0.05, lat + 0.035, lon + 0.05].map((v) => v.toFixed(4)).join(',');

/** Queries too large for one request, and how finely to cut them. */
const SPLIT = { waterways: [3, 2], green: [3, 2] };

const only = process.argv.slice(2);

if (!only.length || only.includes('towns')) {
  const merged = new Map();
  for (const [i, town] of TOWNS.entries()) {
    const box = townBox(town);
    const part = await overpass(
      `region-town-${i}`,
      q(`
  way["natural"="water"](${box});
  relation["natural"="water"](${box});
  way["waterway"~"^(river|canal|stream)$"](${box});
  way["leisure"="park"](${box});
  way["natural"="wood"](${box});
  way["landuse"~"^(forest|grass|meadow|cemetery|allotments|recreation_ground)$"](${box});
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified)$"]["name"](${box})`)
    );
    for (const el of part.elements ?? []) merged.set(`${el.type}/${el.id}`, el);
    console.log(`    ${town[0]}: ${part.elements?.length ?? 0} Elemente`);
  }
  await writeJson('data/raw/region-towns.json', { elements: [...merged.values()] });
  console.log(`  region-towns: ${merged.size} Elemente aus ${TOWNS.length} Orten`);
}

for (const [name, query] of Object.entries(QUERIES)) {
  if (only.length && !only.includes(name)) continue;
  const cut = SPLIT[name];
  if (!cut) {
    const j = await overpass(`region-${name}`, query);
    console.log(`  region-${name}: ${j.elements?.length ?? 0} Elemente`);
    continue;
  }
  const boxes = tiles(REGION_BBOX, cut[0], cut[1]);
  const merged = new Map();
  for (const [i, box] of boxes.entries()) {
    const part = await overpass(
      `region-${name}-${i}`,
      query.replaceAll(REGION_BBOX, box)
    );
    for (const el of part.elements ?? []) merged.set(`${el.type}/${el.id}`, el);
    console.log(`    Kachel ${i + 1}/${boxes.length}: ${part.elements?.length ?? 0} Elemente`);
  }
  await writeJson(`data/raw/region-${name}.json`, { elements: [...merged.values()] });
  console.log(`  region-${name}: ${merged.size} Elemente aus ${boxes.length} Kacheln`);
}

// A quick look at what population data actually came back — the regional
// catchment model stands or falls on it.
const places = await overpass('region-places', QUERIES.places);
const withPop = (places.elements ?? []).filter((p) => p.tags?.population);
const total = withPop.reduce((s, p) => s + (parseInt(p.tags.population, 10) || 0), 0);
console.log(
  `  Orte: ${places.elements.length}, davon ${withPop.length} mit Einwohnerzahl, zusammen ${total.toLocaleString('de-DE')}`
);
for (const name of ['Kiel', 'Rostock', 'Lüneburg', 'Lauenburg/Elbe', 'Lübeck']) {
  const hit = places.elements.find((p) => p.tags?.name === name);
  console.log(`    ${name.padEnd(16)} ${hit ? `${hit.tags.population ?? 'ohne Einwohnerzahl'}` : 'nicht gefunden'}`);
}
await writeJson('data/raw/region-places.json', { elements: places.elements });
