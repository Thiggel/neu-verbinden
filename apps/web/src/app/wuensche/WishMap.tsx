'use client';

// The heat map itself.
//
// Deliberately not the editor's map component: that one carries an engine, a
// controller and the whole editing apparatus, none of which this page uses. It
// renders a picture the server computed, so it needs the base map and nothing
// else.

import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import { buildStyle, DARK, LIGHT } from '@/lib/basemap';
import type { BaseMap } from '@/lib/types';
import type { CityEntry } from '@/lib/engine';

export function WishMap({
  basemap,
  city,
  cells,
  maxWeight,
  dark,
}: {
  basemap: BaseMap;
  city: CityEntry;
  cells: [number, number, number][];
  maxWeight: number;
  dark: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: buildStyle(basemap, dark ? DARK : LIGHT, null),
      center: [city.center.lon, city.center.lat],
      zoom: 10.2,
      minZoom: 8.5,
      maxZoom: 15,
      attributionControl: false,
      dragRotate: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '© OpenStreetMap-Mitwirkende (ODbL)',
      }),
      'bottom-right'
    );
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // Built once; the data is pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: cells.map(([lon, lat, w]) => ({
          type: 'Feature',
          // Normalised here rather than in the paint expression: the scale
          // depends on how many plans there are, and a fixed ramp made a city
          // with four plans look cold and one with four hundred look uniformly
          // hot.
          properties: { w: maxWeight > 0 ? w / maxWeight : 0 },
          geometry: { type: 'Point', coordinates: [lon, lat] },
        })),
      };
      const src = m.getSource('wishes') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
        return;
      }
      m.addSource('wishes', { type: 'geojson', data });
      // Open where the weight is, not on the whole extent.
      //
      // Fitting every cell put the map at the mercy of its longest outlier: one
      // plan carried a regional line out to Bad Oldesloe, the box stretched
      // eighty kilometres north-east, and all the heat in Hamburg shrank to a
      // thumbprint. So the frame is the smallest box holding most of the
      // weight — the tail stays on the map, it just stops deciding the view.
      if (cells.length) {
        const total = cells.reduce((sum, c) => sum + c[2], 0);
        const sorted = [...cells].sort((a, b) => b[2] - a[2]);
        let carried = 0;
        let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
        for (const [lon, lat, weight] of sorted) {
          w = Math.min(w, lon); e = Math.max(e, lon);
          s = Math.min(s, lat); n = Math.max(n, lat);
          carried += weight;
          if (carried >= total * 0.85) break;
        }
        requestAnimationFrame(() => {
          m.resize();
          m.fitBounds([[w, s], [e, n]], { padding: 56, duration: 0, maxZoom: 13 });
        });
      }
      m.addLayer({
        id: 'wishes-heat',
        type: 'heatmap',
        source: 'wishes',
        paint: {
          'heatmap-weight': ['get', 'w'],
          // Each cell is 300 m, so the radius grows with the zoom to keep one
          // cell about one cell wide on screen rather than a blob that means
          // nothing at one end of the range and nothing at the other.
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 12, 26, 15, 90],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 1, 15, 2.4],
          'heatmap-opacity': 0.75,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.15, 'rgba(59,130,246,0.45)',
            0.35, 'rgba(16,185,129,0.6)',
            0.55, 'rgba(250,204,21,0.75)',
            0.75, 'rgba(249,115,22,0.85)',
            1, 'rgba(220,38,38,0.95)',
          ],
        },
      });
    };
    if (m.isStyleLoaded()) apply();
    else m.once('styledata', apply);
  }, [cells, maxWeight]);

  return <div ref={container} className="h-full w-full" />;
}
