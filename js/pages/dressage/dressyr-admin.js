// js/pages/dressyr-admin.js
// Dressyr-admin: (1) KlassÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢Program mapping-editor (typeahead) (2) PDF-import till dressagePrograms (overrides)
// KrÃƒÆ’Ã‚Â¤ver firestoreService.getConfig/saveConfig/getEquipages och global dressagePrograms fÃƒÆ’Ã‚Â¶r fÃƒÆ’Ã‚Â¶rhandsval.

import { getGlobalState } from '../../main.js';
import { getConfig } from '../../services/competitionService.js';
import { saveConfig } from '../../services/competitionService.js';
import { replaceConfig } from '../../services/competitionService.js';
import { listenForJudges } from '../../services/adminService.js';
import { getEquipages } from '../../services/equipageService.js';
import { guessProgramKeyFromClass } from '../../utils/dressageUtils.js';
import { getCompetitionHeader } from '../../ui/components.js';
import { formatDressageProgramOptionLabel, getDressageProgramTrNumber, sortDressageProgramKeys } from './dressageAdminProgramOptions.js';

let competitionId = null;
let allEquipages = [];
let programIndex = {};     // { key: {name, category, arena, movements:[{no,text,coeff}], ...} }
let mapping = {}; // ClassName -> ProgramKey
let mergedPrograms = {};
let mappingLocks = {};
let judgeMapping = {}; // ClassName -> { C: judgeId, ... }
let allJudges = [];        // FrÃƒÆ’Ã‚Â¥n admin-poolen
let dressageRules = {}; // { error1: 2, error2: 4, ... }
let classConfig = {}; // ClassName -> { clearRound: bool, limit: number }
let judgeListenerUnsub = null;


// ---- Helpers ----
const qs = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const normKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '');
const unique = a => Array.from(new Set(a));
const toNumber = v => Number.isFinite(+v) ? +v : 0;
const sortBy = (arr, f) => arr.slice().sort((a, b) => (f(a) > f(b) ? 1 : (f(a) < f(b) ? -1 : 0)));

function renderDressageAdminReadiness(root = document) {
  const container = qs('#dressageAdminReadiness', root);
  if (!container) return;

  const classes = unique(allEquipages.map(e => (e.className || e.klass || '').trim()).filter(Boolean)).sort();
  if (!classes.length) {
    container.className = 'rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100';
    container.innerHTML = '<div class="font-semibold">Inte klar ÃƒÆ’Ã‚Â¤nnu</div><div class="mt-1">Inga dressyrklasser hittades ÃƒÆ’Ã‚Â¤n. LÃƒÆ’Ã‚Â¤gg in ekipage fÃƒÆ’Ã‚Â¶rst.</div>';
    return;
  }

  const missingMappings = classes.filter(cls => !mapping[cls] || !mergedPrograms[mapping[cls]]);
  const missingJudges = classes.filter(cls => !judgeMapping[cls] || Object.keys(judgeMapping[cls] || {}).length === 0);
  const rulesReady = Number.isFinite(Number(dressageRules?.error1)) && Number.isFinite(Number(dressageRules?.error2));

  if (missingMappings.length || missingJudges.length || !rulesReady) {
    container.className = 'rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100';
    const parts = [];
    if (missingMappings.length) parts.push(`${missingMappings.length} klass${missingMappings.length === 1 ? '' : 'er'} saknar program`);
    if (missingJudges.length) parts.push(`${missingJudges.length} klass${missingJudges.length === 1 ? '' : 'er'} saknar domartilldelning`);
    if (!rulesReady) parts.push('regler/avdrag ÃƒÆ’Ã‚Â¤r inte satta');
    container.innerHTML = `<div class="font-semibold">Dressyradmin behÃƒÆ’Ã‚Â¶ver kompletteras</div><div class="mt-1">${esc(parts.join('. '))}.</div>`;
    return;
  }

  container.className = 'rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100';
  container.innerHTML = `<div class="font-semibold">Dressyradmin ser redo ut</div><div class="mt-1">${classes.length} klasser har program, domartilldelning och regler.</div>`;
}

function ensureDressageAdminResponsiveStyles() {
  if (document.getElementById('dressage-admin-responsive-styles')) return;

  const style = document.createElement('style');
  style.id = 'dressage-admin-responsive-styles';
  style.textContent = `
    @media (max-width: 640px) {
      .dressage-admin-section {
        padding: 0.85rem;
      }
      .dressage-admin-map-row {
        padding: 0.8rem;
      }
      .dressage-admin-cr-row {
        align-items: stretch;
      }
      .dressage-admin-cr-row .cr-limit-wrap {
        margin-left: 0;
        justify-content: space-between;
      }
    }
    @media (max-width: 1100px) and (orientation: landscape) and (max-height: 760px) {
      .dressage-admin-section,
      .dressage-admin-map-row {
        padding: 0.9rem;
      }
    }
  `;
  document.head.appendChild(style);
}

function renderProgramOptions(selectedKey = '') {
  const options = ['<option value="">-- VÃƒÆ’Ã‚Â¤lj dressyrprogram --</option>'];
  sortDressageProgramKeys(mergedPrograms).forEach((key) => {
    const selected = key === selectedKey ? ' selected' : '';
    options.push(`<option value="${esc(key)}"${selected}>${esc(formatDressageProgramOptionLabel(key, mergedPrograms[key]))}</option>`);
  });
  return options.join('');
}

function renderSelectedProgramInfo(key, program) {
  if (!key || !program) {
    return '<div class="text-xs text-amber-700 dark:text-amber-300">Inget giltigt program valt.</div>';
  }

  const trNumber = getDressageProgramTrNumber(program);
  const warn = program.verified === false
    ? '<span class="ml-2 text-xs text-amber-700 dark:text-amber-300">(Ej verifierat)</span>'
    : '';
  const meta = [
    trNumber ? `TR nr ${trNumber}` : '',
    program.version ? `Version ${program.version}` : '',
    program.arena || '',
    program.category || ''
  ].filter(Boolean).join(' Ãƒâ€šÃ‚Â· ');

  return `
    <div class="rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
      <div class="text-sm font-semibold text-gray-900 dark:text-white">${esc(program.name || key)}${warn}</div>
      <div class="text-xs text-gray-500 dark:text-gray-300 mt-0.5">${esc(meta || 'Programmetadata saknas')}</div>
      <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Intern nyckel: ${esc(key)}</div>
    </div>
  `;
}

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
  if (window.dressagePrograms && Object.keys(window.dressagePrograms).length) {
    return window.dressagePrograms;
  }
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
    } catch (_) { /* prova nÃƒÆ’Ã‚Â¤sta */ }
  }
  return {};
}

// ---- PDF.js (dynamisk import nÃƒÆ’Ã‚Â¤r behÃƒÆ’Ã‚Â¶vs) ----
async function ensurePdfJs() {
  const lib = window.pdfjsLib;
  if (!lib || !lib.getDocument) {
    throw new Error('PDF.js saknas (kolla index.html-import av pdf.mjs och worker .mjs).');
  }
  return lib;
}

async function extractPdfText(file) {
  const pdfjs = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const rows = []; // varje rad: [{x,y,str}, ...] sorterad pÃƒÆ’Ã‚Â¥ x
  const lines = []; // plain text fallback

  function norm(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // dÃƒÆ’Ã‚Â¶da diakriter
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function flushRow(row) {
    if (!row || row.chunks.length === 0) return;
    row.chunks.sort((a, b) => a.x - b.x);
    rows.push(row.chunks.map(c => ({ x: c.x, y: c.y, str: c.str })));
    const flat = row.chunks.map(c => c.str).join(' ').replace(/\s{2,}/g, ' ').trim();
    if (flat) lines.push(flat);
  }

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();

    let cur = { y: null, chunks: [] };
    const tol = 2.2; // px, rad-joins

    for (const it of tc.items) {
      const t = (it.str || '').trim();
      if (!t) continue;
      const tr = it.transform; const x = tr[4], y = tr[5];
      if (cur.y === null) cur.y = y;
      if (Math.abs(y - cur.y) > tol) { flushRow(cur); cur = { y, chunks: [] }; }
      cur.chunks.push({ x, y, str: it.str });
    }
    flushRow(cur);
  }

  // hitta header-raden: den som har bÃƒÆ’Ã‚Â¥de "Plats" & "RÃƒÆ’Ã‚Â¶relse" & "Att bedÃƒÆ’Ã‚Â¶ma"
  let headerCols = null;
  for (const r of rows) {
    const flat = norm(r.map(c => c.str).join(' ')).toLowerCase();
    if (flat.includes('plats') && (flat.includes('rorelse') || flat.includes('rÃƒÆ’Ã‚Â¶relse')) && flat.includes('bedoma')) {
      // hÃƒÆ’Ã‚Â¤mta start-x fÃƒÆ’Ã‚Â¶r respektive rubrikord
      let nrX = null, platsX = null, rorelseX = null, attX = null;
      for (const c of r) {
        const n = norm(c.str).toLowerCase();
        if ((n === 'nr' || n === 'nr.') && nrX === null) nrX = c.x;
        if (n.includes('plats') && platsX === null) platsX = c.x;
        if ((n.includes('rorelse') || n.includes('rÃƒÆ’Ã‚Â¶relse')) && rorelseX === null) rorelseX = c.x;
        if (n === 'att' && attX === null) attX = c.x;
        if (n.includes('bedoma') && attX === null) attX = c.x; // om "Att" saknas, ta "bedÃƒÆ’Ã‚Â¶ma"
      }
      // om "Nr" inte fanns pÃƒÆ’Ã‚Â¥ samma rad, fÃƒÆ’Ã‚Â¶rsÃƒÆ’Ã‚Â¶k hitta den i tidigare rader
      if (nrX === null) {
        for (const r2 of rows) {
          for (const c2 of r2) {
            const n2 = norm(c2.str).toLowerCase();
            if ((n2 === 'nr' || n2 === 'nr.') && nrX === null) { nrX = c2.x; break; }
          }
          if (nrX !== null) break;
        }
      }
      // sÃƒÆ’Ã‚Â¤ker fallback ifall nÃƒÆ’Ã‚Â¥got saknas: anvÃƒÆ’Ã‚Â¤nd vÃƒÆ’Ã‚Â¤nster/hÃƒÆ’Ã‚Â¶ger-most x
      const allX = r.map(c => c.x).sort((a, b) => a - b);
      const minX = allX[0], maxX = allX[allX.length - 1];
      nrX = nrX ?? minX;
      platsX = platsX ?? (nrX + 80);
      rorelseX = rorelseX ?? (platsX + 160);
      attX = attX ?? (rorelseX + 180);

      // skÃƒÆ’Ã‚Â¤rgrÃƒÆ’Ã‚Â¤nser som mittpunkt mellan start-x
      const starts = [nrX, platsX, rorelseX, attX].sort((a, b) => a - b);
      const cuts = [(starts[0] + starts[1]) / 2, (starts[1] + starts[2]) / 2, (starts[2] + starts[3]) / 2];
      headerCols = { starts, cuts };
      break;
    }
  }

  return { rows, headerCols, lines };
}

function bandIndexByCuts(x, cuts) {
  return (x < cuts[0]) ? 0 : (x < cuts[1]) ? 1 : (x < cuts[2]) ? 2 : 3;
}

function joinCells(parts) {
  // slÃƒÆ’Ã‚Â¥ ihop cellrader till en mening utan att tappa bokstÃƒÆ’Ã‚Â¤ver
  return parts.join(' ')
    .replace(/\s*-\s*\n?\s*/g, '')     // ev. hÃƒÆ’Ã‚Â¥rd avstavning
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// 1D k-means fÃƒÆ’Ã‚Â¶r kolumn-X (Nr | Plats | RÃƒÆ’Ã‚Â¶relse | Att)
function kmeans1D(xs, k = 4, iters = 15) {
  xs = xs.slice().sort((a, b) => a - b);
  if (xs.length < k) return null;
  const min = xs[0], max = xs[xs.length - 1];
  let cent = Array.from({ length: k }, (_, i) => min + (i + 1) / (k + 1) * (max - min));
  for (let t = 0; t < iters; t++) {
    const buckets = Array.from({ length: k }, () => []);
    for (const x of xs) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < k; i++) { const d = Math.abs(x - cent[i]); if (d < bd) { bd = d; bi = i; } }
      buckets[bi].push(x);
    }
    for (let i = 0; i < k; i++) {
      if (buckets[i].length) cent[i] = buckets[i].reduce((a, b) => a + b, 0) / buckets[i].length;
    }
  }
  cent.sort((a, b) => a - b);
  const cuts = []; // grÃƒÆ’Ã‚Â¤nser mellan kluster
  for (let i = 0; i < cent.length - 1; i++) cuts.push((cent[i] + cent[i + 1]) / 2);
  return { cent, cuts };
}

function detectColumnLayout(rows) {
  const xs = [];
  for (const r of rows) for (const c of r) xs.push(c.x);
  const res = kmeans1D(xs, 4, 20);
  if (!res) return null;
  const { cent, cuts } = res;

  // Labela banden med rubrikord om de finns; annars 0:Nr, 1:Plats, 2:RÃƒÆ’Ã‚Â¶relse, 3:Att
  const label = {};
  for (const r of rows) {
    for (const c of r) {
      const t = (c.str || '').toLowerCase();
      const idx = (c.x < cuts[0]) ? 0 : (c.x < cuts[1]) ? 1 : (c.x < cuts[2]) ? 2 : 3;
      if (t.includes('plats')) label.plats = idx;
      if (t.includes('rÃƒÆ’Ã‚Â¶relse') || t.includes('rorelse')) label.rorelse = idx;
      if (/\batt\b/.test(t) || t.includes('bedÃƒÆ’Ã‚Â¶ma') || t.includes('bedoma')) label.att = idx;
    }
  }
  if (label.nr == null) label.nr = 0;
  if (label.plats == null) label.plats = 1;
  if (label.rorelse == null) label.rorelse = 2;
  if (label.att == null) label.att = 3;

  function bandIndex(x) { return (x < cuts[0]) ? 0 : (x < cuts[1]) ? 1 : (x < cuts[2]) ? 2 : 3; }

  return { cuts, label, bandIndex };
}

// heuristik fÃƒÆ’Ã‚Â¶r att tolka ett svenskt program frÃƒÆ’Ã‚Â¥n text (robust mot kolumner/avstavning)
// Delar upp rader som innehÃƒÆ’Ã‚Â¥ller flera moment ("7. ... 8. ...") till separata
// --- [1] Rad-explosion: om en rad rÃƒÆ’Ã‚Â¥kar innehÃƒÆ’Ã‚Â¥lla "7. ... 8. ..." sÃƒÆ’Ã‚Â¥ dela upp den ---
function startsWithLower(s) { return /^[a-zÃƒÆ’Ã‚Â¥ÃƒÆ’Ã‚Â¤ÃƒÆ’Ã‚Â¶]/.test(String(s || '')); }

function chunkRowToCells(rowChunks, layout) {
  const { bandIndex, label } = layout;
  const raw = { 0: '', 1: '', 2: '', 3: '' };
  let nr = null;

  for (const c of rowChunks) {
    const t = (c.str || '').trim();
    if (!t) continue;
    if (/^\d{1,2}\.?$/.test(t) && nr === null) { nr = parseInt(t, 10); continue; }
    const idx = bandIndex(c.x);
    raw[idx] += (raw[idx] ? ' ' : '') + t;
  }
  return {
    nr,
    plats: (raw[label.plats] || '').trim(),
    rorelse: (raw[label.rorelse] || '').trim(),
    att: (raw[label.att] || '').trim()
  };
}

// --- [3] Huvudparsern: delar upp rader, tar ut plats ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ text i rÃƒÆ’Ã‚Â¤tt ordning, och flatten:ar som separata rader ---
function parseProgramFromExtract(ex) {
  const { rows, headerCols, lines } = ex || {};

  // rubrikinfo (fÃƒÆ’Ã‚Â¶r namn/arena uppe pÃƒÆ’Ã‚Â¥ sidan)
  let name = '', arena = '';
  for (let i = 0; i < Math.min(12, (lines || []).length); i++) {
    const s = (lines[i] || '').trim();
    if (/40\s*\*\s*80\s*m|40\s*x\s*80\s*m/i.test(s)) arena = '40x80';
    else if (/40\s*\*\s*100\s*m|40\s*x\s*100\s*m/i.test(s)) arena = '40x100';
    if (!name && /(Svenskt|FEI|MedelsvÃƒÆ’Ã‚Â¥rt|LÃƒÆ’Ã‚Â¤tt|Msv|KÃƒÆ’Ã‚Â¼r|Dressyr)/i.test(s)) name = s.replace(/\s{2,}/g, ' ').trim();
  }

  let metaSource = '';
  let metaVersion = '';

  if (!rows || !rows.length || !headerCols) {
    return { name: name || 'Nytt program', category: /FEI/i.test(name) ? 'FEI' : 'Svenskt', arena, movements: [] };
  }

  // 1) Mappa varje rad ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ celler enligt kolumnbanden
  const cells = rows.map(r => {
    let nr = null, plats = [], rorelse = [], att = [];
    for (const c of r) {
      const t = (c.str || '').trim();
      if (!t) continue;
      if (/^\d{1,2}\.?$/.test(t) && nr === null) { nr = parseInt(t, 10); continue; }
      const band = bandIndexByCuts(c.x, headerCols.cuts); // 0=Nr 1=Plats 2=RÃƒÆ’Ã‚Â¶relse 3=Att
      if (band === 1) plats.push(t);
      else if (band === 2) rorelse.push(t);
      else if (band === 3) att.push(t);
    }
    return {
      nr,
      plats: joinCells(plats),
      rorelse: joinCells(rorelse),
      att: joinCells(att)
    };
  });

  // Plocka "KÃƒÆ’Ã‚Â¤lla" + "Version/ÃƒÆ’Ã‚Â¥r" frÃƒÆ’Ã‚Â¥n raderna fÃƒÆ’Ã‚Â¶re fÃƒÆ’Ã‚Â¶rsta numrerade moment
  for (const c of cells) {
    if (c.nr != null) break; // sluta vid fÃƒÆ’Ã‚Â¶rsta momentet
    // Ex: RÃƒÆ’Ã‚Â¶relse: "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ Svenskt LÃƒÆ’Ã‚Â¤tt B", Att: "nr. 522 (2020)"
    const nameGuess = (c.rorelse || '').replace(/^[ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â-]\s*/, '').trim();
    const mYear = /(?:19|20)\d{2}/.exec(c.att || '');
    const mNr = /\b(?:nr|no)\.?\s*(\d{1,4})/i.exec(c.att || '');
    if (!metaSource && nameGuess) {
      metaSource = mNr ? `${mNr[1]}. ${nameGuess}` : nameGuess;
    }
    if (!metaVersion && mYear) {
      metaVersion = mYear[0];
    }
  }
  // Ta bort ev. kvarvarande "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" om inget nummer hittades
  metaSource = (metaSource || '').replace(/^\d+\.\s*ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â?\s*/, '').trim();

  // 2) Bygg momentblock: ett moment per nummer, hopslaget per kolumn
  const movements = [];
  let curNo = null, accPlats = [], accRorelse = [], accAtt = [];
  const flush = () => {
    if (curNo == null) return;

    const platsStr = accPlats.join(' ').replace(/\s{2,}/g, ' ').trim();
    const rorelseStr = accRorelse.join(' ').replace(/\s{2,}/g, ' ').trim();
    const attStr = accAtt.join(' ').replace(/\s{2,}/g, ' ').trim();

    // skapa EN rad per moment (sammanfogade kolumn-texter)
    if (curNo > 0 && (platsStr || rorelseStr || attStr)) {
      movements.push({
        no: curNo,
        letters: platsStr,
        text: rorelseStr,
        judge: attStr,
        coeff: 1
      });
    }

    curNo = null;
    accPlats = [];
    accRorelse = [];
    accAtt = [];
  };

  for (const c of cells) {
    if (c.nr != null) {
      flush();
      curNo = c.nr;
    }
    if (c.plats) accPlats.push(c.plats);
    if (c.rorelse) accRorelse.push(c.rorelse);
    if (c.att) accAtt.push(c.att);
  }
  flush();

  // 3) Rensa ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œAllmÃƒÆ’Ã‚Â¤nt intryckÃƒÂ¢Ã¢â€šÂ¬Ã‚Â-block och sortera
  const clean = movements.filter(m => Number.isFinite(m.no) && m.no >= 1);
  clean.sort((a, b) => a.no === b.no ? 0 : a.no - b.no);

  return {
    name: name || 'Nytt program',
    category: /FEI/i.test(name) ? 'FEI' : 'Svenskt',
    arena: arena || '',
    source: metaSource || '',         // <<ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â NYTT
    version: metaVersion || '',       // <<ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â NYTT
    movements: clean
  };
}

function render(root) {
  const competition = getGlobalState('currentCompetition');
  root.innerHTML = `
    <div class="p-4 md:p-6 max-w-6xl mx-auto">
      ${getCompetitionHeader(competition, 'Dressyr - Admin')}
      <div id="dressageAdminReadiness" class="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/20 dark:text-gray-300">
        Status laddas...
      </div>

      <!-- Sektion 1: Klass -> Program -->
      <div class="dressage-admin-section bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-md mb-6 border dark:border-gray-700">
        <h2 class="font-semibold text-lg mb-3 dark:text-white">Mapping: Klass ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Dressyrprogram</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          VÃƒÆ’Ã‚Â¤lj vilket program som gÃƒÆ’Ã‚Â¤ller fÃƒÆ’Ã‚Â¶r varje klass. SÃƒÆ’Ã‚Â¶k/skriv i fÃƒÆ’Ã‚Â¤ltet (typeahead). ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œAuto-fixÃƒÂ¢Ã¢â€šÂ¬Ã‚Â fÃƒÆ’Ã‚Â¶rsÃƒÆ’Ã‚Â¶ker gissa enligt vÃƒÆ’Ã‚Â¥ra svenska regler (LÃƒÆ’Ã‚Â¤tt A/B/C, MSV 3/4, osv).
        </p>

        <!-- Verktygsrad fÃƒÆ’Ã‚Â¶r mapping -->
        <div class="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 mb-4">
          <input id="classFilter" class="border rounded px-3 py-2 w-full lg:max-w-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Filtrera klasser (t.ex. LÃƒÆ’Ã‚Â¤tt A, Ponny, Enbet)ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" />
          <div class="lg:ml-auto grid grid-cols-1 sm:grid-cols-2 gap-2 w-full lg:w-auto">
            <button id="btnAutoFixMapping" class="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm">Auto-fix mapping</button>
            <button id="btnSaveMapping" class="px-3 py-2 rounded bg-brand-darkblue text-white hover:bg-brand-gold hover:text-brand-darkblue shadow-sm dark:bg-blue-600 dark:hover:bg-blue-500">Spara mapping</button>
          </div>
        </div>

        <!-- Datalist med programnycklar (typeahead) -->
        <datalist id="programKeysList">
          ${Object.keys(mergedPrograms).sort().map(k => `<option value="${esc(k)}">${esc(mergedPrograms[k].name || k)}</option>`).join('')}
        </datalist>

        <!-- HÃƒÆ’Ã‚Â¤r renderas raderna: Klass | [input fÃƒÆ’Ã‚Â¶r program-nyckel] | Nyckel -->
        <div id="mappingTable" class="space-y-2"></div>

      <div id="mapSaved" class="text-sm text-emerald-700 dark:text-emerald-400 mt-3"></div>
      </div>

      <!-- Sektion 1.5: Domare & Regler -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <!-- Domartilldelning -->
        <div class="dressage-admin-section bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-md border dark:border-gray-700">
          <h2 class="font-semibold text-lg mb-3 dark:text-white">Tilldela Domare</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Vilka domare dÃƒÆ’Ã‚Â¶mer vilken klass?</p>
          
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1 dark:text-gray-300">VÃƒÆ’Ã‚Â¤lj klass</label>
            <select id="judgeClassSelect" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white">
              <option value="">-- VÃƒÆ’Ã‚Â¤lj klass --</option>
            </select>
          </div>

          <div id="judgeAssignmentArea" class="hidden space-y-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded border dark:border-gray-600">
            <!-- HÃƒÆ’Ã‚Â¤r renderas positionerna (C, E, etc.) -->
          </div>
          
          <div class="mt-4 flex flex-col sm:flex-row gap-2">
             <button id="btnSaveJudgeMapping" class="px-3 py-2 rounded bg-brand-darkblue text-white text-sm shadow-sm dark:bg-blue-600 dark:hover:bg-blue-500">Spara tilldelning</button>
             <span id="judgeMapMsg" class="text-sm text-emerald-700 dark:text-emerald-400 self-center"></span>
          </div>

          <div id="judgeSummaryArea" class="mt-6 pt-4 border-t dark:border-gray-700">
             <!-- Assigned classes summary list renders here -->
          </div>
        </div>

        <!-- Regler -->
        <div class="dressage-admin-section bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-md border dark:border-gray-700">
          <h2 class="font-semibold text-lg mb-3 dark:text-white">Regler & Avdrag</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">InstÃƒÆ’Ã‚Â¤llningar fÃƒÆ’Ã‚Â¶r felkÃƒÆ’Ã‚Â¶rning och andra avdrag.</p>
          
          <div class="space-y-4">
             <div>
               <label class="block text-sm font-medium mb-1 dark:text-gray-300">1:a FelkÃƒÆ’Ã‚Â¶rning (poÃƒÆ’Ã‚Â¤ngavdrag)</label>
               <input type="number" id="ruleError1" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 2" />
             </div>
             <div>
               <label class="block text-sm font-medium mb-1 dark:text-gray-300">2:a FelkÃƒÆ’Ã‚Â¶rning (poÃƒÆ’Ã‚Â¤ngavdrag)</label>
               <input type="number" id="ruleError2" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 4" />
             </div>
             <div>
               <label class="block text-sm font-medium mb-1 dark:text-gray-300">3:e FelkÃƒÆ’Ã‚Â¶rning</label>
               <div class="text-sm text-gray-500 italic px-3 py-2 border bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 rounded">Eliminering</div>
             </div>
          </div>

          <div class="mt-4 flex flex-col sm:flex-row gap-2">
             <button id="btnSaveRules" class="px-3 py-2 rounded bg-emerald-600 text-white text-sm shadow-sm hover:bg-emerald-700">Spara regler</button>
             <span id="rulesMsg" class="text-sm text-emerald-700 dark:text-emerald-400 self-center"></span>
          </div>
        </div>
      </div>

      <!-- Sektion 2: Importera program frÃƒÆ’Ã‚Â¥n PDF -->
      <div class="dressage-admin-section bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-md border dark:border-gray-700">
        <h2 class="font-semibold text-lg mb-3 dark:text-white">Importera dressyrprogram frÃƒÆ’Ã‚Â¥n PDF</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Ladda en PDF (t.ex. ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œSvenskt LÃƒÆ’Ã‚Â¤tt B (2020) 40x80mÃƒÂ¢Ã¢â€šÂ¬Ã‚Â). Vi fÃƒÆ’Ã‚Â¶rsÃƒÆ’Ã‚Â¶ker tolka momenten. Du kan justera innan du sparar till tÃƒÆ’Ã‚Â¤vlingen.
        </p>

        <div class="grid gap-3 mb-4 lg:grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,1fr)]">
          <input type="file" id="pdfInput" accept="application/pdf" class="border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 text-sm"/>
          <button id="btnParsePdf" class="px-4 py-2 rounded bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 shadow-sm">LÃƒÆ’Ã‚Â¤s PDF</button>
          <button id="btnSaveProgram" class="px-4 py-2 rounded bg-brand-darkblue text-white hover:bg-brand-gold hover:text-brand-darkblue disabled:opacity-50 disabled:cursor-not-allowed shadow-sm dark:bg-blue-600 dark:hover:bg-blue-500">Spara till tÃƒÆ’Ã‚Â¤vling</button>
          <span id="pdfMsg" class="text-sm text-gray-600 dark:text-gray-400 self-center break-words"></span>
        </div>

        <div id="programForm" class="hidden">
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
            <div>
              <label class="text-sm block mb-1 dark:text-gray-300">Programnamn</label>
              <input id="progName" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white"/>
            </div>
            <div>
              <label class="text-sm block mb-1 dark:text-gray-300">Program-nyckel</label>
              <input id="progKey" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. sv_latt_b_40x80_2020"/>
            </div>
            <div>
              <label class="text-sm block mb-1 dark:text-gray-300">Kategori</label>
              <select id="progCat" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <option>Svenskt</option>
                <option>FEI</option>
                <option>ÃƒÆ’Ã¢â‚¬â€œvrigt</option>
              </select>
            </div>
            <div>
              <label class="text-sm block mb-1 dark:text-gray-300">Bana</label>
              <select id="progArena" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <option value="">(okÃƒÆ’Ã‚Â¤nd)</option>
                <option>40x80</option>
                <option>40x100</option>
              </select>
            </div>
          </div>

          <!-- Metadata -->
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
            <div class="flex items-center gap-2">
              <input id="progVerified" type="checkbox" class="h-4 w-4 rounded dark:bg-gray-700 dark:border-gray-600">
              <label for="progVerified" class="text-sm dark:text-gray-300">Verifierat program</label>
            </div>
            <div>
              <label class="text-sm block mb-1 dark:text-gray-300">KÃƒÆ’Ã‚Â¤lla / kÃƒÆ’Ã‚Â¤lla-PDF</label>
              <input id="progSource" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 522. Svenskt LÃƒÆ’Ã‚Â¤tt B (2020) 40x80m.pdf"/>
            </div>
            <div>
              <label class="text-sm block mb-1 dark:text-gray-300">Version / ÃƒÆ’Ã‚Â¥r</label>
              <input id="progVersion" class="border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="t.ex. 2020"/>
            </div>
          </div>

          <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 class="font-medium dark:text-white">Moment</h3>
            <button id="btnAddMove" class="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white">LÃƒÆ’Ã‚Â¤gg till moment</button>
          </div>

          <div class="overflow-x-auto border rounded-lg dark:border-gray-700">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
                  <th class="text-left p-2 dark:text-gray-300">#</th>
                  <th class="text-left p-2 dark:text-gray-300">Plats</th>
                  <th class="text-left p-2 dark:text-gray-300">RÃƒÆ’Ã‚Â¶relse</th>
                  <th class="text-left p-2 dark:text-gray-300">Att bedÃƒÆ’Ã‚Â¶ma</th>
                  <th class="text-left p-2 dark:text-gray-300">Koeff</th>
                  <th class="text-left p-2"></th>
                </tr>
              </thead>
              <tbody id="movesTbody" class="divide-y dark:divide-gray-700"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function rebuildProgramDatalist(root) {
  const dl = root.querySelector('#programKeysList');
  if (!dl) return;
  dl.innerHTML = sortDressageProgramKeys(mergedPrograms)
    .map(k => `<option value="${esc(k)}">${esc(formatDressageProgramOptionLabel(k, mergedPrograms[k]))}</option>`).join('');
}

function rebuildMappingTable(root, filter = '') {
  const host = qs('#mappingTable', root);
  const classes = unique(allEquipages.map(e => (e.className || e.klass || '').trim()).filter(Boolean)).sort();
  const rows = classes
    .filter(cls => !filter || cls.toLowerCase().includes(filter.toLowerCase()))
    .map(cls => {
      const locked = !!mappingLocks[cls]?.locked;
      const val = mapping[cls] || '';
      const prog = mergedPrograms[val];

      return `
        <div class="dressage-admin-map-row grid grid-cols-1 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_10rem] gap-2 items-start xl:items-center border rounded-lg p-3 dark:border-gray-700 ${locked ? 'opacity-60' : ''}">
          <div class="font-medium flex items-center gap-2 dark:text-white">
            ${esc(cls)}
            ${locked ? '<span class="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200">LÃƒÆ’Ã‚Â¥st</span>' : ''}
          </div>
          <div class="space-y-2">
            <select class="programSelect border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    data-cls="${esc(cls)}" ${locked ? 'disabled' : ''}>
              ${renderProgramOptions(val)}
            </select>
            <input class="mapInput hidden border rounded px-3 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" list="programKeysList" 
                   data-cls="${esc(cls)}" value="${esc(val)}" ${locked ? 'disabled' : ''}
                   placeholder="vÃƒÆ’Ã‚Â¤lj/skriv program-nyckel..."/>
            ${renderSelectedProgramInfo(val, prog)}
            
            <!-- Clear Round Config -->
            <div class="dressage-admin-cr-row flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-sm bg-gray-50 p-2 rounded dark:bg-gray-700/50">
              <label class="flex items-center gap-1 cursor-pointer dark:text-gray-300">
                <input type="checkbox" class="cr-check rounded border-gray-300 text-brand-darkblue dark:bg-gray-700 dark:border-gray-600" 
                       data-cls="${esc(cls)}" 
                       ${(classConfig[cls]?.clearRound) ? 'checked' : ''}>
                <span>Clear Round</span>
              </label>
              ${(classConfig[cls]?.clearRound) ? `
                <div class="cr-limit-wrap flex items-center gap-1 sm:ml-auto">
                   <span class="text-gray-600 text-xs dark:text-gray-400">GrÃƒÆ’Ã‚Â¤ns:</span>
                   <input type="number" class="cr-limit w-16 px-1 py-0.5 border rounded text-xs dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                          data-cls="${esc(cls)}" 
                          value="${classConfig[cls]?.limit || 60}" step="0.5" min="0" max="100">%
                </div>
              ` : ''}
            </div>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 break-all">Nyckel: ${esc(val || 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â')}</div>
        </div>
      `;
    }).join('');
  host.innerHTML = rows || `<div class="text-gray-600 dark:text-gray-400">Inga klasser hittades.</div>`;

  host.querySelectorAll('.programSelect').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const c = e.target.dataset.cls;
      const val = e.target.value.trim();
      const hidden = host.querySelector(`.mapInput[data-cls="${CSS.escape(c)}"]`);
      if (hidden) hidden.value = val;
      if (val) mapping[c] = val; else delete mapping[c];
      rebuildMappingTable(root, filter);
    });
  });

  // Add listeners for local boolean toggle re-render (optional for better UX)
  host.querySelectorAll('.cr-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const c = e.target.dataset.cls;
      if (!classConfig[c]) classConfig[c] = {};
      classConfig[c].clearRound = e.target.checked;
      // Re-render immediately to show/hide limit input
      rebuildMappingTable(root, filter);
    });
  });

  // Updates local state for limit inputs
  host.querySelectorAll('.cr-limit').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const c = e.target.dataset.cls;
      if (!classConfig[c]) classConfig[c] = {};
      classConfig[c].limit = parseFloat(e.target.value) || 0;
    });
  });
}

function fillProgramForm(root, prog) {
  qs('#programForm', root).classList.remove('hidden');
  qs('#progName', root).value = prog.name || '';
  qs('#progKey', root).value = normKey(prog.name || 'nytt_program');
  qs('#progCat', root).value = prog.category || 'Svenskt';
  qs('#progArena', root).value = prog.arena || '';
  qs('#progVerified', root).checked = !!prog.verified;
  qs('#progSource', root).value = prog.source || '';
  qs('#progVersion', root).value = prog.version || '';

  const tb = qs('#movesTbody', root);
  tb.innerHTML = (prog.movements || []).map(m => `
  <tr>
    <td class="p-2"><input type="number" class="mv-no border rounded px-2 py-1 w-20 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${esc(m.no)}"/></td>
    <td class="p-2"><input type="text"   class="mv-letters border rounded px-2 py-1 w-28 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${esc(m.letters || '')}"/></td>
    <td class="p-2"><input type="text"   class="mv-text border rounded px-2 py-1 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${esc(m.text || '')}"/></td>
    <td class="p-2"><input type="text"   class="mv-judge border rounded px-2 py-1 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${esc(m.judge || '')}"/></td>
    <td class="p-2"><input type="number" min="1" step="1" class="mv-coeff border rounded px-2 py-1 w-20 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${esc(m.coeff || 1)}"/></td>
    <td class="p-2 text-right"><button type="button" class="mv-del px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-rose-300">Ta bort</button></td>
  </tr>
`).join('');
}

function readProgramForm(root) {
  const name = qs('#progName', root).value.trim();
  const key = qs('#progKey', root).value.trim() || normKey(name);
  const category = qs('#progCat', root).value.trim();
  const arena = qs('#progArena', root).value.trim();
  const verified = !!qs('#progVerified', root).checked;
  const source = qs('#progSource', root).value.trim();
  const version = qs('#progVersion', root).value.trim();

  const rows = Array.from(qs('#movesTbody', root).querySelectorAll('tr')).map(tr => {
    const no = toNumber(tr.querySelector('.mv-no')?.value);
    const letters = tr.querySelector('.mv-letters')?.value?.trim() || '';
    const text = tr.querySelector('.mv-text')?.value?.trim() || '';
    const judge = tr.querySelector('.mv-judge')?.value?.trim() || '';
    const coeff = Math.max(1, toNumber(tr.querySelector('.mv-coeff')?.value));
    return { no, letters, text, judge, coeff };
  }).filter(r => r.no > 0 && (r.text || r.letters || r.judge));

  const movements = rows; // behÃƒÆ’Ã‚Â¥ll alla rader i ordning
  return { key, program: { name, category, arena, movements, verified, source, version } };

}

function wire(root) {
  // mapping filter
  qs('#classFilter', root)?.addEventListener('input', (e) => {
    rebuildMappingTable(root, e.target.value);
  });

  // Auto-fixa mapping: ersÃƒÆ’Ã‚Â¤tt saknade/fel nycklar med bÃƒÆ’Ã‚Â¤sta svenska match
  qs('#btnAutoFixMapping', root)?.addEventListener('click', async () => {
    const classes = [...new Set((allEquipages || []).map(e => (e.className || e.klass || '').trim()).filter(Boolean))];
    let changes = 0;
    classes.forEach(cls => {
      const key = mapping[cls];
      const exists = key && mergedPrograms[key];
      if (!exists) {
        const guess = guessProgramKeyFromClass(cls, mergedPrograms);
        if (guess) { mapping[cls] = guess; changes++; }
      }
    });
    await replaceConfig(competitionId, 'dressyrProgramMapping', mapping);
    rebuildMappingTable(root, qs('#classFilter', root)?.value || '');
    const tag = qs('#mapSaved', root);
    if (tag) { tag.textContent = `Auto-fix klart: ${changes} ÃƒÆ’Ã‚Â¤ndring(ar).`; setTimeout(() => tag.textContent = '', 3000); }
  });

  // spara mapping
  qs('#btnSaveMapping', root)?.addEventListener('click', async () => {
    // lÃƒÆ’Ã‚Â¤s alla program-nyckel inputs
    const inputs = root.querySelectorAll('.mapInput');
    inputs.forEach(inp => {
      const cls = inp.dataset.cls;
      const val = inp.value.trim();
      if (val) mapping[cls] = val; else delete mapping[cls];
    });

    // Inputs fÃƒÆ’Ã‚Â¶r CR-limit och check sparas redan i classConfig via "change/input" lyssnarna i rebuildMappingTable,
    // men vi kan gÃƒÆ’Ã‚Â¶ra en "sweep" fÃƒÆ’Ã‚Â¶r sÃƒÆ’Ã‚Â¤kerhets skull eller bara lita pÃƒÆ’Ã‚Â¥ objektet.
    // (FÃƒÆ’Ã‚Â¶r sÃƒÆ’Ã‚Â¤kerhetsskull lÃƒÆ’Ã‚Â¤ser vi av DOM igen fÃƒÆ’Ã‚Â¶r limits ifall "input" missades, fast "change" pÃƒÆ’Ã‚Â¥ checkbox triggar re-render.)

    // Validera ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ alla manuella nycklar mÃƒÆ’Ã‚Â¥ste finnas i mergedPrograms
    const invalid = Object.entries(mapping).filter(([cls, key]) => key && !mergedPrograms[key]);
    if (invalid.length) {
      const msgTxt = 'Ogiltig programnyckel fÃƒÆ’Ã‚Â¶r: ' + invalid.map(([c, k]) => `${c}ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢${k}`).join(', ');
      alert(msgTxt);
      return; // avbryt sparning
    }
    try {
      await replaceConfig(competitionId, 'dressyrProgramMapping', mapping);
      await replaceConfig(competitionId, 'dressyrClassConfig', classConfig); // Save CR config
      const msg = qs('#mapSaved', root);
      if (msg) { msg.textContent = 'Sparat (Program & CR).'; setTimeout(() => msg.textContent = '', 2000); }
    } catch (e) {
      console.error('save mapping failed', e);
      alert('Kunde inte spara mapping.');
    }
  });

  // PDF parse
  // PDF parse (fixad)
  qs('#btnParsePdf', root)?.addEventListener('click', async () => {
    const input = qs('#pdfInput', root);
    const msg = qs('#pdfMsg', root);
    const file = input?.files?.[0];

    if (!file) {
      if (msg) msg.textContent = 'VÃƒÆ’Ã‚Â¤lj en PDF fÃƒÆ’Ã‚Â¶rst.';
      return;
    }
    if (msg) msg.textContent = 'LÃƒÆ’Ã‚Â¤ser PDFÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦';

    try {
      // extractPdfText returnerar { lines }, sÃƒÆ’Ã‚Â¥ vi mÃƒÆ’Ã‚Â¥ste plocka ut rÃƒÆ’Ã‚Â¤tt fÃƒÆ’Ã‚Â¤lt
      const extracted = await extractPdfText(file);
      const prog = parseProgramFromExtract(extracted);

      // Gissa namn/nyckel frÃƒÆ’Ã‚Â¥n filnamn om fÃƒÆ’Ã‚Â¤lten ÃƒÆ’Ã‚Â¤r tomma
      const fname = file.name || '';
      const nameGuess = fname.replace(/\.(pdf)$/i, '').replace(/[_-]+/g, ' ').trim();
      const keyGuess = fname.toLowerCase()
        .replace(/\.(pdf)$/i, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

      // Visa formulÃƒÆ’Ã‚Â¤ret och fyll in vÃƒÆ’Ã‚Â¤rden
      qs('#programForm', root)?.classList.remove('hidden');
      fillProgramForm(root, {
        ...prog,
        name: (qs('#progName', root)?.value?.trim() ? qs('#progName', root).value : (prog.name || nameGuess)) || '',
      });

      // SÃƒÆ’Ã‚Â¤tt nyckel om tom
      const keyEl = qs('#progKey', root);
      if (keyEl && !keyEl.value) keyEl.value = keyGuess;

      // Aktivera spara-knappen och skriv status
      const mvCount = (prog.movements || []).length;
      const saveBtn = qs('#btnSaveProgram', root);
      if (saveBtn) saveBtn.disabled = mvCount === 0;
      if (msg) msg.textContent = `PDF lÃƒÆ’Ã‚Â¤st ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ ${mvCount} moment hittade.`;
    } catch (e) {
      console.error(e);
      if (msg) msg.textContent = 'Kunde inte tolka PDF.';
    }
  });


  // lÃƒÆ’Ã‚Â¤gg till moment-rad
  qs('#btnAddMove', root)?.addEventListener('click', () => {
    const tb = qs('#movesTbody', root);
    const tr = document.createElement('tr');
    tr.innerHTML = `
  <td class="p-2"><input type="number" class="mv-no border rounded px-2 py-1 w-20 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="1"/></td>
  <td class="p-2"><input type="text"   class="mv-letters border rounded px-2 py-1 w-28 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value=""/></td>
  <td class="p-2"><input type="text"   class="mv-text border rounded px-2 py-1 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" value=""/></td>
  <td class="p-2"><input type="text"   class="mv-judge border rounded px-2 py-1 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" value=""/></td>
  <td class="p-2"><input type="number" min="1" step="1" class="mv-coeff border rounded px-2 py-1 w-20 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="1"/></td>
  <td class="p-2 text-right"><button type="button" class="mv-del px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-rose-300">Ta bort</button></td>
`;
    tb.appendChild(tr);
  });

  // ta bort rad (delegat)
  qs('#programForm', root)?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mv-del');
    if (!btn) return;
    const tr = btn.closest('tr');
    tr?.parentNode?.removeChild(tr);
  });

  // spara program
  qs('#btnSaveProgram', root)?.addEventListener('click', async () => {
    const { key, program } = readProgramForm(root);
    if (!key) { alert('Program-nyckel saknas.'); return; }
    try {
      const old = await getConfig(competitionId, 'dressagePrograms') || {};
      const next = { ...old, [key]: program };
      await saveConfig(competitionId, 'dressagePrograms', next);
      // uppdatera lokalt index sÃƒÆ’Ã‚Â¥ det finns i datalist direkt
      mergedPrograms[key] = program;
      qs('#programKeysList', root).insertAdjacentHTML('beforeend', `<option value="${esc(key)}">${esc(program.name || key)}</option>`);
      alert('Program sparat i tÃƒÆ’Ã‚Â¤vlingens konfiguration.');
    } catch (e) {
      console.error(e);
      alert('Kunde inte spara program.');
    }
  });

  // --- Sektion 1.5: Domare & Regler ---

  // Fyll klass-vÃƒÆ’Ã‚Â¤ljaren
  const judgeClassSel = qs('#judgeClassSelect', root);
  if (judgeClassSel) {
    const classes = unique(allEquipages.map(e => (e.className || e.klass || '').trim()).filter(Boolean)).sort();
    judgeClassSel.innerHTML = '<option value="">-- VÃƒÆ’Ã‚Â¤lj klass --</option>' +
      classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    judgeClassSel.addEventListener('change', (e) => {
      renderJudgeAssignment(root, e.target.value);
    });
  }

  qs('#btnSaveJudgeMapping', root)?.addEventListener('click', async () => {
    const cls = judgeClassSel.value;
    if (!cls) return;

    // LÃƒÆ’Ã‚Â¤s av selects
    const selects = root.querySelectorAll('.pos-select');
    const assigned = {};
    let count = 0;
    selects.forEach(sel => {
      const dh = sel.dataset.pos; // C, E, B...
      const jid = sel.value;
      if (jid) {
        assigned[dh] = jid;
        count++;
      }
    });

    // Uppdatera state
    if (count > 0) {
      judgeMapping[cls] = assigned;
    } else {
      delete judgeMapping[cls];
    }

    try {
      await replaceConfig(competitionId, 'dressageJudgeMapping', judgeMapping);
      renderJudgeAssignmentSummary(root); // Update summary list
      const msg = qs('#judgeMapMsg', root);
      if (msg) { msg.textContent = 'Sparat.'; setTimeout(() => msg.textContent = '', 2000); }
    } catch (err) {
      console.error(err);
      alert('Kunde inte spara domartilldelning.');
    }
  });

  qs('#btnSaveRules', root)?.addEventListener('click', async () => {
    const e1 = parseFloat(qs('#ruleError1', root).value) || 0;
    const e2 = parseFloat(qs('#ruleError2', root).value) || 0;
    dressageRules = { error1: e1, error2: e2 };

    try {
      await saveConfig(competitionId, 'dressageRules', dressageRules);
      const msg = qs('#rulesMsg', root);
      if (msg) { msg.textContent = 'Sparat.'; setTimeout(() => msg.textContent = '', 2000); }
    } catch (err) {
      console.error(err);
      alert('Kunde inte spara regler.');
    }
  });
}

function renderJudgeAssignment(root, className) {
  const container = qs('#judgeAssignmentArea', root);
  if (!container) return;

  if (!className) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  container.classList.remove('hidden');

  const assigned = judgeMapping[className] || {};
  const positions = ['C', 'E', 'B', 'H', 'M']; // Standard

  // Skapa alternativ fÃƒÆ’Ã‚Â¶r domar-select
  // Sortera: fÃƒÆ’Ã‚Â¶rst de med rÃƒÆ’Ã‚Â¤tt position, sen bokstavsordning
  const getOpts = (currentPos) => {
    let html = '<option value="">(Ingen)</option>';

    const sorted = allJudges.slice().sort((a, b) => {
      // Prio: Har position == currentPos?
      const aPos = (getPrimaryDressagePosition(a) === currentPos);
      const bPos = (getPrimaryDressagePosition(b) === currentPos);
      if (aPos && !bPos) return -1;
      if (!aPos && bPos) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    sorted.forEach(j => {
      html += `<option value="${j.id}">${esc(j.name)} ${j.isOverJudge ? '(ÃƒÆ’Ã¢â‚¬â€œD)' : ''} [${getPrimaryDressagePosition(j) || '-'}]</option>`;
    });
    return html;
  };

  container.innerHTML = positions.map(pos => {
    const val = assigned[pos] || '';
    return `
        <div class="flex items-center gap-2">
           <div class="w-8 font-bold text-center bg-white border rounded py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white">${pos}</div>
           <select class="pos-select border rounded px-2 py-2 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white" data-pos="${pos}">
              ${getOpts(pos)}
           </select>
           <!-- SÃƒÆ’Ã‚Â¤tt vald efterÃƒÆ’Ã‚Â¥t via JS eller inject string -->
        </div>
      `;
  }).join('');

  // SÃƒÆ’Ã‚Â¤tt vÃƒÆ’Ã‚Â¤rden
  container.querySelectorAll('.pos-select').forEach(sel => {
    const pos = sel.dataset.pos;
    if (assigned[pos]) sel.value = assigned[pos];
  });
}

function renderJudgeAssignmentSummary(root) {
  const container = qs('#judgeSummaryArea', root);
  if (!container) return;

  // Group classes by judge
  // judgeMapping: { "Klass A": { C: "judgeId1", E: "judgeId2" }, ... }
  const judgeAssignments = {};

  for (const [clsName, positions] of Object.entries(judgeMapping)) {
    for (const [pos, jid] of Object.entries(positions)) {
      if (!judgeAssignments[jid]) judgeAssignments[jid] = [];
      judgeAssignments[jid].push({ cls: clsName, pos: pos });
    }
  }

  const judgeIds = Object.keys(judgeAssignments);

  if (judgeIds.length === 0) {
    container.innerHTML = '<div class="text-sm text-gray-500 italic dark:text-gray-400">Inga domare tilldelade ÃƒÆ’Ã‚Â¤nnu.</div>';
    return;
  }

  // Look up judge names and sort
  const summaryList = judgeIds.map(jid => {
    const jObj = allJudges.find(j => j.id === jid);
    const jName = jObj ? jObj.name : '(OkÃƒÆ’Ã‚Â¤nd domare)';

    // Sort array of classes
    const classes = judgeAssignments[jid].sort((a, b) => a.cls.localeCompare(b.cls));
    const classesHtml = classes.map(c => `<span class="inline-block bg-gray-100 dark:bg-gray-700 rounded px-2 py-0.5 mt-1 mr-1 text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600">${esc(c.cls)} (${esc(c.pos)})</span>`).join('');

    return `
      <div class="mb-3 last:mb-0">
        <div class="font-medium text-sm text-gray-800 dark:text-gray-200">${esc(jName)}</div>
        <div class="flex flex-wrap">${classesHtml}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Aktuella Tilldelningar</h3>
    ${summaryList}
  `;
}

function getPrimaryDressagePosition(j) {
  // Hitta roll fÃƒÆ’Ã‚Â¶r dressyr
  if (!j.roles) return '';
  const r = j.roles.find(x => x.discipline === 'dressage');
  return r ? (r.position || '') : '';
}

// ---- Entrypoint ----
export async function load() {
  ensureDressageAdminResponsiveStyles();
  const root =
    document.getElementById('page-dressyr-admin') ||
    document.getElementById('root');
  if (!root) return;

  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id || window.currentCompetitionId || window.competitionId || localStorage.getItem('lastCompetitionId') || null;
  if (!competitionId) {
    root.innerHTML = '<p class="p-8 text-center text-gray-600 dark:text-gray-300">Ingen tÃƒÆ’Ã‚Â¤vling vald.</p>';
    return;
  }

  // bygga programindex = global (statisk) + overrides frÃƒÆ’Ã‚Â¥n config
  const globalPrograms = await loadGlobalPrograms();
  const overrides = await getConfig(competitionId, 'dressagePrograms') || {};
  mergedPrograms = { ...globalPrograms, ...overrides };

  // hÃƒÆ’Ã‚Â¤mta mapping + ekipage
  const rawMapping = await getConfig(competitionId, 'dressyrProgramMapping') || {};
  // Hantera ÃƒÆ’Ã‚Â¤ldre, felaktigt kapslat format och sÃƒÆ’Ã‚Â¤kerstÃƒÆ’Ã‚Â¤ll att vi har ett rent objekt.
  if (rawMapping && typeof rawMapping.mapping === 'object' && Object.keys(rawMapping).length === 1) {
    mapping = rawMapping.mapping;
  } else if (__validateMapping(rawMapping)) {
    mapping = rawMapping;
  } else {
    mapping = {}; // Fallback till tomt objekt
  }

  allEquipages = await getEquipages(competitionId) || [];
  mappingLocks = await getConfig(competitionId, 'dressyrLocks') || {};
  judgeMapping = await getConfig(competitionId, 'dressageJudgeMapping') || {};
  dressageRules = await getConfig(competitionId, 'dressageRules') || {};
  classConfig = await getConfig(competitionId, 'dressyrClassConfig') || {}; // Load class config

  // Listen for judges (global pool)
  if (judgeListenerUnsub) judgeListenerUnsub();
  judgeListenerUnsub = listenForJudges(competitionId, (list) => {
    allJudges = list || [];
    // Om vi har en vald klass, rendera om assignments
    const sel = qs('#judgeClassSelect', root);
    if (sel && sel.value) renderJudgeAssignment(root, sel.value);

    // NYTT: Rendera om summary nÃƒÆ’Ã‚Â¤r domarna har laddats!
    renderJudgeAssignmentSummary(root);
    renderDressageAdminReadiness(root);
  });

  render(root);
  renderDressageAdminReadiness(root);

  // Fill rules inputs
  const rErr1 = qs('#ruleError1', root);
  const rErr2 = qs('#ruleError2', root);
  if (rErr1) rErr1.value = dressageRules.error1 || '';
  if (rErr2) rErr2.value = dressageRules.error2 || '';

  rebuildProgramDatalist(root);
  rebuildMappingTable(root, '');
  renderJudgeAssignmentSummary(root);
  renderDressageAdminReadiness(root);

  const noPrograms = !Object.keys(mergedPrograms).length;
  if (noPrograms) {
    const host = document.querySelector('#mappingTable');
    if (host) {
      host.insertAdjacentHTML('beforebegin',
        '<div class="p-3 mb-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm">Inga program hittades ÃƒÆ’Ã‚Â¤nnu. Importera via PDF-fliken nedan eller skapa ett nytt program och spara ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ dÃƒÆ’Ã‚Â¤refter dyker nycklarna upp hÃƒÆ’Ã‚Â¤r.</div>');
    }
  }
  root.addEventListener('input', () => renderDressageAdminReadiness(root));
  root.addEventListener('change', () => renderDressageAdminReadiness(root));
  wire(root);
}

export function __unload() {
  if (judgeListenerUnsub) { judgeListenerUnsub(); judgeListenerUnsub = null; }
}
