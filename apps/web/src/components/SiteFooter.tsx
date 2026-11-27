'use client';

// The bar along the bottom of every view.
//
// § 5 DDG wants the operator's details findable, one step away and available at
// all times, which is why this is a component and not a line on one page — the
// editor included, where it is the only route to them.
//
// It sits outside the scrolling area rather than at the end of the document.
// Ending the document was the obvious way and the wrong one: the plan pages have
// a sticky analysis panel a full viewport tall, and at the bottom of the page it
// covered the footer completely. Measured: footer at 487–539, panel at 56–876.
// A bar that is never in the scroll flow cannot be overlapped by anything in it.

import Link from 'next/link';
import { openFeedback } from '@/components/Feedback';
import { OPERATOR } from '@/lib/impressum';

const LEGAL = [
  ['/rechtliches#impressum', 'Impressum'],
  ['/rechtliches#datenschutz', 'Datenschutz'],
  ['/rechtliches#nutzung', 'Nutzung'],
  ['/rechtliches#daten', 'Daten'],
  ['/konto', 'Konto'],
];

export function SiteFooter() {
  return (
    <footer className="shrink-0 border-t border-line bg-surface">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[12px] text-muted">
        <span className="font-medium text-ink">Von {OPERATOR.name}</span>
        <a className="hover:text-ink hover:underline" href={`mailto:${OPERATOR.email}`}>
          kontaktiere mich
        </a>
        <a
          className="hover:text-ink hover:underline"
          href="https://buymeacoffee.com/filipelaitenberger"
          target="_blank"
          rel="noopener noreferrer"
        >
          kauf mir einen Kaffee
        </a>
        <a
          className="hover:text-ink hover:underline"
          href="https://github.com/Thiggel/neu-verbinden"
          target="_blank"
          rel="noopener noreferrer"
        >
          Quellcode auf GitHub
        </a>
        <button
          onClick={() => openFeedback()}
          className="rounded-full border border-line px-2.5 py-0.5 font-medium text-ink transition-colors hover:bg-subtle"
        >
          Feedback
        </button>

        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {LEGAL.map(([href, label]) => (
            <Link key={href} className="hover:text-ink hover:underline" href={href}>
              {label}
            </Link>
          ))}
          <span className="hidden text-muted/70 xl:inline">
            Kein amtliches Angebot · alle Zahlen sind Modellschätzungen
          </span>
        </span>
      </div>
    </footer>
  );
}
