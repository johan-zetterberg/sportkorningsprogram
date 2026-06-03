const fs = require('fs');

const path = 'c:\\Users\\johan\\OneDrive - Lund University\\Privat\\Sportkorningsprogram\\js\\pages\\dressage\\dressyr-admin.js';
let content = fs.readFileSync(path, 'utf8');

// Find the string to replace
const badContentStart = `// ---- Heuristik flyttad till dressageUtils.js ----`;
const badContentEnd = `  const doc = await pdfjs.getDocument({ data: buf }).promise;`;

const indexStart = content.indexOf(`  const doc = await pdfjs.getDocument({ data: buf }).promise;`);
if (indexStart !== -1) {
  // It starts right after the end of renderSelectedProgramInfo
  const indexFunctionEnd = content.indexOf(`    </div>
  \`;
}`);

  if (indexFunctionEnd !== -1) {
    const endPos = indexFunctionEnd + `    </div>
  \`;
}`.length;

    const correctBlock = `

// ---- Heuristik flyttad till dressageUtils.js ----

function __validateMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return false;
  for (const [klass, program] of Object.entries(mapping)) {
    if (!klass || typeof klass !== 'string') return false;
    if (!program || typeof program !== 'string') return false;
  }
  return true;
}

async function loadGlobalPrograms() {
  // 0) Om redan på fönstret
  if (window.dressagePrograms && Object.keys(window.dressagePrograms).length) {
    return window.dressagePrograms;
  }
  // 1) Försök importera från vanliga sökvägar
  const candidates = [
    '../../data/dressagePrograms.js',
    '/js/data/dressagePrograms.js'
  ];
  for (const url of candidates) {
    try {
      const mod = await import(url);
      const obj = mod.default || mod.dressagePrograms;
      if (obj && typeof obj === 'object' && Object.keys(obj).length) {
        return obj;
      }
    } catch (_) { /* prova nästa */ }
  }
  // 2) Inget hittades – lämna tomt
  return {};
}

// ---- PDF.js (dynamisk import när behövs) ----
async function ensurePdfJs() {
  const lib = window.pdfjsLib;
  if (!lib || !lib.getDocument) {
    throw new Error('PDF.js saknas (kolla index.html-import av pdf.mjs och worker .mjs).');
  }
  return lib;
}

async function extractPdfText(file) {
  const pdfjs = await ensurePdfJs();
  const buf = await file.arrayBuffer();`;

    const before = content.substring(0, endPos);
    const after = content.substring(indexStart);
    fs.writeFileSync(path, before + correctBlock + "\n" + after);
    console.log("File fixed successfully.");
  }
}
