import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getPrecisionResults } from '../../services/precisionService.js';
import { listenForDressageProtocolsCollectionGroup, getAllDressageProtocols } from '../../services/dressageService.js';
import { listenForMaratonCollection, listenForMarathonTimingUpdates, getMarathonTimingData, getMarathonStateDocuments } from '../../services/marathonService.js';

import { getGlobalState } from '../../main.js';

import {
  calculateDressageResult,
  calculateMarathonResult
} from '../../services/calculationService.js';
import { collection, onSnapshot, query, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { getCompetitionHeader, renderResponsiveClassFilter } from '../../ui/components.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
import { t } from '../../utils/i18n.js';

import { initializeScrollSync, injectScrollStyles } from '../../ui/scrollHelper.js';
import {
  getCalculatedRowData,
  buildPlaceMap,
  computeMaxSecondsForClass,
  startTimeFor,
  getPortAllowanceCm,
  statusClass,
  buildOverallStanding,
  getToBeatInfo
} from '../../utils/precisionUtils.js';

// IMPORTERA NYA MODALEN
import { showDetailsModal, closeDetailsModal } from '../../ui/precisionModal.js';
import { generateAndPrintPdf, generatePrecisionListPdf } from '../../pdf/precisionPdf.js';
import {
  buildPrecisionMergeState,
  groupPrecisionEquipagesForDisplay,
  resolvePrecisionMergeGrouping
} from './precisionResultMerge.js';
import { filterPrecisionEquipages } from './precisionResultFilters.js';
import { sortPrecisionEquipages } from './precisionResultSort.js';
import { buildPrecisionLiveTick } from './precisionResultLive.js';
import {
  buildPrecisionFinalizePayload,
  buildPrecisionUnfinalizePayload,
  isPrecisionFinalized as resolvePrecisionFinalized,
  patchPrecisionFinalizeBadge as patchPrecisionFinalizeBadgeUi,
  renderPrecisionFinalizeButtons
} from './precisionResultFinalize.js';
import { renderPrecisionResultCard } from './precisionResultMobileCard.js';
import { renderPrecisionResultDesktopRow } from './precisionResultDesktopRow.js';
import {
  renderPrecisionGroupHeader,
  renderPrecisionTable,
  renderPrecisionTableHead
} from './precisionResultTable.js';
import {
  renderPrecisionLiveStatusPanel,
  updatePrecisionLivePanelTimer
} from './precisionResultLivePanel.js';
import {
  formatPrecisionCsvPenalty
} from './precisionResultExportUtils.js';
import {
  applyPrecisionLiveDocChanges,
  groupDressageProtocolsByStartNumber,
  normalizeMarathonTimingDocs,
  unsubscribeAll
} from './precisionResultListeners.js';

import {
  escapeHtml,
  isMobile,
  debounce,
  msToLabel,
  horseLabel,
  horseLabelStacked,
  isNum,
  fmt2,
  downloadCsv,
  sanitizeForFilename
} from '../../utils/sharedUtils.js';

const renderLiveDebounce = debounce(render, 60);

function render() {
  if (isMobile()) {
    window.__teardownXbarSync?.();
    renderMobile();
  } else {
    renderDesktop();
  }
  updateControlStates();
}

function injectPrecisionResultsBaseStyles() {
  if (document.getElementById('precisionResultsBaseStyles')) return;
  const css = `
  body { font-size: 16px; line-height: 1.35; padding-bottom: 18px; }
  .pr-container { width: 100%; max-width: none; margin: 0 auto; padding: 0 16px; }
  .pr-card { background: #fff; border-radius: 16px; box-shadow: 0 10px 24px rgba(0,0,0,.05); }

  .pr-table {
    border-collapse: separate; border-spacing: 0;
    table-layout: auto;
    min-width: max-content;
    width: auto;
    font-size: 15px;
  }
  .pr-table thead th {
    position: sticky; top: 0; z-index: 2;
    background: #fff;
    border-bottom: 2px solid #e5e7eb;
    white-space: nowrap;
    height: 44px;
    padding: 8px 12px;
  }
  .pr-table tbody td {
    white-space: nowrap;
    border-bottom: 1px solid #eee;
    vertical-align: middle;
    padding: 8px 12px;
  }
  .pr-alt tbody tr:nth-child(odd) { background: #fafafa; }

  
      
      
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
  .dark .pr-card { background: #1f2937; box-shadow: 0 10px 24px rgba(0,0,0,.2); }
  .dark .pr-table thead th { background: #1f2937; border-bottom: 2px solid #374151; color: #e5e7eb; }
  .dark .pr-table tbody td { border-bottom: 1px solid #374151; color: #d1d5db; }
  .dark .pr-alt tbody tr:nth-child(odd) { background: #111827; }

    /* Mobil (< 768px): */
    @media (max-width: ${MOBILE_BP - 1}px) {
        #prWrap > table.pr-table { display: none; }
        #prWrap > div { display: block; }
    }

    /* Desktop (>= 768px): */
    @media (min-width: ${MOBILE_BP}px) {
        #prWrap > table.pr-table { display: table; }
        #prWrap > div { display: none; }
    }
  `;
  const s = document.createElement('style');
  s.id = 'precisionResultsBaseStyles';
  s.textContent = css;
  document.head.appendChild(s);
}

// ---------- State ----------
let precision_displayConfig = {};
const precision_activeClassFilters = new Set();
const MOBILE_BP = 500;

function prec_resolveMergeGrouping(e) {
  return resolvePrecisionMergeGrouping(e, precision_MERGE_MAP);
}

function prec_groupEquipagesForDisplay(equipages = []) {
  return groupPrecisionEquipagesForDisplay(equipages, precision_MERGE_MAP);
}

function prec_buildMergeMap(raw) {
  const mergeState = buildPrecisionMergeState(raw);
  precision_MERGE_GROUPS = mergeState.groups;
  precision_MERGE_MAP = mergeState.map;
}

let competitionId = null;
let precision_equipages = [];
let precision_precisionMap = new Map();
let precision_precisionConfig = {};
let precision_startTimes = {};
let precision_sort = { col: 'startNumber', dir: 'asc' };
let precision_searchText = "";
let precision_showOnlyFinalized = false;
let precision_viewMode = 'startorder';
let precision_liveUnsubscribe = null;
let precision_MERGE_GROUPS = [];
let precision_MERGE_MAP = new Map();
const precision_finalizeCache = new Map();

// NYTT för overall standings
let precision_dressageMap = new Map();
let precision_marathonObstacleMap = new Map();
let precision_marathonTimingMap = new Map();

function getOverallEntries(equipages) {
  return equipages.map(eq => {
    const sn = String(eq.startNumber);
    const dProtos = precision_dressageMap.get(sn) || [];
    const dRes = calculateDressageResult(eq, dProtos);
    
    const mDoc = precision_marathonObstacleMap.get(sn) || {};
    const mTiming = precision_marathonTimingMap.get(sn) || {};
    const mRes = calculateMarathonResult(eq, mDoc, mTiming);
    
    return {
      eq,
      dressagePenalty: dRes.penalty,
      marathonPenalty: mRes.totalPenalty,
      isElim: dRes.eliminated || mRes.eliminated
    };
  });
}

function isPrecisionFinalized(sn) {
  return resolvePrecisionFinalized(sn, precision_precisionMap, precision_finalizeCache);
}

function patchPrecisionFinalizeBadge(sn, finalized) {
  patchPrecisionFinalizeBadgeUi(sn, finalized, document);
}

// Helpers för layout
function getDisplayPortAllowance(className) {
  return getPortAllowanceCm(className, precision_precisionConfig || {});
}

// ===== TICKER-FUNKTIONER =====
let precisionTickerInterval = null;

function ensureTicker() {
  if (precisionTickerInterval) return;
  precisionTickerInterval = setInterval(tickPrecisionTimers, 95);
}

function stopTicker() {
  let anyRunning = false;
  precision_precisionMap.forEach(data => {
    if (data && data.running === true) anyRunning = true;
  });

  if (!anyRunning && precisionTickerInterval) {
    clearInterval(precisionTickerInterval);
    precisionTickerInterval = null;
  }
}

function tickPrecisionTimers() {
  let anyRunning = false;
  precision_precisionMap.forEach((data, sn) => {
    if (data && data.running === true && data.liveStartEpoch) {
      anyRunning = true;
      const desktopCell = document.querySelector(`td[data-sn="${sn}"].time-cell span`);
      const mobileTimer = document.querySelector(`div[data-sn="${sn}"] .live-time-card`);

      const eq = precision_equipages.find(e => String(e.startNumber) === sn);
      const maxSec = eq ? computeMaxSecondsForClass(eq, precision_precisionConfig) : null;
      const tick = buildPrecisionLiveTick(data, {
        equipage: eq,
        maxSec,
        config: precision_precisionConfig,
        allEquipages: precision_equipages,
        precisionMap: precision_precisionMap,
        getGroupKey: (equipage) => {
          const startNumber = String(equipage.startNumber);
          if (precision_MERGE_MAP.has(startNumber)) return precision_MERGE_MAP.get(startNumber).key;
          if (precision_MERGE_MAP.has(Number(startNumber))) return precision_MERGE_MAP.get(Number(startNumber)).key;
          return equipage.className;
        }
      });
      if (!tick) return;
      const elapsedMs = tick.elapsedMs;
      const timeLabel = msToLabel(elapsedMs);
      const overTime = tick.overTime;
      const timeClass = overTime ? 'text-red-600 font-semibold animate-pulse' : '';

      if (desktopCell) {
        desktopCell.textContent = timeLabel;
        desktopCell.className = `tabular-nums ${timeClass}`;
      }
      if (mobileTimer) {
        mobileTimer.textContent = timeLabel;
        mobileTimer.className = `font-semibold text-lg live-time-card ${timeClass}`;
      }

      // Live Panel Update
      let penaltyStr = null;
      let rankStr = null;
      let liveTimePenalty = tick.penalty.timePenalty;

      // Calculate live penalties and rank client-side for immediate feedback
      if (eq) {
        // 2. Obstacle Penalty (from data or knock loop if we had it, but here we trust data for knocks)
        const obsPenalty = tick.penalty.obstaclePenalty;
        const currentTotal = tick.penalty.totalPenalty;
        penaltyStr = currentTotal.toFixed(2);

        // --- Update Main Table Cells & Mobile Cards ---
        const cellTimePen = document.querySelector(`td[data-sn="${sn}"].time-penalty-cell`);
        const cellObsPen = document.querySelector(`td[data-sn="${sn}"].obstacle-penalty-cell`);
        const cellTotalPen = document.querySelector(`td[data-sn="${sn}"].total-penalty-cell`);

        // Mobile cards
        const cardTimePen = document.querySelector(`.live-time-penalty-card[data-sn="${sn}"]`);
        const cardObsPen = document.querySelector(`.live-obstacle-penalty-card[data-sn="${sn}"]`);
        const cardTotalPen = document.querySelector(`.live-total-penalty-card[data-sn="${sn}"]`);

        if (cellTimePen) cellTimePen.textContent = liveTimePenalty.toFixed(2);
        if (cardTimePen) cardTimePen.textContent = liveTimePenalty.toFixed(2);

        if (cellObsPen) cellObsPen.textContent = obsPenalty.toFixed(2);
        if (cardObsPen) cardObsPen.textContent = obsPenalty.toFixed(2);

        if (cellTotalPen) cellTotalPen.textContent = penaltyStr;
        if (cardTotalPen) cardTotalPen.textContent = penaltyStr;
        // ------------------------------------------

        rankStr = tick.rank ? String(tick.rank) : null;
      }

      updateLivePanelTimer(sn, timeLabel, penaltyStr, rankStr);
    }
  });

  if (!anyRunning) stopTicker();
}

function renderLiveStatusPanel() {
  const container = document.getElementById('liveStatusPanelContainer');
  if (!container) return;

  const activeEq = precision_equipages.find(eq => {
    const d = precision_precisionMap.get(String(eq.startNumber));
    return d && (d.running === true || (d.status && d.status.includes('Påg')));
  });

  if (!activeEq) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const sn = String(activeEq.startNumber);
  const currentClass = activeEq._mergedLabel || activeEq.className;
  const visibleInClass = precision_equipages.filter(e => (e._mergedLabel || e.className) === currentClass);
  const overallEntries = getOverallEntries(visibleInClass);
  const { results, map: standingsMap } = buildOverallStanding(overallEntries, precision_precisionMap, precision_precisionConfig);
  const standings = { results, map: standingsMap };
  const myOverall = standingsMap.get(sn);
  const toBeat = getToBeatInfo(sn, standings);
  const data = getCalculatedRowData(sn, new Map(), precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);

  container.classList.remove('hidden');
  container.innerHTML = renderPrecisionLiveStatusPanel({
    equipage: activeEq,
    totalPenalty: data.totalPenalty,
    overallRank: myOverall?.rank,
    toBeat,
    horseLabelHtml: horseLabel(activeEq),
    flagHtml: getFlagHtml(activeEq)
  });
}

function updateLivePanelTimer(sn, label, penaltyDef, rankDef) {
  updatePrecisionLivePanelTimer(sn, label, penaltyDef, rankDef, document);
}

function renderLayout() {
  const comp = getGlobalState('currentCompetition');
  const root = document.getElementById('page-precision-results');
  if (!root) return;

  let precisionDateStr = '';

  const dateCounts = {};
  if (precision_startTimes && precision_startTimes.times) {
    Object.values(precision_startTimes.times).forEach(timeEntry => {
      const precisionTime = timeEntry?.precision;
      if (precisionTime && typeof precisionTime === 'string') {
        const datePart = precisionTime.split('T')[0];
        if (datePart) dateCounts[datePart] = (dateCounts[datePart] || 0) + 1;
      }
    });
  }
  let mostCommonDate = null;
  let maxCount = 0;
  for (const date in dateCounts) {
    if (dateCounts[date] > maxCount) {
      maxCount = dateCounts[date];
      mostCommonDate = date;
    }
  }
  if (mostCommonDate) {
    precisionDateStr = new Date(mostCommonDate).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  root.innerHTML = `
      <div class="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen dark:bg-gray-900 transition-colors duration-500">
        <div class="mb-8">
          ${getCompetitionHeader(comp, t('precision_result_list_title'))}
          ${precisionDateStr ? `<h3 class="text-lg text-gray-500 dark:text-gray-400 mt-1 font-medium text-center">${precisionDateStr}</h3>` : ''}
        </div>

        <div id="liveStatusPanelContainer" class="mb-6 hidden"></div>

        <div class="bg-white dark:bg-gray-800 p-2 md:p-3 rounded-lg md:rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-2 md:mb-4 flex flex-wrap gap-2 md:gap-3 items-center justify-start transition-colors" id="modeToggle">
          
          <div class="relative flex-grow max-w-full sm:max-w-[200px] flex-shrink-0">
               <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
               </div>
               <input type="text" id="inputPrecisionSearch" 
                  class="block w-full pl-8 pr-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded leading-5 bg-gray-50 dark:bg-gray-700 placeholder-gray-500 dark:placeholder-gray-400 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-xs md:text-sm transition-shadow"
                  placeholder="${t('search_placeholder_short')}"
                >
          </div>

          <!-- Desktop Controls -->
          <div class="hidden md:inline-flex shadow-sm rounded-md bg-gray-100 dark:bg-gray-700 p-1 flex-shrink-0" id="precisionToolbarControls">
              <button id="precBtnStartOrder" data-mode="startorder" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('start_order')}</button>
              <button id="precBtnByRank" data-mode="rank" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('place')}</button>
              <button id="precBtnByClass" data-mode="byclass" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('view_by_class_short')}</button>
          </div>
          
          <!-- Mobile Sort Dropdown -->
          <div class="md:hidden relative w-[110px] flex-shrink-0">
               <select id="mobileSortSelectPrec" class="block w-full py-1.5 pl-2 pr-7 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs appearance-none">
                   <option value="byclass">${t('view_by_class_short')}</option>
                   <option value="startorder">${t('start_order')}</option>
                   <option value="rank">${t('place')}</option>
               </select>
               <div class="pointer-events-none absolute right-0 top-0 bottom-0 flex items-center px-1.5 text-gray-500">
                   <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
               </div>
          </div>

          <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1 hidden md:block"></div>

          <button id="precToggleFinalized" class="hidden md:inline-flex px-3 py-1.5 text-xs md:text-sm font-medium rounded border transition-colors">
            <!-- Text updated via JS -->
          </button>

          <!-- Mobile Checkbox -->
          <label class="md:hidden flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer flex-shrink-0">
               <input type="checkbox" id="mobileFinalizedCheckPrec" class="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5" />
               <span id="mobileFinalizedLabelPrec">${t('filter_finished')}</span>
          </label>

          <div id="precClassChips" class="flex-shrink-0 z-10 w-[130px] sm:w-auto"></div>

          <div class="flex-grow hidden sm:block"></div>

          <div class="flex-shrink-0 flex items-center gap-2 justify-end border-t border-gray-100 sm:border-0 pt-2 sm:pt-0 dark:border-gray-700 w-full sm:w-auto">
              <button id="btnExportPrecisionCsv" 
                class="inline-flex items-center px-2 md:px-3 py-1 md:py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-[11px] md:text-sm font-medium rounded text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors">
                 <i class="fas fa-file-csv mr-1.5 text-gray-500 dark:text-gray-400"></i>
                 CSV
              </button>
              <button id="btnExportPrecisionPdf" 
                class="inline-flex items-center px-2 md:px-3 py-1 md:py-1.5 border border-transparent shadow-sm text-[11px] md:text-sm font-medium rounded text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors">
                <svg class="mr-1.5 h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                 Skriv ut PDF
              </button>
          </div>
        </div>

        <div id="precMergeStatus" class="mt-2 text-xs text-gray-600 dark:text-gray-400"></div>
        <div id="precClassChips" class="my-2 flex flex-wrap gap-2"></div>

        <div id="prWrap"></div>
      </div>
    `;

  const host = document.getElementById('prWrap');
  if (host) {
    host.classList.add('x-scroll-wrap');
    window.__setupXbarSync({ barClass: 'fixed-xbar', innerId: 'prXbarInner', hostEl: host });
  }

  const btnPdf = document.getElementById('btnExportPrecisionPdf');
  if (btnPdf) {
    btnPdf.addEventListener('click', async () => {
      try {
        const list = filteredSortedEquipages();
        const freshComp = getGlobalState('currentCompetition') || {};

        await generatePrecisionListPdf(
          list,
          precision_precisionMap,
          precision_precisionConfig,
          precision_startTimes,
          freshComp
        );
      } catch (err) {
        console.error('PDF Export Error:', err);
        alert(t('pdf_export_error') + ' ' + (err.message || err));
      }
    });
  }

  const btnCsv = document.getElementById('btnExportPrecisionCsv');
  if (btnCsv) {
    btnCsv.addEventListener('click', () => {
      const comp = getGlobalState('currentCompetition');
      const date = new Date().toISOString().split('T')[0];
      const filename = `precision_resultat_${sanitizeForFilename(comp?.name || 'tavling')}_${date}.csv`;

      const list = filteredSortedEquipages();
      const placeMap = buildPlaceMap(list, precision_precisionMap, precision_precisionConfig);

      const headers = [
        t('rank'), t('startno'), t('driver'), t('horse'), t('class'), t('club'),
        t('start_time'), `${t('obstacle_width')} (cm)`, t('time'), t('knockdowns'),
        t('obs_penalty'), t('time_penalty'), t('other_penalty_short'),
        t('total'), t('status')
      ];

      const rows = list.map(eq => {
        const sn = String(eq.startNumber);
        const data = getCalculatedRowData(sn, placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);

        const baseAllowance = getDisplayPortAllowance(data.eq.className);
        const eliminated = data.d?.eliminated || data.totalPenalty === Infinity;
        const allowanceDisplay = isNum(baseAllowance) ? baseAllowance : '—';

        return [
          isNum(data.place) ? data.place : '—',
          sn,
          eq.driverName || '—',
          horseLabel(eq),
          eq._mergedLabel || eq.className || '—',
          eq.clubName || '—',
          data.startT || '—',
          allowanceDisplay,
          data.display.timeLabel,           // Tid
          data.display.knocksSimple,        // Rivningar
          formatPrecisionCsvPenalty(data.obstaclePenalty, { zeroWhenEmpty: true }),
          formatPrecisionCsvPenalty(data.timePenalty, { zeroWhenEmpty: true }),
          formatPrecisionCsvPenalty(data.extraPenalty, { zeroWhenEmpty: true }),
          formatPrecisionCsvPenalty(data.totalPenalty, { eliminated }),
          data.status || '—'
        ];
      });

      downloadCsv(filename, headers, rows);
    });
  }
}

function updateControlStates() {
  const btnStart = document.getElementById('precBtnStartOrder');
  const btnRank = document.getElementById('precBtnByRank');
  const btnClass = document.getElementById('precBtnByClass');

  const mode = precision_viewMode;

  const setBtn = (btn, active) => {
    if (btn) btn.className = `px-4 py-1.5 text-sm font-medium rounded transition-all ${active ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;
  };

  setBtn(btnStart, mode === 'startorder');
  setBtn(btnRank, mode === 'rank');
  setBtn(btnClass, mode === 'byclass');

  const btnFin = document.getElementById('precToggleFinalized');
  const isFin = precision_showOnlyFinalized;
  if (btnFin) {
    btnFin.className = `px-3 py-1.5 text-sm font-medium rounded border transition-colors ${isFin ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`;
    btnFin.textContent = isFin ? t('show_all') : t('show_finalized_only');
  }

  const mobSort = document.getElementById('mobileSortSelectPrec');
  if (mobSort && mobSort.value !== mode) {
      mobSort.value = mode;
  }
  const mobFin = document.getElementById('mobileFinalizedCheckPrec');
  if (mobFin && mobFin.checked !== isFin) {
      mobFin.checked = isFin;
  }
}

// showDetailsModal-anropen använder nu den importerade funktionen och skickar data
function openDetails(sn) {
  showDetailsModal(
    sn,
    precision_equipages,
    precision_precisionMap,
    precision_precisionConfig,
    precision_startTimes
  );
}

function filteredSortedEquipages() {
  let list = filterPrecisionEquipages(precision_equipages, {
    searchText: precision_searchText,
    showOnlyFinalized: precision_showOnlyFinalized,
    activeClassFilters: precision_activeClassFilters,
    precisionMap: precision_precisionMap
  });
  const placeMap = buildPlaceMap(list, precision_precisionMap, precision_precisionConfig);
  list = sortPrecisionEquipages(list, {
    sort: precision_sort,
    viewMode: precision_viewMode,
    getRowData: (eq) => getCalculatedRowData(String(eq.startNumber), placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes),
    getOverallValue: (eq) => {
      const currentClass = eq._mergedLabel || eq.className;
      const visibleInClass = precision_equipages.filter((candidate) => (candidate._mergedLabel || candidate.className) === currentClass);
      const overallEntries = getOverallEntries(visibleInClass);
      const { map: standingsMap } = buildOverallStanding(overallEntries, precision_precisionMap, precision_precisionConfig);
      return standingsMap.get(String(eq.startNumber))?.total ?? Infinity;
    },
    getStartTime: (eq) => startTimeFor(eq.startNumber, precision_startTimes) || 'ZZZZ'
  });
  return list;
}

function renderMobile() {
  const container = document.getElementById('prWrap');
  if (!container) return;

  const visibleEquipages = filteredSortedEquipages();
  const placeMap = buildPlaceMap(visibleEquipages, precision_precisionMap);

  // 1. Calculate starters per class for dynamic placement counts
  const classStarters = new Map();
  visibleEquipages.forEach(eq => {
    const cls = eq._mergedLabel || eq.className || 'Ok\u00e4nd Klass';
    classStarters.set(cls, (classStarters.get(cls) || 0) + 1);
  });

  let html = '';
  if (visibleEquipages.length === 0) {
    html = `<div class="p-6 text-center text-gray-500">${t('search_no_match')}</div>`;
  } else {
    if (precision_viewMode === 'byclass') {
      const groups = prec_groupEquipagesForDisplay(visibleEquipages);
      for (const group of groups) {
        html += `<div class="px-2 py-1.5 mt-2 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-bold text-sm rounded-md shadow-sm">${group.label}</div>`;
        html += group.items.map(eq => renderCard(eq, placeMap, classStarters)).join('');
      }
    } else {
      html += visibleEquipages.map(eq => renderCard(eq, placeMap, classStarters)).join('');
    }
  }

  container.innerHTML = `<div class="bg-gray-50 dark:bg-gray-900 py-1 space-y-0">${html}</div>`;

  visibleEquipages.forEach(eq => {
    const sn = String(eq.startNumber);
    patchPrecisionFinalizeBadge(sn, isPrecisionFinalized(sn));
  });

  container.querySelectorAll('[data-sn]').forEach(card => {
    const sn = card.getAttribute('data-sn');
    card.addEventListener('click', () => openDetails(sn));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openDetails(sn);
    });
  });

  const xbar = document.querySelector('.fixed-xbar');
  if (xbar) xbar.style.display = 'none';
}

function renderCard(eq, placeMap, classStarters = new Map()) {
  const sn = String(eq.startNumber);
  const data = getCalculatedRowData(sn, placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);

  return renderPrecisionResultCard({
    data,
    viewMode: precision_viewMode,
    classStarters,
    flagHtml: getFlagHtml(data.eq),
    clubLogoHtml: getClubLogoHtml(data.eq),
    finalizeButtonsHtml: renderFinalizeButtons(eq),
    formatPenalty: fmt2
  });
}

function renderFinalizeButtons(eq) {
  const sn = String(eq.startNumber);
  const can = window.canFinalize && window.canFinalize();
  const finalized = isPrecisionFinalized(sn);
  return renderPrecisionFinalizeButtons({
    startNumber: sn,
    finalized,
    canFinalize: can,
    labels: {
      finalizedBadge: t('finalized_badge'),
      finalize: t('finalize'),
      undo: t('undo')
    }
  });
}

function renderDesktop() {
  if (!precision_equipages?.length) return;
  const container = document.getElementById('prWrap');
  if (!container) return;
  container.innerHTML = '';

  // Render Live Panel first (it mounts into its own container, but we trigger it here to ensure data freshness)
  renderLiveStatusPanel();

  (() => {
    const statusHost = document.getElementById('precMergeStatus');
    const chipHost = document.getElementById('precClassChips');
    if (statusHost) {
      const groups = precision_MERGE_GROUPS || [];
      const activeCount = groups.filter(g => Array.isArray(g.members) && g.members.length > 1).length;
      statusHost.textContent = activeCount ? `${t('active_merges')}: ${activeCount}` : '';
      statusHost.style.display = activeCount ? 'block' : 'none';
    }

    if (chipHost) {
      const gArr = prec_groupEquipagesForDisplay(precision_equipages);
      const labels = gArr.map(g => g.label);

      renderResponsiveClassFilter(chipHost, labels, precision_activeClassFilters, (lbl) => {
        if (precision_activeClassFilters.has(lbl)) precision_activeClassFilters.delete(lbl);
        else precision_activeClassFilters.add(lbl);
        try { if (typeof render === 'function') render(); } catch { }
      });
    }
  })();

  const visible = filteredSortedEquipages();
  const placeMap = buildPlaceMap(visible, precision_precisionMap);

  // Beräkna totalställning EN GÅNG per render
  const overallEntries = getOverallEntries(visible);
  const { map: standingsMap } = buildOverallStanding(overallEntries, precision_precisionMap, precision_precisionConfig);
  const standings = standingsMap;

  const headHTML = renderPrecisionTableHead({
    rank: t('rank'),
    driver: t('driver'),
    className: t('class'),
    countryClub: t('country_club'),
    startTime: t('start_time'),
    obstacleWidth: t('obstacle_width'),
    time: t('time'),
    knockdowns: t('knockdowns'),
    obsPenalty: t('obs_penalty'),
    timePenalty: t('time_penalty'),
    otherPenaltyShort: t('other_penalty_short'),
    total: t('total'),
    overallStanding: 'Total ställning',
    status: t('status'),
    finalColumn: t('final_column')
  });

  const renderRow = (eq, index) => {
    const sn = String(eq.startNumber);
    const data = getCalculatedRowData(sn, placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);
    const baseAllowance = getDisplayPortAllowance(data.eq.className);
    const allowanceDisplay = isNum(baseAllowance) ? `+ ${baseAllowance} cm` : '—';
    const isStruken = data.eq.status === 'struken';
    const badgeClass = isStruken ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' : statusClass(data.status);

    return renderPrecisionResultDesktopRow({
      data,
      index,
      allowanceDisplay,
      startTime: startTimeFor(sn, precision_startTimes),
      horseLabelHtml: horseLabelStacked(data.eq),
      flagHtml: getFlagHtml(data.eq),
      clubLogoHtml: getClubLogoHtml(data.eq),
      overallResult: standings.get(sn),
      statusBadgeClass: badgeClass,
      finalizeButtonsHtml: renderFinalizeButtons(eq),
      formatPenalty: fmt2
    });
  };

  let bodyHTML = '';
  if (precision_viewMode === 'startorder') {
    bodyHTML = visible.map((eq, index) => renderRow(eq, index)).join('');
  } else {
    const groups = prec_groupEquipagesForDisplay(visible);
    for (const group of groups) {
      bodyHTML += renderPrecisionGroupHeader(group.label);
      bodyHTML += group.items.map((eq, i) => renderRow(eq, i)).join('');
    }
  }

  container.innerHTML = renderPrecisionTable({ headHtml: headHTML, bodyHtml: bodyHTML });

  const xbar = document.querySelector('.fixed-xbar');
  if (xbar) xbar.style.display = 'block';

  (function () {
    const host = document.getElementById('prWrap');
    if (host && window.__setupXbarSync) {
      host.classList.add('x-scroll-wrap');
      window.__setupXbarSync({ barClass: 'fixed-xbar', innerId: 'prXbarInner', hostEl: host });
    }
  })();

  const body = document.getElementById('precisionBody');
  if (body) {
    body.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-sn]');
      if (!tr) return;
      if (e.target.closest('button, a')) return;
      e.preventDefault();
      e.stopPropagation();
      openDetails(tr.getAttribute('data-sn'));
    });
  }
}

function updateSortIcons() {
  document.querySelectorAll('th[data-col] .sort-icon').forEach(iconContainer => {
    const th = iconContainer.closest('th[data-col]');
    if (!th) return;
    const col = th.getAttribute('data-col');
    const active = (col === precision_sort.col);
    const dir = precision_sort.dir;
    iconContainer.innerHTML = `
            <svg class="w-3 h-3 inline-block ${active && dir === 'asc' ? 'text-gray-900' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 20 20"><path d="M10 3a1 1 0 01.707.293l5 5a1 1 0 01-1.414 1.414L11 6.414V16a1 1 0 11-2 0V6.414l-3.293 3.293a1 1 0 01-1.414-1.414l5-5A1 1 0 0110 3z"/></svg>
            <svg class="w-3 h-3 inline-block ${active && dir === 'desc' ? 'text-gray-900' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 20 20"><path d="M10 17a1 1 0 01-.707-.293l-5-5a1 1 0 011.414-1.414L9 13.586V4a1 1 0 112 0v9.586l3.293-3.293a1 1 0 011.414 1.414l-5 5A1 1 0 0110 17z"/></svg>
        `;
  });
}

function listenLive() {
  if (precision_liveUnsubscribe) {
    try { precision_liveUnsubscribe(); } catch { }
    precision_liveUnsubscribe = null;
  }
  if (!competitionId) return;

  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
  const q = query(colRef);

  precision_liveUnsubscribe = onSnapshot(q, (snap) => {
    const { needsFullRender, anyRunning } = applyPrecisionLiveDocChanges(snap.docChanges(), precision_precisionMap);

    if (needsFullRender) renderLiveDebounce();
    if (anyRunning) ensureTicker(); else stopTicker();

  }, (error) => {
    console.error("[listenLive] Fel vid lyssning på Firestore:", error);
    stopTicker();
  });
}

let overallUnsubs = [];
function listenOverallData(compId) {
  if (!compId || !appId) return;
  unsubscribeAll(overallUnsubs);
  overallUnsubs = [];

  // 1) Dressyr - Lyssna på alla protokoll för ekipagen
  const unsubD = listenForDressageProtocolsCollectionGroup(compId, precision_equipages, (docs) => {
    precision_dressageMap = groupDressageProtocolsByStartNumber(docs);
    renderLiveDebounce();
  });

  // 2) Maraton - Lyssna på live-dokument (hinder)
  const unsubM = listenForMaratonCollection(compId, (docs) => {
    precision_marathonObstacleMap.clear();
    docs.forEach(d => precision_marathonObstacleMap.set(String(d.id), d));
    renderLiveDebounce();
  });

  // 3) Maraton - Lyssna på tider
  const unsubMT = listenForMarathonTimingUpdates(compId, (docs) => {
    precision_marathonTimingMap = normalizeMarathonTimingDocs(docs);
    renderLiveDebounce();
  });

  overallUnsubs.push(unsubD, unsubM, unsubMT);
}

let mergeUnsubs = [];
function listenMergeConfig(compId) {
  if (Array.isArray(mergeUnsubs)) unsubscribeAll(mergeUnsubs);
  mergeUnsubs = [];
  if (!compId || !appId) return;
  const keys = ['display', 'tdbMergeGroups', 'classMergeMap', 'tdbMergeMap'];
  keys.forEach(key => {
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'config', key);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.exists() ? (snap.data()?.value ?? snap.data()) : null;
      prec_buildMergeMap(snap.id === 'display' ? { mergeByClassNumber: data?.mergeByClassNumber || {} } : data);
      precision_equipages = precision_equipages.map(e => ({
        ...e,
        _mergedKey: prec_resolveMergeGrouping(e).key,
        _mergedLabel: prec_resolveMergeGrouping(e).label
      }));
      render();
    });
    mergeUnsubs.push(unsub);
  });
}

function wireEventListeners() {
  document.getElementById('inputPrecisionSearch')?.addEventListener('input', (e) => {
    precision_searchText = (e.target.value || '').trim();
    render();
  });

  const mobSort = document.getElementById('mobileSortSelectPrec');
  if (mobSort) {
      mobSort.onchange = (e) => {
          precision_viewMode = e.target.value;
          if (precision_viewMode === 'startorder') { precision_sort.col = 'startNumber'; precision_sort.dir = 'asc'; }
          else if (precision_viewMode === 'rank') { precision_sort.col = 'place'; precision_sort.dir = 'asc'; }
          else if (precision_viewMode === 'byclass') { precision_sort.col = 'place'; precision_sort.dir = 'asc'; }
          render();
          updateControlStates();
      }
  }

  const mobFin = document.getElementById('mobileFinalizedCheckPrec');
  if (mobFin) {
      mobFin.onchange = (e) => {
          precision_showOnlyFinalized = e.target.checked;
          render();
          updateControlStates();
      }
  }

  document.getElementById('precisionToolbarControls')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.mode) {
      precision_viewMode = btn.dataset.mode;
      if (precision_viewMode === 'startorder') { precision_sort.col = 'startNumber'; precision_sort.dir = 'asc'; }
      else if (precision_viewMode === 'rank') { precision_sort.col = 'place'; precision_sort.dir = 'asc'; }
      else if (precision_viewMode === 'byclass') { precision_sort.col = 'place'; precision_sort.dir = 'asc'; }
      render();
      updateControlStates();
    }

    if (btn.id === 'precToggleFinalized') {
      precision_showOnlyFinalized = !precision_showOnlyFinalized;
      render();
      updateControlStates();
    }
  });

  const tableWrapper = document.getElementById('prWrap');
  tableWrapper?.addEventListener('click', (e) => {
    // 1. Check for sort header clicks
    const th = e.target.closest('th[data-col]');
    if (th) {
      const col = th.getAttribute('data-col');
      if (precision_sort.col === col) precision_sort.dir = (precision_sort.dir === 'asc') ? 'desc' : 'asc';
      else { precision_sort.col = col; precision_sort.dir = 'asc'; }
      render();
      updateSortIcons();
      return;
    }

    // 2. Check for button actions (finalize/unfinalize)
    const btn = e.target.closest('button[data-prec-action]');
    if (btn) {
      e.stopPropagation(); // Prevent card click
      const action = btn.dataset.precAction;
      const sn = btn.dataset.sn;
      if (action === 'finalize') {
        window.__finalizePrecision(competitionId, sn);
      } else if (action === 'unfinalize') {
        window.__unfinalizePrecision(competitionId, sn);
      }
      return;
    }
  });

  updateControlStates();
}

function initializePrecisionScrollHelpers() {
  initializeScrollSync(window.location.pathname);
}

export async function load() {
  initializePrecisionScrollHelpers();
  injectScrollStyles();
  injectPrecisionResultsBaseStyles();
  document.getElementById('marathonPageStyle')?.remove();
  closeDetailsModal();

  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id;
  const root = document.getElementById('page-precision-results');
  if (!competitionId) {
    if (root) root.innerHTML = '<p class="p-8 text-center text-gray-600">Ingen tävling vald.</p>';
    return;
  }

  const equipagesData = await getEquipages(competitionId);

  const [
    resultsData,
    dressageData,
    marathonObstacleData,
    marathonTimingData,
    configData,
    startTimesData,
    displayCfg,
    mergeCfgA,
    mergeCfgB,
    mergeCfgC
  ] = await Promise.all([
    getPrecisionResults(competitionId).catch(() => []),
    getAllDressageProtocols(competitionId, equipagesData || []).catch(() => new Map()),
    getMarathonStateDocuments(competitionId).catch(() => new Map()),
    getMarathonTimingData(competitionId).catch(() => new Map()),
    getConfig(competitionId, 'precisionConfig').catch(() => ({})),
    getConfig(competitionId, 'startTimes').catch(() => ({})),
    getConfig(competitionId, 'display').catch(() => ({})),
    getConfig(competitionId, 'tdbMergeGroups').catch(() => null),
    getConfig(competitionId, 'classMergeMap').catch(() => null),
    getConfig(competitionId, 'tdbMergeMap').catch(() => null)
  ]);

  precision_equipages = equipagesData || [];
  precision_precisionConfig = configData || {};
  precision_startTimes = startTimesData || {};
  precision_displayConfig = displayCfg || {};

  // Populate initial result maps
  (resultsData || []).forEach(r => precision_precisionMap.set(String(r.startNumber), r));
  if (dressageData instanceof Map) {
    dressageData.forEach((protocols, sn) => {
      precision_dressageMap.set(String(sn), Array.isArray(protocols) ? protocols : []);
    });
  }
  if (marathonObstacleData instanceof Map) {
    marathonObstacleData.forEach((data, sn) => {
      precision_marathonObstacleMap.set(String(sn), data || {});
    });
  }
  if (marathonTimingData instanceof Map) {
    marathonTimingData.forEach((data, sn) => {
      precision_marathonTimingMap.set(String(sn), data || {});
    });
  }

  prec_buildMergeMap(mergeCfgA || mergeCfgB || mergeCfgC || displayCfg);
  precision_equipages = precision_equipages.map(e => ({
    ...e,
    _mergedKey: prec_resolveMergeGrouping(e).key,
    _mergedLabel: prec_resolveMergeGrouping(e).label
  }));

  try { await ensureClubLogosLoaded(competitionId); } catch (e) { console.warn('Logo load failed:', e); }

  document.body.dataset.wasMobile = isMobile() ? '1' : '0';
  if (window.__precisionResizeHandler) try { window.removeEventListener('resize', window.__precisionResizeHandler); } catch { }
  window.__precisionResizeHandler = () => {
    const nowMobile = isMobile() ? '1' : '0';
    if (document.body.dataset.wasMobile !== nowMobile) {
      document.body.dataset.wasMobile = nowMobile;
      render();
    }
  };
  window.addEventListener('resize', window.__precisionResizeHandler, { passive: true });

  renderLayout();
  wireEventListeners();
  listenLive();
  listenMergeConfig(competitionId);
  listenOverallData(competitionId);

  precision_sort = { col: 'startNumber', dir: 'asc' };
  render();
  updateSortIcons();
}

// Globala funktioner för finalisera (anropas via onclick i HTML)
window.__finalizePrecision = async (compId, sn) => {
  if (!compId || !sn) return;
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${compId}/precision/${sn}`);
  try {
    const d = precision_precisionMap.get(String(sn)) || {};
    await setDoc(ref, buildPrecisionFinalizePayload(d), { merge: true });

    precision_finalizeCache.set(String(sn), true);
    patchPrecisionFinalizeBadge(String(sn), true);

    render();
  } catch (err) {
    console.error("Kunde inte finalisera:", err);
    alert("Fel vid sparning: " + err.message);
  }
};

window.__unfinalizePrecision = async (compId, sn) => {
  if (!compId || !sn) return;
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${compId}/precision/${sn}`);
  try {
    await setDoc(ref, buildPrecisionUnfinalizePayload(), { merge: true });
    precision_finalizeCache.set(String(sn), false);
    patchPrecisionFinalizeBadge(String(sn), false);
    render();
  } catch (err) {
    console.error("Kunde inte ångra finalisering:", err);
    alert("Fel vid sparning: " + err.message);
  }
};

// Exportera för testning om det behövs
export const _testFinalize = window.__finalizePrecision;

export function __unload() {
  if (precision_liveUnsubscribe) { precision_liveUnsubscribe(); precision_liveUnsubscribe = null; }
  if (Array.isArray(mergeUnsubs)) { unsubscribeAll(mergeUnsubs); mergeUnsubs = []; }
  if (Array.isArray(overallUnsubs)) { unsubscribeAll(overallUnsubs); overallUnsubs = []; }
  if (typeof window.__activeScrollCleanup === 'function') { window.__activeScrollCleanup(); window.__activeScrollCleanup = null; }
  if (window.__precisionResizeHandler) { try { window.removeEventListener('resize', window.__precisionResizeHandler); } catch { } window.__precisionResizeHandler = null; }
  if (window.__precisionKeydownHandler) { try { document.removeEventListener('keydown', window.__precisionKeydownHandler); } catch { } window.__precisionKeydownHandler = null; }
  try { window.__teardownXbarSync?.(); } catch { }
  document.body.classList.remove('has-fixed-xbar');
  try { document.querySelector('.pr-xbar')?.remove(); } catch { }

  stopTicker();
  precisionTickerInterval = null;
  precision_equipages = [];
  precision_precisionMap.clear();
  precision_precisionConfig = {};
  precision_startTimes = {};
  precision_sort = { col: 'startNumber', dir: 'asc' };
  precision_searchText = "";
  precision_showOnlyFinalized = false;
  precision_viewMode = 'startorder';

  try { document.getElementById('precisionDetailsModal')?.remove(); } catch { }
  try { document.getElementById('precisionModalBaseStyle')?.remove(); } catch { }
  try { document.getElementById('precisionResultsBaseStyles')?.remove(); } catch { }
  try { document.getElementById('prWrap')?.replaceChildren(); } catch { }
  try { window.__teardownXbarSync?.(); } catch { }
  window.__teardownXbarSync = undefined;
  window.__setupXbarSync = undefined;

}

if (!window.openPrecisionModalGlobal) {
  window.openPrecisionModalGlobal = async ({ compId, startNumber }) => {
    try {
      openDetails(startNumber);
    } catch (e) {
      console.error('[PrecisionResults] openPrecisionModalGlobal failed:', e);
    }
  };
}

window.addEventListener('beforeunload', () => {
  try { delete window.openPrecisionModalGlobal; } catch (_) { window.openPrecisionModalGlobal = undefined; }
});

(function exposePrecisionModalBridge() {
  // Här behöver vi inte göra något mer eftersom openDetails/showDetailsModal nu importeras och används korrekt
})();
