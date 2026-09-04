// Where a published plan should open.
//
// A plan page used to open at the city centre at a fixed zoom. That was
// survivable while the map drew the entire existing network — something always
// filled the frame. Once the plan map showed only what would be built, the same
// opening put a handful of dashed lines somewhere in a mostly empty base map,
// and the page read as broken rather than as focused.
//
// Kept apart from the component so it can be tested without a browser: the
// arithmetic is the part that goes wrong, and the two times it did, the failure
// was a frame around the wrong thing rather than an exception.

import type { RenderState } from './types';

/** South-west and north-east corners of everything the plan would build. */
export function planBounds(render: RenderState): [[number, number], [number, number]] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const l of render.lines) {
    if (!l.included) continue;
    for (const seg of l.segments) {
      // Only what would be built frames the view: a line that is merely drawn
      // for context, such as the route an extension continues, must not pull
      // the frame across the region with it.
      // Only track that would actually be built.
      //
      // The map draws a proposed line whole, existing rails included, so the
      // route reads as a route. Framing on the same thing was wrong: a plan
      // about four Hamburg tram lines also switches on the decided S4, whose
      // corridor runs to Bad Oldesloe, and the page opened on eighty kilometres
      // of Schleswig-Holstein with the trams too small to see.
      if (seg.status !== 'to_build') continue;
      for (const [lon, lat] of seg.geo) {
        w = Math.min(w, lon);
        e = Math.max(e, lon);
        s = Math.min(s, lat);
        n = Math.max(n, lat);
      }
    }
  }
  // A plan that builds nothing has no frame of its own, and the caller should
  // leave the map where it opened rather than fit an empty box.
  return w <= e && s <= n ? [[w, s], [e, n]] : null;
}
