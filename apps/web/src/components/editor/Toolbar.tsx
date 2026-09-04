'use client';

import { TOOL_LABEL, type Tool } from '@/lib/store';
import type { Mode } from '@/lib/types';

const TOOLS: { id: Tool; icon: string; key: string; hint: string }[] = [
  { id: 'select', icon: '✋', key: 'V', hint: 'Etwas ansehen' },
  { id: 'draw', icon: '✏️', key: 'D', hint: 'Neue Linie zeichnen' },
  { id: 'extend', icon: '➡️', key: 'E', hint: 'Linie weiterbauen' },
  { id: 'split', icon: '➕', key: 'S', hint: 'Station einfügen' },
  { id: 'delete', icon: '🗑️', key: 'X', hint: 'Etwas entfernen' },
];

/** Room for one word under the icon in the mobile bar. */
const TOOL_SHORT: Record<Tool, string> = {
  select: 'Ansehen',
  draw: 'Zeichnen',
  extend: 'Anbauen',
  split: 'Halt',
  delete: 'Weg',
};

const MODES: { id: Mode; label: string; icon: string; color: string }[] = [
  { id: 'ubahn', label: 'U-Bahn', icon: 'U', color: 'bg-blue-600' },
  { id: 'sbahn', label: 'S-Bahn', icon: 'S', color: 'bg-green-600' },
  { id: 'tram', label: 'Tram', icon: 'T', color: 'bg-pink-600' },
];

/**
 * The tool picker.
 *
 * `grid` lays the tools out in a wrapping grid for the desktop sidebar, where a
 * single row of five labelled buttons does not fit and the labels used to
 * overlap. `compact` is the icon-only row for the mobile control bar.
 */
export function ToolRail({
  tool,
  onTool,
  variant = 'grid',
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  variant?: 'grid' | 'compact';
}) {
  if (variant === 'compact') {
    return (
      <div role="toolbar" aria-label="Werkzeuge" className="flex gap-0.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTool(t.id)}
            aria-pressed={tool === t.id}
            aria-label={TOOL_LABEL[t.id]}
            title={`${TOOL_LABEL[t.id]} (${t.key})`}
            className={`grid h-12 w-[47px] shrink-0 place-items-center gap-0.5 rounded-xl transition-all active:scale-90 ${
              tool === t.id ? 'bg-ink text-paper shadow-md' : 'text-muted hover:bg-subtle'
            }`}
          >
            <span aria-hidden className="text-[17px] leading-none">
              {t.icon}
            </span>
            {/* An icon on its own does not say what "extend" means. There is
                room for the word, so the word is there. */}
            <span aria-hidden className="text-[9.5px] font-medium leading-none">
              {TOOL_SHORT[t.id]}
            </span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="toolbar" aria-label="Werkzeuge" className="grid grid-cols-2 gap-1.5">
      {TOOLS.map((t, i) => (
        <button
          key={t.id}
          onClick={() => onTool(t.id)}
          aria-pressed={tool === t.id}
          title={`${t.hint} · Taste ${t.key}`}
          className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all active:scale-[0.97] ${
            i === 0 ? 'col-span-2' : ''
          } ${tool === t.id ? 'bg-ink text-paper shadow-sm' : 'bg-subtle/60 hover:bg-subtle'}`}
        >
          <span aria-hidden className="text-[16px] leading-none">
            {t.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{TOOL_LABEL[t.id]}</span>
          <kbd
            className={`hidden shrink-0 rounded px-1 text-[10px] font-medium xl:block ${
              tool === t.id ? 'bg-white/20' : 'bg-line'
            }`}
          >
            {t.key}
          </kbd>
        </button>
      ))}
    </div>
  );
}

export function ModeSwitch({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  return (
    <div role="radiogroup" aria-label="Verkehrsmittel" className="flex gap-1 rounded-xl bg-subtle p-1">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          onClick={() => onMode(m.id)}
          className={`flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1 text-[12.5px] font-medium transition-all active:scale-95 ${
            mode === m.id ? 'bg-surface shadow-sm' : 'text-muted'
          }`}
        >
          <span
            aria-hidden
            className={`grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] font-bold text-white ${m.color}`}
          >
            {m.icon}
          </span>
          <span className="truncate">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
