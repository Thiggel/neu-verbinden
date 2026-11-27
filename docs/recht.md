# Rechtliches

Dieses Dokument hält fest, welche rechtlichen Pflichten die Anwendung bereits
erfüllt, welche noch offen sind und welche Fragen nicht ohne anwaltliche
Prüfung entschieden werden sollten, wobei es eine Bestandsaufnahme und keine
Rechtsberatung ist.

## Umgesetzte Pflichten

| Pflicht | Grundlage | Umsetzung |
| --- | --- | --- |
| Impressum, von jeder Seite erreichbar | § 5 DDG | `/rechtliches#impressum`, Fußzeile |
| Datenschutzerklärung | Art. 13 DSGVO | `/rechtliches#datenschutz` |
| Auskunft und Datenübertragbarkeit | Art. 15, 20 DSGVO | `/konto`, `GET /api/auth/export` |
| Löschung | Art. 17 DSGVO | `/konto`, `DELETE /api/auth/me` |
| Meldeweg für Inhalte | Art. 16 DSA | `POST /api/scenarios/:slug/report` |
| Kontaktstelle | Art. 12 DSA | Impressum |
| Nutzungsbedingungen mit Moderationsregeln | Art. 14 DSA | `/rechtliches#nutzung` |
| Namensnennung der Kartendaten | ODbL 1.0 | Kartenfuß, `/rechtliches#daten` |
| Lizenz der *abgeleiteten* Datenbanken | ODbL 1.0 § 4.4 | `LICENSE-DATA`, `/data/` |
| Namensnennung der Statistikdaten | dl-de/by-2-0 | Kartenfuß, `/rechtliches#daten` |
| Hinweis, dass weder ein amtliches Angebot noch eine Standardisierte Bewertung vorliegt | Sorgfalt | `/rechtliches#haftung`, Fußzeile |

Zitiert werden die geltenden Vorschriften, da die Impressumspflicht seit dem
14. Mai 2024 in **§ 5 DDG** statt in § 5 TMG und die Einwilligung für den
Zugriff auf Endgeräte in **§ 25 TDDDG** statt in § 25 TTDSG geregelt ist und
bereits der Verweis auf eine außer Kraft getretene Norm abgemahnt werden kann.

## Betreiberangaben

In `apps/web/src/lib/impressum.ts` ist als Betreiber eine Privatperson mit
ihrer Wohnanschrift eingetragen. Sollten die Angaben je wieder durch
Platzhalter ersetzt werden, zeigt `/rechtliches` einen roten Hinweis, dass das
Angebot nicht betriebsbereit ist, und `HH_ENV=production npm run test:ui`
schlägt fehl.

Dass dort die Wohnanschrift steht, beruht auf einer Entscheidung und nicht auf
einer Vorschrift, denn § 5 DDG verlangt lediglich eine *ladungsfähige*
Anschrift, also einen Ort, an dem tatsächlich zugestellt werden kann. Ein
Postfach genügt dieser Anforderung nicht, während die Wohnung für eine
natürliche Person zwar den Regelfall, aber keine Bedingung darstellt. Ebenso
tragfähig wären eine gewerbliche Zustelladresse mit Nachsendung, die etwa 10
bis 30 € im Monat kostet, ein Coworking-Anbieter, der Post annimmt, oder ein
Verein, unter dessen Dach das Projekt betrieben wird, wobei in diesem Fall
dessen Impressum gälte und Auftragsverarbeitung wie DSA-Kontaktstelle zugleich
eine institutionelle Anschrift erhielten. Da der Wechsel nur eine Zeile in
`impressum.ts` betrifft und das Angebot mit Zahlen zu laufenden, politisch
umstrittenen Vorhaben Stellung bezieht, ist er zumindest zu erwägen.

Von der Impressumspflicht befreit es nicht, dass der Dienst unentgeltlich und
ohne Gewinnerzielungsabsicht betrieben wird, weil „geschäftsmäßig“ im Sinne des
§ 5 DDG auf Dauer angelegt und nicht auf Gewinn gerichtet bedeutet. Die
Ausnahme gilt nur für Angebote, die *ausschließlich persönlichen oder
familiären Zwecken* dienen, etwa für ein privates Fotoalbum, wozu eine
öffentlich erreichbare Plattform, auf der Fremde Konten anlegen, Entwürfe
veröffentlichen und kommentieren, nicht gehört.

## Speichern im Browser ohne Einwilligung

Im Browser werden ausschließlich das gewählte Erscheinungsbild, die zuletzt
geöffnete Stadt, der eigene Entwurf, der Vermerk, dass die Begrüßung gezeigt
wurde, der Zeitpunkt der letzten Rückmeldung und nach einer Anmeldung das
Sitzungsmerkmal gespeichert, während Analyse, Tracking, Werbung, fremde
Schriftarten und beim Aufruf nachgeladene Inhalte Dritter nicht vorkommen.
Deshalb greift die Ausnahme des § 25 Abs. 2 Nr. 2 TDDDG, sodass kein
Einwilligungsbanner erforderlich ist.

Angreifbar ist diese Bewertung vor allem dann, wenn die Anwendung erweitert
wird. Für Sitzungsmerkmal und Entwurf ist die Erforderlichkeit unstrittig,
doch würden eine Reichweitenmessung, eine Karte von einem fremden Kachelserver
oder ein eingebettetes Video die Bewertung unmittelbar ändern.

## Offene Punkte

Für die **Auftragsverarbeitung nach Art. 28 DSGVO** ist mit dem Hosting- und
dem Datenbankanbieter, laut `docs/betrieb.md` Vercel und Neon, je ein Vertrag
erforderlich, bevor echte Konten entstehen, wobei bei Anbietern außerhalb der
EU zusätzlich die Drittlandübermittlung zu prüfen ist. Die Datenschutzerklärung
gibt an, dass solche Verträge bestehen, und verweist für die Namen der Anbieter
auf die Betriebsdokumentation, wobei hier nicht festgehalten ist, ob die
Verträge beider Anbieter tatsächlich angenommen wurden, und zu prüfen bleibt,
ob der Verweis die Empfänger nach Art. 13 Abs. 1 lit. e DSGVO hinreichend
bezeichnet.

Das **Rückmeldeformular** sendet unmittelbar aus dem Browser an Web3Forms, das
die Nachricht per E-Mail weiterleitet und dabei die IP-Adresse des Absenders
erhält. Zu prüfen ist, ob mit Web3Forms ein Vertrag zur Auftragsverarbeitung
geschlossen werden kann, wo der Dienst die Daten verarbeitet und ob die Nennung
in der Datenschutzerklärung genügt. Die E-Mail-Adresse des Betreibers steht im
Impressum ausgeschrieben und ohne `mailto`-Verweis, was § 5 DDG genügen dürfte,
da sie für Menschen lesbar bleibt und das Formular eine zweite unmittelbare
Kontaktmöglichkeit bietet.

Ein **Verzeichnis von Verarbeitungstätigkeiten nach Art. 30 DSGVO** fehlt,
obwohl die Ausnahme für Stellen mit weniger als 250 Beschäftigten nicht
eindeutig greift, da die Verarbeitung nicht nur gelegentlich erfolgt.

Ein **Löschkonzept** besteht nur teilweise, weil Konten auf Verlangen und
Zähler mit IP-Adressen nach 24 Stunden gelöscht werden, für verwaiste Konten,
die nie wieder genutzt werden, jedoch keine Frist gilt.

Eine **Datensicherung** gibt es nicht, weshalb auch keine Aufbewahrungsfrist
für Sicherungen festgelegt ist, wobei beide Fragen zusammen entschieden werden
sollten.

Das **Barrierefreiheitsstärkungsgesetz**, das seit dem 28. Juni 2025 gilt,
dürfte nicht anwendbar sein, weil ein unentgeltliches Angebot ohne
Vertragsschluss kaum unter die Dienstleistungen im elektronischen
Geschäftsverkehr fällt und die Ausnahme für Kleinstunternehmen ohnehin
greifen dürfte. Zu prüfen ist dies erneut, falls das Angebot je etwas kostet,
während die Anwendung unabhängig davon mit der Tastatur bedienbar ist, was
`test:browser` prüft.

Bei der **Unentgeltlichkeit** ist zu klären, wie sich die Aussage der
Rechtstexte, es würden weder Verträge über Waren oder Dienstleistungen
geschlossen noch Entgelte erhoben,
zu der Kontoanlage nach den Nutzungsbedingungen, zu freiwilligen
Unterstützungsbeiträgen und zu der Beschränkung des Vercel-Hobby-Tarifs auf
nicht kommerzielle Nutzung verhalten.

Für **Auskunftsersuchen von Behörden** gibt es kein Verfahren, obwohl
veröffentlichte Entwürfe, wie in den Nutzungsbedingungen benannt,
beabsichtigt öffentlich abrufbar sind.

## Fragen für eine anwaltliche Prüfung

1. Impressum und Datenschutzerklärung im endgültigen Zustand, mit den
   tatsächlichen Betreiberangaben und Auftragsverarbeitern.
2. Die Einräumung von Rechten an nutzergenerierten Inhalten in den
   Nutzungsbedingungen, insbesondere im Zusammenhang mit dem Weiterbearbeiten
   fremder Entwürfe.
3. Die Frage, ob die Ausnahme nach § 25 Abs. 2 Nr. 2 TDDDG für alle vier im
   Browser gespeicherten Werte trägt.
4. Die Verwendung von Liniennummern, Farben und Netzstruktur der bestehenden
   Verkehrsnetze, da Fakten frei sind, die konkrete gestalterische Darstellung
   eines Netzplans aber geschützt sein kann. Für die Anwendung spricht, dass sie
   geografisch und nicht im Stil eines veröffentlichten Netzplans zeichnet,
   doch sollte diese Abwägung nicht ohne fachliche Prüfung getroffen werden.
