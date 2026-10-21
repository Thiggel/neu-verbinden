'use client';

// Where people want connections that do not exist.
//
// Every other view of a published plan is about that plan. This one is about
// what they have in common: two dozen people drawing their own line through
// Eimsbüttel is a statement about Eimsbüttel that no single plan makes.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { WishMap } from './WishMap';
import { api, ApiUnavailable } from '@/lib/api';
import { loadBasemapOnly, type CityEntry } from '@/lib/engine';
import type { BaseMap } from '@/lib/types';
import { CITY_KEY } from '@/lib/drafts';
import { count, km } from '@/lib/format';

type Wishes = Awaited<ReturnType<typeof api.wishes>>;

export default function WishesPage() {
  const [cityId, setCityId] = useState<string | null>(null);
  const [cities, setCities] = useState<CityEntry[]>([]);
  const [base, setBase] = useState<{ basemap: BaseMap; city: CityEntry } | null>(null);
  const [wishes, setWishes] = useState<Wishes | null>(null);
  const [onlyPopular, setOnlyPopular] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    try {
      setCityId(localStorage.getItem(CITY_KEY) ?? null);
    } catch {
      setCityId(null);
    }
  }, []);

  useEffect(() => {
    if (cityId === null && cities.length) return;
    let gone = false;
    loadBasemapOnly(cityId ?? undefined)
      .then((b) => {
        if (gone) return;
        setBase({ basemap: b.basemap, city: b.city });
        setCities(b.cities);
        if (!cityId) setCityId(b.city.id);
      })
      .catch((e) => setError((e as Error).message));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  useEffect(() => {
    if (!base) return;
    setWishes(null);
    api
      .wishes(base.city.id, onlyPopular ? 1 : 0)
      .then(setWishes)
      .catch((e) =>
        setError(e instanceof ApiUnavailable ? 'Der Server ist gerade nicht erreichbar.' : (e as Error).message)
      );
  }, [base, onlyPopular]);

  const empty = wishes && wishes.cells.length === 0;

  return (
    <div className="flex h-full flex-col bg-paper">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-5 lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-[22px] font-semibold">Wo Verbindungen fehlen</h1>
          <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-muted">
            Alle veröffentlichten Entwürfe übereinandergelegt. Gezählt wird nur, was gebaut werden
            müsste, nicht das Netz, das ohnehin schon fährt. Wo es heiß ist, haben viele unabhängig
            voneinander dieselbe Lücke gezeichnet.
          </p>

          <div className="relative mt-4 min-h-[380px] flex-1 overflow-hidden rounded-2xl border border-line">
            {base && wishes ? (
              <WishMap
                basemap={base.basemap}
                city={base.city}
                cells={wishes.cells}
                maxWeight={wishes.maxWeight}
                dark={dark}
              />
            ) : (
              <div className="grid h-full place-items-center text-[13px] text-muted">
                {error ?? 'Wird geladen …'}
              </div>
            )}
            {empty && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <p className="max-w-sm rounded-xl border border-line bg-surface/95 p-4 text-center text-[13px] leading-relaxed shadow-sm backdrop-blur">
                  Für {base?.city.name} ist noch nichts veröffentlicht, das gebaut werden müsste.
                  Sobald jemand etwas zeichnet und veröffentlicht, steht es hier.
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="w-full shrink-0 space-y-3 lg:w-[320px]">
          {cities.length > 1 && (
            <div className="flex gap-1 rounded-full bg-subtle p-1 ring-1 ring-line">
              {cities.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCityId(c.id)}
                  aria-pressed={base?.city.id === c.id}
                  className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${
                    base?.city.id === c.id ? 'bg-paper shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          <section className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Grundlage</p>
            <p className="mt-1 text-[19px] font-semibold tabular-nums">
              {wishes ? count(wishes.scenarios) : '–'}{' '}
              <span className="text-[14px] font-normal text-muted">
                {wishes?.scenarios === 1 ? 'Entwurf' : 'Entwürfe'}
              </span>
            </p>
            <label className="mt-3 flex items-start gap-2 text-[13px] leading-snug">
              <input
                type="checkbox"
                checked={onlyPopular}
                onChange={(e) => setOnlyPopular(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Nur Entwürfe mit mindestens einer Stimme
                <span className="block text-[12px] text-muted">
                  Blendet aus, was niemand außer der zeichnenden Person gesehen hat.
                </span>
              </span>
            </label>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Entwürfe mit Stimmen und Forks zählen stärker, aber nur logarithmisch: ein Entwurf,
              der die Runde gemacht hat, soll zwanzig stille nicht zudecken.
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Am häufigsten gezeichnet
            </p>
            {wishes?.themes.length ? (
              <ol className="mt-2 space-y-1.5">
                {wishes.themes.slice(0, 8).map((t, i) => (
                  <li key={t.label} className="flex items-baseline gap-2 text-[13px]">
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums ${
                        i === 0 ? 'bg-ink text-paper' : 'bg-subtle text-muted'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
                    <span className="shrink-0 tabular-nums text-[12px] text-muted">
                      {count(t.count)}× · {km(t.km)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-[13px] text-muted">Noch nichts gezeichnet.</p>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-subtle/60 p-4 text-[12.5px] leading-relaxed text-muted">
            <p className="font-medium text-ink">Was die Farbe heißt</p>
            <div className="mt-2 h-2 rounded-full bg-gradient-to-r from-blue-500/50 via-yellow-400/80 to-red-600" />
            <div className="mt-1 flex justify-between text-[11px]">
              <span>vereinzelt</span>
              <span>oft gezeichnet</span>
            </div>
            <p className="mt-3">
              Die Skala ist relativ zur heißesten Stelle dieser Stadt. Sie sagt, wo die Entwürfe
              sich einig sind, nicht wie viele Menschen dort wohnen oder fahren würden.
            </p>
            <p className="mt-2">
              <Link href="/entdecken" className="underline hover:text-ink">
                Die einzelnen Entwürfe ansehen
              </Link>
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
