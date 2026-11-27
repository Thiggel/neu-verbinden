'use client';

// The two rights that are useless as a sentence in a privacy policy.
//
// Access and erasure are owed within a month of being asked, and a project run
// by one person answers such a request late or not at all. Both are one button
// here, which is both better for the person asking and less work than the
// letter would have been.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api, ApiError, session } from '@/lib/api';
import { ask, toast } from '@/components/Dialog';

export default function AccountPage() {
  const [user, setUser] = useState<{ handle: string; display_name: string } | null>(null);
  const [state, setState] = useState<'laden' | 'angemeldet' | 'fremd'>('laden');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const token = session.get();
    if (!token) {
      setState('fremd');
      return;
    }
    api
      .me(token)
      .then((u) => {
        setUser(u);
        setState('angemeldet');
      })
      .catch((e) => {
        // Only a refused token ends the session (`api` clears it); a server
        // that is down leaves it for the next visit.
        if (!(e instanceof ApiError && e.status === 401)) toast((e as Error).message, 'warn');
        setState('fremd');
      });
  }, []);

  const download = async () => {
    const token = session.get();
    if (!token) return;
    setBusy('export');
    try {
      const data = await api.exportAccount(token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meine-daten-${user?.handle ?? 'konto'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(null);
    }
  };

  const erase = async () => {
    const token = session.get();
    if (!token) return;
    // Typing the handle, then the password. Erasure cannot be undone, and a
    // single "are you sure" is not a decision, it is a reflex.
    const answers = await ask({
      title: 'Konto löschen',
      intro:
        'Das Konto wird mit allen Entwürfen, Kommentaren und Stimmen endgültig gelöscht, sodass auch veröffentlichte Entwürfe für niemanden mehr abrufbar sind. Das lässt sich nicht rückgängig machen.',
      fields: [
        {
          name: 'handle',
          label: `Zur Bestätigung „${user?.handle}" eingeben`,
          placeholder: user?.handle,
        },
        { name: 'password', label: 'Passwort', secret: true },
      ],
      confirm: 'Endgültig löschen',
    });
    if (!answers) return;
    if (answers.handle?.trim() !== user?.handle) {
      toast('Weil der Nutzername nicht stimmt, wurde nichts gelöscht.', 'warn');
      return;
    }
    setBusy('delete');
    try {
      const r = await api.deleteAccount(token, answers.password ?? '');
      session.set(null);
      toast(`Konto gelöscht, dazu ${r.entwuerfe} Entwürfe.`);
      window.location.href = '/';
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 pb-20">
        <h1 className="text-[22px] font-semibold">Konto und Daten</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          Hier kannst du herunterladen, was dieser Dienst über dich gespeichert hat, und dein
          Konto löschen.
        </p>

        {state === 'laden' && <p className="mt-6 text-[14px] text-muted">Wird geladen …</p>}

        {state === 'fremd' && (
          <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-[15px] font-semibold">Nicht angemeldet</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              Ohne Konto speichert dieser Dienst nichts, was dir zugeordnet ist, weil Entwürfe, die
              du nicht veröffentlichst, in deinem Browser bleiben. Ausgenommen sind kurzlebige
              Zähler gegen Missbrauch und Rückmeldungen, die du selbst abschickst. Was gespeichert wird und warum, steht
              unter{' '}
              <Link className="underline" href="/rechtliches#datenschutz">
                Datenschutz
              </Link>
              .
            </p>
          </div>
        )}

        {state === 'angemeldet' && user && (
          <div className="mt-6 space-y-4">
            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-[15px] font-semibold">Angemeldet als {user.handle}</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                Zu diesem Konto gehören ein Nutzername, ein Anzeigename, eine Selbstbeschreibung und
                ein Passwort-Hash, während eine E-Mail-Adresse nicht erhoben wird.
              </p>
            </section>

            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-[15px] font-semibold">Daten herunterladen</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                Die JSON-Datei enthält alles, was gespeichert ist, also das Konto, sämtliche
                Entwürfe mitsamt ihren Netzen, Kommentare und Stimmen. Sie erfüllt die Rechte auf
                Auskunft nach Art. 15 DSGVO und auf Datenübertragbarkeit nach Art. 20 DSGVO.
              </p>
              <button className="btn btn-primary mt-4" onClick={download} disabled={busy !== null}>
                {busy === 'export' ? 'Wird erzeugt …' : 'Meine Daten herunterladen'}
              </button>
            </section>

            <section className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-5">
              <h2 className="text-[15px] font-semibold">Konto löschen</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                Das Konto wird mit allen Entwürfen, Kommentaren und Stimmen endgültig gelöscht,
                sodass auch veröffentlichte Entwürfe danach für niemanden mehr abrufbar sind. Das
                entspricht dem Recht auf Löschung nach Art. 17 DSGVO.
              </p>
              <button
                className="btn mt-4 border-rose-500/50 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                onClick={erase}
                disabled={busy !== null}
              >
                {busy === 'delete' ? 'Wird gelöscht …' : 'Konto endgültig löschen'}
              </button>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
