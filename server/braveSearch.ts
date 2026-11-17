import type { Plugin } from 'vite';

export type SearchResult = { title: string; url: string; description: string };

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/** Calls the Brave Search API. The key stays on the server, as Brave requires. */
export async function braveSearch(query: string, key: string, fetchImpl: typeof fetch = fetch): Promise<SearchResult[]> {
  const url = `${ENDPOINT}?${new URLSearchParams({ q: query, count: '10', country: 'IN', safesearch: 'moderate' })}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403 ? 'The Brave Search API key was rejected.'
      : response.status === 429 ? 'The Brave Search rate limit or monthly quota was reached.'
      : `Brave Search returned HTTP ${response.status}.`;
    throw new Error(reason);
  }
  const body = await response.json() as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (body.web?.results || []).map(result => ({
    title: result.title || '', url: result.url || '', description: result.description || '',
  }));
}

export type VenueSearchRequest = {
  method: string;
  url: string;
  /** Request headers needed for the same-site check (lower-case names). */
  headers: { host?: string | null; origin?: string | null; 'sec-fetch-site'?: string | null };
};
export type VenueSearchResponse = { status: number; body: { results?: SearchResult[]; error?: string } };

/**
 * Only the app's own pages may use the search (and the owner's Brave quota).
 * Browsers mark same-site fetches with Sec-Fetch-Site; cross-site pages cannot fake it.
 */
export function isSameSiteRequest(headers: VenueSearchRequest['headers']): boolean {
  const site = headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  if (!headers.origin || !headers.host) return false;
  try { return new URL(headers.origin).host === headers.host; } catch { return false; }
}

/** Shared by the Vite dev/preview servers and the Netlify Function. */
export async function handleVenueSearch(
  request: VenueSearchRequest,
  key: string | undefined,
  options: { cache?: Map<string, SearchResult[]>; sameSiteOnly?: boolean; notSetUp?: string; fetchImpl?: typeof fetch } = {},
): Promise<VenueSearchResponse> {
  if (request.method !== 'GET') return { status: 405, body: { error: 'Use GET.' } };
  if (options.sameSiteOnly && !isSameSiteRequest(request.headers)) {
    return { status: 403, body: { error: 'Venue search is only available from this app.' } };
  }
  if (!key) return { status: 503, body: { error: options.notSetUp || 'Online venue search is not set up.' } };
  const query = new URL(request.url, 'http://localhost').searchParams.get('q')?.trim() || '';
  if (!query || query.length > 200) return { status: 400, body: { error: 'Search text must be 1–200 characters.' } };
  try {
    const results = options.cache?.get(query) || await braveSearch(query, key, options.fetchImpl);
    options.cache?.set(query, results);
    return { status: 200, body: { results } };
  } catch (error) {
    return { status: 502, body: { error: error instanceof Error ? error.message : 'Venue search failed.' } };
  }
}

/**
 * Serves GET /api/venue-search?q=… from the Vite dev and preview servers.
 * Results are cached in memory to save search quota while reviewing.
 */
export function venueSearchPlugin(key: string | undefined): Plugin {
  const cache = new Map<string, SearchResult[]>();
  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const { status, body } = await handleVenueSearch({ method: req.method || 'GET', url: req.url || '', headers: {} }, key, {
      cache, notSetUp: 'Online venue search is not set up. Add BRAVE_SEARCH_API_KEY to .env.local and restart the app.',
    });
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'venue-search',
    configureServer(server) { server.middlewares.use('/api/venue-search', (req, res) => void handler(req, res)); },
    configurePreviewServer(server) { server.middlewares.use('/api/venue-search', (req, res) => void handler(req, res)); },
  };
}
