'use client';

// The analysis panel. The default view shows only the five things the plan
// says it should — network, cost, time, benefit, feasibility — and everything
// else is one tap away (plan §80).

import { useState } from 'react';
import {
  BASIS_LABEL,
  count,
  eur,
  eurPerYear,
  eurRange,
  km,
  MODE_LABEL,
  minutes,
  people,
  percent,
  ratio,
  SEVERITY_LABEL,
  tonnes,
} from '@/lib/format';
import type { Relation, SimulationResult, Trip, ZoneConnectivity } from '@/lib/types';
import { AnimatedNumber } from '../AnimatedNumber';
import { Explain } from '../Explain';
import { EXPLAIN, localise } from '@/lib/explanations';
import { PanelTab, useUi } from '@/lib/store';
import type { CityFigures } from '@/lib/explanations';

/** The loaded city's name, for the labels that name a public budget. */
/**
 * Whose budget the fiscal effect lands in.
 *
 * The editor knows its city from the store. This panel is also used on a
 * published plan's page, where the store holds whatever the *reader* last had
 * open — or nothing — so a Berlin plan was labelled "Haushalt Hamburg". The
 * plan's own city is passed in there.
 */
let override: { name?: string; figures?: CityFigures | null } = {};
function cityName() {
  return override.name ?? useUi.getState().city?.name ?? 'Hamburg';
}
/** The figures the explanations quote. Same reasoning as the name above. */
function cityFigures() {
  return override.figures ?? useUi.getState().cityFigures;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'analysis', label: 'Überblick' },
  { id: 'invoice', label: 'Kosten' },
  { id: 'timeline', label: 'Zeitplan' },
  { id: 'economics', label: 'Wirkung' },
  { id: 'connections', label: 'Verbindungen' },
  { id: 'feasibility', label: 'Baubarkeit' },
  { id: 'assumptions', label: 'Grundlagen' },
];

export function Analysis({
  result,
  compact = false,
  city,
  figures,
  existingOff = 0,
  onRestoreExisting,
}: {
  result: SimulationResult | null;
  compact?: boolean;
  /** The plan's city, where that is not the one the reader has loaded. */
  city?: string;
  /** That city's own figures, for the explanations. */
  figures?: CityFigures | null;
  /** Existing lines switched off in this scenario. The figures are differences
   *  against today's network, so switching parts of it off pushes them below
   *  zero — correct, and baffling unless the panel says so. */
  existingOff?: number;
  /** Switches the existing network back on, where that is possible. Absent on a
   *  published plan's page, which nobody can edit. */
  onRestoreExisting?: () => void;
}) {
  const tab = useUi((s) => s.panelTab);
  const set = useUi((s) => s.set);
  override = { name: city, figures };
  if (!result) return <div className="p-4 text-sm text-muted">Wird gerechnet …</div>;

  return (
    <div className="flex h-full flex-col">
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => set({ panelTab: t.id })}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
              tab === t.id ? 'bg-ink text-paper' : 'text-muted hover:bg-subtle'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'analysis' && (
          <Overview
            result={result}
            compact={compact}
            existingOff={existingOff}
            onRestoreExisting={onRestoreExisting}
          />
        )}
        {tab === 'invoice' && <Invoice result={result} />}
        {tab === 'timeline' && <Timeline result={result} />}
        {tab === 'economics' && <Economics result={result} />}
        {tab === 'connections' && <Connections result={result} />}
        {tab === 'feasibility' && <Feasibility result={result} />}
        {tab === 'assumptions' && <Assumptions result={result} />}
      </div>
      <p className="shrink-0 border-t border-line px-4 py-2 text-[11px] leading-snug text-muted">
        {result.disclaimer}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = 'default',
  explain,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'default' | 'good' | 'bad';
  explain?: keyof typeof EXPLAIN;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
        {explain && <Explain info={localise(EXPLAIN[explain], cityFigures())} label={label} />}
      </div>
      <div
        className={`mt-1 text-[19px] font-semibold tabular-nums leading-tight ${
          tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : ''
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}

function Overview({
  result,
  compact,
  existingOff,
  onRestoreExisting,
}: {
  result: SimulationResult;
  compact: boolean;
  existingOff: number;
  onRestoreExisting?: () => void;
}) {
  const h = result.headline;
  const nothing = h.investmentEur <= 0;
  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="Netz"
          explain="network"
          value={<AnimatedNumber value={h.networkKm} format={km} />}
          sub={`${count(h.stations)} Stationen · ${count(h.interchanges)} Umstiege`}
        />
        <Metric
          label="Neubau"
          explain="newKm"
          value={<AnimatedNumber value={h.newKm} format={km} />}
          sub={`${count(h.newStations)} neue Stationen`}
        />
        <Metric
          label="Investition"
          explain="investment"
          value={nothing ? '–' : <AnimatedNumber value={h.investmentEur} format={eur} />}
          sub={nothing ? 'Im Szenario ist nichts zu bauen' : eurRange(h.investmentLowEur, h.investmentHighEur)}
        />
        <Metric
          label="Eröffnung"
          explain="opening"
          value={h.openingYear ?? '–'}
          sub={
            h.openingYear
              ? `${result.timeline.openingYearLow}–${result.timeline.openingYearHigh}`
              : 'kein Bauprogramm'
          }
        />
      </div>

      {/* Without this, a minus in front of "Nutzen" looks like a broken model.
          It is not: the reference is the network Hamburg or Berlin actually
          runs today, and a city missing some of its own lines really does score
          below it. */}
      {existingOff > 0 && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] leading-relaxed">
          {existingOff === 1 ? 'Eine Bestandslinie ist' : `${count(existingOff)} Bestandslinien sind`}{' '}
          abgeschaltet. Weil alle Zahlen unten mit dem <b>heutigen Netz</b> verglichen werden, das
          vollständig fährt, schneidet ein Szenario, in dem Teile davon fehlen, schlechter ab,
          sodass der Nutzen negativ wird.
          {onRestoreExisting && (
            <>
              {' '}
              <button onClick={onRestoreExisting} className="font-semibold underline">
                Bestand wieder einschalten
              </button>
            </>
          )}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {/* Green is a claim, not a colour. These two are differences against
            today's network and can legitimately come out below it — switch a few
            existing lines off and the city really is worse than it is now. Shown
            in green regardless, a minus sign read as a rendering fault rather
            than as the answer. */}
        <Metric
          label="Nutzen"
          explain="benefit"
          value={<AnimatedNumber value={h.annualBenefitEur} format={(v) => eurPerYear(v, { sign: true })} />}
          sub="gegenüber dem heutigen Netz, pro Jahr"
          tone={h.annualBenefitEur >= 0 ? 'good' : 'bad'}
        />
        <Metric
          label="Fiskaleffekt"
          explain="fiscal"
          value={<AnimatedNumber value={h.annualFiscalEur} format={(v) => eurPerYear(v, { sign: true })} />}
          sub={`Haushalt ${cityName()}`}
          tone={h.annualFiscalEur >= 0 ? 'good' : 'bad'}
        />
        <Metric
          label="Betrieb"
          explain="operating"
          value={<AnimatedNumber value={h.annualOperatingEur} format={eurPerYear} />}
          sub={`Kostendeckung ${percent(result.operations.costRecoveryRatio)}`}
          tone={h.annualOperatingEur >= 0 ? 'good' : 'bad'}
        />
        <Metric
          label="Nutzen-Kosten"
          explain="bcr"
          value={<AnimatedNumber value={h.benefitCostRatio} format={ratio} />}
          sub={h.benefitCostRatio >= 1 ? 'förderfähig nach GVFG' : 'unter der Förderschwelle'}
          tone={h.benefitCostRatio >= 1 ? 'good' : 'bad'}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Baubarkeit</div>
          <Explain info={localise(EXPLAIN.feasibility, cityFigures())} label="Baubarkeit" />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <FeasibilityDot cls={result.feasibility.class} />
          <span className="text-[15px] font-semibold">{h.feasibility}</span>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted">{result.feasibility.summary}</p>
      </div>

      {!compact && (
        <div className="grid grid-cols-2 gap-2">
          <Metric
            label="Einsteiger"
            explain="boardings"
            value={count(h.boardingsPerDay)}
            sub="je Werktag im Gesamtnetz"
          />
          {/* Two numbers, because the big one answers a different question
              than people think it does. 1,5 Mio. is what the finished network
              reaches, existing lines included — draw a single tram stop and it
              still says 1,4 Mio. The second line is what this plan actually
              added, which is the figure someone is looking for when they ask
              how much their line is worth. */}
          <Metric
            label="Erschlossen"
            explain="population"
            value={count(h.populationServed)}
            sub={
              h.populationGain > 0
                ? `Einwohner in Gehweite, davon ${count(h.populationGain)} neu`
                : 'Einwohner mit Station in Gehweite'
            }
          />
          <Metric label="CO₂" explain="co2" value={tonnes(h.co2SavedTPerYear)} sub="Einsparung pro Jahr" />
          {/* The time saved across every journey, changes included, rather
              than the access time to a handful of centres, which a line
              between two outer districts barely moves. */}
          <Metric
            label="Zeitgewinn"
            explain="timeSaved"
            value={`${count(result.demand.hoursSavedPerDay)} h`}
            sub="Reisezeit je Werktag, Umstiege eingerechnet"
            tone={result.demand.hoursSavedPerDay < 0 ? 'bad' : 'default'}
          />
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Netz nach Verkehrsmittel</div>
        <div className="mt-2 space-y-1.5">
          {h.kmByMode.map(([mode, value]) => (
            <div key={mode} className="flex items-center gap-2 text-[13px]">
              <span className="w-24 shrink-0 text-muted">{MODE_LABEL[mode] ?? mode}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                <span
                  className="block h-full rounded-full bg-ink/70 transition-[width] duration-500"
                  style={{ width: `${Math.min(100, (value / Math.max(1, h.networkKm)) * 100)}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums">{km(value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FeasibilityDot({ cls }: { cls: string }) {
  const color =
    cls === 'straightforward'
      ? 'bg-emerald-500'
      : cls === 'demanding'
        ? 'bg-amber-500'
        : cls === 'difficult'
          ? 'bg-orange-500'
          : 'bg-rose-500';
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />;
}

function Invoice({ result }: { result: SimulationResult }) {
  const [open, setOpen] = useState<string | null>(null);
  const c = result.cost;
  if (!c.categories.length) {
    return <p className="p-4 text-sm text-muted">In diesem Szenario muss nichts gebaut werden.</p>;
  }
  return (
    <div className="p-3">
      <div className="rounded-xl border border-line bg-surface">
        <div className="border-b border-line p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Investitionsschätzung</div>
          <div className="mt-0.5 text-[24px] font-semibold tabular-nums">{eur(c.totalEur)}</div>
          <div className="text-[12px] text-muted">Spanne {eurRange(c.lowEur, c.highEur)}</div>
        </div>
        <ul>
          {c.categories.map((cat) => (
            <li key={cat.key} className="border-b border-line last:border-0">
              <button
                onClick={() => setOpen(open === cat.key ? null : cat.key)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-subtle"
                aria-expanded={open === cat.key}
              >
                <span
                  className={`text-muted transition-transform ${open === cat.key ? 'rotate-90' : ''}`}
                  aria-hidden
                >
                  ▸
                </span>
                <span className="flex-1 text-[14px]">{cat.label}</span>
                <span className="tabular-nums text-[14px] font-medium">{eur(cat.amountEur)}</span>
              </button>
              {open === cat.key && (
                <ul className="bg-subtle/50 px-3 pb-2">
                  {cat.items.slice(0, 60).map((item, i) => (
                    <li key={i} className="flex gap-2 border-t border-line/60 py-2 text-[12px] first:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.label}</div>
                        <div className="text-muted">
                          {item.detail}
                          <span className="ml-1 rounded bg-line px-1 py-px text-[10px] uppercase tracking-wide">
                            {BASIS_LABEL[item.basis]}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 tabular-nums">{eur(item.amountEur)}</div>
                    </li>
                  ))}
                  {cat.items.length > 60 && (
                    <li className="py-2 text-[12px] text-muted">… und {cat.items.length - 60} weitere Positionen</li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t-2 border-ink/20 px-3 py-3 text-[15px] font-semibold">
          <span>Gesamt</span>
          <span className="tabular-nums">{eur(c.totalEur)}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Metric label="Tunnel" value={km(c.tunnelKm)} />
        <Metric label="Oberirdisch" value={km(c.surfaceKm)} />
        <Metric label="Hochlage" value={km(c.elevatedKm)} />
      </div>

      <ul className="mt-3 space-y-1 text-[11px] leading-snug text-muted">
        {c.notes.map((n, i) => (
          <li key={i}>· {n}</li>
        ))}
      </ul>
    </div>
  );
}

function Timeline({ result }: { result: SimulationResult }) {
  const t = result.timeline;
  if (t.nothingToBuild) {
    return <p className="p-4 text-sm text-muted">In diesem Szenario muss nichts gebaut werden.</p>;
  }
  const span = Math.max(1, t.phases[t.phases.length - 1].end - t.phases[0].start);
  return (
    <div className="space-y-3 p-3">
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Geschätzte Eröffnung</div>
        <div className="mt-0.5 text-[28px] font-semibold tabular-nums">{t.openingYear}</div>
        <div className="text-[12px] text-muted">
          realistische Spanne {t.openingYearLow}–{t.openingYearHigh} · Bauzeit {t.constructionYears.toFixed(1)} Jahre
        </div>
      </div>
      <ol className="space-y-2">
        {t.phases.map((p) => (
          <li key={p.key} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-medium">{p.label}</span>
              <span className="shrink-0 tabular-nums text-[12px] text-muted">
                {Math.floor(p.start)}–{Math.ceil(p.end)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle">
              <div
                className="h-full rounded-full bg-ink/60 transition-[width,margin] duration-500"
                style={{
                  marginLeft: `${((p.start - t.phases[0].start) / span) * 100}%`,
                  width: `${Math.max(1.5, ((p.end - p.start) / span) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">{p.description}</p>
          </li>
        ))}
      </ol>
      <ul className="space-y-1 text-[11px] leading-snug text-muted">
        {t.notes.map((n, i) => (
          <li key={i}>· {n}</li>
        ))}
      </ul>
    </div>
  );
}

function Economics({ result }: { result: SimulationResult }) {
  const e = result.economics;
  const f = result.fiscal;
  const o = result.operations;
  const a = result.appraisal;
  const max = Math.max(...e.items.map((i) => Math.abs(i.amountEurPerYear)), 1);
  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Nutzen/Jahr" value={eur(e.annualBenefitEur)} sub={eurRange(e.annualBenefitLowEur, e.annualBenefitHighEur)} />
        <Metric label="Barwert" value={eur(a.npvEur)} tone={a.npvEur >= 0 ? 'good' : 'bad'} sub={`NKV ${ratio(a.benefitCostRatio)}`} />
        <Metric label="Amortisation" value={a.paybackYear ?? 'nicht im Zeitraum'} sub="kumulierter Saldo positiv" />
        <Metric
          label="Bundesförderung"
          value={f.federalFundingEligible ? eur(f.federalFundingEur) : 'nicht förderfähig'}
          sub={f.federalFundingEligible ? 'GVFG-Bundesprogramm, modellhaft' : 'NKV unter 1,0'}
        />
      </div>

      <Section title="Woraus der Nutzen entsteht">
        {e.items.map((i) => (
          <div key={i.key} className="border-t border-line/60 py-2 first:border-0">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span>{i.label}</span>
              <span className="shrink-0 tabular-nums font-medium">{eurPerYear(i.amountEurPerYear)}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-subtle">
              <div
                className={`h-full rounded-full ${i.amountEurPerYear >= 0 ? 'bg-emerald-500/70' : 'bg-rose-500/70'}`}
                style={{ width: `${(Math.abs(i.amountEurPerYear) / max) * 100}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] leading-snug text-muted">{i.basis}</div>
          </div>
        ))}
      </Section>
      {/* Two of these items are wider economic effects. They are the least
          certain part of the calculation and, in some scenarios, the largest —
          and a German Standardisierte Bewertung would not count them at all.
          Naming the figure without them is the only way the number can be read
          against an official appraisal. */}
      <div className="rounded-xl border border-line bg-subtle/60 p-3 text-[12px] leading-relaxed">
        <div className="flex items-baseline justify-between gap-2 font-medium">
          <span>Ohne weitere volkswirtschaftliche Wirkungen</span>
          <span className="shrink-0 tabular-nums">{eurPerYear(e.annualBenefitCoreEur)}</span>
        </div>
        <p className="mt-1 text-muted">
          Produktivität und Bodenwerte sind hier herausgerechnet, weil die Standardisierte
          Bewertung sie nicht mitzählt. Da sie dafür Wirkungen berücksichtigt, die dieses Modell
          nicht kennt, etwa eingesparte Busleistung, sind veröffentlichte
          Nutzen-Kosten-Verhältnisse nicht direkt vergleichbar.
        </p>
      </div>


      <Section title="Fiskalische Rückflüsse">
        {f.items.map((i) => (
          <div key={i.key} className="flex items-baseline justify-between gap-2 border-t border-line/60 py-2 text-[13px] first:border-0">
            <div className="min-w-0">
              <div>{i.label}</div>
              <div className="text-[11px] leading-snug text-muted">{i.level} · {i.basis}</div>
            </div>
            <span className="shrink-0 tabular-nums font-medium">{eurPerYear(i.amountEurPerYear)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-line pt-2 text-[13px] font-semibold">
          <span>Haushalt {cityName()}</span>
          <span className="tabular-nums">{eurPerYear(f.annualCityEur)}</span>
        </div>
      </Section>

      <Section title="Betriebswirtschaft">
        {o.items.map((i) => (
          <div key={i.key} className="flex items-baseline justify-between gap-2 border-t border-line/60 py-2 text-[13px] first:border-0">
            <div className="min-w-0">
              <div>{i.label}</div>
              <div className="text-[11px] leading-snug text-muted">{i.basis}</div>
            </div>
            <span className="shrink-0 tabular-nums font-medium">{eurPerYear(i.amountEurPerYear)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-line pt-2 text-[13px] font-semibold">
          <span>Ergebnis</span>
          <span className="tabular-nums">{eurPerYear(o.annualResultEur)}</span>
        </div>
      </Section>

      <Section title="Kosten und Nutzen über die Zeit">
        <Sparkline series={a.series} />
      </Section>

      <ul className="space-y-1 text-[11px] leading-snug text-muted">
        {[...e.notes, ...f.notes, ...o.notes, ...a.notes].map((n, i) => (
          <li key={i}>· {n}</li>
        ))}
      </ul>
    </div>
  );
}

function Sparkline({ series }: { series: SimulationResult['appraisal']['series'] }) {
  if (series.length < 2) return null;
  const w = 320;
  const h = 90;
  const values = series.map((s) => s.cumulativeNetEur);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const x = (i: number) => (i / (series.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / range) * h;
  const path = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.cumulativeNetEur).toFixed(1)}`).join(' ');
  const zero = y(0);
  const last = series[series.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" role="img" aria-label="Kumulierter Saldo über die Zeit">
        <line x1={0} y1={zero} x2={w} y2={zero} className="stroke-current text-muted/40" strokeWidth={1} />
        <path d={path} fill="none" className="stroke-current text-ink" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[11px] text-muted">
        <span>{series[0].year}</span>
        <span className="tabular-nums">Saldo {series[series.length - 1].year}: {eur(last.cumulativeNetEur)}</span>
      </div>
    </div>
  );
}

/** "74 min, 2 Umstiege", "41 min, direkt" or "keine Bahnverbindung": the model knows rail only, and buses run almost everywhere. */
function trip(t: Trip | null) {
  if (!t) return 'keine Bahnverbindung';
  const changes = t.changes === 0 ? 'direkt' : t.changes === 1 ? '1 Umstieg' : `${t.changes} Umstiege`;
  return `${count(t.minutes)} min, ${changes}`;
}

function RelationRow({ r }: { r: Relation }) {
  return (
    <li className="border-t border-line/60 py-2 first:border-0">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="min-w-0 font-medium">
          {r.fromName} – {r.toName}
        </span>
        <span
          className={`shrink-0 tabular-nums ${
            r.hoursPerDay >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {r.hoursPerDay >= 0 ? '+' : '−'}
          {count(Math.abs(r.hoursPerDay))} h
        </span>
      </div>
      <div className="mt-0.5 text-[12px] leading-snug text-muted">
        {trip(r.before)} → <span className="text-ink">{trip(r.after)}</span> · {count(r.tripsPerDay)} Fahrten
      </div>
    </li>
  );
}

const ZONES_SHOWN = 12;

/**
 * How much closer the parts of the city and the region move together.
 *
 * The question this answers is the one the access measure misses: not how
 * quickly a quarter reaches the centre, but how quickly it reaches every other
 * quarter, changes included.
 */
function Connections({ result }: { result: SimulationResult }) {
  const c = result.demand.connectivity;
  const [region, setRegion] = useState(false);
  const [all, setAll] = useState(false);
  if (!c || !c.model) {
    return (
      <p className="p-4 text-[13px] text-muted">
        Für dieses Ergebnis liegen keine Verbindungsdaten vor, weil es mit einer älteren Modellversion
        gerechnet wurde.
      </p>
    );
  }
  const delta = (z: ZoneConnectivity) => z.meanMinBefore - z.meanMinAfter;
  const zones = c.zones
    .filter((z) => region || z.kind === 'district')
    .filter((z) => Math.abs(delta(z)) >= 0.05 || Math.abs(z.reachableAfter - z.reachableBefore) >= 1)
    .sort((a, b) => delta(b) - delta(a));
  const shown = all ? zones : zones.slice(0, ZONES_SHOWN);
  const tripsGain = c.tripsBefore > 0 ? c.tripsAfter / c.tripsBefore - 1 : 0;
  const regional = c.zones.filter((z) => z.kind === 'region').length;

  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="Zeitgewinn"
          explain="timeSaved"
          value={`${count(c.hoursSavedPerDay)} h`}
          sub="je Werktag, Umstiege eingerechnet"
          tone={c.hoursSavedPerDay < 0 ? 'bad' : 'default'}
        />
        <Metric
          label="Bahnfahrten"
          value={count(c.tripsAfter)}
          sub={`je Werktag, ${tripsGain >= 0 ? '+' : '−'}${percent(Math.abs(tripsGain), 1)} gegenüber heute`}
        />
      </div>

      <Section title="Schnellere Verbindungen">
        {c.improved.length === 0 ? (
          <p className="py-1 text-[12px] text-muted">Das Szenario verkürzt keine Verbindung messbar.</p>
        ) : (
          <ul>
            {c.improved.map((r) => (
              <RelationRow key={`${r.from}-${r.to}`} r={r} />
            ))}
          </ul>
        )}
      </Section>

      {c.worsened.length > 0 && (
        <Section title="Langsamere Verbindungen">
          <ul>
            {c.worsened.map((r) => (
              <RelationRow key={`${r.from}-${r.to}`} r={r} />
            ))}
          </ul>
        </Section>
      )}

      <Section title={region ? 'Stadtteile und Umland' : 'Stadtteile'}>
        <div className="flex items-center justify-between gap-2 pb-1 text-[11px] text-muted">
          <span>Mittlere Reisezeit · in 45 min erreichbar</span>
          {regional > 0 && (
            <button onClick={() => setRegion(!region)} className="shrink-0 font-medium underline">
              {region ? 'nur Stadtteile' : 'mit Umland'}
            </button>
          )}
        </div>
        {zones.length === 0 ? (
          <p className="py-1 text-[12px] text-muted">Kein Stadtteil rückt messbar näher an die übrigen heran.</p>
        ) : (
          <ul>
            {shown.map((z) => (
              <li key={z.id} className="border-t border-line/60 py-1.5 first:border-0">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate">
                    {z.name}
                    {z.kind === 'region' && <span className="ml-1 text-[11px] text-muted">Umland</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {count(z.meanMinBefore)} → {count(z.meanMinAfter)} min
                  </span>
                </div>
                <div className="text-right text-[12px] tabular-nums text-muted">
                  {people(z.reachableBefore)} → {people(z.reachableAfter)} Einwohner und Arbeitsplätze
                </div>
              </li>
            ))}
          </ul>
        )}
        {zones.length > ZONES_SHOWN && (
          <button onClick={() => setAll(!all)} className="mt-1 text-[12px] font-medium underline">
            {all ? 'weniger zeigen' : `alle ${count(zones.length)} zeigen`}
          </button>
        )}
      </Section>

      <p className="px-1 text-[11px] leading-relaxed text-muted">
        Die mittlere Reisezeit gilt von Tür zu Tür zu allen Stadtteilen, gewichtet nach deren Einwohnern
        und Arbeitsplätzen. Wer keine Station in 1,2 km Fußweg hat, und jedes Ziel ohne Station gehen mit
        180 Minuten ein, damit eine neue Anbindung die Zahl stets senkt; deshalb liegen schlecht
        angebundene Stadtteile weit über den tatsächlichen Fahrzeiten. Außerhalb der Stadt fasst das
        Modell Einwohner und Arbeitsplätze in Kacheln von 5 km Kantenlänge zusammen, die nach dem
        wichtigsten Ort darin benannt sind.
      </p>
    </div>
  );
}

function Feasibility({ result }: { result: SimulationResult }) {
  const f = result.feasibility;
  return (
    <div className="space-y-3 p-3">
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <FeasibilityDot cls={f.class} />
          <span className="text-[15px] font-semibold">{result.headline.feasibility}</span>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted">{f.summary}</p>
      </div>
      {f.findings.length === 0 ? (
        <p className="px-1 text-[13px] text-muted">Keine Auffälligkeiten.</p>
      ) : (
        <ul className="space-y-2">
          {f.findings.map((finding, i) => (
            <li key={i} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    finding.severity === 'blocking'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      : finding.severity === 'warning'
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
                        : finding.severity === 'caution'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-subtle text-muted'
                  }`}
                >
                  {SEVERITY_LABEL[finding.severity]}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{finding.title}</div>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted">{finding.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Assumptions({ result }: { result: SimulationResult }) {
  const d = result.demand;
  return (
    <div className="space-y-3 p-3">
      <Section title="Versionen">
        <Row label="Rechenmodell" value={result.calculationVersion} />
        <Row label={`Daten ${cityName()}`} value={result.dataVersion} />
      </Section>
      <Section title="Nachfrage">
        <Row label="Einsteiger je Werktag" value={count(d.boardingsPerDay)} />
        <Row label="davon durch Neubauten" value={count(d.newBoardingsPerDay)} />
        <Row label="Fahrten je Jahr" value={`${count(d.annualRides / 1e6)} Mio.`} />
        <Row label="Erschlossene Einwohner, vorher" value={count(d.populationServedBefore)} />
        <Row label="Erschlossene Einwohner, nachher" value={count(d.populationServedAfter)} />
        <Row label="Erreichbarkeit vorher" value={minutes(d.accessTimeBeforeMin)} />
        <Row label="Erreichbarkeit nachher" value={minutes(d.accessTimeAfterMin)} />
        <Row label="Ersetzte Autofahrten je Werktag" value={count(d.carTripsReplacedPerDay)} />
      </Section>
      <Section title="Was das Modell nicht kann">
        <p className="py-1 text-[12px] leading-relaxed text-muted">
          Das Modell kennt weder Baugrund noch Leitungslage, Grundstücksverhältnisse oder
          politische Verfahren, weil es nur mit Kennwerten aus veröffentlichten Projekten und mit
          offenen Geo- und Statistikdaten rechnet. Die Ergebnisse sind deshalb Größenordnungen,
          mit denen sich Entwürfe untereinander vergleichen lassen, und keine Planungsgrundlage.
        </p>
      </Section>
      <ul className="space-y-1 text-[11px] leading-snug text-muted">
        {d.notes.map((n, i) => (
          <li key={i}>· {n}</li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-t border-line/60 py-1.5 text-[13px] first:border-0">
      <span className="text-muted">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
