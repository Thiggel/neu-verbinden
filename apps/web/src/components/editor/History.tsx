'use client';

// The list of decisions behind the current network.
//
// The engine's history is semantic — "Linie gezeichnet", "Station entfernt",
// not a stack of geometry snapshots — and that is worth showing. Two arrows
// tell you only that something can be undone; a list tells you what you did,
// and lets you go back several steps at once without guessing how many times
// to press.

import { useEffect, useRef, useState } from 'react';

export interface HistoryState {
  done: string[];
  undone: string[];
}

export function HistoryButton({
  // The history arrives from the engine, so it is empty until that has loaded
  // — and a component that crashes on its own first render is worse than one
  // that shows nothing for a moment.
  history = { done: [], undone: [] },
  onUndoSteps,
  onRedoSteps,
}: {
  history?: HistoryState;
  onUndoSteps: (n: number) => void;
  onRedoSteps: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const total = history.done.length + history.undone.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!total) return null;

  return (
    <div ref={box} className="relative">
      <button
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Was du bisher geändert hast"
      >
        Verlauf
        <span className="ml-1 tabular-nums text-muted">{history.done.length}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Verlauf"
          className="animate-rise absolute right-0 top-full z-40 mt-1 w-[280px] overflow-hidden rounded-xl border border-line bg-paper shadow-2xl"
        >
          <div className="border-b border-line px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            Verlauf
          </div>
          <ol className="max-h-[320px] overflow-y-auto p-1.5">
            {/* Newest first: that is the order someone reasons backwards in. */}
            {history.undone
              .slice()
              .reverse()
              .map((label, i) => (
                <li key={`undone-${i}`}>
                  <button
                    onClick={() => {
                      onRedoSteps(history.undone.length - i);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted hover:bg-subtle"
                    title="Wiederherstellen bis hierher"
                  >
                    <span aria-hidden className="text-[10px]">
                      ↷
                    </span>
                    <span className="truncate line-through">{label}</span>
                  </button>
                </li>
              ))}
            {history.done
              .slice()
              .reverse()
              .map((label, i) => (
                <li key={`done-${i}`}>
                  <button
                    onClick={() => {
                      // Undo everything above this entry, plus this one.
                      onUndoSteps(i + 1);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle"
                    title="Bis hierher zurücknehmen"
                  >
                    <span aria-hidden className="text-[10px] text-muted">
                      ↶
                    </span>
                    <span className="truncate">{label}</span>
                    {i === 0 && (
                      <span className="ml-auto shrink-0 text-[10px] uppercase text-muted">zuletzt</span>
                    )}
                  </button>
                </li>
              ))}
          </ol>
          <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-muted">
            Ein Klick nimmt alles bis einschließlich dieses Schritts zurück.
          </p>
        </div>
      )}
    </div>
  );
}
