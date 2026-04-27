// js/pages/precision-monitor.js
// En "speaker-vy" som visar det aktiva ekipaget i precision, samt nästa start och senaste resultat.

import { getGlobalState } from '../main.js';
import { getEquipages, getConfig } from '../services/firestoreService.js';
import { getCompetitionHeader } from '../ui/components.js';
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';
import { standardPortAllowance, klassTempoData } from '../data/competitionData.js';
import { showDetailsModal } from '../ui/precisionModal.js'; // NYTT
import { getPortAllowanceCm, computeMaxSecondsForClass, getTrackLengthMeters, trackWidthFromEq, computePortWidth, calculatePrecisionTimePenalty } from '../utils/precisionUtils.js';
import { t } from '../utils/i18n.js';

// ---------- State ----------
let competitionId = null;
let allEquipages = [];
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

// ---------- Helpers ----------
const formatMsLive = (ms) => {
  const t = Math.max(0, ms || 0);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(2, '0')}`;
};

const formatTime = (isoOrTs) => {
  if (!isoOrTs) return '—';
  try {
    // Försök hantera om det är ett Firestore Timestamp-objekt
    const value = (typeof isoOrTs === 'object' && isoOrTs.seconds)
      ? new Date(isoOrTs.seconds * 1000)
      : new Date(isoOrTs);

    // Kontrollera om datumobjektet är giltigt
    if (isNaN(value.getTime())) {
      return '—'; // Returnera '—' om datumet är ogiltigt
    }

    return value.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—'; // Fånga eventuella andra fel
  }
};

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
    <div class="container mx-auto p-4 md:p-8">
      ${getCompetitionHeader(comp, t('precision_monitor_title'))}
      <div id="precision-current-driver-panel" class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8"></div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div id="precision-upcoming-panel" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow"></div>
        <div id="precision-results-panel" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow"></div>
      </div>
    </div>
  `;
}

function renderCurrentDriver() {
  const panel = document.getElementById('precision-current-driver-panel');
  if (!panel) return;

  if (!currentDriver) {
    panel.innerHTML = `<div class="text-center p-8 text-gray-500 dark:text-gray-400 text-xl">${t('monitor_waiting')}</div>`;
    return;
  }

  const { eq, data } = currentDriver;

  // NY, EXAKT TIDSBERÄKNING
  // Om loppet är klart (finalized), visa den fastställda sluttiden.
  // Annars kör vi live-beräkning.
  let elapsedMs;
  if ((data.finalized || data.status === 'Klar') && isNum(data.totalPenalty)) {
    elapsedMs = data.timeMs || 0;
  } else if (data.running && data.liveStartEpoch) {
    // RELATIV CLOCK: Använd tidpunkten då vi tog emot snapshoten för att kompensera för klockdiff.
    const receivedAt = data._receivedLocalAt || Date.now();
    elapsedMs = (data.livePausedMs || 0) + (receivedAt - data.liveStartEpoch) + (Date.now() - receivedAt);
  } else {
    elapsedMs = data.liveTimeMs || 0;
  }

  // Hämta baninformation
  const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
  const trackLength = getTrackLengthMeters(eq.className, precisionConfig);
  // Använd "allowance" istället för tot bredd
  const allowance = getPortAllowanceCm(eq.className, precisionConfig);
  const portDisplay = isNum(allowance) ? `+ ${allowance} cm` : '–';

  // Om klart/uteslutet, använd de slutgiltiga värdena, annars live
  // FIX: Om running=true, tvinga live-visning (ignorera status='Klar' från gammal körning)
  const showFinal = !data.running && (data.finalized || data.status === 'Klar' || data.eliminated);
  const isSameDriver = lastDriverSn === String(eq.startNumber);
  lastDriverSn = String(eq.startNumber);

  // Calculate display values
  const displayObstaclePenalty = data.liveObstaclePenalty || data.obstaclePenalty || 0;
  const displayExtra = data.extraPenalty || 0;

  // Calculate time penalty
  let displayTimePenalty = 0;
  if (data.finalized || data.status === 'Klar') {
    displayTimePenalty = data.timePenalty || 0;
  } else if (isNum(maxSec) && maxSec > 0 && elapsedMs > maxSec * 1000) {
    const rate = (precisionConfig.timePenaltyRate != null) ? Number(precisionConfig.timePenaltyRate) : 0.5;
    displayTimePenalty = calculatePrecisionTimePenalty(elapsedMs, maxSec, rate);
  }

  let displayTotal = 0;
  if (data.finalized || data.status === 'Klar') {
    displayTotal = data.totalPenalty || 0;
  } else {
    displayTotal = displayTimePenalty + displayObstaclePenalty + displayExtra;
  }
  // Handle infinite/elimination
  if (data.eliminated) {
    displayTotal = Infinity;
  }

  // Om föraren byts, rendera om hela panelen. Annars, uppdatera atomärt.
  if (!isSameDriver) {
    panel.innerHTML = `
            <div class="flex justify-between items-start mb-4 border-b dark:border-gray-700 pb-4">
                <div>
                    <h3 class="text-3xl font-bold dark:text-white">#${eq.startNumber} ${eq.driverName}</h3>
                    <div class="text-gray-600 dark:text-gray-300 flex items-center gap-2 mt-1">
                        ${getFlagHtml(eq)} ${getClubLogoHtml(eq)} <span>${eq.className}</span>
                    </div>
                </div>
                <div id="leader-in-class-slot" class="text-right">
                    ${leaderInClass ? `
                    <div class="text-sm text-gray-500 dark:text-gray-400">${t('leader_in_class')}</div>
                    <div class="font-semibold dark:text-white">${leaderInClass.name}</div>
                    <div class="font-bold text-brand-lightblue">
                        ${leaderInClass.totalPenalty.toFixed(2)} p
                        <span class="text-sm font-normal text-gray-600 dark:text-gray-300 block">${isNum(leaderInClass.timeMs) ? formatMsLive(leaderInClass.timeMs) : ''}</span>
                    </div>
                    ` : ''}
                </div>
            </div>

            <div class="grid md:grid-cols-2 gap-6 items-center">
                <div>
                    <div class="text-sm text-gray-500 dark:text-gray-400 uppercase">${showFinal ? t('finish_time') : t('live_time')}</div>
                    <div id="live-timer-main" class="text-7xl font font-bold tabular-nums dark:text-white ${displayTimePenalty > 0 ? 'text-red-600 dark:text-red-400' : ''}">${formatMsLive(elapsedMs)}</div>
                    <div class="grid grid-cols-3 gap-2 text-center text-sm mt-2">
                        <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><div class="font-bold dark:text-white">${isNum(maxSec) ? formatMsLive(maxSec * 1000).slice(0, 5) : '–'}</div><div class="text-xs text-gray-500 dark:text-gray-400">${t('max_time')}</div></div>
                        <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><div class="font-bold dark:text-white">${isNum(maxSec) ? formatMsLive(maxSec * 2 * 1000).slice(0, 5) : '–'}</div><div class="text-xs text-gray-500 dark:text-gray-400">Maximaltid</div></div>
                        <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><div class="font-bold dark:text-white">${isNum(trackLength) ? trackLength + 'm' : '–'}</div><div class="text-xs text-gray-500 dark:text-gray-400">${t('track_len')}</div></div>
                        <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><div class="font-bold dark:text-white">${portDisplay}</div><div class="text-xs text-gray-500 dark:text-gray-400">${t('obstacle_width')}</div></div>
                    </div>
                </div>

                <div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                    <div class="text-center mb-4">
                        <div class="text-sm text-gray-500 dark:text-gray-400 uppercase">${t('total_penalty')} ${showFinal ? '' : t('preliminary_suffix')}</div>
                        <div id="live-total-penalty" class="text-7xl font-bold tabular-nums text-brand-lightblue">${data.eliminated ? 'ELIM' : displayTotal.toFixed(2)}</div>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-center text-sm border-t dark:border-gray-600 pt-2 dark:text-gray-300">
                        <div><div class="text-gray-500 dark:text-gray-400">${t('time_penalty')}</div><div id="live-time-penalty" class="font-semibold text-lg">${data.eliminated ? '–' : displayTimePenalty.toFixed(2)}</div></div>
                        <div><div class="text-gray-500 dark:text-gray-400">${t('obs_penalty')}</div><div id="live-obstacle-penalty" class="font-semibold text-lg">${data.eliminated ? '–' : displayObstaclePenalty}</div></div>
                        <div><div class="text-gray-500 dark:text-gray-400">${t('other_penalty')}</div><div id="live-extra-penalty" class="font-semibold text-lg">${data.eliminated ? '–' : displayExtra}</div></div>
                    </div>
                    <div id="live-knocks-container" class="border-t dark:border-gray-600 mt-3 pt-2">
                        ${(Array.isArray(data.knocks) && data.knocks.length > 0) ? `
                        <div class="text-sm text-gray-500 dark:text-gray-400 mb-1">${t('knocked_gates')}</div>
                        <div class="flex flex-wrap gap-2">
                            ${data.knocks.map(gate => {
      const timeMs = data.knockDownTimes?.[gate];
      const timeLabel = isNum(timeMs) ? formatMsLive(timeMs) : '';
      return `<span class="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 font font-semibold px-2 py-1 rounded flex items-center gap-1"><span>${gate}</span>${timeLabel ? `<span class="text-xs opacity-75">(${timeLabel})</span>` : ''}</span>`;
    }).join('')}
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
  } else {
    // Om samma förare, uppdatera endast de dynamiska delarna atomärt
    const leaderSlot = document.getElementById('leader-in-class-slot');
    if (leaderSlot) {
      leaderSlot.innerHTML = leaderInClass ? `
                <div class="text-sm text-gray-500 dark:text-gray-400">${t('leader_in_class')}</div>
                <div class="font-semibold dark:text-white">${leaderInClass.name}</div>
                <div class="font-bold text-brand-lightblue">
                    ${leaderInClass.totalPenalty.toFixed(2)} p
                    <span class="text-sm font-normal text-gray-600 dark:text-gray-300 block">${isNum(leaderInClass.timeMs) ? formatMsLive(leaderInClass.timeMs) : ''}</span>
                </div>
            ` : '';
    }

    const totalPenaltyEl = document.getElementById('live-total-penalty');
    if (totalPenaltyEl) totalPenaltyEl.textContent = data.eliminated ? 'ELIM' : displayTotal.toFixed(2);

    const timePenaltyEl = document.getElementById('live-time-penalty');
    if (timePenaltyEl) timePenaltyEl.textContent = data.eliminated ? '–' : displayTimePenalty.toFixed(2);

    const obsPenaltyEl = document.getElementById('live-obstacle-penalty');
    if (obsPenaltyEl) obsPenaltyEl.textContent = data.eliminated ? '–' : displayObstaclePenalty;

    const extraPenaltyEl = document.getElementById('live-extra-penalty');
    if (extraPenaltyEl) extraPenaltyEl.textContent = data.eliminated ? '–' : displayExtra;

    const knocksEl = document.getElementById('live-knocks-container');
    if (knocksEl) {
      if (Array.isArray(data.knocks) && data.knocks.length > 0) {
        knocksEl.innerHTML = `
                <div class="text-sm text-gray-500 dark:text-gray-400 mb-1">${t('knocked_gates')}</div>
                <div class="flex flex-wrap gap-2">
                    ${data.knocks.map(gate => {
          const timeMs = data.knockDownTimes?.[gate];
          const timeLabel = isNum(timeMs) ? formatMsLive(timeMs) : '';
          return `<span class="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 font font-semibold px-2 py-1 rounded flex items-center gap-1"><span>${gate}</span>${timeLabel ? `<span class="text-xs opacity-75">(${timeLabel})</span>` : ''}</span>`;
        }).join('')}
                </div>
            `;
      } else {
        knocksEl.innerHTML = '';
      }
    }
  }
}

function renderUpcomingPanel() {
  const panelEl = document.getElementById('precision-upcoming-panel');
  if (!panelEl) return;

  const upcoming = allEquipages
    .filter(eq => !allPrecisionData.has(String(eq.startNumber)))
    .sort((a, b) => {
      const aT = startTimes[String(a.startNumber)]?.precision || '99:99';
      const bT = startTimes[String(b.startNumber)]?.precision || '99:99';
      return aT.localeCompare(bT);
    })
    .slice(0, 5);

  const currentHash = upcoming.map(eq => `${eq.startNumber}:${startTimes[String(eq.startNumber)]?.precision}`).join('|');
  if (currentHash === lastRenderedUpcomingHash) return;
  lastRenderedUpcomingHash = currentHash;

  let content = `<h3 class="text-lg font-bold mb-2 dark:text-white">${t('next_start')}</h3>`;
  if (upcoming.length === 0) {
    content += `<p class="text-sm text-gray-500 dark:text-gray-400">${t('all_started')}</p>`;
  } else {
    content += upcoming.map(eq => {
      const startTime = formatTime(startTimes[String(eq.startNumber)]?.precision);
      return `
        <button class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1"
                data-sn="${eq.startNumber}">
          <div class="flex items-center gap-3 min-w-0">
            <span class="font-bold w-8 shrink-0 text-center dark:text-white">#${eq.startNumber}</span>
            <span class="truncate dark:text-gray-300">${eq.driverName || ''}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="flex items-center gap-1 justify-start" title="${eq.clubName || ''}">
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
    content += `<p class="text-sm text-gray-500 dark:text-gray-400">${t('no_results_yet')}</p>`;
  } else {
    content += recentResults.map(res => {
      // ✅ Fallbacks så vi aldrig får "#undefined"
      const sn = String(res.startNumber ?? res.sn);
      const eq = allEquipages.find(e => String(e.startNumber) === sn) || {};
      const d = allPrecisionData.get(sn) || {};
      const name = res.name || res.driverName || eq.driverName || '';
      // PRIORITERA timeMs (slutgiltig tid) om den finns
      const finalizedTime = d.timeMs;
      const liveTime = d.liveTimeMs;
      const elapsedMs = isNum(finalizedTime) ? finalizedTime : liveTime;

      const penalty = (res.totalPenalty ?? d.totalPenalty);
      const isElim = res.eliminated === true || d.eliminated === true || penalty === Infinity;
      const penaltyText = isElim ? 'ELIM'
        : (Number.isFinite(penalty) ? penalty.toFixed(2) + ' p' : '—');

      return `
        <button class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1"
                data-sn="${sn}">
          <div class="flex items-center gap-3 min-w-0">
            <span class="font-bold w-8 shrink-0 text-center dark:text-white">#${sn}</span>
            <span class="truncate dark:text-gray-300">${name}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="flex items-center gap-1 justify-start" title="${eq.clubName || ''}">
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
    return `${sn}:${res.totalPenalty ?? d.totalPenalty}`;
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
      const isFinal = !data.running && (data.finalized || data.status === 'Klar');

      const timerEl = document.getElementById('live-timer-main');
      const timePenaltyEl = document.getElementById('live-time-penalty');
      const totalPenaltyEl = document.getElementById('live-total-penalty');

      if (timerEl) {
        // Om klart (och inte running), låt den statiska vyn vara
        if (isFinal) {
          // Gör inget "tickande" om det är klart.
          return;
        }

        // NY, EXAKT TIDSBERÄKNING
        // RELATIV CLOCK: Använd tidpunkten då vi tog emot snapshoten för att kompensera för klockdiff.
        let elapsedMs;
        if (data.running && data.liveStartEpoch) {
          const receivedAt = data._receivedLocalAt || Date.now();
          elapsedMs = (data.livePausedMs || 0) + (receivedAt - data.liveStartEpoch) + (Date.now() - receivedAt);
        } else {
          // Om klockan är stoppad, visa den senast kända tiden
          elapsedMs = data.liveTimeMs || 0;
        }

        timerEl.textContent = formatMsLive(elapsedMs);

        // LIVE-STRAFF UPPDATERING
        if (data.eliminated) return;

        const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
        let currentTimePenalty = 0;

        if (isNum(maxSec) && maxSec > 0) {
          const elapsedSec = elapsedMs / 1000;
          // Tidsstraff: 0.5 straff per påbörjad sekund över maxtiden (kan variera beroende på gren, men antar 0.5 här baserat på tidigare kod)
          // Tidigare kod i precision-input.js: (elapsedSec - maxSec) * 0.5
          // Kontrollera om precision-input har exakt samma logik?
          // Ja: calculateLiveTimePenalty -> (elapsedSec - maxSec) * 0.5
          const rate = (precisionConfig.timePenaltyRate != null) ? Number(precisionConfig.timePenaltyRate) : 0.5;
          currentTimePenalty = calculatePrecisionTimePenalty(elapsedMs, maxSec, rate);
        }

        // Uppdatera DOM
        // Tidsstraff
        if (timePenaltyEl) {
          timePenaltyEl.textContent = currentTimePenalty.toFixed(2);
        }

        // Totalt straff
        if (totalPenaltyEl) {
          // Vi använder de senast kända värdena för hinder/annat från data
          // OBS: data.liveObstaclePenalty uppdateras bara via snapshot (var 5:e sek eller vid ändring)
          // Det är OK, hinder ändras inte automatiskt av tiden.
          const obst = data.liveObstaclePenalty || 0;
          const extra = data.extraPenalty || 0;
          const total = currentTimePenalty + obst + extra;
          totalPenaltyEl.textContent = total.toFixed(2);
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
      totalPenalty: data.totalPenalty
    });

    // Begränsa listan till 5
    if (recentResults.length > 5) recentResults.pop();
  }
}


function listenForUpdates() {
  const precisionRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
  const unsub = onSnapshot(precisionRef, (snapshot) => {
    snapshot.docChanges().forEach(processDocChange);

    // Försök hitta en PÅGÅENDE förare (running = true)
    // Sortera så vi väljer den som uppdaterades senast
    const activeDrivers = [];
    const now = Date.now();
    const STALE_THRESHOLD_MS = 3600000; // 1 timme

    for (const [sn, data] of allPrecisionData.entries()) {
      // Prioritera running=true
      if (data.running === true) {
        activeDrivers.push({ eq: allEquipages.find(e => String(e.startNumber) === sn), data, priority: 2 });
      }
      // Annars inProgress=true med färskt datum (om systemet inte hann sätta running=false?)
      else if (data.inProgress === true && (now - (data.updatedAt || 0) < STALE_THRESHOLD_MS)) {
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
    leaderInClass = null;
    if (currentDriver) {
      let bestScore = Infinity;
      for (const [sn, data] of allPrecisionData.entries()) {
        if (data.finalized && !data.eliminated && data.className === currentDriver.eq.className && data.totalPenalty < bestScore) {
          const eq = allEquipages.find(e => String(e.startNumber) === sn);
          if (eq) {
            leaderInClass = {
              name: `#${sn} ${eq.driverName}`,
              totalPenalty: data.totalPenalty,
              timeMs: data.timeMs || data.liveTimeMs || 0
            };
            bestScore = data.totalPenalty;
          }
        }
      }
    }

    // BYGG RESULTATLISTAN (Recent Results)
    recentResults.length = 0; // Töm listan
    const allResults = [];
    for (const [sn, data] of allPrecisionData.entries()) {
      // Ta med allt som har ett slutgiltigt straff (även uteslutna)
      if (isNum(data.totalPenalty) || data.eliminated === true) {
        allResults.push({ sn, data });
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
        totalPenalty: item.data.totalPenalty
      });
    }

    renderCurrentDriver();
    renderUpcomingPanel();
    renderResultsPanel();
    if (currentDriver) ensureTicker();
    else stopTicker();
  });
  unsubscribes.push(unsub);
}

// ---------- Entrypoint ----------
export async function load() {
  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id;
  const root = document.getElementById('page-precision-monitor');
  if (!competitionId) {
    if (root) root.innerHTML = `<p class="p-8 text-center text-gray-600">${t('no_competition_selected')}</p>`;
    return;
  }
  renderLayout();
  try {
    const [equipagesRaw, configRaw, startTimesData] = await Promise.all([
      getEquipages(competitionId),
      getConfig(competitionId, 'precisionConfig').catch(() => ({})),
      getConfig(competitionId, 'startTimes').catch(() => ({}))
    ]);
    allEquipages = equipagesRaw;
    precisionConfig = configRaw; // Spara config
    startTimes = startTimesData?.times || {};
    await ensureClubLogosLoaded(competitionId);
    listenForUpdates();
  } catch (error) {
    console.error("Kunde inte ladda data för precision-monitor:", error);
    if (root) root.innerHTML = `<p class="p-8 text-center text-red-500">${t('error_loading_data')}</p>`;
  }
}



export function __unload() {
  stopTicker();
  unsubscribes.forEach(unsub => unsub());
  unsubscribes = [];
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