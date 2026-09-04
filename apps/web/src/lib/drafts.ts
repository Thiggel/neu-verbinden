// Where an unfinished draft lives between visits.
//
// The editor writes it; the scenario page needs it too, so that "open in the
// editor" can hand a published plan over to be worked on. Keeping the key
// spelling in one place is the whole point — two spellings of `hh-draft` would
// silently lose someone's work.

export const DRAFT_KEY = 'hh-draft';
export const DRAFT_TEMPLATE_KEY = 'hh-draft-template';
export const CITY_KEY = 'hh-city';

export const draftKey = (city: string) => `${DRAFT_KEY}-${city}`;

/** Whether unfinished work is stored for this city. */
export function hasDraft(city: string): boolean {
  try {
    return !!localStorage.getItem(draftKey(city));
  } catch {
    return false;
  }
}

/**
 * Hand a document to the editor and say where to go.
 *
 * The editor restores whatever is under the draft key on load, so putting the
 * document there is all it takes — no second code path, and the document is
 * the same shape the editor saves.
 */
export function openInEditor(city: string, document: unknown, templateId = ''): string {
  try {
    localStorage.setItem(draftKey(city), JSON.stringify(document));
    localStorage.setItem(`${DRAFT_TEMPLATE_KEY}-${city}`, templateId);
    localStorage.setItem(CITY_KEY, city);
  } catch {
    // A full or disabled storage: fall through to the editor anyway rather
    // than leaving the button apparently dead.
  }
  return `/?stadt=${encodeURIComponent(city)}`;
}
