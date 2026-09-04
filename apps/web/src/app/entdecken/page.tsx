'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { ScenarioCard } from '@/components/ScenarioCard';
import { CITY_KEY } from '@/lib/drafts';
import { api, ApiUnavailable, type Board, type ScenarioSummary } from '@/lib/api';
import { count, eur, eurPerYear, km, ratio } from '@/lib/format';

const SORTS = [
  { key: 'neu', label: 'Neu' },
  { key: 'beliebt', label: 'Beliebt' },
  { key: 'nkv', label: 'Bestes Nutzen-Kosten-Verhältnis' },
  { key: 'nutzen', label: 'Größter Nutzen' },
  { key: 'fiskal', label: 'Fiskaleffekt' },
  { key: 'laenge', label: 'Meiste Kilometer' },
  { key: 'erschlossen', label: 'Meiste Menschen neu erreicht' },
  { key: 'guenstig', label: 'Günstigste' },
  { key: 'schnell', label: 'Schnellste' },
  { key: 'co2', label: 'CO₂' },
];

export default function DiscoverPage() {
  const [sort, setSort] = useState('neu');
  const [search, setSearch] = useState('');
  // Start with the city the reader was last working in, not with all of them.
  //
  // Mixed, the boards that measure absolute size mostly report which city is
  // bigger: Berlin has more people within reach of any line than Hamburg does,
  // before anyone has drawn anything. "Alle" is still there, and is the right
  // answer for browsing — it is the wrong one for a ranking.
  const [city, setCity] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem(CITY_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [cities, setCities] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<ScenarioSummary[] | null>(null);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .list({ sort, search, city: city || undefined, limit: 36 })
      .then((r) => {
        if (!cancelled) {
          setItems(r);
          setOffline(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setOffline(e instanceof ApiUnavailable);
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sort, search, city]);

  // The city filter is only worth showing once the server serves more than one.
  useEffect(() => {
    api
      .meta()
      .then((m) => setCities(m.cities ?? []))
      .catch(() => setCities([]));
  }, []);

  // The boards follow the city filter. Mixed, the ones measuring absolute size
  // mostly report which city is bigger — Berlin outscores Hamburg on reach and
  // benefit before anyone has drawn anything.
  useEffect(() => {
    let cancelled = false;
    api
      .leaderboards(city || undefined)
      .then((b) => !cancelled && setBoards(b))
      .catch(() => !cancelled && setBoards([]));
    return () => {
      cancelled = true;
    };
  }, [city]);

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* The heading sat alone above a wide empty band. What is in the
            collection is worth saying there, and it is the one thing the page
            can state before the reader has picked anything. */}
        <header className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <h1 className="text-[22px] font-semibold">Entwürfe entdecken</h1>
            <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">
              Veröffentlichte Netzentwürfe anderer. Alle Kennzahlen sind Modellschätzungen, auf dem
              Server mit demselben Modell neu berechnet, nicht die Angaben der Einreichenden.
            </p>
          </div>
          {items && items.length > 0 && (
            <dl className="flex gap-6 text-[13px]">
              {[
                ['Entwürfe', count(items.length)],
                ['Neubau zusammen', km(items.reduce((t, s) => t + s.new_km, 0))],
                ['geplante Stationen', count(items.reduce((t, s) => t + s.new_stations, 0))],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    {label}
                  </dt>
                  <dd className="mt-0.5 text-[18px] font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>

        {/* One surface for everything that changes what you are looking at.
            Loose on the page, the sorts, the city and the search read as three
            unrelated things floating in the margin. */}
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-sm">
          <div className="flex flex-wrap gap-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${
                  sort === s.key ? 'bg-ink text-paper shadow-sm' : 'text-muted hover:bg-subtle'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {cities.length > 1 && (
            <div className="ml-auto flex gap-1 rounded-full bg-subtle p-1 ring-1 ring-line">
              {[{ id: '', name: 'Alle' }, ...cities].map((c) => (
                <button
                  key={c.id || 'alle'}
                  onClick={() => setCity(c.id)}
                  aria-pressed={city === c.id}
                  className={`rounded-full px-3 py-1 text-[13px] font-medium transition-all active:scale-95 ${
                    city === c.id ? 'bg-paper shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen …"
            className={`w-44 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] ${
              cities.length > 1 ? '' : 'ml-auto'
            }`}
            aria-label="Entwürfe durchsuchen"
          />
        </div>

        {items === null ? (
          <p className="text-[14px] text-muted">Wird geladen …</p>
        ) : offline ? (
          <EmptyState
            title="Der Server ist nicht erreichbar"
            body="Der Editor funktioniert auch ohne Server. Entwürfe lassen sich als Datei speichern und wieder öffnen. Zum Veröffentlichen und Diskutieren muss der API-Server laufen."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Noch nichts veröffentlicht"
            body="Zeichne im Editor ein Netz und veröffentliche es, dann steht es hier."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((s) => (
              <ScenarioCard key={s.slug} s={s} highlight={sort} />
            ))}
          </div>
        )}

        {boards && boards.length > 0 && (
          <section className="mt-10">
            <h2 className="text-[18px] font-semibold">Ranglisten</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-muted">
              Bewusst mehrere Ranglisten statt einer Gesamtpunktzahl: ein sparsames Netz, ein
              schnell gebautes und ein wirksames Netz sind verschiedene Dinge. Gemessen wird,
              was ein Entwurf <em>bewirkt</em>, nicht, wie wenig er tut: sonst gewönne die
              kürzeste denkbare Strecke jede Rangliste, bei der weniger besser ist.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {boards.map((b) => (
                <div key={b.key} className="rounded-2xl border border-line bg-surface p-3">
                  <h3 className="text-[13px] font-semibold">{b.label}</h3>
                  <ol className="mt-2 space-y-1">
                    {/* "noch leer" would be a lie on the coverage board: with a
                        1 200 m catchment, inner-city lines reach people who
                        already have a station, so a city can genuinely have no
                        entry rather than merely no submissions yet. */}
                    {b.entries.length === 0 && (
                      <li className="text-[12px] text-muted">{EMPTY[b.key] ?? 'noch leer'}</li>
                    )}
                    {b.entries.map((e, i) => (
                      <li key={e.slug} className="flex items-baseline gap-2 text-[13px]">
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums ${
                            i === 0 ? 'bg-ink text-paper' : 'bg-subtle text-muted'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <Link href={`/szenario/${e.slug}`} className="min-w-0 flex-1 truncate hover:underline">
                          {e.title}
                        </Link>
                        <span className="shrink-0 tabular-nums text-[12px] text-muted">
                          {BOARD_VALUE[b.key]?.(e)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

/** What each board is actually ranking, so a row is a figure and not just a
 *  position. A list of titles under "Größter Nutzen" makes the reader take the
 *  order on trust; the number is the reason the entry is there. */
const BOARD_VALUE: Record<string, (s: ScenarioSummary) => string> = {
  beliebt: (s) => `${count(s.votes)} ♥`,
  gesehen: (s) => `${count(s.views)} Aufrufe`,
  geforkt: (s) => `${count(s.forks)} ⑂`,
  nutzen: (s) => eurPerYear(s.annual_benefit_eur),
  nkv: (s) => ratio(s.benefit_cost_ratio),
  barwert: (s) => eur(s.npv_eur),
  fiskal: (s) => eurPerYear(s.annual_fiscal_eur),
  laenge: (s) => km(s.new_km),
  erschlossen: (s) => `${count(s.population_gain)} Ew.`,
  // Ranked by new kilometres per year of construction, so neither figure alone
  // is the answer; the opening year is the one a reader can act on.
  zuegig: (s) => (s.opening_year ? String(s.opening_year) : '–'),
  co2: (s) => `${count(s.co2_saved_t)} t/a`,
  // Investment per newly reached inhabitant, which is what this board sorts by.
  // It showed the inhabitants instead, and the column then contradicted the
  // order it was printed in.
  erschliessung: (s) =>
    s.population_gain > 0 ? `${eur(s.investment_eur / s.population_gain)}/Ew.` : '–',
  guenstig: (s) => eur(s.investment_eur),
};

/** What an empty board means, where "noch leer" would mislead. */
const EMPTY: Record<string, string> = {
  erschliessung: 'kein Entwurf erschließt bisher neue Einwohner',
  erschlossen: 'kein Entwurf erschließt bisher neue Einwohner',
  barwert: 'bisher trägt sich kein Entwurf selbst',
  beliebt: 'noch hat niemand abgestimmt',
  geforkt: 'noch hat niemand weitergebaut',
};

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-8 text-center">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted">{body}</p>
      <Link href="/" className="btn btn-primary mt-4 inline-flex">
        Zum Editor
      </Link>
    </div>
  );
}
