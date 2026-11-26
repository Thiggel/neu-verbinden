'use client';

import { use, useEffect, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { ScenarioCard } from '@/components/ScenarioCard';
import { api, type ScenarioSummary } from '@/lib/api';
import { count, eur, km } from '@/lib/format';

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const [items, setItems] = useState<ScenarioSummary[] | null>(null);

  useEffect(() => {
    api
      .list({ author: handle, limit: 60 })
      .then(setItems)
      .catch(() => setItems([]));
  }, [handle]);

  const totals = (items ?? []).reduce(
    (a, s) => ({
      km: a.km + s.new_km,
      stations: a.stations + s.new_stations,
      investment: a.investment + s.investment_eur,
      votes: a.votes + s.votes,
    }),
    { km: 0, stations: 0, investment: 0, votes: 0 }
  );

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <header>
          <h1 className="text-[22px] font-semibold">{items?.[0]?.author_name ?? handle}</h1>
          <p className="text-[13px] text-muted">@{handle}</p>
        </header>

        {/* The sums run across every published plan, and plans are usually
            alternatives to one another: two variants of the same idea both
            contain the decided projects, so their kilometres are counted
            twice. "Neue Kilometer 172 km" would read as a claim to have
            proposed 172 km of railway, which is not what it means. The labels
            say "zusammengezählt" and the footnote says why. */}
        {items && items.length > 0 && (
          <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Veröffentlicht" value={count(items.length)} />
            <Stat label="Neubau zusammengezählt" value={km(totals.km)} />
            <Stat label="Stationen zusammengezählt" value={count(totals.stations)} />
            <Stat label="Stimmen erhalten" value={count(totals.votes)} />
          </section>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items === null && <p className="text-[14px] text-muted">Wird geladen …</p>}
          {items?.length === 0 && (
            <p className="text-[14px] text-muted">Noch keine veröffentlichten Entwürfe.</p>
          )}
          {items?.map((s) => <ScenarioCard key={s.slug} s={s} />)}
        </div>

        {items && items.length > 0 && (
          <p className="mt-6 text-[11px] text-muted">
            Zusammengezählt über alle {count(items.length)} Entwürfe: {eur(totals.investment)}{' '}
            Investition. Weil Entwürfe meist Alternativen zueinander sind und dieselben Abschnitte
            mehrfach enthalten, zeigen die Summen, wie viel jemand vorgeschlagen hat, und nicht,
            wie viel gebaut würde. Alle Werte sind Modellschätzungen und keine Planungsgrundlage.
          </p>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
