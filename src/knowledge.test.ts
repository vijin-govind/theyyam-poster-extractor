import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearKnowledge, confidentVenue, importVenues, knowledgeCounts, learnWords, loadKnowledge, matchKnownVenues, recordApprovedRows } from './knowledge';
import { parsePosterRegions, parsePosterText, wordPairs } from './parser';
import { learnCorrection, loadLearnedCorrections, resolveCorrection, clearLearnedCorrections } from './learning';
import { venueQuery } from './venueSearch';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });

test('pairs only the unknown words of a corrected label, and only when they sound alike', () => {
  assert.deepEqual(wordPairs('കുറി ഗുളിക തെയ്യം', 'Kuri Gulikan Theyyam'), [['കുറി', 'Kuri']]);
  // "കൻ" is an OCR fragment of Gulikan: it does not sound like the reviewed word.
  assert.deepEqual(wordPairs('കൻ തിറ', 'Gulikan Thira'), []);
  // Word counts that do not line up are not guessed.
  assert.deepEqual(wordPairs('എടലപ്പുറത്ത് ചാമുണ്ഡി തെയ്യം', 'Chamundi Theyyam'), []);
});

test('a learned word translates new labels on other posters', () => {
  clearKnowledge();
  const before = parsePosterText('2026-10-26\nരാത്രി 9 മണിക്ക് : കുറി ഗുളികൻ തെയ്യം', {}, loadKnowledge());
  assert.equal(before[0].theyyam, 'കുറി ഗുളികൻ തെയ്യം');
  assert.equal(learnWords(wordPairs('കുറി ഗുളികൻ തെയ്യം', 'Kuri Gulikan Theyyam')), 1);
  const after = parsePosterText('2026-11-02\nരാത്രി 8 മണിക്ക് : കുറി ഗുളികൻ വെള്ളാട്ടം', {}, loadKnowledge());
  assert.equal(after[0].theyyam, 'Kuri Gulikan Vellattam');
  // A word that is not a known performance becomes one once it has been taught.
  learnWords([['കണ്ടപ്പൻ', 'Kandappan']]);
  const taught = parsePosterText('2026-11-02\nരാത്രി 8 മണിക്ക് : കണ്ടപ്പൻ', {}, loadKnowledge());
  assert.equal(taught[0]?.theyyam, 'Kandappan');
});

test('reuses a correction when OCR spells the same source slightly differently', () => {
  clearLearnedCorrections();
  learnCorrection('venue', 'വിഷകണ്ഠൻ ക്ഷേത്രം', 'Kolachery Sree Chathampalli Vishakandan Temple');
  const learned = loadLearnedCorrections();
  assert.equal(resolveCorrection(learned, 'venue', 'വിഷകുണ്ഠൻ ക്ഷേത്രം'), 'Kolachery Sree Chathampalli Vishakandan Temple');
  assert.equal(resolveCorrection(learned, 'venue', 'മുത്തപ്പൻ ക്ഷേത്രം'), '');
});

test('exported schedules teach venues, aliases and Theyyam names; samples are not needed', () => {
  clearKnowledge();
  const counts = recordApprovedRows([
    { venue: 'Kolachery Sree Chathampalli Vishakandan Temple', theyyam: 'Gulikan Thira', sourceVenue: 'വിഷകണ്ഠൻ ക്ഷേത്രം', sourceLabel: 'കൻ തിറ' },
    { venue: 'Kolachery Sree Chathampalli Vishakandan Temple', theyyam: 'Kuri Gulikan Theyyam', sourceLabel: 'കുറി ഗുളികൻ തെയ്യം' },
  ], wordPairs);
  assert.deepEqual(counts, { words: 1, venues: 1, theyyams: 2 });
  assert.deepEqual(loadKnowledge().venues['Kolachery Sree Chathampalli Vishakandan Temple'].aliases, ['വിഷകണ്ഠൻ ക്ഷേത്രം']);
});

test('matches a new poster’s partial venue against approved and imported venues', () => {
  clearKnowledge();
  assert.equal(importVenues(['Kolachery Sree Chathampalli Vishakandan Temple', 'Karimbam Vishakandan Temple', 'Muchilottu Kavu']), 3);
  const raw = readFileSync(new URL('./fixtures/kolacheri-puthari-ocr.txt', import.meta.url), 'utf8');
  const matches = matchKnownVenues('വിഷകണ്ഠൻ ക്ഷേത്രം', venueQuery(raw, 'വിഷകണ്ഠൻ ക്ഷേത്രം').hints);
  assert.equal(matches[0].name, 'Kolachery Sree Chathampalli Vishakandan Temple');
  assert.equal(confidentVenue(matches), 'Kolachery Sree Chathampalli Vishakandan Temple');
  // Only the deity word: two temples fit equally, so nothing is filled automatically.
  assert.equal(confidentVenue(matchKnownVenues('വിഷകണ്ഠൻ ക്ഷേത്രം', [])), '');
});

test('recognizes an approved Theyyam name and still parses the reviewed poster', () => {
  clearKnowledge();
  recordApprovedRows([{ venue: 'X Kavu', theyyam: 'Kathivanoor Veeran' }], wordPairs);
  const [row] = parsePosterText('2026-10-26\nരാത്രി 9 മണിക്ക് : കതിവനൂർ വീരൻ', {}, loadKnowledge());
  assert.equal(row.theyyam, 'Kathivanoor Veeran');
  const raw = readFileSync(new URL('./fixtures/kolacheri-puthari-ocr.txt', import.meta.url), 'utf8');
  assert.equal(parsePosterRegions(raw.split(/--- OCR region \d+ ---\s*/).filter(Boolean), {}, true, loadKnowledge()).length, 6);
  assert.equal(knowledgeCounts().theyyams, 1);
});
