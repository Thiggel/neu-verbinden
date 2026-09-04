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
    what: 'Die Gesamtlänge aller Strecken, die in diesem Szenario aktiv sind.',
    how: [
      'Jede eingeschaltete Linie besteht aus Abschnitten zwischen zwei Stationen.',
      'Ein Abschnitt, den sich mehrere Linien teilen, zählt nur <b>einmal</b>. Sonst wäre gemeinsam genutztes Gleis doppelt gezählt.',
      'Die Längen kommen aus der echten Geometrie, nicht aus Luftlinien.',
    ],
    source: 'Streckengeometrie aus OpenStreetMap, geplante Trassen aus den Projektdaten.',
  },
  newKm: {
    title: 'Neubau',
    what: 'Wie viele Kilometer in diesem Szenario tatsächlich gebaut werden müssten.',
    how: [
      'Bestandsstrecken zählen nicht mit, sie stehen schon.',
      'Abschnitte, die real bereits im Bau sind, zählen zu <b>65 %</b>: der begonnene Teil ist versunkene Investition.',
      'Alles andere zählt voll.',
    ],
  },
  investment: {
    title: 'Investition',
    what: 'Was der Bau dieses Szenarios schätzungsweise kosten würde, in heutigen Preisen zuzüglich Baupreissteigerung.',
    how: [
      'Jeder Abschnitt: <b>Kennwert je km</b> nach Bauweise, etwa 105 Mio. € für bergmännischen Tunnel, 26 Mio. € oberirdisch, 14 Mio. € Straßenbahn.',
      'Mal Zuschlag für <b>Bebauungsdichte</b> (bis +30 %) und {stadtAdj} Baugrund ({baugrund}), plus Kosten je Meter Gewässerquerung.',
      'Stationen nach Lage: tief 215 Mio. €, offen gebaut 125 Mio. €, oberirdisch 16 Mio. €, Straßenbahnhaltestelle 0,85 Mio. €. Umsteigebauwerke ×1,45.',
      'Darauf Planung (12 %), Projektsteuerung (4 %), Grunderwerb und Leitungen (3–7,5 %), Fahrzeuge aus dem gefahrenen Takt, Risikovorsorge (15–25 %).',
      'Zuletzt <b>Baupreissteigerung</b> von 2 % pro Jahr bis zur Mitte der Bauzeit.',
    ],
    caveat:
      'Baugrunduntersuchungen, Leitungslage, Grundstückspreise im Einzelfall, Entschädigungen und alles Politische.',
    source:
      'Kennwerte kalibriert an den veröffentlichten Kosten von U5 Ost, U5 City Nord–Jarrestraße, U4 Horner Geest und S4.',
  },
  opening: {
    title: 'Eröffnung',
    what: 'Wann der letzte Abschnitt dieses Szenarios frühestens in Betrieb gehen könnte.',
    how: [
      'Ab 2026: Vorplanung, Planfeststellung, Entwurfsplanung, Vergabe. Je größer das Vorhaben, desto länger.',
      'Bauzeit = Einrichtung + (Jahre je km + Jahre je Station) geteilt durch die Zahl der <b>parallelen Baufelder</b> (höchstens fünf).',
      'Deshalb dauern 25 km nicht das Fünffache von 5 km.',
      'Dann Probebetrieb und Zulassung.',
      'Abschnitte, die schon im Bau sind, überspringen Planung und Genehmigung.',
    ],
    caveat: 'Klagen, Haushaltssperren, Insolvenzen von Baufirmen, also die häufigsten Verzögerungsgründe.',
  },
  benefit: {
    title: 'Volkswirtschaftlicher Nutzen',
    what: 'Was das Szenario der Gesellschaft pro Jahr wert wäre: Wohlfahrt, nicht Geld in einer Kasse.',
    how: [
      '<b>Reisezeit</b> (der größte Posten): Für jede bewohnte Rasterzelle wird die schnellste Verbindung zu den 14 Beschäftigungszentren berechnet, einmal mit, einmal ohne die neuen Abschnitte.',
      'Die Differenz mal Zahl der Fahrten mal <b>11,20 € je Stunde</b>. Neu entstehende Fahrten zählen nur zur Hälfte.',
      '<b>Produktivität</b>: Elastizität 0,04 auf die <i>relative</i> Verkürzung der Wege für die Erwerbstätigen im Einzugsbereich, nicht auf ihre Zahl.',
      '<b>Straße</b>: vermiedene Pkw-Kilometer × 0,108 € Stau + 0,033 € Unfälle + 0,019 € Luft und Lärm.',
      '<b>Klima</b>: 0,145 kg CO₂ je Pkw-km abzüglich Bahnstrom, bewertet mit 300 € je Tonne.',
      'Dazu Gesundheit des Zu- und Abgangs und annuisierte Bodenwerteffekte.',
      'Produktivität und Bodenwerte sind <b>weitere volkswirtschaftliche Wirkungen</b>. Die Standardisierte Bewertung zählt sie nicht mit; der Nutzen ohne sie steht im Reiter „Wirkung" gesondert.',
    ],
    caveat:
      'Kein Verkehrsmodell mit Quelle-Ziel-Matrix. Nicht enthalten sind Wirkungen, die eine Standardisierte Bewertung kennt: eingesparte Busleistung, Fahrzeugbetriebskosten der Nutzer. Ausgewiesene Unsicherheit: ±35 %.',
    source: 'Wertansätze in der Logik der Standardisierten Bewertung, aber keine solche.',
  },
  fiscal: {
    title: 'Fiskaleffekt für {Stadt}',
    what: 'Was davon tatsächlich im {stadtAdj} Haushalt ankommt, deutlich weniger als der Nutzen.',
    how: [
      'Besteuert wird nur der <b>produktive</b> Teil: die Produktivitätswirkung plus 35 % der Reisezeitgewinne (Geschäfts- und Pendleranteil).',
      'Lohn- und Einkommensteuer 18,5 %; als Stadtstaat bekommt {Stadt} Landes- <b>und</b> Gemeindeanteil, zusammen 57,5 %.',
      'Gewerbesteuer 4,8 %, ohne Umlage vollständig bei {Stadt}.',
      'Umsatzsteuer über den Länderanteil (45,9 %) und den Einwohnerschlüssel des Landes ({ustSchluessel}).',
      'Grundsteuer auf den Bodenwertzuwachs und Grunderwerbsteuer auf den jährlich umgeschlagenen Anteil.',
    ],
    caveat:
      'Der Fiskaleffekt ist <b>nicht</b> zum Nutzen addierbar, es sind zwei Sichten auf dieselbe Wirkung.',
  },
  operating: {
    title: 'Betriebsergebnis',
    what: 'Fahrgeldeinnahmen minus laufende Kosten des gesamten Szenarionetzes, pro Jahr.',
    how: [
      'Zug-Kilometer aus Takt, Betriebszeit und Linienlänge.',
      'Kosten je Zug-km: 7,20 € Straßenbahn, 9,60 € U-Bahn, 12,40 € S-Bahn.',
      'Dazu Instandhaltung je km nach Bauweise und Stationsbetrieb nach Lage.',
      'Erlöse: Fahrten × 1,05 € Durchschnittserlös je Einsteiger.',
    ],
    caveat:
      'Ein negatives Ergebnis ist im deutschen ÖPNV der Normalfall und wird über Ausgleichszahlungen finanziert.',
  },
  bcr: {
    title: 'Nutzen-Kosten-Verhältnis',
    what: 'Barwert des Nutzens geteilt durch den Barwert der Kosten. In der amtlichen Bewertung gilt über 1,0 als förderwürdig. Dieses Modell rechnet strenger, siehe unten.',
    how: [
      'Alle Zahlungen werden mit <b>1,7 % real</b> abgezinst, über 30 Jahre ab Eröffnung.',
      'Die Nachfrage läuft über vier Jahre hoch.',
      'Am Ende wird ein Restwert von 25 % der Investition angesetzt.',
      'Im Nutzen stecken auch <b>weitere volkswirtschaftliche Wirkungen</b> (Produktivität, Bodenwerte), die eine amtliche Bewertung nicht mitzählt. Im Reiter „Wirkung" steht der Nutzen ohne sie.',
    ],
    caveat:
      'Kein Ersatz für eine Standardisierte Bewertung, und nicht direkt mit veröffentlichten NKV vergleichbar: die amtliche Methode zählt Wirkungen mit, die dieses Modell nicht kennt. Als Maßstab hilft der eigene Bestand: die bereits beschlossenen Vorhaben, S4, U4 und U5 zusammen, kommen in diesem Modell auf rund 0,42. Sie sind beschlossen und gefördert, also ist 0,42 hier keine Absage, sondern der Bezugspunkt. Sinnvoll ist die Zahl vor allem zum Vergleich von Entwürfen untereinander.',
  },
  feasibility: {
    title: 'Baubarkeit',
    what: 'Ob sich die gezeichnete Trasse so überhaupt bauen ließe.',
    how: [
      'Geprüft werden Bogenradien, Gewässerquerungen, die Eignung der Bauweise, Straßenbahnen ohne Straßenraum, zu enge Stationsabstände und unvereinbare Verkehrsmittel auf gemeinsamem Gleis.',
      'Der Schweregrad wird auf die Projektgröße normiert: zwei Hinweise auf 40 km wiegen weniger als zwei auf 2 km.',
    ],
    caveat: 'Baugrund und Leitungslage, also genau das, woran Tunnelprojekte in der Praxis teuer werden.',
  },
  boardings: {
    title: 'Einsteiger je Werktag',
    what: 'Wie viele Menschen an einem normalen Werktag im gesamten Szenarionetz einsteigen würden.',
    how: [
      'Je Station: Einwohner und Arbeitsplätze im Umkreis, mit der Entfernung abnehmend gewichtet (U-Bahn 800 m, S-Bahn 1 000 m, Straßenbahn 500 m).',
      'Arbeitsplätze zählen 1,35-fach, Umsteigepunkte 1,55-fach, Innenstadtlagen 1,35-fach.',
      'Der Faktor ist so <b>kalibriert</b>, dass das heutige Netz rund 1,39 Mio. Einsteiger ergibt. Beobachtet werden 1,3 bis 1,5 Mio.',
    ],
    caveat: 'Kapazitätsgrenzen, Umsteigezwänge im Detail und tageszeitliche Verteilung.',
  },
  population: {
    title: 'Erschlossene Einwohner',
    what: 'Wie viele Menschen eine Station zu Fuß erreichen könnten.',
    how: [
      '{einwohnerzahlen} der {stadtteilzahl} {stadtteile} werden auf ein 200-Meter-Raster verteilt, gewichtet nach modellierter Wohn-Geschossfläche aus {gebaeude} Gebäuden.',
      'Gezählt wird jede Rasterzelle mit einer Station innerhalb von 1 200 m Fußweg.',
      'Die große Zahl gilt für das <b>fertige Netz</b>, Bestandsstrecken eingeschlossen. Sie ändert sich durch einen Entwurf nur wenig. Verglichen werden Entwürfe deshalb über die <b>neu erschlossenen</b> Einwohner.',
    ],
    source: '{quelle}',
  },
  co2: {
    title: 'CO₂-Einsparung',
    what: 'Netto vermiedene Treibhausgase pro Jahr.',
    how: [
      'Ein Teil der neuen Fahrten ersetzt Autofahrten (28 %, im Mittel 8,4 km).',
      'Vermieden: 0,145 kg CO₂ je Pkw-Kilometer.',
      'Davon abgezogen wird der Bahnstrom der zusätzlichen Fahrleistung.',
    ],
    caveat: 'Der Bau selbst: Beton und Stahl eines Tunnels sind erheblich und hier nicht bilanziert.',
  },
  stations: {
    title: 'Stationen',
    what: 'Alle Halte im Szenario, und wie viele davon neu gebaut würden.',
    how: [
      'Beim Zeichnen wird an jedem gesetzten Punkt eine Station angelegt.',
      'Dazwischen ergänzt die App weitere, wo sich das lohnt: nach Einzugsbereich, Umsteigemöglichkeit und Landmarken.',
      'Zielabstände: U-Bahn 1 000 m, S-Bahn 1 900 m, Straßenbahn 450 m.',
      'Eine Station entsteht nicht allein, weil eine Distanz erreicht ist, und ein wichtiges Ziel darf den Abstand überstimmen.',
    ],
  },
};


// ------------------------------------------------------- filling in the city --

/** The parameter set the loaded engine is working with, if it has been read. */
export interface CityFigures {
  name: string;
  adjective: string;
  vatCityShare: number;
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
    '{baugrund}': `+${pct(city.groundConditionsFactor - 1, 0)}`,
    // "Amtlich" is a claim about the source, not a decoration: Berlin's figures
    // are the population tags of OSM boundary relations, and calling those
    // official would be a small lie in the one place that explains the number.
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
