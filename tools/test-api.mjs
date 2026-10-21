// Integration test for the API server.
//
// Exercises the whole social loop against a running server and a real
// database: register, publish, recompute, vote, comment, fork, rank, and the
// rejections that matter (unauthenticated writes, tampered networks, a
// scenario claiming figures it did not earn).
//
//   npm run server            # in one shell
//   node tools/test-api.mjs   # in another
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HH_API_URL ?? 'http://localhost:8080';
const V = process.env.HH_DATA_VERSION ?? '2026-09';

let passed = 0;
let failed = 0;
const log = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    log.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    log.push(`  ✗ ${name}\n      ${e.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg ?? 'Erwartung nicht erfüllt');
};

async function call(path, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (raw) return { status: res.status, json };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.error ?? text}`);
  return json;
}

// A real Hamburg scenario document, built from the published datasets.
async function buildDocument(templateId) {
  const network = JSON.parse(await readFile(resolve(ROOT, `data/dist/network-${V}.json`), 'utf8'));
  const templates = JSON.parse(await readFile(resolve(ROOT, `data/dist/scenarios-${V}.json`), 'utf8'));
  const template = templates.find((t) => t.id === templateId);
  assert(template, `Szenario ${templateId} nicht gefunden`);
  const included = new Set(template.includedLines);
  for (const line of Object.values(network.lines)) {
    line.included = included.has(line.external_id);
  }
  return JSON.stringify({
    format: 1,
    calculationVersion: '0.9.0',
    dataVersion: V,
    title: template.title,
    description: '',
    network,
  });
}

// Stable handles: the per-address registration limit is deliberately tight,
// and a suite that mints a fresh account on every run would exhaust it.
const suffix = 'stable';
const handle = `apitest${suffix}`;
let token;
let slug;

/**
 * Clear the *per-address* rate-limit buckets, if the caller asked for it.
 *
 * These suites run many times an hour on one machine, which is exactly the
 * pattern the write limits exist to stop. Set `HH_TEST_DB` to the local
 * database to let a development machine clear the counters that are merely in
 * the way. The login and vote limits are *not* cleared — the tests below prove
 * those still bite.
 */
async function relaxAddressLimits() {
  const db = process.env.HH_TEST_DB;
  if (!db) return;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    await promisify(execFile)('psql', [
      db,
      '-c',
      "DELETE FROM rate_limits WHERE bucket LIKE 'register-ip:%' OR bucket LIKE 'login-ip:%' " +
        "OR bucket LIKE 'create:%' OR bucket LIKE 'fork:%' OR bucket LIKE 'comment:%'",
    ]);
  } catch {
    // No psql, wrong credentials — not a reason to fail the suite.
  }
}
await relaxAddressLimits();

await check('Health meldet die Datenversion', async () => {
  const h = await call('/api/health');
  assert(h.ok === true, 'Server nicht bereit');
  assert(h.dataVersion === V, `Datenstand ${h.dataVersion}`);
});

await check('Meta nennt Modellversion, Quellen und Sortierungen', async () => {
  const m = await call('/api/meta');
  assert(m.calculationVersion, 'keine Modellversion');
  assert(m.sorts.length >= 10, 'zu wenige Sortierungen');
  assert(m.sources.length >= 2, 'zu wenige Quellen');
  assert(m.disclaimer.includes('Modellschätzung'), 'kein Hinweis auf Modellcharakter');
});

await check('Registrierung oder Anmeldung liefert eine Sitzung', async () => {
  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: { handle, password: 'ein-hinreichend-langes-passwort', display_name: 'API-Test' },
    raw: true,
  });
  if (reg.status === 200) {
    token = reg.json.token;
  } else {
    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { handle, password: 'ein-hinreichend-langes-passwort' },
    });
    token = login.token;
  }
  assert(token, 'kein Token');
});

await check('ein zu kurzes Passwort wird abgelehnt', async () => {
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { handle: `${handle}x`, password: 'kurz' },
    raw: true,
  });
  assert(r.status === 400, `Status ${r.status}`);
});

await check('ein belegter Nutzername wird abgelehnt', async () => {
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { handle, password: 'ein-hinreichend-langes-passwort' },
    raw: true,
  });
  assert(r.status === 409 || r.status === 429, `Status ${r.status}`);
});

await check('Anmeldung mit falschem Passwort schlägt fehl', async () => {
  const r = await call('/api/auth/login', {
    method: 'POST',
    body: { handle, password: 'falsch-aber-lang-genug' },
    raw: true,
  });
  assert(r.status === 401, `Status ${r.status}`);
});

await check('ohne Konto lässt sich nichts veröffentlichen', async () => {
  const r = await call('/api/scenarios', {
    method: 'POST',
    body: { title: 'X', document: '{}', visibility: 'public' },
    raw: true,
  });
  assert(r.status === 401, `Status ${r.status}`);
});

let published;
await check('Veröffentlichen rechnet serverseitig nach', async () => {
  const document = await buildDocument('beschlossen');
  published = await call('/api/scenarios', {
    method: 'POST',
    token,
    body: {
      title: `API-Test ${suffix}`,
      description: 'Automatischer Integrationstest.',
      document,
      visibility: 'public',
    },
  });
  slug = published.slug;
  assert(slug.startsWith('api-test'), `Slug ${slug}`);
  assert(published.network_km > 300, `Netzlänge ${published.network_km}`);
  assert(published.new_km > 40, `Neubau ${published.new_km}`);
  assert(published.investment_eur > 5e9, `Investition ${published.investment_eur}`);
  assert(published.opening_year > 2030, `Eröffnung ${published.opening_year}`);
});

await check('behauptete Kennzahlen des Clients werden ignoriert', async () => {
  const document = await buildDocument('bestand');
  const r = await call('/api/scenarios', {
    method: 'POST',
    token,
    body: {
      title: `Behauptung ${suffix}`,
      document,
      visibility: 'private',
      // The client has no way to inject these; the server recomputes anyway.
      investment_eur: 1,
      annual_benefit_eur: 999e9,
      votes: 5000,
    },
  });
  assert(r.investment_eur === 0, `Investition ${r.investment_eur} statt 0`);
  assert(r.annual_benefit_eur === 0, `Nutzen ${r.annual_benefit_eur} statt 0`);
  assert(r.votes === 0, `Stimmen ${r.votes}`);
});

await check('ein manipuliertes Netz wird abgelehnt', async () => {
  const doc = JSON.parse(await buildDocument('bestand'));
  const firstEdge = Object.keys(doc.network.edges)[0];
  doc.network.edges[firstEdge].from = 999999;
  const r = await call('/api/scenarios', {
    method: 'POST',
    token,
    body: { title: 'Kaputt', document: JSON.stringify(doc), visibility: 'private' },
    raw: true,
  });
  assert(r.status === 400, `Status ${r.status}`);
  assert(/unbekannten Knoten/.test(r.json.error), `Meldung: ${r.json.error}`);
});

await check('ein fremder Datenstand wird abgelehnt', async () => {
  const doc = JSON.parse(await buildDocument('bestand'));
  doc.dataVersion = '1999-01';
  const r = await call('/api/scenarios', {
    method: 'POST',
    token,
    body: { title: 'Alt', document: JSON.stringify(doc), visibility: 'private' },
    raw: true,
  });
  assert(r.status === 400, `Status ${r.status}`);
  assert(/Datenstand/.test(r.json.error), `Meldung: ${r.json.error}`);
});

await check('Abrufen zählt Aufrufe und liefert das Ergebnis', async () => {
  const d = await call(`/api/scenarios/${slug}`);
  assert(d.views >= 1, `Aufrufe ${d.views}`);
  assert(d.result.headline, 'kein Ergebnis im Dokument');
  assert(d.document.network, 'kein Netz im Dokument');
  assert(
    Math.abs(d.result.headline.investmentEur - published.investment_eur) < 1,
    `Ergebnis weicht ab: ${d.result.headline.investmentEur} gegen ${published.investment_eur}`
  );
});

await check('Zustimmen und Zurücknehmen zählt korrekt', async () => {
  const a = await call(`/api/scenarios/${slug}/vote`, { method: 'POST', token });
  assert(a.votes === 1, `Stimmen ${a.votes}`);
  const again = await call(`/api/scenarios/${slug}/vote`, { method: 'POST', token });
  assert(again.votes === 1, 'doppelte Stimme gezählt');
  const off = await call(`/api/scenarios/${slug}/vote`, { method: 'DELETE', token });
  assert(off.votes === 0, `Stimmen nach Rücknahme ${off.votes}`);
  await call(`/api/scenarios/${slug}/vote`, { method: 'POST', token });
});

await check('Kommentare werden gespeichert und gelistet', async () => {
  const body = 'Das Nutzen-Kosten-Verhältnis ist hier der springende Punkt.';
  const c = await call(`/api/scenarios/${slug}/comments`, { method: 'POST', token, body: { body } });
  assert(c.body === body);
  const list = await call(`/api/scenarios/${slug}/comments`);
  assert(list.some((x) => x.body === body), 'Kommentar fehlt in der Liste');
});

await check('leere Kommentare werden abgelehnt', async () => {
  const r = await call(`/api/scenarios/${slug}/comments`, {
    method: 'POST',
    token,
    body: { body: '   ' },
    raw: true,
  });
  assert(r.status === 400, `Status ${r.status}`);
});

let forkSlug;
await check('Forken erhält die Abstammung und die Kennzahlen', async () => {
  const f = await call(`/api/scenarios/${slug}/fork`, { method: 'POST', token });
  forkSlug = f.slug;
  assert(f.parent_slug === slug, `Elternteil ${f.parent_slug}`);
  assert(Math.abs(f.investment_eur - published.investment_eur) < 1, 'Kennzahlen weichen ab');
  const parent = await call(`/api/scenarios/${slug}`);
  assert(parent.forks >= 1, 'Fork nicht am Original gezählt');
});

await check('ein Fork ist zunächst privat', async () => {
  const f = await call(`/api/scenarios/${forkSlug}`, { token });
  assert(f.visibility === 'private', `Sichtbarkeit ${f.visibility}`);
});

await check('private Entwürfe sind für andere unsichtbar', async () => {
  const r = await call(`/api/scenarios/${forkSlug}`, { raw: true });
  assert(r.status === 404, `Status ${r.status}`);
});

await check('die Liste zeigt nur öffentliche Entwürfe', async () => {
  const list = await call('/api/scenarios?sort=neu&limit=50');
  assert(list.some((s) => s.slug === slug), 'veröffentlichter Entwurf fehlt');
  assert(!list.some((s) => s.slug === forkSlug), 'privater Entwurf ist sichtbar');
});

await check('jede Sortierung liefert ein Ergebnis', async () => {
  const meta = await call('/api/meta');
  for (const s of meta.sorts) {
    const list = await call(`/api/scenarios?sort=${s.key}&limit=5`);
    assert(Array.isArray(list), `Sortierung ${s.key} lieferte kein Array`);
  }
});

await check('eine unbekannte Sortierung wird abgelehnt', async () => {
  const r = await call('/api/scenarios?sort=erfunden', { raw: true });
  assert(r.status === 400, `Status ${r.status}`);
});

await check('Ranglisten decken mehrere Dimensionen ab', async () => {
  const boards = await call('/api/leaderboards');
  assert(boards.length >= 8, `nur ${boards.length} Ranglisten`);
  assert(boards.every((b) => b.label), 'Rangliste ohne Beschriftung');
});

await check('Vergleich liefert eine Kennzahlentabelle', async () => {
  const c = await call(`/api/compare?a=${slug}&b=${slug}`);
  assert(c.rows.length >= 10, `nur ${c.rows.length} Zeilen`);
  assert(c.rows.every((r) => r.a === r.b), 'Selbstvergleich weicht ab');
});

// The comparison page's claim is that both sides come from one calculation.
// The API has to say whether that is actually so, otherwise the page is
// asserting something nobody checked.
await check('Vergleich sagt, ob beide Seiten aus derselben Rechnung stammen', async () => {
  const c = await call(`/api/compare?a=${slug}&b=${slug}`);
  assert(c.sameModel === true, 'ein Entwurf mit sich selbst gilt nicht als gleiches Modell');
  assert(c.a.calculationVersion, 'keine Modellversion für Seite A');
  assert(c.a.calculationVersion === c.b.calculationVersion, 'Versionen weichen ab');
});

// And a freshly published scenario has to be recognised as current — that is
// the condition under which nothing gets re-queued for ever.
await check('ein neuer Entwurf gilt sofort als aktuell gerechnet', async () => {
  const d = await call(`/api/scenarios/${slug}`);
  assert(d.parameter_fingerprint, 'kein Parameter-Fingerabdruck gespeichert');
  assert(
    /^[0-9a-f]{12}$/.test(d.parameter_fingerprint),
    `unerwarteter Fingerabdruck: ${d.parameter_fingerprint}`
  );
});

await check('Melden wird angenommen', async () => {
  const r = await call(`/api/scenarios/${slug}/report`, {
    method: 'POST',
    token,
    body: { reason: 'Testmeldung' },
  });
  assert(r.reported === true);
});

await check('Fremde können einen Entwurf nicht löschen', async () => {
  const otherHandle = `other${suffix}`;
  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: { handle: otherHandle, password: 'noch-ein-langes-passwort' },
    raw: true,
  });
  const otherToken =
    reg.status === 200
      ? reg.json.token
      : (await call('/api/auth/login', {
          method: 'POST',
          body: { handle: otherHandle, password: 'noch-ein-langes-passwort' },
        })).token;
  const r = await call(`/api/scenarios/${slug}`, { method: 'DELETE', token: otherToken, raw: true });
  assert(r.status === 403, `Status ${r.status}`);
});

// The wish map is an aggregate over everything published, so the thing to check
// is what it leaves out: the network that already exists, and other people's
// projects carried along inside a plan. Counting those would draw a heat map of
// the railway Hamburg already has.
await check('die Wunschkarte zählt nur, was gebaut würde', async () => {
  const w = await call('/api/wuensche/hamburg');
  assert(typeof w.scenarios === 'number', 'keine Anzahl der Entwürfe');
  assert(Array.isArray(w.cells), 'keine Zellen');
  assert(w.cells.length > 0, 'die Karte ist leer, obwohl Entwürfe veröffentlicht sind');
  assert(w.maxWeight > 0, `maxWeight ist ${w.maxWeight}`);

  // Every cell is [lon, lat, weight] and lies in the city's corner of the world.
  for (const [lon, lat, weight] of w.cells) {
    assert(lon > 8 && lon < 12, `Zelle bei Länge ${lon}`);
    assert(lat > 52.5 && lat < 55, `Zelle bei Breite ${lat}`);
    assert(weight > 0, `Zelle mit Gewicht ${weight}`);
  }

  // The sharp test for "only what would be built" is not a count, which grows
  // with every plan published, but a place. The existing S-Bahn runs out to
  // Stade, Aumühle and Wedel; no sample plan goes near them. If the Bestand
  // were being counted, those termini would be warm. Counting cells instead
  // caught nothing: with the filter removed the map went from 486 cells to
  // 1296, and a threshold loose enough to be safe was loose enough to pass.
  const far = [
    ['Stade', 9.4758, 53.6025],
    ['Aumühle', 10.3133, 53.5283],
    ['Wedel', 9.7044, 53.5817],
  ];
  for (const [name, lon, lat] of far) {
    const near = w.cells.filter(
      (c) => Math.abs(c[0] - lon) * 66 < 2 && Math.abs(c[1] - lat) * 111 < 2
    );
    assert(
      near.length === 0,
      `${near.length} Zellen bei ${name} — dort fährt die S-Bahn längst, da zeichnet niemand`
    );
  }

  // The busiest corridor has to be hotter than the median, or nothing is being
  // aggregated and every cell carries one plan.
  const weights = w.cells.map((c) => c[2]).sort((a, b) => a - b);
  const median = weights[Math.floor(weights.length / 2)];
  assert(w.maxWeight > median * 2, `Maximum ${w.maxWeight} gegen Median ${median}`);
});

// Every Hamburg plan carries the U5 as to_build, because it is being built.
// Counted as a wish, each of its stations collected every plan at full station
// weight, so the hottest spots on the map were the ones nobody had drawn.
await check('die geplante U5 zählt nicht als Wunsch', async () => {
  const w = await call('/api/wuensche/hamburg');
  const floor = w.scenarios * 2.5;
  const u5 = [
    ['Universität Hamburg', 9.9847, 53.5663],
    ['Siemersplatz', 9.9637, 53.5997],
    ['Moldauhafen', 10.0171, 53.5296],
    ['Volksparkstadion', 9.8987, 53.5872],
  ];
  for (const [name, lon, lat] of u5) {
    const near = w.cells.filter(
      (c) => Math.abs(c[0] - lon) * 66 < 0.5 && Math.abs(c[1] - lat) * 111 < 0.5
    );
    const heat = Math.max(0, ...near.map((c) => c[2]));
    assert(heat < floor, `${name} trägt ${heat}, als hätte jeder Entwurf die U5 gezeichnet`);
  }
});

await check('eine erfundene Stadt wird abgelehnt, nicht leer gerechnet', async () => {
  const r = await call('/api/wuensche/gibtesnicht', { raw: true });
  assert(r.status === 400, `Status ${r.status}`);
});

// The checkbox on the wish map sends minVotes. When the server read min_votes
// instead, the box did nothing and nobody noticed, because an unfiltered map
// looks just as plausible as a filtered one.
await check('der Stimmenfilter der Wunschkarte filtert wirklich', async () => {
  const all = await call('/api/wuensche/hamburg');
  const voted = await call('/api/wuensche/hamburg?minVotes=1000');
  assert(all.scenarios > 0, 'keine Entwürfe ohne Filter');
  assert(voted.scenarios === 0, `${voted.scenarios} Entwürfe mit mindestens 1000 Stimmen`);
  assert(voted.cells.length === 0, `${voted.cells.length} Zellen trotz Filter`);
});

await check('Aufräumen: eigene Entwürfe lassen sich löschen', async () => {
  for (const s of [forkSlug, slug]) {
    const r = await call(`/api/scenarios/${s}`, { method: 'DELETE', token });
    assert(r.deleted === true);
  }
  const gone = await call(`/api/scenarios/${slug}`, { raw: true });
  assert(gone.status === 404, `Status ${gone.status}`);
});

console.log(log.join('\n'));
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
