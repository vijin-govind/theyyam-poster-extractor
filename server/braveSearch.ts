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

/**
 * Serves GET /api/venue-search?q=… from the Vite dev and preview servers.
 * Results are cached in memory to save search quota while reviewing.
 */
export function venueSearchPlugin(key: string | undefined): Plugin {
  const cache = new Map<string, SearchResult[]>();
  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'Use GET.' });
    if (!key) return send(503, { error: 'Online venue search is not set up. Add BRAVE_SEARCH_API_KEY to .env.local and restart the app.' });
    const query = new URL(req.url || '', 'http://localhost').searchParams.get('q')?.trim() || '';
    if (!query || query.length > 200) return send(400, { error: 'Search text must be 1–200 characters.' });
    try {
      const results = cache.get(query) || await braveSearch(query, key);
      cache.set(query, results);
      send(200, { results });
    } catch (error) {
      send(502, { error: error instanceof Error ? error.message : 'Venue search failed.' });
    }
  };
  return {
    name: 'venue-search',
    configureServer(server) { server.middlewares.use('/api/venue-search', (req, res) => void handler(req, res)); },
    configurePreviewServer(server) { server.middlewares.use('/api/venue-search', (req, res) => void handler(req, res)); },
  };
}
