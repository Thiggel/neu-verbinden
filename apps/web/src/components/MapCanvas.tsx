'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MlMap } from 'maplibre-gl';
import { buildStyle, DARK, LIGHT } from '@/lib/basemap';
import { EditorController, type DrawEstimate } from '@/lib/controller';
import type { Tool } from '@/lib/store';
import type { CityEntry, WasmEngine } from '@/lib/engine';
import type { BaseMap, Diff, RenderState, SnapResult } from '@/lib/types';
import { LabelOverlay } from './LabelOverlay';
import { closeUpStreets } from '@/lib/close-up-streets';

interface Props {
  engine: WasmEngine;
  /** The diff of the last committed change, so it can be animated in. */
  lastDiff: Diff | null;
  basemap: BaseMap;
  render: RenderState | null;
  dark: boolean;
  schematic: boolean;
  highlightLine: number | null;
  onReady: (c: EditorController, map: MlMap) => void;
  onChange: (diff: Diff | null) => void;
  onPick: (kind: 'station' | 'line' | 'edge', id: number) => void;
  onMessage: (text: string, tone?: 'info' | 'warn') => void;
  /** How many points the in-progress line has, so the UI can offer "finish". */
  onDraft: (points: number) => void;
  /** Live figures for the line being drawn. */
  onEstimate: (estimate: DrawEstimate | null) => void;
  /** Station the pointer is over, for the hover label and the cursor. */
  selectedStation: number | null;
  /** Where to open the map — the loaded city's centre. */
  initialCenter?: [number, number];
  /** The loaded city, for the attribution line. */
  city?: CityEntry | null;
  /** The active tool, so the keyboard cursor knows when to appear. */
  tool: Tool;
  /** Draw only what the plan would build, hiding the existing network. Used by
   *  the read-only plan map, where the point is somebody's proposal and not the
   *  seven hundred kilometres it is drawn on top of. */
  focusNew?: boolean;
}

/** Fallback frame, used only until the city's own centre is known. */
const INITIAL = { center: [9.995, 53.565] as [number, number], zoom: 10.6 };

export function MapCanvas({
  engine,
  basemap,
  render,
  dark,
  schematic,
  highlightLine,
  onReady,
  onChange,
  onPick,
  onMessage,
  onDraft,
  onEstimate,
  selectedStation,
  lastDiff,
  initialCenter,
  city,
  tool,
  focusNew = false,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const controllerRef = useRef<EditorController | null>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [cursor, setCursor] = useState<{ snap: SnapResult | null; draft: number }>({ snap: null, draft: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: buildStyle(basemap, dark ? DARK : LIGHT, render, focusNew),
      center: initialCenter ?? INITIAL.center,
      zoom: INITIAL.zoom,
      // Far enough out to see Kiel, Lüneburg and Rostock in one view.
      minZoom: 7.2,
      maxZoom: 17,
      attributionControl: false,
      // Touch-first: two fingers pan and zoom, one finger draws (plan §22).
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    // The statistical source differs by city, and naming the wrong office is
    // not a small thing in an attribution line.
    const stats = city?.statistics;
    // Where the population figures are themselves OpenStreetMap's, the credit
    // above already covers them — repeating it, with a second copy of the same
    // licence in brackets, only makes the line harder to read.
    const separate = stats && !/OpenStreetMap/i.test(stats.label);
    m.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: [
          '© OpenStreetMap-Mitwirkende (ODbL)',
          separate ? `${stats.label}${stats.licence ? ` (${stats.licence})` : ''}` : null,
          'Modellwerte: eigene Schätzung',
        ]
          .filter(Boolean)
          .join(' · '),
      }),
      'bottom-right'
    );
    mapRef.current = m;
    // A debugging handle, and only in development. React mounts this component
    // twice in strict mode, so the first map is created and thrown away; without
    // the cleanup below, `__map` pointed at that discarded instance and every
    // probe reported an empty style on a map that was drawing fine.
    const dev = process.env.NODE_ENV !== 'production';
    const w = window as unknown as { __map?: MlMap };
    if (dev) w.__map = m;
    // The map is created before the flex layout has settled, and on mobile the
    // viewport changes when the browser chrome slides away. A ResizeObserver is
    // the only reliable way to keep the canvas matching its container.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container.current);

    // The style already contains every source and layer, so the controller can
    // start immediately — nothing has to be added once the style has loaded.
    const controller = new EditorController(m, engine, {
      onChange,
      onCursor: (snap, draft) => {
        setCursor({ snap, draft });
        onDraft(draft);
      },
      onPick,
      onMessage,
      onEstimate,
    });
    controllerRef.current = controller;
    setMap(m);
    onReady(controller, m);


  // Hovering a station names it, so the map can stay quiet by default.
    const onHover = (e: maplibregl.MapMouseEvent) => {
      if (!m.getLayer('station-outer')) return;
      const hit = m.queryRenderedFeatures(e.point, { layers: ['station-outer'] });
      const id = hit.length ? (hit[0].properties?.id as number) : null;
      setHovered((prev) => {
        if (prev === id) return prev;
        if (render) controllerRef.current?.highlightStation(render, id);
        return id;
      });
    };
    m.on('mousemove', onHover);

    return () => {
      if (dev && w.__map === m) delete w.__map;
      ro.disconnect();
      m.off('mousemove', onHover);
      controllerRef.current?.destroy();
      m.remove();
      mapRef.current = null;
    };
    // The map is created once; style and data changes are applied imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The small streets, once the map exists *and* the city is known.
  //
  // Deliberately not inside the map's own setup effect: that runs as soon as
  // there is a container, which is before the manifest has said which files this
  // city has. Reading the URL there got `undefined`, so the layer stayed empty
  // for good — the file was even fetched, by a mount that was thrown away.
  useEffect(() => {
    if (!map || !city?.files?.streets) return;
    return closeUpStreets(map, `/data/${city.files.streets}`, city.id);
  }, [map, city]);

  // The latest props, for the deferred restyle below: it may run a moment after
  // the effect that scheduled it, and it must build the style from what is
  // current then, not from what was current when the theme was switched.
  const latest = useRef({ basemap, render, focusNew });
  latest.current = { basemap, render, focusNew };

  // Theme changes rebuild the style, then the render state is re-applied.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    // The new style carries the current network with it, so nothing has to be
    // re-applied afterwards.
    const apply = () => {
      const { basemap: b, render: r, focusNew: f } = latest.current;
      m.setStyle(buildStyle(b, dark ? DARK : LIGHT, r, f));
    };
    // `isStyleLoaded()` is false while any source is still settling, and this
    // used to give up when it was — silently. Switch the theme early, or on a
    // slow connection, and the map stayed in the old one for good: the effect
    // only runs again when `dark` changes, so the only way back was to toggle
    // twice. Wait for the style instead of dropping the change.
    if (m.isStyleLoaded()) {
      apply();
      return;
    }
    m.once('styledata', apply);
    return () => {
      m.off('styledata', apply);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    if (render) controllerRef.current?.syncRender(render, { schematic, focusNew });
  }, [render, schematic, focusNew]);


  useEffect(() => {
    if (render) controllerRef.current?.highlightLine(render, highlightLine);
  }, [render, highlightLine]);

  // Animate whatever was just committed. Keyed on the diff object identity, so
  // it plays once per change and not on every unrelated re-render.
  useEffect(() => {
    if (render && lastDiff) controllerRef.current?.flourish(render, lastDiff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDiff]);

  // Working without a pointer: the map's own arrow keys pan the ground under a
  // fixed centre, so the centre is the cursor. Space places a station there,
  // Enter finishes the line, Backspace takes back the last point.
  const keyboardTool = tool === 'draw' || tool === 'extend';
  useEffect(() => {
    if (!map) return;
    const el = map.getCanvasContainer();
    const onKey = (e: KeyboardEvent) => {
      const c = controllerRef.current;
      if (!c) return;
      if (e.key === ' ' || e.key === 'Enter') {
        // Enter finishes, Space places — both would otherwise scroll or
        // activate whatever the browser thinks is focused.
        e.preventDefault();
        e.stopPropagation();
        if (e.key === ' ') c.actAtCentre();
        else c.commitDraft();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        c.undoDraftPoint();
      } else if (e.key === 'Escape') {
        c.clearDraft();
      }
    };
    const onMove = () => controllerRef.current?.previewCentre();
    const onFocus = () => setKeyboardFocus(true);
    const onBlur = () => setKeyboardFocus(false);
    el.addEventListener('keydown', onKey);
    el.addEventListener('focusin', onFocus);
    el.addEventListener('focusout', onBlur);
    map.on('moveend', onMove);
    return () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('focusin', onFocus);
      el.removeEventListener('focusout', onBlur);
      map.off('moveend', onMove);
    };
  }, [map]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="map-surface absolute inset-0" style={{ position: 'absolute', inset: 0 }} />
      {/* The keyboard cursor. Only while a drawing tool is active, and only
          once the map has focus — otherwise it is a crosshair over nothing. */}
      {keyboardTool && keyboardFocus && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="relative">
            <span className="absolute left-1/2 top-1/2 block h-6 w-px -translate-x-1/2 -translate-y-1/2 bg-ink/70" />
            <span className="absolute left-1/2 top-1/2 block h-px w-6 -translate-x-1/2 -translate-y-1/2 bg-ink/70" />
            <span className="block h-3.5 w-3.5 rounded-full ring-2 ring-ink/70" />
          </div>
          <div className="absolute bottom-3 rounded-full bg-ink/85 px-2.5 py-1 text-[11px] font-medium text-paper">
            Pfeiltasten bewegen · Leertaste setzt einen Halt · Enter beendet
          </div>
        </div>
      )}
      {map && render && (
        <LabelOverlay
          map={map}
          render={render}
          basemap={basemap}
          dark={dark}
          hovered={hovered}
          selected={selectedStation}
        />
      )}
      {cursor.snap && <SnapCursor map={map} snap={cursor.snap} />}
    </div>
  );
}

/**
 * The floating snap cursor.
 *
 * Sits above the finger so the target is never hidden, and says what the point
 * will attach to. When it would join the existing network it says so loudly —
 * that is the difference between a line that connects and one that merely
 * passes nearby, and it is invisible otherwise.
 */
function SnapCursor({ map, snap }: { map: MlMap | null; snap: SnapResult }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!map || !ref.current) return;
    const p = map.project([snap.geo.lon, snap.geo.lat]);
    ref.current.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
  }, [map, snap]);

  const onNetwork = snap.target.kind === 'node' || snap.target.kind === 'edge';
  return (
    // Both children are positioned, not in flow, so each centres on the anchor
    // by half of *its own* width.
    //
    // The dot's wrapper used to be a block in normal flow. A block fills its
    // containing block, and that is this div — which shrink-wraps to its widest
    // child, the label. So `-translate-x-1/2` moved the dot by half the *label*
    // instead of half the dot: with "Hauptbahnhof · Umsteigepunkt T1 T4" the
    // marker sat 130 px to the left of the station it named, while the label,
    // being the element whose width was used, sat exactly right. The longer the
    // name, the further the dot drifted.
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-20 h-0 w-0 will-change-transform">
      <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
        {snap.connects && <span className="absolute -inset-3 rounded-full bg-emerald-400/25 animate-ping-slow" />}
        <span
          className={`relative block rounded-full ring-2 ring-white/90 transition-[width,height] ${
            snap.connects
              ? 'h-4 w-4 bg-emerald-500'
              : onNetwork
                ? 'h-3.5 w-3.5 bg-slate-900'
                : 'h-2.5 w-2.5 bg-slate-500'
          }`}
        />
      </div>
      <div
        className={`absolute left-0 top-0 -translate-x-1/2 -translate-y-[46px] flex max-w-[260px] items-center gap-1.5 truncate whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium shadow-lg backdrop-blur ${
          snap.connects ? 'bg-emerald-600 text-white' : 'bg-slate-900/90 text-white'
        }`}
      >
        {snap.connects && <span aria-hidden>⇄</span>}
        <span className="truncate">{snap.label}</span>
        {snap.connectsTo.slice(0, 4).map((l, i) => (
          <span
            key={`${l}-${i}`}
            className="shrink-0 rounded px-1 text-[10px] font-bold"
            style={{ backgroundColor: snap.connectColors[i] ?? '#334155', color: '#fff' }}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
