import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { listenForPrecisionResults, getPrecisionResults } from '../../services/precisionService.js';
import { listenForDressageProtocolsCollectionGroup, getAllDressageProtocols } from '../../services/dressageService.js';
import { listenForMaratonCollection, listenForMarathonTimingUpdates, getMarathonTimingData, getMarathonStateDocuments } from '../../services/marathonService.js';
import { listenForTeams } from '../../services/teamService.js';

import { getGlobalState } from '../../main.js';

import {
  calculateDressageResult,
  calculateMarathonResult
} from '../../services/calculationService.js';
import { collection, onSnapshot, query, getDocs, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { getCompetitionHeader, renderResponsiveClassFilter } from '../../ui/components.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
// import { calculatePrecisionResult } from '../../utils/precisionUtils.js'; // REPLACED by calculationService
import { calculatePrecisionResult } from '../../services/calculationService.js';
import { t } from '../../utils/i18n.js';

import { initializeScrollSync, injectScrollStyles } from '../../ui/scrollHelper.js';
import {
  getCalculatedRowData,
  buildPlaceMap,
  computeMaxSecondsForClass,
  startTimeFor,
  getPortAllowanceCm,
  trackWidthFromEq,
  statusClass,
  buildOverallStanding,
  getToBeatInfo
} from '../../utils/precisionUtils.js';

// IMPORTERA NYA MODALEN
import { showDetailsModal, closeDetailsModal } from '../../ui/precisionModal.js';
import { generateAndPrintPdf, generatePrecisionListPdf } from '../../pdf/precisionPdf.js';

import {
  escapeHtml,
  isMobile,
  debounce,
  round2,
  msToLabel,
  horseLabel,
  horseLabelStacked,
  isNum,
  fmt2,
  downloadCsv,
  sanitizeForFilename
} from '../../utils/sharedUtils.js';

let localTickers = {};

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

function prec_resolveMergeGrouping(e, mergeCfg) {
  if (e?.useMergedTestForDisplay && e?.mergedTestKey && e?.mergedTestLabel) {
    return { key: String(e.mergedTestKey), label: String(e.mergedTestLabel) };
  }
  const num = Number(e?.tdbClassNumber);
  const hit = Number.isFinite(num) ? precision_MERGE_MAP.get(num) : null;
  if (hit) return hit;
  const cls = e?.className || '—';
  return { key: `CLASS:${cls}`, label: cls };
}

function prec_groupEquipagesForDisplay(equipages = [], mergeCfg) {
  const map = new Map();
  for (const e of (equipages || [])) {
    const g = prec_resolveMergeGrouping(e, mergeCfg);
    if (!map.has(g.key)) map.set(g.key, { key: g.key, label: g.label, items: [] });
    map.get(g.key).items.push(e);
  }
  return Array.from(map.values())
    .sort((a, b) => a.label.localeCompare(b.label, 'sv', { numeric: true, sensitivity: 'base' }));
}

function prec_buildMergeMap(raw) {
  precision_MERGE_GROUPS = [];
  precision_MERGE_MAP.clear();
  if (!raw) return;

  const maybeDisplay = raw && typeof raw === 'object' && raw.mergeByClassNumber ? raw : null;
  const source = maybeDisplay ? maybeDisplay.mergeByClassNumber : raw;

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [grpKey, info] of Object.entries(source)) {
      const members = (info?.members || []).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      if (!members.length) continue;
      const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
      const key = String(grpKey || `TDBGROUP:${members.join('+')}`);
      precision_MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => precision_MERGE_MAP.set(num, { key, label }));
    }
    return;
  }
  if (Array.isArray(source)) {
    const groups = source
      .map(arr => (Array.isArray(arr) ? arr.map(Number).filter(n => Number.isFinite(n)) : []))
      .filter(arr => arr.length > 0)
      .map(arr => arr.sort((a, b) => a - b));
    groups.forEach(members => {
      const key = `TDBGROUP:${members.join('+')}`;
      const label = `Sammanslagen: TDB #${members.join('/')}`;
      precision_MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => precision_MERGE_MAP.set(num, { key, label }));
    });
    return;
  }
  if (source && typeof source === 'object') {
    const buckets = new Map();
    for (const [k, v] of Object.entries(source)) {
      const num = Number(String(k).replace(/^num:/i, ''));
      if (!Number.isFinite(num)) continue;
      const gk = String(v || '').trim() || `TDBGROUP:${num}`;
      if (!buckets.has(gk)) buckets.set(gk, new Set());
      buckets.get(gk).add(num);
    }
    for (const [gk, set] of buckets) {
      const members = [...set].sort((a, b) => a - b);
      const key = String(gk);
      const label = `Sammanslagen: TDB #${members.join('/')}`;
      precision_MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => precision_MERGE_MAP.set(num, { key, label }));
    }
  }
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
  const d = precision_precisionMap.get(String(sn));
  if (d && typeof d.finalized === 'boolean') return d.finalized;
  if (precision_finalizeCache.has(String(sn))) return precision_finalizeCache.get(String(sn));
  return false;
}

function patchPrecisionFinalizeBadge(sn, finalized) {
  const root = document;
  const $final = root.querySelector(`#prec-final-badge-${sn}`);
  const $btnFin = root.querySelector(`[data-prec-action="finalize"][data-sn="${sn}"]`);
  const $btnUn = root.querySelector(`[data-prec-action="unfinalize"][data-sn="${sn}"]`);

  if ($final) $final.style.display = finalized ? 'inline-flex' : 'none';
  if ($btnFin) $btnFin.style.display = finalized ? 'none' : '';
  if ($btnUn) $btnUn.style.display = finalized ? '' : 'none';
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
      const labelAt = data._receivedLocalAt || Date.now();
      const elapsedMs = (data.livePausedMs || 0) + (labelAt - data.liveStartEpoch) + (Date.now() - labelAt);

      const desktopCell = document.querySelector(`td[data-sn="${sn}"].time-cell span`);
      const mobileTimer = document.querySelector(`div[data-sn="${sn}"] .live-time-card`);

      const timeLabel = msToLabel(elapsedMs);
      const eq = precision_equipages.find(e => String(e.startNumber) === sn);
      const maxSec = eq ? computeMaxSecondsForClass(eq.className, precision_precisionConfig) : null;
      const overTime = isNum(maxSec) && elapsedMs > (maxSec * 1000);
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
      let liveTimePenalty = 0;

      // Calculate live penalties and rank client-side for immediate feedback
      if (eq) {
        // 1. Time Penalty
        // const maxSec = ... already calculated above
        if (isNum(maxSec) && elapsedMs > maxSec * 1000) {
          const rate = (precision_precisionConfig.timePenaltyRate != null) ? Number(precision_precisionConfig.timePenaltyRate) : 0.5;
          liveTimePenalty = ((elapsedMs / 1000) - maxSec) * rate;
        }

        // 2. Obstacle Penalty (from data or knock loop if we had it, but here we trust data for knocks)
        const obsPenalty = isNum(data.liveObstaclePenalty) ? data.liveObstaclePenalty : (data.obstaclePenalty || 0);
        const extraPenalty = isNum(data.extraPenalty) ? data.extraPenalty : 0;

        const currentTotal = liveTimePenalty + obsPenalty + extraPenalty;
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

        // 3. Live Rank (within CLASS or MERGED GROUP)
        let allResults = [];

        // Helper: get group identifier (merged group key OR className)
        const getGroupKey = (e) => {
          const esn = String(e.startNumber);
          // precision_MERGE_MAP is a global defined in precision-resultat.js
          if (typeof precision_MERGE_MAP !== 'undefined' && precision_MERGE_MAP.has(esn)) {
            return precision_MERGE_MAP.get(esn).key;
          }
          return e.className;
        };
        const myGroupKey = getGroupKey(eq);

        precision_equipages.forEach(e => {
          const s = String(e.startNumber);
          if (s === sn) return; // skip self

          // Filter: Must be in same competition group
          if (getGroupKey(e) !== myGroupKey) return;

          const dd = precision_precisionMap.get(s);
          if (!dd) return;

          // Must have a total penalty to be ranked (finalized or valid live)
          let p = null;
          if (dd.finalized && isNum(dd.totalPenalty)) p = dd.totalPenalty;
          else if (isNum(dd.liveTotalPenalty)) p = dd.liveTotalPenalty; // if we trust other live results

          // Or use getCalculatedRowData for robust comparison if needed, 
          // but let's stick to simple totalPenalty for speed
          if (isNum(p)) allResults.push(p);
        });

        // Add self
        allResults.push(currentTotal);
        // Sort ASC
        allResults.sort((a, b) => a - b);
        // Find self index
        const rank = allResults.indexOf(currentTotal) + 1;
        rankStr = String(rank);
      }

      updateLivePanelTimer(sn, timeLabel, penaltyStr, rankStr);
    }
  });

  if (!anyRunning) stopTicker();
}

function renderLiveStatusPanel() {
  const container = document.getElementById('liveStatusPanelContainer');
  if (!container) return;

  // Hitta aktiv förare
  const activeEq = precision_equipages.find(eq => {
    const d = precision_precisionMap.get(String(eq.startNumber));
    // Check both status string and running flag
    return d && (d.running === true || (d.status && d.status.includes('Påg')));
  });

  if (!activeEq) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const sn = String(activeEq.startNumber);

  // Totallista för klassen (för att räkna ut "To Beat" och overall rank)
  const currentClass = activeEq._mergedLabel || activeEq.className;
  const visibleInClass = precision_equipages.filter(e => (e._mergedLabel || e.className) === currentClass);
  const overallEntries = getOverallEntries(visibleInClass);
  const { results, map: standingsMap } = buildOverallStanding(overallEntries, precision_precisionMap, precision_precisionConfig);
  const standings = { results, map: standingsMap };
  const myOverall = standingsMap.get(sn);
  const toBeat = getToBeatInfo(sn, standings);

  // Använd central beräkning för att få formaterad knocksText m.m.
  const data = getCalculatedRowData(sn, new Map(), precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);

  const totalPenalty = data.totalPenalty === Infinity ? 'ELIM' : (data.totalPenalty || 0).toFixed(2);

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="bg-slate-900 rounded-lg md:rounded-xl p-3 md:p-6 shadow-xl border border-slate-700 relative overflow-hidden text-white">
      <!-- Background Accents -->
      <div class="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full mix-blend-overlay filter blur-3xl opacity-10 -translate-y-1/2 translate-x-1/2"></div>
      
      <!-- DESKTOP LAYOUT (md and up) -->
      <div class="relative z-10 hidden md:flex flex-row items-center justify-between gap-6">
        <!-- Left: Driver Info -->
        <div class="flex items-center gap-4 md:gap-6 flex-1 min-w-0">
           <div class="flex flex-col items-center justify-center bg-white/10 w-16 h-16 rounded-lg backdrop-blur-sm border border-white/10 shrink-0">
              <span class="text-xs text-gray-400 uppercase font-bold tracking-wider">Start</span>
              <span class="text-3xl font-bold font-mono leading-none">${activeEq.startNumber}</span>
           </div>
           
           <div class="min-w-0">
             <div class="flex items-center gap-2 mb-1">
               <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/30">
                 <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                 På banan
               </span>
               <span class="text-slate-400 text-sm truncate">${activeEq.className}</span>
             </div>
             <h2 class="text-2xl md:text-3xl font-bold truncate leading-tight">${activeEq.driverName}</h2>
             <p class="text-slate-400 text-sm md:text-base truncate">${horseLabel(activeEq)}</p>
             <div class="flex items-center gap-2 mt-2 text-xs text-slate-500">
               ${getFlagHtml(activeEq)} ${activeEq.clubName}
             </div>
           </div>
        </div>

        <!-- Right: Stats & Timer -->
        <div class="flex items-center gap-4 md:gap-8 shrink-0">
           <div class="text-center px-4 border-r border-white/10 hidden lg:block">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Totalplac.</div>
             <div class="text-3xl font-bold text-emerald-400 tabular-nums">${myOverall?.rank || '-'}</div>
             ${toBeat ? `<div class="text-[10px] text-emerald-500 font-bold mt-1">För ${toBeat.targetP < 0 ? 'vinst' : 'nästa'}: < ${toBeat.targetP.toFixed(1)}</div>` : ''}
           </div>

           <div class="text-center px-4 border-r border-white/10 hidden md:block">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Delplac.</div>
             <div class="text-3xl font-bold text-yellow-400 tabular-nums" id="livePanelRank-${sn}">-</div>
           </div>

           <div class="text-center px-4 border-r border-white/10">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Straff</div>
             <div class="text-3xl font-bold text-blue-300 tabular-nums" id="livePanelPenalty-${sn}">${totalPenalty}</div>
           </div>

           <div class="text-center min-w-[140px]">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Tid</div>
             <div class="text-5xl md:text-6xl font-black tabular-nums leading-none tracking-tight" id="livePanelTimer-${sn}">
               00:00,00
             </div>
           </div>
        </div>
      </div>

      <!-- MOBILE LAYOUT (tighter) -->
      <div class="relative z-10 flex md:hidden flex-col gap-3">
        <div class="flex items-center justify-between">
           <div class="flex items-center gap-3 min-w-0">
             <div class="bg-white/10 px-2 py-1 rounded border border-white/10 font-bold font-mono text-xl">#${activeEq.startNumber}</div>
             <div class="min-w-0">
               <h2 class="text-lg font-bold truncate leading-tight">${activeEq.driverName}</h2>
               <div class="flex items-center gap-2">
                 <span class="inline-flex items-center gap-1 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold uppercase tracking-wider border border-emerald-500/30 px-1">
                   <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                   Live
                 </span>
                 <span class="text-slate-400 text-[10px] truncate">${activeEq.className}</span>
               </div>
             </div>
           </div>
           <div class="text-right">
             <div id="livePanelTimer-mob-${sn}" class="text-3xl font-black tabular-nums leading-none text-white tracking-tight">00:00,00</div>
             <div class="text-[9px] text-slate-400 uppercase font-bold tracking-widest mt-0.5">Löpande tid</div>
           </div>
        </div>

        <div class="grid grid-cols-3 gap-2 pt-2 border-t border-white/10">
           <div class="bg-white/5 p-2 rounded text-center">
             <div class="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Straff</div>
             <div class="text-lg font-bold text-blue-300" id="livePanelPenalty-mob-${sn}">${totalPenalty}</div>
           </div>
           <div class="bg-white/5 p-2 rounded text-center">
             <div class="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Delplac.</div>
             <div class="text-lg font-bold text-yellow-400" id="livePanelRank-mob-${sn}">-</div>
           </div>
           <div class="bg-white/5 p-2 rounded text-center">
             <div class="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Totalp.</div>
             <div class="text-lg font-bold text-emerald-400">${myOverall?.rank || '-'}</div>
           </div>
        </div>
      </div>
    </div>
  `;
}

function updateLivePanelTimer(sn, label, penaltyDef, rankDef) {
  const elTimer = document.getElementById(`livePanelTimer-${sn}`);
  const elPenalty = document.getElementById(`livePanelPenalty-${sn}`);
  const elRank = document.getElementById(`livePanelRank-${sn}`);

  if (elTimer) elTimer.textContent = label;
  if (elPenalty && penaltyDef) elPenalty.textContent = penaltyDef;
  if (elRank && rankDef) elRank.textContent = rankDef;

  // Mobile IDs
  const elTimerMob = document.getElementById(`livePanelTimer-mob-${sn}`);
  const elPenaltyMob = document.getElementById(`livePanelPenalty-mob-${sn}`);
  const elRankMob = document.getElementById(`livePanelRank-mob-${sn}`);

  if (elTimerMob) elTimerMob.textContent = label;
  if (elPenaltyMob && penaltyDef) elPenaltyMob.textContent = penaltyDef;
  if (elRankMob && rankDef) elRankMob.textContent = rankDef;
}

function renderLayout() {
  const comp = getGlobalState('currentCompetition');
  const root = document.getElementById('page-precision-results');
  if (!root) return;

  let precisionDateStr = '';
  // ... (date logic kept simple or reused if I could, but here I'll just keep the existing calculation or simplify it. 
  // The existing calculation in lines 429-449 is a bit long to copy-paste. I will try to preserve it by not deleting it 
  // if I can help it, but replace_file_content works on blocks. I'll just copy the logic.)

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
          isNum(data.obstaclePenalty) ? data.obstaclePenalty.toFixed(2) : '0,00',
          isNum(data.timePenalty) ? data.timePenalty.toFixed(2) : '0,00',
          isNum(data.extraPenalty) ? data.extraPenalty.toFixed(2) : '0,00',
          (data.d?.eliminated) ? 'ELIM' : (isNum(data.totalPenalty) ? data.totalPenalty.toFixed(2) : '—'),
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
  let list = precision_equipages.slice();
  if (precision_searchText) {
    const s = precision_searchText.toLowerCase();
    list = list.filter(e =>
      String(e.startNumber || '').includes(s) ||
      (e.driverName || '').toLowerCase().includes(s) ||
      (e.className || '').toLowerCase().includes(s) ||
      (e._mergedLabel || '').toLowerCase().includes(s)
    );
  }

  // Filter out withdrawn/struken
  list = list.filter(e => {
    const st = String(e.status || '').toLowerCase();
    return !['struken', 'withdrawn', 'scratched'].includes(st) && !e.struken && !e.withdrawn;
  });

  if (precision_showOnlyFinalized) {
    list = list.filter(e => {
      const d = precision_precisionMap.get(String(e.startNumber)) || {};
      return d.finalized === true && isNum(d.totalPenalty);
    });
  }
  if (precision_activeClassFilters.size > 0) {
    list = list.filter(e => precision_activeClassFilters.has(e._mergedLabel || e.className || '—'));
  }

  const placeMap = buildPlaceMap(list, precision_precisionMap, precision_precisionConfig);

  const col = precision_sort.col;
  const dir = precision_sort.dir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    if (precision_viewMode === 'byclass') {
      const classA = a._mergedLabel || a.className || '';
      const classB = b._mergedLabel || b.className || '';
      if (classA !== classB) {
        return classA.localeCompare(classB, 'sv') * dir;
      }
    }

    const dataA = getCalculatedRowData(String(a.startNumber), placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);
    const dataB = getCalculatedRowData(String(b.startNumber), placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);

    const val = (colName, data) => {
      switch (colName) {
        case 'place': return data.place || Infinity;
        case 'penalty': return isNum(data.totalPenalty) ? data.totalPenalty : Infinity;
        case 'time': return data.timeMs;
        case 'knocks': return data.knocksCount;
        case 'obstacle': return isNum(data.obstaclePenalty) ? data.obstaclePenalty : Infinity;
        case 'timePenalty': return isNum(data.timePenalty) ? data.timePenalty : Infinity;
        case 'extra': return isNum(data.extraPenalty) ? data.extraPenalty : Infinity;
        case 'overall': {
              const currentClass = a._mergedLabel || a.className;
              const visibleInClass = precision_equipages.filter(e => (e._mergedLabel || e.className) === currentClass);
              const overallEntries = getOverallEntries(visibleInClass);
              const { map: standingsMap } = buildOverallStanding(overallEntries, precision_precisionMap, precision_precisionConfig);
              return standingsMap.get(String(a.startNumber))?.total ?? Infinity;
        }
        case 'status': return { 'Pågår': 1, 'Klar': 2, 'Ej startat': 3, 'Struken': 4 }[data.status] ?? 3;
        case 'portWidth': return isNum(data.display.portWidth) ? data.display.portWidth : Infinity;
        case 'startTime': return startTimeFor(data.eq.startNumber, precision_startTimes) || 'ZZZZ';
        case 'className': return (data.eq._mergedLabel || data.eq.className || '');
        case 'driverName': return (data.eq.driverName || '');
        case 'startNumber':
        default: return data.eq.startNumber || 0;
      }
    };

    const va = val(col, dataA);
    const vb = val(col, dataB);

    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;

    // Tie-breaker: Time closest to allowed time
    if (col === 'penalty' || col === 'place') {
      const diffA = dataA.timeDiffFromAllowed || Infinity;
      const diffB = dataB.timeDiffFromAllowed || Infinity;
      if (Math.abs(diffA - diffB) > 1e-6) {
        return (diffA - diffB) * dir;
      }
    }

    return (a.startNumber || 0) - (b.startNumber || 0);
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
      const groups = prec_groupEquipagesForDisplay(visibleEquipages, precision_displayConfig);
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
  
  const timeLabel = data.display.timeLabel;
  const penaltyLabel = data.d?.eliminated ? '<span class="text-red-600 dark:text-red-400 font-bold">ELIM</span>' : fmt2(data.totalPenalty);
  const obstacleLabel = fmt2(data.obstaclePenalty);
  const timePenaltyLabel = fmt2(data.timePenalty);

  const isActive = data.d?.running === true || (data.status && data.status.includes('P\u00e5g'));
  const isStruken = data.status === 'Struken' || eq.status === 'struken';

  // 2. Placement Coloring Logic
  const cls = data.eq._mergedLabel || data.eq.className || 'Ok\u00e4nd Klass';
  const startersCount = classStarters.get(cls) || 1;
  const numPlaced = Math.ceil(startersCount / 4) || 1;
  const rankNum = Number(data.place);
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
      <div class="text-base font-black ${placColor} leading-none">${data.place || '\u2014'}</div>
  `;

  return `
      <div class="m-1 mb-1.5 rounded-lg border shadow-sm overflow-hidden cursor-pointer ${placBg}" data-sn="${sn}" role="button" tabindex="0">
        
        <!-- TOP ROW -->
        <div class="p-1.5 flex items-center justify-between gap-1 border-b dark:border-gray-700/50 ${(isPlaced || isActive || isStruken) ? '' : 'bg-gray-50 dark:bg-gray-800/50'}">
           <!-- Left: Name & Flags -->
           <div class="flex flex-col min-w-0 pr-1">
              <div class="font-bold text-[13px] dark:text-white leading-tight truncate flex items-center gap-1">
                 <span class="text-gray-500 dark:text-gray-400 text-[10px]">#${data.eq.startNumber}</span> 
                 <span class="truncate">${data.eq.driverName}</span>
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                 ${getFlagHtml(data.eq)} ${getClubLogoHtml(data.eq)}
                 ${precision_viewMode === 'startorder' ? `<span class="text-[9px] text-gray-500 dark:text-gray-400 truncate ml-1">${cls}</span>` : ''}
              </div>
           </div>
           
           <!-- Right: Stats & Plac -->
           <div class="flex items-center gap-2 shrink-0">
              <div class="text-right">
                  <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5">Totalt</div>
                  <div class="font-bold text-[13px] text-blue-800 dark:text-blue-300 leading-none live-total-penalty-card" data-sn="${sn}">${penaltyLabel}</div>
              </div>
              <div class="text-right border-l dark:border-gray-300 dark:border-gray-600 pl-2">
                  ${placBlock}
              </div>
           </div>
        </div>

        <!-- BOTTOM ROW -->
        <div class="px-1.5 py-1.5 bg-white dark:bg-gray-800">
           <div class="flex justify-between items-center text-[10px] mb-1">
              <span class="text-gray-500 dark:text-gray-400">Start: <strong class="text-gray-700 dark:text-gray-200">${data.startT || '\u2014'}</strong></span>
              ${isActive
                ? `
                  <div class="flex items-center gap-1">
                      <span class="inline-flex items-center px-1 py-0.5 rounded text-[8px] uppercase font-bold bg-yellow-100 text-yellow-800 animate-pulse">Running</span>
                  </div>
                  `
                : `<span class="text-gray-500 dark:text-gray-400 font-medium">${data.status || '\u2013'}</span>`
              }
           </div>

           <div class="flex gap-1 text-[10px] tabular-nums">
              <div class="flex-1 text-center py-0.5 rounded bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600">
                 <div class="text-[8px] uppercase tracking-wider opacity-70 leading-none">Tid</div>
                 <div class="font-bold live-time-card text-[10px] leading-tight" data-sn="${sn}">${isActive ? '\u2022\u2022:\u2022\u2022,\u2022\u2022' : timeLabel}</div>
              </div>
              <div class="flex-1 text-center py-0.5 rounded bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600">
                 <div class="text-[8px] uppercase tracking-wider opacity-70 leading-none">Hinder</div>
                 <div class="font-bold live-obstacle-penalty-card text-[10px] leading-tight" data-sn="${sn}">${obstacleLabel}</div>
              </div>
              <div class="flex-1 text-center py-0.5 rounded bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600">
                 <div class="text-[8px] uppercase tracking-wider opacity-70 leading-none">Tidsfel</div>
                 <div class="font-bold live-time-penalty-card text-[10px] leading-tight" data-sn="${sn}">${timePenaltyLabel}</div>
              </div>
           </div>
           ${renderFinalizeButtons(eq) ? `
             <div class="mt-1 flex justify-end">${renderFinalizeButtons(eq)}</div>
           ` : ''}
        </div>
      </div>
  `;
}

function renderFinalizeButtons(eq) {
  const compId = getGlobalState('currentCompetition')?.id;
  const sn = String(eq.startNumber);
  const can = window.canFinalize && window.canFinalize();
  const finalized = isPrecisionFinalized(sn);
  if (!can) return '';

  return `
    <div class="mt-2 flex items-center justify-center gap-2" data-prec-finalize-slot>
      <span id="prec-final-badge-${sn}"
            class="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800"
            style="display:${finalized ? 'inline-flex' : 'none'}">
        ${t('finalized_badge')}
      </span>
      <button type="button" data-prec-action="finalize" data-sn="${sn}" class="px-2 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700" style="display:${finalized ? 'none' : ''}" >${t('finalize')}</button>
      <button type="button" data-prec-action="unfinalize" data-sn="${sn}" class="px-2 py-1 text-xs rounded border border-emerald-600 text-emerald-700 hover:bg-emerald-50" style="display:${finalized ? '' : 'none'}" >${t('undo')}</button>
    </div>`;
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
      const gArr = prec_groupEquipagesForDisplay(precision_equipages, precision_displayConfig);
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

  const thClass = "px-2 py-2 lg:px-3 lg:py-3 text-left text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase cursor-pointer bg-white dark:bg-gray-800";
  const thNoClass = "px-2 py-2 lg:px-3 lg:py-3 text-left text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase bg-white dark:bg-gray-800";

  const headHTML = `<thead><tr>
        <th data-col="place" class="${thClass}">${t('rank')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="startNumber" class="${thClass} sticky-col-start bg-gray-50 dark:bg-gray-700"># <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="driverName" class="${thClass} sticky-col-driver bg-gray-50 dark:bg-gray-700">${t('driver')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="className" class="${thClass}">${t('class')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th class="${thNoClass}">${t('country_club')}</th>
        <th data-col="startTime" class="${thClass}">${t('start_time')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="portWidth" class="${thClass}">${t('obstacle_width')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="time" class="${thClass}">${t('time')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="knocks" class="${thClass}">${t('knockdowns')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="obstacle" class="${thClass}">${t('obs_penalty')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="timePenalty" class="${thClass}">${t('time_penalty')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="extra" class="${thClass}">${t('other_penalty_short')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="penalty" class="${thClass}">${t('total')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="overall" class="${thClass}">Total ställning <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="status" class="${thClass}">${t('status')} <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th class="${thNoClass}">${t('final_column')}</th>            
    </tr></thead>`;

  const renderRow = (eq, index) => {
    const sn = String(eq.startNumber);
    const data = getCalculatedRowData(sn, placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);

    const baseAllowance = getDisplayPortAllowance(data.eq.className);
    const allowanceDisplay = isNum(baseAllowance) ? `+ ${baseAllowance} cm` : '—';
    const isStruken = data.eq.status === 'struken';
    const isActive = data.status && data.status.includes('Påg');
    const badgeClass = isStruken ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' : statusClass(data.status);

    let rowBgClass;
    if (isStruken) {
      rowBgClass = 'opacity-50 bg-red-50 dark:bg-red-900/10';
    } else if (isActive) {
      // Improved contrast: Darker yellow background in dark mode
      rowBgClass = 'bg-yellow-50 dark:bg-yellow-900/40 border-l-4 border-yellow-500 shadow-sm relative z-10';
    } else {
      rowBgClass = (index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-800/50');
    }

    // Om active, ta bort border-l-4 från tr och lägg kanske på första td om det strular, 
    // men vi testar på tr först. border-l funkar ofta på tr om collapse=separate.
    const overTime = (data.d.finalized && isNum(data.timePenalty) && data.timePenalty > 0);
    const timeAlertCls = overTime ? 'text-red-600 dark:text-red-400 font-semibold' : '';

    const rowStyle = isActive ? 'border-left: 4px solid #eab308;' : '';

    const resOverall = standings.get(sn);

    return `
           <tr class="${rowBgClass} hover:bg-blue-100 dark:hover:bg-gray-700 cursor-pointer text-gray-900 dark:text-gray-200" data-sn="${sn}" style="${rowStyle}">
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 font-semibold text-[11px] lg:text-sm">${data.place || '–'}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm sticky-col-start ${rowBgClass || ''}">${data.eq.startNumber}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-left align-top sticky-col-driver ${rowBgClass || ''}">
                    <button type="button" class="text-xs lg:text-base font-bold text-gray-900 dark:text-white hover:text-blue-700 dark:hover:text-blue-400 hover:underline text-left transition-colors truncate block w-full" title="${data.eq.driverName}">${data.eq.driverName}</button>
                    <div class="hidden lg:block text-[10px] lg:text-xs text-gray-600 dark:text-gray-400 leading-tight whitespace-nowrap">${horseLabelStacked(data.eq)}</div>
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm"><div class="truncate max-w-[100px] lg:max-w-none" title="${data.eq._mergedLabel || data.eq.className || ''}">${data.eq._mergedLabel || data.eq.className}</div></td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5">
                    <div class="flex items-center gap-2">
                        ${getFlagHtml(data.eq)} ${getClubLogoHtml(data.eq)} <span class="truncate max-w-[80px] lg:max-w-[120px] text-[11px] lg:text-sm" title="${data.eq.clubName || ''}">${data.eq.clubName || ''}</span>
                    </div>
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm whitespace-nowrap">${startTimeFor(sn, precision_startTimes)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm whitespace-nowrap">${allowanceDisplay}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 time-cell align-top" data-sn="${sn}">
                    <span class="tabular-nums ${timeAlertCls} text-[11px] lg:text-sm whitespace-nowrap">${(data.d?.running === true) ? '••:••,••' : data.display.timeLabel}</span>
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm">${data.display.knocksSimple}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums text-[11px] lg:text-sm obstacle-penalty-cell" data-sn="${sn}">${fmt2(data.obstaclePenalty)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums text-[11px] lg:text-sm time-penalty-cell" data-sn="${sn}">${fmt2(data.timePenalty)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums text-[11px] lg:text-sm">${fmt2(data.extraPenalty)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums font-semibold text-[11px] lg:text-sm total-penalty-cell" data-sn="${sn}">${fmt2(data.totalPenalty)}</td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 tabular-nums font-bold text-[11px] lg:text-sm text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    ${!resOverall ? '—' : (resOverall.total === Infinity ? 'ELIM' : `${fmt2(resOverall.total)} (${resOverall.rank})`)}
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center">
                    <span class="inline-block px-1.5 py-0.5 rounded-md text-[10px] lg:text-xs font-medium whitespace-nowrap ${badgeClass}">${data.status}</span>
                </td>
                <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-right whitespace-nowrap">
                  ${renderFinalizeButtons(eq)}
                </td>
            </tr>`;
  };

  let bodyHTML = '';
  if (precision_viewMode === 'startorder') {
    bodyHTML = visible.map((eq, index) => renderRow(eq, index)).join('');
  } else {
    const groups = prec_groupEquipagesForDisplay(visible, precision_displayConfig);
    for (const group of groups) {
      bodyHTML += `<tr class="bg-gray-200 dark:bg-gray-700 border-t-2 border-b-2 border-gray-300 dark:border-gray-600 sticky top-0 z-10"><td class="px-3 py-2 font-bold text-gray-800 dark:text-gray-200" colspan="15">${group.label}</td></tr>`;
      bodyHTML += group.items.map((eq, i) => renderRow(eq, i)).join('');
    }
  }

  container.innerHTML = `<table id="precisionTable" class="pr-table pr-alt">${headHTML}<tbody id="precisionBody">${bodyHTML}</tbody></table>`;

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
    let needsFullRender = false;
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      const newData = ch.doc.data();
      const oldData = precision_precisionMap.get(id) || {};
      if (ch.type === 'removed') {
        precision_precisionMap.delete(id);
      } else {
        newData._receivedLocalAt = Date.now(); // NYTT: För relativ tidssynk
        precision_precisionMap.set(id, newData);
      }
      if (newData.running === true && oldData.running !== true && newData.liveStartEpoch) {
        ensureTicker();
        needsFullRender = true;
      }
      else if (newData.running === false && oldData.running === true) {
        needsFullRender = true;
      }
      else if (
        newData.finalized !== oldData.finalized ||
        newData.totalPenalty !== oldData.totalPenalty ||
        newData.liveTotalPenalty !== oldData.liveTotalPenalty ||
        newData.liveObstaclePenalty !== oldData.liveObstaclePenalty ||
        JSON.stringify(newData.knocks) !== JSON.stringify(oldData.knocks) ||
        newData.extraPenalty !== oldData.extraPenalty ||
        newData.comment !== oldData.comment
      ) {
        needsFullRender = true;
      }
    });

    if (needsFullRender) renderLiveDebounce();

    let anyRunningNow = false;
    precision_precisionMap.forEach(d => { if (d?.running === true) anyRunningNow = true; });
    if (anyRunningNow) ensureTicker(); else stopTicker();

  }, (error) => {
    console.error("[listenLive] Fel vid lyssning på Firestore:", error);
    stopTicker();
  });
}

let overallUnsubs = [];
function listenOverallData(compId) {
  if (!compId || !appId) return;
  overallUnsubs.forEach(u => u());
  overallUnsubs = [];

  // 1) Dressyr - Lyssna på alla protokoll för ekipagen
  const unsubD = listenForDressageProtocolsCollectionGroup(compId, precision_equipages, (docs) => {
    const grouped = new Map();
    docs.forEach(d => {
      const sn = String(d.startNumber);
      if (!grouped.has(sn)) grouped.set(sn, []);
      grouped.get(sn).push(d);
    });
    precision_dressageMap = grouped;
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
    const list = Array.isArray(docs) ? docs : (Array.isArray(docs?.docs) ? docs.docs : Object.values(docs || {}));
    precision_marathonTimingMap.clear();
    for (const doc of list) {
      const data = typeof doc.data === 'function' ? doc.data() : doc;
      const id = doc.id || data.id || data.startNumber;
      if (id) precision_marathonTimingMap.set(String(id), data);
    }
    renderLiveDebounce();
  });

  overallUnsubs.push(unsubD, unsubM, unsubMT);
}

let mergeUnsubs = [];
function listenMergeConfig(compId) {
  if (Array.isArray(mergeUnsubs)) mergeUnsubs.forEach(u => { try { u(); } catch { } });
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
        _mergedKey: prec_resolveMergeGrouping(e, null).key,
        _mergedLabel: prec_resolveMergeGrouping(e, null).label
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
    _mergedKey: prec_resolveMergeGrouping(e, null).key,
    _mergedLabel: prec_resolveMergeGrouping(e, null).label
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
  // FIX: Rätt collection är 'precision', inte 'results_precision'
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${compId}/precision/${sn}`);
  // Läs först nuvarande data för att veta vad vi sparar (säkerhet)
  // Men vi kan också bara sätta finalized: true och förlita oss på calculatePrecisionResult
  // Enklare: Vi litar på att live-lyssnaren uppdaterar UI
  try {
    // Hämta nuvarande data klient-side
    const d = precision_precisionMap.get(String(sn)) || {};
    // Sätt finalized=true
    await setDoc(ref, { prioritized: true, ...d, finalized: true }, { merge: true });

    // Uppdatera cache direkt för snabb respons
    precision_finalizeCache.set(String(sn), true);
    patchPrecisionFinalizeBadge(String(sn), true);

    // Tvinga omräkning av placeringar
    render();
  } catch (err) {
    console.error("Kunde inte finalisera:", err);
    alert("Fel vid sparning: " + err.message);
  }
};

window.__unfinalizePrecision = async (compId, sn) => {
  if (!compId || !sn) return;
  // FIX: Rätt collection är 'precision'
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${compId}/precision/${sn}`);
  try {
    await setDoc(ref, { finalized: false }, { merge: true });
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
  if (Array.isArray(mergeUnsubs)) { mergeUnsubs.forEach(u => { try { u(); } catch { } }); mergeUnsubs = []; }
  if (Array.isArray(overallUnsubs)) { overallUnsubs.forEach(u => { try { u(); } catch { } }); overallUnsubs = []; }
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
