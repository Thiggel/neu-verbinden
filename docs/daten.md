# Datenherkunft

Dieses Dokument beschreibt die **Hamburger** Datenpipeline im Einzelnen,
während Berlin demselben Aufbau mit anderen Quellen folgt, die in Abschnitt 5
zusammengefasst sind. Welche Quellen für eine Stadt gelten, steht in
`data/cities/<id>.json` und im Datensatz selbst unter `provenance`.

Alle Datensätze sind versioniert, wobei der aktuelle Stand **2026-09** lautet.
Ein Szenario speichert den Datenstand, mit dem es berechnet wurde, und der
Server lehnt Szenarien mit einem anderen Datenstand ab, statt sie
stillschweigend umzurechnen.

Die Pipeline ist reproduzierbar, da `npm run data:fetch` die Rohdaten lädt und
unter `data/raw/` zwischenspeichert und `npm run data:build` daraus
`data/dist/` erzeugt; für Berlin dienen dazu `data:fetch:berlin` und
`data:build:berlin`. Eine Nachbearbeitung von Hand findet nicht statt.

Der Zwischenspeicher ist nach dem Hash der Abfrage benannt, sodass eine
geänderte Abfrage eine neue Datei neben der alten anlegt. Welche Datei gilt,
verzeichnet `data/raw/index.json`, weil der Aufbau ohne diesen Verweis die
alphabetisch erste Datei verwendete und eine umgeschriebene Abfrage dadurch
wirkungslos blieb.

## 1. Netz und Geografie aus OpenStreetMap

Die Daten werden über die Overpass-API bezogen und stehen unter der Lizenz
**ODbL 1.0**, die eine Namensnennung verlangt.

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

### Aufbau des Netzgraphen

`tools/importer/build-network.mjs` behandelt für jede Linie den Umstand, dass
OpenStreetMap Fahrtrichtungen und Varianten getrennt führt:

1. Für jede Linienvariante wird die Gleisgeometrie aus den Wegen
   zusammengesetzt und jeder Halt auf sie projiziert, woraus sich die
   Reihenfolge der Halte ergibt, ohne dass die Reihenfolge der
   Relationsmitglieder maßgeblich wäre.
2. Halte werden über einen normalisierten Namen und einen Umkreis von 450 m
   zusammengeführt, sodass „Hauptbahnhof Nord“, „Hauptbahnhof Süd“ und
   „Hamburg Hauptbahnhof“ einen gemeinsamen Knoten bilden.
3. Zwischen benachbarten Halten entsteht eine Kante, und eine zweite Linie,
   die über dieselbe Strecke führt, was am längenbezogenen Mittelpunkt mit
   einer Toleranz von 150 m geprüft wird, nutzt **dieselbe Kante**, sodass
   sich gemeinsame Gleise, Umsteigepunkte und Verzweigungen aus der Struktur
   ergeben.
4. Varianten, die keine neue Kante erzeugen, gelten als Gegenrichtungen und
   entfallen, während Varianten mit neuen Kanten echte Äste sind und als
   eigene Linie geführt werden, wodurch etwa der Flughafenast der S1 erhalten
   bleibt.

Daraus ergeben sich 13 Bestandslinien mit 164 Stationen und 273,7 km, wovon
106,1 km auf die U-Bahn entfallen, deren reales Netz rund 106 km misst.

## 2. Bevölkerung und Beschäftigung in Hamburg

Grundlage sind die „Regionalstatistischen Daten der Stadtteile Hamburgs“ des
Statistikamts Nord, die über die OGC-API der Freien und Hansestadt Hamburg
bezogen werden und unter der Lizenz **dl-de/by-2-0** stehen.

Verwendet wird der aktuelle Jahrgang 2025 für 99 Stadtteile mit Einwohnern
nach Altersgruppen, Haushalten, sozialversicherungspflichtig Beschäftigten am
Wohnort, Wohnungen, Pkw-Bestand und Fläche. Die Summe beträgt **1 975 790
Einwohner** auf 747 km², während das Melderegister für ganz Hamburg 1 980 285
Einwohner ausweist, wobei die Differenz auf Personen entfällt, die keinem
Stadtteil zugeordnet sind.

### Bevölkerungsraster

Da ein Stadtteil im Mittel 7,5 km² groß ist, ein fußläufiger Einzugsbereich
aber nur 2 km², sind Stadtteile für die Berechnung von Einzugsbereichen zu
grob. Die amtliche Einwohnerzahl wird deshalb **innerhalb** jedes Stadtteils
auf ein Raster von 200 m verteilt und dabei mit der modellierten
Wohngeschossfläche gewichtet:

```
Gewicht(Zelle) = Σ Grundfläche × Geschosse   über Wohngebäude in der Zelle
               + 0,25 × Fläche Wohn-Flächennutzung   (füllt Lücken)
```

Weil die Verteilung je Stadtteil normiert ist, wirken sich Fehler in den
Gebäudedaten nur innerhalb eines Stadtteils und nie auf dessen Summe aus, und
die Summe des Rasters entspricht genau 1 975 790.

### Arbeitsplätze

Die amtliche Statistik weist Beschäftigte am **Wohnort** aus, während für die
Erreichbarkeit der **Arbeitsort** benötigt wird. Deshalb werden die 1 370 200
Erwerbstätigen am Arbeitsort, die der Arbeitskreis Erwerbstätigenrechnung für
Hamburg 2025 angibt, stadtweit nach Nichtwohngeschossfläche verteilt, wobei
ein Innenstadtfaktor von `1 + 1,9 · exp(−d/2600 m)` die im Gebäudebestand
unterrepräsentierte Bürodichte der Innenstadt ausgleicht.

Diese Verteilung ist eine **Modellierung** und keine amtliche Angabe, was die
Anwendung auch so ausweist. Die daraus abgeleiteten Beschäftigungszentren
liegen in einer plausiblen Größenordnung, nämlich Rathaus mit 140 000,
Berliner Tor mit 57 000, Diebsteich mit 33 000, Veddel mit 29 000,
Sengelmannstraße (City Nord) mit 27 000, Dehnhaide mit 24 000, Reeperbahn mit
22 000, Harburg mit 19 000 und Waltershof mit 18 000.

## 3. Region um Hamburg

Da sich innerhalb Hamburgs allein keine Regionalverbindung entwerfen lässt,
reicht der Datenausschnitt von **53,00° bis 54,55° Nord und von 9,10° bis
12,55° Ost** und umfasst damit das Gebiet von Lüneburg und der Elbmarsch bis
Kiel, Lübeck und Rostock.

Weil es außerhalb Hamburgs keine amtlichen Daten gibt, deren räumliche
Auflösung der des Statistikamts Nord entspräche, wird die Angabe `population`
der OSM-Ortsknoten verwendet. Die 1 243 Orte mit Einwohnerzahl umfassen
zusammen **3 863 336 Einwohner**, die auf ein **Raster von 1 km** mit 252 × 198
Zellen verteilt werden. Jeder Ort wird dabei über eine Kreisfläche verteilt,
deren Radius sich aus seiner Einwohnerzahl bei 1 800 Einwohnern je km²
bebauter Fläche ergibt, und deren Gewicht zum Rand hin quadratisch abnimmt.

Drei Festlegungen sind dabei bewusst getroffen. Die 678 Zellen innerhalb
Hamburger Stadtteile werden geleert, weil dort das feinere Raster von 200 m
gilt und Hamburg andernfalls doppelt gezählt würde. Unplausible
Einwohnerzahlen werden ersetzt, da `population` in OpenStreetMap von Nutzern
gepflegt wird und gelegentlich die Zahl des umgebenden Amtes enthält, wie beim
Knoten von Bad Bramstedt, der bei rund 14 000 Einwohnern 154 390 angab; liegt
ein Wert weit über dem, was der zugehörige `place`-Typ zulässt, wird
stattdessen eine für diesen Typ übliche Größe angesetzt, weil ein Fehler um den
Faktor zwei geringer wiegt als einer um den Faktor zehn. Das Raster ist
schließlich mit 1 km gegenüber 200 m in der Stadt grob, weil die zugrunde
liegenden Daten grob sind, was für die Frage, wen eine S-Bahn nach Kiel
erreicht, genügt, für die Lage einer Haltestelle in Neumünster jedoch nicht.

Alle 2 756 benannten Orte der Region dienen, auch wenn sie keine Einwohnerzahl
tragen, zusätzlich der **Benennung**, sodass eine Station außerhalb der Städte
nach dem Dorf heißt, das sie erschließt, wie es bei „Bissee“ oder „Groß
Kummerfeld“ auch in der Wirklichkeit der Fall wäre.

## 4. Geplante Vorhaben

`data/curated/projects.json` enthält Stationsfolgen, Bauweisen, Zieltermine und
veröffentlichte Kosten mit jeweiliger Quellenangabe, aber **keine
Koordinaten**. Diese ermittelt `tools/importer/build-projects.mjs`, indem es
jede Station gegen die OSM-Daten desselben Datenstands verortet, also gegen
Bestandsstationen, Ortsteile, Landmarken, Straßennamen und benannte Objekte auf
den geplanten Trassen, wobei die Übereinstimmung des Namens stärker gewichtet
wird als die Nähe.

Die Trassenführung folgt, soweit vorhanden, den in OpenStreetMap erfassten
geplanten Gleisen wie bei der U5 Ost und der U4 Grasbrook oder dem
Bestandskorridor wie bei der S4. Die Straßenbahnvorschläge werden über einen
Graphen aus 67 424 Straßenwegen und 366 161 Knoten geführt, da die Linien sonst
quer über die Alster verliefen.

Zur Kontrolle ergibt sich für die U5 Ost eine Länge von 5,5 km gegenüber rund
5,8 km bei der HOCHBAHN und für den Abschnitt der U5 von City Nord bis
Jarrestraße eine Länge von 2,4 km gegenüber rund 2,6 km.

### Straßenbahnnetz der Studie

Die Studie „Alternativen für eine Fortsetzung der U5 ab Borgweg“, die Dieter
Doege und Jens Ode im Auftrag der Fraktion Die Linke in der Hamburgischen
Bürgerschaft erstellt haben (Stand Juli 2026, vorgestellt am 12.08.2026),
beschreibt vier Korridore A bis D mit zusammen 43,732 km und 91 Haltestellen,
für die sie höchstens 1,5 Mrd. € ansetzt, und nennt in ihren Karten jede
Haltestelle beim Namen.

Die Anwendung übernimmt diese Haltestellen und verortet sie an den
gleichnamigen Bushaltestellen in OpenStreetMap, während fünf Namen, zu denen es
dort keine Haltestelle gibt, an der gleichnamigen Straße verortet sind.
Zwischen zwei Haltestellen folgt die Linie dem Straßennetz, sofern der Weg
höchstens ein Viertel länger ist als die Luftlinie, und andernfalls der
Luftlinie, woraus sich 44,3 km gegenüber 43,7 km in der Studie ergeben. Der
Korridor C ist als zwei Linien angelegt, weil er sich im Westen in eine
Schleife über den Osdorfer Born teilt, und im Korridor A beschriftet die Karte
der Studie nur 21 der 22 genannten Haltestellen.

## 5. Berlin

Berlin durchläuft dieselbe Pipeline mit einer eigenen Konfiguration in
`data/cities/berlin.json`.

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
einer Fläche zusammengeführt, damit ihre Einwohner nicht doppelt gezählt
werden.

Die 2 196 500 Arbeitsplätze entsprechen den Erwerbstätigen am Arbeitsort 2025
nach dem Arbeitskreis Erwerbstätigenrechnung und werden wie in Hamburg nach
Nichtwohngeschossfläche verteilt.

## 6. Fehlende Daten

Die folgenden Lücken sind aufgeführt, weil sie die Ergebnisse beeinflussen.

Zum **Baugrund** gibt es keinen offenen, flächendeckenden und maschinenlesbaren
Datensatz, obwohl die Marsch-, Sand- und Geschiebemergelschichten Hamburgs und
der Grundwasserstand den größten Kostentreiber im Tunnelbau darstellen,
weshalb das Modell mit einem pauschalen Faktor von 1,08 arbeitet.

Der **Leitungsbestand**, der für Bauweise und Kosten der offenen Bauweise
entscheidend ist, ist nicht öffentlich verfügbar.

Eine offene **Quelle-Ziel-Matrix** gibt es für Hamburg nicht, weshalb das
Nachfragemodell mit Einzugsbereichen und Reisezeiten zu Beschäftigungszentren
arbeitet statt mit Wegeketten.

**Fahrgastzahlen je Station** veröffentlichen weder die HOCHBAHN noch die
S-Bahn, sodass gegen die Summe des Netzes kalibriert wird.

**Amtliche Daten mit feiner räumlicher Auflösung außerhalb Hamburgs**
veröffentlichen Schleswig-Holstein, Niedersachsen und Mecklenburg-Vorpommern
zwar je Gemeinde, aber nicht in einem gemeinsamen, maschinenlesbaren Raster.
Der **Gitterdatensatz des Zensus 2022** des Statistischen Bundesamtes mit
einem Raster von 100 m unter dl-de/by-2-0 deckt die gesamte Region ab und
ließe sich anstelle der OSM-Ortsknoten einlesen, wird aber wegen seiner Größe
von rund 2 GB nicht mitgeliefert, wobei der Importer lediglich
Zellmittelpunkt und Einwohnerzahl erwartet.

Stünden diese Daten zur Verfügung, würden sie über dieselbe Pipeline
eingespeist, da die Modelle sie aus `CityData` und nicht aus dem Code lesen.
