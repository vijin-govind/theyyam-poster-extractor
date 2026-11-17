import { normalizedText } from './text';
import { GENERIC, similar, skeleton, VENUE_WORDS } from './phonetic';
import type { VenueDetails } from './venues';

/**
 * What the app learns from reviewed work, kept in this browser:
 * - words: Malayalam word → English spelling, learned from reviewed Theyyam names;
 * - venues / theyyams: names from exported (approved) schedules or an imported list.
 */
export type WordEntry = { english: string; confirmations: number; updatedAt: number };
export type VenueEntry = { aliases: string[]; uses: number; updatedAt: number; details?: Partial<VenueDetails> };
export type NameEntry = { uses: number; updatedAt: number };
export type Knowledge = {
  words: Record<string, WordEntry>;
  venues: Record<string, VenueEntry>;
  theyyams: Record<string, NameEntry>;
};
export type ApprovedRow = { venue: string; theyyam: string; sourceVenue?: string; sourceLabel?: string };
export type KnownVenueMatch = { name: string; score: number };

const STORAGE_KEY = 'theyyam-extractor-knowledge-v1';
const LIMITS = { words: 1000, venues: 1000, theyyams: 500 } as const;

export const emptyKnowledge = (): Knowledge => ({ words: {}, venues: {}, theyyams: {} });

export function loadKnowledge(): Knowledge {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<Knowledge>;
    return { words: parsed.words || {}, venues: parsed.venues || {}, theyyams: parsed.theyyams || {} };
  } catch {
    return emptyKnowledge();
  }
}

function newest<T extends { updatedAt: number }>(entries: Record<string, T>, limit: number) {
  return Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, limit));
}

function save(knowledge: Knowledge): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      words: newest(knowledge.words, LIMITS.words),
      venues: newest(knowledge.venues, LIMITS.venues),
      theyyams: newest(knowledge.theyyams, LIMITS.theyyams),
    }));
    return true;
  } catch {
    return false;
  }
}

export function knowledgeCounts(knowledge = loadKnowledge()) {
  return { words: Object.keys(knowledge.words).length, venues: Object.keys(knowledge.venues).length, theyyams: Object.keys(knowledge.theyyams).length };
}

export function clearKnowledge(): boolean {
  try { localStorage.removeItem(STORAGE_KEY); return true; } catch { return false; }
}

const tidyName = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Stores word spellings; a conflicting review replaces the old spelling. Returns how many were stored. */
export function learnWords(pairs: [string, string][], knowledge = loadKnowledge()): number {
  const now = Date.now();
  let count = 0;
  for (const [malayalam, english] of pairs) {
    const key = normalizedText(malayalam).trim();
    const value = tidyName(english);
    if (!key || !value) continue;
    const previous = knowledge.words[key];
    knowledge.words[key] = { english: value, confirmations: previous?.english === value ? previous.confirmations + 1 : 1, updatedAt: now };
    count++;
  }
  return count && save(knowledge) ? count : 0;
}

function addVenue(knowledge: Knowledge, name: string, alias: string | undefined, now: number) {
  const venue = tidyName(name);
  if (venue.length < 3) return;
  const existing = knowledge.venues[venue] || { aliases: [], uses: 0, updatedAt: now };
  const cleanAlias = alias ? tidyName(normalizedText(alias)) : '';
  if (cleanAlias && cleanAlias !== venue && !existing.aliases.includes(cleanAlias)) existing.aliases = [...existing.aliases, cleanAlias].slice(-10);
  knowledge.venues[venue] = { ...existing, uses: existing.uses + 1, updatedAt: now };
}

/**
 * Called when a schedule is exported: exported rows are reviewed, so their
 * venues, Theyyam names and word spellings become reference data.
 */
export function recordApprovedRows(rows: ApprovedRow[], wordPairs: (source: string, english: string) => [string, string][]) {
  const knowledge = loadKnowledge();
  const now = Date.now();
  for (const row of rows) {
    if (row.venue.trim()) addVenue(knowledge, row.venue, row.sourceVenue, now);
    const name = tidyName(row.theyyam);
    if (name.length >= 3) {
      const existing = knowledge.theyyams[name];
      knowledge.theyyams[name] = { uses: (existing?.uses || 0) + 1, updatedAt: now };
    }
    if (row.sourceLabel && name) {
      for (const [malayalam, english] of wordPairs(row.sourceLabel, name)) {
        const previous = knowledge.words[malayalam];
        knowledge.words[malayalam] = { english, confirmations: previous?.english === english ? previous.confirmations + 1 : 1, updatedAt: now };
      }
    }
  }
  save(knowledge);
  return knowledgeCounts(knowledge);
}

/** Remembers exported venue details (district, village, coordinates…) for the next poster from that venue. */
export function rememberVenueDetails(venues: VenueDetails[]) {
  const knowledge = loadKnowledge();
  const now = Date.now();
  for (const venue of venues) {
    const name = tidyName(venue.nameEn);
    if (!name) continue;
    addVenue(knowledge, name, venue.nameMl || undefined, now);
    const details = Object.fromEntries(Object.entries(venue).filter(([, value]) => value && String(value).trim())) as Partial<VenueDetails>;
    knowledge.venues[name].details = { ...knowledge.venues[name].details, ...details };
  }
  save(knowledge);
}

export function knownVenueDetails(name: string, knowledge = loadKnowledge()): Partial<VenueDetails> {
  return knowledge.venues[tidyName(name)]?.details || {};
}

/** Adds venue names from the user's own list (for example, the calendar app's venue table). */
export function importVenues(names: string[]): number {
  const knowledge = loadKnowledge();
  const now = Date.now();
  const before = Object.keys(knowledge.venues).length;
  for (const name of names) addVenue(knowledge, name, undefined, now);
  save(knowledge);
  return Object.keys(knowledge.venues).length - before;
}

const words = (value: string) => normalizedText(value).replace(/[^\p{L}\p{M}\s]/gu, ' ').split(/\s+/).filter(Boolean);
const isSpecific = (word: string) => !VENUE_WORDS.test(word) && !GENERIC.test(word);

/**
 * Ranks known venues against the poster's partial venue text. An exact OCR
 * alias seen before scores 1; otherwise the share of poster words that sound
 * like a word of the known name, minus a little for words the poster lacks.
 */
export function matchKnownVenues(sourceVenue: string, hints: string[], knowledge = loadKnowledge()): KnownVenueMatch[] {
  const source = tidyName(normalizedText(sourceVenue));
  const specific = [...new Set([...hints, ...words(sourceVenue)])].filter(isSpecific);
  const matches: KnownVenueMatch[] = [];
  for (const [name, entry] of Object.entries(knowledge.venues)) {
    if (source && (name === source || entry.aliases.includes(source))) { matches.push({ name, score: 1 }); continue; }
    if (!specific.length) continue;
    const nameWords = words(name).filter(isSpecific);
    const matched = specific.filter(hint => nameWords.some(word => similar(word, hint)));
    if (!matched.length) continue;
    const unmatched = nameWords.filter(word => !specific.some(hint => similar(word, hint))).length;
    matches.push({ name, score: matched.length / specific.length - unmatched * 0.1 });
  }
  return matches.filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 5);
}

/** A known venue confident enough to fill in automatically, or '' to leave the poster's text for review. */
export function confidentVenue(matches: KnownVenueMatch[]): string {
  const [best, second] = matches;
  if (!best || best.score < 0.99) return '';
  if (second && second.score > best.score - 0.3) return '';
  return best.name;
}

/** True when a Malayalam word and its English spelling plausibly sound alike. */
export function soundsAlike(malayalam: string, english: string) {
  const a = skeleton(malayalam), b = skeleton(english);
  return a.length >= 2 && b.length >= 2 && (a === b || similar(malayalam, english));
}
