// One long user story, start to finish.
//
// The other suites test pieces. This one walks the path a person actually
// takes: open the app, draw a U-Bahn, an S-Bahn and a tram, extend one, insert
// and remove stops, delete a line, undo and redo, save to a file and open it
// again, publish, then — as a second person — vote, comment, fork and compare.
//
// It runs against the real engine and the real API, so it fails if any joint
// between them moves.
//
//   node tools/test-flow.mjs
import { readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.HH_API ?? 'http://localhost:8080';
const V = process.env.HH_DATA_VERSION ?? '2026-09';

let step = 0;
const done = [];
const fail = [];
const skipped = [];

/**
 * A step that could not run rather than one that went wrong.
 *
 * This story needs two accounts, and registrations are limited to ten per
 * address per hour — a limit the security suite exists to verify. Run the two
 * suites in succession and the second half of this one reported as broken
 * authorisation, which is a lie about the application: nothing was wrong except
 * that the run came too soon.
 */
class Skipped extends Error {}
const skip = (why) => {
  throw new Skipped(why);
};

async function stage(name, fn) {
  step++;
  try {
    const note = await fn();
    done.push(`  ${String(step).padStart(2)}. ✓ ${name}${note ? `  — ${note}` : ''}`);
  } catch (e) {
    if (e instanceof Skipped) {
      skipped.push(`  ${String(step).padStart(2)}. ⊘ ${name}  — übersprungen: ${e.message}`);
      return;
    }
    fail.push(`  ${String(step).padStart(2)}. ✗ ${name}\n        ${e.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg ?? 'Erwartung nicht erfüllt');
};

/**
 * A prerequisite from an earlier step.
 *
 * Half of this story hangs on the two accounts. When one of them could not be
 * created, the steps that follow used to fail with "Cannot read properties of
 * undefined", which reads like a broken application and is nothing of the kind.
 */
const need = (value, what) => {
  if (value === undefined || value === null) skip(`${what} fehlt aus einem früheren Schritt`);
  return value;
};

// ------------------------------------------------------------ the engine --

const glue = await import(resolve(ROOT, 'apps/web/src/wasm/hh_wasm.js'));
await glue.default({
  module_or_path: await readFile(resolve(ROOT, 'apps/web/public/engine/hh_wasm_bg.wasm')),
});
const [city, network, scenarios] = await Promise.all(
  ['city', 'network', 'scenarios'].map((n) =>
    readFile(resolve(ROOT, `data/dist/${n}-${V}.json`), 'utf8')
  )
);
const engine = new glue.Engine(city, network, scenarios);

const P = (lon, lat) => ({ lon, lat });
const lines = () => engine.renderState().lines.filter((l) => l.source === 'user');
const line = (label) => lines().find((l) => l.label === label);
const stationsOf = (l) => {
  const st = engine.renderState().stations;
  return l.stations.map((id) => st.find((s) => s.id === id));
};

await stage('Die App startet im Bestandsnetz', () => {
  engine.loadTemplate('bestand');
  const r = engine.renderState();
  assert(r.lines.length > 10, `nur ${r.lines.length} Linien`);
  assert(engine.quickEstimate().investmentEur === 0, 'Der Bestand kostet nichts');
  return `${r.lines.length} Linien, ${r.stations.length} Stationen`;
});

await stage('Eine U-Bahn quer durch Eimsbüttel', () => {
  engine.apply({
    type: 'drawLine',
    mode: 'ubahn',
    points: [P(9.94, 53.556), P(9.97, 53.57), P(10.005, 53.582)],
    anchors: [P(9.94, 53.556), P(9.97, 53.57), P(10.005, 53.582)],
  });
  const l = lines()[0];
  assert(l && l.mode === 'ubahn', 'keine U-Bahn angelegt');
  assert(l.stations.length >= 4, `nur ${l.stations.length} Halte`);
  const named = stationsOf(l).filter((s) => s && !/^Neue Station/.test(s.name));
  assert(named.length === l.stations.length, 'Halte ohne echten Namen');
  return `${l.label}: ${stationsOf(l).map((s) => s.name).join(' · ')}`;
});

await stage('Eine S-Bahn im Süden', () => {
  engine.apply({
    type: 'drawLine',
    mode: 'sbahn',
    points: [P(9.92, 53.53), P(9.96, 53.535), P(10.01, 53.54)],
    anchors: [P(9.92, 53.53), P(9.96, 53.535), P(10.01, 53.54)],
  });
  assert(lines().length === 2, `${lines().length} eigene Linien`);
  const s = lines().find((l) => l.mode === 'sbahn');
  assert(s, 'keine S-Bahn');
  return `${s.label}, ${s.lengthKm.toFixed(1)} km`;
});

await stage('Eine Straßenbahn in Winterhude', () => {
  engine.apply({
    type: 'drawLine',
    mode: 'tram',
    points: [P(9.965, 53.59), P(9.985, 53.596), P(10.01, 53.599)],
    anchors: [P(9.965, 53.59), P(9.985, 53.596), P(10.01, 53.599)],
  });
  const t = lines().find((l) => l.mode === 'tram');
  assert(t, 'keine Straßenbahn');
  // A tram stops far more often than a U-Bahn over the same distance.
  const u = lines().find((l) => l.mode === 'ubahn');
  const tramSpacing = (t.lengthKm * 1000) / (t.stations.length - 1);
  const ubahnSpacing = (u.lengthKm * 1000) / (u.stations.length - 1);
  assert(
    tramSpacing < ubahnSpacing,
    `Straßenbahn ${tramSpacing.toFixed(0)} m gegen U-Bahn ${ubahnSpacing.toFixed(0)} m`
  );
  return `${t.label}, Haltabstand ${tramSpacing.toFixed(0)} m`;
});

await stage('Die Kennzahlen wachsen mit dem Netz', () => {
  const q = engine.quickEstimate();
  assert(q.investmentEur > 1e9, `nur ${q.investmentEur} €`);
  assert(q.newStations > 10, `nur ${q.newStations} neue Stationen`);
  assert(q.openingYear && q.openingYear > 2030, `Eröffnung ${q.openingYear}`);
  return `${(q.investmentEur / 1e9).toFixed(1)} Mrd. €, fertig ${q.openingYear}`;
});

await stage('Die U-Bahn weiterbauen', () => {
  const before = line('U6') ?? lines().find((l) => l.mode === 'ubahn');
  const n = before.stations.length;
  engine.apply({
    type: 'extendLine',
    line: before.id,
    end: 'finish',
    mode: 'ubahn',
    points: [P(10.035, 53.59)],
    anchors: [P(10.035, 53.59)],
  });
  const after = lines().find((l) => l.id === before.id);
  assert(after.stations.length > n, `${n} → ${after.stations.length}`);
  return `${n} → ${after.stations.length} Halte`;
});

await stage('Einen Halt einfügen', () => {
  const l = lines().find((x) => x.mode === 'ubahn');
  const n = l.stations.length;
  const seg = l.segments.slice().sort((a, b) => b.lengthKm - a.lengthKm)[0];
  engine.apply({ type: 'splitEdge', edge: seg.id, alongM: (seg.lengthKm * 1000) / 2 });
  const after = lines().find((x) => x.id === l.id);
  assert(after.stations.length === n + 1, `${n} → ${after.stations.length}`);
  return `${n} → ${after.stations.length} Halte`;
});

await stage('Einen Halt wieder entfernen', () => {
  const l = lines().find((x) => x.mode === 'ubahn');
  const n = l.stations.length;
  // Not every stop can go: one where several lines meet would break them all,
  // and the engine says so. Pick one that only this line uses.
  const st = engine.renderState().stations;
  const removable = l.stations
    .slice(1, -1)
    .find((id) => (st.find((s) => s.id === id)?.lines ?? []).length === 1);
  // A stop shared with another line in service cannot go — that is correct,
  // and the engine says so.
  assert(removable, 'kein entfernbarer Halt gefunden');
  engine.apply({ type: 'removeStation', node: removable });
  const after = lines().find((x) => x.id === l.id);
  assert(after.stations.length === n - 1, `${n} → ${after.stations.length}`);
  return `${n} → ${after.stations.length} Halte`;
});

await stage('Bestandsstationen lassen sich nicht entfernen', () => {
  const existing = engine
    .renderState()
    .stations.find((s) => s.source === 'existing' && s.status === 'in_service');
  let message = '';
  try {
    engine.apply({ type: 'removeStation', node: existing.id });
  } catch (e) {
    message = String(e.message ?? e);
  }
  assert(message, 'Eine Bestandsstation ließ sich entfernen');
  return message.slice(0, 60);
});

await stage('Rückgängig und Wiederholen stellen exakt her', () => {
  const before = JSON.stringify(lines().map((l) => [l.label, l.stations.length]));
  engine.undo();
  const undone = JSON.stringify(lines().map((l) => [l.label, l.stations.length]));
  assert(undone !== before, 'Rückgängig hat nichts geändert');
  engine.redo();
  const redone = JSON.stringify(lines().map((l) => [l.label, l.stations.length]));
  assert(redone === before, `Wiederholen stellt nicht her: ${redone} statt ${before}`);
  return 'identisch';
});

await stage('Eine Linie löschen und wiederherstellen', () => {
  const tram = lines().find((l) => l.mode === 'tram');
  const n = lines().length;
  engine.apply({ type: 'deleteLine', line: tram.id });
  assert(lines().length === n - 1, 'Linie nicht gelöscht');
  engine.undo();
  assert(lines().length === n, 'Löschen ließ sich nicht rückgängig machen');
  return `${n} Linien, gelöscht und wieder da`;
});

let document;
await stage('Speichern und wieder öffnen ändert nichts', () => {
  document = engine.toDocument('Mein Hamburger Netz');
  const before = JSON.stringify(engine.simulate().headline);
  engine.loadTemplate('bestand');
  assert(lines().length === 0, 'Zurücksetzen hat nicht geleert');
  engine.loadDocument(document);
  const after = JSON.stringify(engine.simulate().headline);
  assert(after === before, 'Die Kennzahlen unterscheiden sich nach dem Laden');
  const again = engine.toDocument('Mein Hamburger Netz');
  assert(again === document, 'Zweimal Speichern ergibt nicht dasselbe Dokument');
  return `${(document.length / 1024).toFixed(0)} kB, byte-identisch`;
});

await stage('Ein alter Entwurf wird auf das heutige Modell gebracht', () => {
  // A saved document carries the parameters it was computed with, so that a
  // published record stays reproducible. In the editor that is the wrong
  // behaviour: you are about to keep working on it, and publishing recomputes
  // with today's model anyway — being shown superseded figures until then is
  // how someone finds out their numbers changed at the worst moment.
  const old = JSON.parse(document);
  old.calculationVersion = '0.1.0';
  old.params.version = '0.1.0';
  // A parameter that visibly moves the result.
  old.params.demand.carSubstitutionShare = 0.9;
  const info = engine.loadDocument(JSON.stringify(old));
  assert(info.current === false, 'ein Modell von 0.1.0 gilt als aktuell');
  const stale = engine.simulate();
  assert(stale.calculationVersion === '0.1.0', 'die alten Parameter greifen nicht');

  const fresh = engine.recalculateWithCurrentModel();
  assert(
    fresh.calculationVersion !== '0.1.0',
    `nach dem Neuberechnen immer noch ${fresh.calculationVersion}`
  );
  assert(
    fresh.parameterFingerprint === engine.simulate().parameterFingerprint,
    'der Fingerabdruck bleibt nicht stabil'
  );
  // And back to the current document for the stages that follow.
  engine.loadDocument(document);
  return `${stale.calculationVersion} → ${fresh.calculationVersion}`;
});

await stage('Ein Vergleich mit dem Bestand nennt jede Kennzahl', () => {
  // Compare against a saved document, which is what the app does.
  const mine = engine.toDocument('Mein Netz');
  engine.loadTemplate('bestand');
  const baseline = engine.toDocument('Bestand');
  engine.loadDocument(mine);
  const cmp = engine.compareWith(baseline);
  const rows = cmp.rows ?? cmp;
  assert(Array.isArray(rows) && rows.length >= 8, `nur ${rows?.length} Zeilen: ${JSON.stringify(cmp).slice(0, 160)}`);
  return `${rows.length} Kennzahlen`;
});

// --------------------------------------------------------------- the API --


/**
 * A handle that changes once an hour.
 *
 * The write limits these suites check are per account and per hour, so a
 * single fixed account would run out after a few runs — and a fresh account
 * every run would run into the per-address registration limit instead. One
 * account per hour sits between the two.
 */
function hourTag() {
  return new Date().toISOString().slice(0, 13).replace(/\D/g, '');
}

/**
 * A session for a test account, reused across runs.
 *
 * The suites run often, and every run that logs in afresh spends one of the
 * ten attempts per quarter-hour that the limiter allows — which these very
 * tests check is in place. So the token is cached on disk and only re-fetched
 * when it has actually stopped working.
 */
/**
 * Drop session files from earlier runs.
 *
 * Handles are keyed by the hour, and one suite mints a throwaway voter per run,
 * so the project root collected seventy-odd of these in a day of ten-minute
 * loops. The tokens expire anyway; only the recent ones save a login.
 */
async function pruneSessions(maxAgeHours = 6) {
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  try {
    for (const f of await readdir(ROOT)) {
      if (!f.startsWith('.test-session-')) continue;
      const full = resolve(ROOT, f);
      try {
        if ((await stat(full)).mtimeMs < cutoff) await unlink(full);
      } catch {}
    }
  } catch {}
}
await pruneSessions();

async function account(handle, password = 'ein-langes-testpasswort') {
  const cache = resolve(ROOT, `.test-session-${handle}.json`);
  try {
    const { token } = JSON.parse(await readFile(cache, 'utf8'));
    const me = await call('/api/auth/me', { token });
    if (me.status === 200) return token;
  } catch {}
  const reg = await call('/api/auth/register', { method: 'POST', body: { handle, password } });
  let token = reg.status === 200 ? reg.json.token : null;
  if (!token) {
    const login = await call('/api/auth/login', { method: 'POST', body: { handle, password } });
    if (login.status !== 200) {
      throw new Error(`Kein Konto für ${handle}: ${reg.text.slice(0, 80)} / ${login.text.slice(0, 80)}`);
    }
    token = login.json.token;
  }
  await writeFile(cache, JSON.stringify({ handle, token }));
  return token;
}

const rnd = () => Math.random().toString(36).slice(2, 9);
async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (res.status === 429) {
    skip(`Limit erschöpft bei ${method} ${path} — der Lauf kam zu kurz nach dem letzten`);
  }
  return { status: res.status, json, text };
}

let author;
let reader;
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

await stage('Ein Konto anlegen', async () => {
  const handle = `flow-a-${hourTag()}`;
  author = { handle, token: await account(handle) };
  return handle;
});

await stage('Den Entwurf veröffentlichen', async () => {
  const headline = engine.simulate().headline;
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: author.token,
    body: {
      title: 'Mein Hamburger Netz',
      description: 'U-Bahn, S-Bahn und Straßenbahn in einem Entwurf.',
      document,
      result: headline,
      visibility: 'public',
    },
  });
  assert(r.status === 200, r.text.slice(0, 160));
  slug = r.json.slug;
  // The server recomputes, so its figures must match the client's.
  assert(
    Math.abs(r.json.investment_eur - headline.investmentEur) / headline.investmentEur < 0.001,
    `Server ${r.json.investment_eur} gegen Client ${headline.investmentEur}`
  );
  return slug;
});

await stage('Der Entwurf ist öffentlich abrufbar', async () => {
  const r = await call(`/api/scenarios/${slug}`);
  assert(r.status === 200, `Status ${r.status}`);
  assert(r.json.title === 'Mein Hamburger Netz', r.json.title);
  assert(r.json.calculation_version && r.json.data_version, 'Version fehlt');
  return `Modell ${r.json.calculation_version}, Daten ${r.json.data_version}`;
});

await stage('Ein geteilter Link zeigt eine Vorschau', async () => {
  const WEB = process.env.HH_WEB ?? 'http://localhost:3000';
  const page = await fetch(`${WEB}/szenario/${slug}`);
  assert(page.ok, `Seite: ${page.status}`);
  const html = await page.text();
  assert(html.includes('og:title'), 'kein og:title');
  assert(html.includes('Mein Hamburger Netz'), 'der Titel steht nicht in den Metadaten');
  const img = await fetch(`${WEB}/szenario/${slug}/opengraph-image`);
  assert(img.ok, `Bild: ${img.status}`);
  assert(img.headers.get('content-type')?.includes('image/png'), img.headers.get('content-type'));
  const bytes = (await img.arrayBuffer()).byteLength;
  assert(bytes > 20_000, `nur ${bytes} Byte — vermutlich leer`);
  return `${(bytes / 1024).toFixed(0)} kB PNG`;
});

await stage('Er steht in der Liste', async () => {
  const r = await call('/api/scenarios?sort=neu&limit=50');
  assert(Array.isArray(r.json), r.text.slice(0, 160));
  assert(r.json.some((s) => s.slug === slug), 'nicht in der Liste');
  return `${r.json.length} Entwürfe`;
});

await stage('Eine zweite Person legt ein Konto an', async () => {
  const handle = `flow-b-${hourTag()}`;
  reader = { handle, token: await account(handle) };
  return handle;
});

await stage('Sie stimmt zu, und nimmt die Stimme zurück', async () => {
  need(reader?.token, 'Das Konto der zweiten Person');
  const up = await call(`/api/scenarios/${slug}/vote`, { method: 'POST', token: reader.token });
  assert(up.status === 200 && up.json.votes === 1, JSON.stringify(up.json));
  const again = await call(`/api/scenarios/${slug}/vote`, { method: 'POST', token: reader.token });
  assert(again.json.votes === 1, `Doppelabstimmung: ${again.json.votes}`);
  const down = await call(`/api/scenarios/${slug}/vote`, { method: 'DELETE', token: reader.token });
  assert(down.json.votes === 0, `Rücknahme: ${down.json.votes}`);
  await call(`/api/scenarios/${slug}/vote`, { method: 'POST', token: reader.token });
  return '1 Stimme';
});

await stage('Sie kommentiert', async () => {
  need(reader?.token, 'Das Konto der zweiten Person');
  const r = await call(`/api/scenarios/${slug}/comments`, {
    method: 'POST',
    token: reader.token,
    body: { body: 'Die Straßenbahn nach Winterhude überzeugt mich.' },
  });
  assert(r.status === 200, r.text.slice(0, 160));
  const list = await call(`/api/scenarios/${slug}/comments`);
  assert(list.json.length === 1, `${list.json.length} Kommentare`);
  assert(list.json[0].author === reader.handle, list.json[0].author);
  return list.json[0].body.slice(0, 40);
});

let forkSlug;
await stage('Sie forkt den Entwurf und baut weiter', async () => {
  need(reader?.token, 'Das Konto der zweiten Person');
  const r = await call(`/api/scenarios/${slug}/fork`, { method: 'POST', token: reader.token });
  assert(r.status === 200, r.text.slice(0, 160));
  forkSlug = r.json.slug;
  const detail = await call(`/api/scenarios/${forkSlug}`, { token: reader.token });
  assert(detail.json.parent_slug === slug, `Elternteil ${detail.json.parent_slug}`);
  // Load the fork into the engine and add to it.
  engine.loadDocument(JSON.stringify(detail.json.document));
  const before = lines().length;
  engine.apply({
    type: 'drawLine',
    mode: 'sbahn',
    points: [P(10.05, 53.55), P(10.1, 53.53), P(10.16, 53.51)],
    anchors: [P(10.05, 53.55), P(10.1, 53.53), P(10.16, 53.51)],
  });
  assert(lines().length === before + 1, 'Der Fork ließ sich nicht erweitern');
  const upd = await call(`/api/scenarios/${forkSlug}`, {
    method: 'PATCH',
    token: reader.token,
    body: {
      title: 'Mein Hamburger Netz, weitergedacht',
      document: engine.toDocument('Mein Hamburger Netz, weitergedacht'),
      result: engine.simulate().headline,
      visibility: 'public',
    },
  });
  assert(upd.status === 200, upd.text.slice(0, 160));
  return `${forkSlug}, ${lines().length} eigene Linien`;
});

await stage('Beide Entwürfe lassen sich vergleichen', async () => {
  need(forkSlug, 'Der Fork');
  const r = await call(`/api/compare?a=${slug}&b=${forkSlug}`);
  assert(r.status === 200, `Status ${r.status}`);
  const rows = r.json.rows ?? r.json;
  assert(Array.isArray(rows) && rows.length >= 8, `nur ${rows?.length} Zeilen`);
  const km = rows.find((x) => /km|Neubau/i.test(x.label ?? x.key ?? ''));
  assert(km, 'keine Längenzeile im Vergleich');
  return `${rows.length} Kennzahlen nebeneinander`;
});

await stage('Der Fork erscheint im Profil der zweiten Person', async () => {
  need(reader?.handle, 'Das Konto der zweiten Person');
  const r = await call(`/api/scenarios?author=${reader.handle}`);
  assert((r.json ?? []).some((s) => s.slug === forkSlug), 'Fork fehlt im Profil');
  return `${r.json.length} Entwürfe`;
});

await stage('Ranglisten nennen den Entwurf', async () => {
  const r = await call('/api/leaderboards');
  const boards = r.json.boards ?? r.json;
  assert(Array.isArray(boards) && boards.length >= 3, `nur ${boards?.length} Ranglisten`);
  return `${boards.length} Ranglisten`;
});

// The boards hand out prizes, so the cheapest way to win must not be to do
// almost nothing. Before the boards measured scale-free quantities, a 190 m
// tram stub took first place on both "Geringste Investition" and "Schnellste
// Umsetzung" — 25 million euros, open in 2032 — and nothing but an even
// smaller stub could ever displace it.
await stage('Ein Stummel gewinnt keine Rangliste', async () => {
  const probe = new glue.Engine(city, network, scenarios);
  probe.loadTemplate('bestand');
  probe.apply({
    type: 'drawLine',
    mode: 'tram',
    points: [P(9.975, 53.553), P(9.979, 53.5535)],
    anchors: [P(9.975, 53.553), P(9.979, 53.5535)],
  });
  const h = probe.simulate().headline;
  assert(h.newKm < 0.5, `der Stummel ist ${h.newKm.toFixed(2)} km lang, das prüft nichts`);
  const pub = await call('/api/scenarios', {
    method: 'POST',
    token: author.token,
    body: {
      title: 'Stummel',
      description: 'Prüft, dass Nichtstun keine Rangliste gewinnt.',
      document: probe.toDocument('Stummel'),
      result: h,
      visibility: 'public',
    },
  });
  assert(pub.status === 200, pub.text.slice(0, 120));
  try {
    const boards = await call('/api/leaderboards');
    const won = (boards.json.boards ?? boards.json)
      .filter((b) => b.entries[0]?.slug === pub.json.slug)
      .map((b) => b.label);
    assert(won.length === 0, `der Stummel führt: ${won.join(', ')}`);
    return `${h.newKm.toFixed(2)} km, ${(h.investmentEur / 1e6).toFixed(0)} Mio. € — führt nirgends`;
  } finally {
    await call(`/api/scenarios/${pub.json.slug}`, { method: 'DELETE', token: author.token });
  }
});

await stage('Aufräumen', async () => {
  // Whatever was actually created gets removed; a step that never ran left
  // nothing behind, and insisting on its token here turned tidying up into a
  // failure of its own.
  if (forkSlug && reader?.token) {
    await call(`/api/scenarios/${forkSlug}`, { method: 'DELETE', token: reader.token });
  }
  const r = await call(`/api/scenarios/${slug}`, { method: 'DELETE', token: author.token });
  assert(r.status === 200 || r.status === 404, `Status ${r.status}`);
  return 'beide gelöscht';
});

console.log('\n' + done.concat(skipped, fail).join('\n'));
console.log(
  `\n${done.length} bestanden, ${fail.length} fehlgeschlagen` +
    (skipped.length
      ? `, ${skipped.length} übersprungen — dieser Lauf hat weniger geprüft, als er könnte`
      : '')
);
// A story that stopped halfway has not been told. Half of these steps depend on
// the ones before them, so a skip early on hollows out everything after it.
if (skipped.length > done.length / 3) {
  console.log(
    '\nZu wenig geprüft, um etwas auszusagen. Meist sind die Limits erschöpft:\n' +
      'eine Stunde warten oder den Server mit frischer Datenbank starten.'
  );
}
process.exit(fail.length || skipped.length > done.length / 3 ? 1 : 0);
