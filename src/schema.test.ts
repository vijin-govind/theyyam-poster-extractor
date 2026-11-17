import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildWorkbook, createInitialBatch, emptyRow, fields, MONTHS, validateRow, validateRows } from './schema';

function validRow() {
  return emptyRow('poster-test', {
    venue: 'Muchilottu Kavu', theyyam: 'Muchilottu Bhagavathi',
    malayalamMonth: 'meenam', malayalamDay: '20', malayalamYear: '1201',
    dateKey: '2026-04-03', start: '04:30', timeCertainty: 'exact', recurrence: 'annual', status: 'draft',
  });
}

test('sample batch contains 36 rows linked to 3 posters and exactly one missing required field', () => {
  const { posters, rows } = createInitialBatch();
  assert.equal(posters.length, 3);
  assert.equal(rows.length, 36);
  posters.forEach((poster) => assert.equal(rows.filter((row) => row.posterId === poster.id).length, 12));
  assert.deepEqual(validateRows(rows), [{ rowId: 'sample-18', field: 'theyyam', message: 'theyyam is required.' }]);
});

test('all exact enum values are accepted and unknown values are rejected', () => {
  MONTHS.forEach((month) => assert.equal(validateRow({ ...validRow(), malayalamMonth: month }).malayalamMonth, undefined));
  for (const field of ['malayalamMonth', 'timeCertainty', 'recurrence', 'status'] as const) {
    assert.ok(validateRow({ ...validRow(), [field]: 'invalid' })[field]);
  }
});

test('numeric fields reject fractions, exponents, bounds errors, and malformed years', () => {
  for (const day of ['0', '33', '1.5', '1e1', '-2']) assert.ok(validateRow({ ...validRow(), malayalamDay: day }).malayalamDay);
  for (const day of ['1', '32']) assert.equal(validateRow({ ...validRow(), malayalamDay: day }).malayalamDay, undefined);
  for (const year of ['120', '12010', '1201.0', '1e03']) assert.ok(validateRow({ ...validRow(), malayalamYear: year }).malayalamYear);
  assert.ok(validateRow({ ...validRow(), recurrence: 'n_yearly', recurrenceInterval: '' }).recurrenceInterval);
  for (const interval of ['1', '25', '2.5']) assert.ok(validateRow({ ...validRow(), recurrence: 'n_yearly', recurrenceInterval: interval }).recurrenceInterval);
  assert.deepEqual(validateRow({ ...validRow(), recurrence: 'n_yearly', recurrenceInterval: '24' }), {});
});

test('date validation checks real calendar dates including leap years', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '26-02-01', '2026-2-01']) {
    assert.ok(validateRow({ ...validRow(), dateKey: date }).dateKey, date);
  }
  for (const date of ['', '2024-02-29', '2026-12-31']) assert.equal(validateRow({ ...validRow(), dateKey: date }).dateKey, undefined);
});

test('conditional times are required; strict 24-hour values and overnight ranges are supported', () => {
  for (const certainty of ['exact', 'approximate', 'range']) assert.ok(validateRow({ ...validRow(), timeCertainty: certainty, start: '' }).start);
  assert.ok(validateRow({ ...validRow(), timeCertainty: 'range', end: '' }).end);
  assert.deepEqual(validateRow({ ...validRow(), timeCertainty: 'unknown', start: '', end: '' }), {});
  assert.deepEqual(validateRow({ ...validRow(), timeCertainty: 'range', start: '23:30', end: '01:30' }), {});
  for (const time of ['24:00', '12:60', '4:30', '04:30 AM', '04:30:00']) assert.ok(validateRow({ ...validRow(), start: time }).start);
});

test('Excel roundtrip preserves exact schema, numeric cells, optional blanks, and text without formulas', () => {
  const row = { ...validRow(), venue: '=HYPERLINK("https://example.invalid","text")', theyyam: 'മുച്ചിലോട്ട് ഭഗവതി', highlights: 'fire|ritual', description: '+SUM(1,2)' };
  const bytes = XLSX.write(buildWorkbook([row]), { type: 'buffer', bookType: 'xlsx' });
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Schedule']);
  const sheet = workbook.Sheets.Schedule;
  const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' });
  assert.deepEqual(data[0], [...fields]);
  assert.equal(data[0].length, 16);
  assert.equal(data[1][0], row.venue);
  assert.equal(data[1][1], row.theyyam);
  assert.equal(data[1][3], 20);
  assert.equal(data[1][4], 1201);
  assert.equal(data[1][10], '');
  assert.equal(data[1][15], 'fire|ritual');
  assert.equal(sheet.A2.t, 's');
  assert.equal(sheet.A2.f, undefined);
  assert.equal(sheet.O2.t, 's');
  assert.equal(sheet.O2.f, undefined);
  assert.equal(data[0].map(String).includes('posterId'), false);
  assert.equal(data[0].map(String).includes('id'), false);
});

test('an empty workbook retains the 16-column import header', () => {
  const workbook = buildWorkbook([]);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets.Schedule, { header: 1 })[0], [...fields]);
});
