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
//     nothing else. the first version of the Bramfeld plan carried Hamburg's U5, U4 and
//     S4 because those were switched on in the editor when it was published, so
//     it claimed 74 km of new track for two lines that are 15 km long, and its map
//     showed somebody else's projects.
//   * Every line has a name a person chose. "Meßberg – Pfirsichweg" is what the
//     editor calls a line when nobody has said what it is.
//
//   HH_SEED_PASSWORD=… node tools/seed-examples.mjs
//   HH_SEED_DRY=1 node tools/seed-examples.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.HH_API ?? 'http://localhost:8080';
const V = process.env.HH_DATA_VERSION ?? '2026-09';
const HANDLE = process.env.HH_SEED_HANDLE ?? 'beispiele';
const PASSWORD = process.env.HH_SEED_PASSWORD;
// With HH_SEED_DRY=1 the plans are only calculated and printed, so their
// figures can be checked before anything is published.
const DRY = process.env.HH_SEED_DRY === '1';

if (!PASSWORD && !DRY) {
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
 * `from` names a template the engine ships and, for drawn plans, a file in
 * `tools/examples/` that lists each line's stations in order. The lines are
 * drawn anew from those stations rather than loaded as a stored document,
 * because a document records the existing network as it was when it was saved
 * and no longer loads once the city data has changed.
 */
const EXAMPLES = [
  {
    city: 'hamburg',
    from: { template: 'bestand', draw: 's6-bramfeld-und-hafenlinie' },
    title: 'S6 nach Bramfeld und Hafenlinie',
    description:
      'Dieser Entwurf ergänzt zwei Linien, nämlich eine S-Bahn vom Meßberg über den Hauptbahnhof, Uhlenhorst, Barmbek und Steilshoop nach Bramfeld und eine kurze U-Bahn durch den Hafen von Waltershof über Altenwerder nach Moorburg. Da beide Linien durch sehr unterschiedlich dicht besiedelte Gebiete fahren, zeigt der Vergleich, wie stark der Nutzen einer Strecke von ihrem Einzugsgebiet abhängt.',
    rename: [
      { label: 'S6', name: 'S6: Meßberg – Barmbek – Bramfeld' },
      { label: 'U6', name: 'U6: Waltershof – Altenwerder – Moorburg' },
    ],
  },
  {
    city: 'hamburg',
    from: { template: 'bestand', draw: 'u6-quer-durch-eimsbuettel' },
    title: 'U6 quer durch Eimsbüttel',
    description:
      'Zwischen Altona und der Alster liegen mit Eimsbüttel, Hoheluft und Harvestehude dicht bebaute Viertel, deren Bewohner großenteils mit dem Bus zur nächsten Schnellbahn fahren. Diese U6 verbindet sie unmittelbar miteinander und soll zugleich die Umsteigeknoten der Innenstadt entlasten.',
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
      'Dieser Entwurf ersetzt die U5 durch vier Straßenbahnlinien quer durch Hamburg, die früher fertig und deutlich günstiger wären, dafür aber weniger Fahrgäste aufnehmen und im Straßenraum statt im Tunnel fahren. Er soll den Vergleich beider Ansätze ermöglichen und ist nicht als Empfehlung gemeint.',
    rename: [],
  },
  {
    city: 'berlin',
    from: { template: 'bestand', draw: 'u10-steglitz-weissensee' },
    title: 'U10 Steglitz – Weißensee',
    description:
      'Die Berliner Planung einer U10 sah eine Linie vom Rathaus Steglitz über den Potsdamer Platz nach Weißensee vor, die zwar aufgegeben wurde, für die aber in einigen Bahnhöfen bereits Bauvorleistungen bestehen. Der Entwurf folgt dieser Strecke bis zur Greifswalder Straße und rechnet sie so, als würde sie heute gebaut.',
    rename: [{ label: 'U10', name: 'U10: Rathaus Steglitz – Potsdamer Platz – Greifswalder Straße' }],
  },
];

// A line is drawn through its stations without automatic stops. The engine
// rounds the corners of the alignment and adds a node at every bend, so each
// listed station keeps the node nearest to it and every other new node becomes
// a plain vertex of the track.
function drawLine(engine, line, rename) {
  const points = line.stations.map(({ lat, lon }) => ({ lat, lon }));
  engine.apply({
    type: 'drawLine',
    mode: line.mode,
    infrastructure: null,
    points,
    label: line.label,
    color: line.color,
    autoStations: false,
    anchors: points,
  });
  const net = JSON.parse(engine.toDocument('')).network;
  const [id, drawn] = Object.entries(net.lines).find(([, l]) => l.source === 'user' && l.label === line.label);
  const ids = [net.edges[drawn.edges[0]].from, ...drawn.edges.map((e) => net.edges[e].to)];
  const stops = ids.filter((n) => net.nodes[n].kind === 'station');
  const keep = new Set();
  line.stations.forEach((s, i) => {
    const nearest = stops.reduce((a, b) => (metres(s, net.nodes[a].geo) <= metres(s, net.nodes[b].geo) ? a : b));
    keep.add(nearest);
    const node = net.nodes[nearest];
    if (node.source === 'user' && node.name !== s.name) {
      engine.apply({ type: 'renameNode', node: Number(nearest), name: s.name });
    }
  });
  for (const n of stops) {
    if (!keep.has(n) && net.nodes[n].source === 'user') {
      engine.apply({ type: 'setNodeKind', node: Number(n), kind: 'waypoint' });
    }
  }
  const name = rename.find((r) => r.label === line.label)?.name;
  if (name) engine.apply({ type: 'setLineStyle', line: Number(id), label: null, name, color: null });
  if (line.service) engine.apply({ type: 'setService', line: Number(id), service: line.service });
}

function metres(a, b) {
  const k = Math.PI / 180;
  return Math.hypot((b.lon - a.lon) * Math.cos(a.lat * k) * 111320, (b.lat - a.lat) * 110540);
}

// ---------------------------------------------------------------- publish --

const token = DRY ? null : await (async () => {
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
const existing = DRY ? [] : ((await call('/api/scenarios?limit=100')).json ?? []);
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

  if (ex.from.draw) {
    const plan = JSON.parse(await readFile(resolve(ROOT, `tools/examples/${ex.from.draw}.json`), 'utf8'));
    for (const line of plan.lines) drawLine(engine, line, ex.rename);
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
  const h = result.headline;
  const summary =
    `  ${ex.title.padEnd(30)} ${h.newKm.toFixed(1).padStart(6)} km neu · ${h.newStations} Stationen · ` +
    `${(h.investmentEur / 1e9).toFixed(2)} Mrd. € · NKV ${h.benefitCostRatio.toFixed(2)}`;
  if (DRY) {
    console.log(summary);
    continue;
  }
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
  console.log(`${summary} · /${created.json.slug}`);
}

console.log('\nFertig.');
