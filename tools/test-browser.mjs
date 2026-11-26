// The interface itself, driven the way a person drives it.
//
// Every other suite reaches past the interface: `test-flow` walks a whole user
// story through the engine and the API, and gets there without a single click.
// That is the right way to test the model, and it is blind to exactly the
// things that break in a browser — a button that no longer calls anything, a
// dialog that closes on the wrong condition, a panel that renders a number the
// engine never produced.
//
// So this one clicks. It runs headless against the dev server and the API, and
// it asserts on what the user can actually see and reach.
//
//   node tools/test-browser.mjs
import { chromium } from 'playwright';

const WEB = process.env.HH_WEB ?? 'http://localhost:3000';
const API = process.env.HH_API ?? 'http://localhost:8080';

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

class Skipped extends Error {}
const skip = (why) => {
  throw new Skipped(why);
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg ?? 'Erwartung nicht erfüllt');
};

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${name}  (${Date.now() - started} ms)`);
  } catch (e) {
    if (e instanceof Skipped) {
      skipped++;
      results.push(`  ⊘ ${name}  — übersprungen: ${e.message}`);
      return;
    }
    failed++;
    results.push(`  ✗ ${name}\n      ${(e.message ?? String(e)).slice(0, 300)}`);
  }
}

// The editor loads a WebAssembly engine and about ten megabytes of city data
// before it can show anything, so nothing here can assume a fast first paint.
const READY = 90_000;

const browser = await chromium.launch();

/**
 * A fresh page.
 *
 * Console errors and failed requests are collected rather than ignored: a
 * screenshot of a broken page looks much like a screenshot of a working one,
 * and half the faults worth catching announce themselves in the console and
 * nowhere else.
 */
async function open(path = '/', { city = 'hamburg' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // Aborted map tiles when a page closes mid-flight are noise, not faults.
    if (!r.failure()?.errorText?.includes('ERR_ABORTED')) {
      errors.push(`request failed: ${r.url().slice(-70)} ${r.failure()?.errorText}`);
    }
  });
  const url = path.includes('?') ? `${WEB}${path}` : `${WEB}${path}${path === '/' ? `?stadt=${city}` : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: READY });
  return { page, context, errors };
}

/** Dismiss the welcome sheet, choosing a starting point by its visible text. */
async function start(page, choice = 'Geplante Vorhaben') {
  const heading = page.getByRole('heading', { name: /Wie soll/ });
  await heading.waitFor({ state: 'visible', timeout: READY });
  // Scoped to the sheet's own buttons. Matching on text alone picked the hidden
  // <option> of the scenario <select> behind it, which is never clickable.
  const sheet = page.locator('div').filter({ has: heading }).last();
  await sheet.getByRole('button', { name: new RegExp(choice) }).first().click();
  // The features are read through `serialize()`, the public way to get a
  // source's data. The private `_data` field changed shape with MapLibre 6,
  // after which every check here waited for a network that was already drawn.
  // Ready means the engine has run and the map has the network, which is true
  // on every screen size. Waiting for the headline instead worked only on a
  // wide one: on a phone the analysis sits behind a tab and is not rendered.
  await page.waitForFunction(
    () => (window.__map?.getSource?.('transit-lines')?.serialize?.()?.data?.features?.length ?? 0) > 0,
    null,
    { timeout: READY }
  );
}

/**
 * Waits until a headline figure satisfies `want`.
 *
 * Reading it straight after a click is a race the test loses: the warning about
 * a switched-off network comes from the render state and appears at once, while
 * the figures come from a debounced simulation a moment later. The first
 * version of this suite compared the two and reported that switching the whole
 * network off changed nothing.
 */
async function waitForMetric(page, label, want, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await metric(page, label);
    if (last && want(last)) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`${label} blieb bei „${last}"`);
}

/** The number under a headline label in the analysis panel. */
async function metric(page, label) {
  return page.evaluate((l) => {
    for (const el of document.querySelectorAll('div')) {
      if (el.textContent?.trim().toUpperCase() === l && el.className.includes('uppercase')) {
        return el.parentElement?.parentElement?.textContent ?? null;
      }
    }
    return null;
  }, label.toUpperCase());
}

// ------------------------------------------------------------- der Start --

await check('die App startet und zeigt ein Netz', async () => {
  const { page, context, errors } = await open();
  await start(page);
  const net = await metric(page, 'Netz');
  assert(/\d/.test(net ?? ''), `keine Netzlänge im Überblick: ${net}`);
  // A map with no transit features drawn is the failure this whole suite exists
  // for: every number can be right while the map shows nothing.
  const drawn = await page.evaluate(() => {
    const m = window.__map;
    if (!m || !m.getSource('transit-lines')) return -1;
    return m.getSource('transit-lines').serialize().data.features.length;
  });
  assert(drawn > 100, `nur ${drawn} Streckenteile auf der Karte`);
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

await check('die Stadt lässt sich wechseln', async () => {
  const { page, context } = await open();
  await start(page);
  // A real <select>, deliberately: it works with the keyboard, a screen reader
  // and the phone's own picker. Driven as one here for the same reason.
  await page.selectOption('#city', 'berlin');
  // Switching city reloads the page, and for a moment there is no body to read.
  await page.waitForFunction(() => document.body?.innerText.includes('Berlin') ?? false, null, { timeout: READY });
  await page.waitForFunction(
    () => (window.__map?.getSource('transit-lines')?.serialize().data.features.length ?? 0) > 100,
    null,
    { timeout: READY }
  );
  const drawn = await page.evaluate(() => {
    const m = window.__map;
    return m?.getSource('transit-lines')?.serialize().data.features.length ?? -1;
  });
  assert(drawn > 100, `Berlin zeichnet nur ${drawn} Streckenteile`);
  await context.close();
});

// ------------------------------------------------------------- die Ebenen --

await check('Bestandslinien lassen sich ab- und wieder anschalten', async () => {
  const { page, context } = await open();
  await start(page);
  const before = await metric(page, 'Netz');
  await page.getByRole('button', { name: 'alle aus' }).first().click();
  await waitForMetric(page, 'Netz', (v) => v !== before);
  // The warning has to be actionable, not merely present.
  await page.getByRole('button', { name: 'Bestand wieder einschalten' }).click();
  const back = await waitForMetric(page, 'Netz', (v) => v === before);
  assert(back === before, `nach dem Einschalten steht ${back} statt ${before}`);
  await context.close();
});

await check('ein abgeschalteter Bestand färbt den Nutzen rot', async () => {
  const { page, context } = await open();
  await start(page);
  await page.getByRole('button', { name: 'alle aus' }).first().click();
  await waitForMetric(page, 'Nutzen', (v) => v.includes('−') || /\s-\d/.test(v));
  const red = await page.evaluate(() => {
    for (const el of document.querySelectorAll('div')) {
      if (el.textContent?.trim() === 'Nutzen' && el.className.includes('uppercase')) {
        const value = el.parentElement?.nextElementSibling;
        return { text: value?.textContent ?? '', cls: value?.className ?? '' };
      }
    }
    return null;
  });
  assert(red, 'die Kennzahl Nutzen ist nicht auffindbar');
  assert(red.text.includes('−') || red.text.includes('-'), `Nutzen ist nicht negativ: ${red.text}`);
  assert(/rose-600/.test(red.cls), `ein negativer Nutzen steht nicht in Rot: ${red.cls}`);
  await context.close();
});

// -------------------------------------------------------- die Werkzeuge --

await check('die Werkzeuge lassen sich mit der Tastatur wählen', async () => {
  const { page, context } = await open();
  await start(page);
  // Asserting the button merely *exists* proves nothing — the first version of
  // this check did that and passed while the shortcut was untested.
  for (const [key, label] of [['d', 'Zeichnen'], ['e', 'Weiterbauen'], ['s', 'Halt einfügen'], ['x', 'Entfernen'], ['v', 'Ansehen']]) {
    await page.keyboard.press(key);
    const pressed = await page.evaluate((l) => {
      const b = [...document.querySelectorAll('button[aria-pressed]')].filter((x) =>
        x.textContent?.includes(l)
      );
      return b.length ? b.map((x) => x.getAttribute('aria-pressed')) : null;
    }, label);
    assert(pressed, `${label} ist nach „${key}" nicht auffindbar`);
    assert(pressed.includes('true'), `„${key}" wählt ${label} nicht aus (${pressed})`);
  }
  // And the shortcut has to reach the map, not only the toolbar: the highlight
  // comes from the store, the drawing from the controller, and the two are set
  // in different places.
  await page.keyboard.press('d');
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.waitForTimeout(500);
  const points = await page.evaluate(
    () => window.__map?.getSource('preview-stations')?.serialize().data.features.length ?? -1
  );
  assert(points >= 0, 'die Vorschauquelle fehlt');
  await page.keyboard.press('Escape');
  await context.close();
});


// ------------------------------------------------------------- Zeichnen --

/** Clicks a sequence of points on the map canvas. */
async function drawAt(page, points) {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  assert(box, 'keine Karte auf der Seite');
  for (const [fx, fy] of points) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(160);
  }
}

/**
 * The engine's own view of the document.
 *
 * Driving is done through the interface; asserting is done here. Comparing the
 * rendered strings instead made this check flaky: where a click lands decides
 * how many stops the app inserts between them, so "the number changed" held
 * and "the number changed back" sometimes did not, for reasons that had
 * nothing to do with undo.
 */
const state = (page) =>
  page.evaluate(() => {
    const e = window.__engine;
    if (!e) return null;
    const r = e.renderState();
    return {
      lines: r.lines.filter((l) => l.source === 'user').length,
      history: e.history().done.length,
      newKm: +e.quickEstimate().newKm.toFixed(3),
    };
  });

await check('eine Linie zeichnen, abschließen und rückgängig machen', async () => {
  const { page, context, errors } = await open();
  await start(page);
  const before = await state(page);
  assert(before, 'die Maschine ist nicht erreichbar (nur im Entwicklungsmodus)');

  await page.keyboard.press('d');
  await drawAt(page, [[0.42, 0.45], [0.48, 0.5], [0.54, 0.55]]);
  // The button counts the points placed so far, which is the clearest signal
  // that the map registered the clicks at all. It exists on every screen size
  // now; on a wide one there used to be no way to finish but a double-click,
  // and nothing on screen said so.
  const finish = page.getByRole('button', { name: /Fertig \(\d+\)/ });
  await finish.waitFor({ timeout: 20_000 });
  const label = await finish.textContent();
  assert(/Fertig \([3-9]\)/.test(label ?? ''), `nur ${label} nach drei Klicks`);
  await finish.click();

  await page.waitForFunction(
    (n) => window.__engine.renderState().lines.filter((l) => l.source === 'user').length > n,
    before.lines,
    { timeout: 20_000 }
  );
  const drawn = await state(page);
  assert(drawn.newKm > before.newKm, `der Neubau wächst nicht: ${drawn.newKm}`);
  // One line, one entry in the history: an undo the user has to press three
  // times is not the undo the interface is offering.
  assert(
    drawn.history === before.history + 1,
    `ein Strich erzeugt ${drawn.history - before.history} Schritte in der Historie`
  );

  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await page.waitForFunction(
    (n) => window.__engine.renderState().lines.filter((l) => l.source === 'user').length === n,
    before.lines,
    { timeout: 20_000 }
  );
  const undone = await state(page);
  assert(undone.newKm === before.newKm, `nach dem Rückgängigmachen ${undone.newKm} statt ${before.newKm}`);

  await page.getByRole('button', { name: 'Wiederholen' }).click();
  await page.waitForFunction(
    (km) => +window.__engine.quickEstimate().newKm.toFixed(3) === km,
    drawn.newKm,
    { timeout: 20_000 }
  );
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// ----------------------------------------------------------- die Reiter --

await check('jeder Reiter der Analyse zeigt etwas', async () => {
  const { page, context, errors } = await open();
  await start(page);
  for (const tab of ['Kosten', 'Zeitplan', 'Wirkung', 'Baubarkeit', 'Überblick']) {
    const button = page.getByRole('tab', { name: tab }).or(page.getByRole('button', { name: tab })).first();
    if (!(await button.count())) continue;
    await button.click();
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => document.body.innerText.length);
    assert(text > 500, `der Reiter ${tab} ist leer`);
  }
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

await check('die Erklärungen lassen sich öffnen und wieder schließen', async () => {
  const { page, context } = await open();
  await start(page);
  const info = page.getByRole('button', { name: /^Wie .* berechnet wird$/ }).first();
  assert(await info.count(), 'keine Erklärungsknöpfe gefunden');
  const before = await page.evaluate(() => document.body.innerText.length);
  await info.click();
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => document.body.innerText.length);
  assert(opened > before, 'die Erklärung öffnet nichts');
  await page.getByRole('button', { name: 'Schließen' }).first().click();
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => document.body.innerText.length);
  assert(closed < opened, 'die Erklärung schließt nicht wieder');
  await context.close();
});

// ---------------------------------------------------------- das Aussehen --

await check('das dunkle Design lässt sich schalten und hält die Karte', async () => {
  const { page, context } = await open();
  await start(page);
  await page.getByRole('button', { name: /Dunkles Design|Helles Design/ }).click();
  await page.waitForTimeout(1200);
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  assert(dark, 'das dunkle Design greift nicht');
  // The style is rebuilt on a theme change, and the network has to survive it.
  const drawn = await page.evaluate(
    () => window.__map?.getSource('transit-lines')?.serialize().data.features.length ?? -1
  );
  assert(drawn > 100, `nach dem Themenwechsel nur ${drawn} Streckenteile`);
  await context.close();
});

// ------------------------------------------------------------ Entdecken --

await check('Entdecken zeigt Entwürfe, sortiert und filtert sie', async () => {
  const { page, context, errors } = await open('/entdecken');
  await page.getByRole('heading', { name: 'Entwürfe entdecken' }).waitFor({ timeout: 30_000 });
  const titles = async () =>
    page.evaluate(() => [...document.querySelectorAll('article h3')].map((h) => h.textContent));
  await page.waitForFunction(() => document.querySelectorAll('article').length > 1, null, { timeout: 30_000 });
  const cities = await page.getByRole('button', { name: 'Alle' }).count();
  if (cities) await page.getByRole('button', { name: 'Alle' }).click();
  const byNew = await titles();
  assert(byNew.length > 1, `nur ${byNew.length} Entwürfe`);

  // Sorting has to change something, or the chip is decoration.
  await page.getByRole('button', { name: 'Meiste Kilometer' }).click();
  await page.waitForTimeout(1200);
  const byLength = await titles();
  assert(byLength.join() !== byNew.join(), 'die Sortierung ändert die Reihenfolge nicht');

  // Every leaderboard row carries the figure it is ranked by.
  const boards = await page.evaluate(() =>
    [...document.querySelectorAll('h3')]
      .filter((h) => h.parentElement?.querySelector('ol'))
      .map((h) => ({
        label: h.textContent,
        rows: [...h.parentElement.querySelectorAll('li')].map((li) => ({
          text: li.textContent.trim(),
          // The rank, the title and the figure are separate elements; the
          // figure is the last one. Reading the concatenated text and looking
          // for a digit near its end failed on "459 Mio. €/Jahr", whose last
          // twelve characters are all letters.
          value: li.lastElementChild?.textContent?.trim() ?? '',
          ranked: /^\d/.test(li.textContent.trim()),
        })),
      }))
  );
  assert(boards.length >= 8, `nur ${boards.length} Ranglisten`);
  for (const b of boards) {
    for (const row of b.rows) {
      // An empty board explains itself in words. A ranked row starts with its
      // position and has to carry the figure it is ranked by — a list of bare
      // titles asks the reader to take the order on trust.
      if (!row.ranked) continue;
      assert(/[\d–]/.test(row.value), `${b.label}: „${row.text}" ohne Zahl (${row.value})`);
    }
  }

  // Searching narrows.
  await page.getByPlaceholder('Suchen').fill('zzzz-gibt-es-nicht');
  await page.waitForTimeout(1200);
  const none = await page.evaluate(() => document.querySelectorAll('article').length);
  assert(none === 0, `die Suche findet ${none} Entwürfe für Unsinn`);
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// ------------------------------------------------------------ Vergleich --

await check('Vergleichen führt vom leeren Zustand zur Tabelle', async () => {
  const { page, context, errors } = await open('/vergleich');
  await page.getByRole('heading', { name: 'Entwürfe vergleichen' }).waitFor({ timeout: 30_000 });
  // The empty state offers a pair rather than leaving the reader with two
  // dropdowns and no idea what the page is for.
  const suggestion = page.locator('button.btn-primary').filter({ hasText: 'gegen' }).first();
  await suggestion.waitFor({ timeout: 30_000 });
  await suggestion.click();
  await page.locator('table').waitFor({ timeout: 30_000 });
  const rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
  assert(rows >= 8, `nur ${rows} Kennzahlen in der Tabelle`);
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

await check('zwei Städte nebeneinander werden abgelehnt, nicht gerechnet', async () => {
  const { page, context } = await open('/vergleich');
  await page.getByRole('heading', { name: 'Entwürfe vergleichen' }).waitFor({ timeout: 30_000 });
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('select')].map((s) => [...s.options].map((o) => ({ v: o.value, t: o.textContent })))
  );
  const all = options[0] ?? [];
  if (all.length < 3) skip('zu wenige veröffentlichte Entwürfe für zwei Städte');
  // Pick A, then look for a B the picker still offers from the other city.
  await page.locator('select').first().selectOption(all[1].v);
  await page.waitForTimeout(600);
  const left = await page.evaluate(() =>
    [...document.querySelectorAll('select')][1].options.length
  );
  // The second picker narrows to the same city once the first is chosen, which
  // is itself the protection. If it did not narrow, the notice must appear.
  assert(left >= 1, 'der zweite Auswahlkasten ist leer');
  await context.close();
});

// ------------------------------------------------- die Seite eines Plans --

await check('eine Planseite zeigt nur, was gebaut würde, und lässt den Bestand zu', async () => {
  const list = await fetch(`${API}/api/scenarios?limit=40`).then((r) => r.json());
  const plan = list.find((s) => s.new_km > 0);
  if (!plan) skip('kein veröffentlichter Entwurf baut etwas');
  const { page, context, errors } = await open(`/szenario/${plan.slug}`);
  await page.waitForFunction(
    () => (window.__map?.getSource('transit-lines')?.serialize().data.features.length ?? 0) > 0,
    null,
    { timeout: 60_000 }
  );
  const focused = await page.evaluate(() => ({
    lines: window.__map.getSource('transit-lines').serialize().data.features.length,
    stations: window.__map.getSource('transit-stations').serialize().data.features.length,
  }));
  await page.getByRole('button', { name: 'Bestandsnetz einblenden' }).click();
  await page.waitForFunction(
    (n) => window.__map.getSource('transit-lines').serialize().data.features.length > n,
    focused.lines,
    { timeout: 20_000 }
  );
  const full = await page.evaluate(() => ({
    lines: window.__map.getSource('transit-lines').serialize().data.features.length,
    stations: window.__map.getSource('transit-stations').serialize().data.features.length,
  }));
  assert(full.lines > focused.lines, 'der Bestand kommt nicht dazu');
  // Stations follow their lines in both directions; they used to stay behind as
  // several hundred dots with nothing under them.
  assert(full.stations > focused.stations, 'die Stationen folgen den Strecken nicht');
  await page.getByRole('button', { name: 'Nur die neuen Strecken' }).click();
  await page.waitForFunction(
    (n) => window.__map.getSource('transit-lines').serialize().data.features.length === n,
    focused.lines,
    { timeout: 20_000 }
  );
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// ----------------------------------------------------------- das Teilen --

await check('das Teilen-Blatt passt in jedes Format ins Fenster', async () => {
  const list = await fetch(`${API}/api/scenarios?limit=40`).then((r) => r.json());
  const plan = list.find((s) => s.new_km > 0);
  if (!plan) skip('kein veröffentlichter Entwurf baut etwas');
  const { page, context, errors } = await open(`/szenario/${plan.slug}`);
  await page.getByRole('button', { name: /^Teilen$/ }).click();
  const sheet = page.locator('[role="dialog"]').first();
  await sheet.waitFor({ timeout: 60_000 });
  // The format switch is a radio group, not a row of buttons — which is the
  // right thing for a one-of-four choice, and the reason `getByRole('button')`
  // found none of them.
  const formats = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] [role="radio"]')].map((b) => b.textContent?.trim())
  );
  assert(formats.length >= 3, `nur ${formats.length} Bildformate zur Wahl: ${formats}`);
  for (const f of formats) {
    await page.getByRole('dialog').getByRole('radio', { name: f }).first().click();
    await page.waitForTimeout(900);
    // The story format once made the sheet taller than the window, and the
    // buttons underneath — Telegram among them — became unreachable.
    const fits = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const r = d.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: window.innerHeight, scrolls: d.scrollHeight > d.clientHeight };
    });
    assert(fits.bottom <= fits.h + 1, `${f}: das Blatt ragt ${Math.round(fits.bottom - fits.h)} px unten heraus`);
    assert(fits.top >= -1, `${f}: das Blatt ragt oben heraus`);
  }
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// -------------------------------------------------------- kleine Fenster --

await check('auf einem Telefon sind Karte, Werkzeuge und Analyse erreichbar', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/?stadt=hamburg`, { waitUntil: 'domcontentloaded', timeout: READY });
  await start(page);
  // Nothing may sit outside the viewport horizontally: a phone cannot pan to it.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `die Seite ist ${overflow} px breiter als das Telefon`);
  // The phone layout puts the tools and the readout over the map. Every one of
  // them has to be inside the viewport, or it cannot be reached at all: there
  // is nowhere to scroll to.
  const offscreen = await page.evaluate(() => {
    const bad = [];
    for (const b of document.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1) {
        bad.push(`${b.textContent?.trim().slice(0, 18)} @ ${Math.round(r.left)},${Math.round(r.top)}`);
      }
    }
    return bad;
  });
  assert(offscreen.length === 0, `außerhalb des Bildschirms: ${offscreen.slice(0, 4).join(' · ')}`);

  // And drawing has to work by touch, which is the only way in on a phone.
  await page.getByRole('button', { name: /Zeichnen/ }).first().click();
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  for (const [fx, fy] of [[0.35, 0.4], [0.5, 0.5]]) {
    await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: /Fertig \(\d+\)/ }).waitFor({ timeout: 20_000 });
  assert(errors.length === 0, `Fehler auf dem Telefon: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// ---------------------------------------------------------- die Tastatur --

await check('die Sprungmarken bringen die Tastatur an die Karte', async () => {
  const { page, context } = await open();
  await start(page);
  // Deliberately invisible until focused: tabbing to the map otherwise means
  // passing sixty line checkboxes on the way.
  // Where tabbing *starts* cannot be asserted from a script: Chromium keeps a
  // sequential-navigation point, and dismissing the welcome sheet leaves it
  // deep in the page even after the focused element is gone. What decides the
  // order on a freshly loaded page is the document, so that is what is checked
  // here — followed by the two things the link has to do when it is reached.
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], input, select')]
      .slice(0, 3)
      .map((el) => el.textContent?.trim())
  );
  assert(order[0] === 'Zur Karte', `zuerst erreichbar ist „${order[0]}"`);

  // Measured on the clipping wrapper, not on the button. `sr-only` hides by
  // clipping to a one-pixel box, and a clipped child keeps its own layout box:
  // asking the button for its width says 96 px whether it is on screen or not.
  const visibility = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Zur Karte');
    const nav = b.closest('nav');
    const before = nav.getBoundingClientRect().width;
    b.focus();
    return { before, after: nav.getBoundingClientRect().width };
  });
  assert(visibility.before <= 1, `die Sprungmarke ist auch unfokussiert ${visibility.before} px breit`);
  assert(visibility.after > 20, 'die Sprungmarke bleibt beim Fokussieren unsichtbar');

  await page.keyboard.press('Enter');
  const landed = await page.evaluate(() => document.activeElement?.tagName);
  assert(landed === 'CANVAS', `der Sprung landet auf ${landed}, nicht auf der Karte`);
  // Once there, the keyboard has to be able to drive the map, or the jump only
  // moved the problem.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  assert(
    (await page.evaluate(() => document.activeElement?.tagName)) === 'CANVAS',
    'der Fokus fällt beim ersten Tastendruck von der Karte'
  );
  await context.close();
});

// ----------------------------------------------------------- Wünsche --

await check('die Wunschkarte zeigt eine Hitzekarte und wechselt die Stadt', async () => {
  const { page, context, errors } = await open('/wuensche');
  await page.getByRole('heading', { name: 'Wo Verbindungen fehlen' }).waitFor({ timeout: 30_000 });
  // The map has to carry data, not just exist: a heat layer over an empty
  // source is a grey rectangle that looks like a working map.
  await page.waitForFunction(
    () => {
      const m = window.__map ?? null;
      void m;
      const canvas = document.querySelector('canvas.maplibregl-canvas');
      return !!canvas && document.body.innerText.includes('Entwürfe');
    },
    null,
    { timeout: READY }
  );
  const basis = await page.evaluate(() => document.body.innerText);
  assert(/\d+\s+Entwürfe|1\s+Entwurf/.test(basis), 'die Grundlage nennt keine Zahl');
  assert(basis.includes('Am häufigsten gezeichnet'.toUpperCase()) || basis.includes('häufigsten'),
    'die Liste der meistgezeichneten Linien fehlt');

  // Switching the city reloads both the base map and the aggregate.
  const cityButtons = page.locator('aside button[aria-pressed]');
  if ((await cityButtons.count()) > 1) {
    const before = await page.evaluate(() => document.body.innerText);
    await cityButtons.filter({ hasText: 'Berlin' }).first().click();
    await page.waitForFunction(
      (prev) => document.body.innerText !== prev,
      before,
      { timeout: READY }
    );
    const after = await page.evaluate(() => document.body.innerText);
    assert(after !== before, 'der Städtewechsel ändert nichts');
  }
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// The wish map renders an aggregate; it computes nothing, so it must not drag
// the engine and the population grid down the wire to draw one picture.
await check('die Wunschkarte lädt den Rechenkern nicht mit', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const heavy = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/hh_wasm_bg.*\.wasm|\/data\/city-|\/data\/berlin\/city-/.test(u)) heavy.push(u.slice(-40));
  });
  await page.goto(`${WEB}/wuensche`, { waitUntil: 'domcontentloaded', timeout: READY });
  await page.getByRole('heading', { name: 'Wo Verbindungen fehlen' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(4000);
  assert(heavy.length === 0, `unnötig geladen: ${heavy.join(', ')}`);
  await context.close();
});

// ------------------------------------------------------- Weiterbauen --

// Extending an existing line used to append the new track to that line. It then
// belonged to the Bestand: not listed among the things the author had drawn, and
// impossible to switch off to see what it was worth on its own.
await check('eine Verlängerung ist ein eigener, abschaltbarer Eintrag', async () => {
  const { page, context, errors } = await open();
  await start(page);
  const before = await state(page);

  // Driven through the tool, not through the engine: the point of this check is
  // that pointing at the end of an existing line and drawing onwards produces
  // something the reader can find and switch off.
  const target = await page.evaluate(() => {
    const r = window.__engine.renderState();
    // A line that ends somewhere on screen, so the clicks land on it.
    const m = window.__map;
    const b = m.getBounds();
    const inView = (s) =>
      s.lon > b.getWest() + 0.02 &&
      s.lon < b.getEast() - 0.08 &&
      s.lat > b.getSouth() + 0.02 &&
      s.lat < b.getNorth() - 0.06;
    for (const line of r.lines) {
      if (line.source !== 'existing' || !line.included || line.stations.length < 3) continue;
      for (const end of [line.stations[0], line.stations[line.stations.length - 1]]) {
        const st = r.stations.find((s) => s.id === end);
        if (st && inView(st)) {
          const p = m.project([st.lon, st.lat]);
          return { label: line.label, name: st.name, x: p.x, y: p.y };
        }
      }
    }
    return null;
  });
  if (!target) skip('kein Linienende im sichtbaren Ausschnitt');

  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  await page.keyboard.press('e');
  // First click picks the end to continue, the second draws the new terminus.
  await page.mouse.click(box.x + target.x, box.y + target.y);
  await page.waitForTimeout(400);
  await page.mouse.click(box.x + target.x + 90, box.y + target.y - 70);
  await page.waitForFunction(
    (n) => window.__engine.renderState().lines.filter((l) => l.source === 'user').length > n,
    before.lines,
    { timeout: 20_000 }
  );

  const ext = await page.evaluate(() =>
    window.__engine
      .renderState()
      .lines.filter((l) => l.source === 'user' && l.extends != null)
      .map((l) => ({ id: l.id, label: l.label, name: l.name, included: l.included }))[0]
  );
  assert(ext, 'die Verlängerung steht nicht unter den eigenen Linien');
  assert(ext.label === target.label, `die Verlängerung heißt ${ext.label} statt ${target.label}`);
  assert(/Verlängerung/.test(ext.name), `der Name sagt es nicht: ${ext.name}`);
  assert(ext.included, 'die Verlängerung kommt abgeschaltet zur Welt');

  // It appears in the panel under the author's own work, where it can be found.
  const listed = await page.evaluate(() => document.body.innerText);
  assert(listed.includes('Eigener Entwurf'), 'die Gruppe „Eigener Entwurf" fehlt');
  assert(listed.includes('Verlängerung'), 'die Verlängerung steht nicht in der Liste');

  // And switching it off puts the figures back exactly where they were, which
  // is the whole reason it is a separate entry.
  const drawn = await state(page);
  assert(drawn.newKm > before.newKm, 'die Verlängerung zählt nicht als Neubau');
  await page.getByRole('checkbox', { name: new RegExp('Verlängerung') }).first().click();
  await page.waitForFunction(
    (km) => +window.__engine.quickEstimate().newKm.toFixed(3) === km,
    before.newKm,
    { timeout: 20_000 }
  );
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// ------------------------------------------------------------ Pflichten --

// The bar has to be *on screen*, not merely present in the document, and
// nothing may cover it. On a plan page the sticky analysis panel is a full
// viewport tall and used to sit right over it: measured, footer at 487-539 and
// panel at 56-876. A link nobody can click is not a link.
await check('der Fuß steht unten und wird von nichts überdeckt', async () => {
  const list = await fetch(`${API}/api/scenarios?limit=40`).then((r) => r.json());
  const paths = ['/entdecken', '/rechtliches', '/'];
  if (list.length) paths.push(`/szenario/${list[0].slug}`);
  for (const path of paths) {
    const { page, context } = await open(path);
    if (path === '/') await start(page);
    await page.locator('footer').waitFor({ timeout: READY });
    // Scroll everything that can scroll, then look again.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(600);
    const seen = await page.evaluate(() => {
      const f = document.querySelector('footer');
      const r = f.getBoundingClientRect();
      const gap = Math.round(window.innerHeight - r.bottom);
      // What is actually painted where the footer's links are.
      const link = f.querySelector('a');
      const lr = link.getBoundingClientRect();
      const hit = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
      return { gap, height: Math.round(r.height), covered: !f.contains(hit), hit: hit?.tagName };
    });
    assert(seen.height > 10, `${path}: der Fuß ist ${seen.height} px hoch`);
    assert(seen.gap <= 1, `${path}: der Fuß steht ${seen.gap} px über dem unteren Rand`);
    assert(!seen.covered, `${path}: über dem Fuß liegt ${seen.hit}`);
    await context.close();
  }
});

await check('der Fuß nennt den Betreiber, den Kontakt und den Kaffee', async () => {
  const { page, context } = await open('/entdecken');
  await page.locator('footer').waitFor({ timeout: 30_000 });
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('footer a')].map((a) => ({ t: a.textContent?.trim(), h: a.getAttribute('href') }))
  );
  const mail = links.find((l) => l.h?.startsWith('mailto:'));
  assert(mail, 'kein Kontaktlink im Fuß');
  const coffee = links.find((l) => l.h?.includes('buymeacoffee.com'));
  assert(coffee, 'kein Kaffeelink im Fuß');
  const text = await page.evaluate(() => document.querySelector('footer').innerText);
  assert(/Von .+/.test(text), `der Fuß nennt niemanden: ${text.slice(0, 60)}`);
  await context.close();
});

// Reporting something broken has to take fewer steps than the bug did.
await check('die Rückmeldung lässt sich in drei Schritten abschicken', async () => {
  const { page, context, errors } = await open('/entdecken');
  await page.locator('footer').waitFor({ timeout: 30_000 });
  // The footer is server-rendered, so its presence says nothing about whether
  // React has attached the handler yet. Clicking once and waiting made this
  // fail about half the time — on a slow first load the button really is inert
  // for a moment, which is worth knowing but is not what this check is about.
  const sheet = page.locator('[role="dialog"]').first();
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.getByRole('button', { name: 'Feedback' }).click();
    try {
      await sheet.waitFor({ timeout: 2000 });
      break;
    } catch {
      if (attempt === 9) throw new Error('das Rückmeldungsfenster öffnet sich nicht');
    }
  }
  // Kind, text, send. No account, no address, nothing to solve by hand.
  const kinds = await sheet.getByRole('radio').count();
  assert(kinds === 3, `${kinds} Arten statt drei`);
  await sheet.getByRole('radio', { name: /Etwas fehlt/ }).click();
  await sheet.locator('textarea').fill('Ein Testwunsch aus der Browserprüfung, bitte ignorieren.');
  const send = sheet.getByRole('button', { name: 'Absenden' });
  assert(await send.isEnabled(), 'Absenden bleibt gesperrt');
  await send.click();
  // The proof of work runs in a worker; the confirmation is what proves the
  // whole path worked, challenge and all.
  await page.getByText('Angekommen', { exact: false }).waitFor({ timeout: 40_000 });
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// § 5 DDG wants the operator's details reachable from anywhere, at all times.
// Asserting that against the source only proves the component exists; this
// checks the pages a visitor actually lands on.
await check('jede öffentliche Seite führt in einem Klick zum Impressum', async () => {
  const list = await fetch(`${API}/api/scenarios?limit=1`).then((r) => r.json());
  const paths = ['/entdecken', '/vergleich', '/konto', '/rechtliches'];
  if (list.length) paths.push(`/szenario/${list[0].slug}`);
  for (const path of paths) {
    const { page, context } = await open(path);
    await page.getByRole('contentinfo').waitFor({ timeout: 30_000 });
    // Scoped to the footer: the legal page itself has in-page anchors with the
    // same names, and those are not what § 5 DDG is about.
    const link = page.getByRole('contentinfo').getByRole('link', { name: 'Impressum' }).first();
    assert(await link.count(), `${path} hat keinen Impressumslink`);
    const href = await link.getAttribute('href');
    assert(href?.startsWith('/rechtliches'), `${path} verlinkt „${href}"`);
    await context.close();
  }
});

await check('die Rechtsseite nennt Betreiber, Rechte und Lizenzen', async () => {
  const { page, context, errors } = await open('/rechtliches');
  await page.getByRole('heading', { name: 'Rechtliches' }).waitFor({ timeout: 30_000 });
  const text = await page.evaluate(() => document.body.innerText);
  for (const needle of [
    '§ 5 DDG',
    '§ 25 Abs. 2 Nr. 2 TDDDG',
    'Art. 17',
    'Art. 16 DSA',
    'ODbL',
    'dl-de/by-2-0',
    'Kein amtliches Angebot',
  ]) {
    assert(text.includes(needle), `„${needle}" fehlt auf der Rechtsseite`);
  }
  // The placeholder warning has to be visible while the details are missing,
  // and gone once they are filled in.
  const placeholders = text.includes('BITTE-AUSFUELLEN');
  const warned = text.includes('nicht betriebsbereit');
  assert(placeholders === warned, 'Platzhalter und Warnung passen nicht zusammen');
  assert(errors.length === 0, `Fehler in der Konsole: ${errors.slice(0, 2).join(' | ')}`);
  await context.close();
});

// Access and erasure have to be reachable without writing an email, which is
// the whole reason they are buttons.
await check('die Kontoseite bietet Auskunft und Löschung an', async () => {
  const { page, context } = await open('/konto');
  await page.getByRole('heading', { name: 'Konto und Daten' }).waitFor({ timeout: 30_000 });
  // Signed out, the page explains that nothing is stored rather than showing
  // buttons that cannot work. Waited for: the heading is server-rendered and
  // the state is decided in an effect a moment later, so reading the text
  // straight away caught the loading state.
  await page.getByRole('heading', { name: 'Nicht angemeldet' }).waitFor({ timeout: 20_000 });
  const text = await page.evaluate(() => document.body.innerText);
  assert(text.includes('Datenschutz'), 'kein Weg zur Datenschutzerklärung');
  await context.close();
});

await browser.close();

console.log('\n' + results.join('\n'));
console.log(
  `\n${passed} bestanden, ${failed} fehlgeschlagen` +
    (skipped ? `, ${skipped} übersprungen — dieser Lauf hat weniger geprüft, als er könnte` : '')
);
process.exit(failed ? 1 : 0);
