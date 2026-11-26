// Everything Berlin needs, in one pass.
//
// Hamburg's import is split across several scripts because its population data
// comes from a separate official API. Everything Berlin needs from the network
// comes from OpenStreetMap, so one script covers it: network, stations,
// geography, district boundaries and the surrounding region. The population
// per Ortsteil is the official register count, kept in data/curated because
// the Amt für Statistik publishes it as a report rather than an open endpoint.
//
//   node tools/importer/fetch-berlin.mjs

import { overpass, writeJson } from './overpass.mjs';
import { loadCity } from './lib/city.mjs';

const city = await loadCity('berlin');
const B = city.bbox;
const R = city.regionBbox;
const S = city.stationBbox;

const Q = (body) => `[out:json][timeout:900];\n(${body.trim().replace(/;?$/, ';')}\n);\nout geom;`;
const AREA = `area["boundary"="administrative"]["admin_level"="${city.boundary.adminLevel}"]["name"="${city.boundary.name}"]->.city;`;

console.log(`Berlin: Rohdaten holen (${B})`);

// ------------------------------------------------------------- the network --

// Route relations with full geometry and ordered stop lists. Berlin's trams
// are part of the rapid-transit picture in a way Hamburg's (non-existent) ones
// are not, so they come along.
const routes = await overpass(
  'berlin-transit-routes',
  `[out:json][timeout:900];
${AREA}
(
  relation["type"="route"]["route"="subway"](area.city);
  relation["type"="route"]["route"="light_rail"](area.city);
  relation["type"="route"]["route"="tram"](area.city);
)->.routes;
.routes out body;
node(r.routes)->.rnodes;
.rnodes out body;
way(r.routes)->.rways;
.rways out body;
node(w.rways);
out skel qt;`
);
await writeJson('data/raw/berlin-transit-routes.normalized.json', routes);
console.log(`  Routen: ${routes.elements.filter((e) => e.type === 'relation').length} Relationen`);

// Named station objects over the whole region, for naming and matching. The
// shape matches what fetch-stations.mjs writes for Hamburg, so the network
// builder does not have to know which city it is reading.
const stationsRaw = await overpass(
  'berlin-stations',
  `[out:json][timeout:900];
(
  node["railway"~"^(station|halt|tram_stop)$"](${S});
  way["railway"~"^(station|halt)$"](${S});
  node["public_transport"="station"]["train"="yes"](${S});
  node["public_transport"="station"]["subway"="yes"](${S});
  relation["public_transport"="stop_area"](${S});
);
out center tags;`
);
const namedStations = (stationsRaw.elements ?? [])
  .filter((e) => e.tags?.name)
  .map((e) => ({
    id: `${e.type[0]}${e.id}`,
    name: e.tags.name,
    lon: e.lon ?? e.center?.lon,
    lat: e.lat ?? e.center?.lat,
    tags: e.tags,
  }))
  .filter((e) => e.lon != null);
await writeJson('data/raw/berlin-stations.json', { elements: namedStations });
console.log(`  ${namedStations.length} benannte Stationsobjekte`);

// ----------------------------------------------------------- the geography --

const GEO = {
  'berlin-geo-water': Q(`
  way["natural"="water"](${B});
  relation["natural"="water"](${B});
  way["waterway"="riverbank"](${B});
  relation["waterway"="riverbank"](${B});
  way["landuse"="basin"](${B});
  way["waterway"="river"](${B});
  way["waterway"="canal"](${B})`),
  'berlin-geo-green': Q(`
  way["leisure"="park"](${B});
  relation["leisure"="park"](${B});
  way["landuse"="forest"](${B});
  relation["landuse"="forest"](${B});
  way["landuse"="cemetery"](${B});
  way["leisure"="garden"]["access"!="private"](${B})`),
  'berlin-geo-roads': Q(`
  way["highway"~"^(motorway|trunk|primary|secondary)$"](${B})`),
  'berlin-geo-streets': Q(`
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"]["name"](${B})`),
  'berlin-geo-landuse': Q(`
  way["landuse"~"^(residential|commercial|industrial|retail)$"](${B});
  relation["landuse"~"^(residential|commercial|industrial|retail)$"](${B})`),
  'berlin-geo-landmarks': Q(`
  node["place"~"^(suburb|quarter|neighbourhood|borough)$"]["name"](${B});
  node["amenity"~"^(university|hospital|townhall|theatre|museum|college|ferry_terminal)$"]["name"](${B});
  way["amenity"~"^(university|hospital|townhall)$"]["name"](${B});
  way["leisure"="stadium"]["name"](${B});
  node["tourism"~"^(zoo|museum)$"]["name"](${B});
  way["shop"="mall"]["name"](${B});
  node["aeroway"="aerodrome"]["name"](${B});
  way["aeroway"="aerodrome"]["name"](${B})`),
  'berlin-geo-buildings_big': Q(`
  way["building"]["building:levels"](${B})`),
  // Same query as Hamburg's, and for the same reason. It had drifted: without
  // `subway` Berlin's corridor data held no U-Bahn at all, so a line drawn
  // along the elevated U6 through Tegel or the U1 viaduct counted as cutting a
  // new swathe through the city and drew a buildability warning it had not
  // earned. Without `service!~"."` it carried sidings and depot tracks that
  // Hamburg's did not, which is the same asymmetry the other way round. The
  // tunnelled parts are dropped later, when the corridors are built.
  'berlin-geo-railways': Q(`
  way["railway"~"^(rail|light_rail|subway|narrow_gauge)$"]["service"!~"."](${B})`),
};
for (const [name, query] of Object.entries(GEO)) {
  await overpass(name, query);
}

// ------------------------------------------------------------- the districts --

// Berlin's 97 Ortsteile as boundary relations. A bounding box rather than an
// `area[]` lookup: resolving the Berlin area and then intersecting a hundred
// detailed boundaries against it makes Overpass time out. `ref:DE-BE:OT`, the
// official Ortsteil number, marks a Berlin Ortsteil, keeps Brandenburg's own
// out, and is the key the importer joins the official population on.
const districts = await overpass(
  'berlin-districts',
  `[out:json][timeout:900];
relation["boundary"="administrative"]["admin_level"="${city.districts.adminLevel}"]["ref:DE-BE:OT"](${B});
out geom;`
);
console.log(`  Ortsteile: ${districts.elements.length}`);

// ---------------------------------------------------------------- the region --

const REGION = {
  'berlin-region-places': Q(`
  node["place"~"^(city|town|village)$"]["name"](${R})`),
  'berlin-region-water': Q(`
  way["natural"="water"](${R});
  relation["natural"="water"](${R})`),
  'berlin-region-roads': Q(`
  way["highway"~"^(motorway|trunk)$"](${R})`),
  'berlin-region-rail': Q(`
  way["railway"="rail"]["usage"~"^(main|branch)$"]["service"!~"."](${R})`),
};
for (const [name, query] of Object.entries(REGION)) {
  await overpass(name, query);
}

console.log('fertig');
