// js/pages/maraton-stages-input.js
import { stagePenaltyFromMs, limitsFor, formatMsLive, setMarathonConfig, getPauseTime, pausedMsSince, isDurationSuspicious } from '../../utils/marathonUtils.js';
import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { finalizeMarathon as finalizeMarathonService } from '../../services/finalizationService.js';
import { getMarathonStateDocuments } from '../../services/marathonService.js';
import { listenForMaratonCollection } from '../../services/marathonService.js';
import { getCompetitionHeader, renderCompetitionModeBanner, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { doc, getDoc, setDoc, serverTimestamp, collection, onSnapshot, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { downloadJson } from '../../utils/sharedUtils.js';
import { requestWakeLock } from '../../utils/wakeLock.js';
import { readNewestBackupData, writeMergedBackup } from '../../utils/fieldBackup.js';

// --- Wrapper functions for marathonUtils ---

function normalizeStageForEquipage(eq, stage) {
  if (!eq) return stage;
  if (stage === 'warmup') {
    const limA = limitsFor(eq, 'A');
    const isFTA = limA && limA.ideal > 0 && limA.max === limA.ideal && limA.min === 0;
    if (isFTA) return 'A';
  }
  return stage;
}

function getStageThresholds(equipageSnOrObj, stage) {
  const eq = resolveEquipage(equipageSnOrObj);
  const st = normStage(stage);
  const lim = eq ? limitsFor(eq, st) : null;
  if (!lim) return null;
  return {
    minMs: lim.min * 1000,
    maxMs: lim.max * 1000,
    timeLimitMs: lim.timeLimit * 1000
  };
}

function computeTimePenalty(equipageSnOrObj, stage, ms) {
  const eq = resolveEquipage(equipageSnOrObj);
  const st = normStage(stage);

  const lim = eq ? limitsFor(eq, st) : null;

  if (!Number.isFinite(ms) || ms <= 0) {
    return {
      secondsOut: null,
      points: null,
      rate: null,
      tlMs: lim ? lim.ideal * 1000 : null,
      minMs: lim ? lim.min * 1000 : null,
      maxMs: lim ? lim.max * 1000 : null
    };
  }

  // Om vi saknar equipage/limits kan vi inte räkna straff korrekt
  if (!eq || !lim) {
    return {
      secondsOut: null,
      points: null,
      rate: null,
      tlMs: null,
      minMs: null,
      maxMs: null
    };
  }

  const { points, elim } = stagePenaltyFromMs(ms, eq, st);

  let secondsOut = 0;
  const s = ms / 1000;
  if (s < lim.min) secondsOut = lim.min - s;
  else if (s > lim.max) secondsOut = s - lim.max;

  return {
    secondsOut: secondsOut > 0 ? secondsOut : null,
    points: elim ? 'ELIM' : points,
    rate: 0.25,
    tlMs: (lim && lim.ideal) ? lim.ideal * 1000 : null,
    minMs: (lim && lim.min) ? lim.min * 1000 : null,
    maxMs: (lim && lim.max) ? lim.max * 1000 : null
  };
}

// WRAPPER FUNCTIONS REMOVED (Defined at top of file)
// Legacy compatibility wrappers have been merged into the top definitions.

// Småhjälp: numerikkoll (används av populateStageUI m.fl.)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function resolveEquipage(equipageSnOrObj) {
  if (!equipageSnOrObj) return null;
  if (typeof equipageSnOrObj === 'object') return equipageSnOrObj;
  // annars antas startnummer
  return findEquipageBySn(String(equipageSnOrObj)) || null;
}

function normStage(stage) {
  // config/limits brukar använda "transfer" medan UI använder "transport"
  return stage === 'transport' ? 'transfer' : stage;
}


// FUNKTION FÖR ATT HANTERA GLOBAL PAUS
function listenForGlobalCompetitionPause() {
  if (!competitionId || !appId) return;
  const statusRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus');
  let lastPauseState = false;
  let pauseStartTime = 0;

  return onSnapshot(statusRef, (docSnap) => {
    const isPaused = docSnap.exists() && docSnap.data().isPaused === true;
    isGloballyPaused = isPaused; // <-- UPPDATERA DEN GLOBALA VARIABELN

    if (isPaused && !lastPauseState) {
      // TÄVLINGEN PAUSAS NU

      if (tickInterval) clearInterval(tickInterval);
      tickInterval = null;
      pauseStartTime = Date.now();
      document.body.style.filter = 'grayscale(80%)';

    } else if (!isPaused && lastPauseState) {
      // TÄVLINGEN ÅTERUPPTAS NU
      const pauseDurationMs = Date.now() - pauseStartTime;

      for (const timer of activeTimers.values()) {
        if (timer.isRunning) {
          timer.startEpoch += pauseDurationMs;
        }
      }

      ensureGlobalTicker();
      document.body.style.filter = '';
    }
    lastPauseState = isPaused;
  });
}

// ---------- State ----------
let competitionId = null;
let equipages = [];
let dropdown = null;
let isGloballyPaused = false;

let currentEquipage = null;     // valt ekipage-objekt
let currentStage = 'warmup';    // 'warmup' | 'A' | 'transport' | 'B'
let currentDocData = null;      // firestore-dokument för valt ekipage

// Starttider → ordning för pilarna
let startTimes = {};                 // { [sn]: { marathon: 'YYYY-MM-DDTHH:mm', ... } }
let orderByMarathonStart = [];       // array av equipage i rätt ordning
let currentIndex = -1;               // index i orderByMarathonStart

// Globalt: parallella timrar per ekipage+etapp
const activeTimers = new Map(); // key: `${ sn }| ${ stage } ` → { isRunning, startEpoch, pausedMs }
let tickInterval = null;
// --- Global lyssnare över alla ekipage/etapper (maraton/marathon, med/utan *Timing) ---
let unsubAllA = null;  // maratonTiming
let unsubAllB = null;  // marathonTiming
let unsubAllC = null;  // maraton
let unsubAllD = null;  // marathon
let unsubscribeGlobalPause = null;
let keyboardShortcutHandler = null;

function extractStageFromDocData(data, stage) {
  const flat = stage === 'warmup' ? 'warmup' : (stage === 'transport' ? 'transfer' : stage);
  const key = stage.toUpperCase(); // A|B|WARMUP|TRANSPORT

  const startClock = data?.[`start_${key}`] ?? data?.[`start_${flat}`] ?? null;
  const stopClock = data?.[`finish_${key}`] ?? data?.[`finish_${flat}`] ?? null;
  const durationMs = data?.[`duration_${flat}_ms`] ?? null;
  const runningSince = data?.[`runningSince_${flat}`] ?? null;

  return { startClock, stopClock, durationMs, runningSince };
}

function upsertActiveTimerFromStage(sn, stage, st) {
  const eq = findEquipageBySn(sn);
  const actualStage = normalizeStageForEquipage(eq, stage);
  const key = `${sn}|${actualStage}`;

  const hasStart = !!st?.startClock;
  const hasStop = !!st?.stopClock;

  if (!hasStart || hasStop) {
    if (activeTimers.has(key)) {
      activeTimers.delete(key);
      renderActiveCards?.();
    }
    return;
  }

  const startMs = Date.parse(st.runningSince || st.startClock);
  if (!isFinite(startMs)) return;

  const durationMs = Number(st.durationMs);
  const paused = Number.isFinite(durationMs) ? durationMs : 0;
  const t = { isRunning: true, startEpoch: startMs, pausedMs: paused };

  activeTimers.set(key, t);
  ensureGlobalTicker();
  renderActiveCards?.();
}

function syncActiveFromSnapshot(snap) {
  // Always iterate through all docs to handle initial load and updates robustly
  snap.docs.forEach(doc => {
    const data = doc.data();
    const sn = doc.id;
    // Check all relevant stages
    ['warmup', 'A', 'transport', 'B'].forEach(stage => {
      const st = extractStageFromDocData(data, stage);
      upsertActiveTimerFromStage(sn, stage, st);
    });
  });
  renderActiveCards();
}

function subscribeAllActiveTimers() {
  [unsubAllA, unsubAllB, unsubAllC, unsubAllD].forEach(fn => { try { fn && fn(); } catch { } });
  unsubAllA = unsubAllB = unsubAllC = unsubAllD = null;

  const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
  try {
    const col = collection(db, `${base}/maraton`);
    // Notera: lyssnar på /maraton (svenska). Om data ligger i /marathon syns det inte här.
    // Vi förutsätter att tävlingen körs mot svensk path (standard).
    unsubAllC = onSnapshot(col, syncActiveFromSnapshot, (e) =>
      console.warn('[active] maraton lyssning misslyckades', e?.code || e)
    );
  } catch (e) {
    console.error('[active] kunde inte lyssna på /maraton', e);
  }
}

// ---- Marathon config cache ----
let maratonConfig = null; // fylls i load()
let unsubscribeStageDoc = null;
let listeningStartNumber = null;

// --- DUPLICATE LOGIC REMOVED: getStageThresholds, getAllowedMsForEquipage, findSettingsForClass ---
// Please use wrapper functions at the top of this file leveraging marathonUtils.js

// ---- Firestore refs (svensk stavning först) ----
function maratonDocRef(startNumber) {
  return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`, String(startNumber));
}
function marathonDocRef_EN(startNumber) {
  return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/marathon`, String(startNumber));
}

// Skapa dokumentet på ett "säkert" sätt (första skrivningen)
async function ensureMaratonDoc(sn) {
  const ref = maratonDocRef(sn);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        startNumber: Number(sn),
        className: currentEquipage?.className || '',
        running: false,
        currentObstacle: null,
        updatedAt: serverTimestamp()
      }, { merge: true });
      return;
    } catch (e) {
      if (e.code !== 'permission-denied') throw e;
      // Fallback till engelska om reglerna bara tillåter /marathon
      const refEN = marathonDocRef_EN(sn);
      const snapEN = await getDoc(refEN);
      if (!snapEN.exists()) {
        await setDoc(refEN, {
          startNumber: Number(sn),
          className: currentEquipage?.className || '',
          running: false,
          currentObstacle: null,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    }
  }
}

function fmtMsTimer(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '00:00,00';
  const cs = Math.floor(ms / 10) % 100;
  const totalSec = Math.floor(ms / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(cs).padStart(2, '0');
}

function stageNiceLabel(stage) {
  if (stage === 'warmup') return 'Warm-up';
  if (stage === 'transport') return 'Transport';
  return stage; // 'A' eller 'B'
}

function decorateStageLabel(stage, equipage = null) {
  return stageNiceLabel(normalizeStageForEquipage(equipage, stage));
}

function findEquipageBySn(sn) {
  return (Array.isArray(equipages) ? equipages : allEquipages || [])
    .find(e => String(e.startNumber) === String(sn));
}


// ---------- Utils ----------
const pad2 = (n) => String(n).padStart(2, '0');
const nowMs = () => Date.now();
function msToLabel(ms) {
  const t = Math.max(0, Math.floor(ms || 0));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `${pad2(m)}:${pad2(s)},${pad2(cs)}`;
}
function parseLocalDateTime(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// "mmsscc" → ms (accepterar även 1–6 siffror; paddar med nollor)
function digitsToMs(d) {
  const s = (d || "").replace(/\D/g, '').slice(0, 6).padEnd(6, '0');
  const mm = +s.slice(0, 2), ss = +s.slice(2, 4), cs = +s.slice(4, 6);
  return (mm * 60 + ss) * 1000 + cs * 10;
}

function secToMMSS(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function rebuildOrder() {
  orderByMarathonStart = [...equipages].sort((a, b) => {
    const ta = parseLocalDateTime(startTimes[String(a.startNumber)]?.marathon ?? startTimes[String(a.startNumber)]?.maraton);
    const tb = parseLocalDateTime(startTimes[String(b.startNumber)]?.marathon ?? startTimes[String(b.startNumber)]?.maraton);
    if (ta && tb) return ta - tb;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    return (a.startNumber || 0) - (b.startNumber || 0);
  });
  currentIndex = currentEquipage
    ? orderByMarathonStart.findIndex(e => String(e.startNumber) === String(currentEquipage.startNumber))
    : -1;
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

function renderActiveCards() {
  const host = document.getElementById('activeTimers');
  if (!host) return;

  // NYTT: Uppdatera toggle-knappen med antalet
  const toggleBtn = document.getElementById('toggleActiveTimers');
  if (toggleBtn) {
    const labelEl = toggleBtn.querySelector('span:not(.arrow)');
    if (labelEl) {
      labelEl.textContent = `${t('marathon_stages_active_timers')} (${activeTimers.size})`;
    }
    toggleBtn.disabled = activeTimers.size === 0;
  }
  // NYTT: Håll listan stängd om den är tom
  if (activeTimers.size === 0) {
    document.getElementById('activeTimersWrapper')?.classList.remove('is-open');
  }

  const parts = [];
  for (const [key, timerObj] of activeTimers) {
    const [sn, stage] = key.split('|');
    const eq = findEquipageBySn(sn);
    const name = eq?.driverName || t('marathon_stages_unknown_driver');
    const ms = timerObj?.isRunning ? (timerObj.pausedMs + (Date.now() - timerObj.startEpoch)) : (timerObj?.pausedMs || 0);

    parts.push(`
<div class="flex items-center justify-between px-3 py-2 rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700"
     data-active="${sn}|${stage}">
  <button class="card-left text-left"
          data-sn="${sn}" data-stage="${stage}">
    <div class="text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline">
      ${name} <span class="text-gray-500 dark:text-gray-400">#${sn}</span>
    </div>
    <div class="text-xs text-gray-500 dark:text-gray-400">${decorateStageLabel(stage, eq)}</div>
  </button>
  <div class="flex items-center gap-3">
    <div class="timer font-mono tabular-nums text-lg dark:text-gray-200">${fmtMsTimer(ms)}</div>
    <button class="stop px-2 py-1 text-xs rounded bg-rose-600 text-white hover:bg-rose-700">${t('marathon_stages_stop')}</button>
  </div>
</div>
    `);
  }
  host.innerHTML = parts.join('') || `<div class="text-sm text-gray-500 dark:text-gray-400">${t('marathon_stages_no_active_timers')}</div>`;
}

// ---------- Firestore helpers ----------
function stageFlatPrefix(stage) {
  return stage === 'warmup' ? 'warmup' : (stage === 'transport' ? 'transfer' : stage);
}
function makeStageTimingFromFlat(doc, stage) {
  const flat = stage === 'warmup' ? 'warmup' : (stage === 'transport' ? 'transfer' : stage);
  const key = stage.toUpperCase();

  const startClock = doc[`start_${key}`] ?? doc[`start_${flat}`] ?? null;
  const stopClock = doc[`finish_${key}`] ?? doc[`finish_${flat}`] ?? null;
  const durationMs = doc[`duration_${flat}_ms`] ?? null;
  const runningSince = doc[`runningSince_${flat}`] ?? null;

  const commentStart = doc[`commentStart_${flat}`] ?? '';
  const commentStop = doc[`commentStop_${flat}`] ?? '';

  const base = { startClock, stopClock, durationMs, runningSince, commentStart, commentStop };

  if (stage === 'B') {
    const bitCheckOk = (typeof doc.bettOk !== 'undefined' ? doc.bettOk : doc.bitCheckOk);
    const bitCheckComment = (doc.bettComment ?? doc.bitCheckComment) ?? '';
    return { ...base, ...(typeof bitCheckOk !== 'undefined' ? { bitCheckOk } : {}), bitCheckComment };
  }
  return base;
}

function hydrateTimingFromFlat(doc) {
  const t = {};
  ['warmup', 'A', 'transport', 'B'].forEach(stage => {
    t[stage] = makeStageTimingFromFlat(doc, stage);
  });
  return { ...doc, timing: t };
}

function stagesBackupKey(sn) {
  if (!competitionId || !sn) return null;
  return `bkp_${competitionId}_${sn}`;
}

function readStagesBackup(sn) {
  return readNewestBackupData([stagesBackupKey(sn)]);
}

async function readStageDoc(sn) {
  try {
    const snap = await getDoc(maratonDocRef(sn));
    if (snap.exists()) {
      const data = snap.data();
      mirrorToLocal(sn, data);
      return hydrateTimingFromFlat(data);
    }
  } catch (error) {
    console.warn('[maraton-stages] Kunde inte läsa etappdokument, använder lokal backup om den finns.', error);
  }

  const backupData = readStagesBackup(sn);
  return backupData ? hydrateTimingFromFlat(backupData) : null;
}

async function saveStageSnapshot(stage, payload) {
  if (!currentEquipage) return;

  const sn = String(currentEquipage.startNumber);
  const className = currentEquipage.className || '';
  await ensureMaratonDoc(sn);

  // Mappning av etapp → nycklar
  const stageKey = stage.toUpperCase();                   // 'A' | 'B' | 'WARMUP' | 'TRANSPORT'
  const flatPrefix = stage === 'warmup' ? 'warmup'
    : (stage === 'transport' ? 'transfer' : stage);

  // --- Bygg PLATT skrivning (inkl. legacy-fälten; 'in' gör att null skrivs) ---
  const flat = { startNumber: currentEquipage.startNumber, className };

  if ('startClock' in payload) {
    flat[`start_${stageKey}`] = payload.startClock;
    flat[`start_${flatPrefix}`] = payload.startClock;
    // legacy-nycklar (så reset rensar även gamla läsningar)
    flat[`startClock_${stageKey}`] = payload.startClock;
    flat[`startClock_${flatPrefix}`] = payload.startClock;
  }
  if ('stopClock' in payload) {
    flat[`finish_${stageKey}`] = payload.stopClock;
    flat[`finish_${flatPrefix}`] = payload.stopClock;
    // legacy-nycklar
    flat[`stopClock_${stageKey}`] = payload.stopClock;
    flat[`stopClock_${flatPrefix}`] = payload.stopClock;
  }
  if ('durationMs' in payload) {
    flat[`duration_${flatPrefix}_ms`] = payload.durationMs;
  }
  if ('runningSince' in payload) {
    flat[`runningSince_${flatPrefix}`] = payload.runningSince;
  }
  if ('commentStart' in payload) {
    flat[`commentStart_${flatPrefix}`] = payload.commentStart ?? '';
  }
  if ('commentStop' in payload) {
    flat[`commentStop_${flatPrefix}`] = payload.commentStop ?? '';
  }
  if ('runningStage' in payload) {
    // Praktiskt för vyer som vill veta vilken etapp som pågår
    flat.runningStage = payload.runningStage; // string eller null
  }

  // B- (bettkontroll) – skriv båda nyckelvarianterna för kompatibilitet
  if (stage === 'B') {
    if ('bitCheckOk' in payload) {
      flat.bitCheckOk = !!payload.bitCheckOk;
      flat.bettOk = !!payload.bitCheckOk;         // alias (legacy)
    }
    if ('bitCheckComment' in payload) {
      flat.bitCheckComment = payload.bitCheckComment ?? '';
      flat.bettComment = payload.bitCheckComment ?? ''; // alias (legacy)
    }
  }

  // --- Spegla även till NÄSTLAT så allt gammalt rensas korrekt ---
  // Vi läser inte längre nästlat som "sanning", men andra vyer/äldre kod kan göra det.
  // Att skriva null här gör att gamla värden inte kan "studsa tillbaka".
  const nestedStageTarget = {};
  if ('startClock' in payload) nestedStageTarget.startClock = payload.startClock;
  if ('stopClock' in payload) nestedStageTarget.stopClock = payload.stopClock;
  if ('durationMs' in payload) nestedStageTarget.durationMs = payload.durationMs;
  if ('runningSince' in payload) nestedStageTarget.runningSince = payload.runningSince;
  if ('commentStart' in payload) nestedStageTarget.commentStart = payload.commentStart ?? '';
  if ('commentStop' in payload) nestedStageTarget.commentStop = payload.commentStop ?? '';

  if (Object.keys(nestedStageTarget).length) {
    for (const [k, v] of Object.entries(nestedStageTarget)) {
      flat[`stages.${stage}.${k}`] = v;
      flat[`timing.${stage}.${k}`] = v;
    }
  }

  // --- Skriv EN gång (bara /maraton) ---
  await setDoc(
    maratonDocRef(sn),
    { ...flat, updatedAt: serverTimestamp() },
    { merge: true }
  );

  // --- Uppdatera lokal cache/UI (respektera null) ---
  currentDocData = currentDocData || {};
  currentDocData.timing = currentDocData.timing || {};
  const prev = currentDocData.timing[stage] || {};

  currentDocData.timing[stage] = {
    ...prev,
    ...('startClock' in payload ? { startClock: payload.startClock } : {}),
    ...('stopClock' in payload ? { stopClock: payload.stopClock } : {}),
    ...('durationMs' in payload ? { durationMs: payload.durationMs } : {}),
    ...('runningSince' in payload ? { runningSince: payload.runningSince } : {}),
    ...('commentStart' in payload ? { commentStart: payload.commentStart ?? '' } : {}),
    ...('commentStop' in payload ? { commentStop: payload.commentStop ?? '' } : {}),
    ...(stage === 'B' && 'bitCheckOk' in payload ? { bitCheckOk: !!payload.bitCheckOk } : {}),
    ...(stage === 'B' && 'bitCheckComment' in payload ? { bitCheckComment: payload.bitCheckComment ?? '' } : {}),
  };
}

function applyDocToLocalState(sn, rawDoc) {
  // Gör om platta fält -> timing, precis som readStageDoc gör
  const data = rawDoc ? hydrateTimingFromFlat(rawDoc) : null;

  // Uppdatera currentDocData om detta ekipage är valt
  currentDocData = data || {};
  populateStageUI(currentStage, currentDocData);
  updateTimerLabel(currentStage);
  updateTabStatuses(currentDocData);

  // Synka aktiva timers lokalt per etapp
  const stages = ['warmup', 'A', 'transport', 'B'];
  const eq = findEquipageBySn(sn);

  for (const stage of stages) {
    const actualStage = normalizeStageForEquipage(eq, stage);
    const tKey = `${sn}|${actualStage}`;
    const st = data?.timing?.[stage] || {};

    // Om "pågående" (har startClock men saknar stopClock) -> säkerställ att vi har en tickande lokal timer
    if (st.startClock && !st.stopClock) {
      const startTs = Date.parse(st.runningSince || st.startClock);
      const durationMs = Number(st.durationMs);
      const pausedMs = Number.isFinite(durationMs) ? durationMs : 0;
      let t = activeTimers.get(tKey);
      if (!t) {
        t = { isRunning: true, startEpoch: startTs, pausedMs };
        activeTimers.set(tKey, t);
      } else {
        t.isRunning = true;
        t.startEpoch = startTs;
        t.pausedMs = pausedMs;
      }
    } else {
      // Om etappen inte längre pågår (har stopp eller saknar start)
      // Men vi måste vara försiktiga: om vi normaliserade till en annan etapp (t.ex. warmup -> A),
      // ska vi bara ta bort timern om båda snapshot-etapperna är klara.
      // Egentligen räcker det att upsertActiveTimerFromStage skött det via syncActiveFromSnapshot, 
      // men här gör vi det per-dokument för omedelbar respons.
      if (activeTimers.has(tKey)) {
        // Kolla en gång till: finns det NÅGON del av denna normaliserade etapp som fortfarande körs?
        const isRunningAny = stages.some(s => {
          if (normalizeStageForEquipage(eq, s) !== actualStage) return false;
          const d = data?.timing?.[s] || {};
          return d.startClock && !d.stopClock;
        });

        if (!isRunningAny) {
          removeActiveCard(tKey);
          activeTimers.delete(tKey);
        }
      }
    }
  }

  // Rita om listan med parallella timers och se till att tickern snurrar vid behov
  renderActiveCards();
  ensureGlobalTicker();
}

function tsToMillis(ts) {
  if (!ts) return 0;
  // klarar Firebase Timestamp, Date, String, eller null/undefined
  try { if (ts.toMillis) return ts.toMillis(); } catch { }
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? 0 : parsed;
  }
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}

function subscribeToEquipageDoc(sn) {
  // stäng ev. tidigare lyssnare
  if (unsubscribeStageDoc) { try { unsubscribeStageDoc(); } catch { } unsubscribeStageDoc = null; }
  listeningStartNumber = String(sn);

  // en enda källa: /maraton
  unsubscribeStageDoc = onSnapshot(
    maratonDocRef(sn),
    (snap) => {
      // Uppdatera global synk-status baserat på metadata
      if (typeof window.setSyncStatus === 'function') {
        window.setSyncStatus(snap.metadata.hasPendingWrites);
      }
      const data = snap.exists() ? snap.data() : readStagesBackup(sn);
      if (snap.exists() && data) mirrorToLocal(sn, data); // Backuppa lokalt
      applyDocToLocalState(sn, data);
    },
    (err) => {
      console.error('[maraton-stages] onSnapshot /maraton error', err?.code || err);
      applyDocToLocalState(sn, readStagesBackup(sn));
    }
  );
}

// ---------- Global ticker ----------
function ensureGlobalTicker() {
  // Starta bara om den inte redan körs OCH om tävlingen INTE är pausad
  if (!tickInterval && !isGloballyPaused) {
    tickInterval = setInterval(tickAll, 95);
  }
}

// Mirror data to localStorage for redundancy
function mirrorToLocal(sn, data) {
  if (!sn || !data) return;
  try {
    writeMergedBackup(stagesBackupKey(sn), data);
  } catch (e) {
    console.warn('Could not mirror to localStorage', e);
  }
}
function stopGlobalTickerIfIdle() {
  const limA = currentEquipage ? limitsFor(currentEquipage, 'A') : null;
  const isFixedTimeA = limA && limA.ideal > 0 && limA.max === limA.ideal && limA.min === 0;
  const bStarted = currentDocData?.timing?.['B']?.startClock;
  const isViewingETA = isFixedTimeA && ['A', 'warmup', 'B'].includes(currentStage) && !bStarted;

  if (activeTimers.size === 0 && tickInterval && !isViewingETA) {
    clearInterval(tickInterval); tickInterval = null;
  }
}
function tickAll() {
  const now = Date.now();

  // Måla alla aktiva timers i listan
  for (const key of activeTimers.keys()) {
    paintTimer(key, now);
  }

  // Säkerställ att huvudpanelen inte "driftar":
  // Om aktuell panel INTE har en aktiv timer, uppdatera den från cache (doc-data)
  if (currentEquipage && currentStage) {
    const key = `${currentEquipage.startNumber}|${currentStage}`;
    if (!activeTimers.has(key)) {
      updateTimerLabel(currentStage); // din befintliga funktion; bör läsa från doc/pausedMs
    }
  }
}

function paintTimer(key, now = Date.now()) {
  const [sn, stage] = key.split('|');
  const t = activeTimers.get(key);
  const ms = t?.isRunning ? (t.pausedMs + (now - t.startEpoch)) : (t?.pausedMs || 0);

  // 1) Uppdatera lilla rad-timern i "Aktiva timrar"
  const small = document.querySelector(`[data-active="${sn}|${stage}"] .timer`);
  if (small) small.textContent = fmtMsTimer(ms);

  // 2) Uppdatera huvudpanelen ENDAST om detta är nuvarande ekipage + etapp
  const eq = findEquipageBySn(sn);
  const isCurrentPanel =
    currentEquipage &&
    String(currentEquipage.startNumber) === String(sn) &&
    normalizeStageForEquipage(currentEquipage, currentStage) === normalizeStageForEquipage(eq, stage);

  if (isCurrentPanel) {
    const big = document.getElementById(`timer-${currentStage}`);
    if (big) {
      big.textContent = fmtMsTimer(ms);
      // färglägg enligt TL/max etc
      applyTimerColor(big, sn, stage, ms);
    }
    // fyll TL/avvikelse/straff-raden under timern
    updateTimerInfo(stage, sn, ms);
  }
}

// Format-hjälp
function fmtMsMMSS(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// Hämta ev. koefficient för tidsstraff från admin-config
// (Hanteras nu via marathonUtils inuti computeTimePenalty-wrappern)

// Beräkna straffsekunder & straffpoäng för aktuellt ms och etapp
// (Hanteras nu via computeTimePenalty-wrappern högst upp i filen)

// Skriv ut TL + straffrad under timern
function updateTimerInfo(stage, equipageSnOrObj, ms) {
  const tlEl = document.getElementById(`info-${stage}-tl`);
  const devEl = document.getElementById(`info-${stage}-dev`);
  const penEl = document.getElementById(`info-${stage}-pen`);
  const timerEl = document.getElementById(`timer-${stage}`);
  if (!tlEl && !devEl && !penEl) return;

  const res = computeTimePenalty(equipageSnOrObj, stage, ms);

  // --- NYTT: DISKREPANS-KOLL (Tid vs Klockslag) ---
  const stData = currentDocData?.timing?.[stage];
  if (stData && stData.startClock && stData.stopClock) {
    const startMs = new Date(stData.startClock).getTime();
    const stopMs = new Date(stData.stopClock).getTime();
    const clockDurationMs = stopMs - startMs;
    const diff = Math.abs(clockDurationMs - ms);

    // Om det skiljer mer än 1 sek, varna herrejösses-mycket
    if (diff > 1000 && timerEl) {
      timerEl.classList.add('discrepancy-warning');
      timerEl.title = t('marathon_stages_discrepancy_warning').replace('{computed}', fmtMsTimer(clockDurationMs)).replace('{manual}', fmtMsTimer(ms));
    } else if (timerEl) {
      timerEl.classList.remove('discrepancy-warning');
      timerEl.title = t('marathon_stages_click_manual_time');
    }
  }

  // TL (bara själva tiden)
  if (tlEl) {
    tlEl.textContent = (res.tlMs != null) ? fmtMsMMSS(res.tlMs) : '–';
  }

  // Tid kvar till B (om Fixed Time A)
  const etaBox = document.getElementById(`box-${stage}-etaB`);
  const etaEl = document.getElementById(`info-${stage}-etaB`);
  if (etaBox && etaEl) {
    const eq = resolveEquipage(equipageSnOrObj);
    const limA = eq ? limitsFor(eq, 'A') : null;
    const isFixedTimeA = limA && limA.ideal > 0 && limA.max === limA.ideal && limA.min === 0;

    // Show on A/Warmup ALWAYS if FixedTime. Show on B ONLY if B hasn't started yet.
    const isStageB = stage === 'B';
    const bStarted = currentDocData?.timing?.['B']?.startClock;
    const isWarmupFinished = !!currentDocData?.timing?.['warmup']?.stopClock || !!currentDocData?.timing?.['A']?.stopClock;

    // Vi visar "Rast" om sträckan är klar eller om det är Fixed Time
    const shouldShowEta = isFixedTimeA && (!isStageB || (isStageB && !bStarted));

    if (shouldShowEta) {
      const tlMs = limA.ideal * 1000;
      etaBox.classList.remove('hidden');

      // Byt etikett om sträckan är klar
      const labelEl = etaBox.querySelector('span:first-child');
      if (labelEl && isWarmupFinished) labelEl.textContent = t('marathon_stages_rest_left');

      const warmupDoc = currentDocData?.timing?.['warmup'] || currentDocData?.timing?.['A'];

      if (warmupDoc && (warmupDoc.startClock || warmupDoc.durationMs)) {
        const pauseTimeMs = getPauseTime() * 60 * 1000;
        let totalElapsedMs = 0;

        if (isWarmupFinished && warmupDoc.stopClock) {
          // Har gått i mål på A, vilar nu.
          const stopMs = tsToMillis(warmupDoc.stopClock);
          const durA = Number.isFinite(warmupDoc.durationMs)
            ? warmupDoc.durationMs
            : (stopMs - tsToMillis(warmupDoc.startClock) - pausedMsSince(tsToMillis(warmupDoc.startClock)));

          const activeRestTime = (Date.now() - stopMs) - pausedMsSince(stopMs);
          totalElapsedMs = durA + activeRestTime;
        } else {
          // A pågår fortfarande (eller är pausad)
          const sn = String(eq.startNumber);
          const wStageKey = currentDocData?.timing?.['A'] ? 'A' : 'warmup';
          const tMap = activeTimers.get(`${sn}|${wStageKey}`);

          if (tMap && tMap.isRunning) {
            totalElapsedMs = tMap.pausedMs + (Date.now() - tMap.startEpoch);
          } else if (warmupDoc.startClock && !warmupDoc.stopClock) {
            const startMs = tsToMillis(warmupDoc.startClock);
            const durA = warmupDoc.durationMs || 0;
            totalElapsedMs = durA + (Date.now() - startMs) - pausedMsSince(startMs);
          } else {
            totalElapsedMs = warmupDoc.durationMs || 0;
          }
        }

        const timeLeftMs = (tlMs + pauseTimeMs) - totalElapsedMs;

        if (timeLeftMs >= 0) {
          etaEl.textContent = fmtMsMMSS(timeLeftMs);
          etaEl.className = 'tabular-nums text-sm md:text-base font-bold text-blue-600 dark:text-blue-400';
          if (isWarmupFinished) etaBox.style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
        } else {
          etaEl.textContent = '-' + fmtMsMMSS(Math.abs(timeLeftMs));
          etaEl.className = 'tabular-nums text-sm md:text-base font-bold text-red-600 dark:text-red-400 animate-pulse';
          if (isWarmupFinished) etaBox.style.backgroundColor = 'rgba(225, 29, 72, 0.1)';
        }
      } else {
        etaBox.classList.add('hidden');
      }
    } else {
      etaBox.classList.add('hidden');
    }
  }

  // Avvikelse (mm:ss)
  if (devEl) {
    if (stage === 'transport') {
      devEl.textContent = '–';
    } else {
      devEl.textContent = (res.secondsOut != null) ? secToMMSS(res.secondsOut) : '–';
    }
  }

  // Straff (endast siffra; transport har inget per-sekundstraff)
  if (penEl) {
    if (stage === 'transport') {
      penEl.textContent = '–';
    } else {
      penEl.textContent = (res.points != null) ? String(res.points) : '–';
    }
  }
}

function applyTimerColor(el, equipageSnOrObj, stage, ms) {
  el.classList.remove('text-gray-900', 'dark:text-white', 'text-emerald-600', 'text-rose-600');

  const th = getStageThresholds(equipageSnOrObj, stage);
  if (!th) { el.classList.add('text-gray-900', 'dark:text-white'); return; }

  // Transport: röd först när tidsgräns (ELIM) passeras
  if (stage === 'transport') {
    if (Number.isFinite(th.timeLimitMs) && ms > th.timeLimitMs) {
      el.classList.add('text-rose-600');
    } else {
      el.classList.add('text-gray-900', 'dark:text-white');
    }
    return;
  }

  // A, B, WU: svart < min, grön inom [min, max], röd > max
  if (Number.isFinite(th.minMs) && ms < th.minMs) {
    el.classList.add('text-gray-900', 'dark:text-white');
  } else if (Number.isFinite(th.maxMs) && ms <= th.maxMs) {
    el.classList.add('text-emerald-600');
  } else {
    el.classList.add('text-rose-600');
  }
}

// ---------- UI ----------
// RAD FÖRE (ca 1089): }

function renderLayout() {
  const comp = getGlobalState('currentCompetition');
  const root = document.getElementById('page-maraton-stages');
  if (!root) return;

  root.innerHTML = `
    <style>
      .comment-wrapper { display: none; }
      .comment-wrapper.comment-visible { display: block; margin-top: 8px; }
      
      .toggle-btn {
          background: none;
          border: 1px solid #cbd5e1;
          border-radius: 99px;
          padding: 4px 10px;
          font-size: 11px;
          line-height: 1.2;
          color: #475569;
          cursor: pointer;
          white-space: nowrap;
      }
      .dark .toggle-btn { border-color: #4b5563; color: #d1d5db; }
      .toggle-btn.has-comment { border-color: #2563eb; color: #2563eb; font-weight: 600; }
      .dark .toggle-btn.has-comment { border-color: #60a5fa; color: #60a5fa; }

      .active-timers-list { display: none; }
      .active-timers-wrapper.is-open .active-timers-list { display: block; margin-top: 8px; }
      .active-timers-wrapper.is-open #toggleActiveTimers .arrow { transform: rotate(180deg); }

      .stage-manual-popover {
        position: absolute;
        right: 1rem;
        margin-top: 0.5rem;
        width: 18rem;
        max-width: calc(100vw - 2rem);
      }
      
      .discrepancy-warning {
        color: #e11d48;
        font-weight: 700;
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }

      @media (max-width: 640px) {
          #page-maraton-stages .container { padding: 0.5rem; }
          .main-stages-card { padding: 0.75rem !important; border-radius: 0.5rem; }
          
          .sticky-stages-header {
              top: 63px;
              margin-left: -0.5rem;
              margin-right: -0.5rem;
              padding: 0.5rem !important;
          }
          .stageTab {
              padding-top: 0.5rem !important;
              padding-bottom: 0.5rem !important;
              font-size: 12px !important;
          }
          .timer-display { font-size: 2.8rem !important; line-height: 1; text-align: left; }
          .stage-control-strip {
              display: grid !important;
              grid-template-columns: minmax(0, 1fr) auto;
              gap: 0.5rem;
              align-items: stretch;
          }
          .stage-primary-controls {
              display: grid !important;
              gap: 0.5rem;
              min-width: 0;
          }
          .stage-control-strip.is-live .stage-primary-controls {
              grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .stage-control-strip.is-field .stage-primary-controls {
              grid-template-columns: minmax(0, 1fr);
          }
          .stage-main-btn {
              min-width: 0 !important;
              width: 100%;
          }
          .stage-action-btn {
              padding-top: 0.7rem !important;
              padding-bottom: 0.7rem !important;
              font-size: 1rem !important;
          }
          .stage-reset-btn {
              width: 3.25rem !important;
              min-width: 3.25rem !important;
              min-height: 3.25rem !important;
              height: auto !important;
          }
          .stage-manual-popover {
            position: fixed;
            inset: auto 0.75rem auto 0.75rem;
            top: 50%;
            right: 0.75rem;
            width: auto;
            max-width: none;
            margin-top: 0;
            transform: translateY(-50%);
            z-index: 70;
          }
      }

      @media (max-width: 1100px) and (orientation: landscape) and (max-height: 760px) {
          #page-maraton-stages .container { padding: 0.35rem; }
          .main-stages-card { padding: 0.65rem !important; }
          .sticky-stages-header {
              top: 0 !important;
              margin-left: -0.35rem;
              margin-right: -0.35rem;
              padding: 0.35rem 0.5rem !important;
          }
          #eqInfo { font-size: 0.9rem !important; line-height: 1.15; }
          #activeStageLabel { font-size: 0.8rem; }
          .stageTab {
              padding-top: 0.55rem !important;
              padding-bottom: 0.55rem !important;
              font-size: 0.75rem !important;
          }
          .timer-display {
              font-size: 3.2rem !important;
              line-height: 0.95;
          }
          .stage-control-strip {
              display: grid !important;
              grid-template-columns: minmax(0, 1fr) auto;
              gap: 0.55rem;
              align-items: stretch;
          }
          .stage-primary-controls {
              display: grid !important;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 0.55rem;
              min-width: 0;
          }
          .stage-control-strip.is-field .stage-primary-controls {
              grid-template-columns: minmax(0, 1fr);
          }
          .stage-main-btn {
              min-width: 0 !important;
              width: 100%;
          }
          .stage-action-btn {
              padding-top: 0.55rem !important;
              padding-bottom: 0.55rem !important;
              font-size: 0.95rem !important;
          }
          .stage-reset-btn {
              width: 3rem !important;
              min-width: 3rem !important;
              min-height: 3rem !important;
          }
          #startClockRow-warmup,
          #stopClockRow-warmup,
          #startClockRow-A,
          #stopClockRow-A,
          #startClockRow-transport,
          #stopClockRow-transport,
          #startClockRow-B,
          #stopClockRow-B {
              padding-top: 0.55rem !important;
              padding-bottom: 0.55rem !important;
          }
      }
    </style>

    <div class="container mx-auto p-4 md:p-8 max-w-4xl">
      ${getCompetitionHeader(comp, comp?.competitionMode === 'field'
        ? 'Maraton - manuell etappregistrering'
        : t('marathon_stages_header'))}
      ${renderCompetitionModeBanner(comp, {
        message: 'Tävlingen körs i fältläge. Etapptider registreras manuellt här och sekretariatet används för uppföljning och korrigering.'
      })}

      <!-- STICKY HEADER: KUSK-INFO & FLIKAR -->
      <div class="sticky-stages-header sticky top-[63px] bg-white/95 dark:bg-gray-900/95 backdrop-blur p-4 border-b dark:border-gray-700 z-30 shadow-sm">
        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div id="eqInfo" class="font-bold text-sm md:text-base dark:text-white truncate">${t('marathon_stages_select_equipage')}...</div>
              <div class="text-[10px] uppercase font-bold text-gray-500">
                ${comp?.competitionMode === 'field' ? 'Vald etapp' : 'Aktiv etapp'}: <span id="activeStageLabel" class="text-blue-600 dark:text-blue-400">${decorateStageLabel(currentStage)}</span>
              </div>
            </div>
            <div class="flex gap-1 shrink-0">
              <button id="eqPrev" class="w-8 h-8 flex items-center justify-center rounded border dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300">⟨</button>
              <button id="eqNext" class="w-8 h-8 flex items-center justify-center rounded border dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300">⟩</button>
            </div>
          </div>

          <div class="grid grid-cols-4 gap-1.5">
            <button data-stage="warmup"    class="stageTab py-2.5 rounded-lg border dark:border-gray-700 text-[11px] md:text-sm font-bold transition-all shadow-sm">Warm-up</button>
            <button data-stage="A"         class="stageTab py-2.5 rounded-lg border dark:border-gray-700 text-[11px] md:text-sm font-bold transition-all shadow-sm">A</button>
            <button data-stage="transport" class="stageTab py-2.5 rounded-lg border dark:border-gray-700 text-[11px] md:text-sm font-bold transition-all shadow-sm">Transp.</button>
            <button data-stage="B"         class="stageTab py-2.5 rounded-lg border dark:border-gray-700 text-[11px] md:text-sm font-bold transition-all shadow-sm">B</button>
          </div>
        </div>
      </div>

      <div class="mt-4 space-y-4">
        <!-- VAL AV EKIPAGE -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3 shadow-sm">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
            <label class="text-[10px] uppercase font-bold text-gray-500">${t('marathon_stages_select_equipage')}</label>
            <button id="btnBackupJson" class="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline">${t('marathon_stages_export_json')}</button>
          </div>
          <div id="equipageDropdown"></div>
          <div id="infoLineSmall" class="mt-2 text-[10px] text-gray-400 text-center uppercase">—</div>
        </div>

        <!-- AKTIVA TIMERS (UTFÄLLBAR) -->
        <div id="activeTimersWrapper" class="active-timers-wrapper bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3 shadow-sm">
          <button id="toggleActiveTimers" class="w-full flex justify-between items-center">
            <span class="text-[10px] uppercase font-bold text-gray-500">${t('marathon_stages_active_timers')} (0)</span>
            <span class="arrow text-gray-400 transition-transform">▾</span>
          </button>
          <div id="activeTimers" class="active-timers-list space-y-2"></div>
        </div>

        <!-- ETAPP-PANEL -->
        <div id="stagePanel">
          ${renderStagePanel(currentStage)}
        </div>
      </div>
    </div>
  `;

  highlightActiveTab();
}


function renderStagePanel(stage) {
  const label = (stage === 'warmup') ? 'Warm-up' : (stage === 'transport' ? 'Transport' : stage);

  return `
<div class="main-stages-card rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
  <div class="flex flex-col gap-4">

    <!-- INFO & TIMER RAD -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <label class="text-[10px] uppercase font-bold text-gray-500 block mb-1">${t('marathon_stages_stage')}</label>
        <h2 class="text-2xl font-black dark:text-white leading-tight">${decorateStageLabel(stage, currentEquipage)}</h2>
        <div id="stageEqLine" class="text-xs text-gray-400 font-medium truncate">—</div>
        
        <div class="mt-2 space-y-0.5">
          <div class="flex items-center gap-2">
            <span class="text-[10px] uppercase font-bold text-gray-400">${t('marathon_stages_tl')}</span>
            <span id="info-${stage}-tl" class="tabular-nums text-xs font-bold dark:text-gray-200">—</span>
          </div>
          <div id="box-${stage}-etaB" class="hidden flex items-center gap-2">
            <span class="text-[10px] uppercase font-bold text-gray-400">${t('marathon_stages_rest')}</span>
            <span id="info-${stage}-etaB" class="tabular-nums text-xs font-bold text-blue-600 dark:text-blue-400">—</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] uppercase font-bold text-gray-400">${t('marathon_stages_penalty')}</span>
            <span id="info-${stage}-pen" class="tabular-nums text-xs font-bold dark:text-gray-200">—</span>
          </div>
        </div>
      </div>

      <div class="shrink-0 sm:text-right">
        <div id="timer-${stage}"
             class="timer-display text-4xl md:text-6xl font-black tabular-nums text-gray-800 dark:text-white leading-none cursor-pointer tracking-tighter"
             title="Klicka för manuell tid">
          00:00,00
        </div>
        
        <!-- Manuelltids-editor (popup) -->
        <div id="manual-${stage}"
             class="stage-manual-popover hidden p-4 rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl z-50">
          <label class="block text-xs font-bold uppercase text-gray-500 mb-2">${t('marathon_stages_manual_time_input_label')}</label>
          <input id="manualDigits-${stage}" type="tel" inputmode="numeric"
                 class="w-full text-3xl font-mono text-center py-3 border rounded-lg mb-3 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                 placeholder="mmsscc" maxlength="6" />
          <div class="flex gap-2">
            <button id="manualApply-${stage}" class="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-bold">${t('marathon_stages_apply')}</button>
            <button id="manualCancel-${stage}" class="flex-1 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 dark:text-gray-200">${t('marathon_stages_cancel')}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- KONTROLLER -->
    <div class="stage-control-strip ${getGlobalState('currentCompetition')?.competitionMode === 'field' ? 'is-field' : 'is-live'} flex flex-wrap items-stretch gap-2">
      <div class="stage-primary-controls flex flex-1 flex-wrap items-stretch gap-2">
      ${getGlobalState('currentCompetition')?.competitionMode === 'field'
        ? `<button id="btnManualOpen-${stage}" class="stage-action-btn stage-main-btn flex-1 min-w-[12rem] py-3 md:py-4 text-lg md:text-xl font-black rounded-xl bg-brand-darkblue text-white shadow-lg active:scale-95 transition-all hover:bg-brand-gold hover:text-brand-darkblue">Ange tid</button>`
        : `<button id="btnStart-${stage}" class="stage-action-btn stage-main-btn flex-1 min-w-[9rem] py-3 md:py-4 text-lg md:text-xl font-black rounded-xl bg-emerald-600 text-white shadow-lg active:scale-95 transition-all">${t('marathon_stages_btn_start')}</button>
      <button id="btnStop-${stage}"  class="stage-action-btn stage-main-btn flex-1 min-w-[9rem] py-3 md:py-4 text-lg md:text-xl font-black rounded-xl bg-rose-600 text-white shadow-lg active:scale-95 transition-all">${t('marathon_stages_btn_finish')}</button>`}
      </div>
      <button id="btnReset-${stage}" class="stage-reset-btn w-full sm:w-14 py-3 sm:py-0 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 active:scale-95 transition-all" title="${t('marathon_stages_reset')}">↺</button>
    </div>

    <!-- KLOCKSLAG OCH KOMMENTARER -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="p-2 border dark:border-gray-700 rounded-lg bg-gray-50/50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" id="startClockRow-${stage}">
        <div class="text-[10px] uppercase font-bold text-gray-500">${t('marathon_stages_start_clock')} <span class="text-xs">✏️</span></div>
        <div id="startClock-${stage}" class="text-sm font-bold tabular-nums dark:text-gray-200 text-blue-600 dark:text-blue-400">–</div>
      </div>
      <div class="p-2 border dark:border-gray-700 rounded-lg bg-gray-50/50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" id="stopClockRow-${stage}">
        <div class="text-[10px] uppercase font-bold text-gray-500">${t('marathon_stages_finish_clock')} <span class="text-xs">✏️</span></div>
        <div id="stopClock-${stage}" class="text-sm font-bold tabular-nums dark:text-gray-200 text-blue-600 dark:text-blue-400">–</div>
      </div>
    </div>

    <div class="space-y-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" class="toggle-btn comment-toggle-btn uppercase font-bold">${t('marathon_stages_comments')}</button>
        <div class="flex items-center gap-2">
           <label class="flex items-center gap-1.5 cursor-pointer">
             <input id="manualEliminated" type="checkbox" class="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-rose-600">
             <span class="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-400">${t('marathon_stages_elim')}</span>
           </label>
        </div>
      </div>

      <div class="comment-wrapper">
        <div class="grid gap-3">
          <textarea id="commentStart-${stage}" rows="2" class="w-full text-sm rounded-lg border dark:border-gray-700 px-3 py-2 dark:bg-gray-900/40 dark:text-white" placeholder="${t('marathon_stages_comment_start')}"></textarea>
          <textarea id="commentStop-${stage}" rows="2" class="w-full text-sm rounded-lg border dark:border-gray-700 px-3 py-2 dark:bg-gray-900/40 dark:text-white" placeholder="${t('marathon_stages_comment_finish')}"></textarea>
        </div>
      </div>

      ${stage === 'B' ? `
      <div class="pt-2 border-t dark:border-gray-700 space-y-2">
        <label class="flex items-center gap-2 cursor-pointer">
          <input id="bitOk" type="checkbox" class="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600">
          <span class="text-xs font-bold dark:text-gray-200 uppercase">${t('marathon_stages_bit_check_ok')}</span>
        </label>
        <textarea id="bitComment" rows="1" class="w-full text-sm rounded-lg border dark:border-gray-700 px-3 py-2 dark:bg-gray-900/40 dark:text-white" placeholder="${t('marathon_stages_bit_comment')}"></textarea>
      </div>
      ` : ``}

      <div class="pt-2 border-t dark:border-gray-700 flex flex-col gap-3">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label for="otherMarathonPenalty" class="text-[10px] uppercase font-bold text-gray-500">${t('marathon_stages_other_penalty_total')}</label>
          <input type="number" id="otherMarathonPenalty" min="0" step="0.01" inputmode="decimal" class="w-full sm:w-24 text-right font-bold rounded-lg border dark:border-gray-700 px-2 py-2 sm:py-1 dark:bg-gray-900/40 dark:text-white">
        </div>
        
        <button id="btnSave-${stage}" class="w-full py-3 md:py-4 rounded-xl bg-brand-darkblue text-white font-black text-lg md:text-xl shadow-lg hover:bg-brand-gold hover:text-brand-darkblue active:scale-[0.98] transition-all">${t('marathon_stages_save_changes')}</button>
      </div>
    </div>
  </div>
</div>
  `;
}

function highlightActiveTab() {
  document.querySelectorAll('.stageTab').forEach(btn => {
    const s = btn.dataset.stage;
    const active = (s === currentStage);
    btn.classList.toggle('bg-brand-darkblue', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-blue-600', active);
  });
}

function updateStageEqLine() {
  const el = document.getElementById('stageEqLine');
  if (!el) return;
  if (!currentEquipage) { el.textContent = '—'; return; }
  el.textContent = `#${currentEquipage.startNumber} ${currentEquipage.driverName || ''} (${currentEquipage.className || '—'})`;
}

function updateEqInfo() {
  const el = document.getElementById('eqInfo');
  if (!el) return;
  if (!currentEquipage) { el.textContent = '–'; return; }
  const h = currentEquipage?.horses?.[0]?.name || currentEquipage?.horse || '';
  el.textContent = `#${currentEquipage.startNumber} ${currentEquipage.driverName || ''} (${currentEquipage.className || '—'}) ${h ? '• ' + h : ''}`;
}

function updateTimerLabel(stage) {
  const sn = currentEquipage ? String(currentEquipage.startNumber) : null;
  const host = document.getElementById(`timer-${stage}`);
  if (!host) return;
  if (!sn) { host.textContent = msToLabel(0); return; }

  const eq = findEquipageBySn(sn);
  const actualStage = normalizeStageForEquipage(eq, stage);
  const key = `${sn}|${actualStage}`;
  const t = activeTimers.get(key);
  if (t) {
    const now = Date.now();
    const ms = t.isRunning ? (t.pausedMs + (now - t.startEpoch)) : t.pausedMs;
    host.setAttribute('data-sn', sn);
    host.setAttribute('data-sn', sn);
    host.textContent = msToLabel(ms);
    applyTimerColor(host, sn, stage, ms);
    updateTimerInfo(stage, sn, ms);
    return;
  }

  const st = currentDocData?.timing?.[actualStage] || currentDocData?.timing?.[stage] || {};
  const savedDurationMs = Number(st.durationMs);
  if (st.stopClock && Number.isFinite(savedDurationMs)) {
    host.textContent = msToLabel(savedDurationMs);
    applyTimerColor(host, sn, stage, savedDurationMs);
    updateTimerInfo(stage, sn, savedDurationMs);
  } else if (st.startClock && !st.stopClock) {
    const runningSince = Date.parse(st.runningSince || st.startClock);
    const ms = (Number.isFinite(savedDurationMs) ? savedDurationMs : 0) + (Date.now() - runningSince);
    host.textContent = msToLabel(ms);
    applyTimerColor(host, sn, stage, ms);
    updateTimerInfo(stage, sn, ms);
  } else {
    host.textContent = msToLabel(0);
    applyTimerColor(host, sn, stage, 0);
    updateTimerInfo(stage, sn, 0);
  }
}

// ---------- Aktiva kort (multi-timer) ----------
function addOrUpdateActiveCard(sn, stage) {
  const key = `${sn}|${stage}`;
  const host = document.getElementById('activeTimers');
  let card = document.querySelector(`[data-active="${key}"]`);
  if (!card) {
    card = document.createElement('div');
    card.setAttribute('data-active', key);
    card.className = 'rounded-lg border dark:border-gray-700 p-2 flex items-center justify-between bg-white dark:bg-gray-800';
    card.innerHTML = `
      <div class="text-sm dark:text-gray-300">#${sn} • ${stage.toUpperCase()}</div>
      <div class="timer tabular-nums text-lg dark:text-white">00:00,00</div>
      <button class="stop px-2 py-1 text-xs rounded bg-rose-600 text-white hover:bg-rose-700">${t('marathon_stages_stop')}</button>
    `;
    host.appendChild(card);
  }
}
function removeActiveCard(key) {
  document.querySelector(`[data-active="${key}"]`)?.remove();
}
function attachActiveTimersManualEditDelegate() {
  const host = document.getElementById('activeTimers');
  if (!host || host._manualClickPatched) return;
  host._manualClickPatched = true;

  host.addEventListener('click', async (ev) => {
    const timerSpan = ev.target.closest('.timer');
    if (!timerSpan) return;

    const card = ev.target.closest('[data-active]');
    const key = card?.getAttribute('data-active'); // "sn|stage"
    if (!key) return;
    const [sn, stage] = key.split('|');

    // Se till att currentEquipage pekar på rätt ekipage
    if (!currentEquipage || String(currentEquipage.startNumber) !== sn) {
      const eq = equipages.find(e => String(e.startNumber) === sn);
      if (!eq) return;
      currentEquipage = eq;
      // läs in dokumentet så UI uppdateras
      await onEquipageSelected(eq);
    }

    const raw = prompt('Manuell tid för den här etappen (mmsscc):');
    if (!raw) return;
    const ms = digitsToMs(raw);

    const tKey = `${sn}|${stage}`;
    let t = activeTimers.get(tKey);
    if (!t) { t = { isRunning: false, startEpoch: 0, pausedMs: 0 }; activeTimers.set(tKey, t); }
    if (t.interval) clearInterval(t.interval);
    t.isRunning = false; t.startEpoch = 0; t.pausedMs = ms;

    paintTimer(tKey, ms);

    const now = Date.now();
    const payload = {
      durationMs: ms,
      startClock: new Date(now - ms).toISOString(),
      stopClock: new Date(now).toISOString(),
      runningSince: null,
    };
    try {
      await saveStageSnapshot(stage, payload);
    } catch (err) {
      console.error(err);
      showAlert(t('marathon_stages_manual_time_error'));
    }
  });
}
// === Global: manuell editor via klick på timern (mmsscc eller mm:ss,cc) ===
function bindManualEditor(stage) {
  // Ensure manual UI is hidden initially
  document.getElementById('manual-warmup')?.classList.add('hidden');
  document.getElementById('manual-A')?.classList.add('hidden');
  document.getElementById('manual-transport')?.classList.add('hidden');
  document.getElementById('manual-B')?.classList.add('hidden');

  const timerEl = document.getElementById(`timer-${stage}`);
  const openBtn = document.getElementById(`btnManualOpen-${stage}`);
  const wrapEl = document.getElementById(`manual-${stage}`);
  const inputEl = document.getElementById(`manualDigits-${stage}`);
  const okBtn = document.getElementById(`manualApply-${stage}`);
  const cancelBtn = document.getElementById(`manualCancel-${stage}`);

  if (!timerEl || !wrapEl || !inputEl || !okBtn || !cancelBtn) return;

  const open = () => { wrapEl.classList.remove('hidden'); inputEl.value = ''; setTimeout(() => inputEl.focus(), 0); };
  const close = () => { wrapEl.classList.add('hidden'); };

  timerEl.style.cursor = 'pointer';
  timerEl.title = t('marathon_stages_click_manual_time');
  timerEl.addEventListener('click', open);
  openBtn?.addEventListener('click', open);
  cancelBtn.addEventListener('click', close);

  okBtn.addEventListener('click', async () => {
    if (!currentEquipage) return;

    const ms = digitsToMs(inputEl.value);
    const actualStage = normalizeStageForEquipage(currentEquipage, stage);
    const key = `${currentEquipage.startNumber}|${actualStage}`;
    let timerState = activeTimers.get(key);

    if (!timerState) {
      timerState = { isRunning: false, startEpoch: 0, pausedMs: 0 };
      activeTimers.set(key, timerState);
    }

    timerState.isRunning = false;
    timerState.startEpoch = 0;
    timerState.pausedMs = ms;

    paintTimer(key);

    const now = Date.now();
    const payload = {
      durationMs: ms,
      startClock: new Date(now - ms).toISOString(),
      stopClock: new Date(now).toISOString(),
      runningSince: null,
      runningStage: null
    };

    try {
      await saveStageSnapshot(stage, payload);
      mergeStagePayloadIntoCurrentDoc(stage, payload);
      updateTimerLabel(stage);
      updateTabStatuses(currentDocData);
      renderActiveCards();
      close();
    } catch (err) {
      console.error(err);
      showAlert(t('marathon_stages_manual_time_error'), false);
    }
  });

  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      okBtn.click();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
}

function formatClockDisplay(value) {
  if (!value) return '–';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function refreshCommentToggleState(stage) {
  const wrap = document.querySelector('#stagePanel .comment-wrapper');
  const toggle = document.querySelector('#stagePanel .comment-toggle-btn');
  const startComment = document.getElementById(`commentStart-${stage}`)?.value?.trim() || '';
  const stopComment = document.getElementById(`commentStop-${stage}`)?.value?.trim() || '';
  const bitComment = document.getElementById('bitComment')?.value?.trim() || '';
  const hasComment = !!(startComment || stopComment || bitComment);

  if (wrap) {
    wrap.classList.toggle('comment-visible', hasComment);
  }
  if (toggle) {
    toggle.classList.toggle('has-comment', hasComment);
  }
}

function mergeStagePayloadIntoCurrentDoc(stage, payload = {}) {
  currentDocData = currentDocData || {};
  currentDocData.timing = currentDocData.timing || {};
  currentDocData.timing[stage] = {
    ...(currentDocData.timing[stage] || {}),
    ...payload
  };

  if ('runningStage' in payload) {
    currentDocData.runningStage = payload.runningStage;
  }
  if ('bitCheckOk' in payload) {
    currentDocData.bitCheckOk = payload.bitCheckOk;
    currentDocData.bettOk = payload.bitCheckOk;
  }
  if ('bitCheckComment' in payload) {
    currentDocData.bitCheckComment = payload.bitCheckComment ?? '';
    currentDocData.bettComment = payload.bitCheckComment ?? '';
  }
}

function populateStageUI(stage, docData = {}) {
  const stageData = docData?.timing?.[stage] || {};
  const startClockEl = document.getElementById(`startClock-${stage}`);
  const stopClockEl = document.getElementById(`stopClock-${stage}`);
  const commentStartEl = document.getElementById(`commentStart-${stage}`);
  const commentStopEl = document.getElementById(`commentStop-${stage}`);
  const eliminatedEl = document.getElementById('manualEliminated');
  const otherPenaltyEl = document.getElementById('otherMarathonPenalty');
  const bitOkEl = document.getElementById('bitOk');
  const bitCommentEl = document.getElementById('bitComment');

  updateStageEqLine();
  updateEqInfo();
  highlightActiveTab();

  if (startClockEl) startClockEl.textContent = formatClockDisplay(stageData.startClock);
  if (stopClockEl) stopClockEl.textContent = formatClockDisplay(stageData.stopClock);
  if (commentStartEl) commentStartEl.value = stageData.commentStart || '';
  if (commentStopEl) commentStopEl.value = stageData.commentStop || '';
  if (eliminatedEl) eliminatedEl.checked = !!docData.eliminated;
  if (otherPenaltyEl) otherPenaltyEl.value = Number(docData.otherPenalty || 0);

  if (bitOkEl) {
    bitOkEl.checked = !!(docData.bitCheckOk ?? docData.bettOk);
  }
  if (bitCommentEl) {
    bitCommentEl.value = docData.bitCheckComment ?? docData.bettComment ?? '';
  }

  updateTimerLabel(stage);
  refreshCommentToggleState(stage);
}

function updateTabVisibility(eq) {
  const warmupTab = document.querySelector('[data-stage="warmup"]');
  const stageATab = document.querySelector('[data-stage="A"]');
  const limA = eq ? limitsFor(eq, 'A') : null;
  const isFixedTimeA = limA && limA.ideal > 0 && limA.max === limA.ideal && limA.min === 0;

  if (warmupTab) warmupTab.classList.toggle('hidden', !!isFixedTimeA);
  if (stageATab) stageATab.classList.remove('hidden');

  if (isFixedTimeA && currentStage === 'warmup') {
    currentStage = 'A';
  }
}

async function startStage(stage) {
  if (!currentEquipage) return;

  const actualStage = normalizeStageForEquipage(currentEquipage, stage);
  const key = `${currentEquipage.startNumber}|${actualStage}`;
  const now = Date.now();
  const stageData = currentDocData?.timing?.[actualStage] || currentDocData?.timing?.[stage] || {};
  const existingDuration = Number.isFinite(Number(stageData.durationMs)) ? Number(stageData.durationMs) : 0;
  const startClock = stageData.startClock || new Date(now).toISOString();

  activeTimers.set(key, {
    isRunning: true,
    startEpoch: now,
    pausedMs: existingDuration
  });

  ensureGlobalTicker();

  const payload = {
    startClock,
    stopClock: null,
    durationMs: existingDuration,
    runningSince: new Date(now).toISOString(),
    commentStart: document.getElementById(`commentStart-${stage}`)?.value?.trim() || '',
    runningStage: actualStage
  };

  await saveStageSnapshot(stage, payload);
  mergeStagePayloadIntoCurrentDoc(stage, payload);
  updateTimerLabel(stage);
  updateTabStatuses(currentDocData);
  renderActiveCards();
}

async function stopStage(stage) {
  if (!currentEquipage) return;

  const actualStage = normalizeStageForEquipage(currentEquipage, stage);
  const key = `${currentEquipage.startNumber}|${actualStage}`;
  const timerState = activeTimers.get(key);
  const now = Date.now();
  const stageData = currentDocData?.timing?.[actualStage] || currentDocData?.timing?.[stage] || {};
  const durationMs = timerState?.isRunning
    ? timerState.pausedMs + (now - timerState.startEpoch)
    : (Number.isFinite(Number(stageData.durationMs)) ? Number(stageData.durationMs) : 0);

  activeTimers.delete(key);
  stopGlobalTickerIfIdle();

  const payload = {
    startClock: stageData.startClock || new Date(now - durationMs).toISOString(),
    stopClock: new Date(now).toISOString(),
    durationMs,
    runningSince: null,
    commentStop: document.getElementById(`commentStop-${stage}`)?.value?.trim() || '',
    runningStage: null
  };

  await saveStageSnapshot(stage, payload);
  mergeStagePayloadIntoCurrentDoc(stage, payload);
  updateTimerLabel(stage);
  updateTabStatuses(currentDocData);
  renderActiveCards();
}

async function resetStage(stage) {
  if (!currentEquipage) return;

  const actualStage = normalizeStageForEquipage(currentEquipage, stage);
  const key = `${currentEquipage.startNumber}|${actualStage}`;
  activeTimers.delete(key);
  stopGlobalTickerIfIdle();

  const payload = {
    startClock: null,
    stopClock: null,
    durationMs: null,
    runningSince: null,
    commentStart: '',
    commentStop: '',
    runningStage: null
  };

  if (stage === 'B') {
    payload.bitCheckOk = false;
    payload.bitCheckComment = '';
  }

  await saveStageSnapshot(stage, payload);
  mergeStagePayloadIntoCurrentDoc(stage, payload);
  populateStageUI(stage, currentDocData);
  updateTabStatuses(currentDocData);
  renderActiveCards();
}

function parseManualClockInput(rawValue) {
  const raw = String(rawValue || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const now = new Date();
  now.setHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0);
  return now.toISOString();
}

async function editClock(stage, kind) {
  if (!currentEquipage) return;

  const stageData = currentDocData?.timing?.[stage] || {};
  const currentIso = kind === 'start' ? stageData.startClock : stageData.stopClock;
  const currentLabel = currentIso ? formatClockDisplay(currentIso) : '';
  const raw = prompt(`Ange ${kind === 'start' ? 'start' : 'mål'}tid (HH:MM eller HH:MM:SS)`, currentLabel);
  if (raw == null) return;

  const iso = raw.trim() === '' ? null : parseManualClockInput(raw);
  if (raw.trim() !== '' && !iso) {
    showAlert('Ogiltigt klockslag. Använd HH:MM eller HH:MM:SS.', false);
    return;
  }

  const payload = kind === 'start'
    ? { startClock: iso }
    : { stopClock: iso };

  await saveStageSnapshot(stage, payload);
  mergeStagePayloadIntoCurrentDoc(stage, payload);
  populateStageUI(stage, currentDocData);
  updateTabStatuses(currentDocData);
}

async function saveStageDetails(stage) {
  if (!currentEquipage) return;

  const commentStart = document.getElementById(`commentStart-${stage}`)?.value?.trim() || '';
  const commentStop = document.getElementById(`commentStop-${stage}`)?.value?.trim() || '';
  const eliminated = !!document.getElementById('manualEliminated')?.checked;
  const otherPenalty = Number(document.getElementById('otherMarathonPenalty')?.value || 0);
  const bitCheckOk = !!document.getElementById('bitOk')?.checked;
  const bitCheckComment = document.getElementById('bitComment')?.value?.trim() || '';

  const stagePayload = { commentStart, commentStop };
  if (stage === 'B') {
    stagePayload.bitCheckOk = bitCheckOk;
    stagePayload.bitCheckComment = bitCheckComment;
  }

  await saveStageSnapshot(stage, stagePayload);
  mergeStagePayloadIntoCurrentDoc(stage, stagePayload);

  const rootPayload = {
    eliminated,
    otherPenalty,
    updatedAt: serverTimestamp()
  };
  if (stage === 'B') {
    rootPayload.bitCheckOk = bitCheckOk;
    rootPayload.bettOk = bitCheckOk;
    rootPayload.bitCheckComment = bitCheckComment;
    rootPayload.bettComment = bitCheckComment;
  }

  await setDoc(maratonDocRef(currentEquipage.startNumber), rootPayload, { merge: true });
  currentDocData = { ...(currentDocData || {}), ...rootPayload };

  populateStageUI(stage, currentDocData);
  updateTabStatuses(currentDocData);
  showAlert('Ändringarna sparades.', true);
}

function bindStagePanel(stage) {
  document.getElementById(`btnStart-${stage}`)?.addEventListener('click', async () => {
    try {
      await startStage(stage);
    } catch (error) {
      console.error(error);
      showAlert(t('marathon_stages_save_error') || 'Kunde inte starta etappen.', false);
    }
  });

  document.getElementById(`btnStop-${stage}`)?.addEventListener('click', async () => {
    try {
      await stopStage(stage);
    } catch (error) {
      console.error(error);
      showAlert(t('marathon_stages_save_error') || 'Kunde inte stoppa etappen.', false);
    }
  });

  document.getElementById(`btnReset-${stage}`)?.addEventListener('click', async () => {
    try {
      await resetStage(stage);
    } catch (error) {
      console.error(error);
      showAlert(t('marathon_stages_save_error') || 'Kunde inte återställa etappen.', false);
    }
  });

  document.getElementById(`btnSave-${stage}`)?.addEventListener('click', async () => {
    try {
      await saveStageDetails(stage);
    } catch (error) {
      console.error(error);
      showAlert(t('marathon_stages_save_error') || 'Kunde inte spara etappdata.', false);
    }
  });

  document.getElementById(`startClockRow-${stage}`)?.addEventListener('click', async () => {
    try {
      await editClock(stage, 'start');
    } catch (error) {
      console.error(error);
      showAlert('Kunde inte uppdatera starttid.', false);
    }
  });

  document.getElementById(`stopClockRow-${stage}`)?.addEventListener('click', async () => {
    try {
      await editClock(stage, 'stop');
    } catch (error) {
      console.error(error);
      showAlert('Kunde inte uppdatera måltid.', false);
    }
  });

  document.querySelector('#stagePanel .comment-toggle-btn')?.addEventListener('click', () => {
    document.querySelector('#stagePanel .comment-wrapper')?.classList.toggle('comment-visible');
  });

  document.getElementById(`commentStart-${stage}`)?.addEventListener('input', () => refreshCommentToggleState(stage));
  document.getElementById(`commentStop-${stage}`)?.addEventListener('input', () => refreshCommentToggleState(stage));
  document.getElementById('bitComment')?.addEventListener('input', () => refreshCommentToggleState(stage));
}

async function focusEquipageStage(sn, stage) {
  const eq = equipages.find((item) => String(item.startNumber) === String(sn));
  if (!eq) return;

  currentStage = stage;
  if (dropdown) {
    dropdown.setValue(eq.startNumber);
  } else {
    await onEquipageSelected(eq);
  }
}

// Föregående / Nästa
// ERSÄTT DENNA FUNKTION
function gotoRelative(delta) {
  const list = orderByMarathonStart.length ? orderByMarathonStart : equipages;
  if (!list.length) return;

  const currentSn = currentEquipage ? String(currentEquipage.startNumber) : null;
  const idx = list.findIndex(e => String(e.startNumber) === currentSn);

  const nextIdx = (idx === -1) ? 0 : (idx + delta + list.length) % list.length;
  const nextEq = list[nextIdx];

  if (nextEq) {
    // KORRIGERING: Använd dropdown-objektets inbyggda metod för att uppdatera sitt eget UI
    if (dropdown) {
      dropdown.setValue(nextEq.startNumber);
    }
    // Anropa onEquipageSelected manuellt för att ladda datan
    onEquipageSelected(nextEq);
  }
}

// NYTT: Tangentbordsgenvägar (Pilar + Siffror för flikar)
function wireKeyboardShortcuts() {
  if (keyboardShortcutHandler) {
    document.removeEventListener('keydown', keyboardShortcutHandler);
  }

  keyboardShortcutHandler = (e) => {
    // Ignorera om vi skriver i ett input-fält (förutom pilar om det är tomt? Nej, säkrast att ignorera allt)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // 1-4 för flikar
    if (e.key === '1') document.querySelector('[data-stage="warmup"]')?.click();
    if (e.key === '2') document.querySelector('[data-stage="A"]')?.click();
    if (e.key === '3') document.querySelector('[data-stage="transport"]')?.click();
    if (e.key === '4') document.querySelector('[data-stage="B"]')?.click();

    // Pilar för navigering
    if (e.key === 'ArrowLeft') gotoRelative(-1);
    if (e.key === 'ArrowRight') gotoRelative(+1);
  };

  document.addEventListener('keydown', keyboardShortcutHandler);
}

// NYTT: Uppdatera status-ikoner på flikarna
function updateTabStatuses(docData) {
  const timings = docData?.timing || {};

  // Helper: return icon or empty string
  const getIcon = (st) => {
    if (!st) return '';
    if (st.stopClock) return ' <span class="text-emerald-300 ml-1">✓</span>'; // Klar
    if (st.startClock) return ' <span class="text-amber-300 ml-1 animate-pulse">⏳</span>'; // Pågående
    return ''; // Ej startat
  };

  ['warmup', 'A', 'transport', 'B'].forEach(stage => {
    const btn = document.querySelector(`button[data-stage="${stage}"]`);
    if (btn) {
      // Spara originallabeln om vi inte gjort det
      if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent;

      const icon = getIcon(timings[stage]);
      // Uppdatera HTML med ikon
      btn.innerHTML = btn.dataset.originalLabel + icon;
    }
  });
}

// NY SAMLINGSFUNKTION FÖR ALLA EVENTLISTENERS

function wireEventListeners() {
  document.getElementById('eqPrev')?.addEventListener('click', () => gotoRelative(-1));
  document.getElementById('eqNext')?.addEventListener('click', () => gotoRelative(+1));

  // NYTT: Koppla knappen för att fälla ut/in aktiva timers
  document.getElementById('toggleActiveTimers')?.addEventListener('click', () => {
    document.getElementById('activeTimersWrapper')?.classList.toggle('is-open');
  });

  document.getElementById('btnBackupJson')?.addEventListener('click', () => {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(`bkp_${competitionId}_`)) {
        backup[key] = JSON.parse(localStorage.getItem(key));
      }
    }
    const filename = `backup_maraton_stages_${competitionId}_${new Date().toISOString().split('T')[0]}.json`;
    downloadJson(filename, backup);
  });

  const activeHost = document.getElementById('activeTimers');
  if (activeHost && !activeHost.dataset.bound) {
    activeHost.dataset.bound = '1';
    activeHost.addEventListener('click', async (e) => {
      // 1) Klick på Stoppa -> stoppa timern (prioritet högst)
      const stopBtn = e.target.closest('button.stop');
      if (stopBtn) {
        const card = e.target.closest('[data-active]');
        const key = card?.getAttribute('data-active');
        if (!key) return;
        const [sn, stage] = key.split('|');
        const eq = equipages.find(e => String(e.startNumber) === sn);
        if (eq) await onEquipageSelected(eq);
        await stopStage(stage);
        return;
      }

      // 2) Klick på timervärdet -> låt manuell-editor/annan logik ta hand om det
      if (e.target.closest('.timer')) {
        return;
      }

      // 3) Klick på vänstersidan av kortet => navigera
      const leftHit = e.target.closest('.card-left');
      if (leftHit) {
        const sn = leftHit.getAttribute('data-sn');
        const stage = leftHit.getAttribute('data-stage');
        if (sn && stage) await focusEquipageStage(sn, stage);
        return;
      }

      // 4) Fallback – klick någon annanstans i kortet
      const card = e.target.closest('[data-active]');
      if (card) {
        const [sn, stage] = card.getAttribute('data-active').split('|');
        if (sn && stage) await focusEquipageStage(sn, stage);
        return;
      }
    });
  }

  bindStagePanel(currentStage);
}


// ---------- Events ----------
async function onEquipageSelected(eq) {
  currentEquipage = eq || null;
  // Normalisera currentStage för det valda ekipaget (t.ex. om vi är på Warm-up men det ska vara A)
  if (eq) {
    currentStage = normalizeStageForEquipage(eq, currentStage);
  }
  updateTabVisibility(eq); // <--- NYTT: Uppdatera tab-synlighet (A vs Warm-up)
  updateEqInfo();
  rebuildOrder();
  currentDocData = null;

  // Rendera om panel för aktuell flik, bind och fyll från Firestore
  const host = document.getElementById('stagePanel');
  host.innerHTML = renderStagePanel(currentStage);
  bindStagePanel(currentStage);
  bindManualEditor(currentStage); // <- NY: kopplar timer-klick + editor

  if (currentEquipage) {
    const sn = String(currentEquipage.startNumber);
    subscribeToEquipageDoc(sn);
    currentDocData = await readStageDoc(sn) || {};

    ['warmup', 'A', 'transport', 'B'].forEach(stage => {
      // Använd den hydrerade `timing`-datan som skapats av `readStageDoc`
      const stageData = currentDocData?.timing?.[stage];

      if (stageData?.startClock && !stageData?.stopClock) {
        // En timer är aktiv för denna etapp!
        const key = `${sn}|${stage}`;
        if (!activeTimers.has(key)) {
          const startTS = new Date(stageData.runningSince || stageData.startClock).getTime();
          const durationMs = Number(stageData.durationMs);

          // Skapa ett lokalt timer-objekt som matchar den verkliga starttiden.
          // `paintTimer` beräknar tiden som `pausedMs + (Date.now() - startEpoch)`.
          // Genom att sätta `startEpoch` till den ursprungliga starttiden och `pausedMs`
          // till 0, blir beräkningen `0 + (Date.now() - startTS)`, vilket är exakt rätt.
          const timerState = {
            isRunning: true,
            startEpoch: startTS, // Den ursprungliga, verkliga start-timestampen
            pausedMs: Number.isFinite(durationMs) ? durationMs : 0,
          };

          activeTimers.set(key, timerState);
          addOrUpdateActiveCard(sn, stage);
        }
      }
    });

    // Se till att den globala tickern är igång om några timers återuppväcktes
    if (activeTimers.size > 0) {
      ensureGlobalTicker();
    }

    populateStageUI(currentStage, currentDocData);
    updateTimerLabel(currentStage);
    updateTabStatuses(currentDocData); // <-- NYTT: Initiera flikarna
    renderActiveCards(); // Se till att listan med aktiva timers ritas om
  }
}

function wireTabs() {
  document.querySelectorAll('.stageTab').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = btn.dataset.stage;
      if (s === currentStage) return;
      currentStage = s;
      highlightActiveTab();
      const lab = document.getElementById('activeStageLabel');
      if (lab) lab.textContent = decorateStageLabel(s);
      const host = document.getElementById('stagePanel');
      host.innerHTML = renderStagePanel(currentStage);
      bindStagePanel(currentStage);
      bindManualEditor(currentStage);
      if (currentEquipage && currentDocData) {
        populateStageUI(currentStage, currentDocData);
      }
      updateTimerLabel(currentStage);
      updateStageEqLine();
    });
  });
}

// ---------- Lifecycle ----------
export async function load() {
  __unload();

  const comp = getGlobalState('currentCompetition');
  const isFieldMode = comp?.competitionMode === 'field';
  competitionId = comp?.id;
  const root = document.getElementById('page-maraton-stages');
  if (!competitionId) {
    if (root) root.innerHTML = '<p class="p-8 text-center text-gray-600 dark:text-gray-400">Ingen tävling vald.</p>';
    return;
  }

  // 1. Rendera grundlayouten först så att alla HTML-element finns på plats
  renderLayout();
  if (isFieldMode) {
    document.getElementById('activeTimersWrapper')?.remove();
  }
  // 1b. Knyt flikarnas klick-hanterare
  wireTabs();

  // 2. Hämta all nödvändig data från databasen parallellt
  const [listRaw, configDataSwe, configDataEng, startTimesData, maratonDocs] = await Promise.all([
    getEquipages(competitionId),
    getConfig(competitionId, 'maratonConfig').catch(() => null),
    getConfig(competitionId, 'marathonConfig').catch(() => null),
    getConfig(competitionId, 'startTimes').catch(() => null),
    getMarathonStateDocuments(competitionId)
  ]);

  // 3. Bearbeta och lagra datan i programmets minne
  // Fallback: använd svensk config om den finns, annars engelsk
  maratonConfig = configDataSwe || configDataEng;

  // Pass config to utils immediately to ensure calculations work!
  setMarathonConfig(maratonConfig);

  // ===== VIKTIG FELSÖKNINGSRAD! =====

  startTimes = startTimesData?.times || {};
  equipages = (listRaw || []).map(normalizeEquipage);
  const maratonDocsMap = maratonDocs || new Map();
  orderByMarathonStart = [...equipages].sort((a, b) => {
    const docA = maratonDocsMap.get(String(a.startNumber));
    const docB = maratonDocsMap.get(String(b.startNumber));
    
    // Done if finalized or has finish_B (last stage)
    const doneA = !!(docA?.finalized || docA?.finish_B || docA?.finish_transfer);
    const doneB = !!(docB?.finalized || docB?.finish_B || docB?.finish_transfer);

    if (doneA !== doneB) return doneA ? 1 : -1;

    const timeA = startTimes[String(a.startNumber)]?.marathon || '99:99';
    const timeB = startTimes[String(b.startNumber)]?.marathon || '99:99';
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return (a.startNumber || 0) - (b.startNumber || 0);
  });

  // 4. Initiera UI-komponenter NU när datan finns (ÅTERSTÄLLER DROPDOWN)
  const ddHost = document.getElementById('equipageDropdown');
  if (ddHost) {
    dropdown = createSearchableDropdown(ddHost, orderByMarathonStart, onEquipageSelected);
    if (!currentEquipage && orderByMarathonStart.length > 0) {
      const firstEquipage = orderByMarathonStart[0];
      currentEquipage = firstEquipage;
      if (dropdown?.setValue) {
        dropdown.setValue(firstEquipage.startNumber);
      } else {
        await onEquipageSelected(firstEquipage);
      }
    }
  } else {
    console.error("Kunde inte hitta #equipageDropdown i DOM.");
  }

  // Request Wake Lock bara i full live-drift
  if (!isFieldMode) {
    if (!currentEquipage && !dropdown && orderByMarathonStart.length > 0) {
      await onEquipageSelected(orderByMarathonStart[0]);
    }
    await requestWakeLock();
  }

  // 5. Koppla alla event-lyssnare
  wireEventListeners();
  wireKeyboardShortcuts();

  // 6. Starta de globala Firestore-lyssnarna
  subscribeAllActiveTimers();
  unsubscribeGlobalPause = listenForGlobalCompetitionPause();

  if (unsubMaratonList) unsubMaratonList();
  unsubMaratonList = listenForMaratonCollection(competitionId, (maratonDocs) => {
    const maratonDocsMap = new Map();
    (maratonDocs || []).forEach(d => maratonDocsMap.set(String(d.id), d));

    orderByMarathonStart = [...equipages].sort((a, b) => {
      const docA = maratonDocsMap.get(String(a.startNumber));
      const docB = maratonDocsMap.get(String(b.startNumber));
      
      const doneA = !!(docA?.finalized || docA?.finish_B || docA?.finish_transfer);
      const doneB = !!(docB?.finalized || docB?.finish_B || docB?.finish_transfer);

      if (doneA !== doneB) return doneA ? 1 : -1;

      const timeA = startTimes[String(a.startNumber)]?.marathon || '99:99';
      const timeB = startTimes[String(b.startNumber)]?.marathon || '99:99';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return (a.startNumber || 0) - (b.startNumber || 0);
    });

    if (dropdown) {
      dropdown.updateData(orderByMarathonStart);
    }
  });
}

let unsubMaratonList = null;
export function __unload() {
  // Stoppa global ticker
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }

  // Stäng ALLA Firestore-lyssnare
  try { unsubscribeStageDoc && unsubscribeStageDoc(); } catch { }
  unsubscribeStageDoc = null;

  try { unsubAllA && unsubAllA(); } catch { }
  try { unsubAllB && unsubAllB(); } catch { }
  try { unsubAllC && unsubAllC(); } catch { }
  try { unsubAllD && unsubAllD(); } catch { }
  try { unsubscribeGlobalPause && unsubscribeGlobalPause(); } catch { }
  try { unsubMaratonList && unsubMaratonList(); } catch { }
  unsubAllA = unsubAllB = unsubAllC = unsubAllD = unsubMaratonList = null;
  unsubscribeGlobalPause = null;

  if (keyboardShortcutHandler) {
    document.removeEventListener('keydown', keyboardShortcutHandler);
    keyboardShortcutHandler = null;
  }
  document.body.style.filter = '';

  // Förstör dropdown-komponenten om den finns
  if (dropdown && typeof dropdown.destroy === 'function') {
    try { dropdown.destroy(); } catch { }
  }
  dropdown = null;

  // Nollställ lokalt state
  activeTimers.clear();
  currentEquipage = null;
  currentDocData = null;
  listeningStartNumber = null;
}

