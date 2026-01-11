// total-resultat.js — TR-korrekt totalresultat (Svenska + FEI)
// v1.2:
//  - Visar även faktisk tid (A/B) i maratonkolumnen (mm:ss)
//  - Markerar bästa dressyrresultat i varje klass med fet stil
//  - Liten "Skriv ut / PDF"-knapp (window.print()) i headern

import { getGlobalState } from '../main.js';
import {
  getEquipages,
  getConfig,
  getDressageResultsForEquipage,
  listenForDressageProtocolsCollectionGroup,
  getMaratonTimingData,
  listenForMarathonResult,
  listenForPrecisionResults,
  listenForMaratonCollection,
  listenForMaratonTimingUpdates,
  listenForOfficials,
  listenForJudges
} from '../services/firestoreService.js';

import { calculatePrecisionResult } from '../utils/precisionUtils.js';

import { klassTempoData } from '../data/competitionData.js';
import { getCompetitionHeader } from '../ui/components.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';
import { dressagePrograms } from '../data/dressagePrograms.js'; // Behåll tills vi fixar dressyr-steget
import { openEquipageModal } from '../ui/equipage-modal.js';
import { injectScrollStyles, initializeScrollSync } from '../ui/scrollHelper.js';
import { generateTotalResultsPdf } from '../pdf/totalResultsPdf.js';

// --- NY IMPORT ---
import {
  horseLabel,
  horseLabelStacked,
  round2,
  secondsToMMSS,
  escapeHtml,
  isNum,
  fmt2,
  downloadCsv,
  csvCell,
  sanitizeForFilename
} from '../utils/sharedUtils.js';

import {
  stagePenaltyFromMs,
  limitsFor,
  buildDominantTRCategoryByClass,
  setMarathonConfig,
  getObstacleCoefficient,
  calculateMarathonResult,
  MARATHON_OBSTACLE_TIME_PENALTY,
  MARATHON_TIME_LIMIT_FACTOR_A,
  MARATHON_TIME_LIMIT_FACTOR_B,
  PENALTY_RATE
} from '../utils/marathonUtils.js';
import {
  normalizeMovements,
  getDressagePenaltyCoeff,
  calculateAggregateDressagePenalty,
  computeFinalFromSaved,
  guessProgramKeyFromClass,
  deduplicateAndFilterProtocols
} from '../utils/dressageUtils.js';

// -----------------

// ======= Konstanter (TR 2025) =======
const PRECISION_TIME_PENALTY_PER_SEC = 0.5;

// ---- Dressyr-hjälp (matchar dressyr-resultat.js) ----
// Hämta programlistan: tävlingsspecifika overrides på window, annars globala importen (om den finns)
function getPrograms() {
  const w = (typeof window !== 'undefined' ? window.dressagePrograms : null);
  if (w && Object.keys(w).length) return w;
  // om du har importerat dressagePrograms någon annanstans kan du returnera det här
  return (typeof dressagePrograms !== 'undefined' ? dressagePrograms : {});
}

// ======= Modulstat =======
let competitionId = null;
let equipages = [];
let allCompetitionJudges = [];
let precisionMap = new Map(); // sn -> { obstaclePenalty, timePenalty, time, eliminated }
let marathonTimeMap = new Map(); // sn -> { duration_A, duration_B }
let marathonObstacleMap = new Map(); // sn -> { obstaclePenaltySeconds, penalty, eliminated }
let dressageMap = new Map(); // sn -> Array of protocols
let marathonConfig = null; // { marathonDistances: { 'A-Sträcka': m, 'B-Sträcka': m }, marathonMin?:{A,B} }
let precisionConfig = null;
let processedResults = [];
let sortConfig = { key: 'plac', direction: 'asc' };
let unsub = [];
let bestDressageByClass = new Map(); // className -> högsta percentAvg
let viewMode = 'startorder'; // 'startorder' | 'byclass'
let searchQuery = '';
let activeClassFilters = new Set(); // tom = alla klasser
let computedMap = new Map(); // sn -> { marathon, dressage, precision, total? }
const computedBySn = new Map();
let unsubscribeComputed = null;
let lastSeenMarathonDurations = new Map(); // sn -> { A:sec|null, B:sec|null }
let IS_FEI = false;
let allOfficials = []; // ← NY: funktionärer (banbyggare, TL, veterinär m.fl.)
let isPrintExport = false; // ← NY: när true ska extra-detaljer döljas i PDF

// Filter: visa endast ekipage som fullföljt (har total och ej elim)
let showOnlyCompleted = false;
let showOnlyOngoing = false;

// === Visningskonfig (sammanslagning per TDB-klassnummer) ===
let displayConfig = null;   // { mergeByClassNumber: { "<grpKey>": { label, members:[<tdb#>,...] }, ... } }

// === Export: håll alltid den visade listan (efter filter + sort) ===
let __latestDisplayedRows = [];

// ======= HJÄLPFUNKTIONER FÖR HÄSTNAMN (SAKNADES) =======
function getEquipageModalCtx() {
  return {
    competitionId,
    equipages,
    resultRows: processedResults,
    precisionMap,
    allCompetitionJudges,
    marathonConfig,
    precisionConfig,
    competitionConfig: window.competitionConfig || {}, // Passa den globala configen om den finns
    classProgramMapping: window.klassProgramMapping || {}, // Passa program-mappningen
    // Vi skickar in våra egna hjälpare så modalen kan visa fönster/format
    limitsFor,          // finns redan i denna fil
    secondsToMMSS,      // finns redan i denna fil
  };
}

const MOBILE_BP = 600; // Behålls ifall någon CSS skulle behöva den, men isMobile() använder den inte
const isMobile = () => window.matchMedia("(orientation: portrait)").matches;

// Ny huvudfunktion som väljer rätt vy

function render() {
  // === STEG 1: DATABEARBETNING (Flyttad från renderDesktop) ===

  // Bygg/uppdatera grupp-chips (detta måste hända FÖRE filtrering)
  (() => {
    const chipHost = document.getElementById('classChips');
    if (!chipHost) return;

    const groups = groupEquipagesForDisplay(equipages, displayConfig);
    const labels = groups.map(g => g.label);

    const base = "px-2 py-1 rounded border text-sm cursor-pointer";
    const on = "bg-gray-800 text-white border-gray-800";
    const off = "bg-white text-gray-700 border-gray-300 hover:bg-gray-50";

    chipHost.innerHTML = labels.map(lbl => {
      const active = activeClassFilters.has(lbl);
      return `<button type="button" data-class="${escapeHtml(lbl)}" class="${base} ${active ? on : off}">${escapeHtml(lbl)}</button>`;
    }).join('');
  })();

  // Hämta all rådata
  const rows = processedResults.slice();

  // Filtrera på aktiva chips
  const filteredByClass = rows.filter(r => {
    if (!activeClassFilters.size) return true;
    return activeClassFilters.has(r.displayGroupLabel || '');
  });

  // Sök: startnr, kusk, klass, klubb
  const q = (searchQuery || '').trim().toLowerCase();
  const getEq = (sn) => equipages.find(e => String(e.startNumber) === String(sn));
  const baseData = !q ? filteredByClass : filteredByClass.filter(r => {
    const eq = getEq(r.startNumber) || {};
    const hay = [
      r.startNumber,
      r.driverName || '',
      r.className || '',
      eq.clubName || '',
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  // Filtrera på status (exklusiva i UI)
  let viewData = baseData;
  if (showOnlyCompleted) {
    viewData = baseData.filter(r => !r.isEliminated && r.totalPenalty != null);
  } else if (showOnlyOngoing) {
    viewData = baseData.filter(r => !!r.isOngoing);
  }

  // === SORTERING ===
  const sortKey = sortConfig.key || 'plac';
  const sortDir = sortConfig.direction === 'desc' ? -1 : 1;

  viewData.sort((a, b) => {
    let valA, valB;

    switch (sortKey) {
      case 'plac':
        valA = a.plac ?? (a.isEliminated ? 999998 : 999999);
        valB = b.plac ?? (b.isEliminated ? 999998 : 999999);
        break;
      case 'startNumber':
        valA = Number(a.startNumber) || 0;
        valB = Number(b.startNumber) || 0;
        break;
      case 'driverName':
        valA = (a.driverName || '').toLowerCase();
        valB = (b.driverName || '').toLowerCase();
        break;
      case 'className':
        valA = (a.className || '').toLowerCase();
        valB = (b.className || '').toLowerCase();
        break;
      case 'club':
        valA = (a.clubName || '').toLowerCase();
        valB = (b.clubName || '').toLowerCase();
        break;
      case 'dressage':
        valA = a.dressage?.penalty ?? 999999;
        valB = b.dressage?.penalty ?? 999999;
        break;
      case 'marathon':
        valA = a.marathon?.totalPenalty ?? 999999;
        valB = b.marathon?.totalPenalty ?? 999999;
        break;
      case 'precision':
        valA = a.precision?.pen ?? 999999;
        valB = b.precision?.pen ?? 999999;
        break;
      case 'totalPenalty':
        valA = a.totalPenalty ?? 999999;
        valB = b.totalPenalty ?? 999999;
        break;
      default:
        valA = 0; valB = 0;
    }

    if (valA < valB) return -1 * sortDir;
    if (valA > valB) return 1 * sortDir;

    // Tiebreak: använd startnummer om värdena är lika
    return (Number(a.startNumber) - Number(b.startNumber)) * sortDir;
  });

  // Spara den slutgiltiga listan globalt så BÅDA vyerna kan läsa den
  __latestDisplayedRows = Array.isArray(viewData) ? viewData.slice() : [];

  // === STEG 2: VÄLJ VY ===
  if (isMobile()) {
    window.__teardownXbarSync?.(); // Städa undan X-baren i mobilvy
    renderMobile(); // Denna läser nu den uppdaterade __latestDisplayedRows
  } else {
    renderDesktop(); // Denna läser nu den uppdaterade __latestDisplayedRows

    // Säkerställ att X-baren kopplas på nytt om den tagits bort
    const host = document.getElementById('total-x-wrap');
    if (host && window.__setupXbarSync) {
      window.__setupXbarSync({
        barClass: 'fixed-xbar',
        innerId: 'totalXbarInner',
        hostEl: host
      });
    }
  }
}

// ======= Hjälp =======
const byStart = (a, b) => (a.startNumber || 0) - (b.startNumber || 0);
const safe = (o, p, def = null) => p.split('.').reduce((a, k) => (a && k in a) ? a[k] : undefined, o) ?? def;

// --- STATUSIKONER ---
function statusIcon(kind) {
  const map = {
    ok: { title: 'Komplett', svg: 'M20 6L9 17l-5-5', cls: 'text-green-600' },
    partial: { title: 'Delvis', svg: 'M4 12h16', cls: 'text-amber-600' },
    missing: { title: 'Saknas', svg: 'M6 6l12 12', cls: 'text-gray-400' },
    elim: { title: 'Eliminerad', svg: 'M6 6l12 12', cls: 'text-red-600' }
  };
  const m = map[kind] || map.missing;
  return `
    <span class="inline-flex items-center gap-1 align-middle mr-1" title="${m.title}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14"
           fill="none" stroke="currentColor" stroke-width="2" class="${m.cls}">
        <path d="${m.svg}" />
      </svg>
    </span>
  `;
}

let __raf = null;
function requestRecompute() {
  if (__raf) return;
  __raf = requestAnimationFrame(() => {
    __raf = null;
    recompute();
  });
}

// ======= SAMMANSLAGNING: bygg "visningsgrupp" per ekipage/rad =======

function resolveMergeGrouping(e, mergeCfg) {
  // 1) Per-ekipage override (om satt vid import/adm)
  if (e?.useMergedTestForDisplay && e?.mergedTestKey && e?.mergedTestLabel) {
    return { key: String(e.mergedTestKey), label: String(e.mergedTestLabel) };
  }

  // 2) Global konfig via TDB-klassnummer
  const groupsObj = mergeCfg?.mergeByClassNumber || {};
  const num = (e?.tdbClassNumber != null) ? Number(e.tdbClassNumber) : null;
  if (num != null) {
    for (const [gKey, g] of Object.entries(groupsObj)) {
      if (Array.isArray(g?.members) && g.members.includes(num)) {
        const lbl = g?.label || e?.tdbClassLabel || e?.className || 'Sammanslagen klass';
        return { key: String(gKey), label: String(lbl) };
      }
    }
  }

  // 3) Fallback: originalklass
  const cls = e?.className || '—';
  return { key: `CLASS:${cls}`, label: cls };
}

function groupEquipagesForDisplay(equipages = [], mergeCfg) {
  const map = new Map();
  for (const e of (equipages || [])) {
    const g = resolveMergeGrouping(e, mergeCfg);
    if (!map.has(g.key)) map.set(g.key, { key: g.key, label: g.label, items: [] });
    map.get(g.key).items.push(e);
  }
  return Array.from(map.values())
    .sort((a, b) => a.label.localeCompare(b.label, 'sv', { numeric: true, sensitivity: 'base' }));
}

function buildCsvFromRows(rows, delim = ',') {
  const headers = [
    'StartNr', 'Kusk', 'Klass', 'Förening',
    'Dressyr_straff', 'Dressyr_%',
    'Maraton_tid', 'Maraton_hinder', 'Maraton_totalt',
    'Precision_straff',
    'Totalt', 'Placering', 'Elim'
  ];

  const exportRows = (rows || []).map(r => {
    const eq = (equipages || []).find(e => String(e.startNumber) === String(r.startNumber)) || {};
    return [
      r.startNumber ?? '',
      r.driverName ?? '',
      r.className ?? '',
      eq.clubName ?? '',
      r?.dressage?.penalty != null ? r.dressage.penalty.toFixed(2) : '',
      r?.dressage?.percentAvg != null ? r.dressage.percentAvg.toFixed(2) : '',
      r?.marathon?.timePenalty != null ? r.marathon.timePenalty.toFixed(2) : '',
      r?.marathon?.obstaclePenalty != null ? r.marathon.obstaclePenalty.toFixed(2) : '',
      r?.marathon?.totalPenalty != null ? r.marathon.totalPenalty.toFixed(2) : '',
      r?.precision?.pen != null ? r.precision.pen.toFixed(2) : '',
      r?.totalPenalty != null ? r.totalPenalty.toFixed(2) : '',
      r?.plac ?? '',
      r?.isEliminated ? 'JA' : ''
    ];
  });

  const comp = getGlobalState('currentCompetition');
  const compName = sanitizeForFilename(comp?.name || 'tavling');
  const date = new Date().toISOString().split('T')[0];
  const filename = `total_resultat_${compName}_${date}.csv`;

  downloadCsv(filename, headers, exportRows, delim);
}


// =================================================================
// === KORREKT MARATONBERÄKNING (med rätt variabelnamn)         ===
// =================================================================



// [ADD] inject styles for total results (sticky header + layout)
function injectTotalResultsStyles() {
  if (document.getElementById('total-results-styles')) return;
  injectScrollStyles(); // Ensure shared styles are present

  const css = `
    :root {
      --head-h: 44px;
    }
    
    /* Table grows as needed */
    .total-results-table {
      border-collapse: separate;
      border-spacing: 0;
      table-layout: auto;
      min-width: max-content; /* allow many judge columns */
      width: auto;            /* not forced 100% */
    }
    .total-results-wrap {
      /* no overflow here – the page will scroll instead */
      width: 100%;
    }
    /* Sticky header that stays aligned */
    .total-results-table thead th {
      position: sticky;
      top: 0;
      background: #fff;
      z-index: 2;
      height: var(--head-h);
      border-bottom: 2px solid #ddd;
      box-shadow: 0 1px 0 rgba(0,0,0,0.06);
      white-space: nowrap;
    }
    .total-results-table tbody td {
      white-space: nowrap;
      vertical-align: middle;
      border-bottom: 1px solid #eee;
    }
/* Sticky vänsterkolumner – används på både TH och TD */
.sticky-col-start { position: sticky; left: 0;   z-index: 3; }
.sticky-col-driver{ position: sticky; left: 84px; z-index: 3; } /* 60px kolumn + 24px horis. padding */

/* NYTT: Sätt en solid bakgrund på sticky-kolumnerna
  som matchar radens färg för att förhindra genomskinlighet vid scroll.
*/
.bg-white .sticky-col-start,
.bg-white .sticky-col-driver {
  background-color: #fff; /* Tailwind CSS 'white' */
}
.bg-gray-50 .sticky-col-start,
.bg-gray-50 .sticky-col-driver {
  background-color: #f9fafb; /* Tailwind CSS 'gray-50' */
}
.bg-red-50 .sticky-col-start,
.bg-red-50 .sticky-col-driver {
  background-color: #fef2f2; /* Tailwind CSS 'red-50' för eliminerade */
}
  
/* fasta bredder för att säkra linjering */
 .sticky-col-start { width: 60px; text-align:center; }
 .sticky-col-driver{ min-width: 220px; }
.col-klubb   { min-width: 160px; }
.col-hast    { min-width: 220px; }
    /* Stack judge names first+last on two lines to keep columns narrow */
    .judge-head { line-height: 1.15; }
    .judge-head .first { display:block; }
    .judge-head .last  { display:block; font-weight:600; }
    /* Stack multiple horses on separate lines */
    .cell-multiline { white-space: normal; }
    .cell-multiline .line { display:block; }
    /* icon button */
    .open-equipage-modal {
      border: 0; background: transparent; cursor: pointer;
      padding: 6px; border-radius: 8px;
    }
    .open-equipage-modal:hover { background: #f4f4f5; }

    /* Sortable Headers */
    .sortable-header {
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s ease, color 0.15s ease;
      position: relative;
      padding-right: 24px !important;
    }
    .sortable-header:hover {
      background-color: #f1f5f9 !important;
      color: #1e293b !important;
    }
    .sort-icon {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 10px;
      opacity: 0.4;
      transition: opacity 0.2s;
    }
    .sortable-header:hover .sort-icon {
      opacity: 0.8;
    }
    .sortable-header.active-sort {
      color: #0f172a !important;
      background-color: #f1f5f9 !important;
    }
    .sortable-header.active-sort .sort-icon {
      opacity: 1;
      color: #2563eb;
    }

/* Modal — precision-liknande overlay (blur + lätt mörker, inte helsvart) */
.tr-modal-backdrop {
  position: fixed; inset: 0;
  display:flex; align-items:center; justify-content:center;
  z-index: 2147483647;
  background-color: rgba(0,0,0,0);          /* start transparent */
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);                /* suddig bakgrund */
  pointer-events: none;                      /* aktiveras i .visible */
  padding: 40px 15px;
  opacity: 0;
  transition: background-color .18s ease, opacity .18s ease;
}
.tr-modal-backdrop.visible {
  background-color: rgba(0,0,0,0.45);       /* lite mörker (samma känsla som precision) */
  pointer-events: auto;
  opacity: 1;
}
.tr-modal {
  background:#fff;
  border-radius: 12px;
  width: 100%; max-width: 1100px;
  max-height: 90vh; overflow:auto;
  box-shadow: 0 10px 25px rgba(0,0,0,.10);
  transform: scale(.96);
  transition: transform .18s ease;
}
.tr-modal-backdrop.visible .tr-modal { transform: scale(1); }


    .tr-modal header {
      position: sticky; top:0; background:#fff; z-index:1;
      display:flex; align-items:center; justify-content:space-between;
      padding: 14px 16px; border-bottom: 1px solid #eee;
    }
    .tr-modal .tabs { display:flex; gap:8px; padding: 10px 16px; border-bottom:1px solid #eee;}
    .tr-modal .tabs button {
      padding:8px 12px; border-radius: 999px; border:1px solid #ddd; background:#fff; cursor:pointer;
    }
    .tr-modal .tabs button.active { background:#111; color:#fff; border-color:#111; }
    .tr-modal .content { padding: 16px; }
    .tr-close { border:0; background:transparent; font-size:20px; cursor:pointer; }

    /* Segmented Controls (likt maraton) */
    .segmented-control {
      display: inline-flex;
      background: #f1f5f9;
      padding: 3px;
      border-radius: 8px;
      gap: 2px;
    }
    .segmented-control button {
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
      border: none;
      background: transparent;
      color: #64748b;
    }
    .segmented-control button.active {
      background: #fff;
      color: #0f172a;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .segmented-control button:hover:not(.active) {
      color: #0f172a;
    }

    /* Sökfält-standard */
    .search-input-wrap {
      position: relative;
      width: 100%;
      max-width: 320px;
    }
    .search-input-wrap i {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: #94a3b8;
    }
    .search-input-wrap input {
      padding-left: 36px !important;
      border-radius: 8px !important;
      border-color: #e2e8f0 !important;
    }

    /* Live-pulsering för pågående resultat */
    @keyframes live-pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.05); }
      100% { opacity: 1; transform: scale(1); }
    }
    .live-dot {
      display: inline-block;
      width: 8px; height: 8px;
      background-color: #ef4444;
      border-radius: 50%;
      margin-right: 4px;
      animation: live-pulse 2s infinite ease-in-out;
    }
    
    /* Standardiserade typsnittsstorlekar för resultat */
    .res-val { font-variant-numeric: tabular-nums; font-size: 0.95rem; }
    .res-pos { font-size: 0.7rem; color: #6b7280; }

    /* Legend / Symbolförklaring */
    .results-legend {
      display: none; /* Hidden by default */
      margin-top: 1rem;
      padding: 1rem;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      font-size: 0.85rem;
      color: #475569;
      animation: fadeIn 0.2s ease-out;
    }
    .results-legend.visible { display: block; }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .legend-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1rem;
      margin-top: 0.5rem;
    }
    .legend-item { display: flex; align-items: center; gap: 0.5rem; }
    .legend-label { font-weight: 600; color: #1e293b; min-width: 45px; }
  `;
  const style = document.createElement('style');
  style.id = 'total-results-styles';
  style.textContent = css;
  document.head.appendChild(style);
}




// DELETED redundant local functions (marathonObstaclePenaltyFor, precisionPenaltyFor)

// DELETED redundant local function (computeDressageForEquipage)

function tiebreak(a, b) {
  const ma = a.marathon?.totalPenalty ?? Infinity;
  const mb = b.marathon?.totalPenalty ?? Infinity;
  if (ma !== mb) return ma - mb;
  const pa = a.precision?.pen ?? Infinity;
  const pb = b.precision?.pen ?? Infinity;
  if (pa !== pb) return pa - pb;
  const da = a.dressage?.percentAvg ?? -Infinity;
  const db = b.dressage?.percentAvg ?? -Infinity;
  return db - da;
}

function placeWithinClass(rows) {
  const byGroup = new Map();
  rows.forEach(r => {
    const gk = r.displayGroupKey || `CLASS:${r.className || '—'}`;
    if (!byGroup.has(gk)) byGroup.set(gk, []);
    byGroup.get(gk).push(r);
  });
  const out = [];
  for (const [gk, arr] of byGroup) {
    arr.sort((a, b) => {
      const A = a.totalPenalty, B = b.totalPenalty;
      if (a.isEliminated !== b.isEliminated) { return a.isEliminated ? 1 : -1; }
      if (A == null && B == null) return byStart(a, b);
      if (A == null) return 1;
      if (B == null) return -1;
      if (A !== B) return A - B;
      return tiebreak(a, b);
    });
    let place = 1;
    arr.forEach(r => {
      r.plac = (!r.isEliminated && r.totalPenalty != null) ? place++ : null;
    });
    out.push(...arr);   // ← rätt
  }
  return out;
}

function renderDesktop() {
  const container = document.getElementById('totalResultsContainer');
  if (!container) return;

  // === Status-badges: visa när en gren är "klar" ===
  const statusHost = document.getElementById('disciplinesStatus');
  if (statusHost) {
    const total = equipages.length || 0;
    const cntDress = processedResults.filter(r => r.dressage?.penalty != null || r.dressage?.eliminated).length;
    const cntMar = processedResults.filter(r => r.marathon?.totalPenalty != null || r.marathon?.eliminated).length;
    const cntPrec = processedResults.filter(r => r.precision?.pen != null || r.precision?.eliminated).length;

    const badge = (label, c, isDone) => {
      const cls = isDone ? 'bg-green-100 text-green-800 border-green-200' : 'bg-blue-100 text-blue-800 border-blue-200';
      const live = !isDone ? '<span class="live-dot"></span>' : '';
      return `<span class="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${cls}">${live}${label}: ${c}/${total}</span>`;
    };

    statusHost.innerHTML = `
      ${badge('Dressyr', cntDress, cntDress >= total)}
      ${badge('Maraton', cntMar, cntMar >= total)}
      ${badge('Precision', cntPrec, cntPrec >= total)}
    `;
  }

  // === rubriker (sorterbara) ===
  const headers = (IS_FEI ? [
    // ... (din header-lista är oförändrad) ...
  ] : [
    { key: 'plac', label: 'Plac' },
    { key: 'startNumber', label: '#' },
    { key: 'driverName', label: 'Kusk / Häst' },
    { key: 'className', label: 'Klass' },
    { key: 'club', label: 'Förening' },
    { key: 'dressage', label: 'Dressyr' },
    { key: 'marathon', label: 'Maraton' },
    { key: 'precision', label: 'Precision' },
    { key: 'totalPenalty', label: 'Totalt' },
  ]);

  const th = (h) => {
    let extra = '';
    if (h.key === 'startNumber') extra = ' sticky-col-start bg-gray-50';
    if (h.key === 'driverName') extra = ' sticky-col-driver bg-gray-50';

    const isActive = sortConfig.key === h.key;
    const sortIcon = sortConfig.direction === 'desc' ? 'fa-sort-down' : 'fa-sort-up';
    const activeClass = isActive ? ' active-sort' : '';

    const title = (h.key === 'totalPenalty')
      ? 'Totalt straff. (+Δ) = mot ledaren • ↗︎ = mot närmast framför'
      : '';

    return `
      <th data-key="${h.key}" title="${escapeHtml(title)}" class="sortable-header px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase transition-all duration-200 ${extra}${activeClass}">
        <div class="flex items-center gap-2">
          ${h.label}
          <i class="fas ${isActive ? sortIcon : 'fa-sort'} sort-icon"></i>
        </div>
      </th>`;
  };

  // === data ===
  // HÄMTA DEN FILTRERADE LISTAN (istället för att filtrera här)
  const viewData = __latestDisplayedRows || [];

  // (Chip-renderingslogiken är bortflyttad till render())
  // (All filtreringslogik är bortflyttad till render())

  const getEq = (sn) => equipages.find(e => String(e.startNumber) === String(sn)); // Behövs för renderRow

  // === renderRow (din befintliga funktion är oförändrad) ===
  const renderRow = (r, i) => {
    // ... (hela din befintliga renderRow-funktion här) ...
    const eq = getEq(r.startNumber) || {};
    const bestKey = r.displayGroupKey || `CLASS:${r.className || '—'}`;
    const isBestDressage = bestDressageByClass.get(bestKey) != null &&
      r.dressage?.percentAvg != null &&
      r.dressage.percentAvg === bestDressageByClass.get(bestKey);
    const dPlacHtml = Number.isFinite(r?.posDress) ? `<div class="text-[10px] leading-3 text-gray-500">(${r.posDress})</div>` : '';
    const mPlacHtml = Number.isFinite(r?.posMar) ? `<div class="text-[10px] leading-3 text-gray-500">(${r.posMar})</div>` : '';
    const pPlacHtml = Number.isFinite(r?.posPrec) ? `<div class="text-[10px] leading-3 text-gray-500">(${r.posPrec})</div>` : '';
    const dIco = statusIcon(r.dressageStatus || 'missing');
    const isDressRunning = r.dressageStatus === 'ongoing' || r.dressageStatus === 'pågår';
    const dLive = isDressRunning ? '<span class="live-dot"></span>' : '';
    const dTextRaw = r.dressage?.penalty == null ? '—' : r.dressage.penalty.toFixed(2);
    const dText = `<div class="res-val">${isBestDressage ? `<span class="font-bold text-green-700">${dTextRaw}</span>` : dTextRaw}</div>${dLive}${dPlacHtml}`;

    const isMarRunning = r.marathonStatus === 'ongoing' || r.marathonStatus === 'pågår';
    const mLive = isMarRunning ? '<span class="live-dot"></span>' : '';
    const mText = `<div class="res-val">${r.marathon?.totalPenalty == null ? '—' : r.marathon.totalPenalty.toFixed(2)}</div>${mLive}${mPlacHtml}`;
    const mIco = statusIcon(r.marathonStatus || 'missing');

    const obstAgg = marathonObstacleMap.get(String(r.startNumber)) || {};
    const tp = Number.isFinite(r?.marathon?.timePenalty) ? r.marathon.timePenalty : null;
    const kd = Number.isFinite(obstAgg?.kdPts) ? obstAgg.kdPts : null;
    const ov = Number.isFinite(obstAgg?.otherPts) ? obstAgg.otherPts : null;
    const hid = Number.isFinite(r?.marathon?.obstaclePenalty) ? r.marathon.obstaclePenalty : null;

    const tRow = lastSeenMarathonDurations.get(String(r.startNumber)) || marathonTimeMap.get(String(r.startNumber)) || {};
    const cRow = (computedMap.get(String(r.startNumber)) || {}).marathon || {};
    const aLabel = secondsToMMSS((cRow.duration_A ?? tRow.A));
    const bLabel = secondsToMMSS((cRow.duration_B ?? tRow.B));

    const tt = `A ${aLabel || '—'} / B ${bLabel || '—'}\n` +
      `tids ${tp != null ? tp.toFixed(2) : '—'} + kd ${kd != null ? kd.toFixed(2) : '—'} + övr ${ov != null ? ov.toFixed(2) : '—'} = ${hid != null ? hid.toFixed(2) : '—'}`;

    const pIco = statusIcon(r.precisionStatus || 'missing');
    const isPrecRunning = r.precisionStatus === 'ongoing' || r.precisionStatus === 'pågår';
    const pLive = isPrecRunning ? '<span class="live-dot"></span>' : '';
    const pPen = r.precision?.pen;
    const pOb = r.precision?.obstPen;
    const pTm = r.precision?.timePen;

    const pTip = (!isPrintExport)
      ? [Number.isFinite(pOb) ? `Rivning: ${pOb.toFixed(2)}` : null,
      Number.isFinite(pTm) ? `Tid: ${pTm.toFixed(2)}` : null
      ].filter(Boolean).join(' • ')
      : '';

    const pMini = (!isPrintExport && (Number.isFinite(pOb) || Number.isFinite(pTm)))
      ? `<div class="text-[10px] leading-3 text-gray-500">
           ${Number.isFinite(pOb) ? `R ${pOb.toFixed(2)}` : 'R —'} /
           ${Number.isFinite(pTm) ? `T ${pTm.toFixed(2)}` : 'T —'}
         </div>`
      : '';

    const pMain = (pPen == null ? '—' : pPen.toFixed(2));
    const pText = `<div class="res-val">${pMain}</div>${pLive}${pPlacHtml}${pMini}`;

    const diff = (!isPrintExport && r.diffFromLeader != null && r.diffFromLeader > 0)
      ? `<span class="text-xs text-gray-500" title="Skillnad mot klassens ledare">(+${r.diffFromLeader.toFixed(2)})</span>` : '';

    const nextMini = (!isPrintExport && r.diffFromNext != null && r.diffFromNext > 0)
      ? `<div class="text-[10px] leading-3 text-gray-500" title="Skillnad till närmast framförvarande">↗︎ ${r.diffFromNext.toFixed(2)}</div>` : '';

    const tot = `<div class="res-val font-bold text-blue-900">${r.totalPenalty == null ? '—' : r.totalPenalty.toFixed(2)}</div>`;

    const dPct = r.dressage?.percent == null ? '' : ` <div class="res-pos">(${r.dressage.percent.toFixed(2)}%)</div>`;

    const rowCls = r.isEliminated ? 'bg-red-50' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50');

    const horse = (eq && typeof eq === 'object' && (eq.horseName || eq.horses || eq.hästnamn)) ? '' : '';
    const clubCell = `
      <div class="flex items-center gap-2">
        ${getFlagHtml(eq) || ''}
        ${getClubLogoHtml(eq) || ''}
        <span>${eq.clubName || ''}</span>
      </div>`;

    return `<tr class="${rowCls}" data-start="${r.startNumber}">
      <td class="px-3 py-2">${r.isEliminated ? `<span class="text-red-600 font-semibold">${escapeHtml(r.elimReason || 'ELIM')}</span>`
        : (r.plac ?? '')
      }</td>
      <td class="px-3 py-2 sticky-col-start" style="min-width: 60px;">${r.startNumber ?? ''}</td>
         <td class="px-3 py-2 sticky-col-driver" style="min-width: 220px;">
      <div class="font-medium">${(r.driverName || '').replaceAll('<', '&lt;')}</div>
      ${(() => {
        const names = [];
        if (eq?.horseName) names.push(String(eq.horseName));
        if (Array.isArray(eq?.horses)) {
          for (const h of eq.horses) {
            const n = h?.name || h?.horseName || h?.namn || h?.id;
            if (n) names.push(String(n));
          }
        }
        if (!names.length && eq?.hästnamn) names.push(String(eq.hästnamn));
        return names.length
          ? `<div class="text-xs text-gray-500 cell-multiline">${names.map(n => `<span class="line">${escapeHtml(n)}</span>`).join('')}</div>`
          : '';
      })()}
    </td>
          <td class="px-3 py-2">${r.className || ''}</td>
          <td class="px-3 py-2">${clubCell}</td>
          <td class="px-3 py-2">${dIco}${dText}</td>
          <td class="px-3 py-2" title="${escapeHtml(tt)}">${mIco}${mText}</td>
          <td class="px-3 py-2">${pIco}${pText}</td>
          <td class="px-3 py-2 font-semibold">${tot} ${diff}${nextMini}</td>
    </tr>`;
  };

  // === tabell ===
  const tableHead = `<thead class="bg-gray-50"><tr>${headers.map(th).join('')}</tr></thead>`;

  // Vy: startordning vs grupperat per klass
  let tableBody = '';
  const anchorId = (s) => 'cls-' + String(s || '—').toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');

  if (viewMode === 'byclass') {
    // ... (din befintliga logik för "byclass" är oförändrad) ...
    const classes = Array.from(new Set(viewData.map(r => r.displayGroupLabel || '—')))
      .sort((a, b) => a.localeCompare(b, 'sv', { numeric: true, sensitivity: 'base' }));
    const jumpHost = document.getElementById('classJumpBar');
    if (jumpHost) {
      if (classes.length > 0) {
        jumpHost.classList.remove('hidden');
        jumpHost.innerHTML = classes.map(cls => `<a href="#${anchorId(cls)}" class="px-2 py-1 rounded border hover:bg-gray-50">${escapeHtml(cls)}</a>`).join('');
      } else {
        jumpHost.classList.add('hidden');
        jumpHost.innerHTML = '';
      }
    }
    for (const cls of classes) {
      const group = viewData.filter(r => (r.displayGroupLabel || '—') === cls);
      const total = group.length;
      const finished = group.filter(r => !r.isEliminated && r.totalPenalty != null).length;
      const elim = group.filter(r => r.isEliminated).length;
      const ranked = group
        .filter(r => !r.isEliminated && r.totalPenalty != null)
        .slice()
        .sort((a, b) => a.totalPenalty - b.totalPenalty);
      const leader = ranked[0]?.totalPenalty ?? null;
      const third = ranked[2]?.totalPenalty ?? null;
      const marginToThird = (leader != null && third != null) ? round2(third - leader) : null;
      const metaHtml = `
        <span class="inline-block px-2 py-0.5 rounded-md border text-xs bg-gray-100 text-gray-700 border-gray-200 mr-2">
          ${finished}/${total} fullföljda • ${elim} elim
        </span>
        ${leader != null ? `<span class="inline-block px-2 py-0.5 rounded-md border text-xs bg-blue-50 text-blue-800 border-blue-200 mr-2">
          Ledare: ${leader.toFixed(2)}
        </span>` : ''}
        ${marginToThird != null ? `<span class="inline-block px-2 py-0.5 rounded-md border text-xs bg-emerald-50 text-emerald-800 border-emerald-200">
          Marginal till #3: ${marginToThird.toFixed(2)}
        </span>` : ''}
      `;
      tableBody += `
        <tr id="${anchorId(cls)}" class="bg-gray-200 border-t-2 border-b-2 border-gray-300 sticky top-0 z-10">
          <td class="px-3 py-2 font-bold text-gray-800" colspan="${headers.length}">
            <div class="flex flex-wrap items-center gap-2">
              <span>${escapeHtml(cls)}</span>
              <span class="text-gray-400">|</span>
              ${metaHtml}
            </div>
          </td>
        </tr>
      `;
      tableBody += group.map((r, i) => renderRow(r, i)).join('');
    }
  } else {
    // Dölj snabbhopp
    const jumpHost = document.getElementById('classJumpBar');
    if (jumpHost) { jumpHost.classList.add('hidden'); jumpHost.innerHTML = ''; }

    tableBody = viewData.map((r, i) => renderRow(r, i)).join('');
  }


  container.innerHTML = `<div class="rounded-lg shadow ring-1 ring-black/5">
    <div id="total-x-wrap" class="x-scroll-wrap"> <table class="total-results-table text-sm">
        ${tableHead}
        <tbody>
          ${tableBody}
        </tbody>
      </table>
    </div>
  </div>`;

  // Skapa & koppla fasta x-baren
  (function () {
    const host = document.getElementById('total-x-wrap');
    if (host && window.__setupXbarSync) {
      window.__setupXbarSync({
        barClass: 'fixed-xbar',
        innerId: 'totalXbarInner',
        hostEl: host
      });
    }
  })();

  // Klicksortering
  container.querySelectorAll('.sortable-header').forEach(h => {
    // ... (din sorteringslogik är oförändrad) ...
    h.addEventListener('click', () => {
      const k = h.getAttribute('data-key');
      if (!k) return;
      sortConfig.direction = (sortConfig.key === k && sortConfig.direction === 'asc') ? 'desc' : 'asc';
      sortConfig.key = k;
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      processedResults.sort((a, b) => {
        const va = a[k]; const vb = b[k];
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va ?? '').localeCompare(String(vb ?? ''), 'sv') * dir;
      });
      render(); // Anropar huvud-render() som filtrerar om
    });
  });

  // Öppna modal på rad-klick
  container.addEventListener('click', (e) => {
    // ... (din modallogik är oförändrad) ...
    const tr = e.target.closest('tbody tr');
    if (!tr) return;
    if (e.target.closest('a,button,input,select,textarea,[data-no-rowclick]')) return;
    const sn = tr.getAttribute('data-start');
    if (!sn) return;
    openEquipageModal(String(sn), getEquipageModalCtx());
  });
}

// (DELETED redundant help panel functions)

function renderLayout() {
  const competition = getGlobalState('currentCompetition');
  const root = document.getElementById('page-total-results');

  // Datum-sträng (samma som i headern för maraton)
  const dt = new Date();
  const dateStr = dt.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  root.innerHTML = `
  ${getCompetitionHeader(competition, 'Totalresultat - Start- & Resultatlista')}
  
  <div class="mb-6 text-center text-gray-500 font-medium">
    ${dateStr}
  </div>

  <div class="w-full">
    <div id="controlsContainer" class="flex flex-wrap items-center gap-4 mb-4">
      <!-- Sökfält -->
      <div class="search-input-wrap">
        <i class="fas fa-search"></i>
        <input id="quickSearch" type="search" placeholder="Sök kusk, häst..." class="w-full px-3 py-2 border rounded-md" />
      </div>

      <!-- Startordning / Klassvis -->
      <div id="modeToggle" class="segmented-control">
        <button type="button" data-mode="startorder" class="${viewMode === 'startorder' ? 'active' : ''}">Startordning</button>
        <button type="button" data-mode="byclass" class="${viewMode === 'byclass' ? 'active' : ''}">Klassvis</button>
      </div>

      <div class="h-6 w-px bg-gray-200 hidden md:block"></div>

      <!-- Endast pågående / Endast klara -->
      <div id="statusToggle" class="segmented-control">
        <button type="button" data-filter="ongoing" class="${showOnlyOngoing ? 'active' : ''}">Endast pågående</button>
        <button type="button" data-filter="completed" class="${showOnlyCompleted ? 'active' : ''}">Endast klara</button>
      </div>

      <!-- Export-knappar (flyttade till höger) -->
      <div class="flex items-center gap-2 ml-auto">
        <button id="exportCsvBtn" class="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-slate-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition border border-gray-300 shadow-sm">
           <i class="fas fa-file-csv"></i> CSV
        </button>
        <button id="btnExportPdf" class="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium transition shadow-sm">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 1 0 01-2 2z"/></svg>
          Skriv ut PDF
        </button>
      </div>
    </div>

    <!-- Klass-filter (chips) -->
    <div id="classChips" class="flex flex-wrap items-center gap-2 mb-4"></div>

    <!-- Status-badges per gren -->
    <div class="flex items-center gap-3 mb-4">
      <div id="disciplinesStatus" class="flex flex-wrap gap-2 items-center">
        <!-- fylls i render() -->
      </div>
      <button id="toggleHelpBtn" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs font-medium transition-colors border border-blue-200" title="Visa förklaring av symboler">
        <i class="fas fa-question-circle"></i>
        <span>Förklaring</span>
      </button>
    </div>

    <!-- Förklaringar / Legend (Toggleable) -->
    <div id="helpPanel" class="results-legend mb-4">
      <div class="flex items-center justify-between mb-2">
        <h4 class="font-bold text-slate-800">Symbolförklaring & Exempel</h4>
      </div>
      <div class="legend-grid">
        <div class="legend-item">
          <span class="legend-label">(+Δ)</span> 
          <span>Skillnad mot ledaren • <i class="text-xs text-slate-400">Ex: (+2.50)</i></span>
        </div>
        <div class="legend-item">
          <span class="legend-label">↗︎</span> 
          <span>Gap till närmast framför • <i class="text-xs text-slate-400">Ex: ↗︎ 0.45</i></span>
        </div>
        <div class="legend-item">
          <span class="legend-label">R / T</span> 
          <span>Rivning (R) / Tid (T) straff • <i class="text-xs text-slate-400">Ex: R 3.0 / T 0.5</i></span>
        </div>
        <div class="legend-item">
          <span class="live-dot" style="position:static; transform:none;"></span> 
          <span>Pågår (Resultat uppdateras live)</span>
        </div>
        <div class="legend-item">
          <span class="legend-label">ELIM</span> 
          <span>Utesluten/Brutit • <i class="text-xs text-slate-400">Ex: ELIM (MA)</i></span>
        </div>
        <div class="legend-item">
          <span class="legend-label">Fyllig stil</span> 
          <span>Bästa dressyrresultat i klassen</span>
        </div>
      </div>
    </div>

    <div id="totalResultsContainer"></div>
  </div>`;

  // --- Export PDF (Enhanced) ---
  const btnPdf = document.getElementById('btnExportPdf');
  if (btnPdf) {
    btnPdf.onclick = async () => {
      try {
        const comp = getGlobalState('currentCompetition') || {};
        const rows = __latestDisplayedRows || [];

        // Build a simple string of officials for the PDF
        const listOfficialsText = () => {
          const juryLines = [];
          (allCompetitionJudges || []).forEach(j => {
            const nm = j?.name || j?.fullName || '';
            if (!nm) return;
            const pos = (j?.position) || ((j?.roles || []).find(r => r?.position)?.position) || '';
            juryLines.push(`${nm}${pos ? ` (${pos})` : ''}`);
          });

          const pick = (rx) => (allOfficials || []).filter(o => rx.test(String(o?.role || ''))).map(o => o.name).filter(Boolean);
          const courseDesigners = pick(/banbyggare/i);
          const showDirector = pick(/tävlingsledare/i);

          let text = '';
          if (juryLines.length) text += `Ground Jury: ${juryLines.join(', ')}. `;
          if (courseDesigners.length) text += `Banbyggare: ${courseDesigners.join(', ')}. `;
          if (showDirector.length) text += `Tävlingsledare: ${showDirector.join(', ')}. `;
          return text.trim();
        };

        await generateTotalResultsPdf(rows, comp, {
          viewMode,
          officials: listOfficialsText()
        });
      } catch (err) {
        console.error('Kunde inte generera PDF:', err);
        alert('Ett fel uppstod vid generering av PDF.');
      }
    };
  }

  // --- Export CSV ---
  const btnExport = document.getElementById('exportCsvBtn');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      buildCsvFromRows(__latestDisplayedRows, ';');
    });
  }

  // --- Snabbsök ---
  const qs = document.getElementById('quickSearch');
  if (qs) {
    qs.value = searchQuery || '';
    qs.oninput = (e) => {
      searchQuery = (e.target.value || '').toLowerCase().trim();
      render();
    };
  }

  // --- Segmented Control: Startordning / Klassvis ---
  const modeWrap = document.getElementById('modeToggle');
  if (modeWrap) {
    modeWrap.onclick = (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      viewMode = btn.dataset.mode;
      modeWrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    };
  }

  // --- Segmented Control: Ongoing / Completed ---
  const statusWrap = document.getElementById('statusToggle');
  if (statusWrap) {
    statusWrap.onclick = (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      const f = btn.dataset.filter;
      if (f === 'completed') {
        showOnlyCompleted = !showOnlyCompleted;
        if (showOnlyCompleted) showOnlyOngoing = false;
        statusWrap.querySelector('[data-filter="ongoing"]').classList.remove('active');
        btn.classList.toggle('active', showOnlyCompleted);
      } else if (f === 'ongoing') {
        showOnlyOngoing = !showOnlyOngoing;
        if (showOnlyOngoing) showOnlyCompleted = false;
        statusWrap.querySelector('[data-filter="completed"]').classList.remove('active');
        btn.classList.toggle('active', showOnlyOngoing);
      }
      render();
    };
  }

  // --- Klasschips-lyssnare ---
  const chipHost = document.getElementById('classChips');
  if (chipHost) {
    chipHost.onclick = (e) => {
      const btn = e.target.closest('button[data-class]');
      if (!btn) return;
      const cls = btn.dataset.class;
      if (activeClassFilters.has(cls)) {
        activeClassFilters.delete(cls);
      } else {
        activeClassFilters.add(cls);
      }
      render();
    };
  }

  // --- Hjälp-panel Toggle ---
  const helpBtn = document.getElementById('toggleHelpBtn');
  const helpPanel = document.getElementById('helpPanel');
  if (helpBtn && helpPanel) {
    helpBtn.onclick = () => {
      const isVisible = helpPanel.classList.toggle('visible');
      helpBtn.classList.toggle('active', isVisible);
    };
  }
}

function renderMobile() {
  const container = document.getElementById('totalResultsContainer');
  if (!container) return;

  // Samma logik som desktop för att hämta och filtrera data
  const rows = __latestDisplayedRows || []; // Använd den globalt sparade listan

  let html = '';
  if (rows.length === 0) {
    html = `<div class="p-6 text-center text-gray-500">Inga ekipage matchar din sökning.</div>`;
  } else {
    let lastClass = null;
    rows.forEach(r => {
      const eq = equipages.find(e => String(e.startNumber) === String(r.startNumber)) || {};

      // Klassrubrik om vyn är grupperad per klass
      if (viewMode === 'byclass' && r.className !== lastClass) {
        html += `<div class="px-4 py-2 mt-2 bg-blue-100 text-blue-800 font-bold text-lg rounded-md">${r.className || 'Okänd Klass'}</div>`;
        lastClass = r.className;
      }

      const totalLabel = r.isEliminated ? `<span class="text-red-600 font-bold">${r.elimReason || 'ELIM'}</span>` : (r.totalPenalty != null ? `${r.totalPenalty.toFixed(2)} p` : '—');
      const dressyrLabel = r.dressage?.penalty != null ? `${r.dressage.penalty.toFixed(2)}` : '—';
      const maratonLabel = r.marathon?.totalPenalty != null ? `${r.marathon.totalPenalty.toFixed(2)}` : '—';
      const precisionLabel = r.precision?.pen != null ? `${r.precision.pen.toFixed(2)}` : '—';
      const statusKind = r.isEliminated ? 'elim' : (r.totalPenalty != null ? 'ok' : 'missing');

      // Skapa kortet
      html += `
        <div class="m-2 rounded-xl border shadow-sm bg-white overflow-hidden cursor-pointer" data-start="${r.startNumber}" role="button" tabindex="0">
          <div class="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-4">
            <div>
              <div class="font-semibold text-lg">#${r.startNumber} ${r.driverName}</div>
              <div class="text-sm text-gray-500">${
        // === DEBUG & SAFEGUARD ===
        (typeof horseLabel === 'function')
          ? horseLabel(eq)
          : (console.error(`ERROR: horseLabel är inte en funktion vid renderMobile för SN ${r.startNumber}! Typ: ${typeof horseLabel}`), 'Hästinfo saknas')
        // === SLUT PÅ DEBUG ===
        }</div>
            </div>
            <div class="text-center">
              <div class="text-xs text-gray-500">Plac.</div>
              <div class="text-2xl font-bold">${r.plac || '—'}</div>
            </div>
          </div>
          <div class="p-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><span class="text-gray-500">Klass:</span> <span class="font-medium">${r.className || '—'}</span></div>
            <div class="flex items-center gap-2"> ${getFlagHtml(eq)} ${getClubLogoHtml(eq)} <span class="font-medium truncate">${eq.clubName || '—'}</span></div>

            <div class="pt-2 border-t col-span-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <div class="text-xs text-gray-500">Dressyr</div>
                <div class="font-semibold">${statusIcon(r.dressageStatus || 'missing')} ${dressyrLabel}</div>
              </div>
              <div>
                <div class="text-xs text-gray-500">Maraton</div>
                <div class="font-semibold">${statusIcon(r.marathonStatus || 'missing')} ${maratonLabel}</div>
              </div>
              <div>
                <div class="text-xs text-gray-500">Precision</div>
                <div class="font-semibold">${statusIcon(r.precisionStatus || 'missing')} ${precisionLabel}</div>
              </div>
            </div>

            <div class="pt-2 border-t col-span-2 text-center">
              <div class="text-sm text-gray-500">Totalt Straff</div>
              <div class="font-bold text-blue-800 text-xl">${totalLabel}</div>
            </div>
          </div>
        </div>
        `;
    });
  }

  container.innerHTML = `<div class="bg-gray-50 py-1">${html}</div>`;

  // Koppla klick-lyssnare till korten för att öppna modalen
  container.querySelectorAll('[data-start]').forEach(card => {
    card.addEventListener('click', () => {
      const sn = card.getAttribute('data-start');
      openEquipageModal(String(sn), getEquipageModalCtx()); // Använd den importerade modal-funktionen
    });
  });

  // === Tråda tabellens huvud för sortering ===
  const head = container.querySelector('thead');
  if (head && !head.dataset.wired) {
    head.addEventListener('click', (e) => {
      const thEl = e.target.closest('th.sortable-header');
      if (!thEl) return;
      const key = thEl.dataset.key;
      setSort(key);
    });
    head.dataset.wired = '1';
  }
}

function setSort(key) {
  if (sortConfig.key === key) {
    sortConfig.direction = (sortConfig.direction === 'asc') ? 'desc' : 'asc';
  } else {
    sortConfig.key = key;
    sortConfig.direction = 'asc';
  }
  render();
}

async function recompute() {
  const allPrograms = getPrograms();
  const marathonConfig = window.marathonConfig || {}; // Säkra config

  const rows = equipages.map(e => {
    const sn = String(e.startNumber);
    const cls = e.className || '';

    // 1. Dressyr
    // 1. Dressyr
    const rawProtocols = dressageMap.get(sn) || [];
    const dressageProtocols = deduplicateAndFilterProtocols(rawProtocols, allCompetitionJudges || []);
    const dressageResult = calculateAggregateDressagePenalty(dressageProtocols, allPrograms);

    // Vi vill ha både straff och procent (för tiebreak/visning)
    // calculateAggregateDressagePenalty returnerar bara penalty (avg).
    // För full data kan vi behöva anpassa eller räkna procent separat om det behövs,
    // men låt oss se om vi kan få ut mer från utils.
    // Egentligen vore det bra om utils gav oss allt.

    // För nu, låt oss räkna procent snabbt här om utils inte ger det,
    // ELLER se om vi kan uppdatera utils.
    // Faktum är att computeFinalFromSaved i dressageUtils ger {points, percent, penalty}.
    const computedDressage = computeFinalFromSaved(e, dressageProtocols, allPrograms[e.testKey] || allPrograms[guessProgramKeyFromClass(cls, allPrograms)] || null);
    const d = computedDressage || { penalty: null, percentAvg: null, eliminated: dressageProtocols.some(p => p.eliminated) };
    if (d.percent) d.percentAvg = d.percent; // mapping

    // 2. Maraton
    // marathonObstacleMap bör nu lagra hela dokumentet (med obstacles-array)
    const marDoc = marathonObstacleMap.get(sn) || {};
    const timeDoc = lastSeenMarathonDurations.get(sn) || marathonTimeMap.get(sn) || {};
    const marRes = calculateMarathonResult(e, marDoc, timeDoc);

    // 3. Precision
    const precDoc = precisionMap.get(sn) || {};
    const precRes = calculatePrecisionResult(precDoc, e, precisionConfig);

    // ---- Total ----
    let totalPenalty = null;
    const elimDress = !!d.eliminated;
    const elimMar = !!marRes.eliminated;
    const elimPrec = !!precRes.eliminated;
    const isEliminated = elimDress || elimMar || elimPrec;
    const elimReason = elimDress ? 'ELIM (DR)' : (elimMar ? 'ELIM (MA)' : (elimPrec ? 'ELIM (PR)' : null));

    if (!isEliminated && d.penalty != null && marRes.totalPenalty != null && precRes.totalPenalty != null) {
      totalPenalty = round2(d.penalty + marRes.totalPenalty + precRes.totalPenalty);
    }

    const g = resolveMergeGrouping(e, displayConfig);

    return {
      startNumber: e.startNumber,
      driverName: e.driverName || e.name || '',
      clubName: e.clubName || '',
      className: cls,
      displayGroupKey: g.key,
      displayGroupLabel: g.label,
      dressage: d,
      marathon: {
        ...marRes,
        timePenalty: (marRes.stages?.A?.timePenalty || 0) + (marRes.stages?.B?.timePenalty || 0), // Support CSV
        obstaclePenalty: marRes.obstacles?.sum || 0 // Support CSV
      },
      precision: {
        ...precRes,
        pen: precRes.totalPenalty,
        obstPen: precRes.obstaclePenalty,
        timePen: precRes.timePenalty
      },
      totalPenalty,
      isEliminated,
      elimReason,
      isOngoing: (!isEliminated && totalPenalty == null && (dressageProtocols.length > 0 || marRes.totalPenalty != null || precRes.totalPenalty != null))
      // Enklare logik: har börjat på något men inte klar med allt.
    };
  });

  // Placering per gren inom klass
  function rankWithinClass(baseRows, valuePicker, outField, higherIsBetter = false) {
    const byClass = new Map();
    baseRows.forEach(r => {
      const cls = r.className || '—';
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push(r);
    });

    for (const [cls, arr] of byClass) {
      // sortera giltiga (icke-elim och har siffra) efter värde
      const valid = arr
        .filter(r => {
          const v = valuePicker(r);
          const elim = !!(r.isEliminated);
          return !elim && Number.isFinite(v);
        })
        .sort((a, b) => {
          const va = valuePicker(a), vb = valuePicker(b);
          return higherIsBetter ? (vb - va) : (va - vb);
        });

      let place = 1;
      let lastVal = undefined;
      valid.forEach(r => {
        const v = valuePicker(r);
        if (lastVal === undefined || v !== lastVal) {
          // ny plats om värdet skiljer sig (enkel tie-hantering)
        }
        r[outField] = place++;
        lastVal = v;
      });
    }
  }

  // Dressyr: lägre straff är bättre
  rankWithinClass(rows, r => r?.dressage?.penalty, 'posDress', false);

  // Maraton: lägre total maratonstraff är bättre
  rankWithinClass(rows, r => r?.marathon?.totalPenalty, 'posMar', false);

  // Precision: lägre straff är bättre
  rankWithinClass(rows, r => r?.precision?.pen, 'posPrec', false);


  processedResults = placeWithinClass(rows);

  // Beräkna diff till ledare OCH till närmast framförvarande (inom klass)
  const groupsByClass = new Map();
  for (const r of processedResults) {
    const gk = r.displayGroupKey || `CLASS:${r.className || '—'}`;
    if (!groupsByClass.has(gk)) groupsByClass.set(gk, []);
    groupsByClass.get(gk).push(r);
  }

  groupsByClass.forEach(arr => {
    // arr är redan sorterad av placeWithinClass
    // diffFromLeader
    const leader = arr.find(x => !x.isEliminated && Number.isFinite(x.totalPenalty));
    arr.forEach(x => {
      x.diffFromLeader = (!leader || x.isEliminated || !Number.isFinite(x.totalPenalty))
        ? null
        : round2(x.totalPenalty - leader.totalPenalty);
    });

    // diffFromNext (till närmast bättre)
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i];
      if (r.isEliminated || !Number.isFinite(r.totalPenalty)) { r.diffFromNext = null; continue; }
      let j = i - 1, found = null;
      while (j >= 0) {
        const cand = arr[j];
        if (!cand.isEliminated && Number.isFinite(cand.totalPenalty)) { found = cand; break; }
        j--;
      }
      r.diffFromNext = found ? round2(r.totalPenalty - found.totalPenalty) : null;
    }
  });

  // Status per gren (för ikon i tabellen)
  processedResults.forEach(r => {
    // Dressyr
    if (r.isEliminated) r.dressageStatus = 'elim';
    else if (r?.dressage?.penalty != null || r?.dressage?.percentAvg != null) r.dressageStatus = 'ok';
    else r.dressageStatus = 'missing';

    // Maraton
    if (r.isEliminated) r.marathonStatus = 'elim';
    else if (r?.marathon?.totalPenalty != null) r.marathonStatus = 'ok';
    else if (r?.marathon?.timePenalty != null || r?.marathon?.obstaclePenalty != null) r.marathonStatus = 'partial';
    else r.marathonStatus = 'missing';

    // Precision
    if (r?.precision?.eliminated) r.precisionStatus = 'elim';
    else if (r?.precision?.pen != null) r.precisionStatus = 'ok';
    else r.precisionStatus = 'missing';
  });


  // Bästa dressyr per klass
  bestDressageByClass.clear();
  processedResults.forEach(r => {
    const key = r.displayGroupKey || `CLASS:${r.className || '—'}`;
    const pct = r.dressage?.percentAvg;
    if (typeof pct === 'number') {
      const cur = bestDressageByClass.get(key);
      if (cur == null || pct > cur) bestDressageByClass.set(key, pct);
    }
  });

  render();
}

// DELETED primeDressage - handled by listeners and recompute

function attachListeners() {
  // 1) Dressyr - NU COLLECTION GROUP (Ersätter N separata lyssnare)
  unsub.push(listenForDressageProtocolsCollectionGroup(competitionId, equipages, (docs) => {
    // Gruppera docs efter startNumber
    const grouped = new Map();
    docs.forEach(d => {
      const sn = String(d.startNumber);
      if (!grouped.has(sn)) grouped.set(sn, []);
      grouped.get(sn).push(d);
    });

    // Uppdatera dressageMap
    dressageMap.clear();
    grouped.forEach((list, sn) => dressageMap.set(sn, list));
    requestRecompute();
  }));

  // 2) Precision - Collection-nivå
  unsub.push(listenForPrecisionResults(competitionId, (docs) => {
    precisionMap.clear();
    docs.forEach(d => precisionMap.set(String(d.id || d.startNumber), d));
    requestRecompute();
  }));

  // 3) Maraton (Hinder) - NU COLLECTION-NIVÅ
  unsub.push(listenForMaratonCollection(competitionId, (docs) => {
    marathonObstacleMap.clear();
    docs.forEach(d => marathonObstacleMap.set(String(d.id), d));
    requestRecompute();
  }));

  // 4) Maraton-tider (live) - COLLECTION-NIVÅ
  unsub.push(listenForMaratonTimingUpdates(competitionId, (docs) => {
    const list = Array.isArray(docs) ? docs : (Array.isArray(docs?.docs) ? docs.docs : Object.values(docs || {}));
    marathonTimeMap.clear();
    for (const doc of list) {
      const data = typeof doc.data === 'function' ? doc.data() : doc;
      const id = doc.id || data.id || data.startNumber;
      if (id) marathonTimeMap.set(String(id), data);
    }
    requestRecompute();
  }));

  // 5) Officials/Judges
  unsub.push(listenForOfficials(competitionId, (list) => {
    allOfficials = list || [];
  }));
  unsub.push(listenForJudges(competitionId, (judges) => {
    allCompetitionJudges = judges || [];
  }));
}


// Återställd refreshMarathonTimes för initial laddning
async function refreshMarathonTimes() {
  if (!competitionId) return;
  const docs = await getMaratonTimingData(competitionId);
  marathonTimeMap.clear();
  docs.forEach(doc => {
    // doc.id är startNumber, doc.data() är timing-infot
    const data = typeof doc.data === 'function' ? doc.data() : doc;
    marathonTimeMap.set(String(doc.id), data);
  });
  requestRecompute();
}
export async function load(el) {
  console.log('Totalresultat load startar...');
  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id || null;

  if (!competitionId) {
    console.error('Ingen tävling vald!');
    if (el) el.innerHTML = '<div class="p-8 text-center text-red-600 font-bold">Ingen tävling vald. Gå tillbaka till startsidan och välj en tävling.</div>';
    return;
  }


  // 1. Ladda nödvändig grunddata
  // 1. Ladda nödvändig grunddata
  try {
    const [eqList, marCfg, preCfg, dispCfg, dressMapCfg] = await Promise.all([
      getEquipages(competitionId),
      getConfig(competitionId, 'marathon'),
      getConfig(competitionId, 'precision'),
      getConfig(competitionId, 'display'),
      getConfig(competitionId, 'dressyrProgramMapping').catch(() => ({})), // New: fetch program mapping
      ensureClubLogosLoaded()
    ]);

    const cfg = {
      marathon: marCfg,
      precision: preCfg,
      display: dispCfg
    };

    equipages = eqList || [];
    marathonConfig = cfg.marathon || {};
    setMarathonConfig(marathonConfig);
    precisionConfig = cfg.precision || {};
    // Försök läsa in displayConfig om det finns sparat i config
    displayConfig = cfg.display || null;

    // Configure dressage mapping globally (like dressyr-monitor.js)
    window.klassProgramMapping = (dressMapCfg && typeof dressMapCfg === 'object') ? dressMapCfg : {};

  } catch (err) {
    console.error('Fel vid hämtning av data i init:', err);
  }

  // 2. Rita upp sidans struktur
  injectTotalResultsStyles();
  renderLayout();

  // 3. Starta lyssnare (dressyr, maratonhinder, precision)
  attachListeners();

  // 4. Hämta maratontider (A/B)
  await refreshMarathonTimes();

  // 5. Trigga första beräkningen
  requestRecompute();
}

// Lägg till dessa om de saknas:

const toSec = (val) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && val.includes(':')) {
    const [m, s] = val.split(':').map(Number);
    return (m * 60) + (s || 0);
  }
  return Number(val) || 0;
};

// Hjälpfunktion för att hämta tider från rådata
function getDurationSec(row, section) {
  if (!row) return null;
  const s = String(section).toLowerCase();
  const S = String(section).toUpperCase();

  // 1) Färdiga sekunder
  const candidates = [
    row[`duration_${S}`], row[`duration_${s}`],
    row[s]?.durationSec
  ];
  const directSec = candidates.find(v => typeof v === 'number' && Number.isFinite(v));
  if (directSec != null) return Number(directSec);

  // 2) Millisekunder
  const msCandidates = [
    row[`duration_${s}_ms`], row[`duration_${S}_ms`],
    row[s]?.durationMs
  ];
  const directMs = msCandidates.find(v => typeof v === 'number' && Number.isFinite(v));
  if (directMs != null) return Number(directMs) / 1000;

  return null;
}

export function __unload() {
  // 1) Stoppa lyssnare (Använder 'unsub'-arrayen som definierades i toppen)
  if (Array.isArray(unsub)) {
    unsub.forEach(u => u && typeof u === 'function' && u());
    unsub = [];
  }

  // Stoppa eventuella computed-lyssnare
  if (unsubscribeComputed) { unsubscribeComputed(); unsubscribeComputed = null; }

  // 2) Rensa data
  marathonTimeMap.clear();
  marathonObstacleMap.clear();
  dressageMap.clear();
  marathonConfig = null;
  precisionConfig = null;
  processedResults = [];
  sortConfig = { key: 'plac', direction: 'asc' };
  bestDressageByClass.clear();
  viewMode = 'startorder';
  searchQuery = '';
  activeClassFilters.clear();
  computedMap.clear();
  computedBySn.clear();
  lastSeenMarathonDurations.clear();
  IS_FEI = false;
  allOfficials = [];
  isPrintExport = false;
  showOnlyCompleted = false;
  __latestDisplayedRows = [];

  // 3) Nollställ globala scroll-helpers
  try { window.__teardownXbarSync?.(); } catch { }
  window.__teardownXbarSync = undefined;
  window.__setupXbarSync = undefined;

  console.log('✅ TotalResultat unload klar');
}