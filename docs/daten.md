# Datenherkunft

Dieses Dokument beschreibt die **Hamburger** Datenpipeline im Detail. Berlin
folgt demselben Aufbau mit anderen Quellen: die Netzdaten kommen ebenfalls aus
OpenStreetMap, die Einwohnerzahlen aber aus den `population`-Tags der
OSM-Ortsteilrelationen statt von einem Statistikamt — sie sind also **nicht
amtlich**, und die Anwendung nennt sie auch nicht so. Was für eine Stadt gilt,
steht in `data/cities/<id>.json` und im Datensatz selbst (`provenance`).

Alle Datensätze sind versioniert. Der aktuelle Stand ist **2026-09**. Ein
Szenario speichert den Datenstand, mit dem es gerechnet wurde; der Server
lehnt Szenarien mit fremdem Datenstand ab, statt sie stillschweigend
umzurechnen.

Die Pipeline ist reproduzierbar: `npm run data:fetch` lädt die Rohdaten (mit
Zwischenspeicher unter `data/raw/`), `npm run data:build` erzeugt daraus
`data/dist/`; für Berlin `data:fetch:berlin` und `data:build:berlin`. Nichts
wird von Hand nachbearbeitet.

Der Zwischenspeicher ist nach dem Hash der Abfrage benannt, eine geänderte
Abfrage legt also eine neue Datei neben die alte. Welche davon gilt, steht in
`data/raw/index.json` — ohne diesen Zeiger nahm der Aufbau die alphabetisch
erste, und eine umgeschriebene Abfrage blieb folgenlos.

## 1. Netz und Geografie — OpenStreetMap

Bezogen über die Overpass-API, Lizenz **ODbL 1.0**, Namensnennung
erforderlich.

| Abfrage | Umfang | Verwendung |
| --- | --- | --- |
| Linienrelationen U-Bahn, S-Bahn, AKN | 28 Relationen, 2 342 Wege | Netzgraph |
| Stationsobjekte im weiteren Einzugsgebiet | 14 877 benannte Objekte | Stationsnamen |
| Gewässer | 808 Flächen, 443 Läufe | Karte, Querungskosten, Baubarkeit |
| Grünflächen | 4 976 Flächen | Karte |
| Hauptstraßen | 17 910 Wege | Karte, Trassierung, Baubarkeit |
| Benannte Straßen | 49 514 Wege → 31 401 Korridore | Stationsbenennung, Straßenbahntrassen |
| Flächennutzung | 12 499 Flächen | Bevölkerungs- und Arbeitsplatzverteilung |
| Gebäude mit Geschosszahl | 211 441, davon 195 041 ausgewertet | Bevölkerungsverteilung |
| Landmarken, Orte, POIs (Stadtgebiet) | 1 329 | Stationsfindung und -benennung |
| Orte, Gewässer, Autobahnen, Bahnstrecken der Region | 2 759 Orte, 72 Seen, 75 Küstenlinien, 163 Autobahnen, 345 Bahnstrecken | Regionalkarte, Benennung außerhalb Hamburgs |
| Geplante und im Bau befindliche Gleise | 130 Wege | Trassenführung U5 Ost, U4 Grasbrook |

### Wie aus Relationen ein Graph wird

`tools/importer/build-network.mjs` löst pro Linie das Problem, dass OSM
Richtungen und Varianten getrennt führt:

1. Für jede Linienvariante wird die Gleisgeometrie aus den Wegen
   zusammengesetzt und jeder Halt darauf projiziert — das ergibt die
   Reihenfolge der Halte, ohne sich auf die Reihenfolge der Relationsmitglieder
   zu verlassen.
2. Halte werden über einen normalisierten Namen und 450 m Umkreis
   zusammengeführt, sodass „Hauptbahnhof Nord", „Hauptbahnhof Süd" und
   „Hamburg Hauptbahnhof" ein Knoten werden.
3. Zwischen benachbarten Halten entsteht eine Kante. Führt eine zweite Linie
   über dieselbe Strecke — geprüft am Mittelpunkt nach Länge, 150 m Toleranz —,
   nutzt sie **dieselbe Kante**. Daraus ergeben sich gemeinsame Gleise,
   Umsteigepunkte und Verzweigungen von selbst.
4. Varianten, die keine neue Kante erzeugen, sind Gegenrichtungen und
   entfallen. Varianten, die neue Kanten erzeugen, sind echte Äste und werden
   als eigene Linie geführt — so bleibt der Flughafen-Ast der S1 erhalten.

Ergebnis: 13 Bestandslinien, 164 Stationen, 273,7 km. Die U-Bahn kommt auf
106,1 km — das reale Netz misst rund 106 km.

## 2. Bevölkerung und Beschäftigung — Statistikamt Nord

„Regionalstatistische Daten der Stadtteile Hamburgs", bezogen über die
OGC-API der Freien und Hansestadt Hamburg. Lizenz **dl-de/by-2-0**.

Verwendet wird der aktuellste Jahrgang (2025) für 99 Stadtteile:
Einwohner nach Altersgruppen, Haushalte, sozialversicherungspflichtig
Beschäftigte am Wohnort, Wohnungen, Pkw-Bestand, Fläche.
Summe: **1 975 790 Einwohner** auf 747 km². Das Melderegister weist für ganz
Hamburg 1 980 285 Einwohner aus; die Differenz entfällt auf Personen, die
keinem Stadtteil zugeordnet sind.

### Das Bevölkerungsraster

Stadtteile sind für Einzugsbereiche zu grob — ein Stadtteil ist im Mittel
7,5 km² groß, ein Fußweg-Einzugsbereich 2 km². Deshalb wird die amtliche
Einwohnerzahl **innerhalb** jedes Stadtteils auf ein 200-m-Raster verteilt,
gewichtet mit modellierter Wohn-Geschossfläche:

```
Gewicht(Zelle) = Σ Grundfläche × Geschosse   über Wohngebäude in der Zelle
               + 0,25 × Fläche Wohn-Flächennutzung   (füllt Lücken)
```

Die Verteilung ist je Stadtteil normiert, Fehler in den Gebäudedaten wirken
sich also nur innerhalb eines Stadtteils aus, nie auf dessen Summe. Die
Rastersumme entspricht exakt 1 975 790.

### Die Arbeitsplätze

Die amtliche Statistik weist Beschäftigte am **Wohnort** aus; für
Erreichbarkeit braucht es den **Arbeitsort**. Deshalb werden 1 370 200
Erwerbstätige am Arbeitsort (Hamburg 2025, Arbeitskreis Erwerbstätigenrechnung) stadtweit nach Nichtwohn-Geschossfläche
verteilt, mit einem Innenstadtfaktor
`1 + 1,9 · exp(−d/2600 m)`, der die im Gebäudebestand unterrepräsentierte
Bürodichte der City ausgleicht.

Das ist ausdrücklich eine **Modellierung**, nicht amtlich. Sie wird in der
Anwendung als solche ausgewiesen. Die daraus abgeleiteten Beschäftigungszentren
sind plausibel: Rathaus 140 k, Berliner Tor 57 k, Diebsteich 33 k, Veddel 29 k,
Sengelmannstraße (City Nord) 27 k, Dehnhaide 24 k, Reeperbahn 22 k, Harburg 19 k,
Waltershof 18 k.

## 2b. Die Region — Lüneburg, Lauenburg, Kiel, Rostock

Für Hamburg allein lässt sich keine Regionalverbindung entwerfen. Der
Datenausschnitt reicht deshalb von **53,00° bis 54,55° Nord und 9,10° bis
12,55° Ost** — von Lüneburg und der Elbmarsch bis Kiel, Lübeck und Rostock.

Außerhalb Hamburgs gibt es keine amtliche Kleinräumigkeit, die der des
Statistikamts Nord entspräche. Verwendet wird deshalb die
`population`-Angabe der OSM-Ortsknoten: 1 243 Orte mit Einwohnerzahl,
zusammen **3 863 336 Einwohner**, verteilt auf ein **1-km-Raster** (252 × 198
Zellen). Jeder Ort wird über eine Scheibe verteilt, deren Radius sich aus
seiner Einwohnerzahl bei 1 800 Einwohnern je km² bebauter Fläche ergibt; das
Gewicht fällt zum Rand hin quadratisch ab.

Drei Dinge sind dabei bewusst gesetzt:

* **Zellen innerhalb Hamburger Stadtteile werden geleert** (678 Stück). Dort
  gilt das feine 200-m-Raster; ohne diesen Schritt würde Hamburg doppelt
  gezählt.
* **Unplausible Einwohnerzahlen werden ersetzt.** `population` ist in OSM
  nutzergepflegt und trägt gelegentlich die Zahl des umgebenden Amtes: der
  Knoten von Bad Bramstedt (rund 14 000 Einwohner) führte 154 390. Liegt der
  Wert weit über dem, was der eigene `place`-Typ zulässt, wird stattdessen
  eine typische Größe für diesen Typ angesetzt — falsch um den Faktor zwei ist
  besser als falsch um den Faktor zehn.
* **Das Raster ist grob, weil die Daten grob sind.** 1 km gegen 200 m in der
  Stadt. Für die Frage „wen erreicht eine S-Bahn nach Kiel?" reicht das; für
  eine Haltestellenlage in Neumünster nicht.

Alle 2 756 benannten Orte der Region — auch die ohne Einwohnerzahl — dienen
zusätzlich der **Benennung**: eine Station im Freien heißt nach dem Dorf, das
sie erschließt, so wie „Bissee" oder „Groß Kummerfeld" es real täten.

## 3. Geplante Vorhaben — kuratiert

`data/curated/projects.json` enthält Stationsfolgen, Bauweisen, Zieltermine und
veröffentlichte Kosten, jeweils mit Quellenangabe. **Koordinaten stehen dort
nicht**: `tools/importer/build-projects.mjs` verortet jede Station gegen die
OSM-Daten desselben Datenstands (Bestandsstationen, Ortsteile, Landmarken,
Straßennamen, benannte Objekte auf den geplanten Trassen), wobei die
Namensübereinstimmung schwerer wiegt als die Nähe.

Die Trassenführung folgt, wo vorhanden, den in OSM erfassten geplanten Gleisen
(U5 Ost, U4 Grasbrook) oder dem Bestandskorridor (S4). Für die
Straßenbahnvorschläge wird über einen Graphen aus 67 424 Straßenwegen und
366 161 Knoten geroutet — sonst liefen die Linien quer über die Alster.

Kontrollwerte: U5 Ost 5,5 km (HOCHBAHN: rund 5,8 km), U5 City Nord –
Jarrestraße 2,4 km (rund 2,6 km).

### Das Straßenbahnnetz der Studie

Die Studie „Alternativen für eine Fortsetzung der U5 ab Borgweg“ (Dieter Doege
und Jens Ode im Auftrag der Fraktion Die Linke in der Hamburgischen
Bürgerschaft, Stand Juli 2026, vorgestellt am 12.08.2026) beschreibt vier
Korridore A bis D mit zusammen 43,732 km und 91 Haltestellen, für die sie
höchstens 1,5 Mrd. € ansetzt. Ihre Karten nennen jede Haltestelle beim Namen.

Die Anwendung übernimmt diese Haltestellen und verortet sie an den
gleichnamigen Bushaltestellen in OpenStreetMap; fünf Namen, zu denen es dort
keine Haltestelle gibt, sind an der gleichnamigen Straße verortet. Zwischen
zwei Haltestellen folgt die Linie dem Straßennetz, sofern der Weg höchstens
ein Viertel länger ist als die Luftlinie, und sonst der Luftlinie. So kommt
die Anwendung auf 44,3 km gegenüber 43,7 km in der Studie. Der Korridor C ist
als zwei Linien abgelegt, weil er sich im Westen in eine Schleife über den
Osdorfer Born teilt, und im Korridor A beschriftet die Karte der Studie nur 21
der 22 genannten Haltestellen.

## 3b. Berlin

Dieselbe Pipeline, andere Konfiguration (`data/cities/berlin.json`).

| Datensatz | Quelle | Umfang |
| --- | --- | --- |
| Linienrelationen U-Bahn, S-Bahn, Straßenbahn | OpenStreetMap | 68 Linien, 651 Stationen, 719 km |
| Stationsobjekte der Region | OpenStreetMap | 13 576 benannte Objekte |
| Ortsteilgrenzen | OSM-Grenzrelationen (`admin_level=10`, `ref:DE-BE:OT`) | 97 Ortsteile |
| Einwohner je Ortsteil | **Amt für Statistik Berlin-Brandenburg**, Einwohnerregisterstatistik zum 31.12.2025, CC BY 3.0 DE | 97 Ortsteile, 3 913 644 Einwohner |
| Gebäude mit Geschosszahl | OpenStreetMap | 208 092 ausgewertet |

Die Einwohnerzahlen stammen aus dem Statistischen Bericht A I 5 – hj 2/25, der
in `data/curated/berlin-ortsteile-2025.json` abgelegt ist und über die
Ortsteilnummer (`ref:DE-BE:OT`) mit den OSM-Grenzen verknüpft wird. Ortsteile,
deren Grenze in OpenStreetMap aus mehreren Flächen besteht, werden dabei zu
einer Fläche zusammengeführt, damit ihre Einwohner nicht doppelt gezählt werden.

Die 2 196 500 Arbeitsplätze sind die Erwerbstätigen am Arbeitsort 2025 nach dem
Arbeitskreis Erwerbstätigenrechnung; sie werden wie in Hamburg nach
Nichtwohn-Geschossfläche verteilt.

## 4. Was fehlt

Ehrlich benannt, weil es die Ergebnisse beeinflusst:

* **Baugrund.** Hamburgs Marsch-, Sand- und Geschiebemergelschichten und der
  Grundwasserstand sind der größte Kostentreiber im Tunnelbau. Es gibt keinen
  offenen, flächendeckenden, maschinenlesbaren Datensatz dazu; das Modell
  arbeitet mit einem pauschalen Faktor von 1,08.
* **Leitungsbestand.** Für Bauweise und Kosten in offener Bauweise
  entscheidend, nicht öffentlich verfügbar.
* **Quelle-Ziel-Verflechtung.** Es gibt keine offene Matrix für Hamburg. Das
  Nachfragemodell arbeitet deshalb mit Einzugsbereichen und Reisezeiten zu
  Beschäftigungszentren statt mit Wegeketten.
* **Fahrgastzahlen je Station.** HOCHBAHN und S-Bahn veröffentlichen keine
  stationsscharfen Zahlen. Kalibriert wird gegen die Netzsumme.
* **Amtliche Kleinräumigkeit außerhalb Hamburgs.** Schleswig-Holstein,
  Niedersachsen und Mecklenburg-Vorpommern veröffentlichen Einwohnerzahlen je
  Gemeinde, aber nicht in einem gemeinsamen, maschinenlesbaren Raster. Wer es
  genauer braucht: der **Zensus-2022-Gitterdatensatz** des Statistischen
  Bundesamtes (100-m-Raster, dl-de/by-2-0) deckt die gesamte Region ab und
  ließe sich anstelle der OSM-Ortsknoten einlesen — er ist nur rund 2 GB groß
  und deshalb hier nicht mitgeliefert. Der Importer erwartet lediglich
  Zellmittelpunkt und Einwohnerzahl.

Wären diese Daten verfügbar, würden sie über dieselbe Pipeline eingespeist —
die Modelle lesen sie aus `CityData`, nicht aus dem Code.
