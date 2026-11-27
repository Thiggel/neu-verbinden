# Die Modelle

Jeder Wert dieser Anwendung ist eine Schätzung. Dieses Dokument beschreibt, wie
sie zustande kommt und wo sie nicht trägt. Sämtliche Parameter stehen in
`rust/core/src/params.rs` und wandern als Daten mit einem gespeicherten
Szenario mit.

---

## 1. Automatische Stationen

Der Nutzer zeichnet Infrastruktur, nicht Haltestellen. Aus einem gezeichneten
Korridor entstehen Stationen in zwei Schritten.

**Kandidaten** stammen aus vier Quellen: den beiden Endpunkten (immer
gesetzt), Bestandsstationen im Umkreis von 300 m (Umsteigepunkte), Landmarken
im Umkreis von 500 m, und einem Raster im halben Zielabstand als Auffüllung.
Jeder Kandidat bekommt eine Bewertung aus seinem entfernungsgewichteten
Einzugsbereich plus Zuschlägen für Umstieg und Landmarkengewicht.

Jeder Punkt, den die zeichnende Person gesetzt hat, ist gesetzt: ein Klick ist
eine Anweisung, keine Anregung. Das Modell entscheidet nur, was **dazwischen**
noch hinkommt.

**Auswahl** ist ein dynamisches Programm entlang der Linie: Der Wert einer
Station ist ihre Bewertung **abzüglich 0,42** — was eine Station wert sein
muss, um überhaupt gebaut zu werden — und jeder Abstand kostet
`1,1 · ((d − Ziel)/Ziel)²`, mit zusätzlichen Strafen ober- und unterhalb der
erlaubten Spanne. Abstände unter 60 % des Minimums sind ausgeschlossen.

Deshalb entsteht keine Station, nur weil eine feste Distanz erreicht ist — und
ein wichtiges Ziel kann den normalen Abstand überstimmen.

| Verkehrsmittel | Ziel | Minimum | Maximum | Dehnung im Freien |
| --- | ---: | ---: | ---: | ---: |
| U-Bahn | 1 000 m | 550 m | 2 200 m | × 1,35 |
| S-Bahn | 1 900 m | 900 m | 4 200 m | × 3,0 |
| Straßenbahn | 450 m | 300 m | 900 m | × 1,2 |
| Regionalbahn | 4 500 m | 2 000 m | 9 000 m | × 3,5 |

Die Zielabstände sind **Stadtwerte**. Eine Linie ins Umland bekäme mit ihnen
alle 1,9 km einen Halt im freien Feld. Deshalb dehnt sich die gesamte Spanne
mit der Dünnbesiedelung entlang jedes Abschnitts:

```
Dehnung = √(Referenzeinwohner / Einzugsbereich)   begrenzt auf [1, Modewert]
```

Der Faktor wird über alle Kandidaten zwischen zwei Halten gemittelt, ist also
stetig statt ein Stadt-Land-Schalter. Eine U-Bahn dehnt sich kaum — dieses
Verkehrsmittel existiert nur, wo die Stadt dicht ist —, eine S-Bahn nach Kiel
dagegen bis auf Dorfabstände. Das Ergebnis für einen 86 km langen Korridor
Hamburg–Kiel: 22 Halte in Kattendorf, Hartenholm, Heidmühlen, Latendorf,
Groß Kummerfeld, Bissee und Boksee statt 52 im Nirgendwo.

**Benennung** folgt der Reihenfolge, in der deutsche Haltestellen tatsächlich
benannt sind: eine stadtweit bekannte Landmarke (Flughafen, Universität,
Stadion), sonst die Straße, an der die Station steht, sonst der Stadtteil,
sonst eine kleinere öffentliche Einrichtung. Namen, die ein Verkehrsbetrieb nie
auf ein Schild schreiben würde — Vereine, Kanzleien, Galerien, alles über 26
Zeichen — sind schon beim Import aussortiert. Kommt ein Name entlang einer
Linie zweimal vor, bekommt der zweite Halt seinen nächstbesten Namen statt
einer angehängten Ziffer. Außerhalb Hamburgs gibt es keine Straßenkorridore im
Datensatz; dort greift als letzte Stufe der nächstgelegene benannte Ort im
Umkreis von 4,5 km, gewichtet nach Größe und Entfernung.

Setzt der Nutzer einen Punkt genau auf eine Bestandsstation, übernimmt der
Halt deren Namen, deren Knoten und deren Umsteigebeziehung — die Position
bleibt die geklickte.

---

## 2. Kosten

Abschnittsweise, nie pauschal je Kilometer Linie.

```
Abschnitt = Kennwert(Bauweise) × km
          × Gleisfaktor × (1 + 0,30 · Dichteindex) × Baugrundfaktor
          + Wasserquerung(€/m) × nasse Meter
```

Stationen kosten nach **tatsächlicher** Bauweise der Kanten, die sie im
Szenario bedienen — eine Straßenbahnhaltestelle über einem geplanten
U-Bahnhof kostet den Haltestellenpreis, solange die U-Bahn nicht Teil des
Szenarios ist. Umsteigebauwerke kosten das 1,45-fache; eine Bestandsstation,
die eine neue Linie mitbedienen soll, kostet 35 % eines Neubaus.

Darauf kommen Planung (12 %), Projektsteuerung (4 %), Grunderwerb und Leitungen
(3–7,5 % je Bauweise), Fahrzeuge und Betriebshöfe (aus Taktfolge und Umlaufzeit
gerechnet, nicht pauschal), Risikovorsorge (15–25 %) und die
Baupreisentwicklung bis zur Bauzeitmitte (2 % p. a.).

Kennwerte für 2026 (Auswahl, € je km Doppelgleis):
bergmännischer Tunnel 105 Mio., offene Bauweise 82 Mio., Hochlage 45 Mio.,
oberirdisch 26 Mio., Straßenbahn auf eigenem Bahnkörper 14 Mio.,
Bestandsstrecke ertüchtigen 6,5 Mio.
Stationen: tief 215 Mio., offen 125 Mio., oberirdisch 16 Mio.,
Straßenbahnhaltestelle 0,85 Mio.

Ein Umsteigezuschlag gilt nur, wo tatsächlich eine **andere** Linie hält — die
fünf Baustufen der U5 sind eine Linie, keine fünf. Eine Verzweigung wird nur
berechnet, wo sich das Gleis einer Linie wirklich teilt: dass die U5 unter der
U3 hindurchfährt, ist ein Umstieg, kein Abzweig. Fahrzeuge werden je Linie
beschafft, nicht je Bauabschnitt.

Kalibriert gegen U5 Ost, U5 City Nord – Jarrestraße, U4 Horner Geest und
S4 Ost. `npm run engine:calibrate` prüft das nach, `hh audit <projekt>` zeigt
jede einzelne Position.

Ausgewiesen wird immer eine **Spanne**, ±20 % bei Straßenbahn bis ±32 % bei
Tunnelbau. Ein Punktwert wäre eine Genauigkeit, die die Datenlage nicht
hergibt.

---

## 3. Bauzeit

Phasen: Vorplanung → Planfeststellung → Entwurfs- und Ausführungsplanung →
Vergabe → Bau → Inbetriebnahme. Die vorderen Phasen skalieren mit der
Projektgröße; die Genehmigung läuft zu 55 % parallel zur Planung.

```
Bauzeit = Einrichtung + (Σ Jahre/km + Σ Jahre/Station) / Baufelder
Baufelder = clamp(1, 5·p, Länge / 4 km · p)
p         = 1 − Korridoranteil · (1 − 0,35)
```

Deshalb wächst die Bauzeit unterlinear: 25 km dauern nicht das Fünffache von
5 km. Der Faktor `p` bremst das dort, wo unter laufendem Betrieb gebaut wird:
fünf gleichzeitige Baustellen sind auf freier Strecke vernünftig, in einer
Strecke, die weiter Züge trägt, nicht — dort wird in Sperrpausen gearbeitet.
Eine Trasse vollständig im Bestandskorridor behält gut ein Drittel der
Parallelität.

Abschnitte, die real bereits im Bau sind, überspringen Planung und Genehmigung;
ist zusätzlich ein `constructionStartYear` bekannt, werden die bereits
verstrichenen Baujahre abgezogen — höchstens vier Fünftel, denn eine Strecke im
Bau ist definitionsgemäß nicht fertig.

---

## 4. Baubarkeit

Keine Ja/Nein-Antwort, sondern Befunde mit Begründung und Schweregrad:
Bogenradien unter dem Mindestmaß des Verkehrsmittels, Gewässerquerungen
(Länge, Hauptgewässer, Eignung der Bauweise), Straßenbahnen ohne
Straßenkorridor, Straßenbahn im Mischverkehr auf autobahnähnlichen Straßen,
offene Bauweise in dichter Bebauung, zu enge Stationsabstände, unterbrochene
Laufwege, unvereinbare Verkehrsmittel auf gemeinsamem Gleis.

Der Schweregrad wird auf die Projektgröße normiert — zwei Befunde auf 40 km
wiegen weniger als zwei auf 2 km. Offene Bauweise durch ein Gewässer und ein
Verkehrsmittel auf inkompatiblem Gleis sind Ausschlussgründe.

Das Modell prüft Geometrie, Gewässer, Bauweise und Netzlogik. Es prüft
**keinen Baugrund und keine Leitungslage**.

---

## 5. Nachfrage und Erreichbarkeit

**Einsteiger je Station** aus dem entfernungsgewichteten Einzugsbereich:

```
Gewicht(Zelle) = exp(−1,6 · d / Radius),  d ≤ Radius
Einsteiger = k(Modus) × (Einwohner + 1,35 × Arbeitsplätze)
             × 1,55 (Umstieg) × 1,35 (Innenstadt)
```

Radien: U-Bahn 800 m, S-Bahn 1 000 m, Straßenbahn 500 m. `k` ist so
kalibriert, dass das heutige Netz die Fahrgastzahlen ergibt, die die
Verkehrsunternehmen für 2025 veröffentlicht haben. Weil diese als Jahreswerte
vorliegen, wird mit den 305 Werktagsäquivalenten des Modells umgerechnet:

| | veröffentlicht | Modell | `k` U-Bahn / S-Bahn / Straßenbahn |
| --- | ---: | ---: | --- |
| Hamburg | 571 Mio. (U-Bahn 291 Mio., S-Bahn rund 280 Mio.) | 572 Mio. | 0,55 / 0,80 / 0,40 |
| Berlin | 1 249 Mio. (U-Bahn 556 Mio., Straßenbahn 211 Mio., S-Bahn rund 482 Mio.) | 1 241 Mio. | 0,38 / 0,62 / 0,40 |

Die Raten für U- und S-Bahn sind je Stadt bestimmt, während die Rate der
Straßenbahn aus Berlin stammt, weil nur dort eine Straßenbahn zu beobachten
ist. Quellen: HOCHBAHN, Lagebericht 2025; S-Bahn Hamburg, Daten und Fakten;
BVG in Zahlen 2025; S-Bahn Berlin, Unternehmensprofil.

**Erreichbarkeit** kommt aus dem Netzgraphen, nicht aus einer Annahme. Für
jede der 14 Beschäftigungszentren wird per Dijkstra über das Szenarionetz
gerechnet, mit Umsteigezuschlag von 5 Minuten, Zugangswartezeit von 3 Minuten
und Haltezeiten. Für jede bewohnte Rasterzelle wird die beste Kombination aus
Fußweg zur Station und Fahrt zu jedem Zentrum bestimmt, gewichtet mit den
Arbeitsplätzen des Zentrums.

Diese Erreichbarkeit der Zentren wird ausgewiesen, trägt den Nutzen aber
nicht mehr, weil sie Fahrten zwischen zwei Stadtteilen, von denen keiner ein
Zentrum ist, nicht erfasst.

**Verbindungen** (seit Modell 0.17.0) messen, wie schnell jeder Stadtteil
jeden anderen erreicht, Umstiege eingerechnet:

* **Zonen** sind die Stadtteile und, darüber hinaus, Kacheln von 5 km im
  Umland, jeweils mit den Einwohnern und Arbeitsplätzen der Rasterzellen
  darin und nach dem bedeutendsten Ort darin benannt. Sie hängen nur von den
  Daten ab, sodass beide Seiten eines Vergleichs dieselben Zonen nutzen.
* **Fahrten** werden von jeder Zone mit einer Station in höchstens 1,2 km
  Fußweg zu jeder anderen Zone gesucht: Fußweg, Warten, Fahrt, Umstieg und
  wieder Fußweg, von Tür zu Tür.
* **Wahl** von Ziel und Verkehrsmittel folgt einem Logit-Modell, in dem ein
  Ziel mit seinen Einwohnern und Arbeitsplätzen anzieht und mit der Reisezeit
  abstößt, während alle anderen Verkehrsmittel einen festen Nutzen haben.
* **Nutzen** ist die Änderung der Logsumme: Wer ohnehin fährt, erhält die
  volle Ersparnis, wer neu gewonnen wird, etwa die Hälfte. Ein Anteil an
  Neuverkehr wird nicht gesondert angenommen; Verschlechterungen zählen
  negativ.

Zwei Größen eichen das Modell am heutigen Netz. Der Nutzen der anderen
Verkehrsmittel ist so gesetzt, dass die vorhergesagten Fahrten die heutigen
Einsteiger ergeben. Die Zeitempfindlichkeit ist so gesetzt, dass die
Nachfrage mit einer Elastizität von −0,5 auf die Fahrzeit reagiert, wie
Balcombe u. a. (2004, TRL593, §3.2.4 und §6) es für den städtischen ÖPNV
angeben. Die Wegezahl je Person und Tag stammt aus MiD 2023 (Hamburg 3,0, über alle Wochentage gemittelt)
und SrV 2023 (Berlin 3,3).

| | β je min | Bahnanteil heute | Zonen (davon Umland) |
| --- | ---: | ---: | ---: |
| Hamburg | 0,053 | 33 % | 121 (22) |
| Berlin | 0,060 | 29 % | 130 (33) |

Je Zone werden die mittlere Reisezeit zu allen Stadtteilen (ohne Verbindung
mit 180 Minuten angesetzt) und die in 45 Minuten erreichbaren Einwohner und
Arbeitsplätze ausgewiesen, je Relation Reisezeit, Umstiege, Fahrten und
gewonnene Stunden.

**Neue Fahrgäste** sind die Einsteiger über dem heutigen Netz, höchstens
aber so viele, wie die Fahrten tragen, die nach dem Wahlmodell neu auf die
Bahn wechseln, umgerechnet mit den heutigen Einsteigern je Fahrt. Die
Schranke ist nötig, weil jede Station ihren Einzugsbereich zählt, als läge
keine andere in der Nähe: Zwei Straßenbahnhalte zwischen Holstenwall und
Neustadt, in einem Gebiet, das die U-Bahn bereits erschließt, ergaben sonst
8 200 neue Einsteiger am Tag und ein Nutzen-Kosten-Verhältnis von fast vier.
Aus den neuen Fahrgästen folgen die ersetzten Autofahrten und die
zusätzlichen Fahrgeldeinnahmen.

Auch das ist **kein vollständiges Verkehrsmodell**: Es gibt keine
Kapazitätsrestriktionen, kein Straßennetz und keine Wegeketten.

---

## 6. Nutzen

Sieben Posten, jeder mit ausgewiesener Grundlage:

| Posten | Rechnung |
| --- | --- |
| Reisezeit | eingesparte Personenstunden × 8,64 €/h, neue Fahrten nur zur Hälfte |
| Produktivität | Elastizität 0,04 auf die *relative Wegeverkürzung* der Erwerbstätigen im Einzugsbereich |
| Straßenentlastung | vermiedene Pkw-km × 0,108 €/km |
| Unfälle | × 0,111 €/km |
| Luft und Lärm | × 0,019 €/km |
| Klima | (0,168 kg/Pkw-km − Bahnstrom) × 877 €/t |
| Gesundheit | 0,015 € je Einsteiger für den Fußweg |
| Standort | 4,5 % Bodenwertzuwachs, annuisiert |

Zeitwert (6,60 €/h), Unfallkosten (8,5 ct/Pkw-km), CO₂-Ausstoß (127 g direkt
und 41 g Vorkette je Pkw-km) und CO₂-Preis (670 €/t) stammen aus der
Standardisierten Bewertung 2016+, Preisstand 2016. Weil das Modell in Preisen von
2026 rechnet, werden sie mit dem Verbraucherpreisindex umgerechnet (2016 = 95,0,
2025 = 121,9, 2026 mit 2 % fortgeschrieben): Faktor 1,309. Stau, Luft und Lärm
sowie Gesundheit und Standort sind eigene Ansätze.

Ausgewiesene Unsicherheit: ±35 %.

---

## 7. Fiskaleffekt

Bewusst getrennt vom Nutzen — Wohlfahrtsgewinne sind kein Geld in einer Kasse.
Besteuert wird nur der **produktive** Teil: die Produktivitätswirkung plus 35 %
der Reisezeitgewinne (der geschäftliche und Pendleranteil).

Die Sonderrolle als Stadtstaat ist berücksichtigt — sie gilt für beide Städte:
Sie erhalten den Landesanteil (42,5 %) **und** den Gemeindeanteil (15 %) der
Einkommensteuer, von der Gewerbesteuerumlage den Landesanteil, sodass nur der
Bundesvervielfältiger von 14,5 Punkten abfließt (§ 6 GemFinRefG; Hamburg bei
470 % Hebesatz 96,9 %, Berlin bei 410 % 96,5 %), und über den Länderanteil der
Umsatzsteuer den Einwohnerschlüssel des jeweiligen Landes — Hamburg 2,24 %,
Berlin 4,43 % des Länderaufkommens, denn Berlin hat knapp doppelt so viele
Einwohner. Der Schlüssel steht deshalb je Stadt unter `modelParams` in
`data/cities/<id>.json`, nicht als Konstante im Modell. Dazu Grundsteuer auf den
Bodenwertzuwachs und Grunderwerbsteuer auf den jährlich umgeschlagenen Anteil.

Die Förderfähigkeit nach GVFG-Bundesprogramm wird an ein Nutzen-Kosten-
Verhältnis über 1,0 geknüpft und mit 75 % Bundesanteil ausgewiesen, dem
Höchstsatz für Neu- und Ausbau. Für Reaktivierungen wie die Siemensbahn sieht
das Gesetz bis zu 90 % vor, was das Modell nicht unterscheidet.

---

## 8. Betrieb

Zug-Kilometer aus Taktfolge, Betriebszeit und Linienlänge; Kosten je Zug-km
11,40 € (Straßenbahn) bis 19,60 € (S-Bahn); Infrastrukturunterhalt je km nach
Bauweise; Stationsbetrieb nach Lage; Erlöse aus Fahrten × 1,05 €.

Der Erlös je Einsteiger folgt dem Lagebericht 2025 der HOCHBAHN (596 Mio. €
Erlöse aus dem Personennahverkehr bei 552 Mio. Fahrgästen, also 1,08 €). Die
drei Kostensätze sind gemeinsam so skaliert, dass das heutige Hamburger Netz
bei den beobachteten Fahrgastzahlen den Kostendeckungsgrad erreicht, den die
HOCHBAHN für 2025 ausweist (75,3 %): das Modell kommt auf 76 % bei
−189 Mio. € im Jahr. Für Berlin ergeben dieselben Sätze 62 %.

Ein negatives Betriebsergebnis ist im deutschen ÖPNV der Normalfall. In die
Barwertrechnung geht nur ein, um wie viel sich das Betriebsergebnis gegenüber
dem heutigen Netz verändert, denn das Defizit der bestehenden Linien entsteht
unabhängig davon, ob etwas gebaut wird.

---

## 9. Barwertrechnung

Realer Diskontsatz 1,7 %, 30 Jahre nach Eröffnung, Nachfrageanlauf über
4 Jahre, Restwert 25 % der Investition. Ausgewiesen werden Barwert,
Nutzen-Kosten-Verhältnis, Amortisationsjahr und die Jahresreihe.

Ein Szenario, das nichts baut, hat keinen Barwert — dort steht null, nicht der
Barwert des laufenden Betriebs.

---

## 10. Versionierung

Jedes Szenario speichert `calculationVersion` (derzeit 0.18.0), einen
`parameterFingerprint` über die tatsächlichen Kennwerte und
`dataVersion` (2026-09). Ändern sich die Modelle, bleiben veröffentlichte
Ergebnisse unverändert; die Neuberechnung ist ein ausdrücklicher Schritt, und
der Server rechnet beim Veröffentlichen selbst nach, statt den Angaben des
Clients zu glauben.

Das Szenario trägt auch den **Parametersatz**, mit dem es gerechnet wurde.
Kommt in einer neuen Modellversion ein Parameter hinzu, fehlt er in jedem
älteren Dokument — deshalb ist jeder Parameterblock beim Einlesen
nachsichtig: Was fehlt, bekommt den heutigen Standardwert, was da ist, behält
seinen gespeicherten. Ohne das ließen sich ältere Entwürfe weder öffnen noch
forken.
