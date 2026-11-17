import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanExtractedTheyyam, cleanExtractedVenue, englishPerformanceName, isLikelyPerformanceLabel, parsePosterRegions, parsePosterText } from './parser';

test('extracts explicit English schedule context and times', () => {
  const rows = parsePosterText('Kavumbhagom Kavu\nKumbham 14, 1201\n2026-02-26\nVishnumoorthi - 4:30 AM\nGulikan Theyyam - 14:00 to 15:30');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].venue, 'Kavumbhagom Kavu');
  assert.equal(rows[0].malayalamMonth, 'kumbham');
  assert.equal(rows[0].malayalamDay, '14');
  assert.equal(rows[0].malayalamYear, '1201');
  assert.equal(rows[0].dateKey, '2026-02-26');
  assert.equal(rows[0].start, '04:30');
  assert.equal(rows[0].timeCertainty, 'exact');
  assert.equal(rows[1].end, '15:30');
  assert.equal(rows[1].timeCertainty, 'range');
});

test('extracts Malayalam names, dates and digit forms', () => {
  const rows = parsePosterText('ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം\nകുംഭം ൧൪ ൧൨൦൧\nവിഷ്ണുമൂർത്തി 04:30');
  assert.equal(rows.length, 1);
  const performance = rows[0];
  assert.equal(performance.venue, 'ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം');
  assert.equal(performance.theyyam, 'Vishnumoorthi');
  assert.equal(performance.sourceLabel, 'വിഷ്ണുമൂർത്തി');
  assert.equal(performance.malayalamDay, '14');
  assert.equal(performance.malayalamYear, '1201');
  assert.equal(performance.start, '04:30');
});

test('keeps missing and ambiguous facts empty', () => {
  const [row] = parsePosterText('Festival 2026\nMuthappan\n100 attendees');
  assert.equal(row.malayalamYear, '');
  assert.equal(row.malayalamMonth, '');
  assert.equal(row.start, '');
  assert.equal(row.timeCertainty, 'unknown');
  assert.equal(row.status, 'draft');
  assert.equal(row.recurrence, 'none');
});

test('handles midday, midnight, approximate timing and next-line times', () => {
  const rows = parsePosterText('Gulikan\n12 AM\nPottan Theyyam around 12 PM\nTheechamundi 6:20 PM');
  assert.deepEqual(rows.map(row => row.start), ['00:00', '12:00', '18:20']);
  assert.equal(rows[1].timeCertainty, 'approximate');
});

test('does not invent candidates, duplicate OCR rows, or borrow next performance time', () => {
  assert.deepEqual(parsePosterText('Cultural festival\nGrand opening 18:00'), []);
  const rows = parsePosterText('Gulikan\nPottan 18:00\nPottan 18:00');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].timeCertainty, 'unknown');
});

test('validates actual ISO dates and resets a day at a new month header', () => {
  const rows = parsePosterText('Kumbham 14 1201\nGulikan 04:00\nMeenam\n2026-02-30\nPottan 06:00');
  assert.equal(rows[1].malayalamMonth, 'meenam');
  assert.equal(rows[1].malayalamDay, '');
  assert.equal(rows[1].dateKey, '');
});


test('does not assign ambiguous shared-line times or unrelated next-line events', () => {
  const rows = parsePosterText('04:00 Gulikan / 06:00 Pottan\nTheechamundi\nRegistration at 18:00');
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.timeCertainty === 'unknown'));
});


test('handles shared AM/PM ranges without treating the endpoint as the start', () => {
  const rows = parsePosterText('Gulikan 4–6 AM\nPottan 4 to 6 PM\nTheechamundi 11–1 PM');
  assert.deepEqual(rows.map(row => [row.start, row.end, row.timeCertainty]), [
    ['04:00', '06:00', 'range'], ['16:00', '18:00', 'range'], ['', '', 'unknown'],
  ]);
});


test('clears a consumed Malayalam date when a later ISO date changes', () => {
  const rows = parsePosterText('Kumbham 14 1201\n2026-02-26\nGulikan 04:00\n2026-02-27\nPottan 06:00');
  assert.equal(rows[0].malayalamDay, '14');
  assert.equal(rows[0].dateKey, '2026-02-26');
  assert.equal(rows[1].dateKey, '2026-02-27');
  assert.equal(rows[1].malayalamMonth, 'kumbham');
  assert.equal(rows[1].malayalamDay, '15');
  assert.equal(rows[1].malayalamYear, '1201');
});

test('clears a consumed ISO date when the Malayalam date changes', () => {
  const rows = parsePosterText('2026-02-26\nKollavarsham 1201\nKumbham 14\nGulikan 04:00\nKumbham 15\nPottan 06:00');
  assert.equal(rows[0].dateKey, '2026-02-26');
  assert.equal(rows[0].malayalamDay, '14');
  assert.equal(rows[1].dateKey, '');
  assert.equal(rows[1].malayalamDay, '15');
});

test('preserves explicitly paired date headings and repeated same-day headings', () => {
  const rows = parsePosterText('Kumbham 14 1201\n2026-02-26\nGulikan 04:00\n2026-02-26\nPottan 06:00\n2026-02-27 Kumbham 15 1201\nTheechamundi 08:00');
  assert.equal(rows[1].malayalamDay, '14');
  assert.equal(rows[2].malayalamDay, '15');
  assert.equal(rows[2].dateKey, '2026-02-27');
});

test('leaves Malayalam date ranges unresolved instead of choosing an endpoint', () => {
  const rows = parsePosterText('Meenam20–22 1201\nGulikan 04:00\n20 – 22 Kumbham 1201\nPottan 06:00');
  assert.equal(rows[0].malayalamMonth, 'meenam');
  assert.equal(rows[0].malayalamDay, '');
  assert.equal(rows[1].malayalamMonth, 'kumbham');
  assert.equal(rows[1].malayalamDay, '');
});

test('extracts the Edacheri Puthari Maholsavam poster without a fixed-name dependency', () => {
  const rows = parsePosterText([
    'എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം',
    'പുത്തരി മഹോത്സവം',
    '2025 നവംബർ 8 ശനിയാഴ്ച (1201 തുലാം 22)',
    'രാവിലെ 3.00 നു : തിരുവപ്പന',
    'ഉച്ചയ്ക്ക് 2.30 മണിക്ക് : മേലേരിക്കൽ കർമ്മം',
    'വൈകു. 5.30 മണിക്ക് : ശ്രീ മുത്തപ്പൻ വെള്ളാട്ടം',
    'വൈകു. 6.30 മണിക്ക് : ഗുളികൻ വെള്ളാട്ടം',
    'വൈകു. 7.30 മണിക്ക് : പുതിയ ഭഗവതി വെള്ളാട്ടം',
    'രാത്രി 7.00 മുതൽ 9 വരെ : പ്രസാദ സദ്യ',
  ].join('\n'));

  assert.deepEqual(rows.map(row => row.theyyam), [
    'Thiruvappana', 'Sree Muthappan Vellattam', 'Gulikan Vellattam', 'Puthiya Bhagavathi Vellattam',
  ]);
  assert.deepEqual(rows.map(row => row.sourceLabel), [
    'തിരുവപ്പന', 'ശ്രീ മുത്തപ്പൻ വെള്ളാട്ടം', 'ഗുളികൻ വെള്ളാട്ടം', 'പുതിയ ഭഗവതി വെള്ളാട്ടം',
  ]);
  assert.deepEqual(rows.map(row => row.start), ['03:00', '17:30', '18:30', '19:30']);
  assert.ok(rows.every(row => row.venue === 'എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം'));
  assert.ok(rows.every(row => row.dateKey === '2025-11-08'));
  assert.ok(rows.every(row => row.malayalamMonth === 'thulam' && row.malayalamDay === '22' && row.malayalamYear === '1201'));
  assert.ok(rows.every(row => row.description === 'Event: പുത്തരി മഹോത്സവം'));
  assert.ok(rows.every(row => row.recurrence === 'one_time'));
});

test('applies a reviewed local correction to the exact OCR label', () => {
  const rows = parsePosterText('ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം\nരാവിലെ 3.00 നു : തിരുവപ്പന', {
    തിരുവപ്പന: { value: 'തിരുവപ്പന (reviewed)', confirmations: 2, updatedAt: 1 },
  });
  assert.equal(rows[0].theyyam, 'തിരുവപ്പന (reviewed)');
  assert.equal(rows[0].sourceLabel, 'തിരുവപ്പന');
});

test('applies field-scoped learned venue and known-name corrections', () => {
  const rows = parsePosterText('കണ്ണൂർ മുത്തപ്പ ക്ഷേത്രം\nഗുളികൻ 06:30', {
    'venue:കണ്ണൂർ മുത്തപ്പ ക്ഷേത്രം': { value: 'കണ്ണൂർ ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം', confirmations: 1, updatedAt: 1 },
    'theyyam:ഗുളികൻ': { value: 'ഗുളികൻ വെള്ളാട്ടം', confirmations: 1, updatedAt: 1 },
  });
  assert.equal(rows[0].venue, 'കണ്ണൂർ ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം');
  assert.equal(rows[0].sourceVenue, 'കണ്ണൂർ മുത്തപ്പ ക്ഷേത്രം');
  assert.equal(rows[0].theyyam, 'ഗുളികൻ വെള്ളാട്ടം');
  assert.equal(rows[0].sourceLabel, 'ഗുളികൻ');
});

test('cleans the noisy venue and schedule prefix seen in the uploaded poster', () => {
  const rows = parsePosterText([
    '4 എടച്ചേരി ശ്രീമുത്തപ്പൻ ക്ഷേത്രം --',
    '2025 നവംബർ 8 ശനിയാഴ്ച (1201 തുലാം 22)',
    'വൈകു. 6.30 മണിക്ക് : ഗുളിക വെള്ളാട്ട',
  ].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].venue, 'എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം');
  assert.equal(rows[0].theyyam, 'Gulikan Vellattam');
  assert.equal(rows[0].sourceLabel, 'ഗുളികൻ വെള്ളാട്ടം');
  assert.equal(rows[0].start, '18:30');
  assert.equal(rows[0].dateKey, '2025-11-08');
});

test('repairs the already cached cells from the reported row after reload', () => {
  assert.equal(cleanExtractedVenue('4 എടച്ചേരി ശ്രീമുത്തപ്പൻ ക്ഷേത്രം --'), 'എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം');
  assert.equal(cleanExtractedTheyyam('വൈകു. 6.30 മണിക്ക് : ഗുളിക വെള്ളാട്ട'), 'ഗുളികൻ വെള്ളാട്ടം');
});

test('rejects timed festival activities while keeping actual performance cues', () => {
  const rows = parsePosterText([
    '08:00 ഗണപതി ഹോമം',
    '09:00 പ്രതിഷ്ഠാദിന മഹോത്സവം',
    '12:00 അന്നദാനം',
    '18:30 ഗുളികൻ വെള്ളാട്ടം',
  ].join('\n'));
  assert.deepEqual(rows.map(row => row.theyyam), ['Gulikan Vellattam']);
  assert.equal(isLikelyPerformanceLabel('അന്നദാനം'), false);
  assert.equal(isLikelyPerformanceLabel('ഗുളികൻ വെള്ളാട്ടം'), true);
});

test('infers a Malayalam venue heading without a venue suffix and converts its Gregorian date', () => {
  const rows = parsePosterText([
    'കണ്ണൂർ എടലപ്പുറം',
    'പുത്തരി മഹോത്സവം',
    '2025 നവംബർ 8 ശനിയാഴ്ച',
    'വൈകു. 6.30 മണിക്ക് : കുറി ഗുളിക തെയ്യം',
    'വൈകു. 7.30 മണിക്ക് : എടലപ്പുറത്ത് ചാമുണ്ഡി തെയ്യം',
  ].join('\n'));

  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.venue === 'കണ്ണൂർ എടലപ്പുറം'));
  assert.ok(rows.every(row => row.dateKey === '2025-11-08'));
  assert.ok(rows.every(row => row.malayalamMonth === 'thulam'));
  assert.ok(rows.every(row => row.malayalamDay === '22'));
  assert.ok(rows.every(row => row.malayalamYear === '1201'));
  assert.deepEqual(rows.map(row => row.theyyam), [
    'കുറി ഗുളികൻ തെയ്യം',
    'എടലപ്പുറത്ത് ചാമുണ്ഡി തെയ്യം',
  ]);
});

test('preserves identifying Malayalam prefixes while repairing common OCR endings', () => {
  assert.equal(cleanExtractedTheyyam('കുറി ഗുളിക തെയ്യം'), 'കുറി ഗുളികൻ തെയ്യം');
  assert.equal(cleanExtractedTheyyam('മാർണം ഗുളിക വെള്ളാടം'), 'മാർണം ഗുളികൻ വെള്ളാട്ടം');
  assert.equal(cleanExtractedTheyyam('എടലപ്പുറത്ത് ചാമുണ്ഡി തെയ്യം'), 'എടലപ്പുറത്ത് ചാമുണ്ഡി തെയ്യം');
});

test('translates fully recognized Malayalam labels and keeps unknown ones for review', () => {
  assert.equal(englishPerformanceName('ഗുളികന്റെ വെള്ളാട്ടം'), 'Gulikan Vellattam');
  assert.equal(englishPerformanceName('വിഷകണ്ഠന്റെ വെള്ളാട്ടവും തോറ്റവും'), 'Vishakandan Vellattam & Thottam');
  assert.equal(englishPerformanceName('വിഷകണ്ഠൻ ദൈവത്തിന്റെ പുറപ്പാട്'), 'Vishakandan Daivam Purappad');
  assert.equal(englishPerformanceName('വലിയ തമ്പുരാട്ടിയും'), 'Valiya Thampuratti');
  assert.equal(englishPerformanceName('എള്ളെടുത്ത് ഭഗവതി'), 'Elleduthu Bhagavathi');
  assert.equal(englishPerformanceName('കുറി ഗുളിക തെയ്യം'), '');
});

test('reads compact and dawn times and pairs a time line with the label after it', () => {
  const rows = parsePosterText([
    '2026 ഒക്ടോബർ 27 ചൊവ്വ (തുലാം 10)',
    'പുലർച്ചെ 5 മണിക്ക്: വിഷകണ്ഠൻ ദൈവത്തിന്റെ പുറപ്പാട്',
    'രാവിലെ 1130 ന്',
    'എള്ളെടുത്ത് ഭഗവതി',
    'രാത്രി 12 മണിക്ക് : ഗുളികൻ വെള്ളാട്ടം',
  ].join('\n'));
  assert.deepEqual(rows.map(row => [row.theyyam, row.start]), [
    ['Vishakandan Daivam Purappad', '05:00'], ['Elleduthu Bhagavathi', '11:30'], ['Gulikan Vellattam', '00:00'],
  ]);
});

test('repairs a misread heading day using the poster weekday and Malayalam date', () => {
  // OCR dropped the "2" from a decorative "26": 6 October is a Tuesday and Kanni 20.
  const [byMalayalam] = parsePosterText('2026 ഒക്ടോബർ 6 തിങ്കൾ (തുലാം 09)\nരാത്രി 9 മണിക്ക് : ഗുളികന്റെ വെള്ളാട്ടം');
  assert.deepEqual([byMalayalam.dateKey, byMalayalam.malayalamMonth, byMalayalam.malayalamDay, byMalayalam.malayalamYear], ['2026-10-26', 'thulam', '9', '1202']);
  const [byWeekday] = parsePosterText('2026 ഒക്ടോബർ 6 തിങ്കൾ\nരാത്രി 9 മണിക്ക് : ഗുളികന്റെ വെള്ളാട്ടം');
  assert.equal(byWeekday.dateKey, '2026-10-26');
  const [unreadable] = parsePosterText('2026 ഒക്ടോബർ 77 ചൊ (തുലാം 10)\nരാവിലെ 11 മണിക്ക് : എള്ളെടുത്ത് ഭഗവതി');
  assert.deepEqual([unreadable.dateKey, unreadable.malayalamDay, unreadable.malayalamYear], ['2026-10-27', '10', '1202']);
});

test('moves morning items after a night item to the next day', () => {
  const rows = parsePosterText('2026-10-26\nരാത്രി 9 മണിക്ക് : ഗുളികൻ വെള്ളാട്ടം\nപുലർച്ചെ 4 മണിക്ക് : ഗുളികൻ തിറ');
  assert.deepEqual(rows.map(row => [row.theyyam, row.dateKey, row.malayalamDay]), [
    ['Gulikan Vellattam', '2026-10-26', '9'], ['Gulikan Thira', '2026-10-27', '10'],
  ]);
});

test('skips temple rituals and records mudiyirakkal as the end of the last appearance', () => {
  const rows = parsePosterText([
    '2026-10-27',
    'പുലർച്ചെ 5 മണിക്ക്: വിഷകണ്ഠൻ ദൈവത്തിന്റെ പുറപ്പാട്',
    'രാവിലെ 10 മണിക്ക് : എള്ളെളെടുത്ത് ഭഗവതിയുടെ കലശം',
    'വൈകു: 6 മണിക്ക് : ഹോമം',
    'വൈകു: 6.30 ന് : വിഷകണ്ഠൻ ദൈവത്തിന്റെ മുടിയിറക്കൽ',
  ].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].theyyam, 'Vishakandan Daivam Purappad');
  assert.equal(rows[0].description, 'Mudiyirakkal at 18:30 (end of the Theyyam)');
});

test('extracts the Kolacheri Puthari Adiyanthiram poster from its overlapping OCR regions', () => {
  const raw = readFileSync(new URL('./fixtures/kolacheri-puthari-ocr.txt', import.meta.url), 'utf8');
  const regions = raw.split(/--- OCR region \d+ ---\s*/).filter(Boolean);
  const rows = parsePosterRegions(regions);
  assert.deepEqual(rows.map(row => [row.theyyam, row.dateKey, row.malayalamMonth, row.malayalamDay, row.malayalamYear, row.start]), [
    ['Vishakandan Vellattam & Thottam', '2026-10-26', 'thulam', '9', '1202', '19:30'],
    ['Gulikan Vellattam', '2026-10-26', 'thulam', '9', '1202', '21:00'],
    // OCR lost "ഗുളി" from "ഗുളികൻ തിറ"; Gulikan appears elsewhere on the poster.
    ['Gulikan Thira', '2026-10-27', 'thulam', '10', '1202', '04:00'],
    ['Vishakandan Daivam Purappad', '2026-10-27', 'thulam', '10', '1202', '05:00'],
    ['Elleduthu Bhagavathi', '2026-10-27', 'thulam', '10', '1202', '11:00'],
    ['Valiya Thampuratti', '2026-10-27', 'thulam', '10', '1202', '13:00'],
  ]);
  assert.ok(rows.every(row => row.venue === 'വിഷകണ്ഠൻ ക്ഷേത്രം'));
  assert.ok(rows.every(row => row.description?.startsWith('Event: പുത്തരി അടിയന്തിരം')));
  assert.match(rows[3].description || '', /Mudiyirakkal at 18:30/);
});

test('completes a truncated deity name only when the poster names exactly one match', () => {
  const rows = parsePosterText('2026-10-26\nരാത്രി 9 മണിക്ക് : ഗുളികന്റെ വെള്ളാട്ടം\nപുലർച്ചെ 4 മണിക്ക് : കൻ തിറ');
  assert.deepEqual(rows.map(row => [row.theyyam, row.sourceLabel]), [
    ['Gulikan Vellattam', 'ഗുളികൻ വെള്ളാട്ടം'], ['Gulikan Thira', 'കൻ തിറ'],
  ]);
  // Without a deity on the poster to complete it from, the fragment stays for review.
  const [alone] = parsePosterText('2026-10-26\nപുലർച്ചെ 4 മണിക്ക് : കൻ തിറ');
  assert.equal(alone.theyyam, 'കൻ തിറ');
});

test('never takes a time-of-day word as the venue', () => {
  const [row] = parsePosterText('വൈകുന്നേരം\n2026-10-26\nരാത്രി 9 മണിക്ക് : ഗുളികൻ വെള്ളാട്ടം');
  assert.equal(row.venue, '');
});
