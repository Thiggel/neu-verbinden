'use client';

// The editor controller.
//
// Everything that happens per pointer event lives here, outside React: a
// pointer move asks the engine to snap, writes two GeoJSON sources and moves
// one DOM node. No React render, no allocation storm (plan §55, §83).

import type { Map as MlMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import { cmd, type WasmEngine } from './engine';
import { lineWeight } from './basemap';
import type { Diff, Mode, RenderState, SnapResult, StationPreview } from './types';
import type { Tool } from './store';

/** Great-circle distance in metres between two [lon, lat] pairs. */
function haversine(a: [number, number], b: [number, number]) {
  const R = 6_371_008.8;
  const p1 = (a[1] * Math.PI) / 180;
  const p2 = (b[1] * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface ControllerCallbacks {
  onChange: (diff: Diff | null) => void;
  onCursor: (snap: SnapResult | null, draftLength: number) => void;
  onPick: (kind: 'station' | 'line' | 'edge', id: number) => void;
  onMessage: (text: string, tone?: 'info' | 'warn') => void;
  /** Live figures for the line being drawn, or null when nothing is in progress. */
  onEstimate: (estimate: DrawEstimate | null) => void;
}

/** What the line currently being drawn would add to the scenario. */
export interface DrawEstimate {
  valid: boolean;
  km: number;
  stations: number;
  interchanges: number;
  investmentEur: number;
  investmentLowEur: number;
  investmentHighEur: number;
  openingYear: number | null;
  populationReached: number;
  feasibility: string;
  warnings: string[];
}

export const MODE_COLOR: Record<Mode, string> = {
  ubahn: '#2563EB',
  sbahn: '#16A34A',
  tram: '#DB2777',
  regional: '#64748B',
};

export class EditorController {
  private draft: { lat: number; lon: number }[] = [];
  private cursor: SnapResult | null = null;
  private tool: Tool = 'select';
  private mode: Mode = 'ubahn';
  private extendTarget: { line: number; end: 'start' | 'finish' } | null = null;
  /** Touch input needs a bigger snap radius and a floating cursor (plan §23). */
  private coarsePointer = false;
  private raf = 0;
  private pendingLngLat: { lng: number; lat: number } | null = null;

  constructor(
    private map: MlMap,
    private engine: WasmEngine,
    private cb: ControllerCallbacks
  ) {
    this.attach();
  }

  // ------------------------------------------------------------- lifecycle --

  private handlers: [string, (e: never) => void][] = [];

  private on<K extends string>(event: K, fn: (e: never) => void) {
    this.map.on(event as 'click', fn as never);
    this.handlers.push([event, fn]);
  }

  private attach() {
    this.on('mousemove', (e: MapMouseEvent) => this.queueMove(e.lngLat, false));
    this.on('touchmove', (e: MapTouchEvent) => this.queueMove(e.lngLat, true));
    this.on('click', (e: MapMouseEvent) => this.handleClick(e.lngLat, false));
    // A double-click is "finish here", and by the time it arrives its own two
    // clicks have already been handled: the first finishes the line, the second
    // starts a fresh draft holding a single point. Committing that stray point
    // is not a line — and warning "Setze mindestens zwei Punkte" blames the
    // user for an event the tool generated itself. So: commit a real draft,
    // and otherwise clear quietly.
    this.on('dblclick', () => {
      const extending = this.tool === 'extend' && this.extendTarget;
      if (this.draftPoints.length >= 2 || extending) this.commitDraft();
      else this.clearDraft();
    });
    this.on('mouseout', () => {
      this.cursor = null;
      this.renderPreview();
      this.cb.onCursor(null, this.draft.length);
    });
  }

  destroy() {
    this.destroyed = true;
    this.stopReveal();
    if (this.estimateTimer) clearTimeout(this.estimateTimer);
    for (const [event, fn] of this.handlers) this.map.off(event as 'click', fn as never);
    this.handlers = [];
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.revealFrame);
    if (this.moveTimer) clearTimeout(this.moveTimer);
    if (this.estimateTimer) clearTimeout(this.estimateTimer);
  }

  // ---------------------------------------------------------------- state ---

  setTool(tool: Tool) {
    if (tool !== this.tool && this.draft.length >= 2) {
      // Switching away from drawing keeps the line. Discarding it silently is
      // the single most annoying thing a drawing tool can do.
      this.commitDraft();
      this.cb.onMessage('Linie übernommen.');
    }
    this.tool = tool;
    if (tool !== 'draw' && tool !== 'extend') this.clearDraft();
    if (tool !== 'extend') this.extendTarget = null;
    this.map.getCanvas().style.cursor = tool === 'select' ? '' : 'crosshair';
    this.map.doubleClickZoom[tool === 'draw' ? 'disable' : 'enable']();
  }

  setMode(mode: Mode) {
    this.mode = mode;
    if (this.draft.length) this.renderPreview();
  }

  setExtendTarget(target: { line: number; end: 'start' | 'finish' } | null) {
    this.extendTarget = target;
    this.clearDraft();
  }

  get draftPoints() {
    return this.draft.slice();
  }

  get hasDraft() {
    return this.draft.length > 0;
  }

  // --------------------------------------------------------------- pointer --

  /**
   * Coalesce pointer events to one snap per frame.
   *
   * A timer backs up the animation frame: a throttled or hidden tab stops
   * firing frames entirely, and without the fallback the cursor freezes where
   * it was and drawing stops responding.
   */
  private queueMove(lngLat: { lng: number; lat: number }, coarse: boolean) {
    this.coarsePointer = coarse;
    this.pendingLngLat = lngLat;
    if (this.raf || this.moveTimer) return;
    const flush = () => {
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.moveTimer) clearTimeout(this.moveTimer);
      this.raf = 0;
      this.moveTimer = null;
      const p = this.pendingLngLat;
      this.pendingLngLat = null;
      if (p) this.handleMove(p);
    };
    this.raf = requestAnimationFrame(flush);
    this.moveTimer = setTimeout(flush, 40);
  }

  private moveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Ground distance one screen pixel covers at the current camera. */
  private metresPerPixel() {
    return (
      (40075016.686 * Math.cos((this.map.getCenter().lat * Math.PI) / 180)) /
      Math.pow(2, this.map.getZoom() + 9)
    );
  }

  private handleMove(lngLat: { lng: number; lat: number }) {
    if (this.tool !== 'draw' && this.tool !== 'extend') {
      this.cursor = null;
      this.cb.onCursor(null, 0);
      return;
    }
    const origin = this.anchor();
    let snap: SnapResult;
    try {
      snap = this.engine.snapPoint(
        lngLat.lng,
        lngLat.lat,
        origin?.lon,
        origin?.lat,
        this.mode,
        this.metresPerPixel(),
        this.coarsePointer
      );
    } catch {
      return;
    }
    this.cursor = snap;
    this.renderPreview();
    this.cb.onCursor(snap, this.draft.length);
  }

  private anchor(): { lat: number; lon: number } | null {
    if (this.draft.length) return this.draft[this.draft.length - 1];
    return this.anchorOfExtension();
  }

  /** The station a pending extension grows out of. */
  private anchorOfExtension(): { lat: number; lon: number } | null {
    if (this.tool !== 'extend' || !this.extendTarget) return null;
    try {
      const detail = this.engine.lineDetail(this.extendTarget.line);
      const nodeId =
        this.extendTarget.end === 'start'
          ? detail.stations[0]?.[0]
          : detail.stations[detail.stations.length - 1]?.[0];
      if (nodeId == null) return null;
      const s = this.engine.stationDetail(nodeId);
      return { lat: s.lat, lon: s.lon };
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------- click --

  /**
   * Act at the centre of the map, for someone working without a pointer.
   *
   * The map's own arrow-key panning moves the ground under a fixed centre, so
   * the centre *is* the cursor: pan to where the station should go, and place
   * it. Everything else — snapping, naming, the live estimate — is the same
   * code path a click takes.
   */
  actAtCentre() {
    const c = this.map.getCenter();
    this.handleClick({ lng: c.lng, lat: c.lat }, false);
  }

  /** Show the ground the keyboard cursor is over, without acting on it. */
  previewCentre() {
    const c = this.map.getCenter();
    this.queueMove({ lng: c.lng, lat: c.lat }, false);
  }

  private handleClick(lngLat: { lng: number; lat: number }, coarse: boolean) {
    this.coarsePointer = coarse;
    switch (this.tool) {
      case 'select':
        return this.pickAt(lngLat);
      case 'draw':
      case 'extend':
        return this.addDraftPoint(lngLat);
      case 'split':
        return this.splitAt(lngLat);
      case 'delete':
        return this.deleteAt(lngLat);
    }
  }

  private pickRadius() {
    return this.metresPerPixel() * (this.coarsePointer ? 26 : 14);
  }

  private nearestStation(lngLat: { lng: number; lat: number }, render: RenderState) {
    const r = this.pickRadius();
    let best: { id: number; d: number } | null = null;
    for (const s of render.stations) {
      const dx = (s.lon - lngLat.lng) * 66000;
      const dy = (s.lat - lngLat.lat) * 111000;
      const d = Math.hypot(dx, dy);
      if (d <= r * 1.4 && (!best || d < best.d)) best = { id: s.id, d };
    }
    return best;
  }

  private pickAt(lngLat: { lng: number; lat: number }) {
    const render = this.engine.renderState();
    const station = this.nearestStation(lngLat, render);
    if (station) {
      this.cb.onPick('station', station.id);
      return;
    }
    const edge = this.engine.pickEdge(lngLat.lng, lngLat.lat, this.pickRadius());
    if (edge) {
      this.cb.onPick('edge', edge[0]);
      return;
    }
    this.cb.onPick('line', -1);
  }

  private splitAt(lngLat: { lng: number; lat: number }) {
    const hit = this.engine.pickEdge(lngLat.lng, lngLat.lat, this.pickRadius());
    if (!hit) {
      this.cb.onMessage('Kein Abschnitt getroffen.', 'warn');
      return;
    }
    this.run(cmd.splitEdge(hit[0], hit[2]));
  }

  private deleteAt(lngLat: { lng: number; lat: number }) {
    const render = this.engine.renderState();
    const station = this.nearestStation(lngLat, render);
    if (station) {
      this.run(cmd.removeStation(station.id));
      return;
    }
    const hit = this.engine.pickEdge(lngLat.lng, lngLat.lat, this.pickRadius());
    if (!hit) {
      this.cb.onMessage('Nichts zum Löschen getroffen.', 'warn');
      return;
    }
    this.run(cmd.deleteEdge(hit[0]));
  }

  private addDraftPoint(lngLat: { lng: number; lat: number }) {
    // "Weiterbauen" with nothing picked yet: the first tap chooses which line
    // to grow. Before this, the tool silently did nothing unless the line had
    // been selected in the sidebar first — which is not how anyone expects a
    // tool to behave.
    if (this.tool === 'extend' && !this.extendTarget) {
      if (this.pickExtendTarget(lngLat)) return;
      this.cb.onMessage('Tippe auf das Ende einer Linie, die du weiterbauen willst.', 'warn');
      return;
    }
    const origin = this.anchor();
    const snap = this.engine.snapPoint(
      lngLat.lng,
      lngLat.lat,
      origin?.lon,
      origin?.lat,
      this.mode,
      this.metresPerPixel(),
      this.coarsePointer
    );
    const p = { lat: snap.geo.lat, lon: snap.geo.lon };
    const last = this.draft[this.draft.length - 1];
    if (last && Math.abs(last.lat - p.lat) < 1e-7 && Math.abs(last.lon - p.lon) < 1e-7) {
      // Tapping the same spot twice finishes the line, like a polygon tool.
      this.commitDraft();
      return;
    }
    this.draft.push(p);
    // Extending is one click, one station: the line simply grows to where you
    // pointed, and the next click grows it again. Making the user confirm an
    // extension is a step with nothing in it.
    if (this.tool === 'extend' && this.extendTarget) {
      this.commitDraft();
      return;
    }
    this.renderPreview();
    this.cb.onCursor(snap, this.draft.length);
  }

  /**
   * Choose the line end nearest the tap, and start extending it.
   *
   * Only line *ends* qualify: a line can grow at its terminus, not out of its
   * middle — that would be a branch, which is a different command.
   */
  private pickExtendTarget(lngLat: { lng: number; lat: number }): boolean {
    const render = this.engine.renderState();
    const reach = this.pickRadius() * 2.2;
    let best: { line: number; end: 'start' | 'finish'; d: number } | null = null;
    for (const line of render.lines) {
      if (!line.included || line.stations.length < 2) continue;
      const ends: ['start' | 'finish', number][] = [
        ['start', line.stations[0]],
        ['finish', line.stations[line.stations.length - 1]],
      ];
      for (const [end, id] of ends) {
        const st = render.stations.find((s) => s.id === id);
        if (!st) continue;
        const d = haversine([st.lon, st.lat], [lngLat.lng, lngLat.lat]);
        if (d <= reach && (!best || d < best.d)) best = { line: line.id, end, d };
      }
    }
    if (!best) return false;
    const line = render.lines.find((l) => l.id === best!.line);
    this.extendTarget = { line: best.line, end: best.end };
    this.mode = line?.mode ?? this.mode;
    this.cb.onMessage(
      `${line?.label ?? 'Linie'} wird weitergebaut, tippe an, wohin.`,
      'info'
    );
    return true;
  }

  /** Remove the last draft point. */
  undoDraftPoint() {
    this.draft.pop();
    this.renderPreview();
    this.cb.onCursor(this.cursor, this.draft.length);
  }

  clearDraft() {
    this.draft = [];
    this.cursor = null;
    if (this.estimateTimer) clearTimeout(this.estimateTimer);
    this.cb.onEstimate(null);
    this.setSource('preview', EMPTY);
    this.setSource('preview-stations', EMPTY);
    this.cb.onCursor(null, 0);
  }

  commitDraft() {
    const points = this.draftPoints;
    // When extending, the line's own end is the first point — so a single
    // click is already a segment.
    const extending = this.tool === 'extend' && this.extendTarget;
    if (points.length < (extending ? 1 : 2)) {
      this.cb.onMessage(
        extending ? 'Tippe erst, wohin die Linie weitergehen soll.' : 'Setze mindestens zwei Punkte.',
        'warn'
      );
      return;
    }
    if (extending) {
      this.run(cmd.extendLine(this.extendTarget!.line, this.extendTarget!.end, points, true, points));
    } else {
      this.run(cmd.drawLine(this.mode, points, { color: MODE_COLOR[this.mode], anchors: points }));
    }
    this.clearDraft();
  }

  /** Apply any command and refresh. */
  run(command: unknown) {
    try {
      const diff = this.engine.apply(command);
      this.cb.onChange(diff);
    } catch (e) {
      this.cb.onMessage(String((e as Error)?.message ?? e), 'warn');
      this.cb.onChange(null);
    }
  }

  undo() {
    const d = this.engine.undo();
    this.cb.onChange(d);
  }

  redo() {
    const d = this.engine.redo();
    this.cb.onChange(d);
  }

  // -------------------------------------------------------------- rendering --

  private setSource(id: string, data: GeoJSON.FeatureCollection) {
    // An animation frame can outlive the map — a hot reload, a route change,
    // an unmount mid-flourish. Writing to a map that is gone throws inside a
    // timer, where nothing catches it.
    if (this.destroyed || !this.map) return;
    const src = this.map.getSource(id);
    if (src && 'setData' in src) (src as maplibregl.GeoJSONSource).setData(data);
  }


  private renderPreview() {
    const pts: [number, number][] = [];
    // An extension grows out of the line's existing end, so that end belongs in
    // the preview even before the first click.
    if (this.tool === 'extend' && this.extendTarget) {
      const a = this.anchorOfExtension();
      if (a) pts.push([a.lon, a.lat]);
    }
    pts.push(...this.draft.map((p) => [p.lon, p.lat] as [number, number]));
    if (this.cursor) pts.push([this.cursor.geo.lon, this.cursor.geo.lat]);
    if (pts.length < 2) {
      this.setSource('preview', EMPTY);
      this.setSource('preview-stations', EMPTY);
      return;
    }
    this.setSource('preview', {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { color: MODE_COLOR[this.mode] },
          geometry: { type: 'LineString', coordinates: pts },
        },
      ],
    });
    // The ghost stations are the single most convincing part of the preview:
    // the user sees exactly which stops their line would get (plan §7).
    let previews: StationPreview[] = [];
    try {
      previews = this.engine.previewStations(pts, this.mode);
    } catch {
      previews = [];
    }
    this.setSource('preview-stations', {
      type: 'FeatureCollection',
      features: previews.map((s) => ({
        type: 'Feature',
        properties: { color: MODE_COLOR[this.mode], name: s.name, interchange: s.interchange ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })),
    });
    this.lastPreviewStations = previews;
    if (this.tool !== 'extend') this.schedulePreviewEstimate(pts);
  }

  lastPreviewStations: StationPreview[] = [];

  private estimateTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Cost the line being drawn, throttled.
   *
   * Full enough to be worth showing (a few milliseconds), too heavy for every
   * pointer frame — so it trails the cursor by a beat instead of blocking it.
   */
  private schedulePreviewEstimate(points: [number, number][]) {
    if (this.estimateTimer) clearTimeout(this.estimateTimer);
    if (points.length < 2) {
      this.cb.onEstimate(null);
      return;
    }
    this.estimateTimer = setTimeout(() => {
      try {
        const estimate = this.engine.previewLine(points, this.mode);
        this.cb.onEstimate(estimate.valid ? estimate : null);
      } catch {
        this.cb.onEstimate(null);
      }
    }, 90);
  }

  /** Push the engine's render state into the map sources. */
  syncRender(
    render: RenderState,
    opts: { schematic?: boolean; highlight?: number[]; focusNew?: boolean } = {},
  ) {
    const lines: GeoJSON.Feature[] = [];
    // Stations of lines that survived the filter; see `transitSources`, which
    // seeds the same two sources from the style and has to agree with this.
    const shown = new Set<number>();
    // See `transitSources`: a line that something extends is drawn whole, or the
    // extension starts nowhere.
    const extended = new Set<number>();
    for (const l of render.lines) {
      if (l.included && l.extends != null) extended.add(l.extends);
    }
    for (const l of render.lines) {
      if (!l.included) continue;
      // Reading somebody else's plan, the whole existing network drawn at full
      // strength buries the two lines the plan is actually about. `focusNew`
      // keeps what would be built, plus the rest of any line the author drew, so
      // a route that runs partly on existing track still reads as one route
      // rather than as disconnected fragments.
      const ownLine = l.source !== 'existing' || extended.has(l.id);
      const weight = lineWeight(l.mode);
      let drew = false;
      for (const seg of l.segments) {
        if (opts.focusNew && !ownLine && seg.status !== 'to_build') continue;
        const coords = opts.schematic ? null : seg.geo;
        if (!coords || coords.length < 2) continue;
        drew = true;
        lines.push({
          type: 'Feature',
          properties: {
            id: seg.id,
            line: l.id,
            label: l.label,
            color: l.color,
            weight,
            planned: seg.status === 'to_build' ? 1 : 0,
            opacity: seg.status === 'in_service' ? 1 : 0.92,
          },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
      if (drew) for (const id of l.stations) shown.add(id);
    }
    this.setSource('transit-lines', { type: 'FeatureCollection', features: lines });

    this.setSource('transit-stations', {
      type: 'FeatureCollection',
      features: (opts.focusNew ? render.stations.filter((s) => shown.has(s.id)) : render.stations).map((s) => ({
        type: 'Feature',
        properties: {
          id: s.id,
          name: s.name,
          color: s.colors[0] ?? '#334155',
          interchange: s.interchange ? 1 : 0,
          opacity: s.status === 'in_service' ? 1 : 0.9,
        },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })),
    });

    if (opts.highlight?.length) {
      const set = new Set(opts.highlight);
      this.setSource('highlight', {
        type: 'FeatureCollection',
        features: lines.filter((f) => set.has(f.properties!.id as number)),
      });
    } else {
      this.setSource('highlight', EMPTY);
    }
  }

  // ------------------------------------------------------------ flourish --

  private destroyed = false;
  private revealFrame = 0;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Draw the new line in, and let it land.
   *
   * The head travels along the alignment by *distance*, not by vertex, so the
   * growth is even whether the geometry is dense or sparse. Every station it
   * passes throws off a handful of sparks, and the far end gets a bigger one:
   * the point is that committing a line should feel like something happened.
   *
   * Decoration, deliberately: it lasts under a second, it never touches the
   * committed state, and it is skipped entirely for prefers-reduced-motion.
   */
  private celebrate(render: RenderState, diff: Diff) {
    this.stopReveal();
    const changed = new Set(diff.edgesChanged);
    const line = render.lines.find((l) => l.segments.some((s) => changed.has(s.id)));
    if (!line) return;

    const path: [number, number][] = [];
    for (const seg of line.segments) {
      if (!changed.has(seg.id)) continue;
      for (const c of seg.geo) {
        if (!path.length || path[path.length - 1][0] !== c[0] || path[path.length - 1][1] !== c[1]) {
          path.push(c);
        }
      }
    }
    if (path.length < 2) return;

    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // Cumulative length, so the head can be placed at any fraction of the way.
    const cum = [0];
    for (let i = 1; i < path.length; i++) {
      cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
    }
    const total = cum[cum.length - 1];
    if (total <= 0) return;
    const headAt = (d: number): [number, number] => {
      if (d <= 0) return path[0];
      if (d >= total) return path[path.length - 1];
      let i = 1;
      while (i < cum.length && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9);
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ];
    };
    const upTo = (d: number): [number, number][] => {
      const out: [number, number][] = [path[0]];
      for (let i = 1; i < path.length && cum[i] < d; i++) out.push(path[i]);
      out.push(headAt(d));
      return out;
    };

    // Where each new station sits along the path, as a fraction.
    const stations = render.stations
      .filter((s) => diff.nodesChanged.includes(s.id))
      .map((s) => {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < path.length; i++) {
          const d = haversine(path[i], [s.lon, s.lat]);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        return { lon: s.lon, lat: s.lat, at: cum[best] / total };
      });

    // Each spark is fixed at birth and then just ages, so the burst reads as
    // physical rather than as a wobbling cloud.
    type Spark = { lon: number; lat: number; dx: number; dy: number; born: number; big: boolean };
    const sparks: Spark[] = [];
    const fired = new Set<number>();
    // Metres per degree, near enough at this latitude, so a spark's spread is
    // the same on the ground wherever it goes off.
    const degPerM = 1 / 111_320;

    const duration = 700;
    const start = performance.now();

    const frame = (now: number) => {
      const raw = (now - start) / duration;
      const t = Math.min(1, raw);
      // easeOutCubic, so it arrives rather than stops.
      const e = 1 - Math.pow(1 - t, 3);
      const head = headAt(e * total);

      this.setSource('reveal', {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { color: line.color, opacity: 0.55 * (1 - t) + 0.3 },
            geometry: { type: 'LineString', coordinates: upTo(e * total) },
          },
        ],
      });

      // Rings at the stations the head has reached.
      this.setSource('reveal-pulse', {
        type: 'FeatureCollection',
        features: stations.flatMap((s) => {
          const local = (e - s.at) / 0.35;
          if (local <= 0 || local >= 1) return [];
          return [
            {
              type: 'Feature' as const,
              properties: { color: line.color, radius: 6 + local * 22, opacity: 0.75 * (1 - local) },
              geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
            },
          ];
        }),
      });

      // Sparks: a small puff at each station, a bigger one where it ends.
      stations.forEach((s, i) => {
        if (e >= s.at && !fired.has(i)) {
          fired.add(i);
          sparks.push(...burst(s.lon, s.lat, 7, 26, false));
        }
      });
      if (t >= 1 && !fired.has(-1)) {
        fired.add(-1);
        sparks.push(...burst(head[0], head[1], 14, 46, true));
      }

      const age = (sp: Spark) => (now - sp.born) / (sp.big ? 620 : 460);
      this.setSource('sparks', {
        type: 'FeatureCollection',
        features: [
          // The travelling head, as one bright particle.
          ...(t < 1
            ? [
                {
                  type: 'Feature' as const,
                  properties: { color: line.color, radius: 7, opacity: 0.9 },
                  geometry: { type: 'Point' as const, coordinates: head },
                },
              ]
            : []),
          ...sparks.flatMap((sp) => {
            const a = age(sp);
            if (a >= 1) return [];
            // Fly out fast, then coast — and shrink as they fade.
            const travel = 1 - Math.pow(1 - a, 2.4);
            return [
              {
                type: 'Feature' as const,
                properties: {
                  color: line.color,
                  radius: (sp.big ? 4.2 : 3) * (1 - a * 0.75),
                  opacity: 0.85 * Math.pow(1 - a, 1.5),
                },
                geometry: {
                  type: 'Point' as const,
                  coordinates: [sp.lon + sp.dx * travel, sp.lat + sp.dy * travel],
                },
              },
            ];
          }),
        ],
      });

      const done = t >= 1 && sparks.every((sp) => age(sp) >= 1);
      if (done) {
        this.stopReveal();
        this.setSource('reveal', EMPTY);
        this.setSource('reveal-pulse', EMPTY);
        this.setSource('sparks', EMPTY);
        return;
      }
      this.scheduleReveal(frame);
    };

    function burst(lon: number, lat: number, n: number, reach: number, big: boolean): Spark[] {
      const born = performance.now();
      const out: Spark[] = [];
      const phase = Math.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const r = reach * (0.55 + Math.random() * 0.75) * degPerM;
        out.push({
          lon,
          lat,
          dx: Math.cos(a) * r / Math.cos((lat * Math.PI) / 180),
          dy: Math.sin(a) * r,
          born,
          big,
        });
      }
      return out;
    }

    this.scheduleReveal(frame);
  }

  /**
   * Run the next animation frame.
   *
   * `requestAnimationFrame` does not fire in a background or hidden tab, and a
   * half-drawn line left on screen looks like a bug — so a timer takes over
   * whenever frames stop arriving.
   */
  private scheduleReveal(frame: (now: number) => void) {
    cancelAnimationFrame(this.revealFrame);
    if (this.revealTimer) clearTimeout(this.revealTimer);
    let ran = false;
    const once = (now: number) => {
      if (ran) return;
      ran = true;
      frame(now);
    };
    this.revealFrame = requestAnimationFrame(once);
    this.revealTimer = setTimeout(() => once(performance.now()), 34);
  }

  private stopReveal() {
    cancelAnimationFrame(this.revealFrame);
    if (this.revealTimer) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  /** Play the commit flourish for a diff. */
  flourish(render: RenderState, diff: Diff | null) {
    if (!diff || !diff.edgesChanged.length) return;
    this.celebrate(render, diff);
  }

  /** Mark the station under the pointer. */
  highlightStation(render: RenderState, stationId: number | null) {
    if (stationId == null) {
      this.setSource('hover-station', EMPTY);
      return;
    }
    const s = render.stations.find((x) => x.id === stationId);
    if (!s) {
      this.setSource('hover-station', EMPTY);
      return;
    }
    this.setSource('hover-station', {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { color: s.colors[0] ?? '#888888' },
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        },
      ],
    });
  }

  highlightLine(render: RenderState, lineId: number | null) {
    if (lineId == null) {
      this.setSource('highlight', EMPTY);
      return;
    }
    const line = render.lines.find((l) => l.id === lineId);
    if (!line) return;
    this.setSource('highlight', {
      type: 'FeatureCollection',
      features: line.segments
        .filter((s) => s.geo.length > 1)
        .map((s) => ({
          type: 'Feature',
          properties: { id: s.id },
          geometry: { type: 'LineString', coordinates: s.geo },
        })),
    });
  }
}
