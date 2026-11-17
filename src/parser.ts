import type { Row } from './schema';
import { resolveCorrection, type LearnedCorrections } from './learning';
import { gregorianToMalayalam } from './calendar';
import { normalizedText } from './text';
import { romanize, similar, skeleton } from './phonetic';
import type { Knowledge } from './knowledge';

export { normalizedText };

// Conservative OCR parsing: only explicitly recognized names and dates become data.
// Unrecognized/ambiguous fields stay empty so the grid can require human review.
const MONTHS: [string, string[]][] = [
  ['chingam', ['chingam', 'ചിങ്ങം']], ['kanni', ['kanni', 'കന്നി']],
  ['thulam', ['thulam', 'tulam', 'തുലാം']], ['vrischikam', ['vrischikam', 'vrishchikam', 'വൃശ്ചികം']],
  ['dhanu', ['dhanu', 'ധനു']], ['makaram', ['makaram', 'മകരം']],
  ['kumbham', ['kumbham', 'കുംഭം']], ['meenam', ['meenam', 'മീനം']],
  ['medam', ['medam', 'മേടം']], ['edavam', ['edavam', 'ഇടവം']],
  ['mithunam', ['mithunam', 'മിഥുനം']], ['karkidakam', ['karkidakam', 'karkkidakam', 'കർക്കിടകം', 'കർക്കടകം']],
];
const GREGORIAN_MONTHS: [number, string[]][] = [
  [1, ['january', 'jan', 'ജനുവരി']], [2, ['february', 'feb', 'ഫെബ്രുവരി']],
  [3, ['march', 'mar', 'മാർച്ച്']], [4, ['april', 'apr', 'ഏപ്രിൽ']],
  [5, ['may', 'മേയ്']], [6, ['june', 'jun', 'ജൂൺ']],
  [7, ['july', 'jul', 'ജൂലൈ']], [8, ['august', 'aug', 'ഓഗസ്റ്റ്']],
  [9, ['september', 'sep', 'sept', 'സെപ്റ്റംബർ']],
  [10, ['october', 'oct', 'ഒക്ടോബർ']],
  [11, ['november', 'nov', 'നവംബർ']],
  [12, ['december', 'dec', 'ഡിസംബർ']],
];
// 0 = Sunday, matching Date#getUTCDay.
const WEEKDAYS: [number, RegExp][] = [
  [0, /ഞായർ|\bsunday\b/i], [1, /തിങ്കൾ|\bmonday\b/i], [2, /ചൊവ്വ|\btuesday\b/i],
  [3, /ബുധൻ|\bwednesday\b/i], [4, /വ്യാഴം|\bthursday\b/i], [5, /വെള്ളി(?!ാ)|\bfriday\b/i],
  [6, /ശനി|\bsaturday\b/i],
];
const NAMES: [string, RegExp][] = [
  ['Muchilottu Bhagavathi', /\bmuchil[oa]ttu\s+bhagavat?hi\b/gi],
  ['Agni Kandakarnan', /\bagni\s+kandakarnan\b/gi],
  ['Vayanattu Kulavan', /\bva?y[aā]na(?:t|tt)tu?\s+kulavan\b/gi],
  ['Puliyoor Kannan', /\bpuliy[ou]{1,2}r\s+kannan\b/gi],
  ['Theechamundi', /\bthee?\s*chamundi\b/gi],
  ['Gulikan Theyyam', /\bgulikan(?:\s+theyyam)?\b/gi],
  ['Raktha Chamundi', /\brak(?:t|th)a\s+chamundi\b/gi],
  ['Pottan Theyyam', /\bpottan(?:\s+theyyam)?\b/gi],
  ['Kandanar Kelan', /\bkandanar\s+kelan\b/gi],
  ['Kathivanoor Veeran', /\bkathivan[ou]{1,2}r\s+veeran\b/gi],
  ['Bhairavan', /\bbhairavan(?:\s+theyyam)?\b/gi],
  ['Vishnumoorthi', /\bvishnu\s*moo?rth[yi]\b/gi],
  ['Muthappan', /\bmuthappan(?:\s+theyyam)?\b/gi],
  ['Vettakkorumakan', /\bve?ttakk?orumakan\b/gi],
  ['Puthiya Bhagavathi', /\bputhiya\s+bhagavat?hi\b/gi],
  ['Kannangattu Bhagavathi', /\bkannangattu\s+bhagavat?hi\b/gi],
  ['Kuttichathan', /\bkuttichat(?:t)?han\b/gi],
  ['Dharma Daivam', /\bdharma\s+daivam\b/gi],
  ['Vairajathan', /\bvairajathan\b/gi],
  ['Padarkulangara Bhagavathi', /\bpadarkulangara\s+bhagavat?hi\b/gi],
  ['മുച്ചിലോട്ട് ഭഗവതി', /മുച്ചിലോട്ട[്ു]?\s*ഭഗവതി/g],
  ['അഗ്നി കണ്ടാകർണൻ', /അഗ്നി\s*കണ്ടാ?കർ[ണണ്ണ]+ൻ/g],
  ['വയനാട്ടു കുലവൻ', /വയനാട്ട[ു്]?\s*കുലവൻ/g],
  ['പുലിയൂർ കണ്ണൻ', /പുലിയൂർ\s*കണ്ണൻ/g],
  ['തീച്ചാമുണ്ഡി', /തീച്ചാമുണ്ഡി/g],
  ['ഗുളികൻ', /ഗുളികൻ/g],
  ['രക്ത ചാമുണ്ഡി', /രക്ത\s*ചാമുണ്ഡി/g],
  ['പൊട്ടൻ തെയ്യം', /പൊട്ടൻ(?:\s*തെയ്യം)?/g],
  ['കണ്ടനാർ കേളൻ', /കണ്ടനാർ\s*കേളൻ/g],
  ['കതിവനൂർ വീരൻ', /ക[തഥ]ിവനൂർ\s*വീരൻ/g],
  ['ഭൈരവൻ', /ഭൈരവൻ/g],
  ['വിഷ്ണുമൂർത്തി', /വിഷ്ണുമൂർത്തി/g],
  ['മുത്തപ്പൻ', /മുത്തപ്പൻ/g],
  ['കുട്ടിച്ചാത്തൻ', /കുട്ടിച്ചാത്തൻ/g],
  ['പുതിയ ഭഗവതി', /പുതിയ\s*ഭഗവതി/g],
  ['വേട്ടയ്ക്കൊരുമകൻ', /വേട്ടയ്ക്കൊരുമകൻ/g],
  ['തിരുവപ്പന', /തിരുവപ്പന/g],
  ['ശ്രീ മുത്തപ്പൻ വെള്ളാട്ടം', /ശ്രീ\s*മുത്തപ്പൻ\s*വെള്ളാട്ടം/g],
  ['ഗുളികൻ വെള്ളാട്ടം', /ഗുളികൻ\s*വെള്ളാട്ടം/g],
  ['പുതിയ ഭഗവതി വെള്ളാട്ടം', /പുതിയ\s*ഭഗവതി\s*വെള്ളാട്ടം/g],
];

// ---------------------------------------------------------------------------
// Text normalization

/** Malayalam letters (consonants, independent vowels, chillus) and vowel signs. */
const ML_LETTER = /[\u0D05-\u0D39\u0D3E-\u0D4D\u0D7A-\u0D7F]/;

function malayalamConsonants(value: string) {
  return (value.match(/[ക-ഹൺ-ൿ]/g) || []).length;
}

// ---------------------------------------------------------------------------
// Dates

function validISODate(year: number, month: number, day: number): string {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === iso ? iso : '';
}

type GregorianParts = { year: number; month: number; day: string };

/** Written Gregorian date. The day is returned as OCR text, so an unreadable day can still be reconciled. */
function gregorianParts(line: string): GregorianParts | null {
  for (const [month, aliases] of GREGORIAN_MONTHS) {
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const monthFirst = new RegExp(`(?:^|\\s)${escaped}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,|\\s)+\\s*(\\d{4})(?=$|\\s|[),])`, 'i').exec(line);
      if (monthFirst) return { year: Number(monthFirst[2]), month, day: monthFirst[1] };
      const yearFirst = new RegExp(`(?:^|\\s)(\\d{4})\\s+${escaped}(?=$|[\\s?,:.])\\s*[?,:.]?\\s*(\\d{1,2})?(?=$|\\s|[),])`, 'i').exec(line);
      if (yearFirst) return { year: Number(yearFirst[1]), month, day: yearFirst[2] || '' };
      const dayFirst = new RegExp(`(?:^|\\s)(\\d{1,2})(?:st|nd|rd|th)?\\s+${escaped}(?:,|\\s)+\\s*(\\d{4})(?=$|\\s|[),])`, 'i').exec(line);
      if (dayFirst) return { year: Number(dayFirst[2]), month, day: dayFirst[1] };
    }
  }
  return null;
}

function weekdayOf(line: string): number | undefined {
  const found = WEEKDAYS.filter(([, pattern]) => pattern.test(line));
  return found.length === 1 ? found[0][0] : undefined;
}

function dateFields(line: string): Partial<Row> {
  const result: Partial<Row> = {};
  const iso = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = new Date(`${iso[0]}T00:00:00Z`);
    if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso[0]) result.dateKey = iso[0];
  }
  const written = iso ? null : gregorianParts(line);
  if (!result.dateKey && written && written.year >= 1900 && written.year <= 2200) {
    // An unreadable day still marks a date heading; reconciliation may recover it.
    result.dateKey = written.day ? validISODate(written.year, written.month, Number(written.day)) : '';
  }
  for (const [month, aliases] of MONTHS) {
    for (const alias of aliases) {
      const pattern = new RegExp(`(?:^|[\\s,:(])(${alias})(?=$|[\\s,):.\\d])`, 'i');
      const match = pattern.exec(line);
      if (!match) continue;
      result.malayalamMonth = month;
      // Clear the previous day when a new month header does not specify one.
      result.malayalamDay = '';
      const afterText = line.slice(match.index + match[0].length);
      const beforeText = line.slice(0, match.index);
      const after = afterText.match(/^\s*[:.,-]?\s*(\d{1,2})(?!\d|:)/);
      const before = beforeText.match(/(?:^|\s)(\d{1,2})\s*$/);
      // "തുലാം 9,10" lists two days, like a range: do not choose one.
      const trailingRange = after && /^\s*(?:[-–—,&]|to)\s*\d{1,2}(?!\d)/i.test(afterText.slice(after[0].length));
      const precedingRange = /\d{1,2}\s*(?:[-–—,&]|to)\s*\d{1,2}\s*$/i.test(beforeText);
      const day = after ? (trailingRange ? '' : after[1]) : (precedingRange ? '' : before?.[1]);
      if (day && Number(day) >= 1 && Number(day) <= 32) result.malayalamDay = String(Number(day));
      const year = line.match(/\b(1[12]\d{2})\b/);
      if (year) result.malayalamYear = year[1];
      break;
    }
    if (result.malayalamMonth) break;
  }
  const labelledYear = line.match(/(?:kollavarsham|kolla\s*varsham|malayalam\s*year|കൊല്ലവർഷം)\s*[:.-]?\s*(\d{4})\b/i);
  if (labelledYear) result.malayalamYear = labelledYear[1];
  return reconcileDates(line, result, written);
}

/**
 * A poster heading often states one day in both calendars plus a weekday.
 * OCR regularly drops a digit from large decorative day numbers ("26" → "6"),
 * so a Gregorian day that disagrees with the poster's own Malayalam date or
 * weekday is replaced only when exactly one day of that month fits all evidence.
 */
function reconcileDates(line: string, patch: Partial<Row>, written: GregorianParts | null): Partial<Row> {
  const weekday = weekdayOf(line);
  const month = patch.malayalamMonth;
  const day = patch.malayalamDay;
  const consistent = (iso: string) => {
    if (weekday !== undefined && new Date(`${iso}T00:00:00Z`).getUTCDay() !== weekday) return false;
    if (month || day) {
      const converted = gregorianToMalayalam(iso);
      if (!converted) return false;
      if (month && converted.malayalamMonth !== month) return false;
      if (day && converted.malayalamDay !== day) return false;
    }
    return true;
  };
  const hasEvidence = Boolean(month && day) || weekday !== undefined;
  if (patch.dateKey && written && hasEvidence && !consistent(patch.dateKey)) patch.dateKey = '';
  if (!patch.dateKey && written && hasEvidence) {
    let candidates: string[] = [];
    for (let candidateDay = 1; candidateDay <= 31; candidateDay++) {
      const iso = validISODate(written.year, written.month, candidateDay);
      if (iso && consistent(iso)) candidates.push(iso);
    }
    if (candidates.length > 1 && written.day) {
      const digits = String(Number(written.day));
      candidates = candidates.filter(iso => {
        const value = String(Number(iso.slice(8)));
        return value.endsWith(digits) || value.startsWith(digits);
      });
    }
    if (candidates.length === 1) patch.dateKey = candidates[0];
  }
  if (patch.dateKey) {
    const converted = gregorianToMalayalam(patch.dateKey);
    if (converted) {
      if (!patch.malayalamMonth) Object.assign(patch, converted);
      else if (patch.malayalamMonth === converted.malayalamMonth
        && (!patch.malayalamDay || patch.malayalamDay === converted.malayalamDay)) {
        patch.malayalamDay = converted.malayalamDay;
        patch.malayalamYear ||= converted.malayalamYear;
      }
    }
  }
  return patch;
}

function nextDay(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return '';
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Times

const MORNING = 'രാവിലെ|രാവിഥെ|പ[ുൂ]ലർച്ചെ|പ[ുൂ]ലർച്ച';
const AFTERNOON = 'ഉച്ച(?:യ്ക്ക്|ക്ക്|യ്ക്കു)?|വൈകു(?:ന്നേരം|ട്ട്)?|വൈകിട്ട്|വൈകീട്ട്|സായാഹ്നം';
const NIGHT = 'രാത്രി';
const TIME_SUFFIX = 'മണിക്ക്|മണിയ്ക്ക്|മണി|നു|ന്';

/** Malayalam posters write 7.30 as "730ന്" or "1030 ന്". Only rewrite times attached to a time suffix. */
function compactTimes(line: string) {
  return line.replace(/(^|[^\d.:])(\d{1,2})([0-5]\d)(?=\s*(?:മണി|നു|ന്))/g, '$1$2.$3');
}

function isTimingLine(line: string) {
  return !compactTimes(line).replace(/\b(?:a\.?m\.?|p\.?m\.?|to|until|around|approximately|approx|about|time|starts?|ends?)\b/gi, '')
    .replace(new RegExp(`${MORNING}|${AFTERNOON}|${NIGHT}|${TIME_SUFFIX}|മുതൽ|വരെ`, 'g'), '')
    .replace(/[\d\s:.,;\-–—]/g, '');
}

function timeFields(line: string): Partial<Row> {
  line = compactTimes(line);
  // A trailing AM/PM can apply to both ends of a range. Do not misread
  // the second endpoint alone as an exact start time.
  const sharedMeridiem = /\b(\d{1,2})(?::([0-5]\d))?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)(?!\w)/i.exec(line);
  if (sharedMeridiem) {
    const [, firstHour, firstMinute, lastHour, lastMinute, suffix] = sharedMeridiem;
    const first = Number(firstHour), last = Number(lastHour);
    // Descending shared-meridiem hours may cross noon/midnight; OCR cannot
    // safely determine which endpoint the suffix describes.
    if (first < 1 || first > 12 || last < 1 || last > 12 || first % 12 > last % 12) {
      return { start: '', end: '', timeCertainty: 'unknown' };
    }
    line = line.replace(sharedMeridiem[0], `${firstHour}:${firstMinute || '00'} ${suffix} - ${lastHour}:${lastMinute || '00'} ${suffix}`);
  }
  // Minutes are required without AM/PM; bare numbers can be dates or counts.
  const daypart = new RegExp(MORNING).test(line) ? 'am'
    : new RegExp(AFTERNOON).test(line) ? 'pm'
    : new RegExp(NIGHT).test(line) ? 'night'
    : '';
  const pattern = /\b(\d{1,2})(?:[:.]([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?(?!\w)/gi;
  const found: { value: string; index: number; end: number }[] = [];
  for (const match of line.matchAll(pattern)) {
    if (!match[2] && !match[3] && !daypart) continue;
    let hour = Number(match[1]);
    const meridiem = match[3]?.replace(/\./g, '').toLowerCase();
    if (meridiem || daypart === 'am' || daypart === 'pm') {
      if (hour < 1 || hour > 12) continue;
      hour = hour % 12 + ((meridiem || daypart) === 'pm' ? 12 : 0);
    } else if (daypart === 'night') {
      // രാത്രി 12 is midnight; രാത്രി 1–4 is after midnight.
      if (hour < 1 || hour > 12) continue;
      hour = hour === 12 ? 0 : hour <= 4 ? hour : hour + 12;
    } else if (hour > 23) continue;
    found.push({ value: `${String(hour).padStart(2, '0')}:${match[2] || '00'}`, index: match.index!, end: match.index! + match[0].length });
  }
  if (!found.length) return { start: '', end: '', timeCertainty: 'unknown' };
  const first = found[0];
  const second = found[1];
  const between = second ? line.slice(first.end, second.index).trim() : '';
  const range = second && /^(?:-|–|—|to|until|മുതൽ)$/i.test(between.replace(/\s+/g, ''));
  return {
    start: first.value,
    end: range ? second.value : '',
    timeCertainty: range ? 'range' : /\b(?:around|approx\.?|approximately|about)\b|ഏകദേശം/i.test(line) ? 'approximate' : 'exact',
  };
}

function minutesOf(time?: string) {
  const match = time?.match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

// ---------------------------------------------------------------------------
// Labels

const EDGE_PUNCTUATION = /^[\s:;|,./\\\-–—()[\]{}"“”'‘’!?*~=+<>…%$#@&^_`]+|[\s:;|,./\\\-–—()[\]{}"“”'‘’!?*~=+<>…%$#@&^_`]+$/g;
const LEADING_TIME = new RegExp(`^(?:${MORNING}|${AFTERNOON}|${NIGHT}|\\d{1,4}(?:[:.]\\d{1,2})?|a\\.?m\\.?|p\\.?m\\.?|${TIME_SUFFIX}|മുതൽ|വരെ)`, 'i');

/** Removes time tokens ("രാത്രി", "7.30", "മണിക്ക്", glued "730ന്") without touching words such as "ഗുളികന്റെ". */
function labelTokens(line: string): string[] {
  const tokens: string[] = [];
  for (const raw of compactTimes(line).split(/[\s:;|,]+/)) {
    let token = raw.replace(EDGE_PUNCTUATION, '');
    for (let guard = 0; guard < 6 && token; guard++) {
      const stripped = token.replace(LEADING_TIME, '').replace(EDGE_PUNCTUATION, '');
      if (stripped === token) break;
      token = stripped;
    }
    if (/^(?:to|until|around|approx\.?|approximately|about|ഏകദേശം)$/i.test(token)) continue;
    if (token) tokens.push(token);
  }
  // In a Malayalam schedule line, Latin fragments and digits are OCR noise.
  const malayalam = tokens.filter(token => ML_LETTER.test(token)).map(token => token.replace(/[^ഀ-ൿ]/g, ''));
  return malayalam.length ? malayalam : tokens;
}

/** Repairs common OCR variants and grammatical endings so labels compare and translate reliably. */
function canonicalToken(token: string): string {
  let value = token
    .replace(/^ഗൂളിക/, 'ഗുളിക')
    .replace(/ഭഥവ/g, 'ഭഗവ')
    .replace(/^ലിഷക/, 'വിഷക');
  if (/ത്തിന്റെ$/.test(value)) value = value.replace(/ത്തിന്റെ$/, 'ം');
  else if (/ന്റെ$/.test(value)) value = value.replace(/ന്റെ$/, 'ൻ');
  else if (/യുടെ$/.test(value)) value = value.replace(/യുടെ$/, '');
  else if (/വും$/.test(value)) value = value.replace(/വും$/, 'ം');
  else if (/[ിീെ]യും$/.test(value)) value = value.replace(/യും$/, '');
  if (/^ഗുളിക[ുൂ]?ൻ?$/.test(value)) value = 'ഗുളികൻ';
  if (/^മുത്തപ്പ$/.test(value)) value = 'മുത്തപ്പൻ';
  if (/^വെള്ളാ(?:ട്ടം|ടം|ട്ട|ളം|ട്)?$/.test(value)) value = 'വെള്ളാട്ടം';
  if (/^തിരുവപ്പ/.test(value)) value = 'തിരുവപ്പന';
  return value;
}

function canonicalPerformanceLabel(value: string): string {
  return labelTokens(value).map(canonicalToken).filter(Boolean).join(' ').trim();
}

type WordKind = 'title' | 'deity' | 'stage';
const WORDS: [RegExp, string, WordKind][] = [
  [/^ശ്രീ$/, 'Sree', 'title'],
  [/^വലിയ$/, 'Valiya', 'title'],
  [/^പുതിയ$/, 'Puthiya', 'title'],
  [/^ദൈവം$/, 'Daivam', 'title'],
  [/^ഗുളികൻ$/, 'Gulikan', 'deity'],
  [/^വിഷക[ുൂ]?ണ്ഠൻ$/, 'Vishakandan', 'deity'],
  [/^ഭഗവത(?:ി|്)?$/, 'Bhagavathi', 'deity'],
  [/^[എഏ]{0,2}ള്ളെ(?:ളെ)?ടുത്ത്?$/, 'Elleduthu', 'deity'],
  [/^തമ്പുരാട്ടി$/, 'Thampuratti', 'deity'],
  [/^മുത്തപ്പൻ$/, 'Muthappan', 'deity'],
  [/^തീച്ചാമുണ്ഡി$/, 'Theechamundi', 'deity'],
  [/^ചാമുണ്ഡി$/, 'Chamundi', 'deity'],
  [/^രക്ത$/, 'Raktha', 'title'],
  [/^വിഷ്ണുമൂർത്തി$/, 'Vishnumoorthi', 'deity'],
  [/^പൊട്ടൻ$/, 'Pottan', 'deity'],
  [/^കുട്ടിച്ചാത്തൻ$/, 'Kuttichathan', 'deity'],
  [/^ഭൈരവൻ$/, 'Bhairavan', 'deity'],
  [/^ക[തഥ]ിവനൂർ$/, 'Kathivanoor', 'title'],
  [/^വീരൻ$/, 'Veeran', 'deity'],
  [/^കണ്ടനാർ$/, 'Kandanar', 'title'],
  [/^കേളൻ$/, 'Kelan', 'deity'],
  [/^വയനാട്ട[ു്]?$/, 'Vayanattu', 'title'],
  [/^കുലവൻ$/, 'Kulavan', 'deity'],
  [/^മുച്ചിലോട്ട[്ു]?$/, 'Muchilottu', 'title'],
  [/^അഗ്നി$/, 'Agni', 'title'],
  [/^കണ്ടാ?കർണൻ$/, 'Kandakarnan', 'deity'],
  [/^പുലിയൂർ$/, 'Puliyoor', 'title'],
  [/^കണ്ണൻ$/, 'Kannan', 'deity'],
  [/^തിരുവപ്പന$/, 'Thiruvappana', 'deity'],
  [/^വേട്ടയ്ക്കൊരുമകൻ$/, 'Vettakkorumakan', 'deity'],
  [/^വെള്ളാട്ടം$/, 'Vellattam', 'stage'],
  [/^(?:തോ|താ)റ്റം$/, 'Thottam', 'stage'],
  [/^തിറ$/, 'Thira', 'stage'],
  [/^പുറ[ഀ-ൿ]{0,3}ാട്?$/, 'Purappad', 'stage'],
  [/^തെയ്യം$/, 'Theyyam', 'stage'],
  [/^കോലം$/, 'Kolam', 'stage'],
];

/** Reference spellings of the built-in vocabulary, used to match OCR variants that sound the same. */
const CANONICAL_FORMS = [
  'ശ്രീ', 'വലിയ', 'പുതിയ', 'ദൈവം', 'ഗുളികൻ', 'വിഷകണ്ഠൻ', 'ഭഗവതി', 'എള്ളെടുത്ത്', 'തമ്പുരാട്ടി', 'മുത്തപ്പൻ',
  'തീച്ചാമുണ്ഡി', 'ചാമുണ്ഡി', 'രക്ത', 'വിഷ്ണുമൂർത്തി', 'പൊട്ടൻ', 'കുട്ടിച്ചാത്തൻ', 'ഭൈരവൻ', 'കതിവനൂർ', 'വീരൻ',
  'കണ്ടനാർ', 'കേളൻ', 'വയനാട്ടു', 'കുലവൻ', 'മുച്ചിലോട്ട്', 'അഗ്നി', 'കണ്ടാകർണൻ', 'പുലിയൂർ', 'കണ്ണൻ', 'തിരുവപ്പന',
  'വേട്ടയ്ക്കൊരുമകൻ', 'വെള്ളാട്ടം', 'തോറ്റം', 'തിറ', 'പുറപ്പാട്', 'തെയ്യം', 'കോലം',
];

/** Knowledge learned from reviewed work, active while one poster is parsed. */
let activeKnowledge: Knowledge | undefined;

function builtinToken(token: string): { english: string; kind: WordKind } | undefined {
  const entry = WORDS.find(([pattern]) => pattern.test(token));
  return entry ? { english: entry[1], kind: entry[2] } : undefined;
}

function translateToken(token: string): { english: string; kind: WordKind } | undefined {
  const builtin = builtinToken(token);
  if (builtin) return builtin;
  const learned = activeKnowledge?.words[token];
  if (learned) return { english: learned.english, kind: 'deity' };
  // An OCR variant that sounds exactly like one known word ("വിഷകുണ്ഠൻ" → Vishakandan).
  const shape = skeleton(token);
  if (shape.length < 4) return undefined;
  const options = new Map<string, { english: string; kind: WordKind }>();
  for (const form of CANONICAL_FORMS) {
    if (skeleton(form) === shape) { const known = builtinToken(form)!; options.set(known.english, known); }
  }
  for (const [word, entry] of Object.entries(activeKnowledge?.words || {})) {
    if (skeleton(word) === shape) options.set(entry.english, { english: entry.english, kind: 'deity' });
  }
  return options.size === 1 ? [...options.values()][0] : undefined;
}

/** A Theyyam name from approved schedules that sounds like the whole label. */
function knownTheyyamName(label: string): string {
  const shape = skeleton(romanize(label));
  if (shape.length < 5) return '';
  const names = Object.keys(activeKnowledge?.theyyams || {}).filter(name => skeleton(name) === shape);
  return names.length === 1 ? names[0] : '';
}

/**
 * Pairs the unknown Malayalam words of an OCR label with the reviewer's English
 * words, e.g. "കുറി ഗുളികൻ തെയ്യം" + "Kuri Gulikan Theyyam" → [["കുറി", "Kuri"]].
 * Pairs are kept only when the word counts line up and the spellings sound alike.
 */
export function wordPairs(sourceLabel: string, english: string): [string, string][] {
  const tokens = canonicalPerformanceLabel(normalizedText(sourceLabel)).split(' ').filter(Boolean);
  if (!tokens.length || tokens.some(token => !ML_LETTER.test(token))) return [];
  const remaining = english.replace(/&/g, ' ').split(/\s+/).filter(Boolean);
  const unknown: string[] = [];
  for (const token of tokens) {
    const known = builtinToken(token);
    if (!known) { unknown.push(token); continue; }
    const index = remaining.findIndex(word => word.toLowerCase() === known.english.toLowerCase());
    if (index >= 0) remaining.splice(index, 1);
  }
  if (!unknown.length || unknown.length !== remaining.length) return [];
  return unknown.map((token, index): [string, string] => [token, remaining[index]])
    .filter(([token, word]) => malayalamConsonants(token) >= 2 && /^[A-Za-z][A-Za-z'-]*$/.test(word)
      && (skeleton(token) === skeleton(word) || similar(token, word)));
}

/** English name for a fully recognized Malayalam label; otherwise empty so the reviewer sees the source text. */
export function englishPerformanceName(label: string): string {
  const tokens = canonicalPerformanceLabel(normalizedText(label)).split(' ').filter(Boolean);
  if (!tokens.length || !tokens.some(token => ML_LETTER.test(token))) return '';
  const words = tokens.map(translateToken);
  if (words.some(word => !word)) return knownTheyyamName(tokens.join(' '));
  let result = '';
  words.forEach((word, index) => {
    const previous = words[index - 1];
    result += !index ? word!.english : previous?.kind === 'stage' && word!.kind === 'stage' ? ` & ${word!.english}` : ` ${word!.english}`;
  });
  return result;
}

function deityWords(label: string): string[] {
  return canonicalPerformanceLabel(label).split(' ').map(translateToken)
    .filter(word => word?.kind === 'deity').map(word => word!.english);
}

// Temple rituals, offerings and meals are poster context, not Theyyam appearances.
const RITUAL = /കലശം|മുടിയിറ|ഹോമ|നിവേദ്യ|പൂജ|ബലി|അരിയിട|എതിരേൽക്ക|എഴുന്നള്ളി|ആറാടി|ളംകോലം|പ്രസാദ|അന്നദാനം|സദ്യ|ഉദ്ഘാടനം|ദീപാരാധന|മേലേരി|പുണ്യാഹം|തിരിച്ചുവര|അടിയന്തിര|മഹോത്സവം|വഴിപാട്|സമർപ്പണ|സമാപന|കമ്മിറ്റി|ക്ഷേത്ര/;
const PERFORMANCE = /വെള്ളാട്ടം|വെള്ളാ|തെയ്യം|തിരുവപ്പ|മുത്തപ്പ|ഗുളിക|ഗൂളിക|ഭഗവതി|ഭഥവ|ഭഗവത|ചാമുണ്ഡി|കേളൻ|കുലവൻ|വീരൻ|കണ്ണൻ|ഭൈരവൻ|വിഷ്ണുമൂർത്തി|കുട്ടിച്ചാത്തൻ|വിഷക[ുൂ]?ണ്ഠ|ലിഷക[ുൂ]?ണ്ഠ|ദൈവ|തിറ|തോറ്റ|താറ്റ|പുറപ്പാട|തമ്പുരാട്ടി|theyyam|gulikan|muthappan|bhagavathi|chamundi|vishnu|pottan|kelan|kulavan|veeran|kannan|bhairavan|vishakandan/i;

export function isLikelyPerformanceLabel(value: string): boolean {
  return PERFORMANCE.test(value) && !RITUAL.test(value);
}

// ---------------------------------------------------------------------------
// Venue and event

function isVenueLine(line: string) {
  return /\b(?:kavu|temple|tharavad|tharavadu|kshethram|kshetram|devasthanam|madappura)\b|കാവ്|ക്ഷേത്രം|ക്ഷേത്രത്തിൽ|തറവാട്|ദേവസ്ഥാനം|മടപ്പുര|കോട്ടം|പള്ളിയറ|കഴകം|സ്ഥാനം/i.test(line);
}

function cleanVenue(line: string): string {
  const malayalamVenue = line.match(/([ഀ-ൿ][ഀ-ൿ\s.]*?(?:ക്ഷേത്രത്തിൽ|ക്ഷേത്രം|കാവ്|തറവാട്|ദേവസ്ഥാനം|മടപ്പുര|കോട്ടം|പള്ളിയറ|കഴകം|സ്ഥാനം))/)?.[1];
  let cleaned = (malayalamVenue || line)
    .replace(/ക്ഷേത്രത്തിൽ$/, 'ക്ഷേത്രം')
    .replace(/^[\d\s:;|,./\-–—]+|[\s:;|,./\-–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop a broken one-letter OCR fragment left over from a wrapped heading.
  if (malayalamVenue) cleaned = cleaned.replace(/^[ഀ-ൿ]{1,2}\s+(?=\S)/, '');
  // Common OCR joins and dropped chillus from the reviewed Edacheri poster.
  if (/എടച്ചേരി.*മുത്തപ്പ.*ക്ഷേത്രം/.test(cleaned)) return 'എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം';
  return cleaned;
}

const EVENT = /മഹോത്സവം|ഉത്സവം|അടിയന്തിരം|festival|mahotsavam|mah[oോ]lsavam/i;

function eventTitle(lines: string[]): string {
  for (const line of lines) {
    if (line.length > 100 || !EVENT.test(line) || /^\s*NB\b/i.test(line)) continue;
    const malayalam = line.match(/(?:[ഀ-ൿ]+\s+)?(?:മഹോത്സവം|ഉത്സവം|അടിയന്തിരം)/);
    return malayalam ? malayalam[0].trim() : line;
  }
  return '';
}

type VenueGuess = { venue: string; explicit: boolean };

function inferredVenue(lines: string[]): VenueGuess {
  const explicit = lines.find(line => line.length <= 160 && isVenueLine(line) && !/കമ്മിറ്റി|ക്ഷേത്ര\s+(?:നട|കമ്മി)/.test(line));
  if (explicit) {
    const venue = cleanVenue(explicit);
    if (malayalamConsonants(venue) >= 4 || /[a-z]{4}/i.test(venue)) return { venue, explicit: true };
  }
  const dateIndex = lines.findIndex(line => Boolean(dateFields(line).dateKey || dateFields(line).malayalamMonth));
  const candidates = lines.map((line, index) => ({ line, index })).filter(({ line }) => {
    if (line.length < 3 || line.length > 130 || malayalamConsonants(line) < 5) return false;
    // OCR noise: Latin fragments, digits and time words never form a venue heading.
    if (/[A-Za-z0-9]|മണി/.test(line)) return false;
    // A time-of-day word ("വൈകുന്നേരം", "രാത്രി") is schedule text, not a place.
    if (new RegExp(`${MORNING}|${AFTERNOON}|${NIGHT}`).test(line)) return false;
    if (eventTitle([line]) || PERFORMANCE.test(line) || RITUAL.test(line)) return false;
    if (dateFields(line).dateKey || dateFields(line).malayalamMonth) return false;
    if (timeFields(line).timeCertainty !== 'unknown') return false;
    if (/പരിപാടി|സമയം|വിശദാംശ|ബന്ധപ്പെടുക|സ്വാഗതം|നോട്ടീസ്|ഭക്തജന/.test(line)) return false;
    return true;
  });
  if (!candidates.length) return { venue: '', explicit: false };
  candidates.sort((a, b) => {
    const aDistance = dateIndex >= 0 ? Math.abs(dateIndex - a.index) : a.index;
    const bDistance = dateIndex >= 0 ? Math.abs(dateIndex - b.index) : b.index;
    return aDistance - bDistance || a.index - b.index;
  });
  return { venue: cleanVenue(candidates[0].line), explicit: false };
}

// ---------------------------------------------------------------------------
// Public cleanup helpers (also used to repair saved rows)

export function cleanExtractedVenue(value: string): string {
  return isVenueLine(value) ? cleanVenue(normalizedText(value)) : value.trim();
}

export function cleanExtractedTheyyam(value: string): string {
  const canonical = canonicalPerformanceLabel(normalizedText(value));
  return /ഗുളിക|മുത്തപ്പ|പുതിയ\s*ഭഗവതി|തിരുവപ്പ/.test(canonical) ? canonical : value.trim();
}

/** Malayalam label for a timed schedule line, or '' when the line is not a Theyyam appearance. */
function scheduleLabel(line: string): string {
  const label = canonicalPerformanceLabel(line);
  if (malayalamConsonants(label) < 2) return '';
  if (isLikelyPerformanceLabel(label)) return label;
  // A name the reviewer has taught the app counts as a performance too.
  if (RITUAL.test(label)) return '';
  const learned = label.split(' ').some(token => activeKnowledge?.words[token]) || Boolean(knownTheyyamName(label));
  return learned ? label : '';
}

// ---------------------------------------------------------------------------
// Parsing

type Candidate = Partial<Row> & {
  /** Lines between the date heading and this row; lower is stronger evidence. */
  dateDistance: number;
  /** Start time is earlier than the previous item on the same date. */
  outOfOrder: boolean;
  region: number;
};
type EndNote = { deities: string[]; time: string };
type RegionResult = { rows: Candidate[]; notes: EndNote[]; venue: VenueGuess; event: string };

function namesOnLine(line: string) {
  const matches = NAMES.flatMap(([name, pattern]) => {
    pattern.lastIndex = 0;
    return Array.from(line.matchAll(pattern), match => ({ name, index: match.index!, length: match[0].length }));
  }).sort((a, b) => a.index - b.index);
  // Keep the longest name when patterns overlap ("ഗുളികൻ" inside "ഗുളികൻ വെള്ളാട്ടം").
  return matches.filter(match => !matches.some(other => other !== match && other.length > match.length
    && other.index <= match.index && other.index + other.length >= match.index + match.length));
}

function parseRegion(text: string, learned: LearnedCorrections, region: number): RegionResult {
  const lines = normalizedText(text).split('\n').map(line => line.trim()).filter(Boolean);
  const venueGuess = inferredVenue(lines);
  const sourceVenue = venueGuess.venue;
  const venue = resolveCorrection(learned, 'venue', sourceVenue) || sourceVenue;
  const event = eventTitle(lines);
  let dateContext: Partial<Row> = { malayalamMonth: '', malayalamDay: '', malayalamYear: '', dateKey: '' };
  let contextUsed = false;
  let dateLine = -1;
  let advanced = false;
  let lastMinutes: number | undefined;
  const pending: { timing: Partial<Row>; index: number }[] = [];
  const consumed = new Set<number>();
  const rows: Candidate[] = [];
  const notes: EndNote[] = [];
  const seen = new Set<string>();

  // A schedule runs morning → night. A morning time after a night item without
  // a new heading belongs to the next calendar day.
  const observeTime = (timing: Partial<Row>) => {
    const minutes = minutesOf(timing.start);
    if (minutes === undefined) return false;
    let outOfOrder = false;
    if (lastMinutes !== undefined && lastMinutes >= 18 * 60 && minutes < 12 * 60) {
      const following = dateContext.dateKey ? nextDay(dateContext.dateKey) : '';
      const converted = following ? gregorianToMalayalam(following) : null;
      dateContext = following
        ? { ...dateContext, dateKey: following, ...(converted || { malayalamDay: '' }) }
        : { ...dateContext, malayalamDay: '' };
      advanced = true;
    } else if (lastMinutes !== undefined && minutes < lastMinutes) {
      outOfOrder = true;
    }
    lastMinutes = minutes;
    return outOfOrder;
  };

  const addRow = (name: string, sourceLabel: string, timing: Partial<Row>, outOfOrder: boolean, lineIndex: number) => {
    const row: Candidate = {
      venue, sourceVenue, theyyam: name, sourceLabel, ...dateContext, ...timing,
      recurrence: 'none', recurrenceInterval: '', duration: '', performer: '',
      status: 'draft', description: event ? `Event: ${event}` : '', highlights: '',
      dateDistance: dateLine < 0 ? 999 : lineIndex - dateLine + (advanced ? 50 : 0),
      outOfOrder, region,
    };
    if (row.dateKey) row.recurrence = 'one_time';
    const key = [row.theyyam, row.dateKey, row.malayalamMonth, row.malayalamDay, row.malayalamYear, row.start, row.end].join('|');
    if (!seen.has(key)) { seen.add(key); rows.push(row); }
    contextUsed = true;
  };

  lines.forEach((line, lineIndex) => {
    const datePatch = dateFields(line);
    const malayalamKeys = ['malayalamMonth', 'malayalamDay', 'malayalamYear'] as const;
    const hasISO = datePatch.dateKey !== undefined;
    const hasMalayalam = malayalamKeys.some(key => datePatch[key] !== undefined);
    const isoChanged = hasISO && datePatch.dateKey !== dateContext.dateKey;
    const malayalamChanged = malayalamKeys.some(key => datePatch[key] !== undefined && datePatch[key] !== dateContext[key]);
    const replacesMalayalam = malayalamKeys.some(key => datePatch[key] !== undefined && Boolean(dateContext[key]) && datePatch[key] !== dateContext[key]);
    // Adjacent heading lines can describe one date in two calendars. Once a
    // schedule has consumed that date, a changed heading cannot prove the
    // corresponding date in the other calendar: never carry it forward.
    if (isoChanged && !hasMalayalam && (contextUsed || Boolean(dateContext.dateKey))) {
      dateContext = { ...dateContext, malayalamMonth: '', malayalamDay: '', malayalamYear: '' };
    }
    if (malayalamChanged && !hasISO && (contextUsed || replacesMalayalam)) {
      dateContext = { ...dateContext, dateKey: '' };
    }
    dateContext = { ...dateContext, ...datePatch };
    if (isoChanged || malayalamChanged) {
      contextUsed = false;
      dateLine = lineIndex;
      advanced = false;
      lastMinutes = undefined;
      pending.length = 0;
    }
    if (isVenueLine(line)) return;

    while (pending.length && lineIndex - pending[0].index > 4) pending.shift();
    const ownTiming = timeFields(line);
    const label = canonicalPerformanceLabel(line);
    const matchedNames = namesOnLine(line);

    // A time printed alone on its own OCR line is waiting for its label.
    if (ownTiming.timeCertainty !== 'unknown' && malayalamConsonants(label) < 2 && !matchedNames.length && !hasISO && !hasMalayalam) {
      if (!consumed.has(lineIndex)) {
        observeTime(ownTiming);
        pending.push({ timing: ownTiming, index: lineIndex });
      }
      return;
    }

    let timing = ownTiming;
    let outOfOrder = false;
    if (timing.timeCertainty === 'unknown' && malayalamConsonants(label) >= 3 && pending.length) {
      // Pair the run of label lines with the most recent times: when OCR loses
      // a label, its orphaned time is the oldest one waiting.
      let run = 0;
      for (let next = lineIndex; next < lines.length && run < pending.length; next++) {
        const candidate = lines[next];
        if (timeFields(candidate).timeCertainty !== 'unknown') break;
        if (malayalamConsonants(canonicalPerformanceLabel(candidate)) >= 3) run++;
      }
      while (pending.length > Math.max(1, run)) pending.shift();
      timing = pending.shift()!.timing;
      const minutes = minutesOf(timing.start);
      outOfOrder = minutes !== undefined && lastMinutes !== undefined && minutes < lastMinutes;
    } else if (timing.timeCertainty !== 'unknown') {
      outOfOrder = observeTime(timing);
    }
    const timed = timing.timeCertainty !== 'unknown';

    // "Mudiyirakkal" (removing the headdress) marks the end of a Theyyam.
    if (timed && /മുടിയിറ/.test(label)) {
      const deities = deityWords(label);
      if (deities.length) notes.push({ deities, time: timing.start! });
      return;
    }

    const generic = timed && ML_LETTER.test(label) ? scheduleLabel(line) : '';
    if (generic) {
      const name = resolveCorrection(learned, 'theyyam', generic) || englishPerformanceName(generic) || generic;
      addRow(name, generic, timing, outOfOrder, lineIndex);
      return;
    }
    if (RITUAL.test(label)) return;
    const names = matchedNames.map(match => ({
      name: resolveCorrection(learned, 'theyyam', match.name) || (ML_LETTER.test(match.name) ? englishPerformanceName(match.name) : '') || match.name,
      sourceLabel: match.name,
    }));
    names.forEach(name => {
      // Multiple names on one OCR line make time ownership ambiguous.
      let rowTiming = names.length > 1 ? timeFields('') : timing;
      const nextLine = lines[lineIndex + 1];
      if (rowTiming.timeCertainty === 'unknown' && names.length === 1 && nextLine && !namesOnLine(nextLine).length && nextLine.length <= 70 && isTimingLine(nextLine) && !dateFields(nextLine).malayalamMonth && !dateFields(nextLine).dateKey) {
        rowTiming = timeFields(nextLine);
        consumed.add(lineIndex + 1);
      }
      addRow(name.name, name.sourceLabel, rowTiming, false, lineIndex);
    });
  });
  return { rows, notes, venue: venueGuess, event };
}

const stripMeta = ({ dateDistance: _d, outOfOrder: _o, region: _r, ...row }: Candidate): Partial<Row> => row;

const isDated = (row: Partial<Row>) => Boolean(row.dateKey || row.malayalamDay);
const sameDate = (a: Partial<Row>, b: Partial<Row>) => (a.dateKey || '') === (b.dateKey || '')
  && (a.malayalamMonth || '') === (b.malayalamMonth || '') && (a.malayalamDay || '') === (b.malayalamDay || '');
const labelWords = (row: Partial<Row>) => new Set(canonicalPerformanceLabel(row.sourceLabel || row.theyyam || '').split(' ')
  .filter(word => malayalamConsonants(word) >= 3 && translateToken(word)?.kind !== 'stage'));
const fullyTranslated = (row: Partial<Row>) => Boolean(row.sourceLabel && englishPerformanceName(row.sourceLabel));

/**
 * One poster is OCR'd as a full image plus overlapping tiles. Each tile sees a
 * different part of the layout, so the same performance can appear several
 * times with different OCR mistakes. Merge them using the strongest evidence.
 */
function mergeOverlappingRegions(results: RegionResult[], learned: LearnedCorrections): Candidate[] {
  // One venue for the whole poster: explicit venue wording beats a nearby heading.
  const guesses = results.map(result => result.venue).filter(guess => guess.venue);
  const best = guesses.find(guess => guess.explicit) || guesses[0];
  const sourceVenue = best?.venue || '';
  const venue = resolveCorrection(learned, 'venue', sourceVenue) || sourceVenue;
  const event = results.map(result => result.event).find(Boolean) || '';
  const rows = results.flatMap(result => result.rows).map(row => ({
    ...row, venue, sourceVenue, description: event ? `Event: ${event}` : row.description,
  }));

  const better = (a: Candidate, b: Candidate) => {
    if (isDated(a) !== isDated(b)) return isDated(a) ? a : b;
    if (a.outOfOrder !== b.outOfOrder) return a.outOfOrder ? b : a;
    if (fullyTranslated(a) !== fullyTranslated(b)) return fullyTranslated(a) ? a : b;
    if (a.dateDistance !== b.dateDistance) return a.dateDistance < b.dateDistance ? a : b;
    return a.region <= b.region ? a : b;
  };
  const twins = (a: Candidate, b: Candidate) => {
    if (a.region === b.region) return false;
    const sameName = a.theyyam === b.theyyam;
    const aWords = labelWords(a), bWords = labelWords(b);
    const sharedWord = [...aWords].some(word => bWords.has(word));
    // Same performance seen by two tiles, possibly with a misread name or date.
    if ((sameName || sharedWord) && Boolean(a.start) && a.start === b.start) {
      return !isDated(a) || !isDated(b) || sameDate(a, b) || a.dateDistance !== b.dateDistance;
    }
    // Same name and date, but OCR dropped a digit from one time ("11" → "1").
    return sameName && isDated(a) && sameDate(a, b) && (a.outOfOrder || b.outOfOrder);
  };
  const kept: Candidate[] = [];
  for (const row of rows) {
    const index = kept.findIndex(other => twins(other, row));
    if (index < 0) kept.push(row);
    else kept[index] = better(kept[index], row);
  }
  return kept;
}

/**
 * OCR sometimes keeps only the end of a decorative word ("കൻ തിറ" for
 * "ഗുളികൻ തിറ"). When exactly one deity named elsewhere on the same poster
 * ends with that fragment, complete it; otherwise leave it for review.
 */
function completeTruncatedNames(rows: Candidate[], learned: LearnedCorrections) {
  const deities = new Set(rows.flatMap(row => canonicalPerformanceLabel(row.sourceLabel || '').split(' '))
    .filter(word => translateToken(word)?.kind === 'deity'));
  for (const row of rows) {
    if (!row.sourceLabel || englishPerformanceName(row.sourceLabel) || row.theyyam !== row.sourceLabel) continue;
    const tokens = row.sourceLabel.split(' ');
    let changed = false;
    const completed = tokens.map(token => {
      if (translateToken(token) || malayalamConsonants(token) > 3 || malayalamConsonants(token) < 1 || token.length < 2) return token;
      const matches = [...deities].filter(deity => deity !== token && deity.endsWith(token));
      if (matches.length !== 1) return token;
      changed = true;
      return matches[0];
    });
    if (!changed) continue;
    const label = completed.join(' ');
    const english = englishPerformanceName(label);
    if (!english) continue;
    // Keep the OCR text as the learning key so a reviewer's later fix still applies.
    row.theyyam = resolveCorrection(learned, 'theyyam', row.sourceLabel) || english;
  }
}

function applyEndNotes(rows: Candidate[], notes: EndNote[]) {
  const chronological = (row: Partial<Row>) => `${row.dateKey || '0000-00-00'} ${row.start || '00:00'}`;
  for (const note of notes) {
    const matches = rows.filter(row => note.deities.some(deity => row.theyyam?.includes(deity)));
    if (!matches.length) continue;
    const last = matches.reduce((a, b) => chronological(b) > chronological(a) ? b : a);
    const text = `Mudiyirakkal at ${note.time} (end of the Theyyam)`;
    if (last.description?.includes(text)) continue;
    last.description = last.description ? `${last.description}; ${text}` : text;
  }
}

function sortChronologically(rows: Candidate[]) {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const aKey = `${a.row.dateKey || '9999-99-99'} ${a.row.start || '99:99'}`;
    const bKey = `${b.row.dateKey || '9999-99-99'} ${b.row.start || '99:99'}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : a.index - b.index;
  }).map(({ row }) => row);
}

/**
 * Parses OCR text from one poster. Pass the full-image text first and its
 * overlapping tiles after it; set `overlapping` to false for separate PDF pages.
 */
export function parsePosterRegions(texts: string[], learned: LearnedCorrections = {}, overlapping = true, knowledge?: Knowledge): Partial<Row>[] {
  const previous = activeKnowledge;
  activeKnowledge = knowledge;
  try { return parseWithKnowledge(texts, learned, overlapping); }
  finally { activeKnowledge = previous; }
}

function parseWithKnowledge(texts: string[], learned: LearnedCorrections, overlapping: boolean): Partial<Row>[] {
  const results = texts.map((text, region) => parseRegion(text, learned, region));
  if (overlapping && results.length > 1) {
    const rows = sortChronologically(mergeOverlappingRegions(results, learned));
    completeTruncatedNames(rows, learned);
    applyEndNotes(rows, results.flatMap(result => result.notes));
    return rows.map(stripMeta);
  }
  const rows: Candidate[] = [];
  const exact = new Set<string>();
  results.forEach(result => {
    completeTruncatedNames(result.rows, learned);
    applyEndNotes(result.rows, result.notes);
    for (const row of result.rows) {
      const key = [row.venue, row.theyyam, row.malayalamMonth, row.malayalamDay, row.malayalamYear, row.dateKey, row.start, row.end].join('|');
      if (!exact.has(key)) { exact.add(key); rows.push(row); }
    }
  });
  return rows.map(stripMeta);
}

export function parsePosterText(text: string, learned: LearnedCorrections = {}, knowledge?: Knowledge): Partial<Row>[] {
  return parsePosterRegions([text], learned, false, knowledge);
}
