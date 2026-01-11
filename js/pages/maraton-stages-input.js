// js/pages/maraton-stages-input.js
import { stagePenaltyFromMs, limitsFor, formatMsLive, setMarathonConfig } from '../utils/marathonUtils.js';
import { getGlobalState } from '../main.js';
import { getEquipages, getConfig } from '../services/firestoreService.js';
import { getCompetitionHeader, createSearchableDropdown, showAlert } from '../ui/components.js';
import { doc, getDoc, setDoc, serverTimestamp, collection, onSnapshot, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { downloadJson } from '../utils/sharedUtils.js';

// --- Wrapper functions for marathonUtils ---

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
    tlMs: lim.ideal * 1000,
    minMs: lim.min * 1000,
    maxMs: lim.max * 1000
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
      console.log("Global paus aktiverad. Stoppar lokala timers.");
      if (tickInterval) clearInterval(tickInterval);
      tickInterval = null;
      pauseStartTime = Date.now();
      document.body.style.filter = 'grayscale(80%)';

    } else if (!isPaused && lastPauseState) {
      // TÄVLINGEN ÅTERUPPTAS NU
      console.log("Global paus avslutad. Återupptar lokala timers.");
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
  const key = `${sn}|${stage}`;
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

  // <<--- ändring: ta med ackumulerad (pausad) tid från dokumentet
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
    toggleBtn.querySelector('span').textContent = `Aktiva timers (${activeTimers.size})`;
    toggleBtn.disabled = activeTimers.size === 0;
  }
  // NYTT: Håll listan stängd om den är tom
  if (activeTimers.size === 0) {
    document.getElementById('activeTimersWrapper')?.classList.remove('is-open');
  }

  const parts = [];
  for (const [key, t] of activeTimers) {
    const [sn, stage] = key.split('|');
    const eq = findEquipageBySn(sn);
    const name = eq?.driverName || 'Okänd kusk';
    const ms = t?.isRunning ? (t.pausedMs + (Date.now() - t.startEpoch)) : (t?.pausedMs || 0);

    parts.push(`
<div class="flex items-center justify-between px-3 py-2 rounded-lg border bg-white"
     data-active="${sn}|${stage}">
  <button class="card-left text-left"
          data-sn="${sn}" data-stage="${stage}">
    <div class="text-sm font-medium text-blue-700 hover:underline">
      ${name} <span class="text-gray-500">#${sn}</span>
    </div>
    <div class="text-xs text-gray-500">${stageNiceLabel(stage)}</div>
  </button>
  <div class="flex items-center gap-3">
    <div class="timer font-mono tabular-nums text-lg">${fmtMsTimer(ms)}</div>
    <button class="stop px-2 py-1 text-xs rounded bg-rose-600 text-white">Stoppa</button>
  </div>
</div>
    `);
  }
  host.innerHTML = parts.join('') || '<div class="text-sm text-gray-500">Inga aktiva timers.</div>';
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
  const nestedStage = {};
  if ('startClock' in payload) nestedStage.startClock = payload.startClock;
  if ('stopClock' in payload) nestedStage.stopClock = payload.stopClock;
  if ('durationMs' in payload) nestedStage.durationMs = payload.durationMs;
  if ('commentStart' in payload) nestedStage.commentStart = payload.commentStart ?? '';
  if ('commentStop' in payload) nestedStage.commentStop = payload.commentStop ?? '';

  if (Object.keys(nestedStage).length) {
    flat.stages = { [stage]: nestedStage };
    flat.timing = { [stage]: nestedStage }; // rensa ev. äldre `timing.*` också
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
  for (const stage of stages) {
    const tKey = `${sn}|${stage}`;
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
      if (activeTimers.has(tKey)) {
        removeActiveCard(tKey);
        activeTimers.delete(tKey);
      }
    }
  }

  // Rita om listan med parallella timers och se till att tickern snurrar vid behov
  renderActiveCards();
  ensureGlobalTicker();
}

function tsToMillis(ts) {
  // klarar Firebase Timestamp, Date, eller null/undefined
  try { if (ts?.toMillis) return ts.toMillis(); } catch { }
  const d = (ts instanceof Date) ? ts : (ts?.seconds ? new Date(ts.seconds * 1000) : null);
  return d ? d.getTime() : 0;
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
  if (activeTimers.size === 0 && tickInterval) {
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
  const isCurrentPanel =
    currentEquipage &&
    String(currentEquipage.startNumber) === String(sn) &&
    currentStage === stage;

  if (isCurrentPanel) {
    const big = document.getElementById(`timer-${stage}`);
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
  if (!tlEl && !devEl && !penEl) return;

  const res = computeTimePenalty(equipageSnOrObj, stage, ms);


  // TL (bara själva tiden)
  if (tlEl) {
    tlEl.textContent = (res.tlMs != null) ? fmtMsMMSS(res.tlMs) : '–';
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
  el.classList.remove('text-black', 'text-emerald-600', 'text-rose-600');

  const th = getStageThresholds(equipageSnOrObj, stage);
  if (!th) { el.classList.add('text-black'); return; }

  // Transport: röd först när tidsgräns (ELIM) passeras
  if (stage === 'transport') {
    if (Number.isFinite(th.timeLimitMs) && ms > th.timeLimitMs) {
      el.classList.add('text-rose-600');
    } else {
      el.classList.add('text-black');
    }
    return;
  }

  // A, B, WU: svart < min, grön inom [min, max], röd > max
  if (Number.isFinite(th.minMs) && ms < th.minMs) {
    el.classList.add('text-black');
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

  // Lägg ALLT i en container – precis som i maraton-input
  root.innerHTML = `
    <style>
      .comment-wrapper { display: none; }
      .comment-wrapper.comment-visible { display: block; margin-top: 8px; }
      
      .toggle-btn {
          background: none;
          border: 1px solid #cbd5e1; /* gray-300 */
          border-radius: 99px; /* rounded-full */
          padding: 4px 10px;
          font-size: 11px;
          line-height: 1.2;
          color: #475569; /* gray-600 */
          cursor: pointer;
          white-space: nowrap;
      }
      .toggle-btn:hover { background: #f1f5f9; /* gray-100 */ }
      .toggle-btn.has-comment {
          border-color: #2563eb; /* blue-600 */
          color: #2563eb;
          font-weight: 600;
      }

      /* Stil för utfällbar timer-lista */
      .active-timers-list {
        display: none;
      }
      .active-timers-wrapper.is-open .active-timers-list {
        display: block; /* Visas när wrappern har .is-open */
      }
      .active-timers-wrapper.is-open #toggleActiveTimers .arrow {
        transform: rotate(180deg);
      }
    </style>
    <div class="container mx-auto p-4 md:p-8 max-w-4xl">
      ${getCompetitionHeader(comp, 'Maraton – Etapper (Start/Mål)')}

      <div class="sticky top-[63px] bg-white/95 backdrop-blur p-3 border-b z-30">
        <div class="w-full">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <div id="eqInfo" class="font-semibold">Välj ekipage…</div>
              <div class="text-xs text-gray-600">
                <span>Aktiv etapp:</span>
                <span id="activeStageLabel" class="font-medium">
                  ${(currentStage === 'warmup') ? 'Warm-up' : (currentStage === 'transport' ? 'Transport' : currentStage)}
                </span>
              </div>
            </div>

            <div class="grid grid-cols-4 gap-2 w-full">
              <button data-stage="warmup"    class="stageTab flex-1 py-3 rounded-lg border text-sm font-semibold transition-colors active:scale-95 touch-manipulation">Warm-up</button>
              <button data-stage="A"         class="stageTab flex-1 py-3 rounded-lg border text-sm font-semibold transition-colors active:scale-95 touch-manipulation">A</button>
              <button data-stage="transport" class="stageTab flex-1 py-3 rounded-lg border text-sm font-semibold transition-colors active:scale-95 touch-manipulation">Transp.</button>
              <button data-stage="B"         class="stageTab flex-1 py-3 rounded-lg border text-sm font-semibold transition-colors active:scale-95 touch-manipulation">B</button>
            </div>
          </div>
        </div>
      </div>

      <div class="w-full p-0 pt-3 space-y-4">
        <div class="bg-white rounded-xl border p-3">
          <div class="font-semibold mb-2">Välj ekipage</div>
          <div id="equipageDropdown"></div>
          <div class="mt-3 flex items-center justify-between">
            <div class="text-sm text-gray-600" id="infoLineSmall">—</div>
            <div class="flex gap-2">
              <button id="eqPrev" class="px-3 py-1 rounded border text-sm">⟨ Föreg.</button>
              <button id="eqNext" class="px-3 py-1 rounded border text-sm">Nästa ⟩</button>
            </div>
          </div>
          <div class="mt-3 pt-3 border-t flex justify-end">
            <button id="btnBackupJson" class="text-xs text-blue-600 hover:underline flex items-center gap-1">
              <i class="fas fa-file-download"></i> Ladda ner säkerhetskopia (JSON)
            </button>
          </div>
        </div>

        <div id="activeTimersWrapper" class="active-timers-wrapper bg-white rounded-xl border p-3">
          <button id="toggleActiveTimers" class="font-semibold text-sm w-full text-left flex justify-between items-center">
            <span>Aktiva timers (0)</span>
            <span class="arrow transition-transform">▼</span>
          </button>
          <div id="activeTimers" class="active-timers-list space-y-2 mt-3">
            </div>
        </div>


        <div id="stagePanel" class="bg-white rounded-xl border p-3">
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
<div class="rounded-xl border bg-white p-2 md:p-4">
  <div class="grid gap-4 md:[grid-template-columns:minmax(0,1fr)_minmax(260px,400px)] items-start">

    <div>
      <p class="text-[11px] md:text-xs text-gray-500">Etapp</p>
      <h2 class="mt-1 text-3xl font-bold">${stageNiceLabel(stage)}</h2>
      <div id="stageEqLine" class="text-xs text-gray-600 mt-1">—</div>

      <div class="mt-4 space-y-1"> <div class="flex items-baseline gap-2">
          <span class="text-gray-600 text-xs md:text-sm">TL:</span>
          <span id="info-${stage}-tl" class="tabular-nums text-sm md:text-base font-medium">—</span>
        </div>
        <div class="flex items-baseline gap-2">
          <span class="text-gray-600 text-xs md:text-sm">Tidsstraff:</span>
          <span id="info-${stage}-pen" class="tabular-nums text-sm md:text-base font-medium">—</span>
        </div>
      </div>
    </div>

    <div class="min-w-0 w-full max-w-[400px] justify-self-end self-start">
  <div class="relative">
    <div id="timer-${stage}"
         class="text-3xl md:text-4xl font-bold tabular-nums text-right leading-none max-w-[220px] w-full ml-auto whitespace-nowrap cursor-pointer"
         title="Klicka för att ange manuell tid">
      00:00,00
    </div>
    
    <div id="manual-${stage}"
         class="hidden absolute right-0 mt-2 w-[320px] md:w-[360px] p-5 rounded-xl border bg-white shadow-2xl z-50">
      <label class="block text-base font-semibold mb-3">Manuell tid</label>
      <input id="manualDigits-${stage}" type="tel" inputmode="numeric"
             class="w-full text-4xl font-mono tracking-widest text-center px-4 py-4 border-2 border-gray-300 rounded-lg mb-4 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all"
             placeholder="mmsscc" maxlength="6" />
      <div class="flex gap-3">
        <button id="manualApply-${stage}"  class="flex-1 py-3 text-lg font-bold rounded-lg bg-emerald-600 text-white shadow-sm active:scale-95 transition-transform touch-manipulation">Använd</button>
        <button id="manualCancel-${stage}" class="flex-1 py-3 text-lg font-medium rounded-lg bg-gray-200 text-gray-800 active:scale-95 transition-transform touch-manipulation">Avbryt</button>
      </div>
    </div>
  </div>

  <div class="mt-4 flex items-center justify-between gap-2">
    <button id="btnStart-${stage}" class="flex-1 py-4 text-lg font-bold rounded-lg bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition-transform touch-manipulation">Start</button>
    <button id="btnStop-${stage}"  class="flex-1 py-4 text-lg font-bold rounded-lg bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:scale-95 transition-transform touch-manipulation">Mål</button>
    <button id="btnReset-${stage}" class="px-4 py-4 rounded-lg bg-gray-200 text-gray-800 font-medium active:scale-95 transition-transform touch-manipulation hover:bg-gray-300" title="Nollställ">
       <span class="sr-only">Nollställ</span> 🔄
    </button>
  </div>

  <div class="mt-2 grid grid-cols-2 gap-6 text-xs md:text-sm text-gray-600">
    <div class="text-right">
      <div>Start kl. <span class="text-gray-400 text-[10px]">✏️</span></div>
      <div id="startClock-${stage}" class="tabular-nums font-medium cursor-pointer hover:underline text-blue-700" title="Klicka för att ändra starttid (HHMMSS)">–</div>
    </div>
    <div class="text-right">
      <div>Mål kl. <span class="text-gray-400 text-[10px]">✏️</span></div>
      <div id="stopClock-${stage}" class="tabular-nums font-medium cursor-pointer hover:underline text-blue-700" title="Klicka för att ändra måltid (HHMMSS)">–</div>
    </div>
  </div>
</div>

  <div class="mt-6">
    <button type="button" class="toggle-btn comment-toggle-btn">💬 Kommentarer</button>
    <div class="comment-wrapper">
      <div class="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <label class="block text-sm text-gray-700 mb-1">Kommentar (start)</label>
          <textarea id="commentStart-${stage}" rows="3" class="w-full resize-y rounded-md border border-gray-300 px-3 py-2"></textarea>
        </div>
        <div>
          <label class="block text-sm text-gray-700 mb-1">Kommentar (mål)</label>
          <textarea id="commentStop-${stage}" rows="3" class="w-full resize-y rounded-md border border-gray-300 px-3 py-2"></textarea>
        </div>
      </div>
    </div>
  </div>

  ${stage === 'B' ? `
  <div class="mt-6 grid gap-4 md:grid-cols-2">
    <label class="flex items-center gap-3 p-3 border rounded-md h-full">
      <input id="bitOk" type="checkbox" class="h-5 w-5">
      <span>Bettkontroll OK</span>
    </label>
    <div>
      <label class="block text-sm text-gray-700 mb-1">Kommentar (Bett)</label>
      <textarea id="bitComment" rows="2" class="w-full resize-y rounded-md border border-gray-300 px-3 py-2"></textarea>
    </div>
  </div>
  ` : ``}

  <div class="mt-6 border-t pt-4">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
      
      <div>
        <label for="otherMarathonPenalty" class="block text-sm text-gray-700 mb-1">Övrigt straff (totalt)</label>
        <input type="number" id="otherMarathonPenalty" min="0" step="0.01" inputmode="decimal" class="w-full rounded-md border border-gray-300 px-3 py-2">
      </div>

      <label class="flex items-center gap-2 mb-2 cursor-pointer bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
         <input type="checkbox" id="manualEliminated" class="w-6 h-6 text-rose-600 rounded focus:ring-rose-500 border-gray-300">
         <span class="text-rose-700 font-bold text-sm">Manuell Eliminering</span>
      </label>
      
      <div class="flex items-center justify-end gap-2 md:col-span-2">
        <button id="btnSave-${stage}" class="flex-grow md:flex-grow-0 px-5 py-2.5 rounded-md bg-brand-darkblue text-white hover:bg-brand-gold hover:text-brand-darkblue">Spara</button>
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

  const key = `${sn}|${stage}`;
  const t = activeTimers.get(key);
  if (t) {
    const now = Date.now();
    const ms = t.isRunning ? (t.pausedMs + (now - t.startEpoch)) : t.pausedMs;
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
    card.className = 'rounded-lg border p-2 flex items-center justify-between';
    card.innerHTML = `
      <div class="text-sm">#${sn} • ${stage.toUpperCase()}</div>
      <div class="timer tabular-nums text-lg">00:00,00</div>
      <button class="stop px-2 py-1 text-xs rounded bg-rose-600 text-white">Stoppa</button>
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
      showAlert('Kunde inte spara manuell tid (behörighet/uppkoppling?).');
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
  timerEl.title = 'Klicka för att ange manuell tid';
  timerEl.addEventListener('click', open);
  cancelBtn.addEventListener('click', close);

  okBtn.addEventListener('click', async () => {
    if (!currentEquipage) { showAlert('Välj ekipage först.'); return; }

    const raw = inputEl.value;
    const ms = typeof digitsToMs === 'function'
      ? digitsToMs(raw)
      : (() => { const d = (raw || '').replace(/\D/g, '').slice(0, 6).padEnd(6, '0'); return ((+d.slice(0, 2)) * 60 + (+d.slice(2, 4))) * 1000 + (+d.slice(4, 6)) * 10; })();

    if (!Number.isFinite(ms) || ms < 0) {
      showAlert('Ogiltigt format. Ange mmsscc, t.ex. 13253 (= 13:25,3).');
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
    const now = Date.now();
    const payload = {
      durationMs: ms,
      startClock: new Date(now - ms).toISOString(),
      stopClock: new Date(now).toISOString(),
      commentStart: document.getElementById(`commentStart-${stage}`)?.value || '',
      commentStop: document.getElementById(`commentStop-${stage}`)?.value || '',
    };
    if (stage === 'B') {
      payload.bitCheckOk = !!document.getElementById('bitOk')?.checked;
      payload.bitCheckComment = document.getElementById('bitComment')?.value || '';
    }

    try { await saveStageSnapshot(stage, payload); }
    catch (e) { console.error(e); showAlert('Kunde inte spara manuell tid.'); }
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
        showAlert('Fel vid sparande av eliminering.');
        elimEl.checked = !val; // ångra
      }
    });
  }

  // NYTT: Koppla kommentarsknapp och textfält
  const commentBtn = document.querySelector('.comment-toggle-btn');
  commentBtn?.addEventListener('click', () => {
    const wrapper = document.querySelector('.comment-wrapper');
    wrapper?.classList.toggle('comment-visible');
    // Fokusera på första textrutan om vi öppnar
    if (wrapper?.classList.contains('comment-visible')) {
      wrapper.querySelector('textarea')?.focus();
    }
  });

  const updateBtn = () => {
    const csVal = document.getElementById(`commentStart-${stage}`)?.value || '';
    const ceVal = document.getElementById(`commentStop-${stage}`)?.value || '';
    let hasB = false;
    if (stage === 'B') {
      hasB = !!(document.getElementById('bitComment')?.value);
    }
    commentBtn?.classList.toggle('has-comment', csVal.length > 0 || ceVal.length > 0 || hasB);
  };
  document.getElementById(`commentStart-${stage}`)?.addEventListener('input', updateBtn);
  document.getElementById(`commentStop-${stage}`)?.addEventListener('input', updateBtn);
  if (stage === 'B') {
    document.getElementById('bitComment')?.addEventListener('input', updateBtn);
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

  const label = type === 'start' ? 'Starttiden' : 'Måltiden';

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

  const raw = prompt(`Ange ny ${label} (HHMMSS):`, defVal);
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
    showAlert('Ogiltigt format. Använd HHMMSS (t.ex. 120000 för 12:00:00).', false);
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
    const tStart = Date.parse(newStart);
    const tStop = Date.parse(newStop);
    if (Number.isFinite(tStart) && Number.isFinite(tStop)) {
      newDuration = Math.max(0, tStop - tStart);
    }
  }

  // Payload
  const payload = {};
  if (type === 'start') payload.startClock = newIso;
  else payload.stopClock = newIso;

  if (newDuration !== null) {
    payload.durationMs = newDuration;
  }

  // --- VALIDERING: Varning för framtida tid ---
  const diffFromNow = new Date(newIso).getTime() - Date.now();
  if (diffFromNow > 5 * 60_000) { // Mer än 5 minuter i framtiden
    if (!confirm('Varning: Den angivna tiden är mer än 5 minuter i framtiden. Vill du fortsätta?')) {
      return;
    }
  }

  // Om vi "öppnar" (tar bort start/stop) - stödjs ej via denna prompt just nu, 
  // vi förutsätter att man vill sätta en tid.

  try {
    await saveStageSnapshot(stage, payload);

    // Om vi ändrade starttider och påverkar duration => måste kanske synka activeTimers om den körs?
    // Enklast: Om vi sätter en manuell tid så betraktar vi den som "klar" eller "justerad".
    // Om duration sattes -> uppdatera local state
    if (newDuration !== null && activeTimers) {
      // Hitta timer
      const key = `${sn}|${stage}`;
      let tm = activeTimers.get(key);
      // Om vi har både start och mål är den per definition "klar" / stoppad
      if (newStart && newStop) {
        if (tm) {
          tm.isRunning = false;
          tm.pausedMs = newDuration;
        }
      }
    }

  } catch (err) {
    console.error(err);
    showAlert('Kunde inte uppdatera tid.', false);
  }
}


async function focusEquipageStage(sn, stage) {
  const eq = findEquipageBySn(sn);
  if (!eq) return;

  // välj ekipage
  currentEquipage = eq;
  if (typeof reflectDropdownSelection === 'function') reflectDropdownSelection(eq);
  // Uppdatera rubrik & “Välj ekipage”-info direkt
  updateEqInfo();
  const small = document.getElementById('infoLineSmall');
  if (small) {
    small.textContent = `Visar #${eq.startNumber} ${eq.driverName || ''} • Etapp: ${stageNiceLabel(stage || currentStage)}`;
  }

  // Byt flik/etapp program­matiskt (samma som i wireTabs())
  if (stage && stage !== currentStage) {
    currentStage = stage;
    // 1) Flik-stil
    highlightActiveTab();
    // 2) Etikett i headern
    const lab = document.getElementById('activeStageLabel');
    if (lab) lab.textContent = stageNiceLabel(stage);
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

  // scrolla till timern så man ser kommentarsfälten direkt under
  document.getElementById(`timer-${currentStage}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function populateStageUI(stage, data) {


  const st = data?.timing?.[stage] || {};
  const sc = document.getElementById(`startClock-${stage}`);
  const ec = document.getElementById(`stopClock-${stage}`);
  const cs = document.getElementById(`commentStart-${stage}`);
  const ce = document.getElementById(`commentStop-${stage}`);

  if (sc) sc.textContent = st.startClock ? new Date(st.startClock).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
  if (ec) ec.textContent = st.stopClock ? new Date(st.stopClock).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
  if (cs && typeof st.commentStart === 'string') cs.value = st.commentStart;
  if (ce && typeof st.commentStop === 'string') ce.value = st.commentStop;

  // NYTT: Uppdatera kommentarsknappen baserat på innehåll
  const commentBtn = document.querySelector('.comment-toggle-btn');
  if (commentBtn) {
    const hasComment = (st.commentStart || st.commentStop);
    commentBtn.classList.toggle('has-comment', !!hasComment);
  }

  const otherPenaltyEl = document.getElementById('otherMarathonPenalty');
  if (otherPenaltyEl && isNum(data?.otherPenalty)) otherPenaltyEl.value = data.otherPenalty;

  const elimEl = document.getElementById('manualEliminated');
  if (elimEl) {
    elimEl.checked = !!data.eliminated;
  }

  if (stage === 'B') {
    const bitOk = document.getElementById('bitOk');
    const bitC = document.getElementById('bitComment');
    if (bitOk && typeof st.bitCheckOk === 'boolean') bitOk.checked = !!st.bitCheckOk;
    if (bitC && typeof st.bitCheckComment === 'string') bitC.value = st.bitCheckComment;

    // NYTT: Inkludera bett-kommentar i 'has-comment'-checken
    if (commentBtn && st.bitCheckComment) {
      commentBtn.classList.add('has-comment');
    }
  }
}

// RAD EFTER (ca 1324): async function startStage(stage){

async function startStage(stage) {
  if (!currentEquipage) { showAlert('Välj ekipage först.', false); return; }
  const sn = String(currentEquipage.startNumber);
  const key = `${sn}|${stage}`;
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
      showAlert('Kunde inte återuppta (behörighet/uppkoppling?).', false);
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
    showAlert('Kunde inte spara start (behörighet/uppkoppling?).', false);
  }
}

async function stopStage(stage) {
  if (!currentEquipage) { showAlert('Välj ekipage först.', false); return; }
  const sn = String(currentEquipage.startNumber);
  const key = `${sn}|${stage}`;

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
    showAlert('Kunde inte spara mål (behörighet/uppkoppling?).', false);
    return; // Avbryt om det inte gick att spara
  }

  // VIKTIGT: Vi stannar kvar på sidan. Ingen automatisk navigering.
  showAlert(`Mål registrerat för etapp ${stageNiceLabel(stage)}.`, true);
  document.getElementById(`commentStop-${stage}`)?.focus(); // Sätt fokus på kommentarsfältet
}

// --- RESET (nollställer tid lokalt + i DB) ---
async function resetStage(stage) {
  if (!currentEquipage) return;
  if (!confirm(`Är du säker på att du vill nollställa ALLA tider och kommentarer för etapp ${stageNiceLabel(stage)}? Detta kan inte ångras.`)) return;

  const sn = String(currentEquipage.startNumber);
  const key = `${sn}|${stage}`;

  // 1. Stoppa och ta bort eventuell lokal timer
  if (activeTimers.has(key)) {
    activeTimers.delete(key);
    removeActiveCard(key);
    stopGlobalTickerIfIdle();
  }

  // 2. Skapa en payload som uttryckligen sätter ALLA relevanta fält till null
  const stageKey = stage.toUpperCase();
  const flatPrefix = stage === 'warmup' ? 'warmup' : (stage === 'transport' ? 'transfer' : stage);

  const payload = {
    runningStage: null,
    [`start_${stageKey}`]: null,
    [`start_${flatPrefix}`]: null,
    [`finish_${stageKey}`]: null,
    [`finish_${flatPrefix}`]: null,
    [`duration_${flatPrefix}_ms`]: null,
    [`commentStart_${flatPrefix}`]: '', // Sätt kommentarer till tom sträng
    [`commentStop_${flatPrefix}`]: '',
    // Inkludera B-specifika fält om det är etapp B
    ...(stage === 'B' ? { bitCheckOk: null, bettOk: null, bitCheckComment: null, bettComment: null } : {}),
    // NYTT: Rensa även de nästlade objekten där maratonUtils faktiskt läser
    [`timing.${stage}`]: deleteField(),
    [`stages.${stage}`]: deleteField()
  };

  // --- OPTIMISTISK UPPDATERING ---
  // 3. Uppdatera det lokala UI:t OMEDELBART
  if (currentDocData?.timing) {
    currentDocData.timing[stage] = {}; // Rensa lokalt också
  }
  populateStageUI(stage, currentDocData);
  updateTimerLabel(stage);
  renderActiveCards(); // Se till att listan "Aktiva" också uppdateras

  // 4. Spara den rensande payloaden till Firestore i bakgrunden
  try {
    // Använd setDoc utan merge för att garantera en fullständig överskrivning av dessa fält
    await setDoc(maratonDocRef(sn), payload, { merge: true });
  } catch (err) {
    console.error(err);
    showAlert('Kunde inte nollställa i databasen.', false);
    return;
  }

  showAlert(`Etapp ${stageNiceLabel(stage)} har nollställts.`, true);
}

async function saveCurrentStage(stage) {
  if (!currentEquipage) { showAlert('Välj ekipage först.', false); return; }

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
        showAlert('Ogiltigt värde i Övrigt straff.', false);
      } else {
        let safe = num;
        if (safe < 0) {
          safe = 0;
          el.value = '0';
          showAlert('Negativa straff tillåts inte. Värdet sattes till 0.', false);
        }
        // Viktigt: spara även 0 (tidigare försvann 0 p.g.a. `|| null`)
        await setDoc(maratonDocRef(currentEquipage.startNumber), {
          otherPenalty: safe
        }, { merge: true });
      }
    }
  }

  showAlert('Sparat.', true);
}


async function finalizeMarathon() {
  if (!currentEquipage) { showAlert('Välj ekipage först.', false); return; }

  // Spara först eventuella osaprade ändringar
  await saveCurrentStage('B');

  if (confirm(`Är du säker på att du vill finalisera maraton för #${currentEquipage.startNumber}? Detta markerar resultatet som slutgiltigt.`)) {
    try {
      await setDoc(maratonDocRef(currentEquipage.startNumber), {
        finalized: true,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showAlert(`Maraton har finaliserats för #${currentEquipage.startNumber}.`);
    } catch (err) {
      showAlert('Kunde inte finalisera.', false);
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
      if (lab) lab.textContent = stageNiceLabel(s);
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
    if (root) root.innerHTML = '<p class="p-8 text-center text-gray-600">Ingen tävling vald.</p>';
    return;
  }

  // 1. Rendera grundlayouten först så att alla HTML-element finns på plats
  renderLayout();
  // 1b. Knyt flikarnas klick-hanterare
  wireTabs();

  // 2. Hämta all nödvändig data från databasen parallellt
  const [listRaw, configDataSwe, configDataEng, startTimesData] = await Promise.all([
    getEquipages(competitionId),
    getConfig(competitionId, 'maratonConfig').catch(() => null),
    getConfig(competitionId, 'marathonConfig').catch(() => null),
    getConfig(competitionId, 'startTimes').catch(() => null)
  ]);

  // 3. Bearbeta och lagra datan i programmets minne
  // Fallback: använd svensk config om den finns, annars engelsk
  maratonConfig = configDataSwe || configDataEng;

  // Pass config to utils immediately to ensure calculations work!
  setMarathonConfig(maratonConfig);

  // ===== VIKTIG FELSÖKNINGSRAD! =====
  console.log("Maraton Config Inläst (Swe):", configDataSwe);
  console.log("Maraton Config Inläst (Eng):", configDataEng);
  console.log("Vald Config:", maratonConfig);

  startTimes = startTimesData?.times || {};
  equipages = (listRaw || []).map(normalizeEquipage);
  orderByMarathonStart = [...equipages].sort((a, b) => {
    const ta_str = startTimes[String(a.startNumber)]?.marathon;
    const tb_str = startTimes[String(b.startNumber)]?.marathon;
    if (ta_str && tb_str) return new Date(ta_str) - new Date(tb_str);
    return (a.startNumber || 0) - (b.startNumber || 0);
  });

  // 4. Initiera UI-komponenter NU när datan finns (ÅTERSTÄLLER DROPDOWN)
  const ddHost = document.getElementById('equipageDropdown');
  if (ddHost) {
    dropdown = createSearchableDropdown(ddHost, equipages, onEquipageSelected);
  } else {
    console.error("Kunde inte hitta #equipageDropdown i DOM.");
  }

  // 5. Koppla alla event-lyssnare
  wireEventListeners();
  wireKeyboardShortcuts();

  // 6. Starta de globala Firestore-lyssnarna
  subscribeAllActiveTimers();
  listenForGlobalCompetitionPause();
}
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
  unsubAllA = unsubAllB = unsubAllC = unsubAllD = null;

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
  const stopIso = new Date().toISOString();
  const startIso = new Date(Date.now() - ms).toISOString();

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
    el.title = 'Dubbelklicka för att mata in tid manuellt (mm:ss,cc)';
    el.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      const currentTxt = (el.textContent || '').trim();
      const inp = prompt(`Manuell tid för ${k} (mm:ss,cc eller mmsscc):`, currentTxt);
      if (inp == null) return;
      await applyManualStageTime(k, ms);
    });
  });
}

// kör när DOM finns
document.addEventListener('DOMContentLoaded', wireManualStageEditors);
