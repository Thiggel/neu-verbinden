'use client';

// MapLibre, with its worker pointed somewhere that exists.
//
// Since version 6 the library finds its worker next to itself, by building a
// URL from import.meta.url at run time. Webpack cannot see through that, so it
// never emits the file and the map dies with "Worker failed to load". A literal
// new URL(…, import.meta.url) is something webpack does understand: it copies
// the worker into the build under a content hash and hands back its address.
// Everything that draws a map imports MapLibre from here, so the worker is set
// before the first map asks for it.

import * as maplibregl from 'maplibre-gl';

if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);
}

export { maplibregl };
