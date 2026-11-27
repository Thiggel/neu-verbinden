'use client';

// A guided tour through the editor, started only from the welcome note and only
// by those who ask for it.
//
// Each step names its target by a `data-tour` attribute rather than by an id or
// a class, so that the tour survives changes to the layout. The same name can
// sit on more than one element, because a phone and a desktop show the same
// control in different places, and the first one that is actually on screen
// wins. A step whose target is nowhere on screen is shown in the middle without
// a spotlight, which is better than skipping it, since its text still holds.
//
// The page behind the tour is darkened and does not take clicks, because a
// click that changed the page would move the very element a step points at.

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Step = {
  target: string;
  title: string;
  text: ReactNode;
  /** Replaces `text` below the desktop breakpoint, where the control differs. */
  mobile?: ReactNode;
};

const STEPS: Step[] = [
  {
    target: 'scenario',
    title: 'Ausgangslage',
    text: 'Hier wählst du, wovon dein Entwurf ausgeht, also etwa von den bereits geplanten Vorhaben oder von einem der vorbereiteten Entwürfe, auf denen du anschließend weiterbauen kannst.',
  },
  {
    target: 'city',
    title: 'Stadt',
    text: 'Über den Namen der Stadt wechselst du zwischen Hamburg und Berlin, wobei jeder Entwurf zu der Stadt gehört, in der er gezeichnet wurde.',
  },
  {
    target: 'mode',
    title: 'Verkehrsmittel',
    text: 'Bevor du zeichnest, legst du fest, ob die neue Linie eine U-Bahn, eine S-Bahn oder eine Straßenbahn werden soll, da Bauweise, Kosten und Fahrzeit davon abhängen.',
  },
  {
    target: 'tools',
    title: 'Werkzeuge',
    text: 'Mit „Zeichnen“ beginnst du eine neue Linie, mit „Weiterbauen“ verlängerst du eine bestehende, mit „Halt einfügen“ ergänzt du eine Station und mit „Entfernen“ nimmst du etwas wieder heraus, während du mit „Ansehen“ Linien und Stationen nur anklickst, um mehr über sie zu erfahren.',
  },
  {
    target: 'map',
    title: 'Karte',
    text: 'Beim Zeichnen setzt jeder Klick eine Station, während die App dazwischen weitere ergänzt, bis du die Linie mit einem Doppelklick oder mit Enter beendest. Schon während des Zeichnens erscheint eine erste Schätzung der Kosten.',
    mobile:
      'Beim Zeichnen setzt jedes Tippen eine Station, während die App dazwischen weitere ergänzt, bis du die Linie mit „Fertig“ beendest. Schon während des Zeichnens erscheint eine erste Schätzung der Kosten.',
  },
  {
    target: 'lines',
    title: 'Linien',
    text: 'In dieser Liste schaltest du bestehende und neue Linien ein oder aus und wählst sie aus, um ihre Kennzahlen zu sehen.',
    mobile:
      'Über „Linien“ öffnest du die Liste, in der du bestehende und neue Linien ein- oder ausschaltest und auswählst, um ihre Kennzahlen zu sehen.',
  },
  {
    target: 'analysis',
    title: 'Analyse',
    text: 'Hier rechnet die App mit, was dein Entwurf kostet, wann er fertig wäre, wem er nützt und wie gut er sich bauen lässt, wobei die Reiter jeden Posten einzeln aufschlüsseln.',
    mobile:
      'Über „Analyse“ öffnest du die Auswertung, in der die App mitrechnet, was dein Entwurf kostet, wann er fertig wäre, wem er nützt und wie gut er sich bauen lässt.',
  },
  {
    target: 'share',
    title: 'Teilen',
    text: 'Wenn du mit deinem Entwurf zufrieden bist, machst du ihn hiermit für andere sichtbar, während „Speichern“ ihn als Datei auf deinem Gerät ablegt.',
    mobile: 'Wenn du mit deinem Entwurf zufrieden bist, machst du ihn hiermit für andere sichtbar.',
  },
  {
    target: 'discover',
    title: 'Entdecken',
    text: (
      <>
        Unter{' '}
        <Link href="/entdecken" className="underline">
          Entdecken
        </Link>{' '}
        findest du die Entwürfe, die andere geteilt haben, und kannst sie dir ansehen, bewerten oder
        als Ausgangspunkt für einen eigenen nehmen. Damit ist die Anleitung zu Ende.
      </>
    ),
  },
];

const PAD = 6;
const GAP = 12;
const EDGE = 12;

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** The part of the target that is inside the window, with some room around it. */
function visibleRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top - PAD, 0);
  const left = Math.max(r.left - PAD, 0);
  const bottom = Math.min(r.bottom + PAD, window.innerHeight);
  const right = Math.min(r.right + PAD, window.innerWidth);
  return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
}

/**
 * Below the target, above it, beside it, or, for a target that fills most of
 * the window like the map, inside it at the bottom, always clamped to the
 * window.
 */
function place(t: Rect | null, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), Math.max(vw - w - EDGE, EDGE));
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), Math.max(vh - h - EDGE, EDGE));
  if (!t) return { top: clampY((vh - h) / 2), left: clampX((vw - w) / 2) };
  const midX = t.left + t.width / 2 - w / 2;
  const midY = t.top + t.height / 2 - h / 2;
  if (t.top + t.height + GAP + h <= vh - EDGE) return { top: t.top + t.height + GAP, left: clampX(midX) };
  if (t.top - GAP - h >= EDGE) return { top: t.top - GAP - h, left: clampX(midX) };
  if (t.left + t.width + GAP + w <= vw - EDGE) return { top: clampY(midY), left: t.left + t.width + GAP };
  if (t.left - GAP - w >= EDGE) return { top: clampY(midY), left: t.left - GAP - w };
  return { top: clampY(t.top + t.height - h - GAP), left: clampX(midX) };
}

export function Tour({ open, onClose, desktop }: { open: boolean; onClose: () => void; desktop: boolean }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const close = useCallback(() => {
    setIndex(0);
    onClose();
  }, [onClose]);

  const measure = useCallback(() => {
    const el = findTarget(step.target);
    const r = el ? visibleRect(el) : null;
    setRect(r && r.width > 0 && r.height > 0 ? r : null);
  }, [step.target]);

  // A new step first brings its target into view, then measures it.
  useLayoutEffect(() => {
    if (!open) return;
    findTarget(step.target)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
  }, [open, step.target, measure]);

  useEffect(() => {
    if (!open) return;
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    const ro = new ResizeObserver(onChange);
    const el = findTarget(step.target);
    if (el) ro.observe(el);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
      ro.disconnect();
    };
  }, [open, step.target, measure]);

  // The card is placed once its own size is known.
  useLayoutEffect(() => {
    if (!open || !card.current) return;
    const { width, height } = card.current.getBoundingClientRect();
    setPos(place(rect, width, height));
  }, [open, rect, index, desktop]);

  useEffect(() => {
    if (open) next.current?.focus();
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, STEPS.length - 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Captured, so that the map's own arrow-key handling does not move it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  if (!open) return null;
  const text = !desktop && step.mobile ? step.mobile : step.text;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Takes every click meant for the page. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-white/80 transition-all duration-200"
          style={{ ...rect, boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)' }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/55" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        className="absolute w-[min(340px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-4 shadow-2xl transition-[top,left] duration-200"
        style={pos ?? { top: -9999, left: -9999 }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="tour-title" className="text-[15px] font-semibold">
            {step.title}
          </h2>
          <span className="shrink-0 text-[12px] tabular-nums text-muted">
            {index + 1} von {STEPS.length}
          </span>
        </div>
        <p id="tour-text" className="mt-1.5 text-[13.5px] leading-relaxed">
          {text}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn" onClick={close}>
            Beenden
          </button>
          <span className="flex-1" />
          {index > 0 && (
            <button className="btn" onClick={() => setIndex(index - 1)}>
              Zurück
            </button>
          )}
          <button
            ref={next}
            className="btn btn-primary"
            onClick={() => (last ? close() : setIndex(index + 1))}
          >
            {last ? 'Fertig' : 'Weiter'}
          </button>
        </div>
      </div>
    </div>
  );
}
