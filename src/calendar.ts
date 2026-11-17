import { Kollavarsham } from 'kollavarsham';
import type { Row } from './schema';

const converter = new Kollavarsham({
  system: 'SuryaSiddhanta',
  latitude: 10.8505,
  longitude: 76.2711,
});

const MONTH_TO_SCHEMA: Record<string, string> = {
  'ചിങ്ങം': 'chingam',
  'കന്നി': 'kanni',
  'തുലാം': 'thulam',
  'വൃശ്ചികം': 'vrischikam',
  'ധനു': 'dhanu',
  'മകരം': 'makaram',
  'കുംഭം': 'kumbham',
  'മീനം': 'meenam',
  'മേടം': 'medam',
  'ഇടവം': 'edavam',
  'മിഥുനം': 'mithunam',
  'കർക്കടകം': 'karkidakam',
};

export type MalayalamCalendarDate = {
  malayalamMonth: string;
  malayalamDay: string;
  malayalamYear: string;
};

/** Converts an explicit Gregorian YYYY-MM-DD value using the Surya Siddhanta system. */
export function gregorianToMalayalam(dateKey: string): MalayalamCalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const date = new Date(`${dateKey}T12:00:00+05:30`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== dateKey) return null;
  try {
    const converted = converter.fromGregorianDate(date);
    const malayalamMonth = MONTH_TO_SCHEMA[converted.mlMasaName];
    if (!malayalamMonth || !converted.year || !converted.date) return null;
    return {
      malayalamMonth,
      malayalamDay: String(converted.date),
      malayalamYear: String(converted.year),
    };
  } catch {
    return null;
  }
}

/** Applies a grid date selection and synchronizes its Malayalam calendar fields. */
export function applyGregorianDateSelection(row: Row, dateKey: string): Row {
  const converted = gregorianToMalayalam(dateKey);
  if (!converted) return { ...row, dateKey };
  return {
    ...row,
    dateKey,
    ...converted,
    recurrence: row.recurrence === 'none' || !row.recurrence ? 'one_time' : row.recurrence,
  };
}
