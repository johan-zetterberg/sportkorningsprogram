// js/pages/maraton-resultat.js
import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getMarathonResults, getMarathonTimingData, listenForMarathonTimingUpdates, getMarathonObstacleResults } from '../../services/marathonService.js';
import { collection, onSnapshot, updateDoc, query, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { getCompetitionHeader, renderResponsiveClassFilter } from '../../ui/components.js';
import { ensureClubLogosLoaded, getClubLogoHtml, getClubLogoUrl } from '../../services/logosService.js';
import { getFlagHtml, normalizeCountryCode } from '../../services/flagsService.js';
import { t } from '../../utils/i18n.js';
// import { saveComputedEquipageResult } from '../../services/aggregateService.js';
import {
  maraton_marathonConfig,
  setMarathonConfig,
  tlSecondsFor,
  limitsFor,
  stagePenaltyFromMs,
  getObstacleArray,
  obstacleValues,
  detectTRCategoryFromEquipage,
  buildDominantTRCategoryByClass,
  // De som saknades:
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved,
  pausedMsBetween,
  pausedMsSince,
  formatMsLive,
  setPauseWindows,
  calculateMarathonResult,
  getObstacleCoefficient,
  DEFAULT_TRV_TEMPOS_KMH,
  // Merge Logic
  MERGE_GROUPS,
  MERGE_MAP,
  buildMergeMap,
  mergedClassKeyFor,
  mergedClassLabelFor,
  ensureMergeDecorations,
  prepareMarathonResults,
  getPauseTime
} from '../../utils/marathonUtils.js';
// import { calculateMarathonResult } from '../../services/calculationService.js';

import {
  printMarathonPdf,
  generateMarathonListPdf
} from '../../pdf/marathonPdf.js';


import {
  escapeHtml,
  isMobile,
  debounce,
  horseLabel,
  downloadCsv,
  sanitizeForFilename,
  isNum
} from '../../utils/sharedUtils.js';

import { injectScrollStyles, initializeScrollSync } from '../../ui/scrollHelper.js';

import { showDetailsModal } from '../../ui/marathonModal.js';
// ---- Cross-page X-Scroll Guard (shared) ----


// === Modal/bridge-ägarskap för att undvika krock mellan sidor ===
const MARATHON_MODAL_OWNER = 'marathon-results';

// Städa bort ev. främmande overlay från en annan sida
(function adoptOrResetModalOnce() {
  // Om någon annan lämnat kvar sin overlay → ta bort den
  const foreign = document.querySelector('#marathon-details-modal, #precisionDetailsModal');
  if (foreign && !foreign.dataset?.owner) {
    // okänd → ta bort
    try { foreign.remove(); } catch (_) { }
  }
  // vår egen (results) heter "detailsModal"
  const mine = document.getElementById('detailsModal');
  if (mine) mine.dataset.owner = MARATHON_MODAL_OWNER;
})();

// [NYTT] CSS för sticky scrollbar (samma som i precision)

function injectMaratonTableStyles() {
  if (document.getElementById('marathonResultsTableStyles')) return;
  injectScrollStyles();
  const s = document.createElement('style');
  s.id = 'marathonResultsTableStyles';
  s.textContent = `
    .pr-table {
      border-collapse: separate; 
      border-spacing: 0;
      table-layout: auto;
      min-width: max-content;
      width: auto;
      font-size: 15px;
    }
    
    .pr-table thead th {
      position: sticky; top: 0; z-index: 2;
      background: #f9fafb;
      border-bottom: 2px solid #e5e7eb;
      white-space: nowrap;
      height: 44px;
      color: #111827;
    }
    
    .pr-table tbody td {
      white-space: nowrap;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
      color: #374151;
    }

    
      
      
      /* Z-INDEX FIXES */
      .pr-table thead th, .total-results-table thead th { z-index: 20 !important; }
      .pr-table tbody td.sticky-col-start, .pr-table tbody td.sticky-col-driver, .total-results-table tbody td.sticky-col-start, .total-results-table tbody td.sticky-col-driver { z-index: 15 !important; }
      .pr-table thead th.sticky-col-start, .pr-table thead th.sticky-col-driver, .total-results-table thead th.sticky-col-start, .total-results-table thead th.sticky-col-driver { z-index: 30 !important; }

      /* STICKY COLUMNS */
      .sticky-col-start { position: sticky; left: 0; z-index: 3; min-width: 38px; width: 38px; text-align:center; }
      .sticky-col-driver { position: sticky; left: 38px; z-index: 3; min-width: 130px; max-width: 170px; }
      @media (min-width: 1024px) {
         .sticky-col-start { left: 0; min-width: 48px; width: 48px; }
         .sticky-col-driver { left: 48px; min-width: 180px; max-width: 220px; }
      }
      .dark .bg-white .sticky-col-start, .dark .bg-white .sticky-col-driver { background-color: #1f2937; }
      .dark .bg-gray-50 .sticky-col-start, .dark .bg-gray-50 .sticky-col-driver { background-color: #111827; }
      .dark .bg-red-50 .sticky-col-start, .dark .bg-red-50 .sticky-col-driver { background-color: #450a0a; }
      .dark .bg-yellow-50 .sticky-col-start, .dark .bg-yellow-50 .sticky-col-driver { background-color: #422006; }
      html.dark .pr-table thead th { background: #1f2937; border-bottom-color: #374151; color: #f3f4f6; }
      html.dark .bg-white .sticky-col-start, html.dark .bg-white .sticky-col-driver { background-color: #1f2937; }
      html.dark .bg-gray-50 .sticky-col-start, html.dark .bg-gray-50 .sticky-col-driver { background-color: #374151; }
      html.dark .bg-red-50 .sticky-col-start, html.dark .bg-red-50 .sticky-col-driver { background-color: #7f1d1d; }

      /* Dark Mode Overrides */
    html.dark .pr-table thead th {
      background: #1f2937;
      border-bottom-color: #374151;
      color: #f3f4f6;
    }
    html.dark .pr-table tbody td {
      border-bottom-color: #374151;
      color: #e5e7eb;
    }

    /* Wrap styles specifically for the new layout (no pr-card) */
    #marathon-x-wrap {
      width: 100%;
      overflow-x: auto;
      background: #fff;
    }
    html.dark #marathon-x-wrap {
      background: #111827;
    }

    /* Ensure utility classes work if Tailwind doesn't catch them */
    .w-max { width: max-content; }
    .min-w-max { min-width: max-content; }

    /* Standardläge (Mobil/Kortvy) */
    #marathon-x-wrap > table.pr-table { display: none; }
    #marathonCards { display: grid; }

    /* Desktop/Tabellvy */
    @media (min-width: ${MOBILE_BP}px), (orientation: landscape) and (hover: none) {
      #marathon-x-wrap > table.pr-table { display: table; }
      #marathonCards { display: none; }
    }
  `;
  document.head.appendChild(s);
}

// === ETA helpers ===
let MARATHON_CONFIG = {};
let maraton_sortState = { key: 'startNumber', dir: 'asc' }; // Init sorting state

// === Merge helpers (TDB-klassnummer) ===
// MERGE_GROUPS, MERGE_MAP, buildMergeMap, mergedClassKeyFor, mergedClassLabelFor, ensureMergeDecorations
// Importerade från marathonUtils.js

// === Renderar klass-knapparna ===

function renderActiveMerges() {
  const host = document.getElementById('activeMerges');
  if (!host) return;

  if (!Array.isArray(MERGE_GROUPS) || MERGE_GROUPS.length === 0) {
    host.innerHTML = '';
    return;
  }

  const chips = MERGE_GROUPS.map(g => {
    const lbl = g.label || `TDB #${(g.members || []).join('/')}`;
    const count = maraton_equipages.filter(e =>
      Number.isFinite(Number(e.tdbClassNumber)) && g.members.includes(Number(e.tdbClassNumber))
    ).length;

    return `
      <span class="inline-flex items-center gap-2 px-2 py-1 rounded-full
                  bg-blue-50 border border-blue-200 text-blue-700">
        ${lbl}
        <span class="text-xs text-blue-600">(${count} ekipage)</span>
      </span>`;
  }).join('');

  host.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="font-semibold text-gray-700">Aktiva sammanslagningar:</span>
      ${chips}
    </div>`;
}

// === NY FUNKTION: Renderar klass-knapparna ===
function renderMaratonClassChips() {
  const chipHost = document.getElementById('maratonClassChips');
  if (!chipHost) return;

  const labels = [...new Set(maraton_equipages.map(e => e._mergedLabel || e.className || '—'))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'sv'));

  renderResponsiveClassFilter(chipHost, labels, maraton_activeClassFilters, (lbl) => {
    if (maraton_activeClassFilters.has(lbl)) {
      maraton_activeClassFilters.delete(lbl);
    } else {
      maraton_activeClassFilters.add(lbl);
    }
    render();
  });
}

function getClassDistancesFromConfig(className) {
  const distCfg = MARATHON_CONFIG?.marathonClassDistances;
  if (distCfg) {
    const k = Object.keys(distCfg).find(x => className.startsWith(x)) || className;
    return distCfg[k] || null;
  }
  const dataCfg = MARATHON_CONFIG?.marathonClassData
    || MARATHON_CONFIG?.maratonClassData
    || {};
  const key = Object.keys(dataCfg).find(k => className.startsWith(k)) || className;
  const row = dataCfg[key];
  if (!row) return null;
  const tempoMpm = Number.isFinite(Number(row.tempoT)) ? Number(row.tempoT) : null;
  return {
    A: { distance: Number(row.distanceA) || 0 },
    T: { distance: Number(row.distanceT) || 0, tempo_mpm: tempoMpm },
    B: { distance: Number(row.distanceB) || 0 },
  };
}

// Fyll på dina TR-tempon här (m/min) om du vill ha klass-/kategori-specifika värden
const TR_TEMPO = {
  ponyA: { A: null, B: null },
  ponyB: { A: null, B: null },
  ponyCD: { A: null, B: null },
  horse: { A: null, B: null },
};

function tempoFor(stage, className, categoryKey, cfg) {
  if (stage === 'T') return cfg?.T?.tempo_mpm ?? null;            // Transport: från admin
  const tr = TR_TEMPO[categoryKey]?.[stage];                      // A/B: valfritt från TR
  return Number.isFinite(tr) ? tr : null;
}

function idealMillis(stage, className, categoryKey) {
  const cfg = getClassDistancesFromConfig(className);
  if (!cfg) return null;
  const dist = stage === 'A' ? (cfg.A?.distance || 0)
    : stage === 'B' ? (cfg.B?.distance || 0)
      : (cfg.T?.distance || 0);
  const tempo = tempoFor(stage, className, categoryKey, cfg);     // m/min
  if (!Number.isFinite(dist) || !Number.isFinite(tempo) || tempo <= 0) return null;
  return Math.round((dist / tempo) * 60 * 1000);
}

function fmtClock(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


// ---------- Global state ----------
let competitionId = null;
let isGloballyPaused = false;
let pauseStartTime = 0;

// === Responsive helpers ===
const MOBILE_BP = 500;
// isMobile imported from sharedUtils

// Debounce för live-snapshots så UI inte re-rendras för ofta
const renderLiveDebounce = debounce(render, 60);
const renderFinDebounce = debounce(render, 60);

// Väljer rätt vy
function render() {
  if (!ensureShell()) return;

  const isLandscape = window.matchMedia("(orientation: landscape)").matches;

  // Kortvy endast i portrait. I landscape (även på mobil) kör vi tabellen (användaren kan scrolla i sidled).
  const useCards = isMobile();

  const tableWrapper = document.getElementById('marathonTableWrapper');
  const cardWrapper = document.getElementById('marathonCards');

  // Toggle visibility
  if (tableWrapper) tableWrapper.style.display = useCards ? 'none' : 'block';
  if (cardWrapper) cardWrapper.style.display = useCards ? 'grid' : 'none';

  if (useCards) {
    window.__teardownXbarSync?.();
    renderMobile();
  } else {
    renderTable();
    // se till att X-baren syns i desktop
    try { window.__teardownXbarSync?.(); } catch { }

    const hostEl = document.getElementById('marathon-x-wrap');
    if (hostEl && window.__setupXbarSync) {
      // Viktigt: vänta 1–2 frames så att tabellen hinner få korrekt scrollWidth
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__setupXbarSync({
            barClass: 'fixed-xbar',
            innerId: 'marathonXbarInner',
            hostEl
          });
        });
      });
    }
  }

  // Chips & Common UI
  renderActiveMerges();
  renderMaratonClassChips();
}

// Lista med globala pausintervall: { from:number, to:number|null }
let pauseWindows = [];

// === Finalisering (Maraton) ===
// I maraton sparas 'finalized: true' direkt i maraton-dokumentet (t.ex. artifacts/.../maraton/{sn}).
// Vi läser det från maraton_marathonMap som redan synkas via listenLive.

function isMarathonFinalized(sn) {
  const d = maraton_marathonMap.get(String(sn));
  return !!(d?.finalized || d?.status === 'Klar');
}

// Åtgärder (samma behörighetskontroll som i dressyr)
export function __finalizeMaraton(compId, sn) {
  const ref = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'maraton', String(sn));
  updateDoc(ref, { finalized: true, status: 'Klar', updatedAt: serverTimestamp() })
    .catch(err => {
      console.error('Finalize failed:', err);
      if (window.showAlert) window.showAlert('Kunde inte finalisera resultatet.', false);
    });
}
window.__finalizeMaraton = __finalizeMaraton;

export function __unfinalizeMaraton(compId, sn) {
  const ref = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'maraton', String(sn));
  updateDoc(ref, { finalized: false, status: 'Pågår', updatedAt: serverTimestamp() })
    .catch(err => {
      console.error('Unfinalize failed:', err);
      if (window.showAlert) window.showAlert('Kunde inte ångra finalisering.', false);
    });
}
window.__unfinalizeMaraton = __unfinalizeMaraton;

// Summera pausad tid mellan två klockslag
let maraton_equipages = [];
let maraton_marathonMap = new Map(); // ...
let maraton_startTimes = {};

// Skriv inte computed från klient i publik miljö
const CAN_PUBLISH_COMPUTED = false;

let maraton_viewMode = 'startorder';
let maraton_showOnlyFinalized = false;
let maraton_showOnlyOnB = false;
let maraton_searchQuery = '';
// === Klassfilter (för chips/knappar) ===
window.maraton_activeClassFilters ??= new Set();
const maraton_activeClassFilters = window.maraton_activeClassFilters;

// ---- Stage (A/T/B) state ----
let stageCols = [];              // vilka kolumner som ska visas, t.ex. ['A','transport','B']
let localStageTickers = {};      // "sn|stage" -> intervalId

let lastStructuralHash = '';
let lastHeaderHash = '';

// ---------- Utils ----------
const safeLower = (x) => (x == null ? '' : String(x)).toLowerCase();

// escapeHtml imported from sharedUtils



// === Hjälpare: säker extrahering av hinderdata ===
// Rendera hinderchips H1..H8 kompakt
function renderObstacleChips(res, max = 8) {
  const arr = getObstacleArray(res);
  const chips = [];

  for (let i = 1; i <= max; i++) {
    const o =
      arr.find(x => (x.no ?? x.nr ?? x.hinderNr) === i) ||
      arr[i - 1] ||
      null;

    let label = `H${i}`;
    if (o) {
      const { timeSec, penalty } = obstacleValues(o);
      const t = (timeSec != null && !Number.isNaN(timeSec))
        ? `${Number(timeSec).toFixed(1)}s`
        : '–';
      const p = Number(penalty || 0);
      label += ` ${t} (+${p.toFixed(2)})`;
    } else {
      label += ` – (+0)`;
    }

    chips.push(
      `<span class="inline-flex items-center px-2 py-1 rounded text-[11px] bg-gray-100 text-gray-700 border border-gray-200">
         ${label}
       </span>`
    );
  }

  return `<div class="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4 md:grid-cols-8">${chips.join('')}</div>`;
}


// FUNKTION FÖR PAUS-LYSSNARE
function listenForGlobalCompetitionPause_Results() {
  if (!competitionId || !appId) return;
  const statusRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus');

  return onSnapshot(statusRef, (docSnap) => {
    if (docSnap.exists()) {
      const d = docSnap.data();
      isGloballyPaused = d.isPaused === true;
      setPauseWindows(d.pauseLog || []);

      if (isGloballyPaused && Array.isArray(d.pauseLog)) {
        const current = d.pauseLog.find(p => p.end === null);
        if (current && current.start) {
          pauseStartTime = new Date(current.start).getTime();
        } else {
          pauseStartTime = Date.now();
        }
      } else {
        pauseStartTime = 0;
      }
    } else {
      isGloballyPaused = false;
      pauseStartTime = 0;
      setPauseWindows([]);
    }

    document.body.style.filter = isGloballyPaused ? 'grayscale(80%)' : '';
    render();
  });
}

function normalizeEquipage(e) {
  const startNumber =
    Number(e?.startNumber ?? e?.startnr ?? e?.nr ?? e?.start ?? e?.startNo ?? e?.bib ?? 0);
  const driverName =
    e?.driverName ?? e?.driver ?? e?.name ?? e?.kusk ?? '';
  const className =
    e?.className ?? e?.class ?? e?.klass ?? '';
  return { ...e, startNumber, driverName, className };
}

function classSettingsFor(cls) {
  return maraton_marathonConfig?.marathonClassData?.[cls] || {};
}
function globalRules() {
  return {
    timePenaltyRate: maraton_marathonConfig?.timePenaltyRate ?? 0.25,
    knockdownPenaltyDefault: maraton_marathonConfig?.knockdownPenaltyDefault ?? 5,
    obstacleMaxTime: maraton_marathonConfig?.obstacleMaxTime ?? 300,
    pauseTime: maraton_marathonConfig?.pauseTime ?? null
  };
}

// function sanitizeForFilename moved to sharedUtils


/**
 * Hämtar hästnamn för ett ekipage för ett specifikt moment.
 * Om 'moment' anges (t.ex. 'marathon') och val finns, visas de valda hästarna.
 * Annars visas alla registrerade hästar som fallback.
 * @param {object} equipage - Ekipageobjektet.
 * @param {'dressage' | 'marathon' | 'precision'} moment - Momentet att hämta hästar för.
 * @returns {string} - En sträng med hästnamn, separerade av ' & ', eller '—'.
 */
function getMomentHorseLabel(equipage, moment) {
  // === KOD FRÅN dressyr-resultat.js ===
  if (!equipage || typeof equipage !== 'object') return '—';
  const allHorsesRaw = equipage.horses || equipage.horseNames || equipage.horse || [];
  let allHorses = [];
  if (Array.isArray(allHorsesRaw)) {
    allHorses = allHorsesRaw.map(h => (typeof h === 'string' ? { name: h } : h)).filter(h => h && h.name);
  } else if (typeof allHorsesRaw === 'string' && allHorsesRaw.trim()) {
    allHorses = allHorsesRaw.split(/[\/,&+]|(?:\s*&\s*)/).map(name => ({ name: name.trim() })).filter(h => h.name);
  } else if (typeof allHorsesRaw === 'object' && allHorsesRaw.name) {
    allHorses = [allHorsesRaw];
  }
  if (allHorses.length === 0) return '—';
  const horseMap = new Map(allHorses.map(h => [h.id || h.name, h.name]));
  let horseIdsToShow = [];
  if (moment && equipage.momentHorses && Array.isArray(equipage.momentHorses[moment]) && equipage.momentHorses[moment].length > 0) {
    horseIdsToShow = equipage.momentHorses[moment];
  }
  if (horseIdsToShow.length > 0) {
    return horseIdsToShow.map(id => horseMap.get(id) || id).join(' & ');
  } else {
    return allHorses.map(h => h.name).filter(Boolean).join(' & ');
  }
  // === SLUT PÅ KOD FRÅN dressyr-resultat.js ===
}

/**
 * Hämtar hästnamn för ett specifikt moment och formaterar dem som stackade HTML-span.
 * @param {object} equipage - Ekipageobjektet.
 * @param {'dressage' | 'marathon' | 'precision'} moment - Momentet att hämta hästar för.
 * @returns {string} - HTML-sträng med stackade hästnamn, eller '—'.
 */
function getMomentHorseLabelStacked(equipage, moment) {
  const label = getMomentHorseLabel(equipage, moment);
  if (label === '—') return '—';
  const names = label.split(/\s*&\s*/); // Dela upp på " & "
  return names.map(n => `<span class="block">${n}</span>`).join('');
}

function getMaxObstacleNo() {
  let maxN = 0;
  maraton_marathonMap.forEach(d => {
    const arr = getObstacleArray(d);
    arr.forEach(o => {
      const nr = Number(o?.number ?? o?.no ?? o?.nr ?? o?.hinderNr);
      if (Number.isFinite(nr)) maxN = Math.max(maxN, nr);
    });
  });
  if (maxN <= 0) maxN = 6;
  return Math.min(maxN, 8);
}


// --- Timing helpers (A/T/B) ---
// =====================================================
// CANONICAL A/T/B helpers – klassmedvetna & live-säkra
// =====================================================

const STAGE_KEYS = ['A', 'transport', 'B'];  // 'transport' = T

function rowStageCellsHTML(res) {
  return (stageCols || []).map(stKey => {
    const sData = res.stages[stKey];
    let val = '—';
    if (sData) {
      if (sData.eliminated) val = 'ELIM';
      else if (Number.isFinite(sData.timePenalty)) val = sData.timePenalty.toFixed(2);
    }

    return `<td class="px-2 py-1.5 lg:px-3 lg:py-2 text-center text-[11px] lg:text-sm">
      <span class="tabular-nums" data-stage-pts="${res.startNumber}" data-stage="${stKey}">${val}</span>
    </td>`;
  }).join('');
}

const localLiveTickers = {};
const localObsTickers = {};

function stopLocalLiveTicker(sn) {
  const key = String(sn);
  if (localLiveTickers[key]) {
    clearInterval(localLiveTickers[key]);
    delete localLiveTickers[key];
  }
}

// attach/cleanupMarathonFinalizeListeners tas bort då listenLive sköter realtidsuppdatering för alla rader

function startOrUpdateLiveTicker(sn) {
  const key = String(sn);
  if (localLiveTickers[key]) return;

  // Hämta korrekt ekipage-objekt (behövs för limitsFor)
  const eq = maraton_equipages.find(e => String(e.startNumber) === key);

  const run = () => {
    // --- Paus-logik: Om tävlingen är pausad, "fryser" vi tiden helt ---
    if (isGloballyPaused) {
      return;
    }

    const d = maraton_marathonMap.get(key) || {};
    const t = timingDocFor(key);

    // DEBUG: check if we actually have data
    // console.log('Ticker run for', key, 'running:', d.running, 'obs:', d.currentObstacle);

    let isAnythingRunning = false;
    let labelText = '';
    let timeText = '';

    // --- Sträck-logik (Stage ticking) ---
    let liveStageP = 0;
    let runningStage = null;

    for (const stage of STAGE_KEYS) {
      const s = stageStartTS(t, stage), e = stageStopTS(t, stage);
      if (s && !e) {
        isAnythingRunning = true;
        runningStage = stage;
        const elapsedMs = (stageDurationMsSaved(t, stage) || 0) + (Date.now() - s - pausedMsSince(s));

        // Prioritera sträcka för huvudklockan om hinder inte är igång
        if (stage === 'A') {
          const limitsA = limitsFor(eq, 'A');
          const isFixedTimeA = limitsA && limitsA.isFixedTime;
          labelText = isFixedTimeA ? 'W' : 'A';
        } else if (stage === 'transport') {
          labelText = 'T';
        } else {
          labelText = stage;
        }
        timeText = formatMsLive(elapsedMs);

        const { points, elim } = stagePenaltyFromMs(elapsedMs, eq, stage);
        liveStageP = elim ? Infinity : (isNum(points) ? points : 0);
        document.querySelectorAll(`[data-stage-pts="${key}"][data-stage="${stage}"]`).forEach(el => {
          el.textContent = elim ? 'ELIM' : (isNum(points) ? points.toFixed(2) : '—');
        });
        break; // Endast en sträcka kan gå åt gången
      }
    }

    // --- Mellan Warm-up och Etapp B ---
    if (!isAnythingRunning) {
      const aStart = stageStartTS(t, 'A');
      const aStop = stageStopTS(t, 'A');
      const bStart = stageStartTS(t, 'B');
      if (aStart && aStop && !bStart) {
        const limitsA = limitsFor(eq, 'A');
        if (limitsA && limitsA.isFixedTime) {
          isAnythingRunning = true;
          const pauseTimeMs = getPauseTime() * 60 * 1000;
          const tlMs = limitsA.ideal * 1000;
          const etaBTimestamp = aStart + tlMs + pauseTimeMs + pausedMsSince(aStart);
          const timeLeftMs = etaBTimestamp - Date.now();
          labelText = 'ETA B';
          if (timeLeftMs >= 0) {
            timeText = formatMsMMSS(timeLeftMs);
          } else {
            timeText = '-' + formatMsMMSS(Math.abs(timeLeftMs));
          }
        }
      }
    }

    // --- Hinder-logik (Obstacle ticking) ---
    let liveObsP = 0;
    let obsTimeMs = 0;
    const obsNr = Number(d.currentObstacle);
    // FIX: Only override B-timer if obstacle is actually running. 'status' is for the whole equipage.
    if (d.running === true && Number.isFinite(obsNr)) {
      isAnythingRunning = true;
      const lastUpdateMs = Number(d.liveObstacleTimeMs) || 0;
      const lastUpdateTime = d.updatedAt?.toMillis ? d.updatedAt.toMillis() : Date.now();
      obsTimeMs = lastUpdateMs + (Date.now() - lastUpdateTime - pausedMsSince(lastUpdateTime));

      // Hinder-klockan går före sträck-klockan i displayen
      labelText = `H${d.currentObstacle}`;
      timeText = formatMsLive(obsTimeMs);

      // DEBUG: Trace values
      if (Math.random() < 0.005) {
        // console.log(`[Ticker] Obs running #${key} H${obsNr} time=${obsTimeMs}`);
      }

      const obsCoeff = (typeof getObstacleCoefficient === 'function')
        ? (getObstacleCoefficient(eq.className) || 1.0)
        : 1.0;
      liveObsP = (obsTimeMs / 1000) * obsCoeff;
    }

    document.querySelectorAll(`td[data-sn="${key}"] span[data-cell="obsVal"]`).forEach(el => {
      // Reset styles
      el.classList.remove('text-amber-700', 'animate-pulse', 'font-bold');
    });

    if (isAnythingRunning) {
      // Update Labels & Master Time
      const labelEls = document.querySelectorAll(`[data-live-label="${key}"]`);
      const timeEls = document.querySelectorAll(`[data-live-time="${key}"]`);

      labelEls.forEach(el => {
        el.textContent = labelText;
      });
      timeEls.forEach(el => {
        el.textContent = timeText;
        el.classList.add('text-amber-700', 'animate-pulse', 'font-semibold');
      });

      // Update specific obstacle cell
      if (d.running === true && Number.isFinite(obsNr)) {
        document.querySelectorAll(`td[data-sn="${key}"][data-obs="${obsNr}"] span[data-cell="obsVal"]`).forEach(el => {
          el.textContent = liveObsP.toFixed(2);
          el.classList.add('text-amber-700', 'animate-pulse', 'font-bold');
        });
      }

      // --- LIVE TOTAL PENALTY ---
      try {
        const baseRes = calculateMarathonResult(eq, d, t);
        let liveTotal = baseRes.totalPenalty;
        let liveObsSum = baseRes.obstacles.sum || 0;

        // 1. Add Live Stage Penalty if missing from base result
        // (If calculateMarathonResult didn't factor in the live time for the running stage)
        if (runningStage && Number.isFinite(liveStageP) && liveStageP > 0) {
          const baseStageP = baseRes.stages[runningStage]?.timePenalty || 0;
          if (baseStageP === 0) {
            const base = (Number.isFinite(liveTotal)) ? liveTotal : 0;
            liveTotal = (liveTotal === Infinity) ? Infinity : (base + liveStageP);
            // Note: We don't update liveObsSum here, as this is stage penalty
          }
        }

        // 2. Add Live Obstacle Penalty
        // baseRes.totalPenalty does NOT include the currently running obstacle time
        if (Number.isFinite(liveObsP) && liveObsP > 0) {
          const base = (Number.isFinite(liveTotal)) ? liveTotal : 0;
          liveTotal = (liveTotal === Infinity) ? Infinity : (base + liveObsP);
          liveObsSum += liveObsP;
        }

        const liveTotalLabel = (liveTotal === Infinity) ? 'ELIM' : (isNum(liveTotal) ? liveTotal.toFixed(2) : '—');

        // Update Total Obstacle Sum
        document.querySelectorAll(`td[data-sn="${key}"][data-cell="obsSum"]`).forEach(el => {
          el.textContent = liveObsSum.toFixed(2);
          // Optional: add pulse effect
          // el.classList.add('text-amber-700', 'animate-pulse'); 
        });

        // DEBUG: Log first running ticker to console
        if (window._debugTicker === undefined) window._debugTicker = key;
        if (window._debugTicker === key && Math.random() < 0.05) { // Log occasionally (approx every 2s)
        }

        document.querySelectorAll(`[data-total-pen="${key}"]`).forEach(el => {
          el.textContent = liveTotalLabel;
        });
      } catch (err) {
        console.error('Total penalty tick error:', err);
      }
    } else {
      // --- Städa upp om inget är igång ---
      document.querySelectorAll(`[data-live-time="${key}"]`).forEach(el => {
        el.textContent = '—';
        el.classList.remove('text-amber-700', 'animate-pulse', 'font-semibold');
      });
      document.querySelectorAll(`[data-live-label="${key}"]`).forEach(el => el.textContent = '');
      stopLocalLiveTicker(key);
    }
  };

  run();
  localLiveTickers[key] = setInterval(run, 95);
}

function formatMsMMSS(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function startTimeFor(startNumber) {
  const sn = String(startNumber);
  const d = maraton_marathonMap.get(sn);
  let val = null;

  // 1. Prioritize actual start time from live data
  if (d) {
    val = d.start_A || d.start_warmup || d.start_transport || d.start_B;
    // Handle nested (legacy/alternative)
    if (!val && d.stages) {
      val = d.stages.A?.startClock || d.stages.warmup?.startClock || d.stages.B?.startClock || d.stages.A?.start || d.stages.B?.start;
    }
  }

  // 2. Fallback to schedule (Start Times page)
  if (!val) {
    const row = maraton_startTimes?.[sn] ?? maraton_startTimes?.[Number(sn)] ?? null;
    val = row?.marathon ?? row?.b ?? row?.start_B ?? row?.start ?? row?.time ?? row?.start_A ?? row?.startTime ?? null;
  }

  return val || null;
}

function formatStartTimeLabel(val) {
  if (!val) return '—';
  if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) return val;
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (_) { }
  return String(val);
}

function isFinalizedDoc(d) {
  return d?.finalized === true || d?.status === 'finalized' || d?.status === 'Klar' || d?.isFinal === true;
}





function statusClass(s) {
  if (s === 'Klar') return 'bg-green-100 text-green-800';
  if (s === 'Pågår') return 'bg-amber-100 text-amber-800';
  if (s === 'Eliminerad') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-600';
}

function activeRankFor(startNumber) {
  const sn = String(startNumber);
  const live = maraton_marathonMap.get(sn) || {};
  if (live.running === true || live.inProgress === true) return 0;
  const t = timingDocFor(sn) || {};
  if (t.start_B && !t.finish_B) return 1;
  if (isFinalizedDoc(live)) return 3;
  return 2;
}

function matchesSearch(eq) {
  if (!maraton_searchQuery) return true;
  const q = safeLower(maraton_searchQuery);
  const sn = String(eq.startNumber);
  if (sn.includes(q)) return true;
  if (safeLower(eq.driverName).includes(q)) return true;
  if (safeLower(eq.className).includes(q)) return true;
  if (safeLower(eq._mergedLabel || '').includes(q)) return true;
  const horses = Array.isArray(eq.horses) ? eq.horses.map(h => h?.name || h).join(' ') : (eq.horse || '');
  if (safeLower(horses).includes(q)) return true;
  return false;
}

function shortClubOrCountry(eq) {
  const club = eq.club || eq.clubName || eq.association || eq.federation || eq.team || eq.organisation || '';
  const country = (eq.country || eq.nation || eq.nationality || '').toString().trim();
  const c3 = country ? country.slice(0, 3).toUpperCase() : '';
  const clubShort = (club || '').toString().trim();
  return clubShort || c3 || '—';
}



// ---------- Stage helpers ----------
function hasAnyTimingForStage(s) {
  for (const v of maraton_marathonMap.values()) {
    const t = v || {};
    if (stageStartTS(t, s) || stageStopTS(t, s) || stageDurationMsSaved(t, s)) return true;
  }
  return false;
}

async function fetchImageDataUrl(url) {
  if (!url) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}

function _normClass(s) {
  return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}
function _pickClassRow(map, className) {
  if (!map) return null;
  if (map[className]) return map[className];
  const n = _normClass(className);
  for (const k of Object.keys(map)) {
    if (_normClass(k) === n) return map[k];
  }
  let bestKey = null, bestScore = 0;
  const tokens = n.split(' ').filter(Boolean);
  for (const k of Object.keys(map)) {
    const kn = _normClass(k);
    let score = 0;
    for (const t of tokens) if (t && kn.includes(t)) score++;
    if (score > bestScore) { bestScore = score; bestKey = k; }
  }
  if (bestKey && bestScore >= 2) return map[bestKey];
  return null;
}

function stageEnabled(s) {
  if (hasAnyTimingForStage(s)) return true;

  const distancesByClass = maraton_marathonConfig?.marathonClassData;
  if (!distancesByClass) {
    return false;
  }
  const field = s === 'A' ? 'distanceA' : s === 'B' ? 'distanceB' : 'distanceT';

  return Object.values(distancesByClass).some(classSettings => {
    const stageData = classSettings?.[s];
    return stageData && Number.isFinite(stageData.distance) && stageData.distance > 0;
  });
}

function timingDocFor(sn) {
  return maraton_marathonMap.get(String(sn)) || {};
}

function filteredSortedEquipages() {

  // Se till att _mergedKey/_mergedLabel speglar aktuell MERGE_MAP innan vi sorterar
  maraton_equipages = ensureMergeDecorations(maraton_equipages);

  let list = maraton_equipages.slice();

  list = list.filter(matchesSearch);

  // 1. Filter
  if (maraton_searchQuery) {
    const q = maraton_searchQuery.toLowerCase();
    list = list.filter(e =>
      String(e.startNumber).includes(q) ||
      (e.driverName || '').toLowerCase().includes(q) ||
      (e.className || '').toLowerCase().includes(q)
    );
  }

  list = list.filter(e => {
    const s = String(e.status || '').toLowerCase();
    return !['struken', 'withdrawn', 'scratched'].includes(s) && !e.struken && !e.withdrawn;
  }); // Re-applying the filter from previous task if it was there.

  if (maraton_activeClassFilters.size > 0) {
    list = list.filter(e => maraton_activeClassFilters.has(e._mergedLabel || e.className));
  }

  if (maraton_showOnlyFinalized) {
    list = list.filter(e => isMarathonFinalized(e.startNumber));
  } else if (maraton_showOnlyOnB) {
    list = list.filter(eq => {
      const sn = String(eq.startNumber);
      const d = maraton_marathonMap.get(sn) || {};
      const res = calculateMarathonResult(eq, d, timingDocFor(sn));
      return res.status === 'Pågår' || d.running === true;
    });
  }

  // 2. Sort
  const key = maraton_sortState.key;
  const dir = maraton_sortState.dir === 'asc' ? 1 : -1;
  const placeMap = buildPlacementsByClass(); // Optimization: Calculate once? It depends on `filteredSortedEquipages`? circular?
  // `buildPlacementsByClass` uses `maraton_equipages` (all), so it's safe.

  const getVal = (eq, k) => {
    const sn = String(eq.startNumber);
    const d = maraton_marathonMap.get(sn) || {};
    const res = calculateMarathonResult(eq, d, timingDocFor(sn));

    // Sort keys
    if (k === 'place') return placeMap.get(sn) || 9999;
    if (k === 'startNumber') return Number(eq.startNumber) || 0;
    if (k === 'driverName') return (eq.driverName || '').toLowerCase();
    if (k === 'className') return (eq._mergedLabel || eq.className || '').toLowerCase();
    if (k === 'clubName') return (eq.clubName || '').toLowerCase();
    if (k === 'startTime') return startTimeFor(sn) || '99:99'; // ISO-time string sorts correctly
    if (k === 'eta') {
      // Sort by ETA B, then A
      const eta = res.eta.B || res.eta.A;
      return eta ? new Date(eta).getTime() : 9999999999999;
    }
    if (k === 'live') return 0; // Not really sortable?
    if (k === 'obsSum') return isNum(res.obstacles.sum) ? res.obstacles.sum : 9999;
    if (k === 'otherPenalty') return isNum(res.otherPenalty) ? res.otherPenalty : 9999;
    if (k === 'totalPenalty') return (res.totalPenalty === Infinity) ? 99999 : (res.totalPenalty || 0);
    if (k === 'status') return res.status || '';

    // Stages/Obstacles
    if (k.startsWith('stage-')) {
      const st = k.split('stage-')[1]; // e.g. 'A'
      const p = res.stages[st]?.penalty;
      return isNum(p) ? p : 9999;
    }
    if (k.startsWith('obs-')) {
      const n = parseInt(k.split('obs-')[1]);
      const item = (res.obstacles.items || []).find(o => Number(o.number) === n);
      return (item && isNum(item.penalty)) ? Number(item.penalty) : 9999;
    }
    return 0;
  };

  list.sort((a, b) => {
    if (maraton_viewMode === 'byclass' && key === 'place') {
      // If viewing by class AND sorting by place (default), grouping logic overrides or wraps.
      // Actually `renderTable` handles grouping visually. Sorting here should just sort.
      // But if we sort by Place globally, the grouping might look weird if we don't group first.
      // Standard behavior: Sort by Class first, then Key.
      const aLabel = safeLower(a._mergedLabel || a.className || '');
      const bLabel = safeLower(b._mergedLabel || b.className || '');
      const classCompare = aLabel.localeCompare(bLabel, 'sv');
      if (classCompare !== 0) return classCompare;
    }

    const va = getVal(a, key);
    const vb = getVal(b, key);

    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'sv') * dir;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  return list;
}

function calculateMarathonDateStr() {
  const dateCounts = {};
  Object.values(maraton_startTimes).forEach(timeEntry => {
    const marathonTime = timeEntry?.marathon || timeEntry?.maraton;
    if (marathonTime) {
      const datePart = marathonTime.split('T')[0];
      if (datePart) dateCounts[datePart] = (dateCounts[datePart] || 0) + 1;
    }
  });
  let mostCommonDate = null;
  let maxCount = 0;
  for (const date in dateCounts) {
    if (dateCounts[date] > maxCount) { maxCount = dateCounts[date]; mostCommonDate = date; }
  }
  if (mostCommonDate) {
    return new Date(mostCommonDate).toLocaleDateString('sv-SE', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
  return '';
}


function ensureShell() {
  const root = document.getElementById('page-maraton-results');
  if (!root) return false;
  const shellId = 'maraton-results-shell';
  if (document.getElementById(shellId)) return true;

  root.innerHTML = `
        <div id="${shellId}" class="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen dark:bg-gray-900 transition-colors duration-500">
          <div class="mb-8">
             ${getCompetitionHeader(getGlobalState('currentCompetition'), t('marathon_results_title'))}
             <h3 id="maratonDateHeader" class="text-lg text-gray-500 dark:text-gray-400 mt-1 font-medium text-center"></h3>
          </div>

          <div class="bg-white dark:bg-gray-800 p-2 md:p-3 rounded-lg md:rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-2 md:mb-4 flex flex-wrap gap-2 md:gap-3 items-center justify-start transition-colors" id="modeToggle">
            
            <div class="relative flex-grow max-w-full sm:max-w-[200px] flex-shrink-0">
                 <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                    <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                 </div>
                 <input type="text" id="marSearchBox" 
                    class="block w-full pl-8 pr-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded leading-5 bg-gray-50 dark:bg-gray-700 placeholder-gray-500 dark:placeholder-gray-400 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-xs md:text-sm transition-shadow"
                    placeholder="${t('search_placeholder_short')}"
                  >
            </div>

            <!-- Desktop Controls -->
            <div class="hidden md:inline-flex shadow-sm rounded-md bg-gray-100 dark:bg-gray-700 p-1 flex-shrink-0">
                <button id="marBtnStartOrder" data-mode="startorder" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('start_order')}</button>
                <button id="marBtnByClass" data-mode="byclass" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('view_by_class_short')}</button>
            </div>
            
            <!-- Mobile Sort Dropdown -->
            <div class="md:hidden relative w-[110px] flex-shrink-0">
                 <select id="mobileSortSelect" class="block w-full py-1.5 pl-2 pr-7 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs appearance-none">
                     <option value="byclass">${t('view_by_class_short')}</option>
                     <option value="startorder">${t('start_order')}</option>
                 </select>
                 <div class="pointer-events-none absolute right-0 top-0 bottom-0 flex items-center px-1.5 text-gray-500">
                     <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                 </div>
            </div>

            <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1 hidden md:block"></div>

            <button id="marToggleOnB" class="px-2 py-1.5 md:px-3 text-xs md:text-sm font-medium rounded border transition-colors flex-shrink-0">
              <!-- Text updated via JS -->
            </button>
            <button id="marToggleFinalized" class="hidden md:inline-flex px-3 py-1.5 text-xs md:text-sm font-medium rounded border transition-colors">
               <!-- Text updated via JS -->
            </button>

            <!-- Mobile Checkbox -->
            <label class="md:hidden flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer flex-shrink-0">
                 <input type="checkbox" id="mobileFinalizedCheck" class="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5" />
                 <span id="mobileFinalizedLabel">${t('filter_finished')}</span>
            </label>

            <div id="maratonClassChips" class="flex-shrink-0 z-10 w-[130px] sm:w-auto"></div>

            <div class="flex-grow hidden sm:block"></div>

            <div class="flex-shrink-0 flex items-center gap-2 justify-end border-t border-gray-100 sm:border-0 pt-2 sm:pt-0 dark:border-gray-700 w-full sm:w-auto">
                <button id="marBtnExportCsv" 
                  class="inline-flex items-center px-2 md:px-3 py-1 md:py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-[11px] md:text-sm font-medium rounded text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors">
                   <i class="fas fa-file-csv mr-1.5 text-gray-500 dark:text-gray-400"></i>
                   CSV
                </button>
                <button id="marBtnExportMarathonPdf" 
                  class="inline-flex items-center px-2 md:px-3 py-1 md:py-1.5 border border-transparent shadow-sm text-[11px] md:text-sm font-medium rounded text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors">
                  <svg class="mr-1.5 h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                   Skriv ut PDF
                </button>
            </div>
          </div>
          
          <div id="activeMerges" class="mb-4"></div>

          <div id="marathonTableWrapper" class="bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700">
             <div id="marathon-x-wrap" class="x-scroll-wrap bg-white dark:bg-gray-900 w-full overflow-x-auto">
                <table class="pr-table min-w-full divide-y divide-gray-200 dark:divide-gray-700" id="marathonTable">
                    <thead class="bg-gray-50 dark:bg-gray-700" id="marathonTableHead"></thead>
                    <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700" id="marathonBody"></tbody>
                </table>
             </div>
          </div>
          
          <div id="marathonCards" class="mt-6 grid gap-4 grid-cols-1"></div>
        </div>
      `;
  wireControls(); // Bind listeners ONLY ONCE
  const sb = document.getElementById('marSearchBox');
  if (sb) sb.value = maraton_searchQuery || '';
  return true;
}


function renderTable() {
  if (!ensureShell()) return;

  const marathonDateStr = calculateMarathonDateStr();
  const list = filteredSortedEquipages();
  const maxObs = getMaxObstacleNo();
  const placeMap = buildPlacementsByClass();

  const isOnB = maraton_showOnlyOnB;
  const isClass = maraton_viewMode === 'byclass';
  const isFin = maraton_showOnlyFinalized;

  // --- 2. UPDATE STATIC ELEMENTS ---
  const dateEl = document.getElementById('maratonDateHeader');
  if (dateEl) dateEl.innerText = marathonDateStr || '';

  const btnStartOrder = document.getElementById('marBtnStartOrder');
  const btnByClass = document.getElementById('marBtnByClass');
  if (btnStartOrder) {
    btnStartOrder.className = `px-4 py-1.5 text-sm font-medium rounded transition-all ${!isClass ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;
  }
  if (btnByClass) {
    btnByClass.className = `px-4 py-1.5 text-sm font-medium rounded transition-all ${isClass ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;
  }

  const btnOnB = document.getElementById('marToggleOnB');
  if (btnOnB) {
    btnOnB.className = `px-3 py-1.5 text-sm font-medium rounded border transition-colors ${isOnB ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`;
    btnOnB.innerText = isOnB ? t('show_all') : t('filter_on_course');
  }

  const btnFin = document.getElementById('marToggleFinalized');
  if (btnFin) {
    btnFin.className = `px-3 py-1.5 text-sm font-medium rounded border transition-colors ${isFin ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`;
    btnFin.innerText = isFin ? t('show_all') : t('filter_finished');
  }

  const mobSort = document.getElementById('mobileSortSelect');
  if (mobSort && mobSort.value !== maraton_viewMode) {
      mobSort.value = maraton_viewMode;
  }
  const mobFin = document.getElementById('mobileFinalizedCheck');
  if (mobFin && mobFin.checked !== isFin) {
      mobFin.checked = isFin;
  }

  // --- 3. DYNAMIC CONTENT ---
  const tableHead = document.getElementById('marathonTableHead');
  const tableBody = document.getElementById('marathonBody');
  const xWrap = document.getElementById('marathon-x-wrap');

  stageCols = STAGE_KEYS.filter(stageEnabled);

  // Structural Hashing: Prevents fully rebuilding the table if nothing relevant changed
  const currentStructuralHash = [
    list.length,
    maraton_viewMode,
    maraton_sortState.key,
    maraton_sortState.dir,
    maxObs,
    stageCols.join(','),
    list.map(e => {
      const sn = String(e.startNumber);
      const d = maraton_marathonMap.get(sn) || {};
      const res = calculateMarathonResult(e, d, timingDocFor(sn));
      const fin = isMarathonFinalized(sn) ? 'F' : 'P';
      const run = d.running ? 'R' : 'S';
      const pen = res.totalPenalty || 0;
      return `${sn}:${fin}:${run}:${pen}`;
    }).join('|')
  ].join('::');

  const headerHash = [maxObs, stageCols.join(','), maraton_sortState.key, maraton_sortState.dir].join('|');

  if (tableHead && headerHash !== lastHeaderHash) {
    renderTableHead(tableHead, maxObs);
    lastHeaderHash = headerHash;
  }

  if (currentStructuralHash === lastStructuralHash) {
    // Only update live tickers if the list structure is identical
    try { list.forEach(eq => startOrUpdateLiveTicker(eq.startNumber)); } catch (err) { console.error('LiveTicker error:', err); }
    return;
  }
  lastStructuralHash = currentStructuralHash;
  const renderRow = (eq, index) => {
    const sn = String(eq.startNumber), d = maraton_marathonMap.get(sn) || {};
    const res = calculateMarathonResult(eq, d, timingDocFor(sn));
    const isStruken = eq.status === 'struken';
    const status = res.status;
    const isActive = status && status.includes('Påg');

    let rowBgClass;
    let rowStyle = '';

    if (isStruken) {
      rowBgClass = 'opacity-60 bg-red-50 dark:bg-red-900/10';
    } else if (isActive) {
      rowBgClass = 'bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-500 shadow-sm relative z-10';
      rowStyle = '';
    } else {
      rowBgClass = (index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700/50');
    }

    const startTimeValue = startTimeFor(sn);
    const startLabel = formatStartTimeLabel(startTimeValue);
    const etaLabel = res.eta.B ? fmtClock(res.eta.B) : (res.eta.A ? fmtClock(res.eta.A) : '—');

    const place = placeMap.get(sn);
    const totalPen = res.totalPenalty;
    const totalLabel = (totalPen === Infinity) ? 'ELIM' : (isNum(totalPen) ? totalPen.toFixed(2) : '—');

    return `<tr class="${rowBgClass} hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors" data-sn="${sn}" style="cursor: pointer; ${rowStyle}">
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center font-bold text-gray-700 dark:text-gray-300 text-[11px] lg:text-sm">${isNum(place) ? place : '—'}</td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm font-medium text-gray-900 dark:text-white">${sn}</td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 sticky-col-driver ${rowBgClass || ''}">
            <div class="text-xs lg:text-base font-bold text-gray-900 dark:text-white leading-tight truncate" title="${eq.driverName || '-'}">${eq.driverName || '-'}</div>
            <div class="hidden lg:block text-[10px] lg:text-xs text-gray-500 dark:text-gray-400 mt-0.5 whitespace-nowrap">${getMomentHorseLabelStacked(eq, 'marathon')}</div>
        </td>
        ${isClass ? '' : `<td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm text-gray-500 dark:text-gray-400"><div class="truncate max-w-[100px] lg:max-w-none" title="${eq._mergedLabel || eq.className || ''}">${eq._mergedLabel || eq.className || '-'}</div></td>`}
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm text-gray-500 dark:text-gray-400">
             <div class="flex items-center gap-1.5">
                  ${getFlagHtml(eq)}
                  ${getClubLogoHtml(eq)}
                  <span class="truncate max-w-[100px] lg:max-w-[120px]" title="${eq.clubName || ''}">${eq.clubName || ''}</span>
             </div>
        </td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm text-gray-900 dark:text-gray-200 whitespace-nowrap">${startLabel}</td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm dark:text-gray-300 whitespace-nowrap">${etaLabel}</td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm tabular-nums whitespace-nowrap">
             <span data-live-label="${sn}" class="text-[10px] lg:text-xs font-bold text-gray-400 mr-1"></span>
             <span data-live-time="${sn}" class="font-bold text-gray-700 dark:text-gray-200">—</span>
        </td>

        ${rowStageCellsHTML(res)}
        ${rowObstacleCells(res, maxObs)}

        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center text-[11px] lg:text-sm font-bold text-gray-700 dark:text-gray-300" data-sn="${sn}" data-cell="obsSum">${isNum(res.obstacles.sum) ? res.obstacles.sum.toFixed(2) : '-'}</td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center text-[11px] lg:text-sm font-bold text-gray-700 dark:text-gray-300">
          ${(() => {
        // Sum global Other + Wrong Gait + Per-Obstacle Other Penalty
        let val = (res.otherPenalty || 0) + (res.wgPenalty || 0);
        if (res.obstacles && res.obstacles.items) {
          res.obstacles.items.forEach(o => {
            val += (Number(o.otherPenalty) || 0);
          });
        }
        return (val > 0 || val !== 0) ? val.toFixed(2) : '-';
      })()}
        </td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center text-[11px] lg:text-sm font-black text-gray-900 dark:text-white" data-total-pen="${sn}">${totalLabel}</td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm">
             <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] lg:text-xs font-medium whitespace-nowrap ${statusClass(status)}">
               ${status}
             </span>
        </td>
        <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm">
             <div class="flex items-center gap-2" data-finalize-slot>
               ${(() => {
        const compId = getGlobalState('currentCompetition')?.id;
        const can = window.canFinalize && window.canFinalize();
        const finalized = isMarathonFinalized(sn);
        if (!can) return '';
        return finalized
          ? `<button class="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 text-[10px] lg:text-xs border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded whitespace-nowrap" onclick="event.stopPropagation(); __unfinalizeMaraton('${compId}','${sn}')">${t('undo')}</button>`
          : `<button class="text-white bg-emerald-600 hover:bg-emerald-700 text-[10px] lg:text-xs px-2 py-1 rounded shadow-sm whitespace-nowrap" onclick="event.stopPropagation(); __finalizeMaraton('${compId}','${sn}')">${t('finalize')}</button>`;
      })()}
             </div>
        </td>
    </tr>`;
  };

  if (tableBody) {
    if (list.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="99" class="p-12 text-center text-gray-400 italic">${t('dressage_no_results') || t('no_results') || 'Inga resultat.'}</td></tr>`;
    } else if (isClass) {
      let html = '';
      const groups = new Map();
      list.forEach(e => {
        const k = e._mergedKey || `CLS:${e.className || t('unknown_class')}`;
        if (!groups.has(k)) groups.set(k, { label: e._mergedLabel || e.className || t('unknown_class'), rows: [] });
        groups.get(k).rows.push(e);
      });
      [...groups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'sv')).forEach(([, grp]) => {
        html += `<tr class="bg-gray-100 dark:bg-gray-700 border-t border-b border-gray-200 dark:border-gray-600"><td colspan="99" class="px-4 py-2 font-bold text-gray-700 dark:text-gray-200 text-sm">${grp.label}</td></tr>`;
        grp.rows.forEach((eq, index) => html += renderRow(eq, index));
      });
      tableBody.innerHTML = html;
    } else {
      tableBody.innerHTML = list.map((eq, index) => renderRow(eq, index)).join('');
    }
  }

  // Scroll Sync & Tickers
  if (xWrap && window.__setupXbarSync) {
    try { window.__setupXbarSync({ barClass: 'fixed-xbar', innerId: 'marathonXbarInner', hostEl: xWrap }); } catch { }
  }
  try { list.forEach(eq => startOrUpdateLiveTicker(eq.startNumber, eq.className || '')); } catch { }
}


function wireControls() {
  const input = document.getElementById('marSearchBox');
  const wrap = document.getElementById('modeToggle');

  if (input) {
    input.addEventListener('input', (e) => {
      maraton_searchQuery = e.target.value || '';
      render();
    });
  }

  // Bind direkt på knapparna (robust även om wrapper saknas)
  const btnStart = document.getElementById('marBtnStartOrder');
  const btnClass = document.getElementById('marBtnByClass');
  const btnFin = document.getElementById('marToggleFinalized');
  const btnOnB = document.getElementById('marToggleOnB');

  if (btnStart) btnStart.onclick = () => { maraton_viewMode = 'startorder'; render(); };
  if (btnClass) btnClass.onclick = () => { maraton_viewMode = 'byclass'; render(); };

  if (btnFin) btnFin.onclick = () => { maraton_showOnlyFinalized = !maraton_showOnlyFinalized; render(); };
  if (btnOnB) btnOnB.onclick = () => { maraton_showOnlyOnB = !maraton_showOnlyOnB; render(); };

  const mobileSort = document.getElementById('mobileSortSelect');
  if (mobileSort) {
      mobileSort.onchange = (e) => {
          maraton_viewMode = e.target.value;
          render();
      };
  }

  const mobileFin = document.getElementById('mobileFinalizedCheck');
  if (mobileFin) {
      mobileFin.onchange = (e) => {
          maraton_showOnlyFinalized = e.target.checked;
          render();
      };
  }

  const cards = document.getElementById('marathonCards');
  if (cards) {
    cards.onclick = (e) => {
      const card = e.target.closest('[data-sn]');
      if (!card) return;
      const sn = card.dataset.sn;
      showDetailsModal(sn, maraton_equipages, maraton_marathonMap);
    };
  }


  const btnPdf = document.getElementById('marBtnExportMarathonPdf');
  if (btnPdf) {
    // Remove old listeners? No easy way, but since wireControls is only called once per shell creation, it should be fine.
    // Ideally we clone and replace to strip listeners if we were re-wiring. 
    // But now we are only wiring once.
    btnPdf.onclick = async () => {
      try {
        const freshComp = getGlobalState('currentCompetition') || {};
        const search = document.getElementById('marSearchBox')?.value.toLowerCase();

        // Use centralized helper
        let list = prepareMarathonResults(maraton_equipages || [], maraton_marathonConfig, {
          timingMap: maraton_marathonMap,
          stateMap: maraton_marathonMap
        });

        if (search) {
          list = list.filter(e => (e.driverName || '').toLowerCase().includes(search) || String(e.startNumber).includes(search));
        }
        list.sort((a, b) => (a.place || 9999) - (b.place || 9999));

        await generateMarathonListPdf(list, freshComp);
      } catch (err) {
        console.error(err);
        alert('Kunde inte skapa PDF: ' + err.message);
      }
    };
  }

  const btnCsv = document.getElementById('marBtnExportCsv');
  if (btnCsv) {
    btnCsv.onclick = () => {
      const comp = getGlobalState('currentCompetition');
      const date = new Date().toISOString().split('T')[0];
      const filename = `maraton_resultat_${sanitizeForFilename(comp?.name || 'tavling')}_${date}.csv`;

      const list = filteredSortedEquipages();
      const maxObs = getMaxObstacleNo();
      const activeStages = STAGE_KEYS.filter(stageEnabled);
      const placeMap = buildPlacementsByClass();

      const headers = [
        'Plac', 'Nr', 'Kusk', 'Häst', 'Klass', 'Klubb', 'Start', 'ETA'
      ];

      activeStages.forEach(st => headers.push(`Sträcka ${st}`));
      for (let i = 1; i <= maxObs; i++) headers.push(`H${i}`);

      headers.push('H-Straff', 'Övr-Straff', 'Totalt', 'Status');

      const rows = list.map(eq => {
        const sn = String(eq.startNumber);
        const d = maraton_marathonMap.get(sn) || {};
        const t = timingDocFor(sn);
        const res = calculateMarathonResult(eq, d, t);

        const startTimeValue = startTimeFor(sn);
        const startLabel = startTimeValue ? (startTimeValue.split('T')[1] || '—') : '—';
        const etaLabel = res.eta.B ? fmtClock(res.eta.B) : (res.eta.A ? fmtClock(res.eta.A) : '—');

        const place = placeMap.get(sn);
        const totalPen = res.totalPenalty;
        const totalLabel = (totalPen === Infinity) ? 'ELIM' : (isNum(totalPen) ? totalPen.toFixed(2) : '—');

        const row = [
          isNum(place) ? place : '—',
          sn,
          eq.driverName || '—',
          getMomentHorseLabel(eq, 'marathon'),
          eq._mergedLabel || eq.className || '—',
          eq.clubName || '—',
          startLabel,
          etaLabel
        ];

        // Stage penalties
        activeStages.forEach(st => {
          const sData = res.stages[st];
          if (st === 'B' && res.status === 'Pågår' && !Number.isFinite(sData?.timePenalty)) {
            // console.warn(`[DEBUG-DISAPPEAR] #${res.startNumber} Stage B Penalty missing!`, { sData, stages: res.stages });
          }

          let val = '—';
          if (sData) {
            if (sData.eliminated) val = 'ELIM';
            else if (isNum(sData.timePenalty)) val = sData.timePenalty.toFixed(2);
          }
          row.push(val);
        });

        // Obstacle penalties
        const obsArr = getObstacleArray(d);
        for (let i = 1; i <= maxObs; i++) {
          const o = obsArr.find(x => (x.number ?? x.no ?? x.nr ?? x.hinderNr) === i) || null;
          if (o) {
            const { penalty } = obstacleValues(o);
            const p = isNum(penalty) ? penalty : 0;
            row.push(p.toFixed(2));
          } else {
            row.push('0,00');
          }
        }

        row.push(
          isNum(res.obstacles.sum) ? res.obstacles.sum.toFixed(2) : '0,00',
          isNum(res.otherPenalty) ? res.otherPenalty.toFixed(2) : '0,00',
          totalLabel,
          res.status || '—'
        );

        return row;
      });

      downloadCsv(filename, headers, rows);
    };
  }

  const table = document.getElementById('marathonTable');
  if (table) {
    // Header click
    const thead = document.getElementById('marathonTableHead');
    if (thead) {
      thead.onclick = (e) => {
        const th = e.target.closest('th[data-sort-key]');
        if (!th) return;
        const key = th.dataset.sortKey;
        if (maraton_sortState.key === key) {
          maraton_sortState.dir = maraton_sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
          maraton_sortState.key = key;
          maraton_sortState.dir = 'asc';
        }
        render();
      };
    }

    table.onclick = (e) => {
      // Ignore header clicks on sorting (handled above, or if bubble)
      if (e.target.closest('thead')) return;

      const targetEl = e.target.closest('tr[data-sn]') || e.target.closest('button[data-sn]');
      if (!targetEl) return;
      const sn = targetEl.getAttribute('data-sn');
      if (!sn) return;

      if (e.target.closest('button') && !e.target.closest('.eqLink')) return; // Allow eqLink (driver name) to bubble, block admin buttons if any?
      // Actually admin buttons have their own onclick with stopPropagation.
      // So we just need to handle row click.

      e.preventDefault();
      showDetailsModal(sn, maraton_equipages, maraton_marathonMap);
    };
  }
}




function rowObstacleCells(res, maxObs) {
  return Array.from({ length: maxObs }, (_, i) => {
    const n = i + 1;
    const obsItem = (res.obstacles.items || []).find(o => Number(o.number) === n);
    const finalP = (obsItem && Number.isFinite(Number(obsItem.penalty))) ? Number(obsItem.penalty) : null;
    const label = (finalP !== null) ? finalP.toFixed(2) : '—';

    return `<td class="px-2 py-1.5 lg:px-3 lg:py-2 text-center text-[11px] lg:text-sm font-normal tabular-nums" data-sn="${res.startNumber}" data-obs="${n}">
                    <span data-cell="obsVal">${label}</span>
                </td>`;
  }).join('');
}

function renderTableHead(thead, maxObs) {
  const isClass = maraton_viewMode === 'byclass';
  const thClass = "px-2 py-2 lg:px-3 lg:py-3 text-left text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider align-middle";
  const thCenter = "px-2 py-2 lg:px-3 lg:py-3 text-center text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider align-middle";

  const getSortIcon = (k) => {
    if (maraton_sortState.key !== k) return '<span class="text-gray-300 dark:text-gray-600 opacity-50 text-[10px] w-3 text-center">↕</span>';
    return maraton_sortState.dir === 'asc'
      ? '<span class="text-gray-800 dark:text-gray-200 text-[10px] w-3 text-center">↓</span>'
      : '<span class="text-gray-800 dark:text-gray-200 text-[10px] w-3 text-center">↑</span>';
  };

  const thSort = (cls, key, txt) => {
    const justify = cls.includes('text-center') ? 'justify-center' : 'justify-start';
    return `<th class="${cls} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none" data-sort-key="${key}">
                <div class="flex items-center gap-1 ${justify}">
                  <span>${txt}</span>${getSortIcon(key)}
                </div>
              </th>`;
  };

  const stageHead = stageCols.map(st => thSort("px-2 py-2 lg:px-3 lg:py-3 text-center text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider align-middle", `stage-${st}`, stageLabel(st))).join('');
  const obsHead = Array.from({ length: maxObs }, (_, i) => thSort("px-2 py-2 lg:px-3 lg:py-3 text-center text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider align-middle", `obs-${i + 1}`, `${t('obstacle_lbl')} ${i + 1}`)).join('');
  const klassTH = isClass ? '' : thSort(thClass, 'className', t('class'));

  thead.innerHTML = `
        <tr>
            ${thSort(`${thClass} w-10 text-center`, 'place', t('rank_short'))}
            ${thSort(`${thClass} w-12 sticky-col-start bg-gray-50 dark:bg-gray-700`, 'startNumber', t('startno'))}
            ${thSort(`${thClass} sticky-col-driver bg-gray-50 dark:bg-gray-700`, 'driverName', t('driver'))}
            ${klassTH}
            ${thSort(thClass, 'clubName', t('club'))}
            ${thSort(thClass, 'startTime', t('start_time'))}
            ${thSort(thClass, 'eta', t('eta'))}
            ${thSort(thClass, 'live', t('live'))}
            ${stageHead}
            ${obsHead}
            ${thSort(thCenter, 'obsSum', t('penalty_obstacle_short'))}
            ${thSort(thCenter, 'otherPenalty', t('penalty_other_short'))}
            ${thSort(thCenter, 'totalPenalty', t('total'))}
            ${thSort(thClass, 'status', t('status'))}
            <th class="${thClass}">Admin</th>
        </tr>
      `;
}

function stageLabel(s) {
  return s === 'transport' ? 'T' : String(s || '').toUpperCase();
}



function buildPlacementsByClass() {
  const byGroup = {};
  const map = new Map();

  for (const eq of maraton_equipages) {
    const sn = String(eq.startNumber);
    const d = maraton_marathonMap.get(sn) || {};
    const t = timingDocFor(sn);
    const res = calculateMarathonResult(eq, d, t);

    // Enbart ekipage som är "Klar" eller "Färdigmarkerad" (finalized) ska få placering.
    // Eliminerade ekipage (res.totalPenalty === Infinity) får ingen placering (#).
    const finalized = isFinalizedDoc(d);
    const finished = res.status === 'Klar' || finalized;
    const tot = res.totalPenalty;

    if (!finished || !Number.isFinite(tot) || tot === Infinity) continue;

    // 🧩 Gruppnyckel för placering: sammanslagna klass om vald, annars original
    const grpKey = eq._mergedKey || `CLS:${eq.className || 'Okänd klass'}`;
    (byGroup[grpKey] ||= []).push({ sn, tot, res });
  }

  for (const grpKey of Object.keys(byGroup)) {
    const arr = byGroup[grpKey];
    arr.sort((a, b) => {
      // 1. Total Penalty
      const diff = a.tot - b.tot;
      if (Math.abs(diff) > 1e-6) return diff;

      // 2. Tie-breaker: Sum of Obstacle Penalties (lowest wins)
      const aObsPen = a.res.obstaclePenaltySum || 0;
      const bObsPen = b.res.obstaclePenaltySum || 0;
      const obsPenDiff = aObsPen - bObsPen;
      if (Math.abs(obsPenDiff) > 1e-6) return obsPenDiff;

      // 3. Tie-breaker: Obstacle Times sequence (fastest at first differentiator wins)
      const aTimes = a.res.obstacleTimes || [];
      const bTimes = b.res.obstacleTimes || [];
      const maxLen = Math.max(aTimes.length, bTimes.length);
      for (let j = 0; j < maxLen; j++) {
        const ta = aTimes[j] || 0;
        const tb = bTimes[j] || 0;
        if (Math.abs(ta - tb) > 1e-6) return ta - tb;
      }

      return 0;
    });

    let place = 1;
    let prevTot = -1, prevObsPen = -1, prevTimes = null;

    arr.forEach((row, i) => {
      let isTie = false;
      if (prevTot !== -1) {
        const totTie = Math.abs(row.tot - prevTot) < 1e-6;
        const obsPenTie = Math.abs((row.res.obstaclePenaltySum || 0) - prevObsPen) < 1e-6;
        
        // Deep compare times
        let timesTie = true;
        const rTimes = row.res.obstacleTimes || [];
        const pTimes = prevTimes || [];
        if (rTimes.length !== pTimes.length) {
          timesTie = false;
        } else {
          for (let j = 0; j < rTimes.length; j++) {
            if (Math.abs(rTimes[j] - pTimes[j]) > 1e-6) {
              timesTie = false;
              break;
            }
          }
        }
        
        if (totTie && obsPenTie && timesTie) {
          isTie = true;
        }
      }

      if (!isTie) {
        place = i + 1;
      }

      map.set(row.sn, place);
      prevTot = row.tot;
      prevObsPen = row.res.obstaclePenaltySum || 0;
      prevTimes = row.res.obstacleTimes || [];
    });
  }

  return map;
}






// Hjälp: bygg etiketter vi använder på korten
// Hjälp: bygg etiketter vi använder på korten
function buildCardData(eq) {
  const sn = String(eq.startNumber);
  const d = maraton_marathonMap.get(sn) || {};
  const res = calculateMarathonResult(eq, d, timingDocFor(sn));

  const totalPen = res.totalPenalty;
  const totalLabel = (totalPen === Infinity) ? 'ELIM' : (isNum(totalPen) ? totalPen.toFixed(2) : '—');
  const etaLabel = res.eta.B ? fmtClock(res.eta.B) : (res.eta.A ? fmtClock(res.eta.A) : '—');
  const startVal = startTimeFor(sn);
  const startLabel = formatStartTimeLabel(startVal);

  return { sn, d, status: res.status, totalLabel, etaLabel, startLabel };
}


function renderMobile() {
  const cards = document.getElementById('marathonCards');
  if (!cards) return;

  const list = filteredSortedEquipages();
  if (list.length === 0) {
    cards.innerHTML = `<div class="p-6 text-center text-gray-400 italic bg-white dark:bg-gray-800 rounded-lg shadow-sm w-full">${t('dressage_no_results') || t('no_results') || 'Inga resultat.'}</div>`;
    return;
  }

  const maxObs = getMaxObstacleNo();
  const placeMap = buildPlacementsByClass();

  // 1. Calculate starters per class for dynamic placement counts
  const classStarters = new Map();
  list.forEach(eq => {
    const cls = eq.className || 'Ok\u00e4nd Klass';
    classStarters.set(cls, (classStarters.get(cls) || 0) + 1);
  });

  let lastClass = null;
  let html = '';

  list.forEach(eq => {
    const cls = eq.className || 'Ok\u00e4nd Klass';

    if (maraton_viewMode === 'byclass' && cls !== lastClass) {
        html += `<div class="px-2 py-1.5 mt-2 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-bold text-sm rounded-md shadow-sm">${cls}</div>`;
        lastClass = cls;
    }

    const { sn, d, status, totalLabel, etaLabel, startLabel } = buildCardData(eq);
    const place = placeMap.get(sn);
    const isActive = status && status.includes('P\u00e5g');
    const isStruken = eq.status === 'struken';

    const res = calculateMarathonResult(eq, d, timingDocFor(sn));

    // 2. Placement Coloring Logic
    const startersCount = classStarters.get(cls) || 1;
    const numPlaced = Math.ceil(startersCount / 4) || 1;
    const rankNum = Number(place);
    const isPlaced = !isNaN(rankNum) && rankNum > 0 && rankNum <= numPlaced;

    let placColor = 'text-gray-600 dark:text-gray-400';
    let placBg = 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';

    if (isStruken) {
        placBg = 'bg-red-50 dark:bg-red-900/10 border-red-100 opacity-75';
    } else if (isActive) {
        placBg = 'bg-yellow-50 dark:bg-yellow-900/40 border-yellow-500 shadow-sm border-l-4 border-2';
    } else if (isPlaced) {
        if (rankNum === 1) { placColor = 'text-yellow-600 dark:text-yellow-400 drop-shadow-sm'; placBg = 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-500/80 border-2'; }
        else if (rankNum === 2) { placColor = 'text-slate-600 dark:text-slate-300 drop-shadow-sm'; placBg = 'bg-slate-100 dark:bg-slate-800/80 border-slate-400 dark:border-slate-500/80 border-2'; }
        else if (rankNum === 3) { placColor = 'text-orange-700 dark:text-orange-400 drop-shadow-sm'; placBg = 'bg-orange-100 dark:bg-orange-950/40 border-orange-500 dark:border-orange-600/80 border-2'; }
        else { placColor = 'text-emerald-600 dark:text-emerald-400'; placBg = 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/50 border-2'; }
    }

    let placBlock = `
        <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5 font-bold tracking-wider">Plac</div>
        <div class="text-base font-black ${placColor} leading-none">${place || '\u2014'}</div>
    `;

    html += `
      <div class="m-1 mb-1.5 rounded-lg border shadow-sm overflow-hidden cursor-pointer ${placBg}" data-sn="${sn}" style="cursor: pointer;">
        
        <div class="p-1.5 flex items-center justify-between gap-1 border-b dark:border-gray-700/50 ${(isPlaced || isActive || isStruken) ? '' : 'bg-gray-50 dark:bg-gray-800/50'}">
           <!-- Left: Name & Flags -->
           <div class="flex flex-col min-w-0 pr-1">
              <div class="font-bold text-[13px] dark:text-white leading-tight truncate flex items-center gap-1">
                 <span class="text-gray-500 dark:text-gray-400 text-[10px]">#${eq.startNumber}</span> 
                 <span class="truncate">${eq.driverName}</span>
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                 ${getFlagHtml(eq)} ${getClubLogoHtml(eq)}
                 ${maraton_viewMode === 'startorder' ? `<span class="text-[9px] text-gray-500 dark:text-gray-400 truncate ml-1">${cls}</span>` : ''}
              </div>
           </div>
           
           <!-- Right: Stats & Plac -->
           <div class="flex items-center gap-2 shrink-0">
              <div class="text-right">
                  <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5">Totalt</div>
                  <div class="font-bold text-[13px] text-blue-800 dark:text-blue-300 leading-none" data-total-pen="${sn}">${totalLabel}</div>
              </div>
              <div class="text-right border-l dark:border-gray-300 dark:border-gray-600 pl-2">
                  ${placBlock}
              </div>
           </div>
        </div>

        <div class="px-1.5 py-1 bg-white dark:bg-gray-800">
           <div class="flex justify-between items-center text-[9px] mb-1">
              <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                 <span>Start: <strong class="text-gray-700 dark:text-gray-200">${startLabel}</strong></span>
                 <span>ETA M\u00e5l: <strong class="text-gray-700 dark:text-gray-200">${etaLabel}</strong></span>
              </div>
              ${isActive
                ? `
                  <div class="flex items-center gap-1">
                      <span class="inline-flex items-center px-1 py-0.5 rounded text-[8px] uppercase font-bold bg-yellow-100 text-yellow-800 animate-pulse">Running</span>
                      <span data-live-time="${sn}" class="font-bold text-yellow-700 animate-pulse">\u2014</span>
                  </div>
                  `
                : `<span class="text-gray-500 dark:text-gray-400 font-medium">${status || '\u2013'}</span>`
              }
           </div>

           <!-- STAGES ROW -->
           <div class="flex gap-1">
               ${STAGE_KEYS.filter(stageEnabled).map(st => {
           const sData = res.stages[st];
           let val = '\u2014';
           let valClass = "bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400";

           if (sData) {
             if (sData.eliminated) { val = 'ELIM'; valClass = "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 font-bold"; }
             else if (isNum(sData.timePenalty)) {
               val = sData.timePenalty.toFixed(2);
               if (sData.timePenalty > 0) valClass = "bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-200";
             }
           }
           return `
                    <div class="flex-1 text-center py-0.5 rounded ${valClass} border border-gray-100 dark:border-gray-600">
                       <div class="text-[8px] uppercase tracking-wider opacity-70 leading-none">${stageLabel(st)}</div>
                       <div class="font-bold text-[10px] tabular-nums leading-tight" data-stage-pts="${sn}" data-stage="${st}">${val}</div>
                    </div>
                  `;
         }).join('')}
           </div>
        </div>

      </div>
    `;
  });

  cards.innerHTML = html;

  try { list.forEach(eq => startOrUpdateLiveTicker(eq.startNumber)); } catch (err) { console.error('LiveTicker error:', err); }
}

// === LIVE LISTENERS ===
function listenLive() {
  if (!competitionId) return;

  const summaryRef = collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton');
  const unsub = onSnapshot(summaryRef, snapshot => {
    let changed = false;
    snapshot.docChanges().forEach(change => {
      const id = String(change.doc.id);
      if (change.type === 'added' || change.type === 'modified') {
        const current = maraton_marathonMap.get(id) || {};
        maraton_marathonMap.set(id, { ...current, ...change.doc.data() });
        changed = true;
      }
      if (change.type === 'removed') {
        maraton_marathonMap.delete(id);
        changed = true;
      }
    });

    if (changed) {
      // Uppdaterar bara listan, inte hela sidan om vi kan undvika det
      // Använd debounce för att inte rendera för ofta
      if (document.visibilityState === 'visible') {
        renderLiveDebounce();
      }
    }
  });

  return unsub;
}

// Lyssnare för admin-config (merge-grupper mm)
function listenMergeConfig() {
  if (!competitionId) return;
  const cfgRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'marathon');
  return onSnapshot(cfgRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      buildMergeMap(data); // Bygg om MERGE_MAP
      maraton_equipages = ensureMergeDecorations(maraton_equipages); // uppdatera equipages
      render(); // rita om
    }
  });
}


// === MAIN LOAD ===

export async function load() {
  initializeScrollSync(window.location.pathname);
  const comp = getGlobalState('currentCompetition');
  if (!comp || !comp.id) {
    console.error('MaratonResults: No competition loaded.');
    return;
  }
  competitionId = comp.id;

  if (!document.getElementById('marathonResultsTableStyles')) {
    injectMaratonTableStyles(); // Ensure CSS injected
  }

  // Load startlist & config
  const [eqs, cfg, startTimes, initialTimingData] = await Promise.all([
    getEquipages(competitionId),
    getConfig(competitionId, 'maratonConfig'),
    getConfig(competitionId, 'schedule'),
    getMarathonTimingData(competitionId),
    ensureClubLogosLoaded(competitionId)
  ]);


  // maraton_marathonConfig is imported, so we cannot assign to it.
  setMarathonConfig(cfg || {});

  maraton_startTimes = startTimes || {};

  initialTimingData.forEach((data, id) => {
    maraton_marathonMap.set(String(id), data);
  });

  maraton_equipages = eqs.map(normalizeEquipage);
  // Default sort: Place
  maraton_sortState = { key: 'place', dir: 'asc' };

  // Init merge groups if config has them
  buildMergeMap(maraton_marathonConfig);
  maraton_equipages = ensureMergeDecorations(maraton_equipages);

  // Setup UI
  ensureShell();
  const search = document.getElementById('marSearchBox');
  if (search) maraton_searchQuery = search.value || '';

  render();

  // Listeners
  const u1 = listenLive();
  const u2 = listenForMarathonTimingUpdates(competitionId, (docs) => {
    let changed = false;
    docs.forEach(d => {
      const id = String(d.id);
      const current = maraton_marathonMap.get(id) || {};
      maraton_marathonMap.set(id, { ...current, ...d.data() });
      changed = true;
    });
    if (changed) renderLiveDebounce();
  });
  const u3 = listenForGlobalCompetitionPause_Results();
  const u4 = listenMergeConfig(); // Lyssna på ändringar i display/merge-config

  // [NYTT] Re-rendra vid resize för att växla mellan tabell/kortvy
  const onResize = () => renderLiveDebounce();
  window.addEventListener('resize', onResize);

  // spara undan för unload
  window.__marathonUnsub = () => {
    window.removeEventListener('resize', onResize);
    if (u1) u1();
    if (u2) u2(); // redundant?
    if (u3) u3();
    if (u4) u4();
    Object.values(localLiveTickers).forEach(clearInterval);
    Object.keys(localLiveTickers).forEach(k => delete localLiveTickers[k]);
  };

  // Expose bridge for modal
  exposeMarathonModalBridge();
}

export function __unload() {
  if (window.__marathonUnsub) window.__marathonUnsub();
  window.__marathonUnsub = null;
  window.__teardownXbarSync?.();
}

// === BRIDGE FÖR MODAL (Navigering) ===
// Gör att modalen kan anropa "nästa / föregående" och vi svarar med nytt ekipage-data.
// Modalen vet inget om sortering/filtrering, men vi vet (filteredSortedEquipages).
function exposeMarathonModalBridge() {
  window.__marathonModalBridge = {
    // Hämta nästa/föregående startnummer givet ett nuvarande
    getNeighbor: (currentSn, direction) => {
      const list = filteredSortedEquipages();
      const idx = list.findIndex(e => String(e.startNumber) === String(currentSn));
      if (idx < 0) return null; // hittades inte

      let nextIdx = idx + direction; // +1 eller -1
      if (nextIdx < 0) return null; // början
      if (nextIdx >= list.length) return null; // slutet

      const nextEq = list[nextIdx];
      const sn = String(nextEq.startNumber);
      const d = maraton_marathonMap.get(sn);
      return { sn, data: d, equipage: nextEq };
    }
  };
}





