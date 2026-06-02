// total-resultat.js — TR-korrekt totalresultat (Svenska + FEI)
// v1.2:
//  - Visar även faktisk tid (A/B) i maratonkolumnen (mm:ss)
//  - Markerar bästa dressyrresultat i varje klass med fet stil
//  - Liten "Skriv ut / PDF"-knapp (window.print()) i headern

import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { listenForDressageProtocolsCollectionGroup } from '../../services/dressageService.js';
import { getMarathonTimingData } from '../../services/marathonService.js';
import { listenForPrecisionResults } from '../../services/precisionService.js';
import { listenForOfficials, listenForJudges } from '../../services/adminService.js';
import { listenForMaratonCollection, listenForMarathonTimingUpdates } from '../../services/marathonService.js';
import { listenForTeams } from '../../services/teamService.js';
import { t } from '../../utils/i18n.js';

import { calculateTotalResult } from '../../services/calculationService.js';
import { calculateTeamResults } from '../../services/teamCalculationService.js';
import { getCompetitionHeader, renderResponsiveClassFilter } from '../../ui/components.js';
import { ensureClubLogosLoaded, getClubLogoHtml, getClubLogoUrl } from '../../services/logosService.js';
import { getFlagHtml, flagPngUrl, normalizeCountryCode } from '../../services/flagsService.js';
import { dressagePrograms } from '../../data/dressagePrograms.js';
import { openEquipageModal } from '../../ui/equipage-modal.js';
import { injectScrollStyles, initializeScrollSync } from '../../ui/scrollHelper.js';
import { generateTotalResultsPdf } from '../../pdf/totalResultsPdf.js';
import { generateTeamResultsPdf } from '../../pdf/teamResultsPdf.js';
import {
  applyTotalDisciplineStatuses,
  buildTotalResultRow
} from './totalResultRows.js';
import {
  applyTotalDisciplinePlacements,
  applyTotalResultDiffs,
  buildBestDressageByGroup,
  buildDisplayedTotalRows,
  placeTotalRowsWithinClass
} from './totalResultRanking.js';
import {
  groupDocsByStartNumber,
  mapRowsByStartNumber,
  normalizeTimingDocs,
  replaceMapContents,
  unsubscribeAll
} from './totalResultListeners.js';
import {
  groupTotalEquipagesForDisplay,
  resolveTotalMergeGrouping
} from './totalResultGrouping.js';
import { downloadTotalCsv } from './totalResultCsv.js';
import {
  buildProcessedTotalTeams,
  buildTeamDisciplineBests,
  renderTeamCard,
  renderTeamMemberRow
} from './totalResultTeams.js';
import {
  formatTotalResultPenalty,
  formatTotalResultPercent,
  isTotalDisciplineEliminated
} from './totalResultDisplayUtils.js';

import {
  round2,
  secondsToMMSS,
  escapeHtml,
  isMobile
} from '../../utils/sharedUtils.js';

import {
  limitsFor,
  setMarathonConfig
} from '../../utils/marathonUtils.js';

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

let rawTeams = [];
let processedTeams = [];
let currentMainTab = 'individual'; // 'individual' | 'teams'
let totalResultsResizeHandler = null;

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
    marathonTimeMap,
    marathonObstacleMap,
    competitionConfig: window.competitionConfig || {}, // Passa den globala configen om den finns
    classProgramMapping: window.klassProgramMapping || {}, // Passa program-mappningen
    // Vi skickar in våra egna hjälpare så modalen kan visa fönster/format
    limitsFor,          // finns redan i denna fil
    secondsToMMSS,      // finns redan i denna fil
  };
}

// Mobil-detektering importeras globalt från sharedUtils.js

// Ny huvudfunktion som väljer rätt vy

function render() {
  // === STEG 1: DATABEARBETNING (Flyttad från renderDesktop) ===
  const competition = getGlobalState('currentCompetition');
  const showTeams = competition?.showTeams === true;

  // TAB SWITCH LOGIC
  if (showTeams && currentMainTab === 'teams') {
    renderTeams();
    return; // Stop here
  }

  // Bygg/uppdatera grupp-chips (detta måste hända FÖRE filtrering)
  (() => {
    const chipHost = document.getElementById('classChips');
    if (!chipHost) return;

    const groups = groupTotalEquipagesForDisplay(equipages, displayConfig);
    const labels = groups.map(g => g.label);

    renderResponsiveClassFilter(chipHost, labels, activeClassFilters, (lbl) => {
      if (activeClassFilters.has(lbl)) {
        activeClassFilters.delete(lbl);
      } else {
        activeClassFilters.add(lbl);
      }
      render();
    });
  })();

  const viewData = buildDisplayedTotalRows(processedResults, {
    activeClassFilters,
    searchQuery,
    equipages,
    showOnlyCompleted,
    showOnlyOngoing,
    sortConfig
  });

  // Spara den slutgiltiga listan globalt så BÅDA vyerna kan läsa den
  __latestDisplayedRows = Array.isArray(viewData) ? viewData.slice() : [];

  // === STEG 2: VÄLJ VY ===
  if (isMobile()) {
    window.__teardownXbarSync?.(); // Städa undan X-baren i mobilvy
    renderMobile(); // Denna läser nu den uppdaterade __latestDisplayedRows
  } else {
    renderDesktop(); // Denna läser nu den uppdaterade __latestDisplayedRows
  }
}

// --- STATUSIKONER ---
function statusIcon(kind) {
  const map = {
    ok: { title: 'Komplett', svg: 'M20 6L9 17l-5-5', cls: 'text-green-600 dark:text-green-400' },
    partial: { title: 'Delvis', svg: 'M4 12h16', cls: 'text-amber-600 dark:text-amber-400' },
    missing: { title: 'Saknas', svg: 'M6 6l12 12', cls: 'text-gray-400 dark:text-gray-500' },
    elim: { title: 'Eliminerad', svg: 'M6 6l12 12', cls: 'text-red-600 dark:text-red-400' }
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
    /* Header background in dark mode */
    .dark .total-results-table thead th {
      background: #1f2937; /* gray-800 */
      border-bottom: 2px solid #374151; /* gray-700 */
      color: #e5e7eb; /* gray-200 */
    }

    /* Sticky columns background in dark mode */
    .dark .bg-white .sticky-col-start,
    .dark .bg-white .sticky-col-driver {
        background-color: #1f2937; /* gray-800 */
    }
    .dark .bg-gray-50 .sticky-col-start,
    .dark .bg-gray-50 .sticky-col-driver {
        background-color: #111827; /* gray-900 */
    }
    /* Eliminated rows in dark mode */
    .dark .bg-red-50 .sticky-col-start,
    .dark .bg-red-50 .sticky-col-driver {
        background-color: #450a0a; /* red-950 approx */
    }

    /* Text colors in table for dark mode */
    .dark .total-results-table tbody td {
        border-bottom: 1px solid #374151;
        color: #d1d5db;
    }

    
    /* Dark Mode Overrides for Sticky Cols */
    html.dark .total-results-table thead th {
      background: #1f2937;
      border-bottom-color: #374151;
      color: #f3f4f6;
    }
    html.dark .total-results-table tbody td {
      border-bottom-color: #374151;
      color: #e5e7eb;
    }
    html.dark .bg-white .sticky-col-start,
    html.dark .bg-white .sticky-col-driver {
      background-color: #1f2937; /* gray-800 */
    }
    html.dark .bg-gray-50 .sticky-col-start,
    html.dark .bg-gray-50 .sticky-col-driver {
      background-color: #374151; /* gray-700 */
    }
    html.dark .bg-red-50 .sticky-col-start,
    html.dark .bg-red-50 .sticky-col-driver {
      background-color: #7f1d1d; /* red-900 */
    }
  
/* fasta bredder för att säkra linjering */
 .sticky-col-start { min-width: 38px; width: 38px; text-align:center; }
 .sticky-col-driver{ min-width: 130px; max-width: 170px; }
 @media (min-width: 1024px) {
    .sticky-col-start { min-width: 48px; width: 48px; }
    .sticky-col-driver{ min-width: 180px; max-width: 220px; }
 }
.col-klubb   { min-width: 130px; }
.col-hast    { min-width: 180px; }
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
    html.dark .tr-modal { background: #1f2937; color: #f3f4f6; }
    html.dark .tr-modal header { background: #1f2937; border-bottom-color: #374151; }
    html.dark .tr-modal .tabs button { background: #374151; color: #e5e7eb; border-color: #4b5563; }
    html.dark .tr-modal .tabs button.active { background: #e5e7eb; color: #111827; border-color: #e5e7eb; }

    .tr-modal .tabs { display:flex; gap:8px; padding: 10px 16px; border-bottom:1px solid #eee;}
    .tr-modal .tabs button {
      padding:8px 12px; border-radius: 999px; border:1px solid #ddd; background:#fff; cursor:pointer;
    }
    .tr-modal .tabs button.active { background:#111; color:#fff; border-color:#111; }
    .tr-modal .content { padding: 16px; }
    .tr-close { border:0; background:transparent; font-size:20px; cursor:pointer; color:inherit; }

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
    .res-val { font-variant-numeric: tabular-nums; font-size: inherit; }
    .res-pos { font-size: 0.85em; color: #6b7280; }

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

    /* Dark Mode Overrides for UI Components */
    html.dark .segmented-control { background: #374151; }
    html.dark .segmented-control button { color: #9ca3af; }
    html.dark .segmented-control button.active { background: #4b5563; color: #fff; box-shadow: none; }
    html.dark .segmented-control button:hover:not(.active) { color: #fff; }

    html.dark .results-legend { background: #1f2937; border-color: #374151; color: #9ca3af; }
    html.dark .legend-label { color: #e5e7eb; }
    html.dark .search-input-wrap i { color: #9ca3af; }
    html.dark .search-input-wrap input { 
      background-color: #374151; 
      border-color: #4b5563 !important; 
      color: #fff; 
    }
    html.dark h4 { color: #e5e7eb; }
  `;
  const style = document.createElement('style');
  style.id = 'total-results-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
function placeWithinClass(rows) {
  return placeTotalRowsWithinClass(rows);
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
  // === rubriker (sorterbara) ===
  // Använd samma kolumner för både TR och FEI tills vidare
  const headers = [
    { key: 'plac', label: t('rank') },
    { key: 'startNumber', label: '#' },
    { key: 'driverName', label: t('driver_horse') },
    { key: 'className', label: t('class') },
    { key: 'club', label: t('club') },
    { key: 'dressage', label: t('dressage') },
    { key: 'marathon', label: t('marathon') },
    { key: 'precision', label: t('precision') },
    { key: 'totalPenalty', label: t('total') },
  ];

  const th = (h) => {
    let extra = '';
    if (h.key === 'startNumber') extra = ' sticky-col-start bg-gray-50 dark:bg-gray-700';
    if (h.key === 'driverName') extra = ' sticky-col-driver bg-gray-50 dark:bg-gray-700';

    const isActive = sortConfig.key === h.key;
    const sortIcon = sortConfig.direction === 'desc' ? 'fa-sort-down' : 'fa-sort-up';
    const activeClass = isActive ? ' active-sort' : '';

    const title = (h.key === 'totalPenalty')
      ? t('tooltip_total_penalty')
      : '';

    return `
      <th data-key="${h.key}" title="${escapeHtml(title)}" class="sortable-header px-2 py-2 lg:px-3 lg:py-2 text-left text-[10px] lg:text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase transition-all duration-200 ${extra}${activeClass}">
        <div class="flex items-center gap-1.5 lg:gap-2">
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
    const dTextRaw = formatTotalResultPenalty(r.dressage?.penalty, { eliminated: isTotalDisciplineEliminated(r, 'dressage') });
    const dText = `<div class="res-val">${isBestDressage ? `<span class="font-bold text-green-700 dark:text-green-400">${dTextRaw}</span>` : dTextRaw}</div>${dLive}${dPlacHtml}`;

    const isMarRunning = r.marathonStatus === 'ongoing' || r.marathonStatus === 'pågår';
    const mLive = isMarRunning ? '<span class="live-dot"></span>' : '';
    const mText = `<div class="res-val">${formatTotalResultPenalty(r.marathon?.totalPenalty, { eliminated: isTotalDisciplineEliminated(r, 'marathon') })}</div>${mLive}${mPlacHtml}`;
    const mIco = statusIcon(r.marathonStatus || 'missing');

    // const obstAgg = marathonObstacleMap.get(String(r.startNumber)) || {}; // RAW lookup removed
    const mObsItems = r.marathon?.obstacles?.items || [];
    const tp = Number.isFinite(r?.marathon?.timePenalty) ? r.marathon.timePenalty : null;

    // Calculate sums from centralized result items
    const sumKd = mObsItems.reduce((acc, o) => acc + (Number(o.knockDownPenalty) || 0), 0);
    const sumOv = mObsItems.reduce((acc, o) => acc + (Number(o.otherPenalty) || 0), 0);

    const kd = sumKd > 0 ? sumKd : null;
    const ov = sumOv > 0 ? sumOv : null;
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
      ? [Number.isFinite(pOb) ? `${t('knockdown')}: ${pOb.toFixed(2)}` : null,
      Number.isFinite(pTm) ? `${t('time')}: ${pTm.toFixed(2)}` : null
      ].filter(Boolean).join(' • ')
      : '';

    const pMini = (!isPrintExport && (Number.isFinite(pOb) || Number.isFinite(pTm)))
      ? `<div class="text-[10px] leading-3 text-gray-500">
           ${Number.isFinite(pOb) ? `R ${pOb.toFixed(2)}` : 'R —'} /
           ${Number.isFinite(pTm) ? `T ${pTm.toFixed(2)}` : 'T —'}
         </div>`
      : '';

    const pMain = formatTotalResultPenalty(pPen, { eliminated: isTotalDisciplineEliminated(r, 'precision') });
    const pText = `<div class="res-val">${pMain}</div>${pLive}${pPlacHtml}${pMini}`;

    const diff = (!isPrintExport && r.diffFromLeader != null && r.diffFromLeader > 0)
      ? `<span class="text-xs text-gray-500" title="${t('legend_diff_leader')}">(+${r.diffFromLeader.toFixed(2)})</span>` : '';

    const nextMini = (!isPrintExport && r.diffFromNext != null && r.diffFromNext > 0)
      ? `<div class="text-[10px] leading-3 text-gray-500" title="${t('legend_diff_next')}">↗︎ ${r.diffFromNext.toFixed(2)}</div>` : '';

    const tot = `<div class="res-val font-bold text-blue-900 dark:text-blue-300">${formatTotalResultPenalty(r.totalPenalty, { eliminated: r.isEliminated })}</div>`;

    const dPct = formatTotalResultPercent(r.dressage?.percent);

    const rowCls = r.isEliminated ? 'bg-red-50 dark:bg-red-900/30' : (i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700');

    const horse = (eq && typeof eq === 'object' && (eq.horseName || eq.horses || eq.hästnamn)) ? '' : '';
    const clubCell = `
      <div class="flex items-center gap-2">
        ${getFlagHtml(eq) || ''}
        ${getClubLogoHtml(eq) || ''}
        <span>${eq.clubName || ''}</span>
      </div>`;

    return `<tr class="${rowCls}" data-start="${r.startNumber}">
      <td class="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] lg:text-sm font-semibold">${r.isEliminated ? `<span class="text-red-600 font-semibold">${escapeHtml(r.elimReason || 'ELIM')}</span>`
        : (r.plac ?? '')
      }</td>
      <td class="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] lg:text-sm sticky-col-start">${r.startNumber ?? ''}</td>
         <td class="px-2 py-1.5 lg:px-3 lg:py-2 sticky-col-driver">
      <div class="font-medium text-gray-900 break-words max-h-12 overflow-hidden lg:max-h-none dark:text-white text-[12px] lg:text-sm leading-tight">${(r.driverName || '').replaceAll('<', '&lt;')}</div>
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
          ? `<div class="hidden lg:block text-[10px] lg:text-xs text-gray-500 cell-multiline">${names.map(n => `<span class="line">${escapeHtml(n)}</span>`).join('')}</div>`
          : '';
      })()}
    </td>
          <td class="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] lg:text-sm"><div class="truncate max-w-[100px] lg:max-w-[160px]" title="${r.className || ''}">${r.className || ''}</div></td>
          <td class="px-2 py-1.5 lg:px-3 lg:py-2"><div class="truncate max-w-[100px] lg:max-w-[160px] text-[11px] lg:text-sm" title="${eq.clubName || ''}">${clubCell}</div></td>
          <td class="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] lg:text-sm">${dIco}${dText}</td>
          <td class="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] lg:text-sm whitespace-nowrap" title="${escapeHtml(tt)}">${mIco}${mText}</td>
          <td class="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] lg:text-sm whitespace-nowrap">${pIco}${pText}</td>
          <td class="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] lg:text-sm font-semibold whitespace-nowrap">${tot} ${diff}${nextMini}</td>
    </tr>`;
  };

  // === tabell ===
  const tableHead = `<thead class="bg-gray-50 dark:bg-gray-700"><tr>${headers.map(th).join('')}</tr></thead>`;

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
        jumpHost.innerHTML = classes.map(cls => `<a href="#${anchorId(cls)}" class="px-2 py-1 rounded border hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">${escapeHtml(cls)}</a>`).join('');
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
        <span class="inline-block px-2 py-0.5 rounded-md border text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 mr-2">
          ${finished}/${total} ${t('completed_count')} • ${elim} ${t('elim_count')}
        </span>
        ${leader != null ? `<span class="inline-block px-2 py-0.5 rounded-md border text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800 mr-2">
          ${t('leader')}: ${leader.toFixed(2)}
        </span>` : ''}
        ${marginToThird != null ? `<span class="inline-block px-2 py-0.5 rounded-md border text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800">
          ${t('margin_to_third')}: ${marginToThird.toFixed(2)}
        </span>` : ''}
      `;
      tableBody += `
        <tr id="${anchorId(cls)}" class="bg-gray-200 dark:bg-gray-700 border-t-2 border-b-2 border-gray-300 dark:border-gray-600 sticky top-0 z-10">
          <td class="px-3 py-2 font-bold text-gray-800 dark:text-white" colspan="${headers.length}">
            <div class="flex flex-wrap items-center gap-2">
              <span>${escapeHtml(cls)}</span>
              <span class="text-gray-400 dark:text-gray-500">|</span>
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
      // Delay to ensure table layout is ready
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__setupXbarSync({
            barClass: 'fixed-xbar',
            innerId: 'totalXbarInner',
            hostEl: host
          });
        });
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
    // Support both TR (desktop) and DIV/Card (mobile/teams)
    const el = e.target.closest('tbody tr, [data-start]');
    if (!el) return;
    if (e.target.closest('a,button,input,select,textarea,[data-no-rowclick]')) return;
    const sn = el.getAttribute('data-start');
    if (!sn) return;
    openEquipageModal(String(sn), getEquipageModalCtx());
  });
}


function renderTeams() {
  const container = document.getElementById('totalResultsContainer');
  if (!container) return;

  const showTeams = getGlobalState('currentCompetition')?.showTeams;
  if (!showTeams) return;

  if (!processedTeams || processedTeams.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-gray-500 dark:text-gray-400">Inga lag skapade än.</div>`;
    return;
  }

  const teamBests = buildTeamDisciplineBests(processedTeams);

  // Render Table
  const rows = processedTeams.map((team, idx) => {
    // Resolve Team Assets (Logo/Flag)
    let teamAssetHtml = '';
    const clubUrl = getClubLogoUrl(team.teamName);
    if (clubUrl) {
      teamAssetHtml += `<img src="${clubUrl}" alt="Logga" class="h-10 w-auto object-contain mr-3">`;
    }
    const cc = normalizeCountryCode(team.teamName);
    if (cc) {
      const flagUrl = flagPngUrl(cc);
      teamAssetHtml += `<img src="${flagUrl}" alt="${cc}" class="h-8 w-auto object-contain mr-3 shadow-sm">`;
    }

    // Member details
    const membersHtml = team.members.map(m => {
      const eq = equipages.find(e => String(e.startNumber) === String(m.startNumber));
      return renderTeamMemberRow(m, {
        flagHtml: getFlagHtml(eq),
        clubLogoHtml: getClubLogoHtml(eq, { className: 'inline-block h-4 w-auto ml-1 align-sub opacity-80', style: '' }),
        clubName: eq?.clubName || ''
      });
    }).join('');

    return renderTeamCard(team, {
      index: idx,
      teamBests,
      teamAssetHtml,
      membersHtml
    });
  }).join('');

  container.innerHTML = `<div class="max-w-4xl mx-auto mt-6">${rows}</div>`;
}

function renderLayout() {
  const competition = getGlobalState('currentCompetition');
  const root = document.getElementById('page-total-resultat');

  // Datum-sträng (samma som i headern för maraton)
  const dt = new Date();
  const dateStr = dt.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  root.innerHTML = `
  ${getCompetitionHeader(competition, t('total_results_title'))}
  
  <div class="mb-6 text-center text-gray-500 dark:text-gray-400 font-medium">
    ${dateStr}
  </div>

  <div class="w-full">
    <div id="controlsContainer" class="flex flex-wrap items-center gap-2 mb-3 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700">
      
      <!-- Search Input -->
      <div class="search-input-wrap flex-1 min-w-[200px] relative">
        <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10 text-xs"></i>
        <input id="quickSearch" type="search" placeholder="${t('search_placeholder_short')}" class="w-full pl-8 pr-3 py-1 border rounded leading-5 dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 shadow-sm text-xs" />
      </div>

      <!-- Mode Toggle -->
      <select id="modeSelect" class="border rounded px-2 py-1 text-xs dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 shadow-sm focus:ring-1 focus:ring-blue-500">
        <option value="startorder" ${viewMode === 'startorder' ? 'selected' : ''}>${t('start_order')}</option>
        <option value="byclass" ${viewMode === 'byclass' ? 'selected' : ''}>${t('view_by_class')}</option>
      </select>

      <!-- MAIN TABS (If Teams Enabled) -->
      ${competition.showTeams ? `
        <select id="tabSelect" class="border rounded px-2 py-1 text-xs dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 shadow-sm focus:ring-1 focus:ring-blue-500">
          <option value="individual" ${currentMainTab === 'individual' ? 'selected' : ''}>Individuellt</option>
          <option value="teams" ${currentMainTab === 'teams' ? 'selected' : ''}>Lag</option>
        </select>
      ` : ''}

       <!-- Klasser Dropdown (genereras av renderResponsiveClassFilter) -->
       <div id="classChips" class="flex flex-wrap items-center gap-1"></div>

       <!-- Status Checkboxes -->
       <label class="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
          <input type="checkbox" id="checkOngoing" ${showOnlyOngoing ? 'checked' : ''} class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 dark:bg-gray-700 dark:border-gray-600">
          ${t('show_only_ongoing')}
       </label>
       <label class="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 mr-auto">
          <input type="checkbox" id="checkCompleted" ${showOnlyCompleted ? 'checked' : ''} class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 dark:bg-gray-700 dark:border-gray-600">
          ${t('show_finalized_only')}
       </label>

      <!-- Export Buttons -->
      <div class="flex-shrink-0 flex items-center gap-1.5">
        <button id="exportCsvBtn" title="Exportera CSV" class="inline-flex items-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-xs font-medium rounded text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors">
           <i class="fas fa-file-csv mr-1.5 text-gray-500 dark:text-gray-400"></i>
           CSV
        </button>
        <button id="btnExportPdf" class="inline-flex items-center px-2 py-1.5 border border-transparent shadow-sm text-xs font-medium rounded text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-500 transition-colors">
          <svg class="mr-1.5 h-3 w-3 lg:h-3.5 lg:w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
           ${t('print_pdf')}
        </button>
      </div>
    </div>

    <!-- Status-badges per gren -->
    <div class="flex items-center gap-3 mb-4">
      <div id="disciplinesStatus" class="flex flex-wrap gap-2 items-center">
        <!-- fylls i render() -->
      </div>
      <button id="toggleHelpBtn" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 text-blue-800 dark:text-blue-300 text-xs font-medium transition-colors border border-blue-200 dark:border-blue-800" title="${t('view_legend')}">
        <i class="fas fa-question-circle"></i>
        <span>${t('legend_short')}</span>
      </button>
    </div>

    <!-- Förklaringar / Legend (Toggleable) -->
    <div id="helpPanel" class="results-legend mb-4">
      <div class="flex items-center justify-between mb-2">
        <h4 class="font-bold text-slate-800">${t('symbol_legend_title')}</h4>
      </div>
      <div class="legend-grid">
        <div class="legend-item">
          <span class="legend-label">(+Δ)</span> 
          <span>${t('legend_diff_leader')} • <i class="text-xs text-slate-400">Ex: (+2.50)</i></span>
        </div>
        <div class="legend-item">
          <span class="legend-label">↗︎</span> 
          <span>${t('legend_diff_next')} • <i class="text-xs text-slate-400">Ex: ↗︎ 0.45</i></span>
        </div>
        <div class="legend-item">
          <span class="legend-label">R / T</span> 
          <span>${t('legend_knock_time')} • <i class="text-xs text-slate-400">Ex: R 3.0 / T 0.5</i></span>
        </div>
        <div class="legend-item">
          <span class="live-dot" style="position:static; transform:none;"></span> 
          <span>${t('legend_ongoing')}</span>
        </div>
        <div class="legend-item">
          <span class="legend-label">ELIM</span> 
          <span>${t('legend_elim')} • <i class="text-xs text-slate-400">Ex: ELIM (MA)</i></span>
        </div>
        <div class="legend-item">
          <span class="legend-label">${t('legend_best_dressage')}</span> 
          <span>${t('legend_best_dressage')}</span>
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

        // Fix scope issue
        const stateComp = getGlobalState('currentCompetition');
        const showTeamsLocal = stateComp?.showTeams === true;

        if (showTeamsLocal && currentMainTab === 'teams') {
          // TEAM PDF
          await generateTeamResultsPdf(processedTeams, comp);
        } else {
          // INDIVIDUAL PDF
          await generateTotalResultsPdf(rows, comp, {
            viewMode,
            officials: listOfficialsText()
          });
        }
      } catch (err) {
        console.error('Kunde inte generera PDF:', err);
        alert(t('pdf_export_error'));
      }
    };
  }

  // --- Export CSV ---
  const btnExport = document.getElementById('exportCsvBtn');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      downloadTotalCsv({
        rows: __latestDisplayedRows,
        equipages,
        competitionName: getGlobalState('currentCompetition')?.name || 'tavling',
        translate: t
      }, ';');
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

  // --- Mode Select ---
  const modeSel = document.getElementById('modeSelect');
  if (modeSel) {
    modeSel.onchange = (e) => {
      viewMode = e.target.value;
      render();
    };
  }

  // --- Status Checkboxes ---
  const checkOngoing = document.getElementById('checkOngoing');
  const checkCompleted = document.getElementById('checkCompleted');
  if (checkOngoing) {
    checkOngoing.onchange = (e) => {
      showOnlyOngoing = e.target.checked;
      if (showOnlyOngoing && checkCompleted) checkCompleted.checked = false;
      showOnlyCompleted = checkCompleted ? checkCompleted.checked : false;
      render();
    };
  }
  if (checkCompleted) {
    checkCompleted.onchange = (e) => {
      showOnlyCompleted = e.target.checked;
      if (showOnlyCompleted && checkOngoing) checkOngoing.checked = false;
      showOnlyOngoing = checkOngoing ? checkOngoing.checked : false;
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

  // --- Tab Select (Teams) ---
  const tabSel = document.getElementById('tabSelect');
  if (tabSel) {
    tabSel.onchange = (e) => {
      currentMainTab = e.target.value;
      render();
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
    html = `<div class="p-6 text-center text-gray-500 dark:text-gray-400">${t('search_no_match')}</div>`;
  } else {
    // 1. Calculate starters per class for dynamic placement counts
    const classStarters = new Map();
    rows.forEach(r => {
      const cls = r.className || 'Ok\\u00e4nd Klass';
      classStarters.set(cls, (classStarters.get(cls) || 0) + 1);
    });

    let lastClass = null;
    rows.forEach(r => {
      const eq = equipages.find(e => String(e.startNumber) === String(r.startNumber)) || {};
      const cls = r.className || 'Ok\\u00e4nd Klass';

      // Klassrubrik om vyn är grupperad per klass
      if (viewMode === 'byclass' && r.className !== lastClass) {
        html += `<div class="px-2 py-1.5 mt-2 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-bold text-sm rounded-md shadow-sm">${cls}</div>`;
        lastClass = r.className;
      }

      const totalLabel = r.isEliminated ? `<span class="text-red-600 dark:text-red-400 font-bold">${r.elimReason || 'ELIM'}</span>` : formatTotalResultPenalty(r.totalPenalty);
      const dressyrLabel = formatTotalResultPenalty(r.dressage?.penalty, { eliminated: isTotalDisciplineEliminated(r, 'dressage') });
      const maratonLabel = formatTotalResultPenalty(r.marathon?.totalPenalty, { eliminated: isTotalDisciplineEliminated(r, 'marathon') });
      const precisionLabel = formatTotalResultPenalty(r.precision?.pen, { eliminated: isTotalDisciplineEliminated(r, 'precision') });
      const statusKind = r.isEliminated ? 'elim' : (r.totalPenalty != null ? 'ok' : 'missing');

      // 2. Placement Coloring Logic
      const startersCount = classStarters.get(cls) || 1;
      const numPlaced = Math.ceil(startersCount / 4) || 1; // Default to 25% placed
      const rankNum = Number(r.plac);
      const isPlaced = !isNaN(rankNum) && rankNum > 0 && rankNum <= numPlaced;

      let placColor = 'text-gray-600 dark:text-gray-400';
      let placBg = 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';
      
      if (isPlaced) {
          if (rankNum === 1) { placColor = 'text-yellow-600 dark:text-yellow-400 drop-shadow-sm'; placBg = 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-500/80 border-2'; }
          else if (rankNum === 2) { placColor = 'text-slate-600 dark:text-slate-300 drop-shadow-sm'; placBg = 'bg-slate-100 dark:bg-slate-800/80 border-slate-400 dark:border-slate-500/80 border-2'; }
          else if (rankNum === 3) { placColor = 'text-orange-700 dark:text-orange-400 drop-shadow-sm'; placBg = 'bg-orange-100 dark:bg-orange-950/40 border-orange-500 dark:border-orange-600/80 border-2'; }
          else { placColor = 'text-emerald-600 dark:text-emerald-400'; placBg = 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/50 border-2'; }
      }

      let placBlock = `
        <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5 font-bold tracking-wider">Plac</div>
        <div class="text-base font-black ${placColor} leading-none">${r.plac || '—'}</div>
      `;

      // Skapa kortet
      html += `
        <div class="m-1 mb-1.5 rounded-lg border shadow-sm overflow-hidden cursor-pointer ${placBg}" data-start="${r.startNumber}" role="button" tabindex="0">
          <div class="p-1.5 flex items-center justify-between gap-1 border-b dark:border-gray-700/50 ${isPlaced ? '' : 'bg-gray-50 dark:bg-gray-800/50'}">
            
            <!-- Left: Name & Flags -->
            <div class="flex flex-col min-w-0 pr-1">
              <div class="font-bold text-[13px] dark:text-white leading-tight truncate flex items-center gap-1">
                 <span class="text-gray-500 dark:text-gray-400 text-[10px]">#${r.startNumber}</span> 
                 <span class="truncate">${r.driverName}</span>
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                 ${getFlagHtml(eq)} ${getClubLogoHtml(eq)}
                 ${viewMode === 'startorder' ? `<span class="text-[9px] text-gray-500 dark:text-gray-400 truncate ml-1">${cls}</span>` : ''}
              </div>
            </div>
            
            <!-- Right: Stats & Plac -->
            <div class="flex items-center gap-2 shrink-0">
                <div class="text-right">
                    <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5">Totalt</div>
                    <div class="font-bold text-[13px] text-blue-800 dark:text-blue-300 leading-none">${totalLabel}</div>
                </div>
                <div class="text-right border-l dark:border-gray-300 dark:border-gray-600 pl-2">
                    ${placBlock}
                </div>
            </div>
          </div>
          
          <!-- Bottom Row: Sub-results -->
          <div class="px-1.5 py-1.5 flex items-center justify-between gap-1 bg-white dark:bg-gray-800">
             <div class="flex items-center justify-between w-full text-[10px] sm:text-xs">
                <div class="flex flex-col items-center flex-1 border-r border-gray-100 dark:border-gray-700">
                   <span class="text-[8px] uppercase text-gray-400 font-semibold leading-none mb-1">Dressyr</span>
                   <span class="font-bold text-gray-700 dark:text-gray-200 flex items-center gap-0.5">${statusIcon(r.dressageStatus || 'missing')} ${dressyrLabel}</span>
                </div>
                <div class="flex flex-col items-center flex-1 border-r border-gray-100 dark:border-gray-700">
                   <span class="text-[8px] uppercase text-gray-400 font-semibold leading-none mb-1">Maraton</span>
                   <span class="font-bold text-gray-700 dark:text-gray-200 flex items-center gap-0.5">${statusIcon(r.marathonStatus || 'missing')} ${maratonLabel}</span>
                </div>
                <div class="flex flex-col items-center flex-1">
                   <span class="text-[8px] uppercase text-gray-400 font-semibold leading-none mb-1">Precision</span>
                   <span class="font-bold text-gray-700 dark:text-gray-200 flex items-center gap-0.5">${statusIcon(r.precisionStatus || 'missing')} ${precisionLabel}</span>
                </div>
             </div>
          </div>
        </div>
      `;
    });
  }

  container.innerHTML = `<div class="bg-gray-50 dark:bg-gray-900 py-1">${html}</div>`;

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
  const activeMarathonConfig = window.marathonConfig || marathonConfig || {};

  const rows = equipages
    .filter(e => {
      const s = String(e.status || '').toLowerCase();
      // Exclude explicitly withdrawn/struken drivers
      if (s.includes('struken') || s === 'withdrawn' || s === 'scratched' || e.struken || e.withdrawn) return false;
      return true;
    })
    .map(e => {
      const sn = String(e.startNumber);

      const rawProtocols = dressageMap.get(sn) || [];
      const marDoc = marathonObstacleMap.get(sn) || {};
      const timeDocRaw = lastSeenMarathonDurations.get(sn) || marathonTimeMap.get(sn) || {};

      const precDoc = precisionMap.get(sn) || {};

      return buildTotalResultRow({
        equipage: e,
        rawProtocols,
        marDoc,
        timeDocRaw,
        precisionDoc: precDoc,
        allPrograms,
        judges: allCompetitionJudges,
        marathonConfig: activeMarathonConfig,
        precisionConfig,
        displayConfig,
        calculateTotalResult,
        resolveMergeGrouping: resolveTotalMergeGrouping
      });
    });

  applyTotalDisciplinePlacements(rows);
  processedResults = placeWithinClass(rows);
  applyTotalResultDiffs(processedResults);

  applyTotalDisciplineStatuses(processedResults);

  bestDressageByClass.clear();
  buildBestDressageByGroup(processedResults).forEach((percent, groupKey) => {
    bestDressageByClass.set(groupKey, percent);
  });

  processedTeams = buildProcessedTotalTeams({
    rawTeams,
    processedResults,
    calculateTeamResults
  });

  render();
}

function attachListeners() {
  // 1) Dressyr - NU COLLECTION GROUP (Ersätter N separata lyssnare)
  unsub.push(listenForDressageProtocolsCollectionGroup(competitionId, equipages, (docs) => {
    replaceMapContents(dressageMap, groupDocsByStartNumber(docs));
    requestRecompute();
  }));

  // 2) Precision - Collection-nivå
  unsub.push(listenForPrecisionResults(competitionId, (docs) => {
    replaceMapContents(precisionMap, mapRowsByStartNumber(docs));
    requestRecompute();
  }));

  // 3) Maraton (Hinder) - NU COLLECTION-NIVÅ
  unsub.push(listenForMaratonCollection(competitionId, (docs) => {
    replaceMapContents(marathonObstacleMap, mapRowsByStartNumber(docs));
    requestRecompute();
  }));

  // 4) Maraton-tider (live) - COLLECTION-NIVÅ
  unsub.push(listenForMarathonTimingUpdates(competitionId, (docs) => {
    replaceMapContents(marathonTimeMap, normalizeTimingDocs(docs));
    requestRecompute();
  }));

  // 5) Officials/Judges
  unsub.push(listenForOfficials(competitionId, (list) => {
    allOfficials = list || [];
  }));
  unsub.push(listenForJudges(competitionId, (judges) => {
    allCompetitionJudges = judges || [];
    requestRecompute();
  }));

  // 6. Teams
  unsub.push(listenForTeams(competitionId, (teams) => {
    rawTeams = teams;
    requestRecompute();
  }));
}


// Återställd refreshMarathonTimes för initial laddning
async function refreshMarathonTimes() {
  if (!competitionId) return;
  const map = await getMarathonTimingData(competitionId);
  replaceMapContents(marathonTimeMap, normalizeTimingDocs(map));
  requestRecompute();
}


export async function load(el) {

  // Lyssnare för att hantera rotation/resize (växla mellan kort/tabell)
  if (totalResultsResizeHandler) {
    window.removeEventListener('resize', totalResultsResizeHandler);
  }
  totalResultsResizeHandler = () => render();
  window.addEventListener('resize', totalResultsResizeHandler, { passive: true });

  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id || null;

  if (!competitionId) {
    console.warn('Ingen tävling vald!');
    if (el) el.innerHTML = '<div class="p-8 text-center text-red-600 font-bold">Ingen tävling vald. Gå tillbaka till startsidan och välj en tävling.</div>';
    return;
  }


  // 1. Ladda nödvändig grunddata
  // 1. Ladda nödvändig grunddata
  try {
    const [eqList, marCfg, maratonCfgLegacy, preCfg, dispCfg, dressMapCfg, compMeta] = await Promise.all([
      getEquipages(competitionId),
      getConfig(competitionId, 'marathon'),
      getConfig(competitionId, 'maratonConfig'), // [FIX] Fetch config used by maraton-resultat.js
      getConfig(competitionId, 'precisionConfig'),
      getConfig(competitionId, 'display'),
      getConfig(competitionId, 'dressyrProgramMapping').catch(() => ({})),
      getConfig(competitionId, 'competitionMeta').catch(() => ({})),
      ensureClubLogosLoaded(competitionId)
    ]);

    const cfg = {
      marathon: marCfg,
      precision: preCfg,
      display: dispCfg,
      meta: compMeta
    };

    equipages = eqList || [];

    // [FIX] Prefer maratonConfig (used by working results page) for calculations
    // Merge them to be safe, prioritizing maratonConfig's class data
    marathonConfig = marCfg || {};
    if (maratonCfgLegacy && Object.keys(maratonCfgLegacy).length > 0) {
      marathonConfig = { ...marathonConfig, ...maratonCfgLegacy };
    }

    setMarathonConfig(marathonConfig);
    precisionConfig = cfg.precision || {};
    // Försök läsa in displayConfig om det finns sparat i config
    displayConfig = cfg.display || null;

    // Configure dressage mapping globally (like dressyr-monitor.js)
    window.klassProgramMapping = (dressMapCfg && typeof dressMapCfg === 'object') ? dressMapCfg : {};

    // Configure competition config globally
    window.competitionConfig = { ...(window.competitionConfig || {}), ...(cfg.meta || {}) };

    // Update global FEI/International flag if available
    if (cfg.meta && typeof cfg.meta.isInternational === 'boolean') {
      IS_FEI = cfg.meta.isInternational;
    }

  } catch (err) {
    console.error('Fel vid hämtning av data i init:', err);
  }

  // 2. Rita upp sidans struktur
  initializeScrollSync(window.location.pathname);
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
  if (totalResultsResizeHandler) {
    try { window.removeEventListener('resize', totalResultsResizeHandler); } catch { }
    totalResultsResizeHandler = null;
  }

  // 1) Stoppa lyssnare (Använder 'unsub'-arrayen som definierades i toppen)
  if (Array.isArray(unsub)) {
    unsubscribeAll(unsub);
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

  // Team Cleanup
  rawTeams = [];
  processedTeams = [];
  currentMainTab = 'individual';

  // 3) Nollställ globala scroll-helpers
  try { window.__teardownXbarSync?.(); } catch { }
  window.__teardownXbarSync = undefined;
  window.__setupXbarSync = undefined;

}
