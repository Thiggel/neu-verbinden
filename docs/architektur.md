# Architektur

## Schichten

```
Oberfläche  ≠  Rechenkern  ≠  Renderer  ≠  Persistenz
```

Die Anwendung besteht aus vier Schichten, die voneinander getrennt bleiben.
Die Oberfläche in `apps/web` ist eine Next.js-Anwendung, die Panels,
Formulare, die gemeinschaftlichen Funktionen und die Anpassung an
verschiedene Bildschirmgrößen umfasst, aber keine Fachlogik enthält. Das
gesamte Domänenwissen liegt in `rust/core`, das keine Abhängigkeit zu Web,
Darstellung oder Datenbank hat. MapLibre übernimmt Projektion, Kamera und
WebGL und erhält dafür fertige Geometrie, während `rust/server` für die
Speicherung, die gemeinschaftlichen Funktionen und die maßgebliche
Neuberechnung zuständig ist.

Der Rechenkern wird zweimal übersetzt, nämlich nach WebAssembly für den
Browser und nativ für Server und Kommandozeile. Da Kosten, Topologie und
Nutzen auf diese Weise nur an einer Stelle berechnet werden, stimmt der Wert,
den der Browser anzeigt, mit dem überein, den der Server speichert.

## Verarbeitung eines Zeigerereignisses

```
pointermove
   └─ requestAnimationFrame (Ereignisse werden zusammengefasst)
        └─ engine.snapPoint()          Rust/WASM, 0,03 ms
             ├─ zwei GeoJSON-Quellen aktualisieren
             └─ einen DOM-Knoten verschieben (Fangzeiger)
```

Eine Zeigerbewegung löst weder `setState` noch ein Rendern in React oder eine
Neuberechnung des Netzes aus, weil React erst dann davon erfährt, wenn ein
Kommando bestätigt wird.

## Verarbeitung einer Änderung

```
Nutzeraktion
   └─ Kommando            { type: "drawLine", mode: "ubahn", points: [...] }
        └─ Editor         wendet an, erzeugt Diff und Umkehr-Patch
             ├─ Diff      → Renderer aktualisiert nur das Geänderte
             ├─ quick()   → Live-Anzeige, 1,9 ms
             └─ simulate()→ Analysepanel, entprellt, 21 ms
```

Das Rückgängigmachen speichert keine Zeigerspuren, sondern den Umkehr-Patch
der Primitivoperationen, sodass der vorherige Zustand bitgenau
wiederhergestellt wird, was
`editor::tests::undo_restores_the_previous_state_exactly` prüft.

## Netzgraph

Ein Netz ist als Graph und nicht als Sammlung von Linienzügen angelegt:

```
Netz
├── Knoten   Station · Verzweigung · Stützpunkt
├── Kanten   Geometrie (geografisch + schematisch), Verkehrsmittel,
│            Bauweise, Bauzustand, Herkunft, Gleiszahl, Entwurfsgeschwindigkeit
└── Linien   geordneter Pfad über Kanten
```

Da mehrere Linien **dieselbe** Kante nutzen können, ergeben sich gemeinsame
Gleise, Verzweigungen, Umsteigepunkte und die richtige Zusammenfassung der
Kosten aus der Struktur selbst, statt als Sonderfälle behandelt werden zu
müssen.

Herkunft (`Existing`, `Planned`, `Proposal`, `User`) und Bauzustand
(`InService`, `UnderConstruction`, `ToBuild`) sind voneinander getrennte
Eigenschaften. Wer eine Linie ein- oder ausschaltet, nimmt sie samt ihren
Kosten in das Szenario auf oder entfernt sie daraus, weshalb die Ebenenliste
das eigentliche Werkzeug zum Zusammenstellen von Szenarien ist.

## Grundkarte

Der Kartenstil wird vollständig aus dem eigenen, versionierten Datensatz mit
Wasser, Grünflächen, Hauptstraßen und Stadtteilgrenzen gebaut, sodass weder
Kachelserver noch Schriftkacheln noch andere externe Anfragen nötig sind.

Diese Entscheidung ist gestalterisch begründet, weil eine gewöhnliche
Straßenkarte optisch mit dem Netz konkurrieren würde, während hier das Netz
das einzige Element mit Farbe und Gewicht ist. Als Nebenwirkung kann die
Anwendung vollständig offline laufen.

Beschriftungen werden als HTML über dem Canvas dargestellt und nicht als
Symbolebenen von MapLibre, was Web-Typografie, eine eigene Kollisionsregel
nach Wichtigkeit und den Verzicht auf Schriftkacheln ermöglicht.

## Quellen und Ebenen im Stil

Sämtliche Quellen und Ebenen, auch die für Vorschau, Hervorhebung und
Animation, sind Teil des anfänglichen MapLibre-Stils. Nachträglich
hinzugefügte Ebenen setzen voraus, dass der Stil vollständig geladen ist,
während eine GeoJSON-Quelle ohne Objekte sich bei MapLibre **nie** als geladen
meldet. Zusammen führen beide Eigenschaften dazu, dass das Netz unsichtbar
bleibt, solange die Grundkarte lädt, und in einem gedrosselten Tab dauerhaft.
Die Overlay-Quellen enthalten deshalb je ein unsichtbares Platzhalterobjekt,
das die Ebenen herausfiltern.

## Kartenebenen

Die Zahl der Ebenen ist mit Rücksicht auf mobile Grafikprozessoren klein
gehalten:

```
Untergrund → Grün → Wasser → Wasserläufe → Bahn → Straßen → Stadtteile
  → Netz (Kontur) → Netz (gebaut) → Netz (geplant, gestrichelt)
  → Hervorhebung → Vorschau → Stationen → Umsteigepunkte → Vorschaustationen
```

Gebaute und geplante Strecken benötigen zwei Ebenen, weil `line-dasharray` in
MapLibre keinen datengetriebenen Ausdruck annimmt.

## Server

Der Server beruht auf Axum und sqlx. Die Netzdefinition liegt als JSONB vor,
die Kennzahlen dagegen als Spalten, damit die Entdecken-Seite und die
Ranglisten über Indizes statt über die Auswertung von JSON abgefragt werden.

Beim Veröffentlichen liest der Server das Dokument mit demselben Rechenkern
ein, prüft seine Struktur und **rechnet die Kennzahlen neu**, wobei die vom
Client mitgeschickten Werte unberücksichtigt bleiben, was
`tools/test-api.mjs` prüft.

PostGIS ist optional, da die Migration `0002` Geometriespalte und GiST-Index
nur anlegt, wenn die Erweiterung vorhanden ist, und andernfalls einen Hinweis
ausgibt, sodass die Anwendung auch auf einem einfachen PostgreSQL läuft.

Auch Redis ist optional, weil der Cache nur abgeleitete Werte enthält, deren
Verlust lediglich eine Neuberechnung kostet, während PostgreSQL die
maßgebliche Quelle bleibt.

Hintergrundarbeit läuft über eine Job-Tabelle mit `FOR UPDATE SKIP LOCKED`,
sodass mehrere Prozesse nebeneinander arbeiten können.

## Offene Erweiterungen

Für eine Zusammenarbeit in Echtzeit ist die Kommandostruktur bereits geeignet,
weil ein Kommando klein und serialisierbar ist und sich auf dem Server
nachvollziehen lässt; es fehlen jedoch der Transport und die Auflösung von
Konflikten.

Für ein Fahrgastmodell mit Quelle-Ziel-Matrix liegen der Netzgraph und die
Reisezeitrechnung vor, während die erforderlichen Daten fehlen.

Weitere Städte lassen sich ergänzen, wie die Aufnahme Berlins gezeigt hat,
wobei die Annahme, ein zweiter Datensatz genüge, sich als unzutreffend erwies.
Der Rechenkern kannte zwar nur `CityData`, in seiner Umgebung fanden sich aber
Annahmen über Hamburg, die sich nicht von selbst bemerkbar machten: Die
metrische Projektion war als Konstante hinterlegt, der Importer las für jede
Stadt die Dateien Hamburgs, die Szenariovorlagen waren fest einprogrammiert,
sodass auch Berlin die „U5 im Vollausbau“ angeboten bekam, eine Ergebniszeile
hieß „Fiskaleffekt Hamburg“, und der Umsatzsteuerschlüssel ebenso wie der
Baugrundfaktor beschreiben die Stadt und nicht die Eisenbahn. Eine dritte
Stadt erfordert inzwischen nur noch einen Datensatz und eine
Konfigurationsdatei, doch empfiehlt es sich, beim Anlegen nach allem zu suchen,
was entstanden ist, als es nur eine Stadt gab.
