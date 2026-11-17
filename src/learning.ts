import { skeleton } from './phonetic';

export type LearnedCorrection = {
  value: string;
  confirmations: number;
  updatedAt: number;
};

export type LearnedCorrections = Record<string, LearnedCorrection>;
export type LearnableField = 'venue' | 'theyyam';

const STORAGE_KEY = 'theyyam-extractor-learned-corrections-v1';
const MAX_CORRECTIONS = 500;

export function correctionKey(value: string): string {
  return value.normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u200b\ufeff]/g, '')
    .replace(/[“”"'`´:;,.|/\\()[\]{}\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A correction is only safe to reuse when its OCR source is specific text, not
 * a fragment such as "ത്ത" or a time line that could appear on any poster.
 */
export function isLearnableSource(field: LearnableField, value: string): boolean {
  const key = correctionKey(value);
  const letters = (key.match(/[\u0D15-\u0D39\u0D7A-\u0D7Fa-z]/g) || []).length;
  if (letters < 4) return false;
  if (field === 'venue' && (/\d|മണി/.test(key))) return false;
  return true;
}

export function fieldCorrectionKey(field: LearnableField, value: string): string {
  return `${field}:${correctionKey(value)}`;
}

export function loadLearnedCorrections(): LearnedCorrections {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as LearnedCorrections;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Reads an exact, field-scoped correction. Legacy Theyyam corrections remain supported. */
export function resolveCorrection(
  corrections: LearnedCorrections,
  field: LearnableField,
  sourceValue: string,
): string {
  if (!isLearnableSource(field, sourceValue)) return '';
  const scoped = corrections[fieldCorrectionKey(field, sourceValue)]?.value;
  const legacy = field === 'theyyam' ? corrections[correctionKey(sourceValue)]?.value : undefined;
  if (scoped || legacy) return (scoped || legacy || '').trim();
  // OCR rarely reads a poster identically twice. Reuse a correction whose source
  // sounds the same ("വിഷകുണ്ഠൻ ക്ഷേത്രം" ≈ "വിഷകണ്ഠൻ ക്ഷേത്രം") when exactly one does.
  const shape = skeleton(correctionKey(sourceValue));
  if (shape.length < 6) return '';
  const prefix = `${field}:`;
  const values = new Set(Object.entries(corrections)
    .filter(([key]) => key.startsWith(prefix) && isLearnableSource(field, key.slice(prefix.length)) && skeleton(key.slice(prefix.length)) === shape)
    .map(([, entry]) => entry.value.trim()));
  return values.size === 1 ? [...values][0] : '';
}

/**
 * Learns only an explicit human correction. It never guesses from an upload,
 * and it stays in this browser so one reviewer cannot silently change another's data.
 */
export function learnCorrection(field: LearnableField, sourceLabel: string, reviewedValue: string): boolean {
  const key = fieldCorrectionKey(field, sourceLabel);
  const value = reviewedValue.trim();
  if (!isLearnableSource(field, sourceLabel) || !value || correctionKey(value) === correctionKey(sourceLabel)) return false;
  try {
    const corrections = loadLearnedCorrections();
    const previous = corrections[key];
    corrections[key] = {
      value,
      confirmations: previous?.value === value ? previous.confirmations + 1 : 1,
      updatedAt: Date.now(),
    };
    const limited = Object.fromEntries(
      Object.entries(corrections)
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, MAX_CORRECTIONS),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
    return true;
  } catch {
    return false;
  }
}

export function learnedCorrectionCount(): number {
  return Object.keys(loadLearnedCorrections()).length;
}

export function clearLearnedCorrections(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
