// The picture a plan gets shared as.
//
// A screenshot of the editor is a bad share image: it is full of interface, the
// network is thin, and the numbers that make the plan interesting sit in a
// sidebar nobody can read at thumbnail size. So the card is drawn from scratch
// — the network as a poster, the existing lines faded back, the new ones bright
// and thick, and the three figures that actually decide whether a plan is worth
// arguing about.
//
// Rendered on a canvas rather than fetched from a server: it works offline, it
// costs nothing to run, and the same code produces the download, the clipboard
// image and the file handed to the native share sheet.

import type { LineGeometry, RenderState, StationGeometry } from './types';
import { eur } from './format';

export type CardFormat = 'landscape' | 'portrait' | 'square' | 'story';

export interface CardStats {
  newKm: number;
  newStations: number;
  investmentEur: number;
  benefitEur: number;
  bcr: number;
  openingYear: number | null;
}

export interface CardInput {
  title: string;
  author?: string | null;
  city: string;
  /** Where the population figures came from, for the footnote. */
  dataSource?: string;
  stats: CardStats;
  render: RenderState;
  format?: CardFormat;
  /** Rendered light instead of dark. */
  light?: boolean;
  /**
   * A second plan to set beside the first.
   *
   * Comparing is half of what this application is for, and "here are the two,
   * judge for yourself" is a better thing to post than either alone.
   */
  versus?: { title: string; stats: CardStats; render: RenderState };
}

const SIZES: Record<CardFormat, [number, number]> = {
  landscape: [1200, 630],
  portrait: [1080, 1350],
  square: [1080, 1080],
  // The full-screen 9:16 of an Instagram or TikTok story. The 1080 × 1350
  // above is the *feed* portrait and was labelled "Story", which it is not:
  // posted as a story it gets letterboxed with grey bars top and bottom.
  story: [1080, 1920],
};

const DARK = {
  bg: '#0b0e12',
  panel: '#151b24',
  ink: '#f2f5f9',
  muted: '#8f9aab',
  faint: '#3a4655',
  accent: '#57c785',
};

const LIGHT = {
  bg: '#f6f4f0',
  panel: '#ffffff',
  ink: '#14181f',
  muted: '#67707f',
  faint: '#c3cad3',
  accent: '#1f7a4d',
};

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

/** Draw the card and hand back a PNG blob. */
export async function renderShareCard(input: CardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const [w, h] = SIZES[input.format ?? 'landscape'];
  const scale = 2;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas nicht verfügbar');
  ctx.scale(scale, scale);
  drawCard(ctx, w, h, input);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))),
      'image/png'
    )
  );
}

/** The same drawing, straight onto a canvas the caller owns (for the preview). */
export function drawShareCard(canvas: HTMLCanvasElement, input: CardInput) {
  const [w, h] = SIZES[input.format ?? 'landscape'];
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * scale;
  canvas.height = h * scale;
  canvas.style.aspectRatio = `${w} / ${h}`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  drawCard(ctx, w, h, input);
}

function drawCard(ctx: CanvasRenderingContext2D, w: number, h: number, input: CardInput) {
  if (input.versus) return drawComparison(ctx, w, h, input);
  const c = input.light ? LIGHT : DARK;
  const pad = Math.round(Math.min(w, h) * 0.05);
  const wide = w > h * 1.25;

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);

  // A wide card puts the caption beside the map; a tall one puts it below.
  // Stacking on a 1200×630 leaves the map a 170-pixel strip — the network
  // becomes a smudge and the whole point of the picture is lost.
  const split = Math.round(w * 0.605);
  const panel = wide
    ? { x: split, y: pad, w: w - split - pad, h: h - pad * 2 }
    : { x: pad, y: h - pad - Math.round(h * 0.31), w: w - pad * 2, h: Math.round(h * 0.31) };
  const map = wide
    ? { x: pad, y: pad * 2.4, w: split - pad * 1.7, h: h - pad * 3.6 }
    : { x: pad, y: pad * 2.4, w: w - pad * 2, h: panel.y - pad * 3.3 };

  const glow = ctx.createRadialGradient(
    map.x + map.w / 2,
    map.y + map.h / 2,
    10,
    map.x + map.w / 2,
    map.y + map.h / 2,
    Math.max(map.w, map.h) * 0.8
  );
  glow.addColorStop(0, input.light ? 'rgba(0,0,0,0.05)' : 'rgba(120,160,255,0.11)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, wide ? panel.x : w, wide ? h : panel.y);

  drawNetwork(ctx, input, map, c);
  drawHeader(ctx, map.x, pad, input, c, Math.round(Math.min(w, h) * 0.017));
  drawPanel(ctx, panel, input, c);
}

// ------------------------------------------------------------- the network --

function drawNetwork(
  ctx: CanvasRenderingContext2D,
  input: CardInput,
  box: { x: number; y: number; w: number; h: number },
  c: typeof DARK
) {
  const lines = input.render.lines.filter((l) => l.included && l.geo.length > 1);
  if (!lines.length) return;

  // "New" means anything this scenario would have to build — a line the user
  // drew, a political proposal, or the officially planned U5. Only the network
  // in service is context.
  const isNew = (l: LineGeometry) => l.segments.some((seg) => seg.status !== 'in_service');

  const lat0 = lines[0].geo[0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const bounds = (ls: LineGeometry[]) => {
    let a = Infinity;
    let b = Infinity;
    let cx = -Infinity;
    let cy = -Infinity;
    for (const l of ls) {
      for (const [lon, lat] of l.geo) {
        a = Math.min(a, lon * kx);
        cx = Math.max(cx, lon * kx);
        b = Math.min(b, -lat);
        cy = Math.max(cy, -lat);
      }
    }
    return [a, b, cx, cy] as const;
  };

  // Frame what is new, with context around it. A card about one line in
  // Bergedorf that shows all of Hamburg as a smudge says nothing; the same
  // card framed on Bergedorf says everything.
  const focus = lines.filter(isNew);
  let [minX, minY, maxX, maxY] = bounds(focus.length ? focus : lines);
  const MIN_SPAN = 0.05; // degrees — roughly 5 km, so one short line still reads
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const spanX = Math.max((maxX - minX) * 1.35, MIN_SPAN);
  const spanY = Math.max((maxY - minY) * 1.35, MIN_SPAN);
  minX = midX - spanX / 2;
  maxX = midX + spanX / 2;
  minY = midY - spanY / 2;
  maxY = midY + spanY / 2;

  const s = Math.min(box.w / (maxX - minX), box.h / (maxY - minY));
  const ox = box.x + (box.w - (maxX - minX) * s) / 2;
  const oy = box.y + (box.h - (maxY - minY) * s) / 2;
  const px = ([lon, lat]: [number, number]): [number, number] => [
    ox + (lon * kx - minX) * s,
    oy + (-lat - minY) * s,
  ];

  // Anything outside the frame is clipped rather than sprawling over the title.
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();

  const width = Math.max(2.4, Math.min(box.w, box.h) / 105);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const l of lines.filter((x) => !isNew(x))) {
    stroke(ctx, l.geo.map(px), c.faint, width * 0.7);
  }
  for (const l of focus) {
    ctx.save();
    ctx.shadowColor = l.color;
    ctx.shadowBlur = width * 3.4;
    stroke(ctx, l.geo.map(px), l.color, width * 1.6);
    ctx.restore();
  }

  const newIds = new Set(focus.flatMap((l) => l.stations));
  const dot = Math.max(2.6, width * 0.9);
  for (const st of input.render.stations as StationGeometry[]) {
    if (!newIds.has(st.id)) continue;
    const [x, y] = px([st.lon, st.lat]);
    ctx.beginPath();
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.lineWidth = Math.max(1.4, dot * 0.5);
    ctx.strokeStyle = st.colors[0] ?? c.accent;
    ctx.stroke();
  }

  // A badge at the end of each new line. Without it the picture shows some
  // coloured threads; with it, it shows *which* lines a plan is about.
  const badge = Math.max(9, Math.min(box.w, box.h) / 26);
  const placed: { x: number; y: number }[] = [];
  // One badge per line *label*: the U5 is imported as five construction
  // stages, and five identical badges say nothing that one does not.
  const byLabel = new Map<string, LineGeometry>();
  for (const l of focus) {
    const held = byLabel.get(l.label);
    if (!held || l.lengthKm > held.lengthKm) byLabel.set(l.label, l);
  }
  for (const l of byLabel.values()) {
    // Prefer the end furthest from the badges already placed, so two rarely
    // collide.
    const ends = [l.geo[0], l.geo[l.geo.length - 1]].map(px);
    const spot =
      ends.find((e) => placed.every((p) => Math.hypot(p.x - e[0], p.y - e[1]) > badge * 2.4)) ?? ends[1];
    if (spot[0] < box.x || spot[0] > box.x + box.w || spot[1] < box.y || spot[1] > box.y + box.h) {
      continue;
    }
    placed.push({ x: spot[0], y: spot[1] });
    ctx.font = `700 ${badge * 0.86}px ${FONT}`;
    const w = Math.max(badge * 1.5, ctx.measureText(l.label).width + badge * 0.7);
    roundRect(ctx, spot[0] - w / 2, spot[1] - badge * 0.62, w, badge * 1.24, badge * 0.3);
    ctx.fillStyle = l.color;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.label, spot[0], spot[1] + badge * 0.04);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function stroke(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  color: string,
  width: number
) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// -------------------------------------------------------------------- text --

function drawHeader(
  ctx: CanvasRenderingContext2D,
  x: number,
  pad: number,
  input: CardInput,
  c: typeof DARK,
  size: number
) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.muted;
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.fillText(spaced(`${input.city.toUpperCase()} · NETZENTWURF`), x, pad + size);
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  input: CardInput,
  c: typeof DARK
) {
  const { stats } = input;
  ctx.fillStyle = c.panel;
  roundRect(ctx, box.x, box.y, box.w, box.h, Math.min(box.w, box.h) * 0.06);
  ctx.fill();

  const inset = Math.min(box.w * 0.075, box.h * 0.09);
  const x0 = box.x + inset;
  const inner = box.w - inset * 2;
  // Everything is sized off the panel, so one implementation reads correctly
  // at 1200×630 and at 1080×1350.
  const u = Math.min(box.h / 24, box.w / 20);

  ctx.textBaseline = 'alphabetic';
  let y = box.y + inset;

  ctx.fillStyle = c.ink;
  const titleSize = u * 1.95;
  ctx.font = `700 ${titleSize}px ${FONT}`;
  for (const line of wrap(ctx, input.title, inner, 2)) {
    y += titleSize * 0.98;
    ctx.fillText(line, x0, y);
  }

  ctx.fillStyle = c.muted;
  const subSize = u * 0.92;
  ctx.font = `500 ${subSize}px ${FONT}`;
  y += subSize * 2.1;
  const sub = [
    `${fmtKm(stats.newKm)} neu`,
    `${stats.newStations} Stationen`,
    stats.openingYear ? `ab ${stats.openingYear}` : null,
    input.author ? `von ${input.author}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  for (const line of wrap(ctx, sub, inner, 2)) {
    ctx.fillText(line, x0, y);
    y += subSize * 1.45;
  }
  y -= subSize * 1.45;

  const cells: [string, string, string][] = [
    ['INVESTITION', eur(stats.investmentEur), 'Modellschätzung'],
    ['NUTZEN', eur(stats.benefitEur), 'pro Jahr'],
    [
      'NUTZEN-KOSTEN',
      stats.bcr > 0 ? stats.bcr.toFixed(2).replace('.', ',') : '–',
      stats.bcr >= 1 ? 'förderfähig' : 'unter der Förderschwelle',
    ],
  ];
  const labelSize = u * 0.76;
  const valueSize = u * 1.7;
  const noteSize = u * 0.76;
  const stacked = box.w < box.h * 1.4;

  if (stacked) {
    y += u * 0.9;
    for (const [label, value, note] of cells) {
      y += u * 1.5;
      ctx.fillStyle = c.muted;
      ctx.font = `600 ${labelSize}px ${FONT}`;
      ctx.fillText(spaced(label), x0, y);
      ctx.font = `700 ${valueSize}px ${FONT}`;
      const vw = ctx.measureText(value).width;
      ctx.fillStyle = label === 'NUTZEN-KOSTEN' && stats.bcr >= 1 ? c.accent : c.ink;
      ctx.fillText(value, x0, y + valueSize);
      ctx.fillStyle = c.muted;
      ctx.font = `500 ${noteSize}px ${FONT}`;
      ctx.fillText(fit(ctx, note, inner - vw - u * 0.6), x0 + vw + u * 0.6, y + valueSize);
      y += valueSize * 1.15;
    }
  } else {
    y += u * 2.2;
    const cellW = inner / 3;
    cells.forEach(([label, value, note], i) => {
      const x = x0 + i * cellW;
      ctx.fillStyle = c.muted;
      ctx.font = `600 ${labelSize}px ${FONT}`;
      ctx.fillText(spaced(label), x, y);
      ctx.fillStyle = i === 2 && stats.bcr >= 1 ? c.accent : c.ink;
      // Shrink rather than truncate: a cut-off figure is worse than a small one.
      let size = valueSize;
      ctx.font = `700 ${size}px ${FONT}`;
      while (size > valueSize * 0.6 && ctx.measureText(value).width > cellW - u * 0.6) {
        size -= 1;
        ctx.font = `700 ${size}px ${FONT}`;
      }
      ctx.fillText(value, x, y + valueSize * 1.05);
      ctx.fillStyle = c.muted;
      ctx.font = `500 ${noteSize}px ${FONT}`;
      ctx.fillText(fit(ctx, note, cellW - u * 0.6), x, y + valueSize * 1.05 + noteSize * 1.7);
    });
  }

  // The honesty line belongs on the picture, because the picture is what
  // travels — the caveat inside the app never leaves the app.
  ctx.fillStyle = c.muted;
  const footSize = u * 0.7;
  ctx.font = `500 ${footSize}px ${FONT}`;
  const foot = wrap(
    ctx,
    `Modellschätzung, keine offizielle Kosten-Nutzen-Untersuchung. Daten: OpenStreetMap${
      input.dataSource ? `, ${input.dataSource}` : ''
    }.`,
    inner,
    3
  );
  foot.forEach((line, i) => {
    ctx.fillText(line, x0, box.y + box.h - inset - footSize * 1.35 * (foot.length - 1 - i));
  });
}

// ------------------------------------------------------------------ helpers --

const spaced = (s: string) => s.split('').join(' ');

function fmtKm(km: number) {
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** Break into at most `maxLines` lines, the last one ellipsised if needed. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      out.push(line);
      line = word;
      if (out.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (out.length < maxLines && line) out.push(line);
  if (out.length === maxLines) out[maxLines - 1] = fit(ctx, out[maxLines - 1], maxWidth);
  return out.slice(0, maxLines);
}

/** Shorten to fit, with an ellipsis. One line, always. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------- comparison --

/**
 * Two plans side by side.
 *
 * Deliberately even-handed: the same frame, the same scale rules, the same
 * three figures under each, and the better value in a row merely marked — not
 * a verdict. Which number matters is a political question, and the card should
 * not pretend otherwise.
 */
function drawComparison(ctx: CanvasRenderingContext2D, w: number, h: number, input: CardInput) {
  const c = input.light ? LIGHT : DARK;
  const other = input.versus!;
  const pad = Math.round(Math.min(w, h) * 0.045);
  const gap = Math.round(pad * 0.8);
  const colW = (w - pad * 2 - gap) / 2;

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const u = Math.min(h / 30, w / 40);
  ctx.fillStyle = c.muted;
  ctx.font = `600 ${u * 0.86}px ${FONT}`;
  ctx.fillText(spaced(`${input.city.toUpperCase()} · ZWEI ENTWÜRFE`), pad, pad + u);

  const top = pad + u * 2.6;
  // The caption below each map is four figures plus a two-line title, so its
  // height is known — give it that, and the map takes the rest. Splitting by a
  // fixed fraction instead left the last row off the bottom of the card.
  // On the wide card the four figures sit on one line each — label left, value
  // right — because stacking them there costs the map a third of its height.
  const inlineRows = w > h * 1.25;
  const rowH = inlineRows ? u * 1.62 : u * 2.3;
  const titleH = u * 1.35 * 1.02;
  const captionH = u * 2.4 + titleH * 2 + u * 0.9 + rowH * 3 + u * (inlineRows ? 1.4 : 1.6) + u * 1.3;
  const inner = h - top - pad;
  // A column is half the card wide, so on the tall formats the leftover space
  // would stretch the map into a ribbon. Cap it at a readable shape and share
  // what is left evenly above and below, rather than letting the block sink.
  const mapH = Math.min(colW * 1.15, Math.max(inner * 0.28, inner - captionH));
  const slack = Math.max(0, inner - mapH - captionH - u * 2);
  const mapY = top + u + slack / 2;

  const sides: [string, CardStats, RenderState][] = [
    [input.title, input.stats, input.render],
    [other.title, other.stats, other.render],
  ];
  const rows: [string, (s: CardStats) => string, (s: CardStats) => number, 'low' | 'high'][] = [
    ['INVESTITION', (s) => eur(s.investmentEur), (s) => s.investmentEur, 'low'],
    ['NUTZEN/JAHR', (s) => eur(s.benefitEur), (s) => s.benefitEur, 'high'],
    ['NUTZEN-KOSTEN', (s) => (s.bcr > 0 ? s.bcr.toFixed(2).replace('.', ',') : '–'), (s) => s.bcr, 'high'],
    ['NEUBAU', (s) => fmtKm(s.newKm), (s) => s.newKm, 'high'],
  ];

  sides.forEach(([title, stats, render], side) => {
    const x = pad + side * (colW + gap);
    ctx.fillStyle = c.panel;
    roundRect(ctx, x, top, colW, h - top - pad, u * 0.8);
    ctx.fill();

    drawNetwork(
      ctx,
      { ...input, render, versus: undefined },
      { x: x + u, y: mapY, w: colW - u * 2, h: mapH },
      c
    );

    let y = mapY + mapH + u * 2.4;
    ctx.fillStyle = c.ink;
    const titleSize = u * 1.35;
    ctx.font = `700 ${titleSize}px ${FONT}`;
    // Always advance by two lines, even for a title that fits on one: the rows
    // below are meant to be read across the two columns, and they only line up
    // if the captions start at the same height.
    const lines = wrap(ctx, title, colW - u * 2, 2);
    for (const line of lines) {
      ctx.fillText(line, x + u, y);
      y += titleSize * 1.02;
    }
    y += titleSize * 1.02 * (2 - lines.length) + u * 0.9;

    for (const [label, format, value, better] of rows) {
      const mine = value(stats);
      const theirs = value(sides[1 - side][1]);
      const wins =
        Number.isFinite(mine) && Number.isFinite(theirs) && mine !== theirs
          ? better === 'low'
            ? mine < theirs
            : mine > theirs
          : false;
      ctx.fillStyle = c.muted;
      ctx.font = `600 ${u * 0.72}px ${FONT}`;
      ctx.fillText(spaced(label), x + u, inlineRows ? y + u * 0.95 : y);
      ctx.fillStyle = wins ? c.accent : c.ink;
      ctx.font = `700 ${u * 1.25}px ${FONT}`;
      if (inlineRows) {
        ctx.textAlign = 'right';
        ctx.fillText(fit(ctx, format(stats), colW * 0.6), x + colW - u, y + u);
        ctx.textAlign = 'left';
      } else {
        ctx.fillText(fit(ctx, format(stats), colW - u * 2), x + u, y + u * 1.3);
      }
      y += rowH;
    }
  });

  ctx.fillStyle = c.muted;
  ctx.font = `500 ${u * 0.62}px ${FONT}`;
  ctx.fillText(
    'Hervorgehoben ist der günstigere Wert. Welche Kennzahl zählt, ist eine politische Frage.',
    pad,
    h - pad * 0.45
  );
}
