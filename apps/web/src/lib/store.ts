'use client';

// UI state only. The network graph, its geometry and every number derived from
// it live in the Rust engine (plan §65); nothing here duplicates them.

import { create } from 'zustand';
import type { CityEntry } from './engine';
import type { CityFigures } from './explanations';
import type {
  LineDetail,
  Mode,
  QuickEstimate,
  RenderState,
  ScenarioTemplate,
  SimulationResult,
  StationDetail,
} from './types';

export type Tool = 'select' | 'draw' | 'extend' | 'split' | 'delete';
export type SheetState = 'closed' | 'collapsed' | 'half' | 'full';
export type PanelTab = 'analysis' | 'invoice' | 'timeline' | 'economics' | 'feasibility' | 'assumptions';

export interface Selection {
  kind: 'station' | 'line' | 'edge';
  id: number;
}

export interface UiState {
  ready: boolean;
  loadingStage: string;
  loadingFraction: number;
  error: string | null;

  tool: Tool;
  mode: Mode;
  infrastructure: string | null;

  render: RenderState | null;
  quick: QuickEstimate | null;
  result: SimulationResult | null;
  simulating: boolean;

  templates: ScenarioTemplate[];
  templateId: string;
  /** The city currently loaded, and everything the manifest offers. */
  city: CityEntry | null;
  cities: CityEntry[];
  /** The city's own figures, for the explanations that quote them. */
  cityFigures: CityFigures | null;
  scenarioTitle: string;

  selection: Selection | null;
  stationDetail: StationDetail | null;
  lineDetail: LineDetail | null;

  sheet: SheetState;
  panelTab: PanelTab;
  layersOpen: boolean;
  historyOpen: boolean;
  /** The semantic edit history, shown as a list of decisions. */
  history: { done: string[]; undone: string[] };
  reducedMotion: boolean;
  schematic: boolean;
  hint: string | null;

  set: (patch: Partial<UiState>) => void;
  setTool: (t: Tool) => void;
  select: (s: Selection | null) => void;
  showHint: (h: string | null) => void;
}

export const useUi = create<UiState>((set) => ({
  ready: false,
  loadingStage: 'Wird geladen',
  loadingFraction: 0,
  error: null,

  tool: 'select',
  mode: 'ubahn',
  infrastructure: null,

  render: null,
  quick: null,
  result: null,
  simulating: false,

  templates: [],
  templateId: 'beschlossen',
  city: null,
  cityFigures: null,
  cities: [],
  scenarioTitle: 'Mein Entwurf',

  selection: null,
  stationDetail: null,
  lineDetail: null,

  sheet: 'closed',
  panelTab: 'analysis',
  layersOpen: true,
  historyOpen: false,
  history: { done: [], undone: [] },
  reducedMotion: false,
  schematic: false,
  hint: null,

  set: (patch) => set(patch),
  setTool: (tool) =>
    set((s) => ({
      tool,
      selection: tool === 'select' ? s.selection : null,
      stationDetail: tool === 'select' ? s.stationDetail : null,
      lineDetail: tool === 'select' ? s.lineDetail : null,
      hint: TOOL_HINT[tool],
    })),
  select: (selection) => set({ selection, sheet: selection ? 'half' : 'closed' }),
  showHint: (hint) => set({ hint }),
}));

export const TOOL_HINT: Record<Tool, string> = {
  select: 'Tippe eine Linie oder Station an, um zu sehen, was dahintersteckt.',
  draw: 'Jeder Klick setzt eine Station. Dazwischen ergänzt die App weitere. Enter oder Doppelklick beendet die Linie.',
  extend: 'Jeder Klick verlängert die gewählte Linie um eine Station. Die Kosten wachsen mit.',
  split: 'Tippe auf eine Strecke, um dort eine zusätzliche Station einzufügen.',
  delete: 'Tippe an, was wieder verschwinden soll.',
};

export const TOOL_LABEL: Record<Tool, string> = {
  select: 'Ansehen',
  draw: 'Zeichnen',
  extend: 'Weiterbauen',
  split: 'Halt einfügen',
  delete: 'Entfernen',
};
