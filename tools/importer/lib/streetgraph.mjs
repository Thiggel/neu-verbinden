// A routable graph over the OSM street network.
//
// Proposal corridors are given as a list of anchor points; drawing straight
// lines between them puts trams across the Alster. Routing them along real
// streets instead produces corridors a tram could actually use — and the
// engine's water-crossing and feasibility checks then see the truth.
import { haversine } from './geo.mjs';

const KEY_PRECISION = 6;
const key = (lon, lat) => `${lon.toFixed(KEY_PRECISION)},${lat.toFixed(KEY_PRECISION)}`;

/** Build the graph from Overpass `out geom` way elements. */
export function buildStreetGraph(wayGroups) {
  /** @type {Map<string, {lon:number, lat:number, links:{to:string, cost:number, dist:number}[]}>} */
  const nodes = new Map();
  const node = (lon, lat) => {
    const k = key(lon, lat);
    let n = nodes.get(k);
    if (!n) {
      n = { lon, lat, links: [] };
      nodes.set(k, n);
    }
    return [k, n];
  };

  let ways = 0;
  for (const { elements, penalty } of wayGroups) {
    for (const w of elements) {
      const geom = w.geometry;
      if (!geom || geom.length < 2) continue;
      const hw = w.tags?.highway ?? '';
      // A tram cannot run on a motorway; make those effectively unusable but
      // not impossible, so a corridor is still found in the worst case.
      const p = /^(motorway|motorway_link|trunk|trunk_link)$/.test(hw) ? 25 : penalty;
      ways++;
      for (let i = 0; i < geom.length - 1; i++) {
        const a = geom[i];
        const b = geom[i + 1];
        const d = haversine([a.lon, a.lat], [b.lon, b.lat]);
        if (d < 0.5) continue;
        const [ka, na] = node(a.lon, a.lat);
        const [kb, nb] = node(b.lon, b.lat);
        na.links.push({ to: kb, cost: d * p, dist: d });
        nb.links.push({ to: ka, cost: d * p, dist: d });
      }
    }
  }

  // Coarse bucket index for nearest-node lookup.
  const CELL = 0.004; // ~300 m
  const buckets = new Map();
  for (const [k, n] of nodes) {
    const bk = `${Math.floor(n.lon / CELL)},${Math.floor(n.lat / CELL)}`;
    let b = buckets.get(bk);
    if (!b) buckets.set(bk, (b = []));
    b.push(k);
  }

  function nearest([lon, lat], maxM = 900) {
    let best = null;
    const r = Math.ceil(maxM / 300) + 1;
    const c0 = Math.floor(lon / CELL);
    const r0 = Math.floor(lat / CELL);
    for (let dc = -r; dc <= r; dc++) {
      for (let dr = -r; dr <= r; dr++) {
        const b = buckets.get(`${c0 + dc},${r0 + dr}`);
        if (!b) continue;
        for (const k of b) {
          const n = nodes.get(k);
          const d = haversine([lon, lat], [n.lon, n.lat]);
          if (d <= maxM && (!best || d < best.d)) best = { k, d };
        }
      }
    }
    return best;
  }

  /** Dijkstra with a binary heap. Returns the geographic path or null. */
  function route(from, to, { maxDetour = 3.2 } = {}) {
    const a = nearest(from);
    const b = nearest(to);
    if (!a || !b) return null;
    if (a.k === b.k) return null;
    const straight = haversine(from, to);
    const budget = Math.max(straight * maxDetour, 1500) * 30;

    const dist = new Map([[a.k, 0]]);
    const prev = new Map();
    const heap = [[0, a.k]];
    const done = new Set();
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };

    while (heap.length) {
      const [d, k] = pop();
      if (done.has(k)) continue;
      done.add(k);
      if (k === b.k) break;
      if (d > budget) break;
      for (const link of nodes.get(k).links) {
        if (done.has(link.to)) continue;
        const nd = d + link.cost;
        if (nd < (dist.get(link.to) ?? Infinity)) {
          dist.set(link.to, nd);
          prev.set(link.to, k);
          push([nd, link.to]);
        }
      }
    }
    if (!done.has(b.k)) return null;

    const path = [];
    let cur = b.k;
    while (cur) {
      const n = nodes.get(cur);
      path.push([n.lon, n.lat]);
      if (cur === a.k) break;
      cur = prev.get(cur);
    }
    path.reverse();
    if (path.length < 2) return null;
    // Reject absurd detours rather than returning a nonsense corridor.
    const len = path.slice(1).reduce((s, p, i) => s + haversine(path[i], p), 0);
    if (len > straight * maxDetour + 800) return null;
    return [from, ...path, to];
  }

  return { route, nearest, size: nodes.size, ways };
}
