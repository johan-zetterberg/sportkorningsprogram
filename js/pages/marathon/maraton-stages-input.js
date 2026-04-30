// js/pages/maraton-stages-input.js
import { stagePenaltyFromMs, limitsFor, formatMsLive, setMarathonConfig, getPauseTime, pausedMsSince, isDurationSuspicious } from '../../utils/marathonUtils.js';
import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getMarathonStateDocuments } from '../../services/marathonService.js';
import { listenForMaratonCollection } from '../../services/marathonService.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { doc, getDoc, setDoc, serverTimestamp, collection, onSnapshot, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';
import { downloadJson } from '../../utils/sharedUtils.js';
import { requestWakeLock } from '../../utils/wakeLock.js';

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

function extractStageFromDocData(data, stage) {
  const flat = stage === 'warmup' ? 'warmup' : (stage === 'transport' ? 'transfer' : stage);
  const key = stage.toUpperCase(); // A|B|WARMUP|TRANSPORT

  const startClock = data?.[`start_${key}`] ?? data?.[`start_${flat}`] ?? null;
  const stopClock = data?.[`finish_${key}`] ?? data?.[`finish_${flat}`] ?? null;
  const durationMs = data?.[`duration_${flat}_ms`] ?? null;

  return { startClock, stopClock, durationMs };
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

  const startMs = Date.parse(st.startClock);
  if (!isFinite(startMs)) return;

  const paused = Number.isFinite(st.durationMs) ? st.durationMs : 0;
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
    toggleBtn.querySelector('span').textContent = `${t('marathon_stages_active_timers').replace('{count}', activeTimers.size)}`;
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

  const commentStart = doc[`commentStart_${flat}`] ?? '';
  const commentStop = doc[`commentStop_${flat}`] ?? '';

  const base = { startClock, stopClock, durationMs, commentStart, commentStop };

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

async function readStageDoc(sn) {
  const snap = await getDoc(maratonDocRef(sn));
  return snap.exists() ? hydrateTimingFromFlat(snap.data()) : null;
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
      const startTs = Date.parse(st.startClock);
      let t = activeTimers.get(tKey);
      if (!t) {
        t = { isRunning: true, startEpoch: startTs, pausedMs: (st.durationMs || 0) };
        activeTimers.set(tKey, t);
      } else {
        t.isRunning = true;
        t.startEpoch = startTs;
        t.pausedMs = (st.durationMs || 0);
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
      const data = snap.exists() ? snap.data() : null;
      if (data) mirrorToLocal(sn, data); // Backuppa lokalt
      applyDocToLocalState(sn, data);
    },
    (err) => console.error('[maraton-stages] onSnapshot /maraton error', err?.code || err)
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
    const key = `bkp_${competitionId}_${sn}`;
    localStorage.setItem(key, JSON.stringify({
      ts: Date.now(),
      data
    }));
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
          .stageTab { py-2 !important; font-size: 12px !important; }
          .timer-display { font-size: 2.25rem !important; }
      }
    </style>

    <div class="container mx-auto p-4 md:p-8 max-w-4xl">
      ${getCompetitionHeader(comp, t('marathon_stages_header'))}

      <!-- STICKY HEADER: KUSK-INFO & FLIKAR -->
      <div class="sticky-stages-header sticky top-[63px] bg-white/95 dark:bg-gray-900/95 backdrop-blur p-4 border-b dark:border-gray-700 z-30 shadow-sm">
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div id="eqInfo" class="font-bold text-sm md:text-base dark:text-white truncate">${t('marathon_stages_select_equipage')}…</div>
              <div class="text-[10px] uppercase font-bold text-gray-500">
                Aktiv etapp: <span id="activeStageLabel" class="text-blue-600 dark:text-blue-400">${decorateStageLabel(currentStage)}</span>
              </div>
            </div>
            <div class="flex gap-1">
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
          <div class="flex items-center justify-between mb-2">
            <label class="text-[10px] uppercase font-bold text-gray-500">${t('marathon_stages_select_equipage')}</label>
            <button id="btnBackupJson" class="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline">${t('marathon_stages_export_json')}</button>
          </div>
          <div id="equipageDropdown"></div>
          <div id="infoLineSmall" class="mt-2 text-[10px] text-gray-400 text-center uppercase">—</div>
        </div>

        <!-- AKTIVA TIMERS (UTFÄLLBAR) -->
        <div id="activeTimersWrapper" class="active-timers-wrapper bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3 shadow-sm">
          <button id="toggleActiveTimers" class="w-full flex justify-between items-center">
            <span class="text-[10px] uppercase font-bold text-gray-500">Aktiva timers (0)</span>
            <span class="arrow text-gray-400 transition-transform">▼</span>
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
    <div class="flex items-start justify-between gap-4">
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

      <div class="text-right shrink-0">
        <div id="timer-${stage}"
             class="timer-display text-4xl md:text-6xl font-black tabular-nums text-gray-800 dark:text-white leading-none cursor-pointer tracking-tighter"
             title="Klicka för manuell tid">
          00:00,00
        </div>
        
        <!-- Manuelltids-editor (popup) -->
        <div id="manual-${stage}"
             class="hidden absolute right-4 mt-2 w-72 p-4 rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl z-50">
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
    <div class="flex items-stretch gap-2">
      <button id="btnStart-${stage}" class="flex-[2] py-4 text-xl font-black rounded-xl bg-emerald-600 text-white shadow-lg active:scale-95 transition-all">${t('marathon_stages_btn_start')}</button>
      <button id="btnStop-${stage}"  class="flex-[2] py-4 text-xl font-black rounded-xl bg-rose-600 text-white shadow-lg active:scale-95 transition-all">${t('marathon_stages_btn_finish')}</button>
      <button id="btnReset-${stage}" class="w-14 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 active:scale-95 transition-all" title="${t('marathon_stages_reset')}">🔄</button>
    </div>

    <!-- KLOCKSLAG OCH KOMMENTARER -->
    <div class="grid grid-cols-2 gap-4">
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
      <div class="flex items-center justify-between">
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
        <div class="flex items-center justify-between">
          <label for="otherMarathonPenalty" class="text-[10px] uppercase font-bold text-gray-500">${t('marathon_stages_other_penalty_total')}</label>
          <input type="number" id="otherMarathonPenalty" min="0" step="0.01" inputmode="decimal" class="w-24 text-right font-bold rounded-lg border dark:border-gray-700 px-2 py-1 dark:bg-gray-900/40 dark:text-white">
        </div>
        
        <button id="btnSave-${stage}" class="w-full py-4 rounded-xl bg-brand-darkblue text-white font-black text-xl shadow-lg hover:bg-brand-gold hover:text-brand-darkblue active:scale-[0.98] transition-all">${t('marathon_stages_save_changes')}</button>
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

  const st = currentDocData?.timing?.[stage] || {};
  if (st.stopClock && Number.isFinite(st.durationMs)) {
    host.textContent = msToLabel(st.durationMs);
    applyTimerColor(host, sn, stage, st.durationMs);
    updateTimerInfo(stage, sn, st.durationMs);
  } else if (st.startClock && !st.stopClock) {
    const ms = (st.durationMs || 0) + (Date.now() - Date.parse(st.startClock));
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
  cancelBtn.addEventListener('click', close);

  okBtn.addEventListener('click', async () => {
    if (!currentEquipage) { showAlert(t('marathon_stages_select_equipage_first')); return; }

    const raw = inputEl.value;
    const ms = typeof digitsToMs === 'function'
      ? digitsToMs(raw)
      : (() => { const d = (raw || '').replace(/\D/g, '').slice(0, 6).padEnd(6, '0'); return ((+d.slice(0, 2)) * 60 + (+d.slice(2, 4))) * 1000 + (+d.slice(4, 6)) * 10; })();

    if (!Number.isFinite(ms) || ms < 0) {
      showAlert(t('marathon_stages_manual_time_invalid'));
      return;
    }

    const sn = String(currentEquipage.startNumber);
    const key = `${sn}|${stage}`;

    // Uppdatera lokal timerstate
    let t = activeTimers.get(key);
    if (!t) { t = { isRunning: false, startEpoch: 0, pausedMs: 0 }; activeTimers.set(key, t); }
    if (t._ticker) clearInterval(t._ticker);
    t.isRunning = false;
    t.startEpoch = 0;
    t.pausedMs = ms;

    // UI direkt
    updateTimerLabel(stage);

    // Spara snapshot (start = nu - ms, stopp = nu)
    const dNow = new Date();
    dNow.setMilliseconds(0);
    const nowMs = dNow.getTime();

    const payload = {
      durationMs: ms,
      startClock: new Date(nowMs - ms).toISOString(),
      stopClock: dNow.toISOString(),
      commentStart: document.getElementById(`commentStart-${stage}`)?.value || '',
      commentStop: document.getElementById(`commentStop-${stage}`)?.value || '',
    };
    if (stage === 'B') {
      payload.bitCheckOk = !!document.getElementById('bitOk')?.checked;
      payload.bitCheckComment = document.getElementById('bitComment')?.value || '';
    }

    try { await saveStageSnapshot(stage, payload); }
    catch (e) { console.error(e); showAlert(t('marathon_stages_manual_time_error2')); }
    finally { close(); }
  });
}

// ---------- Actions ----------
// Bind knapparna för den aktuella etapp-panelen (utan någon timerEl-logik här)
function bindStagePanel(stage) {
  // Start / Mål / Nollställ / Spara
  const btnStart = document.getElementById(`btnStart-${stage}`);
  const btnStop = document.getElementById(`btnStop-${stage}`);
  const btnReset = document.getElementById(`btnReset-${stage}`) || document.getElementById(`btnZero-${stage}`);
  const btnSave = document.getElementById(`btnSave-${stage}`);

  btnStart && btnStart.addEventListener('click', () => startStage(stage));
  btnStop && btnStop.addEventListener('click', () => stopStage(stage));
  btnReset && btnReset.addEventListener('click', () => resetStage(stage));
  btnSave && btnSave.addEventListener('click', () => saveCurrentStage?.(stage));

  // BORTTAGEN: Lyssnare för btnFinalize

  // Koppla den nya *globala* editor-bindningen
  bindManualEditor(stage);

  // Förhindra negativa tecken i fältet (extra skydd)
  const otherEl = document.getElementById('otherMarathonPenalty');
  if (otherEl && !otherEl.dataset.bound) {
    otherEl.dataset.bound = '1';
    otherEl.addEventListener('input', () => {
      const v = (otherEl.value || '').trim();
      if (v === '') return;
      const n = Number(v.replace(',', '.'));
      if (!Number.isFinite(n)) return;
      if (n < 0) otherEl.value = '0';
    });
  }

  // NYTT: Manuell Eliminering
  const elimEl = document.getElementById('manualEliminated');
  if (elimEl) {
    elimEl.addEventListener('change', async () => {
      if (!currentEquipage) return;
      const sn = String(currentEquipage.startNumber);
      const val = elimEl.checked;

      // Spara till firestore (root-nivå)
      try {
        await setDoc(maratonDocRef(sn), { eliminated: val }, { merge: true });
        // UI-feedback sker via onSnapshot -> populateStageUI, men vi kan sätta färg direkt om vi vill
      } catch (e) {
        console.error('Kunde inte spara eliminering', e);
        showAlert(t('marathon_stages_elim_save_error'));
        elimEl.checked = !val; // ångra
      }
    });
  }

  // NYTT: Koppla kommentarsknapp och textfält med robust hantering
  const panel = document.getElementById('stagePanel');
  const commentBtn = panel?.querySelector('.comment-toggle-btn');
  if (commentBtn) {
    commentBtn.onclick = () => {
      const wrapper = panel.querySelector('.comment-wrapper');
      wrapper?.classList.toggle('comment-visible');
      if (wrapper?.classList.contains('comment-visible')) {
        wrapper.querySelector('textarea')?.focus();
      }
    };
  }

  const updateBtnStatus = () => {
    const csVal = document.getElementById(`commentStart-${stage}`)?.value || '';
    const ceVal = document.getElementById(`commentStop-${stage}`)?.value || '';
    let hasB = false;
    if (stage === 'B') {
      hasB = !!(document.getElementById('bitComment')?.value);
    }
    commentBtn?.classList.toggle('has-comment', csVal.length > 0 || ceVal.length > 0 || hasB);
  };

  // Auto-save för kommentarer (direkt vid ändring)
  const autoSaveComment = async () => {
    updateBtnStatus();
    if (!currentEquipage) return;
    try {
      await saveStageSnapshot(stage, {
        commentStart: document.getElementById(`commentStart-${stage}`)?.value || '',
        commentStop: document.getElementById(`commentStop-${stage}`)?.value || '',
        ...(stage === 'B' ? {
          bitCheckComment: document.getElementById('bitComment')?.value || ''
        } : {})
      });
    } catch (e) { console.error('Auto-save comment failed', e); }
  };

  const csInp = document.getElementById(`commentStart-${stage}`);
  if (csInp) csInp.oninput = autoSaveComment;
  const ceInp = document.getElementById(`commentStop-${stage}`);
  if (ceInp) ceInp.oninput = autoSaveComment;

  if (stage === 'B') {
    const bitC = document.getElementById('bitComment');
    if (bitC) bitC.oninput = autoSaveComment;
    const bitOk = document.getElementById('bitOk');
    if (bitOk) {
      bitOk.onclick = async () => {
        if (!currentEquipage) return;
        await saveStageSnapshot(stage, { bitCheckOk: bitOk.checked });
      };
    }
  }

  // NYTT: Klicka på Start kl. / Mål kl. för att ändra manuellt – använd onclick för att undvika dubbla lyssnare
  const startEl = document.getElementById(`startClock-${stage}`);
  if (startEl) startEl.onclick = () => handleManualClockEdit(stage, 'start');

  const stopEl = document.getElementById(`stopClock-${stage}`);
  if (stopEl) stopEl.onclick = () => handleManualClockEdit(stage, 'stop');
}

async function handleManualClockEdit(stage, type) {
  if (!currentEquipage) return;

  const sn = String(currentEquipage.startNumber);
  const stDoc = currentDocData?.timing?.[stage] || {};

  const label = type === 'start' ? t('marathon_stages_start_time') : t('marathon_stages_finish_time');

  // Pre-fill med nuvarande tid i HHMMSS-format för enklare justering
  let defVal = '';
  const currentIso = type === 'start' ? stDoc.startClock : stDoc.stopClock;
  if (currentIso) {
    const d = new Date(currentIso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    defVal = `${hh}${mm}${ss}`;
  }

  const raw = prompt(t('marathon_stages_enter_new_time').replace('{label}', label), defVal);
  if (!raw) return;

  // Litet regex för att parsa HH:MM:SS (eller HH:MM:SS,ms)
  // Tillåter även HHMMSS eller HMMSS
  const parseTimeInput = (str) => {
    const s = str.trim().replace(',', '.');

    // 1. Kolon-format: HH:MM:SS
    const matchCol = s.match(/^(\d{1,2})[:.](\d{2})[:.](\d{2})$/);
    if (matchCol) {
      return { h: +matchCol[1], m: +matchCol[2], s: +matchCol[3] };
    }

    // 2. Släta siffror: 5 eller 6 tecken (HMMSS eller HHMMSS)
    // Ex: "93000" -> 09:30:00, "123000" -> 12:30:00
    const matchPlain = s.match(/^(\d{1,2})(\d{2})(\d{2})$/);
    if (matchPlain) {
      return { h: +matchPlain[1], m: +matchPlain[2], s: +matchPlain[3] };
    }

    return null;
  };

  const t = parseTimeInput(raw);
  if (!t) {
    showAlert(t('marathon_stages_invalid_time_format'), false);
    return;
  }

  // Konstruera datumet. Använd befintlig tidstämpelns datum om möjligt, annars "idag".
  let baseDate = new Date();

  const existingIso = type === 'start' ? stDoc.startClock : stDoc.stopClock;
  if (existingIso) {
    baseDate = new Date(existingIso);
  } else {
    // Om vi redigerar start men start saknas -> kolla mål
    if (type === 'start' && stDoc.stopClock) baseDate = new Date(stDoc.stopClock);
    // Om vi redigerar mål men mål saknas -> kolla start
    else if (type === 'stop' && stDoc.startClock) baseDate = new Date(stDoc.startClock);
  }

  baseDate.setHours(t.h, t.m, t.s, 0); // nollställ ms för enkelhetens skull, eller låt användaren mata in?
  const newIso = baseDate.toISOString();

  // Beräkna duration om vi har båda punkterna
  let newStart = (type === 'start') ? newIso : stDoc.startClock;
  let newStop = (type === 'stop') ? newIso : stDoc.stopClock;
  let newDuration = null;

  if (newStart && newStop) {
    const dStart = new Date(newStart);
    const dStop = new Date(newStop);

    // --- NYTT: Förhindra 0,xx-diffar vid manuell ändring ---
    // Nollställ millisekunder för BÅDA så att duration === (stop - start) i hela sekunder
    dStart.setMilliseconds(0);
    dStop.setMilliseconds(0);

    const tStart = dStart.getTime();
    const tStop = dStop.getTime();

    if (Number.isFinite(tStart) && Number.isFinite(tStop)) {
      newDuration = Math.max(0, tStop - tStart);
      // Uppdatera även de ISO-strängar som sparas så att de slutar på .000Z
      newStart = dStart.toISOString();
      newStop = dStop.toISOString();
    }
  }

  // Payload
  const payload = {};
  if (type === 'start') payload.startClock = newStart;
  else payload.stopClock = newStop;

  // Om vi ändrade en klocka och den andra fanns -> spara även den andra med nollade ms
  // för att garantera att duration stämmer med visad tid.
  if (type === 'start' && newStop) payload.stopClock = newStop;
  if (type === 'stop' && newStart) payload.startClock = newStart;

  if (newDuration !== null) {
    payload.durationMs = newDuration;
  }

  // --- VALIDERING: Varning för framtida tid ---
  const diffFromNow = new Date(newIso).getTime() - Date.now();
  if (diffFromNow > 5 * 60_000) { // Mer än 5 minuter i framtiden
    if (!confirm(t('marathon_stages_future_time_warning'))) {
      return;
    }
  }

  // Om vi "öppnar" (tar bort start/stop) - stödjs ej via denna prompt just nu, 
  // vi förutsätter att man vill sätta en tid.

  try {
    await saveStageSnapshot(stage, payload);

    // --- SYNKA LOKAL STATE (activeTimers) ---
    const key = `${sn}|${stage}`;
    const tm = activeTimers.get(key);

    if (tm) {
      if (type === 'start') {
        // Om vi ändrade starttid -> justera startEpoch för den tickande timern
        const newStartMs = new Date(newStart).getTime();
        tm.startEpoch = newStartMs;
      }
      
      if (type === 'stop' && newStop) {
        // Om vi satte en måltid manuellt -> stoppa timern lokalt
        tm.isRunning = false;
        if (newDuration !== null) tm.pausedMs = newDuration;
      }

      // Om vi nu har både start och mål (och timern fanns) -> definitivt stoppad
      if (newStart && newStop) {
        tm.isRunning = false;
        if (newDuration !== null) tm.pausedMs = newDuration;
      }
    }

    // Tvinga omedelbar UI-uppdatering så användaren ser "hoppet" i tid
    updateTimerLabel(stage);
    renderActiveCards();

  } catch (err) {
    console.error(err);
    showAlert(t('marathon_stages_could_not_update_time'), false);
  }
}


async function focusEquipageStage(sn, stage) {
  const eq = findEquipageBySn(sn);
  if (!eq) return;

  // välj ekipage
  currentEquipage = eq;
  if (typeof reflectDropdownSelection === 'function') reflectDropdownSelection(eq);

  // === REDIRECT LOGIC for Fixed Time "Warm-up" on Stage A ===
  // Normalisera etappen baserat på ekipagets profil (A vs Warm-up)
  const normalized = normalizeStageForEquipage(eq, stage || currentStage);
  if (normalized !== (stage || currentStage)) {
    stage = normalized;
  }

  // NYTT: Uppdatera flikar (VISUAL ONLY)
  updateTabVisibility(eq);

  // Uppdatera rubrik & “Välj ekipage”-info direkt
  updateEqInfo();
  const small = document.getElementById('infoLineSmall');
  if (small) {
    small.textContent = t('marathon_stages_showing_equipage').replace('{startNumber}', eq.startNumber).replace('{driverName}', eq.driverName || '').replace('{stage}', decorateStageLabel(stage || currentStage));
  }

  // Byt flik/etapp program­matiskt (samma som i wireTabs())
  if (stage && stage !== currentStage) {
    currentStage = stage;
    // 1) Flik-stil
    highlightActiveTab();
    // 2) Etikett i headern
    const lab = document.getElementById('activeStageLabel');
    if (lab) lab.textContent = decorateStageLabel(stage);
    // 3) Rendera rätt panel och bind knappar/editor
    const host = document.getElementById('stagePanel');
    if (host) {
      host.innerHTML = renderStagePanel(currentStage);
      bindStagePanel(currentStage);
    }
  }

  // ladda & fyll UI
  try {
    const snStr = String(eq.startNumber);
    currentDocData = await readStageDoc(snStr) || {};
  } catch (e) {
    currentDocData = {};
  }
  populateStageUI(currentStage, currentDocData);
  updateTimerLabel(currentStage);
  updateStageEqLine();
  ensureGlobalTicker();

  // scrolla till timern så man ser kommentarsfälten direkt under
  document.getElementById(`timer-${currentStage}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// NYTT: Dynamisk visning av flikar baserat på om A är "Warm-up" (Fixed Time)
function updateTabVisibility(eq) {
  if (!eq) return;
  const limitsA = limitsFor(eq, 'A');

  // Detektera "Fixed Time A" genom att kolla om max === ideal (och > 0) och min === 0
  const isFixedTimeA = limitsA && limitsA.ideal > 0 && limitsA.max === limitsA.ideal && limitsA.min === 0;

  const warmupTab = document.querySelector('button[data-stage="warmup"]');
  const stageATab = document.querySelector('button[data-stage="A"]');

  if (isFixedTimeA) {
    // 1. Dölj den "riktiga" warm-up-fliken
    if (warmupTab) warmupTab.classList.add('hidden');

    // 2. Döp om A-fliken till "Warm-up"
    if (stageATab) {
      stageATab.textContent = 'Warm-up';
      // Ensure we preserve icon if present (re-apply updateTabStatuses logic potentially, or just text)
      // updateTabStatuses relies on .dataset.originalLabel + icon.
      // We should update originalLabel too so future icon updates use the new name.
      stageATab.dataset.originalLabel = 'Warm-up';
    }
  } else {
    // Återställ
    if (warmupTab) warmupTab.classList.remove('hidden');
    if (stageATab) {
      stageATab.textContent = 'A';
      stageATab.dataset.originalLabel = 'A';
    }
  }
}

function decorateStageLabel(stage, eq = currentEquipage) {
  if (stage === 'A') {
    const limitsA = limitsFor(eq, 'A');
    if (limitsA && limitsA.ideal > 0 && limitsA.max === limitsA.ideal && limitsA.min === 0) {
      return 'Warm-up';
    }
  }
  return stageNiceLabel(stage);
}

function populateStageUI(stage, data) {


  const st = data?.timing?.[stage] || {};
  const sc = document.getElementById(`startClock-${stage}`);
  const ec = document.getElementById(`stopClock-${stage}`);
  const cs = document.getElementById(`commentStart-${stage}`);
  const ce = document.getElementById(`commentStop-${stage}`);

  if (sc) sc.textContent = st.startClock ? new Date(st.startClock).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
  if (ec) ec.textContent = st.stopClock ? new Date(st.stopClock).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
  
  if (cs && typeof st.commentStart === 'string' && document.activeElement !== cs) cs.value = st.commentStart;
  if (ce && typeof st.commentStop === 'string' && document.activeElement !== ce) ce.value = st.commentStop;

  // NYTT: Uppdatera kommentarsknappen baserat på innehåll
  const commentBtn = document.querySelector('.comment-toggle-btn');
  if (commentBtn) {
    const hasComment = (st.commentStart || st.commentStop || st.bitCheckComment);
    commentBtn.classList.toggle('has-comment', !!hasComment);
  }

  const otherPenaltyEl = document.getElementById('otherMarathonPenalty');
  if (otherPenaltyEl && isNum(data?.otherPenalty) && document.activeElement !== otherPenaltyEl) {
    otherPenaltyEl.value = data.otherPenalty;
  }

  const elimEl = document.getElementById('manualEliminated');
  if (elimEl && document.activeElement !== elimEl) {
    elimEl.checked = !!data.eliminated;
  }

  if (stage === 'B') {
    const bitOk = document.getElementById('bitOk');
    const bitC = document.getElementById('bitComment');
    if (bitOk && typeof st.bitCheckOk === 'boolean' && document.activeElement !== bitOk) bitOk.checked = !!st.bitCheckOk;
    if (bitC && typeof st.bitCheckComment === 'string' && document.activeElement !== bitC) bitC.value = st.bitCheckComment;
  }
}

// RAD EFTER (ca 1324): async function startStage(stage){

async function startStage(stage) {
  if (!currentEquipage) { showAlert(t('marathon_stages_select_equipage_first'), false); return; }
  const eq = currentEquipage;
  const sn = String(eq.startNumber);
  const actualStage = normalizeStageForEquipage(eq, stage);
  const key = `${sn}|${actualStage}`;
  const stDoc = currentDocData?.timing?.[stage] || {};
  const nowIso = new Date().toISOString();
  const nowEpoch = Date.parse(nowIso);

  // 1) Redan igång på dokumentet? → anslut lokalt & lämna
  if (stDoc.startClock && !stDoc.stopClock) {
    const startTS = Date.parse(stDoc.startClock);
    let t = activeTimers.get(key);
    if (!t) {
      t = { isRunning: true, startEpoch: startTS, pausedMs: (stDoc.durationMs || 0) };
      activeTimers.set(key, t);
    } else {
      t.isRunning = true;
      t.startEpoch = startTS;
      t.pausedMs = (stDoc.durationMs || 0);
    }
    // --- OPTIMISTISK ---
    addOrUpdateActiveCard(sn, stage);
    ensureGlobalTicker();
    updateTimerLabel(stage);
    renderActiveCards();
    return;
  }

  // 2) ÅTERUPPTA: det finns en sparad tid (mål registrerat) → behåll duration, öppna igen
  if (stDoc.stopClock && Number.isFinite(stDoc.durationMs)) {
    // lokal ticker ska fortsätta från pausad tid
    let t = activeTimers.get(key);
    if (!t) { t = { isRunning: false, startEpoch: 0, pausedMs: 0 }; activeTimers.set(key, t); }
    t.isRunning = true;
    t.startEpoch = nowEpoch; // nu börjar nästa “etapp” av samma körning
    t.pausedMs = stDoc.durationMs || 0; // redan uppmätt tid

    // --- OPTIMISTISK UPPDATERING ---
    // UI: visa ny start och rensa mål
    const sEl = document.getElementById(`startClock-${stage}`);
    if (sEl) sEl.textContent = new Date(nowIso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const eEl = document.getElementById(`stopClock-${stage}`);
    if (eEl) eEl.textContent = '–';

    // Starta den lokala tickern och uppdatera alla UI-delar
    addOrUpdateActiveCard(sn, stage);
    ensureGlobalTicker();
    updateTimerLabel(stage);
    renderActiveCards();

    // Spara till servern i bakgrunden
    try {
      await saveStageSnapshot(stage, {
        startClock: nowIso,          // ny start för “fortsättningen”
        stopClock: null,            // öppna igen
        durationMs: stDoc.durationMs || 0, // ackumulerad tid hittills
        runningStage: stage
      });
    } catch (err) {
      console.error(err);
      showAlert(t('marathon_stages_resume_error'), false);
      return;
    }
    return;
  }

  // 3) NY START
  let t = activeTimers.get(key);
  if (!t) { t = { isRunning: false, startEpoch: 0, pausedMs: 0 }; activeTimers.set(key, t); }
  t.isRunning = true;
  t.startEpoch = nowEpoch;
  t.pausedMs = 0;

  // --- OPTIMISTISK UPPDATERING ---
  // UI (klockslag)
  const sEl = document.getElementById(`startClock-${stage}`);
  if (sEl) sEl.textContent = new Date(nowIso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const eEl = document.getElementById(`stopClock-${stage}`);
  if (eEl) eEl.textContent = '–';

  // Starta den lokala tickern och uppdatera alla UI-delar
  addOrUpdateActiveCard(sn, stage);
  ensureGlobalTicker();
  updateTimerLabel(stage);
  renderActiveCards();

  // Spara till servern i bakgrunden
  try {
    await saveStageSnapshot(stage, {
      startClock: nowIso,
      stopClock: null,
      durationMs: 0,
      runningStage: stage
    });
  } catch (err) {
    console.error(err);
    showAlert(t('marathon_stages_save_start_error'), false);
  }
}

async function stopStage(stage) {
  const eq = currentEquipage;
  const sn = String(eq.startNumber);
  const actualStage = normalizeStageForEquipage(eq, stage);
  const key = `${sn}|${actualStage}`;

  const now = Date.now();
  const stopIso = new Date(now).toISOString();

  // 1. Beräkna den slutgiltiga tiden på ett robust sätt
  let finalMs = 0;
  const localTimer = activeTimers.get(key);
  const docData = currentDocData?.timing?.[stage] || {};

  if (localTimer?.isRunning) {
    // Om en lokal timer tickar, är det den som gäller.
    finalMs = localTimer.pausedMs + (now - localTimer.startEpoch);
  } else if (docData.startClock && !docData.stopClock) {
    // Om ingen lokal timer finns (t.ex. startad på annan enhet), beräkna från dokumentet.
    const startMs = new Date(docData.startClock).getTime();
    const accumulatedMs = docData.durationMs || 0;
    finalMs = accumulatedMs + (now - startMs);
  } else if (Number.isFinite(docData.durationMs)) {
    // Om klockan redan var stoppad, behåll den sparade tiden.
    finalMs = docData.durationMs;
  }

  // --- NYTT: VARNING VID LÅNG TID ---
  if (isDurationSuspicious(finalMs, currentEquipage, stage)) {
    const ok = confirm(t('marathon_stages_max_time_warning').replace('{time}', fmtMsTimer(finalMs)));
    if (!ok) return;
  }

  // --- OPTIMISTISK UPPDATERING ---
  // 2. Uppdatera UI direkt för omedelbar feedback
  const labelEl = document.getElementById(`stopClock-${stage}`);
  if (labelEl) {
    labelEl.textContent = new Date(stopIso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  const timerEl = document.getElementById(`timer-${stage}`);
  if (timerEl) {
    timerEl.textContent = fmtMsTimer(finalMs);
    applyTimerColor(timerEl, sn, stage, finalMs);
  }
  updateTimerInfo(stage, sn, finalMs);

  // 3. Städa upp den lokala tickern OMEDELBART
  if (activeTimers.has(key)) {
    activeTimers.delete(key);
    removeActiveCard(key);
    stopGlobalTickerIfIdle();
    renderActiveCards();
  }

  // 4. Skapa payload för att spara i Firestore
  const payload = {
    stopClock: stopIso,
    durationMs: finalMs,
    commentStart: document.getElementById(`commentStart-${stage}`)?.value || '',
    commentStop: document.getElementById(`commentStop-${stage}`)?.value || '',
    runningStage: null, // Markera att ingen etapp längre är aktiv
    ...(stage === 'B' ? {
      bitCheckOk: !!document.getElementById('bitOk')?.checked,
      bitCheckComment: document.getElementById('bitComment')?.value || ''
    } : {})
  };

  // 5. Spara till Firestore i bakgrunden
  try {
    await saveStageSnapshot(stage, payload);
  } catch (err) {
    console.error(err);
    showAlert(t('marathon_stages_save_finish_error'), false);
    return; // Avbryt om det inte gick att spara
  }

  // VIKTIGT: Vi stannar kvar på sidan. Ingen automatisk navigering.
  showAlert(t('marathon_stages_finish_registered').replace('{stage}', decorateStageLabel(stage)), true);
  document.getElementById(`commentStop-${stage}`)?.focus(); // Sätt fokus på kommentarsfältet
}

// --- RESET (nollställer tid lokalt + i DB) ---
async function resetStage(stage) {
  if (!currentEquipage) return;
  if (!confirm(t('marathon_stages_reset_confirm').replace('{stage}', decorateStageLabel(stage)))) return;

  const eq = currentEquipage;
  const sn = String(eq.startNumber);
  const actualStage = normalizeStageForEquipage(eq, stage);
  const key = `${sn}|${actualStage}`;

  // 1. Stoppa och ta bort eventuell lokal timer
  if (activeTimers.has(key)) {
    activeTimers.delete(key);
    removeActiveCard(key);
    stopGlobalTickerIfIdle();
  }

  // 2. Skapa en payload som uttryckligen sätter ALLA relevanta fält till null
  const isFTA = (() => {
    const limA = limitsFor(eq, 'A');
    return limA && limA.ideal > 0 && limA.max === limA.ideal && limA.min === 0;
  })();

  const payload = {
    runningStage: null,
    updatedAt: serverTimestamp()
  };

  // Listan på etapper som ska rensas
  const stagesToClear = (isFTA && (stage === 'A' || stage === 'warmup')) 
    ? ['A', 'warmup'] 
    : [stage];

  for (const s of stagesToClear) {
    const stageKey = s.toUpperCase();
    const flatPrefix = s === 'warmup' ? 'warmup' : (s === 'transport' ? 'transfer' : s);

    payload[`start_${stageKey}`] = null;
    payload[`start_${flatPrefix}`] = null;
    payload[`finish_${stageKey}`] = null;
    payload[`finish_${flatPrefix}`] = null;
    payload[`duration_${flatPrefix}_ms`] = null;
    payload[`commentStart_${flatPrefix}`] = '';
    payload[`commentStop_${flatPrefix}`] = '';
    
    if (s === 'B') {
      Object.assign(payload, { bitCheckOk: null, bettOk: null, bitCheckComment: null, bettComment: null });
    }
    
    payload[`timing.${s}`] = deleteField();
    payload[`stages.${s}`] = deleteField();

    // Rensa lokalt timer-state för denna specifika nyckel också
    const tKey = `${sn}|${s}`;
    if (activeTimers.has(tKey)) {
      activeTimers.delete(tKey);
      removeActiveCard(tKey);
    }
    
    // Rensa i currentDocData
    if (currentDocData?.timing) {
      currentDocData.timing[s] = {};
    }
  }

  stopGlobalTickerIfIdle();
  populateStageUI(stage, currentDocData);
  updateTimerLabel(stage);
  renderActiveCards(); // Se till att listan "Aktiva" också uppdateras

  // 4. Spara den rensande payloaden till Firestore i bakgrunden
  try {
    // Använd setDoc utan merge för att garantera en fullständig överskrivning av dessa fält
    await setDoc(maratonDocRef(sn), payload, { merge: true });
  } catch (err) {
    console.error(err);
    showAlert(t('marathon_stages_reset_error'), false);
    return;
  }

  showAlert(t('marathon_stages_reset_success').replace('{stage}', decorateStageLabel(stage)), true);
}

async function saveCurrentStage(stage) {
  if (!currentEquipage) { showAlert(t('marathon_stages_select_equipage_first'), false); return; }

  // 1) Spara kommentarer (och ev. bettkontroll) som tidigare
  await saveStageSnapshot(stage, {
    commentStart: document.getElementById(`commentStart-${stage}`)?.value || '',
    commentStop: document.getElementById(`commentStop-${stage}`)?.value || '',
    ...(stage === 'B' ? {
      bitCheckOk: !!document.getElementById('bitOk')?.checked,
      bitCheckComment: document.getElementById('bitComment')?.value || ''
    } : {})
  });

  // 2) Övrigt straff – tillåt 0, förhindra negativa
  const el = document.getElementById('otherMarathonPenalty');
  if (el) {
    const raw = (el.value ?? '').trim();
    // tomt fält -> uppdatera inte otherPenalty alls
    if (raw !== '') {
      // acceptera både "1,25" och "1.25"
      const num = Number(raw.replace(',', '.'));
      if (!Number.isFinite(num)) {
        showAlert(t('marathon_stages_invalid_penalty'), false);
      } else {
        let safe = num;
        if (safe < 0) {
          safe = 0;
          el.value = '0';
          showAlert(t('marathon_stages_negative_penalty_warning'), false);
        }
        // Viktigt: spara även 0 (tidigare försvann 0 p.g.a. `|| null`)
        await setDoc(maratonDocRef(currentEquipage.startNumber), {
          otherPenalty: safe
        }, { merge: true });
      }
    }
  }

  showAlert(t('marathon_stages_saved'), true);
}


async function finalizeMarathon() {
  if (!currentEquipage) { showAlert(t('marathon_stages_select_equipage_first'), false); return; }

  // Spara först eventuella osaprade ändringar
  await saveCurrentStage('B');

  if (confirm(t('marathon_stages_finalize_confirm').replace('{startNumber}', currentEquipage.startNumber))) {
    try {
      await setDoc(maratonDocRef(currentEquipage.startNumber), {
        finalized: true,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showAlert(t('marathon_stages_finalize_success').replace('{startNumber}', currentEquipage.startNumber));
    } catch (err) {
      showAlert(t('marathon_stages_finalize_error'), false);
    }
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
  document.addEventListener('keydown', (e) => {
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
  });
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
          const startTS = new Date(stageData.startClock).getTime();

          // Skapa ett lokalt timer-objekt som matchar den verkliga starttiden.
          // `paintTimer` beräknar tiden som `pausedMs + (Date.now() - startEpoch)`.
          // Genom att sätta `startEpoch` till den ursprungliga starttiden och `pausedMs`
          // till 0, blir beräkningen `0 + (Date.now() - startTS)`, vilket är exakt rätt.
          const timerState = {
            isRunning: true,
            startEpoch: startTS, // Den ursprungliga, verkliga start-timestampen
            pausedMs: 0,
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
  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id;
  const root = document.getElementById('page-maraton-stages');
  if (!competitionId) {
    if (root) root.innerHTML = '<p class="p-8 text-center text-gray-600 dark:text-gray-400">Ingen tävling vald.</p>';
    return;
  }

  // 1. Rendera grundlayouten först så att alla HTML-element finns på plats
  renderLayout();
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
  } else {
    console.error("Kunde inte hitta #equipageDropdown i DOM.");
  }

  // Request Wake Lock
  await requestWakeLock();

  // 5. Koppla alla event-lyssnare
  wireEventListeners();
  wireKeyboardShortcuts();

  // 6. Starta de globala Firestore-lyssnarna
  subscribeAllActiveTimers();
  listenForGlobalCompetitionPause();

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
  try { unsubMaratonList && unsubMaratonList(); } catch { }
  unsubAllA = unsubAllB = unsubAllC = unsubAllD = unsubMaratonList = null;

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

// =====================================================
// Manuell tid för etapper – dubbelklick på stora displayen
// =====================================================

function parseManualTimeToMs(input) {
  // accepterar "mm:ss,cc", "mm:ss.cc", "mmsscc" eller "mm:ss"
  const s = String(input || '').trim().replace('.', ',');
  if (!s) return null;

  let mm = 0, ss = 0, cc = 0;
  if (/^\d{1,2}:\d{2}[,]\d{1,2}$/.test(s)) {
    const [m, rest] = s.split(':');
    const [s2, c2] = rest.split(',');
    mm = +m; ss = +s2; cc = +c2.padEnd(2, '0').slice(0, 2);
  } else if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [m, s2] = s.split(':'); mm = +m; ss = +s2;
  } else if (/^\d{3,6}$/.test(s)) {
    const p = s.padStart(6, '0');
    mm = +p.slice(0, 2); ss = +p.slice(2, 4); cc = +p.slice(4, 6);
  } else if (/^\d{1,2}:\d{1,2}[,]?$/.test(s)) {
    const [m, s2] = s.split(':'); mm = +m; ss = +(s2 || 0);
  } else {
    return null;
  }
  if (mm < 0 || ss < 0 || ss >= 60 || cc < 0) return null;
  return (mm * 60 + ss) * 1000 + Math.round(cc * 10);
}

async function applyManualStageTime(stageKey, ms) {
  // Vi sätter stop = nu, start = stop - ms. (Behåller ev tidigare start om du vill – byt här.)
  const dNow = new Date();
  dNow.setMilliseconds(0);
  const stopIso = dNow.toISOString();
  const startIso = new Date(dNow.getTime() - ms).toISOString();

  // Rensa ev. lokala tickers för den här etappen
  try { stopLocalStageTicker(`${listeningStartNumber}|${stageKey}`); } catch { }

  // Spara snapshot – durationMs + start/stop; nollställ runningStage
  await saveStageSnapshot(stageKey, {
    startClock: startIso,
    stopClock: stopIso,
    durationMs: ms,
    runningStage: null
  });
}

function wireManualStageEditors() {
  const ids = ['warmup', 'A', 'transport', 'B'];
  ids.forEach(k => {
    const el = document.getElementById(`timer-${k}`);
    if (!el) return;
    el.title = t('marathon_stages_manual_time_dblclick');
    el.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      const currentTxt = (el.textContent || '').trim();
      const inp = prompt(t('marathon_stages_manual_time_prompt').replace('{stage}', k), currentTxt);
      if (inp == null) return;
      await applyManualStageTime(k, ms);
    });
  });
}

// kör när DOM finns
document.addEventListener('DOMContentLoaded', wireManualStageEditors);
