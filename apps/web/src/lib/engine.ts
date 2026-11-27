'use client';

// Loading and wrapping the Rust/WASM engine.
//
// The browser holds exactly one engine instance for the session. Everything
// that touches the network graph goes through it; nothing about topology,
// geometry, cost or benefit is reimplemented here (plan §47).

import type { CityFigures } from './explanations';
import type {
  ComparisonRow,
  DataVersion,
  Diff,
  LineDetail,
  QuickEstimate,
  RenderState,
  ScenarioTemplate,
  SimulationResult,
  SnapResult,
  StationDetail,
  StationPreview,
  Mode,
  BaseMap,
} from './types';

export interface CityEntry {
  id: string;
  name: string;
  /** "Hamburger", "Berliner" — for the sentences that need one. */
  adjective: string;
  /** Where the population figures come from, and under which licence. */
  statistics: { label: string; licence: string | null };
  center: { lat: number; lon: number };
  files: Record<string, string>;
}

export interface Manifest {
  version: string;
  /** Which city the app opens with when nothing else is asked for. */
  defaultCity: string;
  cities: Record<string, CityEntry>;
  /** The default city's files, for clients from before the manifest grew. */
  files: Record<string, string>;
  generated: string;
}

export interface EngineBundle {
  engine: WasmEngine;
  basemap: BaseMap;
  city: CityEntry;
  manifest: Manifest;
}

/** The subset of the generated binding we use, typed. */
interface WasmEngine {
  renderState(): RenderState;
  quickEstimate(): QuickEstimate;
  simulate(): SimulationResult;
  snapPoint(
    lon: number,
    lat: number,
    originLon: number | undefined,
    originLat: number | undefined,
    mode: string,
    metresPerPixel: number,
    coarsePointer: boolean
  ): SnapResult;
  previewStations(points: [number, number][], mode: string): StationPreview[];
  previewLine(points: [number, number][], mode: string): import('./controller').DrawEstimate;
  apply(command: unknown): Diff;
  undo(): Diff | null;
  redo(): Diff | null;
  canUndo(): boolean;
  canRedo(): boolean;
  history(): { done: string[]; undone: string[] };
  templates(): ScenarioTemplate[];
  loadTemplate(id: string): ScenarioTemplate;
  setLineIncluded(line: number, included: boolean): Diff;
  stationDetail(id: number): StationDetail;
  lineDetail(id: number): LineDetail;
  toDocument(title: string): string;
  loadDocument(json: string): {
    title: string;
    description: string;
    calculationVersion: string;
    dataVersion: string;
    current: boolean;
    /** Drawn on an earlier state of the city data. */
    olderData: boolean;
  };
  /** Loads a published plan for reading, even when today's network has moved
   *  some of its existing track; `loadDocument` refuses that for editing. */
  showDocument(json: string): ReturnType<WasmEngine['loadDocument']>;
  recalculateWithCurrentModel(): SimulationResult;
  /** Figures for a document, without loading it into the editor. */
  simulateDocument(json: string): SimulationResult;
  params(): unknown;
  /** The city's own parameters, unaffected by a loaded document. */
  cityParams(): unknown;
  dataSources(): DataVersion;
  provenance(): CityFigures['provenance'];
  compareWith(json: string): ComparisonRow[];
  allowedInfrastructure(mode: string): [string, string][];
  pickEdge(lon: number, lat: number, radiusM: number): [number, number, number] | null;
  free(): void;
}

export type { WasmEngine };

// One bundle per city id, keyed by the id the caller asked for ('' meaning
// "whatever the manifest calls default").
const bundles = new Map<string, Promise<EngineBundle>>();

async function fetchJson<T>(url: string, onProgress?: (loaded: number) => void): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!onProgress || !res.body) return (await res.json()) as T;
  // Stream so the loading screen can show real progress on the big datasets.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded);
  }
  const merged = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.length;
  }
  return JSON.parse(new TextDecoder().decode(merged)) as T;
}

export interface LoadProgress {
  stage: string;
  fraction: number;
  /** Known from the manifest onwards, so the loading screen can name the
   *  city's own data sources instead of the default city's. */
  city?: CityEntry;
}

/**
 * Just enough to draw a map: the base map and the manifest, no engine.
 *
 * The wish map renders an aggregate the server computed; it calculates nothing
 * itself, so it has no use for the engine, the network or the five megabyte
 * population grid. Loading all of it would cost a visitor twelve megabytes to
 * look at one picture.
 */
export async function loadBasemapOnly(
  cityId?: string
): Promise<{ basemap: BaseMap; city: CityEntry; cities: CityEntry[] }> {
  const manifest = await fetchJson<Manifest>(`/data/manifest.json?t=${Date.now()}`);
  const cities = Object.values(manifest.cities ?? {});
  const city = manifest.cities?.[cityId ?? manifest.defaultCity] ?? cities[0];
  const files = city?.files ?? manifest.files;
  const basemap = JSON.parse(await fetchText(`/data/${files.basemap}`)) as BaseMap;
  return { basemap, city, cities };
}

/**
 * Load the datasets and construct the engine. Idempotent: repeated calls share
 * the same promise, so React strict mode double-invocation is harmless.
 */
export function loadEngine(
  onProgress?: (p: LoadProgress) => void,
  cityId?: string
): Promise<EngineBundle> {
  // One engine per city, because the metric projection the engine works in is
  // anchored on the city it was built for.
  const key = cityId ?? '';
  const cached = bundles.get(key);
  if (cached) return cached;
  const promise = (async () => {
    let known: CityEntry | undefined;
    const report = (stage: string, fraction: number) =>
      onProgress?.({ stage, fraction, city: known });
    report('Datenstand wird geladen', 0.02);
    // The manifest names content-hashed files, so it is the one thing that
    // must always be fetched fresh.
    const manifest = await fetchJson<Manifest>(`/data/manifest.json?t=${Date.now()}`);
    const city = manifest.cities?.[cityId ?? manifest.defaultCity];
    known = city;
    const files = city?.files ?? manifest.files;

    report('Karte wird geladen', 0.08);
    const base = `/data/`;
    // Roughly the compressed sizes, used to weight the progress bar.
    const [basemapText, cityText, networkText, scenariosText, paramsText] = await Promise.all([
      fetchText(base + files.basemap, (l) => report('Karte wird geladen', 0.08 + Math.min(l / 4.6e6, 1) * 0.3)),
      fetchText(base + files.city, (l) => report('Stadtdaten werden geladen', 0.38 + Math.min(l / 4.2e6, 1) * 0.3)),
      fetchText(base + files.network),
      fetchText(base + files.scenarios),
      // The city's own parameter set. It is small, and without it the engine
      // falls back to the built-in defaults — which are one city's figures.
      fetchText(base + files.params),
    ]);

    report('Modell wird gestartet', 0.75);
    const wasm = await import('../wasm/hh_wasm.js');
    // The glue carries the content hash of the module it was generated with,
    // so no explicit path is needed and a stale cached engine cannot be paired
    // with fresh bindings.
    await wasm.default();
    report('Netz wird aufgebaut', 0.85);
    const engine = new wasm.Engine(
      cityText,
      networkText,
      scenariosText,
      paramsText
    ) as unknown as WasmEngine;
    report('Fertig', 1);
    return {
      engine,
      basemap: JSON.parse(basemapText) as BaseMap,
      manifest,
      city: city ?? {
        id: manifest.defaultCity ?? 'hamburg',
        name: 'Hamburg',
        adjective: 'Hamburger',
        statistics: { label: 'Statistikamt Nord', licence: 'dl-de/by-2-0' },
        center: { lat: 53.5511, lon: 9.9937 },
        files,
      },
    };
  })();
  bundles.set(key, promise);
  return promise;
}

async function fetchText(url: string, onProgress?: (loaded: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!onProgress || !res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded);
  }
  const merged = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(merged);
}

// --------------------------------------------------------------- commands --

export const cmd = {
  drawLine(
    mode: Mode,
    points: { lat: number; lon: number }[],
    opts: {
      infrastructure?: string;
      label?: string;
      color?: string;
      autoStations?: boolean;
      /** Positions the user pointed at; each becomes a station. */
      anchors?: { lat: number; lon: number }[];
    } = {}
  ) {
    return {
      type: 'drawLine',
      mode,
      infrastructure: opts.infrastructure ?? null,
      points,
      label: opts.label ?? null,
      color: opts.color ?? null,
      autoStations: opts.autoStations ?? true,
      anchors: opts.anchors ?? null,
    };
  },
  extendLine(
    line: number,
    end: 'start' | 'finish',
    points: { lat: number; lon: number }[],
    autoStations = true,
    anchors?: { lat: number; lon: number }[]
  ) {
    return { type: 'extendLine', line, end, points, autoStations, anchors: anchors ?? null };
  },
  shortenLine(line: number, end: 'start' | 'finish', count: number) {
    return { type: 'shortenLine', line, end, count };
  },
  splitEdge(edge: number, alongM: number, name?: string) {
    return { type: 'splitEdge', edge, alongM, name: name ?? null };
  },
  mergeAtNode(node: number) {
    return { type: 'mergeAtNode', node };
  },
  removeStation(node: number) {
    return { type: 'removeStation', node };
  },
  moveNode(node: number, to: { lat: number; lon: number }) {
    return { type: 'moveNode', node, to };
  },
  deleteEdge(edge: number) {
    return { type: 'deleteEdge', edge };
  },
  deleteLine(line: number) {
    return { type: 'deleteLine', line };
  },
  connectNodes(a: number, b: number, mode: Mode, infrastructure?: string) {
    return { type: 'connectNodes', a, b, mode, infrastructure: infrastructure ?? null };
  },
  changeInfrastructure(edge: number, infrastructure: string) {
    return { type: 'changeInfrastructure', edge, infrastructure };
  },
  setLineIncluded(line: number, included: boolean) {
    return { type: 'setLineIncluded', line, included };
  },
  renameNode(node: number, name: string) {
    return { type: 'renameNode', node, name };
  },
  setLineStyle(line: number, style: { label?: string; name?: string; color?: string }) {
    return {
      type: 'setLineStyle',
      line,
      label: style.label ?? null,
      name: style.name ?? null,
      color: style.color ?? null,
    };
  },
  regenerateStations(line: number) {
    return { type: 'regenerateStations', line };
  },
};

/**
 * The figures the explanations quote about a city — its VAT share, its subsoil,
 * how its population was counted.
 *
 * Derived here rather than in the editor because the plan pages need the same
 * thing: an explanation on someone else's Berlin plan that quotes Hamburg's
 * numbers is worse than one that quotes none, and the editor's copy was the
 * only one that existed.
 */
export function cityFiguresFrom(bundle: EngineBundle): CityFigures {
  const params = bundle.engine.cityParams() as {
    fiscal?: { vatCityShare?: number };
    cost?: { groundConditionsFactor?: number };
  };
  const city = bundle.city;
  return {
    name: city?.name ?? 'Hamburg',
    adjective: city?.adjective ?? city?.name ?? 'Hamburg',
    vatCityShare: params?.fiscal?.vatCityShare ?? 0,
    groundConditionsFactor: params?.cost?.groundConditionsFactor ?? 1,
    provenance: bundle.engine.provenance(),
  };
}
