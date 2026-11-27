// How each headline figure is derived, in the words of the model itself.
//
// The numbers quoted here come from the parameter set in
// `rust/core/src/params.rs`; if that changes, these change with it.
//
// A few of them are statements about the city rather than about railways — the
// share of the VAT pot a Land receives, what its subsoil costs to dig through —
// and those are written as placeholders and filled in from the loaded city's
// own parameters. Spelled out, they said "Hamburg" over a Berlin network.

import type { Explanation } from '@/components/Explain';

export const EXPLAIN: Record<string, Explanation> = {
  network: {
    title: 'Netzlänge',
    what: 'Die Gesamtlänge aller Strecken, die in diesem Szenario eingeschaltet sind.',
    how: [
      'Jede eingeschaltete Linie besteht aus Abschnitten, die jeweils zwei Stationen verbinden.',
      'Ein Abschnitt, den sich mehrere Linien teilen, zählt nur <b>einmal</b>, weil gemeinsam genutztes Gleis sonst doppelt gezählt würde.',
      'Die Längen folgen dem tatsächlichen Streckenverlauf und nicht der Luftlinie.',
    ],
    source: 'Streckengeometrie aus OpenStreetMap, geplante Trassen aus den Projektdaten.',
  },
  newKm: {
    title: 'Neubau',
    what: 'Wie viele Kilometer in diesem Szenario gebaut werden müssten.',
    how: [
      'Bestandsstrecken zählen nicht mit, weil sie bereits vorhanden sind.',
      'Abschnitte, die schon im Bau sind, zählen zu <b>65 %</b>, weil der begonnene Teil bereits ausgegeben ist.',
      'Alle übrigen Abschnitte zählen voll.',
    ],
  },
  investment: {
    title: 'Investition',
    what: 'Was der Bau dieses Szenarios schätzungsweise kosten würde, gerechnet in heutigen Preisen zuzüglich der Baupreissteigerung bis zur Bauzeit.',
    how: [
      'Jeder Abschnitt erhält einen <b>Kennwert je Kilometer</b>, der von der Bauweise abhängt: etwa 105 Mio. € für einen bergmännischen Tunnel, 26 Mio. € für eine oberirdische Strecke und 14 Mio. € für eine Straßenbahn.',
      'Hinzu kommen ein Zuschlag für die <b>Bebauungsdichte</b> (bis +30 %), ein Zuschlag für den {stadtAdj} Baugrund ({baugrund}) und Kosten je Meter Gewässerquerung.',
      'Stationen kosten je nach Lage 215 Mio. € (tief), 125 Mio. € (offen gebaut), 16 Mio. € (oberirdisch) oder 0,85 Mio. € (Straßenbahnhaltestelle), wobei Umsteigebauwerke ×1,45 zählen.',
      'Darauf werden Planung (12 %), Projektsteuerung (4 %), Grunderwerb und Leitungen (3–7,5 %), die Fahrzeuge für den gefahrenen Takt und eine Risikovorsorge (15–25 %) aufgeschlagen.',
      'Zuletzt kommt eine <b>Baupreissteigerung</b> von 2 % pro Jahr hinzu, die bis zur Mitte der Bauzeit gerechnet wird.',
    ],
    caveat:
      'Baugrunduntersuchungen, Leitungslage, Grundstückspreise und Entschädigungen im Einzelfall sowie politische Entscheidungen.',
    source:
      'Kennwerte aus veröffentlichten Projektkosten. Gegenüber den aktuellen Angaben für U5 Ost, U5 City Nord–Jarrestraße, U4 Horner Geest und S4 weicht das Modell zwischen 5 und 39 % ab.',
  },
  opening: {
    title: 'Eröffnung',
    what: 'Wann der letzte Abschnitt dieses Szenarios frühestens in Betrieb gehen könnte.',
    how: [
      'Ab 2026 folgen Vorplanung, Planfeststellung, Entwurfsplanung und Vergabe aufeinander, was umso länger dauert, je größer das Vorhaben ist.',
      'Die Bauzeit ergibt sich aus der Einrichtung der Baustelle sowie den Jahren je Kilometer und je Station, die durch die Zahl der <b>parallelen Baufelder</b> (höchstens fünf) geteilt werden.',
      'Deshalb dauern 25 km nicht fünfmal so lange wie 5 km.',
      'Danach folgen Probebetrieb und Zulassung.',
      'Abschnitte, die schon im Bau sind, überspringen Planung und Genehmigung.',
    ],
    caveat: 'Klagen, Haushaltssperren und Insolvenzen von Baufirmen, obwohl sie die häufigsten Gründe für Verzögerungen sind.',
  },
  benefit: {
    title: 'Volkswirtschaftlicher Nutzen',
    what: 'Was das Szenario der Gesellschaft pro Jahr wert wäre, ausgedrückt als Wohlfahrtsgewinn und nicht als Einnahme einer öffentlichen Kasse.',
    how: [
      '<b>Reisezeit</b> ist der größte Posten: Zwischen allen Stadtteilen und den Orten des Umlands wird die schnellste Verbindung von Tür zu Tür berechnet, Umstiege eingerechnet, einmal im heutigen Netz und einmal im Netz des Szenarios.',
      'Die eingesparten Stunden, die der Reiter „Verbindungen" herleitet, werden mit <b>8,64 € je Stunde</b> bewertet, wobei Fahrten, die erst die schnellere Verbindung gewinnt, etwa zur Hälfte zählen.',
      '<b>Produktivität</b> wird mit einer Elastizität von 0,04 auf die <i>relative</i> Verkürzung der Wege angesetzt, die die Erwerbstätigen im Einzugsbereich gewinnen.',
      '<b>Straße</b>: Jeder vermiedene Pkw-Kilometer spart 0,108 € Stau, 0,111 € Unfälle sowie 0,019 € Luft und Lärm.',
      '<b>Klima</b>: 0,168 kg CO₂ je Pkw-km abzüglich Bahnstrom, bewertet mit 877 € je Tonne.',
      'Hinzu kommen der Gesundheitsnutzen der Fußwege zur Station und der auf ein Jahr umgerechnete Zuwachs der Bodenwerte.',
      'Produktivität und Bodenwerte sind <b>weitere volkswirtschaftliche Wirkungen</b>, die die Standardisierte Bewertung nicht mitzählt, weshalb der Reiter „Wirkung" den Nutzen auch ohne sie ausweist.',
    ],
    caveat:
      'Ein Verkehrsmodell mit Quelle-Ziel-Matrix sowie zwei Wirkungen, die die Standardisierte Bewertung kennt: eingesparte Busleistung und Fahrzeugbetriebskosten der Nutzer. Die Unsicherheit wird mit ±35 % ausgewiesen.',
    source:
      'Zeitwert, Unfallkosten, CO₂-Ausstoß und CO₂-Preis stammen aus der Standardisierten Bewertung 2016+ und sind mit dem Verbraucherpreisindex auf Preise von 2026 umgerechnet. Eine Standardisierte Bewertung ist das Modell trotzdem nicht.',
  },
  fiscal: {
    title: 'Fiskaleffekt für {Stadt}',
    what: 'Welcher Teil des Nutzens als Steuereinnahme im {stadtAdj} Haushalt ankommt, was deutlich weniger ist als der Nutzen selbst.',
    how: [
      'Besteuert wird nur der <b>produktive</b> Teil des Nutzens, also die Produktivitätswirkung und 35 % der Reisezeitgewinne, die auf Geschäfts- und Pendelwege entfallen.',
      'Von der Lohn- und Einkommensteuer (18,5 %) erhält {Stadt} als Stadtstaat den Landes- <b>und</b> den Gemeindeanteil, zusammen 57,5 %.',
      'Die Gewerbesteuer wird mit {gewerbesteuer} der Wertschöpfung angesetzt, was dem tatsächlichen Aufkommen im Verhältnis zur Wertschöpfung der Stadt entspricht. Davon bleiben {gewerbesteuerAnteil} bei {Stadt}, weil ein Stadtstaat den Landesanteil der Gewerbesteuerumlage behält und nur den Bundesanteil abführt.',
      'Von der Umsatzsteuer erhält {Stadt} über den Länderanteil ({ustLaender}) den Teil, der seinem Einwohnerschlüssel entspricht ({ustSchluessel}).',
      'Die Grundsteuer steigt nur so weit, wie ihre Bemessung nach Landesrecht dem Wert folgt, weshalb sie mit {grundsteuer} des Wertzuwachses im Jahr angesetzt wird. Hinzu kommt Grunderwerbsteuer von {grunderwerbsteuer} auf den Anteil der Grundstücke, der jährlich den Eigentümer wechselt.',
      'Der Fiskaleffekt lässt sich <b>nicht</b> zum Nutzen addieren, weil beide dieselbe Wirkung aus zwei Blickwinkeln beschreiben.',
    ],
  },
  operating: {
    title: 'Betriebsergebnis',
    what: 'Die jährlichen Fahrgeldeinnahmen abzüglich der laufenden Kosten des gesamten Szenarionetzes.',
    how: [
      'Die Zug-Kilometer ergeben sich aus Takt, Betriebszeit und Linienlänge.',
      'Ein Zug-Kilometer kostet 11,40 € bei der Straßenbahn, 15,20 € bei der U-Bahn und 19,60 € bei der S-Bahn.',
      'Hinzu kommen die Instandhaltung je Kilometer, die von der Bauweise abhängt, und der Stationsbetrieb, der von der Lage abhängt.',
      'Die Erlöse sind die Fahrten multipliziert mit 1,05 € Durchschnittserlös je Einsteiger.',
      'Die Kostensätze sind so <b>kalibriert</b>, dass das heutige Hamburger Netz 75 % seiner Kosten aus Fahrgeld deckt, wie es die HOCHBAHN für 2025 ausweist.',
      'In das Nutzen-Kosten-Verhältnis geht nur ein, um wie viel sich das Ergebnis gegenüber dem heutigen Netz verändert.',
    ],
    caveat:
      'Ausgleichszahlungen der öffentlichen Hand, mit denen das im deutschen Nahverkehr übliche negative Ergebnis finanziert wird.',
    source: 'HOCHBAHN, Lagebericht 2025 (Erlös je Fahrgast, Kostendeckungsgrad).',
  },
  bcr: {
    title: 'Nutzen-Kosten-Verhältnis',
    what: 'Der Barwert des Nutzens geteilt durch den Barwert der Kosten. In der amtlichen Bewertung gilt ein Vorhaben als förderwürdig, wenn der Wert über 1,0 liegt, während dieses Modell meist niedrigere Werte ergibt.',
    how: [
      'Alle Zahlungen werden mit <b>1,7 % real</b> abgezinst, und zwar über 30 Jahre ab der Eröffnung.',
      'Die Nachfrage wächst über vier Jahre auf ihren vollen Wert.',
      'Am Ende des Zeitraums wird ein Restwert von 25 % der Investition angesetzt.',
      'Zu den Kosten zählen die Investition und die Verschlechterung des Betriebsergebnisses gegenüber dem heutigen Netz.',
      'Im Nutzen stecken auch <b>weitere volkswirtschaftliche Wirkungen</b> (Produktivität, Bodenwerte), die eine amtliche Bewertung nicht mitzählt, weshalb der Reiter „Wirkung" den Nutzen auch ohne sie ausweist.',
    ],
    caveat:
      'Wirkungen, die nur die amtliche Standardisierte Bewertung erfasst, weshalb sich die Zahl nicht mit veröffentlichten Nutzen-Kosten-Verhältnissen vergleichen lässt. Zur Einordnung: Die in Hamburg geplanten Vorhaben S4, U4 und U5 zusammen kommen in diesem Modell auf rund 0,60, während die amtliche Bewertung der U5 allein 1,27 ergibt. Die Zahl eignet sich deshalb vor allem dazu, Entwürfe untereinander zu vergleichen.',
  },
  feasibility: {
    title: 'Baubarkeit',
    what: 'Ob sich die gezeichnete Trasse in dieser Form bauen ließe.',
    how: [
      'Geprüft werden Bogenradien, Gewässerquerungen, die Eignung der Bauweise, Straßenbahnen ohne Straßenraum, zu enge Stationsabstände und unvereinbare Verkehrsmittel auf gemeinsamem Gleis.',
      'Der Schweregrad wird auf die Größe des Vorhabens bezogen, sodass zwei Hinweise auf 40 km weniger wiegen als zwei auf 2 km.',
    ],
    caveat: 'Baugrund und Leitungslage, obwohl gerade sie Tunnelprojekte in der Praxis verteuern.',
  },
  timeSaved: {
    title: 'Zeitgewinn',
    what: 'Wie viele Stunden Reisezeit das Szenario an einem Werktag einspart, auf allen Wegen zwischen den Stadtteilen und dem Umland.',
    how: [
      'Die Stadtteile und, außerhalb der Stadt, Kacheln von 5 km Kantenlänge bilden die Zonen, zwischen denen die schnellste Verbindung von Tür zu Tür gesucht wird: Fußweg, Warten, Fahrt, <b>Umstiege</b> und Fußweg am Ziel.',
      'Wohin Menschen fahren und ob sie die Bahn nehmen, folgt einem Logit-Modell, in dem ein Ziel mit seinen Einwohnern und Arbeitsplätzen anzieht und mit der Reisezeit an Anziehung verliert.',
      'Das Modell ist am heutigen Netz <b>kalibriert</b>: Es ergibt die heutigen Einsteiger, und die Nachfrage reagiert auf die Fahrzeit mit einer Elastizität von −0,5.',
      'Wer die Bahn ohnehin nimmt, gewinnt die volle Zeitersparnis, und wer erst durch die schnellere Verbindung umsteigt, ungefähr die Hälfte davon. Fällt eine Verbindung weg, zählt das als Verlust.',
    ],
    caveat: 'Kapazitätsgrenzen, Fahrpläne im Einzelnen und Wege innerhalb eines Stadtteils.',
    source:
      'Elastizität nach Balcombe u. a. (2004), TRL-Bericht 593; Wege je Person und Tag nach MiD 2023 (Hamburg) und SrV 2023 (Berlin).',
  },
  boardings: {
    title: 'Einsteiger je Werktag',
    what: 'Wie viele Menschen an einem gewöhnlichen Werktag im gesamten Szenarionetz einsteigen würden.',
    how: [
      'Für jede Station werden die Einwohner und Arbeitsplätze im Umkreis gezählt, wobei ihr Gewicht mit der Entfernung abnimmt (U-Bahn 800 m, S-Bahn 1 000 m, Straßenbahn 500 m).',
      'Arbeitsplätze zählen 1,35-fach, Umsteigepunkte 1,55-fach und Innenstadtlagen 1,35-fach.',
      'Die Rate je Verkehrsmittel ist so <b>kalibriert</b>, dass das heutige Netz die Fahrgastzahlen ergibt, die die Verkehrsunternehmen für 2025 veröffentlicht haben: in Hamburg rund 570 Mio. Fahrten auf U- und S-Bahn, in Berlin rund 1 250 Mio. einschließlich Straßenbahn.',
      'Ein Werktag entspricht dabei dem 305. Teil eines Jahres.',
    ],
    caveat: 'Kapazitätsgrenzen, Umsteigezwänge im Einzelnen und die Verteilung über den Tag.',
    source: 'HOCHBAHN, Lagebericht 2025; S-Bahn Hamburg; BVG in Zahlen 2025; S-Bahn Berlin.',
  },
  population: {
    title: 'Erschlossene Einwohner',
    what: 'Wie viele Menschen eine Station zu Fuß erreichen könnten.',
    how: [
      '{einwohnerzahlen} der {stadtteilzahl} {stadtteile} werden auf ein 200-Meter-Raster verteilt, das nach der modellierten Wohn-Geschossfläche von {gebaeude} Gebäuden gewichtet ist.',
      'Gezählt wird jede Rasterzelle, von der aus eine Station innerhalb von 1 200 m Fußweg liegt.',
      'Die große Zahl gilt für das <b>fertige Netz</b> einschließlich der Bestandsstrecken und ändert sich durch einen Entwurf nur wenig, weshalb Entwürfe über die <b>neu erschlossenen</b> Einwohner verglichen werden.',
    ],
    source: '{quelle}',
  },
  co2: {
    title: 'CO₂-Einsparung',
    what: 'Die Treibhausgase, die pro Jahr netto vermieden werden.',
    how: [
      'Ein Teil der neuen Fahrten ersetzt Autofahrten (28 %, im Mittel 8,4 km).',
      'Vermieden werden 0,168 kg CO₂ je Pkw-Kilometer, davon 127 g aus dem Auspuff und 41 g aus der Kraftstoffherstellung.',
      'Davon wird der Bahnstrom abgezogen, den die zusätzliche Fahrleistung verbraucht.',
    ],
    caveat: 'Der Bau selbst, obwohl Beton und Stahl eines Tunnels erhebliche Emissionen verursachen.',
  },
  stations: {
    title: 'Stationen',
    what: 'Alle Halte im Szenario und die Zahl derer, die neu gebaut würden.',
    how: [
      'Beim Zeichnen entsteht an jedem gesetzten Punkt eine Station.',
      'Dazwischen ergänzt die App weitere Stationen, wo Einzugsbereich, Umsteigemöglichkeit oder ein wichtiges Ziel dafür sprechen.',
      'Der Zielabstand beträgt 1 000 m bei der U-Bahn, 1 900 m bei der S-Bahn und 450 m bei der Straßenbahn.',
      'Eine Station entsteht nicht allein deshalb, weil der Abstand erreicht ist, während ein wichtiges Ziel den Abstand unterschreiten darf.',
    ],
  },
};


// ------------------------------------------------------- filling in the city --

/** The parameter set the loaded engine is working with, if it has been read. */
export interface CityFigures {
  name: string;
  adjective: string;
  vatCityShare: number;
  tradeTaxRate: number;
  tradeTaxCityShare: number;
  vatLaenderShare: number;
  propertyTaxRate: number;
  transferTaxRate: number;
  groundConditionsFactor: number;
  provenance?: {
    districtTerm: string;
    districtCount: number;
    buildingsCounted: number;
    populationSource: string;
    officialPopulation: boolean;
  } | null;
}

const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits).replace('.', ',')} %`;

/**
 * Fill the city's own figures into an explanation.
 *
 * Falls back to leaving the placeholder's default reading — Hamburg — only
 * when nothing has been loaded yet, which is a moment, not a state anyone
 * reads.
 */
export function localise(info: Explanation, city: CityFigures | null): Explanation {
  if (!city) return info;
  const p = city.provenance;
  const num = (v: number) => v.toLocaleString('de-DE');
  const map: Record<string, string> = {
    '{Stadt}': city.name,
    '{stadtAdj}': city.adjective,
    '{ustSchluessel}': pct(city.vatCityShare),
    '{gewerbesteuer}': pct(city.tradeTaxRate),
    '{gewerbesteuerAnteil}': pct(city.tradeTaxCityShare, 1),
    '{ustLaender}': pct(city.vatLaenderShare, 1),
    '{grundsteuer}': pct(city.propertyTaxRate),
    '{grunderwerbsteuer}': pct(city.transferTaxRate, 1),
    '{baugrund}': `+${pct(city.groundConditionsFactor - 1, 0)}`,
    // "Amtlich" is a claim about the source, not a decoration: a city whose
    // figures came from anywhere but the statistical office must not say so.
    '{einwohnerzahlen}': p?.officialPopulation
      ? 'Die amtlichen Einwohnerzahlen'
      : 'Die Einwohnerzahlen',
    '{stadtteilzahl}': p ? num(p.districtCount) : '',
    '{stadtteile}': p?.districtTerm ?? 'Stadtteile',
    '{gebaeude}': p ? num(p.buildingsCounted) : '',
    '{quelle}': p?.populationSource ?? '',
  };
  const keys = Object.keys(map)
    .map((k) => k.slice(1, -1))
    .join('|');
  const re = new RegExp(`\\{(${keys})\\}`, 'g');
  const sub = (t: string) => t.replace(re, (m) => map[m] ?? m);
  return {
    ...info,
    title: sub(info.title),
    what: sub(info.what),
    how: info.how.map(sub),
    caveat: info.caveat ? sub(info.caveat) : info.caveat,
    source: info.source ? sub(info.source) : info.source,
  };
}
