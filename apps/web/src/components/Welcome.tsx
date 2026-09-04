'use client';

// Shown once, then never again. Someone arriving here has no idea what this is
// or that they are allowed to touch it — one short card fixes both, and the
// scenario buttons get them somewhere interesting in one tap.

import { useEffect, useState } from 'react';
import type { ScenarioTemplate } from '@/lib/types';

const KEY = 'hh-welcomed';

export function Welcome({
  templates,
  onPick,
  city = 'Hamburg',
}: {
  templates: ScenarioTemplate[];
  onPick: (id: string) => void;
  city?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      // Private browsing: showing it every time is better than not at all.
      setOpen(true);
    }
  }, []);

  if (!open) return null;
  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
  };

  const highlights = ['beschlossen', 'u5-vollausbau', 'strassenbahn']
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is ScenarioTemplate => !!t);

  // `grid-cols-1` is load-bearing. With a bare `place-items-center` the single
  // column is auto-sized, so it grows to the child's `max-w-md` (448 px) and
  // the dialog ends up wider than a 375 px phone, clipping its own text on the
  // right. Tailwind's `grid-cols-1` is `minmax(0, 1fr)`, which bounds it.
  return (
    <div className="absolute inset-0 z-40 grid grid-cols-1 place-items-center bg-black/25 p-4 backdrop-blur-[2px]">
      <div className="animate-rise w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-end gap-1.5" aria-hidden>
          {['#0075BF', '#008B3C', '#DB2777'].map((c, i) => (
            <span
              key={c}
              className="block w-2.5 rounded-full"
              style={{ backgroundColor: c, height: `${16 + i * 9}px`, animation: `pop-in 380ms ${i * 80}ms both` }}
            />
          ))}
        </div>
        <h1 className="text-[21px] font-semibold leading-tight">Wie soll {city} fahren?</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Zeichne die U-Bahn, S-Bahn oder Straßenbahn, die du dir wünschst. Die App rechnet
          mit, was sie kosten würde, wann sie fertig wäre und wem sie etwas bringt, und du
          kannst deinen Entwurf mit anderen teilen.
        </p>

        <div className="mt-4 space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Oder schau dir erst an, was schon geplant ist
          </div>
          {highlights.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onPick(t.id);
                dismiss();
              }}
              className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left transition-colors hover:bg-subtle"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{t.title}</span>
                <span className="block truncate text-[12px] text-muted">{t.summary}</span>
              </span>
              <span aria-hidden className="text-muted">
                →
              </span>
            </button>
          ))}
        </div>

        <button onClick={dismiss} className="btn btn-primary mt-4 w-full">
          Los geht’s
        </button>
        {/* This sentence used to name only the ⓘ. That fits the figures in the
            overview, but the cost, schedule and impact tabs show their
            derivation by unfolding each item instead — there is no ⓘ there at
            all. A promise should name a route that exists. */}
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Alle Zahlen sind Schätzungen eines offenen Modells, kein Planungswerkzeug, sondern
          ein Werkzeug zum Nachdenken und Streiten. Jede Kennzahl lässt sich bis
          zur Herleitung aufklappen, über das
          <span className="mx-1 inline-grid h-[15px] w-[15px] place-items-center rounded-full border border-line align-[-2px] text-[9px] font-bold">
            i
          </span>
          im Überblick, und in den übrigen Reitern Posten für Posten.
        </p>
      </div>
    </div>
  );
}
