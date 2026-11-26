'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api, ApiUnavailable, type ComparisonRow, type ScenarioSummary } from '@/lib/api';
import { cityLabel, count, eur, km, ratio } from '@/lib/format';

function formatValue(row: ComparisonRow, value: number) {
  if (row.unit === '€') return eur(value);
  if (row.unit === '€/a') return `${eur(value)}/Jahr`;
  if (row.unit === 'km') return km(value);
  if (row.unit === 't/a') return `${count(value)} t`;
  if (row.key === 'bcr') return ratio(value);
  if (row.key === 'opening') return value > 0 ? String(Math.round(value)) : '–';
  return count(value);
}

function ComparePageInner() {
  const params = useSearchParams();
  const [a, setA] = useState(params.get('a') ?? '');
  const [b, setB] = useState(params.get('b') ?? '');
  const [options, setOptions] = useState<ScenarioSummary[]>([]);
  const cityOfA = options.find((o) => o.slug === a)?.city ?? '';
  const cityOfB = options.find((o) => o.slug === b)?.city ?? '';
  const mismatch =
    cityOfA && cityOfB && cityOfA !== cityOfB
      ? `${cityLabel(cityOfA)} und ${cityLabel(cityOfB)}`
      : '';
  // A pair worth looking at, for the empty state: the two most popular plans
  // that share a city, since two cities cannot be compared meaningfully.
  const suggestion = (() => {
    for (const first of options) {
      const second = options.find((o) => o.city === first.city && o.slug !== first.slug);
      if (second) return [first, second] as const;
    }
    return null;
  })();
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [titles, setTitles] = useState<{ a: string; b: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sameModel, setSameModel] = useState(true);
  const [offline, setOffline] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    // "Es sind noch keine Entwürfe veröffentlicht" over a server that is simply
    // down says something false about the world — and it is the sentence a
    // reader is most likely to believe, because it is a plausible state.
    api
      .list({ sort: 'beliebt', limit: 60 })
      .then((o) => {
        setOptions(o);
        setOffline(false);
      })
      .catch((e) => {
        setOptions([]);
        setOffline(e instanceof ApiUnavailable);
      });
  }, []);

  useEffect(() => {
    if (!a || !b || a === b) {
      setRows(null);
      return;
    }
    api
      .compare(a, b)
      .then((r) => {
        setRows(r.rows);
        setTitles({ a: r.a.title, b: r.b.title });
        setSameModel(r.sameModel !== false);
        setError(null);
      })
      .catch((e) => {
        setError((e as Error).message);
        setRows(null);
      });
  }, [a, b]);

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-6 pb-16">
        <h1 className="text-[22px] font-semibold">Entwürfe vergleichen</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">
          Hier stehen zwei veröffentlichte Entwürfe nebeneinander, die direkt vergleichbar sind,
          weil beide Seiten mit demselben Modell und demselben Datenstand gerechnet wurden.
        </p>

        <div className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2">
          <Picker label="Entwurf A" value={a} onChange={setA} options={options} />
          <Picker
            label="Entwurf B"
            value={b}
            onChange={setB}
            // Once A is picked, only the same city can sensibly follow — but a
            // link that already names a plan from another city has to keep
            // showing it. Dropping it left the control on "— auswählen —" while
            // the notice below talked about two plans, which reads as a fault
            // in the page rather than in the pairing.
            options={
              cityOfA
                ? options.filter((o) => o.city === cityOfA || o.slug === b)
                : options
            }
          />
        </div>

        {/* A picture of the two side by side outlives the page it came from,
            so it may only be made when the two really are comparable. */}
        {rows && !mismatch && sameModel && (
          <div className="mt-4">
            <button
              className="btn btn-primary"
              disabled={sharing}
              onClick={async () => {
                setSharing(true);
                try {
                  // Both networks are needed for the picture, so the engine is
                  // loaded when the picture is asked for — not on every visit.
                  const { loadEngine } = await import('@/lib/engine');
                  const { openShareSheet } = await import('@/components/ShareSheet');
                  const [da, db] = await Promise.all([api.get(a), api.get(b)]);
                  const { engine, city } = await loadEngine(undefined, da.city);
                  const load = (d: typeof da) => {
                    engine.loadDocument(JSON.stringify(d.document));
                    return engine.renderState();
                  };
                  const renderA = load(da);
                  const renderB = load(db);
                  const stats = (d: typeof da) => ({
                    newKm: d.new_km,
                    newStations: d.new_stations,
                    investmentEur: d.investment_eur,
                    benefitEur: d.annual_benefit_eur,
                    bcr: d.benefit_cost_ratio,
                    openingYear: d.opening_year,
                  });
                  await openShareSheet({
                    title: da.title,
                    city: city.name,
                    dataSource: city.statistics?.label,
                    url: `${window.location.origin}/vergleich?a=${a}&b=${b}`,
                    summary: `${da.title} gegen ${db.title}, beide mit derselben Rechnung.`,
                    render: renderA,
                    stats: stats(da),
                    versus: { title: db.title, stats: stats(db), render: renderB },
                  });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSharing(false);
                }
              }}
            >
              {sharing ? 'Bild wird erzeugt …' : 'Vergleich teilen'}
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-[13px] text-rose-600">{error}</p>}

        {/* Comparing a Hamburg plan with a Berlin one is arithmetic without
            meaning: different networks, different populations, different
            baselines. Say so rather than putting the two columns side by side. */}
        {mismatch && (
          <p className="mt-4 rounded-xl border border-line bg-subtle p-3 text-[13px] leading-relaxed">
            Weil diese beiden Entwürfe zu verschiedenen Städten gehören ({mismatch}), hätten ihre
            Zahlen nebeneinander keine gemeinsame Grundlage. Vergleichen lassen sich nur Entwürfe
            derselben Stadt.
          </p>
        )}

        {/* The heading above promises both columns come from the same
            calculation. When they do not — one side stored before a
            recalibration, not yet swept — saying so is the whole point. */}
        {rows && !mismatch && !sameModel && (
          <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] leading-relaxed">
            Weil diese beiden Entwürfe mit <b>unterschiedlichen Modellständen</b> gerechnet wurden,
            lassen sich ihre Zahlen nicht direkt vergleichen, bis der ältere in Kürze neu berechnet
            ist.
          </p>
        )}

        {mismatch ? null : !rows ? (
          /* An empty page with one grey sentence on it does not tell anyone
             what a comparison is for. This says it, and offers a pair to try. */
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-[15px] font-semibold">
                {offline
                  ? 'Der Server ist gerade nicht erreichbar'
                  : options.length === 0
                    ? 'Noch ist nichts veröffentlicht'
                    : 'Wähle zwei Entwürfe'}
              </h2>
              <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-muted">
                {offline
                  ? 'Veröffentlichte Entwürfe lassen sich deshalb nicht laden, während der Editor weiter funktioniert.'
                  : options.length === 0
                    ? 'Sobald jemand ein Netz veröffentlicht, lässt es sich hier gegen ein anderes stellen.'
                    : 'Der Vergleich stellt zwei Netze Kennzahl für Kennzahl nebeneinander. Weil beide Seiten mit derselben Rechnung entstanden sind, ist der Unterschied aussagekräftig, anders als bei Zahlen aus verschiedenen Quellen.'}
              </p>
              {suggestion && (
                <button
                  onClick={() => {
                    setA(suggestion[0].slug);
                    setB(suggestion[1].slug);
                  }}
                  className="btn btn-primary mt-4"
                >
                  {suggestion[0].title} gegen {suggestion[1].title}
                </button>
              )}
            </section>

            {/* What the table will hold, so the shape of the answer is visible
                before there is one. */}
            <section className="rounded-2xl border border-line bg-subtle/60 p-5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Verglichen wird
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] text-muted">
                {[
                  'Netzlänge',
                  'Neubau',
                  'Stationen',
                  'Investition',
                  'Eröffnung',
                  'Jährlicher Nutzen',
                  'Fiskaleffekt',
                  'Nutzen-Kosten',
                ].map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span aria-hidden className="h-1 w-1 rounded-full bg-muted/50" />
                    {k}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="p-3 font-medium text-muted">Kennzahl</th>
                  <th className="p-3 text-right font-semibold">
                    <Link href={`/szenario/${a}`} className="hover:underline">
                      {titles?.a}
                    </Link>
                  </th>
                  <th className="p-3 text-right font-semibold">
                    <Link href={`/szenario/${b}`} className="hover:underline">
                      {titles?.b}
                    </Link>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const aWins = r.higherIsBetter ? r.a > r.b : r.a < r.b;
                  const tie = r.a === r.b;
                  return (
                    <tr key={r.key} className="border-b border-line/60 last:border-0">
                      <td className="p-3 text-muted">{r.label}</td>
                      <td className={`p-3 text-right tabular-nums ${!tie && aWins ? 'font-semibold' : ''}`}>
                        {formatValue(r, r.a)}
                      </td>
                      <td className={`p-3 text-right tabular-nums ${!tie && !aWins ? 'font-semibold' : ''}`}>
                        {formatValue(r, r.b)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-line p-3 text-[11px] leading-snug text-muted">
              Hervorgehoben ist jeweils der günstigere Wert, was nicht bedeutet, dass ein Entwurf
              insgesamt besser ist, denn welche Kennzahl zählt, ist eine politische Frage.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ScenarioSummary[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px]"
      >
        <option value="">auswählen …</option>
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="p-8 text-[14px] text-muted">Wird geladen …</div>}>
      <ComparePageInner />
    </Suspense>
  );
}
