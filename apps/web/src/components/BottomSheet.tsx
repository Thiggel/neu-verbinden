'use client';

// Mobile bottom sheet with the three states the plan asks for: collapsed, half
// and full (plan §24). Drag with a finger, or use the handle button with a
// keyboard.

import { useEffect, useRef, useState } from 'react';
import type { SheetState } from '@/lib/store';

const HEIGHT: Record<Exclude<SheetState, 'closed'>, string> = {
  collapsed: '86px',
  half: '46vh',
  full: 'calc(100vh - 92px)',
};

const ORDER: Exclude<SheetState, 'closed'>[] = ['collapsed', 'half', 'full'];

export function BottomSheet({
  state,
  onState,
  title,
  subtitle,
  children,
  onClose,
}: {
  state: SheetState;
  onState: (s: SheetState) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state !== 'closed') ref.current?.focus();
  }, [state]);

  if (state === 'closed') return null;

  const cycle = (dir: 1 | -1) => {
    const i = ORDER.indexOf(state as Exclude<SheetState, 'closed'>);
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, i + dir))];
    onState(next);
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Details"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-line bg-surface shadow-[0_-8px_30px_rgba(0,0,0,0.12)] outline-none transition-[height] duration-300 ease-out motion-reduce:transition-none"
      style={{ height: `calc(${HEIGHT[state as Exclude<SheetState, 'closed'>]} - ${drag}px)` }}
      onTouchStart={(e) => (startY.current = e.touches[0].clientY)}
      onTouchMove={(e) => {
        if (startY.current == null) return;
        setDrag(Math.max(-200, Math.min(200, e.touches[0].clientY - startY.current)));
      }}
      onTouchEnd={() => {
        if (drag > 60) cycle(-1);
        else if (drag < -60) cycle(1);
        startY.current = null;
        setDrag(0);
      }}
    >
      <div className="shrink-0 px-4 pb-2 pt-2">
        <button
          onClick={() => cycle(state === 'full' ? -1 : 1)}
          aria-label={state === 'full' ? 'Details verkleinern' : 'Details vergrößern'}
          className="mx-auto block h-1.5 w-10 rounded-full bg-line"
        />
        <div className="mt-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-tight">{title}</div>
            {subtitle && <div className="truncate text-[12px] text-muted">{subtitle}</div>}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="-mr-1 grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-subtle"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}
