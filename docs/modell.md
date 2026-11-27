# Modelle

Da jeder Wert dieser Anwendung eine Schätzung ist, beschreibt dieses Dokument,
wie die Schätzungen zustande kommen und wo sie an ihre Grenzen stoßen.
Sämtliche Parameter stehen in `rust/core/src/params.rs` und werden als Daten
mit einem gespeicherten Szenario mitgeführt.

---

## 1. Automatische Stationen

Da der Nutzer Infrastruktur und keine Haltestellen zeichnet, entstehen die
Stationen eines gezeichneten Korridors in zwei Schritten.

Die **Kandidaten** stammen aus vier Quellen, nämlich den beiden Endpunkten,
die immer gesetzt sind, den Bestandsstationen im Umkreis von 300 m als
Umsteigepunkten, den Landmarken im Umkreis von 500 m und einem Raster im
halben Zielabstand, das die verbleibenden Lücken füllt. Jeder Kandidat erhält
eine Bewertung, die sich aus seinem entfernungsgewichteten Einzugsbereich und
Zuschlägen für Umstieg und Landmarkengewicht zusammensetzt.

Jeder Punkt, den die zeichnende Person gesetzt hat, bleibt erhalten, weil ein
Klick als Anweisung und nicht als Anregung verstanden wird, sodass das Modell
nur darüber entscheidet, welche Stationen **dazwischen** hinzukommen.

Die **Auswahl** erfolgt durch ein dynamisches Programm entlang der Linie, in
dem der Wert einer Station ihre Bewertung **abzüglich 0,42** ist, also
abzüglich dessen, was eine Station mindestens wert sein muss, um gebaut zu
werden, während jeder Abstand `1,1 · ((d − Ziel)/Ziel)²` kostet und
zusätzliche Strafen ober- und unterhalb der erlaubten Spanne anfallen.
Abstände unter 60 % des Minimums sind ausgeschlossen. Auf diese Weise entsteht
keine Station allein deshalb, weil eine feste Distanz erreicht ist, und ein
wichtiges Ziel kann den gewöhnlichen Abstand überstimmen.

| Verkehrsmittel | Ziel | Minimum | Maximum | Dehnung im Freien |
| --- | ---: | ---: | ---: | ---: |
| U-Bahn | 1 000 m | 550 m | 2 200 m | × 1,35 |
| S-Bahn | 1 900 m | 900 m | 4 200 m | × 3,0 |
| Straßenbahn | 450 m | 300 m | 900 m | × 1,2 |
| Regionalbahn | 4 500 m | 2 000 m | 9 000 m | × 3,5 |

Weil die Zielabstände **für die Stadt** gelten und eine Linie ins Umland mit
ihnen alle 1,9 km einen Halt im freien Feld erhielte, dehnt sich die gesamte
Spanne mit abnehmender Besiedlung entlang jedes Abschnitts:

```
Dehnung = √(Referenzeinwohner / Einzugsbereich)   begrenzt auf [1, Modewert]
```

Der Faktor wird über alle Kandidaten zwischen zwei Halten gemittelt, sodass er
sich stetig verändert, statt zwischen Stadt und Land umzuschalten. Eine U-Bahn
dehnt sich kaum, da dieses Verkehrsmittel nur dort vorkommt, wo die Stadt
dicht ist, während eine S-Bahn nach Kiel bis auf Dorfabstände gedehnt wird. Für
einen 86 km langen Korridor von Hamburg nach Kiel ergeben sich auf diese Weise
22 Halte, unter anderem in Kattendorf, Hartenholm, Heidmühlen, Latendorf,
Groß Kummerfeld, Bissee und Boksee, statt 52 Halten abseits jeder Siedlung.

Die **Benennung** folgt der Reihenfolge, in der deutsche Haltestellen
tatsächlich benannt werden, also zuerst einer stadtweit bekannten Landmarke
wie einem Flughafen, einer Universität oder einem Stadion, andernfalls der
Straße, an der die Station liegt, dann dem Stadtteil und zuletzt einer
kleineren öffentlichen Einrichtung. Namen, die ein Verkehrsbetrieb nicht auf
ein Schild schreiben würde, etwa von Vereinen, Kanzleien oder Galerien, sowie
alle Namen mit mehr als 26 Zeichen werden bereits beim Import aussortiert.
Kommt ein Name entlang einer Linie zweimal vor, erhält der zweite Halt seinen
nächstbesten Namen statt einer angehängten Ziffer. Da der Datensatz außerhalb
Hamburgs keine Straßenkorridore enthält, greift dort als letzte Stufe der
nächstgelegene benannte Ort im Umkreis von 4,5 km, gewichtet nach Größe und
Entfernung.

Setzt der Nutzer einen Punkt genau auf eine Bestandsstation, übernimmt der
Halt deren Namen, Knoten und Umsteigebeziehung, während die geklickte Position
erhalten bleibt.

---

## 2. Kosten

Die Kosten werden abschnittsweise und nie pauschal je Kilometer Linie
berechnet:

```
Abschnitt = Kennwert(Bauweise) × km
          × Gleisfaktor × (1 + 0,30 · Dichteindex) × Baugrundfaktor
          + Wasserquerung(€/m) × nasse Meter
```

Stationen kosten nach der **tatsächlichen** Bauweise der Kanten, die sie im
Szenario bedienen, sodass eine Straßenbahnhaltestelle über einem geplanten
U-Bahnhof den Preis einer Haltestelle kostet, solange die U-Bahn nicht Teil
des Szenarios ist. Umsteigebauwerke kosten das 1,45-Fache, und eine
Bestandsstation, die eine neue Linie mitbedienen soll, kostet 35 % eines
Neubaus.

Hinzu kommen Planung (12 %), Projektsteuerung (4 %), Grunderwerb und Leitungen
(3 bis 7,5 % je nach Bauweise), Fahrzeuge und Betriebshöfe, die aus Taktfolge
und Umlaufzeit und nicht pauschal gerechnet werden, eine Risikovorsorge von 15
bis 25 % sowie die Baupreisentwicklung bis zur Mitte der Bauzeit mit 2 % im
Jahr.

Als Kennwerte für 2026 gelten, je Kilometer Doppelgleis, unter anderem
105 Mio. € für einen bergmännischen Tunnel, 82 Mio. € für die offene Bauweise,
45 Mio. € für eine Hochlage, 26 Mio. € für eine oberirdische Strecke,
14 Mio. € für eine Straßenbahn auf eigenem Bahnkörper und 6,5 Mio. € für die
Ertüchtigung einer Bestandsstrecke. Eine tiefe Station kostet 215 Mio. €, eine
in offener Bauweise 125 Mio. €, eine oberirdische 16 Mio. € und eine
Straßenbahnhaltestelle 0,85 Mio. €.

Ein Umsteigezuschlag fällt nur dort an, wo tatsächlich eine **andere** Linie
hält, weshalb die fünf Baustufen der U5 als eine Linie und nicht als fünf
gelten. Eine Verzweigung wird nur dort berechnet, wo sich das Gleis einer Linie
tatsächlich teilt, sodass die Unterquerung der U3 durch die U5 als Umstieg und
nicht als Abzweig zählt. Fahrzeuge werden je Linie und nicht je Bauabschnitt
beschafft.

Kalibriert ist das Kostenmodell an der U5 Ost, dem Abschnitt der U5 von City
Nord bis Jarrestraße, der U4 zur Horner Geest und der S4 Ost, was
`npm run engine:calibrate` nachprüft, während `hh audit <projekt>` jede
einzelne Position zeigt.

Ausgewiesen wird stets eine **Spanne**, die von ±20 % bei der Straßenbahn bis
±32 % beim Tunnelbau reicht, weil ein einzelner Wert eine Genauigkeit
vortäuschen würde, die die Datenlage nicht hergibt.

---

## 3. Bauzeit

Die Bauzeit setzt sich aus Vorplanung, Planfeststellung, Entwurfs- und
Ausführungsplanung, Vergabe, Bau und Inbetriebnahme zusammen, wobei die
vorderen Phasen mit der Projektgröße wachsen und die Genehmigung zu 55 %
parallel zur Planung läuft.

```
Bauzeit = Einrichtung + (Σ Jahre/km + Σ Jahre/Station) / Baufelder
Baufelder = clamp(1, 5·p, Länge / 4 km · p)
p         = 1 − Korridoranteil · (1 − 0,35)
```

Daher wächst die Bauzeit unterlinear, sodass 25 km nicht das Fünffache von
5 km dauern. Der Faktor `p` bremst diesen Effekt dort, wo unter laufendem
Betrieb gebaut wird, weil fünf gleichzeitige Baustellen auf freier Strecke
vernünftig sind, in einer Strecke, die weiterhin Züge trägt und deshalb nur in
Sperrpausen bearbeitet werden kann, jedoch nicht. Eine Trasse, die vollständig
im Bestandskorridor liegt, behält gut ein Drittel der Parallelität.

Abschnitte, die bereits im Bau sind, überspringen Planung und Genehmigung, und
ist zusätzlich ein `constructionStartYear` bekannt, werden die bereits
verstrichenen Baujahre abgezogen, höchstens jedoch vier Fünftel, da eine
Strecke im Bau definitionsgemäß nicht fertig ist.

---

## 4. Baubarkeit

Statt einer Antwort mit Ja oder Nein liefert das Modell Befunde mit Begründung
und Schweregrad, die Bogenradien unter dem Mindestmaß des Verkehrsmittels,
Gewässerquerungen nach Länge, Hauptgewässer und Eignung der Bauweise,
Straßenbahnen ohne Straßenkorridor, Straßenbahnen im Mischverkehr auf
autobahnähnlichen Straßen, offene Bauweise in dichter Bebauung, zu enge
Stationsabstände, unterbrochene Laufwege und unvereinbare Verkehrsmittel auf
gemeinsamem Gleis betreffen.

Der Schweregrad wird auf die Projektgröße bezogen, sodass zwei Befunde auf
40 km weniger wiegen als zwei auf 2 km. Offene Bauweise durch ein Gewässer und
ein Verkehrsmittel auf unvereinbarem Gleis schließen ein Vorhaben aus.

Geprüft werden Geometrie, Gewässer, Bauweise und Netzlogik, während
**Baugrund und Leitungslage nicht geprüft** werden.

---

## 5. Nachfrage und Erreichbarkeit

Die **Einsteiger je Station** ergeben sich aus dem entfernungsgewichteten
Einzugsbereich:

```
Gewicht(Zelle) = exp(−1,6 · d / Radius),  d ≤ Radius
Einsteiger = k(Modus) × (Einwohner + 1,35 × Arbeitsplätze)
             × 1,55 (Umstieg) × 1,35 (Innenstadt)
```

Die Radien betragen 800 m für die U-Bahn, 1 000 m für die S-Bahn und 500 m für
die Straßenbahn. Der Faktor `k` ist so kalibriert, dass das heutige Netz die
Fahrgastzahlen ergibt, die die Verkehrsunternehmen für 2025 veröffentlicht
haben, wobei diese als Jahreswerte vorliegen und deshalb mit den 305
Werktagsäquivalenten des Modells umgerechnet werden:

| | veröffentlicht | Modell | `k` U-Bahn / S-Bahn / Straßenbahn |
| --- | ---: | ---: | --- |
| Hamburg | 571 Mio. (U-Bahn 291 Mio., S-Bahn rund 280 Mio.) | 572 Mio. | 0,55 / 0,80 / 0,40 |
| Berlin | 1 249 Mio. (U-Bahn 556 Mio., Straßenbahn 211 Mio., S-Bahn rund 482 Mio.) | 1 241 Mio. | 0,38 / 0,62 / 0,40 |

Die Raten für U- und S-Bahn sind je Stadt bestimmt, während die Rate der
Straßenbahn aus Berlin stammt, weil sich nur dort eine Straßenbahn beobachten
lässt. Als Quellen dienen der Lagebericht 2025 der HOCHBAHN, die Daten und
Fakten der S-Bahn Hamburg, „BVG in Zahlen 2025“ und das Unternehmensprofil der
S-Bahn Berlin.

Die **Erreichbarkeit** wird aus dem Netzgraphen berechnet und nicht
angenommen. Für jedes der 14 Beschäftigungszentren wird mit dem
Dijkstra-Verfahren über das Szenarionetz gerechnet, wobei ein
Umsteigezuschlag von 5 Minuten, eine Zugangswartezeit von 3 Minuten und die
Haltezeiten einfließen. Für jede bewohnte Rasterzelle wird anschließend die
beste Kombination aus Fußweg zur Station und Fahrt zu jedem Zentrum bestimmt,
gewichtet mit den Arbeitsplätzen des Zentrums. Diese Erreichbarkeit der
Zentren wird zwar ausgewiesen, trägt den Nutzen aber nicht mehr, weil sie
Fahrten zwischen zwei Stadtteilen, von denen keiner ein Zentrum ist, nicht
erfasst.

Die **Verbindungen**, die seit Modell 0.17.0 berechnet werden, messen, wie
schnell jeder Stadtteil jeden anderen einschließlich der Umstiege erreicht:

* Als **Zonen** dienen die Stadtteile und darüber hinaus Kacheln von 5 km im
  Umland, die jeweils die Einwohner und Arbeitsplätze der in ihnen liegenden
  Rasterzellen tragen und nach dem bedeutendsten Ort in ihnen benannt sind.
  Da sie nur von den Daten abhängen, nutzen beide Seiten eines Vergleichs
  dieselben Zonen.
* Die **Fahrten** werden von jeder Zone, die eine Station in höchstens 1,2 km
  Fußweg hat, zu jeder anderen Zone gesucht und umfassen Fußweg, Warten,
  Fahrt, Umstieg und erneuten Fußweg von Tür zu Tür.
* Die **Wahl** von Ziel und Verkehrsmittel folgt einem Logit-Modell, in dem
  ein Ziel mit seinen Einwohnern und Arbeitsplätzen anzieht und mit der
  Reisezeit abstößt, während alle anderen Verkehrsmittel einen festen Nutzen
  haben.
* Der **Nutzen** ist die Änderung der Logsumme, sodass Fahrgäste, die ohnehin
  fahren, die volle Ersparnis und neu gewonnene etwa die Hälfte erhalten. Ein
  Anteil an Neuverkehr wird nicht gesondert angenommen, und
  Verschlechterungen zählen negativ.

Zwei Größen eichen das Modell am heutigen Netz. Der Nutzen der anderen
Verkehrsmittel ist so gesetzt, dass die vorhergesagten Fahrten die heutigen
Einsteiger ergeben, und die Zeitempfindlichkeit so, dass die Nachfrage mit
einer Elastizität von −0,5 auf die Fahrzeit reagiert, wie Balcombe u. a.
(2004, TRL593, §3.2.4 und §6) es für den städtischen ÖPNV angeben. Die Zahl
der Wege je Person und Tag stammt für Hamburg aus MiD 2023 (3,0, über alle
Wochentage gemittelt) und für Berlin aus SrV 2023 (3,3).

| | β je min | Bahnanteil heute | Zonen (davon Umland) |
| --- | ---: | ---: | ---: |
| Hamburg | 0,053 | 33 % | 121 (22) |
| Berlin | 0,060 | 29 % | 130 (33) |

Je Zone werden die mittlere Reisezeit zu allen Stadtteilen, bei der fehlende
Verbindungen mit 180 Minuten angesetzt werden, sowie die in 45 Minuten
erreichbaren Einwohner und Arbeitsplätze ausgewiesen, je Relation außerdem
Reisezeit, Umstiege, Fahrten und gewonnene Stunden.

Als **neue Fahrgäste** gelten die Einsteiger über dem heutigen Netz, höchstens
jedoch so viele, wie die Fahrten tragen, die nach dem Wahlmodell neu auf die
Bahn wechseln, umgerechnet mit den heutigen Einsteigern je Fahrt. Diese
Schranke ist erforderlich, weil jede Station ihren Einzugsbereich so zählt, als
läge keine andere in der Nähe, weshalb zwei Straßenbahnhalte zwischen
Holstenwall und Neustadt, in einem Gebiet, das die U-Bahn bereits erschließt,
ohne sie 8 200 neue Einsteiger am Tag und ein Nutzen-Kosten-Verhältnis von
fast vier ergaben. Aus den neuen Fahrgästen folgen die ersetzten Autofahrten
und die zusätzlichen Fahrgeldeinnahmen.

Auch dieser Ansatz ist **kein vollständiges Verkehrsmodell**, da er weder
Kapazitätsgrenzen noch ein Straßennetz noch Wegeketten berücksichtigt.

---

## 6. Nutzen

Der Nutzen setzt sich aus den folgenden Posten zusammen, deren Grundlage
jeweils ausgewiesen wird:

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
und 41 g in der Vorkette je Pkw-km) und CO₂-Preis (670 €/t) stammen aus der
Standardisierten Bewertung 2016+ mit dem Preisstand 2016. Da das Modell in
Preisen von 2026 rechnet, werden sie mit dem Verbraucherpreisindex
umgerechnet, der 2016 bei 95,0 und 2025 bei 121,9 lag und für 2026 mit 2 %
fortgeschrieben wird, woraus sich der Faktor 1,309 ergibt. Stau, Luft und
Lärm, Gesundheit und Standort beruhen auf eigenen Ansätzen.

Die Produktivitätswirkung bewertet jeden Erwerbstätigen mit der
Wertschöpfung, die in seiner Stadt je Erwerbstätigem entsteht. Sie betrug 2025
in Hamburg 152.295 Mio. € bei 1.370.500 Erwerbstätigen, also 111.100 €, und in
Berlin 197.529 Mio. € bei 2.195.000 Erwerbstätigen, also 90.000 €
(Statistikamt Nord, Statistik informiert Nr. 16/2026 und 56/2026; Amt für
Statistik Berlin-Brandenburg, P I 1 – j/25). Die Werte sind in Preisen von
2025 angegeben und werden nicht fortgeschrieben.

Die ausgewiesene Unsicherheit beträgt ±35 %.

---

## 7. Fiskaleffekt

Der Fiskaleffekt wird bewusst vom Nutzen getrennt, weil Wohlfahrtsgewinne
kein Geld in einer öffentlichen Kasse sind. Besteuert wird nur der
**produktive** Teil, der aus der Produktivitätswirkung und 35 % der
Reisezeitgewinne besteht, also dem Anteil der Geschäfts- und Pendelwege.

Berücksichtigt ist die Sonderrolle als Stadtstaat, die für beide Städte gilt.
Beide erhalten den Landesanteil (42,5 %) **und** den Gemeindeanteil (15 %) der
Einkommensteuer sowie von der Gewerbesteuerumlage den Landesanteil, sodass nur
der Bundesvervielfältiger von 14,5 Punkten abfließt (§ 6 GemFinRefG), was in
Hamburg bei einem Hebesatz von 470 % einen verbleibenden Anteil von 96,9 % und
in Berlin bei 410 % von 96,5 % ergibt. Über den Länderanteil der Umsatzsteuer
erhalten sie außerdem den Anteil nach dem Einwohnerschlüssel des jeweiligen
Landes. Den Ländern standen 2025 nach § 1 FAG 48,85 % des
Umsatzsteueraufkommens zu (151.520 von 310.206 Mio. €), davon Hamburg
3.385 Mio. € oder 2,23 % und Berlin 6.701 Mio. € oder 4,42 % (Bericht der
Bundesregierung zum Finanzkraftausgleich 2025, BT-Drs. 21/6860, Tabellen 2 und
4a). Der Finanzkraftausgleich selbst bleibt unberücksichtigt. Der Schlüssel
steht je Stadt unter `modelParams` in `data/cities/<id>.json` und nicht als
Konstante im Modell.

Die Grundsteuer wächst nur, soweit ihre Bemessung nach Landesrecht dem Wert
folgt. Da Hamburg sie nach Fläche und Wohnlage erhebt (Hamburgisches
Grundsteuergesetz), erhöht ein Wertzuwachs sie nicht, weshalb das Modell 0 %
ansetzt. Berlin wendet dagegen das Bundesmodell mit einer Messzahl von 0,31 ‰
für Wohngrundstücke und einem Hebesatz von 470 % an. Weil der Ertragswert einer
Wohnung dort mit der Mietniveaustufe für ganz Berlin gerechnet wird und nur
der abgezinste Bodenwert der Lage folgt, setzt das Modell 0,03 % des
Wertzuwachses im Jahr an, wobei diese Schätzung erst mit der nächsten
Hauptfeststellung wirksam würde. Die Grunderwerbsteuer beträgt in Hamburg seit
2023 5,5 % und in Berlin seit 2014 6,0 % und fällt auf den Anteil der
Grundstücke an, der jährlich den Eigentümer wechselt (3,5 %).

Für den Satz der Lohn- und Einkommensteuer von 18,5 % der zusätzlichen
Wertschöpfung fehlt bislang eine Quelle, wie `docs/backlog.md` vermerkt.

Die Förderfähigkeit nach dem GVFG-Bundesprogramm wird an ein
Nutzen-Kosten-Verhältnis über 1,0 geknüpft und mit einem Bundesanteil von 75 %
ausgewiesen, dem Höchstsatz für Neu- und Ausbau. Für Reaktivierungen wie die
Siemensbahn sieht das Gesetz bis zu 90 % vor, was das Modell nicht
unterscheidet.

---

## 8. Betrieb

Die Zugkilometer ergeben sich aus Taktfolge, Betriebszeit und Linienlänge und
kosten zwischen 11,40 € je Zugkilometer bei der Straßenbahn und 22,10 € bei der
Regionalbahn. Hinzu kommen der Unterhalt der Infrastruktur je Kilometer nach
Bauweise und der Stationsbetrieb nach Lage, während die Erlöse mit 1,05 € je
Fahrt angesetzt werden.

Dieser Erlös je Einsteiger liegt etwas unter den 1,08 €, die sich aus dem
Lagebericht 2025 der HOCHBAHN ergeben, der 596 Mio. € Erlöse aus dem
Personennahverkehr bei 552 Mio. Fahrgästen ausweist. Die drei Kostensätze
sind gemeinsam so skaliert, dass das heutige Hamburger Netz bei den
beobachteten Fahrgastzahlen den Kostendeckungsgrad erreicht, den die HOCHBAHN
für 2025 ausweist (75,3 %), wobei das Modell auf 76 % bei einem Ergebnis von
−189 Mio. € im Jahr kommt. Für Berlin ergeben dieselben Sätze 62 %.

Da ein negatives Betriebsergebnis im deutschen ÖPNV der Regelfall ist, geht in
die Barwertrechnung nur ein, um wie viel sich das Betriebsergebnis gegenüber
dem heutigen Netz verändert, weil das Defizit der bestehenden Linien
unabhängig davon entsteht, ob etwas gebaut wird.

---

## 9. Barwertrechnung

Gerechnet wird mit einem realen Diskontsatz von 1,7 % über 30 Jahre nach der
Eröffnung, mit einem Anlauf der Nachfrage über 4 Jahre und einem Restwert von
25 % der Investition. Ausgewiesen werden Barwert, Nutzen-Kosten-Verhältnis,
Amortisationsjahr und die Jahresreihe.

Ein Szenario, das nichts baut, hat keinen Barwert, weshalb dort null und nicht
der Barwert des laufenden Betriebs steht.

---

## 10. Versionierung

Jedes Szenario speichert die `calculationVersion` (derzeit 0.19.0), einen
`parameterFingerprint` über die tatsächlich verwendeten Kennwerte und die
`dataVersion` (2026-09). Ändern sich die Modelle, bleiben veröffentlichte
Ergebnisse unverändert, da die Neuberechnung ein ausdrücklicher Schritt ist
und der Server beim Veröffentlichen selbst nachrechnet, statt den Angaben des
Clients zu vertrauen.

Das Szenario trägt außerdem den **Parametersatz**, mit dem es gerechnet wurde.
Da ein Parameter, der in einer neuen Modellversion hinzukommt, in jedem
älteren Dokument fehlt, wird jeder Parameterblock beim Einlesen nachsichtig
behandelt, sodass fehlende Werte den heutigen Standardwert erhalten und
vorhandene ihren gespeicherten behalten. Ohne diese Regel ließen sich ältere
Entwürfe weder öffnen noch als Grundlage eigener Entwürfe übernehmen.
