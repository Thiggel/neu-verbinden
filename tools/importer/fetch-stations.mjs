// Named station objects for the whole S-Bahn/AKN catchment. Route relations
// reference unnamed stop_position nodes, so the names have to come from the
// station/halt objects nearby.
import { overpass, writeJson } from './overpass.mjs';

// The whole area a regional line could plausibly reach: Lüneburg and
// Lauenburg to the south, Kiel to the north, Rostock to the east.
const BBOX = '53.00,9.10,54.55,12.55';
const q = `[out:json][timeout:600];
(
  node["railway"~"^(station|halt|tram_stop)$"](${BBOX});
  way["railway"~"^(station|halt)$"](${BBOX});
  node["public_transport"="station"]["train"="yes"](${BBOX});
  node["public_transport"="station"]["subway"="yes"](${BBOX});
  relation["public_transport"="stop_area"](${BBOX});
);
out center tags;`;

const j = await overpass('stations', q);
const named = (j.elements ?? []).filter((e) => e.tags?.name);
console.log(`  ${named.length} benannte Stationsobjekte`);
await writeJson('data/raw/stations.json', {
  elements: named.map((e) => ({
    id: `${e.type[0]}${e.id}`,
    name: e.tags.name,
    lon: e.lon ?? e.center?.lon,
    lat: e.lat ?? e.center?.lat,
    tags: e.tags,
  })).filter((e) => e.lon != null),
});
