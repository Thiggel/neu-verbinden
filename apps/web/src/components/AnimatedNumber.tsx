'use client';

// A number that eases to its new value. Cost figures change constantly while
// editing, and a hard jump makes it hard to tell whether the last edit made
// things better or worse (plan §18). Honours prefers-reduced-motion.

import { useEffect, useRef, useState } from 'react';
import { tween } from '@/lib/tween';

export function AnimatedNumber({
  value,
  format,
  durationMs = 450,
}: {
  value: number;
  format: (v: number) => string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  // What is actually painted right now. The animation has to start from this
  // and not from where the last one was *supposed* to end: figures change
  // faster than 450 ms while editing, so animations interrupt each other
  // constantly, and an origin that only updates on completion goes stale.
  const painted = useRef(value);
  const raf = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = (v: number) => {
    painted.current = v;
    setShown(v);
  };

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const a = painted.current;
    const b = value;
    // Already there, or nothing sensible to ease between: show the number and
    // stop. Returning here *without* showing it was how a figure could freeze
    // part-way — see `tween` above.
    if (reduce || !Number.isFinite(b) || !Number.isFinite(a) || a === b) {
      show(b);
      return;
    }
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      show(tween(a, b, p));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    // `requestAnimationFrame` does not run while the tab is hidden, so without
    // this the figure would still be mid-ease when someone comes back to it.
    // Timers do run there. The number is the point; the easing is decoration.
    settle.current = setTimeout(() => show(b), durationMs + 120);
    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(settle.current);
    };
  }, [value, durationMs]);

  // A brief bump on change: the eye notices motion long before it reads a
  // number, so an edit registers even when you are looking at the map.
  const [bump, setBump] = useState(0);
  useEffect(() => {
    setBump((b) => b + 1);
  }, [value]);

  return (
    <span key={bump} className="inline-block animate-bump">
      {format(shown)}
    </span>
  );
}
