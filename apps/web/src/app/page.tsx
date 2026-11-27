'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { MapCanvas } from '@/components/MapCanvas';
import { Analysis } from '@/components/editor/Analysis';
import { Layers } from '@/components/editor/Layers';
import { LineInspector, StationInspector } from '@/components/editor/Inspector';
import { ModeSwitch, ToolRail } from '@/components/editor/Toolbar';
import { BottomSheet } from '@/components/BottomSheet';
import { ScenarioBar } from '@/components/editor/ScenarioBar';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Welcome } from '@/components/Welcome';
import { cityFiguresFrom, cmd, loadEngine, type WasmEngine } from '@/lib/engine';
import { existingSwitchedOff, ownWorkOnly, scopeOf } from '@/lib/publish-scope';
import type { DrawEstimate, EditorController } from '@/lib/controller';
import { ask, askText } from '@/components/Dialog';
import { api, session } from '@/lib/api';
import { ensureSession } from '@/lib/account';
import { useUi, type UiState } from '@/lib/store';
import type { BaseMap, Diff, LineDetail, StationDetail } from '@/lib/types';
import { count, eur, eurRange, km } from '@/lib/format';
import { useMediaQuery } from '@/hooks/useMediaQuery';

import { CITY_KEY, DRAFT_KEY, DRAFT_TEMPLATE_KEY } from '@/lib/drafts';

/**
 * Which city to open.
 *
 * `?stadt=berlin` wins, so a link can point at one; otherwise the last one
 * used; otherwise whatever the manifest calls default. Each city has its own
 * saved draft, because a Hamburg network makes no sense on a Berlin map.
 */
function initialCity(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const asked = new URLSearchParams(window.location.search).get('stadt');
  if (asked) return asked.toLowerCase();
  try {
    return localStorage.getItem(CITY_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export default function EditorPage() {
  const ui = useUi();
  const engineRef = useRef<WasmEngine | null>(null);
  const controllerRef = useRef<EditorController | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [basemap, setBasemap] = useState<BaseMap | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [dark, setDark] = useState(false);
  const [sidebar, setSidebar] = useState<'layers' | 'analysis'>('analysis');
  const [drawing, setDrawing] = useState(0);
  const [estimate, setEstimate] = useState<DrawEstimate | null>(null);
  const [lastDiff, setLastDiff] = useState<Diff | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isTablet = useMediaQuery('(min-width: 700px)');

  // ------------------------------------------------------------ bootstrap --

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    const wanted = initialCity();
    loadEngine(
      (p) => ui.set({ loadingStage: p.stage, loadingFraction: p.fraction, city: p.city ?? useUi.getState().city }),
      wanted
    )
      .then(({ engine, basemap, manifest, city }) => {
        engineRef.current = engine;
        try {
          localStorage.setItem(CITY_KEY, city.id);
        } catch {}
        if (process.env.NODE_ENV !== 'production') {
          (window as unknown as { __engine?: WasmEngine }).__engine = engine;
        }
        setBasemap(basemap);
        // Pick up an unfinished draft from a previous visit.
        let restored: string | null = null;
        let staleModel: string | null = null;
        let brokenDraft = false;
        let templateId = 'beschlossen';
        const draftKey = `${DRAFT_KEY}-${city.id}`;
        try {
          const saved = localStorage.getItem(draftKey);
          if (saved) {
            const info = engine.loadDocument(saved);
            restored = info.title;
            // A saved document carries the parameters it was computed with, so
            // that a published record stays reproducible. An unfinished draft
            // is not a record: left on an old model it would show figures that
            // change the moment it is published, which is the worst possible
            // moment to find out. Bring it forward and say so.
            if (!info.current) {
              engine.recalculateWithCurrentModel();
              staleModel = info.calculationVersion;
            }
            templateId = localStorage.getItem(`${DRAFT_TEMPLATE_KEY}-${city.id}`) ?? '';
          }
        } catch {
          restored = null;
          // A draft that no longer loads would be overwritten by the next
          // autosave. It is put aside instead, so that the work is not lost
          // without a word and can still be recovered from the browser.
          try {
            const bad = localStorage.getItem(draftKey);
            if (bad) {
              localStorage.setItem(`${draftKey}-broken`, bad);
              localStorage.removeItem(draftKey);
              brokenDraft = true;
            }
          } catch {}
        }
        // A template id saved for another city will not exist here. An *empty*
        // one is different: it means a document was loaded rather than a
        // template picked, and the header says "Eigener Entwurf" for it.
        // Treating that as unknown too made the header claim "Bestand 2026"
        // over a network that was nothing of the sort.
        const known =
            templateId === '' || engine.templates().some((t: { id: string }) => t.id === templateId);
        if (!known) templateId = engine.templates()[0]?.id ?? 'bestand';
        if (!restored) engine.loadTemplate(templateId);
        // The figures the "i" explanations quote describe the *city*, so they
        // come from `cityParams()` rather than `params()`. The two differ the
        // moment a document is loaded: restoring the draft above replaces the
        // engine's working parameters with the ones that draft was computed
        // with. Reading those here would have made the explanations describe a city
        // nobody had opened.
        ui.set({
          ready: true,
          city,
          cityFigures: cityFiguresFrom({ engine, basemap, manifest, city }),
          cities: Object.values(manifest.cities ?? {}),
          templates: engine.templates(),
          templateId,
          scenarioTitle: restored ?? 'Mein Entwurf',
          render: engine.renderState(),
          quick: engine.quickEstimate(),
          history: engine.history(),
        });
        if (restored) {
          showToast(
            staleModel
              ? `„${restored}" wiederhergestellt und mit dem aktuellen Modell neu gerechnet (vorher ${staleModel})`
              : `„${restored}" wiederhergestellt`
          );
        } else if (brokenDraft) {
          showToast(
            'Der zuletzt gespeicherte Entwurf ließ sich nicht öffnen und wurde im Browser beiseitegelegt.',
            'warn'
          );
        }
        scheduleSimulation();
      })
      .catch((e) => ui.set({ error: String(e?.message ?? e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Declared before `scheduleSimulation`, which calls it. The order matters:
  // a dependency array is evaluated while the component renders, so naming a
  // callback that is defined further down would read it in its temporal dead
  // zone and throw. It worked only because the dependency was left out.
  const showToast = useCallback((text: string, tone: 'info' | 'warn' = 'info') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const scheduleSimulation = useCallback(() => {
    if (simTimer.current) clearTimeout(simTimer.current);
    useUi.setState({ simulating: true });
    // The full analysis is ~20 ms; debouncing keeps it off the drawing path.
    simTimer.current = setTimeout(() => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        useUi.setState({ result: engine.simulate(), simulating: false });
      } catch (e) {
        useUi.setState({ simulating: false });
        showToast(String((e as Error).message ?? e), 'warn');
      }
    }, 140);
  }, [showToast]);

  /** Keep the working draft in the browser so a reload never loses it. */
  const autosave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        const id = useUi.getState().city?.id ?? 'hamburg';
        localStorage.setItem(`${DRAFT_KEY}-${id}`, engine.toDocument(useUi.getState().scenarioTitle));
        localStorage.setItem(`${DRAFT_TEMPLATE_KEY}-${id}`, useUi.getState().templateId);
      } catch {
        // A full or disabled storage is not worth interrupting the user over.
      }
    }, 600);
  }, []);

  const refresh = useCallback(
    (_diff: Diff | null) => {
      const engine = engineRef.current;
      if (!engine) return;
      ui.set({
        render: engine.renderState(),
        quick: engine.quickEstimate(),
        history: engine.history(),
      });
      scheduleSimulation();
      autosave();
      // Keep the open inspector in sync with the change that just landed.
      const sel = useUi.getState().selection;
      if (sel) refreshSelection(sel.kind, sel.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleSimulation, autosave]
  );

  const refreshSelection = useCallback((kind: 'station' | 'line' | 'edge', id: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      if (kind === 'station') {
        useUi.setState({ stationDetail: engine.stationDetail(id) as StationDetail, lineDetail: null });
      } else if (kind === 'line') {
        useUi.setState({ lineDetail: engine.lineDetail(id) as LineDetail, stationDetail: null });
      }
    } catch {
      useUi.setState({ selection: null, stationDetail: null, lineDetail: null, sheet: 'closed' });
    }
  }, []);

  const handlePick = useCallback(
    (kind: 'station' | 'line' | 'edge', id: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      if (id < 0) {
        useUi.setState({ selection: null, stationDetail: null, lineDetail: null, sheet: 'closed' });
        return;
      }
      if (kind === 'edge') {
        // Selecting a segment selects the line that runs over it.
        const render = useUi.getState().render;
        const line = render?.lines.find((l) => l.segments.some((s) => s.id === id));
        if (line) {
          useUi.setState({ selection: { kind: 'line', id: line.id }, sheet: 'half' });
          refreshSelection('line', line.id);
        }
        return;
      }
      useUi.setState({ selection: { kind, id }, sheet: 'half' });
      refreshSelection(kind, id);
    },
    [refreshSelection]
  );

  // ------------------------------------------------------------- shortcuts --

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const c = controllerRef.current;
      if (!c) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? c.redo() : c.undo();
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'v': setTool('select'); break;
        case 'd': setTool('draw'); break;
        case 'e': setTool('extend'); break;
        case 's': setTool('split'); break;
        case 'x': setTool('delete'); break;
        case 'enter': c.commitDraft(); break;
        case 'escape': c.clearDraft(); setDrawing(0); break;
        case 'backspace': if (c.hasDraft) { e.preventDefault(); c.undoDraftPoint(); } break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The parameter type comes from the store, not from the `ui` snapshot: a
  // type-level mention of a value still counts as a dependency to the hooks
  // lint, and there is nothing there that can go stale.
  const setTool = useCallback((t: Parameters<UiState['setTool']>[0]) => {
    useUi.getState().setTool(t);
    controllerRef.current?.setTool(t);
  }, []);

  // --------------------------------------------------------------- actions --

  const toggleLine = useCallback(
    (id: number, included: boolean) => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        engine.setLineIncluded(id, included);
        refresh(null);
      } catch (e) {
        showToast(String((e as Error).message), 'warn');
      }
    },
    [refresh, showToast]
  );

  const loadTemplate = useCallback(
    (id: string) => {
      const engine = engineRef.current;
      if (!engine) return;
      const t = engine.loadTemplate(id);
      useUi.setState({ templateId: id, scenarioTitle: t.title, selection: null, stationDetail: null, lineDetail: null, sheet: 'closed' });
      refresh(null);
      showToast(`Szenario „${t.title}" geladen`);
    },
    [refresh, showToast]
  );

  const focusStation = useCallback((id: number) => {
    const engine = engineRef.current;
    const map = mapRef.current;
    if (!engine || !map) return;
    const d = engine.stationDetail(id);
    map.easeTo({ center: [d.lon, d.lat], zoom: Math.max(map.getZoom(), 13.4), duration: 600 });
    handlePick('station', id);
  }, [handlePick]);

  // ------------------------------------------------------------------ view --

  const quick = ui.quick;
  const sel = ui.selection;

  // Switching parts of the existing network off is a legitimate thing to try,
  // and it turns every headline figure negative. The analysis panel says so
  // rather than leaving the reader to conclude the model is broken.
  const existingOff = useMemo(
    () => (ui.render?.lines ?? []).filter((l) => l.source === 'existing' && !l.included).length,
    [ui.render],
  );

  // Explaining the minus sign is not enough on its own. Nobody switches the
  // whole existing network off on purpose to appraise a tram line; they clear
  // the list to see their own work and the appraisal quietly becomes "what if
  // Hamburg had no trains". One click back.
  const restoreExisting = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      for (const l of useUi.getState().render?.lines ?? []) {
        if (l.source === 'existing' && !l.included) engine.setLineIncluded(l.id, true);
      }
      refresh(null);
    } catch (e) {
      showToast(String((e as Error).message), 'warn');
    }
  }, [refresh, showToast]);

  const inspector = useMemo(() => {
    const engine = engineRef.current;
    if (!engine || !sel) return null;
    if (sel.kind === 'station' && ui.stationDetail) {
      return (
        <StationInspector
          detail={ui.stationDetail}
          onFocus={() => focusStation(ui.stationDetail!.id)}
          onRename={(name) => controllerRef.current?.run(cmd.renameNode(ui.stationDetail!.id, name))}
          onRemove={() => controllerRef.current?.run(cmd.removeStation(ui.stationDetail!.id))}
        />
      );
    }
    if (sel.kind === 'line' && ui.lineDetail) {
      const d = ui.lineDetail;
      return (
        <LineInspector
          detail={d}
          infrastructures={engine.allowedInfrastructure(d.mode)}
          onExtend={(end) => {
            controllerRef.current?.setExtendTarget({ line: d.id, end });
            setTool('extend');
            showToast('Tippe an, wohin die Linie weitergehen soll, denn jeder Klick verlängert sie um eine Station.');
          }}
          onShorten={(end) => controllerRef.current?.run(cmd.shortenLine(d.id, end, 1))}
          onDelete={() => {
            controllerRef.current?.run(cmd.deleteLine(d.id));
            useUi.setState({ selection: null, lineDetail: null, sheet: 'closed' });
          }}
          onRegenerate={() => controllerRef.current?.run(cmd.regenerateStations(d.id))}
          onToggle={(included) => toggleLine(d.id, included)}
          onFocusStation={focusStation}
          onSetColor={(color) => controllerRef.current?.run(cmd.setLineStyle(d.id, { color }))}
        />
      );
    }
    return null;
  }, [sel, ui.stationDetail, ui.lineDetail, focusStation, setTool, showToast, toggleLine]);

  if (ui.error) {
    return (
      <main className="grid h-full grid-cols-1 place-items-center p-8 text-center">
        <div>
          <h1 className="text-lg font-semibold">Das Modell konnte nicht geladen werden</h1>
          <p className="mt-2 max-w-md text-sm text-muted">{ui.error}</p>
        </div>
      </main>
    );
  }

  if (!ui.ready || !basemap || !engineRef.current) {
    return <LoadingScreen stage={ui.loadingStage} fraction={ui.loadingFraction} city={ui.city} />;
  }

  const sheetTitle = sel
    ? sel.kind === 'station'
      ? ui.stationDetail?.name ?? ''
      : ui.lineDetail?.name ?? ''
    : 'Analyse';
  const sheetSubtitle = sel
    ? sel.kind === 'station'
      ? ui.stationDetail?.lines.map((l) => l[0]).join(' · ')
      : `${ui.lineDetail ? km(ui.lineDetail.lengthKm) : ''}`
    : quick
      ? `${km(quick.newKm)} neu · ${quick.investmentEur > 0 ? eur(quick.investmentEur) : 'nichts zu bauen'}`
      : '';

  return (
    <main className="flex h-full flex-col overflow-hidden bg-paper">
      {/* Reaching the map or the analysis by tabbing means passing sixty line
          checkboxes. These land you there in one keystroke, and stay out of
          the way until they are focused. */}
      <nav aria-label="Direkt zu" className="sr-only focus-within:not-sr-only">
        <div className="absolute left-2 top-2 z-50 flex gap-2">
          <button
            className="btn btn-primary"
            onClick={() => {
              // The canvas, not its container. MapLibre gives the canvas
              // tabindex="0" and leaves the wrapper unfocusable, so calling
              // focus() on the wrapper did nothing at all: the link looked
              // right, read right, and moved nobody anywhere.
              const el = document.querySelector<HTMLElement>('canvas.maplibregl-canvas');
              el?.focus();
            }}
          >
            Zur Karte
          </button>
          <button
            className="btn btn-primary"
            onClick={() => document.getElementById('analyse-panel')?.focus()}
          >
            Zur Analyse
          </button>
          <button
            className="btn btn-primary"
            onClick={() => document.getElementById('linien-panel')?.focus()}
          >
            Zu den Linien
          </button>
        </div>
      </nav>
      <ScenarioBar
        templates={ui.templates}
        templateId={ui.templateId}
        onTemplate={loadTemplate}
        cities={ui.cities}
        cityId={ui.city?.id ?? ''}
        onCity={(id) => {
          // A different city is a different engine and a different map, and
          // the draft belongs to the city it was drawn in. Reloading with the
          // city in the address is simpler than tearing down the map, and it
          // makes the choice linkable.
          try {
            localStorage.setItem('hh-city', id);
          } catch {}
          window.location.href = `/?stadt=${encodeURIComponent(id)}`;
        }}
        onUndo={() => controllerRef.current?.undo()}
        onRedo={() => controllerRef.current?.redo()}
        history={ui.history}
        onUndoSteps={(n) => {
          for (let i = 0; i < n; i++) controllerRef.current?.undo();
        }}
        onRedoSteps={(n) => {
          for (let i = 0; i < n; i++) controllerRef.current?.redo();
        }}
        canUndo={engineRef.current.canUndo()}
        canRedo={engineRef.current.canRedo()}
        dark={dark}
        onDark={(v) => {
          setDark(v);
          document.documentElement.classList.toggle('dark', v);
          try { localStorage.setItem('hh-theme', v ? 'dark' : 'light'); } catch {}
        }}
        onSave={async () => {
          const engine = engineRef.current;
          if (!engine) return;
          const title = await askText('Entwurf speichern', 'Titel', useUi.getState().scenarioTitle, {
            hint: 'Die Datei landet in deinem Download-Ordner und lässt sich später wieder öffnen.',
          });
          if (!title) return;
          const json = engine.toDocument(title);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${title.replace(/[^\w\d-]+/g, '-').toLowerCase()}.hhnetz.json`;
          a.click();
          URL.revokeObjectURL(url);
          useUi.setState({ scenarioTitle: title });
          showToast('Entwurf gespeichert');
        }}
        onLoad={(json) => {
          const engine = engineRef.current;
          if (!engine) return;
          try {
            const info = engine.loadDocument(json);
            // Same reasoning as the restored draft: the editor is where you
            // work on a plan, not where an old result is preserved. Opening a
            // file to keep editing it and being shown figures from a
            // superseded model helps nobody — least of all when publishing
            // would quietly produce different ones.
            if (!info.current) engine.recalculateWithCurrentModel();
            useUi.setState({ scenarioTitle: info.title, templateId: '' });
            refresh(null);
            const loaded = info.current
              ? `„${info.title}" geladen`
              : `„${info.title}" geladen und mit dem aktuellen Modell neu gerechnet (vorher ${info.calculationVersion})`;
            showToast(
              info.olderData
                ? `${loaded}; weil er auf dem Datenstand ${info.dataVersion} gezeichnet wurde, kann das heutige Netz von ihm abweichen.`
                : loaded,
              info.olderData ? 'warn' : undefined
            );
          } catch (e) {
            showToast(String((e as Error).message), 'warn');
          }
        }}
        onPublish={() => publishScenario(engineRef.current!, showToast)}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop: tools on the left, analysis on the right (plan §19). */}
        {isDesktop && (
          <aside
            id="linien-panel"
            tabIndex={-1}
            aria-label="Linien und Werkzeuge"
            className="flex w-[336px] shrink-0 flex-col border-r border-line bg-paper"
          >
            <div className="border-b border-line p-3">
              <ModeSwitch
                mode={ui.mode}
                onMode={(m) => {
                  useUi.setState({ mode: m });
                  controllerRef.current?.setMode(m);
                }}
              />
              <div className="mt-2">
                <ToolRail tool={ui.tool} onTool={setTool} />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted">
                {ui.hint ??
                  (ui.tool === 'draw' || ui.tool === 'extend'
                    ? 'Jeder Klick setzt eine Station, während die App dazwischen weitere ergänzt. Ohne Maus wählst du die Karte an, zielst mit den Pfeiltasten, setzt mit der Leertaste eine Station und beendest die Linie mit Enter.'
                    : 'Beim Zeichnen setzt jeder Klick eine Station, während die App dazwischen weitere ergänzt.')}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Layers
                lines={ui.render?.lines ?? []}
                onToggle={toggleLine}
                onSelect={(id) => handlePick('line', id)}
                onHover={setHoverLine}
                selectedLine={sel?.kind === 'line' ? sel.id : null}
              />
            </div>
          </aside>
        )}

        <div className="relative min-w-0 flex-1">
          <MapCanvas
            engine={engineRef.current}
            basemap={basemap}
            render={ui.render}
            dark={dark}
            initialCenter={ui.city ? [ui.city.center.lon, ui.city.center.lat] : undefined}
            city={ui.city}
            tool={ui.tool}
            schematic={ui.schematic}
            highlightLine={hoverLine ?? (sel?.kind === 'line' ? sel.id : null)}
            onReady={(c, m) => {
              controllerRef.current = c;
              mapRef.current = m;
              c.setTool(useUi.getState().tool);
              c.setMode(useUi.getState().mode);
              if (useUi.getState().render) c.syncRender(useUi.getState().render!);
            }}
            onChange={(d) => {
              setDrawing(0);
              setEstimate(null);
              setLastDiff(d);
              refresh(d);
            }}
            onPick={handlePick}
            onMessage={showToast}
            onDraft={setDrawing}
            onEstimate={setEstimate}
            selectedStation={sel?.kind === 'station' ? sel.id : null}
            lastDiff={lastDiff}
          />

          {/* What the line being drawn would add, while it is being drawn. */}
          {estimate && isDesktop && <DrawFeedback estimate={estimate} />}

          {/* Finishing a line, on a desktop.
              These three controls existed only in the phone layout. On a wide
              screen the line being drawn followed the pointer with nothing on
              screen to say how to end it: the ways out were a double-click, or
              Enter, or Escape, and the interface named none of them. Someone
              who did not already know was left dragging a rubber band around. */}
          {isDesktop && drawing > 0 && (
            <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2 rounded-xl border border-line bg-surface/95 p-2 shadow-lg backdrop-blur">
              <button
                className="btn"
                onClick={() => controllerRef.current?.undoDraftPoint()}
                title="Letzten Punkt zurücknehmen (Rücktaste)"
              >
                Punkt zurück
              </button>
              <button
                className="btn"
                onClick={() => {
                  controllerRef.current?.clearDraft();
                  setDrawing(0);
                }}
                title="Verwerfen (Esc)"
              >
                Abbrechen
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  controllerRef.current?.commitDraft();
                  setDrawing(0);
                }}
                title="Linie abschließen (Enter oder Doppelklick)"
              >
                Fertig ({drawing})
              </button>
            </div>
          )}

          {/* Live readout while drawing — the cost counter the plan asks for. */}
          {quick && (
            <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-xl border border-line bg-surface/90 px-3 py-2 shadow-sm backdrop-blur">
              <div className="text-[11px] uppercase tracking-wide text-muted">
                {quick.newKm > 0 ? 'Das würde gebaut' : 'Noch nichts geplant'}
              </div>
              <div className="text-[15px] font-semibold tabular-nums">
                {km(quick.newKm)} · {quick.newStations} Stationen
              </div>
              <div className="text-[13px] tabular-nums">
                {quick.investmentEur > 0 ? eurRange(quick.investmentLowEur, quick.investmentHighEur) : 'keine Investition'}
              </div>
              {quick.openingYear ? (
                <div className="text-[12px] text-muted">fertig etwa {quick.openingYear}</div>
              ) : (
                <div className="text-[12px] text-muted">Zeichne eine Linie, um zu sehen, was sie kosten würde</div>
              )}
            </div>
          )}

          {/* Mobile / tablet floating controls (plan §21). */}
          {!isDesktop && (
            <>
              <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 space-y-2">
                {estimate && <DrawFeedback estimate={estimate} inline />}
                {drawing > 0 && (
                  <div className="flex gap-2 rounded-xl border border-line bg-surface/95 p-2 shadow-lg backdrop-blur">
                    <button className="btn flex-1" onClick={() => controllerRef.current?.undoDraftPoint()}>
                      Punkt zurück
                    </button>
                    <button className="btn flex-1" onClick={() => { controllerRef.current?.clearDraft(); setDrawing(0); }}>
                      Abbrechen
                    </button>
                    <button className="btn btn-primary flex-1" onClick={() => { controllerRef.current?.commitDraft(); setDrawing(0); }}>
                      Fertig ({drawing})
                    </button>
                  </div>
                )}
                <div className="rounded-2xl border border-line bg-surface/95 p-2 shadow-lg backdrop-blur">
                  <ModeSwitch
                    mode={ui.mode}
                    onMode={(m) => {
                      useUi.setState({ mode: m });
                      controllerRef.current?.setMode(m);
                    }}
                  />
                  <div className="mt-2 flex items-center gap-1">
                    <ToolRail tool={ui.tool} onTool={setTool} variant="compact" />
                    <button
                      className="ml-auto btn shrink-0"
                      onClick={() => useUi.setState({ sheet: ui.sheet === 'closed' ? 'half' : 'closed', selection: null })}
                    >
                      Analyse
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSidebar(sidebar === 'layers' ? 'analysis' : 'layers')}
                className="absolute right-3 top-3 z-20 btn bg-surface/90 backdrop-blur"
              >
                Linien
              </button>
              {sidebar === 'layers' && (
                <div className="absolute inset-y-0 right-0 z-30 w-[min(340px,88vw)] overflow-y-auto border-l border-line bg-paper shadow-xl animate-rise">
                  <div className="flex items-center justify-between border-b border-line px-3 py-2">
                    <span className="text-[13px] font-semibold">Linien</span>
                    <button className="btn" onClick={() => setSidebar('analysis')}>
                      Schließen
                    </button>
                  </div>
                  <Layers
                    lines={ui.render?.lines ?? []}
                    onToggle={toggleLine}
                    onSelect={(id) => handlePick('line', id)}
                    onHover={setHoverLine}
                    selectedLine={sel?.kind === 'line' ? sel.id : null}
                  />
                </div>
              )}
            </>
          )}

          <Welcome templates={ui.templates} onPick={loadTemplate} city={ui.city?.name} />

          {toast && (
            <div
              role="status"
              className={`absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-lg px-3 py-2 text-[13px] shadow-lg animate-rise ${
                toast.tone === 'warn' ? 'bg-rose-600 text-white' : 'bg-ink text-paper'
              }`}
            >
              {toast.text}
            </div>
          )}

          {!isDesktop && (
            <BottomSheet
              state={ui.sheet}
              onState={(s) => useUi.setState({ sheet: s })}
              title={sheetTitle}
              subtitle={sheetSubtitle}
              onClose={() => useUi.setState({ sheet: 'closed', selection: null, stationDetail: null, lineDetail: null })}
            >
              {inspector ?? <Analysis
                  result={ui.result}
                  compact={!isTablet}
                  existingOff={existingOff}
                  onRestoreExisting={restoreExisting}
                />}
            </BottomSheet>
          )}
        </div>

        {isDesktop && (
          <aside
            id="analyse-panel"
            tabIndex={-1}
            aria-label="Analyse"
            className="flex w-[360px] shrink-0 flex-col border-l border-line bg-paper"
          >
            {inspector ? (
              <>
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className="text-[13px] font-semibold">Auswahl</span>
                  <button
                    className="btn"
                    onClick={() => useUi.setState({ selection: null, stationDetail: null, lineDetail: null })}
                  >
                    Zurück zur Analyse
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{inspector}</div>
              </>
            ) : (
              <Analysis
                result={ui.result}
                existingOff={existingOff}
                onRestoreExisting={restoreExisting}
              />
            )}
          </aside>
        )}
      </div>
    </main>
  );
}

/**
 * The live readout while a line is being drawn.
 *
 * Drawing without feedback is guesswork; this turns every extra click into a
 * visible consequence.
 */
function DrawFeedback({ estimate, inline = false }: { estimate: DrawEstimate; inline?: boolean }) {
  // On a phone the card sits in the bottom stack, above the buttons. Floating
  // it over them at a fixed offset does not survive the draw controls
  // appearing, and it ended up hidden underneath them.
  return (
    <div
      className={
        inline
          ? 'animate-rise pointer-events-none rounded-2xl border border-line bg-surface/95 p-3 shadow-xl backdrop-blur'
          : 'animate-rise pointer-events-none absolute bottom-4 left-1/2 z-20 w-[min(23rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-line bg-surface/95 p-3 shadow-xl backdrop-blur'
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[17px] font-semibold tabular-nums">{km(estimate.km)}</span>
        <span className="text-[13px] text-muted">
          {estimate.stations} Stationen
          {estimate.interchanges > 0 && ` · ${estimate.interchanges} Umstiege`}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
        <span className="font-medium tabular-nums">
          {eurRange(estimate.investmentLowEur, estimate.investmentHighEur)}
        </span>
        {estimate.openingYear && <span className="text-muted">fertig etwa {estimate.openingYear}</span>}
        {estimate.populationReached > 0 && (
          <span className="text-muted">{count(estimate.populationReached)} Menschen erreicht</span>
        )}
      </div>
      {estimate.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
          {estimate.warnings.map((w) => (
            <li key={w} className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function publishScenario(engine: WasmEngine, toast: (t: string, tone?: 'info' | 'warn') => void) {
  // What is switched on before we ask anything, so the question can be specific
  // — and so it is not asked at all when there is nothing to decide.
  const draft = engine.toDocument(useUi.getState().scenarioTitle);
  const scope = scopeOf(draft);
  // Publishing with parts of the existing network switched off is allowed, and
  // it is a real proposal to make. But it makes every figure on the plan's page
  // negative, and a reader who arrives later has no way to know that was on
  // purpose. Say so while it can still be undone.
  const off = existingSwitchedOff(draft);
  const answers = await ask({
    title: 'Entwurf veröffentlichen',
    intro:
      off > 0
        ? `Weil ${off === 1 ? 'eine Bestandslinie abgeschaltet ist' : `${off} Bestandslinien abgeschaltet sind`} und dein Entwurf mit dem vollständigen heutigen Netz verglichen wird, fällt der Nutzen negativ aus. Falls das nicht gewollt ist, brich ab und schalte den Bestand wieder ein.`
        : 'Dein Netz bekommt eine eigene Seite, auf der andere es ansehen, bewerten und weiterbauen können.',
    fields: [
      { name: 'title', label: 'Titel', value: useUi.getState().scenarioTitle },
      {
        name: 'description',
        label: 'Worum geht es?',
        multiline: true,
        optional: true,
        placeholder: 'Was ist die Idee hinter diesem Netz?',
      },
      ...(scope.own > 0 && scope.others > 0
        ? [
            {
              name: 'includeOthers',
              label: 'Was soll dazugehören?',
              choices: [
                {
                  value: 'own',
                  label: `Nur was du gezeichnet hast (${scope.own} ${scope.own === 1 ? 'Linie' : 'Linien'})`,
                  hint: 'Kosten und Nutzen beschreiben dann deinen Entwurf.',
                },
                {
                  value: 'all',
                  label: `Auch die eingeschalteten Vorhaben anderer (${scope.others})`,
                  hint: 'Deren Kosten zählen dann zu deinem Entwurf.',
                },
              ],
              value: 'own',
            },
          ]
        : []),
    ],
    confirm: 'Veröffentlichen',
  });
  if (!answers) return;
  const { title, description } = answers;
  try {
    const token = await ensureSession();
    if (!token) return;
    const full = engine.toDocument(title);
    const doc = answers.includeOthers === 'all' ? full : ownWorkOnly(full);
    // Recomputed from what is actually being published, not from what is on
    // screen: the server recomputes anyway and the two must not disagree.
    const result = doc === full ? engine.simulate() : engine.simulateDocument(doc);
    const { slug } = await api.create(
      { title, description, document: doc, result: result.headline, visibility: 'public' },
      token
    );
    toast('Veröffentlicht');
    // The moment right after publishing is the moment someone wants to post
    // it, so the picture and the links are offered straight away.
    const { openShareSheet } = await import('@/components/ShareSheet');
    await openShareSheet({
      title,
      city: useUi.getState().city?.name ?? 'Hamburg',
      dataSource: useUi.getState().city?.statistics?.label,
      url: `${window.location.origin}/szenario/${slug}`,
      summary: description || undefined,
      render: engine.renderState(),
      stats: {
        newKm: result.headline.newKm,
        newStations: result.headline.newStations,
        investmentEur: result.headline.investmentEur,
        benefitEur: result.headline.annualBenefitEur,
        bcr: result.headline.benefitCostRatio,
        openingYear: result.headline.openingYear ?? null,
      },
    });
  } catch (e) {
    toast(`Das Veröffentlichen ist fehlgeschlagen: ${(e as Error).message}`, 'warn');
  }
}
