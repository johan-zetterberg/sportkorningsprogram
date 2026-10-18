// js/pdf/pdfFonts.js
// Unicode font for every PDF. jsPDF's built-in fonts (helvetica etc.) only
// know WinAnsi, so names like Łukasz, Řehoř or Őrsi came out garbled.
// Noto Sans 2.015 (SIL Open Font License 1.1, see lib/fonts/OFL.txt) from
// github.com/notofonts, subset with fontTools to Latin, Latin Extended A/B and
// Additional, Greek, Cyrillic and common punctuation/symbols (no hinting, no
// layout tables: jsPDF uses neither). Loaded only when a PDF is made, and
// precached by the service worker so PDFs work without signal.

export const PDF_FONT_NAME = 'NotoSans';
export const PDF_FALLBACK_FONT_NAME = 'helvetica';
export const PDF_FONT_FILES = Object.freeze({
  normal: '/lib/fonts/NotoSans-Regular.ttf',
  bold: '/lib/fonts/NotoSans-Bold.ttf'
});

// jsPDF style -> font file. There is no italic cut: italic text uses the
// upright face (an unregistered style would fall back to WinAnsi Times)
const STYLE_FILES = Object.freeze({
  normal: 'normal',
  bold: 'bold',
  italic: 'normal',
  bolditalic: 'bold'
});

/** Whether the bytes start like a TrueType font (0x00010000 or 'true') */
export function isTrueTypeFont(buffer) {
  if (!buffer || buffer.byteLength < 12) return false;
  const bytes = new Uint8Array(buffer, 0, 4);
  const isTtf = bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0;
  const isTrue = String.fromCharCode(...bytes) === 'true';
  return isTtf || isTrue;
}

/** Base64 of an ArrayBuffer (jsPDF's virtual file system takes base64) */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchPdfFontData(fetchImpl) {
  const entries = await Promise.all(Object.entries(PDF_FONT_FILES).map(async ([style, url]) => {
    const res = await fetchImpl(url);
    if (!res || !res.ok) throw new Error(`${url}: HTTP ${res?.status}`);
    const buffer = await res.arrayBuffer();
    if (!isTrueTypeFont(buffer)) throw new Error(`${url}: not a TrueType font`);
    return [style, arrayBufferToBase64(buffer)];
  }));
  return Object.fromEntries(entries);
}

let fontDataPromise = null;

/**
 * The font files as base64 ({ normal, bold }), fetched once and cached.
 * Resolves to null when they cannot be loaded: the PDF then uses helvetica.
 */
export function loadPdfFontData({ fetchImpl = globalThis.fetch } = {}) {
  if (!fontDataPromise) {
    fontDataPromise = (async () => {
      if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
      return fetchPdfFontData(fetchImpl);
    })().catch(err => {
      console.warn('PDF: the Unicode font could not be loaded, using helvetica (names with ł, ř, ő etc. may print wrong):', err);
      // The next PDF tries again
      fontDataPromise = null;
      return null;
    });
  }
  return fontDataPromise;
}

/** Forgets the cached font (tests) */
export function resetPdfFontCache() {
  fontDataPromise = null;
}

/** The font a document should use: the Unicode font when it is loaded */
export function pickPdfFontName(fontData) {
  return fontData?.normal && fontData?.bold ? PDF_FONT_NAME : PDF_FALLBACK_FONT_NAME;
}

/**
 * Registers the font in one jsPDF document and makes it the default for text
 * and autoTable. Returns the font name in use; helvetica if anything fails.
 */
export function registerPdfFont(doc, fontData) {
  if (!doc || pickPdfFontName(fontData) !== PDF_FONT_NAME) return PDF_FALLBACK_FONT_NAME;
  try {
    doc.addFileToVFS(`${PDF_FONT_NAME}-normal.ttf`, fontData.normal);
    doc.addFileToVFS(`${PDF_FONT_NAME}-bold.ttf`, fontData.bold);
    for (const [style, file] of Object.entries(STYLE_FILES)) {
      doc.addFont(`${PDF_FONT_NAME}-${file}.ttf`, PDF_FONT_NAME, style);
    }
    doc.setFont(PDF_FONT_NAME, 'normal');
    // autoTable defaults to helvetica: the tables use the font too
    if (typeof doc.autoTableSetDefaults === 'function') {
      doc.autoTableSetDefaults({ styles: { font: PDF_FONT_NAME } });
    }
    return PDF_FONT_NAME;
  } catch (err) {
    console.warn('PDF: the Unicode font could not be registered, using helvetica:', err);
    try { doc.setFont(PDF_FALLBACK_FONT_NAME, 'normal'); } catch (_) { /* keep the default */ }
    return PDF_FALLBACK_FONT_NAME;
  }
}

let installedFontData = null;

/**
 * Every jsPDF document created after this call gets the font (jsPDF's
 * 'initialized' event), so no generator has to register it itself.
 */
export function installPdfFont(jsPDF, fontData) {
  if (!jsPDF?.API?.events || pickPdfFontName(fontData) !== PDF_FONT_NAME) return false;
  const alreadyInstalled = installedFontData !== null;
  installedFontData = fontData;
  if (!alreadyInstalled) {
    jsPDF.API.events.push(['initialized', function () {
      registerPdfFont(this, installedFontData);
    }]);
  }
  return true;
}

/** The font name a document is currently set to (for code that sets fonts by name) */
export function getPdfFontName(doc) {
  try {
    return doc?.getFont?.()?.fontName || PDF_FALLBACK_FONT_NAME;
  } catch (_) {
    return PDF_FALLBACK_FONT_NAME;
  }
}
