import Link from 'next/link';
import type { ScenarioSummary } from '@/lib/api';
import { cityLabel, count, eur, eurPerYear, km, ratio, timeAgo } from '@/lib/format';

/**
 * The card the plan describes for shared proposals: the numbers that matter,
 * then the two actions (plan §25).
 */
export function ScenarioCard({ s, highlight }: { s: ScenarioSummary; highlight?: string }) {
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Link href={`/szenario/${s.slug}`} className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-snug">{s.title}</h3>
        </Link>
        {/* Two networks look alike in a list; the city is what tells them
            apart at a glance. */}
        <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted">
          {cityLabel(s.city)}
        </span>
      </div>
      <p className="mt-0.5 text-[12px] text-muted">
        {s.author ? (
          <Link href={`/profil/${s.author}`} className="hover:underline">
            {s.author_name ?? s.author}
          </Link>
        ) : (
          'ohne Konto'
        )}
        {s.published_at ? ` · ${timeAgo(s.published_at)}` : ''}
        {s.parent_slug ? (
          <>
            {' · '}
            <Link href={`/szenario/${s.parent_slug}`} className="hover:underline">
              Fork
            </Link>
          </>
        ) : null}
      </p>
      {s.description && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-muted">{s.description}</p>}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
        <Row label="Neubau" value={km(s.new_km)} on={highlight === 'laenge'} />
        <Row label="Stationen" value={count(s.new_stations)} on={highlight === 'stationen'} />
        <Row label="Investition" value={eur(s.investment_eur)} on={highlight === 'guenstig'} />
        <Row label="Eröffnung" value={s.opening_year ? String(s.opening_year) : '–'} on={highlight === 'schnell'} />
        <Row
          label="Nutzen"
          value={eurPerYear(s.annual_benefit_eur)}
          on={highlight === 'nutzen'}
          negative={s.annual_benefit_eur < 0}
        />
        <Row
          label="NKV"
          value={ratio(s.benefit_cost_ratio)}
          on={highlight === 'nkv'}
          negative={s.benefit_cost_ratio < 0}
        />
      </dl>

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-2.5 text-[12px] text-muted">
        <span title="Stimmen">♥ {count(s.votes)}</span>
        <span title="Kommentare">💬 {count(s.comment_count)}</span>
        <span title="Forks">⑂ {count(s.forks)}</span>
        <span title="Aufrufe" className="ml-auto">
          {count(s.views)} Aufrufe
        </span>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Link href={`/szenario/${s.slug}`} className="btn flex-1">
          Öffnen
        </Link>
        <Link href={`/vergleich?a=${s.slug}`} className="btn">
          Vergleichen
        </Link>
      </div>
    </article>
  );
}

function Row({
  label,
  value,
  on,
  negative,
}: {
  label: string;
  value: string;
  on?: boolean;
  /** Below zero, and the card should not pretend otherwise. A plan published
   *  with parts of the existing network switched off scores under today's
   *  network, and in a list of six cards that is the one thing worth seeing. */
  negative?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-2 ${on ? 'font-semibold' : ''}`}>
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular-nums ${negative ? 'text-rose-600 dark:text-rose-400' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
