// js/pages/precision-resultat.js
import { getGlobalState } from '../main.js';
import { getEquipages, getConfig } from '../services/firestoreService.js';
import { collection, onSnapshot, query, getDocs, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { getCompetitionHeader } from '../ui/components.js';
import { getFlagHtml } from '../services/flagsService.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../services/logosService.js';
import { calculatePrecisionResult } from '../utils/precisionUtils.js';

import { initializeScrollSync, injectScrollStyles } from '../ui/scrollHelper.js';
import {
  getCalculatedRowData,
  buildPlaceMap,
  computeMaxSecondsForClass,
  startTimeFor,
  getPortAllowanceCm,
  trackWidthFromEq,
  statusClass
} from '../utils/precisionUtils.js';

// IMPORTERA NYA MODALEN
import { showDetailsModal, closeDetailsModal } from '../ui/precisionModal.js';
import { generateAndPrintPdf, generatePrecisionListPdf } from '../pdf/precisionPdf.js';

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
} from '../utils/sharedUtils.js';

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
const MOBILE_BP = 600;

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
      const elapsedMs = (data.livePausedMs || 0) + (Date.now() - data.liveStartEpoch);

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

      // Calculate live penalties and rank client-side for immediate feedback
      if (eq) {
        // 1. Time Penalty
        let liveTimePenalty = 0;
        if (isNum(maxSec) && elapsedMs > maxSec * 1000) {
          liveTimePenalty = ((elapsedMs / 1000) - maxSec) * 0.5;
        }

        // 2. Obstacle Penalty (from data or knock loop if we had it, but here we trust data for knocks)
        const obsPenalty = isNum(data.liveObstaclePenalty) ? data.liveObstaclePenalty : (data.obstaclePenalty || 0);
        const extraPenalty = isNum(data.extraPenalty) ? data.extraPenalty : 0;

        const currentTotal = liveTimePenalty + obsPenalty + extraPenalty;
        penaltyStr = currentTotal.toFixed(2);

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
  const data = precision_precisionMap.get(sn);

  // Beräkna straff
  const obstaclePenalty = isNum(data.liveObstaclePenalty) ? data.liveObstaclePenalty : (data.obstaclePenalty || 0);
  const timePenalty = isNum(data.liveTimePenalty) ? data.liveTimePenalty : (data.timePenalty || 0);
  const totalPenalty = (obstaclePenalty + timePenalty).toFixed(2);

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="bg-slate-900 rounded-xl p-4 md:p-6 shadow-xl border border-slate-700 relative overflow-hidden text-white">
      <!-- Background Accents -->
      <div class="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full mix-blend-overlay filter blur-3xl opacity-10 -translate-y-1/2 translate-x-1/2"></div>
      
      <div class="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
        
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
           <!-- Position (Rank) -->
           <div class="text-center px-4 border-r border-white/10 hidden md:block">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Placering</div>
             <div class="text-3xl font-bold text-yellow-400 tabular-nums" id="livePanelRank-${sn}">-</div>
           </div>

           <!-- Penalties -->
           <div class="text-center px-4 border-r border-white/10">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Straff</div>
             <div class="text-3xl font-bold text-blue-300 tabular-nums" id="livePanelPenalty-${sn}">${totalPenalty}</div>
           </div>

           <!-- Timer -->
           <div class="text-center min-w-[140px]">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Tid</div>
             <div class="text-5xl md:text-6xl font-black tabular-nums leading-none tracking-tight" id="livePanelTimer-${sn}">
               00:00,00
             </div>
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
      <div class="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen">
        <div class="mb-8">
          ${getCompetitionHeader(comp, 'Precision – Start- & Resultatlista')}
          ${precisionDateStr ? `<h3 class="text-lg text-gray-500 mt-1 font-medium text-center">${precisionDateStr}</h3>` : ''}
        </div>

        <div id="liveStatusPanelContainer" class="mb-6 hidden"></div>

        <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-col lg:flex-row gap-4 items-center justify-between" id="modeToggle">
          
          <div class="flex flex-col md:flex-row items-center gap-4 w-full lg:w-auto">
              <div class="relative w-full md:w-72">
                   <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg class="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                   </div>
                   <input type="text" id="inputPrecisionSearch" 
                      class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-gray-50 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-shadow"
                      placeholder="Sök kusk, häst..."
                    >
              </div>

              <div class="flex flex-wrap items-center gap-2" id="precisionToolbarControls">
                  <div class="inline-flex shadow-sm rounded-md bg-gray-100 p-1">
                      <button id="precBtnStartOrder" data-mode="startorder" class="px-4 py-1.5 text-sm font-medium rounded transition-all">Startordning</button>
                      <button id="precBtnByRank" data-mode="rank" class="px-4 py-1.5 text-sm font-medium rounded transition-all">Placering</button>
                      <button id="precBtnByClass" data-mode="byclass" class="px-4 py-1.5 text-sm font-medium rounded transition-all">Klassvis</button>
                  </div>
                  
                  <div class="w-px h-6 bg-gray-300 mx-2 hidden md:block"></div>

                  <button id="precToggleFinalized" class="px-3 py-1.5 text-sm font-medium rounded border transition-colors">
                    <!-- Text updated via JS -->
                  </button>
              </div>
          </div>

          <div class="flex-shrink-0 flex items-center gap-2">
              <button id="btnExportPrecisionCsv" 
                class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors">
                 <i class="fas fa-file-csv mr-2 -ml-1 text-gray-500"></i>
                 CSV
              </button>
              <button id="btnExportPrecisionPdf" 
                class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors">
                <svg class="mr-2 -ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                 Skriv ut PDF
              </button>
          </div>
        </div>

        <div id="precMergeStatus" class="mt-2 text-xs text-gray-600"></div>
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
        alert('Kunde inte skapa PDF: ' + (err.message || err));
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
      const placeMap = buildPlaceMap(list, precision_precisionMap);

      const headers = [
        'Plac', 'Nr', 'Kusk', 'Häst', 'Klass', 'Klubb',
        'Starttid', 'Hinderbredd (cm)', 'Tid', 'Rivningar',
        'H-Straff', 'Tid-Straff', 'Övr-Straff',
        'Totalt', 'Status'
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
          data.display.knocksText,          // Rivningar
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
    if (btn) btn.className = `px-4 py-1.5 text-sm font-medium rounded transition-all ${active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`;
  };

  setBtn(btnStart, mode === 'startorder');
  setBtn(btnRank, mode === 'rank');
  setBtn(btnClass, mode === 'byclass');

  const btnFin = document.getElementById('precToggleFinalized');
  const isFin = precision_showOnlyFinalized;
  if (btnFin) {
    btnFin.className = `px-3 py-1.5 text-sm font-medium rounded border transition-colors ${isFin ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`;
    btnFin.textContent = isFin ? 'Visa alla' : 'Visa bara finaliserade';
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
  if (precision_showOnlyFinalized) {
    list = list.filter(e => {
      const d = precision_precisionMap.get(String(e.startNumber)) || {};
      return d.finalized === true && isNum(d.totalPenalty);
    });
  }
  if (precision_activeClassFilters.size > 0) {
    list = list.filter(e => precision_activeClassFilters.has(e._mergedLabel || e.className || '—'));
  }

  const placeMap = buildPlaceMap(list, precision_precisionMap);

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
    return (a.startNumber || 0) - (b.startNumber || 0);
  });
  return list;
}

function renderMobile() {
  const container = document.getElementById('prWrap');
  if (!container) return;

  const visibleEquipages = filteredSortedEquipages();
  const placeMap = buildPlaceMap(visibleEquipages, precision_precisionMap);

  let html = '';
  if (visibleEquipages.length === 0) {
    html = '<div class="p-6 text-center text-gray-500">Inga ekipage matchar din sökning.</div>';
  } else {
    if (precision_viewMode === 'byclass') {
      const groups = prec_groupEquipagesForDisplay(visibleEquipages, precision_displayConfig);
      for (const group of groups) {
        html += `<div class="px-4 py-2 mt-2 bg-blue-100 text-blue-800 font-bold text-lg rounded-md">${group.label}</div>`;
        html += group.items.map(eq => renderCard(eq, placeMap)).join('');
      }
    } else {
      html += visibleEquipages.map(eq => renderCard(eq, placeMap)).join('');
    }
  }

  container.innerHTML = `<div class="bg-gray-50 py-1 space-y-2">${html}</div>`;

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

function renderCard(eq, placeMap) {
  const sn = String(eq.startNumber);
  const data = getCalculatedRowData(sn, placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);
  const statusCls = statusClass(data.status);
  const timeLabel = data.display.timeLabel;
  const penaltyLabel = data.d?.eliminated ? '<span class="text-red-600 font-bold">ELIM</span>' : fmt2(data.totalPenalty);
  const obstacleLabel = fmt2(data.obstaclePenalty);
  const timePenaltyLabel = fmt2(data.timePenalty);

  return `
        <div class="m-2 rounded-xl border shadow-sm bg-white overflow-hidden cursor-pointer" data-sn="${sn}" role="button" tabindex="0">
            <div class="px-4 py-3 border-b bg-gray-50 flex items-start justify-between gap-4">
                <div>
                    <div class="font-semibold text-lg">#${data.eq.startNumber} ${data.eq.driverName}</div>
                    <div class="text-sm text-gray-500">${horseLabel(data.eq)}</div>
                </div>
                <div class="text-center flex-shrink-0">
                    <div class="text-xs text-gray-500">Plac.</div>
                    <div class="text-2xl font-bold">${data.place || '—'}</div>
                </div>
            </div>
            <div class="p-4 grid grid-cols-1 gap-y-2 text-sm">
                <div class="flex justify-between"><span class="text-gray-500">Klass:</span> <span class="font-medium text-right">${data.eq._mergedLabel || data.eq.className || '—'}</span></div>
                <div class="flex justify-between items-center"><span class="text-gray-500">Klubb:</span>
                    <span class="font-medium flex items-center gap-2 text-right">
                        ${getFlagHtml(data.eq)}
                        ${getClubLogoHtml(data.eq)}
                        <span class="truncate">${data.eq.clubName || '—'}</span>
                    </span>
                </div>
                 <div class="flex justify-between"><span class="text-gray-500">Starttid:</span> <span class="font-medium text-right">${data.startT || '—'}</span></div>
            </div>
             <div class="px-4 py-3 border-t grid grid-cols-2 gap-4 items-center">
                 <div class="text-center">
                    <div class="text-xs text-gray-500">Tid</div>
                    <div class="font-semibold text-lg live-time-card" data-sn="${sn}">${(data.d?.running === true) ? '••:••,••' : timeLabel}</div>
                </div>
                 <div class="text-center">
                    <div class="text-xs text-gray-500">Hinderstraff</div>
                    <div class="font-semibold text-lg">${obstacleLabel}</div>
                </div>
                 <div class="text-center">
                    <div class="text-xs text-gray-500">Tidsstraff</div>
                    <div class="font-semibold text-lg">${timePenaltyLabel}</div>
                </div>
                 <div class="text-center">
                    <div class="text-xs text-gray-500">Totalt Straff</div>
                    <div class="font-bold text-blue-800 text-lg">${penaltyLabel}</div>
                </div>
            </div>
             <div class="px-4 py-2 border-t text-center">
                 <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusCls}">${data.status}</span>
                 ${renderFinalizeButtons(eq)}
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
        Finaliserad
      </span>
      <button type="button" data-prec-action="finalize" data-sn="${sn}" class="px-2 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700" style="display:${finalized ? 'none' : ''}" onclick="event.stopPropagation(); window.__finalizePrecision('${compId}','${sn}')">Finalisera</button>
      <button type="button" data-prec-action="unfinalize" data-sn="${sn}" class="px-2 py-1 text-xs rounded border border-emerald-600 text-emerald-700 hover:bg-emerald-50" style="display:${finalized ? '' : 'none'}" onclick="event.stopPropagation(); window.__unfinalizePrecision('${compId}','${sn}')">Ångra</button>
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
    if (!statusHost || !chipHost) return;

    const groups = precision_MERGE_GROUPS || [];
    const activeCount = groups.filter(g => Array.isArray(g.members) && g.members.length > 1).length;
    statusHost.textContent = activeCount ? `Aktiva sammanslagningar: ${activeCount}` : '';
    statusHost.style.display = activeCount ? 'block' : 'none';

    const gArr = prec_groupEquipagesForDisplay(precision_equipages, precision_displayConfig);
    const labels = gArr.map(g => g.label);
    const base = "px-2 py-1 rounded border text-sm cursor-pointer";
    const on = "bg-gray-800 text-white border-gray-800";
    const off = "bg-white text-gray-700 border-gray-300 hover:bg-gray-50";

    chipHost.innerHTML = labels.map(lbl => {
      const active = precision_activeClassFilters.has(lbl);
      return `<button type="button" data-class="${escapeHtml(lbl)}" class="${base} ${active ? on : off}">${escapeHtml(lbl)}</button>`;
    }).join('');

    if (!chipHost.dataset.wired) {
      chipHost.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-class]');
        if (!btn) return;
        const lbl = btn.dataset.class;
        if (precision_activeClassFilters.has(lbl)) precision_activeClassFilters.delete(lbl);
        else precision_activeClassFilters.add(lbl);
        try { if (typeof render === 'function') render(); } catch { }
      });
      chipHost.dataset.wired = '1';
    }
  })();

  const visible = filteredSortedEquipages();
  const placeMap = buildPlaceMap(visible, precision_precisionMap);

  const headHTML = `<thead><tr>
        <th data-col="place" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Plac <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="startNumber" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer"># <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="driverName" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Kusk / Häst <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="className" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Klass <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Land/Förening</th>
        <th data-col="startTime" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Starttid <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="portWidth" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Hinderbredd <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="time" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Tid <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="knocks" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Rivningar <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="obstacle" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Hinderstraff <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="timePenalty" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Tidsstraff <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="extra" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Annat str. <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="penalty" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Totalt <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th data-col="status" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Status <span class="ml-1 inline-block align-middle sort-icon"></span></th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Final</th>            
    </tr></thead>`;

  const renderRow = (eq, index) => {
    const sn = String(eq.startNumber);
    const data = getCalculatedRowData(sn, placeMap, precision_equipages, precision_precisionMap, precision_precisionConfig, precision_startTimes);

    const baseAllowance = getDisplayPortAllowance(data.eq.className);
    const allowanceDisplay = isNum(baseAllowance) ? `+ ${baseAllowance} cm` : '—';
    const isStruken = data.eq.status === 'struken';
    const isActive = data.status && data.status.includes('Påg');
    const badgeClass = isStruken ? 'bg-red-100 text-red-800' : statusClass(data.status);

    let rowBgClass;
    if (isStruken) {
      rowBgClass = 'opacity-50 bg-red-50';
    } else if (isActive) {
      rowBgClass = 'bg-yellow-50 border-l-4 border-yellow-500 shadow-sm relative z-10';
    } else {
      rowBgClass = (index % 2 === 0 ? 'bg-white' : 'bg-gray-50');
    }

    // Om active, ta bort border-l-4 från tr och lägg kanske på första td om det strular, 
    // men vi testar på tr först. border-l funkar ofta på tr om collapse=separate.
    const overTime = (data.d.finalized && isNum(data.timePenalty) && data.timePenalty > 0);
    const timeAlertCls = overTime ? 'text-red-600 font-semibold' : '';

    const rowStyle = isActive ? 'background-color: #fefce8; border-left: 4px solid #eab308;' : '';

    return `
           <tr class="${rowBgClass} hover:bg-blue-100 cursor-pointer" data-sn="${sn}" style="${rowStyle}">
                <td class="px-3 py-2 font-semibold">${data.place || '–'}</td>
                <td class="px-3 py-2">${data.eq.startNumber}</td>
                <td class="px-3 py-2 text-left align-top">
                    <button type="button" class="font-bold text-gray-900 hover:text-blue-700 hover:underline text-left transition-colors">${data.eq.driverName}</button>
                    <div class="text-xs text-gray-600 leading-tight whitespace-normal">${horseLabelStacked(data.eq)}</div>
                </td>
                <td class="px-3 py-2">${data.eq._mergedLabel || data.eq.className}</td>
                <td class="px-3 py-2">
                    <div class="flex items-center gap-2">
                        ${getFlagHtml(data.eq)} ${getClubLogoHtml(data.eq)} <span>${data.eq.clubName || ''}</span>
                    </div>
                </td>
                <td class="px-3 py-2">${startTimeFor(sn, precision_startTimes)}</td>
                <td class="px-3 py-2">${allowanceDisplay}</td>
                <td class="px-3 py-2 time-cell align-top" data-sn="${sn}">
                    <span class="tabular-nums ${timeAlertCls}">${(data.d?.running === true) ? '••:••,••' : data.display.timeLabel}</span>
                </td>
                <td class="px-3 py-2">${data.display.knocksText}</td>
                <td class="px-3 py-2 tabular-nums">${fmt2(data.obstaclePenalty)}</td>
                <td class="px-3 py-2 tabular-nums">${fmt2(data.timePenalty)}</td>
                <td class="px-3 py-2 tabular-nums">${fmt2(data.extraPenalty)}</td>
                <td class="px-3 py-2 tabular-nums font-semibold">${fmt2(data.totalPenalty)}</td>
                <td class="px-3 py-2 text-center">
                    <span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium ${badgeClass}">${data.status}</span>
                </td>
                <td class="px-3 py-2 text-right">
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
      bodyHTML += `<tr class="bg-gray-200 border-t-2 border-b-2 border-gray-300 sticky top-0 z-10"><td class="px-3 py-2 font-bold text-gray-800" colspan="15">${group.label}</td></tr>`;
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
    const th = e.target.closest('th[data-col]');
    if (!th) return;
    const col = th.getAttribute('data-col');
    if (precision_sort.col === col) precision_sort.dir = (precision_sort.dir === 'asc') ? 'desc' : 'asc';
    else { precision_sort.col = col; precision_sort.dir = 'asc'; }
    render();
    updateSortIcons();
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

  const [
    equipagesData,
    configData,
    startTimesData,
    displayCfg,
    mergeCfgA,
    mergeCfgB,
    mergeCfgC
  ] = await Promise.all([
    getEquipages(competitionId),
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

  prec_buildMergeMap(mergeCfgA || mergeCfgB || mergeCfgC || displayCfg);
  precision_equipages = precision_equipages.map(e => ({
    ...e,
    _mergedKey: prec_resolveMergeGrouping(e, null).key,
    _mergedLabel: prec_resolveMergeGrouping(e, null).label
  }));

  try { await ensureClubLogosLoaded('/assets/config/club-logos.json'); }
  catch (_) {
    try { await ensureClubLogosLoaded('../assets/config/club-logos.json'); }
    catch (_) { await ensureClubLogosLoaded('./assets/config/club-logos.json'); }
  }

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
  render();
  updateSortIcons();
  listenLive();
  renderLayout();
  wireEventListeners();
  render();
  updateSortIcons();
  listenLive();
  listenMergeConfig(competitionId);
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

  console.log('✅ Precision unload klar');
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