// Fetch Hamburg rapid-transit route relations (U-Bahn, S-Bahn, AKN) with full
// geometry and ordered stop lists from OpenStreetMap via Overpass.
import { overpass, indexElements, writeJson } from './overpass.mjs';

const QUERY = `[out:json][timeout:600];
area["boundary"="administrative"]["admin_level"="4"]["name"="Hamburg"]->.hh;
(
  relation["type"="route"]["route"="subway"]["network"~"Hamburg",i](area.hh);
  relation["type"="route"]["route"="light_rail"]["network"~"Hamburg",i](area.hh);
  relation["type"="route"]["route"="train"]["operator"~"AKN"](area.hh);
)->.routes;
.routes out body;
node(r.routes)->.rnodes;
.rnodes out body;
way(r.routes)->.rways;
.rways out body;
node(w.rways);
out skel qt;`;

const raw = await overpass('transit-routes', QUERY);
await writeJson('data/raw/transit-routes.normalized.json', raw);
const { nodes, ways, rels } = indexElements(raw);
console.log(`  relations=${rels.size} ways=${ways.size} nodes=${nodes.size}`);
const refs = new Map();
for (const r of rels.values()) {
  const t = r.tags || {};
  const k = t.ref || t.name;
  refs.set(k, (refs.get(k) || 0) + 1);
}
console.log('  route refs:', [...refs].map(([k, v]) => `${k}(${v})`).join(' '));
