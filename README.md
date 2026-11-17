# Theyyam Poster Extractor

A private internal review workspace for turning Theyyam poster schedules into an Excel bulk-import file. The application uses React, TypeScript, Vite, Tailwind CSS, Lucide React, SheetJS (`xlsx`), Tesseract.js, PDF.js, the `kollavarsham` calendar library, and IndexedDB through `idb-keyval`.

The initial three posters and 36 performances are **sample data**. One sample `theyyam` value is intentionally missing in row 18 so the review workflow can be explored. Its source poster shows **Raktha Chamundi**. Start a new batch before importing real work if the sample rows should not appear in your export.

## Run locally

Use Node.js 22.13 or newer and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build:

```sh
npm run build
```

The build runs TypeScript checks and creates `dist/`. Serve the entire directory over HTTPS, including `/ocr/` and `/posters/`. The application expects deployment at the origin root. Do not open `index.html` with `file://`; worker and module loading require an HTTP origin.

### Deploy to Netlify

`netlify.toml` configures the build (`npm run build`, Node 22, publish `dist/`), the security headers in `public/_headers`, and the venue-search function (`netlify/functions/venue-search.ts`, served at `/api/venue-search`).

1. In Netlify, choose **Add new project → Import an existing project → GitHub** and select `theyyam-poster-extractor`. Netlify reads the settings from `netlify.toml`; keep the branch as `main`.
2. Optional, for web **Find venue**: **Site configuration → Environment variables → Add a variable** `BRAVE_SEARCH_API_KEY`, then **Deploys → Trigger deploy**. The key stays on Netlify and is never sent to the browser. The function answers only requests from the app's own pages.
3. Every push to `main` redeploys automatically.

Saved batches and learned data live in each browser for the site's address; work done on `localhost` does not appear on the deployed site.

The OCR worker, WebAssembly core, English and Malayalam recognition data, and PDF support assets are included under `public/ocr/`. Their license files are retained with the assets. No API key or server-side extraction service is required. The Sites hosting configuration is in `.openai/hosting.json`.

## Working with a batch

- Upload JPG, PNG, WebP, or PDF files using Browse or drag and drop. Each file must be at most 20 MB; PDFs are limited to 20 pages. Files are processed sequentially, with progress and cancellation for the current file.
- Scroll the poster feed to highlight its associated rows, or click a grid row to focus its source poster. Use the poster preview to inspect the source. Uploaded posters also expose the extracted text.
- Use **Reanalyze** on an uploaded poster to run OCR again and replace only that poster's extracted rows after confirmation. New uploads retain the original file locally; older saved uploads fall back to their rendered preview. Use **Remove** to delete a poster and its linked rows after confirmation.
- When extraction finds zero performances, use **Guide extraction** to type or dictate Venue, Date, Theyyam, and Time values. The browser turns each Theyyam/Time pair into a draft row, runs the normal Gregorian-to-Malayalam conversion, and leaves every field editable. Browser speech recognition is optional; labelled text and a blank-row fallback always remain available.
- Edit all 16 fields inline. `Tab` moves between controls; `Enter` moves to the same column in the next visible row. Scroll horizontally for the remaining fields.
- Selecting a Gregorian `dateKey` with the calendar picker immediately synchronizes `malayalamMonth`, `malayalamDay`, and `malayalamYear` using the Kollavarsham converter. Existing annual/custom recurrence values are preserved.
- Search across schedule fields or use **Needs review** to show rows with schema issues. The status pill and review links navigate to a field requiring attention.
- Add a row to the currently selected poster. Delete a row using its trash icon; the notification offers a short-lived Undo action.
- **Download .xlsx** validates the complete batch, including rows hidden by search or review filters. Resolve validation issues before exporting. The workbook contains one `Schedule` sheet and exactly the 16 import columns, with no internal row or poster identifiers.
- **Start a new batch** clears the current locally saved batch after confirmation. Export first if you need to retain the schedule.

## How the app learns from your reviews

OCR and the parsing rules do not change by themselves; the app learns from reviewed work, stored only in this browser:

- **Corrections:** editing an OCR venue or Theyyam cell remembers *OCR text → your value*. It is reused when a later poster's OCR text is the same or sounds the same (for example `വിഷകുണ്ഠൻ ക്ഷേത്രം` ≈ `വിഷകണ്ഠൻ ക്ഷേത്രം`).
- **Words:** correcting a Theyyam name also teaches its unknown words when they line up and sound alike (`കുറി ഗുളികൻ തെയ്യം` → `Kuri Gulikan Theyyam` teaches `കുറി` = Kuri). New labels containing those words are then translated, and taught names count as performances.
- **Approved names:** **Download .xlsx** adds the exported venues (with their OCR spellings) and Theyyam names to a reference list; sample posters are excluded. A new poster's partial venue is filled in automatically when exactly one known venue matches all its name fragments; otherwise the matches appear first in **Find venue**, without needing a search key. **Help → Import venue list** adds names from a CSV or Excel file (a `venue` column, or the first column).
- **Help → Clear everything learned** removes all of the above. Limits: 500 corrections, 1,000 words, 1,000 venues, 500 Theyyam names.

## Find venue online

Decorative headings often leave OCR with only part of the venue name. **Find venue** on an uploaded poster builds a Malayalam and an English search from the partial venue and nearby heading fragments, such as `കൊളച്ചേരി ശ്രീ ചാത്തമ്പ` + `വിഷകണ്ഠൻ ക്ഷേത്രം`. It searches the web, lists the temple names found in the results with their source links, and ranks them by phonetic match with the poster. You choose or edit the name, and it is applied to all of that poster's rows. It is also remembered as a venue correction.

Setup (Brave Search API; Google's Custom Search JSON API no longer accepts new customers):

1. Create a key at https://brave.com/search/api/ (check the current free allowance and pricing).
2. Copy `.env.example` to `.env.local` and set `BRAVE_SEARCH_API_KEY=…`.
3. Restart `npm run dev` (or `npm run build && npx vite preview`).

The key is read only by the local Vite server (`server/braveSearch.ts`, endpoint `/api/venue-search`) and is never included in the page bundle, as Brave requires. Only the two search texts are sent to Brave; poster images and schedules are not. On Netlify the same endpoint is a Netlify Function (see **Deploy to Netlify**). Other static hosting of `dist/` has no such endpoint, so the button reports that search is not set up.

## Storage and privacy

Poster decoding, OCR, parsing, validation, and Excel generation run in the browser. Uploaded poster contents are not sent to an OCR API. The browser fetches the application's code, fonts, worker, and recognition assets from the application host.

Rows, poster previews, and extracted text are saved in IndexedDB for this browser and origin. Saving is debounced; wait for **Saved locally** before closing the tab. These drafts are not synchronized between browsers, devices, or accounts. Browser site-data deletion, private browsing, storage limits, or a changed deployment origin can make saved work unavailable. The application reports local-save failures; export a spreadsheet to keep a separate copy.

New uploads retain the original file in this browser so Reanalyze can use the best available source. Older uploads created before this feature retain only their rendered preview and extracted text, so their Reanalyze action uses the preview and may be less accurate. Keep the original poster files separately. A multi-page PDF currently has a preview of its first page; the extracted-text view contains text from all processed pages. Review later pages against your original PDF.

## Extraction and manual review

OCR produces draft candidates, not verified schedule facts. Recognition is affected by image quality, decorative fonts, multi-column layouts, and Malayalam text quality. Digital PDFs use embedded text when available and otherwise use OCR.

The parser recognizes common English and Malayalam Theyyam names and can also extract an unfamiliar Malayalam label from a timed schedule line. It understands Malayalam day-part words such as `രാവിലെ`, `ഉച്ചയ്ക്ക്`, `വൈകിട്ട്`, and `രാത്രി`, including dot-separated times such as `5.30`. Festival titles are retained in `description`. When a valid Gregorian date is found, the official `kollavarsham` package converts it to the Malayalam month, day, and year using the Surya Siddhanta system and Kerala coordinates. Explicit Malayalam calendar text on the poster remains the primary evidence when it is present. Unrecognized or ambiguous required details remain blank for manual completion. If no candidates are found, the poster can still be reviewed and rows added manually.

When a reviewer corrects an OCR-extracted `venue` or `theyyam` cell and leaves the cell, the exact normalized source text and reviewed value are remembered locally. The next upload containing that same source text in the same field uses the correction. Venue and Theyyam mappings are isolated, reconfirmations raise their confidence count, and conflicting reviews replace the prior value rather than accumulating unsafe alternatives. The Help dialog shows the number of learned corrections and provides a confirmed reset action. This bounded correction memory keeps up to 500 mappings in the current browser; it never learns blank/manual rows, dates, times, or unreviewed OCR output and does not synchronize corrections to other users. See [`docs/malayalam-poster-extraction.md`](docs/malayalam-poster-extraction.md) for the reviewed domain rules and learning policy.

The parser first looks for temple and venue terms such as `ക്ഷേത്രം`, `കാവ്`, `ദേവസ്ഥാനം`, `മടപ്പുര`, and related forms. For cropped multi-panel schedules without one of those suffixes, it conservatively selects a nearby Malayalam heading while rejecting dates, event titles, times, and performance labels. Saved OCR text is rechecked after upgrades so an unambiguous newly detected venue can repair an existing blank row. Check multi-venue documents and date changes carefully. Identical recognized name/date/time candidates are deduplicated; repeated performances with incomplete timing may need to be added manually. Recurrence, performer information, descriptions, and other optional details require review or manual entry. A schema-valid row can still contain an OCR mistake, so compare every schedule with its source before publishing or importing it elsewhere.

## Import contract and validation

Headers are exported in this exact order:

```text
venue,theyyam,malayalamMonth,malayalamDay,malayalamYear,dateKey,start,end,timeCertainty,recurrence,recurrenceInterval,duration,performer,status,description,highlights
```

| Field | Rules |
| --- | --- |
| `venue` | Required text. |
| `theyyam` | Required text. |
| `malayalamMonth` | Required: `chingam`, `kanni`, `thulam`, `vrischikam`, `dhanu`, `makaram`, `kumbham`, `meenam`, `medam`, `edavam`, `mithunam`, `karkidakam`. |
| `malayalamDay` | Required whole number, 1–32. |
| `malayalamYear` | Required four-digit whole number, 1000–9999, such as `1201`. |
| `dateKey` | Optional valid calendar date in `YYYY-MM-DD` format. |
| `start` | `HH:MM` in 24-hour time. Required for `exact`, `approximate`, or `range` certainty. |
| `end` | `HH:MM` in 24-hour time. Required for `range` certainty. Overnight ranges are permitted. |
| `timeCertainty` | Required: `exact`, `approximate`, `range`, `unknown`. With `unknown`, both times may be blank. |
| `recurrence` | Required: `one_time`, `annual`, `n_yearly`, `none`. |
| `recurrenceInterval` | Whole number, 2–24, when supplied; required for `n_yearly`. |
| `duration` | Optional text. |
| `performer` | Optional text. |
| `status` | Required: `draft`, `pending`, `verified`, `published`, `cancelled`. |
| `description` | Optional text. |
| `highlights` | Optional text, with multiple highlights separated by `|`. |

Numeric fields use numeric Excel cells. Dates and times retain the schema's string format. All other values use explicit text cells, so user content beginning with `=` or similar characters is not emitted as an Excel formula.

## Verification

```sh
npm test
npm run build
```

Automated tests cover the initial sample batch, required values and enums, numeric/date/time boundaries, Gregorian-to-Malayalam calendar conversion, conditional recurrence and time rules, overnight ranges, the exact XLSX header order and roundtrip types, formula-like text, and conservative English/Malayalam extraction behavior.

Suggested browser smoke checks:

1. Confirm the initial batch has three posters, 36 rows, and one field needing review. Navigate to the issue and enter `Raktha Chamundi` in row 18.
2. Scroll to another poster and verify the associated rows are highlighted. Click a row belonging to a different poster and verify that source card comes into view.
3. Add and edit a row, try an invalid day or time, and confirm export offers a review dialog. Correct the fields, delete the added row, and test Undo.
4. Export and open the workbook in Excel or another compatible spreadsheet app. Confirm the 16 headers, expected row count, Malayalam text, and preserved date/time formats.
5. Make an edit, wait for **Saved locally**, reload, and confirm the edit remains.
6. Upload a clear English image, a Malayalam image, and a PDF. Compare the draft rows and extracted text with the source; verify that missing information remains editable.
7. Try an unsupported file, an oversized file, and cancellation. Confirm clear feedback and that another upload can be started afterward.
8. Check a narrow viewport using **Show posters / Show schedule**, and verify horizontal grid scrolling, keyboard editing, and dialog controls.

## Source map

- `src/App.tsx`: interface, batch state, source linking, upload orchestration, and local saving.
- `src/schema.ts`: exact field contract, validation, sample rows, and XLSX creation.
- `src/ocr.ts`: file checks, image/PDF rendering, OCR, cancellation, and resource cleanup.
- `src/parser.ts`: conservative text-to-schedule extraction.
- `src/calendar.ts`: Gregorian-to-Kollavarsham conversion and schema month mapping.
- `src/learning.ts`: browser-local, reviewer-confirmed correction memory.
- `src/knowledge.ts`: learned words and approved venue/Theyyam names; `src/phonetic.ts`: Malayalam/English sound-alike matching; `src/text.ts`: OCR text normalization.
- `src/venueSearch.ts`, `src/VenueSearchPanel.tsx`, `server/braveSearch.ts`: online venue lookup.
- `docs/malayalam-poster-extraction.md`: reviewed Malayalam vocabulary and extraction policy.
- `src/styles.css`: responsive workspace styling.
- `public/posters/`: labeled sample posters.
- `public/ocr/`: locally served recognition and PDF assets.
