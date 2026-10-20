// js/pages/precision-monitor.js
// En "speaker-vy" som visar det aktiva ekipaget i precision, samt nästa start och senaste resultat.

import { getGlobalState } from '../../main.js';
import { loadMergeSource, mergeGroupResolver } from '../../services/mergeConfigService.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getCompetitionHeader } from '../../ui/components.js';
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { standardPortAllowance, klassTempoData } from '../../data/competitionData.js';
import { showDetailsModal } from '../../ui/precisionModal.js'; // NYTT
import { getPortAllowanceCm, computeMaxSecondsForClass, getTrackLengthMeters, trackWidthFromEq, computePortWidth, calculatePrecisionResult, calculatePrecisionLiveResult } from '../../utils/precisionUtils.js';
import { assignPlaces, comparePrecisionRank, precisionGroupContext } from '../../core-engine/ranking.js';
import { getPrecisionFormat, getPrecisionRoundCourse } from '../../utils/precisionCalculation.js';
import { isAnyPrecisionRoundRunning, readPrecisionRound } from '../../utils/precisionRounds.js';
import {
  currentPrecisionRound,
  formatPrecisionRoundCell,
  formatPrecisionSeconds,
  isMultiRoundPrecisionFormat,
  latestPrecisionRoundWithData,
  precisionPlacingScore,
  precisionRoundLabel
} from './precisionRoundsDisplay.js';
import { t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { publishedStartTimes } from '../../utils/publishedStartTimes.js';
import { formatClockTime, timeValueToMs } from '../../utils/timeValueUtils.js';
import { compareByTimeThenStartNumber } from '../../utils/startNumberSort.js';
import { enterTvModeIfRequested, exitTvMode, tvModeLinkHtml } from '../shared/tvMode.js';
import { createConnectionBanner, resilientSnapshot } from '../../services/listenerErrorUtils.js';
import { renderMap, destroyMap } from './precision-monitor-map.js';
import {
  formatPrecisionMonitorPartPenalty,
  formatPrecisionMonitorPenalty
} from './precisionMonitorFormatUtils.js';

// ---------- State ----------
let competitionId = null;
let allEquipages = [];
// Class group for the class leader (a merged class is placed as one class)
let classGroupOf = (eq) => `CLASS:${eq?.className || ''}`;
let startTimes = {};
let precisionConfig = {}; // NYTT: För att lagra config
const allPrecisionData = new Map();
let currentDriver = null;
let leaderInClass = null; // NYTT: För att hålla koll på ledaren
const recentResults = [];
let tickerInterval = null;
let unsubscribes = [];
let lastRenderedUpcomingHash = null;
let lastRenderedResultsHash = null;
let lastDriverSn = "";
let currentView = 'list'; // 'list' or 'map'
let loadToken = 0;

// ---------- Helpers ----------
const formatMsLive = (ms) => {
  const t = Math.max(0, ms || 0);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(2, '0')}`;
};

// Strings, Firestore Timestamps, {seconds} objects and ms numbers
const formatTime = (isoOrTs) => formatClockTime(isoOrTs);

function getBestSplitExcept(className, gateId, excludeSn) {
    let bestElapsed = Infinity;
    for (const [sn, data] of allPrecisionData.entries()) {
        if (sn === excludeSn) continue;
        const eq = allEquipages.find(e => String(e.startNumber) === sn);
        if (eq && eq.className === className && data.gateSplits && data.gateSplits[gateId] && data.gateSplits['start']) {
            const elapsed = data.gateSplits[gateId] - data.gateSplits['start'];
            if (elapsed > 0 && elapsed < bestElapsed) {
                bestElapsed = elapsed;
            }
        }
    }
    return bestElapsed === Infinity ? null : bestElapsed;
}

function getSplitComparisonHTML(myElapsed, bestOtherElapsed) {
    if (bestOtherElapsed === null) return { colorClass: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800', diffStr: '' };
    
    const diffMs = myElapsed - bestOtherElapsed;
    const isFaster = diffMs < 0;
    const isEqual = diffMs === 0;
    
    const absDiff = Math.abs(diffMs);
    const m = Math.floor(absDiff / 60000);
    const s = Math.floor((absDiff % 60000) / 1000);
    const ds = Math.floor((absDiff % 1000) / 100);
    const formattedDiff = `${m > 0 ? m + ':' : ''}${String(s).padStart(m > 0 ? 2 : 1, '0')},${ds}s`;
    
    if (isFaster) {
        return {
            colorClass: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700',
            diffStr: `<span class="text-xs font-bold ml-1 opacity-90">(-${formattedDiff})</span>`
        };
    } else if (isEqual) {
        return {
            colorClass: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700',
            diffStr: `<span class="text-xs font-bold ml-1 opacity-90">(±0,0s)</span>`
        };
    } else {
        return {
            colorClass: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
            diffStr: `<span class="text-xs font-bold ml-1 opacity-90">(+${formattedDiff})</span>`
        };
    }
}

// NYTT: Helpers från precision-resultat.js för att beräkna ban-data
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const _norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');









async function openPrecisionDetailsModal(startNumber) {
  if (!startNumber) return;
  // Anropa funktionaliteten från precisionModal.js direkt med vår lokala data
  showDetailsModal(startNumber, allEquipages, allPrecisionData, precisionConfig, { times: startTimes });
}


// ---------- UI Rendering ----------
function renderLayout() {
  const comp = getGlobalState('currentCompetition');
  const root = document.getElementById('page-precision-monitor');
  if (!root) return;

  root.innerHTML = `
    <div class="container mx-auto p-4 md:p-8 tv-page">
      ${getCompetitionHeader(comp, t('precision_monitor_title'))}
      <div class="mb-2 flex justify-end">${tvModeLinkHtml('precision-monitor')}</div>
      
        <div class="flex justify-end mb-4">
            <div class="bg-gray-200 dark:bg-gray-700 p-1 rounded-lg inline-flex shadow-inner">
                <button id="prec-btn-view-list" class="${currentView === 'list' ? 'bg-white dark:bg-gray-600 shadow text-brand-darkblue dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-700'} px-4 py-1.5 rounded-md text-sm font-bold transition-all">
                    <i class="fas fa-list mr-1"></i> Lista
                </button>
                <button id="prec-btn-view-map" class="${currentView === 'map' ? 'bg-white dark:bg-gray-600 shadow text-brand-darkblue dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-700'} px-4 py-1.5 rounded-md text-sm font-bold transition-all">
                    <i class="fas fa-map mr-1"></i> Karta
                </button>
            </div>
        </div>

      <div id="precision-current-driver-panel" class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-lg mb-4 md:mb-8"></div>
      
      <div id="precision-list-view" class="${currentView === 'list' ? '' : 'hidden'}">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div id="precision-upcoming-panel" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow"></div>
          <div id="precision-results-panel" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow"></div>
        </div>
      </div>
      
      <div id="precision-map-view" class="${currentView === 'map' ? '' : 'hidden'}">
          <div id="precision-map-container" class="w-full h-[400px] lg:h-[700px]"></div>
      </div>
    </div>
  `;

  document.getElementById('prec-btn-view-list')?.addEventListener('click', () => setView('list'));
  document.getElementById('prec-btn-view-map')?.addEventListener('click', () => setView('map'));
}

function setView(view) {
    if (currentView === view) return;
    currentView = view;
    
    // Toggle buttons
    const btnList = document.getElementById('prec-btn-view-list');
    const btnMap = document.getElementById('prec-btn-view-map');
    
    if (view === 'list') {
        btnList.className = "bg-white dark:bg-gray-600 shadow text-brand-darkblue dark:text-white px-4 py-1.5 rounded-md text-sm font-bold transition-all";
        btnMap.className = "text-gray-600 dark:text-gray-300 hover:text-gray-700 px-4 py-1.5 rounded-md text-sm font-bold transition-all";
        document.getElementById('precision-list-view').classList.remove('hidden');
        document.getElementById('precision-map-view').classList.add('hidden');
    } else {
        btnMap.className = "bg-white dark:bg-gray-600 shadow text-brand-darkblue dark:text-white px-4 py-1.5 rounded-md text-sm font-bold transition-all";
        btnList.className = "text-gray-600 dark:text-gray-300 hover:text-gray-700 px-4 py-1.5 rounded-md text-sm font-bold transition-all";
        document.getElementById('precision-list-view').classList.add('hidden');
        document.getElementById('precision-map-view').classList.remove('hidden');
    }
    
    forceFullRender(); // Triggers re-render of panels and map
}

function forceFullRender() {
    lastRenderedUpcomingHash = null;
    lastRenderedResultsHash = null;
    lastDriverSn = "";
    
    renderCurrentDriver();
    renderUpcomingPanel();
    renderResultsPanel();
    
    if (currentView === 'map') {
        const activeEquipages = getActiveEquipagesForMap();
        renderMap(document.getElementById('precision-map-container'), activeEquipages, precisionConfig?.mapSettings, currentDriver, precisionConfig);
    }
}

// A round (phase 1 on the top level, or phase 2 / drive-off) marked in progress
function isAnyRoundInProgress(data) {
    return data?.inProgress === true || data?.rounds?.phase2?.inProgress === true || data?.rounds?.driveOff?.inProgress === true;
}

// What the current-driver panel shows for the round on the course: the round's
// stored fields (knocks, eliminated …), its calculated result, max time, course
// length and how the score is written ("65,00 s" for a time round)
function roundViewOf(eq, data, live, round) {
    const src = readPrecisionRound(data, round);
    if (round === 'phase1') {
        return {
            round,
            src,
            res: live,
            scoring: 'fault',
            maxSec: computeMaxSecondsForClass(eq, precisionConfig),
            trackLength: getTrackLengthMeters(eq, precisionConfig),
            showFinal: !data.running && (data.finalized || data.status === 'Klar' || data.eliminated)
        };
    }
    const res = live.rounds?.[round] || {};
    const course = getPrecisionRoundCourse(eq, precisionConfig, round);
    // A drive-off without its own length drives the same course
    const ownLength = Number(course.trackLengthMeters);
    return {
        round,
        src,
        res,
        scoring: res.scoring || 'fault',
        maxSec: isNum(res.maxTimeSec) ? res.maxTimeSec : null,
        trackLength: ownLength > 0 ? ownLength : (round === 'driveOff' ? getTrackLengthMeters(eq, precisionConfig) : null),
        showFinal: !res.live && res.decided === true
    };
}

// The total as written for a round: penalty points, or seconds for a time round
function roundScoreText(view, total, eliminated) {
    if (eliminated || total === Infinity) return 'ELIM';
    if (view.scoring === 'time') return formatPrecisionSeconds(Number.isFinite(total) ? total : 0);
    return formatPrecisionMonitorPenalty(total, { eliminated: false });
}

function getActiveEquipagesForMap() {
    const activeEquipages = new Map();
    const now = Date.now();
    const STALE_THRESHOLD_MS = 3600000; // 1 hour

    for (const [sn, data] of allPrecisionData.entries()) {
        const isRunning = isAnyPrecisionRoundRunning(data) || (isAnyRoundInProgress(data) && (now - (data.updatedAt || 0) < STALE_THRESHOLD_MS));
        
        let recentlyFinished = false;
        if (!isRunning && (data.status === 'Klar' || data.inProgress === false)) {
            // Vi måste använda updatedAt (servertid för när de gick i mål) för att undvika att alla poppar upp
            // på kartan i 15 sek när man laddar om sidan (eftersom _receivedLocalAt då är precis nu).
            const finishedTime = data.updatedAt || 0;
            if (finishedTime > 0 && (now - finishedTime < 15000)) { // Keep on map for 15 seconds after finishing
                recentlyFinished = true;
            }
        }
        
        if (isRunning || recentlyFinished) {
            const eq = allEquipages.find(e => String(e.startNumber) === sn);
            if (eq) {
                activeEquipages.set(sn, {
                    equipageInfo: eq,
                    data: data,
                    task: { type: 'course', name: 'Precision' }
                });
            }
        }
    }
    return activeEquipages;
}

function renderCurrentDriver() {
  const panel = document.getElementById('precision-current-driver-panel');
  if (!panel) return;

  if (!currentDriver) {
    panel.innerHTML = `<div class="text-center p-8 text-gray-600 dark:text-gray-300 text-xl">${t('monitor_waiting')}</div>`;
    return;
  }

  const { eq, data } = currentDriver;

  // Tid och straff från resultatmotorn (tickande tid om loppet pågår)
  const live = calculatePrecisionLiveResult(data, eq, precisionConfig);
  // The round on the course (phase 2 / drive-off follow rounds.<r>, not the top level)
  const round = currentPrecisionRound(data);
  const view = roundViewOf(eq, data, live, round);
  const format = getPrecisionFormat(eq, precisionConfig);
  const roundBadge = isMultiRoundPrecisionFormat(format) ? precisionRoundLabel(round, format) : '';
  const roundEliminated = view.src.eliminated === true || view.res.eliminated === true;
  const knocks = Array.isArray(view.src.knocks) ? view.src.knocks : [];
  const knockTimes = view.src.knockDownTimes || {};
  const elapsedMs = round === 'phase1' ? (live.elapsedMs ?? live.timeMs ?? 0) : (view.res.elapsedMs ?? view.res.timeMs ?? 0);

  // Hämta baninformation
  const maxSec = view.maxSec;
  const trackLength = view.trackLength;
  // Använd "allowance" istället för tot bredd
  const allowance = getPortAllowanceCm(eq, precisionConfig);
  const portDisplay = isNum(allowance) ? `+ ${allowance} cm` : '–';

  // Om klart/uteslutet, använd de slutgiltiga värdena, annars live
  // FIX: Om running=true, tvinga live-visning (ignorera status='Klar' från gammal körning)
  const showFinal = view.showFinal;
  // A new round of the same driver re-renders the panel (course data differ)
  const driverKey = `${eq.startNumber}:${round}`;
  const isSameDriver = lastDriverSn === driverKey;
  lastDriverSn = driverKey;

  const displayObstaclePenalty = view.res.obstaclePenalty ?? 0;
  const displayExtra = view.res.extraPenalty ?? 0;
  const displayTimePenalty = view.res.timePenalty ?? 0;
  const displayTotal = roundEliminated ? Infinity : (view.res.totalPenalty ?? 0);

  // Om föraren byts, rendera om hela panelen. Annars, uppdatera atomärt.
  if (!isSameDriver) {
    panel.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start mb-4 border-b dark:border-gray-700 pb-4 gap-4 md:gap-0">
                <div>
                    <h3 class="text-xl sm:text-2xl md:text-3xl font-bold dark:text-white">#${escapeHtml(eq.startNumber)} ${escapeHtml(eq.driverName)}</h3>
                    <div class="text-sm md:text-base text-gray-600 dark:text-gray-300 flex items-center gap-2 mt-1">
                        ${getFlagHtml(eq)} ${getClubLogoHtml(eq)} <span>${escapeHtml(eq.className)}</span>
                        ${roundBadge ? `<span class="live-round-badge rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold uppercase text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">${escapeHtml(roundBadge)}</span>` : ''}
                    </div>
                </div>
                <div id="leader-in-class-slot" class="text-left md:text-right w-full md:w-auto bg-gray-50 dark:bg-gray-700 md:bg-transparent md:dark:bg-transparent p-3 md:p-0 rounded-lg md:rounded-none">
                    ${leaderInClass ? `
                    <div class="text-sm text-gray-600 dark:text-gray-300">${t('leader_in_class')}</div>
                    <div class="font-semibold dark:text-white">${escapeHtml(leaderInClass.name)}</div>
                    <div class="font-bold text-blue-700 dark:text-brand-lightblue">
                        ${escapeHtml(leaderInClass.scoreText)}
                        <span class="text-sm font-normal text-gray-600 dark:text-gray-300 block">${isNum(leaderInClass.timeMs) ? formatMsLive(leaderInClass.timeMs) : ''}</span>
                    </div>
                    ` : ''}
                </div>
            </div>

            <div class="grid md:grid-cols-2 gap-6 items-center">
                <div>
                    <div class="text-sm text-gray-600 dark:text-gray-300 uppercase">${showFinal ? t('finish_time') : t('live_time')}</div>
                    <div id="live-timer-main" class="text-5xl sm:text-6xl md:text-7xl font-bold tabular-nums dark:text-white ${displayTimePenalty > 0 ? 'text-red-600 dark:text-red-400' : ''}">${formatMsLive(elapsedMs)}</div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-sm mt-2">
                        <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><div class="font-bold dark:text-white">${isNum(maxSec) ? formatMsLive(maxSec * 1000).slice(0, 5) : '–'}</div><div class="text-xs text-gray-600 dark:text-gray-300">${t('max_time')}</div></div>
                        <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><div class="font-bold dark:text-white">${isNum(maxSec) ? formatMsLive(maxSec * 2 * 1000).slice(0, 5) : '–'}</div><div class="text-xs text-gray-600 dark:text-gray-300">Maximaltid</div></div>
                        <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><div class="font-bold dark:text-white">${isNum(trackLength) ? trackLength + 'm' : '–'}</div><div class="text-xs text-gray-600 dark:text-gray-300">${t('track_len')}</div></div>
                        <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><div class="font-bold dark:text-white">${portDisplay}</div><div class="text-xs text-gray-600 dark:text-gray-300">${t('obstacle_width')}</div></div>
                    </div>
                </div>

                <div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg mt-4 md:mt-0">
                    <div class="text-center mb-4">
                        <div class="text-sm text-gray-600 dark:text-gray-300 uppercase">${t('total_penalty')} ${showFinal ? '' : t('preliminary_suffix')}</div>
                        <div id="live-total-penalty" class="text-5xl sm:text-6xl md:text-7xl font-bold tabular-nums text-blue-700 dark:text-brand-lightblue">${roundScoreText(view, displayTotal, roundEliminated)}</div>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-center text-sm border-t dark:border-gray-600 pt-2 dark:text-gray-300">
                        <div><div class="text-gray-600 dark:text-gray-300">${t('time_penalty')}</div><div id="live-time-penalty" class="font-semibold text-lg">${roundEliminated ? '–' : displayTimePenalty.toFixed(2)}</div></div>
                        <div><div class="text-gray-600 dark:text-gray-300">${t('obs_penalty')}</div><div id="live-obstacle-penalty" class="font-semibold text-lg">${roundEliminated ? '–' : displayObstaclePenalty}</div></div>
                        <div><div class="text-gray-600 dark:text-gray-300">${t('other_penalty')}</div><div id="live-extra-penalty" class="font-semibold text-lg">${roundEliminated ? '–' : displayExtra}</div></div>
                    </div>
                    <div id="live-knocks-container" class="border-t dark:border-gray-600 mt-3 pt-2">
                        ${(knocks.length > 0) ? `
                        <div class="text-sm text-gray-600 dark:text-gray-300 mb-1">${t('knocked_gates')}</div>
                        <div class="flex flex-wrap gap-2">
                            ${knocks.map(gate => {
      const timeMs = knockTimes[gate];
      const timeLabel = isNum(timeMs) ? formatMsLive(timeMs) : '';
      return `<span class="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 font font-semibold px-2 py-1 rounded flex items-center gap-1"><span>${escapeHtml(gate)}</span>${timeLabel ? `<span class="text-xs opacity-75">(${timeLabel})</span>` : ''}</span>`;
    }).join('')}
                        </div>
                        ` : ''}
                    </div>
                    
                    <div id="live-splits-container" class="${Object.keys(data.gateSplits || {}).length > 0 ? 'border-t dark:border-gray-600 mt-3 pt-2' : ''}">
                        ${(() => {
                            const splits = data.gateSplits || {};
                            const keys = Object.keys(splits).filter(k => k === 'start' || k === 'finish' || k.startsWith('gate_'));
                            if (keys.length === 0) return '';
                            
                            let latestGate = null;
                            let latestTime = 0;
                            for (const [k, t] of Object.entries(splits)) {
                                if (t > latestTime) {
                                    latestTime = t;
                                    latestGate = k;
                                }
                            }
                            
                            let label = latestGate;
                            if (label === 'start') label = 'Start';
                            else if (label === 'finish') label = 'Mål';
                            else label = 'Gate ' + label.replace('gate_', '');
                            
                            let timeStr = '';
                            let compHtml = { colorClass: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800', diffStr: '' };
                            
                            const startAbs = splits['start'] || data.liveStartEpoch;
                            if (latestGate === 'start' || !startAbs) {
                                timeStr = 'kl. ' + new Date(latestTime).toLocaleTimeString('sv-SE', {hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
                            } else {
                                const elapsed = Math.max(0, latestTime - startAbs);
                                const m = Math.floor(elapsed / 60000);
                                const s = Math.floor((elapsed % 60000) / 1000);
                                const ds = Math.floor((elapsed % 1000) / 100);
                                timeStr = `+${m > 0 ? m + ':' : ''}${String(s).padStart(m > 0 ? 2 : 1, '0')},${ds}s`;
                                
                                const bestOther = getBestSplitExcept(eq.className, latestGate, String(eq.startNumber));
                                compHtml = getSplitComparisonHTML(elapsed, bestOther);
                            }
                            
                            return `
                                <div class="text-sm text-gray-600 dark:text-gray-300 mb-1">Senaste passering</div>
                                <div class="inline-flex ${compHtml.colorClass} font-semibold px-3 py-1.5 rounded-lg items-center gap-2 border">
                                    <i class="fas fa-map-marker-alt"></i>
                                    <span>${escapeHtml(label)}</span>
                                    <span class="text-xs font-mono opacity-80 bg-white/50 dark:bg-black/20 px-1 rounded">${timeStr}</span>
                                    ${compHtml.diffStr}
                                </div>
                            `;
                        })()}
                    </div>
                </div>
            </div>
        `;
  } else {
    // Om samma förare, uppdatera endast de dynamiska delarna atomärt
    const leaderSlot = document.getElementById('leader-in-class-slot');
    if (leaderSlot) {
      leaderSlot.innerHTML = leaderInClass ? `
                <div class="text-sm text-gray-600 dark:text-gray-300">${t('leader_in_class')}</div>
                <div class="font-semibold dark:text-white">${escapeHtml(leaderInClass.name)}</div>
                <div class="font-bold text-blue-700 dark:text-brand-lightblue">
                    ${escapeHtml(leaderInClass.scoreText)}
                    <span class="text-sm font-normal text-gray-600 dark:text-gray-300 block">${isNum(leaderInClass.timeMs) ? formatMsLive(leaderInClass.timeMs) : ''}</span>
                </div>
            ` : '';
    }

    const totalPenaltyEl = document.getElementById('live-total-penalty');
    if (totalPenaltyEl) totalPenaltyEl.textContent = roundScoreText(view, displayTotal, roundEliminated);

    const timePenaltyEl = document.getElementById('live-time-penalty');
    if (timePenaltyEl) timePenaltyEl.textContent = roundEliminated ? '–' : displayTimePenalty.toFixed(2);

    const obsPenaltyEl = document.getElementById('live-obstacle-penalty');
    if (obsPenaltyEl) obsPenaltyEl.textContent = roundEliminated ? '–' : displayObstaclePenalty;

    const extraPenaltyEl = document.getElementById('live-extra-penalty');
    if (extraPenaltyEl) extraPenaltyEl.textContent = roundEliminated ? '–' : displayExtra;

    const knocksEl = document.getElementById('live-knocks-container');
    if (knocksEl) {
      if (knocks.length > 0) {
        knocksEl.innerHTML = `
                <div class="text-sm text-gray-600 dark:text-gray-300 mb-1">${t('knocked_gates')}</div>
                <div class="flex flex-wrap gap-2">
                    ${knocks.map(gate => {
          const timeMs = knockTimes[gate];
          const timeLabel = isNum(timeMs) ? formatMsLive(timeMs) : '';
          return `<span class="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 font font-semibold px-2 py-1 rounded flex items-center gap-1"><span>${escapeHtml(gate)}</span>${timeLabel ? `<span class="text-xs opacity-75">(${timeLabel})</span>` : ''}</span>`;
        }).join('')}
                </div>
            `;
      } else {
        knocksEl.innerHTML = '';
      }
    }
    
    const splitsEl = document.getElementById('live-splits-container');
    if (splitsEl) {
        const splits = data.gateSplits || {};
        const keys = Object.keys(splits).filter(k => k === 'start' || k === 'finish' || k.startsWith('gate_'));
        
        if (keys.length > 0) {
            splitsEl.className = 'border-t dark:border-gray-600 mt-3 pt-2';
            let latestGate = null;
            let latestTime = 0;
            for (const [k, t] of Object.entries(splits)) {
                if (t > latestTime) {
                    latestTime = t;
                    latestGate = k;
                }
            }
            
            let label = latestGate;
            if (label === 'start') label = 'Start';
            else if (label === 'finish') label = 'Mål';
            else label = 'Gate ' + label.replace('gate_', '');
            
            let timeStr = '';
            let compHtml = { colorClass: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800', diffStr: '' };
            
            const startAbs = splits['start'] || data.liveStartEpoch;
            if (latestGate === 'start' || !startAbs) {
                timeStr = 'kl. ' + new Date(latestTime).toLocaleTimeString('sv-SE', {hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
            } else {
                const elapsed = Math.max(0, latestTime - startAbs);
                const m = Math.floor(elapsed / 60000);
                const s = Math.floor((elapsed % 60000) / 1000);
                const ds = Math.floor((elapsed % 1000) / 100);
                timeStr = `+${m > 0 ? m + ':' : ''}${String(s).padStart(m > 0 ? 2 : 1, '0')},${ds}s`;
                
                const bestOther = getBestSplitExcept(currentDriver.eq.className, latestGate, String(currentDriver.eq.startNumber));
                compHtml = getSplitComparisonHTML(elapsed, bestOther);
            }
            
            splitsEl.innerHTML = `
                <div class="text-sm text-gray-600 dark:text-gray-300 mb-1">Senaste passering</div>
                <div class="inline-flex ${compHtml.colorClass} font-semibold px-3 py-1.5 rounded-lg items-center gap-2 border">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>${escapeHtml(label)}</span>
                    <span class="text-xs font-mono opacity-80 bg-white/50 dark:bg-black/20 px-1 rounded">${timeStr}</span>
                    ${compHtml.diffStr}
                </div>
            `;
        } else {
            splitsEl.className = '';
            splitsEl.innerHTML = '';
        }
    }
  }
}

function renderUpcomingPanel() {
  const panelEl = document.getElementById('precision-upcoming-panel');
  if (!panelEl) return;

  const upcoming = allEquipages
    .filter(eq => !allPrecisionData.has(String(eq.startNumber)))
    .sort((a, b) => compareByTimeThenStartNumber(
      timeValueToMs(startTimes[String(a.startNumber)]?.precision),
      timeValueToMs(startTimes[String(b.startNumber)]?.precision),
      a.startNumber,
      b.startNumber
    ))
    .slice(0, 5);

  const currentHash = upcoming.map(eq => `${eq.startNumber}:${startTimes[String(eq.startNumber)]?.precision}`).join('|');
  if (currentHash === lastRenderedUpcomingHash) return;
  lastRenderedUpcomingHash = currentHash;

  let content = `<h3 class="text-lg font-bold mb-2 dark:text-white">${t('next_start')}</h3>`;
  if (upcoming.length === 0) {
    content += `<p class="text-sm text-gray-600 dark:text-gray-300">${t('all_started')}</p>`;
  } else {
    content += upcoming.map(eq => {
      const startTime = formatTime(startTimes[String(eq.startNumber)]?.precision);
      return `
        <button class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1"
                data-sn="${escapeHtml(eq.startNumber)}">
          <div class="flex items-center gap-3 min-w-0">
            <span class="font-bold w-8 shrink-0 text-center dark:text-white">#${escapeHtml(eq.startNumber)}</span>
            <span class="truncate dark:text-gray-300">${escapeHtml(eq.driverName || '')}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="flex items-center gap-1 justify-start" title="${escapeHtml(eq.clubName || '')}">
              ${getFlagHtml(eq)}
              ${getClubLogoHtml(eq)}
            </div>
            <span class="font-semibold text-gray-800 dark:text-gray-300 w-20 text-right">${startTime}</span>
          </div>
        </button>
      `;
    }).join('');
  }

  panelEl.innerHTML = content;

  // Klick: hela raden (knappen) öppnar modal
  panelEl.querySelectorAll('button[data-sn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const startNumber = btn.getAttribute('data-sn');
      if (startNumber) openPrecisionDetailsModal(startNumber);
    });
  });
}


function renderResultsPanel() {
  const panelEl = document.getElementById('precision-results-panel');
  if (!panelEl) return;

  let content = `<h3 class="text-lg font-bold mb-2 dark:text-white">${t('latest_results')}</h3>`;

  if (recentResults.length === 0) {
    content += `<p class="text-sm text-gray-600 dark:text-gray-300">${t('no_results_yet')}</p>`;
  } else {
    content += recentResults.map(res => {
      // ✅ Fallbacks så vi aldrig får "#undefined"
      const sn = String(res.startNumber ?? res.sn);
      const eq = allEquipages.find(e => String(e.startNumber) === sn) || {};
      const d = allPrecisionData.get(sn) || {};
      const name = res.name || res.driverName || eq.driverName || '';
      // PRIORITERA timeMs (slutgiltig tid) om den finns
      // The latest round with data: phase 2 / drive-off of a multi-round class, else phase 1
      const roundDoc = readPrecisionRound(d, res.round || 'phase1');
      const finalizedTime = roundDoc.timeMs;
      const liveTime = roundDoc.liveTimeMs;
      const elapsedMs = isNum(finalizedTime) ? finalizedTime : liveTime;

      const penalty = (res.totalPenalty ?? d.totalPenalty);
      const isElim = res.eliminated === true || d.eliminated === true || penalty === Infinity;
      let penaltyText = isElim ? 'ELIM'
        : (Number.isFinite(penalty) ? penalty.toFixed(2) + ' p' : '—');
      if (res.round && res.round !== 'phase1' && res.roundResult) {
        const cell = formatPrecisionRoundCell(res.roundResult);
        penaltyText = `${precisionRoundLabel(res.round, res.format)} ${cell.text}`;
      }

      return `
        <button class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1"
                data-sn="${escapeHtml(sn)}">
          <div class="flex items-center gap-3 min-w-0">
            <span class="font-bold w-8 shrink-0 text-center dark:text-white">#${escapeHtml(sn)}</span>
            <span class="truncate dark:text-gray-300">${escapeHtml(name)}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="flex items-center gap-1 justify-start" title="${escapeHtml(eq.clubName || '')}">
              ${getFlagHtml(eq)}
              ${getClubLogoHtml(eq)}
            </div>
<span class="font-semibold text-gray-800 dark:text-gray-300 w-20 text-right">${isNum(elapsedMs) ? formatMsLive(elapsedMs) : '—'}</span>
        <span class="font-bold text-blue-700 dark:text-blue-400 w-20 text-right">${penaltyText}</span>
          </div>
        </button>
      `;
    }).join('');
  }

  const currentHash = recentResults.map(res => {
    const sn = String(res.startNumber ?? res.sn);
    const d = allPrecisionData.get(sn) || {};
    return `${sn}:${res.totalPenalty ?? d.totalPenalty}:${res.round || ''}:${res.roundResult?.totalPenalty ?? ''}`;
  }).join('|');

  if (currentHash === lastRenderedResultsHash) return;
  lastRenderedResultsHash = currentHash;

  panelEl.innerHTML = content;

  // Klick: hela raden (knappen) öppnar modal
  panelEl.querySelectorAll('button[data-sn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const startNumber = btn.getAttribute('data-sn');
      if (startNumber) openPrecisionDetailsModal(startNumber);
    });
  });
}


// ---------- Ticker & Data Logic ----------
function ensureTicker() {
  if (tickerInterval) return;
  tickerInterval = setInterval(() => {
    if (currentDriver) {
      const { eq, data } = currentDriver;
      const tickRound = currentPrecisionRound(data);
      const tickView = roundViewOf(eq, data, calculatePrecisionLiveResult(data, eq, precisionConfig), tickRound);
      const isFinal = tickView.showFinal;

      const timerEl = document.getElementById('live-timer-main');
      const timePenaltyEl = document.getElementById('live-time-penalty');
      const totalPenaltyEl = document.getElementById('live-total-penalty');

      if (timerEl) {
        // Om klart (och inte running), låt den statiska vyn vara
        if (isFinal) {
          // Gör inget "tickande" om det är klart.
          return;
        }

        // Tickande tid och straff från resultatmotorn
        const live = calculatePrecisionLiveResult(data, eq, precisionConfig);
        const roundLive = tickRound === 'phase1' ? live : (live.rounds?.[tickRound] || {});
        const elapsedMs = tickRound === 'phase1' ? (live.elapsedMs ?? data.liveTimeMs ?? 0) : (roundLive.elapsedMs ?? readPrecisionRound(data, tickRound).liveTimeMs ?? 0);

        timerEl.textContent = formatMsLive(elapsedMs);

        // LIVE-STRAFF UPPDATERING
        if (roundLive.eliminated) return;

        const currentTimePenalty = roundLive.timePenalty ?? 0;

        // Uppdatera DOM
        // Tidsstraff
        if (timePenaltyEl) {
          timePenaltyEl.textContent = currentTimePenalty.toFixed(2);
        }

        // Totalt straff
        if (totalPenaltyEl) {
          totalPenaltyEl.textContent = roundScoreText(tickView, roundLive.totalPenalty ?? 0, false);
        }

        // Röd markering
        if (currentTimePenalty > 0) {
          timerEl.classList.add('text-red-600', 'dark:text-red-400');
        } else {
          timerEl.classList.remove('text-red-600', 'dark:text-red-400');
        }
      }
    }
  }, 95);
}

function stopTicker() {
  if (tickerInterval) clearInterval(tickerInterval);
  tickerInterval = null;
}

function processDocChange(change) {
  const sn = change.doc.id;
  const data = change.doc.data();
  const oldData = allPrecisionData.get(sn) || {};

  if (change.type === 'removed') {
    allPrecisionData.delete(sn);
  } else {
    data._receivedLocalAt = Date.now(); // NYTT: För relativ tidssynk
    allPrecisionData.set(sn, data);
  }
  // När ett ekipage precis gått i mål (inProgress går från true till false) → pusha in i "Senaste Resultat"
  if ((oldData.inProgress === true) && (data.inProgress === false)) {
    // Hitta det matchande ekipaget från startlistan för att få namn, klubb etc.
    const eq = allEquipages.find(e => String(e.startNumber) === sn) || {};

    // DEDUPLICERING: Lägg inte till om detta ekipage redan ligger överst (eller i listan med samma straff)
    if (recentResults.length > 0) {
      const top = recentResults[0];
      if (String(top.sn) === String(sn) && top.totalPenalty === data.totalPenalty) {
        return;
      }
    }

    // Skapa ett "resultat-objekt" för listan
    recentResults.unshift({
      sn,
      startNumber: Number(sn),
      name: eq.driverName || data.driverName || '', // Använd namn från startlistan om det finns
      driverName: eq.driverName || data.driverName || '',
      clubName: eq.clubName || '',
      countryCode: eq.countryCode || eq.country || '',

      // Spara det viktiga resultatet (straffpoängen)
      // Notera: Tiden (elapsedMs) hämtas separat från allPrecisionData i renderResultsPanel
      totalPenalty: calculatePrecisionResult(data, eq, precisionConfig).totalPenalty
    });

    // Begränsa listan till 5
    if (recentResults.length > 5) recentResults.pop();
  }
}


function listenForUpdates() {
  const precisionRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
  // Subscribes again after an error (the last data stays on screen, with a
  // banner); a new subscription's first snapshot holds every document
  const unsub = resilientSnapshot({
    name: 'precision-monitor',
    subscribe: (onNext, onError) => onSnapshot(precisionRef, onNext, onError),
    onStatus: (status) => connectionBanner.update('precision-monitor', status),
    onData: (snapshot, { fresh }) => {
    if (fresh) {
      // Removed while the listener was down
      const present = new Set(snapshot.docs.map(d => d.id));
      for (const sn of [...allPrecisionData.keys()]) {
        if (!present.has(sn)) allPrecisionData.delete(sn);
      }
    }
    snapshot.docChanges().forEach(processDocChange);

    // Försök hitta en PÅGÅENDE förare (running = true)
    // Sortera så vi väljer den som uppdaterades senast
    const activeDrivers = [];
    const now = Date.now();
    const STALE_THRESHOLD_MS = 3600000; // 1 timme

    for (const [sn, data] of allPrecisionData.entries()) {
      // Prioritera running=true
      if (isAnyPrecisionRoundRunning(data)) {
        activeDrivers.push({ eq: allEquipages.find(e => String(e.startNumber) === sn), data, priority: 2 });
      }
      // Annars inProgress=true med färskt datum (om systemet inte hann sätta running=false?)
      else if (isAnyRoundInProgress(data) && (now - (data.updatedAt || 0) < STALE_THRESHOLD_MS)) {
        activeDrivers.push({ eq: allEquipages.find(e => String(e.startNumber) === sn), data, priority: 1 });
      }
    }

    // Sortera: Högst prioritet först, sedan senast uppdaterad
    activeDrivers.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (b.data.updatedAt || 0) - (a.data.updatedAt || 0);
    });

    // Filtrera bort undefined om equipage saknas
    const validActive = activeDrivers.filter(a => a.eq);

    // Välj vinnaren
    let activeDriver = validActive[0] || null;

    if (activeDriver) {
      currentDriver = activeDriver;
    } else {
      // Behåll nuvarande om den nyss var aktiv (för att visa resultat en stund), 
      // men om den är finalized/klar länge sen, släpp den.
      if (currentDriver) {
        const fresh = allPrecisionData.get(String(currentDriver.eq.startNumber));
        if (!fresh || (fresh.status === 'Klar' && (now - (fresh.updatedAt || 0) > 30000))) {
          // Om den har varit klar i mer än 30 sekunder, rensa skärmen (eller visa nästa start?)
          // För nu: rensa inte, låt den ligga kvar tills ny start
          // currentDriver = null; 
        }
        if (fresh) currentDriver.data = fresh;
      }
    }
    // Om vi inte hade någon activeDriver och ingen currentDriver sen innan => currentDriver förblir null (vänteläge)
    // Beräkna ledare i klassen
    // Klassledare: bästa finaliserade resultat enligt precisionens rangordning
    leaderInClass = null;
    if (currentDriver) {
      const finished = [];
      for (const [sn, data] of allPrecisionData.entries()) {
        if (!data.finalized) continue;
        const eq = allEquipages.find(e => String(e.startNumber) === sn);
        if (eq && classGroupOf(eq) === classGroupOf(currentDriver.eq)) finished.push({ startNumber: eq.startNumber, eq, result: calculatePrecisionResult(data, eq, precisionConfig) });
      }
      const precisionCtx = precisionGroupContext(finished, row => row.result);
      const leader = assignPlaces(finished, {
        key: row => precisionCtx.rankKey(row),
        compare: comparePrecisionRank,
        outField: null
      }).ranked[0];
      if (leader) {
        // Placed on phase 2: that round's score and time, else phase 1's
        const score = precisionPlacingScore(leader.result);
        leaderInClass = {
          name: `#${leader.eq.startNumber} ${leader.eq.driverName}`,
          scoreText: score.text,
          timeMs: score.timeMs || 0
        };
      }
    }

    // BYGG RESULTATLISTAN (Recent Results)
    recentResults.length = 0; // Töm listan
    const allResults = [];
    for (const [sn, data] of allPrecisionData.entries()) {
      // Ta med allt som har ett slutgiltigt straff (även uteslutna)
      if (isNum(data.totalPenalty) || data.eliminated === true || data.rounds) {
        const eq = allEquipages.find(e => String(e.startNumber) === sn) || { startNumber: sn, className: data.className };
        const calc = calculatePrecisionResult(data, eq, precisionConfig);
        allResults.push({ sn, data, calc, totalPenalty: calc.totalPenalty });
      }
    }
    // Sortera: Senast uppdaterad först (faller tillbaka på startnummer om tid saknas)
    allResults.sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0));

    // Ta topp 5 och konvertera till visningsformat
    for (const item of allResults.slice(0, 5)) {
      const eq = allEquipages.find(e => String(e.startNumber) === item.sn) || {};
      recentResults.push({
        sn: item.sn,
        startNumber: Number(item.sn),
        name: eq.driverName || item.data.driverName || '',
        driverName: eq.driverName || item.data.driverName || '',
        clubName: eq.clubName || '',
        countryCode: eq.countryCode || eq.country || '',
        totalPenalty: item.totalPenalty,
        // The latest round with data (phase 2 / drive-off) of a class with more than one
        round: isMultiRoundPrecisionFormat(item.calc.precisionFormat) ? latestPrecisionRoundWithData(item.calc) : 'phase1',
        roundResult: item.calc.rounds?.[latestPrecisionRoundWithData(item.calc)] || null,
        format: item.calc.precisionFormat
      });
    }

    renderCurrentDriver();
    renderUpcomingPanel();
    renderResultsPanel();
    
    if (currentView === 'map') {
        const activeEquipagesForMap = getActiveEquipagesForMap();
        renderMap(document.getElementById('precision-map-container'), activeEquipagesForMap, precisionConfig?.mapSettings, currentDriver, precisionConfig);
    }

    if (currentDriver) ensureTicker();
    else stopTicker();
    }
  });
  unsubscribes.push(unsub);
}

const connectionBanner = createConnectionBanner(() => document.querySelector('#page-precision-monitor .container'));

// ---------- Entrypoint ----------
export async function load() {
  __unload();
  const currentLoadToken = ++loadToken;

  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id;
  const root = document.getElementById('page-precision-monitor');
  if (!competitionId) {
    if (root) root.innerHTML = `<p class="p-8 text-center text-gray-600 dark:text-gray-400">${t('no_competition_selected')}</p>`;
    return;
  }
  try {
    const [equipagesRaw, configRaw, startTimesData, mergeSource] = await Promise.all([
      getEquipages(competitionId),
      getConfig(competitionId, 'precisionConfig').catch(() => ({})),
      getConfig(competitionId, 'startTimes').catch(() => ({})),
      loadMergeSource(competitionId).catch(() => null)
    ]);
    if (currentLoadToken !== loadToken) return;
    classGroupOf = mergeGroupResolver(mergeSource);

    allEquipages = equipagesRaw;
    precisionConfig = configRaw || {}; // Spara config
    // Only published start times (a draft list is not shown on the public monitor)
    startTimes = publishedStartTimes(startTimesData || {});
    enterTvModeIfRequested();
    
    renderLayout(); // NU HAR VI precisionConfig!
    
    // Default till list-view
    currentView = 'list';
    document.getElementById('precision-list-view')?.classList.remove('hidden');
    document.getElementById('precision-map-view')?.classList.add('hidden');
    await ensureClubLogosLoaded(competitionId);
    if (currentLoadToken !== loadToken) return;

    listenForUpdates();
  } catch (error) {
    if (currentLoadToken !== loadToken) return;
    console.error("Kunde inte ladda data för precision-monitor:", error);
    if (root) root.innerHTML = `<p class="p-8 text-center text-red-500">${t('error_loading_data')}</p>`;
  }
}



export function __unload() {
  loadToken++;
  stopTicker();
  destroyMap();
  exitTvMode();
  unsubscribes.forEach(unsub => {
    try { unsub(); } catch { }
  });
  unsubscribes = [];
  connectionBanner.clear();
  currentDriver = null;
  leaderInClass = null;
  allPrecisionData.clear();
  recentResults.length = 0;
  allEquipages = [];
  startTimes = {};
  precisionConfig = {};
  competitionId = null;
  lastRenderedUpcomingHash = null;
  lastRenderedResultsHash = null;
  lastDriverSn = "";
}
