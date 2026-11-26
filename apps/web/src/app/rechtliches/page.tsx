import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { OPERATOR, impressumIsComplete } from '@/lib/impressum';

export const metadata: Metadata = {
  title: 'Rechtliches · Verkehrsnetz-Designer',
  description: 'Impressum, Datenschutz, Nutzungsbedingungen und Datenlizenzen.',
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function LegalPage() {
  const complete = impressumIsComplete();
  return (
    <div className="min-h-full bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-6 pb-20">
        <h1 className="text-[22px] font-semibold">Rechtliches</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">
          Wer diese Seite betreibt, was sie mit Daten macht, unter welchen Bedingungen sie benutzt
          werden kann und woher die Karten- und Statistikdaten stammen.
        </p>

        <nav className="mt-5 flex flex-wrap gap-2 text-[13px]">
          {[
            ['impressum', 'Impressum'],
            ['datenschutz', 'Datenschutz'],
            ['nutzung', 'Nutzungsbedingungen'],
            ['inhalte', 'Melden und Moderation'],
            ['daten', 'Daten und Lizenzen'],
            ['haftung', 'Haftung'],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border border-line bg-surface px-3 py-1.5 font-medium transition-colors hover:bg-subtle"
            >
              {label}
            </a>
          ))}
        </nav>

        {!complete && (
          <p className="mt-5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[13px] leading-relaxed">
            <b>Diese Seite ist noch nicht betriebsbereit.</b> Im Impressum stehen Platzhalter statt
            der Angaben des Betreibers. § 5 DDG verlangt Namen und ladungsfähige Anschrift; ohne sie
            darf der Dienst nicht öffentlich erreichbar sein. Die Werte stehen in{' '}
            <code className="rounded bg-subtle px-1">apps/web/src/lib/impressum.ts</code>.
          </p>
        )}

        <div className="mt-5 space-y-4">
          <Section id="impressum" title="Impressum">
            <p>Angaben gemäß § 5 DDG:</p>
            <address className="not-italic leading-relaxed text-ink">
              {OPERATOR.name}
              <br />
              {OPERATOR.street}
              <br />
              {OPERATOR.city}
              <br />
              {OPERATOR.country}
            </address>
            <p>
              Kontakt:{' '}
              <a className="underline" href={`mailto:${OPERATOR.email}`}>
                {OPERATOR.email}
              </a>
            </p>
            {OPERATOR.vatId && <p>Umsatzsteuer-Identifikationsnummer: {OPERATOR.vatId}</p>}
            {OPERATOR.responsibleForContent && (
              <p>Verantwortlich für den Inhalt: {OPERATOR.responsibleForContent}</p>
            )}
            <p>
              Diese Adresse ist zugleich die zentrale Kontaktstelle nach Artikel 12 des Gesetzes
              über digitale Dienste (DSA). Die Verständigung ist auf Deutsch und auf Englisch
              möglich.
            </p>
            <p>
              Dieses Angebot wird von einer Privatperson ohne Gewinnerzielungsabsicht betrieben. Es
              werden keine Verträge über Waren oder Dienstleistungen geschlossen und keine Entgelte
              erhoben; eine Pflicht zur Teilnahme an einem Streitbeilegungsverfahren nach dem VSBG
              besteht daher nicht, und eine Teilnahme findet auch freiwillig nicht statt.
            </p>
          </Section>

          <Section id="datenschutz" title="Datenschutz">
            <p>
              Verantwortlich im Sinne der DSGVO ist der oben genannte Betreiber. Grundsatz dieser
              Anwendung ist, so wenig zu erheben, dass sich die Frage nach dem Zweck meist gar nicht
              stellt.
            </p>

            <h3 className="text-[14px] font-semibold text-ink">Was ohne Konto passiert</h3>
            <p>
              Das Zeichnen läuft vollständig im Browser. Der Rechenkern ist ein WebAssembly-Modul,
              das mit heruntergeladen wird; Netzentwürfe, die nicht veröffentlicht werden, verlassen
              das Gerät nicht. Es gibt keine Analyse-, Tracking- oder Werbedienste, keine
              eingebetteten Schriftarten fremder Anbieter und keine Inhalte, die beim Aufruf von
              dritter Seite nachgeladen werden.
            </p>
            <p>
              Im lokalen Speicher des Browsers liegen: das gewählte Erscheinungsbild, die zuletzt
              geöffnete Stadt, der eigene unveröffentlichte Entwurf und, nach einer Anmeldung, das
              Sitzungsmerkmal. Diese Angaben sind für die ausdrücklich gewünschte Funktion
              erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG); deshalb gibt es hier kein Einwilligungsbanner.
              Löschen lassen sie sich jederzeit über die Browsereinstellungen.
            </p>

            <h3 className="text-[14px] font-semibold text-ink">Beim Aufruf des Servers</h3>
            <p>
              Für Anmeldungen, Veröffentlichungen und Kommentare wird eine Programmschnittstelle
              angesprochen. Zur Abwehr von Missbrauch werden IP-Adressen kurzzeitig in Zählern
              verarbeitet (Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO, berechtigtes Interesse an
              einem funktionsfähigen Dienst). Diese Zähler werden nach spätestens 24 Stunden
              gelöscht.
            </p>

            <h3 className="text-[14px] font-semibold text-ink">Mit Konto</h3>
            <p>
              Ein Konto besteht aus einem selbstgewählten Nutzernamen und einem Passwort. Eine
              E-Mail-Adresse wird nicht erhoben und auch dann nicht gespeichert, wenn sie
              mitgeschickt wird. Das Passwort wird ausschließlich als Argon2-Hash abgelegt.
              Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, die Erfüllung des Nutzungsvertrags.
            </p>
            <p>
              Veröffentlichte Entwürfe, Stimmen und Kommentare sind öffentlich und mit dem
              Nutzernamen verknüpft. Das ist der Zweck des Veröffentlichens; wer das nicht möchte,
              hält den Entwurf privat.
            </p>

            <h3 className="text-[14px] font-semibold text-ink">Rückmeldungen</h3>
            <p>
              Wer über das Rückmeldeformular schreibt, schickt die gewählte Art, den Text, die Seite,
              auf der das Formular geöffnet wurde, und, nur wenn angegeben, eine Antwortadresse.
              Die Rückmeldung wird nicht mit einem Konto verknüpft. Sie wird gespeichert und per
              E-Mail an den Betreiber weitergeleitet, damit sie gelesen und beantwortet werden kann
              (Art. 6 Abs. 1 lit. f DSGVO); die IP-Adresse dient nur dem Missbrauchszähler oben.
              Gespeicherte Rückmeldungen werden nach spätestens zwölf Monaten gelöscht.
            </p>

            <h3 className="text-[14px] font-semibold text-ink">Rechte</h3>
            <p>
              Es bestehen die Rechte auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung
              (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch
              (Art. 21) sowie ein Beschwerderecht bei einer Aufsichtsbehörde (Art. 77).
            </p>
            <p>
              Auskunft und Löschung sind in der Anwendung selbst eingebaut: unter{' '}
              <Link className="underline" href="/konto">
                Konto
              </Link>{' '}
              lassen sich alle gespeicherten Daten als Datei herunterladen und das Konto samt
              Entwürfen und Kommentaren endgültig löschen.
            </p>

            <h3 className="text-[14px] font-semibold text-ink">Auftragsverarbeiter</h3>
            <p>
              Der Betrieb erfolgt bei Dienstleistern für Hosting und Datenbank, mit denen Verträge
              zur Auftragsverarbeitung nach Art. 28 DSGVO bestehen. Welche das sind, steht in der
              Betriebsdokumentation des Projekts; erfolgt eine Verarbeitung außerhalb der EU,
              geschieht dies auf Grundlage der Standardvertragsklauseln beziehungsweise eines
              Angemessenheitsbeschlusses.
            </p>
          </Section>

          <Section id="nutzung" title="Nutzungsbedingungen">
            <p>
              Die Nutzung ist unentgeltlich. Ein Anspruch auf Verfügbarkeit besteht nicht; das
              Angebot kann jederzeit geändert oder eingestellt werden.
            </p>
            <p>
              Für selbst eingestellte Inhalte, also Entwürfe, Titel, Beschreibungen und Kommentare,
              bleiben die Rechte bei den Verfassenden. Mit dem Veröffentlichen wird dem Betreiber
              das einfache, unentgeltliche Recht eingeräumt, sie im Rahmen dieses Dienstes
              anzuzeigen, weiterzuverbreiten und in Vergleichs- und Vorschaubildern darzustellen.
              Wer einen Entwurf weiterbaut, veröffentlicht ein eigenes Werk und muss die Herkunft
              erkennbar lassen; die Anwendung tut das automatisch.
            </p>
            <p>
              Untersagt sind rechtswidrige Inhalte, Beleidigungen, personenbezogene Angaben Dritter,
              Werbung und Versuche, den Dienst zu überlasten oder Zugangsbeschränkungen zu umgehen.
            </p>
          </Section>

          <Section id="inhalte" title="Melden und Moderation">
            <p>
              Dieser Dienst speichert von Nutzenden eingestellte Inhalte und ist damit ein
              Hostingdienst im Sinne des DSA. Jeder Entwurf und jeder Kommentar lässt sich melden;
              der Meldeweg ist auf der jeweiligen Seite eingebaut (Art. 16 DSA). Meldungen können
              auch formlos an die oben genannte Adresse gehen.
            </p>
            <p>
              Gemeldete Inhalte werden geprüft. Wird ein Inhalt entfernt oder unsichtbar geschaltet,
              erhält die einstellende Person eine Begründung, soweit sie erreichbar ist. Gegen die
              Entscheidung kann formlos an derselben Adresse widersprochen werden.
            </p>
            <p>
              Eine allgemeine Überwachungspflicht besteht nicht (Art. 8 DSA, § 7 Abs. 2 DDG). Von
              rechtswidrigen Inhalten distanziert sich der Betreiber; sie werden nach Kenntnis
              unverzüglich entfernt.
            </p>
          </Section>

          <Section id="daten" title="Daten und Lizenzen">
            <p>
              Netz, Stationen, Gewässer, Grünflächen und Straßen stammen aus{' '}
              <a className="underline" href="https://www.openstreetmap.org/copyright">
                OpenStreetMap
              </a>
              , © OpenStreetMap-Mitwirkende, lizenziert unter der{' '}
              <a className="underline" href="https://opendatacommons.org/licenses/odbl/1-0/">
                Open Database License 1.0
              </a>{' '}
              (ODbL). Die daraus aufbereiteten Datensätze dieser Anwendung sind abgeleitete
              Datenbanken und stehen ihrerseits unter der ODbL. Sie liegen unter{' '}
              <a className="underline" href="/data/manifest.json">
                <code className="rounded bg-subtle px-1">/data/</code>
              </a>{' '}
              und können von dort bezogen
              werden.
            </p>
            <p>
              Einwohner- und Beschäftigtenzahlen für Hamburg stammen vom Statistikamt Nord, für
              Berlin vom Amt für Statistik Berlin-Brandenburg und aus dem Datenportal des Landes
              Berlin, jeweils unter{' '}
              <a className="underline" href="https://www.govdata.de/dl-de/by-2-0">
                Datenlizenz Deutschland Namensnennung 2.0
              </a>{' '}
              (dl-de/by-2-0).
            </p>
            <p>
              Der Quelltext dieser Anwendung steht unter der MIT-Lizenz. Die Datensätze fallen
              nicht darunter, sondern unter die oben genannten Lizenzen.
            </p>
            <p>
              Liniennummern, Farben und Stationsnamen sind Angaben über das bestehende Netz.
              Marken und Kennzeichen der Verkehrsunternehmen und Verkehrsverbünde stehen deren
              Inhabern zu und werden hier ausschließlich beschreibend verwendet.
            </p>
          </Section>

          <Section id="haftung" title="Haftung">
            <p>
              <b>Dies ist kein amtliches Angebot.</b> Es besteht keine Verbindung zu einem
              Verkehrsunternehmen, einem Verkehrsverbund oder einer Behörde, und es entsteht kein
              Auftrag von dort.
            </p>
            <p>
              Alle Kennzahlen sind Schätzungen eines offenen Modells auf Grundlage öffentlich
              verfügbarer Daten und dokumentierter Annahmen. Sie sind keine
              Nutzen-Kosten-Untersuchung nach dem Standardisierten Bewertungsverfahren und keine
              Grundlage für Investitionsentscheidungen. Für Richtigkeit, Vollständigkeit und
              Aktualität wird keine Gewähr übernommen.
            </p>
            <p>
              Für Inhalte verlinkter fremder Seiten sind deren Betreiber verantwortlich; zum
              Zeitpunkt der Verlinkung waren keine Rechtsverstöße erkennbar.
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}
