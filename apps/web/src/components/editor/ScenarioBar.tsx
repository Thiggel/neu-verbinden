'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { ScenarioTemplate } from '@/lib/types';
import { HistoryButton, type HistoryState } from './History';

export function ScenarioBar({
  templates,
  templateId,
  onTemplate,
  cities,
  cityId,
  onCity,
  onUndo,
  history,
  onUndoSteps,
  onRedoSteps,
  onRedo,
  canUndo,
  canRedo,
  dark,
  onDark,
  onSave,
  onLoad,
  onPublish,
}: {
  templates: ScenarioTemplate[];
  templateId: string;
  onTemplate: (id: string) => void;
  /** Which cities the manifest offers, and which one is loaded. */
  cities: { id: string; name: string }[];
  cityId: string;
  onCity: (id: string) => void;
  onUndo: () => void;
  /** What has been done and taken back, for the history list. */
  history: HistoryState;
  onUndoSteps: (n: number) => void;
  onRedoSteps: (n: number) => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dark: boolean;
  onDark: (v: boolean) => void;
  onSave: () => void;
  onLoad: (json: string) => void;
  onPublish: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const current = templates.find((t) => t.id === templateId);
  return (
    // On a phone the row cannot hold the city, the scenario and five actions:
    // the scenario select is the one with `flex-1`, so it was the one that got
    // squeezed — to exactly zero width, leaving no way to change scenario at
    // all, while the actions still overflowed and cut off "Teilen". So it wraps
    // to its own row below `sm`. Forty pixels of height is a cheap price for
    // the control that decides what you are looking at.
    // Three columns rather than a row, so the title sits in the middle of the
    // bar and stays there whatever the controls on either side are doing. A
    // flex row would centre it between its neighbours, which is not the middle.
    // A phone has no middle to speak of: the four controls on the right are
    // wider than a third of a 375 px bar, so a three-column grid pushed the
    // title left and only looked broken. Below `sm` the bar is an ordinary row
    // with the title at the start; from `sm` up there is room to centre it.
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-paper px-2 py-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:flex-nowrap sm:px-3">
      <div className="order-last min-w-0 basis-full sm:order-none sm:col-span-1 sm:basis-auto">
        <label className="sr-only" htmlFor="scenario">
          Szenario
        </label>
        <select
          id="scenario"
          data-tour="scenario"
          value={templateId}
          onChange={(e) => onTemplate(e.target.value)}
          className="w-full max-w-[280px] rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px]"
        >
          {templateId === '' && <option value="">Eigener Entwurf</option>}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        {current && <p className="mt-0.5 hidden truncate text-[11px] text-muted md:block">{current.summary}</p>}
      </div>

      {/* The name of the thing, with the city in it — and the city is the part
          you can change. A bare `select` reads as a form field; this reads as
          the title, and says it is a choice by looking like one that is shut. */}
      <div className="flex min-w-0 items-center gap-2 sm:justify-center">
        <h1 className="flex items-baseline gap-1.5 whitespace-nowrap text-[14px] font-semibold">
          {cities.length > 1 ? (
            <span data-tour="city" className="group relative inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 ring-1 ring-line transition-colors hover:bg-subtle focus-within:ring-2 focus-within:ring-ink/40">
              <span>{cities.find((c) => c.id === cityId)?.name ?? cityId}</span>
              <span aria-hidden className="text-[9px] text-muted transition-transform group-hover:translate-y-[1px]">
                ▾
              </span>
              {/* The real control, invisible but on top: the native menu keeps
                  keyboard use, screen readers and the phone's own picker. */}
              <label className="sr-only" htmlFor="city">
                Stadt wechseln
              </label>
              <select
                id="city"
                value={cityId}
                onChange={(e) => onCity(e.target.value)}
                title="Stadt wechseln"
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </span>
          ) : (
            <span>{cities.find((c) => c.id === cityId)?.name ?? 'Hamburg'}</span>
          )}
          <span className="hidden font-normal text-muted sm:inline">neu verbinden</span>
        </h1>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:justify-end">
        <button className="btn" onClick={onUndo} disabled={!canUndo} title="Rückgängig (⌘Z)" aria-label="Rückgängig">
          ↶
        </button>
        <button className="btn" onClick={onRedo} disabled={!canRedo} title="Wiederholen (⇧⌘Z)" aria-label="Wiederholen">
          ↷
        </button>
        <HistoryButton history={history} onUndoSteps={onUndoSteps} onRedoSteps={onRedoSteps} />
        <button className="btn hidden sm:inline-flex" onClick={onSave}>
          Speichern
        </button>
        <button className="btn hidden sm:inline-flex" onClick={() => file.current?.click()}>
          Öffnen
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onLoad(await f.text());
            e.target.value = '';
          }}
        />
        <button data-tour="share" className="btn btn-primary" onClick={onPublish} title="Deinen Entwurf für andere sichtbar machen">
          Teilen
        </button>
        <Link href="/entdecken" data-tour="discover" className="btn btn-discover hidden lg:inline-flex">
          Entdecken
        </Link>
        <button
          className="btn"
          onClick={() => onDark(!dark)}
          aria-label={dark ? 'Helles Design' : 'Dunkles Design'}
          title={dark ? 'Helles Design' : 'Dunkles Design'}
        >
          {dark ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}
