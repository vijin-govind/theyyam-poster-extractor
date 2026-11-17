import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGuidedPosterInput } from './guided';

test('turns labelled reviewer text into draft rows with calendar conversion', () => {
  const rows = parseGuidedPosterInput([
    'Venue: എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം',
    'Date: 2025 November 8',
    'Theyyam: കുറി ഗുളികൻ തെയ്യം',
    'Time: 6:30 PM',
    'Theyyam: എടലപ്പുറത്ത് ചാമുണ്ഡി തെയ്യം',
    'Time: 7:30 PM',
  ].join('\n'));

  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.venue === 'എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം'));
  assert.ok(rows.every(row => row.dateKey === '2025-11-08'));
  assert.ok(rows.every(row => row.malayalamMonth === 'thulam' && row.malayalamDay === '22' && row.malayalamYear === '1201'));
  assert.deepEqual(rows.map(row => row.start), ['18:30', '19:30']);
  assert.deepEqual(rows.map(row => row.theyyam), ['കുറി ഗുളികൻ തെയ്യം', 'എടലപ്പുറത്ത് ചാമുണ്ഡി തെയ്യം']);
  assert.ok(rows.every(row => row.status === 'draft'));
});

test('accepts a one-line English voice transcript and preserves an unfamiliar name', () => {
  const rows = parseGuidedPosterInput('Venue is North Kavu Date is 2026 February 26 Theyyam is Example Kolam Time is 4:30 AM');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].venue, 'North Kavu');
  assert.equal(rows[0].theyyam, 'Example Kolam');
  assert.equal(rows[0].dateKey, '2026-02-26');
  assert.equal(rows[0].start, '04:30');
});

test('returns no row for empty or non-labelled unrecognized text', () => {
  assert.deepEqual(parseGuidedPosterInput(''), []);
  assert.deepEqual(parseGuidedPosterInput('This poster is difficult to read'), []);
});
