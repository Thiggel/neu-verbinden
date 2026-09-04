// The rule behind an eased figure, kept apart from the component so it can be
// tested without a browser.

/**
 * What a figure should read at a given moment, given where it was painted.
 *
 * Pulled out of the component so the rule can be tested without a browser: the
 * number is the point, the easing is decoration, and no sequence of changes may
 * leave the wrong number on screen. Two ways that used to happen:
 *
 *  * the origin was "where the last animation was meant to end" rather than
 *    what is actually painted. Figures change faster than one ease while
 *    editing, so animations interrupt each other and that origin goes stale;
 *  * with a stale origin, undoing a change mid-ease made target and origin
 *    equal again, the update was skipped as a no-op, and the display kept
 *    whatever partial value it had reached.
 */
export function tween(painted: number, value: number, progress: number, reduce = false): number {
  if (reduce || !Number.isFinite(value) || !Number.isFinite(painted)) return value;
  if (painted === value || progress >= 1) return value;
  if (progress <= 0) return painted;
  // easeOutCubic
  return painted + (value - painted) * (1 - Math.pow(1 - progress, 3));
}
