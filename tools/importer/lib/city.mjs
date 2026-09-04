// Which city an import is for.
//
// Everything city-specific — the bounding boxes, the projection origin, where
// the population figures come from — lives in `data/cities/<id>.json` rather
// than in the scripts, so adding a city is a data change and not a fork of the
// pipeline.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from '../overpass.mjs';

/** The city id for this run: `--city=berlin`, `HH_CITY=berlin`, else hamburg. */
export function cityId() {
  const arg = process.argv.find((a) => a.startsWith('--city='));
  return (arg ? arg.slice('--city='.length) : process.env.HH_CITY || 'hamburg').toLowerCase();
}

export async function loadCity(id = cityId()) {
  const path = resolve(ROOT, `data/cities/${id}.json`);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Keine Stadtkonfiguration für „${id}" (erwartet: ${path})`);
  }
  const city = JSON.parse(text);
  for (const key of ['id', 'name', 'center', 'projectionOrigin', 'bbox', 'regionBbox']) {
    if (city[key] == null) throw new Error(`In ${path} fehlt „${key}"`);
  }
  return city;
}

/** Raw-file prefix, so two cities never share a cache entry. */
export const rawName = (city, name) => (city.id === 'hamburg' ? name : `${city.id}-${name}`);

/** Where a built dataset goes. Hamburg keeps its original paths. */
export const distName = (city, name, version) =>
  city.id === 'hamburg'
    ? `data/dist/${name}-${version}.json`
    : `data/dist/${city.id}/${name}-${version}.json`;
