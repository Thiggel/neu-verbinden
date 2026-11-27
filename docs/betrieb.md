# Betrieb

Wie diese Anwendung ins Netz kommt, was sie dafür braucht und was dabei
schiefgehen kann. Geschrieben für den Fall, dass nichts dafür bezahlt werden
soll.

## Woraus sie besteht

Drei Teile, die getrennt betrieben werden müssen:

| Teil | Was es ist | Was es braucht |
| --- | --- | --- |
| `apps/web` | Next.js, fast vollständig im Browser. Der Rechenkern läuft als WebAssembly beim Besucher. | Statisches Ausliefern, dazu **rund 12 MB Kartendaten je Erstbesuch** |
| `rust/server` | Axum-API mit Hintergrundarbeiter | Ein Prozess, der dauerhaft läuft. 7 MB Arbeitsspeicher im Leerlauf |
| Postgres | Konten, veröffentlichte Entwürfe, Kommentare, Limits | Muss bleiben. Eine Datenbank, die nach 30 Tagen abläuft, ist keine |

Die Oberfläche spricht **direkt** mit der API, nicht über eine eigene
Serverseite. Deshalb ist `HH_ALLOWED_ORIGIN` die gesamte Absicherung gegen
fremde Seiten, und deshalb muss die API über HTTPS erreichbar sein.

## Umgebungsvariablen

`HH_ENV=production` schaltet die Startprüfung scharf: fehlt eines der drei
ersten Dinge, startet der Server nicht, statt mit einer Warnung im Protokoll
monatelang falsch zu laufen (`rust/server/src/preflight.rs`).

| Variable | Pflicht | Wofür |
| --- | --- | --- |
| `HH_ENV` | ja | `production` schaltet die Prüfungen unten scharf |
| `HH_JWT_SECRET` | ja | Signiert die Anmeldungen. Mindestens 32 Zeichen, zufällig. Ohne feste Angabe erfindet der Server bei jedem Start ein neues und meldet alle ab |
| `HH_ALLOWED_ORIGIN` | ja | Die Adresse der Oberfläche, mit `https://`. `*` wird im Betrieb abgelehnt |
| `DATABASE_URL` | ja | Postgres |
| `HH_TRUST_PROXY` | hinter jedem Proxy | Ohne dies sieht der Server nur die Adresse des Proxys. Alle Aufrufer teilen sich dann **ein** Limit, und der erste, der es erreicht, sperrt alle übrigen aus. Mit dies gesetzt und *ohne* Proxy davor kann jeder sein eigenes Limit durch einen erfundenen Kopfzeileneintrag zurücksetzen, also genau dann setzen, wenn wirklich einer davor steht. Der Wert ist die Zahl der eigenen Proxys hintereinander (`1` für einen einzelnen, `2` etwa für CDN plus Load Balancer); gezählt wird von rechts in `X-Forwarded-For`, denn nur diese Einträge hat ein eigener Proxy geschrieben |
| `HH_WORKER_IDLE_SECS` | bei schlafender Datenbank | Wie lange der Arbeiter wartet, wenn nichts zu tun ist (Vorgabe 60 s) |
| `HH_DB_IDLE_SECS` | bei schlafender Datenbank | Wann ungenutzte Verbindungen geschlossen werden (Vorgabe 120 s) |
| `HH_CITIES`, `HH_DATA_DIR`, `HH_DATA_VERSION` | nein | Welche Städte, woher, welcher Stand |
| `HH_SENDMAIL`, `HH_FEEDBACK_TO` | für Rückmeldungen | Programm und Empfänger für das Feedback-Fenster. Aufgerufen wird `HH_SENDMAIL -i -- HH_FEEDBACK_TO`, die Nachricht kommt auf der Standardeingabe; der Empfänger steht also nie in den Kopfzeilen, die ein Absender beeinflussen kann. Ohne beides bleibt die Rückmeldung in der Tabelle `feedback` stehen, statt verloren zu gehen. Gespeicherte Rückmeldungen löscht der Aufräumjob nach zwölf Monaten |

Für die Oberfläche zur *Bauzeit*: `NEXT_PUBLIC_API_URL=https://…`, die Adresse
der API. Sie steht danach im ausgelieferten JavaScript und lässt sich ohne
neuen Bau nicht ändern.

## Was das Freikontingent entscheidet

Die Zahl, an der die Wahl hängt, ist nicht der Arbeitsspeicher, sondern
**Datenverkehr**: Hamburg sind rund 12 MB beim ersten Besuch (Grundkarte,
Stadtraster, Netz, dazu 1,3 MB WebAssembly). Alles trägt seine Version im
Namen und wird ein Jahr lang zwischengespeichert, ein zweiter Besuch kostet
also fast nichts. Aber 100 GB im Monat sind damit rund 8 000 Erstbesuche,
komprimiert etwa das Drei- bis Vierfache.

Deshalb: **die Oberfläche gehört auf einen Anbieter ohne Verkehrsdeckel.** Bei
einem Deckel ohne Nachzahlung steht die Seite still, wenn sie einmal irgendwo
verlinkt wird, also genau dann, wenn sie zum ersten Mal jemanden interessiert.

Für die Datenbank zählt etwas anderes: Anbieter mit Freikontingent rechnen in
*Rechenstunden* und schlafen im Leerlauf ein. Der Hintergrundarbeiter fragte
früher alle zwei Sekunden nach Arbeit und hielt sie damit rund um die Uhr wach;
ein Kontingent von 100 Stunden im Monat war nach vier Tagen aufgebraucht. Er
verdoppelt seine Wartezeit jetzt bis `HH_WORKER_IDLE_SECS`. Bei einer
schlafenden Datenbank ist ein hoher Wert richtig (etwa 600), und die
Neuberechnung nach einer Modelländerung dauert entsprechend länger. Sie ist
nichts, worauf jemand wartet.

## Der Reihe nach

1. **Datenbank** anlegen, `DATABASE_URL` notieren. Die Migrationen laufen beim
   Start des Servers von selbst.
2. **API** aus dem `Dockerfile` im Wurzelverzeichnis bauen und ausrollen. Die
   Stadtdaten liegen im Abbild, damit ein Behälter nicht auf einen anderen
   Datenstand trifft als den, gegen den er gebaut wurde. Die Variablen oben
   setzen, `HH_ALLOWED_ORIGIN` zeigt auf die Oberfläche.
3. **Oberfläche** mit `NEXT_PUBLIC_API_URL` bauen und ausrollen.
4. **Nachsehen**, ob es gestimmt hat:
   ```
   curl https://api…/api/health
   HH_API=https://api… HH_WEB=https://… npm run test:api
   HH_API=https://api… npm run test:security
   ```
   Der Sicherheitslauf prüft echte Limits und unterliegt ihnen selbst; zweimal
   kurz hintereinander gestartet sagt er weniger, und sagt das auch.

## Mit Vercel und Neon

Ausgerollt wird nur, wenn auf GitHub ein Release veröffentlicht wird
(`.github/workflows/deploy.yml`); ein Vorab-Release bleibt offline. Die
Git-Anbindung von Vercel ist in beiden `vercel.json` abgeschaltet, damit ein
Push auf `main` nichts verändert. Die Oberfläche wird in GitHub Actions gebaut,
weil Rechenkern und Stadtdaten nicht im Repository liegen, und fertig
hochgeladen. Die API baut Vercel aus dem `Dockerfile`.

Zwei Vercel-Projekte aus demselben Repository:

| Projekt | Root Directory | Framework | Variablen |
| --- | --- | --- | --- |
| Oberfläche, `neu-verbinden` | `apps/web` | Next.js | `NEXT_PUBLIC_API_URL` |
| API, `neu-verbinden-api` | Wurzel | Container | alle aus der Tabelle oben, dazu `PORT=8080`, `HH_TRUST_PROXY=1`, `HH_WORKER_IDLE_SECS=600`, `HH_DB_IDLE_SECS=60` |

`DATABASE_URL` setzt die Neon-Integration aus dem Vercel Marketplace, wenn
dort der Free-Tarif gewählt wird. Bei der Einrichtung: Region Frankfurt, Auth
und Realtime aus, denn die Anmeldung erledigt die API selbst; verbunden nur mit
dem API-Projekt, nur für Production, Präfix `DATABASE`. Die Integration setzt
dann auch `DATABASE_URL_UNPOOLED`, die der Server vorzieht, weil die
Migrationen eine Sitzungssperre brauchen, die der Pooler nicht hält. In GitHub stehen als Secrets
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_WEB` und
`VERCEL_PROJECT_ID_API`, als Variable optional `API_URL`. Ist `API_URL` gesetzt,
geht die Oberfläche erst hinaus, wenn die neue API antwortet. Vor dem Hochladen fragt der
Ablauf bei Vercel die Namen der beiden Projekte ab und bricht ab, wenn sie
nicht zu den in `deploy.yml` hinterlegten passen, weil eine vertauschte ID
sonst die Oberfläche durch die API ersetzt.

Der Hobby-Tarif kennt keine Nachzahlung, weil ihm keine Zahlungsart hinterlegt
ist: Wird ein Kontingent überschritten, ruht der betroffene Dienst bis zum
nächsten Abrechnungszeitraum. Kosten entstehen erst nach einem Wechsel zu Pro,
der eine Karte verlangt. Die Grenzen, die hier zuerst greifen dürften, sind
die 100 GB Datenverkehr (siehe oben) und der bereitgestellte Speicher des
Containers, der nach jedem Aufruf mindestens fünf Minuten wach bleibt. Der
Hobby-Tarif ist auf persönliche, nicht kommerzielle Nutzung beschränkt.
Stand 2026-11-27, Quelle: vercel.com/docs/plans/hobby und
vercel.com/legal/terms.

## Die Beispiele auf der Entdecken-Seite

`npm run examples:seed` veröffentlicht sie unter einem eigenen Konto und ersetzt
dabei, was dasselbe Konto vorher veröffentlicht hat. `HH_SEED_PASSWORD` ist
Pflicht, `HH_SEED_PURGE=1` räumt zusätzlich alles andere weg und braucht dafür
ein Konto mit Moderatorrechten.

## Was noch offen ist

* Die Oberfläche hat eine einzige serverseitige Route: das Vorschaubild unter
  `/szenario/[slug]/opengraph-image`. Auf einem rein statischen Anbieter fällt
  sie weg. Entweder ein Anbieter, der sie ausführt, oder das Bild wandert in
  die API, die den Rechenkern ohnehin hat.
* Es gibt keinen Ablauf für Datensicherungen. Veröffentlichte Entwürfe sind das
  Einzige, was nicht aus dem Quelltext wiederherstellbar ist.
