'use client';

// The map of a published plan, for reading rather than editing.
//
// A plan's page showed its figures and its cost breakdown but never the thing
// itself, which is the wrong way round: the drawing is the argument, the numbers
// are the evidence. This mounts the same map the editor uses with the `select`
// tool, which picks things without changing them — you can pan, zoom and read
// the names, and that is all.
//
// The engine and the city data are cached per city by `loadEngine`, so opening a
// second plan for the same city costs nothing beyond loading its document.

import { useEffect, useRef, useState } from 'react';
import { MapCanvas } from '@/components/MapCanvas';
import { cityFiguresFrom, loadEngine, type CityEntry, type WasmEngine } from '@/lib/engine';
import type { BaseMap, RenderState } from '@/lib/types';
import { planBounds } from '@/lib/plan-bounds';
import type { CityFigures } from '@/lib/explanations';

export function PlanMap({
  document: doc,
  city,
  onCity,
}: {
  document: unknown;
  city: string;
  /** The loaded city's own figures, so the page's explanations quote the right
   *  ones instead of whatever the reader last had open in the editor. */
  onCity?: (figures: CityFigures) => void;
}) {
  const [state, setState] = useState<{
    engine: WasmEngine;
    basemap: BaseMap;
    render: RenderState;
    entry: CityEntry | null;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  // A published plan is an argument about a handful of lines. Drawing all seven
  // hundred kilometres of the existing network on top of it answers a question
  // nobody asked; the whole network is one click away for anyone who wants the
  // context.
  const [showAll, setShowAll] = useState(false);
  // A plan that builds nothing has no "new routes" to show, and hiding the
  // network then leaves a blank base map where the argument should be. Somebody
  // publishing a pure comparison of existing concepts gets the network instead,
  // with the toggle still there.
  const buildsSomething = state ? planBounds(state.render) !== null : true;
  const focusNew = buildsSomething && !showAll;

  useEffect(() => {
    setDark(window.document.documentElement.classList.contains('dark'));
  }, []);

  // Held in a ref so the effect does not depend on it: a caller passing an
  // inline arrow would otherwise make this run on every render, reloading the
  // document and setting state in a loop.
  const report = useRef(onCity);
  report.current = onCity;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bundle = await loadEngine(undefined, city);
        report.current?.(cityFiguresFrom(bundle));
        // The published document is JSON; the engine takes it as text.
        bundle.engine.showDocument(typeof doc === 'string' ? doc : JSON.stringify(doc));
        if (cancelled) return;
        setState({
          engine: bundle.engine,
          basemap: bundle.basemap,
          render: bundle.engine.renderState(),
          entry: bundle.city ?? null,
        });
      } catch (e) {
        if (!cancelled) setFailed((e as Error).message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, city]);

  if (failed) {
    return (
      <div className="grid h-[380px] place-items-center rounded-2xl border border-line bg-subtle px-6 text-center text-[13px] text-muted">
        Die Karte konnte nicht geladen werden. Die Zahlen unten stimmen trotzdem, weil sie vom
        Server stammen und nicht von dieser Ansicht abhängen.
      </div>
    );
  }
  if (!state) {
    return (
      <div className="grid h-[380px] place-items-center rounded-2xl border border-line bg-subtle text-[13px] text-muted">
        Karte wird geladen …
      </div>
    );
  }

  return (
    <div className="relative h-[380px] overflow-hidden rounded-2xl border border-line sm:h-[460px]">
      <MapCanvas
        engine={state.engine}
        basemap={state.basemap}
        render={state.render}
        dark={dark}
        city={state.entry}
        initialCenter={state.entry ? [state.entry.center.lon, state.entry.center.lat] : undefined}
        tool="select"
        schematic={false}
        focusNew={focusNew}
        highlightLine={null}
        selectedStation={null}
        lastDiff={null}
        onReady={(c, map) => {
          c.setTool('select');
          // Open on the plan, not on the city.
          //
          // The map used to start at the city centre at zoom 10.6, which was
          // survivable while the whole existing network was drawn: there was
          // always something in the frame. With only the new track showing, a
          // plan whose lines are dashed and thin at that zoom opened on an empty
          // base map, and the page looked broken rather than focused.
          //
          // Not in this tick: the canvas is still being laid out, and MapLibre
          // works the zoom out from the size it can see. Fitted immediately, a
          // box around thirty-five kilometres of Hamburg opened at zoom 8.7,
          // with Norderstedt in frame and the plan too small to make out.
          //
          // Nor on the `load` event. `map.loaded()` stays false on this map for
          // as long as it is open, so anything waiting for it waits for good;
          // the fit simply never happened. A frame later the container has its
          // real size, and `resize()` makes sure of it.
          // The map draws what the controller was handed, not what the engine
          // happens to hold: without this the base map appeared and the plan
          // itself, the entire point of the page, did not. It goes first — an
          // early return on the framing once skipped it altogether, and a plan
          // with nothing to frame drew nothing at all.
          c.syncRender(state.render, { focusNew });
          const box = planBounds(state.render);
          if (box) {
            requestAnimationFrame(() => {
              map.resize();
              map.fitBounds(box, { padding: 48, duration: 0, maxZoom: 13.5 });
            });
          }
        }}
        // Nothing here changes anything: the viewing tool emits no edits, and
        // these are the inert ends of the editor's wiring.
        onChange={() => {}}
        onPick={() => {}}
        onMessage={() => {}}
        onDraft={() => {}}
        onEstimate={() => {}}
      />
      {buildsSomething && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="absolute bottom-3 left-3 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-[12px] font-medium shadow-sm backdrop-blur transition-colors hover:bg-subtle"
        >
          {showAll ? 'Nur die neuen Strecken' : 'Bestandsnetz einblenden'}
        </button>
      )}
    </div>
  );
}
