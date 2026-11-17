# Malayalam Theyyam poster extraction guide

This project guide records reviewed domain rules used by the browser parser. It is deliberately narrower than a claim of understanding all Malayalam posters: OCR remains fallible, and a human must compare every draft with its source.

## Reviewed example: Puthari Maholsavam

The user-confirmed poster contains these headline facts:

- Venue: `എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം` (Edacheri Sri Muthappan Temple)
- Event: `പുത്തരി മഹോത്സവം` (Puthari Maholsavam)
- Gregorian date: `2025 നവംബർ 8 ശനിയാഴ്ച` — Saturday, 8 November 2025
- Malayalam date: `1201 തുലാം 22`

The visible schedule demonstrates common layout and vocabulary:

- `രാവിലെ` means morning and supplies AM context.
- `ഉച്ചയ്ക്ക്` means afternoon; `വൈകു.` / `വൈകിട്ട്` means evening; `രാത്രി` means night. These supply PM context when a poster omits AM/PM.
- Malayalam posters often write time as `3.00`, `5.30`, and so on. A dot can be the hour/minute separator.
- `മണിക്ക്`, `നു`, and `ന്` attach a time to an activity.
- `മുതൽ … വരെ` expresses a range.
- `വെള്ളാട്ടം` is a performance-stage term. Names such as `ശ്രീ മുത്തപ്പൻ വെള്ളാട്ടം`, `ഗുളികൻ വെള്ളാട്ടം`, and `പുതിയ ഭഗവതി വെള്ളാട്ടം` must retain the complete label.
- `തിരുവപ്പന` is a performance entry in this schedule.
- Supporting items such as `മേലേരിക്കൽ കർമ്മം` and `പ്രസാദ സദ്യ` are event activities, but they are not exported as Theyyam performance rows.

## Reviewed example: Kolacheri Puthari Adiyanthiram

A two-day landscape poster (`കൊളച്ചേരി ശ്രീ ചാത്തമ്പള്ളി വിഷകണ്ഠൻ ക്ഷേത്രം`, 26–27 October 2026, Thulam 9–10, 1202) showed these OCR failure modes, now handled:

- The decorative day number `26` was read as `6`. The heading's weekday (`തിങ്കൾ`) and Malayalam date (`തുലാം 09`) identify the only matching day, so the Gregorian date is repaired. An unreadable day (`77`) is recovered the same way from `തുലാം 10`.
- `പുലർച്ചെ` (dawn) is morning context; `730ന്` / `1130 ന്` are compact forms of 7.30 and 11.30; `രാത്രി 12` is midnight.
- OCR often prints a time on one line and its label on the next. A label line takes the most recent waiting time.
- A morning item after a night item with no new heading belongs to the next day.
- The image is read whole and as overlapping tiles. Duplicate sightings are merged, preferring dated rows, times in schedule order, and fully recognized names.
- Only Theyyam appearances become rows (vellattam, thottam, thira, purappad, named deities). Rituals such as kalasham, homam, nivedyam, ilamkolam, ezhunnallathu and mudiyirakkal do not.
- `മുടിയിറക്കൽ` (removing the headdress) marks the end of a Theyyam; its time is added to the description of that deity's last appearance.

## Theyyam names

Recognized Malayalam labels are exported in English transliteration, for example `ഗുളികന്റെ വെള്ളാട്ടം` → `Gulikan Vellattam` and `വിഷകണ്ഠൻ ദൈവത്തിന്റെ പുറപ്പാട്` → `Vishakandan Daivam Purappad`. Consecutive stages are joined with `&`. If any word in a label is not in the reviewed vocabulary, the cleaned Malayalam label is kept so the reviewer can see and correct it. Learned corrections are keyed by the Malayalam source label.

## Extraction policy

1. A short line containing a reviewed venue term such as `ക്ഷേത്രം`, `കാവ്`, `തറവാട്`, `ദേവസ്ഥാനം`, or `മടപ്പുര` is a venue candidate. A nearby Malayalam heading can be used conservatively when a cropped schedule panel has no suffix.
2. A short line containing `മഹോത്സവം` or `ഉത്സവം` is event context and is copied to `description`.
3. Explicit Gregorian and Malayalam dates are attached to following performance lines. A valid Gregorian date is deterministically converted to Kollavarsham using the Surya Siddhanta system and Kerala coordinates; explicit Malayalam poster text remains direct evidence.
4. A timed Malayalam schedule line can produce a candidate even when its name is absent from the built-in vocabulary.
5. Known non-performance activities are excluded from the Theyyam column.
6. Every extracted row remains `draft` until a reviewer checks the poster.

## Local correction learning

When a reviewer changes an OCR-extracted `venue` or `theyyam` value and leaves the cell, the app stores a field-scoped mapping from the normalized OCR text to the reviewed value in that browser. A later poster containing the same normalized source text in the same field reuses the correction.

This is bounded, explainable correction memory rather than unsupervised model training:

- only explicit reviewer edits teach it;
- venue and Theyyam corrections cannot cross into each other's fields;
- dates and times are not memorized as global replacements;
- repeated confirmations increase the mapping's confirmation count, while a conflicting review replaces the prior value and restarts that count;
- mappings remain private to the current browser;
- at most 500 recent mappings are retained;
- correction metadata is never exported to Excel;
- the Help dialog can clear the learned mappings without deleting schedule rows;
- fuzzy guesses are avoided so one correction cannot silently rewrite a different Malayalam word;
- short OCR fragments (fewer than four letters) and venue sources containing digits or time words are never learned or applied.
