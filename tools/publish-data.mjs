// Copy the versioned datasets into the web app's public directory and write a
// manifest the client uses to discover what is available.
//
// The manifest lists cities, not files: the app asks for "berlin" and gets the
// six datasets that belong to it. Hamburg's files stay at the top level for
// historic reasons; every other city lives in its own directory.
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'data/dist');
const DST = resolve(ROOT, 'apps/web/public/data');
// `streets` is fetched only when someone zooms in far enough to want it, so it
// is listed in the manifest but never loaded with the rest.
const KINDS = ['city', 'basemap', 'network', 'scenarios', 'params', 'projects', 'streets'];

await mkdir(DST, { recursive: true });

/** Copy one directory of datasets and return {kind: "file?v=hash"}. */
async function publish(srcDir, dstDir, prefix) {
  await mkdir(dstDir, { recursive: true });
  const files = (await readdir(srcDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name);
  const out = {};
  let bytes = 0;
  let version = null;
  for (const f of files) {
    await copyFile(resolve(srcDir, f), resolve(dstDir, f));
    const { size } = await stat(resolve(dstDir, f));
    bytes += size;
    // A content hash in the URL. The filenames carry the data version, but
    // that version is rewritten in place while the data is still being worked
    // on — and a browser holding an `immutable` copy never asks again.
    const hash = createHash('sha256')
      .update(await readFile(resolve(dstDir, f)))
      .digest('hex')
      .slice(0, 10);
    const m = f.match(/^([a-z]+)-(\d{4}-\d{2})\.json$/);
    if (!m) continue;
    const [, kind, v] = m;
    if (!KINDS.includes(kind)) continue;
    version = v;
    out[kind] = `${prefix}${f}?v=${hash}`;
    console.log(`  ${(prefix + f).padEnd(42)} ${(size / 1e6).toFixed(2)} MB  ${hash}`);
  }
  return { files: out, bytes, version };
}

const configs = (await readdir(resolve(ROOT, 'data/cities')))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

const cities = {};
let total = 0;
let version = null;

for (const id of configs) {
  const config = JSON.parse(await readFile(resolve(ROOT, `data/cities/${id}.json`), 'utf8'));
  // Hamburg's datasets sit directly in data/dist; every other city has its own
  // subdirectory, both in the source and in what is published.
  const srcDir = id === 'hamburg' ? SRC : resolve(SRC, id);
  const dstDir = id === 'hamburg' ? DST : resolve(DST, id);
  const prefix = id === 'hamburg' ? '' : `${id}/`;
  let published;
  try {
    published = await publish(srcDir, dstDir, prefix);
  } catch {
    console.log(`  (${config.name}: noch keine Daten gebaut, übersprungen)`);
    continue;
  }
  if (KINDS.some((k) => !published.files[k])) {
    const missing = KINDS.filter((k) => !published.files[k]);
    console.log(`  (${config.name}: unvollständig, es fehlen ${missing.join(', ')} — übersprungen)`);
    continue;
  }
  total += published.bytes;
  version = published.version ?? version;
  cities[id] = {
    id,
    name: config.name,
    // The adjective and the statistics source are city facts the interface has
    // to say out loud — the attribution under the map, the wording of the cost
    // explanation. Hard-coded, they read "Statistikamt Nord" over Berlin.
    adjective: config.adjective ?? config.name,
    statistics: {
      label: config.statistics?.label ?? 'amtliche Statistik',
      licence: config.statistics?.licence ?? null,
    },
    center: config.center,
    files: published.files,
  };
}

if (!Object.keys(cities).length) throw new Error('Keine vollständigen Stadtdatensätze gefunden.');

const defaultCity = cities.hamburg ? 'hamburg' : Object.keys(cities)[0];
await writeFile(
  resolve(DST, 'manifest.json'),
  JSON.stringify(
    {
      version,
      defaultCity,
      cities,
      // Kept so an older client that has not been reloaded still finds the
      // Hamburg datasets where it expects them.
      files: cities[defaultCity].files,
      generated: new Date().toISOString(),
    },
    null,
    2
  )
);

console.log(
  `\nDatenstand ${version}, ${Object.keys(cities).length} Stadt/Städte, ${(total / 1e6).toFixed(1)} MB gesamt`
);
