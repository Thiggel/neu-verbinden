// End-to-end test of the WebAssembly engine against the real Hamburg dataset.
//
// This is the layer the browser actually talks to, so it is worth testing
// outside the browser: it catches binding drift, dataset/schema mismatches and
// regressions in the editor flow without needing a page at all.
//
//   node tools/test-engine.mjs
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { ringSelfIntersects, setOrigin } from './importer/lib/geo.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V = process.env.HH_DATA_VERSION ?? '2026-09';

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
  if (!cond) throw new Error(msg ?? 'Erwartung nicht erfüllt');
};
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

const wasmPath = resolve(ROOT, 'apps/web/public/engine/hh_wasm_bg.wasm');
const glue = await import(resolve(ROOT, 'apps/web/src/wasm/hh_wasm.js'));
await glue.default({ module_or_path: await readFile(wasmPath) });

const [city, network, scenarios] = await Promise.all([
  readFile(resolve(ROOT, `data/dist/city-${V}.json`), 'utf8'),
  readFile(resolve(ROOT, `data/dist/network-${V}.json`), 'utf8'),
  readFile(resolve(ROOT, `data/dist/scenarios-${V}.json`), 'utf8'),
]);

const t0 = performance.now();
const engine = new glue.Engine(city, network, scenarios);
const bootMs = performance.now() - t0;

// --------------------------------------------------------------- baseline --

engine.loadTemplate('bestand');
const base = engine.renderState();
const baseQuick = engine.quickEstimate();
const baseSim = engine.simulate();

check('das Bestandsnetz enthält die echten Hamburger Linien', () => {
  const labels = new Set(base.lines.filter((l) => l.included).map((l) => l.label));
  for (const l of ['U1', 'U2', 'U3', 'U4', 'S1', 'S2', 'S3', 'S5']) {
    assert(labels.has(l), `Linie ${l} fehlt`);
  }
});

check('die U-Bahn-Länge entspricht dem realen Netz', () => {
  const ubahn = baseSim.headline.kmByMode.find(([m]) => m === 'ubahn');
  assert(ubahn, 'keine U-Bahn im Netz');
  // Hamburg's U-Bahn is about 106 km.
  near(ubahn[1], 106, 6, 'U-Bahn-Länge');
});

check('im Bestand ist nichts zu bauen', () => {
  assert(baseQuick.investmentEur === 0, `erwartet 0 €, war ${baseQuick.investmentEur}`);
  assert(baseQuick.openingYear === null || baseQuick.openingYear === undefined);
  assert(baseSim.timeline.nothingToBuild);
});

check('die Nachfrage im Bestandsnetz liegt in der beobachteten Größenordnung', () => {
  const b = baseSim.demand.boardingsPerDay;
  // U-Bahn 291 Mio. and S-Bahn about 280 Mio. rides in 2025, over the 305
  // weekday equivalents of the model: 1.87 Mio. a day.
  assert(b > 1_700_000 && b < 2_000_000, `${Math.round(b)} Einsteiger/Werktag ist unplausibel`);
});

check('Stationen tragen Namen und Farben', () => {
  assert(base.stations.length > 140, `nur ${base.stations.length} Stationen`);
  assert(base.stations.every((s) => s.name && s.name !== 'Ohne Namen'), 'unbenannte Station');
  assert(base.stations.every((s) => s.colors.length > 0), 'Station ohne Linienfarbe');
  const hbf = base.stations.find((s) => s.name.includes('Hauptbahnhof'));
  assert(hbf && hbf.interchange, 'Hauptbahnhof ist kein Umsteigepunkt');
});

// -------------------------------------------------------- planned projects --

engine.loadTemplate('beschlossen');
const planned = engine.simulate();

check('mit den beschlossenen Vorhaben entsteht Neubau', () => {
  assert(planned.headline.newKm > 40, `${planned.headline.newKm} km Neubau`);
  assert(planned.headline.investmentEur > 5e9, 'unplausibel geringe Investition');
  assert(planned.headline.openingYear > 2030, 'unplausibles Eröffnungsjahr');
});

check('die Kostenkategorien summieren sich auf den Gesamtwert', () => {
  const sum = planned.cost.categories.reduce((s, c) => s + c.amountEur, 0);
  near(sum, planned.cost.totalEur, planned.cost.totalEur * 1e-6, 'Kategoriensumme');
  for (const c of planned.cost.categories) {
    const items = c.items.reduce((s, i) => s + i.amountEur, 0);
    near(items, c.amountEur, Math.abs(c.amountEur) * 1e-6 + 1, `Positionen in ${c.key}`);
  }
});

check('die Spanne umschließt den Punktwert', () => {
  const h = planned.headline;
  assert(h.investmentLowEur < h.investmentEur && h.investmentEur < h.investmentHighEur);
  assert(planned.timeline.openingYearLow <= h.openingYear);
  assert(planned.timeline.openingYearHigh >= h.openingYear);
});

check('die Bauphasen sind lückenlos und aufsteigend', () => {
  const p = planned.timeline.phases;
  assert(p.length >= 3, 'zu wenige Phasen');
  for (let i = 0; i < p.length - 1; i++) {
    near(p[i].end, p[i + 1].start, 1e-9, `Lücke zwischen ${p[i].key} und ${p[i + 1].key}`);
  }
});

check('das Szenario verbessert die Erreichbarkeit', () => {
  const d = planned.demand;
  assert(
    d.accessTimeAfterMin <= d.accessTimeBeforeMin + 1e-6,
    `nachher ${d.accessTimeAfterMin} > vorher ${d.accessTimeBeforeMin}`
  );
  assert(d.populationServedAfter >= d.populationServedBefore, 'weniger Menschen erschlossen');
});

check('die Verbindungen zwischen den Stadtteilen werden schneller', () => {
  const c = planned.demand.connectivity;
  assert(c && c.model, 'keine Verbindungsdaten');
  assert(c.model.betaPerMin > 0 && c.model.railShare > 0 && c.model.railShare < 1, 'Wahlmodell unplausibel');
  assert(c.zones.some((z) => z.kind === 'district'), 'keine Stadtteile');
  assert(c.zones.some((z) => z.kind === 'region'), 'kein Umland');
  assert(c.hoursSavedPerDay > 0, `Zeitgewinn ${c.hoursSavedPerDay}`);
  near(planned.demand.hoursSavedPerDay, c.hoursSavedPerDay, 1e-6, 'Zeitgewinn weicht ab');
  assert(c.tripsAfter >= c.tripsBefore, 'weniger Bahnfahrten');
  assert(c.improved.length > 0, 'keine schnellere Verbindung');
  for (const r of c.improved) {
    assert(r.hoursPerDay > 0, `${r.fromName}–${r.toName} ohne Gewinn`);
    if (r.before && r.after) assert(r.after.minutes < r.before.minutes, `${r.fromName}–${r.toName} nicht schneller`);
  }
  for (const z of c.zones) {
    assert(z.meanMinAfter <= 180 + 1e-9 && z.meanMinBefore <= 180 + 1e-9, `${z.name} über 180 min`);
  }
});

check('Nutzen, Fiskaleffekt und Betrieb bleiben getrennt', () => {
  assert(planned.economics.annualBenefitEur > 0);
  assert(planned.fiscal.annualCityEur <= planned.fiscal.annualTotalEur + 1);
  assert(planned.operations.annualResultEur !== planned.economics.annualBenefitEur);
});

// ------------------------------------------------------- tram alternative --

engine.loadTemplate('strassenbahn');
const tram = engine.simulate();
check('die Straßenbahn-Alternative ist deutlich billiger als der U-Bahn-Ausbau', () => {
  assert(
    tram.headline.investmentEur < planned.headline.investmentEur,
    `Straßenbahn ${tram.headline.investmentEur} >= U-Bahn ${planned.headline.investmentEur}`
  );
  assert(tram.headline.openingYear <= planned.headline.openingYear, 'Straßenbahn nicht schneller');
});

// -------------------------------------------------------------- snapping ---

engine.loadTemplate('bestand');
check('Zeigerpositionen rasten auf Bestandsstationen ein', () => {
  const st = engine.renderState().stations.find((s) => s.interchange);
  // 3 m per pixel is roughly zoom 14; the offset below is about 60 m.
  const snap = engine.snapPoint(st.lon + 0.0008, st.lat + 0.0004, undefined, undefined, 'ubahn', 3, false);
  assert(snap.target.kind === 'node', `eingerastet auf ${snap.target.kind}`);
  assert(snap.label.includes(st.name.split(' ')[0]), `Beschriftung war "${snap.label}"`);
  assert(snap.offsetM < 200, `Versatz ${snap.offsetM} m`);
});

check('Einrasten bleibt auch weit herausgezoomt in Reichweite', () => {
  const st = engine.renderState().stations.find((s) => s.interchange);
  // Zoomed far out, one pixel is hundreds of metres — the cursor must still
  // not be dragged across the city.
  const snap = engine.snapPoint(st.lon + 0.02, st.lat, undefined, undefined, 'ubahn', 300, false);
  assert(snap.offsetM < 500, `der Zeiger sprang ${snap.offsetM.toFixed(0)} m weit`);
});

check('Winkel rasten nur nahe an einer Vorzugsrichtung ein', () => {
  const origin = { lon: 9.99, lat: 53.55 };
  // Fast waagerecht: rastet ein.
  const near = engine.snapPoint(10.04, 53.5504, origin.lon, origin.lat, 'ubahn', 3, false);
  assert(near.angleConstrained, 'nahe an 0° sollte einrasten');
  const a = ((near.angleDeg % 360) + 360) % 360;
  assert(Math.min(a, 360 - a) < 1, `Winkel ${a}° liegt nicht auf 0°`);

  // Deutlich dazwischen: bleibt frei.
  const free = engine.snapPoint(10.04, 53.566, origin.lon, origin.lat, 'ubahn', 3, false);
  assert(!free.angleConstrained, 'ein freier Winkel darf nicht gezwungen werden');
});

check('Einrasten auf eine Station meldet den Anschluss', () => {
  const st = engine.renderState().stations.find((s) => s.interchange);
  const snap = engine.snapPoint(st.lon + 0.0002, st.lat, undefined, undefined, 'ubahn', 3, false);
  assert(snap.connects, 'kein Anschluss gemeldet');
  assert(snap.connectsTo.length > 0, 'keine Linien genannt');
  assert(snap.connectsTo.length === snap.connectColors.length, 'Farben fehlen');
});

check('freie Fläche meldet keinen Anschluss', () => {
  const snap = engine.snapPoint(9.6, 53.9, undefined, undefined, 'ubahn', 3, false);
  assert(!snap.connects, 'unerwarteter Anschluss');
});

// ------------------------------------------------------- drawing a line ----

check('gezeichnete Linien bekommen abgerundete Kurven', () => {
  // A hard right angle must come back as an arc, not a corner.
  const diff = engine.apply({
    type: 'drawLine',
    mode: 'ubahn',
    infrastructure: null,
    points: [
      { lat: 53.66, lon: 9.88 },
      { lat: 53.66, lon: 9.96 },
      { lat: 53.72, lon: 9.96 },
    ],
    label: 'U7',
    color: '#0EA5E9',
    autoStations: true,
  });
  const line = engine.renderState().lines.find((l) => l.label === 'U7');
  const geo = line.geo;
  let sharpest = 180;
  for (let i = 1; i < geo.length - 1; i++) {
    const [ax, ay] = [(geo[i - 1][0] - geo[i][0]) * 66000, (geo[i - 1][1] - geo[i][1]) * 111000];
    const [bx, by] = [(geo[i + 1][0] - geo[i][0]) * 66000, (geo[i + 1][1] - geo[i][1]) * 111000];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1 || lb < 1) continue;
    const ang = (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180) / Math.PI;
    sharpest = Math.min(sharpest, ang);
  }
  assert(sharpest > 130, `schärfste Ecke ist ${sharpest.toFixed(0)}°`);
  engine.apply({ type: 'deleteLine', line: line.id });
  assert(diff.linesChanged.length === 1);
});

check('eine gezeichnete Linie erhält automatisch sinnvolle Stationen', () => {
  const corridor = [
    [9.93, 53.6],
    [10.02, 53.62],
  ];
  const preview = engine.previewStations(corridor, 'ubahn');
  assert(preview.length >= 4, `nur ${preview.length} Haltestellen vorgeschlagen`);
  assert(preview.every((p) => p.name && p.name.trim()), 'Vorschlag ohne Namen');
  const names = new Set(preview.map((p) => p.name));
  assert(names.size === preview.length, 'doppelte Stationsnamen');
});

check('die Live-Vorschau beziffert eine Linie vor dem Zeichnen', () => {
  const corridor = [
    [9.93, 53.6],
    [10.02, 53.62],
  ];
  const p = engine.previewLine(corridor, 'ubahn');
  assert(p.valid, 'keine Vorschau');
  assert(p.km > 5, `${p.km} km`);
  assert(p.stations >= 4, `${p.stations} Stationen`);
  assert(p.investmentEur > 1e9, `${p.investmentEur} €`);
  assert(p.openingYear > 2030, `Eröffnung ${p.openingYear}`);
  assert(p.populationReached > 0, 'niemand erreicht');
  // A preview must not change anything.
  const before = engine.renderState().lines.length;
  engine.previewLine(corridor, 'ubahn');
  assert(engine.renderState().lines.length === before, 'die Vorschau hat das Netz verändert');
});

check('jeder gesetzte Punkt wird zur Station', () => {
  const anchors = [
    { lat: 53.6, lon: 9.93 },
    { lat: 53.607, lon: 9.975 },
    { lat: 53.62, lon: 10.02 },
  ];
  const diff = engine.apply({
    type: 'drawLine',
    mode: 'ubahn',
    infrastructure: null,
    points: anchors,
    label: 'U8',
    color: '#7C3AED',
    autoStations: true,
    anchors,
  });
  const line = engine.renderState().lines.find((l) => l.label === 'U8');
  const detail = engine.lineDetail(line.id);
  const coords = detail.stations.map(([id]) => engine.stationDetail(id));
  for (const a of anchors) {
    const near = coords.some(
      (c) => Math.hypot((c.lon - a.lon) * 66000, (c.lat - a.lat) * 111000) < 120
    );
    assert(near, `kein Halt beim gesetzten Punkt ${a.lon},${a.lat}`);
  }
  engine.apply({ type: 'deleteLine', line: line.id });
  assert(diff.linesChanged.length === 1);
});

check('Zeichnen legt Linie, Kanten und Stationen an', () => {
  const before = engine.renderState().lines.length;
  const diff = engine.apply({
    type: 'drawLine',
    mode: 'ubahn',
    infrastructure: null,
    points: [
      { lat: 53.6, lon: 9.93 },
      { lat: 53.62, lon: 10.02 },
    ],
    label: 'U9',
    color: '#7C3AED',
    autoStations: true,
  });
  assert(diff.linesChanged.length === 1, 'keine neue Linie');
  assert(diff.edgesChanged.length >= 3, `nur ${diff.edgesChanged.length} Abschnitte`);
  assert(engine.renderState().lines.length === before + 1);
  const q = engine.quickEstimate();
  assert(q.newKm > 5, `${q.newKm} km neu`);
  assert(q.investmentEur > 1e9, 'Tunnelneubau müsste Milliarden kosten');
  assert(q.openingYear > 2030, 'unplausibles Eröffnungsjahr');
});

let drawnLine;
check('die neue Linie lässt sich abfragen', () => {
  drawnLine = engine.renderState().lines.find((l) => l.label === 'U9');
  assert(drawnLine, 'U9 nicht gefunden');
  const detail = engine.lineDetail(drawnLine.id);
  assert(detail.stations.length === drawnLine.segments.length + 1, 'Laufweg ist nicht durchgehend');
  assert(detail.mode === 'ubahn');
  assert(detail.lengthKm > 5);
});

check('Verlängern hängt Abschnitte an', () => {
  const before = engine.lineDetail(drawnLine.id).stations.length;
  engine.apply({
    type: 'extendLine',
    line: drawnLine.id,
    end: 'finish',
    points: [{ lat: 53.64, lon: 10.08 }],
    autoStations: true,
  });
  const after = engine.lineDetail(drawnLine.id).stations.length;
  assert(after > before, `${before} → ${after} Stationen`);
});

check('Rückgängig und Wiederholen stellen den Zustand her', () => {
  const withExtension = engine.lineDetail(drawnLine.id).stations.length;
  assert(engine.canUndo());
  engine.undo();
  const undone = engine.lineDetail(drawnLine.id).stations.length;
  assert(undone < withExtension, 'Rückgängig hatte keine Wirkung');
  assert(engine.canRedo());
  engine.redo();
  assert(engine.lineDetail(drawnLine.id).stations.length === withExtension, 'Wiederholen stellte nicht her');
});

check('die Historie ist semantisch, nicht geometrisch', () => {
  const { done, undone } = engine.history();
  assert(Array.isArray(done) && Array.isArray(undone), 'Historie hat die falsche Form');
  assert(done.length >= 2, 'zu kurze Historie');
  assert(done.some((e) => e.includes('gezeichnet')), `Historie: ${done.join(', ')}`);
  assert(done.some((e) => e.includes('verlängert')), `Historie: ${done.join(', ')}`);
});

check('zurückgenommene Schritte bleiben als solche sichtbar', () => {
  const before = engine.history().done.length;
  engine.undo();
  const h = engine.history();
  assert(h.done.length === before - 1, `${h.done.length} statt ${before - 1}`);
  assert(h.undone.length >= 1, 'der zurückgenommene Schritt fehlt');
  engine.redo();
  assert(engine.history().done.length === before, 'Wiederholen stellt die Historie nicht her');
});

check('Stationen lassen sich entfernen', () => {
  const anchors = [
    { lat: 53.66, lon: 9.86 },
    { lat: 53.665, lon: 9.9 },
    { lat: 53.67, lon: 9.94 },
  ];
  engine.apply({
    type: 'drawLine',
    mode: 'ubahn',
    infrastructure: null,
    points: anchors,
    label: 'U4x',
    color: '#0EA5E9',
    autoStations: true,
    anchors,
  });
  const line = engine.renderState().lines.find((l) => l.label === 'U4x');
  let detail = engine.lineDetail(line.id);
  const before = detail.stations.length;
  assert(before >= 3, `nur ${before} Stationen`);

  // Ein Zwischenhalt verschwindet, die Linie bleibt durchgehend.
  const middle = detail.stations[1][0];
  engine.apply({ type: 'removeStation', node: middle });
  detail = engine.lineDetail(line.id);
  assert(detail.stations.length === before - 1, `${detail.stations.length} statt ${before - 1}`);
  assert(!detail.stations.some(([id]) => id === middle), 'Halt ist noch da');

  // A terminus can be removed too.
  const terminus = detail.stations[detail.stations.length - 1][0];
  engine.apply({ type: 'removeStation', node: terminus });
  detail = engine.lineDetail(line.id);
  assert(!detail.stations.some(([id]) => id === terminus), 'Endhalt ist noch da');

  engine.apply({ type: 'deleteLine', line: line.id });
});

check('Bestandsstationen lassen sich nicht entfernen', () => {
  const st = engine.renderState().stations.find((s) => s.status === 'in_service');
  let message = null;
  try {
    engine.apply({ type: 'removeStation', node: st.id });
  } catch (e) {
    message = String(e);
  }
  assert(message && /Bestandsnetz/.test(message), `Meldung war: ${message}`);
});

check('eine Station lässt sich in einen Abschnitt einfügen', () => {
  const line = engine.renderState().lines.find((l) => l.included && l.segments.length > 2);
  const seg = line.segments[1];
  const before = engine.lineDetail(line.id).stations.length;
  engine.apply({ type: 'splitEdge', edge: seg.id, alongM: (seg.lengthKm * 1000) / 2, name: 'Prüfhalt' });
  const after = engine.lineDetail(line.id);
  assert(after.stations.length === before + 1, `${after.stations.length} statt ${before + 1}`);
  assert(after.stations.some(([, n]) => n === 'Prüfhalt'), 'Name nicht übernommen');
  engine.undo();
});

check('Löschen entfernt die Linie wieder', () => {
  const before = engine.renderState().lines.length;
  engine.apply({ type: 'deleteLine', line: drawnLine.id });
  assert(engine.renderState().lines.length === before - 1);
});

// -------------------------------------------------------- save and reload --

check('Szenarien überstehen Speichern und Laden unverändert', () => {
  engine.loadTemplate('beschlossen');
  const a = engine.simulate();
  const doc = engine.toDocument('Testentwurf');
  const info = engine.loadDocument(doc);
  assert(info.title === 'Testentwurf');
  assert(info.current, 'Modellversion sollte aktuell sein');
  const b = engine.simulate();
  near(b.headline.investmentEur, a.headline.investmentEur, 1, 'Investition nach Neuladen');
  near(b.headline.networkKm, a.headline.networkKm, 0.001, 'Netzlänge nach Neuladen');
  assert(b.headline.stations === a.headline.stations);
});

check('ein zweiter Speicherlauf ist byte-identisch', () => {
  const one = engine.toDocument('Stabil');
  engine.loadDocument(one);
  const two = engine.toDocument('Stabil');
  assert(one === two, 'Dokument ist nicht reproduzierbar');
});

check('Vergleich liefert eine vollständige Kennzahlentabelle', () => {
  const doc = engine.toDocument('Vergleich');
  const rows = engine.compareWith(doc);
  assert(rows.length >= 10, `nur ${rows.length} Zeilen`);
  assert(rows.every((r) => r.label && r.key), 'Zeile ohne Beschriftung');
  assert(rows.every((r) => r.a === r.b), 'Vergleich mit sich selbst müsste identisch sein');
});

check('Datenherkunft ist auslesbar', () => {
  const v = engine.dataSources();
  assert(v.id === V, `Datenstand ${v.id}`);
  assert(v.sources.length >= 2, 'zu wenige Quellenangaben');
  assert(v.sources.every((s) => s.name && s.licence), 'Quelle ohne Lizenz');
});

// ------------------------------------------------------------ performance --

// Measured on the *heaviest* scenario, not the lightest.
//
// This used to run against the existing network and reported 2 ms, which is
// true and useless: the estimate runs on every pointer move, and the network
// someone is drawing on is whatever they loaded. On the tram scenario the same
// call took 54 ms — three frames — because the feasibility check deduplicated
// its street candidates with a linear scan. A budget checked against the easy
// case is not a budget.
check('eine Schätzung ist schnell genug fürs Zeichnen', () => {
  const heaviest = ['alles', 'strassenbahn', 'beschlossen'].find((id) =>
    JSON.parse(scenarios).some((t) => t.id === id)
  );
  assert(heaviest, 'kein schweres Szenario zum Messen gefunden');
  const probe = new glue.Engine(city, network, scenarios);
  probe.loadTemplate(heaviest);
  for (let i = 0; i < 5; i++) probe.quickEstimate();
  const t = performance.now();
  for (let i = 0; i < 20; i++) probe.quickEstimate();
  const per = (performance.now() - t) / 20;
  // A frame is 16.7 ms and the estimate is not the only thing in it.
  assert(per < 12, `${per.toFixed(1)} ms je Schätzung auf „${heaviest}" ist zu langsam`);
  results.push(`      (${per.toFixed(1)} ms je Schnellschätzung auf „${heaviest}")`);
});

// Startup is the first thing anyone waits for, and it was 640 ms in the browser
// engine — of which 197 ms (about 550 in WebAssembly) was the water mask asking
// `point_in_ring` for every cell of every water body. A scanline fill made it
// 4 ms. This keeps it from creeping back as the data grows.
check('der Rechenkern startet schnell genug', () => {
  assert(bootMs < 250, `${bootMs.toFixed(0)} ms bis zum ersten Rechnen ist zu lang`);
  results.push(`      (${bootMs.toFixed(0)} ms Start, inkl. Datei lesen und Index bauen)`);
});

check('Snapping ist interaktiv schnell', () => {
  const t = performance.now();
  for (let i = 0; i < 200; i++) {
    engine.snapPoint(9.9 + i * 0.0005, 53.55, 9.9, 53.55, 'ubahn', 3, false);
  }
  const per = (performance.now() - t) / 200;
  assert(per < 5, `${per.toFixed(2)} ms je Zeigerbewegung ist zu langsam`);
  results.push(`      (${per.toFixed(2)} ms je Snapping-Aufruf)`);
});

console.log(`Rechenkern gestartet in ${bootMs.toFixed(0)} ms\n`);

// ------------------------------------------------- the "i" popovers are true --

// The explanations exist so that every figure can be traced. That only works
// while the numbers in them match the parameters the engine actually uses —
// and a parameter change is exactly the moment nobody remembers the prose.
{
  const text = await readFile(resolve(ROOT, 'apps/web/src/lib/explanations.ts'), 'utf8');
  const params = JSON.parse(await readFile(resolve(ROOT, `data/dist/params-${V}.json`), 'utf8'));
  const de = (v, digits = 2) =>
    v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const claims = [
    ['Verlagerungsanteil vom Auto', `(${Math.round(params.demand.carSubstitutionShare * 100)} %`],
    ['ersetzte Fahrtlänge', `${de(params.demand.avgReplacedCarTripKm, 1)} km)`],
    ['Zeitwert', `${de(params.economics.valueOfTimeEurH)} € je Stunde`],
    ['CO₂-Preis', `${de(params.economics.co2EurPerKg * 1000, 0)} € je Tonne`],
    ['Stau je Pkw-km', `${de(params.economics.congestionEurPerCarKm, 3)} €`],
    ['Unfälle je Pkw-km', `${de(params.economics.accidentEurPerCarKm, 3)} €`],
    ['Luft und Lärm je Pkw-km', `${de(params.economics.airNoiseEurPerCarKm, 3)} €`],
    ['CO₂ je Pkw-km', `${de(params.economics.co2KgPerCarKm, 3)} kg`],
    ['Diskontsatz', `${de(params.economics.discountRate * 100, 1)} % real`],
    ['Restwert', `${Math.round(params.economics.residualValueShare * 100)} % der Investition`],
    ['Planungsanteil', `${Math.round(params.cost.planningShare * 100)} %`],
    ['Baupreissteigerung', `${Math.round(params.cost.priceEscalationPerYear * 100)} %`],
    ['Umsteigebauwerke', `×${de(params.cost.interchangeStationFactor, 2)}`],
    ['Agglomerationselastizität', `${de(params.economics.agglomerationElasticity, 2)}`],
  ];
  for (const [what, needle] of claims) {
    check(`die Erläuterung nennt den aktuellen Wert: ${what}`, () => {
      assert(text.includes(needle), `„${needle}" steht nicht in explanations.ts`);
    });
  }

  // The model documentation makes the same claims as the popovers do, and goes
  // stale the same way: it described the agglomeration formula as it was
  // *before* the error in it was corrected, and quoted a ridership figure and a
  // calculation version that had both moved on. Prose that explains a model has
  // to be checked against the model.
  const doc = await readFile(resolve(ROOT, 'docs/modell.md'), 'utf8');
  const docClaims = [
    ['Zeitwert', `${de(params.economics.valueOfTimeEurH)} €/h`],
    ['Stau je Pkw-km', `${de(params.economics.congestionEurPerCarKm, 3)} €/km`],
    ['CO₂ je Pkw-km', `${de(params.economics.co2KgPerCarKm, 3)} kg`],
    ['Planungsanteil', `Planung (${Math.round(params.cost.planningShare * 100)} %)`],
    ['Baupreissteigerung', `(${Math.round(params.cost.priceEscalationPerYear * 100)} % p. a.)`],
    ['Genehmigungsüberlappung', `${Math.round(params.timeline.designOverlap * 100)} % parallel`],
    ['Modellversion', `\`calculationVersion\` (derzeit ${params.version})`],
  ];
  for (const [what, needle] of docClaims) {
    check(`docs/modell.md nennt den aktuellen Wert: ${what}`, () => {
      assert(doc.includes(needle), `„${needle}" steht nicht in docs/modell.md`);
    });
  }
  // The README asserts a property of the application; the property has to
  // exist. It did not — the sentence stood there for weeks while nothing in
  // the program ever produced a notice about the coarse regional raster.
  await checkAsync('der Hinweis auf das grobe Umlandraster existiert wirklich', async () => {
    const feas = await readFile(resolve(ROOT, 'rust/core/src/feasibility.rs'), 'utf8');
    assert(
      /im Umland, wo die Daten gröber sind/.test(feas),
      'das README verspricht den Hinweis, der Rechenkern erzeugt ihn nicht'
    );
  });

  check('docs/modell.md beschreibt nicht die alte Agglomerationsformel', () => {
    assert(
      !/Elastizität 0,04 auf zusätzlich erschlossene/.test(doc),
      'die vor dem 2026-09-02 korrigierte Formel steht noch in der Doku'
    );
  });

  // The city-dependent figures are placeholders, so the check above cannot see
  // them. What matters instead is that no city's own figure was left spelled
  // out — that is exactly how Berlin came to be told about Hamburg's subsoil —
  // and that every placeholder still has something to fill it.
  check('keine Stadt steht fest einprogrammiert in den Erläuterungen', () => {
    const spelled = ['Hamburger Schlüssel', 'Hamburger Baugrund', 'Statistikamt Nord', '99 Stadtteile'];
    const found = spelled.filter((t) => text.includes(t));
    assert(!found.length, `fest einprogrammiert: ${found.join(', ')}`);
  });

  // Every field of an explanation is rendered through the same markup pass.
  // The caveat was not, and printed a literal "<b>nicht</b>" in the one line
  // that matters most — the one saying what the number does not cover.
  await checkAsync('jedes Feld der Erläuterungen wird als Markup gerendert', async () => {
    const explain = await readFile(resolve(ROOT, 'apps/web/src/components/Explain.tsx'), 'utf8');
    for (const field of ['info.what', 'info.caveat', 'info.source']) {
      assert(
        explain.includes(`markup(${field})`),
        `${field} wird roh ausgegeben statt durch markup()`
      );
    }
  });

  const FILLERS = ['Stadt', 'stadtAdj', 'ustSchluessel', 'baugrund', 'einwohnerzahlen',
    'stadtteilzahl', 'stadtteile', 'gebaeude', 'quelle'];
  check('jeder Platzhalter in den Erläuterungen ist auch belegt', () => {
    // Only the explanation table itself; below it sits the code that does the
    // filling in, whose own template literals are not placeholders.
    const table = text.split('// ------------------------------------------------------- filling in the city --')[0];
    const used = new Set([...table.matchAll(/\{([A-Za-zÄÖÜäöü]+)\}/g)].map((m) => m[1]));
    const orphan = [...used].filter((k) => !FILLERS.includes(k));
    assert(!orphan.length, `ohne Füllung: ${orphan.join(', ')}`);
  });

  // And each city's parameter file actually carries its own values, rather
  // than inheriting the default city's.
  const cities = JSON.parse(await readFile(resolve(ROOT, 'apps/web/public/data/manifest.json'), 'utf8'));
  const seen = { vat: new Set(), ground: new Set() };
  for (const id of Object.keys(cities.cities)) {
    const file = id === 'hamburg' ? `params-${V}.json` : `${id}/params-${V}.json`;
    const cp = JSON.parse(await readFile(resolve(ROOT, `data/dist/${file}`), 'utf8'));
    check(`${id}: Parameter auf dem aktuellen Stand`, () => {
      assert(cp.version === params.version, `${cp.version} statt ${params.version}`);
    });
    seen.vat.add(cp.fiscal.vatCityShare);
    seen.ground.add(cp.cost.groundConditionsFactor);
  }
  check('die Städte tragen eigene Stadtparameter', () => {
    assert(seen.vat.size > 1, 'alle Städte haben denselben Umsatzsteuerschlüssel');
    assert(seen.ground.size > 1, 'alle Städte haben denselben Baugrundfaktor');
  });

  // The second thing the map showed: the U5 broken between City Nord and
  // Sengelmannstraße. A line whose edges do not share endpoints draws as
  // disconnected pieces, so this checks every line in every city rather than
  // the one segment that was reported.
  for (const [cityId, file] of [
    ['hamburg', `network-${V}.json`],
    ['berlin', `berlin/network-${V}.json`],
  ]) {
    const net = JSON.parse(await readFile(resolve(ROOT, `data/dist/${file}`), 'utf8'));
    check(`${cityId}: jede Linie ist eine durchgehende Kette`, () => {
      const nameOf = (id) => net.nodes[id]?.name ?? `#${id}`;
      const broken = [];
      for (const line of Object.values(net.lines)) {
        const eds = line.edges.map((i) => net.edges[i]).filter(Boolean);
        assert(eds.length === line.edges.length, `${line.label}: Kante fehlt im Netz`);
        for (let i = 1; i < eds.length; i++) {
          const prev = [eds[i - 1].from, eds[i - 1].to];
          const cur = [eds[i].from, eds[i].to];
          if (!prev.some((x) => cur.includes(x))) {
            broken.push(`${line.label}: ${nameOf(prev[1])} ✕ ${nameOf(cur[0])}`);
          }
        }
      }
      assert(!broken.length, `${broken.length} Brüche: ${broken.slice(0, 3).join('; ')}`);
      assert(Object.keys(net.lines).length > 10, 'zu wenige Linien — prüft das etwas?');
    });
  }

  // The bug the map showed: a shoreline that jumps across the water and takes
  // the land behind it with it. Simplification caused it, rounding the output
  // to five decimals afterwards could re-create it, and the build's area check
  // never saw either — a ring that crosses itself loses on one side of the knot
  // what it gains on the other. This checks the data that actually ships.
  for (const [cityId, file] of [
    ['hamburg', `city-${V}.json`],
    ['berlin', `berlin/city-${V}.json`],
  ]) {
    const data = JSON.parse(await readFile(resolve(ROOT, `data/dist/${file}`), 'utf8'));
    check(`${cityId}: kein Gewässerumriss überschneidet sich selbst`, () => {
      setOrigin(data.projectionOrigin?.lon ?? 9.99, data.projectionOrigin?.lat ?? 53.55);
      const broken = data.water
        .filter((w) => Array.isArray(w.ring) && w.ring.length > 4)
        .filter((w) => ringSelfIntersects(w.ring.map((p) => [p.lon, p.lat])))
        .map((w) => w.name || '(ohne Namen)');
      assert(!broken.length, `${broken.length} Umrisse: ${broken.slice(0, 4).join(', ')}`);
      assert(data.water.length > 100, `nur ${data.water.length} Gewässer — prüft das überhaupt etwas?`);
    });
  }

  // The NKV explanation anchors the scale on the decided projects, because a
  // model reading 0.30 where the published appraisal reads above 1.0 is
  // otherwise just confusing. A figure quoted in prose goes stale in silence,
  // so the prose has to agree with the engine.
  check('der Bezugswert im NKV-Text stimmt mit dem Modell überein', () => {
    const quoted = readFileSync(resolve(ROOT, 'apps/web/src/lib/explanations.ts'), 'utf8')
      .match(/S4, U4 und U5 zusammen,? kommen in diesem Modell auf rund (\d,\d\d)/);
    assert(quoted, 'der Bezugswert steht nicht mehr im Text');
    engine.loadTemplate('beschlossen');
    const actual = engine.simulate().headline.benefitCostRatio;
    const shown = Number(quoted[1].replace(',', '.'));
    assert(
      Math.abs(actual - shown) < 0.02,
      `Text nennt ${quoted[1]}, das Modell rechnet ${actual.toFixed(3)}`
    );
  });
}

console.log(results.join('\n'));
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
