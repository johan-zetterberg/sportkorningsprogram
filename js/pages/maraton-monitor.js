// js/pages/maraton-monitor.js
// En "kontrollrums"-vy som visar alla ekipage som just nu är aktiva på maratonbanan.

import { getGlobalState } from '../main.js';
import { getEquipages, getConfig } from '../services/firestoreService.js';
import { getCompetitionHeader } from '../ui/components.js';
import { collection, onSnapshot, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';

// Importera modalen direkt
import { showDetailsModal } from '../ui/marathonModal.js';

// Importera gemensam logik från utils
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
  toTimeLabel
} from '../utils/marathonUtils.js';

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


    `;
  document.head.appendChild(s);
}

// ---------- State ----------
let competitionId = null;
let allEquipages = [];
let startTimes = {};
const allMarathonData = new Map();
const activeEquipages = new Map();
let tickerInterval = null;
let unsubscribes = [];
let isGloballyPaused = false;
let pauseStartTime = 0;


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

  let totalPenalty = 0;
  let isEliminated = false;

  // 1. Hinder (använd utils)
  const obsArr = getObstacleArray(docData);
  for (const o of obsArr) {
    const { penalty, eliminated } = obstacleValues(o);
    if (eliminated) isEliminated = true;
    if (Number.isFinite(penalty)) totalPenalty += penalty;
  }

  // 2. Etapper (använd utils)
  ['A', 'B'].forEach(stage => {
    const dur = stageDurationMsSaved(docData, stage);
    // Om ingen duration är sparad men vi har tider (t.ex. manuell mål), räkna ut
    let ms = dur;
    if (!Number.isFinite(ms)) {
      const s = stageStartTS(docData, stage);
      const e = stageStopTS(docData, stage);
      if (s && e) {
        ms = (e - s) - pausedMsBetween(s, e);
      }
    }

    if (Number.isFinite(ms)) {
      const res = stagePenaltyFromMs(ms, equipage, stage);
      if (res.elim) isEliminated = true;
      if (Number.isFinite(res.points)) totalPenalty += res.points;
    }
  });

  // 3. Övrigt
  const other = Number(docData.otherPenalty);
  if (Number.isFinite(other)) totalPenalty += other;

  return isEliminated ? Infinity : totalPenalty;
}

function calculateETA(startTimeMs, equipage, stage) {
  // Använd limitsFor för att få idealtid och regler
  const limits = limitsFor(equipage, stage);
  if (!startTimeMs || !limits?.ideal) return '—';

  // Hämta aktuell paus-tid från utils (som har koll på globala fönster)
  const p = pausedMsSince(startTimeMs);

  // Starttid + Idealtid (sek -> ms) + Paus
  const etaTimestamp = startTimeMs + (limits.ideal * 1000) + p;
  return toTimeLabel(etaTimestamp);
}

function summarizeObstacles(docData) {
  const arr = getObstacleArray(docData);
  const items = arr
    .map(o => {
      const n = Number(o.number || o.obstacleNumber || o.id);
      const { penalty, eliminated } = obstacleValues(o);
      return { n, p: penalty, elim: eliminated };
    })
    .filter(x => Number.isFinite(x.n) && x.n > 0)
    .sort((a, b) => a.n - b.n)
    .slice(0, 8);

  let sum = 0, eliminated = false;
  for (const it of items) {
    if (it.elim) eliminated = true;
    if (Number.isFinite(it.p)) sum += it.p;
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


// ---------- UI Rendering ----------
function renderLayout() {
  const comp = getGlobalState('currentCompetition');
  const root = document.getElementById('page-maraton-monitor');
  if (!root) return;

  root.innerHTML = `
  <div class="container mx-auto p-4 md:p-8 transition-all duration-500" id="marathon-monitor-container">
    <div class="flex justify-between items-center mb-4">
        ${getCompetitionHeader(comp, 'Maraton – Live Monitor')}

    </div>
      <div id="pause-status-banner" class="hidden p-4 mb-4 text-center font-bold text-white bg-red-600 rounded-lg">
        TÄVLINGEN ÄR PAUSAD
      </div>

      <div id="summary-stats" class="grid grid-cols-3 gap-4 mb-6 text-center"></div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div id="upcoming-wrapper" class="bg-white p-4 rounded-lg shadow overflow-hidden h-[400px]">
            <div id="upcoming-panel"></div>
        </div>
        <div id="finished-wrapper" class="bg-white p-4 rounded-lg shadow overflow-hidden h-[400px]">
             <div id="finished-panel"></div>
        </div>
      </div>

      <h2 class="text-xl font-bold mb-4 border-b pb-2">På Banan</h2>
      <div id="monitor-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        </div>
    </div>
  `;
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
  <div class="bg-blue-50 p-3 rounded-lg"><div class="text-2xl font-bold">${onCourse}</div><div class="text-sm text-blue-800 font-semibold">På Banan</div></div>
        <div class="bg-green-50 p-3 rounded-lg"><div class="text-2xl font-bold">${finishedCount}</div><div class="text-sm text-green-800 font-semibold">Klara</div></div>
        <div class="bg-gray-100 p-3 rounded-lg"><div class="text-2xl font-bold">${notStarted < 0 ? 0 : notStarted}</div><div class="text-sm text-gray-600 font-semibold">Kvar att Starta</div></div>
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

  let content = '<h3 class="text-lg font-bold mb-2">Nästa Start</h3>';
  if (upcoming.length === 0) {
    content += `<p class="text-sm text-gray-500" > Inga fler ekipage att starta.</p> `;
  } else {
    content += upcoming.map(eq => {
      const rawTime = startTimes[String(eq.startNumber)]?.maraton;
      const startTime = rawTime ? toTimeLabel(rawTime) : '—';
      return `
  <button class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b last:border-0 hover:bg-gray-50 rounded px-1"
data-sn="${eq.startNumber}" >
        <div class="flex items-center gap-3 min-w-0">
          <span class="font-bold w-8 shrink-0 text-center">#${eq.startNumber}</span>
          <span class="truncate">${eq.driverName || ''}</span>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <div class="flex items-center gap-1 justify-start" title="${eq.clubName || ''}">
            ${getFlagHtml(eq)}
            ${getClubLogoHtml(eq)}
          </div>
          <span class="font-semibold text-gray-800 w-20 text-right">${startTime}</span>
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

  let content = '<h3 class="text-lg font-bold mb-2">Nyligen i Mål</h3>';
  if (display.length === 0) {
    content += `<p class="text-sm text-gray-500" > Inga ekipage har gått i mål ännu.</p> `;
  } else {
    content += display.map(fin => {
      const penaltyText = fin.totalPenalty === Infinity
        ? 'ELIM'
        : (Number.isFinite(fin.totalPenalty) ? fin.totalPenalty.toFixed(2) + ' p' : '—');

      return `
  <button class="w-full text-left flex items-center justify-between text-sm py-1.5 border-b last:border-0 hover:bg-gray-50 rounded px-1"
data-sn="${fin.sn}" >
              <div class="flex items-center gap-3 min-w-0">
                <span class="font-bold w-8 shrink-0 text-center">#${fin.sn}</span>
                <span class="truncate">${fin.name || ''}</span>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <div class="flex items-center gap-1 justify-start" title="${fin.clubName || ''}">
                  ${getFlagHtml(fin.eqObj)}
                  ${getClubLogoHtml(fin.eqObj)}
                </div>
                <span class="font-semibold text-gray-800 w-20 text-right">${toTimeLabel(fin.finishTime)}</span>
                <span class="font-bold text-blue-700 w-20 text-right">
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
  if (!grid) return;

  if (activeEquipages.size === 0) {
    grid.innerHTML = `<div class="col-span-full text-center p-8 bg-white rounded-lg shadow-md text-gray-500">Inga ekipage är för närvarande aktiva på banan.</div>`;
    return;
  }

  const sorted = Array.from(activeEquipages.values()).sort((a, b) => a.equipageInfo.startNumber - b.equipageInfo.startNumber);

  grid.innerHTML = sorted.map(active => {
    const eq = active.equipageInfo;
    const elapsedMs = active.pausedMs + (Date.now() - active.startTime - pausedMsSince(active.startTime));
    const stageKey = active.task.key;
    const doc = allMarathonData.get(String(eq.startNumber)) || active.data || {};
    const obs = summarizeObstacles(doc);

    // Varning och ETA med hjälp av utils
    let etaHtml = '', startTimeHtml = '', warningHtml = '', cardClasses = '';
    let progressBarHtml = '';
    const limits = limitsFor(eq, stageKey);

    // Progress bar for Time Limit
    if (limits && limits.timeLimit && (active.task.type === 'stage' || active.task.type === 'transport')) {
      const limitMs = limits.timeLimit * 1000;
      const pct = Math.min(100, Math.max(0, (elapsedMs / limitMs) * 100));

      let colorClass = 'bg-green-500';
      if (pct > 75) colorClass = 'bg-amber-400';
      if (pct > 90) colorClass = 'bg-red-500';

      progressBarHtml = `
         <div class="h-2 w-full bg-gray-200 rounded-full mt-2 overflow-hidden">
           <div class="progress-bar-fill h-full ${colorClass} transition-all duration-300 ease-out" style="width: ${pct}%" data-limit-ms="${limitMs}"></div>
         </div>
       `;
    }


    // Kolla tidsgräns (timeLimit är i sekunder i utils, konvertera till ms)
    if (limits && limits.timeLimit && elapsedMs > (limits.timeLimit * 1000)) {
      cardClasses = 'is-overdue';
      warningHtml = `<div class="absolute top-2 right-2 text-red-600 animate-pulse" title="Tidsgränsen har överskridits!"><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>`;
    }

    if (active.task.type === 'stage' && (stageKey === 'A' || stageKey === 'B')) {
      const eta = calculateETA(active.startTime, eq, stageKey);
      const startTimeStr = toTimeLabel(active.startTime);
      const etaLabel = stageKey === 'A' ? 'ETA Slut A' : 'ETA Mål';

      startTimeHtml = `<div class="text-xs text-gray-500"> Start ${stageKey}: <span class="font-semibold">${startTimeStr}</span></div>`;
      etaHtml = `<div class="text-sm font-semibold text-blue-700 mt-1"> ${etaLabel}: <span class="font">${eta}</span></div>`;
    }

    // --- LIVE SPLITS RENDERER ---
    let splitsHtml = '';
    if (active.task.type === 'obstacle' && doc.live_gateSplits && doc.live_gateSplits.length > 0) {
      const splits = doc.live_gateSplits || [];

      // Look for Persistent Start Time first (new logic), then Active Start Time
      let obstacleStartTs = doc.live_staticStartAt || doc.liveObstacleStartAt;
      if (obstacleStartTs && obstacleStartTs.toMillis) obstacleStartTs = obstacleStartTs.toMillis();

      // FALLBACK: Om klockan är stoppad, hämta starttid från 'obstacleTimes'
      if (!obstacleStartTs && doc.currentObstacle && doc.obstacleTimes && doc.obstacleTimes[doc.currentObstacle]) {
        const ot = doc.obstacleTimes[doc.currentObstacle];
        let st = ot.enteredAt || ot.enteredAtClient;
        if (st && st.toMillis) st = st.toMillis();
        else if (typeof st === 'string') st = new Date(st).getTime();

        if (st && !isNaN(st)) obstacleStartTs = st;
      }

      // Hämta statistik för klassen
      const classStats = calculateClassSplitStats(eq.className, doc.currentObstacle);

      if (obstacleStartTs) {
        // Filtrera: Endast unika versaler (första passagen gäller)
        const uniqueSplits = [];
        const seenChars = new Set();
        for (const s of splits) {
          if (s.char && s.char === s.char.toUpperCase() && !seenChars.has(s.char)) {
            uniqueSplits.push(s);
            seenChars.add(s.char);
          }
        }

        const items = uniqueSplits
          .map(s => {
            let ts = s.ts;
            if (ts && ts.toMillis) ts = ts.toMillis();
            if (!ts) return null;

            // KORRIGERING: Visa total tid från start (absolut split)
            const totalElapsed = ts - obstacleStartTs;

            // Jämför med statistik
            const stat = classStats[s.char];
            let colorClass = 'bg-gray-100 text-gray-700 border-gray-200'; // Default
            let title = '';

            if (stat) {
              // Marginal för "Best": inom 0.1s eller snabbare
              if (totalElapsed <= stat.best + 100) {
                colorClass = 'bg-green-100 text-green-800 border-green-300 ring-1 ring-green-400 font-bold';
                title = `Bäst i klassen! (Bäst: ${(stat.best / 1000).toFixed(1)}s)`;
              } else if (totalElapsed < stat.avg) {
                colorClass = 'bg-blue-50 text-blue-800 border-blue-200';
                title = `Bättre än snittet (${(stat.avg / 1000).toFixed(1)}s)`;
              } else {
                colorClass = 'bg-amber-50 text-amber-800 border-amber-200';
                title = `Sämre än snittet (${(stat.avg / 1000).toFixed(1)}s)`;
              }
            }

            return `<span class="${colorClass} px-1.5 py-0.5 rounded border text-[10px] font-mono" title="${title}">${s.char}: ${(totalElapsed / 1000).toFixed(1)}s</span>`;
          }).filter(Boolean).slice(-8); // Visa 8 senaste

        if (items.length > 0) {
          splitsHtml = `<div class="flex flex-wrap justify-center gap-1 mt-2 mb-1 cursor-help">${items.join('')}</div>`;
        }
      }
    }

    // --- RANKS (placering i klassen) ---
    // Räkna ut placering dynamiskt baserat på det vi vet
    // Filtrera alla ekipage i samma klass
    const classMates = allEquipages.filter(e => e.className === eq.className);
    // Beräkna total straff för alla dessa
    const rankedList = classMates.map(e => {
      const d = allMarathonData.get(String(e.startNumber));
      const p = calculateTotalPenalty(d, e); // Returnerar null om data saknas, Infinity om utesluten
      return { sn: e.startNumber, p: (p === null ? 0 : p) }; // Behandla "ej start" som 0 eller hantera separat?
      // Egentligen: Om man inte startat har man 0 straff, men man borde hamna sist? 
      // Låt oss sortera på straff. De med 0 (men inte startat) är svåra.
      // För enkelhets skull: Vi rankar de som HAR straff > 0 eller har startat.
      // Men maratonstraff börjar på 0.
    }).sort((a, b) => {
      if (a.p === Infinity && b.p === Infinity) return 0;
      if (a.p === Infinity) return 1;
      if (b.p === Infinity) return -1;
      return a.p - b.p;
    });

    // Hitta mitt index
    const myIndex = rankedList.findIndex(x => x.sn === eq.startNumber);
    const placement = (myIndex !== -1) ? myIndex + 1 : '-';
    const rankHtml = `<div class="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded inline-block ml-2" title="Preliminär placering i klassen">Plac: ${placement}</div>`;


    // --- VISUALISERING: TARGET TIME (BÄST I KLASSEN) ---
    // Om vi kör ett hinder, visa vad rekordet är just nu
    let infoHtml = '';
    if (active.task.type === 'obstacle') {
      const stats = calculateClassObstacleStats(eq.className, doc.currentObstacle);
      // Hinderstraff är tid * 0.25 (oftast). Vi vill visa TIDEN att slå (sekunder).
      // Statsen returnerar straffpoäng. Vi får baklängesräkna eller spara tid i stats.
      // Enklast: Spara tid i stats också.
      // Men vänta, 'calculateClassObstacleStats' räknar PENALTY. 
      // Vi vill visa "Tid att slå".
      // Vi får göra en snabb sökning efter bästa TIDEN också om vi vill vara exakta.

      // Låt oss utöka logiken snabbt här inline eller skapa en helper om vi orkar.
      // Helpern 'calculateClassObstacleStats' är bra men returnerar Straff.  
      // Vi gör en snabb sökning här för "Best Time In Seconds"
      let bestSeconds = Infinity;
      for (const [s_sn, s_data] of allMarathonData.entries()) {
        const s_eq = allEquipages.find(e => String(e.startNumber) === s_sn);
        if (!s_eq || s_eq.className !== eq.className) continue;
        const s_res = s_data.obstacles?.find(o => Number(o.number) === Number(doc.currentObstacle));
        if (s_res && Number.isFinite(s_res.timeInSeconds) && !s_res.eliminated) {
          if (s_res.timeInSeconds < bestSeconds) bestSeconds = s_res.timeInSeconds;
        }
      }

      if (bestSeconds !== Infinity) {
        infoHtml = `<div class="text-xs text-gray-500 mt-1 font-mono">Att slå: <span class="font-bold text-green-700">${bestSeconds.toFixed(2)}s</span></div>`;
      }
    }


    if (active.task.type === 'result_flash') {
      const flashData = active.task.data;
      const { timeSec, penalty } = obstacleValues(flashData);
      const timeStr = Number.isFinite(timeSec) ? timeSec.toFixed(2) + 's' : '—';

      let comparisonHtml = '';
      let cardColor = 'bg-white border-blue-500';
      let textColor = 'text-gray-800';

      if (Number.isFinite(penalty)) {
        const n = Number(flashData.number || flashData.obstacleNumber);
        const stats = calculateClassObstacleStats(eq.className, n);
        if (stats) {
          const isBest = penalty <= stats.best + 0.01;
          const isBetter = penalty < stats.avg;

          if (isBest) {
            cardColor = 'bg-green-50 border-green-600 ring-4 ring-green-100';
            comparisonHtml = `<div class="text-xl font-black text-green-700 uppercase tracking-wider animate-pulse">BÄST I KLASSEN!</div>`;
          } else if (isBetter) {
            cardColor = 'bg-blue-50 border-blue-600 ring-4 ring-blue-100';
            comparisonHtml = `<div class="text-lg font-bold text-blue-700">Bra tid! (Bättre än snittet)</div>`;
          } else {
            cardColor = 'bg-white border-gray-400';
            comparisonHtml = `<div class="text-md font-semibold text-gray-500">Tid registrerad</div>`;
          }
          comparisonHtml += `<div class="text-xs text-gray-500 mt-1">Snitt: ${(stats.avg / 0.25).toFixed(2)}s (${stats.avg.toFixed(2)}p)</div>`;
        }
      }

      return `
          <div class="relative rounded-lg shadow-xl p-6 flex flex-col justify-center items-center border-l-8 ${cardColor} h-full transform scale-105 transition-transform">
             <div class="absolute top-2 right-2 text-xs font-mono text-gray-400">RESULTAT</div>
             <h3 class="text-2xl font-bold mb-2 text-center">#${eq.startNumber} ${eq.driverName}</h3>
             <div class="text-sm font-semibold text-gray-600 mb-6">${active.task.name}</div>
             
             <div class="text-6xl font-extrabold mb-4 tracking-tight ${isFinite(penalty) ? 'text-gray-900' : 'text-red-600'}">
                 ${timeStr}
             </div>
             
             <div class="text-center mb-4 font-sans">
                 ${comparisonHtml}
             </div>

             <div class="mt-auto flex gap-4 text-sm text-gray-500 font-sans">
                 <span>Straff: ${Number.isFinite(penalty) ? penalty.toFixed(2) : '—'}</span>
                 <span>Rivn: ${flashData.knockdowns || 0}</span>
             </div>
          </div>
         `;
    }

    return `
  <div class="card-base relative bg-white rounded-lg shadow-lg p-4 flex flex-col justify-between border-l-4 ${active.task.type === 'obstacle' ? 'border-amber-500' : 'border-blue-500'} ${cardClasses} h-full transition-all duration-300">
    ${warningHtml}
        <div>
          <div class="flex justify-between items-start">
            <h3 class="text-lg font-bold">#${eq.startNumber} ${eq.driverName}</h3>
            <div class="flex flex-col items-end gap-1">
                <span class="task-badge px-2 py-0.5 text-xs font-semibold rounded-full ${active.task.type === 'obstacle' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">
                ${active.task.name}
                </span>
            </div>
          </div>
           <div class="text-sm text-gray-600 flex items-center gap-2 mt-1 mb-2 flag-logo-row">
             ${getFlagHtml(eq)}
             ${getClubLogoHtml(eq)}
             <span>${eq.className}</span>
             <span class="rank-badge inline-block">${rankHtml}</span>
           </div>
        </div>

        <div class="text-center my-4">
          <div id="timer-${eq.startNumber}" class="timer-display text-4xl font font-bold tabular-nums">
            ${formatMsLive(elapsedMs)}
          </div>
          ${infoHtml}
          ${splitsHtml}
          ${progressBarHtml}
          <div class="flex justify-center gap-4 mt-2">
            ${startTimeHtml}
            ${etaHtml}
          </div>
        </div>

        <div class="mt-auto">
          ${(() => {
        if (!obs.items.length) return '';
        if (!obs.items.length) return '';
        const chips = obs.items.map(it => {
          const label = it.elim ? 'ELIM' : (Number.isFinite(it.p) ? it.p.toFixed(2) + ' p' : '—');
          const isLive = Number(doc.currentObstacle) === it.n;

          // Jämförelse-logik
          let comparisonClass = '';
          let title = `Hinder ${it.n}`;

          if (!it.elim && Number.isFinite(it.p)) {
            const stats = calculateClassObstacleStats(eq.className, it.n);
            if (stats) {
              const isBest = it.p <= stats.best + 0.01; // Marginal för flyttal
              const isBetterThanAvg = it.p < stats.avg;

              title += `\nStraff: ${it.p.toFixed(2)}\nBäst: ${stats.best.toFixed(2)}\nSnitt: ${stats.avg.toFixed(2)}`;

              if (isBest) comparisonClass = 'bg-green-100 text-green-800 ring-1 ring-green-400 font-bold';
              else if (isBetterThanAvg) comparisonClass = 'bg-blue-50 text-blue-800 ring-1 ring-blue-200';
              else comparisonClass = 'bg-amber-50 text-amber-800 ring-1 ring-amber-200';
            }
          }

          // Fallback style om ingen annan klass satts (och inte elim)
          if (!comparisonClass && !it.elim) comparisonClass = 'bg-gray-100 text-gray-700';

          return `<span class="chip ${it.elim ? 'elim' : ''} ${isLive ? 'chip-live' : ''} ${comparisonClass}" title="${title}">H${it.n}: ${label}</span>`;
        }).join(''); // Space removed to let flex gap handle spacing if we use flex-wrap

        const sumLbl = obs.eliminated ? 'ELIM' : (Number.isFinite(obs.sum) ? obs.sum.toFixed(2) + ' p' : '—');

        const tot = calculateTotalPenalty(doc, eq);
        const totLbl = (tot === Infinity) ? 'ELIM' : (Number.isFinite(tot) ? tot.toFixed(2) + ' p' : '—');

        return `
                <div class="pt-3 border-t mt-2 chip-container">
                  <div class="text-xs text-gray-500 mb-1">Hinder</div>
                  <div class="flex flex-wrap gap-1.5 mb-2">${chips}</div>
                  <div class="flex justify-between items-center text-xs bg-gray-50 p-2 rounded">
                    <div><span class="text-gray-500">Omg. Hinder:</span> <span class="font-semibold ml-1">${sumLbl}</span></div>
                    <div><span class="text-gray-500">Totalt:</span> <span class="font-semibold ml-1">${totLbl}</span></div>
                  </div>
                </div>
            `;
      })()
      }
        </div>
      </div>
  `;
  }).join('');

  grid.querySelectorAll('.relative').forEach(card => {
    const h3 = card.querySelector('h3');
    const sn = h3?.textContent?.match(/#(\d+)/)?.[1];
    if (!sn) return;
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => openMarathonDetailsModal(sn));
  });
}

// ---------- Ticker Logic ----------
function ensureTicker() {
  if (tickerInterval) return;
  tickerInterval = setInterval(() => {
    if (isGloballyPaused) return;

    let needsRender = false;
    activeEquipages.forEach((active, sn) => {
      const timerEl = document.getElementById(`timer-${sn}`);

      // AUTO-EXPIRE FLASH
      if (active.task.type === 'result_flash') {
        if (Date.now() - active.startTime > 20000) {
          // activeEquipages.delete(sn);
          evaluateActiveState(sn);
          needsRender = true;
        }
        return; // Skip timer update for flash cards
      }

      if (timerEl) {

        // KORRIGERING: Beräkna elapsedMs korrekt:
        // Om klockan rullar: Bas + (Nu - Start - Paus)
        // Om klockan står still (men kortet visas): Bas (dvs pausedMs)
        let elapsedMs = active.pausedMs;

        if (active.isRunning) {
          const startTimeMs = active.startTime; // Detta ska vara liveObstacleStartAt för hinder
          if (startTimeMs) {
            elapsedMs = active.pausedMs + (Date.now() - startTimeMs - pausedMsSince(startTimeMs));
          }
        }

        timerEl.textContent = formatMsLive(elapsedMs);

        // Update progress bar
        const cardEl = timerEl.closest('.relative');
        const progressBar = cardEl?.querySelector('.progress-bar-fill');
        if (progressBar) {
          const limitMs = Number(progressBar.getAttribute('data-limit-ms'));
          if (limitMs > 0) {
            const pct = Math.min(100, Math.max(0, (elapsedMs / limitMs) * 100));
            progressBar.style.width = `${pct}%`;

            // Update colors dynamically
            progressBar.classList.remove('bg-green-500', 'bg-amber-400', 'bg-red-500');
            if (pct > 90) progressBar.classList.add('bg-red-500');
            else if (pct > 75) progressBar.classList.add('bg-amber-400');
            else progressBar.classList.add('bg-green-500');
          }
        }

        // Kolla om varning ska visas/döljas
        const limits = limitsFor(active.equipageInfo, active.task.key);
        if (limits && limits.timeLimit && cardEl) {
          const isOverdue = elapsedMs > (limits.timeLimit * 1000);
          if (isOverdue && !cardEl.classList.contains('is-overdue')) {
            needsRender = true;
          }
        }
      }
    });

    if (needsRender && activeEquipages.size > 0) {
      renderMonitor();
    }
  }, 95);
}

function stopTicker() {
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
}

// ---------- Data Logic & Listeners ----------


// ---------- Entrypoint ----------
export async function load() {
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
    const [equipagesRaw, configRaw, startTimesData] = await Promise.all([
      getEquipages(competitionId),
      getConfig(competitionId, 'maratonConfig').catch(() => ({})),
      getConfig(competitionId, 'startTimes').catch(() => ({}))
    ]);

    allEquipages = equipagesRaw || [];
    setMarathonConfig(configRaw || {});
    startTimes = startTimesData || {};

    await ensureClubLogosLoaded();

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

    // 2. Marathon Data Collection
    const unSubMarathon = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton'), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const sn = String(change.doc.id);
        allMarathonData.set(sn, data);

        // Check active state
        evaluateActiveState(sn, data);
      });

      renderSummaryStats();
      renderMonitor();
      renderUpcomingPanel();
      renderFinishedPanel();
    });
    unsubscribes.push(unSubMarathon);

    // 3. Global Pause
    const unSubPause = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'maratonPause'), (docSnap) => {

      if (docSnap.exists()) {
        const d = docSnap.data();
        isGloballyPaused = d.paused || false;
        pauseStartTime = d.startTime || 0;
        // setPauseWindows(d.windows || []); // Update utils if needed

        const banner = document.getElementById('pause-status-banner');
        if (banner) {
          if (isGloballyPaused) {
            banner.classList.remove('hidden');
            banner.textContent = `TÄVLINGEN PAUSAD SEDAN ${toTimeLabel(pauseStartTime)}`;
          } else {
            banner.classList.add('hidden');
          }
        }
      }
    });
    unsubscribes.push(unSubPause);

    ensureTicker();

  } catch (err) {
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

  // Check finished
  if (stageStopTS(data, 'B')) {
    activeEquipages.delete(sn);
    return;
  }

  // Check started
  const startA = stageStartTS(data, 'A');
  const startT = stageStartTS(data, 'transport');
  const startB = stageStartTS(data, 'B');

  if (!startA && !startT && !startB) {
    activeEquipages.delete(sn);
    return;
  }

  // Determine current task
  let task = { name: 'På Banan', type: 'unknown', key: 'unknown' };
  let startTime = 0;

  if (startB) {
    task = { name: 'Etapp B', type: 'stage', key: 'B' };
    startTime = startB;
    if (data.currentObstacle) {
      task = { name: `Hinder ${data.currentObstacle}`, type: 'obstacle', key: 'obstacle' };
      // Obstacle start time logic is complex (live_staticStartAt etc), handled in renderMonitor
      // For sorting activeEquipages, startB is fine as base time
    }
  } else if (startT) {
    task = { name: 'Transport', type: 'transport', key: 'transport' };
    startTime = startT;
  } else if (startA) {
    task = { name: 'Etapp A', type: 'stage', key: 'A' };
    startTime = startA;
  }

  // Check for Flash Result
  if (data.live_flash_result) {
    const flashTs = data.live_flash_timestamp ? (data.live_flash_timestamp.toMillis ? data.live_flash_timestamp.toMillis() : new Date(data.live_flash_timestamp).getTime()) : 0;
    if (Date.now() - flashTs < 15000) { // Show for 15s
      task = { name: 'Resultat: Hinder ' + (data.live_flash_result.number || data.live_flash_result.obstacleNumber), type: 'result_flash', key: 'flash', data: data.live_flash_result };
    }
  }

  activeEquipages.set(sn, {
    equipageInfo: eq,
    data: data,
    task: task,
    startTime: startTime, // Base start time regarding the stage
    pausedMs: 0, // Simplified for now, calculated in render
    isRunning: !isGloballyPaused
  });
}


export function __unload() {
  unsubscribes.forEach(u => u && u());
  unsubscribes = [];
  if (tickerInterval) clearInterval(tickerInterval);
}


