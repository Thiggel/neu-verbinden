# Backlog

Alles, was auffällt: Fehler, offene Prüfungen, Ideen. Erledigtes bleibt mit
Datum stehen, damit nachvollziehbar ist, was schon geprüft wurde.

Legende: **[F]** Fehler · **[P]** zu prüfen · **[I]** Idee/Verbesserung

## Offen

### Modell und Daten
* **[P]** Die übrigen Steuersätze des Fiskaleffekts haben noch keine Quelle:
  Einkommensteuer 18,5 % der Wertschöpfung, Länderanteil an der Umsatzsteuer
  45,9 %, Grundsteuer 0,35 % und Wertschöpfung je Erwerbstätigem 92.000 €.
  Bei der Einkommensteuer ist zu entscheiden, ob der Durchschnittssatz gilt,
  der nach grober Überschlagsrechnung deutlich unter 18,5 % liegen dürfte, oder
  ein Grenzsatz, weil zusätzliche Wertschöpfung höher besteuert wird als die
  bestehende. Der
  Länderfinanzausgleich bleibt unberücksichtigt, was in der Erklärung stehen
  sollte.

* **[F]** Ein veröffentlichter Entwurf mit abgeschaltetem Bestand steht in den
  Ranglisten neben Entwürfen, die auf dem vollen Netz aufbauen. "S4 Ringbahn"
  hat deshalb ein Nutzen-Kosten-Verhältnis von −0,19 und liegt auf der
  Bestenliste ganz unten, obwohl der Entwurf selbst nichts damit zu tun hat: er
  wurde mit vierzehn abgeschalteten Bestandslinien veröffentlicht. Erklärt wird
  das inzwischen auf der Planseite und vor dem Veröffentlichen gewarnt. Offen
  bleibt, ob solche Entwürfe überhaupt in derselben Rangliste stehen sollten,
  denn verglichen wird dort Ungleiches.

* **[P]** Die U5 City Nord–Jarrestraße eröffnet im Modell 2040 gegen
  veröffentlichte 2035 — untersucht, **bewusst nicht geändert.**

  Die Bauzeit beträgt 7,3 Jahre für 2,29 km, und das liegt fast ganz an den
  Stationen: 4,8 der 5,8 reinen Baujahre sind Stationsjahre (zwei neue
  Tiefbahnhöfe zu je 2,0 Jahren plus der Umbau am Borgweg). Alles davon läuft
  hintereinander, weil die Zahl der Baufelder allein aus der *Länge* kommt —
  2,29 km / 4 km ergibt weniger als eins, also ein Feld. Physikalisch ist das
  falsch: zwei Tiefbahnhöfe 1,4 km auseinander sind zwei Baustellen.

  Die naheliegende Verbesserung — Baufelder auch aus der Stationszahl — habe
  ich durchgerechnet und verworfen. Bei einer Station je Feld sinkt der
  Abschnitt auf 3,9 Jahre, aber die **U5 Ost** von 8,8 auf 4,2 Jahre; bei 1,5
  Stationen je Feld auf 5,1 gegen 5,5. In jeder Variante wird die U5 Ost um
  zwei bis viereinhalb Jahre schneller — und die liegt heute bei **+1 Jahr**
  (2033 gegen 2032), die U4 Horner Geest bei +2. Aus einer kleinen
  Überschätzung würde so eine ähnlich große Unterschätzung; getauscht wäre nur
  das Vorzeichen. (Genau trifft derzeit die S4 Ost: 2032 gegen 2032.)

  Offen bleibt damit, woher die Differenz kommt: entweder rechnet das Modell
  Vorlauf und Bau für kurze, stationsdichte Abschnitte zu lang, oder der
  Termin 2035 ist optimistisch. Beides ließe sich nur mit mehr Referenzen
  klären — kurze U-Bahn-Abschnitte mit veröffentlichtem Termin, aus Berlin,
  München oder Nürnberg. Bis dahin steht die Abweichung sichtbar in der
  Kalibrierung.
* **[P]** Preisstand fehlt noch für U5 Ost (2,6 Mrd. €), U5 City
  Nord–Jarrestraße (1,5 Mrd. €) und S4 Ost (2,1 Mrd. €) — zu erheben aus den
  Bürgerschafts-Drucksachen. Das Feld und die Auswertung stehen bereits.
* **[I]** Amtlichen Baupreisindex hinterlegen (Destatis, Ingenieurbau), damit
  eine ältere Angabe auf heutige Preise umgerechnet statt nur beschriftet wird.
  Die Vorausannahme des Modells (2 %/Jahr) taugt dafür nicht: die deutschen
  Baupreise sind 2021–2023 sprunghaft gestiegen. Die Jahreswerte stehen weder
  auf den Übersichtsseiten von Destatis noch bei der Bundesarchitektenkammer —
  sie liegen in **GENESIS-Online, Themenbereich 61261** (Basis 2021 = 100,
  Erhebungsmonate Februar, Mai, August, November). Von Hand geschätzte Werte
  kommen hier ausdrücklich nicht in Frage: ein erfundener Index wäre genau der
  Fehler, der bei der U4-Zahl gerade behoben wurde.
* **[I]** Zensus-2022-Gitter statt OSM-Einwohnerzahlen für die Region.
* **[F]** Veröffentlichte Entwürfe nach einer Datenberichtigung. Wird
  bestehende Strecke im Datenstand verschoben, ohne dass sich dessen Kennung
  ändert, führt ein älterer Entwurf Abschnitte als bestehend, die das heutige
  Netz nicht mehr trägt. Anzeigen lässt er sich weiterhin (`showDocument`),
  bearbeiten und neu veröffentlichen nicht (`loadDocument` und der Server
  lehnen ab). Nach dem Start sollte jede Berichtigung deshalb einen neuen
  Datenstand bekommen; die Beispiele müssen nach den Korrekturen dieses Laufs
  mit `npm run examples:seed` neu angelegt werden.

* **[F]** Der Modellvorschlag Harburg–Winsen–Lüneburg hieß S5, obwohl die
  S5 nach Stade fährt. Weil die Fahrzeugkosten je Liniennamen berechnet
  werden, zählte das Modell beide Linien als einen Betrieb, und die Karte
  zeigte zwei verschiedene Linien unter demselben Namen. Der Vorschlag heißt
  jetzt S8, und ein Test hält fest, dass kein Vorschlag einen vergebenen
  Liniennamen trägt.


### Karte
* **[F]** `map.loaded()` bleibt auf dieser Karte dauerhaft `false`, obwohl der
  Stil geladen ist und alles zeichnet. Alles, was auf `load` wartet, wartet
  darum für immer: der Bildausschnitt einer Planseite wurde so gesetzt und lief
  nie. Vermutlich meldet sich eine leere GeoJSON-Quelle nie als geladen, wovor
  `basemap.ts` an anderer Stelle schon warnt und wogegen dort `placeholder()`
  steht. Ungeklärt ist, welche Quelle es ist; bis dahin gilt: keinen Code an
  `load` oder `idle` hängen.

### Oberfläche
* **[F]** Auf einem breiten Bildschirm gab es keinen sichtbaren Weg, eine
  gezeichnete Linie abzuschließen: „Punkt zurück / Abbrechen / Fertig" standen
  nur im Telefon-Layout, und Doppelklick, Enter und Esc nannte die Oberfläche
  nirgends. Behoben, und von `test:browser` abgedeckt.
* **[F]** Die Sprungmarke „Zur Karte" rief `focus()` auf
  `.maplibregl-canvas-container` auf. Der Behälter ist nicht fokussierbar,
  MapLibre gibt das `tabindex` der Leinwand darin. Die Marke sah also richtig
  aus, las sich richtig vor und brachte niemanden irgendwohin. Behoben.
* **[F]** Ein veröffentlichter Entwurf ohne Neubau zeigte eine leere Karte: die
  neue „nur die neuen Strecken"-Ansicht filterte alles weg, und ein vorzeitiges
  `return` beim Bildausschnitt übersprang zusätzlich das Zeichnen ganz. Jetzt
  bekommt so ein Entwurf das Bestandsnetz.

### Recht
* **[P]** Das Impressum nennt die Wohnanschrift einer Privatperson. Zulässig und
  bewusst so entschieden, aber nicht die einzige Möglichkeit: § 5 DDG verlangt
  eine ladungsfähige Anschrift, nicht die eigene Wohnung. Eine Zustelladresse
  oder ein Verein als Träger wären ein Einzeiler in `impressum.ts` und hielten
  die Adresse aus der Öffentlichkeit. Siehe `docs/recht.md`.
* **[P]** Verträge zur Auftragsverarbeitung (Art. 28 DSGVO) mit Hosting- und
  Datenbankanbieter fehlen, ebenso ein Verzeichnis von Verarbeitungstätigkeiten
  (Art. 30) und ein Löschkonzept für verwaiste Konten. Einzelheiten in
  `docs/recht.md`.

### Sicherheit
* **[F]** Kommentare eines Entwurfs waren ohne Sichtbarkeitsprüfung abrufbar.
  Kommentieren ist auf privaten Entwürfen gesperrt, der Lesepfad sah deshalb
  sicher aus. Sichtbarkeit ist aber nicht endgültig: veröffentlichen,
  diskutieren, wieder auf privat stellen, und der Entwurf antwortete 404,
  während Text und Verfassername jedem mit dem Slug offenstanden, auch ohne
  Anmeldung. Behoben und in `test:security` festgehalten.

* **[T]** `test:security` prüft echte Limits und unterliegt ihnen selbst: zehn
  Registrierungen je Adresse und Stunde, vierzig Entwürfe. Zweimal hintereinander
  gestartet, meldete der Lauf bis zu sechzehn rote Zeilen, darunter *SQL-Meta-
  zeichen im Slug öffnen nichts* — was nach einem Einbruch aussieht und eine
  gedrosselte Vorbereitung war. Ein unerwartetes 429 gilt jetzt als *nicht
  geprüft*, und ein Lauf, der mehr als ein Drittel übersprungen hat, endet mit
  Fehlercode statt mit einer grünen Zahl. Offen bleibt, wie der Lauf ohne
  Datenbankzugriff wiederholbar wird: mit `HH_TEST_DB` ließen sich die Limits
  zwischen den Läufen zurücksetzen und die dort übersprungenen Prüfungen
  liefen mit.

* **[P]** Die Profilseite zeigt für *jeden* Namen ein Profil, auch für nicht
  vergebene — sie fragt nur nach Entwürfen, nicht nach dem Konto. Das ist
  einerseits unsauber („@gibtesnicht" sieht aus wie eine Person ohne Entwürfe),
  andererseits verhindert genau das die Aufzählung von Kontonamen. Eine
  Unterscheidung bräuchte einen Endpunkt, der Existenz preisgibt — abzuwägen,
  nicht nebenbei zu entscheiden.
* **[P]** Gegen einen *geduldigen* Angreifer, der über Tage hinweg langsam
  Konten anlegt, gibt es weiterhin nichts — und ohne Identitätsprüfung kann es
  das auch nicht geben. Die Ranglisten sind damit von jemandem mit genug Zeit
  beeinflussbar. Das ist ein Grund mehr, dass die Anwendung mehrere Ranglisten
  zeigt statt einer Gesamtpunktzahl; ob darüber hinaus etwas nötig ist, ist eine
  Produktentscheidung.

### Berlin
* **[P]** Die kuratierte Berliner Vorhabenliste umfasst vier Projekte
  (`data/curated/projects-berlin.json`). Mit Quelle belegt und noch nicht
  aufgenommen: Straßenbahn Turmstraße–Jungfernheide (3,8 km, 2031), Pankow–
  Pasedagplatz (5,1 km, 2031), Blankenburger Süden (3,2 km, 2032), Ausbau
  Mahlsdorf (1,6 km) und der zweite Abschnitt der S21. U7 Rudow–BER und U7
  Heerstraße Nord sind Studien ohne Beschluss. Der U8-Bahnhof „Wesendorfer
  Straße" ist belegt, lässt sich aus den Straßendaten aber nicht als eigener
  Standort auflösen.
* **[P]** Das Hamburger Netz enthält die S7, die es nur bis zum 12.12.2026
  gibt. Mit dem nächsten Datenstand entfällt sie.
* **[P]** Die Straßenbahnstudie behält die U5 bis Borgweg bei; im Szenario
  endet sie an der City Nord, weil der Abschnitt City Nord–Jarrestraße nur als
  Ganzes vorliegt. Er ließe sich am Borgweg teilen.
* **[P]** Der Berliner **U6** fehlen die fünf nördlichen Stationen von
  Alt-Tegel bis Scharnweberstraße: 24 statt 29 Halte. Nachgeprüft und
  eingegrenzt:

  * Beide U6-Relationen führen dieselben 24 Halte, und ihre Gleismitglieder
    enden ebenfalls bei 52,5635 — die Relation ist nicht nur in der Haltefolge
    unvollständig, sondern auch in der Geometrie. Die `to`-Angabe nennt trotzdem
    Alt-Tegel.
  * Die fünf Stationen **sind** in `berlin-stations` mit Koordinaten vorhanden;
    sie fallen nur heraus, weil keine Linie sie bedient.
  * Die Gleise fehlen auch im allgemeinen Bahndatensatz: im Umkreis von 800 m um
    Alt-Tegel liegen nur die Kremmener Bahn und etwas `light_rail`, kein
    `subway`. Ein Nachtragen bräuchte also einen eigenen Overpass-Abruf für den
    Korridor **und** einen Mechanismus für kuratierte Netzkorrekturen.

  Nicht gemacht, weil der Aufwand für den Nordzipfel einer Linie in keinem
  Verhältnis steht; der richtige Ort für die Korrektur ist ohnehin OSM selbst.

  Nebenbei: eine schnelle Prüfung „Endpunkt aus `from`/`to` nicht unter den
  Halten" meldete 54 Hamburger und 240 Berliner Relationen. Das ist **kein**
  Befund — eine Linie wird aus mehreren Relationsvarianten zusammengesetzt, und
  die fertigen Linien stimmen (U1 Norderstedt Mitte – Großhansdorf mit 44
  Halten, U2 Mümmelmannsberg – Niendorf Nord mit 25). Die Prüfung taugt nur je
  Variante, nicht je Linie.
* **[P]** Im Modell erschließt keine innerstädtische Berliner Linie *neue*
  Einwohner: der 1 200-m-Einzugsbereich deckt die Innenstadt bereits
  vollständig ab, die U10 kommt auf exakt null neu erschlossene Menschen. Das
  ist plausibel — der Nutzen liegt dort in der Reisezeit, nicht in der
  Erschließung — macht aber das Brett „Günstigste Erschließung" für Berlin
  leer. Zu prüfen, ob 1 200 m für eine so dichte Stadt zu großzügig ist.

* **[P]** Das Modell rechnet für die *beschlossenen* Vorhaben (S4, U4, U5) ein
  NKV von 0,30. Diese Projekte sind beschlossen und gefördert, was nach
  amtlicher Methode ein NKV über 1,0 voraussetzt. Der Erklärtext nennt 0,30
  jetzt ausdrücklich als Bezugspunkt statt als Absage, und ein Test hält Text
  und Modell zusammen. Offen bleibt die eigentliche Frage: die
  veröffentlichten Nutzen-Kosten-Untersuchungen zu U5 und S4 beschaffen und
  Posten für Posten vergleichen, statt den Faktor drei zu vermuten.

* **[P]** Die mittlere Detailstufe deckt vierzehn Orte ab, nicht die Strecken
  dazwischen. Zwischen den Orten bleibt es bei Flüssen, Wäldern und
  Bundesstraßen. Zu prüfen, ob ein schmaler Streifen entlang der Korridore
  selbst noch etwas bringt oder nur Daten kostet — Ackerland sieht auch mit
  Feldwegen wie Ackerland aus.

* **[P]** Zwei Advisories bleiben offen: postcss innerhalb von Next
  (Path-Traversal über `sourceMappingURL`, XSS beim CSS-Stringify). Behebbar nur
  mit Next 16. Zu entscheiden, ob der Hauptversionssprung jetzt sinnvoll ist —
  betroffen ist die Verarbeitung eigener Stylesheets, nicht fremder Eingaben.


## Erledigt

* **[F]** 2026-11-27 Zahlen in den Erläuterungstexten des Rust-Kerns, etwa in
  den Grundlagenzeilen des Fiskaleffekts, standen mit Dezimalpunkt („2.31 %“),
  während die Oberfläche das Komma verwendet. Kosten, Wirkung, Machbarkeit und
  Bauablauf formatieren sie jetzt über `fmt::de` deutsch („2,31 %“, „1.500 m“).

* **[F]** 2026-11-27 Gewerbesteuer im Fiskaleffekt, Modell 0.18.0. Angesetzt
  waren 4,8 % der Wertschöpfung ohne Quelle, und die Erklärung behauptete, ein
  Stadtstaat führe keine Umlage ab. Beides war falsch:
  * **Satz** ist jetzt das tatsächliche Aufkommen je Euro Bruttowertschöpfung:
    Hamburg 2,31 % (2025: 3.514 Mio. € auf 152.295 Mio. €, Statistikamt Nord,
    Statistik informiert Nr. 52/2026 und 56/2026), Berlin 1,67 % (3.302 Mio. €
    auf 197.529 Mio. €, Amt für Statistik Berlin-Brandenburg, L II 7 – j und
    P I 1 – j/25).
  * **Umlage:** Stadtstaaten behalten den Landesanteil, führen aber den
    Bundesvervielfältiger von 14,5 Punkten ab (§ 6 Abs. 3 GemFinRefG). Bei
    Hebesätzen von 470 % und 410 % bleiben 96,9 % und 96,5 % in der Stadt. Den
    Abfluss bestätigt der Berliner Haushalt 2024 mit 262 Mio. €
    Gewerbesteuerumlage.
  * Beide Werte stehen je Stadt unter `modelParams`, und die Erklärung nennt
    sie aus den Stadtparametern statt als feste Zahl.

* **[F]** 2026-11-27 Verbindungen zwischen Stadtteilen und Umland, Modell
  0.17.0. Der Reisezeitnutzen kam vorher nur aus der Erreichbarkeit von 14
  Zentren, sodass eine direkte Linie zwischen zwei Stadtteilen, die heute
  zwei Umstiege brauchen, kaum zählte. Jetzt:
  * **Zonen** sind die Stadtteile und 5-km-Kacheln im Umland (Hamburg 121,
    davon 22 im Umland; Berlin 130, davon 33).
  * **Fahrten** von Tür zu Tür zwischen allen Zonen, mit Umstiegen und
    Wartezeit, aus der Routensuche über das Szenarionetz.
  * **Wahl** von Ziel und Verkehrsmittel als Logit, geeicht auf die heutigen
    Einsteiger und eine Fahrzeitelastizität von −0,5 (Balcombe u. a. 2004,
    TRL593); der Nutzen ist die Änderung der Logsumme.
  * **Wegezahl** je Person und Tag: Hamburg 3,0 (MiD 2023, Kurzbericht
    Hamburg,
    https://www.hamburg.de/resource/blob/1132384/df391ad7f5773fe715e834e4926039e6/mid2023-kurzbericht-hamburg-data.pdf),
    Berlin 3,3 (SrV 2023, Steckbrief Berlin,
    https://www.berlin.de/sen/uvk/_assets/verkehr/verkehrsdaten/zahlen-und-fakten/mobilitaet-in-staedten-srv-2023/srv_2023_berlin_steckbrief.pdf).
  * **Oberfläche:** Reiter „Verbindungen“ mit den am stärksten beschleunigten
    und verlangsamten Relationen und der mittleren Reisezeit je Stadtteil,
    wahlweise mit Umland.
  * Die beschlossenen Hamburger Vorhaben kommen damit auf ein
    Nutzen-Kosten-Verhältnis von 0,58 (vorher 0,65); die Summen werden in
    fester Reihenfolge gebildet, sodass ein Szenario mit sich selbst
    verglichen genau gleich ausfällt.
  * **Neue Fahrgäste** sind höchstens so viele, wie die vom Wahlmodell neu
    gewonnenen Fahrten tragen, weil die Einzugsbereiche benachbarter
    Stationen sich überlappen und ein Stummel von 190 m sonst 8 200 neue
    Einsteiger und ein Nutzen-Kosten-Verhältnis von 3,9 erhielt; die
    Vorlagen beider Städte ändern sich dadurch nicht.
* **[F]** 2026-11-26 Faktenprüfung aller Eingangsdaten gegen Primärquellen,
  Modell 0.16.0. Was sich geändert hat:
  * **Einwohner Berlin** kommen jetzt aus der Einwohnerregisterstatistik des
    Amts für Statistik (97 Ortsteile, 3 913 644 zum 31.12.2025) statt aus
    Wikidata (3 639 138). Ortsteile mit mehreren Flächen in OSM wurden doppelt
    gezählt (98 statt 97).
  * **Arbeitsplätze** sind die Erwerbstätigen am Arbeitsort 2025: Hamburg
    1 370 200 (vorher 1 280 000), Berlin 2 196 500 (vorher 1 690 000, was den
    sozialversicherungspflichtig Beschäftigten entsprach).
  * **Umsatzsteuerschlüssel** 2,24 % und 4,43 % statt 2,45 % und 4,65 %.
  * **Wertansätze** aus der Standardisierten Bewertung 2016+, auf Preise von
    2026 umgerechnet: Zeitwert 8,64 €/h (vorher 11,20), CO₂ 877 €/t (vorher
    300), Unfälle 0,111 €/Pkw-km (vorher 0,033), 168 g CO₂ je Pkw-km (vorher
    145).
  * **Nachfrage** war auf „1,3 bis 1,5 Mio. Einsteiger je Werktag“ geeicht,
    wofür es keine Quelle gibt. Veröffentlicht sind Jahreswerte: Hamburg 571
    Mio. (U-Bahn 291, S-Bahn rund 280), Berlin 1 249 Mio. (U-Bahn 556,
    Straßenbahn 211, S-Bahn rund 482). Darauf sind die Raten jetzt je Stadt
    kalibriert; das Modell lag vorher 36 % (Hamburg) und 23 % (Berlin) darunter.
  * **Betriebskosten** sind auf den Kostendeckungsgrad der HOCHBAHN (75 %,
    2025) kalibriert; der Erlös von 1,05 € je Einsteiger hat sich am
    Lagebericht bestätigt (1,08 €).
  * **Bewertung:** Einem Vorhaben wurde das Betriebsdefizit des *gesamten*
    Netzes angelastet, also auch das der Linien, die heute schon fahren. Jetzt
    zählt nur die Veränderung gegenüber dem heutigen Netz. Berlins Vorhaben
    kamen dadurch auf 0,13 statt 0,86.
  * **`hh simulate`, `audit` und `bench`** rechneten jede Stadt mit Hamburgs
    Parametern; nur der Import nahm die der Stadt.
  * **Hamburger Vorhaben:** U5 Ost 2,86 Mrd. € und 2033 (vorher 2,6 Mrd., 2032);
    Stationsfolge der U5 nach aktuellem Stand ohne Jungfernstieg und Mundsburg,
    mit Beethovenstraße, St. Georg, Stephansplatz, Grindelberg, UKE,
    Sportplatzring und Lurup Mitte; Barmbek Nord lag an der U3-Haltestelle
    Habichtstraße, 1,2 km neben dem geplanten Standort. U4 Horner Geest 561
    Mio. € (vorher 465 mit Preisstand 2018). U4 zum Moldauhafen Ende 2031
    (vorher 2035) und als Brücke und Viadukt statt als Tunnel. S4 mit allen 16
    Halten ab Hauptbahnhof, 1,847 Mrd. € (vorher 2,1), Baubeginn 2021 (vorher
    2023).
  * **Straßenbahn:** Die gezeigten vier Linien waren eine freie Rekonstruktion,
    die mit der Studie nur die Eckdaten gemein hatte. Jetzt sind es die vier
    Korridore der Studie mit ihren Haltestellen (44,3 km gegen 43,7 km).
  * **S6 nach Lübeck:** Die Trasse lief bei Bad Oldesloe 3,5 km zurück und über
    Lübeck Hbf hinaus, 9 km zu viel; dazu fünf erfundene Zwischenhalte.
  * **Berliner Vorhaben:** Siemensbahn ist nicht im Bau, sondern in
    vorgezogenen Maßnahmen; U8-Kosten als Medienangabe gekennzeichnet; das
    Zitat „nicht valide vorhersagbar“ zur Straßenbahn Ostkreuz war nicht
    belegbar und ist entfernt; U3 zum Mexikoplatz ergänzt.
  * **Browsertests** lasen ein privates Feld von MapLibre, dessen Form sich mit
    Version 6 geändert hat, und liefen deshalb alle in die Zeitüberschreitung.

* **[+]** Wunschkarte (`/wuensche`, `GET /api/wuensche/:city`). Alle
  veröffentlichten Entwürfe einer Stadt übereinandergelegt, gerastert auf 300 m,
  gewichtet mit `1 + ln(1 + Stimmen + Forks)`. Gezählt wird nur, was gebaut
  würde: ein Entwurf trägt das Bestandsnetz mit sich, und das mitzuzählen ergäbe
  eine Hitzekarte der Bahn, die längst fährt. Die Seite lädt bewusst nur die
  Grundkarte, nicht den Rechenkern und nicht das Einwohnerraster, weil sie
  nichts rechnet.


* **[F]** Eine Verlängerung einer bestehenden Linie hängte die neuen Abschnitte
  an diese Linie an. Damit gehörte sie zum Bestand: sie stand nicht unter
  „Eigener Entwurf", und sie ließ sich nicht abschalten, um zu sehen, was sie
  für sich genommen bringt. Sie ist jetzt eine eigene Linie mit `extends` auf
  die fortgesetzte Route. Der Reisezeitgraph rechnet sie unter der Kennung der
  Mutterlinie, sonst hätte die Fuge fünf Minuten Umsteigezeit gekostet und eine
  durchgehende Fahrt wäre als Umstieg bewertet worden. Ein zweites Weiterbauen
  am selben Ende verlängert dieselbe Verlängerung, statt eine Abzweigung zu
  erzeugen. Bestehende gespeicherte Entwürfe ändern sich nicht: ohne `extends`
  rechnet der Graph wie zuvor, was `model_baseline` bestätigt.


* **[P→erledigt]** 2026-09-03 Die Zusage „der Editor funktioniert auch ohne
  Server" bei abgeschaltetem API-Server nachgeprüft — sie hält. Der Editor lädt
  vollständig: Rechenkern, Karte, 77 Linien, laufende Kennzahlen. Die
  Entdecken-Seite sagt „Der Server ist nicht erreichbar", erklärt, was ohne ihn
  geht, und bietet den Weg zum Editor an. Eine Entwurfsseite unterscheidet
  „Gerade nicht abrufbar" von „Nicht gefunden" — der Unterschied steht so im
  Code und stimmt auch.

  Ebenfalls geprüft und in Ordnung: ein abgelaufenes Anmelde-Merkmal führte zu
  einem 401 je Seitenaufruf, wird aber beim ersten Fehlschlag verworfen. Das war
  eine Folge meiner eigenen Aufräumarbeit, kein Fehler.

* **[F]** Die Deckkraft der Straßen war eine ungültige MapLibre-Angabe: ich
  hatte eine Zoom-Interpolation in ein `case` geschachtelt, und Zoom muss dort
  außen stehen. MapLibre verwirft dann die ganze Eigenschaft. Das war das
  „1 Issue", das seit dem Einbau in der Ecke stand und das ich mehrfach
  übersehen habe, während ich nach anderem suchte — eine Meldung, die immer da
  ist, liest man irgendwann nicht mehr. Klassenprüfung jetzt innerhalb der
  Stützstellen. *(2026-09-03)*

* **[F]** Die neue mittige Kopfzeile war auf dem Telefon nicht mittig: die vier
  Bedienelemente rechts sind breiter als ein Drittel einer 375-px-Leiste, also
  schob das Dreispaltenraster den Titel nach links, und es sah schlicht kaputt
  aus. Unter `sm` jetzt eine gewöhnliche Zeile mit dem Titel am Anfang, ab `sm`
  mittig. Auf 375 px kein Überlauf mehr. *(2026-09-03)*

* **[F]** Die Entdecken-Seite stand auf „Alle Städte", und damit rankten die
  Bretter mit absoluten Größen im Kern die Stadtgröße — Berlin erreicht mehr
  Menschen als Hamburg, bevor jemand etwas gezeichnet hat. Sie öffnet jetzt in
  der Stadt, in der zuletzt gearbeitet wurde; „Alle" bleibt und ist zum Stöbern
  auch richtig, nur eben nicht für eine Rangliste. *(2026-09-03)*

* **[F]** Der Rückstand selbst hat jetzt eine Prüfung. Zweimal hat ein
  skriptgesteuerter Eingriff die Überschrift „Erledigt" mitgelöscht, was den
  *nächsten* Einfügeversuch stillschweigend wirkungslos machte — die Einträge
  waren weg, ohne dass irgendetwas fehlschlug. Geprüft werden jetzt beide
  Überschriften, ihre Reihenfolge, Einträge ohne Aufzählungszeichen und
  abgeschlossene Punkte, die noch unter „Offen" stehen. Gegengeprüft, indem die
  Überschrift entfernt wurde. *(2026-09-03)*

* **[F]** Berlin führte **fünf** Knoten namens „Ostkreuz", zwei davon an
  identischen Koordinaten; Hamburg zwei „Sengelmannstraße". Der Abgleich
  gleichnamiger Stationen strich nur eine feste Liste von Klammerzusätzen
  (Nord|Süd|Ost|West|oben|unten|U|S) — „(Ringbahn)" und „(Ostbahn)" standen
  nicht darin. Eine Klammer hinter einem Stationsnamen sagt, welcher Bahnsteig,
  nicht welche Station; jetzt zählt jeder abschließende Klammerzusatz. Die 450 m
  bleiben die Grenze: gleicher Name und weiter auseinander heißt weiter zwei
  Stationen. Vorher gemessen, was das zusammenlegt — 21 Paare, darunter
  „Bernau" ↔ „Bernau (bei Berlin)" (18 m) und „Südkreuz (Ringbahn)" ↔
  „(Nord-Süd)" (31 m), alle richtig.

  Dazu die Regel für kuratierte Vorhaben: ein als *neu* geführter Halt direkt
  auf einer Bestandsstation **ist** diese Station. Die bisherige Unterscheidung
  ist bei 194 m richtig — der neue Siemensbahn-Halt neben dem U7 ist ein zweiter
  Bahnsteig — und bei null Metern falsch. Unter 40 m wird wiederverwendet.

  Hamburg 261 → 256 Stationen, Berlin 666 → 658, keine Dubletten unter 60 m mehr.
  *(2026-09-03)*

* **[F]** Dabei brach der Berlin-Import ganz ab: „Kante hat eine ungültige
  Länge". Zwei Halte an derselben Stelle ergeben einen Abschnitt von null
  Metern, den die Netzprüfung zu Recht verweigert. Drei Stellen konnten das
  erzeugen — Zeichnen im Editor, Verbinden zweier Knoten, Vorhaben-Import —, alle
  drei überspringen jetzt einen Abschnitt ohne Länge. Die Meldung nennt
  außerdem die beiden Stationen statt nur einer Kantennummer: „zwischen Ostkreuz
  und Ostkreuz" sagt sofort, was los ist. *(2026-09-03)*

* **[P→erledigt]** 2026-09-03 Nach dem Datenumbau vermutet, gespeicherte
  Entwürfe seien veraltet — sie tragen andere Stationszahlen als das neue Netz.
  Nachgeprüft: nein. Ein veröffentlichtes Dokument enthält sein *eigenes* Netz
  und seine eigenen Parameter, wird also aus sich selbst gerechnet und bleibt
  reproduzierbar. Ein Datenumbau darf seine Zahlen gar nicht bewegen; die
  erzwungene Neuberechnung aller 65 Einträge bestätigt es.

* **[F]** Der Bezugswert im NKV-Text musste von 0,40 auf 0,42 — die
  Stationszusammenlegung ändert die Stationszahl und damit die Kosten. Vom Test
  gefangen, der Text und Modell zusammenhält. *(2026-09-03)*

* **[I]** Karte deutlich detaillierter, in drei Schritten:

  * **Alle Stationen bekommen Namen.** Beschriftet wurden nur Umsteigepunkte,
    und zwar auf jeder Zoomstufe — 590 von Berlins 666 Stationen blieben damit
    namenlos, egal wie nah man heranging. Ostkreuz, Rummelsburg, Sonntagstraße
    stehen jetzt da. Umsteigepunkte kommen weiterhin zuerst und ab Zoom 12,2,
    gewöhnliche Halte ab 13,6, und das Platzbudget wächst mit der Nähe.
  * **Kleine Straßen**, in einer eigenen Datei, die erst beim Hineinzoomen
    geladen wird (1,9 MB Hamburg, 2,5 MB Berlin). Nicht die namensweise
    zusammengefassten Korridore der Engine: 14 446 davon enthalten Sprünge über
    250 m, gezeichnet hätten sie Striche quer durch die Stadt gezogen.
  * **Straßennamen ab Zoom 15.** Die Rentzelstraße ist eine `secondary`, und die
    Basiskarte hatte alles ab Klasse 2 weggelassen — sie war auf keiner
    Zoomstufe zu finden. Jetzt sichtbar und beschriftet. Ein Name je Straße im
    Bild: je OSM-Weg ein Schild ergab „Rentzelstraße" achtmal nebeneinander.

  *(2026-09-03)*

* **[F]** Beim Veröffentlichen zählten fremde Vorhaben als eigene Leistung.
  „U6 quer durch Eimsbüttel" stand mit 65,6 km und 23,1 Mrd. € in der Liste —
  für **eine** gezeichnete Linie plus acht eingeschaltete Hamburger Vorhaben.
  Jede Zahl auf der Seite und jeder Ranglistenplatz beschrieb damit die Arbeit
  anderer. Der Veröffentlichen-Dialog fragt jetzt, und die Vorgabe ist „nur was
  du gezeichnet hast"; das Bestandsnetz bleibt immer drin, weil es die
  Vergleichsgrundlage ist und nicht als Neubau zählt. Nachgemessen: derselbe
  Entwurf wird jetzt mit 1,81 km und 0,34 Mrd. € gespeichert statt mit 7,8 km
  und 2,77 Mrd. Ein Entwurf ganz ohne eigene Linien — etwa ein Vergleich zweier
  bestehender Konzepte — bleibt unangetastet. *(2026-09-03)*

* **[I]** Die Kopfzeile trägt den Namen der Sache in der Mitte: „[Stadt] neu
  verbinden", mit der Stadt als sichtbar anklickbarem Auswahlfeld statt eines
  Formularelements am Rand. Darunter liegt weiterhin ein echtes `select`, damit
  Tastatur, Screenreader und die Auswahl des Telefons funktionieren.
  *(2026-09-03)*

* **[F]** Die Regionaldetails hatten den **Berlin-Build zerbrochen**: er
  verlangte Rohdaten, die es nur für Hamburg gibt, brach ab — und der
  Veröffentlichungsschritt schrieb daraufhin klaglos ein Manifest mit *einer*
  Stadt. Fehlende Daten sind ein Grund, von einer Stadt weniger zu zeichnen,
  nicht ein Grund, sie nicht zu bauen. *(2026-09-03)*

* **[F]** Ich hatte das Modell heute mehrfach verändert — Reisezeitnutzen über
  beide Raster, „nicht erreichbar" von 75 auf 180 Minuten, keine
  übereinanderliegenden Halte mehr — **ohne die `CALCULATION_VERSION` zu
  erhöhen**. Damit galten alle gespeicherten Ergebnisse als aktuell, obwohl sie
  mit dem alten Modell gerechnet waren: der Vergleich hätte einen frisch
  gerechneten Entwurf gegen einen veralteten gestellt und beide als „dieselbe
  Rechnung" ausgewiesen. Genau dafür gibt es den Mechanismus, und ich bin an ihm
  vorbeigelaufen.

  Aufgefallen beim Gegenrechnen eines Berliner Entwurfs: der Server meldete NKV
  0,0884 und 2,10 Mio. € Fiskaleffekt, dieselbe Rechnung lokal 0,0781 und 0,66
  Mio. — die Investition stimmte, also lag es nicht an den Stadtparametern.

  Jetzt 0.14.0 mit Änderungseintrag; der Worker hat beim Neustart 62 Ergebnisse
  eingereiht und neu gerechnet, der Server stimmt wieder exakt mit einer
  unabhängigen Rechnung überein. Die Kalibrierung wandert dadurch von 11 % auf
  **13 %** größte Abweichung — alle Referenzen bleiben in der ausgewiesenen
  Spanne, die Eröffnungsjahre unverändert. Das kommt vom Ausdünnen der Halte:
  wo zwei Halte zusammenfielen, gibt es jetzt einen, und das verschiebt die
  Stationskosten. *(2026-09-03)*

* **[P→erledigt]** 2026-09-03 Eine Versionserhöhung muss die Parameterdateien
  **jeder** Stadt neu erzeugen; `engine:import` allein macht nur die
  Vorgabestadt, Berlins Datei blieb auf 0.13.0 stehen. Der vorhandene Test
  „Parameter auf dem aktuellen Stand" fängt das je Stadt ab — er hätte es
  gemeldet, bevor irgendetwas ausgeliefert worden wäre.

* **[F]** Derselbe Fehler steckte auch im **Editor**, gefunden beim Absuchen
  danach: er liest die Kennwerte für die Erklärtexte erst *nachdem* ein
  gespeicherter Entwurf wiederhergestellt wurde. Ein alter Entwurf hätte seine
  eigenen Parameter durchgereicht, einer ohne Parameter die eingebauten
  Vorgaben. Beide Seiten benutzen jetzt dieselbe Funktion `cityFiguresFrom`, die
  über `cityParams()` geht. Geprüft: der Editor nennt weiterhin „Hamburger
  Baugrund (+8 %)", die Berliner Entwurfsseite +5 %.

  Der Rest der Absuche war sauber: von den Bausteinen, die öffentliche Seiten
  mit dem Editor teilen, griff nur die Kennzahlentafel auf den Editor-Zustand
  zu, und die Quellenangabe der Teilen-Bilder kommt schon je Stadt aus dem
  Manifest (Berlin „OpenStreetMap-Ortsteildaten", Hamburg „Statistikamt Nord").
  *(2026-09-03)*

* **[F]** Die Erklärtexte auf der Seite eines fremden Entwurfs nannten die
  Kennwerte der **falschen Stadt**: Berlins Seite schrieb „Berliner Baugrund
  (+8 %)" — Hamburgs Zuschlag, Berlins sind +5 % — und den Hamburger
  Umsatzsteuerschlüssel. Zwei Ursachen übereinander:

  * Die Kennzahlentafel liest Stadt und Kennwerte aus dem Editor-Zustand. Auf
    einer fremden Entwurfsseite steht dort, was der *Lesende* zuletzt offen
    hatte, oder nichts. Beides gibt die Seite jetzt mit.
  * Danach stimmte der Name, die Zahlen aber immer noch nicht. Grund:
    `loadDocument` ersetzt die Parameter der Engine bewusst durch die des
    Dokuments, damit ein Entwurf so erscheint, wie sein Autor ihn gerechnet hat
    — und für ein Dokument ohne eigene Parameter sind das die eingebauten
    Vorgaben, also Hamburgs. `engine.params()` beschreibt danach nicht mehr die
    Stadt. Neue Methode `cityParams()` liefert den Satz der Stadt unabhängig vom
    geladenen Dokument.

  Aufgefallen ist es nur, weil der gemeldete Parametersatz die Version 0.12.0
  trug — die zu keiner der beiden Städtedateien passt. Eine Zahl, die zu nichts
  gehört, ist ein besserer Hinweis als eine, die plausibel aussieht.
  *(2026-09-03)*

* **[F]** Ein Berliner Entwurf wies seinen Fiskaleffekt dem „Haushalt Hamburg"
  zu. Die Kennzahlentafel las die Stadt aus dem Editor-Zustand — sinnvoll im
  Editor, falsch auf der Seite eines *fremden* Entwurfs, wo dort steht, was der
  Lesende zuletzt offen hatte, oder nichts. Die Seite gibt jetzt die Stadt des
  Entwurfs mit. Gefunden beim Prüfen der neuen Kartenansicht für Berlin.
  *(2026-09-03)*

* **[P→erledigt]** 2026-09-03 Der soziale Teil jetzt auch **durch die
  Oberfläche** durchgespielt, nicht nur über die API: zustimmen (mit
  Kontoanlage im selben Zug, Passwort mit acht Zeichen), Stimme sichtbar
  gezählt, forken — landet auf der Seite des Forks mit „abgeleitet von" —, und
  vergleichen, das nach dem `populationGain`-Fix wieder eine vollständige
  Gegenüberstellung liefert. Testkonten und Test-Fork wieder entfernt.

* **[F]** Der Vergleich brach mit „Ungültige Daten: missing field
  `populationGain`" ab — und zwar für **jeden** vorhandenen Entwurf. Ich hatte
  das Feld zur Kennzahlenzeile hinzugefügt, ohne zu bedenken, dass Ergebnisse
  *gespeichert* werden: jede Zeile in der Datenbank stammt von vorher und hat es
  nicht. Ohne Vorgabewert scheitert das Einlesen komplett. Jetzt
  `#[serde(default)]`, und ein Test entfernt das Feld aus einem echten Ergebnis
  und verlangt, dass es sich trotzdem lesen lässt — gegengeprüft, er meldet
  denselben Fehlertext. Für jedes künftige Feld gilt dasselbe. *(2026-09-03)*

* **[I]** Auf der Seite eines Entwurfs steht jetzt seine **Karte**. Vorher gab
  es dort Zahlen und eine Kostenaufstellung, aber nicht das, worum es geht — die
  Zeichnung ist das Argument, die Zahlen sind der Beleg. Dieselbe Karte wie im
  Editor, mit dem Ansehen-Werkzeug: schwenken, zoomen, Namen lesen, sonst
  nichts. Engine und Stadtdaten sind je Stadt zwischengespeichert, ein zweiter
  Entwurf derselben Stadt kostet also nur noch sein Dokument. *(2026-09-03)*

* **[F]** Das Story-Format sprengte das Teilen-Fenster: 1080 × 1920 in voller
  Dialogbreite sind über 1100 px hoch, die Knöpfe darunter rutschten aus dem
  Bild und Telegram war nicht mehr erreichbar. Die Vorschau ist jetzt auch in
  der Höhe begrenzt. Mein eigener Fehler, mit dem Story-Format eingeführt.
  *(2026-09-03)*

* **[F]** Die Symbole der sozialen Netze waren Behelfszeichen — „f", „in", ein
  Emoji-Schmetterling für Bluesky — und sahen aus wie Platzhalter, weil sie
  welche waren. Jetzt die echten Marken aus `simple-icons` (CC0), in den
  offiziellen Farben. Nicht importiert, sondern die acht Pfade herausgezogen
  (`tools/build-brand-icons.mjs`): das Paket enthält über dreitausend Symbole.
  LinkedIn fehlt dort seit einer Markenbeschwerde und behält bewusst sein
  Textzeichen statt eines falschen Glyphs. *(2026-09-03)*

* **[F]** Ein zu kurzes Passwort schloss den Dialog und meldete den Fehler erst
  danach, als das Getippte schon weg war. Der Dialog kennt Feldprüfungen jetzt
  und bleibt offen; das Passwortfeld sagt, wie viele Zeichen fehlen. Zugleich
  die Mindestlänge von 10 auf **8** gesenkt: hier wird eine Verkehrskarte
  gezeichnet, ein Konto sorgt dafür, dass ein Entwurf jemandem gehört und eine
  Stimme einmal zählt — begrenzt wird Raten ohnehin durch die Limits (5 je Name
  und Stunde, 10 je Adresse, 300 dienstweit). *(2026-09-03)*

* **[F]** Zustimmen, Forken, Kommentieren und Melden verwiesen auf „Konto oben
  rechts anlegen", während das Veröffentlichen direkt fragte. Alle vier fragen
  jetzt genauso, mit auf den Anlass gemünztem Text („Wer stimmt zu?"). Die
  gemeinsame Funktion liegt in `lib/account.ts`. *(2026-09-03)*

* **[F]** Der Punkt beim Zeichnen lag weiterhin neben dem Zeiger — ein
  **zweiter**, davon unabhängiger Fehler, und diesmal im Layout statt im
  Rechenkern. Die Engine lieferte durchweg die richtige Stelle (gemessen: 0 m
  Abweichung zum Hauptbahnhof-Knoten auf jeder Zoomstufe); gezeichnet wurde sie
  falsch.

  Punkt und Beschriftung zentrieren sich beide mit `-translate-x-1/2`, das um
  die halbe **Eigenbreite** verschiebt. Das stimmt nur, wenn das Element aus
  dem Textfluss genommen ist: der Punkt saß in einem Block, ein Block füllt sein
  umschließendes Element, und das schrumpfte auf sein breitestes Kind — die
  Beschriftung. Der Punkt wanderte also um die halbe *Beschriftung*. Bei
  „Hauptbahnhof · Umsteigepunkt T1 T4" waren das 130 px; die Beschriftung selbst
  saß genau richtig, weil ihre Breite die verwendete war. Je länger der Name,
  desto weiter daneben.

  Beide Kinder sind jetzt absolut positioniert und zentrieren sich um sich
  selbst; nachgemessen: Punktmitte exakt auf dem Ankerpunkt. Ein Test prüft, dass
  jedes zentrierende Element auch `absolute` trägt, und fängt die Rücknahme des
  Fixes.

  Wert festzuhalten: ich hatte den ersten Fehler mit einer Messung *im
  Rechenkern* für erledigt erklärt und nie geprüft, wo der Punkt tatsächlich
  landet. Eine richtige Koordinate ist nicht dasselbe wie ein richtig
  gezeichneter Punkt. *(2026-09-03)*

* **[P→abgewogen]** 2026-09-03 Die *Registrierung* sagt ausdrücklich „Dieser
  Nutzername ist schon vergeben" — ein direkterer Existenzhinweis, als das
  Zeitverhalten der Anmeldung es je war. Das lässt sich nicht abstellen: bei
  öffentlichen, eindeutigen Namen muss man jemandem sagen können, dass sein
  Wunschname weg ist. Begrenzt wird es durch die Limits (5 je Name und Stunde,
  10 je Adresse, 300 dienstweit). Bewusst so belassen.
* **[P→erledigt]** 2026-09-02 Berliner Gewässer und Benennung stichprobenhaft
  geprüft: Großer Müggelsee 7,4 km² (real 7,4), Tegeler See 4,4 (real 4,5),
  Langer See 3,1 (real 3,2). Vier gezeichnete Korridore in Marzahn, Spandau,
  Steglitz und Richtung Potsdam ergeben durchweg echte Berliner Straßen- und
  Ortsnamen (Alt-Marzahn, Cottbusser Platz, Rathaus Spandau, Nikolassee).

* **[F]** Der Rechenkern brauchte im Browser **640 ms** bis zur ersten
  Rechnung. Aufgeschlüsselt: 26 ms Lesen und Parsen, 11 ms Index — und **197 ms
  Wassermaske**, das sind rund 550 ms in WebAssembly. Sie rasterte jede
  Wasserfläche, indem sie für *jede* Zelle im Umgriff `point_in_ring` über den
  ganzen Ring laufen ließ: bei der Elbe rund 900 000 Zellen gegen 200 Punkte.

  Jetzt füllt sie zeilenweise — eine Schnittpunktberechnung je Rasterzeile statt
  je Zelle, gleiche Even-Odd-Regel, gleiche Zellmittelpunkte. Wassermaske
  197 → 4 ms, Start im Browser **640 → 49 ms**. Ein Test prüft Zelle für Zelle
  gegen die ersetzte Regel, an einer absichtlich sperrigen Form mit Einkerbung
  und dünnem Arm; gegengeprüft mit dem klassischen Fehler (vom ersten bis zum
  letzten Schnittpunkt füllen), den er genau in der Kerbe fängt. Dazu ein
  Startzeit-Budget von 250 ms. *(2026-09-03)*

* **[F]** Beinahe eine Engine ausgeliefert, die im Browser beim Start abstürzt:
  die Messung, mit der ich die Wassermaske gefunden habe, benutzte
  `Instant::now()` — das auf `wasm32` mit „time not implemented on this
  platform" abbricht. Im nativen Build lief alles, der Fehler zeigte sich erst
  beim Laden des WASM-Moduls. Die Messung steht jetzt nur noch im CLI, mit einem
  Hinweis an der Stelle im Kern, wo sie verlockend wäre. *(2026-09-03)*

* **[F]** Die Schnellschätzung — die bei *jeder* Zeigerbewegung während des
  Zeichnens läuft — brauchte im Browser **54 ms** auf dem Straßenbahn-Szenario
  und auf „Alles gleichzeitig". Das sind mehr als drei Bilder; Zeichnen auf
  einem großen Netz ruckelte entsprechend.

  Der Test hat es nie gesehen, weil er auf dem *Bestandsnetz* maß und dort 2 ms
  bekam. Das ist wahr und nutzlos: gezeichnet wird auf dem Netz, das jemand
  geladen hat. Ein Budget, das am leichtesten Fall geprüft wird, ist keins — der
  Test misst jetzt das schwerste Szenario, mit 12 ms Grenze.

  Die Ursache fand die nach Posten aufgeschlüsselte Messung in `hh bench`
  (Bauzeit · Kosten · Baubarkeit): 17 der 20 ms steckten in der
  Baubarkeitsprüfung. Sie fragt je 250 m Straßenbahn nach der nächsten Straße,
  und die Umkreissuche entfernte Doppeltreffer mit `Vec::contains` — einer
  linearen Suche über eine wachsende Liste. In der Innenstadt umfasst eine
  400-m-Abfrage neun Zellen mit je einigen hundert Straßen, also
  hunderttausende Vergleiche pro Aufruf. Jetzt ein Markierungsfeld statt der
  Liste, und die Klassenprüfung *vor* der Doppeltreffer-Prüfung: was nicht in
  Frage kommt, muss nicht gemerkt werden.

  Baubarkeit 17,0 → 3,1 ms, Schnellschätzung im Browser 54,3 → 5,4 ms, volle
  Rechnung 33,0 → 18,8 ms, Snapping 0,18 → 0,11 ms. Dieselbe Suche steckte in
  drei Methoden (Straße, Straße nach Klasse, Schiene); alle drei sind ersetzt.
  *(2026-09-03)*

* **[P→erledigt]** 2026-09-03 Kompletter Nutzerweg zum ersten Mal **durch die
  Oberfläche** durchgespielt, nicht über die API: Begrüßung, Verkehrsmittel
  wählen, mit echten Klicks zeichnen, per Doppelklick abschließen, rückgängig
  und wiederholen über die Knöpfe, Halt entfernen, veröffentlichen, Konto dabei
  anlegen, Teilen-Blatt. Alles funktioniert; der Entwurf kam mit denselben
  Zahlen auf dem Server an, die die Oberfläche zeigte (119,3 km neu, NKV 0,28).
  Testkonto und Testentwurf wieder entfernt.

  Drei Dinge sahen dabei nach Fehlern aus und waren keine — festgehalten, damit
  sie nicht noch einmal verfolgt werden:

  * **Enter schloss die Linie nicht ab.** Die Automatisierung schickt ein
    Tastenereignis mit **leerem** `key`; die App ignoriert es zu Recht. Mit
    einem echten Ereignis (`key: 'Enter'`) wird sofort übernommen.
  * **Das Löschwerkzeug tat nichts.** Der Klick lag auf der
    Entwurfsleiste, die über der Karte liegt. Genau gezielt entfernt es den
    Halt. Bestandsstationen bleiben unangetastet — auch richtig.
  * **Das Teilen-Blatt schien durchsichtig.** Ein Bild mitten in der 200-ms-
    Blende. Zwei Sekunden später steht das Feld deckend.

  Dazu die Umrechnung, die jedes Mal nötig ist: der Bildschirmabzug ist 800×450,
  das Fenster 1280×720 — Faktor 0,625. Ein Klick auf Bildschirmabzug-Koordinaten
  ohne diese Umrechnung landet 60 % daneben.

* **[F]** Instagram fehlte beim Teilen — ausgerechnet das zuerst genannte
  Netzwerk. Es nimmt als einziges keine Beiträge aus dem Browser entgegen, es
  gibt also keinen Intent-Link. Ein Knopf, der so tut, wäre schlimmer als keiner:
  der Instagram-Knopf bereitet jetzt das Bild vor und reicht es weiter — auf dem
  Handy über das Teilen-Menü, in dem Instagram steht, am Rechner als Download.
  *(2026-09-03)*

* **[F]** Das Format 1080 × 1350 war als „Story" beschriftet und ist keine: als
  Story hochgeladen bekommt es graue Balken oben und unten. Es heißt jetzt
  „Hochformat" (Instagram-Beitrag), und ein echtes Story-Format 1080 × 1920 ist
  dazugekommen. Ein Test hält Typ, Maße und Auswahlknöpfe zusammen — beide neuen
  Prüfungen wurden gegengeprüft, indem das Format wieder entfernt wurde.
  *(2026-09-03)*

* **[F]** `npm run lint` war keine Prüfung. ESLint war nie installiert, der
  Befehl fiel in den interaktiven Einrichtungsassistenten — und die dreizehn
  `eslint-disable`-Kommentare im Code waren damit reine Dekoration. Jetzt
  eingerichtet, über die ESLint-CLI statt über `next lint` (das mit Next 16
  verschwindet), mit `--max-warnings 0`: der Stand ist null Warnungen, also ist
  jede neue eine Regression. Gegengeprüft, dass der Befehl bei einer
  wiedereingebauten Abweichung mit 1 endet. Hängt jetzt vorn in `npm test`.

  Zwei echte Funde dabei. `scheduleSimulation` rief `showToast` auf, das *nach*
  ihm definiert ist — die fehlende Abhängigkeit war das einzige, was das trug:
  ein Abhängigkeitsfeld wird beim Rendern ausgewertet, ein Verweis nach unten
  hätte in der temporalen Totzone geworfen. Reihenfolge getauscht und
  Abhängigkeit ergänzt. Der zweite war ein Fehlalarm mit echtem Kern:
  `Parameters<typeof ui.setTool>` nennt einen Wert in einer Typposition, was die
  Regel als Abhängigkeit zählt; jetzt über den Store-Typ. *(2026-09-03)*

* **[F]** Next.js stand auf 15.1.6, gegen das eine lange Liste von Advisories
  läuft — darunter kritische: RCE im React-Flight-Protokoll, Umgehung der
  Autorisierung in Middleware, SSRF, Cache-Poisoning, Informationspreisgabe im
  Dev-Server. Auf 15.5.25 gehoben, gezielt statt per `npm audit fix --force`.
  Damit sind das kritische und ein hohes Problem weg. Offen bleiben zwei in
  einem postcss, das Next mitbringt; die wären nur mit Next 16 zu lösen, einem
  Hauptversionssprung. Praktisch geht es dabei um CSS, das wir selbst schreiben,
  nicht um Eingaben von außen. *(2026-09-03)*

* **[F]** Die Karte hörte außerhalb Hamburgs bei Flüssen, Wäldern und
  Bundesstraßen auf — in Lüneburg oder Lübeck stand nur der Ortsname auf leerer
  Fläche. Eine dritte, mittlere Detailstufe ergänzt: Gewässer, Grün, Läufe und
  benannte Straßen in **vierzehn Orten** über 15 000 Einwohner im Umkreis von
  70 km, außerhalb von Hamburgs eigenem Kasten. Bewusst nicht flächendeckend —
  die Region ist dreißigmal so groß wie Hamburgs Kasten; diese vierzehn Boxen
  sind zusammen 725 km², also unter einem Drittel davon, und liegen dort, wo
  jemand hinsieht. Der Datenstand wächst von 17,9 auf 19,4 MB.

  Die 5 129 benannten Ortsstraßen gehen auch in die Benennung ein. Eine
  Straßenbahn durch Lüneburg heißt jetzt Schildsteinweg · Am Weißen Turm ·
  Kalandstraße · Ilmenaustraße · Lüneburg Nord · Meisterweg — vorher hätte sie
  gar keine Straße gefunden. *(2026-09-03)*

* **[F]** Zwei Halte konnten übereinander liegen. Der Mindestabstand wurde
  *entlang der Linie* gemessen, und wo ein Korridor zurückschwenkt — Zulaufgleise
  tun das ständig — lagen zwei Halte 2,24 km Fahrweg und 91 m Luftlinie
  auseinander: „Lübeck Hauptbahnhof" und „Lübeck Hauptbahnhof 2". Das betraf
  nicht nur den Vorschlag, sondern jede selbst gezeichnete Linie mit einer
  Kehre. Aufeinanderfolgende Halte werden jetzt schon bei der Auswahl auch nach
  Luftlinie geprüft, und ein Nachlauf entfernt die übrigen Kollisionen, bei
  denen weitere Halte dazwischenliegen — Bestandsstationen schlagen neue, sonst
  gewinnt das größere Einzugsgebiet. Ringlinien sind ausgenommen: dass sie am
  Ausgangspunkt ankommen, ist ihr Zweck. Engster Abstand auf der S6 jetzt 889 m.
  *(2026-09-03)*

* **[F]** Der Reisezeitnutzen — der größte Posten der Bewertung — wurde nur
  über Hamburgs feinem 200-m-Raster gerechnet, das 21 km vom Zentrum endet. Wer
  außerhalb wohnt, zählte gar nicht. Eine Regional-S-Bahn nach Lüneburg, deren
  ganzer Zweck es ist, Menschen von dort in die Stadt zu bringen, kam damit auf
  **eine** eingesparte Stunde pro Tag bei 20 000 neuen Einsteigern. Beide Raster
  werden jetzt durchlaufen, Zellen des groben nur dort, wo das feine nicht
  greift. *(2026-09-03)*

* **[F]** Der Zuschlag für „gar nicht erreichbar" betrug pauschal 75 Minuten —
  weniger als eine echte Fahrt vom Rand der Region nach Hamburg. Eine Strecke,
  die einen bis dahin unerschlossenen Ort anband, *verschlechterte* damit die
  gemessene Erreichbarkeit: das Modell tauschte einen 75-Minuten-Platzhalter
  gegen eine ehrliche 90-Minuten-Fahrt und las das als Rückschritt. Jetzt 180
  Minuten, und zwar als Konstante: ein aus den Daten abgeleiteter Wert bedeutet
  vor und nach der Maßnahme etwas anderes, und genau das prüft der
  Monotonie-Test, der meinen ersten Versuch sofort abgefangen hat. Als feste
  Obergrenze begrenzt sie zugleich jeden Zellenmittelwert, womit die nötige
  Eigenschaft bewiesen statt gehofft ist. *(2026-09-03)*

* **[F]** Die Stationsbenennung kannte die Bahnhöfe der Region nicht. Eine Linie
  nach Lüneburg bekam Halte wie „Bramweg" und „Hinter der Bahn", während
  Meckelfeld, Winsen und Bardowick — Bahnhöfe an genau dieser Strecke — gar
  nicht in den Daten standen. 467 Regionalbahnhöfe ergänzt, und die Benennung
  fragt sie zuerst. *(2026-09-03)*

* **[F]** `proposals: true` schaltete *alle* Vorschläge zu. Das ging gut, solange
  es einen gab; mit dem zweiten landeten 70 km Regional-S-Bahn im
  Straßenbahn-Szenario, das ausdrücklich Straßenbahn gegen U-Bahn stellt.
  Szenarien nennen jetzt die Vorschläge, die sie meinen. *(2026-09-03)*

* **[F]** Der Vorschlags-Import verwarf eine Linie, die sich nicht zeichnen
  ließ, kommentarlos — der Datensatz hatte dann still eine Linie weniger, als in
  der kuratierten Datei steht. Sagt jetzt, welche und warum. *(2026-09-03)*

* **[I]** Zwei Modellvorschläge ergänzt: S8 (damals S5) Harburg–Winsen–Lüneburg (37,7 km,
  9 Halte) und S6 Bad Oldesloe–Reinfeld–Lübeck (22,7 km). Beide folgen der
  bestehenden Bahnstrecke, beide sind aus mehreren gerechneten Varianten die mit
  dem besten Nutzen-Kosten-Verhältnis. In beiden Korridoren gewinnt der volle
  Weg gegen das kürzere Ende. *(2026-09-03)*

* **[F]** Regionalkarte: Flüsse, Kanäle und Wälder ergänzt, Autobahnen um
  Bundesstraßen erweitert, und die Regionalebenen blenden beim Hineinzoomen
  nicht mehr auf null aus. Sie taten das in der Annahme, die Stadtebenen
  übernähmen — die reichen aber nur bis 10,40° Ost, sodass Zoomen auf Lübeck die
  Karte leerte statt sie zu schärfen. *(2026-09-03)*

* **[F]** Beim Zeichnen sprang der Punkt weit neben den Zeiger und nannte
  „Raster", obwohl der Zeiger genau auf einer Station stand. Ursache war die
  Reihenfolge: die Winkelrasterung lief **vor** dem Fangen, verschob die
  Position um ein paar hundert Meter auf die nächste erlaubte Richtung, und von
  dort aus lag die Station außer Reichweite. Jetzt wird zuerst unter dem Zeiger
  gesucht — Station, Bestandsstrecke, Ort, Straße — und die Winkelhilfe ist,
  was sie sein sollte: die Antwort für freie Fläche. *(2026-09-03)*

* **[F]** „Raster" und „frei" waren interne Begriffe, die niemandem etwas
  sagen. Freie Flächen heißen jetzt „Neuer Halt bei …" mit dem nächsten
  bekannten Ort, Straße oder Stadtteil im Umkreis von 700 m. *(2026-09-03)*

* **[F]** Beschriftungen zitterten beim Ziehen der Karte, aus drei Gründen
  gleichzeitig: sie wurden erst im *nächsten* Frame neu gezeichnet und hingen
  der Karte damit immer ein Bild hinterher; jede Position wurde auf ganze Pixel
  gerundet, sodass benachbarte Namen zu leicht verschiedenen Zeitpunkten um ein
  Pixel sprangen; und die Kollisionsprüfung lief in jedem Frame neu, sodass die
  Auswahl ständig umbrach. Jetzt wird im Render-Frame der Karte positioniert,
  während der Bewegung ohne Rundung, und die Auswahl höchstens alle 400 ms neu
  berechnet. Nebenbei entfällt das Neubauen des Markups je Frame — und mit ihm
  das Escapen, weil die Namen jetzt als Text gesetzt werden. *(2026-09-03)*

* **[F]** Die Schienengeometrie der Engine endete bei 10,41° Ost. Eine
  Regionallinie entlang der bestehenden Strecke nach Lüneburg oder Lübeck sah
  für das Modell nach freiem Feld aus und wurde als Neubautrasse bepreist. Die
  Hauptstrecken der Region sind jetzt mit drin. *(2026-09-03)*

* **[F]** Die Testsuiten mülllten das Projekt zu: 74 Sitzungsdateien im
  Wurzelverzeichnis und 39 Wegwerfkonten in der Datenbank, eines je Lauf des
  Sicherheitstests — auf den Profilseiten von echten Nutzern nicht zu
  unterscheiden. Die Suiten räumen jetzt beides selbst weg, Dateien älter als
  sechs Stunden und Konten älter als eine. Keine verwaisten Fremdschlüssel.
  *(2026-09-03)*

* **[F]** Die vom Nutzer gemeldeten Gewässer waren **nicht** behoben, nur
  unauffällig geworden. Drei Umrisse überschnitten sich selbst — die
  Vereinfachung legte die Uferlinie über sich selbst, sodass Wasser Land
  verschluckt. Die Bauprüfung sah es nicht, weil sie nur die *Fläche* vergleicht
  und ein verknoteter Ring auf der einen Seite verliert, was er auf der anderen
  gewinnt. Douglas–Peucker garantiert Abstand, nicht Topologie. Der Vereinfacher
  halbiert jetzt die Toleranz, bis der Umriss sauber ist, und fällt zur Not auf
  die Originallinie zurück; die Bauprüfung bricht bei jeder Selbstüberschneidung
  ab. *(2026-09-03)*

* **[F]** Dabei kam heraus, dass das *Runden* der Koordinaten selbst der Auslöser
  sein kann: fünf Nachkommastellen verschieben einen Punkt um bis zu einen
  Meter, was zwei knapp aneinander vorbeilaufende Kanten zum Kreuzen bringt. Die
  Prüfung lief vor dem Runden — der Ring war sauber und wurde kaputt
  ausgeliefert. `simplifyRing` rundet jetzt selbst und prüft, was tatsächlich
  gespeichert wird. *(2026-09-03)*

* **[F]** Zwei meiner eigenen Kontrollen prüften nichts. Der Gewässertest las
  `ring[i][0]` auf Punkten der Form `{lon, lat}`, der U5-Test `edge.a`/`edge.b`
  auf Kanten mit `from`/`to` — beide verglichen `undefined` mit `undefined` und
  meldeten „0 Fehler". Beide Nutzermeldungen stehen jetzt als Tests im Datensatz
  (kein Gewässerumriss überschneidet sich selbst; jede Linie jeder Stadt ist eine
  durchgehende Kette), und beide wurden gegengeprüft, indem der Fehler absichtlich
  wieder eingebaut wurde. *(2026-09-03)*

* **[F]** Ranglisten belohnten Nichtstun. Ein 190-m-Straßenbahnstummel — 25
  Mio. €, Eröffnung 2032 — führte „Geringste Investition" und „Schnellste
  Umsetzung" an, und war dort nur durch einen noch kleineren Stummel zu
  schlagen. Eine Mindestlänge hilft nicht, sie verschiebt den Boden nur: es
  gewinnt immer der kleinste noch zugelassene Entwurf. Die beiden Bretter
  messen jetzt maßstabsfreie Größen — „Günstigste Erschließung" (Investition je
  neu erschlossenem Einwohner) und „Schnellster Ausbau" (neue Kilometer je
  Planungsjahr). Als Sortierung auf der Entdecken-Seite bleibt beides erhalten:
  eine Sortierung ordnet, ein Brett zeichnet aus. *(2026-09-03)*

* **[F]** Derselbe Fehler steckte in „Höchster Barwert", gefunden vom neuen
  Test, nicht von mir: kein veröffentlichter Entwurf hat einen positiven
  Barwert, „höchster" hieß also „geringster Verlust", und die −25 Mio. € des
  Stummels schlugen die −5,7 Mrd. € eines echten Netzes. Daraus die allgemeine
  Regel: jedes Brett, dessen Kennzahl negativ werden kann, wird von einem
  Entwurf gewonnen, der nichts tut und null erreicht. Jedes Brett trägt jetzt
  eine eigene Bedingung — es rankt nur Entwürfe, die auf seiner eigenen
  Kennzahl überhaupt punkten — und ein Test erzwingt, dass die Bedingung sich
  auf genau diese Kennzahl bezieht. *(2026-09-03)*

* **[F]** „Erschlossene Einwohner" verglich Entwürfe über die Gesamtzahl des
  fertigen Netzes, in der das Bestandsnetz alles dominiert: der Stummel kam auf
  1,39 Mio. gegen 1,54 Mio. eines 93-km-Umbaus — 90 % der Punktzahl für 0,2 %
  der Arbeit. Neue Spalte `population_gain` (Migration 0005, aus den
  gespeicherten Ergebnissen exakt nachgetragen); Bretter und Sortierung ranken
  den Zuwachs, der Editor zeigt beides nebeneinander. *(2026-09-03)*

* **[F]** Ein leeres Brett meldete „noch leer", auch wo nicht die Einreichungen
  fehlen, sondern die Sache selbst: kein Entwurf trägt sich, keiner erschließt
  neue Einwohner. Steht jetzt so da. *(2026-09-03)*

* **[P→erledigt]** 2026-09-03 Die vier Prüfungen, die bis gestern nicht
  fehlschlagen *konnten*, waren damit auch nie im Fehlerfall gesehen worden —
  repariert heißt noch nicht wirksam. Alle vier einzeln gegengeprüft, indem der
  jeweilige Fehler wieder eingebaut wurde: der Umland-Hinweis (Titel geändert),
  das Markup in `caveat` (Aufruf entfernt), die Unterscheidung leer/nicht
  erreichbar (`ApiUnavailable` ignoriert) und die Sprachprüfung (deutscher
  Kommentar eingefügt). Jede schlägt fehl, jede besteht danach wieder.
  Dazu die beiden Rust-Wächter, die ich *nach* ihrer Reparatur geschrieben und
  daher nie scheitern gesehen hatte: mit `frontsInCorridor: 1.0` meldet der
  Bauzeittest „im Bestandskorridor nicht länger: 3,4 gegen 3,4 Jahre", und ohne
  den Datengrundlagen-Befund meldet der andere „kein Hinweis auf fehlende
  Daten". Beide greifen.
  Bei `tween` waren zwei meiner ersten Mutationen wirkungslos — `painted`
  zurückgeben, wo es gleich `value` ist, ändert nichts. Mit tatsächlich
  verhaltensändernden Mutationen fallen die richtigen Prüfungen um („am Ende
  steht immer der Zielwert", „ohne Bewegung wird sofort der Zielwert gezeigt").
  Eine Mutation, die nichts ändert, beweist nichts — auch das ist eine Art,
  sich selbst zu täuschen.

* **[F]** 2026-09-03 Nach den vier nicht-fehlschlagbaren Prüfungen die
  Sammlungen auf die *anderen* Wege durchgesehen, auf denen eine Prüfung still
  bestehen kann. Gefunden: **vier Abbruchpfade, die als „bestanden" gezählt
  wurden.** Ohne `HH_TEST_DB` überspringen die beiden Prüfungen der dienstweiten
  Limits und die der E-Mail-Spalte ihre Zusicherungen; ohne laufende
  Weboberfläche die des privaten Vorschaubildes. Ein Lauf ohne Datenbankzugriff
  meldete trotzdem „30 bestanden" — voller grüner Haken für drei Prüfungen, die
  nichts angesehen hatten.
  Überspringen ist legitim, es als Bestehen zu zählen nicht. Es gibt jetzt
  `skip(grund)`; die Zusammenfassung schreibt „27 bestanden, 0 fehlgeschlagen,
  3 übersprungen — dieser Lauf hat weniger geprüft, als er könnte".
  Dasselbe in Rust: `monotone_access.rs` überspringt stillschweigend, wenn
  `data/dist` fehlt, damit `cargo test` auf einem frischen Klon läuft. Mit
  `HH_REQUIRE_DATA=1` wird daraus ein Fehler — gegengeprüft: ohne Daten und mit
  Flag schlägt der Test fehl, ohne Flag überspringt er, mit Daten läuft er.

* **[F]** 2026-09-03 **Vier meiner eigenen Prüfungen konnten gar nicht
  fehlschlagen.** Ich wollte die gestern gebrochene Kommentar-Konvention
  maschinell absichern und schrieb dafür eine Prüfung — die sofort bestand,
  auch als ich zur Kontrolle einen deutschen Kommentar einfügte. Ursache war
  nicht die Prüfung, sondern die Sammlung: `check(name, fn)` in
  `test-ui.mjs` und `test-engine.mjs` rief `fn()` **ohne await**. Eine `async`
  Prüfung gab damit ein Promise zurück, das niemand ansah; die Zusicherung darin
  fiel lange nach dem eingetragenen „bestanden", und ihre Ablehnung verlief im
  Nichts.
  Betroffen waren vier Prüfungen, die ich in den letzten Runden hinzugefügt und
  als Absicherung gemeldet hatte: der Hinweis auf das grobe Umlandraster, das
  Markup in den Erläuterungsfeldern, die Unterscheidung „leer" gegen „nicht
  erreichbar" — und ausgerechnet die neue Sprachprüfung selbst. Eine Prüfung,
  die nicht fehlschlagen kann, ist schlechter als keine, weil sie mitgezählt
  wird.
  `check` lehnt jetzt ein zurückgegebenes Promise mit einer klaren Meldung ab,
  daneben gibt es `checkAsync`, das wartet. Beide Wächter gegengeprüft: ein
  eingefügter deutscher Kommentar lässt die Sprachprüfung fehlschlagen, und eine
  `async`-Prüfung an `check` übergeben meldet „würde immer bestehen".
  Die Sprachprüfung fand danach sofort fünf weitere deutsche Kommentare, die
  mir beim Übersetzen von Hand entgangen waren. `test-api.mjs`,
  `test-security.mjs` und `test-flow.mjs` waren nie betroffen — die warten schon
  immer korrekt.

* **[F]** 2026-09-03 **Ich hatte selbst gegen eine dokumentierte Konvention
  verstoßen.** Das README sagt: „Die Oberfläche ist deutsch, der Code und diese
  Dokumentation sind englisch kommentiert." Beim Prüfen der nächsten Zusage
  fiel auf, dass ich im Lauf des Tages an gut zwanzig Stellen deutsche
  Kommentare hinterlassen hatte — in `auth.rs`, `import.rs`, `feasibility.rs`,
  `test-security.mjs`, `test-ui.mjs` und `Welcome.tsx`. Eine Sprachmischung im
  Quelltext ist für jeden Späteren teurer als für mich, und die Regel stand
  ausdrücklich da. Alle übersetzt; zurück bleiben nur englische Kommentare, die
  deutsche Eigennamen oder zitierte Oberflächentexte enthalten — das ist richtig
  so, man muss die Zeichenkette nennen können, über die man spricht.
  Nebenbei ein halbdeutscher Satz im Quelltext repariert („it is the trägers own
  claim") und ein übrig gebliebener deutscher Kommentar in `test-engine.mjs`,
  der schon vorher dort stand.

* **[P→erledigt]** 2026-09-03 Zwei weitere Zusagen nachgeprüft. **Wahr:** „Der
  Server lehnt Szenarien mit fremdem Datenstand ab, statt sie stillschweigend
  umzurechnen" — live bestätigt, ein Dokument mit Datenstand 1999-01 bekommt
  400 mit beiden Ständen im Klartext.
  **Nicht ganz wahr:** „Jede Zahl lässt sich über das ⓘ bis zur Herleitung
  aufklappen." Gezählt: der Überblick hat zwölf ⓘ auf zehn Kennzahlen, die
  Reiter Kosten, Zeitplan, Wirkung, Baubarkeit und Grundlagen haben **kein
  einziges**. Inhaltlich stimmt das Versprechen trotzdem — dort klappen die
  Posten selbst auf und zeigen ihre Herleitung Zeile für Zeile —, aber es nannte
  einen Weg, den es in fünf von sechs Reitern nicht gibt. Umformuliert auf das,
  was tatsächlich da ist.
  Beim Umformulieren selbst einen Fehler eingebaut und beim Nachsehen gefunden:
  der JSX-Kommentar zwischen zwei Textstücken frisst das Leerzeichen, im Dialog
  stand „sondernein Werkzeug". Kommentar aus dem Textfluss heraus.

* **[F]** 2026-09-03 **„Keine E-Mail-Adresse" galt nur fürs Formular.** Die
  Anmeldung verspricht „Ein Name und ein Passwort genügen — keine
  E-Mail-Adresse", und die Oberfläche hat auch nie eine geschickt. Die
  *Schnittstelle* nahm aber eine entgegen und schrieb sie in eine
  UNIQUE-Spalte. Ein Versprechen über den Dienst ist ein Versprechen über den
  Dienst, nicht über die Eingabemaske.
  Nebenwirkung, die mir erst beim Nachlesen auffiel: eine Kollision auf dieser
  Spalte wurde als „Dieser Nutzername ist schon vergeben" gemeldet — falsch,
  und ein Hinweis darauf, welche Adressen registriert sind. Das Feld ist raus;
  ein trotzdem mitgeschicktes wird ignoriert und nichts gespeichert. Die Spalte
  bleibt vorerst (in allen 190 Zeilen NULL) und fällt beim nächsten
  Schemaschnitt. Prüfung in `tools/test-security.mjs`: nach einer Registrierung
  mit Adresse steht in keiner Zeile eine, und ein zweites Konto mit derselben
  Adresse scheitert nicht an einer Eindeutigkeit, die es nicht geben soll.
* **[P→erledigt]** 2026-09-03 Die zweite Zusage im selben Atemzug geprüft:
  „Das Bild wird hier im Browser erzeugt — nichts wird dafür hochgeladen."
  Stimmt. Nach dem Klick auf „Teilen" laufen ausschließlich *Downloads* über
  die Leitung (Datensätze und Rechenkern, nötig, um das Netz zu zeichnen); es
  geht nichts hinaus.

* **[F]** 2026-09-03 **Das README behauptete eine Eigenschaft, die es nicht
  gab.** Über das grobe Regionalraster stand dort: „Die Genauigkeit ist
  entsprechend gröber, und die Anwendung sagt das." Sie sagte es nicht — im
  ganzen Programm fand sich kein Hinweis darauf. Eine Trasse ins Umland wurde
  mit derselben Selbstverständlichkeit bepreist wie eine innerstädtische,
  obwohl die Einwohnerzahlen dort aus OSM-Ortsangaben auf einem
  Ein-Kilometer-Raster stammen statt aus amtlicher Statistik auf 200 m.
  Jetzt gibt es den Hinweis wirklich: „62,8 km liegen im Umland, wo die Daten
  gröber sind", mit der Begründung, was das für Nachfrage, Nutzen und NKV
  bedeutet. Als Hinweis, nicht als Mangel — das Urteil ändert sich dadurch
  nicht, denn grobe Daten sind kein Baumangel. Eine Prüfung in
  `tools/test-engine.mjs` hält fest, dass der versprochene Hinweis existiert;
  eine Zusage in der Dokumentation ist eine Zusage.

* **[F]** 2026-09-03 **Jenseits der Datengrundlage sagte das Modell trotzdem
  „baulich unauffällig".** Beim Ausprobieren der Ränder — was tut die App bei
  einer 5-m-Linie, bei zwei gleichen Punkten, bei einer Linie hinaus aufs
  Meer? Die ersten beiden werden sauber abgelehnt. Die dritte nicht: eine
  137 km lange S-Bahn in die Nordsee kam als *baulich unauffällig* zurück, auf
  den Euro bepreist, mit null erreichten Einwohnern und keiner einzigen
  Warnung. Draußen gibt es keine Bebauung, keine Gewässer, keine Bahnanlagen
  und keine Einwohner — die Prüfung las das als „nichts im Weg", während es
  „nichts bekannt" heißt. Das ist derselbe Fehler wie „0 % Abweichung aus 0
  Referenzen".
  Jetzt: ein Befund je Abschnitt, der außerhalb liegt, und ein Urteil, das
  nicht mehr „unauffällig" lautet, wenn ein nennenswerter Teil ungeprüft ist —
  samt Zusammenfassung, die sagt, wie viel und warum das die Zahlen entwertet.
  Zwei Anläufe: der erste rechnete den Anteil in den nach Projektgröße
  normierten Punktestand ein, wo er mit wachsender Länge *verschwindet* —
  genau verkehrt herum. Der zweite maß nur den Anteil, und ausgerechnet die
  Nordseelinie landete bei exakt 50 % eines Szenarios, das schon die
  beschlossenen Vorhaben enthielt, und rutschte unter die Schwelle. Jetzt
  Anteil **und** absolute Untergrenze: wie viel sich nicht beurteilen lässt,
  hängt nicht davon ab, was sonst noch im Entwurf steht.
  Geprüft, dass nichts Ehrliches getroffen wird: innerstädtisch, 34 km nach
  Lüneburg und 80 km nach Kiel bleiben unauffällig — sie liegen im
  Regionalraster.

* **[F]** 2026-09-03 Zwei Warnungen liefen bei **jedem** Import mit
  („Hauptbahnhof liegt 244 m neben der eigenen Trasse"), und ich hatte sie
  wochenlang überlesen — was der eigentliche Schaden ist: eine Warnung, die
  immer erscheint, bringt einem bei, an Warnungen vorbeizusehen.
  Dahinter stecken zwei verschiedene Sachverhalte. Bei einer Station, die das
  Vorhaben **baut**, heißt ein Abstand, dass kuratierte Koordinate und
  trassierter Korridor sich widersprechen — das will man wissen. Bei einer aus
  dem Bestand **übernommenen** Station ist der Knoten der eine Punkt eines
  ganzen Bahnhofskomplexes; der Hamburger Hauptbahnhof ist einen Vierteilkilometer
  breit, und ein neuer Tiefbahnsteig darunter liegt zu Recht so weit von einem
  Korridor entfernt, der oben durch die Straßen läuft. Das Gleis wird ohnehin an
  den Bahnsteig gezogen. Getrennte Grenzen (150 m neu, 400 m Bestand) und ein
  Text, der sagt, was passiert.
  Vorher nachgemessen, statt die Warnung einfach abzuschalten: neue Stationen
  liegen **höchstens 12 m** neben ihrer Trasse, die Grenze hat also reichlich
  Luft — hinter dem Rauschen versteckte sich nichts. Beide Städte importieren
  jetzt ohne eine einzige Warnung.

* **[F]** 2026-09-03 Nach dem README auch die drei Fachdokumente geprüft.
  `docs/modell.md` beschrieb **einen Fehler als Verhalten**: „Elastizität 0,04
  auf zusätzlich erschlossene Erwerbstätige" ist genau die Formel, die am
  2026-09-02 als falsch erkannt und ersetzt wurde — die Elastizität gehört auf
  die *relative Wegeverkürzung*, nicht auf einen Bestand. Wer die Doku liest,
  um das Modell zu verstehen, hätte den behobenen Fehler gelernt. Dazu
  veraltet: 1,31 statt 1,39 Mio. Einsteiger, `calculationVersion` 0.11.0 statt
  0.13.0, die Baufelder-Formel ohne den heute ergänzten Korridorfaktor, der
  Hinweis auf im Bau befindliche Abschnitte ohne die abgezogene Bauzeit, und
  der Umsatzsteuerschlüssel als Hamburger Konstante statt je Stadt.
  Acht Prüfungen in `tools/test-engine.mjs` halten die Doku jetzt an dieselben
  Parameter wie die „i"-Erläuterungen — samt einer, die ausdrücklich das
  Wiederauftauchen der alten Agglomerationsformel verbietet.
* **[I]** 2026-09-03 `docs/architektur.md` sagte unter „Was fehlt": weitere
  Städte brauchten nur „einen zweiten Datensatz, der Editor bleibt
  unverändert". Das stimmte nicht, und der Eintrag sagt jetzt, was es
  tatsächlich kostete — feste Projektion, Importer auf Hamburgs Dateien,
  einprogrammierte Szenarien, eine Ergebniszeile „Fiskaleffekt Hamburg",
  stadtabhängige Kennwerte als Konstanten. Für eine dritte Stadt stimmt die
  ursprüngliche Aussage inzwischen; der Eintrag warnt trotzdem vor dem Muster.
  `docs/daten.md` sagt jetzt vorab, dass es die Hamburger Pipeline beschreibt,
  und wie Berlin davon abweicht.

* **[F]** 2026-09-03 **Das README war stehengeblieben** — geprüft, weil es das
  Erste ist, was jemand liest, der das Projekt übernimmt:
  * Titel und Einleitung nannten nur Hamburg („Hamburg Verkehrsnetz-Designer",
    „Zeichne das Hamburger Nahverkehrsnetz"), obwohl die Anwendung seit
    gestern zwei Städte führt und selbst schon umbenannt war. Derselbe
    Hamburg-Rest wie im Programm, nur in der Dokumentation.
  * Die Leistungstabelle war **sachlich falsch**: sie nannte 403 km, 271
    Stationen, 1,1 ms schnell und 11,9 ms voll — Zahlen von vor der zweiten
    Stadt und vor allen Modelländerungen. Jetzt beide Städte mit heute
    gemessenen Werten, samt der Bitte, `engine:bench` nach jeder
    Modelländerung laufen zu lassen: genau daran hing der Fehler von heute
    früh.
  * `npm run test:ui` fehlte in der Liste der Einzelsuiten — wer den
    Anweisungen folgte, ließ eine Suite still aus. `build:check` fehlte
    ebenfalls, samt Begründung.
  * Die Datenquellen beschrieben nur Hamburg. Berlins Einwohnerzahlen stammen
    aus OSM-Tags und sind **nicht amtlich**; das steht jetzt da, so wie es auch
    in der Oberfläche steht.
  * Die Testzahlen im README („138 Unit-Tests", „36 End-to-End-Tests") waren
    längst überholt. Sie sind jetzt ganz raus: eine Zahl, die bei jedem neuen
    Test veraltet, wird nicht nachgetragen — `npm test` sagt sie ohnehin.

* **[F]** 2026-09-03 **Die Anmeldung verriet über die Antwortzeit, welche Konten
  es gibt.** Die Fehlermeldung ist für „Konto unbekannt" und „Passwort falsch"
  dieselbe — die *Dauer* war es nicht: bei einem unbekannten Namen kehrte die
  Funktion sofort um, ohne das absichtlich teure Argon2 zu rechnen. Gemessen:
  **1,8 ms gegen 17,6 ms**, ein Faktor zehn und mühelos ablesbar. Nicht
  überbewerten: das Anmeldelimit lässt 200 Versuche je 900 s und Adresse zu,
  aus einer Quelle also rund 13 Namen je Minute — verteilt entsprechend mehr.
  Grundlos war der Unterschied trotzdem, und es ist die Art Asymmetrie, die man
  nicht stehen lässt. Beide Zweige rechnen jetzt dasselbe — der unbekannte Fall prüft
  gegen einen festen Vergleichs-Hash und verwirft das Ergebnis. Nachgemessen:
  16,0 gegen 16,2 ms.

  Beim Nachmessen fast selbst hereingefallen: die erste Kontrollmessung zeigte
  1,5 gegen 1,3 ms und sah nach Erfolg aus — tatsächlich hatte das Anmeldelimit
  zugeschlagen und beide Anfragen vor jeder Passwortprüfung abgewiesen. Die
  Prüfung in `tools/test-security.mjs` setzt die Zähler deshalb selbst zurück.
* **[F]** 2026-09-03 Die Profilseite zählte „Neue Kilometer" über alle Entwürfe
  zusammen — aber Entwürfe sind meist *Alternativen* zueinander und enthalten
  dieselben beschlossenen Abschnitte mehrfach. „172 km" las sich wie ein
  Anspruch, 172 km Bahn vorgeschlagen zu haben; tatsächlich waren es dreimal
  weitgehend dieselben. Die Kennzahlen heißen jetzt „zusammengezählt", und die
  Fußnote sagt, dass die Summen aussagen, wie viel jemand *vorgeschlagen* hat,
  nicht wie viel gebaut würde.

* **[F]** 2026-09-03 **Ich hatte den Editor selbst langsam gemacht.** Die
  Bauzeitrechnung fragt seit heute, wie viel einer Trasse im Bestandskorridor
  liegt — und `distance_to_rail` lief linear über *alle* Gleiskorridore der
  Stadt und rechnete deren Stützpunkte bei jedem Aufruf neu von Grad in Meter
  um. In der vollen Auswertung fiel das nicht auf; in der **Schnellschätzung**,
  die antwortet, während jemand zeichnet, schon: sie stieg von deutlich unter
  einer Millisekunde auf **35 ms** („Beschlossene Vorhaben") und **63 ms**
  („Straßenbahn statt U5") — kaum schneller als die vollständige Rechnung, die
  sie ersparen soll. Aufgefallen ist es nur, weil ich nach der Änderung
  `hh bench` laufen liess.

  Die Gleiskorridore liegen jetzt im selben räumlichen Index wie die Straßen,
  mit vorberechneter metrischer Geometrie. Hamburg: Schnellschätzung 35 → 1,7 ms,
  63 → 18,8 ms; die volle Rechnung profitiert mit (44 → 11 ms, 80 → 30 ms), denn
  die Baubarkeitsprüfung stellte dieselbe Frage. Berlin mit 742 km: 5,8 ms
  schnell, 71 ms voll.

  Als Wächter ein Test, der die *Abfrage* misst statt eines Verhältnisses:
  mein erster Versuch verlangte „schnell < voll / 3", was bei der
  Straßenbahn-Variante auch im gesunden Zustand nicht gilt — der Test wäre
  falsch gewesen, nicht die Software. Jetzt: 200 Korridore, eine 18-km-Linie,
  Grenze 20 ms. Gegengeprüft, dass er greift — mit der linearen Fassung
  zurückgestellt dauert dieselbe Abfrage **238 ms**.

* **[P→erledigt]** 2026-09-03 Nach dem Fund mit den Richtungsüberschreibern die
  benachbarten Angriffsflächen durchprobiert — **drei Mal kein Fehler**, und
  das ist auch ein Ergebnis:
  * Ein **privater Entwurf** fällt über keinen Nebenweg heraus: die
    Schnittstelle antwortet anonym mit 404, die Seite zeigt nichts, und das
    Vorschaubild — ein eigener Server-Pfad in der Weboberfläche, der die
    Sichtbarkeit unabhängig prüfen muss — kommt leer heraus (19 kB gegen 79 kB
    mit Daten).
  * **Mitgeschickte Kennzahlen und Besitz werden ignoriert.** Ein `create` mit
    `votes: 9999`, `benefitCostRatio: 99`, `investmentEur: 1` und fremder
    `author_id` ergab 0 Stimmen, die selbst gerechneten 0,285 und 22,9 Mrd. €
    und den richtigen Autor. Der Server rechnet ohnehin selbst — aber geprüft
    ist besser als angenommen.
  * **Kommentare** lassen sich nur vom Verfasser oder von der Moderation
    ausblenden.
  Die ersten beiden sind jetzt Prüfungen in `tools/test-security.mjs`,
  besonders das Vorschaubild: ein zweiter Server-Pfad auf dieselben Daten ist
  genau die Stelle, an der so etwas später wieder aufgeht. Gegengeprüft, dass
  die Prüfung nicht leer läuft — gegen einen öffentlichen Entwurf schlägt sie
  fehl.

* **[F]** 2026-09-03 **Ein Titel konnte etwas anderes anzeigen, als in ihm
  steht.** `char::is_control` deckt nur die Kategorie Cc ab; die Unicode-
  *Format*-Zeichen liefen ungehindert durch die Bereinigung — darunter die
  Richtungsüberschreiber, die die Anzeigereihenfolge alles Nachfolgenden
  umkehren. Nachgestellt und im Browser bestätigt: der Titel
  `Harmlos<U+202E>gnp.txt<U+200B> Zeile1\nZeile2` stand auf der Entdecken-Karte
  als **„HarmlosbaT 2elieZ 1elieZ txt.png"** — Text, den niemand geschrieben
  hat. Das ist der bekannte Dateinamen-Trick, angewandt auf eine Liste von
  Vorschlägen; damit lässt sich ein Entwurf als ein anderer ausgeben.
  Entfernt werden jetzt die Einbettungen, Überschreiber und Isolate
  (U+202A–U+202E, U+2066–U+2069) sowie Zerobreite-Leerzeichen, BOM und weiches
  Trennzeichen. **Nicht** entfernt: die schwächeren Richtungsmarken LRM/RLM und
  vor allem U+200C/U+200D — der Verbinder hält Emoji-Folgen zusammen und der
  Nichtverbinder trägt im Persischen Bedeutung; blind alles Unsichtbare zu
  streichen hätte echte Schreibweisen kaputt gemacht.
  Dazu: ein Titel ist einzeilig. Zeilenumbrüche und Tabulatoren darin brachen
  Karten, Überschriften und das Vorschaubild; sie werden zu einfachen
  Leerzeichen zusammengezogen. Die Beschreibung behält ihre Absätze.
  Der **Anzeigename** war nur getrimmt und steht neben jedem veröffentlichten
  Entwurf — dieselbe Angriffsfläche, jetzt dieselbe Bereinigung.
  Drei neue Rust-Tests und eine Prüfung in `tools/test-security.mjs`, die den
  Angriff über die echte Schnittstelle fährt.

* **[F]** 2026-09-03 Das **Vorschaubild geteilter Links** war gebaut, aber nie
  angesehen worden — dabei ist es das Erste, was jemand von einem geteilten
  Entwurf sieht. Drei Mängel, alle im gerenderten PNG geprüft:
  * Der Bildausschnitt richtete sich allein nach dem, was gebaut würde, und
    schnitt das Bestandsnetz mitten im Strich ab. Eine Linie, die am Bildrand
    abrupt endet, sieht nach Darstellungsfehler aus, nicht nach Karte. Der
    Ausschnitt wächst jetzt bis zu 28 % in Richtung des umliegenden Netzes —
    genug für Zusammenhang, ohne den Entwurf in die Mitte zu schrumpfen.
  * Das Bestandsnetz war mit 3 px so dünn, dass es als lose Fäden las statt als
    Netz; jetzt 4,5 px, der Neubau steht mit 7 px weiterhin klar davor.
  * Die Erläuterung stand *neben* der Zahl („22,9 Mrd. € Modellschätzung") und
    verschmolz optisch mit ihr. Sie steht jetzt darunter — das Bild wird meist
    als Vorschaubild in einer Zeitleiste gesehen, klein. Die Abstände im Panel
    sind entsprechend nachgezogen, sonst stiess der Schlusshinweis an.
  Für Berlin ergibt das ein wirklich schönes Bild: das ganze Netz in Grau, der
  Entwurf in Blau quer hindurch.

* **[F]** 2026-09-03 **Forken war eine Sackgasse.** Den Ablauf einmal ganz
  durchgespielt: abgemeldet forken sagt sauber „Dafür brauchst du ein Konto",
  angemeldet entsteht die Kopie mit richtiger Herkunft („Abgeleitet von …",
  eigener Besitz, nicht veröffentlicht). Nur konnte man sie danach **nicht
  bearbeiten** — die Entwurfsseite bot keinen Weg in den Editor. Der einzige
  Ausweg war „Herunterladen" und die Datei von Hand wieder zu öffnen. Eine Kopie
  zum Weiterbauen, die man nicht weiterbauen kann, ist der Punkt der Übung
  verfehlt. Jetzt gibt es „Im Editor öffnen"; liegt dort schon unfertige Arbeit,
  wird vorher gefragt, statt sie stillschweigend zu überschreiben. Die
  Speicherschlüssel liegen dafür in `lib/drafts.ts` — zwei Schreibweisen von
  `hh-draft` hätten genau die Arbeit gekostet, die der Dialog schützen soll.
* **[F]** 2026-09-03 Nach dem Laden eines Dokuments behauptete die Kopfzeile
  „Bestand 2026" über einem Netz, das damit nichts zu tun hatte. Die Auswahl
  kennt für diesen Fall längst den Eintrag „Eigener Entwurf" (`templateId`
  leer), aber der Rückfall, der eine *fremdstädtische* Vorlage abfängt, verschluckte
  den leeren Fall gleich mit und setzte die erste Vorlage ein. Nur noch ein
  nicht-leerer, unbekannter Bezeichner fällt zurück.

* **[F]** 2026-09-03 **Das Modell nahm an, überall gleichzeitig bauen zu
  können.** Die Bauzeit wird durch `Baufelder` geteilt — bis zu fünf parallele
  Baustellen, allein aus der Länge abgeleitet. Auf freier Strecke ist das
  vernünftig. Auf einer Strecke, die weiter Züge trägt, nicht: dort wird in
  Sperrpausen gebaut, um den Betrieb herum sequenziert. Die S4 nach Bad
  Oldesloe ist 47 km fast vollständig in der bestehenden Lübecker Bahn und wird
  von 2023 bis 2032 gebaut — das Modell sagte **3,1 Jahre**.
  Die Parallelität hängt jetzt vom Anteil der Trasse im Bestandskorridor ab
  (`rail_corridor_share`, dasselbe Signal, das schon die Baubarkeitsprüfung
  benutzt): vollständig im Korridor bleibt gut ein Drittel davon übrig. S4 Ost
  von −4 auf **−1 Jahr**; die U5 Ost, die im Tunnel auf neuer Trasse liegt,
  bewegt sich um ein Jahr auf +1. Der Kennwert ist an *einem* Vorhaben geeicht,
  das sei deutlich gesagt — aber er ist besser begründet als eine Zahl, die den
  Zusammenhang gar nicht kennt. Ein Test in `construction.rs` hält die Richtung
  fest: dieselbe Strecke dauert im Bestandskorridor länger.

* **[F]** 2026-09-03 **Das Eröffnungsjahr wurde nie geprüft.** Die Kalibrierung
  verglich ausschließlich Kosten, obwohl „Eröffnung 2049" auf jedem Entwurf
  ganz oben steht und acht veröffentlichte Termine in den kuratierten Daten
  liegen. Ein Zeitmodell, das niemand nachrechnet, ist eine Zahl in
  selbstbewusster Schrift und sonst nichts. Der Vergleich steht jetzt in der
  Tabelle, in Jahren statt in Prozent — „2049 gegen 2045" ist vier Jahre spät,
  nicht 0,2 % daneben — mit eigenem Urteil.

  Er förderte sofort einen echten blinden Fleck zutage: **das Modell wusste
  nicht, dass gebaut wird.** Für eine Strecke im Bau übersprang es zwar Planung
  und Genehmigung, setzte die Bauzeit aber vollständig ab heute an. Alle drei
  im Bau befindlichen Hamburger Vorhaben kamen dadurch vier bis sechs Jahre zu
  spät heraus. Vorhaben tragen jetzt ein `constructionStartYear`, und die
  verstrichenen Baujahre werden abgezogen — höchstens vier Fünftel, denn das
  letzte Stück Tunnel ist nicht das schnelle, und eine Strecke im Bau ist
  definitionsgemäß nicht fertig. Ergebnis: U5 Ost 2032 gegen 2032 (exakt), U4
  Horner Geest +2 statt +6 Jahre, U5 City Nord–Jarrestraße unverändert +5
  (nicht im Bau). Berlin: Siemensbahn +3.

  Nebenbei behoben: der Ausschluss wegen veraltetem Preisstand griff auch auf
  die Eröffnungszeile derselben Linie über — dass eine Kostenangabe von 2018
  stammt, sagt nichts über die Vergleichbarkeit des Termins.

* **[F]** 2026-09-03 Mit abgeschaltetem API-Server geprüft, was die Anwendung
  dann sagt — sie verspricht in ihrem eigenen Text, dass der Editor auch ohne
  Server funktioniert. Das stimmt: Entwurf wiederhergestellt, volle Analyse,
  keine Fehlermeldung. Zwei andere Seiten sagten aber etwas Falsches über die
  Welt:
  * **Die Vergleichsseite meldete „Es sind noch keine Entwürfe
    veröffentlicht."** Es *gibt* welche — sie waren nur nicht abrufbar. Das ist
    ausgerechnet der Satz, den man glaubt, weil er plausibel klingt.
  * **Die Entwurfsseite betitelte einen existierenden Entwurf mit „Nicht
    gefunden"**, mit der Erklärung darunter. Die Überschrift ist das, was
    hängen bleibt.
  Beide unterscheiden jetzt `ApiUnavailable` von einem echten leeren Ergebnis
  beziehungsweise einem echten 404 — die Fehlerklasse gab es längst, die
  Entdecken-Seite benutzte sie schon, die anderen beiden nicht. Geprüft: bei
  laufendem Server sagt ein unbekannter Kurzname weiterhin „Nicht gefunden",
  und die Vergleichsseite bietet ihre fünf Entwürfe an. Eine Prüfung in
  `tools/test-ui.mjs` hält fest, dass alle drei Seiten den Unterschied kennen.

* **[F]** 2026-09-03 **Der Hellmodus war nie geprüft** — und beim ersten Blick
  blieb die Karte dunkel, während der Rest der Oberfläche hell wurde. Der
  Effekt, der den Kartenstil neu baut, stieg bei `!isStyleLoaded()` einfach aus.
  `isStyleLoaded()` ist aber `false`, solange noch irgendeine Quelle nachlädt.
  Wer früh umschaltet oder eine langsame Verbindung hat, bekam also eine Karte,
  die dauerhaft im alten Modus blieb — der Effekt läuft erst wieder, wenn sich
  `dark` ändert, der einzige Ausweg war zweimal Umschalten. Jetzt wird auf
  `styledata` gewartet, statt die Änderung zu verwerfen; der neue Stil wird
  ausserdem aus den *aktuellen* Daten gebaut, nicht aus denen vom Moment des
  Umschaltens.

  Der Hellmodus selbst ist in Ordnung: Karte, Linienfarben auf hellem Grund,
  Analysepanel, Veröffentlichen-Dialog und das Teilen-Bild sind alle lesbar.
* **[I]** 2026-09-03 `npm run build:check` baut nach `.next-build` statt nach
  `.next` (`NEXT_DIST_DIR`, in `next.config.mjs` ausgewertet). Ein Prüfbau
  ersetzte bisher die Chunks, die der laufende Entwicklungsserver gerade
  ausliefert; die Anwendung antwortete danach mit 500 und „Cannot find module
  './523.js'". Das ist mir heute dreimal passiert, und zweimal habe ich
  daraufhin einen Fehler in der Anwendung gesucht, den es nicht gab.

* **[F]** 2026-09-03 **Die Anwendung war auf dem Telefon nie geprüft worden** —
  obwohl sie laut Plan §22 zuerst für den Finger gebaut ist. Bei 375 px:
  * Der **Willkommensdialog lief aus dem Bild** und schnitt seinen eigenen Text
    rechts ab — das Erste, was ein Handynutzer sieht. Ursache: bei blossem
    `place-items-center` bemisst sich die einzige Rasterspalte am Inhalt, also
    an `max-w-md` (448 px), und `w-full` daneben ist wirkungslos. Mit
    `grid-cols-1` (`minmax(0, 1fr)`) ist die Spalte an den Container gebunden:
    343 px statt 448. Derselbe Fehler steckte im **Ladebildschirm**
    (`max-w-sm` = 384 px > 375 px) und im Fehlerbildschirm.
  * Die **Kopfzeile lief 60 px über** und schnitt „Teilen" ab, sobald der
    Verlauf-Knopf erschien. Schlimmer: das Szenario-Auswahlfeld war das einzige
    mit `flex-1` und wurde deshalb auf **exakt null Pixel** gequetscht — auf dem
    Telefon liess sich das Szenario also gar nicht mehr wechseln, und das ist
    die Bedienung, die entscheidet, was man überhaupt sieht. Unterhalb von `sm`
    rutscht es jetzt in eine eigene Zeile (280 px), die Kopfzeile passt
    (375/375).
  Danach den Ablauf auf dem Telefon durchgespielt: zeichnen funktioniert
  (58,9 → 64,6 km, keine Fehlwarnung), die Analyse öffnet sich als Bottom Sheet
  mit scrollbaren Reitern, und quer scrollt nichts.

* **[P→erledigt]** 2026-09-03 Nach dem dritten fest einprogrammierten
  Hamburg-Rest an einem Tag einmal systematisch gesucht statt auf den nächsten
  zu warten — Rechenkern, Importer und Anwendung. Gefunden und behoben:
  * `simulation::compare` beschriftete eine Zeile mit „Fiskaleffekt Hamburg".
    Die Vergleichsseite zeigte das über zwei *Berliner* Entwürfen. Die Zeile
    heißt jetzt schlicht „Fiskaleffekt"; welcher Haushalt gemeint ist, steht in
    der Fiskalaufstellung.
  * Die Kostenrechnung merkte an, die Kennwerte seien „an veröffentlichten
    **Hamburger** Projektkosten" geeicht — für Berlin gedruckt, aber
    zufälligerweise wahr. Jetzt steht das ausdrücklich in den Parametern
    (`calibratedOn`) und wird genannt: Berlin rechnet mit Hamburger Kennwerten
    und zwei eigenen Zahlen, und keine Berliner Referenz prüft sie derzeit. Wer
    eine Berliner Schätzung liest, soll das wissen.
  * Die CLI-Ausgabe schrieb „Fiskaleffekt Hamburg" unabhängig von der Stadt.
  * Die Liste der „großen" Gewässer war als Hamburger Namensliste **im
    gemeinsamen Code** hinterlegt und galt mangels Alternative auch für Berlin.
    Hier lag *kein* Fehler vor — die Flächenregel (0,4 km²) und die Flussregel
    fangen Havel, Dahme, Müggelsee und Spree ohnehin, was ich nachgemessen habe,
    bevor ich etwas „reparierte". Die Liste steht jetzt trotzdem je Stadt in
    deren Konfiguration; Berlin nennt seine eigenen Wasserstraßen und kommt auf
    52 statt 45 als groß geführte Gewässer.
  * `hamburgRings()` in `build-city.mjs` war generisch und nur falsch benannt —
    genau so verstecken sich diese Reste.
  Nicht gefunden: in der Weboberfläche steht nur noch Absicht (der
  Zwei-Städte-Text) und Rückfallwerte. Hamburg bleibt in allem unverändert,
  Kalibrierung 11 % aus 3 von 6 Referenzen.

* **[F]** 2026-09-03 **Berlin bekam Hamburgs Szenarien.** Beim Nachsehen, ob die
  neuen Berliner Vorhaben in der Anwendung ankommen, standen im Auswahlfeld „U5
  im Vollausbau" und „Straßenbahn statt U5" — Hamburger Debatten, in Berlin
  sinnlos, und beide obendrein Dubletten: „U5 im Vollausbau" enthielt in Berlin
  exakt den Bestand, „Straßenbahn statt U5" exakt dasselbe wie „Alles
  gleichzeitig". Die Vorlagen waren im Importer fest einprogrammiert, samt
  Beschreibungstext („U5, U4-Verlängerungen, S4"), und galten für jede Stadt.

  Ein Szenario, das bestimmte Vorhaben benennt, gehört zu diesen Vorhaben. Der
  Importer erzeugt jetzt nur noch das, was überall gilt — Bestand, Beschlossene
  Vorhaben, Freies Netz, und „Alles gleichzeitig" nur, wo es überhaupt
  Gegenvorschläge gibt — und die Zusammenfassung nennt die Projekte, die diese
  Stadt wirklich hat. Alles Weitere steht unter `scenarios` in der kuratierten
  Datei der Stadt; Hamburgs beide sind dorthin gezogen. Hamburg unverändert
  (sechs Szenarien, gleiche Linienzahlen 14/22/19/22/26/14), Berlin hat jetzt
  drei sinnvolle statt sechs, davon drei erfundene.

* **[P→erledigt]** 2026-09-03 Die beiden ursprünglich gemeldeten Fehler noch
  einmal geprüft, nachdem die Stadtdaten beider Städte mehrfach neu gebaut
  wurden: **Gewässer** stimmen in der Fläche mit der Wirklichkeit überein
  (Außenalster 1,58 km² gegen 1,6; Binnenalster 0,18 gegen 0,18; Müggelsee 7,35
  gegen 7,4; Langer See 3,10 gegen 3,1; Tegeler See 4,35 gegen 4,5), und die
  **Trassen hängen zusammen**: von 1 148 Kanten in beiden Netzen hat keine
  einzige eine Lücke von mehr als 25 m zu ihrem Knoten. Die U5 durchgehend:
  Bramfeld → Steilshoop → Barmbek-Nord → Sengelmannstraße → City Nord → Borgweg
  → … → Osdorfer Born.
* **[F]** 2026-09-03 **Eine Referenzzahl stand ohne Beleg in den Daten.** Die
  U4 Horner Geest war mit 620 Mio. € und Eröffnung 2029 geführt, als Quelle die
  HOCHBAHN-Projektseite. Die nennt aber überhaupt keine Kosten und als Termin
  Herbst 2027. Belegbar ist 465 Mio. € für Planung und Bau — aus einem
  HOCHBAHN-Beitrag vom **13. März 2018**. Beides korrigiert, mit der Datierung
  in der Quellenangabe.
* **[I]** 2026-09-03 Vorhaben haben jetzt ein Feld `priceBaseYear`, und die
  Kalibrierung zeigt es: `U4 (u4-horner-geest) [2018]`. Eine Angabe, deren
  Preisstand mehr als drei Jahre zurückliegt, bleibt aus dem Urteil heraus —
  eine Zahl von 2018 kann ein Modell nicht prüfen, das in Preisen von 2026
  rechnet, und die Differenz ist Baupreissteigerung, nicht Fehleichung.
  Umgerechnet wird bewusst nichts: dafür bräuchte es den amtlichen
  Baupreisindex, nicht die Vorausannahme des Modells.

  Das Urteil sagt jetzt außerdem, **worauf es beruht**: „11 % (3 von 6
  Referenzen)". Vorher hätte Berlin nach dieser Änderung „0 %" gemeldet — beide
  Referenzen ausgeschlossen, was wie ein perfektes Ergebnis aussieht und das
  Gegenteil bedeutet. Steht keine Referenz zur Verfügung, sagt der Ausdruck
  ausdrücklich, dass die Kennwerte für diese Stadt ungeprüft sind. Hamburg: 11 %
  aus 3 von 6 Referenzen (vorher 31 %, getrieben von der undatierten U4-Zahl).

* **[F]** 2026-09-03 Ein **neuer** Bahnhof eines kuratierten Vorhabens wurde von
  jedem vorhandenen Bahnhof im Umkreis von 320 m verschluckt: er übernahm dessen
  Namen und dessen Lage. Die beiden Zweige der Fallunterscheidung taten
  dasselbe, die Bedingung `!s.is_new` war also reine Zierde. Sichtbar wurde es
  an der Siemensbahn, deren neuer Halt Siemensstadt zum „Siemensdamm" der U7
  wurde und 194 m neben dem eigenen Viadukt lag; ebenso beim „Märkischen
  Zentrum" und beim Ostkreuz, wo die neue Haltestelle Sonntagstraße in der
  bestehenden Holteistraße verschwand und der erste Abschnitt der Strecke damit
  aus zwei gleichen Knoten bestand. Jetzt gilt die Unterscheidung, die gemeint
  war: `new: false` heißt „das *ist* dieser Bahnhof" (Hamburgs Hauptbahnhof,
  Sengelmannstraße), `new: true` legt einen eigenen Knoten an und markiert beide
  als Umsteigepunkt — zwei Bahnsteige in Gehweite sind ein Umstieg, kein
  gemeinsamer Bahnsteig. Hamburg unverändert.
* **[F]** 2026-09-03 Die abschnittsweise gewählte Bauweise ergab Übergänge, die
  so niemand baut: die U8-Verlängerung kam als 1,4 km **Viadukt** zwischen dem
  unterirdischen Bahnhof Wittenau und zwei gebohrten Tunneln heraus. Die Rampe
  allein wäre länger als der Abschnitt. Ein von Tunnel *eingeschlossener*
  Hochbahnabschnitt wird jetzt zu offener Bauweise. „Eingeschlossen" ist dabei
  die ganze Regel — mein erster Versuch wandelte jeden Hochbahnabschnitt um, der
  einen Tunnel *berührt*, und legte damit Abschnitt für Abschnitt die komplette
  Linie unter die Erde. Der vorhandene Test
  `the_construction_type_follows_the_ground` hat genau das gefangen: eine
  U-Bahn, die die dichte Stadt verlässt und bis zur Endstation oben bleibt, tut
  das Übliche. Ob die Linie an ihren Enden an Bestandstunnel anschließt, gibt
  der Importer dazu — deshalb ist der erste U8-Abschnitt eingeschlossen, obwohl
  ihm nichts vorausgeht. Gilt nur für U-Bahnen; eine S-Bahn, die oberirdisch
  fährt und einmal abtaucht, ist normal.

  Wirkung: die U8-Verlängerung liegt jetzt durchgehend unter der Erde (offene
  Bauweise, dann TVM) und kostet im Modell 1,92 Mrd. € — 770 Mio. €/km. Das ist
  *über* der Spanne von 291–500 Mio. €/km, die in der öffentlichen Kritik als
  Vergleich genannt wird; das Modell dürfte hier also selbst zu hoch liegen,
  liegt aber näher daran als die veröffentlichten 139 Mio. €/km. Der Wert ist
  als bestritten (†) markiert und beeinflusst die Eichung nicht. Die
  Siemensbahn: 461 Mio. € gegen 500 Mio. € veröffentlicht, −8 %.

* **[F]** 2026-09-03 `build-projects.mjs` las für **jede** Stadt Hamburgs
  Dateien: Stadtdatensatz, Bahndaten, Straßen, Stationen und die kuratierte
  Liste waren fest verdrahtet. Für Berlin wäre die Vorhabenliste damit gegen
  Hamburgs Karte aufgelöst worden — und der Berliner Build rief den Schritt
  ohnehin nie auf. Beides behoben; eine Stadt ohne kuratierte Liste erzeugt
  jetzt ein leeres Ergebnis statt eines fremden.
* **[I]** 2026-09-03 Erste kuratierte Vorhaben für Berlin, mit Quellen und ohne
  erfundene Zahlen: **Siemensbahn** (Reaktivierung Jungfernheide–Gartenfeld,
  i2030, im Bau, 500 Mio. € Stand 2021, Inbetriebnahme 2029), **U8 Wittenau –
  Märkisches Viertel** (390 Mio. €, Preisstand 2025) und die
  **Straßenbahn-Neubaustrecke Ostkreuz** (1,2 km, vier Halte — Kosten und
  Baubeginn sind *nicht* veröffentlicht und stehen deshalb auch nicht in der
  Datei). Berlin hat damit erstmals ein Szenario „Beschlossene Vorhaben".

  Zwei Dinge, die dabei auffielen und geändert wurden:
  * Das Modell rechnet für die Siemensbahn 454 Mio. € gegen 500 Mio. €
    veröffentlicht — 9 % Abweichung. Für die U8 rechnet es 1,33 Mrd. € gegen
    390 Mio. €, also 536 Mio. €/km gegen 139 Mio. €/km. Der veröffentlichte
    Wert ist genau der, den der BUND Berlin öffentlich bestreitet, weil
    vergleichbare deutsche U-Bahn-Verlängerungen 291–500 Mio. €/km kosten. Das
    Modell trifft also die Kritik, nicht die Zahl. Ein neues Feld
    `costDisputed` markiert solche Angaben mit † und hält sie aus dem
    Kalibrierungsurteil heraus, mit der Begründung im Ausdruck — sonst hätte
    ich die Kennwerte auf eine Zahl gezogen, die andere bereits für zu niedrig
    halten.
  * `infrastructure` war im Vorhaben-Schema **Pflicht**. Für die U8 ist die
    Bauweise nicht veröffentlicht; ich hatte zunächst `deep_tunnel`
    hingeschrieben und damit selbst eine Annahme in die Vergleichsspalte
    gesetzt (1,70 statt 1,33 Mrd. €). Das Feld ist jetzt optional: fehlt es,
    wählt der Rechenkern die Bauweise je Abschnitt aus dem Untergrund — dieselbe
    Regel wie für eine selbst gezeichnete Linie. Dazu wurde
    `choose_infrastructure` aus dem Editor zu einer freien Funktion, und die
    Bahnsteigtiefe folgt jetzt den tatsächlich gebauten Abschnitten statt einer
    vorab gesetzten Klasse.
* **[F]** 2026-09-03 `calibrate` und `build` im Importer rechneten mit
  `Params::default()` statt mit den Parametern der geladenen Stadt — seit die
  Städte eigene Kennwerte haben, ist das schlicht die falsche Stadt.

* **[F]** 2026-09-03 **Welche Rohdaten ein Import benutzt, hing von der
  alphabetischen Reihenfolge ab.** Der Overpass-Cache benennt Dateien nach dem
  Hash der Abfrage, also bleibt beim Ändern einer Abfrage die alte Antwort neben
  der neuen liegen — und `readRaw` nahm schlicht den ersten passenden Dateinamen.
  Ich habe Berlins Bahnabfrage umgeschrieben, neu geholt, neu gebaut und
  gemessen, dass sich *nichts* geändert hatte: der Build las weiter die alte
  Antwort, weil deren Hash früher sortierte. `data/raw/index.json` hält jetzt
  fest, welche Datei zur aktuellen Abfrage gehört; für Altbestände wird die
  neueste genommen und gemeldet, wenn mehrere da sind.
* **[F]** 2026-09-03 Die U-Bahn fehlte in den Bahnkorridoren — in **beiden**
  Städten und aus zwei verschiedenen Gründen. Die Baubarkeitsprüfung
  unterscheidet damit, ob eine oberirdische Trasse einem Korridor folgt, in dem
  ohnehin Züge fahren, oder eine neue Schneise schlägt. Eine Hochbahn ist genau
  so ein Korridor; eine Linie neben Berlins U1-Viadukt an der Skalitzer Straße
  oder Hamburgs U3 auf der Hochbahn galt trotzdem als Schneise und bekam eine
  Warnung, die sie nicht verdient hatte.
  * Berlins Abfrage holte `subway` gar nicht erst — Hamburgs schon. Dieselbe
    Abfrage war in den beiden Städten auseinandergelaufen; Berlin schleppte
    außerdem Abstell- und Betriebshofgleise mit, die Hamburg ausschloss. Beide
    holen jetzt dasselbe.
  * Und der *Aufbau* filterte `subway` ohnehin heraus, für beide Städte. Damit
    war Hamburgs vollständigere Abfrage folgenlos.
  Getunnelte Abschnitte fallen weiter weg — ein Tunnel unter einer Straße ist
  kein Korridor über ihr. Von 163 oberirdischen U-Bahn-Wegen in Berlin liegen 45
  im Korridornetz; der Rest sind kurze Viaduktstücke zwischen zwei Tunnelmündern,
  die zu Recht nicht als Korridor zählen. Hamburg: 128 → 176 Korridore, die U3
  an den Landungsbrücken jetzt 136 m statt weit außerhalb. Berlin: 241 Korridore
  und 1 655 km statt 1 085 Bruchstücken und 2 136 km — weniger und länger, weil
  die Betriebsgleise weg sind. Beide Städte kalibrieren unverändert.

* **[I]** 2026-09-03 Dienstweite Obergrenzen gegen verteilte Angriffe: 300 neue
  Konten und 3 000 Stimmen je Stunde für den ganzen Dienst
  (`HH_MAX_REGISTRATIONS`, `HH_MAX_VOTES`). Das Limit je Adresse begrenzt einen
  Angreifer auf einer Verbindung; zehn Konten je Stunde von hundert Adressen
  sind trotzdem tausend. Genau diese Form haben massenhafte Kontenanlage und
  Stimmenkauf. Die Grenzen liegen weit über jeder plausiblen ehrlichen Stunde,
  damit Missbrauch auf eine Wand trifft statt auf ein Gefälle, und sie
  protokollieren laut — jemand soll hinsehen. Dass sie im Ernstfall auch
  ehrliche Leute für den Rest der Stunde aussperren, ist der Handel: ein Dienst,
  der kurz keine Konten annimmt, erholt sich; eine mit Strohmännern gefüllte
  Rangliste nicht.

  Dazu ein eigener Fehlerfall `ServiceBusy`: „Zu viele Anfragen — bitte kurz
  warten" wäre gegenüber jemandem, der gerade erst angekommen ist, schlicht
  falsch. Die Meldung sagt jetzt, dass gerade ungewöhnlich viel passiert und
  deshalb pausiert wird. Drei neue Prüfungen in `tools/test-security.mjs`: beide
  Grenzen greifen, die Meldung erklärt sich, und der Dienst öffnet wieder.

  **Kein Proof of Work.** Der offene Punkt schlug ihn vor; durchgerechnet bringt
  er hier nichts. Unter einer Obergrenze von 300 Konten je Stunde kommt ein
  Angreifer ohnehin nicht über 300 Konten je Stunde — eine Sekunde Rechenarbeit
  je Konto (ein Zwölftel des Abstands zwischen zwei erlaubten Anmeldungen)
  ändert daran nichts. Sie würde nur jeden ehrlichen Anmeldevorgang um eine
  Sekunde verlängern. Die Obergrenze dominiert; das Zusätzliche wäre Zierde.

* **[F]** 2026-09-03 **Vier Berliner Straßenbahnlinien wurden um bis zu ein
  Drittel verkürzt veröffentlicht — und ich hatte das OpenStreetMap
  angelastet.** Der Eintrag oben behauptete bis heute, zehn Linien endeten vor
  ihrem Endpunkt, weil die Relationen unvollständig seien. Für sieben davon war
  das falsch, und die Ursache lag hier:
  * `routeGeometry` fügte die Wege einer Relation zusammen und behielt dann
    **nur das längste zusammenhängende Stück**. Relationen haben aber
    regelmäßig kleine Lücken — an einer Kreuzung, bei einem fehlenden kurzen
    Verbindungsstück, bei einer getrennt erfassten Wendeschleife. Alles jenseits
    der Lücke fiel weg, die Halte dort lagen dann bis zu 3,7 km von der
    „Trasse" entfernt und wurden von der 400-Meter-Prüfung stillschweigend
    verworfen. Die Linie 63 kam so mit 16 statt 27 Halten heraus, die 62 mit 19
    statt 30. Jetzt werden die Stücke aneinandergehängt, nächste Enden zuerst,
    solange die Lücke klein genug für eine Erfassungsnaht ist. In Berlin sind
    das elf Lücken zwischen wenigen Metern und 59 m — die Grenze liegt bei
    150 m, weit über dem, was vorkommt, und weit unter einer Strecke, die quer
    durch einen Block gezeichnet würde. Ergebnis: 62 fährt wieder
    Mahlsdorf–Wendenschloß, 63 Landschaftspark Johannisthal–Rahnsdorfer Straße,
    27 und 67 bis Krankenhaus Köpenick.
  * Die Meldung selbst verglich nur die **Endpunkte** der gebauten Linie mit dem
    from/to-Tag. Eine Relation führt aber regelmäßig über ihren angegebenen
    Endpunkt hinaus: die Wendeschleife hinter dem letzten Bahnsteig (die 16
    endet an der Frankfurter Allee und fährt weiter zum Traveplatz) oder eine
    Verlängerung, die das Tag noch nicht kennt (M5 und M8 fahren inzwischen über
    den Hauptbahnhof hinaus). Geprüft wird jetzt, ob der genannte Endpunkt
    **überhaupt bedient** wird. Von zehn Meldungen bleiben drei, und die sagen
    ehrlich, dass aus den Daten nicht zu entscheiden ist, ob die Relation
    unvollständig oder das Tag veraltet ist.
  Berlin: 73 Linien, 658 Stationen (vorher 647), 742,2 km. Stichproben gegen die
  Wirklichkeit stimmen: U7 40 Halte, U2 29, U5 26, M10 bis Turmstraße, 87 bis
  Woltersdorf Schleuse. 2,89 Mio. Einsteiger je Werktag, weiterhin im
  beobachteten Bereich. Hamburg unverändert.

* **[F]** 2026-09-03 Eine unterbrochene Zahlenanimation konnte die **falsche
  Zahl** stehen lassen. Gefunden beim Nachsehen, ob andere Animationen denselben
  Fehler haben wie die Meldungen. `AnimatedNumber` merkte sich als Startwert,
  wo die letzte Animation *enden sollte*, und schrieb ihn nur beim Erreichen des
  Endes fort. Kennzahlen ändern sich beim Bearbeiten schneller als die 450 ms
  einer Animation, also unterbrechen sie einander ständig und dieser Startwert
  veraltet. Nimmt man eine Änderung dann mitten in der Animation zurück, sind
  Start- und Zielwert wieder gleich, die Aktualisierung galt als „nichts zu tun"
  — und auf dem Bildschirm blieb der halb gelaufene Zwischenwert stehen, dauerhaft.
  In einer Anwendung, die aus Zahlen besteht, ist das der schlimmste mögliche
  Fehler. Jetzt ist der Startwert das, was *tatsächlich gemalt* ist, und der
  Zielwert wird immer gesetzt. Dazu ein Zeitgeber als Rückfall: auch hier läuft
  `requestAnimationFrame` in einem Hintergrund-Tab nicht (in dieser Umgebung
  nachgemessen: **null Einzelbilder in zwei Sekunden**), und eine Zahl darf nicht
  auf halbem Weg stehen bleiben, weil jemand den Tab gewechselt hat.
  Die Regel liegt jetzt als reine Funktion in `lib/tween.ts`, damit sie ohne
  Browser prüfbar ist.
* **[I]** 2026-09-03 Neue Prüfsammlung `tools/test-ui.mjs` (`npm run test:ui`,
  auch Teil von `npm test`): die wenigen Regeln, die in der Oberfläche statt im
  Rechenkern leben und die ein Browsertest schlecht festnagelt — was eine Zahl
  während der Animation anzeigt, wie eine Stadt heißt, wie eine Zahl deutsch
  gesetzt wird. Neun Prüfungen, darunter die beiden Fälle, an denen die
  Zahlenanimation gescheitert ist.

* **[P→erledigt]** 2026-09-03 Der vollständige Ablauf einmal von Hand im
  Browser durchgespielt: Straßenbahn, S-Bahn und U-Bahn zeichnen · Station über
  den Inspektor entfernen · über die Verlaufsliste zurücknehmen · ganze Linie
  löschen · veröffentlichen · dabei Konto anlegen · Teilen-Blatt · entdecken ·
  fremdem Entwurf zustimmen · kommentieren · vergleichen. Alles funktioniert.
  Nebenbei geprüft und *nicht* als Fehler bestätigt: nach dem Entfernen einer
  Straßenbahnhaltestelle stieg die Investition um 100 Mio. €. Ursache ist
  richtig gerechnet — der Halt „Große Elbstraße" hielt die Trasse an Land, ohne
  ihn schneidet der zusammengelegte Abschnitt das Hafenbecken, und aus 91 Mio. €
  Brücke werden 153 Mio. €. Die App hatte beim Zeichnen genau davor gewarnt.
* **[F]** 2026-09-03 Meldungen („Veröffentlicht", „Bild gespeichert") wurden mit
  `opacity: 0` eingefügt und erst in `requestAnimationFrame` sichtbar gemacht.
  In einem Hintergrund-Tab läuft `requestAnimationFrame` nicht: die Meldung
  blieb unsichtbar und wurde nach 3,2 s wieder entfernt — sie erschien nie. Wer
  veröffentlicht und in der Zwischenzeit den Tab wechselt, bekam also keine
  Rückmeldung. Jetzt wird der Anfangszustand mit einem Layout-Lesezugriff
  durchgesetzt, ohne auf ein Einzelbild zu warten.
* **[F]** 2026-09-03 Auf der Vergleichsseite zeigte das zweite Auswahlfeld
  „— auswählen —", wenn der Link einen Entwurf aus einer anderen Stadt nannte:
  die Liste war auf die Stadt des ersten Entwurfs gefiltert, der gewählte Wert
  stand nicht darin. Darunter erklärte der Hinweis derweil, *diese beiden*
  Entwürfe gehörten zu verschiedenen Städten — was wie ein Fehler der Seite
  aussieht statt wie einer der Paarung. Der verlinkte Entwurf bleibt jetzt in
  der Liste. Außerdem nannte derselbe Hinweis die Städte bei ihren
  Bezeichnern („hamburg und berlin"); es gibt jetzt eine gemeinsame
  Beschriftung in `format.ts`, die beide Seiten benutzen.

* **[F]** 2026-09-03 **Bauen konnte die Stadt langsamer machen.** Beim
  Durchspielen des vollständigen Ablaufs im Browser — U-Bahn, S-Bahn und
  Straßenbahn zeichnen — fiel auf, dass der jährliche Nutzen nach einer
  weiteren Linie von 501 auf 77 Mio. € *fiel*. Ursache: die mittlere
  Erreichbarkeit stieg von 50,9 auf 52,9 Minuten, obwohl nur Strecken
  hinzugekommen waren. Damit standen **Reisezeitgewinne und
  Agglomerationsnutzen auf exakt null** — die beiden größten Posten jeder
  Bewertung. Zwei Fehler, beide in der Messung:
  * Ein Beschäftigungsschwerpunkt wurde von der *nächstgelegenen* Station aus
    gemessen. Ein neuer Halt, der näher lag als der Umsteigebahnhof, den er
    verdrängte, zog den ganzen Schwerpunkt auf seinen Ast. Jetzt zählt jede
    Station in Gehweite als Zugang, jede mit ihrem eigenen Fußweg
    (`TravelGraph::times_from_any`).
  * Die Liste der Schwerpunkte im Mittelwert wurde aus den *vorhandenen*
    Stationen gebildet. Erreichte ein Szenario einen weiteren Schwerpunkt, kam
    für jede Rasterzelle ein Term hinzu — für alle weit entfernten mit dem
    Unerreichbar-Aufschlag — und der Mittelwert wurde schlechter, *weil* gebaut
    worden war. Der Mittelwert läuft jetzt immer über alle Schwerpunkte der
    Stadt.
  Neuer Integrationstest `core/tests/monotone_access.rs`: gegen den echten
  Hamburger Datensatz werden vier Strecken nacheinander gezeichnet, und keine
  darf die mittlere Erreichbarkeit verschlechtern. Er reproduzierte den Fehler
  in 0,2 s. Ein zweiter Test mit der Spielzeugstadt hatte ihn *nicht* gefunden —
  die vorhandene Prüfung zog eine Linie, die zufällig nichts verdrängte.
  Wirkung: beschlossene Vorhaben 330 → 276 Mio. €/Jahr, NKV 0,39 → 0,34;
  Modellversion 0.13.0. Beide Städte kalibrieren weiter im beobachteten Bereich.
* **[F]** 2026-09-03 „Mit dem heutigen Modell neu rechnen" gab es im
  Rechenkern, aber keine Oberfläche rief es je auf — und es setzte die
  Parameter auf `Params::default()`, also für Berlin auf Hamburgs Zahlen. Jetzt
  hält der Rechenkern die Parameter der geladenen Stadt daneben, und sowohl der
  wiederhergestellte Entwurf als auch eine geöffnete Datei werden auf den
  aktuellen Stand gebracht, mit Hinweis darauf im Toast. Vorher rechnete ein
  Entwurf aus der letzten Sitzung still mit einem überholten Modell weiter —
  und die Zahlen änderten sich erst beim Veröffentlichen, im denkbar
  schlechtesten Moment.
* **[F]** 2026-09-03 Ein Doppelklick zum Beenden einer Linie hinterließ die
  Warnung „Setze mindestens zwei Punkte": der zweite Klick begann einen neuen
  Entwurf mit einem Punkt, den das `dblclick`-Ereignis sofort abzuschließen
  versuchte. Der Doppelklick schließt jetzt nur ab, wenn es etwas abzuschließen
  gibt, und räumt sonst still auf — die Warnung machte den Benutzer für ein
  Ereignis verantwortlich, das das Werkzeug selbst erzeugt hatte.

* **[F]** 2026-09-03 **Nichts rechnete veröffentlichte Entwürfe nach einer
  Modelländerung neu.** Aufgefallen direkt nach der Berliner Parameterkorrektur:
  jeder schon veröffentlichte Entwurf behielt seine alten Zahlen, während ein
  identischer Entwurf, heute veröffentlicht, andere bekommen hätte — und die
  Vergleichsseite behauptete derweil, beide Seiten stammten „aus derselben
  Rechnung". Zwei Ursachen:
  * `calculation_version` benennt die *Form* der Rechnung, nicht ihre Werte.
    Sie bewegt sich nicht, wenn eine Kennzahl darin sich ändert, und zwei
    Städte fahren jetzt dieselbe Version mit verschiedenen Zahlen. Ergebnisse
    tragen deshalb zusätzlich einen `parameterFingerprint`: FNV-1a über die
    kanonische JSON-Form des Parametersatzes, zwölf Hexstellen, über Builds und
    Maschinen hinweg identisch — was ein in eine Datenbank geschriebener Wert
    sein muss.
  * Den Job `recalculate_all` gab es, aber niemand reihte ihn je ein. Jetzt
    sucht `requeue_stale` alle drei Minuten je Stadt nach Ergebnissen, deren
    Version *oder* Fingerabdruck nicht mehr der aktuelle ist, und reiht 200
    davon ein. Beim Start sofort — nach einem Deploy sind bis dahin alle Zahlen
    auf allen Seiten falsch. Beim ersten Lauf wurden alle fünf gespeicherten
    Entwürfe erkannt und neu gerechnet; der zweite Lauf reihte nichts ein.
  Die Vergleichsseite prüft das jetzt, statt es zu behaupten: `/api/compare`
  liefert `sameModel`, und stimmen die Stände nicht überein, steht das als
  Hinweis über der Tabelle — und „Vergleich teilen" ist aus, weil ein Bild
  zweier nicht vergleichbarer Netze die Verwechslung überdauert.

* **[F]** 2026-09-03 **Berlin wurde mit Hamburgs Modell gerechnet.** Beim
  vollständigen Durchgehen aller Texte fiel auf, dass die Anwendung an mehreren
  Stellen „Hamburg" sagte, obwohl Berlin geladen war — und dahinter lag kein
  Textfehler, sondern ein Rechenfehler. Der Reihe nach:
  * Der Rechenkern nahm für *jede* Stadt `Params::default()`. Die je Stadt
    veröffentlichte Parameterdatei wurde zwar ausgeliefert und angezeigt, aber
    nie geladen — sie war Dekoration. Jetzt nimmt `Engine::new` sie als
    viertes Argument entgegen, und der Server hält sie je Stadt statt einmal
    global.
  * Berlins Datei war ohnehin auf Stand 0.11.0 stehen geblieben, also mit dem
    verworfenen Verlagerungsanteil von 0,42 statt 0,28.
  * Zwei Kennwerte sind Aussagen über die *Stadt*, nicht über Eisenbahn: der
    Einwohnerschlüssel am Umsatzsteuer-Länderanteil (Hamburg 2,45 %, Berlin
    4,65 % — Berlin hat gut doppelt so viele Einwohner) und der Baugrundfaktor
    (Hamburger Kleimarsch +8 %, Berliner Sande +5 %). Beide stehen jetzt unter
    `modelParams` in `data/cities/<id>.json`; ein Tippfehler im Pfad bricht den
    Import ab, statt die Stadt still auf der Vorgabe zu lassen.
  * Die Fiskalaufstellung des Rechenkerns beschriftete jede Position mit
    „Hamburg", auch für ein Berliner Netz.
  * Die Detailseite lud zum Teilen den Rechenkern der *Standardstadt* — ein
    Berliner Netz wurde damit in Hamburgs metrischer Ebene gezeichnet.
  * Titel, Attribution, Ladebildschirm und die „i"-Erläuterungen nannten fest
    Hamburg, Statistikamt Nord, „99 Stadtteile", „195 041 Gebäude". Die Zahlen
    kommen jetzt aus dem Datensatz selbst (`provenance`), die stadtabhängigen
    Angaben aus den Parametern der geladenen Stadt. Berlin sagt jetzt
    „Ortsteile", 98, 207 331 — und nennt seine Einwohnerzahlen nicht
    „amtlich", weil sie aus OpenStreetMap stammen.
  Drei neue Prüfungen in `tools/test-engine.mjs` halten das fest: keine Stadt
  fest einprogrammiert, jeder Platzhalter belegt, jede Stadt mit eigenen und
  aktuellen Parametern.
* **[F]** 2026-09-03 Der Hinweis „Nicht enthalten" in den „i"-Erläuterungen
  gab `<b>`-Auszeichnungen roh aus — sichtbar als `<b>nicht</b>` in genau dem
  Satz, der sagt, was eine Zahl *nicht* abdeckt. `what`, `caveat` und `source`
  laufen jetzt durch dieselbe Markup-Ausgabe wie die Herleitungsschritte.

* **[I→erledigt]** 2026-09-03 Teilen-Bild für die Vergleichsseite: „Vergleich
  teilen" auf `/vergleich` zeichnet beide Netze nebeneinander, mit gleicher
  Bildausschnitt-Logik und vier Kennzahlen (Investition, Nutzen/Jahr,
  Nutzen-Kosten, Neubau); der jeweils günstigere Wert steht in der Akzentfarbe,
  darunter der Hinweis, dass die Wahl der Kennzahl eine politische Frage ist.
  Beim Prüfen der drei Formate fielen drei Layoutfehler auf und wurden behoben:
  die letzte Zeile fiel unten aus der Karte (die Höhe der Bildunterschrift war
  geschätzt statt gerechnet — die Titelzeilenhöhe und der Abstand über der
  Unterschrift fehlten in der Rechnung), im Hochformat wurde die Karte zum
  Band (jetzt auf ein lesbares Seitenverhältnis begrenzt, der Rest gleichmäßig
  oben und unten), und ein einzeiliger Titel verschob die Kennzahlen der einen
  Spalte gegen die andere (der Titel belegt jetzt immer zwei Zeilen, sonst
  lässt sich nicht quer lesen). Im Querformat stehen Bezeichnung und Wert auf
  einer Zeile — gestapelt kostete das die Karte ein Drittel ihrer Höhe.
* **[P→erledigt]** 2026-09-03 `dangerouslySetInnerHTML` ist aus `Explain.tsx`
  verschwunden; die Erläuterungen werden als React-Elemente gerendert. Übrig
  bleibt allein das Theme-Skript in `layout.tsx`, ein fester String ohne
  Interpolation.

* **[F]** 2026-09-03 Zwei „i"-Erläuterungen nannten veraltete Zahlen: 42 %
  Verlagerung vom Auto (statt 28 %) und 1,31 Mio. Einsteiger (statt 1,39). Die
  Popups sind der Ort, an dem eine Zahl ihre Herleitung zeigt — dort ist eine
  veraltete Angabe schlimmer als anderswo. Dreizehn Angaben werden jetzt von
  `tools/test-engine.mjs` gegen die veröffentlichten Parameter geprüft.
* **[I]** 2026-09-03 Liniennummern auf dem Teilen-Bild, eine je Linie: die
  U5 ist als fünf Bauabschnitte importiert, und fünf gleiche Plaketten sagen
  nichts, was eine nicht sagt.

* **[I]** 2026-09-03 Der Verlauf ist sichtbar: eine Liste der Entscheidungen
  („U-Bahn gezeichnet", „Station entfernt"), neueste zuerst, zurückgenommene
  durchgestrichen. Ein Klick nimmt alles bis einschließlich dieses Schritts
  zurück oder stellt es wieder her. Zwei Pfeile sagen nur, *dass* etwas
  rückgängig zu machen ist; die Liste sagt, was.

* **[F]** 2026-09-03 Die S4 fuhr auf drei Abschnitten quer durch Wandsbek statt
  entlang der Lübecker Bahn. Ursache: die Bahnhöfe heißen in OSM
  „Hamburg-Tonndorf", „Hamburg-Rahlstedt", und ohne das Stadtpräfix zu
  entfernen verlor der Bahnhof gegen den *Stadtteil* gleichen Namens. Für
  Wandsbek gibt es überhaupt nur einen `stop_area` — der zählt jetzt als
  Bahnhofskandidat. Alle elf Abschnitte folgen nun der Bestandsstrecke,
  Abweichung gegenüber der veröffentlichten Kostenangabe von −13 % auf −6 %.
* **[F]** 2026-09-03 Die Bestandsgleise fehlten rund um große Bahnhöfe: die
  Gleise werden dort als viele kurze Wege erfasst, und die Längenschwelle warf
  sie einzeln weg — der Hamburger Hauptbahnhof hatte im Datensatz im Umkreis
  von 800 m kein Gleis. Jetzt werden sie erst zusammengefügt, dann gefiltert
  (128 statt 595 Linien). Damit verschwand auch der Fehlalarm „oberirdische
  Strecke in bebautem Gebiet" für die S4.
* **[F]** 2026-09-03 Der Trassierungs-Router konnte durch einen Bahnhofskopf
  zurücklaufen — 6,5 km für einen 3,4-km-Abschnitt. Ein Korridor wird nur noch
  gefolgt, solange er ungefähr auf dem Weg bleibt.
* **[F]** 2026-09-03 Die Neuberechnung im Hintergrund schrieb das gespeicherte
  Ergebnis, aber nicht die Übersichtsspalten — die Karte in der Liste zeigte
  danach eine andere Investition als die Detailseite.
* **[I]** 2026-09-03 Enge Bögen in *nachgezeichneten* Trassen sind jetzt ein
  Hinweis statt einer Warnung, mit der ehrlichen Begründung: die Krümmung sagt
  dort mehr über die Digitalisierung der Vorlage als über die Planung. Bei
  selbst gezeichneten Linien bleibt es eine Warnung — dort ist die Ecke eine
  Entscheidung.

* **[I]** 2026-09-03 Die Anwendung ist ohne Maus bedienbar, das Zeichnen
  eingeschlossen: der Kartenmittelpunkt ist der Zeiger, die Pfeiltasten
  schieben den Boden darunter durch, Leertaste setzt einen Halt, Enter
  beendet. Dazu Sprungmarken zu Karte, Analyse und Linienliste — ohne sie
  liegen sechzig Häkchen zwischen Kopfzeile und Auswertung. Alle 100
  fokussierbaren Elemente haben eine Beschriftung.

* **[F]** 2026-09-02 Der größte Nutzenposten war ein Rechenfehler. Der
  Agglomerationsnutzen wandte eine Elastizität auf einen *Bestand* an: jeder
  neu erschlossene Einwohner brachte 4 % seiner gesamten Jahresleistung, für
  immer — rund 1 900 € je Kopf und 45 % des gesamten Nutzens der Hamburger
  Vorhaben. Eine Agglomerationselastizität gilt für die *Veränderung* der
  effektiven Dichte. Jetzt: Elastizität auf die relative Wegeverkürzung der
  Erwerbstätigen im Einzugsbereich.
* **[F]** 2026-09-02 Der Verlagerungsanteil vom Auto lag bei 0,42 — das hätte
  bedeutet, dass die beschlossenen Vorhaben 96 000 Autofahrten je Werktag
  ersetzen, etwa doppelt so viel wie die Vorhabenträger selbst angeben. Jetzt
  0,28, im Bereich dessen, was Nacherhebungen zu neuen deutschen Stadtbahnen
  finden.
* **[I]** 2026-09-02 Der Reiter „Wirkung" weist jetzt den Nutzen **ohne**
  weitere volkswirtschaftliche Wirkungen gesondert aus und sagt, dass die
  Standardisierte Bewertung diese nicht mitzählt, dafür aber anderes, das
  dieses Modell nicht kennt — veröffentlichte NKV sind also nicht direkt
  vergleichbar.

  Wirkung insgesamt: Nutzen der beschlossenen Vorhaben von 635 auf 332 Mio.
  €/Jahr, NKV von 0,66 auf 0,39, CO₂ von 19 100 auf 7 200 t/Jahr.

* **[F]** 2026-09-02 Der Editor gab einer ganzen Linie *eine* Bauweise. Ein
  Korridor, der einen Fluss quert, unter der Innenstadt verläuft und dann ins
  Freie führt, sind drei verschiedene Bauwerke — ein Kilometerpreis für alles
  war der größte Grund, warum eine gezeichnete Linie unrealistisch war. Die
  Bauweise wird jetzt **je Abschnitt** aus Gewässer, Bebauungsdichte und
  vorhandenen Bahnkorridoren gewählt, über Nachbarabschnitte geglättet
  (niemand taucht für einen Halt zwischen zwei Tunneln auf), und jede Station
  bekommt die Tiefe des Gleises, das sie erreicht. Die Seitenleiste zeigt die
  Mischung in Kilometern. Eine ausdrücklich gewählte Bauweise bleibt
  unangetastet.

  Wirkung: Eine S-Bahn quer durch die Innenstadt kostet jetzt 576 statt
  108 Mio. €/km, weil sie im Tunnel gebaut wird statt oberirdisch mit einem
  nachträglichen Warnhinweis. Eine U-Bahn in die Vier- und Marschlande fährt
  auf dem Viadukt und über Brücken statt im Tunnel — 335 statt 700 Mio. €/km.

* **[F]** 2026-09-02 In der Entdecken-Liste war einem Entwurf nicht anzusehen,
  für welche Stadt er ist. Jede Karte trägt jetzt die Stadt, und die Liste
  lässt sich danach filtern.

* **[F]** 2026-09-02 Die Testsuiten liefen gegen ihre eigene Ratenbegrenzung.
  Sie benutzen jetzt ein Konto je Stunde und merken sich die Sitzung; auf dem
  Entwicklungsrechner räumt `HH_TEST_DB` die adressbezogenen Zähler weg.

* **[F]** 2026-09-02 CORS fiel ohne `HH_ALLOWED_ORIGIN` auf „jede Herkunft"
  zurück — eine vergessene Umgebungsvariable hätte die API für jede Seite im
  Netz geöffnet. Ohne Angabe gilt jetzt localhost; alles Weitere muss
  ausdrücklich gesetzt werden.
* **[F]** 2026-09-02 Obergrenze für die Zahl der Entwürfe je Konto (200): das
  Stundenlimit allein ließ tausend am Tag zu.
* **[I]** 2026-09-02 Der Importer meldet jetzt Linien, die vor ihrem in der
  Relation angegebenen Endpunkt enden — so fällt eine unvollständige
  OSM-Relation beim Import auf und nicht erst auf der Karte.

* **[I]** 2026-09-02 Geteilte Szenario-Links haben jetzt eine Vorschau: Titel,
  Beschreibung und ein serverseitig gezeichnetes Bild des Netzes mit den drei
  Kennzahlen — in den Linienfarben, ohne dass ein Crawler JavaScript ausführen
  müsste. Abgesichert in `tools/test-flow.mjs`.
* **[I]** 2026-09-02 Die Station unter dem Zeiger wird jetzt hervorgehoben —
  vorher war die einzige Rückmeldung ein Label an anderer Stelle des Bildschirms.

* **[I]** 2026-09-02 Zweite Stadt: Berlin. Projektionsursprung, Ausschnitt,
  Einwohnerquelle und Linienfarben stehen jetzt in `data/cities/<id>.json`; der
  Rechenkern nimmt den Ursprung aus dem Datensatz, und der Server hält beide
  Städte gleichzeitig, jede in ihrer eigenen metrischen Ebene.
* **[I]** 2026-09-02 Teilen: Bild im Browser erzeugt (Beitrag, Story, Quadrat),
  mit Netz, Titel, Investition, Nutzen und Nutzen-Kosten-Verhältnis, dazu die
  Plattformen X, Bluesky, Mastodon, Facebook, LinkedIn, WhatsApp, Reddit,
  Telegram sowie Speichern, Kopieren und das Teilen-Menü des Geräts.
* **[F]** 2026-09-02 Straßenbahnen im Tunnel galten als unzulässig — Berlins
  Bestandsnetz ließ sich deshalb nicht importieren. Stadtbahntunnel sind in
  Deutschland Normalfall (Karlsruhe, Stuttgart, Bremen).
* **[F]** 2026-09-02 Eine oberirdische Strecke durch dichte Bebauung wurde als
  „keine baulichen Auffälligkeiten" gemeldet — eine S-Bahn quer durch die
  Innenstadt kostete damit ein Viertel des Realistischen, ohne Hinweis. Neuer
  Baubarkeitsbefund, mit Ausnahme für Trassen entlang bestehender Bahnkorridore
  (so wird die S4 tatsächlich gebaut).

* **[F]** 2026-09-02 Das Werkzeug „Weiterbauen" tat nichts, solange die Linie
  nicht vorher in der Seitenleiste ausgewählt war — ohne jede Rückmeldung. Der
  erste Klick wählt jetzt das nächstgelegene Linienende.
* **[F]** 2026-09-02 Halte ließen sich nicht entfernen, wenn an ihnen ein
  *abgeschaltetes* Vorhaben endete: die Fehlermeldung nannte Linien, die gar
  nicht auf der Karte sind. Editoroperationen zählen jetzt nur aktive
  Abschnitte — und der Knoten bleibt stehen, wenn andere Strecken ihn noch
  brauchen (sonst zeigten deren Kanten ins Leere).
* **[F]** 2026-09-02 Speichern rundete die Koordinaten, das laufende Netz nicht
  — dieselbe Planung kostete nach dem Laden ein paar tausend Euro anders. Jetzt
  wird nach jedem Befehl gerundet, Speichern und Laden ist bit-identisch.

* **[F]** 2026-09-02 Das Rate Limit hat nie gegriffen: der Fensterschlüssel
  behielt die Bruchteile einer Sekunde, also bekam jede Anfrage ihre eigene
  Zeile und der Zähler stand immer auf 1. Anmeldeversuche, Registrierungen,
  Kommentare und Stimmen waren damit unbegrenzt. Gefunden von
  `tools/test-security.mjs`.
* **[F]** 2026-09-02 Die Größengrenze für Szenarien lag bei 20 000 Knoten — eine
  Analyse dieser Größe kostet den Server acht Sekunden Rechenzeit. Jetzt 3 000
  Knoten (das Zwölffache des Hamburger Netzes) bei 0,25 s, abgesichert durch
  `rust/core/tests/size_limits.rs`.
* **[F]** 2026-09-02 Anmeldung und Registrierung waren nur je Nutzername
  begrenzt — gegen Password Spraying und Massenregistrierung wirkungslos. Jetzt
  zusätzlich je Adresse.
* **[F]** 2026-09-02 Kalibrierung: der Endbahnhof einer verlängerten Linie wurde
  wie ein Umbau für eine neue Linie berechnet (35 % eines Neubaus statt 10 %).
  U4 Horner Geest dadurch von +50 % auf +29 %.

* **[F]** 2026-09-02 U5 zwischen Sengelmannstraße und City Nord optisch
  unterbrochen: Die Eckenverrundung schnitt Kurven an Stationsknoten ab und
  verschob die Trasse um bis zu 90 m. `round_corridor_through` verrundet jetzt
  nur *zwischen* Halten; zusätzlich rasten Kantenenden auf die Knotenposition
  ein. Abweichung jetzt 0 von 318 Kanten.
* **[P→erledigt]** 2026-09-02 S-Bahn im Tunnel: geprüft. Alle Bauweisen sind
  für S-Bahn und Regionalbahn wählbar, und die Kosten staffeln sich richtig
  (3,7 km: oberirdisch 0,40 Mrd. €, offene Bauweise 1,49 Mrd. €, bergmännisch
  2,16 Mrd. €). Neu: eine oberirdische Strecke durch dichte Bebauung wird jetzt
  als kritisch gemeldet — vorher meldete das Modell für eine S-Bahn quer durch
  die Innenstadt „keine baulichen Auffälligkeiten".
* **[F]** 2026-09-02 Bogenprüfung maß Digitalisierungsrauschen statt Trassierung
  (Radien von 3 m in geraden Tunneln, rund 100 Fehlalarme). Sie misst jetzt über
  eine Sehne von 55 m.
* **[F]** 2026-09-02 Kalibrierung schaltete für jedes Projekt das gesamte übrige
  Netz ab — dadurch verlor die verlängerte Linie ihren eigenen Bestand, und der
  Endbahnhof wurde als Umbau für eine „neue" Linie berechnet. Größte Abweichung
  dadurch von 50 % auf 29 % gefallen.
* **[F]** 2026-09-02 Gewässer verzerrt: Douglas–Peucker auf geschlossenen
  Ringen hing am doppelten Anfangspunkt und schnitt Buchten ab — 56 Gewässer
  wichen um mehr als 10 % ab, eines um +27 %. `simplifyRing` verrundet jetzt
  über zwei Bögen mit flächenbezogener Toleranz; größte Abweichung 4,8 %, und
  der Importer bricht oberhalb von 8 % ab.
