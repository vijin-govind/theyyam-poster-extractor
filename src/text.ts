// Shared text normalization for OCR output (no app imports, so any module can use it).

const CHILLU: [RegExp, string][] = [
  [/ന്\u200d/g, 'ൻ'], [/ര്\u200d/g, 'ർ'], [/ല്\u200d/g, 'ൽ'], [/ള്\u200d/g, 'ൾ'], [/ണ്\u200d/g, 'ൺ'],
];
export function normalizedText(text: string) {
  let value = text.normalize('NFKC');
  // Older fonts encode chillu letters as consonant + virama + ZWJ. Use the atomic form.
  for (const [pattern, chillu] of CHILLU) value = value.replace(pattern, chillu);
  // OCR often reads chillu-n as the Malayalam digit nine (൯) after a letter.
  value = value.replace(/(?<=[അ-ഹാ-്])൯/g, 'ൻ');
  return value.replace(/[൦-൯]/g, character => String(character.charCodeAt(0) - 0x0d66))
    .replace(/\r/g, '').replace(/[\u200b-\u200d\ufeff]/g, '');
}
