# Verkehrsnetz-Designer

Zeichne das Nahverkehrsnetz, das du dir wünschst — für **Hamburg oder Berlin** —
und erfahre, was es vermutlich kosten, wie lange es dauern und was es bringen
würde.

> **Alle Zahlen dieser Anwendung sind Modellschätzungen.** Sie ersetzen keine
> Standardisierte Bewertung, keine Kostenberechnung und keine Planung.

Die Oberfläche ist deutsch, der Code und diese Dokumentation sind englisch
kommentiert.

---

## Was es kann

* Zwei echte Netze, importiert aus OpenStreetMap und im Editor umschaltbar:
  **Hamburg** (U-Bahn, S-Bahn, AKN — 14 Linien, 276 km) und **Berlin**
  (U-Bahn, S-Bahn, Straßenbahn — 73 Linien, 742 km). Jede Linie einzeln ein-
  und ausschaltbar.
* Die offiziell geplanten Vorhaben als eigene, umschaltbare Ebenen — für
  Hamburg die U5 in fünf Baustufen, U4 Horner Geest, U4 Grasbrook und die S4,
  dazu das im August 2026 vorgestellte Straßenbahnkonzept; für Berlin die
  Siemensbahn, die U8 ins Märkische Viertel und die Straßenbahn zum Ostkreuz.
* Zeichnen statt GIS: jeder Klick setzt eine Station, dazwischen ergänzt die
  App weitere; Kurven werden ausgerundet, Winkel rasten nur ein, wenn sie schon
  nahe an einer Vorzugsrichtung liegen, und ein Anschluss an eine bestehende
  Linie wird beim Zeigen deutlich markiert.
* Während des Zeichnens laufen Länge, Stationen, Kosten, Eröffnungsjahr und
  erreichte Einwohner live mit.
* Sofortige Schätzung von Baukosten, Bauzeit, Eröffnungsjahr, Baubarkeit,
  Fahrgastnachfrage, volkswirtschaftlichem Nutzen, Fiskaleffekt für den
  Haushalt der jeweiligen Stadt und Betriebsergebnis — mit ausklappbarer Kostenaufstellung bis zum einzelnen
  Abschnitt.
* Speichern als Datei, Veröffentlichen, Forken, Abstimmen, Kommentieren,
  Vergleichen und Ranglisten.
* Eine **Wunschkarte** je Stadt: alle veröffentlichten Entwürfe
  übereinandergelegt, als Hitzekarte dessen, was gebaut werden müsste. Sie
  zeigt, wo unabhängig voneinander dieselbe Lücke gezeichnet wird — eine
  Aussage, die kein einzelner Entwurf macht. Das bestehende Netz zählt nicht
  mit, Stimmen und Forks nur logarithmisch.

### Was das Modell reproduziert

`npm run engine:calibrate` prüft die Kennwerte gegen veröffentlichte
Hamburger Projektangaben:

| Referenz | Modell | veröffentlicht | Abweichung |
| --- | ---: | ---: | ---: |
| U5 City Nord – Jarrestraße | 1,48 Mrd. € | 1,50 Mrd. € | −1 % |
| S4 Ost | 1,78 Mrd. € | 2,10 Mrd. € | −15 % |
| U5 Ost (Bramfeld – City Nord) | 2,08 Mrd. € | 2,60 Mrd. € | −20 % |
| U4 Horner Geest | 929 Mio. € | 620 Mio. € | +50 % |
| Einsteiger je Werktag, Bestandsnetz | 1,35 Mio. | 1,3–1,5 Mio. | im Rahmen |

Alle Projektreferenzen liegen innerhalb der ausgewiesenen Unsicherheitsspanne
von ±20 bis ±32 %. `hh audit <projekt>` zeigt die Herleitung Position für
Position, damit sich die Rechnung von Hand nachprüfen lässt.

---

## Schnellstart

Voraussetzungen: **Node ≥ 20** und **Rust ≥ 1.80**. PostgreSQL ≥ 14 nur, wenn
veröffentlicht werden soll.

Die fertigen Datensätze für Hamburg und Berlin liegen unter `data/dist/` im
Repository. Nach dem Klonen muss also nichts aus dem Netz geholt werden; es
fehlt nur der Rechenkern, den der Browser braucht, weil er kompiliert wird und
deshalb nicht mitliegt.

```bash
git clone git@github.com:Thiggel/neu-verbinden.git
cd neu-verbinden
npm install

rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127

npm run wasm:build     # Rechenkern nach WebAssembly übersetzen
npm run data:publish   # Datensätze aus data/dist in die Web-App kopieren
npm run dev            # http://localhost:3000
```

Das genügt für den Editor: Zeichnen, Rechnen, Speichern und Öffnen laufen
vollständig im Browser, ohne Server und ohne Konto.

### Mit Server

Für Veröffentlichen, Abstimmen, Kommentieren und Vergleichen:

```bash
createdb hamburg_transit
cp .env.example .env      # und HH_JWT_SECRET ersetzen
npm run server            # http://localhost:8080, legt seine Tabellen selbst an
```

Die Weboberfläche spricht die API unter `http://localhost:8080` an; eine andere
Adresse über `NEXT_PUBLIC_API_URL` beim Bauen setzen.

### Die Beispiele auf der Entdecken-Seite

```bash
HH_SEED_PASSWORD=… npm run examples:seed
```

Veröffentlicht die vier Beispielentwürfe unter einem eigenen Konto und ersetzt
dabei, was dasselbe Konto vorher veröffentlicht hat. Jeder enthält genau die
eigenen Linien und das bestehende Netz, sonst nichts: ein Entwurf, der fremde
Vorhaben mitführt, weist deren Kilometer und Kosten als seine eigenen aus.

### Die Daten neu bauen

Nur nötig, wenn die Datensätze aktualisiert werden sollen. Der Bezug dauert
lange und belastet fremde Server, deshalb ist er nicht Teil des Schnellstarts.

```bash
npm run data:fetch     # OpenStreetMap über Overpass, Statistik, Geodaten
npm run data:build     # normalisieren, geocodieren, Domänennetz erzeugen
npm run data:publish

# Berlin:
npm run data:fetch:berlin
npm run data:build:berlin
npm run data:publish
```

### Tests

`test:browser` fährt einen echten Browser. Einmalig:

```bash
npx playwright install chromium
```

```bash
# Alle Suiten auf einmal:
npm test

# Einzeln:
npm run engine:test    # Unit-Tests des Rechenkerns und der API (Rust)
npm run test:ui        # reine Oberflächenlogik, ohne Browser
npm run test:engine    # der gebaute Rechenkern gegen die echten Stadtdaten
npm run test:flow      # eine vollständige Nutzergeschichte, Schritt für Schritt
npm run test:api       # Integrationstests gegen die laufende API
npm run test:browser   # die Oberfläche selbst, angeklickt (Playwright)
npm run test:security  # Angriffsversuche gegen die laufende API

npm run engine:bench     # Laufzeiten — nach jeder Modelländerung laufen lassen
npm run engine:calibrate # Abgleich mit veröffentlichten Projektangaben
cd rust && cargo run --release -p hh-cli --bin hh -- audit u5   # Kostenherleitung
```

Die Zahl der Tests steht bewusst nicht hier: sie veraltet schneller, als sie
jemand nachträgt. `npm test` sagt sie.

`npm run build:check` baut die Weboberfläche nach `.next-build` statt nach
`.next` — ein Prüfbau ersetzt sonst die Dateien, die ein laufender
`npm run dev` gerade ausliefert, und der antwortet danach mit 500.

Ein Lauf ohne Datenbankzugriff oder ohne laufende Weboberfläche überspringt
einzelne Prüfungen. Das ist in Ordnung — die Zusammenfassung sagt es dann
ausdrücklich („3 übersprungen"), damit ein Teillauf nicht wie ein vollständiger
aussieht. `HH_REQUIRE_DATA=1` macht aus dem entsprechenden Überspringen der
Rust-Tests einen Fehler; das sollte setzen, wer die Datensätze gerade gebaut hat.

Die API-Suiten laufen gegen die Ratenbegrenzung, die sie selbst prüfen — nach
ein paar Durchläufen je Stunde greift sie. Auf dem Entwicklungsrechner räumt
`HH_TEST_DB=hamburg_transit` die *adressbezogenen* Zähler vor jedem Lauf weg;
die konto- und namensbezogenen Grenzen bleiben in Kraft, weil die Tests genau
die prüfen.

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

Die wichtigste Trennung: **die Oberfläche kennt keine Fachlogik.** Sie schickt
Zeigerpositionen und semantische Kommandos hinein und bekommt Diffs, Geometrie
und Ergebnisse heraus. Es gibt genau eine Implementierung von Topologie,
Geometrie, Kosten und Nutzen — in `rust/core` —, und die läuft im Browser, auf
dem Server und in der Kommandozeile.

### Verzeichnisse

```
rust/core        Domänenmodell und alle Modelle (95 Unit-Tests)
rust/wasm        WebAssembly-Bindungen für den Browser
rust/server      Axum-API, Postgres, Worker, Social
rust/cli         Import, Kalibrierung, Benchmarks
tools/importer   Datenpipeline (OpenStreetMap, Statistikamt Nord)
data/curated     Handgepflegte Projektdefinitionen mit Quellenangaben
data/dist        Versionierte, erzeugte Datensätze
apps/web         Next.js-Anwendung
```

### Der Rechenkern

`rust/core` ist frei von Web-, Render- und Persistenzbelangen:

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

Kein Wert ist im Code fest verdrahtet: `params.rs` enthält jede Kennzahl, jeden
Anteil und jede Dauer, und ein Szenario speichert die Parameter, mit denen es
gerechnet wurde.

---

## Ohne Maus

Die Anwendung lässt sich vollständig mit der Tastatur bedienen, das Zeichnen
eingeschlossen. Der Mittelpunkt der Karte ist dabei der Zeiger: die Pfeiltasten
schieben den Boden darunter durch, **Leertaste** setzt an dieser Stelle einen
Halt, **Enter** beendet die Linie, **Rücktaste** nimmt den letzten Punkt
zurück, **Esc** verwirft. Werkzeuge liegen auf V, D, E, S und X, Rückgängig auf
⌘Z. Drei Sprungmarken am Anfang der Seite führen direkt zur Karte, zur Analyse
und zur Linienliste — sonst lägen sechzig Häkchen dazwischen.

---

## Zwei Städte

Die Anwendung kennt Hamburg und Berlin. Was eine Stadt ausmacht, steht in
`data/cities/<id>.json` — Ausschnitt, Projektionsursprung, Herkunft der
Einwohnerzahlen, Linienfarben — und nicht im Code; eine dritte Stadt ist damit
eine Datei und ein Importlauf, kein zweiter Zweig der Pipeline.

Die metrische Ebene, in der jede Berechnung läuft, gehört zum Datensatz: sie
ist eine lokale Näherung um *einen* Punkt, und 240 km davon entfernt wären die
Ost-West-Abstände drei Prozent zu kurz. Der Server hält beide Städte
gleichzeitig und rechnet jedes Szenario in der Ebene seiner eigenen Stadt.

| | Hamburg | Berlin |
| --- | ---: | ---: |
| Netz | 276 km, 164 Stationen | 737 km, 647 Stationen |
| Verkehrsmittel | U-Bahn, S-Bahn, AKN | U-Bahn, S-Bahn, Straßenbahn |
| Einwohner im Raster | 1 975 790 (amtlich, Stadtteile) | 3 678 322 (Ortsteile, Wikidata/Amt für Statistik) |
| Einsteiger je Werktag (Modell) | 1,39 Mio. | 2,89 Mio. |
| Kuratierte Vorhaben | U5, U4, S4, Straßenbahnkonzept | noch keine |

Berlin hat noch keine kuratierten Vorhaben: die Zahlen zu U-Bahn-Verlängerungen
und i2030 sind öffentlich, aber ihre Erfassung mit Quelle und Preisstand steht
noch aus. Bis dahin startet Berlin im Bestand.

---

## Daten

Siehe `docs/daten.md` für die vollständige Herkunft. Kurz:

| Datensatz | Quelle | Lizenz |
| --- | --- | --- |
| Netzgeometrie, Stationen, Gewässer, Grün, Straßen, Gebäude, Landmarken | OpenStreetMap über Overpass | ODbL 1.0 |
| Einwohner, Haushalte, Beschäftigte, Pkw je Stadtteil (Hamburg) | Statistikamt Nord, Regionalstatistische Daten der Stadtteile | dl-de/by-2-0 |
| Einwohner je Ortsteil (Berlin) | `population`-Tags der OSM-Ortsteilrelationen — **nicht amtlich**, und die Anwendung nennt sie auch nicht so | ODbL 1.0 |
| Verteilung der Arbeitsplätze | eigene Modellierung aus Nichtwohn-Geschossfläche | — |
| Geplante Vorhaben | kuratiert aus Projektveröffentlichungen, verortet gegen die OSM-Daten desselben Stands | — |
| Orte und Einwohnerzahlen der Region bis Kiel, Lübeck, Rostock und Lüneburg | OpenStreetMap über Overpass | ODbL 1.0 |

Die Bevölkerungsverteilung ist das analytisch interessanteste Stück: die
Einwohnerzahlen der Stadt- beziehungsweise Ortsteile werden innerhalb jedes
Teils nach modellierter Wohn-Geschossfläche auf ein 200-m-Raster verteilt
(Hamburg 99 Stadtteile und 195 041 Gebäude mit Geschosszahl, Berlin 98
Ortsteile und 207 331 Gebäude, jeweils ergänzt um Flächennutzung). Die
Rastersumme entspricht exakt der Ausgangssumme — für Hamburg den amtlichen
1 975 790 Einwohnern. Woher die Zahlen einer Stadt stammen, steht im
Datensatz selbst und wird in der Oberfläche genannt; für Berlin sind es
OSM-Angaben, nicht das Amt für Statistik.

Über die Stadt hinaus reicht der Ausschnitt in die Region — für Hamburg bis
Lüneburg, Lauenburg, Kiel, Lübeck und Rostock, für Berlin ins Brandenburger
Umland —, damit sich auch Regionalverbindungen entwerfen lassen.
Dort gibt es keine vergleichbare amtliche Kleinräumigkeit; verwendet wird ein
1-km-Raster aus den Einwohnerzahlen von 1 243 OSM-Ortsknoten
(3 863 336 Einwohner), aus dem Zellen innerhalb Hamburgs entfernt sind. Die
Genauigkeit ist entsprechend gröber, und die Anwendung sagt das: eine Trasse,
die nennenswert ins Umland reicht, bekommt in der Baubarkeit den Hinweis, auf
wie vielen Kilometern die Zahlen auf dem groben Raster beruhen.

---

## Modellierung und ihre Grenzen

`docs/modell.md` beschreibt jedes Modell im Detail. Die wichtigsten Grenzen:

* Das Modell kennt **keinen Baugrund**, keine Leitungslage, keine
  Grundstücksverhältnisse und keine politischen Verfahren.
* Die Nachfrage ist ein Einzugsbereichsmodell mit Reisezeiten aus dem
  Netzgraphen, kein Verkehrsmodell mit Quelle-Ziel-Matrix.
* Der Nutzen ist eine Abschätzung in der Logik der Standardisierten Bewertung,
  aber keine solche.
* Kosten werden als Spanne ausgewiesen. Ein Punktwert ohne Spanne wäre eine
  Behauptung, die die Datenlage nicht trägt.

Jedes veröffentlichte Szenario speichert `calculationVersion` und
`dataVersion`. Verbessert sich das Modell, bleiben alte Ergebnisse
reproduzierbar; die Neuberechnung ist ein ausdrücklicher Schritt.

---

## Leistung

`npm run engine:bench`, Release-Build. Die Schnellschätzung antwortet, während
jemand zeichnet; die vollständige Analyse ist entprellt und darf sich Zeit
lassen.

| Vorgang | Hamburg | Berlin |
| --- | --- | --- |
| Netzumfang | 276 km, 164 Stationen | 742 km, 658 Stationen |
| Einrasten je Zeigerbewegung | 0,10 ms | 0,11 ms |
| Schnellschätzung, Bestand | 0,5 ms | 5,2 ms |
| Schnellschätzung, größtes Szenario | 18,8 ms (410 km) | 5,8 ms |
| Vollständige Analyse, Bestand | 9,0 ms | 70,9 ms |
| Szenario serialisieren / laden | 0,7 / 1,0 ms (348 kB) | 1,1 / 1,6 ms (577 kB) |

Die Datensätze beider Städte wiegen zusammen 16,3 MB, der Rechenkern 1,3 MB.

Nach jeder Modelländerung `npm run engine:bench` laufen lassen: eine
Abfrage, die in der vollständigen Analyse nicht auffällt, kann in der
Schnellschätzung um den Faktor zwanzig durchschlagen.

Reproduzierbar mit `npm run engine:bench`.

Zeigerereignisse laufen vollständig an React vorbei: der Editor-Controller
schreibt zwei GeoJSON-Quellen und bewegt einen DOM-Knoten, mehr nicht.

---

## Betrieb

Drei Teile, die getrennt laufen: die Oberfläche (statisch, plus eine
serverseitige Route für das Vorschaubild), die API mitsamt Hintergrundarbeiter,
und Postgres. Das `Dockerfile` im Wurzelverzeichnis baut die API mit den
Stadtdaten im Abbild.

`HH_ENV=production` schaltet eine Startprüfung scharf: ohne festes
`HH_JWT_SECRET`, ohne `HH_ALLOWED_ORIGIN` oder mit `*` startet der Server gar
nicht erst, statt mit einer Warnung im Protokoll monatelang falsch zu laufen.

Zwei Dinge entscheiden über die Wahl des Anbieters, und beide sind nicht
offensichtlich:

* **Datenverkehr.** Ein Erstbesuch lädt rund 12 MB Kartendaten. Ein Anbieter mit
  hartem Deckel und ohne Nachzahlung stellt die Seite genau dann ab, wenn sie
  zum ersten Mal irgendwo verlinkt wird.
* **Eine Datenbank, die im Leerlauf einschläft.** Der Hintergrundarbeiter fragt
  nach Arbeit und hält sie damit wach. `HH_WORKER_IDLE_SECS` und
  `HH_DB_IDLE_SECS` stellen ein, wie geduldig er ist.

Alle Umgebungsvariablen, die Reihenfolge beim Ausrollen und was danach zu prüfen
ist: **[`docs/betrieb.md`](docs/betrieb.md)**.

---

## Rechtliches

Der Dienst ist in Deutschland betrieben und dafür vorbereitet: Impressum nach
§ 5 DDG, Datenschutzerklärung, Nutzungsbedingungen und Meldeweg nach dem DSA
liegen unter `/rechtliches` und sind aus dem Fuß jeder Seite erreichbar. Die
Rechte auf Auskunft und Löschung sind unter `/konto` eingebaut und nicht bloß
zugesagt.

Ein Einwilligungsbanner gibt es nicht, weil es nichts einzuwilligen gibt: keine
Analyse, kein Tracking, keine fremden Schriftarten, nichts, was beim Aufruf von
dritter Seite nachgeladen wird. Im Browser liegen vier Werte, die für die
gewünschte Funktion nötig sind (§ 25 Abs. 2 Nr. 2 TDDDG).

Stand, offene Punkte und was ein Anwalt ansehen sollte:
**[`docs/recht.md`](docs/recht.md)**.

---

## Lizenz und Namensnennung

**Code: MIT** ([`LICENSE`](LICENSE)).

**Daten: nicht MIT.** Die Datensätze unter `data/` sind aus fremden Datenbanken
abgeleitet, und deren Lizenzen gelten weiter:

* OpenStreetMap, **ODbL 1.0**, mit Share-alike. Die Dateien in `data/dist/` sind
  abgeleitete Datenbanken im Sinne der Lizenz, nicht bloß daraus erzeugte Werke;
  sie werden deshalb ihrerseits unter der ODbL angeboten. Die Namensnennung auf
  der Karte deckt die *Darstellung* ab, nicht das JSON, das der Browser lädt.
* Statistikamt Nord, Amt für Statistik Berlin-Brandenburg und die
  Statistischen Ämter des Bundes und der Länder, **dl-de/by-2-0**.

Einzelheiten und der genaue Umfang: [`LICENSE-DATA`](LICENSE-DATA).
