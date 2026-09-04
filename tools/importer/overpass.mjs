// Overpass fetch helper with on-disk caching.
// All raw responses are cached under data/raw/ so imports are reproducible
// and we stay friendly to the public Overpass instances.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RAW = resolve(ROOT, 'data/raw');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Record which cached file belongs to the query that is current *now*.
 *
 * The cache is keyed by a hash of the query, so editing a query leaves the old
 * response sitting beside the new one. The builders used to take whichever
 * filename came first in the directory, which meant a changed query could go
 * on being ignored for as long as the old file happened to sort earlier —
 * Berlin's railway query was rewritten, refetched, and the build kept reading
 * the previous answer. Which data a build uses must not depend on alphabetical
 * order.
 */
async function markCurrent(name, file) {
  const indexFile = resolve(RAW, 'index.json');
  let index = {};
  try {
    index = JSON.parse(await readFile(indexFile, 'utf8'));
  } catch {}
  if (index[name] === file) return;
  index[name] = file;
  await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`);
}

export async function overpass(name, query, { force = false } = {}) {
  await mkdir(RAW, { recursive: true });
  const hash = createHash('sha1').update(query).digest('hex').slice(0, 10);
  const file = resolve(RAW, `${name}.${hash}.json`);
  await markCurrent(name, `${name}.${hash}.json`);
  if (!force) {
    try {
      await stat(file);
      const cached = JSON.parse(await readFile(file, 'utf8'));
      console.log(`  [cache] ${name} (${cached.elements?.length ?? 0} elements)`);
      return cached;
    } catch {}
  }
  let lastErr;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      process.stdout.write(`  [fetch] ${name} via ${new URL(endpoint).host} ... `);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'hamburg-transit-designer/0.1 (versioned data import; contact via repository)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const json = JSON.parse(text);
      if (json.remark && /error/i.test(json.remark)) throw new Error(json.remark);
      console.log(`ok (${json.elements?.length ?? 0} elements, ${(text.length / 1e6).toFixed(1)} MB)`);
      await writeFile(file, text);
      return json;
    } catch (err) {
      lastErr = err;
      console.log(`failed: ${err.message}`);
      await sleep(4000 + attempt * 3000);
    }
  }
  throw new Error(`Overpass query "${name}" failed: ${lastErr?.message}`);
}

/** Index an Overpass element array by "type/id". */
export function indexElements(json) {
  const nodes = new Map();
  const ways = new Map();
  const rels = new Map();
  for (const el of json.elements ?? []) {
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'way') ways.set(el.id, el);
    else if (el.type === 'relation') rels.set(el.id, el);
  }
  return { nodes, ways, rels };
}

export async function writeJson(relPath, value) {
  const file = resolve(ROOT, relPath);
  await mkdir(dirname(file), { recursive: true });
  const text = JSON.stringify(value);
  await writeFile(file, text);
  console.log(`  [write] ${relPath} (${(text.length / 1e6).toFixed(2)} MB)`);
}

export async function writeJsonPretty(relPath, value) {
  const file = resolve(ROOT, relPath);
  await mkdir(dirname(file), { recursive: true });
  const text = JSON.stringify(value, null, 2);
  await writeFile(file, text);
  console.log(`  [write] ${relPath} (${(text.length / 1e6).toFixed(2)} MB)`);
}
