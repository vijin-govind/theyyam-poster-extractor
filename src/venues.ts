import * as XLSX from 'xlsx';

/** Column order of the venue bulk-import template (sheet "Venues"). */
export const VENUE_FIELDS = [
  'nameEn', 'nameMl', 'venueType', 'district', 'districtId', 'village', 'description', 'landmark',
  'mapsLink', 'latitude', 'longitude', 'videoUrl', 'images', 'status',
] as const;
export type VenueField = (typeof VENUE_FIELDS)[number];
export type VenueDetails = Record<VenueField, string>;
export type VenueErrors = Partial<Record<VenueField, string>>;

export const VENUE_TYPES = ['kavu', 'temple', 'tharavadu', 'madappura', 'shrine', 'other'] as const;
export const VENUE_STATUSES = ['active', 'hidden', 'removed'] as const;
export const KERALA_DISTRICTS = [
  'Kasaragod', 'Kannur', 'Wayanad', 'Kozhikode', 'Malappuram', 'Palakkad', 'Thrissur',
  'Ernakulam', 'Idukki', 'Kottayam', 'Alappuzha', 'Pathanamthitta', 'Kollam', 'Thiruvananthapuram',
];
export const MAX_VENUE_ROWS = 200;

export type VenueColumn = { key: VenueField; width: number; required: boolean; type: 'text' | 'select' | 'number' | 'district'; options?: readonly string[]; hint: string };
export const venueColumns: VenueColumn[] = [
  { key: 'nameEn', width: 260, required: true, type: 'text', hint: 'English name (required)' },
  { key: 'nameMl', width: 220, required: false, type: 'text', hint: 'Malayalam name' },
  { key: 'venueType', width: 140, required: false, type: 'select', options: VENUE_TYPES, hint: 'Blank defaults to other' },
  { key: 'district', width: 150, required: true, type: 'district', hint: 'District name or slug (or districtId)' },
  { key: 'districtId', width: 110, required: false, type: 'number', hint: 'Numeric district ID, instead of district' },
  { key: 'village', width: 150, required: true, type: 'text', hint: 'Village (required)' },
  { key: 'description', width: 240, required: false, type: 'text', hint: 'Optional' },
  { key: 'landmark', width: 180, required: false, type: 'text', hint: 'Optional' },
  { key: 'mapsLink', width: 220, required: false, type: 'text', hint: 'Full http(s) URL' },
  { key: 'latitude', width: 110, required: false, type: 'number', hint: '-90 to 90' },
  { key: 'longitude', width: 110, required: false, type: 'number', hint: '-180 to 180' },
  { key: 'videoUrl', width: 200, required: false, type: 'text', hint: 'Full http(s) URL' },
  { key: 'images', width: 260, required: false, type: 'text', hint: 'Up to 8 http(s) URLs separated by |' },
  { key: 'status', width: 120, required: false, type: 'select', options: VENUE_STATUSES, hint: 'Blank defaults to active' },
];

/** The template's Instructions sheet, kept with every export. */
export const VENUE_INSTRUCTIONS: [string, string][] = [
  ['Bulk venue upload', 'Instructions'],
  ['Required fields', 'nameEn, village, and either district or districtId'],
  ['District', "Enter an existing district's English name or slug. If using districtId, enter its numeric ID instead. Do not fill both unless they refer to the same district."],
  ['Venue type', 'Use one of: kavu, temple, tharavadu, madappura, shrine, other. Blank defaults to other.'],
  ['Status', 'Use one of: active, hidden, removed. Blank defaults to active.'],
  ['Coordinates', 'Latitude must be from -90 to 90. Longitude must be from -180 to 180.'],
  ['URLs', 'Maps, video, and image links must be complete http(s) URLs.'],
  ['Images', 'Separate multiple image URLs with |. Up to 8 images are accepted.'],
  ['Import limit', 'Upload up to 200 venue rows at a time. Remove the example row before entering your records.'],
  ['Review', 'The uploader checks every row and shows the reason for each issue. If any row or column is invalid, no venues are imported until you fix it.'],
];

export const emptyVenue = (): VenueDetails => Object.fromEntries(VENUE_FIELDS.map(field => [field, ''])) as VenueDetails;
const isMalayalam = (value: string) => /[ഀ-ൿ]/.test(value);

export function inferVenueType(...names: string[]): string {
  const text = names.join(' ');
  if (/\bkavu\b|കാവ്/i.test(text)) return 'kavu';
  if (/\btharavad|തറവാട്/i.test(text)) return 'tharavadu';
  if (/\bmadappura\b|മടപ്പുര/i.test(text)) return 'madappura';
  if (/\btemple\b|\bksh?eth?ram\b|ക്ഷേത്രം|ദേവസ്ഥാനം|കോട്ടം|കഴകം/i.test(text)) return 'temple';
  if (/\bshrine\b|പള്ളിയറ|സ്ഥാനം/i.test(text)) return 'shrine';
  return '';
}

/** Kerala venue names usually start with the place: "Kolachery Sree … Temple" → "Kolachery". */
export function guessVillage(nameEn: string): string {
  const words = nameEn.trim().split(/\s+/);
  const honorific = words.findIndex(word => /^(?:sree|sri|shri|shree)$/i.test(word));
  if (honorific === 1 || honorific === 2) return words.slice(0, honorific).join(' ');
  return '';
}

/** First draft of a venue's import row from its schedule name, OCR text and anything remembered. */
export function suggestVenue(name: string, sourceVenue = '', remembered: Partial<VenueDetails> = {}): VenueDetails {
  const nameEn = isMalayalam(name) ? '' : name.trim();
  const nameMl = isMalayalam(name) ? name.trim() : '';
  return {
    ...emptyVenue(),
    nameEn,
    nameMl,
    venueType: inferVenueType(name, sourceVenue),
    village: guessVillage(nameEn),
    status: 'active',
    ...Object.fromEntries(Object.entries(remembered).filter(([, value]) => value)),
  };
}

const isUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
};

/** Checks one row against the template's Instructions sheet. */
export function validateVenue(venue: VenueDetails): VenueErrors {
  const errors: VenueErrors = {};
  const value = (field: VenueField) => (venue[field] || '').trim();
  if (!value('nameEn')) errors.nameEn = 'nameEn is required.';
  if (!value('village')) errors.village = 'village is required.';
  if (!value('district') && !value('districtId')) errors.district = 'Enter a district or a districtId.';
  if (value('districtId') && !/^\d+$/.test(value('districtId'))) errors.districtId = 'districtId must be a whole number.';
  if (value('venueType') && !(VENUE_TYPES as readonly string[]).includes(value('venueType'))) errors.venueType = `Use one of: ${VENUE_TYPES.join(', ')}.`;
  if (value('status') && !(VENUE_STATUSES as readonly string[]).includes(value('status'))) errors.status = `Use one of: ${VENUE_STATUSES.join(', ')}.`;
  for (const [field, limit] of [['latitude', 90], ['longitude', 180]] as const) {
    if (!value(field)) continue;
    const number = Number(value(field));
    if (!Number.isFinite(number) || Math.abs(number) > limit) errors[field] = `${field} must be a number from -${limit} to ${limit}.`;
  }
  if ((value('latitude') === '') !== (value('longitude') === '')) {
    errors[value('latitude') ? 'longitude' : 'latitude'] = 'Enter both latitude and longitude, or neither.';
  }
  for (const field of ['mapsLink', 'videoUrl'] as const) {
    if (value(field) && !isUrl(value(field))) errors[field] = 'Use a complete http(s) URL.';
  }
  if (value('images')) {
    const images = value('images').split('|').map(image => image.trim()).filter(Boolean);
    if (images.length > 8) errors.images = 'Up to 8 image URLs are accepted.';
    else if (images.some(image => !isUrl(image))) errors.images = 'Each image must be a complete http(s) URL, separated by |.';
  }
  return errors;
}

export type VenueIssue = { index: number; field: VenueField; message: string };
export function validateVenues(venues: VenueDetails[]): VenueIssue[] {
  const issues = venues.flatMap((venue, index) => Object.entries(validateVenue(venue))
    .map(([field, message]) => ({ index, field: field as VenueField, message: message! })));
  const seen = new Map<string, number>();
  venues.forEach((venue, index) => {
    const key = venue.nameEn.trim().toLowerCase();
    if (!key) return;
    if (seen.has(key)) issues.push({ index, field: 'nameEn', message: `Duplicate of venue row ${seen.get(key)! + 1}.` });
    else seen.set(key, index);
  });
  return issues;
}

/** Builds the venue import workbook: same columns, widths and Instructions sheet as the template. */
export function buildVenueWorkbook(venues: VenueDetails[]): XLSX.WorkBook {
  const rows: XLSX.CellObject[][] = [VENUE_FIELDS.map(field => ({ t: 's', v: field }))];
  for (const venue of venues) {
    rows.push(VENUE_FIELDS.map((field): XLSX.CellObject => {
      const value = (venue[field] || '').trim();
      if ((field === 'latitude' || field === 'longitude' || field === 'districtId') && value) return { t: 'n', v: Number(value) };
      // Explicit text cells: a name starting with "=" is never turned into a formula.
      return value ? { t: 's', v: value } : { t: 'z' };
    }));
  }
  const sheet = XLSX.utils.aoa_to_sheet([]);
  rows.forEach((row, r) => row.forEach((cell, c) => { if (cell.t !== 'z') sheet[XLSX.utils.encode_cell({ r, c })] = cell; }));
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: VENUE_FIELDS.length - 1 } });
  sheet['!cols'] = [24, 22, 16, 16, 16, 20, 40, 28, 34, 14, 14, 34, 52, 16].map(wch => ({ wch }));
  const instructions = XLSX.utils.aoa_to_sheet(VENUE_INSTRUCTIONS);
  instructions['!cols'] = [{ wch: 22 }, { wch: 100 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Venues');
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions');
  workbook.Props = { Title: 'Theyyam Venues', Subject: 'Venue bulk import', Author: 'Theyyam Poster Extractor' };
  return workbook;
}
