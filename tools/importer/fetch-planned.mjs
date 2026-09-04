// Officially planned and under-construction rail infrastructure as mapped in
// OpenStreetMap (U5, U4 extension, S4, S32 …), including the planned stations.
import { overpass, writeJson } from './overpass.mjs';

const BBOX = '53.25,9.35,53.95,10.60';
const q = `[out:json][timeout:900];
(
  way["railway"~"^(proposed|construction)$"](${BBOX});
  way["proposed:railway"](${BBOX});
  way["construction:railway"](${BBOX});
  node["railway"~"^(proposed|construction)$"](${BBOX});
  node["proposed:railway"~"^(station|halt)$"](${BBOX});
  node["construction:railway"~"^(station|halt)$"](${BBOX});
  node["public_transport"="station"]["construction"](${BBOX});
);
out geom tags;`;

const j = await overpass('planned', q);
const ways = j.elements.filter((e) => e.type === 'way' && e.geometry?.length > 1);
const nodes = j.elements.filter((e) => e.type === 'node');
console.log(`  ${ways.length} Wege, ${nodes.length} Punkte`);
const tally = {};
for (const w of ways) {
  const t = w.tags;
  const k = `${t.railway ?? ''}/${t['proposed:railway'] ?? t['construction:railway'] ?? ''}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
console.log('  ', JSON.stringify(tally));
console.log(
  '   benannte Punkte:',
  nodes.filter((n) => n.tags?.name).map((n) => n.tags.name).slice(0, 60).join(', ')
);
await writeJson('data/raw/planned.json', {
  ways: ways.map((w) => ({ id: w.id, tags: w.tags, geo: w.geometry.map((g) => [g.lon, g.lat]) })),
  nodes: nodes.map((n) => ({ id: n.id, tags: n.tags, lon: n.lon, lat: n.lat })),
});
