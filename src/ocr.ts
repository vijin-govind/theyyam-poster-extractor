import type { Row } from './schema';
import { parsePosterRegions } from './parser';
import { loadLearnedCorrections } from './learning';
import { confidentVenue, loadKnowledge, matchKnownVenues } from './knowledge';
import { venueQuery } from './venueSearch';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;
export const ACCEPTED_FILE_TYPES = '.jpg,.jpeg,.png,.webp,.pdf';

export interface ExtractionResult {
  previewBlob: Blob;
  rawText: string;
  candidates: Partial<Row>[];
}

/** Fast upload validation. File signatures are checked again before decoding. */
export function validatePosterFile(file: File): string | null {
  if (!file.size) return 'This file is empty. Choose a poster image or PDF.';
  if (file.size > MAX_FILE_BYTES) return 'Each poster must be 20 MB or smaller.';
  const knownType = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type);
  const knownExtension = /\.(jpe?g|png|webp|pdf)$/i.test(file.name);
  if (!knownType && !knownExtension) return 'Choose a JPG, PNG, WebP, or PDF file.';
  return null;
}

function identifyFile(bytes: Uint8Array): 'pdf' | 'image' {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  if (jpeg || png || webp) return 'image';
  throw new Error('The file contents are not a supported image or PDF. Please export the poster as JPG, PNG, WebP, or PDF.');
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create a poster preview.')), 'image/jpeg', quality);
  });
}

function makeCanvas(width: number, height: number, maximum = 3200): HTMLCanvasElement {
  // Bound canvas memory for high-resolution scans and oversized PDF pages.
  const scale = Math.min(1, maximum / Math.max(width, height), Math.sqrt(8_000_000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

function improveSmallPosterForOCR(source: HTMLCanvasElement): HTMLCanvasElement {
  const longest = Math.max(source.width, source.height);
  if (longest >= 1600) return source;
  const scale = Math.min(3, 1800 / longest);
  const canvas = makeCanvas(source.width * scale, source.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return source;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  // Decorative social-media posters often have small Malayalam lettering over
  // saturated backgrounds. Grayscale plus moderate contrast gives Tesseract
  // cleaner character edges without hard-thresholding away light text.
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = 0.2126 * image.data[index] + 0.7152 * image.data[index + 1] + 0.0722 * image.data[index + 2];
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
    image.data[index] = image.data[index + 1] = image.data[index + 2] = contrasted;
  }
  context.putImageData(image, 0, 0);
  source.width = source.height = 0;
  return canvas;
}

function makeLandscapeRegions(source: HTMLCanvasElement): HTMLCanvasElement[] {
  if (source.width / source.height < 1.15) return [];
  const columns = 3;
  const rows = 2;
  const overlap = 0.08;
  const regions: HTMLCanvasElement[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const baseWidth = source.width / columns;
      const baseHeight = source.height / rows;
      const sx = Math.max(0, column * baseWidth - baseWidth * overlap);
      const sy = Math.max(0, row * baseHeight - baseHeight * overlap);
      const right = Math.min(source.width, (column + 1) * baseWidth + baseWidth * overlap);
      const bottom = Math.min(source.height, (row + 1) * baseHeight + baseHeight * overlap);
      const width = Math.max(1, Math.round(right - sx));
      const height = Math.max(1, Math.round(bottom - sy));
      const region = makeCanvas(width, height);
      const context = region.getContext('2d');
      if (!context) continue;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, region.width, region.height);
      context.drawImage(source, sx, sy, width, height, 0, 0, region.width, region.height);
      regions.push(improveSmallPosterForOCR(region));
    }
  }
  return regions;
}

async function previewFromCanvas(source: HTMLCanvasElement): Promise<Blob> {
  const canvas = makeCanvas(source.width, source.height, 1500);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create an image preview.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  canvas.width = canvas.height = 0;
  return blob;
}

/**
 * Recognizes English and Malayalam entirely in the browser. Language data and
 * WASM workers are hosted with this app; poster contents never leave the device.
 */
export async function extractPoster(
  file: File,
  onProgress: (progress: number, label: string) => void,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const validation = validatePosterFile(file);
  if (validation) throw new Error(validation);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 300_000);
  let worker: import('tesseract.js').Worker | undefined;
  let pdf: import('pdfjs-dist').PDFDocumentProxy | undefined;
  let loadingTask: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  let activeCanvas: HTMLCanvasElement | undefined;
  let imageCanvases: HTMLCanvasElement[] = [];
  let imageBitmap: ImageBitmap | undefined;
  const abortError = () => timedOut
    ? new Error('Extraction took too long. Try a smaller image or split the PDF into fewer pages.')
    : new DOMException('Extraction cancelled.', 'AbortError');

  function ensureActive() {
    if (controller.signal.aborted) throw abortError();
  }
  async function interruptible<T>(promise: Promise<T>): Promise<T> {
    ensureActive();
    let listener: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      listener = () => reject(abortError());
      controller.signal.addEventListener('abort', listener, { once: true });
    });
    try { return await Promise.race([promise, interrupted]); }
    finally { controller.signal.removeEventListener('abort', listener); }
  }

  let pageIndex = 0;
  let pageCount = 1;
  try {
    ensureActive();
    onProgress(1, 'Reading poster');
    const bytes = new Uint8Array(await interruptible(file.arrayBuffer()));
    const kind = identifyFile(bytes);
    let firstPreview: Blob | undefined;
    let pdfjs: typeof import('pdfjs-dist') | undefined;

    if (kind === 'pdf') {
      onProgress(3, 'Opening PDF');
      const [module, workerAsset] = await interruptible(Promise.all([
        import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]));
      pdfjs = module;
      pdfjs.GlobalWorkerOptions.workerSrc = workerAsset.default;
      loadingTask = pdfjs.getDocument({
        data: bytes,
        cMapUrl: '/ocr/pdf-assets/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/ocr/pdf-assets/standard_fonts/',
        wasmUrl: '/ocr/pdf-assets/wasm/',
      });
      pdf = await interruptible(loadingTask.promise);
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`This PDF contains ${pdf.numPages} pages. Upload a PDF with ${MAX_PDF_PAGES} pages or fewer.`);
      pageCount = pdf.numPages;
    } else {
      imageBitmap = await interruptible(createImageBitmap(file));
      activeCanvas = makeCanvas(imageBitmap.width, imageBitmap.height);
      const context = activeCanvas.getContext('2d');
      if (!context) throw new Error('Your browser could not open this poster.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, activeCanvas.width, activeCanvas.height);
      context.drawImage(imageBitmap, 0, 0, activeCanvas.width, activeCanvas.height);
      imageBitmap.close();
      imageBitmap = undefined;
      firstPreview = await interruptible(previewFromCanvas(activeCanvas));
      activeCanvas = improveSmallPosterForOCR(activeCanvas);
      imageCanvases = [activeCanvas, ...makeLandscapeRegions(activeCanvas)];
      pageCount = imageCanvases.length;
      activeCanvas = undefined;
    }

    onProgress(5, 'Loading English + Malayalam recognition');
    const { createWorker, PSM } = await interruptible(import('tesseract.js'));
    const pendingWorker = createWorker(['eng', 'mal'], 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr',
      langPath: '/ocr',
      workerBlobURL: false,
      gzip: true,
      logger: message => {
        if (controller.signal.aborted) return;
        if (message.status === 'recognizing text') {
          const percent = Math.round(15 + 80 * (pageIndex + message.progress) / pageCount);
          onProgress(percent, pageCount > 1 ? `Reading page ${pageIndex + 1} of ${pageCount}` : 'Reading poster text');
        }
      },
      errorHandler: () => {},
    }).then(async createdWorker => {
      if (controller.signal.aborted) {
        await createdWorker.terminate();
        throw abortError();
      }
      worker = createdWorker;
      return createdWorker;
    });
    await interruptible(pendingWorker);
    await interruptible(worker!.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    }));
    ensureActive();
    const pageTexts: string[] = [];

    for (pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      ensureActive();
      if (pdf) {
        onProgress(Math.round(15 + 80 * pageIndex / pageCount), `Opening page ${pageIndex + 1} of ${pageCount}`);
        const page = await interruptible(pdf.getPage(pageIndex + 1));
        const baseViewport = page.getViewport({ scale: 2 });
        activeCanvas = makeCanvas(baseViewport.width, baseViewport.height);
        const viewport = page.getViewport({ scale: 2 * activeCanvas.width / baseViewport.width });
        const context = activeCanvas.getContext('2d');
        if (!context) throw new Error('Your browser could not render this PDF page.');
        const renderTask = page.render({ canvas: activeCanvas, canvasContext: context, viewport });
        const cancelRender = () => renderTask.cancel();
        controller.signal.addEventListener('abort', cancelRender, { once: true });
        try { await interruptible(renderTask.promise); }
        finally { controller.signal.removeEventListener('abort', cancelRender); }
        if (!firstPreview) firstPreview = await interruptible(previewFromCanvas(activeCanvas));
        // Embedded text is generally more accurate than OCR for digital PDFs.
        const embedded = await interruptible(page.getTextContent());
        const text = embedded.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('');
        if (text.trim().length > 40 && /[a-z\u0d00-\u0d7f]/i.test(text)) {
          pageTexts.push(text);
          activeCanvas.width = activeCanvas.height = 0;
          activeCanvas = undefined;
          page.cleanup();
          continue;
        }
        page.cleanup();
      } else {
        activeCanvas = imageCanvases[pageIndex];
      }
      if (!activeCanvas || !worker) throw new Error('The poster could not be prepared for extraction.');
      const result = await interruptible(worker.recognize(activeCanvas));
      pageTexts.push(result.data.text);
      activeCanvas.width = activeCanvas.height = 0;
      activeCanvas = undefined;
    }

    ensureActive();
    if (!firstPreview) throw new Error('No readable pages were found in this poster.');
    onProgress(98, 'Preparing performances for review');
    const rawText = pageTexts.map((text, index) => `--- OCR region ${index + 1} ---\n${text}`).join('\n\n');
    const learned = loadLearnedCorrections();
    // Image text is the full poster followed by overlapping tiles of it; PDF text is separate pages.
    const knowledge = loadKnowledge();
    const candidates = parsePosterRegions(pageTexts, learned, kind !== 'pdf', knowledge);
    // Fill a partial OCR venue from venues you have approved before, when one clearly matches.
    for (const sourceVenue of new Set(candidates.map(row => row.sourceVenue || ''))) {
      const rows = candidates.filter(row => (row.sourceVenue || '') === sourceVenue && row.venue === sourceVenue);
      if (!rows.length) continue;
      const known = confidentVenue(matchKnownVenues(sourceVenue, venueQuery(rawText, sourceVenue).hints, knowledge));
      if (known) rows.forEach(row => { row.venue = known; });
    }
    onProgress(100, 'Ready for review');
    return { previewBlob: firstPreview, rawText, candidates };
  } catch (error) {
    if (controller.signal.aborted) throw abortError();
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    if (/password/i.test(message)) throw new Error('This PDF is password protected. Upload an unlocked copy.');
    if (/fetch|network|load|worker/i.test(message)) throw new Error('The recognition engine could not load. Check your connection and retry.');
    throw error instanceof Error ? error : new Error('The poster could not be read. Try a clearer image.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    imageBitmap?.close();
    if (activeCanvas) activeCanvas.width = activeCanvas.height = 0;
    imageCanvases.forEach(canvas => { canvas.width = canvas.height = 0; });
    await worker?.terminate().catch(() => {});
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}
