# Rechtliches: Stand und offene Punkte

Was an dieser Anwendung rechtlich vorbereitet ist, was noch fehlt und was nicht
ohne anwaltliche Prüfung entschieden werden sollte. Dieses Dokument ist eine
Bestandsaufnahme, keine Rechtsberatung.

## Erledigt

| Pflicht | Grundlage | Wo |
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
| Kein amtliches Angebot, keine Standardisierte Bewertung | Sorgfalt | `/rechtliches#haftung`, Fußzeile |

Die Paragraphen sind die aktuellen: seit dem 14. Mai 2024 steht die
Impressumspflicht in **§ 5 DDG** statt § 5 TMG, und die Einwilligung für den
Zugriff auf Endgeräte in **§ 25 TDDDG** statt § 25 TTDSG. Der Verweis auf eine
außer Kraft getretene Norm ist selbst ein Abmahngrund.

## Betreiberangaben

`apps/web/src/lib/impressum.ts` ist ausgefüllt: eine Privatperson mit ihrer
Wohnanschrift. Der Schutzmechanismus bleibt bestehen, falls die Angaben je
wieder auf Platzhalter fallen: `/rechtliches` zeigt dann einen roten Kasten
„nicht betriebsbereit", und `HH_ENV=production npm run test:ui` schlägt fehl.

**Dass es die Wohnanschrift ist, ist eine Entscheidung, keine Vorschrift.**
§ 5 DDG verlangt eine *ladungsfähige* Anschrift, also einen Ort, an dem
tatsächlich zugestellt werden kann. Ein Postfach genügt dafür nicht, eine
Wohnung ist aber nur der Regelfall für eine natürliche Person und nicht die
Bedingung. Ebenso tragfähig wären:

* eine gewerbliche Zustelladresse mit Nachsendung, etwa 10 bis 30 € im Monat,
* ein Coworking-Anbieter, der Post annimmt,
* ein Verein, unter dessen Dach das Projekt läuft; dann gilt dessen Impressum,
  und die Auftragsverarbeitung sowie die DSA-Kontaktstelle bekommen zugleich
  eine institutionelle Adresse.

Der Wechsel ist eine Zeile in `impressum.ts`. Erwägenswert ist er, weil dieses
Angebot mit Zahlen gegen ein laufendes Vorhaben argumentiert; eine Wohnanschrift
an einer politisch strittigen Position ist etwas anderes als eine an einem
Kochblog.

Dass der Dienst unentgeltlich und ohne Gewinnerzielungsabsicht betrieben wird,
befreit nicht von der Impressumspflicht. „Geschäftsmäßig" in § 5 DDG heißt auf
Dauer angelegt, nicht auf Gewinn gerichtet. Die Ausnahme gilt für Angebote, die
*ausschließlich persönlichen oder familiären Zwecken* dienen, also etwa ein
privates Fotoalbum. Eine öffentlich erreichbare Plattform, auf der Fremde Konten
anlegen, veröffentlichen und kommentieren, ist das nicht.

## Kein Einwilligungsbanner, und warum

Im Browser liegen nur: Erscheinungsbild, zuletzt geöffnete Stadt, der eigene
Entwurf und das Sitzungsmerkmal nach einer Anmeldung. Keine Analyse, kein
Tracking, keine Werbung, keine fremden Schriftarten, kein Inhalt Dritter, der
beim Aufruf nachgeladen wird. Damit greift die Ausnahme des § 25 Abs. 2 Nr. 2
TDDDG und es ist kein Banner nötig.

**Das ist der eine Punkt, der angreifbar ist.** Sitzungsmerkmal und Entwurf sind
unstrittig erforderlich. Ob das gilt, sobald die Anwendung um irgendetwas
erweitert wird, das messen, zählen oder einbetten soll, ist es nicht: eine
Reichweitenmessung, eine Karte von einem fremden Kachelserver oder ein
eingebettetes Video kippen die Bewertung sofort.

## Offen

* **Auftragsverarbeitung (Art. 28 DSGVO).** Mit Hosting- und
  Datenbankanbieter muss je ein Vertrag geschlossen werden, bevor echte Konten
  entstehen. Bei Anbietern außerhalb der EU zusätzlich die Frage der
  Drittlandübermittlung. `docs/betrieb.md` nennt die Kandidaten; die Verträge
  fehlen noch, weil noch nichts ausgerollt ist.
* **Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO).** Die Ausnahme für
  unter 250 Beschäftigte greift hier nicht sauber, weil die Verarbeitung nicht
  nur gelegentlich erfolgt. Ein kurzes Verzeichnis ist schnell geschrieben und
  fehlt.
* **Löschkonzept.** Konten werden auf Verlangen gelöscht, Zähler mit IP-Adressen
  nach 24 Stunden. Für verwaiste Konten, die nie wieder benutzt werden, gibt es
  keine Frist.
* **Datensicherung.** Es gibt keine, und damit auch keine Aussage darüber, wie
  lange Sicherungen aufbewahrt würden. Beides gehört zusammen entschieden.
* **Barrierefreiheit (BFSG).** Seit dem 28. Juni 2025 in Kraft. Ein
  unentgeltliches Angebot ohne Vertragsschluss dürfte nicht unter
  „Dienstleistungen im elektronischen Geschäftsverkehr" fallen, und die
  Kleinstunternehmerausnahme dürfte ohnehin greifen. Zu prüfen, falls das
  Angebot je etwas kostet. Unabhängig davon ist die Anwendung mit Tastatur
  bedienbar und `test:browser` prüft das.
* **Nutzerinhalte im Ausland.** Veröffentlichte Entwürfe sind öffentlich
  abrufbar; das ist gewollt und in den Nutzungsbedingungen benannt. Ein
  Verfahren für Auskunftsersuchen von Behörden gibt es nicht.

## Was ein Anwalt ansehen sollte

1. Impressum und Datenschutzerklärung im fertigen Zustand, mit den echten
   Betreiberangaben und den tatsächlich eingesetzten Auftragsverarbeitern.
2. Die Rechteeinräumung an nutzergenerierten Inhalten in den
   Nutzungsbedingungen, besonders im Zusammenspiel mit dem Forken.
3. Ob die Ausnahme nach § 25 Abs. 2 Nr. 2 TDDDG für alle vier gespeicherten
   Werte trägt.
4. Die Verwendung von Liniennummern, Farben und Netzstruktur der bestehenden
   Verkehrsnetze. Fakten sind frei, die konkrete gestalterische Darstellung
   eines Netzplans kann geschützt sein; diese Anwendung zeichnet geografisch
   und nicht im Stil eines veröffentlichten Netzplans, was dafür spricht, aber
   nicht von einem Laien entschieden werden sollte.
