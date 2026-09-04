// The small streets, fetched the first time somebody zooms in far enough.
//
// They are about two megabytes per city — worth having when you are placing a
// stop and need to know whether that is the Rentzelstraße, and not worth loading
// for someone who opens the map and looks at the whole city. So they live in
// their own file, outside the base map, and are fetched once per city on the
// first view close enough to draw them.

import type { Map as MlMap } from 'maplibre-gl';

interface StreetFile {
  ways: { n: string; g: [number, number][] }[];
}

/** Cities whose streets are loaded or on their way, so this happens once. */
const started = new Map<string, Promise<GeoJSON.FeatureCollection | null>>();

function load(url: string, key: string): Promise<GeoJSON.FeatureCollection | null> {
  const existing = started.get(key);
  if (existing) return existing;
  const p = fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<StreetFile>) : null))
    .then((data) =>
      data
        ? ({
            type: 'FeatureCollection',
            features: data.ways.map((w) => ({
              type: 'Feature' as const,
              properties: { name: w.n },
              geometry: { type: 'LineString' as const, coordinates: w.g },
            })),
          } as GeoJSON.FeatureCollection)
        : null
    )
    .catch(() => null);
  started.set(key, p);
  return p;
}

/**
 * Put the streets on the map once the view is close enough to draw them.
 *
 * Applied on every `styledata` as well as on arrival, for two reasons that both
 * bit: the file can arrive before the style has created the source, in which
 * case setting it is silently dropped — and switching between light and dark
 * rebuilds the whole style, which would otherwise lose the streets until a
 * reload.
 *
 * Returns a function that detaches the listeners.
 */
export function closeUpStreets(map: MlMap, url: string | undefined, cityKey: string): () => void {
  if (!url) return () => {};
  let data: GeoJSON.FeatureCollection | null = null;

  const apply = () => {
    if (!data) return;
    const src = map.getSource('streets') as { setData?: (d: unknown) => void } | undefined;
    src?.setData?.(data);
  };

  let asked = false;
  const maybe = () => {
    if (asked || map.getZoom() < 13.2) return;
    asked = true; // The fetch is started once, not once per frame.
    void load(url, cityKey).then((d) => {
      data = d;
      apply();
    });
  };

  map.on('zoomend', maybe);
  map.on('moveend', maybe);
  map.on('styledata', apply);
  maybe();
  return () => {
    map.off('zoomend', maybe);
    map.off('moveend', maybe);
    map.off('styledata', apply);
  };
}
