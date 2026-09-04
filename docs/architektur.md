# Architektur

## Die eine wichtige Trennung

```
Oberfläche  ≠  Rechenkern  ≠  Renderer  ≠  Persistenz
```

* **`apps/web`** — Next.js. Panels, Formulare, Social, Responsivität. Kennt
  keine Fachlogik.
* **`rust/core`** — das gesamte Domänenwissen. Frei von Web-, Render- und
  Datenbankbelangen.
* **MapLibre** — Projektion, Kamera, WebGL. Bekommt fertige Geometrie.
* **`rust/server`** — Speicherung, Social, autoritative Neuberechnung.

Der Rechenkern wird zweimal übersetzt: nach WebAssembly für den Browser und
nativ für Server und Kommandozeile. Deshalb gibt es Kosten, Topologie und
Nutzen genau einmal — und der Wert, den der Browser zeigt, ist derselbe, den
der Server speichert.

## Der Weg eines Zeigerereignisses

```
pointermove
   └─ requestAnimationFrame (Ereignisse werden zusammengefasst)
        └─ engine.snapPoint()          Rust/WASM, 0,03 ms
             ├─ zwei GeoJSON-Quellen aktualisieren
             └─ einen DOM-Knoten verschieben (Fangzeiger)
```

Kein `setState`, kein React-Rendern, keine Neuberechnung des Netzes. React
erfährt erst beim Bestätigen eines Kommandos davon.

## Der Weg einer Änderung

```
Nutzeraktion
   └─ Kommando            { type: "drawLine", mode: "ubahn", points: [...] }
        └─ Editor         wendet an, erzeugt Diff und Umkehr-Patch
             ├─ Diff      → Renderer aktualisiert nur das Geänderte
             ├─ quick()   → Live-Anzeige, 1,9 ms
             └─ simulate()→ Analysepanel, entprellt, 21 ms
```

Undo speichert keine Zeigerspuren, sondern den exakten Umkehr-Patch der
Primitivoperationen. Ein Undo stellt den vorherigen Zustand bitgenau her —
`editor::tests::undo_restores_the_previous_state_exactly` prüft das.

## Der Netzgraph

Ein Netz ist ein Graph, keine Sammlung von Linienzügen:

```
Netz
├── Knoten   Station · Verzweigung · Stützpunkt
├── Kanten   Geometrie (geografisch + schematisch), Verkehrsmittel,
│            Bauweise, Bauzustand, Herkunft, Gleiszahl, Entwurfsgeschwindigkeit
└── Linien   geordneter Pfad über Kanten
```

Mehrere Linien können **dieselbe** Kante nutzen. Daraus ergeben sich
gemeinsame Gleise, Verzweigungen, Umsteigepunkte und die korrekte
Kostenaggregation von selbst, statt als Sonderfälle.

Herkunft (`Existing`, `Planned`, `Proposal`, `User`) und Bauzustand
(`InService`, `UnderConstruction`, `ToBuild`) sind getrennte Eigenschaften.
Eine Linie ein- oder auszuschalten heißt, sie in das Szenario aufzunehmen —
und damit auch ihre Kosten. Genau das macht die Ebenenliste zum eigentlichen
Szenario-Werkzeug.

## Warum die Karte keine Kacheln lädt

Der Kartenstil wird vollständig aus dem eigenen versionierten Datensatz
gebaut: Wasser, Grün, Hauptstraßen, Stadtteilgrenzen. Keine Kachelserver,
keine Schriftkacheln, keine externen Anfragen.

Das ist keine Sparmaßnahme, sondern eine Gestaltungsentscheidung. Eine
gewöhnliche Straßenkarte würde optisch mit dem Netz konkurrieren; hier ist das
Netz das einzige Element mit Farbe und Gewicht. Nebenbei kann die Anwendung
dadurch vollständig offline laufen.

Beschriftungen sind HTML über dem Canvas, nicht MapLibre-Symbolebenen: echte
Web-Typografie, eine selbst kontrollierte Kollisionsregel nach Wichtigkeit,
und keine Schriftkacheln.

## Warum alles im Stil steht

Sämtliche Quellen und Ebenen — auch die für Vorschau, Hervorhebung und
Animation — sind Teil des initialen MapLibre-Stils. Nachträglich hinzugefügte
Ebenen setzen voraus, dass der Stil fertig geladen ist, und eine GeoJSON-Quelle
ohne Objekte meldet sich bei MapLibre **nie** als geladen. Beides zusammen
führt dazu, dass das Netz unsichtbar bleibt, solange die Grundkarte kachelt —
und in einem gedrosselten Tab dauerhaft. Die Overlay-Quellen enthalten deshalb
je ein unsichtbares Platzhalter-Objekt, das die Ebenen wegfiltern.

## Kartenebenen

Bewusst wenige, wegen mobiler GPUs:

```
Untergrund → Grün → Wasser → Wasserläufe → Bahn → Straßen → Stadtteile
  → Netz (Kontur) → Netz (gebaut) → Netz (geplant, gestrichelt)
  → Hervorhebung → Vorschau → Stationen → Umsteigepunkte → Vorschaustationen
```

Gebaute und geplante Strecken brauchen zwei Ebenen, weil `line-dasharray` in
MapLibre keinen datengetriebenen Ausdruck akzeptiert.

## Server

Axum mit sqlx. Die Netzdefinition liegt als JSONB, die Kennzahlen als Spalten —
Entdecken und Ranglisten laufen über Indizes, nicht über JSON-Auswertung.

Beim Veröffentlichen parst der Server das Dokument mit demselben Rechenkern,
validiert die Struktur und **rechnet neu**. Behauptete Kennzahlen des Clients
werden ignoriert; `tools/test-api.mjs` prüft das.

PostGIS ist optional: Migration `0002` legt Geometriespalte und GiST-Index nur
an, wenn die Erweiterung vorhanden ist, und meldet sonst einen Hinweis. Die
Anwendung läuft auf einem einfachen PostgreSQL genauso.

Redis ist ebenfalls optional. Der Cache hält nur abgeleitete Werte; geht er
verloren, kostet das eine Neuberechnung. Autoritativ ist PostgreSQL.

Hintergrundarbeit läuft über eine Job-Tabelle mit
`FOR UPDATE SKIP LOCKED`, sodass mehrere Prozesse nebeneinander arbeiten
können.

## Was fehlt, und wo es hingehört

* **Echtzeit-Zusammenarbeit.** Die Kommandostruktur trägt sie bereits: ein
  Kommando ist klein, serialisierbar und auf dem Server nachvollziehbar. Es
  fehlt der Transport und die Konfliktauflösung.
* **Fahrgastmodell mit Quelle-Ziel-Matrix.** Der Netzgraph und die
  Reisezeitrechnung liegen vor; es fehlen die Daten.
* **Weitere Städte.** Erledigt für Berlin — und die Umstellung war lehrreicher
  als erwartet. Der Rechenkern kennt tatsächlich nur `CityData`, aber „ein
  zweiter Datensatz genügt" stimmte nicht: rundherum steckten Hamburg-Reste,
  die sich nicht von selbst melden. Die metrische Projektion war eine
  Konstante; der Importer las für jede Stadt Hamburgs Dateien; die
  Szenariovorlagen waren fest einprogrammiert, samt „U5 im Vollausbau", das
  Berlin dann auch angeboten bekam; eine Ergebniszeile hieß „Fiskaleffekt
  Hamburg"; und der Umsatzsteuerschlüssel wie der Baugrundfaktor sind Aussagen
  über die *Stadt*, nicht über Eisenbahn. Eine dritte Stadt kostet jetzt
  wirklich nur noch einen Datensatz und eine Konfigurationsdatei — aber wer
  sie anlegt, sollte trotzdem nach dem Muster suchen: alles, was geschrieben
  wurde, als es eine Stadt gab.
