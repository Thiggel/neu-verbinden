// The picture a shared link unfurls to.
//
// Same idea as the in-app share card, but drawn on the server so a crawler
// gets it without running JavaScript: the network as a poster, the new lines
// bright, and the three figures that decide whether a plan is worth arguing
// about. The network itself is an inline SVG — satori draws that fine, and it
// keeps the whole image under a few kilobytes.

import { ImageResponse } from 'next/og';
import { fetchScenario } from './scenario-data';

export const runtime = 'nodejs';
export const alt = 'Netzentwurf';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const C = {
  bg: '#0b0e12',
  panel: '#151b24',
  ink: '#f2f5f9',
  muted: '#8f9aab',
  faint: '#3a4655',
  accent: '#57c785',
};

const km = (v: number) => `${v.toFixed(1).replace('.', ',')} km`;
const eur = (v: number) =>
  v >= 1e9
    ? `${(v / 1e9).toFixed(1).replace('.', ',')} Mrd. €`
    : `${Math.round(v / 1e6).toLocaleString('de-DE')} Mio. €`;

/**
 * The network as an SVG data URI, framed on what the scenario would build.
 *
 * Returns null when there is no geometry to draw — a preview without a map is
 * better than a broken one.
 */
function networkSvg(data: Awaited<ReturnType<typeof fetchScenario>>, w: number, h: number) {
  const net = data?.document?.network;
  const edgeMap = net?.edges ?? {};
  const edges = Object.values(edgeMap) as {
    geo: { lat: number; lon: number }[] | [number, number][];
    status: string;
  }[];
  if (!edges.length) return null;

  // Each new line in its own colour — the U5 purple, the S4 blue — because a
  // single green thread says nothing about what is being proposed.
  const colourOf = new Map<string, string>();
  for (const line of Object.values(net?.lines ?? {})) {
    if (!line.included) continue;
    for (const e of line.edges) if (!colourOf.has(String(e))) colourOf.set(String(e), line.color);
  }
  const keys = Object.keys(edgeMap);

  const coords = (e: (typeof edges)[number]): [number, number][] =>
    (e.geo as unknown[])
      .map((p) =>
        Array.isArray(p) ? ([p[0], p[1]] as [number, number]) : ([(p as { lon: number }).lon, (p as { lat: number }).lat] as [number, number])
      )
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

  const isNew = (e: (typeof edges)[number]) => e.status !== 'in_service';
  const all = edges.map(coords).filter((c) => c.length > 1);
  const fresh = edges
    .map((e, i) => ({ set: coords(e), colour: colourOf.get(keys[i]) ?? C.accent, isNew: isNew(e) }))
    .filter((x) => x.isNew && x.set.length > 1);
  if (!all.length) return null;

  const lat0 = all[0][0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const bounds = (sets: [number, number][][]) => {
    let a = Infinity;
    let b = Infinity;
    let c = -Infinity;
    let d = -Infinity;
    for (const set of sets)
      for (const [lon, lat] of set) {
        a = Math.min(a, lon * kx);
        c = Math.max(c, lon * kx);
        b = Math.min(b, -lat);
        d = Math.max(d, -lat);
      }
    return [a, b, c, d] as const;
  };
  // Framed on what would be built, but never so tightly that the existing
  // network is cut through mid-stroke at the edges: a line that stops dead at
  // the border reads as a rendering fault rather than as a map. So the frame
  // is widened towards the surrounding network, up to a limit — enough to give
  // the new line context without shrinking it into the middle of the picture.
  const [fx0, fy0, fx1, fy1] = bounds(fresh.length ? fresh.map((f) => f.set) : all);
  const [ax0, ay0, ax1, ay1] = bounds(all);
  const grow = 0.28;
  let minX = Math.max(fx0 - (fx1 - fx0) * grow, Math.min(fx0, ax0));
  let maxX = Math.min(fx1 + (fx1 - fx0) * grow, Math.max(fx1, ax1));
  let minY = Math.max(fy0 - (fy1 - fy0) * grow, Math.min(fy0, ay0));
  let maxY = Math.min(fy1 + (fy1 - fy0) * grow, Math.max(fy1, ay1));
  const MIN_SPAN = 0.05;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const spanX = Math.max((maxX - minX) * 1.12, MIN_SPAN);
  const spanY = Math.max((maxY - minY) * 1.12, MIN_SPAN);
  minX = midX - spanX / 2;
  maxX = midX + spanX / 2;
  minY = midY - spanY / 2;
  maxY = midY + spanY / 2;

  const s = Math.min(w / (maxX - minX), h / (maxY - minY));
  const ox = (w - (maxX - minX) * s) / 2;
  const oy = (h - (maxY - minY) * s) / 2;
  const path = (set: [number, number][]) =>
    set
      .map(([lon, lat], i) => {
        const x = (ox + (lon * kx - minX) * s).toFixed(1);
        const y = (oy + (-lat - minY) * s).toFixed(1);
        return `${i ? 'L' : 'M'}${x} ${y}`;
      })
      .join('');

  const old = edges
    .map((e, i) => (isNew(e) ? null : all[i]))
    .filter(Boolean) as [number, number][][];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    // Heavy enough to read as a network rather than as stray threads; the new
    // line still stands well clear of it at more than twice the width.
    old.map((set) => `<path d="${path(set)}" stroke="${C.faint}" stroke-width="4.5"/>`).join('') +
    fresh
      .map((f) => `<path d="${path(f.set)}" stroke="${f.colour}" stroke-width="7" opacity="0.95"/>`)
      .join('') +
    `</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchScenario(slug);
  const mapW = 700;
  const mapH = 470;
  const map = networkSvg(data, mapW, mapH);

  const cells: [string, string, string][] = data
    ? [
        ['INVESTITION', eur(data.investment_eur), 'Modellschätzung'],
        ['NUTZEN', eur(data.annual_benefit_eur), 'pro Jahr'],
        [
          'NUTZEN-KOSTEN',
          data.benefit_cost_ratio > 0 ? data.benefit_cost_ratio.toFixed(2).replace('.', ',') : '–',
          data.benefit_cost_ratio >= 1 ? 'förderfähig' : 'unter der Förderschwelle',
        ],
      ]
    : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: C.bg,
          color: C.ink,
          fontFamily: 'sans-serif',
          padding: 32,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', width: 726 }}>
          <div style={{ display: 'flex', fontSize: 17, letterSpacing: 4, color: C.muted, marginLeft: 4 }}>
            {(data?.city ?? 'hamburg').toUpperCase()} · NETZENTWURF
          </div>
          <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {map ? <img src={map} width={mapW} height={mapH} alt="" /> : <div />}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 410,
            background: C.panel,
            borderRadius: 26,
            padding: 34,
          }}
        >
          <div style={{ display: 'flex', fontSize: 36, fontWeight: 700, lineHeight: 1.12 }}>
            {(data?.title ?? 'Netzentwurf').slice(0, 46)}
          </div>
          <div style={{ display: 'flex', fontSize: 17, color: C.muted, marginTop: 12 }}>
            {data
              ? [
                  `${km(data.new_km)} neu`,
                  `${data.new_stations} Stationen`,
                  data.opening_year ? `ab ${data.opening_year}` : null,
                ]
                  .filter(Boolean)
                  .join('  ·  ')
              : ''}
          </div>
          <div style={{ display: 'flex', fontSize: 17, color: C.muted, marginTop: 4 }}>
            {data?.author_name ? `von ${data.author_name}` : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16 }}>
            {cells.map(([label, value, note]) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', marginTop: 11 }}>
                <div style={{ display: 'flex', fontSize: 15, letterSpacing: 3, color: C.muted }}>
                  {label}
                </div>
                {/* The note goes under the number, not beside it. Beside a
                    wide figure it read as part of the number, and this picture
                    is mostly seen at thumbnail size in a timeline. */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 34,
                      fontWeight: 700,
                      color:
                        label === 'NUTZEN-KOSTEN' && (data?.benefit_cost_ratio ?? 0) >= 1
                          ? C.accent
                          : C.ink,
                    }}
                  >
                    {value}
                  </div>
                  <div style={{ display: 'flex', fontSize: 15, color: C.muted, marginTop: 2 }}>
                    {note}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexGrow: 1 }} />
          <div style={{ display: 'flex', fontSize: 13, color: C.muted, lineHeight: 1.4, marginTop: 14 }}>
            Modellschätzung, keine offizielle Kosten-Nutzen-Untersuchung. Daten: OpenStreetMap.
          </div>
        </div>
      </div>
    ),
    size
  );
}
