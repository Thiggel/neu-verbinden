// Server-side read of one scenario, used by the metadata and the preview image.
//
// Deliberately forgiving: a link should still render if the API is down, just
// without the extras.

export interface ScenarioMeta {
  slug: string;
  title: string;
  description: string;
  author_name: string | null;
  author: string | null;
  city: string;
  new_km: number;
  new_stations: number;
  investment_eur: number;
  annual_benefit_eur: number;
  benefit_cost_ratio: number;
  opening_year: number | null;
  document?: {
    network?: {
      edges?: Record<string, { geo: unknown; status: string }>;
      lines?: Record<string, { edges: number[]; color: string; included: boolean }>;
    };
  };
}

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:8080';

export async function fetchScenario(slug: string): Promise<ScenarioMeta | null> {
  try {
    const res = await fetch(`${API}/api/scenarios/${encodeURIComponent(slug)}`, {
      // A preview may be requested by many crawlers at once; a minute of
      // caching costs nothing and spares the database.
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as ScenarioMeta;
  } catch {
    return null;
  }
}
