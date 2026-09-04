// Official Hamburg regional statistics per Stadtteil (Statistikamt Nord,
// published via the Hamburg OGC API Features endpoint).
// Licence: Datenlizenz Deutschland – Namensnennung – Version 2.0.
import { writeJson, ROOT } from './overpass.mjs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE =
  'https://api.hamburg.de/datasets/v1/regionalstatistische_daten_stadtteile/collections/regionalstatistische_daten_stadtteile/items';
const CACHE = resolve(ROOT, 'data/raw/hh-regionalstatistik.json');

async function cached(fn) {
  try {
    await stat(CACHE);
    console.log('  [cache] hh-regionalstatistik');
    return JSON.parse(await readFile(CACHE, 'utf8'));
  } catch {}
  const v = await fn();
  await mkdir(resolve(ROOT, 'data/raw'), { recursive: true });
  await writeFile(CACHE, JSON.stringify(v));
  return v;
}

const all = await cached(async () => {
  const features = [];
  let offset = 0;
  for (;;) {
    const url = `${BASE}?limit=200&offset=${offset}&f=json`;
    process.stdout.write(`  [fetch] regionalstatistik offset=${offset} ... `);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'hamburg-transit-designer/0.1' },
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const page = await res.json();
    const got = page.features ?? [];
    console.log(`${got.length} features`);
    features.push(...got);
    if (got.length < 200) break;
    offset += 200;
    if (offset > 4000) break;
  }
  return { type: 'FeatureCollection', features };
});

const years = new Set(all.features.map((f) => String(f.properties.jahr)));
const latest = [...years].sort().at(-1);
console.log(`  years: ${[...years].sort().join(', ')} -> using ${latest}`);

const districts = all.features
  .filter((f) => String(f.properties.jahr) === latest && f.properties.verwaltungseinheit === 'Stadtteil')
  .map((f) => {
    const p = f.properties;
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: String(p.stadtteil_nr),
        name: p.stadtteil,
        borough: p.bezirk,
        boroughId: String(p.bezirk_nr),
        population: p.bev_insgesamt ?? 0,
        populationUnder18: p.bev_u18 ?? 0,
        population15to64: p.bev_15_bis_64 ?? 0,
        populationOver65: p.bev_ab65 ?? 0,
        areaHa: p.flaeche_brutto_ha ?? 0,
        densityPerHa: p.flaeche_einw_pro_ha ?? 0,
        households: p.hau_privathaushalte_anz ?? 0,
        employedResidents: p.soz_sozverpflichtig_beschaeftigte_ins_anz ?? 0,
        unemployed: p.arb_arbeitslose_ingesamt_anz ?? 0,
        dwellings: p.wohn_wohnungen_in_wohn_und_nichtwohngebauede_anz ?? 0,
        carsPer1000: p.ver_private_pkw_je_1000_ew_anz ?? 0,
        privateCars: p.ver_private_pkw_anz ?? 0,
      },
    };
  });

const totals = districts.reduce(
  (a, d) => {
    a.population += d.properties.population;
    a.employedResidents += d.properties.employedResidents;
    a.households += d.properties.households;
    a.areaHa += d.properties.areaHa;
    return a;
  },
  { population: 0, employedResidents: 0, households: 0, areaHa: 0 }
);

console.log(
  `  ${districts.length} Stadtteile | ${totals.population.toLocaleString('de-DE')} Einwohner | ` +
    `${totals.employedResidents.toLocaleString('de-DE')} SV-Beschäftigte (Wohnort) | ${Math.round(totals.areaHa / 100)} km²`
);

await writeJson('data/raw/districts.geojson', {
  type: 'FeatureCollection',
  metadata: {
    source: 'Statistikamt Nord / Freie und Hansestadt Hamburg — Regionalstatistische Daten der Stadtteile',
    url: 'https://api.hamburg.de/datasets/v1/regionalstatistische_daten_stadtteile',
    licence: 'Datenlizenz Deutschland Namensnennung 2.0',
    referenceYear: latest,
    totals,
  },
  features: districts,
});
