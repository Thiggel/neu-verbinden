// Client for the Rust API.
//
// Everything here degrades gracefully: the editor is fully usable with no
// server at all (scenarios save to a file), and the social pages say so rather
// than showing a broken screen.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:8080';

export interface ScenarioSummary {
  slug: string;
  /** Which city this plan is for. */
  city: string;
  title: string;
  description: string;
  author: string | null;
  author_name: string | null;
  visibility: string;
  network_km: number;
  new_km: number;
  stations: number;
  new_stations: number;
  investment_eur: number;
  annual_benefit_eur: number;
  annual_fiscal_eur: number;
  benefit_cost_ratio: number;
  npv_eur: number;
  population_served: number;
  /** People the plan newly brings within walking distance of a station. */
  population_gain: number;
  co2_saved_t: number;
  opening_year: number | null;
  votes: number;
  views: number;
  forks: number;
  comment_count: number;
  created_at: string;
  published_at: string | null;
  parent_slug: string | null;
  calculation_version: string;
  data_version: string;
}

export interface ScenarioDetail extends ScenarioSummary {
  document: unknown;
  result: unknown;
  voted: boolean;
  can_edit: boolean;
}

export interface Board {
  key: string;
  label: string;
  entries: ScenarioSummary[];
}

export interface Comment {
  id: string;
  body: string;
  author: string | null;
  author_name: string | null;
  created_at: string;
}

export interface ComparisonRow {
  key: string;
  label: string;
  a: number;
  b: number;
  unit: string;
  higherIsBetter: boolean;
}

export class ApiUnavailable extends Error {
  constructor() {
    super('Der Server ist gerade nicht erreichbar.');
  }
}

async function call<T>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiUnavailable();
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => call<{ ok: boolean; dataVersion: string }>('/api/health'),
  meta: () =>
    call<{
      calculationVersion: string;
      dataVersion: string;
      sorts: { key: string; label: string }[];
      cities: { id: string; name: string }[];
      defaultCity: string;
      disclaimer: string;
      sources: { name: string; url: string; licence: string; note: string }[];
    }>('/api/meta'),

  list: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
    return call<ScenarioSummary[]>(`/api/scenarios?${q}`);
  },
  get: (slug: string, token?: string | null) =>
    call<ScenarioDetail>(`/api/scenarios/${encodeURIComponent(slug)}`, { token }),
  create: (body: unknown, token: string) =>
    call<ScenarioSummary>('/api/scenarios', { method: 'POST', body: JSON.stringify(body), token }),
  fork: (slug: string, token: string) =>
    call<ScenarioSummary>(`/api/scenarios/${encodeURIComponent(slug)}/fork`, { method: 'POST', token }),
  vote: (slug: string, token: string, on: boolean) =>
    call<{ voted: boolean; votes: number }>(`/api/scenarios/${encodeURIComponent(slug)}/vote`, {
      method: on ? 'POST' : 'DELETE',
      token,
    }),
  comments: (slug: string) => call<Comment[]>(`/api/scenarios/${encodeURIComponent(slug)}/comments`),
  addComment: (slug: string, body: string, token: string) =>
    call<Comment>(`/api/scenarios/${encodeURIComponent(slug)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      token,
    }),
  report: (slug: string, reason: string, token: string) =>
    call<{ reported: boolean }>(`/api/scenarios/${encodeURIComponent(slug)}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      token,
    }),
  leaderboards: (city?: string) =>
    call<Board[]>(`/api/leaderboards${city ? `?city=${encodeURIComponent(city)}` : ''}`),
  compare: (a: string, b: string) =>
    call<{
      a: { slug: string; title: string; calculationVersion: string };
      b: { slug: string; title: string; calculationVersion: string };
      /** False when the two results came from different model or parameter versions. */
      sameModel: boolean;
      rows: ComparisonRow[];
    }>(
      `/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
    ),
  register: (body: { handle: string; password: string; display_name?: string }) =>
    call<{ token: string; user: { handle: string; display_name: string } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { handle: string; password: string }) =>
    call<{ token: string; user: { handle: string; display_name: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  me: (token: string) =>
    call<{ handle: string; display_name: string; bio: string; role: string }>('/api/auth/me', { token }),
  /** Everything stored about this account (Art. 15 and 20 DSGVO). */
  exportAccount: (token: string) => call<Record<string, unknown>>('/api/auth/export', { token }),
  /** Erases the account and everything attached to it (Art. 17 DSGVO). */
  deleteAccount: (token: string, password: string) =>
    call<{ geloescht: boolean; entwuerfe: number }>('/api/auth/me', {
      method: 'DELETE',
      token,
      body: JSON.stringify({ password }),
    }),
};

const TOKEN_KEY = 'hh-token';

export const session = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  },
};
