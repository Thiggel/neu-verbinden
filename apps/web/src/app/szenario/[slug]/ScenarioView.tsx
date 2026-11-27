'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api, ApiUnavailable, session, type Comment, type ScenarioDetail } from '@/lib/api';
import { hasDraft, openInEditor } from '@/lib/drafts';
import { ensureSession, type AccountPurpose } from '@/lib/account';
import { cityLabel } from '@/lib/format';
import type { SimulationResult } from '@/lib/types';
import { Analysis } from '@/components/editor/Analysis';
import { PlanMap } from '@/components/PlanMap';
import { existingSwitchedOff } from '@/lib/publish-scope';
import type { CityFigures } from '@/lib/explanations';
import { count, eur, eurPerYear, km, ratio, timeAgo } from '@/lib/format';
import { askConfirm, askText, toast } from '@/components/Dialog';

export function ScenarioView({ slug }: { slug: string }) {
  const [data, setData] = useState<ScenarioDetail | null>(null);
  const [sharing, setSharing] = useState(false);
  // Filled in once the map has loaded this plan's city.
  const [figures, setFigures] = useState<CityFigures | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the plan is genuinely gone, or we simply could not ask.
  const [offline, setOffline] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [voted, setVoted] = useState(false);
  const [votes, setVotes] = useState(0);

  useEffect(() => {
    api
      .get(slug, session.get())
      .then((d) => {
        setData(d);
        setVoted(d.voted);
        setVotes(d.votes);
      })
      .catch((e) => {
        setOffline(e instanceof ApiUnavailable);
        setError((e as Error).message);
      });
    api.comments(slug).then(setComments).catch(() => {});
  }, [slug]);

  if (error) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          {/* "Nicht gefunden" over a plan that exists and is merely
              unreachable tells the reader something untrue about the world. */}
          <h1 className="text-[18px] font-semibold">
            {offline ? 'Gerade nicht abrufbar' : 'Nicht gefunden'}
          </h1>
          <p className="mt-2 text-[14px] text-muted">{error}</p>
          <Link href="/entdecken" className="btn mt-4 inline-flex">
            Zurück zur Übersicht
          </Link>
        </main>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center text-[14px] text-muted">Wird geladen …</main>
      </div>
    );
  }

  const result = data.result as SimulationResult;
  // Ask for the account here rather than pointing at a button elsewhere.
  //
  // This used to say "you need an account — create one at the top right", which
  // stops what you were doing and sends you looking for a control you were not
  // using. Publishing already asked directly; agreeing with a plan is a smaller
  // step than publishing one and should not be harder.
  const requireLogin = (purpose: AccountPurpose) => ensureSession(purpose);

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            <header>
              <h1 className="text-[24px] font-semibold leading-tight">{data.title}</h1>
              <p className="mt-1 text-[13px] text-muted">
                {data.author ? (
                  <Link href={`/profil/${data.author}`} className="hover:underline">
                    {data.author_name ?? data.author}
                  </Link>
                ) : (
                  'ohne Konto'
                )}
                {data.published_at ? ` · veröffentlicht ${timeAgo(data.published_at)}` : ' · nicht veröffentlicht'}
                {data.parent_slug && (
                  <>
                    {' · abgeleitet von '}
                    <Link href={`/szenario/${data.parent_slug}`} className="hover:underline">
                      diesem Entwurf
                    </Link>
                  </>
                )}
              </p>
              {data.description && (
                <p className="mt-3 max-w-2xl text-[14px] leading-relaxed">{data.description}</p>
              )}
            </header>

            {/* The plan itself, before the figures about it. */}
            <section className="mt-5">
              <PlanMap document={data.document} city={data.city} onCity={setFigures} />
            </section>

            <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Big label="Netz" value={km(data.network_km)} sub={`${count(data.stations)} Stationen`} />
              <Big label="Neubau" value={km(data.new_km)} sub={`${count(data.new_stations)} neue Stationen`} />
              <Big label="Investition" value={eur(data.investment_eur)} sub="Modellschätzung" />
              <Big label="Nutzen" value={eurPerYear(data.annual_benefit_eur)} sub="volkswirtschaftlich" />
              <Big label="Nutzen-Kosten" value={ratio(data.benefit_cost_ratio)} sub="Barwerte" />
              <Big
                label="Eröffnung"
                value={data.opening_year ? String(data.opening_year) : '–'}
                sub="frühestens"
              />
            </section>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className={`btn ${voted ? 'btn-primary' : ''}`}
                onClick={async () => {
                  const t = await requireLogin('vote');
                  if (!t) return;
                  try {
                    const r = await api.vote(slug, t, !voted);
                    setVoted(r.voted);
                    setVotes(r.votes);
                  } catch (e) {
                    toast((e as Error).message, 'warn');
                  }
                }}
              >
                ♥ {count(votes)} {voted ? 'Stimme zurücknehmen' : 'Zustimmen'}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const t = await requireLogin('fork');
                  if (!t) return;
                  try {
                    const f = await api.fork(slug, t);
                    window.location.href = `/szenario/${f.slug}`;
                  } catch (e) {
                    toast((e as Error).message, 'warn');
                  }
                }}
              >
                ⑂ Forken
              </button>
              <button
                className="btn"
                disabled={sharing}
                onClick={async () => {
                  setSharing(true);
                  try {
                    // The engine is only needed for the picture, so it is
                    // loaded when the picture is asked for — not on every
                    // visit to a scenario page.
                    const { loadEngine } = await import('@/lib/engine');
                    const { openShareSheet } = await import('@/components/ShareSheet');
                    // The scenario's own city, not the default one: a Berlin
                    // network loaded into Hamburg's engine is drawn in the
                    // wrong metric plane and comes out as a smear.
                    const { engine, city } = await loadEngine(undefined, data.city);
                    engine.showDocument(JSON.stringify(data.document));
                    await openShareSheet({
                      title: data.title,
                      author: data.author_name ?? data.author,
                      city: city.name,
                      dataSource: city.statistics?.label,
                      url: window.location.href,
                      summary: data.description || undefined,
                      render: engine.renderState(),
                      stats: {
                        newKm: data.new_km,
                        newStations: data.new_stations,
                        investmentEur: data.investment_eur,
                        benefitEur: data.annual_benefit_eur,
                        bcr: data.benefit_cost_ratio,
                        openingYear: data.opening_year,
                      },
                    });
                  } catch (e) {
                    toast((e as Error).message, 'warn');
                  } finally {
                    setSharing(false);
                  }
                }}
              >
                {sharing ? 'Bild wird erzeugt …' : 'Teilen'}
              </button>
              <Link href={`/vergleich?a=${slug}`} className="btn">
                Vergleichen
              </Link>
              {/* Forking without this was a dead end: you got your own copy on a
                  page you cannot change, and the only way to work on it was to
                  download the file and open it again by hand. Taking a plan
                  apart is the point of the tool. */}
              <button
                className="btn"
                onClick={async () => {
                  const city = data.city || 'hamburg';
                  if (
                    hasDraft(city) &&
                    !(await askConfirm(
                      'Angefangene Arbeit ersetzen?',
                      `Im Editor liegt noch ein unfertiger Entwurf für ${cityLabel(city)}, der überschrieben wird, wenn du „${data.title}" öffnest.`,
                      'Öffnen und ersetzen'
                    ))
                  ) {
                    return;
                  }
                  window.location.href = openInEditor(city, data.document);
                }}
              >
                Im Editor öffnen
              </button>
              <button
                className="btn"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(data.document)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${slug}.hhnetz.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Herunterladen
              </button>
              <button
                className="btn ml-auto text-muted"
                onClick={async () => {
                  const t = await requireLogin('report');
                  if (!t) return;
                  const reason = await askText(
                    'Entwurf melden',
                    'Was ist das Problem?',
                    '',
                    { multiline: true, placeholder: 'Beschreibe kurz, was hier nicht stimmt.' }
                  );
                  if (!reason) return;
                  try {
                    await api.report(slug, reason, t);
                    toast('Danke, die Meldung ist eingegangen.');
                  } catch (e) {
                    toast((e as Error).message, 'warn');
                  }
                }}
              >
                Melden
              </button>
            </div>

            <p className="mt-3 text-[11px] leading-snug text-muted">
              Die Werte sind mit Modell {data.calculation_version} auf Datenstand{' '}
              {data.data_version} gerechnet und wurden beim Veröffentlichen auf dem Server neu
              berechnet.
            </p>

            <section className="mt-8">
              <h2 className="text-[16px] font-semibold">Kommentare ({comments.length})</h2>
              <div className="mt-3 space-y-3">
                {comments.map((c) => (
                  <article key={c.id} className="rounded-xl border border-line bg-surface p-3">
                    <div className="text-[12px] text-muted">
                      {c.author ? (
                        <Link href={`/profil/${c.author}`} className="hover:underline">
                          {c.author_name ?? c.author}
                        </Link>
                      ) : (
                        'gelöschtes Konto'
                      )}{' '}
                      · {timeAgo(c.created_at)}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed">{c.body}</p>
                  </article>
                ))}
                {comments.length === 0 && <p className="text-[13px] text-muted">Noch keine Kommentare.</p>}
              </div>
              <form
                className="mt-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const t = await requireLogin('comment');
                  if (!t || !draft.trim()) return;
                  try {
                    const c = await api.addComment(slug, draft, t);
                    setComments((prev) => [...prev, c]);
                    setDraft('');
                  } catch (err) {
                    toast((err as Error).message, 'warn');
                  }
                }}
              >
                <label className="sr-only" htmlFor="comment">
                  Kommentar
                </label>
                <textarea
                  id="comment"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  placeholder="Was hältst du von diesem Entwurf?"
                  className="w-full rounded-xl border border-line bg-surface p-3 text-[14px]"
                />
                <button type="submit" className="btn btn-primary mt-2" disabled={!draft.trim()}>
                  Kommentieren
                </button>
              </form>
            </section>
          </div>

          <aside className="lg:sticky lg:top-16 lg:h-[calc(100vh-5rem)]">
            <div className="h-full overflow-hidden rounded-2xl border border-line bg-surface">
              <Analysis
                result={result}
                city={cityLabel(data.city)}
                figures={figures}
                existingOff={existingSwitchedOff(data.document)}
              />
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Big({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums">{value}</div>
      <div className="text-[12px] text-muted">{sub}</div>
    </div>
  );
}
