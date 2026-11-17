import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildVenueWorkbook, emptyVenue, guessVillage, inferVenueType, suggestVenue, validateVenue, validateVenues, VENUE_FIELDS, VENUE_INSTRUCTIONS } from './venues';

test('drafts a venue row from the poster venue', () => {
  const venue = suggestVenue('Kolachery Sree Chathampalli Vishakandan Temple', 'വിഷകണ്ഠൻ ക്ഷേത്രം');
  assert.equal(venue.nameEn, 'Kolachery Sree Chathampalli Vishakandan Temple');
  assert.equal(venue.venueType, 'temple');
  assert.equal(venue.village, 'Kolachery');
  assert.equal(venue.status, 'active');
  assert.equal(venue.district, '');
  const malayalam = suggestVenue('വിഷകണ്ഠൻ ക്ഷേത്രം');
  assert.deepEqual([malayalam.nameEn, malayalam.nameMl, malayalam.venueType], ['', 'വിഷകണ്ഠൻ ക്ഷേത്രം', 'temple']);
  // Remembered details from an earlier export pre-fill the row.
  assert.equal(suggestVenue('Kolachery Sree Chathampalli Vishakandan Temple', '', { district: 'Kannur' }).district, 'Kannur');
  assert.equal(inferVenueType('Muchilottu Kavu'), 'kavu');
  assert.equal(inferVenueType('Perumthitta Tharavad'), 'tharavadu');
  assert.equal(guessVillage('Muchilottu Kavu'), '');
});

test('applies the template instructions', () => {
  const valid = { ...emptyVenue(), nameEn: 'A Temple', village: 'Payyanur', district: 'Kannur', status: 'active', venueType: 'temple' };
  assert.deepEqual(validateVenue(valid), {});
  assert.deepEqual(Object.keys(validateVenue(emptyVenue())).sort(), ['district', 'nameEn', 'village']);
  assert.deepEqual(validateVenue({ ...valid, district: '', districtId: '12' }), {});
  assert.ok(validateVenue({ ...valid, districtId: 'twelve' }).districtId);
  assert.ok(validateVenue({ ...valid, venueType: 'church' }).venueType);
  assert.ok(validateVenue({ ...valid, status: 'draft' }).status);
  assert.ok(validateVenue({ ...valid, latitude: '91', longitude: '75' }).latitude);
  assert.ok(validateVenue({ ...valid, latitude: '12.1' }).longitude);
  assert.ok(validateVenue({ ...valid, mapsLink: 'maps.google.com' }).mapsLink);
  assert.ok(validateVenue({ ...valid, images: Array(9).fill('https://x.example/a.jpg').join('|') }).images);
  assert.deepEqual(validateVenue({ ...valid, images: 'https://x.example/a.jpg | https://x.example/b.jpg' }), {});
  assert.equal(validateVenues([valid, { ...valid }]).at(-1)?.message, 'Duplicate of venue row 1.');
});

test('writes the template layout with typed cells and the Instructions sheet', () => {
  const workbook = buildVenueWorkbook([
    { ...emptyVenue(), nameEn: 'Kolachery Sree Chathampalli Vishakandan Temple', nameMl: 'കൊളച്ചേരി ശ്രീ ചാത്തമ്പള്ളി വിഷകണ്ഠൻ ക്ഷേത്രം', venueType: 'temple', district: 'Kannur', village: 'Kolachery', latitude: '11.98', longitude: '75.42', status: 'active' },
    { ...emptyVenue(), nameEn: '=HYPERLINK("x")', village: 'X', district: 'Kannur' },
  ]);
  const copy = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  assert.deepEqual(copy.SheetNames, ['Venues', 'Instructions']);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(copy.Sheets.Venues, { header: 1, defval: '' });
  assert.deepEqual(rows[0], [...VENUE_FIELDS]);
  assert.equal(rows.length, 3);
  assert.equal(copy.Sheets.Venues.J2.t, 'n');
  assert.equal(copy.Sheets.Venues.J2.v, 11.98);
  assert.equal(copy.Sheets.Venues.B2.v, 'കൊളച്ചേരി ശ്രീ ചാത്തമ്പള്ളി വിഷകണ്ഠൻ ക്ഷേത്രം');
  assert.equal(copy.Sheets.Venues.A3.t, 's');
  assert.equal(copy.Sheets.Venues.A3.f, undefined);
  assert.equal(copy.Sheets.Venues.J3, undefined);
  assert.deepEqual(XLSX.utils.sheet_to_json(copy.Sheets.Instructions, { header: 1 }), VENUE_INSTRUCTIONS);
});
