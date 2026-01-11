// Förutsätter att jsPDF redan finns i sidan (t.ex. via <script src="...jspdf.umd.min.js">)
const { jsPDF } = window.jspdf || {};

if (!jsPDF) {
  console.error('[pdf/core] jsPDF saknas. Lägg in UMD-bundlen före detta script.');
}

export function createDoc(opts = {}) {
  const doc = new jsPDF({
    orientation: opts.orientation || 'portrait',
    unit: 'mm',
    format: opts.format || 'a4',
    compressPdf: true
  });
  return doc;
}

export function saveDoc(doc, filename = 'rapport.pdf') {
  doc.save(filename);
}

export function mmText(doc, x, y, text, opt = {}) {
  doc.setFont(opt.font || 'helvetica', opt.style || 'normal');
  doc.setFontSize(opt.size || 10);
  if (opt.align) doc.text(text, x, y, { align: opt.align });
  else doc.text(text, x, y);
}

export function line(doc, x1, y1, x2, y2) {
  doc.line(x1, y1, x2, y2);
}
