import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLearnedCorrections,
  fieldCorrectionKey,
  learnCorrection,
  learnedCorrectionCount,
  loadLearnedCorrections,
  resolveCorrection,
} from './learning';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

test('learns exact venue and Theyyam corrections without crossing fields', () => {
  clearLearnedCorrections();
  assert.equal(learnCorrection('venue', 'എടച്ചേരി മുത്തപ്പ ക്ഷേത്രം', 'എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം'), true);
  assert.equal(learnCorrection('theyyam', 'ഗുളിക വെള്ളാടം', 'ഗുളികൻ വെള്ളാട്ടം'), true);

  const learned = loadLearnedCorrections();
  assert.equal(resolveCorrection(learned, 'venue', 'എടച്ചേരി മുത്തപ്പ ക്ഷേത്രം'), 'എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം');
  assert.equal(resolveCorrection(learned, 'theyyam', 'ഗുളിക വെള്ളാടം'), 'ഗുളികൻ വെള്ളാട്ടം');
  assert.equal(resolveCorrection(learned, 'venue', 'ഗുളിക വെള്ളാടം'), '');
  assert.equal(learnedCorrectionCount(), 2);
});

test('reconfirmation raises confidence and a conflicting review replaces the value', () => {
  clearLearnedCorrections();
  learnCorrection('theyyam', 'കുറി ഗുളിക തെയ്യം', 'കുറി ഗുളികൻ തെയ്യം');
  learnCorrection('theyyam', 'കുറി ഗുളിക തെയ്യം', 'കുറി ഗുളികൻ തെയ്യം');
  let learned = loadLearnedCorrections();
  assert.equal(learned[fieldCorrectionKey('theyyam', 'കുറി ഗുളിക തെയ്യം')].confirmations, 2);

  learnCorrection('theyyam', 'കുറി ഗുളിക തെയ്യം', 'കുറി ഗുളികൻ വെള്ളാട്ടം');
  learned = loadLearnedCorrections();
  assert.equal(learned[fieldCorrectionKey('theyyam', 'കുറി ഗുളിക തെയ്യം')].confirmations, 1);
  assert.equal(resolveCorrection(learned, 'theyyam', 'കുറി ഗുളിക തെയ്യം'), 'കുറി ഗുളികൻ വെള്ളാട്ടം');
});

test('does not learn unchanged or blank values and can be reset', () => {
  clearLearnedCorrections();
  assert.equal(learnCorrection('venue', 'Same Venue', ' same venue '), false);
  assert.equal(learnCorrection('theyyam', 'OCR name', ''), false);
  assert.equal(learnedCorrectionCount(), 0);
  assert.equal(clearLearnedCorrections(), true);
});

test('ignores OCR fragments and time lines as correction sources', () => {
  clearLearnedCorrections();
  assert.equal(learnCorrection('venue', 'ത്ത', 'Kolacheri Temple'), false);
  assert.equal(learnCorrection('venue', 'anflees 10 മണിക്ക്', 'Kolacheri Temple'), false);
  assert.equal(learnedCorrectionCount(), 0);
  // Mappings saved by earlier versions are no longer applied.
  const legacy = { 'venue:ത്ത': { value: 'Kolacheri Temple', confirmations: 1, updatedAt: 1 } };
  assert.equal(resolveCorrection(legacy, 'venue', 'ത്ത'), '');
});
