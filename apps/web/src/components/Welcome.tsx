'use client';

// Shown once, then never again. Someone arriving here has no idea what this is,
// why it exists or that they are allowed to touch it, so the first screen is a
// short personal note that answers all three before the map is shown at all.
// The page behind it stays covered until the note is closed, because a map,
// two side panels and sixty line switches at once tell a newcomer nothing.
//
// The guided tour is offered here and only here, as a button for those who
// want it. Everybody else goes straight to the map.

import { useLayoutEffect, useState } from 'react';
import type { ScenarioTemplate } from '@/lib/types';
import { openFeedback } from '@/components/Feedback';

const KEY = 'hh-welcomed';
const DOCS = 'https://github.com/Thiggel/neu-verbinden/blob/main/docs';

export function Welcome({
  templates,
  onPick,
  onTour,
  city = 'Hamburg',
}: {
  templates: ScenarioTemplate[];
  onPick: (id: string) => void;
  onTour: () => void;
  city?: string;
}) {
  const [open, setOpen] = useState(false);

  // A layout effect, so that the note covers the page before its first paint.
  // The component is mounted only on the client, once the engine has loaded,
  // so there is no server render for it to disagree with.
  useLayoutEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      // Private browsing: showing it every time is better than not at all.
      setOpen(true);
    }
  }, []);

  if (!open) return null;
  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
  };

  const highlights = ['beschlossen', 'u5-vollausbau', 'strassenbahn']
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is ScenarioTemplate => !!t);

  // `grid-cols-1` is load-bearing. With a bare `place-items-center` the single
  // column is auto-sized, so it grows to the child's maximum width and the
  // dialog ends up wider than a 375 px phone, clipping its own text on the
  // right. Tailwind's `grid-cols-1` is `minmax(0, 1fr)`, which bounds it.
  //
  // The heading has to stay a direct child of the card that also holds the
  // scenario buttons, since the browser tests find those buttons through it.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className="fixed inset-0 z-50 grid grid-cols-1 place-items-center overflow-y-auto bg-paper p-4"
    >
      <div className="animate-rise w-full max-w-2xl rounded-2xl border border-line bg-surface p-5 shadow-xl sm:p-7">
        <div className="mb-3 flex items-end gap-1.5" aria-hidden>
          {['#0075BF', '#008B3C', '#DB2777'].map((c, i) => (
            <span
              key={c}
              className="block w-2.5 rounded-full"
              style={{ backgroundColor: c, height: `${16 + i * 9}px`, animation: `pop-in 380ms ${i * 80}ms both` }}
            />
          ))}
        </div>
        <h1 id="welcome-title" className="text-[22px] font-semibold leading-tight">
          Netzentwurf für {city}
        </h1>

        <div className="mt-3 space-y-3 text-[14.5px] leading-relaxed">
          <p>
            In Hamburg und Berlin wird derzeit viel über die U5 und über neue Straßenbahnen
            diskutiert, und fast immer stellt sich dabei die Frage, weshalb solche Vorhaben so
            teuer sind und so lange dauern. Weil sich diese Frage ohne konkrete Zahlen kaum
            beantworten lässt, habe ich diese Seite gebaut, auf der sich jede und jeder
            interaktiv ein eigenes Bild machen kann.
          </p>
          <p>
            Die Idee ist, dass wir alle unsere Wunschlinien, so utopisch sie auch sein mögen, als
            U-Bahn, S-Bahn oder Straßenbahn in die Karte zeichnen und dabei sofort sehen, was sie
            ungefähr kosten würden, wann sie fertig sein könnten, wem sie nützen und wie machbar
            sie wären. Auf diese Weise, so hoffe ich, können wir gemeinsam an der Willensbildung
            arbeiten, die solchen Entscheidungen vorausgehen sollte, und fertige Entwürfe lassen
            sich mit anderen teilen.
          </p>
        </div>

        <h2 className="mt-5 text-[11px] font-medium uppercase tracking-wide text-muted">
          Quellen und Methode
        </h2>
        <div className="mt-1.5 space-y-2 text-[13px] leading-relaxed text-muted">
          <p>
            Das bestehende Netz mit seinen Linien, Stationen und Gleisen stammt aus OpenStreetMap,
            während die Einwohnerzahlen aus der amtlichen Statistik kommen, für Hamburg vom
            Statistikamt Nord und für Berlin aus dem Einwohnerregister des Amts für Statistik
            Berlin-Brandenburg zum 31.12.2025. Die bereits geplanten Vorhaben habe ich aus
            öffentlichen Planungsunterlagen zusammengetragen, wobei jede Angabe mit ihrer Quelle
            und ihrem Stand hinterlegt ist.
          </p>
          <p>
            Die Kosten werden nicht pauschal je Kilometer, sondern Abschnitt für Abschnitt nach
            Bauweise, Bebauungsdichte, Baugrund und Wasserquerungen berechnet, worauf Planung,
            Projektsteuerung, Grunderwerb, Fahrzeuge, eine Risikovorsorge und die
            Baupreisentwicklung aufgeschlagen werden. Damit die Größenordnung stimmt, ist das
            Modell an bereits geplanten Strecken wie der U5 Ost, der U4 zur Horner Geest und der
            S4 Ost sowie an den Fahrgastzahlen kalibriert, die die Verkehrsunternehmen beider
            Städte für 2025 veröffentlicht haben. Zeitwert, Unfall- und Klimakosten, mit denen der
            Nutzen bewertet wird, stammen aus der Standardisierten Bewertung, nach der auch
            Bund und Länder über die Förderung solcher Vorhaben entscheiden.
          </p>
          <p>
            Alle Zahlen bleiben trotzdem Schätzungen eines offenen Modells, das Entwürfe
            vergleichbar machen soll und keine Planung ersetzt, weshalb stets eine Spanne
            ausgewiesen wird. Wie eine Kennzahl zustande kommt, zeigt im Überblick das
            <span className="mx-1 inline-grid h-[15px] w-[15px] place-items-center rounded-full border border-muted align-[-2px] text-[9px] font-bold leading-none">
              i
            </span>
            neben ihr, während sich in den übrigen Reitern jeder Posten aufklappen lässt. Die
            vollständige Herleitung ist in der{' '}
            <a className="underline hover:text-ink" href={`${DOCS}/modell.md`} target="_blank" rel="noreferrer">
              Modellbeschreibung
            </a>{' '}
            und der{' '}
            <a className="underline hover:text-ink" href={`${DOCS}/daten.md`} target="_blank" rel="noreferrer">
              Datenherkunft
            </a>{' '}
            nachzulesen.
          </p>
        </div>

        {highlights.length > 0 && (
          <div className="mt-5 space-y-1.5">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Zum Einstieg
            </h2>
            {highlights.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  onPick(t.id);
                  dismiss();
                }}
                className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left transition-colors hover:bg-subtle"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{t.title}</span>
                  <span className="block truncate text-[12px] text-muted">{t.summary}</span>
                </span>
                <span aria-hidden className="text-muted">
                  →
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-5 text-[14.5px] leading-relaxed">
          Schreibt mir gerne mit eurem Feedback, euren Fehlermeldungen und Anregungen, wofür es
          ein{' '}
          <button className="underline hover:text-muted" onClick={() => openFeedback()}>
            Formular für Rückmeldungen
          </button>{' '}
          gibt. Ich hoffe, das hier hilft!
        </p>
        <p className="mt-2 text-[14.5px] font-medium">Filipe Laitenberger</p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => {
              dismiss();
              onTour();
            }}
            className="btn btn-discover flex-1"
          >
            Anleitung
          </button>
          <button onClick={dismiss} className="btn btn-primary flex-1">
            Los geht’s
          </button>
        </div>
      </div>
    </div>
  );
}
