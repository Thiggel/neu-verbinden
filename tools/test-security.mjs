// Adversarial tests against the running API.
//
// The other suites check that the right thing happens for a well-behaved
// client. This one checks that the wrong thing does not happen for a badly
// behaved one: authorisation on every write, size and rate limits, injection
// attempts, and figures the client is not allowed to dictate.
//
//   node tools/test-security.mjs
import { readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.HH_API ?? 'http://localhost:8080';
const WEB = process.env.HH_WEB ?? 'http://localhost:3000';
const V = process.env.HH_DATA_VERSION ?? '2026-09';

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

/**
 * A check that could not run — no database access, no web app.
 *
 * Skipping is legitimate; counting a skip as a pass is not. Several checks here
 * quietly returned early when a precondition was missing and were recorded as
 * green, so a run without `HH_TEST_DB` reported full marks while verifying
 * noticeably less. The summary now says how many were skipped and exits with a
 * distinct note, so nobody reads a partial run as a complete one.
 */
class Skipped extends Error {}
const skip = (why) => {
  throw new Skipped(why);
};

// Setup runs at the top level, outside any test. A limit hit there used to end
// the run as an unhandled rejection: a stack trace where the verdict should be,
// and nothing said about what was and was not checked.
const inconclusive = (e) => {
  if (!(e instanceof Skipped)) throw e;
  console.log(
    `\nDer Lauf konnte nicht aufgebaut werden: ${e.message}\n` +
      'Damit ist nichts geprüft. Eine Stunde warten oder den Server mit frischer\n' +
      'Datenbank starten, dann sagt dieser Lauf wieder etwas aus.'
  );
  process.exit(1);
};
// A rejected top-level await in an ES module arrives as an uncaught exception,
// not as an unhandled rejection. Both, so neither route prints a stack trace
// where the verdict belongs.
process.on('unhandledRejection', inconclusive);
process.on('uncaughtException', inconclusive);

async function check(name, fn) {
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (e) {
    if (e instanceof Skipped) {
      skipped++;
      results.push(`  ⊘ ${name}  — übersprungen: ${e.message}`);
      return;
    }
    failed++;
    results.push(`  ✗ ${name}\n      ${e.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg ?? 'Erwartung nicht erfüllt');
};


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
  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: { handle, password },
    allow429: true,
  });
  let token = reg.status === 200 ? reg.json.token : null;
  if (!token) {
    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { handle, password },
      allow429: true,
    });
    // Ten registrations per address per hour, and this suite needs several. Run
    // it twice in a row and the rest reports as broken authorisation, which is
    // the one thing a security suite must never say when it does not mean it: a
    // real regression would arrive as another red line among a dozen.
    if (login.status === 429 || reg.status === 429) {
      skip('Registrierungslimit erschöpft — der Lauf kam zu kurz nach dem letzten');
    }
    if (login.status !== 200) {
      throw new Error(`Kein Konto für ${handle}: ${reg.text.slice(0, 80)} / ${login.text.slice(0, 80)}`);
    }
    token = login.json.token;
  }
  await writeFile(cache, JSON.stringify({ handle, token }));
  return token;
}

const rnd = () => Math.random().toString(36).slice(2, 10);

/**
 * A request to the service under test.
 *
 * An unexpected 429 ends the test as *inconclusive*, not as a failure. The
 * limits this suite verifies are real, they apply to the suite itself, and a
 * second run inside the hour used to turn sixteen green lines red — including
 * "SQL-Metazeichen im Slug öffnen nichts", which reads like a breach and was a
 * throttled setup request. A security suite that cries wolf is worse than one
 * that says plainly it could not look. Pass `allow429` where the limit is the
 * thing being tested.
 */
async function call(path, { method = 'GET', body, token, headers = {}, allow429 = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (res.status === 429 && !allow429) {
    skip(`Limit erschöpft bei ${method} ${path} — der Lauf kam zu kurz nach dem letzten`);
  }
  return { status: res.status, json, text };
}

const register = async (handle, { expectLimit = false } = {}) => {
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { handle, password: 'ein-langes-testpasswort' },
    allow429: true,
  });
  if (r.status === 429 && !expectLimit) {
    skip('Registrierungslimit erschöpft — der Lauf kam zu kurz nach dem letzten');
  }
  return r;
};

// A minimal valid document, taken from the engine so the shape is always right.
const glue = await import(resolve(ROOT, 'apps/web/src/wasm/hh_wasm.js'));
await glue.default({
  module_or_path: await readFile(resolve(ROOT, 'apps/web/public/engine/hh_wasm_bg.wasm')),
});
const [city, network, scenarios] = await Promise.all(
  ['city', 'network', 'scenarios'].map((n) => readFile(resolve(ROOT, `data/dist/${n}-${V}.json`), 'utf8'))
);
const engine = new glue.Engine(city, network, scenarios);
engine.loadTemplate('bestand');
engine.apply({
  type: 'drawLine',
  mode: 'ubahn',
  points: [
    { lon: 9.94, lat: 53.556 },
    { lon: 9.97, lat: 53.57 },
    { lon: 10.0, lat: 53.582 },
  ],
});
const document = engine.toDocument('Sicherheitstest');
const headline = engine.simulate().headline;

// --------------------------------------------------------------- accounts --

// Stable handles, so repeated runs do not exhaust the registration limit that
// these very tests check is in place.
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

/** Read a single value from the local database, or null without access. */
async function sqlValue(query) {
  const db = process.env.HH_TEST_DB;
  if (!db) return null;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout } = await promisify(execFile)('psql', [db, '-t', '-A', '-c', query]);
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Run one SQL statement against the local database, if the caller allowed it. */
async function sql(statement) {
  const db = process.env.HH_TEST_DB;
  if (!db) return false;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    await promisify(execFile)('psql', [db, '-c', statement]);
    return true;
  } catch {
    return false;
  }
}

const alice = `sec-a-${hourTag()}`;
const bob = `sec-b-${hourTag()}`;
const aliceToken = await account(alice);
const bobToken = await account(bob);

await check('ein zu kurzes Passwort wird abgelehnt', async () => {
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { handle: `sec-x-${rnd()}`, password: 'kurz' },
  });
  assert(r.status === 400, `Status ${r.status}`);
});

await check('ein Nutzername mit Sonderzeichen wird abgelehnt', async () => {
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { handle: '<script>alert(1)</script>', password: 'ein-langes-testpasswort' },
  });
  assert(r.status === 400, `Status ${r.status}`);
});

await check('ein vergebener Nutzername lässt sich nicht doppelt anlegen', async () => {
  const r = await register(alice);
  assert(r.status >= 400, `Status ${r.status}`);
});

await check('ein falsches Passwort meldet keinen Unterschied zu einem falschen Namen', async () => {
  const wrongPassword = await call('/api/auth/login', {
    method: 'POST',
    body: { handle: alice, password: 'falsches-passwort-hier' },
  });
  const noSuchUser = await call('/api/auth/login', {
    method: 'POST',
    body: { handle: `gibtsnicht-${rnd()}`, password: 'falsches-passwort-hier' },
  });
  assert(
    wrongPassword.status === noSuchUser.status,
    `${wrongPassword.status} gegen ${noSuchUser.status} verrät, ob es das Konto gibt`
  );
});

await check('ein gefälschtes Token wird zurückgewiesen', async () => {
  const forged =
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', handle: 'root', role: 'admin', exp: 4102444800 })).toString('base64url') +
    '.ungueltige-signatur';
  const r = await call('/api/auth/me', { token: forged });
  assert(r.status === 401, `Status ${r.status}`);
});

await check('ein Token ohne Signatur (alg=none) wird zurückgewiesen', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', handle: 'root', role: 'admin', exp: 4102444800 })
  ).toString('base64url');
  const r = await call('/api/auth/me', { token: `${header}.${payload}.` });
  assert(r.status === 401, `Status ${r.status}`);
});

// -------------------------------------------------------------- ownership --

const own = await call('/api/scenarios', {
  method: 'POST',
  token: aliceToken,
  body: { title: 'Alices Entwurf', description: '', document, result: headline, visibility: 'public' },
});
const slug = own.json?.slug;

await check('ein Entwurf lässt sich anlegen', () => assert(own.status === 200 && slug, own.text.slice(0, 200)));

await check('Fremde können einen Entwurf nicht ändern', async () => {
  const r = await call(`/api/scenarios/${slug}`, {
    method: 'PATCH',
    token: bobToken,
    body: { title: 'Übernommen' },
  });
  assert(r.status === 403 || r.status === 404, `Status ${r.status}`);
});

// Visibility is not settled at creation. A plan can be published, collect a
// discussion, and be set back to private, and the discussion has to go with it.
// `add_comment` refuses to write on a private plan, which is why the read path
// looked safe for so long: there could be nothing there to leak. By this route
// there was, and anyone holding the slug could read it, signed in or not.
await check('Kommentare folgen der Sichtbarkeit des Entwurfs', async () => {
  const made = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: 'Erst öffentlich', description: '', document, result: headline, visibility: 'public' },
  });
  assert(made.status === 200, `Anlegen: ${made.status}`);
  const s = made.json.slug;
  const wrote = await call(`/api/scenarios/${s}/comments`, {
    method: 'POST',
    token: aliceToken,
    body: { body: 'Interner Vermerk, der niemanden angeht' },
  });
  assert(wrote.status === 200, `Kommentar: ${wrote.status}`);
  const back = await call(`/api/scenarios/${s}`, {
    method: 'PATCH',
    token: aliceToken,
    body: { visibility: 'private' },
  });
  assert(back.status === 200, `Zurückstellen: ${back.status}`);

  for (const [who, token] of [['ohne Token', null], ['als Fremder', bobToken]]) {
    const r = await call(`/api/scenarios/${s}/comments`, { token });
    assert(r.status === 404, `Kommentare ${who}: Status ${r.status}`);
    assert(!r.text.includes('niemanden angeht'), `Der Kommentartext steht ${who} offen`);
    // The handles of the people involved must not get out either.
    assert(!r.text.includes(alice), `Der Verfassername steht ${who} offen`);
  }
  const mine = await call(`/api/scenarios/${s}/comments`, { token: aliceToken });
  assert(mine.status === 200, `Die Eigentümerin sieht ihre eigenen nicht: ${mine.status}`);
  assert(mine.text.includes('niemanden angeht'), 'Der eigene Kommentar fehlt');
  await call(`/api/scenarios/${s}`, { method: 'DELETE', token: aliceToken });
});

// Deleting is not editing, and is checked separately: an authorisation that
// covers only PATCH still lets a stranger make the plan disappear.
await check('Fremde können einen Entwurf nicht löschen', async () => {
  const r = await call(`/api/scenarios/${slug}`, { method: 'DELETE', token: bobToken });
  assert(r.status === 403 || r.status === 404, `Status ${r.status}`);
  const still = await call(`/api/scenarios/${slug}`);
  assert(still.status === 200, `Der Entwurf ist nach dem Versuch weg: ${still.status}`);
});

// A private plan must not leak sideways through a fork either: forking copies
// the document, and a public fork of a private plan is that plan's contents
// under a different name.
await check('ein privater Entwurf lässt sich nicht forken', async () => {
  const made = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: 'Nicht zu kopieren', description: '', document, result: headline, visibility: 'private' },
  });
  assert(made.status === 200, `Anlegen: ${made.status}`);
  const r = await call(`/api/scenarios/${made.json.slug}/fork`, { method: 'POST', token: bobToken });
  assert(r.status === 404 || r.status === 403, `Status ${r.status}`);
  await call(`/api/scenarios/${made.json.slug}`, { method: 'DELETE', token: aliceToken });
});

// Roles come from the database, never from what a caller sends along.
await check('eine mitgeschickte Rolle macht niemanden zum Moderator', async () => {
  const handle = `sec-role-${rnd()}`;
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { handle, password: 'ein-langes-testpasswort', role: 'admin', is_moderator: true },
    allow429: true,
  });
  if (r.status === 429) skip('Registrierungslimit erschöpft');
  assert(r.status === 200, `Anlegen: ${r.status}`);
  // Hiding someone else's comment is for its author or a moderator, which is
  // exactly what the role decides.
  const wrote = await call(`/api/scenarios/${slug}/comments`, {
    method: 'POST',
    token: aliceToken,
    body: { body: 'Alices Kommentar' },
  });
  assert(wrote.status === 200, `Kommentar: ${wrote.status}`);
  const hide = await call(`/api/comments/${wrote.json.id}`, { method: 'DELETE', token: r.json.token });
  assert(hide.status === 403, `Ein selbsternannter Admin durfte verstecken: ${hide.status}`);
});

// The access and erasure endpoints are the two most attractive things on this
// service for someone holding a token they should not have: one hands over
// everything about a person, the other destroys it.
await check('Auskunft und Löschung sind an das eigene Konto gebunden', async () => {
  const anonymous = await call('/api/auth/export');
  assert(anonymous.status === 401, `Auskunft ohne Token: ${anonymous.status}`);

  const mine = await call('/api/auth/export', { token: aliceToken });
  assert(mine.status === 200, `eigene Auskunft: ${mine.status}`);
  // What comes back has to be this account's, and nobody else's.
  assert(mine.text.includes(alice), 'die eigene Auskunft nennt das Konto nicht');
  assert(!mine.text.includes(bob), 'die Auskunft enthält Daten eines fremden Kontos');
  // The hash is not part of an Art. 15 answer, and handing it out would make a
  // stolen session into a stolen password.
  assert(!/\$argon2/.test(mine.text), 'die Auskunft enthält den Passwort-Hash');

  // Erasure asks for the password, so a session alone cannot end an account.
  const noPassword = await call('/api/auth/me', { method: 'DELETE', token: aliceToken, body: {} });
  assert(noPassword.status !== 200, `Löschen ohne Passwort: ${noPassword.status}`);
  const wrong = await call('/api/auth/me', {
    method: 'DELETE',
    token: aliceToken,
    body: { password: 'das-ist-es-nicht' },
  });
  assert(wrong.status === 401, `Löschen mit falschem Passwort: ${wrong.status}`);
  // And the account is still there afterwards.
  const still = await call('/api/auth/me', { token: aliceToken });
  assert(still.status === 200, `nach dem Fehlversuch ist das Konto weg: ${still.status}`);
});

// Erasure has to be complete: a plan or a comment left standing under "ohne
// Konto" is still the writing of someone who asked to be forgotten.
await check('Löschen entfernt Entwürfe und Kommentare mit', async () => {
  const handle = `sec-del-${rnd()}`;
  const password = 'ein-langes-testpasswort';
  const made = await call('/api/auth/register', {
    method: 'POST',
    body: { handle, password },
    allow429: true,
  });
  if (made.status === 429) skip('Registrierungslimit erschöpft');
  assert(made.status === 200, `Anlegen: ${made.status}`);
  const token = made.json.token;

  const plan = await call('/api/scenarios', {
    method: 'POST',
    token,
    body: { title: 'Verschwindet gleich', description: '', document, result: headline, visibility: 'public' },
  });
  assert(plan.status === 200, `Entwurf: ${plan.status}`);
  const slug = plan.json.slug;
  await call(`/api/scenarios/${slug}/comments`, { method: 'POST', token, body: { body: 'Ein Wort dazu' } });

  const gone = await call('/api/auth/me', { method: 'DELETE', token, body: { password } });
  assert(gone.status === 200, `Löschen: ${gone.status} ${gone.text.slice(0, 80)}`);

  // The plan is gone for everyone, not merely detached from its author.
  const after = await call(`/api/scenarios/${slug}`);
  assert(after.status === 404, `der Entwurf steht noch: ${after.status}`);
  // The token no longer opens anything.
  const session = await call('/api/auth/me', { token });
  assert(session.status === 401 || session.status === 404, `die Sitzung gilt weiter: ${session.status}`);
  // And the handle does not appear in the public list any more.
  const list = await call('/api/scenarios?limit=60');
  assert(!list.text.includes(handle), 'der Nutzername steht noch in der Liste');
});

await check('ohne Token lässt sich nichts anlegen', async () => {
  const r = await call('/api/scenarios', {
    method: 'POST',
    body: { title: 'Anonym', document, result: headline, visibility: 'public' },
  });
  assert(r.status === 401, `Status ${r.status}`);
});

await check('ein privater Entwurf ist für Fremde unsichtbar', async () => {
  const priv = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: 'Privat', document, result: headline, visibility: 'private' },
  });
  const s = priv.json?.slug;
  assert(s, priv.text.slice(0, 200));
  const asStranger = await call(`/api/scenarios/${s}`, { token: bobToken });
  assert(asStranger.status === 404 || asStranger.status === 403, `Status ${asStranger.status}`);
  const asOwner = await call(`/api/scenarios/${s}`, { token: aliceToken });
  assert(asOwner.status === 200, `Eigentümer sieht ihn nicht: ${asOwner.status}`);
  await call(`/api/scenarios/${s}`, { method: 'DELETE', token: aliceToken });
});

await check('ein privater Entwurf taucht nicht in der Liste auf', async () => {
  const priv = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: `Geheim ${rnd()}`, document, result: headline, visibility: 'private' },
  });
  const list = await call('/api/scenarios?limit=100');
  assert(
    !(list.json ?? []).some((x) => x.slug === priv.json.slug),
    'Ein privater Entwurf steht in der öffentlichen Liste'
  );
  await call(`/api/scenarios/${priv.json.slug}`, { method: 'DELETE', token: aliceToken });
});

// ------------------------------------------------------- claimed figures --

await check('der Server übernimmt keine vom Client behaupteten Kennzahlen', async () => {
  const lie = { ...headline, investmentEur: 1, annualBenefitEur: 9e12, benefitCostRatio: 999 };
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: `Behauptung ${rnd()}`, document, result: lie, visibility: 'private' },
  });
  assert(r.status === 200, r.text.slice(0, 200));
  // Deleted whatever the assertion below decides, so a failing run does not
  // leave a scenario behind for ever.
  try {
    assert(
      r.json.benefit_cost_ratio < 100 && r.json.investment_eur > 1000,
      `Server hat die Behauptung übernommen: NKV ${r.json.benefit_cost_ratio}, Investition ${r.json.investment_eur}`
    );
  } finally {
    await call(`/api/scenarios/${r.json.slug}`, { method: 'DELETE', token: aliceToken });
  }
});

// ---------------------------------------------------------------- limits --

await check('ein überlanger Titel wird gekürzt oder abgelehnt', async () => {
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: 'A'.repeat(5000), document, result: headline, visibility: 'private' },
  });
  if (r.status === 200) {
    assert(r.json.title.length <= 200, `Titel ist ${r.json.title.length} Zeichen lang`);
    await call(`/api/scenarios/${r.json.slug}`, { method: 'DELETE', token: aliceToken });
  } else {
    assert(r.status === 400, `Status ${r.status}`);
  }
});

await check('ein übergroßes Netz wird abgelehnt', async () => {
  const doc = JSON.parse(document);
  const nodes = {};
  const edges = {};
  for (let i = 1; i <= 6000; i++) {
    nodes[i] = {
      id: i,
      kind: 'station',
      name: `S${i}`,
      geo: { lat: 53.5 + i * 1e-5, lon: 9.9 + i * 1e-5 },
      schematic: { x: i, y: i },
      source: 'user',
      status: 'to_build',
      interchange: false,
      accessible: true,
      depth: 'surface',
      external_id: null,
    };
  }
  doc.network = { nodes, edges, lines: {}, next_id: 60001 };
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: 'Riesennetz', document: JSON.stringify(doc), result: headline, visibility: 'private' },
  });
  assert(r.status === 400, `Status ${r.status} — ein Netz mit 6 000 Knoten wurde angenommen`);
});

await check('ein Dokument über der Größengrenze wird abgelehnt', async () => {
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: 'Riesig', document: 'x'.repeat(5 * 1024 * 1024), result: headline, visibility: 'private' },
  });
  assert(r.status === 400 || r.status === 413, `Status ${r.status}`);
});

await check('ein Kommentar über der Längengrenze wird abgelehnt', async () => {
  const r = await call(`/api/scenarios/${slug}/comments`, {
    method: 'POST',
    token: bobToken,
    body: { body: 'A'.repeat(50_000) },
  });
  assert(r.status === 400, `Status ${r.status}`);
});

// ------------------------------------------------------------- injection --

await check('SQL-Metazeichen im Slug öffnen nichts', async () => {
  for (const evil of ["' OR '1'='1", "'; DROP TABLE scenarios; --", '../../etc/passwd', '%00']) {
    const r = await call(`/api/scenarios/${encodeURIComponent(evil)}`);
    assert(r.status === 404 || r.status === 400, `${evil} → ${r.status}`);
  }
  const still = await call(`/api/scenarios/${slug}`);
  assert(still.status === 200, 'Die Tabelle ist nach den Versuchen nicht mehr da');
});

await check('Markup in Titel und Kommentar wird als Text gespeichert', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: `XSS ${payload}`, document, result: headline, visibility: 'private' },
  });
  assert(r.status === 200, r.text.slice(0, 200));
  const back = await call(`/api/scenarios/${r.json.slug}`, { token: aliceToken });
  assert(typeof back.json.title === 'string', 'Titel fehlt');
  assert(!back.json.slug.includes('<'), `Slug enthält Markup: ${back.json.slug}`);
  await call(`/api/scenarios/${r.json.slug}`, { method: 'DELETE', token: aliceToken });
});

await check('eine unbekannte Sichtbarkeit wird abgelehnt', async () => {
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: { title: 'Sichtbarkeit', document, result: headline, visibility: 'superoeffentlich' },
  });
  assert(r.status === 400, `Status ${r.status}`);
});

// ------------------------------------------------------------ rate limit --

await check('wiederholte Fehlanmeldungen laufen in ein Limit', async () => {
  const victim = `sec-r-${rnd()}`;
  await register(victim);
  let limited = false;
  for (let i = 0; i < 15; i++) {
    const r = await call('/api/auth/login', {
      method: 'POST',
      body: { handle: victim, password: `versuch-${i}-falsch` },
      allow429: true,
    });
    if (r.status === 429) {
      limited = true;
      break;
    }
  }
  assert(limited, '15 Fehlversuche ohne Sperre');
});

await check('massenhaftes Abstimmen läuft in ein Limit', async () => {
  let limited = false;
  for (let i = 0; i < 210; i++) {
    const r = await call(`/api/scenarios/${slug}/vote`, {
      method: 'POST',
      token: bobToken,
      allow429: true,
    });
    if (r.status === 429) {
      limited = true;
      break;
    }
  }
  assert(limited, '210 Stimmen ohne Sperre');
});

// ---------------------------------------------------------------- Abbau --

// The service-wide ceilings. Per-address limits bound one attacker on one
// connection; these are what a flood spread over many addresses runs into.
// Reaching them for real would take hundreds of requests, so the counter is
// filled directly and the wall is then checked from outside — the alternative
// is a test that mounts the very attack it is testing for.
for (const [what, path, body] of [
  ['registrations', '/api/auth/register', () => ({ handle: `sec-g-${rnd()}`, password: 'genugzeichenhier' })],
  ['votes', null, null],
]) {
  await check(`das dienstweite Limit für ${what} greift`, async () => {
    // A voter who has not spent their own hourly allowance yet, or the
    // per-account limit answers first and the service-wide one is never
    // reached.
    const voter = path ? null : await account(`sec-v-${rnd()}`);
    const window = 3600;
    const filled = await sql(
      `INSERT INTO rate_limits (bucket, window_at, hits)
       VALUES ('global:${what}', to_timestamp(floor(extract(epoch from now()) / ${window}) * ${window}), 999999)
       ON CONFLICT (bucket, window_at) DO UPDATE SET hits = 999999`
    );
    if (!filled) {
      // Without database access the ceiling cannot be reached without actually
      // flooding the service, which is not something a test should do.
      skip('kein Datenbankzugriff (HH_TEST_DB)');
    }
    try {
      const r = path
        ? await call(path, { method: 'POST', body: body(), allow429: true })
        : await call(`/api/scenarios/${slug}/vote`, {
            method: 'POST',
            token: voter,
            allow429: true,
          });
      assert(r.status === 429, `Status ${r.status} statt 429`);
      // And it has to say what actually happened. "Zu viele Anfragen" would
      // blame someone who has just arrived for a flood that is not theirs.
      const message = r.json?.error ?? '';
      assert(
        /ungewöhnlich viel/.test(message),
        `Meldung erklärt das dienstweite Limit nicht: ${message}`
      );
    } finally {
      await sql(`DELETE FROM rate_limits WHERE bucket = 'global:${what}'`);
    }
  });
}

// And it must let go again once the counter is clear — a ceiling that never
// reopens is an outage, not a defence.
await check('nach dem Zurücksetzen sind Konten wieder anlegbar', async () => {
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { handle: `sec-h-${rnd()}`, password: 'genugzeichenhier' },
  });
  assert(r.status === 200 || r.status === 201, `Status ${r.status}`);
});

// Invisible characters that visibly write something else. The right-to-left
// override reverses everything after it: a title submitted as
// "Harmlos<RLO>gnp.txt Zeile1" appeared in the list as
// "HarmlosbaT 1elieZ txt.png" — text nobody wrote.
await check('Richtungsüberschreiber im Titel werden entfernt', async () => {
  const doc = JSON.stringify((await call(`/api/scenarios/${slug}`)).json.document);
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: {
      title: 'Harmlos\u202Egnp.txt\u200B Zeile1\nZeile2',
      description: 'Probe',
      document: doc,
      result: { newKm: 1 },
      visibility: 'public',
    },
  });
  assert(r.status === 200 && r.json?.slug, `Status ${r.status}`);
  try {
    const title = (await call(`/api/scenarios/${r.json.slug}`)).json.title;
    assert(
      !/[\u202A-\u202E\u2066-\u2069\u200B\uFEFF\u00AD]/.test(title),
      `unsichtbare Zeichen im Titel: ${JSON.stringify(title)}`
    );
    assert(!/[\n\t]/.test(title), `Zeilenumbruch im Titel: ${JSON.stringify(title)}`);
  } finally {
    await call(`/api/scenarios/${r.json.slug}`, { method: 'DELETE', token: aliceToken });
  }
});

// A private plan must not fall out through the side doors either. The preview
// image is its own server route in the web app and has to check visibility
// independently — exactly the kind of place where this reopens later.
await check('ein privater Entwurf steht nicht im Vorschaubild', async () => {
  const doc = JSON.stringify((await call(`/api/scenarios/${slug}`)).json.document);
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: {
      title: 'Streng geheimer Netzentwurf',
      description: 'nicht für andere',
      document: doc,
      result: { newKm: 1 },
      visibility: 'private',
    },
  });
  assert(r.status === 200 && r.json?.slug, `Status ${r.status}`);
  const s = r.json.slug;
  try {
    const anon = await call(`/api/scenarios/${s}`);
    assert(anon.status === 404, `anonym abrufbar: ${anon.status}`);
    let png;
    try {
      png = await fetch(`${WEB}/szenario/${s}/opengraph-image`);
    } catch {
      // The web app is not running; no reason to break the suite, but no
      // reason to claim the check ran either.
      skip('Weboberfläche nicht erreichbar');
    }
    const body = Buffer.from(await png.arrayBuffer()).toString('latin1');
    assert(
      !body.includes('geheim') && !body.includes('Streng'),
      'der Titel steht im Vorschaubild'
    );
    // An image without data is small; one with a network and figures is not.
    assert(body.length < 40_000, `Vorschaubild zu gross (${body.length} B) — enthält es Daten?`);
  } finally {
    await call(`/api/scenarios/${s}`, { method: 'DELETE', token: aliceToken });
  }
});

// The server computes for itself and adopts no figures from the caller.
await check('mitgeschickte Kennzahlen und Besitz werden ignoriert', async () => {
  const doc = JSON.stringify((await call(`/api/scenarios/${slug}`)).json.document);
  const r = await call('/api/scenarios', {
    method: 'POST',
    token: aliceToken,
    body: {
      title: 'Massenzuweisung',
      description: 'x',
      document: doc,
      result: { newKm: 1 },
      visibility: 'public',
      votes: 9999,
      views: 9999,
      author_id: '00000000-0000-0000-0000-000000000000',
      benefit_cost_ratio: 99,
      investment_eur: 1,
    },
  });
  assert(r.status === 200 && r.json?.slug, `Status ${r.status}`);
  try {
    const d = (await call(`/api/scenarios/${r.json.slug}`)).json;
    assert(d.votes === 0, `Stimmen übernommen: ${d.votes}`);
    assert(d.benefit_cost_ratio !== 99, `NKV übernommen: ${d.benefit_cost_ratio}`);
    assert(d.investment_eur > 1e6, `Investition übernommen: ${d.investment_eur}`);
    assert(d.author_name === alice, `Autor übernommen: ${d.author_name}`);
  } finally {
    await call(`/api/scenarios/${r.json.slug}`, { method: 'DELETE', token: aliceToken });
  }
});

// Whether an account exists must not be readable from the response time. For
// an unknown handle the login returned at once, skipping the deliberately
// expensive password hashing — 1.8 ms against 17.6 ms. The error message is
// identical either way; the duration was not.
await check('die Anmeldung verrät nicht, welche Konten es gibt', async () => {
  await sql("DELETE FROM rate_limits WHERE bucket LIKE 'login%'");
  const timeOne = async (handle) => {
    const t = performance.now();
    const r = await call('/api/auth/login', {
      method: 'POST',
      body: { handle, password: 'ganz-sicher-falsch-1' },
    });
    return { ms: performance.now() - t, status: r.status };
  };
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const known = [];
  const unknown = [];
  for (let i = 0; i < 5; i++) {
    const a = await timeOne(alice);
    const b = await timeOne(`gibtesnicht-${rnd()}`);
    assert(a.status === 401 && b.status === 401, `Status ${a.status}/${b.status} statt 401`);
    known.push(a.ms);
    unknown.push(b.ms);
  }
  const k = median(known);
  const u = median(unknown);
  // Generous on purpose: this is measured over the network, and what matters
  // is the order of magnitude (a factor of ten), not single milliseconds.
  const ratio = Math.max(k, u) / Math.max(1, Math.min(k, u));
  assert(
    ratio < 3,
    `Antwortzeiten unterscheiden sich um Faktor ${ratio.toFixed(1)} (${k.toFixed(1)} ms gegen ${u.toFixed(1)} ms)`
  );
  await sql("DELETE FROM rate_limits WHERE bucket LIKE 'login%'");
});

// The application promises "no email address". That is about the service, not
// only the form: the API accepted one and stored it in a UNIQUE column — with
// the wrong message "username already taken" on a collision, which would have
// revealed which addresses are registered.
await check('eine mitgeschickte E-Mail-Adresse wird nicht gespeichert', async () => {
  const handle = `sec-m-${rnd()}`;
  const address = `${handle}@example.invalid`;
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { handle, password: 'genugzeichenhier', email: address },
  });
  assert(r.status === 200, `Status ${r.status}`);
  const rows = await sqlValue(
    `SELECT count(*) FROM users WHERE email IS NOT NULL`
  );
  if (rows === null) skip('kein Datenbankzugriff (HH_TEST_DB)');
  assert(Number(rows) === 0, `${rows} Konten haben eine E-Mail-Adresse gespeichert`);
  // And a second account using the same address must not fail on a
  // uniqueness rule that is not supposed to exist.
  const second = await call('/api/auth/register', {
    method: 'POST',
    body: { handle: `${handle}-b`, password: 'genugzeichenhier', email: address },
  });
  assert(second.status === 200, `zweites Konto abgelehnt: ${second.status} ${second.text?.slice(0, 80)}`);
});

await check('Aufräumen', async () => {
  // Every scenario either account made, not just the public ones — an earlier
  // failure otherwise leaves private leftovers behind for good.
  let removed = 0;
  for (const [handle, token] of [
    [alice, aliceToken],
    [bob, bobToken],
  ]) {
    const mine = await call(`/api/scenarios?author=${handle}&limit=100`, { token });
    for (const s of mine.json ?? []) {
      const r = await call(`/api/scenarios/${s.slug}`, { method: 'DELETE', token });
      if (r.status === 200) removed++;
    }
  }
  const r = await call(`/api/scenarios/${slug}`, { method: 'DELETE', token: aliceToken });
  assert(r.status === 200 || r.status === 404, `Status ${r.status}`);

  // The service-wide vote limit needs a voter who has not spent their own
  // hourly allowance, so each run mints one. Without this they stay: thirty-nine
  // accounts had built up, all of them indistinguishable from real users on the
  // profile pages. Only the throwaways go, and only the ones an hour past use.
  const purged = await sql(
    `DELETE FROM users WHERE handle LIKE 'sec-v-%' AND created_at < now() - interval '1 hour'`
  );
  return `${removed + 1} entfernt${purged ? ', Wegwerfkonten aufgeräumt' : ''}`;
});

console.log('\n' + results.join('\n'));
console.log(
  `\n${passed} bestanden, ${failed} fehlgeschlagen` +
    (skipped ? `, ${skipped} übersprungen — dieser Lauf hat weniger geprüft, als er könnte` : '')
);
// A run that skipped most of itself has not cleared this application of
// anything, and it must not be able to pass for one that did. Exhausted rate
// limits are the usual cause; the fix is to wait for the hour, not to read the
// green number at the bottom.
const thin = skipped > (passed + failed + skipped) / 3;
if (thin) {
  console.log(
    '\nZu wenig geprüft, um etwas auszusagen. Meist sind die Limits erschöpft:\n' +
      'eine Stunde warten oder den Server mit frischer Datenbank starten.'
  );
}
process.exit(failed || thin ? 1 : 0);
