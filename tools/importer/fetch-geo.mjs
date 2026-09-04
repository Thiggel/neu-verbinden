// Base geography for the stylised Hamburg map + the analytical layers the
// simulation engine needs (land use for the population/jobs surface,
// street names and landmarks for automatic station naming).
import { overpass } from './overpass.mjs';

// Hamburg city region. Transit geometry may extend beyond; the base map does not.
export const BBOX = '53.32,9.60,53.80,10.40';

const Q = (body) => `[out:json][timeout:900];\n(${body.trim().replace(/;?$/, ';')}\n);\nout geom;`;

const QUERIES = {
  water: Q(`
  way["natural"="water"](${BBOX});
  relation["natural"="water"](${BBOX});
  way["waterway"="riverbank"](${BBOX});
  relation["waterway"="riverbank"](${BBOX});
  way["landuse"="basin"](${BBOX});
  way["natural"="coastline"](${BBOX});
  way["waterway"="river"](${BBOX});
  way["waterway"="canal"](${BBOX})`),

  green: Q(`
  way["leisure"="park"](${BBOX});
  relation["leisure"="park"](${BBOX});
  way["leisure"="garden"]["access"!="private"](${BBOX});
  way["natural"="wood"](${BBOX});
  relation["natural"="wood"](${BBOX});
  way["landuse"~"^(forest|grass|meadow|recreation_ground|village_green|cemetery|allotments|orchard|farmland)$"](${BBOX});
  relation["landuse"~"^(forest|recreation_ground|cemetery|allotments)$"](${BBOX})`),

  roads: Q(`
  way["highway"~"^(motorway|trunk|primary|secondary)$"](${BBOX})`),

  streets: Q(`
  way["highway"~"^(tertiary|residential|unclassified|living_street)$"]["name"](${BBOX})`),

  landuse: Q(`
  way["landuse"~"^(residential|commercial|industrial|retail|construction|port)$"](${BBOX});
  relation["landuse"~"^(residential|commercial|industrial|retail|port)$"](${BBOX})`),

  landmarks: Q(`
  node["place"~"^(city|borough|suburb|quarter|neighbourhood|town|village)$"](${BBOX});
  nwr["amenity"~"^(university|college|hospital|townhall|theatre|arts_centre|conference_centre|prison)$"](${BBOX});
  nwr["shop"="mall"](${BBOX});
  nwr["tourism"~"^(attraction|museum|zoo|theme_park)$"](${BBOX});
  nwr["leisure"~"^(stadium|sports_centre|water_park)$"](${BBOX});
  nwr["aeroway"="aerodrome"](${BBOX});
  nwr["amenity"="ferry_terminal"](${BBOX});
  nwr["public_transport"="station"](${BBOX});
  nwr["railway"~"^(station|halt)$"](${BBOX})`),

  boundaries: Q(`
  relation["boundary"="administrative"]["admin_level"~"^(9|10)$"](${BBOX})`),

  railways: Q(`
  way["railway"~"^(rail|light_rail|subway|narrow_gauge)$"]["service"!~"."](${BBOX})`),

  buildings_big: Q(`
  way["building"]["building:levels"](${BBOX})`),
};

const only = process.argv.slice(2);
for (const [name, query] of Object.entries(QUERIES)) {
  if (only.length && !only.includes(name)) continue;
  await overpass(`geo-${name}`, query);
}
console.log('done');
