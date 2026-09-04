'use client';

// Semantic editing of whatever is selected (plan §8): no raw geometry, only
// operations that mean something — extend, shorten, split, change the
// construction type, regenerate the stops.

import { count, eur, km, MODE_LABEL, SOURCE_LABEL, STATUS_LABEL } from '@/lib/format';
import type { LineDetail, StationDetail } from '@/lib/types';
import { askText } from '@/components/Dialog';

export function StationInspector({
  detail,
  onRename,
  onRemove,
  onFocus,
}: {
  detail: StationDetail;
  onRename: (name: string) => void;
  onRemove: () => void;
  onFocus: () => void;
}) {
  return (
    <div className="space-y-3 p-3">
      <header>
        <div className="flex flex-wrap items-center gap-1.5">
          {detail.lines.map(([label, color, mode], i) => (
            <span
              key={`${label}-${mode}-${i}`}
              className="rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {label}
            </span>
          ))}
        </div>
        <h2 className="mt-1.5 text-[20px] font-semibold leading-tight">{detail.name}</h2>
        <p className="text-[12px] text-muted">
          {detail.depthLabel} · {STATUS_LABEL[detail.status]} · {SOURCE_LABEL[detail.source]}
          {detail.district ? ` · ${detail.district}` : ''}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Fact label="Einwohner im Einzugsbereich" value={count(detail.catchmentPopulation)} />
        <Fact label="Arbeitsplätze im Einzugsbereich" value={count(detail.catchmentJobs)} />
        <Fact label="Linien" value={String(detail.lines.length)} />
        <Fact label="Umsteigepunkt" value={detail.interchange ? 'ja' : 'nein'} />
      </div>

      {detail.nearby.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">In der Nähe</div>
          <ul className="space-y-0.5">
            {detail.nearby.map(([name, dist], i) => (
              <li key={`${name}-${i}`} className="flex justify-between gap-2 text-[12px]">
                <span className="truncate">{name}</span>
                <span className="shrink-0 tabular-nums text-muted">{Math.round(dist)} m</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={onFocus}>
          Auf Karte zeigen
        </button>
        <button
          className="btn"
          onClick={async () => {
            const name = await askText('Station umbenennen', 'Name', detail.name, { confirm: 'Übernehmen' });
            if (name) onRename(name);
          }}
        >
          Umbenennen
        </button>
        <button className="btn btn-danger" onClick={onRemove}>
          Station entfernen
        </button>
      </div>
    </div>
  );
}

export function LineInspector({
  detail,
  infrastructures,
  onExtend,
  onShorten,
  onDelete,
  onRegenerate,
  onToggle,
  onFocusStation,
  onSetColor,
}: {
  detail: LineDetail;
  infrastructures: [string, string][];
  onExtend: (end: 'start' | 'finish') => void;
  onShorten: (end: 'start' | 'finish') => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onToggle: (included: boolean) => void;
  onFocusStation: (id: number) => void;
  onSetColor: (color: string) => void;
}) {
  return (
    <div className="space-y-3 p-3">
      <header>
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-[13px] font-bold text-white"
            style={{ backgroundColor: detail.color }}
          >
            {detail.label}
          </span>
          <span className="text-[12px] text-muted">
            {MODE_LABEL[detail.mode]} · {SOURCE_LABEL[detail.source]}
          </span>
        </div>
        <h2 className="mt-1.5 text-[18px] font-semibold leading-tight">{detail.name}</h2>
        <p className="text-[12px] text-muted">
          {km(detail.lengthKm)} · {detail.stations.length} Stationen · Takt {detail.headwayPeakMin} min
        </p>
        {detail.note && <p className="mt-1.5 text-[12px] leading-snug text-muted">{detail.note}</p>}
      </header>

      {(detail.officialCostEur || detail.officialOpeningYear) && (
        <section className="rounded-xl border border-line bg-surface p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            Angaben des Vorhabenträgers
          </div>
          <div className="space-y-1 text-[13px]">
            {detail.officialCostEur && (
              <div className="flex justify-between">
                <span className="text-muted">Kosten laut Projekt</span>
                <span className="tabular-nums">{eur(detail.officialCostEur)}</span>
              </div>
            )}
            {detail.officialOpeningYear && (
              <div className="flex justify-between">
                <span className="text-muted">Ziel-Eröffnung</span>
                <span className="tabular-nums">{detail.officialOpeningYear}</span>
              </div>
            )}
            {detail.openingYear && (
              <div className="flex justify-between">
                <span className="text-muted">Modellschätzung</span>
                <span className="tabular-nums">{detail.openingYear}</span>
              </div>
            )}
          </div>
        </section>
      )}

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={detail.included}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-4 w-4 accent-slate-900 dark:accent-slate-100"
        />
        Teil des Szenarios
      </label>

      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={() => onExtend('start')}>
          Anfang verlängern
        </button>
        <button className="btn" onClick={() => onExtend('finish')}>
          Ende verlängern
        </button>
        <button className="btn" onClick={() => onShorten('start')}>
          Anfang kürzen
        </button>
        <button className="btn" onClick={() => onShorten('finish')}>
          Ende kürzen
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={onRegenerate}>
          Stationen neu setzen
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          Linie löschen
        </button>
      </div>

      <section className="rounded-xl border border-line bg-surface p-3">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Farbe</div>
        <div className="flex flex-wrap gap-1.5">
          {['#2563EB', '#16A34A', '#DB2777', '#EA580C', '#7C3AED', '#0891B2', '#CA8A04', '#DC2626'].map((c) => (
            <button
              key={c}
              onClick={() => onSetColor(c)}
              aria-label={`Farbe ${c}`}
              className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-surface ${
                detail.color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-ink' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Laufweg
        </div>
        <ol className="p-1.5">
          {detail.stations.map(([id, name, isNew]) => (
            <li key={id}>
              <button
                onClick={() => onFocusStation(id)}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] hover:bg-subtle"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full ring-2"
                  style={{ backgroundColor: isNew ? detail.color : 'transparent', color: detail.color }}
                />
                <span className="truncate">{name}</span>
                {isNew && <span className="ml-auto shrink-0 text-[10px] uppercase text-muted">neu</span>}
              </button>
            </li>
          ))}
        </ol>
      </section>

      {detail.construction?.length > 0 && (
        <section className="rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            Bauweise
          </div>
          <div className="space-y-1 p-3">
            {detail.construction.map(([label, kms]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{label}</span>
                <span className="shrink-0 tabular-nums text-muted">{km(kms)}</span>
              </div>
            ))}
            <p className="pt-1 text-[11px] leading-snug text-muted">
              Je Abschnitt danach gewählt, was dort tatsächlich ginge: Wasser, Bebauungsdichte und
              vorhandene Bahnkorridore. Über den Abschnitt lässt sich das ändern.
            </p>
          </div>
        </section>
      )}
      {infrastructures.length > 0 && (
        <p className="text-[11px] leading-snug text-muted">
          Mögliche Bauweisen für {MODE_LABEL[detail.mode]}: {infrastructures.map((i) => i[1]).join(', ')}.
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5">
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
