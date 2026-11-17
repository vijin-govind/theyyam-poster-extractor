import { handleVenueSearch, type SearchResult } from '../../server/braveSearch';

// Kept between requests while this function instance is warm, to save search quota.
const cache = new Map<string, SearchResult[]>();

/** Netlify Function serving GET /api/venue-search for the deployed app. */
export default async (request: Request): Promise<Response> => {
  const { status, body } = await handleVenueSearch({
    method: request.method,
    url: request.url,
    headers: {
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      'sec-fetch-site': request.headers.get('sec-fetch-site'),
    },
  }, process.env.BRAVE_SEARCH_API_KEY, {
    cache,
    sameSiteOnly: true,
    notSetUp: 'Online venue search is not set up. Add BRAVE_SEARCH_API_KEY in Netlify (Site configuration → Environment variables) and redeploy.',
  });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};

export const config = { path: '/api/venue-search' };
