'use client';

// Map labels as HTML rather than as a MapLibre symbol layer.
//
// The map ships without glyph tiles, so text has to be drawn above the canvas.
// That turns out to be the better option anyway: real web typography, a
// collision rule we control, and no network request for fonts (plan §79).

import { useEffect, useRef } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import type { BaseMap, RenderState } from '@/lib/types';

/** A label that has been placed, and the element drawing it. */
interface Anchored {
  text: string;
  className: string;
  lon: number;
  lat: number;
  el: HTMLSpanElement | null;
}

interface Label {
  text: string;
  lon: number;
  lat: number;
  priority: number;
  className: string;
  minZoom: number;
}

/**
 * Map labels as HTML above the canvas.
 *
 * Only the places that orient you are labelled by default — districts, water,
 * and the interchanges that anchor the network. Naming all 270 stations at once
 * buries the network under its own text; the rest appear on hover, and whatever
 * is selected always keeps its name.
 */
export function LabelOverlay({
  map,
  render,
  basemap,
  dark,
  hovered,
  selected,
}: {
  map: MlMap;
  render: RenderState;
  basemap: BaseMap;
  dark: boolean;
  hovered: number | null;
  selected: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Label[]>([]);
  // What is on screen right now, with the element that shows it.
  const shownRef = useRef<Anchored[]>([]);

  useEffect(() => {
    // Every station, in the order it earns its space.
    //
    // Only interchanges used to be named, at any zoom — which left 590 of
    // Berlin's 666 stations nameless however far you zoomed in, and made the
    // map useless for the thing people actually do with it: find out what is
    // where. Interchanges still come first and appear first; ordinary stops
    // follow once there is room for them.
    const stationLabels: Label[] = render.stations.map((s) => ({
      text: s.name,
      lon: s.lon,
      lat: s.lat,
      priority:
        (s.interchange ? 200 : 120) +
        (s.status === 'in_service' ? 0 : 30) +
        s.lines.length,
      className: s.interchange ? 'lbl-station lbl-station-major' : 'lbl-station',
      minZoom: s.interchange ? 12.2 : 13.6,
    }));
    // Street names, close up only.
    //
    // Seeing a line is not the same as finding a street: "where is the
    // Rentzelstraße" is answered by the name, not by the geometry. Placed at the
    // middle of the way and ranked below everything else, so they fill the space
    // the stations and districts leave rather than competing for it.
    const streetLabels: Label[] = (basemap.roads ?? [])
      .filter((r) => r.name && r.geo.length > 1)
      .map((r) => {
        const mid = r.geo[Math.floor(r.geo.length / 2)];
        return {
          text: r.name,
          lon: mid[0],
          lat: mid[1],
          priority: 10 + (2 - Math.min(2, r.class)) * 5,
          className: 'lbl-street',
          minZoom: r.class <= 1 ? 14.2 : 15.0,
        };
      });

    const placeLabels: Label[] = basemap.places.map((p) => ({
      text: p.name,
      lon: p.geo[0],
      lat: p.geo[1],
      priority: p.weight * 40,
      className: 'lbl-place',
      minZoom: p.weight >= 0.7 ? 10.2 : 11.6,
    }));
    // The towns a regional line could reach. Bigger places appear first as you
    // zoom out, so the region reads as a network of destinations.
    const regionLabels: Label[] = (basemap.regionPlaces ?? []).map((p) => ({
      text: p.name,
      lon: p.geo[0],
      lat: p.geo[1],
      priority: 60 + Math.min(60, p.population / 4000),
      className: 'lbl-region',
      // Kiel, Lübeck, Rostock and Schwerin have to be readable at the widest
      // view — that is the whole point of zooming out that far.
      minZoom: p.population > 150_000 ? 0 : p.population > 60_000 ? 8.0 : p.population > 20_000 ? 9.0 : 9.8,
    }));
    const waterLabels: Label[] = basemap.water
      .filter((w) => w.major && w.name)
      .slice(0, 24)
      .map((w) => {
        const ring = w.rings[0];
        const mid = ring[Math.floor(ring.length / 2)];
        return { text: w.name, lon: mid[0], lat: mid[1], priority: 30, className: 'lbl-water', minZoom: 11.5 };
      });
    labelsRef.current = [...stationLabels, ...placeLabels, ...regionLabels, ...waterLabels, ...streetLabels].sort(
      (a, b) => b.priority - a.priority
    );
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, basemap]);

  // Hover and selection are drawn separately so they always win, whatever the
  // collision budget decided.
  useEffect(() => {
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, selected]);

  useEffect(() => {
    // Why this is not simply "redraw on move".
    //
    // It used to be, and the labels wobbled against the map while dragging.
    // Three separate reasons, all of them visible at once:
    //
    //  1. The redraw was deferred to the next animation frame, so the text was
    //     always one frame behind the canvas it belongs to. Panning made the
    //     whole label layer swim.
    //  2. Every position was rounded to a whole pixel. Neighbouring labels
    //     cross their rounding threshold at different moments, so they twitched
    //     against each other by a pixel — the wiggle proper.
    //  3. The collision layout was recomputed from scratch on every frame, so
    //     labels re-flowed continuously: one drops out, its neighbour moves
    //     into the gap, and the eye reads all of it as movement.
    //
    // Now the layout is decided occasionally and the positions are updated in
    // the map's own render frame. Between layouts the text moves rigidly with
    // the map, which is what makes it look attached to it.
    let lastPlaced = 0;
    const onRender = () => {
      const moving = map.isMoving() || map.isZooming() || map.isRotating();
      // While moving, refresh the layout a few times a second so that panning
      // into new territory still brings its names along — but not every frame.
      if (moving && performance.now() - lastPlaced > 400) {
        lastPlaced = performance.now();
        place();
      } else {
        position(!moving);
      }
    };
    const onSettled = () => {
      lastPlaced = performance.now();
      place();
    };
    map.on('render', onRender);
    map.on('moveend', onSettled);
    map.on('zoomend', onSettled);
    map.on('resize', onSettled);
    place();
    return () => {
      map.off('render', onRender);
      map.off('moveend', onSettled);
      map.off('zoomend', onSettled);
      map.off('resize', onSettled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, dark]);

  /**
   * Decide which labels are shown and where, and build the elements.
   *
   * Greedy: highest priority first, anything that collides is dropped. This is
   * the expensive half, so it runs on settle and a few times a second while the
   * map is moving — not once per frame.
   */
  function place() {
    const el = host.current;
    if (!el) return;
    const zoom = map.getZoom();
    const { width, height } = map.getCanvas().getBoundingClientRect();
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const chosen: Anchored[] = [];
    // One label per street name on screen.
    //
    // A street is many OSM ways, and labelling each of them put "Rentzelstraße"
    // on the map eight times over. Suppressing repeats here rather than picking
    // one way per name at build time means the name follows you as you pan: the
    // copy that gets labelled is whichever one is in view.
    const namedOnce = new Set<string>();
    // Room for more names the closer you are: at street level the map has the
    // space, and withholding names there is what made it feel empty.
    let budget = zoom > 14.5 ? 220 : zoom > 13 ? 130 : 55;

    // Whatever the pointer is on, and whatever is selected, is named first.
    const focus = [hovered, selected].filter((v): v is number => v != null);
    for (const id of focus) {
      const s = render.stations.find((x) => x.id === id);
      if (!s) continue;
      const p = map.project([s.lon, s.lat]);
      const w = s.name.length * 6.6 + 14;
      placed.push({ x: p.x - w / 2, y: p.y - 24 - 9, w, h: 24 });
      chosen.push({ text: s.name, className: 'lbl-focus', lon: s.lon, lat: s.lat, el: null });
    }

    for (const l of labelsRef.current) {
      if (budget <= 0) break;
      if (zoom < l.minZoom) continue;
      if (l.className === 'lbl-street') {
        if (namedOnce.has(l.text)) continue;
      }
      const p = map.project([l.lon, l.lat]);
      if (p.x < -60 || p.y < -30 || p.x > width + 60 || p.y > height + 30) continue;
      const w = l.text.length * 6.2 + 8;
      const h = 15;
      const box = { x: p.x - w / 2, y: p.y - h - 9, w, h };
      if (placed.some((q) => !(box.x + box.w < q.x || q.x + q.w < box.x || box.y + box.h < q.y || q.y + q.h < box.y))) {
        continue;
      }
      placed.push(box);
      if (l.className === 'lbl-street') namedOnce.add(l.text);
      budget--;
      chosen.push({ text: l.text, className: l.className, lon: l.lon, lat: l.lat, el: null });
    }

    // Reuse the nodes rather than rebuilding the markup: `innerHTML` on ninety
    // labels several times a second is both slow and enough to make the text
    // flicker as it is parsed and re-laid-out.
    const host_ = el;
    const existing = shownRef.current;
    for (let i = 0; i < chosen.length; i++) {
      let node = existing[i]?.el;
      if (!node) {
        node = document.createElement('span');
        host_.appendChild(node);
      }
      if (node.className !== chosen[i].className) node.className = chosen[i].className;
      if (node.textContent !== chosen[i].text) node.textContent = chosen[i].text;
      chosen[i].el = node;
    }
    for (let i = chosen.length; i < existing.length; i++) existing[i].el?.remove();
    shownRef.current = chosen;
    position(!map.isMoving());
  }

  /**
   * Move the existing labels to where their anchors are now.
   *
   * `snap` rounds to whole pixels, which keeps static text crisp. It is off
   * while the map moves: rounding mid-drag is what made neighbouring labels
   * twitch against each other by a pixel.
   */
  function position(snap: boolean) {
    for (const l of shownRef.current) {
      if (!l.el) continue;
      const p = map.project([l.lon, l.lat]);
      const x = snap ? Math.round(p.x) : p.x;
      const y = snap ? Math.round(p.y) : p.y;
      l.el.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
  }

  return <div ref={host} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden />;
}
