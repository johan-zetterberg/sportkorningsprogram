import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PDF_FONT_NAME,
  PDF_FALLBACK_FONT_NAME,
  PDF_FONT_FILES,
  arrayBufferToBase64,
  isTrueTypeFont,
  loadPdfFontData,
  resetPdfFontCache,
  pickPdfFontName,
  registerPdfFont,
  installPdfFont,
  getPdfFontName
} from '../js/pdf/pdfFonts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(url) {
  const bytes = readFileSync(path.join(ROOT, url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// fetch from the project folder, counting the requests
function projectFetch(counter = { calls: 0 }) {
  return async (url) => {
    counter.calls += 1;
    return { ok: true, status: 200, arrayBuffer: async () => readProjectFile(url) };
  };
}

function fakeDoc() {
  const calls = { vfs: [], fonts: [], setFont: [], defaults: null };
  return {
    calls,
    addFileToVFS: (name, data) => calls.vfs.push([name, data.length]),
    addFont: (file, name, style) => calls.fonts.push([file, name, style]),
    setFont: (name, style) => calls.setFont.push([name, style]),
    autoTableSetDefaults: (defaults) => { calls.defaults = defaults; },
    getFont: () => ({ fontName: calls.setFont.at(-1)?.[0] || 'helvetica' })
  };
}

// The PDF font must stay quiet in the test output
function silenceWarnings(fn) {
  return async () => {
    const original = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
      await fn(warnings);
    } finally {
      console.warn = original;
    }
  };
}

test('the vendored Noto Sans files are TrueType fonts with their OFL license', () => {
  for (const url of Object.values(PDF_FONT_FILES)) {
    const buffer = readProjectFile(url);
    assert.equal(isTrueTypeFont(buffer), true, url);
    // Subset: well below the full font (430 kB)
    assert.ok(buffer.byteLength < 200_000, `${url} is ${buffer.byteLength} bytes`);
  }
  const license = readFileSync(path.join(ROOT, 'lib/fonts/OFL.txt'), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test('the service worker precaches the PDF fonts (PDFs offline)', () => {
  const sw = readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  for (const url of Object.values(PDF_FONT_FILES)) {
    assert.ok(sw.includes(`abs('${url}')`), `${url} missing in urlsToCache`);
  }
});

test('isTrueTypeFont rejects HTML and short files', () => {
  assert.equal(isTrueTypeFont(new TextEncoder().encode('<!doctype html><html>').buffer), false);
  assert.equal(isTrueTypeFont(new Uint8Array([0, 1, 0]).buffer), false);
  assert.equal(isTrueTypeFont(null), false);
});

test('arrayBufferToBase64 matches Node base64, also for large buffers', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
  assert.equal(arrayBufferToBase64(bytes.buffer), Buffer.from(bytes).toString('base64'));
});

test('loadPdfFontData fetches the fonts once and caches them', async () => {
  resetPdfFontCache();
  const counter = { calls: 0 };
  const fetchImpl = projectFetch(counter);
  const first = await loadPdfFontData({ fetchImpl });
  const second = await loadPdfFontData({ fetchImpl });
  assert.equal(counter.calls, 2); // regular + bold, once
  assert.equal(first, second);
  assert.equal(Buffer.from(first.normal, 'base64').byteLength, readProjectFile(PDF_FONT_FILES.normal).byteLength);
  assert.equal(pickPdfFontName(first), PDF_FONT_NAME);
  resetPdfFontCache();
});

test('loadPdfFontData falls back (null, warning) and retries on the next PDF', silenceWarnings(async (warnings) => {
  resetPdfFontCache();
  const failing = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
  assert.equal(await loadPdfFontData({ fetchImpl: failing }), null);
  assert.equal(warnings.length, 1);

  // An HTML page instead of the font (offline fallback page) is no font either
  const html = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('<html>offline</html>').buffer });
  assert.equal(await loadPdfFontData({ fetchImpl: html }), null);

  const ok = await loadPdfFontData({ fetchImpl: projectFetch() });
  assert.ok(ok?.normal && ok?.bold);
  resetPdfFontCache();
}));

test('pickPdfFontName uses helvetica without font data', () => {
  assert.equal(pickPdfFontName(null), PDF_FALLBACK_FONT_NAME);
  assert.equal(pickPdfFontName({ normal: 'x' }), PDF_FALLBACK_FONT_NAME);
  assert.equal(pickPdfFontName({ normal: 'x', bold: 'y' }), PDF_FONT_NAME);
});

test('registerPdfFont registers all four styles and makes the font the table default', () => {
  const doc = fakeDoc();
  assert.equal(registerPdfFont(doc, { normal: 'AAAA', bold: 'BBBB' }), PDF_FONT_NAME);
  assert.deepEqual(doc.calls.vfs.map(([name]) => name), ['NotoSans-normal.ttf', 'NotoSans-bold.ttf']);
  assert.deepEqual(doc.calls.fonts.map(([, , style]) => style).sort(), ['bold', 'bolditalic', 'italic', 'normal']);
  // No italic cut: italic uses the upright faces
  assert.deepEqual(doc.calls.fonts.find(([, , style]) => style === 'italic')[0], 'NotoSans-normal.ttf');
  assert.deepEqual(doc.calls.setFont.at(-1), [PDF_FONT_NAME, 'normal']);
  assert.deepEqual(doc.calls.defaults, { styles: { font: PDF_FONT_NAME } });
  assert.equal(getPdfFontName(doc), PDF_FONT_NAME);
});

test('registerPdfFont keeps helvetica when the font is missing or jsPDF rejects it', silenceWarnings(async (warnings) => {
  const doc = fakeDoc();
  assert.equal(registerPdfFont(doc, null), PDF_FALLBACK_FONT_NAME);
  assert.equal(doc.calls.fonts.length, 0);

  const broken = fakeDoc();
  broken.addFont = () => { throw new Error('bad font'); };
  assert.equal(registerPdfFont(broken, { normal: 'A', bold: 'B' }), PDF_FALLBACK_FONT_NAME);
  assert.deepEqual(broken.calls.setFont.at(-1), [PDF_FALLBACK_FONT_NAME, 'normal']);
  assert.equal(warnings.length, 1);
  assert.equal(getPdfFontName(null), PDF_FALLBACK_FONT_NAME);
}));

test('installPdfFont hooks jsPDF once, so every new document gets the font', () => {
  const events = [];
  const jsPDF = { API: { events } };
  assert.equal(installPdfFont(jsPDF, null), false);
  assert.equal(installPdfFont(jsPDF, { normal: 'A', bold: 'B' }), true);
  assert.equal(installPdfFont(jsPDF, { normal: 'A', bold: 'B' }), true);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'initialized');

  // jsPDF calls the handler with the new document as this
  const doc = fakeDoc();
  events[0][1].call(doc);
  assert.deepEqual(doc.calls.setFont.at(-1), [PDF_FONT_NAME, 'normal']);
});
