// Pure interface logic, tested without a browser.
//
// Most of this application's behaviour lives in the engine and is covered by
// the Rust tests. A few rules live in the interface, and they are exactly the
// ones a browser test is bad at pinning down: what a figure reads while it is
// animating, how a city is named, how a number is written in German. They are
// small, they are pure, and getting one wrong shows the user a wrong number.
//
// Run: node tools/test-ui.mjs

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => resolve(ROOT, 'apps/web/src', p);

const { tween } = await import(src('lib/tween.ts'));
const { cityLabel, km, eur, ratio } = await import(src('lib/format.ts'));
const { existingSwitchedOff, ownWorkOnly, scopeOf } = await import(src('lib/publish-scope.ts'));
const { transitSources } = await import(src('lib/basemap.ts'));
const { impressumIsComplete } = await import(src('lib/impressum.ts'));
const { planBounds } = await import(src('lib/plan-bounds.ts'));

let passed = 0;
let failed = 0;
const results = [];

// `check` is synchronous on purpose, and says so loudly.
//
// It used to call `fn()` without awaiting. An `async` check therefore returned
// a promise that nobody looked at: the assertion inside it settled long after
// the result had been recorded as a pass, and its rejection went nowhere. Four
// checks were passing that way — including one written to catch exactly this
// class of mistake. A test that cannot fail is worse than no test, because it
// is counted.
function check(name, fn) {
  try {
    const returned = fn();
    if (returned && typeof returned.then === 'function') {
      throw new Error(
        'check() wartet nicht: diese Prüfung ist async und würde immer bestehen — checkAsync benutzen'
      );
    }
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}\n      ${e.message}`);
  }
}

/** The same, for a check that has to await something. Call it with `await`. */
async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}\n      ${e.message}`);
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ------------------------------------------------------- animated figures --

check('am Ende steht immer der Zielwert', () => {
  assert(tween(100, 200, 1) === 200, 'Ende erreicht den Zielwert nicht');
  assert(tween(100, 200, 1.4) === 200, 'über das Ende hinaus nicht geklemmt');
});

check('am Anfang steht der gemalte Wert', () => {
  assert(tween(100, 200, 0) === 100, 'Anfang ist nicht der gemalte Wert');
});

check('dazwischen liegt der Wert zwischen beiden', () => {
  const v = tween(100, 200, 0.5);
  assert(v > 100 && v < 200, `${v} liegt nicht dazwischen`);
});

// The two failures this rule exists for.
check('ein zurückgenommener Wechsel zeigt wieder den richtigen Wert', () => {
  // 100 → 200 starts, reaches 150, then goes back to 100. What is painted is
  // 150 and the target is 100, which must not pass as "nothing to do".
  const painted = tween(100, 200, 0.5);
  assert(painted !== 100, 'Voraussetzung: es wurde etwas anderes gemalt');
  assert(tween(painted, 100, 1) === 100, 'der zurückgenommene Wert wird nicht wiederhergestellt');
});

check('gleicher Wert bleibt genau dieser Wert', () => {
  assert(tween(150, 150, 0.5) === 150, 'ein unveränderter Wert wandert');
});

check('ohne Bewegung wird sofort der Zielwert gezeigt', () => {
  assert(tween(100, 200, 0, true) === 200, 'prefers-reduced-motion springt nicht ans Ziel');
  assert(tween(100, 200, 0.3, true) === 200, 'prefers-reduced-motion easet trotzdem');
});

check('unbrauchbare Zahlen werden nicht animiert', () => {
  assert(Number.isNaN(tween(100, NaN, 0.5)), 'NaN wird geglättet');
  assert(tween(NaN, 200, 0.5) === 200, 'aus NaN heraus wird nicht direkt gesprungen');
  assert(tween(100, Infinity, 0.5) === Infinity, 'Unendlich wird geglättet');
});

// ------------------------------------------------ one language for the source --

// The README says the interface is German and the code is commented in English.
// That rule is easy to break while explaining a fix in the language you are
// thinking in — I put about twenty German comments into the Rust and the test
// suites in a single day without noticing, and only found them while reading
// the README for something else.
//
// The test looks for German *function words*, not for umlauts: comments
// legitimately name Straße, Lübeck and Gewässer, and quote German interface
// strings, but no English sentence contains "wird", "nicht" or "sondern".
await checkAsync('der Quelltext ist einsprachig kommentiert', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const GERMAN = /\b(nicht|wird|werden|sich|dass|sondern|eine[nmr]?|dieser|diese|jedoch|damit|weil|deshalb|steht|liegt|gibt|kann|muss|soll|hätte|wurde|worden)\b/;
  const roots = ['rust/core/src', 'rust/cli/src', 'rust/server/src', 'rust/wasm/src', 'tools'];
  const offenders = [];
  const walk = async (dir) => {
    for (const e of await readdir(resolve(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') await walk(rel);
        continue;
      }
      if (!/\.(rs|mjs)$/.test(e.name)) continue;
      const text = await readFile(resolve(ROOT, rel), 'utf8');
      text.split('\n').forEach((line, i) => {
        const m = line.match(/^\s*(\/\/\/?!?|\*)\s?(.*)$/);
        if (!m) return;
        // Drop quoted strings: a comment may quote the German interface.
        const bare = m[2].replace(/"[^"]*"/g, '').replace(/„[^"“]*[""]/g, '');
        if (GERMAN.test(bare)) offenders.push(`${rel}:${i + 1}  ${m[2].slice(0, 60)}`);
      });
    }
  };
  for (const r of roots) await walk(r);
  assert(
    offenders.length === 0,
    `deutsche Kommentare im Quelltext:\n      ${offenders.slice(0, 8).join('\n      ')}`
  );
});

// --------------------------------------- what the server is not right now --

// "Nothing there" and "cannot be reached" are different claims about the
// world, and the first is the one people believe, because it sounds plausible.
// Every page that waits on the server has to know the difference.
await checkAsync('Server-nicht-erreichbar wird von leer unterschieden', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const page of [
    'app/entdecken/page.tsx',
    'app/vergleich/page.tsx',
    'app/szenario/[slug]/ScenarioView.tsx',
  ]) {
    const text = await readFile(src(page), 'utf8');
    assert(
      /instanceof ApiUnavailable/.test(text),
      `${page} unterscheidet nicht zwischen leer und nicht erreichbar`
    );
  }
});

// -------------------------------------------------------------- Beschriftung --

check('Städte heißen bei ihrem Namen, nicht bei ihrem Bezeichner', () => {
  assert(cityLabel('hamburg') === 'Hamburg', cityLabel('hamburg'));
  assert(cityLabel('berlin') === 'Berlin', cityLabel('berlin'));
  // A city that does not exist yet still must not turn up lower-case in the
  // middle of a sentence.
  assert(cityLabel('leipzig') === 'Leipzig', cityLabel('leipzig'));
  assert(cityLabel('') === 'Hamburg', 'leerer Bezeichner ohne Rückfall');
});

// ------------------------------------------------------------ Zahlensatz --

check('Zahlen werden deutsch gesetzt', () => {
  assert(km(74.1756) === '74,2 km', km(74.1756));
  assert(ratio(0.345) === '0,35', ratio(0.345));
  assert(/Mrd\. €$/.test(eur(24.2e9)), eur(24.2e9));
  assert(/Mio\. €$/.test(eur(390e6)), eur(390e6));
});

// ------------------------------------------------------------- Rückstand --

// The backlog is the record of what is known to be wrong, so it has to survive
// being edited. Twice now a scripted edit has removed a heading along with the
// entry above it, which silently turned the *next* insert into a no-op and lost
// the entries it was supposed to add. Cheap to check, and it fails loudly.
check('der Rückstand ist noch als Rückstand lesbar', () => {
  const text = readFileSync(resolve(ROOT, 'docs/backlog.md'), 'utf8');
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert(headings.includes('Offen'), 'Überschrift „Offen" fehlt');
  assert(headings.includes('Erledigt'), 'Überschrift „Erledigt" fehlt');
  assert(
    text.indexOf('## Offen') < text.indexOf('## Erledigt'),
    'Offen steht nicht vor Erledigt'
  );

  // A bullet that lost its "* " reads as part of the entry above it and stops
  // being an entry at all.
  const orphan = text.split('\n').filter((l) => /^\s+\*\*\[[FPI]/.test(l));
  assert(!orphan.length, `Einträge ohne Aufzählungszeichen: ${orphan[0]?.trim().slice(0, 60)}`);

  const open = text.slice(text.indexOf('## Offen'), text.indexOf('## Erledigt'));
  const openEntries = [...open.matchAll(/^\* \*\*\[/gm)].length;
  assert(openEntries > 0, 'kein einziger offener Punkt — das wäre zu schön');
  // Anything already settled belongs in the other half.
  const settled = [...open.matchAll(/^\* \*\*\[P→/gm)].length;
  assert(!settled, `${settled} abgeschlossene Punkte stehen noch unter „Offen"`);
});

// ------------------------------------------------- Umfang beim Teilen --

// A plan drawn on top of a scenario used to be published with that scenario's
// projects switched on: "U6 quer durch Eimsbüttel" claimed 65,6 km and 23,1 Mrd
// € for one drawn line and eight of Hamburg's decided projects. Every figure on
// its page, and its rank on every board, described somebody else's work.
check('Veröffentlichen zählt fremde Vorhaben nicht mit', () => {
  const doc = (lines) => JSON.stringify({ network: { lines } });
  const mixed = doc({
    1: { source: 'existing', included: true },
    2: { source: 'planned', included: true },
    3: { source: 'proposal', included: true },
    4: { source: 'user', included: true },
    5: { source: 'planned', included: false },
  });
  const counted = JSON.parse(ownWorkOnly(mixed)).network.lines;
  assert(counted[4].included, 'die eigene Linie fehlt');
  assert(counted[1].included, 'das Bestandsnetz ist die Vergleichsgrundlage und muss bleiben');
  assert(!counted[2].included && !counted[3].included, 'fremde Vorhaben zählen weiter mit');

  const { own, others } = scopeOf(mixed);
  assert(own === 1 && others === 2, `gezählt: ${own} eigene, ${others} fremde`);
});

// Publishing a comparison of two existing concepts is a legitimate thing to do,
// and stripping it would leave a plan with nothing in it.
check('ein Entwurf ganz ohne eigene Linien bleibt unangetastet', () => {
  const only = JSON.stringify({
    network: { lines: { 1: { source: 'planned', included: true }, 2: { source: 'existing', included: true } } },
  });
  assert(ownWorkOnly(only) === only, 'ein Entwurf ohne eigene Linien wurde beschnitten');
});

// ----------------------------------------------------------- Zeigerpunkt --

// The marker and its label both centre themselves with `-translate-x-1/2`,
// which shifts by half the element's *own* width. That is only the width you
// expect if the element is out of flow: a block child fills its containing
// block instead, and the containing block here shrink-wraps to the widest
// child — the label. The marker then moved by half the label, so pointing at
// "Hauptbahnhof · Umsteigepunkt T1 T4" drew the dot 130 px to the left of the
// station, while the label sat exactly right.
check('Zeigerpunkt und Beschriftung hängen beide am selben Punkt', () => {
  const src = readFileSync(resolve(ROOT, 'apps/web/src/components/MapCanvas.tsx'), 'utf8');
  const at = src.indexOf('function SnapCursor');
  assert(at > 0, 'SnapCursor nicht gefunden');
  const body = src.slice(at, src.indexOf('\nfunction ', at + 10));
  // For each centring element, look back to the class list it belongs to.
  // Matching the whole attribute is awkward because these are template literals
  // with interpolation in them; the span between `className=` and the marker is
  // enough and cannot be confused with a neighbour's.
  // Scan forward from each className, not backward from each centring class:
  // the comment above this component names `-translate-x-1/2` too, and prose is
  // not markup.
  let found = 0;
  for (let at2 = body.indexOf('className='); at2 > 0; at2 = body.indexOf('className=', at2 + 1)) {
    const cls = body.slice(at2, at2 + 260);
    if (!cls.includes('-translate-x-1/2')) continue;
    found++;
    assert(
      /\babsolute\b/.test(cls.slice(0, cls.indexOf('-translate-x-1/2'))),
      `ein zentriertes Element steht im Textfluss und verschiebt sich dann um die halbe Breite ` +
        `seines Elternteils statt um die eigene: ${cls.slice(0, 90).replace(/\s+/g, ' ')}`
    );
  }
  assert(found >= 2, `nur ${found} zentrierte Elemente gefunden`);
});

// --------------------------------------------------------------- Teilen --

// Every declared card format needs a size and a button, or it is a format that
// exists only in the type. The story size was added because 1080 × 1350 was
// labelled "Story" and is not one — posted as a story it gets letterboxed.
check('jedes Bildformat hat Maße und einen Knopf', () => {
  const card = readFileSync(resolve(ROOT, 'apps/web/src/lib/sharecard.ts'), 'utf8');
  const sheet = readFileSync(resolve(ROOT, 'apps/web/src/components/ShareSheet.tsx'), 'utf8');
  const declared = card
    .match(/export type CardFormat =([^;]+);/)[1]
    .split('|')
    .map((x) => x.trim().replace(/'/g, ''))
    .filter(Boolean);
  const sizes = card.slice(card.indexOf('const SIZES'), card.indexOf('const DARK'));
  for (const f of declared) {
    assert(new RegExp(`\\b${f}:\\s*\\[`).test(sizes), `${f} hat keine Maße`);
    assert(sheet.includes(`id: '${f}'`), `${f} steht in keiner Auswahl`);
  }
  assert(declared.includes('story'), 'kein 9:16-Format für Stories');
  assert(/story: \[1080, 1920\]/.test(sizes), 'Story ist nicht 1080 × 1920');
});

check('Instagram ist erreichbar, obwohl es keine Links annimmt', () => {
  const sheet = readFileSync(resolve(ROOT, 'apps/web/src/components/ShareSheet.tsx'), 'utf8');
  const at = sheet.indexOf("id: 'instagram'");
  assert(at > 0, 'Instagram fehlt in den Zielen');
  // Just this entry: the window used to run on into the next target and pick up
  // its href, so the check failed on a link that was never Instagram's.
  const block = sheet.slice(at, sheet.indexOf('},', at));
  // A web intent for Instagram would be a button that pretends: it has none.
  assert(!/href:/.test(block), 'Instagram hat einen Link, den es nicht gibt');
  assert(/action:/.test(block), 'Instagram hat keine Aktion');
});

// ------------------------------------------------------- Nur das Neue --

// Somebody else's plan is about the two lines they drew. Drawn on top of the
// seven hundred kilometres that already exist, at the same weight and the same
// colours, those two lines are not findable — which is what the plan pages did
// until now.
check('die Planansicht zeigt nur, was gebaut würde', () => {
  const seg = (id, status) => ({ id, status, geo: [[10, 53.5], [10.1, 53.6]] });
  // Station 2 belongs only to the untouched S1, so the focused view drops it;
  // 1 sits on the extended U1, 3 and 4 on the drawn line.
  const stop = (id, lines) => ({ id, name: `H${id}`, lon: 10, lat: 53.5, colors: [], status: 'in_service', interchange: false, lines });
  const render = {
    stations: [stop(1), stop(2), stop(3), stop(4)],
    lines: [
      // An existing line that the plan extends: the extension is new, the rest
      // of it is not.
      {
        id: 1, label: 'U1', name: '', mode: 'ubahn', color: '#000', source: 'existing',
        included: true, extends: null, stations: [1], segments: [seg(11, 'in_service'), seg(12, 'to_build')],
      },
      // Untouched existing line: nothing of it belongs to the plan.
      {
        id: 2, label: 'S1', name: '', mode: 'sbahn', color: '#000', source: 'existing',
        included: true, extends: null, stations: [2], segments: [seg(21, 'in_service')],
      },
      // The author's own line, drawn partly over track that already carries
      // trains. Dropping that part would break the route into fragments.
      {
        id: 3, label: 'U6', name: '', mode: 'ubahn', color: '#000', source: 'user',
        included: true, extends: null, stations: [3, 4], segments: [seg(31, 'to_build'), seg(32, 'in_service')],
      },
      // Switched off: not in the plan at all, in either view.
      {
        id: 4, label: 'X', name: '', mode: 'tram', color: '#000', source: 'user',
        included: false, extends: null, stations: [9], segments: [seg(41, 'to_build')],
      },
    ],
  };
  const ids = (focus) =>
    transitSources(render, focus).lines.features.map((f) => f.properties.id).sort((a, b) => a - b);

  assert(ids(false).join() === '11,12,21,31,32', `die volle Ansicht zeigt ${ids(false)}`);
  assert(ids(true).join() === '12,31,32', `die Planansicht zeigt ${ids(true)}`);

  // A line that something extends is drawn whole, so the extension does not
  // begin in mid-air. Here: nothing extends anything, so nothing extra appears.
  const withExtension = {
    stations: [stop(1), stop(2), stop(3), stop(4), stop(5)],
    lines: [
      // The U4, untouched but continued by the plan below.
      { id: 5, label: 'U4', name: '', mode: 'ubahn', color: '#000', source: 'existing',
        included: true, extends: null, stations: [5], segments: [seg(51, 'in_service')] },
      { id: 6, label: 'U4', name: 'U4-Verlängerung', mode: 'ubahn', color: '#000', source: 'user',
        included: true, extends: 5, stations: [5], segments: [seg(61, 'to_build')] },
    ],
  };
  const extended = transitSources(withExtension, true).lines.features.map((f) => f.properties.id);
  assert(
    extended.includes(51) && extended.includes(61),
    `die fortgesetzte Linie fehlt in der Planansicht: ${extended}`
  );
  // Switched off, it is nobody's context either.
  const off = { ...withExtension, lines: [withExtension.lines[0], { ...withExtension.lines[1], included: false }] };
  assert(
    !transitSources(off, true).lines.features.map((f) => f.properties.id).includes(51),
    'die Linie wird auch ohne eingeschaltete Verlängerung mitgezeichnet'
  );

  // Stations followed their lines, or several hundred coloured dots stayed on
  // the map with nothing under them.
  const stops = (focus) =>
    transitSources(render, focus).stations.features.map((f) => f.properties.id).sort((a, b) => a - b);
  assert(stops(false).join() === '1,2,3,4', `die volle Ansicht zeigt ${stops(false)} Stationen`);
  assert(stops(true).join() === '1,3,4', `die Planansicht zeigt ${stops(true)} Stationen`);
});

// The style seeds these sources itself, on creation and again on every theme
// change. It took the flag as an afterthought once, and the whole network came
// back the moment the reader switched to dark.
check('der Kartenstil reicht die Einschränkung durch', () => {
  const src = readFileSync(resolve(ROOT, 'apps/web/src/lib/basemap.ts'), 'utf8');
  assert(/transitSources\(render, focusNew\)/.test(src), 'buildStyle reicht focusNew nicht weiter');
  const canvas = readFileSync(resolve(ROOT, 'apps/web/src/components/MapCanvas.tsx'), 'utf8');
  for (const call of canvas.match(/buildStyle\([^)]*\)/g) ?? [])
    assert(/focusNew|, f\)/.test(call), `buildStyle ohne focusNew: ${call}`);
  assert(/syncRender\(render, \{ schematic, focusNew \}\)/.test(canvas), 'syncRender ohne focusNew');
  // The controller re-seeds the very same two sources on every change, so a
  // rule that lives only in the style holds until the first edit and no longer.
  const ctrl = readFileSync(resolve(ROOT, 'apps/web/src/lib/controller.ts'), 'utf8');
  assert(/opts\.focusNew && !ownLine && seg\.status !== 'to_build'/.test(ctrl), 'der Controller filtert keine Strecken');
  assert(/opts\.focusNew \? render\.stations\.filter/.test(ctrl), 'der Controller filtert keine Stationen');
});

// A plan published with the network switched off carries nothing but negative
// figures, and the author is the only person who can still say whether that was
// the point. Warn there, not afterwards.
check('das Veröffentlichen warnt vor abgeschaltetem Bestand', () => {
  const doc = (lines) => JSON.stringify({ network: { lines } });
  assert(
    existingSwitchedOff(doc({ a: { source: 'existing', included: false }, b: { source: 'user', included: true } })) === 1,
    'abgeschaltete Bestandslinie nicht gezählt'
  );
  assert(existingSwitchedOff(doc({ a: { source: 'existing', included: true } })) === 0, 'Fehlalarm');
  assert(existingSwitchedOff(doc({ a: { source: 'planned', included: false } })) === 0, 'zählt fremde Vorhaben mit');
  assert(existingSwitchedOff('kein JSON') === 0, 'stolpert über unlesbare Entwürfe');
  const page = readFileSync(resolve(ROOT, 'apps/web/src/app/page.tsx'), 'utf8');
  assert(/off > 0\s*\?/.test(page), 'der Veröffentlichen-Dialog warnt nicht');
});

// A leaderboard row without its figure asks the reader to take the order on
// trust. Every board the server defines needs one, and it has to be the figure
// the board actually sorts by — "Günstigste Erschließung" printed the reached
// inhabitants, which is not what it ranks, so its column contradicted its order.
check('jede Rangliste zeigt die Zahl, nach der sie sortiert', () => {
  const server = readFileSync(resolve(ROOT, 'rust/server/src/scenarios.rs'), 'utf8');
  const boards = server.slice(server.indexOf('pub const BOARDS'), server.indexOf('pub async fn list'));
  const keys = [...boards.matchAll(/\(\s*"([a-z0-9]+)",/g)].map((m) => m[1]);
  assert(keys.length >= 10, `nur ${keys.length} Ranglisten gefunden`);
  const page = readFileSync(resolve(ROOT, 'apps/web/src/app/entdecken/page.tsx'), 'utf8');
  const map = page.slice(page.indexOf('const BOARD_VALUE'), page.indexOf('/** What an empty board'));
  for (const k of new Set(keys)) assert(new RegExp(`\\b${k}:`).test(map), `${k} ohne Zahl`);
  assert(/investment_eur \/ s\.population_gain/.test(map), 'Erschließung zeigt nicht die Kosten je Einwohner');
});

// The opening frame has to be the plan, not the city. It went wrong twice in
// opposite directions: fitted before the canvas had its size, a box around
// thirty-five Hamburg kilometres opened at zoom 8,7 with Norderstedt in view;
// deferred to the map's `load` event, it never ran at all, because `loaded()`
// stays false on this map for as long as it is open.
check('eine Planseite öffnet auf dem Plan', () => {
  const seg = (status, geo) => ({ id: 1, status, geo });
  const line = (source, segments) => ({ source, included: true, segments, stations: [] });
  const box = planBounds({
    stations: [],
    lines: [
      // Existing track all over Hamburg: not part of the frame.
      line('existing', [seg('in_service', [[9.7, 53.4], [10.4, 53.9]])]),
      // What the plan would build, in one corner of it.
      line('existing', [seg('to_build', [[9.98, 53.55], [10.02, 53.58]])]),
      line('user', [seg('to_build', [[10.0, 53.56], [10.05, 53.6]])]),
      // A decided project running far out of town on rails that already exist.
      // It is drawn, so that the line reads as a line, and it must not drag the
      // opening frame eighty kilometres north-east with it.
      line('planned', [seg('in_service', [[10.9, 53.81], [10.4, 53.7]])]),
      { source: 'user', included: false, stations: [], segments: [seg('to_build', [[8, 52], [12, 55]])] },
    ],
  });
  assert(box, 'kein Rahmen für einen Entwurf, der etwas baut');
  assert(
    box.flat().join() === '9.98,53.55,10.05,53.6',
    `der Rahmen liegt bei ${box.flat().join()}`
  );
  // Nothing to build, so nothing to frame: the map stays where it opened
  // instead of fitting an empty box, which would put it in the Atlantic.
  assert(
    planBounds({ stations: [], lines: [line('user', [seg('in_service', [[9.7, 53.4]])])] }) === null,
    'ein Entwurf ohne Neubau bekommt trotzdem einen Rahmen'
  );
});

// -------------------------------------------------- Vorzeichen und Farbe --

// A minus sign in green, labelled "Nutzen", reads as a broken model. It is not:
// switch existing lines off and the city really is worse than the one that runs
// today, which is what the figure is measured against.
check('negativer Nutzen wird nicht grün angezeigt', () => {
  const src = readFileSync(resolve(ROOT, 'apps/web/src/components/editor/Analysis.tsx'), 'utf8');
  for (const field of ['annualBenefitEur', 'annualFiscalEur'])
    assert(
      new RegExp(`tone=\\{h\\.${field} >= 0 \\? 'good' : 'bad'\\}`).test(src),
      `${field} hat einen festen Ton`
    );
  assert(/gegenüber dem heutigen Netz/.test(src), 'der Bezugspunkt wird nicht genannt');
  assert(/existingOff > 0 &&/.test(src), 'abgeschaltete Bestandslinien werden nicht erklärt');
  // The explanation alone leaves the reader with a wrong number and no way back.
  assert(/Bestand wieder einschalten/.test(src), 'der Hinweis lässt sich nicht befolgen');
  const page = readFileSync(resolve(ROOT, 'apps/web/src/app/page.tsx'), 'utf8');
  assert(/onRestoreExisting=\{restoreExisting\}/.test(page), 'der Editor reicht die Rückkehr nicht durch');
});

// ------------------------------------------------------------ Pflichten --

// § 5 DDG wants the operator named, reachable by post and electronically, on a
// page that is easy to find and always available. The details cannot be
// guessed, so they start as placeholders — and a placeholder that reaches the
// public is worse than a missing page, because an Impressum naming nobody still
// claims to be one.
check('das Impressum steht nicht auf Platzhaltern, oder sagt es', () => {
  const page = readFileSync(resolve(ROOT, 'apps/web/src/app/rechtliches/page.tsx'), 'utf8');
  // Asked of the module rather than of its text. Searching the file for the
  // placeholder marker always found one: the function that detects placeholders
  // contains the string it looks for.
  const open = !impressumIsComplete();
  // Filled in or not, the page has to react to it rather than print the
  // placeholder as though it were an address.
  assert(/impressumIsComplete/.test(page), 'die Seite prüft die Angaben nicht');
  assert(/nicht betriebsbereit/.test(page), 'die Seite warnt nicht vor Platzhaltern');
  if (open && process.env.HH_ENV === 'production') {
    throw new Error(
      'Die Betreiberangaben sind noch Platzhalter; so darf der Dienst nicht öffentlich laufen.'
    );
  }
});

// The link has to be on every page that has a footer, and it has to be the
// legal one — "Impressum" pointing at a marketing page is a common way to fail
// § 5 DDG without noticing.
check('jede Seite führt zu Impressum und Datenschutz', () => {
  const footer = readFileSync(resolve(ROOT, 'apps/web/src/components/SiteFooter.tsx'), 'utf8');
  for (const [label, href] of [
    ['Impressum', '/rechtliches#impressum'],
    ['Datenschutz', '/rechtliches#datenschutz'],
    ['Nutzungsbedingungen', '/rechtliches#nutzung'],
  ]) {
    assert(footer.includes(href), `${label} fehlt im Fuß`);
  }
  const layout = readFileSync(resolve(ROOT, 'apps/web/src/app/layout.tsx'), 'utf8');
  assert(/<SiteFooter\s*\/>/.test(layout), 'der Fuß steht nicht im Grundgerüst');
});

// Rights that exist only as a sentence in a privacy policy are rights nobody
// exercises. Both are wired to something that runs.
check('Auskunft und Löschung sind eingebaut, nicht nur zugesagt', () => {
  const routes = readFileSync(resolve(ROOT, 'rust/server/src/main.rs'), 'utf8');
  assert(/auth::export/.test(routes), 'keine Route für die Auskunft (Art. 15 DSGVO)');
  assert(/auth::delete_account/.test(routes), 'keine Route für die Löschung (Art. 17 DSGVO)');
  const konto = readFileSync(resolve(ROOT, 'apps/web/src/app/konto/page.tsx'), 'utf8');
  assert(/exportAccount/.test(konto) && /deleteAccount/.test(konto), 'die Kontoseite ruft sie nicht auf');
  // Erasure that leaves the writing behind is not erasure. The foreign keys
  // would merely detach it, so the handler has to delete rather than rely on
  // ON DELETE SET NULL.
  const auth = readFileSync(resolve(ROOT, 'rust/server/src/auth.rs'), 'utf8');
  for (const table of ['comments', 'scenarios', 'votes', 'users'])
    assert(
      new RegExp(`DELETE FROM ${table} WHERE`).test(auth),
      `beim Löschen bleibt ${table} stehen`
    );
});

// The datasets under /data are derived databases in the sense of the ODbL, and
// share-alike applies to them. Attribution on the map is not the whole duty:
// the licence of the derived data has to be stated too.
check('die Datenlizenzen werden genannt', () => {
  const page = readFileSync(resolve(ROOT, 'apps/web/src/app/rechtliches/page.tsx'), 'utf8');
  for (const needle of ['ODbL', 'OpenStreetMap', 'dl-de/by-2-0', 'abgeleitete']) {
    assert(page.includes(needle), `${needle} fehlt bei den Lizenzen`);
  }
  assert(/kein amtliches Angebot/i.test(page), 'der Hinweis auf die fehlende Amtlichkeit fehlt');
});

console.log(results.join('\n'));
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
