// js/pages/maraton-monitor.js
// En "kontrollrums"-vy som visar alla ekipage som just nu är aktiva på maratonbanan.

import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getCompetitionHeader } from '../../ui/components.js';
import { collection, onSnapshot, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { getMarathonActiveState } from '../../services/competitionStatusService.js';
import { t } from '../../utils/i18n.js';

// Importera modalen direkt
import { showDetailsModal } from '../../ui/marathonModal.js';
import { renderMap, destroyMap, updateSidebar as updateSidebarMap } from './maraton-monitor-map.js';

import {
  setMarathonConfig,
  setPauseWindows,
  stagePenaltyFromMs,
  limitsFor,
  getObstacleArray,
  obstacleValues,
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved,
  pausedMsSince,
  pausedMsBetween,
  formatMsLive,
  toTimeLabel,
  calculateMarathonResult
} from '../../utils/marathonUtils.js';

function injectMonitorStylesOnce() {
  if (document.getElementById('maratonMonitorStyles')) return;
  const s = document.createElement('style');
  s.id = 'maratonMonitorStyles';
  s.textContent = `
    /* röd, diskret inner-ram för kort som passerat tidsgräns */
    .is-overdue { box-shadow: 0 0 0 2px rgba(220, 38, 38, .25) inset; }
    /* hinder-chips */
    .chip { display:inline-block; padding:1px 6px; font-size:11px; border-radius:999px; background:#f3f4f6; color:#374151; white-space:nowrap; }
    .chip.elim { background:#fee2e2; color:#991b1b; font-weight:600; }
    .chip-live { outline:2px solid rgba(251,191,36,.6); } /* markerar aktuellt hinder */

    /* Map Markers */
    .custom-div-icon { background: transparent; border: none; }
    .map-marker-ping { position: absolute; width: 100%; height: 100%; border-radius: 50%; opacity: 0.8; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; }
    .map-marker-body { position: relative; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transform: scale(0.9); transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); z-index: 10; border: 3px solid white; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); }
    .map-marker-body:hover { transform: scale(1.15); z-index: 50; }
    .map-marker-sn { font-size: 14px; font-weight: 900; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.3); pointer-events: none; }
    /* Static Course Markers */
    .static-div-icon { background: transparent; border: none; }
    .static-marker { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
    .static-marker-bubble { 
        background: white; 
        color: #4b5563; 
        font-weight: 800; 
        font-size: 11px; 
        width: 20px; 
        height: 20px; 
        border-radius: 50%; 
        border: 2px solid #9ca3af; 
        display: flex; 
        align-items: center; 
        justify-content: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: all 0.2s;
    }
    .static-marker-bubble:hover {
        transform: scale(1.2);
        border-color: #4b5563;
        z-index: 1000;
    }

    /* Leaflet Popup Styling */
    .driver-popup .leaflet-popup-content-wrapper { border-radius: 12px; padding: 0; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); }
    .driver-popup .leaflet-popup-content { margin: 0; width: 220px !important; }
    .driver-popup .leaflet-popup-tip { background: white; }
    
    /* Dark mode overrides for popup */
    .dark .driver-popup .leaflet-popup-content-wrapper { background: #1f2937; color: white; }
    .dark .driver-popup .leaflet-popup-tip { background: #1f2937; }

    /* Sidebar Scrollbar */
    #maraton-active-list::-webkit-scrollbar { width: 4px; }
    #maraton-active-list::-webkit-scrollbar-track { background: transparent; }
    #maraton-active-list::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; }
    #maraton-active-list::-webkit-scrollbar-thumb:hover { background: #d1d5db; }

    @keyframes ping { 75%, 100% { transform: scale(2.2); opacity: 0; } }


    `;
  document.head.appendChild(s);
}

// ---------- State ----------
let competitionId = null;
let allEquipages = [];
let startTimes = {};
const allMarathonData = new Map(); // Derived: { ...timing, ...state }
const marathonStateMap = new Map();  // From 'maraton' collection
const marathonTimingMap = new Map(); // From 'maraton-timing' collection
const activeEquipages = new Map();
let tickerInterval = null;
let unsubscribes = [];
let isGloballyPaused = false;
let pauseStartTime = 0;
let viewMode = 'map'; // 'map' as default
let maratonConfig = null; // Local copy for map settings
let lastRenderedGridHash = ""; // To prevent flickering
let loadToken = 0;


// ---------- Helpers ----------

// Hämta/beräkna upparbetad tid (för att kunna återuppta klockan korrekt)
function getExistingElapsedMs(docData, context) {
  if (!docData) return 0;

  // Hinder:
  if (context === 'obstacle') {
    return docData.liveObstacleTimeMs || 0;
  }

  // Etapper: Använd utils för att hitta duration (säkrare)
  const stageKey = (context === 'transport') ? 'transport' : context;
  const dur = stageDurationMsSaved(docData, stageKey);
  if (Number.isFinite(dur)) return dur;

  return 0;
}

function calculateTotalPenalty(docData, equipage) {
  if (!docData || !equipage) return null;
  // Use centralized TR-compliant calculation
  const res = calculateMarathonResult(equipage, docData, docData);
  return res.totalPenalty;
}

function calculateETA(startTimeMs, equipage, stage, nowMs = Date.now()) {
  // Använd limitsFor för att få idealtid och regler
  const limits = limitsFor(equipage, stage);
  if (!startTimeMs || !limits?.ideal) return '—';

  // Hämta aktuell paus-tid från utils (som har koll på globala fönster)
  const p = pausedMsSince(startTimeMs, nowMs);

  // Starttid + Idealtid (sek -> ms) + Paus
  const etaTimestamp = startTimeMs + (limits.ideal * 1000) + p;
  return toTimeLabel(etaTimestamp);
}

function summarizeObstacles(docData) {
  const arr = getObstacleArray(docData);
  const items = arr
    .map(o => {
      const n = Number(o.number || o.obstacleNumber || o.id);
      const { timeSec, penalty, eliminated } = obstacleValues(o);
      // Prefer timeSec (seconds), fallback to penalty if no time exists
      // If we use timeSec, it is 's', if we fallback to penalty, it might be 'p' (or 's' in legacy)
      const val = Number.isFinite(timeSec) ? timeSec : penalty;
      const isTime = Number.isFinite(timeSec);

      return { n, val, isTime, elim: eliminated };
    })
    .filter(x => Number.isFinite(x.n) && x.n > 0)
    .sort((a, b) => a.n - b.n)
    .slice(0, 8);

  let sum = 0, eliminated = false;
  for (const it of items) {
    if (it.elim) eliminated = true;
    if (Number.isFinite(it.val)) sum += it.val;
  }
  return { items, sum: eliminated ? Infinity : sum, eliminated };
}

// Beräknar statistik (Best & Avg) för varje gate (A, B...) i ett hinder för en given klass
function calculateClassSplitStats(className, obstacleNumber) {
  const stats = {}; // { 'A': { min: 1234, sum: 5000, count: 4 }, 'B': ... }

  // Hämta 'färdiga' resultat från minnet
  for (const [sn, data] of allMarathonData.entries()) {
    const eq = allEquipages.find(e => String(e.startNumber) === sn);
    if (!eq || eq.className !== className) continue;

    // Hitta resultatet för detta hinder
    const obsResults = data.obstacles || [];
    const res = obsResults.find(o => Number(o.number) === Number(obstacleNumber));

    if (res && res.gateSplits && res.gateSplits.length > 0 && res.timeMs) { // timeMs check ensures validity
      // 1. Försök hitta 'enteredAt' direkt på resultatet (nytt robust sätt)
      let startTs = res.enteredAt;

      // 2. Fallback: Hämta från 'obstacleTimes' (gammalt sätt)
      if (!startTs) {
        const times = data.obstacleTimes?.[String(obstacleNumber)];
        startTs = times?.enteredAt || times?.enteredAtClient;
      }

      // Normalisera starttid
      if (startTs && startTs.toMillis) startTs = startTs.toMillis();
      else if (typeof startTs === 'string') startTs = new Date(startTs).getTime();

      if (!startTs || isNaN(startTs)) continue;

      // Iterera splits
      res.gateSplits.forEach(s => {
        if (!s.char || s.char !== s.char.toUpperCase()) return; // Skip lower
        let ts = s.ts;
        if (ts && ts.toMillis) ts = ts.toMillis();
        else if (typeof ts === 'string') ts = new Date(ts).getTime();

        if (!ts) return;

        const diff = ts - startTs;
        if (diff <= 0) return;

        if (!stats[s.char]) stats[s.char] = { min: Infinity, sum: 0, count: 0 };

        if (diff < stats[s.char].min) stats[s.char].min = diff;
        stats[s.char].sum += diff;
        stats[s.char].count++;
      });
    }
  }

  // Finalize averages
  const final = {};
  for (const char in stats) {
    final[char] = {
      best: stats[char].min,
      avg: stats[char].sum / stats[char].count
    };
  }
  return final;
}

// Beräknar statistik (Best & Avg) för totalstraff på ett specifikt hinder i en klass
function calculateClassObstacleStats(className, obstacleNumber) {
  let min = Infinity;
  let sum = 0;
  let count = 0;

  for (const [sn, data] of allMarathonData.entries()) {
    const eq = allEquipages.find(e => String(e.startNumber) === sn);
    if (!eq || eq.className !== className) continue;

    const obsResults = data.obstacles || [];
    const res = obsResults.find(o => Number(o.number) === Number(obstacleNumber));

    if (res && Number.isFinite(res.penalty) && !res.eliminated) {
      if (res.penalty < min) min = res.penalty;
      sum += res.penalty;
      count++;
    }
  }

  if (count === 0) return null;

  return {
    best: min,
    avg: sum / count,
    count
  };
}

// ---------- Modal Logic ----------

// Här anropar vi modalen direkt med Monitorns egen data!
// Inga omvägar via resultat-sidan.
async function openMarathonDetailsModal(startNumber) {
  if (!competitionId) return;

  // Hitta rätt ekipage-objekt
  const snStr = String(startNumber);

  // Skicka 'allEquipages' och 'allMarathonData' som vi har laddat här i Monitorn
  await showDetailsModal(snStr, allEquipages, allMarathonData);
}

// Expose to window for map interaction
window.openMarathonDetailsModal = openMarathonDetailsModal;


// ---------- UI Rendering ----------
function renderLayout() {
  const comp = getGlobalState('currentCompetition');
  const root = document.getElementById('page-maraton-monitor');
  if (!root) return;

  root.innerHTML = `
  <div class="container mx-auto p-4 md:p-8 transition-all duration-500" id="maraton-monitor-container">
    <div class="mb-4">
        ${getCompetitionHeader(comp, t('marathon_monitor_title'))}
    </div>
      <div id="pause-status-banner" class="hidden p-4 mb-4 text-center font-bold text-white bg-red-600 rounded-lg">
        ${t('paused_banner')}
      </div>

      <div id="summary-stats" class="grid grid-cols-3 gap-4 mb-6 text-center"></div>

      <!-- MAIN LIVE AREA (Now at the top) -->
      <div class="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-2">
        <h2 class="text-xl font-bold dark:text-white">${t('on_course')}</h2>
        <div class="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
           <button id="maratonViewGridBtn" class="px-4 py-1.5 rounded-md text-sm font-bold transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}">
              📊 Lista
           </button>
           <button id="maratonViewMapBtn" class="px-4 py-1.5 rounded-md text-sm font-bold transition-all ${viewMode === 'map' ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}">
              🗺️ Karta
           </button>
        </div>
      </div>

      <div id="monitor-content-area" class="mb-10">
        <div id="monitor-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 ${viewMode === 'map' ? 'hidden' : ''}"></div>
        <div id="monitor-map-container" class="w-full ${viewMode === 'grid' ? 'hidden' : ''}"></div>
      </div>

      <!-- SECONDARY LISTS -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div id="upcoming-wrapper" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow overflow-hidden h-[400px]">
            <div id="upcoming-panel"></div>
        </div>
        <div id="finished-wrapper" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow overflow-hidden h-[400px]">
             <div id="finished-panel"></div>
        </div>
      </div>
    </div>
  `;

  const gridBtn = document.getElementById('maratonViewGridBtn');
  const mapBtn = document.getElementById('maratonViewMapBtn');

  if (gridBtn) gridBtn.addEventListener('click', () => switchView('grid'));
  if (mapBtn) mapBtn.addEventListener('click', () => switchView('map'));
}

function switchView(mode) {
  try {
    viewMode = mode;
    const grid = document.getElementById('monitor-grid');
    const mapContainer = document.getElementById('monitor-map-container');
    const gridBtn = document.getElementById('maratonViewGridBtn');
    const mapBtn = document.getElementById('maratonViewMapBtn');

    if (!grid || !mapContainer || !gridBtn || !mapBtn) {
      console.warn('Elements missing in switchView');
      return;
    }

    if (mode === 'grid') {
      lastRenderedGridHash = ""; // Force rebuild
      // Show Grid
      grid.classList.remove('hidden');
      grid.classList.add('grid');

      // Hide Map
      mapContainer.classList.add('hidden');
      mapContainer.classList.remove('block');

      gridBtn.className = 'px-4 py-1.5 rounded-md text-sm font-bold transition-all bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-300';
      mapBtn.className = 'px-4 py-1.5 rounded-md text-sm font-bold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200';

      try { destroyMap(); } catch (e) { }
    } else {
      // Hide Grid
      grid.classList.add('hidden');
      grid.classList.remove('grid');

      // Show Map
      mapContainer.classList.remove('hidden');
      mapContainer.classList.add('block');

      gridBtn.className = 'px-4 py-1.5 rounded-md text-sm font-bold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200';
      mapBtn.className = 'px-4 py-1.5 rounded-md text-sm font-bold transition-all bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-300';
    }
    renderMonitor();
  } catch (err) {
    console.error('Error in switchView:', err);
  }
}

function renderSummaryStats() {
  const statsEl = document.getElementById('summary-stats');
  if (!statsEl) return;

  const onCourse = activeEquipages.size;
  let finishedCount = 0;
  for (const data of allMarathonData.values()) {
    if (stageStopTS(data, 'B')) { // Använd utils för säker koll
      finishedCount++;
    }
  }
  const notStarted = allEquipages.length - onCourse - finishedCount;

  statsEl.innerHTML = `
  <div class="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg"><div class="text-2xl font-bold dark:text-blue-100">${onCourse}</div><div class="text-sm text-blue-800 dark:text-blue-200 font-semibold">${t('on_course')}</div></div>
        <div class="bg-green-50 dark:bg-green-900/30 p-3 rounded-lg"><div class="text-2xl font-bold dark:text-green-100">${finishedCount}</div><div class="text-sm text-green-800 dark:text-green-200 font-semibold">${t('finished_count')}</div></div>
        <div class="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg"><div class="text-2xl font-bold dark:text-gray-200">${notStarted < 0 ? 0 : notStarted}</div><div class="text-sm text-gray-600 dark:text-gray-400 font-semibold">${t('remaining_to_start')}</div></div>
`;
}

function renderUpcomingPanel() {
  const panelEl = document.getElementById('upcoming-panel');
  if (!panelEl) return;

  // Filter: Not started yet
  // Started means: Has start time for 'A' OR 'transport' (or 'B' if they skipped others)
  const upcoming = allEquipages
    .filter(eq => {
      const sn = String(eq.startNumber);
      const data = allMarathonData.get(sn);
      if (!data) return true; // No data = definitely not started

      const started = stageStartTS(data, 'A') || stageStartTS(data, 'transport') || stageStartTS(data, 'B');
      return !started;
    })
    .sort((a, b) => {
      const timeA = startTimes[String(a.startNumber)]?.maraton || '99:99';
      const timeB = startTimes[String(b.startNumber)]?.maraton || '99:99';
      return timeA.localeCompare(timeB);
    })
    .slice(0, 5);

  let content = `<h3 class="text-lg font-bold mb-2 dark:text-white">${t('next_start')}</h3>`;
  if (upcoming.length === 0) {
    content += `<p class="text-sm text-gray-500 dark:text-gray-400" > ${t('no_more_starts')}</p> `;
  } else {
    content += upcoming.map(eq => {
      const rawTime = startTimes[String(eq.startNumber)]?.maraton;
      const startTime = rawTime ? toTimeLabel(rawTime) : '—';
      return `
  <button class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1"
data-sn="${eq.startNumber}" >
        <div class="flex items-center gap-3 min-w-0">
          <span class="font-bold w-8 shrink-0 text-center dark:text-white">#${eq.startNumber}</span>
          <span class="truncate dark:text-gray-300">${eq.driverName || ''}</span>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <div class="flex items-center gap-1 justify-start" title="${eq.clubName || ''}">
            ${getFlagHtml(eq)}
            ${getClubLogoHtml(eq)}
          </div>
          <span class="font-semibold text-gray-800 dark:text-gray-200 w-20 text-right">${startTime}</span>
        </div>
      </button>
  `;
    }).join('');
  }

  panelEl.innerHTML = content;
  panelEl.querySelectorAll('button[data-sn]').forEach(btn => {
    btn.addEventListener('click', () => openMarathonDetailsModal(btn.getAttribute('data-sn')));
  });
}

function renderFinishedPanel() {
  const panelEl = document.getElementById('finished-panel');
  if (!panelEl) return;

  // Compute finished list dynamically
  const finished = [];
  for (const [sn, data] of allMarathonData.entries()) {
    const stopB = stageStopTS(data, 'B');
    if (stopB) {
      const eq = allEquipages.find(e => String(e.startNumber) === sn);
      if (eq) {
        finished.push({
          sn,
          name: eq.driverName,
          finishTime: stopB,
          clubName: eq.clubName,
          country: eq.country,
          totalPenalty: calculateTotalPenalty(data, eq),
          // Store eq for flag/logo helpers if needed, or just pass eq to helpers
          eqObj: eq
        });
      }
    }
  }

  // Sort by finishTime descending (latest first)
  finished.sort((a, b) => b.finishTime - a.finishTime);
  const display = finished.slice(0, 5);

  let content = `<h3 class="text-lg font-bold mb-2 dark:text-white">${t('recently_finished')}</h3>`;
  if (display.length === 0) {
    content += `<p class="text-sm text-gray-500 dark:text-gray-400" > ${t('no_finished_yet')}</p> `;
  } else {
    content += display.map(fin => {
      const penaltyText = fin.totalPenalty === Infinity
        ? 'ELIM'
        : (Number.isFinite(fin.totalPenalty) ? fin.totalPenalty.toFixed(2) + ' p' : '—');

      return `
  <button class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1"
data-sn="${fin.sn}" >
              <div class="flex items-center gap-3 min-w-0">
                <span class="font-bold w-8 shrink-0 text-center dark:text-white">#${fin.sn}</span>
                <span class="truncate dark:text-gray-300">${fin.name || ''}</span>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <div class="flex items-center gap-1 justify-start" title="${fin.clubName || ''}">
                  ${getFlagHtml(fin.eqObj)}
                  ${getClubLogoHtml(fin.eqObj)}
                </div>
                <span class="font-semibold text-gray-800 dark:text-gray-200 w-20 text-right">${toTimeLabel(fin.finishTime)}</span>
                <span class="font-bold text-blue-700 dark:text-blue-400 w-20 text-right">
                    ${penaltyText}
                </span>
              </div>
            </button>
  `;
    }).join('');
  }
  panelEl.innerHTML = content;
  panelEl.querySelectorAll('button[data-sn]').forEach(btn => {
    btn.addEventListener('click', () => openMarathonDetailsModal(btn.getAttribute('data-sn')));
  });
}

function renderMonitor() {
  const grid = document.getElementById('monitor-grid');
  const mapContainer = document.getElementById('monitor-map-container');
  if (!grid || !mapContainer) return;

  if (viewMode === 'map') {
    if (!maratonConfig) {
      mapContainer.innerHTML = `<div class="p-10 text-center text-gray-400 italic">${t('loading_map') || 'Laddar karta...'}</div>`;
      return;
    }
    renderMap(mapContainer, activeEquipages, maratonConfig?.mapSettings);
    return;
  }

  if (activeEquipages.size === 0) {
    grid.innerHTML = `<div class="col-span-full text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-md text-gray-500 dark:text-gray-400">${t('no_active_equipages')}</div>`;
    lastRenderedGridHash = "empty";
    return;
  }

  const sorted = Array.from(activeEquipages.values()).sort((a, b) => a.equipageInfo.startNumber - b.equipageInfo.startNumber);
  const currentHash = sorted.map(a => `${a.equipageInfo.startNumber}:${a.task.name}`).join('|');

  // 1. Structural update (only if order/tasks changed)
  if (currentHash !== lastRenderedGridHash) {
    grid.innerHTML = sorted.map(active => {
      const eq = active.equipageInfo;
      const isFlash = active.task.type === 'result_flash';

      if (isFlash) {
        return `<div id="card-${eq.startNumber}" data-sn="${eq.startNumber}" class="h-full"></div>`;
      }

      return `
     <div class="card-base relative bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 flex flex-col justify-between border-l-4 ${active.task.type === 'obstacle' ? 'border-amber-500' : 'border-blue-500'} h-full transition-all duration-300" data-sn="${eq.startNumber}" id="card-${eq.startNumber}">
       <div id="warning-${eq.startNumber}"></div>
           <div>
             <div class="flex justify-between items-start">
               <h3 class="text-lg font-bold dark:text-white">#${eq.startNumber} ${eq.driverName}</h3>
               <div class="flex flex-col items-end gap-1">
                   <span class="task-badge px-2 py-0.5 text-xs font-semibold rounded-full ${active.task.type === 'obstacle' ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200' : 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200'}">
                   ${active.task.name}
                   </span>
               </div>
             </div>
              <div class="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2 mt-1 mb-2 flag-logo-row">
                ${getFlagHtml(eq)}
                ${getClubLogoHtml(eq)}
                <span>${eq.className}</span>
                <span class="rank-badge inline-block" id="rank-${eq.startNumber}"></span>
              </div>
           </div>
   
           <div class="text-center my-4">
             <div id="timer-${eq.startNumber}" class="timer-display text-4xl font font-bold tabular-nums dark:text-white">00:00,00</div>
             <div id="info-${eq.startNumber}"></div>
             <div id="splits-${eq.startNumber}"></div>
             <div id="progress-${eq.startNumber}"></div>
             <div class="flex justify-center gap-4 mt-2">
               <div id="startTime-${eq.startNumber}"></div>
               <div id="eta-${eq.startNumber}"></div>
             </div>
           </div>
   
           <div class="mt-auto" id="bottom-${eq.startNumber}"></div>
        </div>
        `;
    }).join('');

    grid.querySelectorAll('[data-sn]').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => openMarathonDetailsModal(card.getAttribute('data-sn')));
    });

    lastRenderedGridHash = currentHash;
  }

  // 2. Atomic updates
  sorted.forEach(active => {
    const eq = active.equipageInfo;
    const sn = String(eq.startNumber);
    const card = document.getElementById(`card-${sn}`);
    if (!card) return;

    // Handle Flash Results (different template)
    if (active.task.type === 'result_flash') {
      const flashData = active.task.data;
      const { timeSec, penalty } = obstacleValues(flashData);
      const timeStr = Number.isFinite(timeSec) ? timeSec.toFixed(2) + 's' : '—';
      const stats = calculateClassObstacleStats(eq.className, Number(flashData.number || flashData.obstacleNumber));

      let comparisonHtml = '';
      let cardColor = 'bg-white dark:bg-gray-800 border-blue-500 dark:border-blue-400';

      if (stats && Number.isFinite(penalty)) {
        if (penalty <= stats.best + 0.01) {
          cardColor = 'bg-green-50 dark:bg-green-900/20 border-green-600 dark:border-green-500 ring-4 ring-green-100 dark:ring-green-900/50';
          comparisonHtml = `<div class="text-xl font-black text-green-700 dark:text-green-300 uppercase tracking-wider animate-pulse">${t('best_in_class')}</div>`;
        } else if (penalty < stats.avg) {
          cardColor = 'bg-blue-50 dark:bg-blue-900/20 border-blue-600 dark:border-blue-500 ring-4 ring-blue-100 dark:ring-blue-900/50';
          comparisonHtml = `<div class="text-lg font-bold text-blue-700 dark:text-blue-300">${t('better_than_avg')}</div>`;
        } else {
          comparisonHtml = `<div class="text-md font-semibold text-gray-500 dark:text-gray-400">${t('time_registered')}</div>`;
        }
        comparisonHtml += `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${t('avg_short')}: ${(stats.avg / 0.25).toFixed(2)}s (${stats.avg.toFixed(2)}p)</div>`;
      }

      card.className = `relative rounded-lg shadow-xl p-6 flex flex-col justify-center items-center border-l-8 ${cardColor} h-full transform scale-105 transition-transform`;
      card.innerHTML = `
             <div class="absolute top-2 right-2 text-xs font-mono text-gray-400">RESULTAT</div>
             <h3 class="text-2xl font-bold mb-2 text-center dark:text-white">#${eq.startNumber} ${eq.driverName}</h3>
             <div class="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-6">${active.task.name}</div>
             <div class="text-6xl font-extrabold mb-4 tracking-tight ${isFinite(penalty) ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-400'}">${timeStr}</div>
             <div class="text-center mb-4 font-sans">${comparisonHtml}</div>
             <div class="mt-auto flex gap-4 text-sm text-gray-500 dark:text-gray-400 font-sans">
                 <span>${t('penalty')}: ${Number.isFinite(penalty) ? penalty.toFixed(2) : '—'}</span>
                 <span>${t('knockdown')}: ${flashData.knockdowns || 0}</span>
             </div>
      `;
      return;
    }

    // Normal Item Updates
    const stageKey = active.task.key;
    const doc = allMarathonData.get(sn) || active.data || {};
    const limits = limitsFor(eq, stageKey);
    const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();

    // Timer calculation: distinguish between virtual (already adjusted) and raw timestamps
    let elapsedMs = 0;
    if (active.fixedElapsedMs != null) {
      elapsedMs = active.fixedElapsedMs;
    } else if (active.timerBaseMs) {
      const diff = tickTimeNow - active.timerBaseMs;
      // ONLY subtract global pauses if the base is RAW. Virtual bases already have them removed.
      const pauseToSubtract = active.timerIsVirtual ? 0 : pausedMsSince(active.timerBaseMs, tickTimeNow);
      elapsedMs = diff - pauseToSubtract + (active.pausedMs || 0);
    }

    // Timer
    const timerEl = document.getElementById(`timer-${sn}`);
    if (timerEl) {
      const live = formatMsLive(elapsedMs);
      if (timerEl.textContent !== live) timerEl.textContent = live;
    }

    // Warning
    const warnEl = document.getElementById(`warning-${sn}`);
    if (warnEl) {
      if (limits?.timeLimit && elapsedMs > (limits.timeLimit * 1000)) {
        card.classList.add('is-overdue');
        if (!warnEl.innerHTML) warnEl.innerHTML = `<div class="absolute top-2 right-2 text-red-600 animate-pulse"><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>`;
      } else {
        card.classList.remove('is-overdue');
        warnEl.innerHTML = '';
      }
    }

    // Target Time (To Beat)
    const infoEl = document.getElementById(`info-${sn}`);
    if (infoEl) {
      if (active.task.type === 'obstacle') {
        let bestSec = Infinity;
        for (const [s_sn, s_data] of allMarathonData.entries()) {
          const s_eq = allEquipages.find(e => String(e.startNumber) === s_sn);
          if (!s_eq || s_eq.className !== eq.className) continue;
          const s_res = s_data.obstacles?.find(o => Number(o.number) === Number(doc.currentObstacle));
          if (s_res?.timeInSeconds && !s_res.eliminated) {
            if (s_res.timeInSeconds < bestSec) bestSec = s_res.timeInSeconds;
          }
        }
        infoEl.innerHTML = bestSec !== Infinity ? `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">${t('to_beat')}: <span class="font-bold text-green-700 dark:text-green-400">${bestSec.toFixed(2)}s</span></div>` : '';
      } else {
        infoEl.innerHTML = '';
      }
    }

    // Splits
    const splitEl = document.getElementById(`splits-${sn}`);
    if (splitEl) {
      if (active.task.type === 'obstacle' && doc.live_gateSplits?.length > 0) {
        let obsStart = doc.live_staticStartAt || doc.liveObstacleStartAt;
        if (obsStart && obsStart.toMillis) obsStart = obsStart.toMillis();
        if (obsStart) {
          const classStats = calculateClassSplitStats(eq.className, doc.currentObstacle);
          const uniqueSplits = [];
          const seen = new Set();
          for (const s of doc.live_gateSplits) {
            if (s.char && s.char === s.char.toUpperCase() && !seen.has(s.char)) {
              uniqueSplits.push(s); seen.add(s.char);
            }
          }
          const items = uniqueSplits.map(s => {
            let ts = s.ts?.toMillis ? s.ts.toMillis() : s.ts;
            const diff = ts - obsStart;
            const stat = classStats[s.char];
            let cls = 'bg-gray-100 text-gray-700 border-gray-200';
            if (stat) {
              if (diff <= stat.best + 100) cls = 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border-green-300 ring-1 ring-green-400 font-bold';
              else if (diff < stat.avg) cls = 'bg-blue-50 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-200';
              else cls = 'bg-amber-50 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-200';
            }
            return `<span class="${cls} px-1.5 py-0.5 rounded border text-[10px] font-mono">${s.char}: ${(diff / 1000).toFixed(1)}s</span>`;
          }).slice(-8);
          splitEl.innerHTML = `<div class="flex flex-wrap justify-center gap-1 mt-2 mb-1 cursor-help">${items.join('')}</div>`;
        }
      } else {
        splitEl.innerHTML = '';
      }
    }

    // Bottom (Chips)
    const botEl = document.getElementById(`bottom-${sn}`);
    if (botEl) {
      const obs = summarizeObstacles(doc);
      if (obs.items.length) {
        const chips = obs.items.map(it => {
          const lbl = it.elim ? 'ELIM' : (Number.isFinite(it.val) ? it.val.toFixed(2) + (it.isTime ? ' s' : ' p') : '—');
          const isLive = Number(doc.currentObstacle) === it.n;
          return `<span class="chip ${it.elim ? 'elim' : ''} ${isLive ? 'chip-live' : ''} bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200" title="Hinder ${it.n}">H${it.n}: ${lbl}</span>`;
        }).join('');

        // FIX: Verify live total includes stage penalty
        let liveStageP = 0;
        if (active.task.type === 'stage') {
          const { points, elim } = stagePenaltyFromMs(elapsedMs, eq, active.task.key);
          liveStageP = elim ? Infinity : (Number.isFinite(points) ? points : 0);
        }

        const res = calculateMarathonResult(eq, doc, doc);
        let tot = res.totalPenalty;

        if (active.task.type === 'stage' && liveStageP > 0 && Number.isFinite(tot)) {
          const baseP = res.stages[active.task.key]?.timePenalty || 0;
          if (baseP === 0) {
            tot += liveStageP;
          }
        }

        const totLbl = (tot === Infinity) ? 'ELIM' : (Number.isFinite(tot) ? tot.toFixed(2) + ' p' : '—');
        botEl.innerHTML = `
          <div class="pt-3 border-t dark:border-gray-700 mt-2 chip-container">
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">${t('obstacles')}</div>
            <div class="flex flex-wrap gap-1.5 mb-2">${chips}</div>
            <div class="flex justify-between items-center text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded">
              <div><span class="text-gray-500 dark:text-gray-400">${t('total')}:</span> <span class="font-semibold ml-1 dark:text-gray-200">${totLbl}</span></div>
            </div>
          </div>`;
      } else {
        botEl.innerHTML = '';
      }
    }

    // Rank
    const rankEl = document.getElementById(`rank-${sn}`);
    if (rankEl) {
      const classMates = allEquipages.filter(e => e.className === eq.className);
      const rankedList = classMates.map(e => {
        const d = allMarathonData.get(String(e.startNumber));
        const p = calculateTotalPenalty(d, e);
        return { sn: e.startNumber, p: (p === null ? 0 : p) };
      }).sort((a, b) => {
        if (a.p === Infinity && b.p === Infinity) return 0;
        if (a.p === Infinity) return 1;
        if (b.p === Infinity) return -1;
        return a.p - b.p;
      });
      const myIndex = rankedList.findIndex(x => x.sn === eq.startNumber);
      const placement = (myIndex !== -1) ? myIndex + 1 : '-';
      rankEl.innerHTML = `<div class="text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded inline-block ml-2" title="${t('dressage_placing')}">${t('rank_short')}: ${placement}</div>`;
    }

    // ETA / StartTime
    const stEl = document.getElementById(`startTime-${sn}`);
    const etaEl = document.getElementById(`eta-${sn}`);
    if (stEl && etaEl) {
      if (active.task.type === 'stage' && (stageKey === 'A' || stageKey === 'B')) {
        const stageStart = stageStartTS(doc, stageKey);
        if (stageStart) {
          const lblStart = toTimeLabel(stageStart);
          const lblETA = calculateETA(stageStart, eq, stageKey, tickTimeNow);
          stEl.innerHTML = `<div class="text-xs text-gray-500 flex flex-col items-center"><span>${t('start_time')}</span><span class="font-bold text-gray-800 dark:text-gray-200">${lblStart}</span></div>`;
          etaEl.innerHTML = `<div class="text-xs text-gray-500 flex flex-col items-center"><span>ETA</span><span class="font-bold text-gray-800 dark:text-gray-200">${lblETA}</span></div>`;
        } else {
          stEl.innerHTML = ''; etaEl.innerHTML = '';
        }
      } else {
        stEl.innerHTML = ''; etaEl.innerHTML = '';
      }
    }

  });
}

// ---------- Ticker Logic ----------
function ensureTicker() {
  if (tickerInterval) return;
  tickerInterval = setInterval(() => {
    // DO NOT return early if isGloballyPaused! 
    // We still need to run the loop so that the map/grid UI calculations 
    // are able to execute with `tickTimeNow = pauseStartTime`.
    // Returning early freezes the entire monitor UI from drawing anything.

    // 1. Update internal state if needed (mostly redundant now with unified time source)
    activeEquipages.forEach(active => {
      // State updates could go here if we had any non-UI logic
    });

    // 2. CONSOLIDATED UI UPDATES (Once per tick)
    const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();
    if (viewMode === 'map') {
      updateSidebarMap(activeEquipages, tickTimeNow);
    } else {
      renderMonitor();
    }
  }, 100);
}

function stopTicker() {
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
}

// ---------- Data Logic & Listeners ----------

function rebuildMarathonData(sn) {
  const t = marathonTimingMap.get(sn) || {};
  const s = marathonStateMap.get(sn) || {};

  // MERGE: State overrides Timing (to respect manual edits)
  const merged = { ...t, ...s };

  allMarathonData.set(sn, merged);
  evaluateActiveState(sn, merged);
}


// ---------- Entrypoint ----------
export async function load() {
  __unload();
  const currentLoadToken = ++loadToken;

  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id;
  const root = document.getElementById('page-maraton-monitor');

  if (!competitionId) {
    if (root) root.innerHTML = '<p class="p-8 text-center text-gray-600">Ingen tävling vald.</p>';
    return;
  }

  renderLayout();
  injectMonitorStylesOnce();

  try {
    const [equipagesRaw, startTimesData, configData] = await Promise.all([
      getEquipages(competitionId),
      getConfig(competitionId, 'startTimes').catch(() => ({})),
      getConfig(competitionId, 'maratonConfig').catch(() => null)
    ]);
    if (currentLoadToken !== loadToken) return;

    allEquipages = equipagesRaw || [];
    startTimes = startTimesData || {};
    maratonConfig = configData;
    if (maratonConfig) setMarathonConfig(maratonConfig);

    await ensureClubLogosLoaded();
    if (currentLoadToken !== loadToken) return;

    // START LISTENERS
    // 1. Equipages / Status
    const unSubEquipages = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'equipages'), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        // Refresh equipage info if changed
        const data = change.doc.data();
        const sn = String(data.startNumber);
        const idx = allEquipages.findIndex(e => String(e.startNumber) === sn);
        if (idx >= 0) allEquipages[idx] = { ...allEquipages[idx], ...data };
        else allEquipages.push(data);
      });
      renderUpcomingPanel();
    });
    unsubscribes.push(unSubEquipages);

    // 2. Marathon Data Collection (State / Manual)
    const unSubMarathon = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton'), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const d = change.doc.data();
        const sn = String(change.doc.id);

        // Update State Map
        marathonStateMap.set(sn, d);

        // Rebuild derived data
        rebuildMarathonData(sn);
      });

      renderSummaryStats();

      // Initial render
      renderMonitor();
      renderUpcomingPanel();
      renderFinishedPanel();
    });
    unsubscribes.push(unSubMarathon);

    // [FIX] Listen to maraton-timing (live stage times) and merge!
    // This ensures consistency with total-resultat.js and maraton-resultat.js
    const unSubTiming = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton-timing'), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const d = change.doc.data();
        const sn = String(change.doc.id);

        // Update Timing Map
        marathonTimingMap.set(sn, d);

        // Rebuild derived data
        rebuildMarathonData(sn);
      });
      // Re-render relevant parts (or let ticker handle it, but specific updates are better)
      if (viewMode === 'map') renderMonitor(); // Map needs live updates
      renderSummaryStats();
      renderUpcomingPanel();
      renderFinishedPanel();
    });
    unsubscribes.push(unSubTiming);

    // 3. Maraton Config (Live updates for map) - MOVED OUT OF MARATHON LISTENER
    const unSubConfig = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'maratonConfig'), (snap) => {
      if (snap.exists()) {
        maratonConfig = snap.data();
        setMarathonConfig(maratonConfig);
        if (viewMode === 'map') renderMonitor();
      }
    });
    unsubscribes.push(unSubConfig);

    // 3. Global Pause
    const unSubPause = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus'), (docSnap) => {

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

        const banner = document.getElementById('pause-status-banner');
        if (banner) {
          if (isGloballyPaused) {
            banner.classList.remove('hidden');
            banner.textContent = `TÄVLINGEN PAUSAD SEDAN ${toTimeLabel(pauseStartTime)} `;
          } else {
            banner.classList.add('hidden');
          }
        }
      }
    });
    unsubscribes.push(unSubPause);

    ensureTicker();

  } catch (err) {
    if (currentLoadToken !== loadToken) return;
    console.error("Error loading Marathon Monitor:", err);
    if (root) root.innerHTML = '<p class="text-red-600 p-4">Kunde inte ladda data.</p>';
  }
}

function evaluateActiveState(sn, data) {
  // Simplify: If 'started' and not 'finished', it is active.
  // Use utils to check status
  if (!data) return;
  const eq = allEquipages.find(e => String(e.startNumber) === sn);
  if (!eq) return;

  const {
    startA,
    startT,
    startB,
    stopA,
    stopT,
    obstacleIsLive,
    hasActiveStageA,
    hasActiveStageT,
    hasActiveStageB,
    isActive
  } = getMarathonActiveState(data);
  const hasLiveObstacle = obstacleIsLive;

  // A reset/restarted obstacle can still carry an old B finish timestamp.
  // Do not treat that as finished while a live obstacle or result flash is active.
  if (stageStopTS(data, 'B') && !hasLiveObstacle && !data.live_flash_result) {
    activeEquipages.delete(sn);
    return;
  }

  if (!isActive) {
    activeEquipages.delete(sn);
    return;
  }

  // Determine current task
  let task = { name: 'På Banan', type: 'unknown', key: 'unknown' };
  let startTime = 0;
  let obstacleStart = 0;
  let timerIsVirtual = false;
  let fixedElapsedMs = null; // New field for stopped timers

  if (hasActiveStageB || hasLiveObstacle) {
    task = { name: 'Etapp B', type: 'stage', key: 'B' };
    startTime = startB || 0;
    if (obstacleIsLive) {
      task = { name: `Hinder ${data.currentObstacle} `, type: 'obstacle', key: 'obstacle' };

      // --- LOGIC FIX: Check if running ---
      if (data.running === false && typeof data.liveObstacleTimeMs === 'number') {
        // Timer is stopped -> Use the static fixed time
        fixedElapsedMs = data.liveObstacleTimeMs;
      } else {
        // Timer is running -> Calculate start time
        // ROBUSTNESS: Prefer liveObstacleStartAt (the resume point) if it exists,
        // as it works best with data.liveObstacleTimeMs (accumulated).
        let obsStartTs = data.liveObstacleStartAt || data.live_staticStartAt;

        if (obsStartTs && obsStartTs.toMillis) obsStartTs = obsStartTs.toMillis();
        else if (typeof obsStartTs === 'string') obsStartTs = new Date(obsStartTs).getTime();

        // Fallback to timing array (raw entry time)
        if (!obsStartTs && data.obstacleTimes && data.obstacleTimes[data.currentObstacle]) {
          const ot = data.obstacleTimes[data.currentObstacle];
          const st = ot.enteredAt || ot.enteredAtClient;
          if (st) {
            if (st.toMillis) obsStartTs = st.toMillis();
            else obsStartTs = new Date(st).getTime();
          }
        }
        if (!obsStartTs && data.updatedAt) {
          if (data.updatedAt.toMillis) obsStartTs = data.updatedAt.toMillis();
          else obsStartTs = new Date(data.updatedAt).getTime();
        }
        if (!obsStartTs && data.running === true) {
          obsStartTs = Date.now();
        }
        obstacleStart = obsStartTs || 0;

        // If we are using live_staticStartAt, it is a VIRTUAL timestamp (already pause-adjusted)
        if (obstacleStart && !data.liveObstacleStartAt && data.live_staticStartAt) {
          timerIsVirtual = true;
        }
      }
    }
  } else if (hasActiveStageT) {
    task = { name: 'Transport', type: 'transport', key: 'transport' };
    startTime = startT;

    // Check if Transport is stopped
    if (stopT) {
      // Transport is finished.
      fixedElapsedMs = stageDurationMsSaved(data, 'transport');
    }

  } else if (hasActiveStageA) {
    const limitsA = limitsFor(eq, 'A');
    const isFixedTimeA = limitsA && limitsA.ideal > 0 && limitsA.max === limitsA.ideal && limitsA.min === 0;
    task = { name: isFixedTimeA ? 'Warm-up' : 'Etapp A', type: 'stage', key: 'A' };
    startTime = startA;

    // Check if A is stopped
    if (stopA) {
      // A is finished.
      fixedElapsedMs = stageDurationMsSaved(data, 'A');
    }
  }

  // Check for Flash Result
  if (data.live_flash_result) {
    const flashTs = data.live_flash_timestamp ? (data.live_flash_timestamp.toMillis ? data.live_flash_timestamp.toMillis() : new Date(data.live_flash_timestamp).getTime()) : 0;
    if (Date.now() - flashTs < 15000) { // Show for 15s
      task = { name: 'Resultat: Hinder ' + (data.live_flash_result.number || data.live_flash_result.obstacleNumber), type: 'result_flash', key: 'flash', data: data.live_flash_result };
    }
  }

  // Final base time and pause offset
  // If it's an obstacle, we use the specific obstacle entry/resume time.
  // Otherwise, we use the stage start time.
  const baseTime = (task.type === 'obstacle' && obstacleStart) ? obstacleStart : startTime;

  activeEquipages.set(sn, {
    equipageInfo: eq,
    data: data,
    task: task,
    startTime: startTime,
    obstacleStart: obstacleStart,
    // THE UNIFIED TIME SOURCE
    timerBaseMs: baseTime,
    timerIsVirtual: timerIsVirtual, // <-- Track if pauses should be subtracted
    fixedElapsedMs: fixedElapsedMs,
    // For obstacles, pausedMs is the accumulated time before the current segment (liveObstacleTimeMs).
    // For stages, it's any manual adjustment (durationMs).
    pausedMs: (task.type === 'obstacle') ? (data.liveObstacleTimeMs || 0) : (data.timing?.[task.key]?.durationMs || 0),
    isRunning: !isGloballyPaused,
    totalPenalty: calculateTotalPenalty(data, eq)
  });
}


export function __unload() {
  loadToken++;
  unsubscribes.forEach(u => {
    try { u && u(); } catch { }
  });
  unsubscribes = [];
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
  destroyMap();
  competitionId = null;
  allEquipages = [];
  startTimes = {};
  allMarathonData.clear();
  marathonStateMap.clear();
  marathonTimingMap.clear();
  activeEquipages.clear();
  isGloballyPaused = false;
  pauseStartTime = 0;
  maratonConfig = null;
  lastRenderedGridHash = "";
}


