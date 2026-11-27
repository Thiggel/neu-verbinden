# Verkehrsnetz-Designer

Die Anwendung erlaubt es, ein Nahverkehrsnetz für Hamburg oder Berlin zu
zeichnen, und schätzt, was es kosten, wie lange sein Bau dauern und welchen
Nutzen es stiften würde.

> Alle Zahlen dieser Anwendung sind Modellschätzungen, die weder eine
> Standardisierte Bewertung noch eine Kostenberechnung oder eine Planung
> ersetzen.

Die Oberfläche und diese Dokumentation sind deutsch, während der Code englisch
kommentiert ist.

---

## Funktionsumfang

Die Anwendung enthält die bestehenden Netze zweier Städte, die aus
OpenStreetMap importiert und im Editor umschaltbar sind: für Hamburg U-Bahn,
S-Bahn und AKN mit 13 Linien und 273 km, für Berlin U-Bahn, S-Bahn und
Straßenbahn mit 68 Linien und 719 km, wobei sich jede Linie einzeln ein- und
ausblenden lässt. Die offiziell geplanten Vorhaben liegen als eigene, ebenfalls
umschaltbare Ebenen vor, und zwar für Hamburg die U5 in fünf Baustufen, die U4
zur Horner Geest und zum Grasbrook, die S4 sowie die vier Straßenbahnkorridore
der im August 2026 für die Linksfraktion vorgestellten Studie, für Berlin die
Siemensbahn, die U8 ins Märkische Viertel, die U3 zum Mexikoplatz und die
Straßenbahn zum Ostkreuz.

Beim Zeichnen setzt jeder Klick eine Station, zwischen denen die Anwendung
weitere ergänzt. Kurven werden ausgerundet, Winkel rasten nur ein, wenn sie
bereits nahe an einer Vorzugsrichtung liegen, und ein Anschluss an eine
bestehende Linie wird hervorgehoben, sobald der Zeiger auf ihr liegt. Länge,
Zahl der Stationen, Kosten, Eröffnungsjahr und erreichte Einwohner werden schon
während des Zeichnens fortlaufend angezeigt.

Für jeden Entwurf schätzt die Anwendung Baukosten, Bauzeit, Eröffnungsjahr,
Baubarkeit, Fahrgastnachfrage, volkswirtschaftlichen Nutzen, den Fiskaleffekt
für den Haushalt der jeweiligen Stadt und das Betriebsergebnis, wobei sich die
Kosten bis zum einzelnen Abschnitt aufschlüsseln lassen. Entwürfe lassen sich
als Datei speichern, veröffentlichen, forken, kommentieren und miteinander
vergleichen, und über veröffentlichte Entwürfe kann abgestimmt werden, woraus
die Ranglisten entstehen.

Die Wunschkarte legt für jede Stadt alle veröffentlichten Entwürfe übereinander
und zeigt als Hitzekarte, wo unabhängig voneinander dieselbe Lücke gezeichnet
wurde, was sich an keinem einzelnen Entwurf ablesen lässt. Das bestehende Netz
geht dabei nicht ein, während Stimmen und Forks nur logarithmisch gewichtet
werden.

### Abgleich mit veröffentlichten Angaben

`npm run engine:calibrate` vergleicht die Kennwerte des Modells mit
veröffentlichten Angaben zu Hamburger Vorhaben und zum Hamburger Bestandsnetz.

| Referenz | Modell | veröffentlicht | Abweichung |
| --- | ---: | ---: | ---: |
| U5 City Nord – Jarrestraße | 1,42 Mrd. € | 1,50 Mrd. € | −5 % |
| S4 | 1,70 Mrd. € | 1,85 Mrd. € | −8 % |
| U5 Ost (Bramfeld – City Nord) | 1,97 Mrd. € | 2,86 Mrd. € | −31 % |
| U4 Horner Geest | 779 Mio. € | 561 Mio. € | +39 % |
| Straßenbahnnetz der Studie, Länge | 43,0 km | 43,7 km | −2 % |
| Fahrten im Jahr, Bestandsnetz | 572 Mio. | 571 Mio. | +0 % |
| Kostendeckung, Bestandsnetz | 76 % | 75 % (HOCHBAHN) | im Rahmen |

Bei den veröffentlichten Kosten handelt es sich um die jüngsten Angaben der
Vorhabenträger, die künftige Preissteigerungen teilweise einrechnen. Die
Fahrgastzahlen, auf die die Einsteigerraten kalibriert sind, stammen aus dem
Lagebericht 2025 der HOCHBAHN (U-Bahn 291 Mio.) und von der S-Bahn Hamburg
(rund 280 Mio.). `hh audit <projekt>` gibt die Herleitung Position für Position
aus, sodass sich die Rechnung von Hand nachprüfen lässt.

---

## Installation und Start

Vorausgesetzt werden Node 20 oder neuer und Rust 1.80 oder neuer, während
PostgreSQL 14 oder neuer nur benötigt wird, wenn Entwürfe veröffentlicht werden
sollen.

Da die fertigen Datensätze für Hamburg und Berlin unter `data/dist/` im
Repository liegen, muss nach dem Klonen nichts aus dem Netz geladen werden. Zu
erzeugen ist lediglich der Rechenkern für den Browser, der als kompiliertes
Ergebnis nicht im Repository enthalten ist.

```bash
git clone https://github.com/Thiggel/neu-verbinden.git
cd neu-verbinden
npm install

rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127

npm run wasm:build     # Rechenkern nach WebAssembly übersetzen
npm run data:publish   # Datensätze aus data/dist in die Web-App kopieren
npm run dev            # http://localhost:3000
```

Für den Editor genügt das, weil Zeichnen, Rechnen, Speichern und Öffnen
vollständig im Browser und ohne Server oder Konto laufen.

### Server

Veröffentlichen, Abstimmen, Kommentieren und Vergleichen setzen den Server und
eine PostgreSQL-Datenbank voraus, deren Tabellen der Server beim ersten Start
selbst anlegt.

```bash
createdb hamburg_transit
cp .env.example .env      # HH_JWT_SECRET darin ersetzen
npm run server            # http://localhost:8080
```

Die Weboberfläche spricht die API unter `http://localhost:8080` an, wobei sich
eine andere Adresse beim Bauen über `NEXT_PUBLIC_API_URL` setzen lässt.

### Beispielentwürfe

```bash
HH_SEED_PASSWORD=… npm run examples:seed
```

Der Befehl veröffentlicht die vier Beispielentwürfe der Entdecken-Seite unter
einem eigenen Konto und ersetzt dabei, was dasselbe Konto zuvor veröffentlicht
hat. Jeder Entwurf enthält ausschließlich seine eigenen Linien und das
bestehende Netz, weil ein Entwurf, der fremde Vorhaben mitführt, deren Kilometer
und Kosten als seine eigenen ausweisen würde.

### Neubau der Datensätze

Ein Neubau ist nur nötig, wenn die Datensätze aktualisiert werden sollen, und
gehört nicht zum gewöhnlichen Start, weil der Bezug lange dauert und fremde
Server belastet.

```bash
npm run data:fetch     # OpenStreetMap über Overpass, Statistik, Geodaten
npm run data:build     # normalisieren, geocodieren, Domänennetz erzeugen
npm run data:publish

# Berlin
npm run data:fetch:berlin
npm run data:build:berlin
npm run data:publish
```

### Tests

Da `test:browser` einen echten Browser steuert, ist vor dem ersten Lauf
einmalig `npx playwright install chromium` auszuführen.

```bash
npm test               # alle Suiten nacheinander

npm run engine:test    # Unit-Tests des Rechenkerns und der API (Rust)
npm run test:ui        # reine Oberflächenlogik, ohne Browser
npm run test:engine    # der gebaute Rechenkern gegen die echten Stadtdaten
npm run test:flow      # eine vollständige Nutzergeschichte, Schritt für Schritt
npm run test:api       # Integrationstests gegen die laufende API
npm run test:browser   # die Oberfläche selbst, angeklickt (Playwright)
npm run test:security  # Angriffsversuche gegen die laufende API

npm run engine:bench     # Laufzeiten, nach jeder Modelländerung
npm run engine:calibrate # Abgleich mit veröffentlichten Projektangaben
cd rust && cargo run --release -p hh-cli --bin hh -- audit u5   # Kostenherleitung
```

Die Zahl der Tests ist hier absichtlich nicht angegeben, weil sie schneller
veraltet, als sie nachgetragen wird, und `npm test` sie ohnehin ausgibt.

`npm run build:check` baut die Weboberfläche nach `.next-build` statt nach
`.next`, weil ein Prüfbau sonst die Dateien ersetzen würde, die ein laufender
`npm run dev` gerade ausliefert, der daraufhin mit 500 antwortet.

Fehlt der Zugriff auf die Datenbank oder läuft die Weboberfläche nicht,
überspringt ein Lauf einzelne Prüfungen und weist dies in der Zusammenfassung
ausdrücklich aus („3 übersprungen"), damit ein Teillauf nicht wie ein
vollständiger erscheint. `HH_REQUIRE_DATA=1` macht aus dem entsprechenden
Überspringen in den Rust-Tests einen Fehler, was sich empfiehlt, wenn die
Datensätze gerade gebaut wurden.

Die API-Suiten unterliegen der Ratenbegrenzung, die sie selbst prüfen, sodass
diese nach einigen Durchläufen je Stunde greift. Auf dem Entwicklungsrechner
entfernt `HH_TEST_DB=hamburg_transit` vor jedem Lauf die adressbezogenen
Zähler, während die konto- und namensbezogenen Grenzen in Kraft bleiben, weil
die Tests gerade diese prüfen.

---

## Architektur

```
                          Browser
┌────────────────────────────────────────────────────────┐
│ Next.js · React · TypeScript                           │
│   Oberfläche, Panels, Social, Responsivität            │
│                                                        │
│   ┌──────────────────────┐   ┌──────────────────────┐  │
│   │ MapLibre · WebGL     │   │ Rust → WebAssembly   │  │
│   │ Karte, Kamera        │◄──┤ Netz, Geometrie,     │  │
│   │ Renderer             │   │ Kosten, Simulation   │  │
│   └──────────────────────┘   └──────────────────────┘  │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP
                           ▼
                  Rust · Axum · derselbe Rechenkern
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     PostgreSQL      Cache/Redis      Worker
     (+ PostGIS)                      (Jobs)
```

Die Oberfläche enthält keine Fachlogik, sondern übergibt Zeigerpositionen und
semantische Kommandos an den Rechenkern und erhält von ihm Diffs, Geometrie und
Ergebnisse zurück. Topologie, Geometrie, Kosten und Nutzen sind genau einmal
implementiert, nämlich in `rust/core`, und diese Implementierung läuft im
Browser, auf dem Server und in der Kommandozeile.

### Verzeichnisse

```
rust/core        Domänenmodell und alle Modelle
rust/wasm        WebAssembly-Bindungen für den Browser
rust/server      Axum-API, Postgres, Worker, Social
rust/cli         Import, Kalibrierung, Benchmarks
tools/importer   Datenpipeline (OpenStreetMap, Statistikämter)
data/curated     Handgepflegte Projektdefinitionen mit Quellenangaben
data/dist        Versionierte, erzeugte Datensätze
apps/web         Next.js-Anwendung
```

### Rechenkern

`rust/core` ist frei von Belangen der Weboberfläche, der Darstellung und der
Persistenz und gliedert sich in die folgenden Module.

| Modul | Aufgabe |
| --- | --- |
| `geo` | Koordinaten, lokale metrische Projektion, Schnitte, Vereinfachung |
| `model` | Netz als Graph: Knoten, Kanten, Linien, Bauzustand, Herkunft |
| `city` | Versionierter Stadtdatensatz: Bevölkerung, Arbeitsplätze, Wasser, Straßen |
| `snap` | Einrasten und Winkelzwang |
| `stations` | Automatische Stationsfindung und -benennung |
| `editor` | Semantische Kommandos mit exaktem Undo/Redo |
| `travel` | Reisezeiten über den Netzgraphen |
| `costs` | Abschnittsweise Kosten und die aufklappbare Rechnung |
| `construction` | Bauphasen und Eröffnungsjahr |
| `feasibility` | Baubarkeit mit begründeten Befunden |
| `demand` | Nachfrage und Erreichbarkeit |
| `economics` | Nutzen, Fiskaleffekt, Betrieb, Barwertrechnung |
| `simulation` | Orchestrierung, Vergleich, Ranglisten-Kennzahlen |
| `params` | Sämtliche Modellparameter als Daten, versioniert |

Im Code ist kein Wert fest verdrahtet, weil `params.rs` jede Kennzahl, jeden
Anteil und jede Dauer enthält und jedes Szenario die Parameter speichert, mit
denen es gerechnet wurde.

---

## Bedienung über die Tastatur

Die Anwendung lässt sich einschließlich des Zeichnens vollständig mit der
Tastatur bedienen. Als Zeiger dient dabei der Mittelpunkt der Karte, unter dem
die Pfeiltasten die Karte verschieben, während die Leertaste an dieser Stelle
einen Halt setzt, Enter die Linie beendet, die Rücktaste den letzten Punkt
zurücknimmt und Esc die Linie verwirft. Die Werkzeuge liegen auf V, D, E, S und
X, das Rückgängigmachen auf ⌘Z. Drei Sprungmarken am Anfang der Seite führen
unmittelbar zur Karte, zur Analyse und zur Linienliste, die sonst erst nach
sechzig Kontrollkästchen erreichbar wären.

---

## Städte

Die Anwendung unterstützt Hamburg und Berlin. Die Eigenschaften einer Stadt,
darunter Ausschnitt, Projektionsursprung, Herkunft der Einwohnerzahlen und
Linienfarben, stehen nicht im Code, sondern in `data/cities/<id>.json`, sodass
eine dritte Stadt eine weitere Datei und einen Importlauf erfordert, aber keinen
eigenen Zweig der Pipeline.

Die metrische Ebene, in der jede Berechnung läuft, gehört zum Datensatz, weil
sie eine lokale Näherung um einen einzigen Punkt ist, deren Ost-West-Abstände
in 240 km Entfernung um drei Prozent zu kurz wären. Der Server hält beide
Städte gleichzeitig vor und rechnet jedes Szenario in der Ebene der Stadt, zu
der es gehört.

| | Hamburg | Berlin |
| --- | ---: | ---: |
| Netz | 273 km, 164 Stationen | 719 km, 651 Stationen |
| Verkehrsmittel | U-Bahn, S-Bahn, AKN | U-Bahn, S-Bahn, Straßenbahn |
| Einwohner im Raster | 1 975 790 (Statistikamt Nord, 99 Stadtteile) | 3 913 644 (Amt für Statistik Berlin-Brandenburg, 97 Ortsteile, Stand 31.12.2025) |
| Arbeitsplätze im Raster | 1 370 200 (Erwerbstätige am Arbeitsort 2025) | 2 196 500 (Erwerbstätige am Arbeitsort 2025) |
| Fahrten im Jahr (Modell / veröffentlicht) | 572 Mio. / 571 Mio. | 1 244 Mio. / 1 249 Mio. |
| Kuratierte Vorhaben | U5, U4, S4, Straßenbahnstudie | Siemensbahn, U8, U3, Straßenbahn Ostkreuz |

Die Berliner Vorhaben sind mit Quellen erfasst, wobei Angaben wie Kosten oder
Eröffnungsjahr leer bleiben, solange sie nicht amtlich veröffentlicht sind.

---

## Daten

Die vollständige Herkunft der Daten beschreibt `docs/daten.md`, die folgende
Übersicht fasst sie zusammen.

| Datensatz | Quelle | Lizenz |
| --- | --- | --- |
| Netzgeometrie, Stationen, Gewässer, Grün, Straßen, Gebäude, Landmarken | OpenStreetMap über Overpass | ODbL 1.0 |
| Einwohner, Haushalte, Beschäftigte, Pkw je Stadtteil (Hamburg) | Statistikamt Nord, Regionalstatistische Daten der Stadtteile | dl-de/by-2-0 |
| Einwohner je Ortsteil (Berlin) | Amt für Statistik Berlin-Brandenburg, Einwohnerregisterstatistik zum 31.12.2025 (Statistischer Bericht A I 5 – hj 2/25) | CC BY 3.0 DE |
| Verteilung der Arbeitsplätze | eigene Modellierung aus Nichtwohn-Geschossfläche | — |
| Geplante Vorhaben | kuratiert aus Projektveröffentlichungen, verortet gegen die OSM-Daten desselben Stands | — |
| Orte und Einwohnerzahlen der Region bis Kiel, Lübeck, Rostock und Lüneburg | OpenStreetMap über Overpass | ODbL 1.0 |

Die Bevölkerungsverteilung entsteht, indem die Einwohnerzahlen der Stadt- und
Ortsteile innerhalb jedes Teils nach modellierter Wohn-Geschossfläche auf ein
200-m-Raster verteilt werden. Zugrunde liegen in Hamburg 99 Stadtteile und
197 577 Gebäude mit Geschosszahl, in Berlin 97 Ortsteile und 208 092 Gebäude,
jeweils ergänzt um die Flächennutzung. Die Rastersumme entspricht exakt der
Ausgangssumme, für Hamburg also den amtlichen 1 975 790 Einwohnern und für
Berlin den 3 913 644 Einwohnern der Einwohnerregisterstatistik, und die Herkunft
der Zahlen steht im Datensatz selbst, aus dem die Oberfläche sie anzeigt.

Damit sich auch Regionalverbindungen entwerfen lassen, reicht der Ausschnitt
über die Stadt hinaus, für Hamburg bis Lüneburg, Lauenburg, Kiel, Lübeck und
Rostock, für Berlin ins Brandenburger Umland. Da es dort keine vergleichbar
kleinräumige amtliche Statistik gibt, wird ein 1-km-Raster aus den
Einwohnerzahlen von 1 243 OSM-Ortsknoten (3 862 753 Einwohner) verwendet, aus
dem die Zellen innerhalb Hamburgs entfernt sind. Weil die Genauigkeit dort
entsprechend gröber ist, erhält eine Trasse, die nennenswert ins Umland reicht,
in der Baubarkeit einen Hinweis darauf, auf wie vielen Kilometern ihre Zahlen
auf dem groben Raster beruhen.

---

## Modellierung und ihre Grenzen

`docs/modell.md` beschreibt jedes Modell im Einzelnen. Zu den wichtigsten
Grenzen gehört, dass das Modell weder Baugrund noch Leitungslage,
Grundstücksverhältnisse oder politische Verfahren kennt. Die Nachfrage beruht
auf einem Einzugsbereichsmodell mit Reisezeiten aus dem Netzgraphen und nicht
auf einem Verkehrsmodell mit Quelle-Ziel-Matrix, und der Nutzen ist eine
Abschätzung in der Logik der Standardisierten Bewertung, ohne eine solche zu
sein. Kosten werden als Spanne ausgewiesen, weil ein bloßer Punktwert eine
Genauigkeit behaupten würde, die die Datenlage nicht trägt.

Jedes veröffentlichte Szenario speichert `calculationVersion` und
`dataVersion`, sodass alte Ergebnisse reproduzierbar bleiben, wenn sich das
Modell ändert, und eine Neuberechnung stets ein ausdrücklicher Schritt ist.

---

## Leistung

Die folgenden Werte stammen aus `npm run engine:bench` mit einem Release-Build.
Die Schnellschätzung antwortet, während gezeichnet wird, wohingegen die
vollständige Analyse entprellt ist und mehr Zeit beanspruchen darf.

| Vorgang | Hamburg | Berlin |
| --- | --- | --- |
| Netzumfang | 273 km, 164 Stationen | 719 km, 651 Stationen |
| Einrasten je Zeigerbewegung | 0,06 ms | 0,11 ms |
| Schnellschätzung, Bestand | 0,5 ms | 4,4 ms |
| Schnellschätzung, größtes Szenario | 4,9 ms (455 km) | 5,2 ms |
| Vollständige Analyse, Bestand | 9,0 ms | 64,8 ms |
| Szenario serialisieren / laden | 1,3 / 0,9 ms (271 kB) | 0,9 / 1,5 ms (565 kB) |

Die Datensätze beider Städte umfassen zusammen 16,3 MB, der Rechenkern 1,3 MB.

Nach jeder Modelländerung sollte `npm run engine:bench` erneut laufen, weil
eine Abfrage, die in der vollständigen Analyse nicht auffällt, die
Schnellschätzung um den Faktor zwanzig verlangsamen kann. Zeigerereignisse
laufen vollständig an React vorbei, da der Editor-Controller bei jeder Bewegung
lediglich zwei GeoJSON-Quellen schreibt und einen DOM-Knoten verschiebt.

---

## Betrieb

Der Dienst besteht aus drei getrennt laufenden Teilen, nämlich der Oberfläche,
die statisch ausgeliefert wird und nur für das Vorschaubild eine serverseitige
Route hat, der API mitsamt Hintergrundarbeiter und der Postgres-Datenbank. Das
`Dockerfile` im Wurzelverzeichnis baut die API einschließlich der Stadtdaten in
ein Abbild.

Mit `HH_ENV=production` prüft der Server beim Start seine Konfiguration und
startet nicht, wenn `HH_JWT_SECRET` nicht fest gesetzt ist oder
`HH_ALLOWED_ORIGIN` fehlt oder `*` lautet, damit eine fehlerhafte Konfiguration
nicht monatelang mit einer bloßen Warnung im Protokoll in Betrieb bleibt.

Bei der Wahl des Anbieters sind zwei Umstände entscheidend, die nicht
offensichtlich sind. Zum einen lädt ein Erstbesuch rund 12 MB Kartendaten,
weshalb ein Anbieter mit hartem Volumendeckel und ohne Nachzahlung die Seite
gerade dann abschalten würde, wenn sie zum ersten Mal breiter verlinkt wird.
Zum anderen würde der Hintergrundarbeiter eine Datenbank, die im Leerlauf
einschläft und nach Laufzeit abgerechnet wird, durch seine Abfragen nach Arbeit
ständig wach halten, weshalb `HH_WORKER_IDLE_SECS` den Abstand dieser Abfragen
im Leerlauf und `HH_DB_IDLE_SECS` die Zeit bis zum Schließen ungenutzter
Verbindungen einstellt.

Sämtliche Umgebungsvariablen, die Reihenfolge beim Ausrollen und die
anschließenden Prüfungen beschreibt [`docs/betrieb.md`](docs/betrieb.md).

---

## Rechtliches

Der Dienst wird in Deutschland betrieben und ist darauf eingerichtet, sodass
Impressum nach § 5 DDG, Datenschutzerklärung, Nutzungsbedingungen und der
Meldeweg nach dem DSA unter `/rechtliches` liegen und vom Fuß jeder Seite aus
erreichbar sind, während sich die Rechte auf Auskunft und Löschung unter
`/konto` unmittelbar ausüben lassen.

Ein Einwilligungsbanner ist nicht vorhanden, weil keine Einwilligung einzuholen
ist: Die Anwendung verwendet weder Analyse noch Tracking noch fremde
Schriftarten und lädt beim Aufruf nichts von dritter Seite nach. Im Browser
werden vier Werte gespeichert, die für die gewünschte Funktion erforderlich sind
(§ 25 Abs. 2 Nr. 2 TDDDG).

Der Stand, die offenen Punkte und die Fragen, die eine anwaltliche Prüfung
klären sollte, sind in [`docs/recht.md`](docs/recht.md) festgehalten.

---

## Lizenz und Namensnennung

Der Code steht unter der MIT-Lizenz ([`LICENSE`](LICENSE)), die für die
Datensätze unter `data/` jedoch nicht gilt, weil diese aus fremden Datenbanken
abgeleitet sind, deren Lizenzen fortgelten.

Die Daten aus OpenStreetMap unterliegen der ODbL 1.0 mit ihrer
Share-alike-Bedingung. Da die Dateien in `data/dist/` im Sinne dieser Lizenz
abgeleitete Datenbanken und nicht bloß daraus erzeugte Werke sind, werden sie
ihrerseits unter der ODbL angeboten, und die Namensnennung auf der Karte deckt
lediglich die Darstellung ab, nicht aber das JSON, das der Browser lädt. Die
Hamburger Statistik des Statistikamts Nord unterliegt der Datenlizenz
Deutschland – Namensnennung 2.0 (dl-de/by-2-0), die Berliner Statistik des Amts
für Statistik Berlin-Brandenburg der Lizenz CC BY 3.0 DE.

Die Einzelheiten und den genauen Umfang regelt [`LICENSE-DATA`](LICENSE-DATA).
