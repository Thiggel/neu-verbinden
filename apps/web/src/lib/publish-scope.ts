// What a published plan actually claims as its own.
//
// A plan is drawn on top of a scenario, and the scenario may already contain
// projects somebody else decided. "U6 quer durch Eimsbüttel" was published with
// one drawn line and eight of Hamburg's decided projects switched on, and came
// out at 65.6 km of new track for €23.1 bn — figures that describe the S4, the
// U4 and the U5, not the line its author drew. Every number on the plan's page,
// and its place on every leaderboard, was really about somebody else's work.
//
// So the default is now: your line, on the network that exists. The decided
// projects can be published with it, but that is a choice you make and see.
//
// The existing network always stays: it is the baseline the model measures
// against, and it is not counted as new track. Only what would be *built* is at
// issue here.

/** Line sources that represent somebody else's plan rather than the author's. */
const OTHERS = new Set(['planned', 'proposal']);

interface DocLine {
  source?: string;
  included?: boolean;
}

/** How many of each kind of line a document currently switches on. */
export function scopeOf(documentJson: string): { own: number; others: number } {
  let own = 0;
  let others = 0;
  try {
    const doc = JSON.parse(documentJson) as { network?: { lines?: Record<string, DocLine> } };
    for (const line of Object.values(doc.network?.lines ?? {})) {
      if (!line.included) continue;
      if (line.source === 'user') own++;
      else if (OTHERS.has(line.source ?? '')) others++;
    }
  } catch {
    // A document we cannot read is one we must not quietly alter.
  }
  return { own, others };
}

/**
 * Existing lines the document switches off.
 *
 * A plan may legitimately propose replacing part of the network, and then every
 * figure it carries is a difference against a network that still runs those
 * lines. The reader has to be told, or a negative benefit looks like a fault in
 * the arithmetic rather than the answer to the question the plan asked.
 */
export function existingSwitchedOff(document: unknown): number {
  try {
    const doc = (typeof document === 'string' ? JSON.parse(document) : document) as {
      network?: { lines?: Record<string, DocLine> };
    };
    return Object.values(doc?.network?.lines ?? {}).filter(
      (l) => l.source === 'existing' && !l.included,
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Switch off everything the author did not draw.
 *
 * Returns the document unchanged when there is nothing of their own in it —
 * publishing a comparison of two existing concepts is a legitimate thing to do,
 * and stripping it would leave an empty plan.
 */
export function ownWorkOnly(documentJson: string): string {
  const { own } = scopeOf(documentJson);
  if (own === 0) return documentJson;
  try {
    const doc = JSON.parse(documentJson) as { network?: { lines?: Record<string, DocLine> } };
    for (const line of Object.values(doc.network?.lines ?? {})) {
      if (line.included && OTHERS.has(line.source ?? '')) line.included = false;
    }
    return JSON.stringify(doc);
  } catch {
    return documentJson;
  }
}
