import { normalizedText } from './text';
import { GENERIC, romanize, similar, skeleton, VENUE_WORDS } from './phonetic';

export { romanize, skeleton };

/** One web search hit, as returned by the venue-search endpoint. */
export type SearchResult = { title: string; url: string; description: string };
export type VenueCandidate = { name: string; score: number; mentions: number; url: string; source: string };
export type VenueQuery = { malayalam: string; english: string; hints: string[] };

// ---------------------------------------------------------------------------
// Query building from the poster's OCR text


/**
 * Builds search text from the extracted venue plus heading fragments such as
 * "കൊളച്ചേരി ശ്രീ ചാത്തമ്പ" that name the place but lack a venue suffix.
 */
export function venueQuery(rawText: string, sourceVenue: string): VenueQuery {
  const venue = normalizedText(sourceVenue).trim();
  const core = venue.split(/\s+/).filter(word => word && !VENUE_WORDS.test(word));
  const lines = normalizedText(rawText || '').split('\n').map(line => line.replace(/[^ഀ-ൿ\s]/g, ' ').replace(/\s+/g, ' ').trim());
  const fragments = new Map<string, number>();
  for (const line of lines) {
    const words = line.split(' ').filter(word => (word.match(/[ക-ഹൺ-ൿ]/g) || []).length >= 2);
    const sree = words.indexOf('ശ്രീ');
    if (sree < 1 || words.length > 7) continue;
    const fragment = words.slice(Math.max(0, sree - 2), sree + 3).filter(word => !core.includes(word) && !/ക്ഷേത്ര/.test(word)).join(' ');
    if (fragment.split(' ').length >= 2) fragments.set(fragment, (fragments.get(fragment) || 0) + 1);
  }
  // Prefer the longest, most repeated reading of the heading.
  const heading = [...fragments.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || '';
  const malayalam = [heading, venue].filter(Boolean).join(' ').replace(/ക്ഷേത്രത്തിൽ/g, 'ക്ഷേത്രം').trim();
  const englishWords = romanize(malayalam).split(' ').map(word => word === 'kshethram' ? 'temple' : word === 'shree' ? 'sree' : word);
  if (!englishWords.includes('temple') && !englishWords.includes('kavu')) englishWords.push('temple');
  return { malayalam, english: `${englishWords.join(' ')} Kerala`.trim(), hints: queryHints(malayalam) };
}

/** Name and place words of a search text, without "ശ്രീ", "ക്ഷേത്രം" and similar. */
export function queryHints(text: string): string[] {
  return [...new Set(normalizedText(text).split(/\s+/).filter(word => word && !VENUE_WORDS.test(word)))];
}

// ---------------------------------------------------------------------------
// Candidate extraction

const ENGLISH_VENUE = /((?:[A-Z][A-Za-z'’.-]*\s+){1,7}(?:Temple|Kshetram|Kshethram|Kshetra|Kavu|Devasthanam|Tharavad|Tharavadu|Madappura))\b/g;
const MALAYALAM_VENUE = /((?:[ഀ-ൿ]+\s+){1,6}(?:ക്ഷേത്രം|കാവ്|ദേവസ്ഥാനം|തറവാട്|മടപ്പുര))/g;
const stripTags = (value: string) => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

function tidy(name: string) {
  return name.replace(/\s+/g, ' ').replace(/^(?:The|At|In|Of|About|Visit)\s+/i, '').replace(/\bSri\b/g, 'Sree').trim();
}

/** Ranks temple names found in search results by how many OCR fragments they match. */
export function venueCandidates(results: SearchResult[], hints: string[]): VenueCandidate[] {
  const found = new Map<string, VenueCandidate>();
  const specific = hints.filter(hint => !GENERIC.test(romanize(hint)));
  for (const result of results) {
    const text = `${stripTags(result.title)} . ${stripTags(result.description)}`;
    const names = [...text.matchAll(ENGLISH_VENUE), ...normalizedText(text).matchAll(MALAYALAM_VENUE)].map(match => tidy(match[1]));
    for (const name of new Set(names)) {
      const words = name.split(/\s+/).filter(word => !GENERIC.test(word) && !VENUE_WORDS.test(word));
      const matched = specific.filter(hint => words.some(word => similar(word, hint)));
      if (!matched.length) continue;
      // Words that match nothing on the poster may belong to a different temple.
      const unmatched = words.filter(word => !specific.some(hint => similar(word, hint))).length;
      const score = matched.length / Math.max(1, specific.length) - unmatched * 0.1;
      const key = skeleton(name.replace(/\b(?:temple|kshetram|kshethram|kshetra)\b/gi, ''));
      const previous = found.get(key);
      let source = '';
      try { source = new URL(result.url).hostname.replace(/^www\./, ''); } catch { /* keep blank */ }
      if (previous) {
        previous.mentions++;
        if (score > previous.score) Object.assign(previous, { name, score });
      } else found.set(key, { name, score, mentions: 1, url: result.url, source });
    }
  }
  return [...found.values()]
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.mentions - a.mentions || b.name.length - a.name.length)
    .slice(0, 8);
}

export class VenueSearchUnavailable extends Error {}

/** Searches through the app's own endpoint, which holds the search API key. */
export async function searchVenueOnline(
  queries: string[],
  hints: string[],
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ candidates: VenueCandidate[]; resultCount: number }> {
  const results: SearchResult[] = [];
  for (const query of [...new Set(queries.map(q => q.trim()).filter(Boolean))]) {
    const response = await fetchImpl(`/api/venue-search?q=${encodeURIComponent(query)}`, { signal });
    const body = await response.json().catch(() => ({})) as { results?: SearchResult[]; error?: string };
    if (response.status === 404 || response.status === 503) {
      throw new VenueSearchUnavailable(body.error || 'Online venue search is not set up for this app.');
    }
    if (!response.ok) throw new Error(body.error || `Venue search failed (${response.status}).`);
    results.push(...(body.results || []));
  }
  return { candidates: venueCandidates(results, hints), resultCount: results.length };
}
