'use client';

// § 5 DDG wants the operator's details "leicht erkennbar, unmittelbar
// erreichbar und ständig verfügbar" — findable, one step away, and on every
// page. A link in the footer of every view is the settled way to do that, and
// the reason this is a component rather than a line on one page.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteFooter() {
  const path = usePathname();
  // The editor fills the window and manages its own scrolling; a footer there
  // would either be unreachable or push the map out of view.
  if (path === '/') return null;
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 text-[12.5px] text-muted">
        <Link className="hover:text-ink hover:underline" href="/rechtliches#impressum">
          Impressum
        </Link>
        <Link className="hover:text-ink hover:underline" href="/rechtliches#datenschutz">
          Datenschutz
        </Link>
        <Link className="hover:text-ink hover:underline" href="/rechtliches#nutzung">
          Nutzungsbedingungen
        </Link>
        <Link className="hover:text-ink hover:underline" href="/rechtliches#daten">
          Daten und Lizenzen
        </Link>
        <Link className="hover:text-ink hover:underline" href="/konto">
          Konto und Daten
        </Link>
        <span className="ml-auto">
          Kein amtliches Angebot. Alle Zahlen sind Modellschätzungen.
        </span>
      </div>
    </footer>
  );
}
