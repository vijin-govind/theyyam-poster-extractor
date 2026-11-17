import * as XLSX from 'xlsx';

export const MONTHS = [
  'chingam', 'kanni', 'thulam', 'vrischikam', 'dhanu', 'makaram',
  'kumbham', 'meenam', 'medam', 'edavam', 'mithunam', 'karkidakam',
] as const;
export const TIME_CERTAINTIES = ['exact', 'approximate', 'range', 'unknown'] as const;
export const RECURRENCES = ['one_time', 'annual', 'n_yearly', 'none'] as const;
export const STATUSES = ['draft', 'pending', 'verified', 'published', 'cancelled'] as const;

/** Keep this order in sync with the bulk-import contract. */
export const fields = [
  'venue', 'theyyam', 'malayalamMonth', 'malayalamDay', 'malayalamYear',
  'dateKey', 'start', 'end', 'timeCertainty', 'recurrence',
  'recurrenceInterval', 'duration', 'performer', 'status', 'description', 'highlights',
] as const;
export const FIELDS = fields;
export type FieldKey = (typeof fields)[number];
export type ScheduleValues = Record<FieldKey, string>;
export type Row = ScheduleValues & {
  id: string;
  posterId: string;
  /** OCR label retained locally so a reviewed correction can be learned. */
  sourceLabel?: string;
  /** OCR venue retained locally so a reviewed venue correction can be learned safely. */
  sourceVenue?: string;
};
export type Poster = {
  id: string;
  title: string;
  fileName: string;
  previewUrl: string;
  dateLabel: string;
  isSample?: boolean;
  rawText?: string;
  /** Original upload retained locally so the poster can be reanalyzed without reselecting it. */
  sourceBlob?: Blob;
  sourceType?: string;
  state?: 'ready' | 'processing' | 'error';
  progress?: number;
  error?: string;
};

export type Column = {
  key: FieldKey;
  label: string;
  width: number;
  required: boolean;
  type: 'text' | 'number' | 'select' | 'date' | 'time';
  options?: readonly string[];
  min?: number;
  max?: number;
};

export const columns: Column[] = [
  { key: 'venue', label: 'venue', width: 230, required: true, type: 'text' },
  { key: 'theyyam', label: 'theyyam', width: 218, required: true, type: 'text' },
  { key: 'malayalamMonth', label: 'malayalamMonth', width: 185, required: true, type: 'select', options: MONTHS },
  { key: 'malayalamDay', label: 'malayalamDay', width: 150, required: true, type: 'number', min: 1, max: 32 },
  { key: 'malayalamYear', label: 'malayalamYear', width: 160, required: true, type: 'number', min: 1000, max: 9999 },
  { key: 'dateKey', label: 'dateKey', width: 165, required: false, type: 'date' },
  { key: 'start', label: 'start', width: 115, required: false, type: 'time' },
  { key: 'end', label: 'end', width: 115, required: false, type: 'time' },
  { key: 'timeCertainty', label: 'timeCertainty', width: 165, required: true, type: 'select', options: TIME_CERTAINTIES },
  { key: 'recurrence', label: 'recurrence', width: 155, required: true, type: 'select', options: RECURRENCES },
  { key: 'recurrenceInterval', label: 'recurrenceInterval', width: 185, required: false, type: 'number', min: 2, max: 24 },
  { key: 'duration', label: 'duration', width: 150, required: false, type: 'text' },
  { key: 'performer', label: 'performer', width: 190, required: false, type: 'text' },
  { key: 'status', label: 'status', width: 140, required: true, type: 'select', options: STATUSES },
  { key: 'description', label: 'description', width: 270, required: false, type: 'text' },
  { key: 'highlights', label: 'highlights', width: 230, required: false, type: 'text' },
];
export const COLUMNS = columns;

export type RowErrors = Partial<Record<FieldKey, string>>;
export type ValidationIssue = { rowId: string; field: FieldKey; message: string };

function validInteger(value: string, min: number, max: number): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}

export function validateRow(row: Row): RowErrors {
  const errors: RowErrors = {};
  for (const column of columns) {
    const value = String(row[column.key] ?? '').trim();
    if (!value) {
      if (column.required) errors[column.key] = `${column.label} is required.`;
      continue;
    }
    if (column.options && !column.options.includes(value)) {
      errors[column.key] = `Choose one of: ${column.options.join(', ')}.`;
    }
  }

  const day = String(row.malayalamDay ?? '').trim();
  if (day && !validInteger(day, 1, 32)) errors.malayalamDay = 'Enter a whole number from 1 to 32.';
  const year = String(row.malayalamYear ?? '').trim();
  if (year && (!/^\d{4}$/.test(year) || !validInteger(year, 1000, 9999))) {
    errors.malayalamYear = 'Enter a four-digit year, for example 1201.';
  }

  const date = String(row.dateKey ?? '').trim();
  if (date) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
      errors.dateKey = 'Enter a valid calendar date in YYYY-MM-DD format.';
    }
  }

  const certainty = String(row.timeCertainty ?? '').trim();
  for (const key of ['start', 'end'] as const) {
    const value = String(row[key] ?? '').trim();
    if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      errors[key] = 'Use 24-hour time in HH:MM format, for example 04:30.';
    }
  }
  if (['exact', 'approximate', 'range'].includes(certainty) && !String(row.start ?? '').trim()) {
    errors.start = `A start time is required when timeCertainty is ${certainty}.`;
  }
  if (certainty === 'range' && !String(row.end ?? '').trim()) {
    errors.end = 'An end time is required for a time range.';
  }

  const interval = String(row.recurrenceInterval ?? '').trim();
  if (String(row.recurrence ?? '').trim() === 'n_yearly' && !interval) {
    errors.recurrenceInterval = 'An interval is required for n_yearly recurrence.';
  } else if (interval && !validInteger(interval, 2, 24)) {
    errors.recurrenceInterval = 'Enter a whole number from 2 to 24.';
  }
  return errors;
}

export function validateRows(rows: Row[]): ValidationIssue[] {
  return rows.flatMap((row) => Object.entries(validateRow(row)).map(([field, message]) => ({
    rowId: row.id, field: field as FieldKey, message,
  })));
}

export function emptyRow(posterId: string, defaults: Partial<ScheduleValues> = {}): Row {
  const values = Object.fromEntries(fields.map((field) => [field, ''])) as ScheduleValues;
  return {
    ...values,
    timeCertainty: 'unknown', recurrence: 'one_time', status: 'draft',
    ...defaults,
    id: crypto.randomUUID(), posterId,
  };
}

/** Demonstration records only; never presented as OCR output from an uploaded file. */
export function createInitialBatch(): { posters: Poster[]; rows: Row[] } {
  const posters: Poster[] = [
    { id: 'poster-1', title: 'Kavumbhagom Kaliyattam', fileName: 'kavumbhagom-kaliyattam-2026.jpg', previewUrl: '/posters/poster-1.svg', dateLabel: '26–28 Feb 2026', isSample: true, state: 'ready' },
    { id: 'poster-2', title: 'Muchilottu Kavu', fileName: 'muchilottu-kavu-2026.jpg', previewUrl: '/posters/poster-2.svg', dateLabel: '2–4 Apr 2026', isSample: true, state: 'ready' },
    { id: 'poster-3', title: 'Perumthitta Tharavad', fileName: 'perumthitta-tharavad-2026.jpg', previewUrl: '/posters/poster-3.svg', dateLabel: '5–7 Apr 2026', isSample: true, state: 'ready' },
  ];
  const names = [
    ['Vishnumoorthi', 'Gulikan Theyyam', 'Raktha Chamundi', 'Muthappan', 'Muchilottu Bhagavathi', 'Pottan Theyyam', 'Kandanar Kelan', 'Kathivanoor Veeran', 'Bhairavan', 'Vayanattu Kulavan', 'Agni Kandankarnan', 'Puliyoor Kannan'],
    ['Muchilottu Bhagavathi', 'Kannangattu Bhagavathi', 'Puliyoor Kali', 'Vishnumoorthi', 'Gulikan Theyyam', '', 'Pottan Theyyam', 'Kathivanoor Veeran', 'Bhairavan', 'Agni Kandankarnan', 'Vayanattu Kulavan', 'Puliyoor Kannan'],
    ['Theechamundi', 'Gulikan Theyyam', 'Raktha Chamundi', 'മുച്ചിലോട്ട് ഭഗവതി', 'Pottan Theyyam', 'Kandanar Kelan', 'Kathivanoor Veeran', 'Bhairavan', 'വീരാളി', 'Agni Kandankarnan', 'Vayanattu Kulavan', 'Puliyoor Kannan'],
  ];
  const rows = posters.flatMap((poster, posterIndex) => names[posterIndex].map((name, index) => {
    const dayOffset = Math.floor(index / 4);
    const dates = [['2026-02-26', '2026-02-27', '2026-02-28'], ['2026-04-02', '2026-04-03', '2026-04-04'], ['2026-04-05', '2026-04-06', '2026-04-07']];
    const row = emptyRow(poster.id, {
      venue: poster.title,
      theyyam: name,
      malayalamMonth: posterIndex === 0 ? 'kumbham' : 'meenam',
      malayalamDay: String([14, 19, 22][posterIndex] + dayOffset),
      malayalamYear: '1201',
      dateKey: dates[posterIndex][dayOffset],
      start: ['04:30', '06:00', '08:30', '22:00'][index % 4],
      timeCertainty: index === 10 ? 'approximate' : 'exact',
      recurrence: 'annual',
      duration: index % 3 === 0 ? '1 hour' : '',
      status: 'draft',
      description: 'Sample performance. Replace with your reviewed poster data.',
      highlights: index === 0 ? 'traditional ritual|annual festival' : '',
    });
    row.id = `sample-${posterIndex * 12 + index + 1}`;
    return row;
  }));
  return { posters, rows };
}

/** Explicit text cell types prevent formula-like user content from becoming formulas. */
export function buildWorkbook(rows: Row[]): XLSX.WorkBook {
  const numericFields = new Set<FieldKey>(['malayalamDay', 'malayalamYear', 'recurrenceInterval']);
  const sheet: XLSX.WorkSheet = {};
  fields.forEach((field, columnIndex) => {
    sheet[XLSX.utils.encode_cell({ r: 0, c: columnIndex })] = { t: 's', v: field };
  });
  rows.forEach((row, rowIndex) => {
    fields.forEach((field, columnIndex) => {
      const value = String(row[field] ?? '').trim();
      const cell: XLSX.CellObject = numericFields.has(field) && /^\d+$/.test(value)
        ? { t: 'n', v: Number(value), z: '0' }
        : { t: 's', v: value };
      sheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex })] = cell;
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: fields.length - 1 } });
  sheet['!cols'] = columns.map(({ width }) => ({ wch: Math.round(width / 8) }));
  sheet['!rows'] = [{ hpt: 24 }];
  sheet['!autofilter'] = { ref: sheet['!ref'] };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Schedule');
  workbook.Props = { Title: 'Theyyam Schedule', Subject: 'Bulk-import schedule', Author: 'Theyyam Poster Extractor' };
  return workbook;
}
