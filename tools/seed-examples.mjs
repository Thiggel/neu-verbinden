// The examples on the discover page.
//
// They are the first thing anyone sees of what this application is for, so they
// are not left to whatever happened to be published during testing. This script
// owns them: it runs under one account, removes what it published last time and
// publishes the current set, so running it twice leaves the same four plans
// rather than eight.
//
// Two rules they all follow, both learned from the state this replaced:
//
//   * A plan contains its author's own work and the network that exists, and
//     nothing else. "Elbtangente und Ostring" carried Hamburg's U5, U4 and S4
//     because those were switched on in the editor when it was published, so it
//     claimed 74 km of new track for two lines that are 24 km long, and its map
//     showed somebody else's projects.
//   * Every line has a name a person chose. "Meßberg – Pfirsichweg" is what the
//     editor calls a line when nobody has said what it is.
//
//   HH_SEED_PASSWORD=… node tools/seed-examples.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.HH_API ?? 'http://localhost:8080';
const V = process.env.HH_DATA_VERSION ?? '2026-09';
const HANDLE = process.env.HH_SEED_HANDLE ?? 'beispiele';
const PASSWORD = process.env.HH_SEED_PASSWORD;

if (!PASSWORD) {
  console.error(
    'HH_SEED_PASSWORD fehlt. Das Konto, unter dem die Beispiele stehen, braucht\n' +
      'ein Passwort, damit sie später wieder ersetzt werden können.'
  );
  process.exit(2);
}

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
  return { status: res.status, json, text };
}

// ------------------------------------------------------------ the engine --

const glue = await import(resolve(ROOT, 'apps/web/src/wasm/hh_wasm.js'));
await glue.default({
  module_or_path: await readFile(resolve(ROOT, 'apps/web/public/engine/hh_wasm_bg.wasm')),
});

const cityData = {};
async function engineFor(city) {
  if (!cityData[city]) {
    const dir = city === 'hamburg' ? 'data/dist' : `data/dist/${city}`;
    cityData[city] = await Promise.all(
      ['city', 'network', 'scenarios'].map((n) => readFile(resolve(ROOT, `${dir}/${n}-${V}.json`), 'utf8'))
    );
  }
  return new glue.Engine(...cityData[city]);
}

// ----------------------------------------------------------- the examples --

/**
 * Each example says where its network comes from and what to call things.
 *
 * `from` is either a template the engine ships or the slug of something already
 * published, whose drawn routes are worth keeping even when everything around
 * them needed fixing.
 */
const EXAMPLES = [
  {
    city: 'hamburg',
    from: { template: 'bestand', borrow: 'elbtangente-und-ostring-zgh52q' },
    title: 'Elbtangente und Ostring',
    description:
      'Hamburgs Schnellbahnen laufen fast alle durch die Mitte. Wer von Bramfeld nach Eppendorf will, fährt über den Hauptbahnhof. Dieser Entwurf legt zwei Querverbindungen an: einen Ostring von der Innenstadt über Barmbek nach Bramfeld und eine Elbtangente nach Wilhelmsburg, die den Süden erschließt, statt ihn zu überqueren.',
    rename: [
      { label: 'S6', name: 'Ostring: Meßberg – Barmbek – Bramfeld' },
      { label: 'U6', name: 'Elbtangente: Innenstadt – Kleiner Grasbrook – Wilhelmsburg' },
    ],
  },
  {
    city: 'hamburg',
    from: { template: 'bestand', borrow: 'u6-quer-durch-eimsbuettel-sz8scz' },
    title: 'U6 quer durch Eimsbüttel',
    description:
      'Zwischen Altona und der Alster liegen dichte Gründerzeitviertel ohne eigene U-Bahn: Eimsbüttel, Hoheluft, Harvestehude. Wer dort wohnt, fährt mit dem Bus zur nächsten Linie. Diese U6 verbindet sie direkt und nimmt der Innenstadt einen Teil der Umsteiger ab.',
    rename: [{ label: 'U6', name: 'U6: Altona – Eimsbüttel – Alster' }],
  },
  {
    city: 'hamburg',
    // The tram concept as it was published, and nothing beside it: this plan is
    // an argument about trams instead of the U5, so the U4 and the S4 have no
    // business in its figures or on its map.
    from: { template: 'strassenbahn', keep: ['proposal'] },
    title: 'Straßenbahn statt U5',
    description:
      'Dasselbe Geld, anders ausgegeben: vier Straßenbahnlinien quer durch Hamburg statt der U5. Schneller fertig, deutlich billiger, dafür weniger Kapazität und im Straßenraum statt darunter. Der Vergleich ist der Sinn der Sache, nicht die Empfehlung.',
    rename: [],
  },
  {
    city: 'berlin',
    from: { template: 'bestand', borrow: 'u10-steglitz-weissensee-tkgkkt' },
    title: 'U10 Steglitz – Weißensee',
    description:
      'Die alte Berliner Planung: eine zehnte U-Bahn-Linie quer durch die Stadt, vom Rathaus Steglitz über den Potsdamer Platz nach Weißensee. Aufgegeben, aber in den Trassen mancher Bahnhöfe bis heute sichtbar. Hier gerechnet, als würde sie gebaut.',
    rename: [{ label: 'U10', name: 'U10: Rathaus Steglitz – Potsdamer Platz – Weißensee' }],
  },
];

// ---------------------------------------------------------------- publish --

const token = await (async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { handle: HANDLE, password: PASSWORD },
  });
  if (login.status === 200) return login.json.token;
  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: { handle: HANDLE, display_name: 'Beispiele', password: PASSWORD },
  });
  if (reg.status !== 200) {
    console.error(`Kein Konto ${HANDLE}: ${reg.text.slice(0, 160)}`);
    process.exit(1);
  }
  return reg.json.token;
})();

// Whatever this account published before goes, so the set stays the set.
//
// With HH_SEED_PURGE=1 and a moderator account, everything else goes too. That
// is for a demonstration instance, where the discover page is meant to show the
// examples and not the wreckage of every test run: three copies of "Mein
// Hamburger Netz", a plan called "Testentwurf X", and one published with the
// whole existing network switched off, scoring −0.19.
//
// Granting the role is a database operation and deliberately not something this
// script does for itself:
//
//   psql "$DATABASE_URL" -c "UPDATE users SET role='moderator' WHERE handle='…'"
const purge = process.env.HH_SEED_PURGE === '1';
const existing = (await call('/api/scenarios?limit=100')).json ?? [];
for (const s of existing) {
  if (s.author !== HANDLE && !purge) continue;
  const r = await call(`/api/scenarios/${s.slug}`, { method: 'DELETE', token });
  if (r.status === 200) console.log(`  entfernt: ${s.title}`);
  else if (s.author === HANDLE) console.log(`  konnte ${s.title} nicht entfernen (${r.status})`);
  else console.log(`  bleibt: ${s.title} — ${r.status}, dafür braucht es Moderatorrechte`);
}

for (const ex of EXAMPLES) {
  const engine = await engineFor(ex.city);
  engine.loadTemplate(ex.from.template);

  if (ex.from.borrow) {
    // The routes are worth keeping; everything that was switched on around them
    // is not. Loading the published document and then switching off what the
    // author did not draw is simpler than redrawing the geometry by hand.
    const source = await call(`/api/scenarios/${ex.from.borrow}`);
    if (source.status !== 200) {
      console.log(`  übersprungen: ${ex.title} — ${ex.from.borrow} ist nicht abrufbar`);
      continue;
    }
    const doc = source.json.document;
    for (const line of Object.values(doc.network.lines)) {
      if (line.included && line.source !== 'existing' && line.source !== 'user') {
        line.included = false;
      }
    }
    for (const r of ex.rename) {
      for (const line of Object.values(doc.network.lines)) {
        if (line.source === 'user' && line.label === r.label) line.name = r.name;
      }
    }
    doc.title = ex.title;
    engine.loadDocument(JSON.stringify(doc));
    engine.recalculateWithCurrentModel();
  } else if (ex.from.keep) {
    const keep = new Set(ex.from.keep);
    for (const line of engine.renderState().lines) {
      if (line.source !== 'existing' && !keep.has(line.source)) {
        engine.setLineIncluded(line.id, false);
      }
    }
  }

  const document = engine.toDocument(ex.title);
  const result = engine.simulate();
  const created = await call('/api/scenarios', {
    method: 'POST',
    token,
    body: {
      title: ex.title,
      description: ex.description,
      document,
      result: result.headline,
      visibility: 'public',
    },
  });
  if (created.status !== 200) {
    console.error(`  FEHLER bei ${ex.title}: ${created.text.slice(0, 200)}`);
    continue;
  }
  const h = result.headline;
  console.log(
    `  ${ex.title.padEnd(30)} ${h.newKm.toFixed(1).padStart(6)} km neu · ` +
      `${(h.investmentEur / 1e9).toFixed(2)} Mrd. € · NKV ${h.benefitCostRatio.toFixed(2)} · /${created.json.slug}`
  );
}

console.log('\nFertig.');
