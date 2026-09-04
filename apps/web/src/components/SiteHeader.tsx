'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, session } from '@/lib/api';
import { ask, toast } from '@/components/Dialog';

const NAV = [
  { href: '/', label: 'Editor' },
  { href: '/entdecken', label: 'Entdecken' },
  { href: '/vergleich', label: 'Vergleich' },
];

export function SiteHeader() {
  const path = usePathname();
  const [user, setUser] = useState<{ handle: string; display_name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = session.get();
    if (!token) return;
    api.me(token).then(setUser).catch(() => session.set(null));
  }, []);

  const auth = async (mode: 'login' | 'register') => {
    const answers = await ask({
      title: mode === 'login' ? 'Anmelden' : 'Konto anlegen',
      intro:
        mode === 'login'
          ? 'Damit deine Entwürfe dir gehören und du abstimmen kannst.'
          : 'Nur ein Name und ein Passwort, keine E-Mail-Adresse.',
      fields: [
        {
          name: 'handle',
          label: 'Nutzername',
          hint: mode === 'register' ? 'Kleinbuchstaben, Ziffern, _ und -' : undefined,
        },
        {
          name: 'password',
          label: 'Passwort',
          secret: true,
          hint: mode === 'register' ? 'Mindestens 10 Zeichen' : undefined,
        },
      ],
      confirm: mode === 'login' ? 'Anmelden' : 'Konto anlegen',
    });
    if (!answers) return;
    const { handle, password } = answers;
    setBusy(true);
    try {
      const res = mode === 'login' ? await api.login({ handle, password }) : await api.register({ handle, password });
      session.set(res.token);
      setUser(res.user);
      toast(mode === 'login' ? `Willkommen zurück, ${res.user.display_name}` : 'Konto angelegt');
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur">
      <Link href="/" className="flex items-center gap-2">
        <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-[13px] font-bold text-paper">
          H
        </span>
        <span className="text-[14px] font-semibold">Verkehrsnetz-Designer</span>
      </Link>
      <nav className="flex gap-1">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            // The gold is a signpost, so it is worth nothing on the page it
            // points at: there it is just a loud way of saying "you are here".
            className={`rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${
              path === n.href
                ? 'bg-subtle'
                : n.href === '/entdecken'
                  ? 'btn-discover'
                  : 'text-muted hover:bg-subtle'
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {user ? (
          <>
            <Link href={`/profil/${user.handle}`} className="text-[13px] font-medium hover:underline">
              {user.display_name}
            </Link>
            <button
              className="btn"
              onClick={() => {
                session.set(null);
                setUser(null);
              }}
            >
              Abmelden
            </button>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={() => auth('login')}>
              Anmelden
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => auth('register')}>
              Konto anlegen
            </button>
          </>
        )}
      </div>
    </header>
  );
}
