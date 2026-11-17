import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGregorianDateSelection, gregorianToMalayalam } from './calendar';
import { emptyRow } from './schema';

test('converts the reported November 2025 date to Kollavarsham', () => {
  assert.deepEqual(gregorianToMalayalam('2025-11-08'), {
    malayalamMonth: 'thulam',
    malayalamDay: '22',
    malayalamYear: '1201',
  });
});

test('converts another known Gregorian date and rejects invalid dates', () => {
  assert.deepEqual(gregorianToMalayalam('2026-02-26'), {
    malayalamMonth: 'kumbham',
    malayalamDay: '14',
    malayalamYear: '1201',
  });
  assert.equal(gregorianToMalayalam('2026-02-30'), null);
  assert.equal(gregorianToMalayalam('not-a-date'), null);
});

test('synchronizes Malayalam fields when a Gregorian grid date is selected', () => {
  const row = emptyRow('poster-1', {
    malayalamMonth: 'meenam', malayalamDay: '1', malayalamYear: '1200', recurrence: 'none',
  });
  const updated = applyGregorianDateSelection(row, '2025-11-08');
  assert.equal(updated.dateKey, '2025-11-08');
  assert.equal(updated.malayalamMonth, 'thulam');
  assert.equal(updated.malayalamDay, '22');
  assert.equal(updated.malayalamYear, '1201');
  assert.equal(updated.recurrence, 'one_time');
});

test('preserves annual recurrence and does not erase Malayalam fields for an invalid date', () => {
  const row = emptyRow('poster-1', {
    malayalamMonth: 'kumbham', malayalamDay: '14', malayalamYear: '1201', recurrence: 'annual',
  });
  const annual = applyGregorianDateSelection(row, '2026-02-26');
  assert.equal(annual.recurrence, 'annual');
  const invalid = applyGregorianDateSelection(row, '');
  assert.equal(invalid.dateKey, '');
  assert.equal(invalid.malayalamMonth, 'kumbham');
  assert.equal(invalid.malayalamDay, '14');
  assert.equal(invalid.malayalamYear, '1201');
});
