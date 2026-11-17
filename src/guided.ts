import type { Row } from './schema';
import { parsePosterText } from './parser';
import type { LearnedCorrections } from './learning';

type Label = 'venue' | 'date' | 'theyyam' | 'time';

const LABELS: Array<[Label, RegExp]> = [
  ['venue', /^(?:venue|temple|place|location|സ്ഥലം|വേദി|ക്ഷേത്രം)\s*(?::|[-–—]|is\b|ആണ്\b)\s*(.+)$/i],
  ['date', /^(?:date|day|തീയതി|ദിവസം)\s*(?::|[-–—]|is\b|ആണ്\b)\s*(.+)$/i],
  ['theyyam', /^(?:theyyam|performance|name|തെയ്യം|കോലം|പേര്)\s*(?::|[-–—]|is\b|ആണ്\b)\s*(.+)$/i],
  ['time', /^(?:time|start|സമയം|തുടക്കം)\s*(?::|[-–—]|is\b|ആണ്\b)\s*(.+)$/i],
];

function labelledLine(line: string): { label: Label; value: string } | null {
  for (const [label, pattern] of LABELS) {
    const match = pattern.exec(line.trim());
    if (match?.[1]?.trim()) return { label, value: match[1].trim() };
  }
  return null;
}

function splitSpokenLabels(text: string): string {
  return text.replace(/\s+(?=(?:venue|temple|place|location|date|day|theyyam|performance|name|time|start)\s+(?:is\b|:))/gi, '\n');
}

/**
 * Parses reviewer-provided text or a browser speech transcript. Free-form
 * schedule text uses the normal conservative parser. Labelled input also
 * accepts unfamiliar Theyyam names because the reviewer supplied them.
 */
export function parseGuidedPosterInput(text: string, learned: LearnedCorrections = {}): Partial<Row>[] {
  const normalized = splitSpokenLabels(text.normalize('NFKC')).replace(/\r/g, '').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const hasLabels = lines.some(line => labelledLine(line));
  if (!hasLabels) {
    const direct = parsePosterText(normalized, learned);
    return direct.map(row => ({ ...row, sourceLabel: undefined, sourceVenue: undefined }));
  }

  let venue = '';
  let date = '';
  let theyyam = '';
  let time = '';
  const entries: Array<{ theyyam: string; time: string }> = [];

  const flush = () => {
    if (theyyam) entries.push({ theyyam, time });
    theyyam = '';
    time = '';
  };

  for (const line of lines) {
    const labelled = labelledLine(line);
    if (!labelled) continue;
    if (labelled.label === 'venue') venue = labelled.value;
    else if (labelled.label === 'date') date = labelled.value;
    else if (labelled.label === 'theyyam') {
      flush();
      theyyam = labelled.value;
    } else if (labelled.label === 'time') {
      time = labelled.value;
    }
  }
  flush();

  return entries.map(entry => {
    // Add an explicit cue only for parsing context, then restore the exact
    // reviewer-provided name in the returned draft row.
    const contextText = [venue, date, `${entry.theyyam} തെയ്യം ${entry.time}`].filter(Boolean).join('\n');
    const parsed = parsePosterText(contextText, learned)[0] || {};
    return {
      ...parsed,
      venue: parsed.venue || venue,
      theyyam: entry.theyyam,
      sourceLabel: undefined,
      sourceVenue: undefined,
      timeCertainty: parsed.timeCertainty || 'unknown',
      recurrence: parsed.dateKey ? 'one_time' : 'none',
      recurrenceInterval: '',
      duration: '',
      performer: '',
      status: 'draft',
      description: 'Added from guided text or voice entry.',
      highlights: '',
    };
  });
}
