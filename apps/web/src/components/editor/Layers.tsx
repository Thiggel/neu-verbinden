'use client';

// Independent visibility per line, grouped by where the line comes from
// (plan §12). Toggling a planned project on is what makes it part of the
// scenario — and therefore part of the cost.

import { useMemo, useState } from 'react';
import { km, MODE_LABEL, SOURCE_LABEL, eur } from '@/lib/format';
import type { LineGeometry, SourceKind } from '@/lib/types';

const ORDER: SourceKind[] = ['existing', 'planned', 'proposal', 'user'];

const GROUP_NOTE: Record<SourceKind, string> = {
  existing: 'Linien, die heute fahren.',
  planned: 'Vorhaben, die offiziell geplant oder im Bau sind.',
  proposal: 'Alternativen aus der politischen Debatte, die sich als Szenario durchrechnen lassen.',
  user: 'Linien, die du gezeichnet hast.',
};

export function Layers({
  lines,
  onToggle,
  onSelect,
  onHover,
  selectedLine,
}: {
  lines: LineGeometry[];
  onToggle: (id: number, included: boolean) => void;
  onSelect: (id: number) => void;
  onHover: (id: number | null) => void;
  selectedLine: number | null;
}) {
  const groups = useMemo(() => {
    const by = new Map<SourceKind, LineGeometry[]>();
    for (const l of lines) {
      const list = by.get(l.source) ?? [];
      list.push(l);
      by.set(l.source, list);
    }
    for (const list of by.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }) || a.name.localeCompare(b.name, 'de'));
    }
    return ORDER.filter((s) => by.has(s)).map((s) => [s, by.get(s)!] as const);
  }, [lines]);

  const [collapsed, setCollapsed] = useState<Set<SourceKind>>(new Set());

  return (
    <div className="space-y-3 p-3">
      {groups.map(([source, list]) => {
        const on = list.filter((l) => l.included).length;
        const isCollapsed = collapsed.has(source);
        return (
          <section key={source} className="rounded-xl border border-line bg-surface">
            <header className="flex items-center gap-2 border-b border-line px-3 py-2">
              <button
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() =>
                  setCollapsed((c) => {
                    const next = new Set(c);
                    next.has(source) ? next.delete(source) : next.add(source);
                    return next;
                  })
                }
                aria-expanded={!isCollapsed}
              >
                <span className={`text-muted transition-transform ${isCollapsed ? '' : 'rotate-90'}`} aria-hidden>
                  ▸
                </span>
                <span className="text-[13px] font-semibold">{SOURCE_LABEL[source]}</span>
                <span className="text-[12px] text-muted">
                  {on}/{list.length}
                </span>
              </button>
              <button
                className="rounded px-2 py-1 text-[11px] text-muted hover:bg-subtle"
                onClick={() => list.forEach((l) => onToggle(l.id, on !== list.length))}
              >
                {on === list.length ? 'alle aus' : 'alle an'}
              </button>
            </header>
            {!isCollapsed && (
              <>
                <p className="px-3 pt-2 text-[11px] leading-snug text-muted">{GROUP_NOTE[source]}</p>
                <ul className="p-1.5">
                  {list.map((l) => (
                    <li key={l.id}>
                      <div
                        className={`flex items-center gap-2 rounded-lg px-1.5 py-1.5 ${
                          selectedLine === l.id ? 'bg-subtle' : 'hover:bg-subtle/60'
                        }`}
                        onMouseEnter={() => onHover(l.id)}
                        onMouseLeave={() => onHover(null)}
                      >
                        <input
                          type="checkbox"
                          checked={l.included}
                          onChange={(e) => onToggle(l.id, e.target.checked)}
                          className="h-4 w-4 shrink-0 accent-slate-900 dark:accent-slate-100"
                          aria-label={`${l.label} ${l.name} anzeigen`}
                        />
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => onSelect(l.id)}
                        >
                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                            style={{ backgroundColor: l.color }}
                          >
                            {l.label}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] leading-tight">{l.name}</span>
                            <span className="block truncate text-[11px] leading-tight text-muted">
                              {MODE_LABEL[l.mode]} · {km(l.lengthKm)}
                              {l.officialCostEur ? ` · offiziell ${eur(l.officialCostEur)}` : ''}
                              {l.officialOpeningYear ? ` · Ziel ${l.officialOpeningYear}` : ''}
                            </span>
                          </span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
