// The stylised Hamburg base map (plan §4).
//
// Built entirely from our own versioned dataset — no tile server, no external
// glyphs. That keeps the map deliberately sparse (water, green, a handful of
// roads, district outlines) so the transit network is the only thing with
// visual weight, and it means the whole app can run offline.

import type * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import type { BaseMap, RenderState } from './types';

export interface Palette {
  land: string;
  water: string;
  waterLine: string;
  green: string;
  road: string;
  roadMinor: string;
  rail: string;
  boundary: string;
  text: string;
  textMuted: string;
  halo: string;
}

export const LIGHT: Palette = {
  land: '#F5F3EF',
  water: '#CFE3EE',
  waterLine: '#B7D5E5',
  green: '#E3EBDC',
  road: '#E7E2D9',
  roadMinor: '#EDE9E1',
  rail: '#DFDAD1',
  boundary: '#E2DCD1',
  text: '#1D2530',
  textMuted: '#6B7688',
  halo: '#FFFFFF',
};

export const DARK: Palette = {
  land: '#12161C',
  water: '#16232E',
  waterLine: '#1E3140',
  green: '#161D18',
  road: '#1B2027',
  roadMinor: '#171C22',
  rail: '#20262E',
  boundary: '#232A33',
  text: '#EAEEF4',
  textMuted: '#8A94A4',
  halo: '#0B0E12',
};

/**
 * Line width for the transit layers. A function rather than a shared constant:
 * MapLibre takes ownership of the expression array it is handed, so two layers
 * must not be given the same one.
 */
const transitWidth = () =>
  [
    'interpolate',
    ['linear'],
    ['zoom'],
    9,
    ['*', ['get', 'weight'], 2.4],
    16,
    ['*', ['get', 'weight'], 9],
  ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>;

/** A source that is never empty, so MapLibre can report the style loaded. */
const placeholder = (): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { placeholder: 1 },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
  ],
});

/** Rendering geometry for the network, as MapLibre sources. */
export function transitSources(render?: RenderState | null, focusNew = false) {
  const lines: GeoJSON.Feature[] = [];
  const stations: GeoJSON.Feature[] = [];
  /** Stations on a line that survived the filter. */
  const shown = new Set<number>();
  // A line somebody extended is drawn whole, even in the focused view.
  //
  // An extension on its own is a piece of track starting nowhere: the U4 goes
  // to Horner Geest and the plan carries it onward, and without the U4 the
  // reader sees a fragment in the suburbs with no idea what it continues.
  const extended = new Set<number>();
  for (const l of render?.lines ?? []) {
    if (l.included && l.extends != null) extended.add(l.extends);
  }
  for (const l of render?.lines ?? []) {
    if (!l.included) continue;
    // Same rule the controller applies. The style seeds these sources on
    // creation and again on every theme change, so without it the full network
    // reappeared behind the reader's back the moment they switched to dark.
    const ownLine = l.source !== 'existing' || extended.has(l.id);
    const weight = lineWeight(l.mode);
    let drew = false;
    for (const seg of l.segments) {
      if (focusNew && !ownLine && seg.status !== 'to_build') continue;
      if (seg.geo.length < 2) continue;
      drew = true;
      lines.push({
        type: 'Feature',
        properties: {
          id: seg.id,
          line: l.id,
          label: l.label,
          color: l.color,
          weight,
          planned: seg.status === 'to_build' ? 1 : 0,
          opacity: seg.status === 'in_service' ? 1 : 0.92,
        },
        geometry: { type: 'LineString', coordinates: seg.geo },
      });
    }
    if (drew) for (const id of l.stations) shown.add(id);
  }
  // Hiding the lines but keeping every station left several hundred coloured
  // dots on the map with nothing under them, which is worse than either showing
  // the network or not. A station belongs to the focused view when a line that
  // was actually drawn stops there.
  //
  // Segments carry no station ids, so this is per line rather than per segment:
  // an existing line kept only for a new extension brings its other stops with
  // it. In the data as it stands that case does not arise — projects are their
  // own lines — and the alternative, matching stations to track geometry, is a
  // spatial index for a case nobody has.
  for (const st of render?.stations ?? []) {
    if (focusNew && !shown.has(st.id)) continue;
    stations.push({
      type: 'Feature',
      properties: {
        id: st.id,
        name: st.name,
        color: st.colors[0] ?? '#334155',
        interchange: st.interchange ? 1 : 0,
        opacity: st.status === 'in_service' ? 1 : 0.9,
      },
      geometry: { type: 'Point', coordinates: [st.lon, st.lat] },
    });
  }
  return { lines: fc(lines), stations: fc(stations) };
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

export function baseMapSources(basemap: BaseMap) {
  const water = fc(
    basemap.water.map((w) => ({
      type: 'Feature',
      properties: { name: w.name, major: w.major ? 1 : 0 },
      geometry: { type: 'Polygon', coordinates: w.rings },
    }))
  );
  const waterways = fc(
    basemap.waterways.map((w) => ({
      type: 'Feature',
      properties: { name: w.name, major: w.major ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: w.geo },
    }))
  );
  const green = fc(
    basemap.green.map((g) => ({
      type: 'Feature',
      properties: { name: g.name, kind: g.kind },
      geometry: { type: 'Polygon', coordinates: g.rings },
    }))
  );
  const roads = fc(
    basemap.roads.map((r) => ({
      type: 'Feature',
      properties: { name: r.name, cls: r.class },
      geometry: { type: 'LineString', coordinates: r.geo },
    }))
  );
  const rail = fc(
    basemap.rail.map((r) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: r },
    }))
  );
  // The wider region, drawn thinner and only when you zoom out to it.
  const regionWater = fc(
    (basemap.regionWater ?? []).map((w) => ({
      type: 'Feature',
      properties: { name: w.name },
      geometry: { type: 'Polygon', coordinates: w.rings },
    }))
  );
  const regionLines = fc([
    ...(basemap.coastline ?? []).map((l) => ({
      type: 'Feature' as const,
      properties: { kind: 'coast' },
      geometry: { type: 'LineString' as const, coordinates: l },
    })),
    ...(basemap.regionRoads ?? []).map((l) => ({
      type: 'Feature' as const,
      properties: { kind: 'road' },
      geometry: { type: 'LineString' as const, coordinates: l },
    })),
    ...(basemap.regionRail ?? []).map((l) => ({
      type: 'Feature' as const,
      properties: { kind: 'rail' },
      geometry: { type: 'LineString' as const, coordinates: l },
    })),
    // Rivers out here read as terrain, the same way the Elbe does in the city.
    ...(basemap.regionWaterways ?? []).map((l) => ({
      type: 'Feature' as const,
      properties: { kind: 'river' },
      geometry: { type: 'LineString' as const, coordinates: l },
    })),
  ]);
  // Town detail. Same shapes as the city layers, drawn only where the region
  // has them — the fourteen towns a regional line could reach.
  const townWater = fc(
    (basemap.townWater ?? []).map((w) => ({
      type: 'Feature',
      properties: { name: w.name },
      geometry: { type: 'Polygon', coordinates: w.rings },
    }))
  );
  const townGreen = fc(
    (basemap.townGreen ?? []).map((g) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: g.rings },
    }))
  );
  const townLines = fc([
    ...(basemap.townWaterways ?? []).map((l) => ({
      type: 'Feature' as const,
      properties: { kind: 'river' },
      geometry: { type: 'LineString' as const, coordinates: l },
    })),
    ...(basemap.townRoads ?? []).map((r) => ({
      type: 'Feature' as const,
      properties: { kind: r.major ? 'major' : 'minor' },
      geometry: { type: 'LineString' as const, coordinates: r.geo },
    })),
  ]);
  const regionGreen = fc(
    (basemap.regionGreen ?? []).map((g) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: g.rings },
    }))
  );
  const districts = fc(
    basemap.districts.map((d) => ({
      type: 'Feature',
      properties: { name: d.name, borough: d.borough, population: d.population, areaKm2: d.areaKm2 },
      geometry: { type: 'Polygon', coordinates: d.rings },
    }))
  );
  return {
    water,
    waterways,
    green,
    roads,
    rail,
    districts,
    regionWater,
    regionGreen,
    regionLines,
    townWater,
    townGreen,
    townLines,
  };
}

/**
 * A complete MapLibre style, transit layers included.
 *
 * The network is seeded straight into the style rather than added afterwards.
 * Adding layers later means waiting for the style to finish loading, and a
 * GeoJSON source with no features never reports itself loaded — so the network
 * would stay invisible for as long as the base map takes to tile, and forever
 * in a tab the browser has throttled.
 */
export function buildStyle(
  basemap: BaseMap,
  palette: Palette,
  render?: RenderState | null,
  focusNew = false
): StyleSpecification {
  const s = baseMapSources(basemap);
  const transit = transitSources(render, focusNew);
  return {
    version: 8,
    // No glyphs and no sprite: all labels are rendered as HTML above the canvas,
    // which gives us real typography and keeps the map free of network calls.
    sources: {
      water: { type: 'geojson', data: s.water },
      waterways: { type: 'geojson', data: s.waterways },
      green: { type: 'geojson', data: s.green },
      roads: { type: 'geojson', data: s.roads },
      rail: { type: 'geojson', data: s.rail },
      districts: { type: 'geojson', data: s.districts },
      'region-water': { type: 'geojson', data: s.regionWater },
      'region-green': { type: 'geojson', data: s.regionGreen },
      'town-green': { type: 'geojson', data: s.townGreen },
      'town-water': { type: 'geojson', data: s.townWater },
      'town-lines': { type: 'geojson', data: s.townLines },
      // Filled in on demand — see `useCloseUpStreets`.
      'streets': { type: 'geojson', data: placeholder() },
      'region-lines': { type: 'geojson', data: s.regionLines },
      'transit-lines': { type: 'geojson', data: transit.lines },
      'transit-stations': { type: 'geojson', data: transit.stations },
      // Interaction overlays. Seeded with one hidden placeholder so the source
      // is never empty; the layers filter it out.
      preview: { type: 'geojson', data: placeholder() },
      'preview-stations': { type: 'geojson', data: placeholder() },
      highlight: { type: 'geojson', data: placeholder() },
      reveal: { type: 'geojson', data: placeholder() },
      'reveal-pulse': { type: 'geojson', data: placeholder() },
      sparks: { type: 'geojson', data: placeholder() },
      'hover-station': { type: 'geojson', data: placeholder() },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': palette.land } },
      {
        id: 'region-green',
        type: 'fill',
        source: 'region-green',
        paint: { 'fill-color': palette.green, 'fill-opacity': 0.75 },
      },
      {
        id: 'region-water',
        type: 'fill',
        source: 'region-water',
        paint: { 'fill-color': palette.water },
      },
      // Only worth drawing once close enough to tell a park from a field.
      {
        id: 'town-green',
        type: 'fill',
        source: 'town-green',
        minzoom: 10.5,
        paint: { 'fill-color': palette.green, 'fill-opacity': 0.85 },
      },
      {
        id: 'town-water',
        type: 'fill',
        source: 'town-water',
        minzoom: 10.5,
        paint: { 'fill-color': palette.water },
      },
      // The small streets, only close up. Below this the city is read as
      // districts and main roads; above it people are placing a stop and need
      // to see which street they are on.
      {
        id: 'streets',
        type: 'line',
        source: 'streets',
        minzoom: 13.5,
        paint: {
          'line-color': palette.road,
          'line-width': ['interpolate', ['linear'], ['zoom'], 13.5, 0.4, 17, 2.4],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.2, 0.75],
        },
      },
      {
        id: 'town-lines',
        type: 'line',
        source: 'town-lines',
        minzoom: 11,
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'river',
            palette.waterLine,
            palette.road,
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            ['match', ['get', 'kind'], 'major', 0.9, 0.4],
            15,
            ['match', ['get', 'kind'], 'major', 2.6, 1.2],
          ],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 12, 1],
        },
      },
      {
        id: 'region-lines',
        type: 'line',
        source: 'region-lines',
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'coast',
            palette.waterLine,
            'rail',
            palette.rail,
            'river',
            palette.waterLine,
            palette.road,
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            7,
            ['match', ['get', 'kind'], 'coast', 0.9, 0.5],
            12,
            ['match', ['get', 'kind'], 'coast', 1.6, 1.4],
          ],
          // These used to fade to nothing by zoom 13, on the assumption that
          // the detailed city layers take over. They only take over inside
          // Hamburg's own box: past Bad Oldesloe there is nothing behind them,
          // so zooming in on Lübeck or Lüneburg emptied the map instead of
          // sharpening it. Faded back, not away.
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 1, 13, 0.55],
        },
      },
      {
        id: 'green',
        type: 'fill',
        source: 'green',
        paint: { 'fill-color': palette.green, 'fill-opacity': 0.9 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'water',
        paint: { 'fill-color': palette.water },
      },
      {
        id: 'waterways',
        type: 'line',
        source: 'waterways',
        paint: {
          'line-color': palette.waterLine,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['==', ['get', 'major'], 1], 1.2, 0.4], 15, ['case', ['==', ['get', 'major'], 1], 6, 2]],
        },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'rail',
        minzoom: 11,
        paint: {
          'line-color': palette.rail,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 1.6],
        },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'roads',
        paint: {
          'line-color': ['case', ['<=', ['get', 'cls'], 1], palette.road, palette.roadMinor],
          // Class 2 is only worth drawing close up: at city scale it is noise,
          // and at street level it is half the streets people name.
          //
          // The zoom interpolation has to be the outermost expression — MapLibre
          // refuses `["case", …, ["interpolate", ["zoom"], …]]` outright, and
          // then ignores the whole property. So the class test moves inside the
          // stops instead.
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12.5,
            ['case', ['<=', ['get', 'cls'], 1], 1, 0],
            13.5,
            ['case', ['<=', ['get', 'cls'], 1], 1, 0.9],
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9,
            ['case', ['<=', ['get', 'cls'], 0], 1.2, 0.3],
            13,
            ['case', ['<=', ['get', 'cls'], 0], 4, ['<=', ['get', 'cls'], 1], 2.4, 1.2],
            17,
            ['case', ['<=', ['get', 'cls'], 0], 12, ['<=', ['get', 'cls'], 1], 8, 5],
          ],
        },
      },
      {
        id: 'district-outline',
        type: 'line',
        source: 'districts',
        minzoom: 10.5,
        paint: { 'line-color': palette.boundary, 'line-width': 1, 'line-dasharray': [3, 3] },
      },


    // Deliberately few layers so mobile GPUs stay happy (plan §54).
      {
        id: 'transit-casing',
        type: 'line',
        source: 'transit-lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': palette.halo,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9,
            ['+', ['*', ['get', 'weight'], 2.4], 2],
            16,
            ['+', ['*', ['get', 'weight'], 9], 4],
          ],
          'line-opacity': 0.85,
        },
      },
      // Two layers rather than one: `line-dasharray` takes no data expression,
      // so "already built" and "still to build" have to be drawn separately.
      {
        id: 'transit-line',
        type: 'line',
        source: 'transit-lines',
        filter: ['!=', ['get', 'planned'], 1],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': transitWidth(),
          'line-opacity': ['get', 'opacity'],
        },
      },
      {
        id: 'transit-line-planned',
        type: 'line',
        source: 'transit-lines',
        filter: ['==', ['get', 'planned'], 1],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': transitWidth(),
          'line-opacity': 0.95,
          'line-dasharray': [1.9, 1.1],
        },
      },
      {
        id: 'highlight',
        filter: ['!=', ['get', 'placeholder'], 1],
        type: 'line',
        source: 'highlight',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#111827',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 6, 16, 20],
          'line-opacity': 0.18,
        },
      },
      // The line being drawn has to be the loudest thing on screen: it is the
      // only part of the map the user is currently responsible for.
      {
        id: 'preview-glow',
        filter: ['!=', ['get', 'placeholder'], 1],
        type: 'line',
        source: 'preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 9, 16, 26],
          'line-opacity': 0.16,
          'line-blur': 3,
        },
      },
      {
        id: 'preview-line',
        filter: ['!=', ['get', 'placeholder'], 1],
        type: 'line',
        source: 'preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 16, 11],
          'line-opacity': 0.95,
          'line-dasharray': [2.2, 1.2],
        },
      },
      {
        id: 'station-outer',
        type: 'circle',
        source: 'transit-stations',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            ['case', ['==', ['get', 'interchange'], 1], 3.4, 2],
            16,
            ['case', ['==', ['get', 'interchange'], 1], 11, 6.5],
          ],
          'circle-color': palette.halo,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 2.6],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-opacity': ['get', 'opacity'],
        },
      },
      {
        id: 'station-core',
        type: 'circle',
        source: 'transit-stations',
        minzoom: 12,
        filter: ['==', ['get', 'interchange'], 1],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 16, 3.6],
          'circle-color': palette.text,
          'circle-opacity': 0.75,
        },
      },
      // Purely decorative: the freshly committed line drawing itself in, and a
      // ring expanding out of each new station. Both are overlays, so if the
      // browser never runs an animation frame the map is still correct.
      {
        id: 'reveal-line',
        filter: ['!=', ['get', 'placeholder'], 1],
        type: 'line',
        source: 'reveal',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 16, 15],
          'line-opacity': ['get', 'opacity'],
          'line-blur': 1.5,
        },
      },
      {
        id: 'reveal-pulse',
        filter: ['!=', ['get', 'placeholder'], 1],
        type: 'circle',
        source: 'reveal-pulse',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': 'transparent',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-opacity': ['get', 'opacity'],
        },
      },
      {
        // The station under the pointer, drawn on top and a little larger.
        // Without it the only feedback is the label, which appears somewhere
        // else on the screen.
        id: 'hover-station',
        filter: ['!=', ['get', 'placeholder'], 1],
        type: 'circle',
        source: 'hover-station',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 13],
          'circle-color': palette.halo,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 16, 3.4],
          'circle-radius-transition': { duration: 120 },
          'circle-stroke-width-transition': { duration: 120 },
        },
      },
      {
        // The particles thrown off as the line lands. Radius, colour and
        // opacity all come from the feature, so one source drives the whole
        // burst without touching the style between frames.
        id: 'sparks',
        filter: ['!=', ['get', 'placeholder'], 1],
        type: 'circle',
        source: 'sparks',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-blur': 0.35,
        },
      },
      {
        id: 'preview-station',
        filter: ['!=', ['get', 'placeholder'], 1],
        type: 'circle',
        source: 'preview-stations',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            ['case', ['==', ['get', 'interchange'], 1], 4.5, 3.2],
            16,
            ['case', ['==', ['get', 'interchange'], 1], 10, 7.5],
          ],
          'circle-color': palette.halo,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 16, 3],
          'circle-opacity': 1,
        },
      },
    ],
  } as StyleSpecification;
}

/** Line weight by mode: U-Bahn reads heaviest, tram lightest. */
export function lineWeight(mode: string): number {
  switch (mode) {
    case 'ubahn':
      return 1.0;
    case 'sbahn':
      return 0.95;
    case 'tram':
      return 0.7;
    default:
      return 0.55;
  }
}
