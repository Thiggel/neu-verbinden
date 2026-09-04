// German formatting. Every figure in this product is an estimate, so the
// formatters deliberately round hard: showing "€8,43172 Mrd." would imply a
// precision the model does not have (plan §29).

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat('de-DE', opts);

const int = nf({ maximumFractionDigits: 0 });
const one = nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
const two = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Money, rounded to a sensible number of significant digits. */
export function eur(value: number, opts: { sign?: boolean } = {}): string {
  const v = Math.abs(value);
  const s = value < 0 ? '−' : opts.sign && value > 0 ? '+' : '';
  if (v >= 1e9) return `${s}${(v / 1e9 >= 10 ? one : two).format(v / 1e9)} Mrd. €`;
  if (v >= 1e6) return `${s}${int.format(Math.round(v / 1e6))} Mio. €`;
  if (v >= 1e3) return `${s}${int.format(Math.round(v / 1e3))} Tsd. €`;
  return `${s}${int.format(Math.round(v))} €`;
}

export function eurPerYear(value: number, opts: { sign?: boolean } = {}): string {
  return `${eur(value, opts)}/Jahr`;
}

/** A range, collapsing to a single value when the ends round the same. */
export function eurRange(low: number, high: number): string {
  const a = eur(low);
  const b = eur(high);
  return a === b ? a : `${a} – ${b}`;
}

export function km(value: number): string {
  return `${value >= 100 ? int.format(value) : one.format(value)} km`;
}

export function count(value: number): string {
  return int.format(Math.round(value));
}

export function percent(value: number, digits = 0): string {
  return `${nf({ maximumFractionDigits: digits }).format(value * 100)} %`;
}

export function ratio(value: number): string {
  return two.format(value);
}

export function minutes(value: number): string {
  return `${one.format(value)} min`;
}

export function tonnes(value: number): string {
  if (Math.abs(value) >= 1e6) return `${one.format(value / 1e6)} Mio. t`;
  if (Math.abs(value) >= 1e3) return `${int.format(Math.round(value / 1e3))} Tsd. t`;
  return `${int.format(Math.round(value))} t`;
}

export function yearRange(low: number, mid: number, high: number): string {
  if (low === high) return String(mid);
  return `${mid} (${low}–${high})`;
}

/** "vor 3 Tagen", for the social pages. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d < 31) return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `vor ${mo} Mon.`;
  return `vor ${Math.round(mo / 12)} Jahren`;
}

export const MODE_LABEL: Record<string, string> = {
  ubahn: 'U-Bahn',
  sbahn: 'S-Bahn',
  tram: 'Stadtbahn',
  regional: 'Regionalbahn',
};

export const SOURCE_LABEL: Record<string, string> = {
  existing: 'Bestand',
  planned: 'Geplant',
  proposal: 'Vorschlag',
  user: 'Eigener Entwurf',
};

export const STATUS_LABEL: Record<string, string> = {
  in_service: 'in Betrieb',
  under_construction: 'im Bau',
  to_build: 'zu bauen',
};

export const BASIS_LABEL: Record<string, string> = {
  benchmark: 'Kennwert',
  modelled: 'modelliert',
  assumption: 'Annahme',
};

export const SEVERITY_LABEL: Record<string, string> = {
  info: 'Hinweis',
  caution: 'Zu beachten',
  warning: 'Kritisch',
  blocking: 'Nicht umsetzbar',
};


/**
 * A city's display name from its identifier.
 *
 * The identifiers are lowercase and appear in URLs and in the database; they
 * are not names, and printing one in a sentence reads like a bug even when it
 * is not ("gehören zu verschiedenen Städten (hamburg und berlin)").
 */
const CITY_LABEL: Record<string, string> = { hamburg: 'Hamburg', berlin: 'Berlin' };

export const cityLabel = (id: string) =>
  CITY_LABEL[id] ?? (id ? id[0].toUpperCase() + id.slice(1) : 'Hamburg');
