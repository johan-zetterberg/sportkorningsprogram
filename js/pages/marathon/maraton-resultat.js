// js/pages/maraton-resultat.js
import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getMarathonTimingData, listenForMarathonTimingUpdates } from '../../services/marathonService.js';
import { collection, onSnapshot, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { t } from '../../utils/i18n.js';
import {
  maraton_marathonConfig,
  setMarathonConfig,
  limitsFor,
  stagePenaltyFromMs,
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved,
  pausedMsSince,
  formatMsLive,
  setPauseWindows,
  calculateMarathonResult,
  getObstacleCoefficient,
  MERGE_GROUPS,
  buildMergeMap,
  ensureMergeDecorations,
  getPauseTime
} from '../../utils/marathonUtils.js';
import {
  formatStartTimeLabel,
  getMomentHorseLabelStacked,
  statusClass
} from './marathonResultFormatters.js';
import {
  renderTableHead,
  rowObstacleCells
} from './marathonResultTable.js';
import { renderMarathonMobileCards } from './marathonResultMobile.js';
import {
  buildMarathonPlacementsByClass,
  filterAndSortMarathonEquipages,
  isFinalizedMarathonDoc
} from './marathonResultRanking.js';
import {
  getStartTimeFor,
  getTimingDocFor,
  isStageEnabled
} from './marathonResultTiming.js';
import {
  clearMarathonLiveTickers,
  rowStageCellsHTML as renderLiveStageCellsHTML,
  startOrUpdateMarathonLiveTicker
} from './marathonResultLiveTicker.js';
import { wireMarathonResultControls } from './marathonResultControls.js';
import {
  ensureMarathonResultShell,
  injectMaratonTableStyles,
  renderActiveMerges as renderActiveMergeChips,
  renderMaratonClassChips as renderClassFilterChips
} from './marathonResultShell.js';
import {
  calculateMarathonDateStr as calculateMarathonDateLabel,
  getMaxObstacleNoFromMap,
  normalizeMarathonEquipage
} from './marathonResultData.js';


import {
  isMobile,
  debounce,
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

let maraton_sortState = { key: 'startNumber', dir: 'asc' }; // Init sorting state

function renderActiveMerges() {
  renderActiveMergeChips({
    mergeGroups: MERGE_GROUPS,
    equipages: maraton_equipages
  });
}

function renderMaratonClassChips() {
  renderClassFilterChips({
    equipages: maraton_equipages,
    activeClassFilters: maraton_activeClassFilters,
    onChange: (lbl) => {
      if (maraton_activeClassFilters.has(lbl)) {
        maraton_activeClassFilters.delete(lbl);
      } else {
        maraton_activeClassFilters.add(lbl);
      }
      render();
    }
  });
}
function fmtClock(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


// ---------- Global state ----------
let competitionId = null;
let isGloballyPaused = false;
let marathonResultsLoadToken = 0;

// Debounce för live-snapshots så UI inte re-rendras för ofta
const renderLiveDebounce = debounce(render, 60);

function listenForGlobalCompetitionPause_Results() {
  if (!competitionId || !appId) return null;
  const statusRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus');

  return onSnapshot(statusRef, (docSnap) => {
    if (docSnap.exists()) {
      const d = docSnap.data();
      isGloballyPaused = d.isPaused === true;
      setPauseWindows(d.pauseLog || []);
    } else {
      isGloballyPaused = false;
      setPauseWindows([]);
    }

    document.body.style.filter = isGloballyPaused ? 'grayscale(80%)' : '';
    render();
  });
}

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
  renderActiveMerges();
  renderMaratonClassChips();
}


function isMarathonFinalized(sn) {
  const d = maraton_marathonMap.get(String(sn));
  return !!(d?.finalized === true || d?.status === 'finalized' || d?.isFinal === true);
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
  updateDoc(ref, { finalized: false, updatedAt: serverTimestamp() })
    .catch(err => {
      console.error('Unfinalize failed:', err);
      if (window.showAlert) window.showAlert('Kunde inte ångra finalisering.', false);
    });
}
window.__unfinalizeMaraton = __unfinalizeMaraton;

let maraton_equipages = [];
let maraton_marathonMap = new Map(); // ...
let maraton_startTimes = {};

// Skriv inte computed från klient i publik miljö
let maraton_viewMode = 'startorder';
let maraton_showOnlyFinalized = false;
let maraton_showOnlyOnB = false;
let maraton_searchQuery = '';
window.maraton_activeClassFilters ??= new Set();
const maraton_activeClassFilters = window.maraton_activeClassFilters;

let stageCols = [];              // vilka kolumner som ska visas, t.ex. ['A','transport','B']
let lastStructuralHash = '';
let lastHeaderHash = '';

function normalizeEquipage(e) {
  return normalizeMarathonEquipage(e);
}
function getMaxObstacleNo() {
  return getMaxObstacleNoFromMap(maraton_marathonMap);
}
// --- Timing helpers (A/T/B) ---
// =====================================================
// CANONICAL A/T/B helpers – klassmedvetna & live-säkra
// =====================================================

const STAGE_KEYS = ['A', 'transport', 'B'];  // 'transport' = T

function rowStageCellsHTML(res) {
  return renderLiveStageCellsHTML(res, stageCols);
}

function startOrUpdateLiveTicker(sn) {
  startOrUpdateMarathonLiveTicker(sn, {
    getIsGloballyPaused: () => isGloballyPaused,
    equipages: maraton_equipages,
    marathonMap: maraton_marathonMap,
    timingDocFor,
    stageKeys: STAGE_KEYS,
    stageStartTS,
    stageStopTS,
    stageDurationMsSaved,
    pausedMsSince,
    formatMsLive,
    limitsFor,
    getPauseTime,
    stagePenaltyFromMs,
    getObstacleCoefficient,
    calculateResult: calculateMarathonResult
  });
}
function startTimeFor(startNumber) {
  return getStartTimeFor(startNumber, {
    marathonMap: maraton_marathonMap,
    startTimes: maraton_startTimes
  });
}
function stageEnabled(s) {
  return isStageEnabled(s, {
    marathonMap: maraton_marathonMap,
    marathonConfig: maraton_marathonConfig,
    stageStartTS,
    stageStopTS,
    stageDurationMsSaved
  });
}

function timingDocFor(sn) {
  return getTimingDocFor(maraton_marathonMap, sn);
}
function filteredSortedEquipages() {
  maraton_equipages = ensureMergeDecorations(maraton_equipages);

  return filterAndSortMarathonEquipages({
    equipages: maraton_equipages,
    searchQuery: maraton_searchQuery,
    activeClassFilters: maraton_activeClassFilters,
    showOnlyFinalized: maraton_showOnlyFinalized,
    showOnlyOnB: maraton_showOnlyOnB,
    sortState: maraton_sortState,
    viewMode: maraton_viewMode,
    marathonMap: maraton_marathonMap,
    isMarathonFinalized,
    calculateResult: calculateMarathonResult,
    timingDocFor,
    startTimeFor,
    placeMap: buildPlacementsByClass()
  });
}
function calculateMarathonDateStr() {
  return calculateMarathonDateLabel(maraton_startTimes);
}
function ensureShell() {
  return ensureMarathonResultShell({
    currentCompetition: getGlobalState('currentCompetition'),
    translate: t,
    wireControls,
    searchQuery: maraton_searchQuery
  });
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
    renderTableHead(tableHead, {
      maxObs,
      viewMode: maraton_viewMode,
      sortState: maraton_sortState,
      stageCols,
      translate: t
    });
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
  wireMarathonResultControls({
    setViewMode: (value) => { maraton_viewMode = value; },
    toggleFinalized: () => { maraton_showOnlyFinalized = !maraton_showOnlyFinalized; },
    toggleOnB: () => { maraton_showOnlyOnB = !maraton_showOnlyOnB; },
    setShowOnlyFinalized: (value) => { maraton_showOnlyFinalized = value; },
    render,
    getEquipages: () => maraton_equipages,
    getMarathonMap: () => maraton_marathonMap,
    showDetailsModal,
    getMarathonConfig: () => maraton_marathonConfig,
    filteredSortedEquipages,
    getMaxObstacleNo,
    getActiveStages: () => STAGE_KEYS.filter(stageEnabled),
    buildPlacementsByClass,
    timingDocFor,
    startTimeFor,
    fmtClock,
    sortState: maraton_sortState
  });
}
function buildPlacementsByClass() {
  return buildMarathonPlacementsByClass({
    equipages: maraton_equipages,
    marathonMap: maraton_marathonMap,
    timingDocFor,
    calculateResult: calculateMarathonResult
  });
}
function renderMobile() {
  const cards = document.getElementById('marathonCards');
  if (!cards) return;

  renderMarathonMobileCards({
    cards,
    list: filteredSortedEquipages(),
    viewMode: maraton_viewMode,
    placeMap: buildPlacementsByClass(),
    marathonMap: maraton_marathonMap,
    stageKeys: STAGE_KEYS,
    stageEnabled,
    calculateResult: calculateMarathonResult,
    timingDocFor,
    startTimeFor,
    fmtClock,
    getFlagHtml,
    getClubLogoHtml,
    startLiveTicker: startOrUpdateLiveTicker,
    translate: t
  });
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
      buildMergeMap(data);
      maraton_equipages = ensureMergeDecorations(maraton_equipages); // uppdatera equipages
      render(); // rita om
    }
  });
}


// === MAIN LOAD ===

export async function load() {
  __unload();
  const currentLoadToken = ++marathonResultsLoadToken;

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
  if (currentLoadToken !== marathonResultsLoadToken) return;


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
  const onResize = () => renderLiveDebounce();
  window.addEventListener('resize', onResize);

  // spara undan för unload
  window.__marathonUnsub = () => {
    window.removeEventListener('resize', onResize);
    if (u1) u1();
    if (u2) u2();
    if (u3) u3();
    if (u4) u4();
    clearMarathonLiveTickers();
  };

  // Expose bridge for modal
  exposeMarathonModalBridge();
}

export function __unload() {
  marathonResultsLoadToken++;
  if (window.__marathonUnsub) {
    try { window.__marathonUnsub(); } catch { }
  }
  window.__marathonUnsub = null;
  window.__teardownXbarSync?.();
  clearMarathonLiveTickers();
  document.body.style.filter = '';
  competitionId = null;
  isGloballyPaused = false;
  maraton_equipages = [];
  maraton_marathonMap.clear();
  maraton_startTimes = {};
  stageCols = [];
  lastStructuralHash = '';
  lastHeaderHash = '';
  window.__marathonModalBridge = null;
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
