import { normalizedText } from './text';

// ---------------------------------------------------------------------------
// Malayalam → Latin

const CONSONANTS: Record<string, string> = {
  'ക': 'k', 'ഖ': 'kh', 'ഗ': 'g', 'ഘ': 'gh', 'ങ': 'ng', 'ച': 'ch', 'ഛ': 'chh', 'ജ': 'j', 'ഝ': 'jh', 'ഞ': 'nj',
  'ട': 't', 'ഠ': 'th', 'ഡ': 'd', 'ഢ': 'dh', 'ണ': 'n', 'ത': 'th', 'ഥ': 'th', 'ദ': 'd', 'ധ': 'dh', 'ന': 'n',
  'പ': 'p', 'ഫ': 'ph', 'ബ': 'b', 'ഭ': 'bh', 'മ': 'm', 'യ': 'y', 'ര': 'r', 'ല': 'l', 'വ': 'v', 'ശ': 'sh',
  'ഷ': 'sh', 'സ': 's', 'ഹ': 'h', 'ള': 'l', 'ഴ': 'zh', 'റ': 'r',
};
const VOWELS: Record<string, string> = {
  'അ': 'a', 'ആ': 'aa', 'ഇ': 'i', 'ഈ': 'ee', 'ഉ': 'u', 'ഊ': 'oo', 'ഋ': 'ru', 'എ': 'e', 'ഏ': 'e', 'ഐ': 'ai',
  'ഒ': 'o', 'ഓ': 'o', 'ഔ': 'au',
};
const SIGNS: Record<string, string> = {
  'ാ': 'a', 'ി': 'i', 'ീ': 'ee', 'ു': 'u', 'ൂ': 'oo', 'ൃ': 'ru', 'െ': 'e', 'േ': 'e', 'ൈ': 'ai', 'ൊ': 'o',
  'ോ': 'o', 'ൌ': 'au', 'ൗ': 'au',
};
const OTHER: Record<string, string> = { 'ൻ': 'n', 'ർ': 'r', 'ൽ': 'l', 'ൾ': 'l', 'ൺ': 'n', 'ം': 'm', 'ഃ': 'h' };

/** Readable romanization ("കൊളച്ചേരി" → "kolachcheri"), good enough for a web query. */
export function romanize(text: string): string {
  let out = '';
  const chars = [...normalizedText(text)];
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    const consonant = CONSONANTS[char];
    if (consonant) {
      const next = chars[index + 1];
      if (next === '്') { out += consonant; index++; }
      else if (next && SIGNS[next] !== undefined) { out += consonant + SIGNS[next]; index++; }
      else out += consonant + 'a';
    } else out += VOWELS[char] ?? OTHER[char] ?? (/[ഀ-ൿ]/.test(char) ? '' : char);
  }
  return out.replace(/chch/g, 'ch').replace(/thth/g, 'tth').replace(/shsh/g, 'sh').replace(/\s+/g, ' ').trim();
}

/**
 * Consonant outline used to compare spellings: "Kolachery", "Kolacheri" and
 * "കൊളച്ചേരി" all become "klcr"; "Vishakandan" and "വിഷകണ്ഠൻ" both "vsktn".
 */
export function skeleton(word: string): string {
  const latin = /[ഀ-ൿ]/.test(word) ? romanize(word) : word;
  return latin.toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/zh/g, 'l').replace(/sh|ch|th|dh|kh|gh|ph|bh/g, match => match[0] === 's' ? 's' : match[0])
    .replace(/w/g, 'v').replace(/[aeiouyh]/g, '')
    .replace(/d/g, 't').replace(/g/g, 'k').replace(/b/g, 'p').replace(/j/g, 'c').replace(/z/g, 's').replace(/q/g, 'k')
    .replace(/(.)\1+/g, '$1');
}

export function similar(a: string, b: string) {
  const x = skeleton(a), y = skeleton(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x === y) return true;
  // OCR often truncates the end of a word ("ചാത്തമ്പ" for "ചാത്തമ്പള്ളി").
  return Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x));
}

/** Honorifics and venue types that do not identify a particular venue. */
export const VENUE_WORDS = /^(?:ശ്രീ|ക്ഷേത്രം|ക്ഷേത്രത്തിൽ|കാവ്|തറവാട്|ദേവസ്ഥാനം|മടപ്പുര|കോട്ടം|പള്ളിയറ|കഴകം|സ്ഥാനം|temple|kshetram|kshethram|kavu|sree|sri|shri|tharavad|devasthanam|madappura)$/i;
export const GENERIC = /^(?:sree|shree|sri|shri|temple|kshetram|kshethram|kshetra|kavu|devasthanam|tharavad|tharavadu|madappura|bhagavathi|kerala|kannur|theyyam|festival|the|of)$/i;
