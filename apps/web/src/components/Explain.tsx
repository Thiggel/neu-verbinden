'use client';

// Every number in this application is a model output, and a number without its
// derivation is just an assertion. The "i" opens the actual chain: what went in,
// what was assumed, and what the result does not cover.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface Explanation {
  title: string;
  /** One sentence: what this number means. */
  what: string;
  /** The derivation, step by step. */
  how: string[];
  /** What it deliberately leaves out. */
  caveat?: string;
  /** Where the inputs come from. */
  source?: string;
}

const WIDTH = 330;
const MARGIN = 10;

export function Explain({ info, label }: { info: Explanation; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Positioned against the viewport rather than the button's own container.
  // The panels these live in scroll and clip their contents, so an absolutely
  // positioned popover gets cut off at the panel edge.
  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.min(
      Math.max(MARGIN, b.right - width),
      window.innerWidth - width - MARGIN
    );
    const height = panel.current?.offsetHeight ?? 260;
    const above = b.bottom + height + MARGIN > window.innerHeight && b.top > height + MARGIN;
    setPos({ left, top: above ? b.top - height - 6 : b.bottom + 6, above });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (button.current?.contains(e.target as Node)) return;
      if (panel.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    // Any scrolling container, hence capture.
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Wie ${label ?? info.title} berechnet wird`}
        onClick={() => setOpen((v) => !v)}
        className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full border text-[10px] font-bold leading-none transition-colors ${
          open ? 'border-ink bg-ink text-paper' : 'border-line text-muted hover:border-muted hover:text-ink'
        }`}
      >
        i
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={id}
            ref={panel}
            role="dialog"
            aria-label={info.title}
            className="animate-rise fixed z-[60] rounded-xl border border-line bg-surface p-3 text-left shadow-2xl"
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              width: Math.min(WIDTH, typeof window !== 'undefined' ? window.innerWidth - 2 * MARGIN : WIDTH),
              maxHeight: 'min(70vh, 34rem)',
              overflowY: 'auto',
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-[13px] font-semibold">{info.title}</div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Schließen"
                className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted hover:bg-subtle"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">{markup(info.what)}</p>
            <ol className="mt-2 space-y-1">
              {info.how.map((step, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-subtle text-[9px] font-semibold text-muted">
                    {i + 1}
                  </span>
                  <span>{markup(step)}</span>
                </li>
              ))}
            </ol>
            {info.caveat && (
              <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
                <strong className="font-semibold">Nicht enthalten:</strong> {markup(info.caveat)}
              </p>
            )}
            {info.source && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                <strong className="font-semibold">Grundlage:</strong> {markup(info.source)}
              </p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}


/**
 * Render the small amount of markup the explanations use, as React elements.
 *
 * These strings are written by hand and contain only <b> and <i>, so
 * `dangerouslySetInnerHTML` worked — but it is one careless interpolation away
 * from being an injection point, and the explanations are exactly the kind of
 * text that grows a `${}` in it one day. Parsing the two tags we allow costs
 * nothing and removes the question entirely.
 */
function markup(text: string) {
  const out: React.ReactNode[] = [];
  const pattern = /<(b|i)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const inner = m[2];
    out.push(
      m[1] === 'b' ? (
        <strong key={key++} className="font-semibold">
          {inner}
        </strong>
      ) : (
        <em key={key++}>{inner}</em>
      )
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
