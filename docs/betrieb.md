# Betrieb

Dieses Dokument beschreibt, wie die Anwendung veröffentlicht wird, welche
Dienste sie dafür benötigt und welche Fehler dabei auftreten können, wobei
vorausgesetzt ist, dass für den Betrieb keine Kosten entstehen sollen.

## Bestandteile

Die Anwendung besteht aus drei Teilen, die getrennt betrieben werden:

| Teil | Beschreibung | Bedarf |
| --- | --- | --- |
| `apps/web` | Next.js-Anwendung, die fast vollständig im Browser läuft, wobei der Rechenkern als WebAssembly beim Besucher ausgeführt wird | Statische Auslieferung und **rund 12 MB Kartendaten je Erstbesuch** |
| `rust/server` | Axum-API mit Hintergrundarbeiter | Ein dauerhaft laufender Prozess, der im Leerlauf 7 MB Arbeitsspeicher belegt |
| Postgres | Konten, veröffentlichte Entwürfe, Kommentare und Limits | Eine dauerhafte Datenbank, weshalb Angebote, die nach 30 Tagen ablaufen, nicht in Frage kommen |

Da die Oberfläche **unmittelbar** mit der API spricht und keine eigene
Serverseite dazwischen liegt, ist `HH_ALLOWED_ORIGIN` die einzige Absicherung
gegen fremde Seiten, und die API muss über HTTPS erreichbar sein.

## Umgebungsvariablen

Mit `HH_ENV=production` wird die Startprüfung in `rust/server/src/preflight.rs`
wirksam, sodass der Server nicht startet, wenn eine der ersten drei Angaben
fehlt, statt über längere Zeit mit einer Warnung im Protokoll fehlerhaft zu
laufen.

| Variable | Pflicht | Zweck |
| --- | --- | --- |
| `HH_ENV` | ja | Mit `production` werden die folgenden Prüfungen wirksam |
| `HH_JWT_SECRET` | ja | Signiert die Anmeldungen und muss zufällig sein und mindestens 32 Zeichen haben. Fehlt eine feste Angabe, erzeugt der Server bei jedem Start ein neues Geheimnis und meldet damit alle Nutzer ab |
| `HH_ALLOWED_ORIGIN` | ja | Die Adresse der Oberfläche einschließlich `https://`, wobei `*` im Betrieb abgelehnt wird |
| `DATABASE_URL` | ja | Postgres |
| `HH_TRUST_PROXY` | hinter jedem Proxy | Ohne diese Angabe sieht der Server nur die Adresse des Proxys, sodass sich alle Aufrufer **ein** Limit teilen und der erste, der es erreicht, alle übrigen aussperrt. Ist sie dagegen gesetzt, ohne dass ein Proxy vorgeschaltet ist, kann jeder sein Limit durch einen erfundenen Kopfzeileneintrag zurücksetzen, weshalb sie nur dann gesetzt werden sollte, wenn tatsächlich ein Proxy davor steht. Der Wert gibt die Zahl der eigenen Proxys in Folge an (`1` für einen einzelnen, `2` etwa für CDN und Load Balancer), und gezählt wird von rechts in `X-Forwarded-For`, weil nur diese Einträge von einem eigenen Proxy stammen |
| `HH_WORKER_IDLE_SECS` | bei schlafender Datenbank | Wartezeit des Arbeiters, wenn nichts zu tun ist (Vorgabe 60 s) |
| `HH_DB_IDLE_SECS` | bei schlafender Datenbank | Zeit, nach der ungenutzte Verbindungen geschlossen werden (Vorgabe 120 s) |
| `HH_CITIES`, `HH_DATA_DIR`, `HH_DATA_VERSION` | nein | Auswahl der Städte, Ort und Stand der Daten |
| `HH_SENDMAIL`, `HH_FEEDBACK_TO` | für Rückmeldungen | Programm und Empfänger für das Rückmeldefenster. Aufgerufen wird `HH_SENDMAIL -i -- HH_FEEDBACK_TO` mit der Nachricht auf der Standardeingabe, sodass der Empfänger nie in Kopfzeilen steht, die ein Absender beeinflussen könnte. Fehlen beide Angaben, bleibt die Rückmeldung in der Tabelle `feedback` erhalten, deren Einträge der Aufräumjob nach zwölf Monaten löscht |

Die Oberfläche benötigt zur *Bauzeit* `NEXT_PUBLIC_API_URL=https://…` mit der
Adresse der API, die anschließend im ausgelieferten JavaScript steht und sich
nur durch einen neuen Bau ändern lässt.

## Freikontingente

Für die Wahl des Anbieters ist nicht der Arbeitsspeicher, sondern der
**Datenverkehr** entscheidend, da ein erster Besuch in Hamburg rund 12 MB
überträgt, die sich auf Grundkarte, Stadtraster, Netz und 1,3 MB WebAssembly
verteilen. Weil jede Datei ihre Version im Namen trägt und ein Jahr lang
zwischengespeichert wird, verursacht ein zweiter Besuch kaum Verkehr, doch
entsprechen 100 GB im Monat dennoch nur rund 8 000 Erstbesuchen,
beziehungsweise etwa dem Drei- bis Vierfachen bei komprimierter Übertragung.

Die Oberfläche sollte deshalb **bei einem Anbieter ohne Obergrenze für den
Datenverkehr** liegen, weil eine Obergrenze ohne Nachzahlung die Seite
gerade dann stilllegt, wenn sie an anderer Stelle verlinkt wird und damit zum
ersten Mal Aufmerksamkeit erhält.

Für die Datenbank gilt eine andere Rechnung, weil Anbieter mit
Freikontingent nach *Rechenstunden* abrechnen und die Datenbank im Leerlauf
schlafen legen. Der Hintergrundarbeiter fragte früher alle zwei Sekunden nach
Arbeit und hielt sie damit ständig wach, sodass ein Kontingent von 100 Stunden
im Monat nach vier Tagen erschöpft war. Inzwischen verdoppelt er seine
Wartezeit bis zum Wert von `HH_WORKER_IDLE_SECS`, für den bei einer schlafenden
Datenbank ein hoher Wert wie 600 angemessen ist, wobei die Neuberechnung nach
einer Modelländerung entsprechend länger dauert, was jedoch unerheblich ist,
da niemand auf sie wartet.

## Einrichtung

1. Zuerst wird die **Datenbank** angelegt und `DATABASE_URL` notiert, während
   die Migrationen beim Start des Servers selbsttätig laufen.
2. Danach wird die **API** aus dem `Dockerfile` im Wurzelverzeichnis gebaut
   und ausgerollt. Die Stadtdaten sind Teil des Abbilds, damit ein Container
   nicht auf einen anderen Datenstand trifft als den, gegen den er gebaut
   wurde. Zu setzen sind die oben genannten Variablen, wobei
   `HH_ALLOWED_ORIGIN` auf die Oberfläche verweist.
3. Anschließend wird die **Oberfläche** mit `NEXT_PUBLIC_API_URL` gebaut und
   ausgerollt.
4. Zuletzt wird das Ergebnis **geprüft**:
   ```
   curl https://api…/api/health
   HH_API=https://api… HH_WEB=https://… npm run test:api
   HH_API=https://api… npm run test:security
   ```
   Da der Sicherheitslauf die tatsächlichen Limits prüft und ihnen selbst
   unterliegt, ist ein zweiter Lauf kurz nach dem ersten weniger aussagekräftig,
   worauf der Lauf in diesem Fall auch hinweist.

## Vercel und Neon

Ausgerollt wird nur, wenn auf GitHub ein Release veröffentlicht wird
(`.github/workflows/deploy.yml`), während ein Vorab-Release nicht online geht.
Die Git-Anbindung von Vercel ist in beiden `vercel.json` abgeschaltet, damit
ein Push auf `main` nichts verändert. Die Oberfläche wird in GitHub Actions
gebaut und fertig hochgeladen, weil Rechenkern und Stadtdaten nicht im
Repository liegen, während Vercel die API aus dem `Dockerfile` baut.

Aus demselben Repository werden zwei Vercel-Projekte gespeist:

| Projekt | Root Directory | Framework | Variablen |
| --- | --- | --- | --- |
| Oberfläche, `neu-verbinden` | `apps/web` | Next.js | `NEXT_PUBLIC_API_URL` |
| API, `neu-verbinden-api` | Wurzel | Container | alle aus der Tabelle oben, dazu `PORT=8080`, `HH_TRUST_PROXY=1`, `HH_WORKER_IDLE_SECS=600`, `HH_DB_IDLE_SECS=60` |

`DATABASE_URL` wird von der Neon-Integration aus dem Vercel Marketplace
gesetzt, wenn dort der Free-Tarif gewählt wird. Bei der Einrichtung sind die
Region Frankfurt zu wählen und Auth sowie Realtime abzuschalten, da die API die
Anmeldung selbst übernimmt; verbunden wird die Integration nur mit dem
API-Projekt, nur für Production und mit dem Präfix `DATABASE`. Sie setzt
außerdem `DATABASE_URL_UNPOOLED`, die der Server bevorzugt, weil die
Migrationen eine Sitzungssperre benötigen, die der Pooler nicht hält.

In GitHub sind als Secrets `VERCEL_TOKEN` und `VERCEL_ORG_ID` hinterlegt und
als optionale Variable `API_URL`, bei deren Angabe die Oberfläche erst
ausgerollt wird, wenn die neue API antwortet. Die IDs der beiden Projekte
werden nicht hinterlegt, sondern vor dem Hochladen anhand der in `deploy.yml`
genannten Projektnamen bei Vercel erfragt, weil eine vertauschte oder
fehlerhafte ID sonst die Oberfläche durch die API ersetzen oder den Ablauf
stillschweigend scheitern lassen könnte.

Der Hobby-Tarif sieht keine Nachzahlung vor, da ihm keine Zahlungsart
hinterlegt ist, sodass ein Dienst, dessen Kontingent überschritten wird, bis
zum nächsten Abrechnungszeitraum ruht und Kosten erst nach einem Wechsel zum
Pro-Tarif entstehen, der eine Karte voraussetzt. Voraussichtlich greifen
zuerst die Grenze von 100 GB Datenverkehr, die oben beschrieben ist, und der
bereitgestellte Speicher des Containers, der nach jedem Aufruf mindestens fünf
Minuten aktiv bleibt. Der Hobby-Tarif ist auf persönliche, nicht kommerzielle
Nutzung beschränkt (Stand 2026-11-27, Quellen: vercel.com/docs/plans/hobby
und vercel.com/legal/terms).

## Beispielentwürfe

`npm run examples:seed` veröffentlicht die Beispiele der Entdecken-Seite unter
einem eigenen Konto und ersetzt dabei, was dasselbe Konto zuvor veröffentlicht
hat. `HH_SEED_PASSWORD` ist dafür erforderlich, während `HH_SEED_PURGE=1`
zusätzlich alle übrigen Entwürfe entfernt und ein Konto mit Moderatorrechten
voraussetzt.

## Offene Punkte

Die Oberfläche besitzt mit dem Vorschaubild unter
`/szenario/[slug]/opengraph-image` eine einzige serverseitige Route, die bei
einem rein statischen Anbieter entfiele, weshalb entweder ein Anbieter gewählt
werden muss, der sie ausführt, oder das Bild in die API verlegt werden müsste,
die den Rechenkern ohnehin enthält.

Für Datensicherungen gibt es bislang keinen Ablauf, obwohl veröffentlichte
Entwürfe als einzige Daten nicht aus dem Quelltext wiederhergestellt werden
können.
