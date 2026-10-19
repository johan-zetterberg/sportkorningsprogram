import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { listenForMarathonObstacles } from '../../services/marathonService.js';
import { getMarathonStateDocuments } from '../../services/marathonService.js';
import { trackWrite } from '../../services/firestoreService.js';
import { getStartTimes, saveMarathonObstacleResult, listenForMaratonCollection } from '../../services/marathonService.js';
import {
  setPauseWindows,
  pausedMsBetween,
  calculateObstacleResult,
  getObstacleMaxTime,
  getClassDrivenObstacles,
  setMarathonConfig,
  shouldShowObstacleKnockdowns,
} from '../../utils/marathonUtils.js';
import { getCompetitionHeader, renderCompetitionModeBanner, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { registerUnsavedWork } from '../../utils/unsavedWork.js';
import { downloadJson, escapeHtml } from '../../utils/sharedUtils.js';
import { releaseWakeLock, requestWakeLock } from '../../utils/wakeLock.js';
import { serverNow, startServerClockSync, stopServerClockSync, setServerClockHold, isServerClockSynced } from '../../utils/serverClock.js';
import { readNewestBackupData, writeMergedBackup, pruneFieldBackups } from '../../utils/fieldBackup.js';
import { queuedNotice } from '../../utils/offlineWrite.js';
import { reportRejectedWrite } from '../../services/rejectedWritesService.js';
import { obstacleLiveEntry, mergeMarathonObstacles, MARATHON_LIVE_DEFAULTS } from '../../core-engine/stateSelector.js';
import {
  markObstacleUpdateInProgress,
  obstacleElapsedMs,
  shouldResumeAfterGlobalPause,
  lastClosedPauseEndMs,
  obstacleSeedFields,
  obstacleFormState,
  obstacleLiveWrite,
  obstaclesRunningElsewhere,
  parseHoldMinutes,
  formatHoldTime,
  obstaclePageHasUnsavedWork
} from './marathonObstacleOwnership.js';

// Firestore för live (endast det vi använder på denna sida)
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot, Timestamp, collection, query, where, getDocs, limit, FieldPath }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';


// --- Lokal state och hjälpfunktioner för modulen ---
let competitionId = null;
let sortedEquipages = [];
let equipageSearchDropdownMar = null;
let marathonConfigCache = null;     // för att veta hur många portar klassen har
let unsubObstacles = null;   // återkallare för lyssnaren
let boundHandlers = {};      // samlar på oss event-handlers att kunna ta bort
let unsubGlobalPause = null;
let obstacleList = []; // Sparar listan med hinderkonfiguration
let marathonStateDocsMap = new Map();
let currentStartTimesData = null;
let isGloballyPaused = false;
let globalPauseStartTime = 0;

function isFieldModeEnabled() {
  return getGlobalState('currentCompetition')?.competitionMode === 'field';
}

// Every page stays in the DOM: lookups are scoped to this page's container,
// so an element with the same id on another page (dressyr-input) is never hit
const pageRoot = () => document.getElementById('page-maraton-input');
const byId = (id) => pageRoot()?.querySelector(`#${CSS.escape(id)}`) || null;
const pageQuery = (selector) => pageRoot()?.querySelector(selector) || null;
const pageQueryAll = (selector) => Array.from(pageRoot()?.querySelectorAll(selector) || []);

// ---- LIVE state (återanvänder precisionens modell) ----
let currentEquipage = null;
let timerInterval = null;
let currentObstacleNumber = null; // vilken hinderpost vi mäter live på just nu

// ---- Tidshjälpare (kopierat från precision) ----
let pendingLiveComment = null;
let liveCommentSaveTimer = null;

const LIVE_COMMENT_SAVE_DEBOUNCE_MS = 500;

function clearLiveCommentSaveTimer() {
  if (liveCommentSaveTimer) {
    clearTimeout(liveCommentSaveTimer);
    liveCommentSaveTimer = null;
  }
}

// Form fields (knockdowns, penalty, hold time, eliminated) are sent together
// after a short pause in typing: each write wakes every spectator
const FORM_FIELD_PUSH_DEBOUNCE_MS = 500;
let pendingFormFields = null;
let pendingFormTarget = null;
let formFieldPushTimer = null;

function cancelPendingFormFields() {
  if (formFieldPushTimer) {
    clearTimeout(formFieldPushTimer);
    formFieldPushTimer = null;
  }
  pendingFormFields = null;
  pendingFormTarget = null;
}

async function flushPendingFormFields() {
  const fields = pendingFormFields;
  const target = pendingFormTarget;
  cancelPendingFormFields();
  const eq = target?.equipage || currentEquipage;
  const obsNo = target?.obstacleNumber ?? currentObstacleNumber;
  if (!fields || !eq || obsNo == null) return;
  // Queued at once for this equipage, not awaited: a write resolves only when
  // the server answers, and Save or a switch must not wait for that offline
  // (Firestore keeps the order of writes)
  pushLiveSafe(fields, { equipage: eq, obstacleNumber: obsNo }).catch((error) => console.error('Kunde inte skicka hinderformuläret live:', error));
}

function cancelPendingLiveCommentSave() {
  clearLiveCommentSaveTimer();
  pendingLiveComment = null;
  cancelPendingFormFields();
}

// Sends everything typed but not yet sent (before switching equipage or saving)
async function flushPendingLiveComment() {
  clearLiveCommentSaveTimer();
  await flushPendingFormFields();
  if (pendingLiveComment == null) return;

  const valueToSave = pendingLiveComment;
  pendingLiveComment = null;

  if (!currentEquipage || currentObstacleNumber == null) return;
  if ((currentLiveState?.live_comment || '') === valueToSave) return;

  // Queued, not awaited (see flushPendingFormFields)
  pushLiveSafe({ live_comment: valueToSave }).catch((error) => console.error('Kunde inte spara hinderkommentar live:', error));
}

function scheduleLiveCommentSave(value) {
  pendingLiveComment = value;
  clearLiveCommentSaveTimer();
  liveCommentSaveTimer = setTimeout(() => {
    flushPendingLiveComment().catch((error) => {
      console.error('Kunde inte spara hinderkommentar live:', error);
    });
  }, LIVE_COMMENT_SAVE_DEBOUNCE_MS);
}

const pad2 = (n) => String(n).padStart(2, '0');
// Server time: the global pause log is stamped in it, so clock stamps must be too
const nowMs = () => serverNow();
function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string' || value instanceof Date) {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  // A Timestamp restored from the local backup is a plain { seconds, nanoseconds }
  if (typeof value === 'object' && Number.isFinite(value.seconds)) {
    return value.seconds * 1000 + Math.floor((Number(value.nanoseconds) || 0) / 1e6);
  }
  const ms = Number(value);
  return Number.isFinite(ms) ? ms : 0;
}
function msToParts(ms) {
  const t = Math.max(0, Math.floor(ms || 0));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return { m, s, cs };
}
function partsToString({ m, s, cs }) { return `${pad2(m)}:${pad2(s)},${pad2(cs)}`; }
// Mirror data to localStorage for redundancy
function marathonBackupKey(sn) {
  if (!competitionId || !sn) return null;
  return `bkp_${competitionId}_mar_${sn}`;
}

function readMarathonBackup(sn) {
  return readNewestBackupData([marathonBackupKey(sn)]);
}

function mirrorToLocal(sn, data) {
  if (!sn || !data) return;
  try {
    writeMergedBackup(marathonBackupKey(sn), data);
  } catch (e) {
    console.warn('Could not mirror to localStorage', e);
  }
}

function getElapsedMsFromState(state) {
  if (!state) return 0;
  // The state is this obstacle's own (obstacleLive.{n}): another obstacle's
  // clock is never shown here
  const accumulated = state.liveObstacleTimeMs || 0;
  // Klockan går: ackumulerad tid + tid sedan senaste start. A global pause
  // this device never saw (offline while it began and ended) lies inside the
  // running segment: it must not count. A pause it did see ended the segment
  // at its start, so nothing is taken twice.
  const tickNow = isGloballyPaused && globalPauseStartTime > 0 ? globalPauseStartTime : nowMs();
  return obstacleElapsedMs({
    accumulatedMs: accumulated,
    running: state.running === true,
    startMs: timestampToMs(state.liveObstacleStartAt)
  }, tickNow, (a, b) => pausedMsBetween(a, b, nowMs()));
}

function normalizeEquipage(e) {
  const startNumber =
    Number(e?.startNumber ?? e?.startnr ?? e?.nr ?? e?.start ?? e?.startNo ?? e?.bib ?? 0);

  const driverName =
    e?.driverName ?? e?.driver ?? e?.name ?? e?.kusk ?? '';

  const className =
    e?.className ?? e?.class ?? e?.klass ?? '';

  const trackWidth =
    Number(e?.trackWidth ?? e?.trackWidthCm ?? e?.vagnbredd ?? e?.spannvidd ?? NaN);

  return {
    ...e, // behåll övriga fält orörda
    startNumber,
    driverName,
    className,
    trackWidth: Number.isFinite(trackWidth) ? trackWidth : null
  };
}
// ==== LIVE-cache för resultatvyn ====
const marathonMap = new Map();

// Formatter för mm:ss,cc i resultatlistan
function fmtMs(ms) {
  const t = Math.max(0, Number(ms) || 0);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(m)}:${pad2(s)},${pad2(cs)}`;
}
function digitsToMs(d) {
  const s = (d || "").replace(/\D/g, '').slice(0, 6).padEnd(6, '0');
  const mm = +s.slice(0, 2), ss = +s.slice(2, 4), cs = +s.slice(4, 6);
  return (mm * 60 + ss) * 1000 + cs * 10;
}
// A typed time ("mmsscc" or "mm:ss,cc") → ms, or null when it is empty, zero
// or not a time (seconds ≥ 60)
function parseManualTimeMs(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let mm, ss, cs;
  const sep = s.match(/^(\d{1,2})[:.](\d{1,2})(?:[,.](\d{1,2}))?$/);
  if (sep) {
    mm = +sep[1]; ss = +sep[2]; cs = sep[3] ? +sep[3].padEnd(2, '0') : 0;
  } else if (/^\d{1,6}$/.test(s)) {
    const d = s.padEnd(6, '0');
    mm = +d.slice(0, 2); ss = +d.slice(2, 4); cs = +d.slice(4, 6);
  } else {
    return null;
  }
  if (ss >= 60) return null;
  const ms = (mm * 60 + ss) * 1000 + cs * 10;
  return ms > 0 ? ms : null;
}

// NY FUNKTION FÖR ATT HANTERA GLOBAL PAUS
function syncGlobalPauseUiState() {
  const lockTiming = isGloballyPaused === true;
  [
    'btnStartMar',
    'btnStopMar',
    'btnResetMar',
    'btnManualApplyMar',
    'maratonObstacleSelect',
    'routeUndo',
    'routeClear',
    'maratonKnockdowns',
    'maratonPenalty',
    'maratonHoldTime',
    'maratonEliminated',
    'maratonComment'
  ].forEach((id) => {
    const el = byId(id);
    if (!el) return;
    el.disabled = lockTiming;
    el.classList.toggle('opacity-50', lockTiming);
    el.classList.toggle('cursor-not-allowed', lockTiming);
  });

  const timerEl = byId('liveTimerMar');
  if (timerEl) {
    timerEl.classList.toggle('pointer-events-none', lockTiming);
    timerEl.classList.toggle('opacity-70', lockTiming);
    timerEl.title = lockTiming ? 'Global paus aktiv' : 'Ändra tid';
  }

  const saveBtn = pageQuery('#addMaratonResultForm button[type="submit"]');
  if (saveBtn) {
    saveBtn.disabled = lockTiming;
    saveBtn.classList.toggle('opacity-50', lockTiming);
    saveBtn.classList.toggle('cursor-not-allowed', lockTiming);
  }

  const routeButtons = byId('routeButtons');
  if (routeButtons) {
    routeButtons.classList.toggle('pointer-events-none', lockTiming);
    routeButtons.classList.toggle('opacity-60', lockTiming);
  }
}

// The pause status is known only after the first globalStatus snapshot: before
// it a clock stopped by the pause must not be resumed (the pause may still run)
let globalPauseStatusKnown = false;
let lastPauseLog = [];

// Resumes this obstacle's clock when the global pause stopped it and the pause
// is over. Called when the pause is lifted and when the document is shown
// (reload or re-select after the pause ended: the lift was not seen then)
function resumeClockAfterGlobalPauseIfStopped() {
  if (!shouldResumeAfterGlobalPause(currentLiveState, {
    obstacleNumber: currentObstacleNumber,
    isPaused: isGloballyPaused,
    pauseStatusKnown: globalPauseStatusKnown
  })) return false;
  // Resumed from the moment the pause ended (from the log), not when this
  // snapshot arrived: every device at the obstacle writes the same stamp.
  // Not a server timestamp: it reads as empty until the server answers.
  const resumedAt = Timestamp.fromMillis(lastClosedPauseEndMs(lastPauseLog, nowMs()));
  currentLiveState = { ...currentLiveState, running: true, liveObstacleStartAt: resumedAt, pausedByGlobalPause: false };
  pushLiveSafe({
    running: true,
    liveObstacleStartAt: resumedAt,
    pausedByGlobalPause: false
  });
  if (!timerInterval) timerInterval = setInterval(updateTimerViewMar, 90);
  updateTimerViewMar();
  return true;
}

function listenForGlobalCompetitionPause_Obstacles() {
  if (!competitionId || !appId) return;
  const statusRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus');
  let lastPauseState = false;
  return onSnapshot(statusRef, (docSnap) => {
    const data = docSnap.exists() ? (docSnap.data() || {}) : {};
    const isPaused = data.isPaused === true;
    const pauseLog = Array.isArray(data.pauseLog) ? data.pauseLog : [];
    const openPause = pauseLog.find(p => p && p.end == null);

    setPauseWindows(pauseLog);
    lastPauseLog = pauseLog;
    globalPauseStatusKnown = true;
    isGloballyPaused = isPaused;
    globalPauseStartTime = isPaused
      ? (openPause?.start ? new Date(openPause.start).getTime() : nowMs())
      : 0;
    syncGlobalPauseUiState();

    // Only the obstacle whose clock it is pauses and resumes it: another
    // device viewing the equipage (another obstacle, or none chosen) would
    // otherwise take the clock over and the real judge's Stop did nothing
    const ownsClock = currentObstacleNumber != null
      && Number(currentLiveState?.currentObstacle) === Number(currentObstacleNumber);

    if (isPaused && !lastPauseState) {
      // TÄVLINGEN PAUSAS NU

      if (timerInterval) clearInterval(timerInterval);
      timerInterval = null;

      // Pausa den pågående mätningen i Firestore
      if (currentLiveState.running && ownsClock) {
        const pausedTime = getElapsedMsFromState(currentLiveState);
        currentLiveState = {
          ...currentLiveState,
          running: false,
          liveObstacleTimeMs: pausedTime,
          liveObstacleStartAt: null,
          pausedByGlobalPause: true
        };
        updateTimerViewMar();
        pushLiveSafe({
          running: false, // Markera som pausad
          liveObstacleTimeMs: pausedTime, // Spara ackumulerad tid
          liveObstacleStartAt: null,
          // Tells a clock stopped by the pause from one the judge stopped
          pausedByGlobalPause: true
        });
      } else {
        updateTimerViewMar();
      }
      document.body.style.filter = 'grayscale(80%)';

    } else if (!isPaused) {
      // TÄVLINGEN ÅTERUPPTAS NU (or this device opened after the pause ended)

      // Återuppta mätningen i Firestore: only a clock the pause stopped, not a
      // time the judge stopped before the pause and has not saved yet
      if (ownsClock) resumeClockAfterGlobalPauseIfStopped();
      if (lastPauseState) document.body.style.filter = '';
    }
    lastPauseState = isPaused;
  });
}

// UPPDATERAD MED BÄTTRE LOGIK OCH KOMMENTARER ENLIGT TR
function validateRouteString(routeStr, expectedGates) {
  const tokens = (routeStr || '').trim().split(/\s+/).filter(Boolean);

  // Om ingen väg angetts
  if (tokens.length === 0) {
    return { styledHtml: `<span class="text-gray-400 dark:text-gray-500">${t('marathon_waiting_first_gate')}</span>`, isElimination: false, reason: t('marathon_enter_route') };
  }

  let expectedIdx = 0;
  let isElimination = false;
  let reason = '';
  const styledTokens = [];
  const passedRequiredGates = new Set();
  let firstErrorFound = false;

  // The route comes from the shared document (any marathon official can write
  // it): every token is escaped before it becomes HTML
  for (const token of tokens) {
    const isUppercase = token === token.toUpperCase() && token !== token.toLowerCase();
    const ucToken = token.toUpperCase();

    // Om vi redan har hittat ett fel, markera resten av portarna som en del av felkörningen
    if (firstErrorFound) {
      styledTokens.push(`<span class="text-red-600 dark:text-red-400">${escapeHtml(token)}</span>`);
      continue;
    }

    // 1. Korrekt port i sekvensen
    if (isUppercase && ucToken === expectedGates[expectedIdx]) {
      styledTokens.push(`<strong class="text-green-600 dark:text-green-400">${escapeHtml(token)}</strong>`);
      passedRequiredGates.add(ucToken);
      expectedIdx++;
    }
    // 2. Tillåten passage genom en redan avklarad ("död") port
    else if (passedRequiredGates.has(ucToken)) {
      styledTokens.push(`<span class="text-brand-lightblue dark:text-blue-300 underline">${escapeHtml(token)}</span>`); // Blå för tydlighet
    }
    // 3. Felkörning! Detta är första felet.
    else {
      styledTokens.push(`<strong class="text-red-600 dark:text-red-400">${escapeHtml(token)}</strong>`);
      reason = t('marathon_wrong_gate').replace('{expected}', expectedGates[expectedIdx]).replace('{actual}', token);
      firstErrorFound = true;
      // Notera: Vi sätter INTE isElimination här, då felet kan korrigeras.
    }
  }

  // Slutkontroll efter att ha gått igenom alla tokens
  if (!firstErrorFound) {
    // Om alla förväntade portar är tagna och inget fel hittades
    if (expectedIdx === expectedGates.length) {
      reason = t('marathon_route_correct');
    } else {
      // Om vägen är korrekt hittills, men inte komplett
      reason = t('marathon_route_correct_so_far').replace('{expected}', expectedGates[expectedIdx]);
    }
  }

  // Om hela vägen har angetts men inte alla portar är med i rätt ordning, DÅ är det eliminering.
  // Detta är domarens slutgiltiga bedömning, men koden kan flagga det som troligt.
  // För att vara säker sätter vi bara eliminering om den sparas i ofullständigt skick.
  if (firstErrorFound) {
    isElimination = true; // En okorrigerad felkörning leder till eliminering
    reason += t('marathon_route_ended_uncorrected');
  } else if (expectedIdx < expectedGates.length) {
    // Om vägen är slut men inte alla portar har passerats
    isElimination = true;
    reason = t('marathon_route_incomplete').replace('{expected}', expectedGates[expectedIdx]);
  }


  return {
    styledHtml: styledTokens.join(' '),
    isElimination: isElimination,
    reason: reason
  };
}

// ---- NYTT: Realtidslyssnare och State Management ----
let unsubMaratonDoc = null; // Håller koll på vår Firestore-lyssnare

// Denna funktion anropas varje gång datan i Firestore ändras för det valda ekipaget
// GLOBALA VARIABLER: Se till att du har dessa högst upp i filen.
let currentLiveState = {}; // Håller alltid den senaste datan från Firestore

// RAD FÖRE (ca 298): let currentLiveState = {}; // Håller alltid den senaste datan från Firestore

// The form and clock of one obstacle from the equipage's document: its own
// live entry (obstacleLive.{n}) while that holds work, else the saved result.
// Another obstacle's clock or form on the same document is never used here.
function deriveObstacleState(data, obstacleNo) {
  const obstacles = mergeMarathonObstacles(data || {});
  const entry = obstacleLiveEntry(data || {}, obstacleNo);
  const saved = obstacleNo != null ? obstacles.find(o => Number(o?.number) === Number(obstacleNo)) : null;
  const pendingHere = pendingFormFields && pendingFormTarget
    && String(pendingFormTarget.equipage?.startNumber) === String(data?.startNumber ?? currentEquipage?.startNumber)
    && Number(pendingFormTarget.obstacleNumber) === Number(obstacleNo);
  return {
    startNumber: data?.startNumber ?? currentEquipage?.startNumber ?? null,
    className: data?.className ?? currentEquipage?.className ?? '',
    obstacles,
    currentObstacle: obstacleNo,
    ...obstacleFormState(entry, saved),
    // Typed but not yet sent wins over the server copy
    ...(pendingHere ? pendingFormFields : {})
  };
}

function applyLiveStateToUI(data) {
  if (!data || !currentEquipage) {
    renderLiveState(null);
    return;
  }
  // 1. Synka valt hinder (behåll domarens valda hinder om ett redan är valt)
  const obstacleSelect = byId('maratonObstacleSelect');
  const selectedObsNo = Number(obstacleSelect?.value || 0) || null;
  const obstacleNo = selectedObsNo || null;
  currentObstacleNumber = obstacleNo;
  renderLiveState(deriveObstacleState(data, obstacleNo));
}

// Shows a state of this obstacle (from the document or an optimistic change)
function renderLiveState(state) {
  const commentInput = byId('maratonComment');
  const commentBtn = pageQuery('.comment-toggle-btn');

  if (!state || !currentEquipage) {
    // Om inget ekipage är valt eller data är tom, återställ allt
    cancelPendingLiveCommentSave();
    currentLiveState = {};
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    updateServerClockHold();
    const route = byId('routeString');
    if (route) route.value = '';
    const kd = byId('maratonKnockdowns');
    if (kd) kd.value = '0';
    const pen = byId('maratonPenalty');
    if (pen) pen.value = '0';
    const hold = byId('maratonHoldTime');
    if (hold) hold.value = '';
    if (commentInput) commentInput.value = '';
    if (commentBtn) commentBtn.classList.remove('has-comment');
    const elim = byId('maratonEliminated');
    if (elim) elim.checked = false;
    pageQueryAll('#liveTimerMar').forEach(out => { out.textContent = '00:00,00'; });
    updateHeaderInfoMar();
    renderRoutePreview();
    updateTotalPenaltyDisplay();
    return;
  }

  currentLiveState = state;
  const effective = state;

  // A clock the global pause stopped, shown after the pause has ended (reload
  // or re-select): resume it, the pause listener saw no lift on this load
  resumeClockAfterGlobalPauseIfStopped();

  // 2. Synka Timern
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  if (currentLiveState.running && !isGloballyPaused) {
    // Starta en lokal renderingsloop BARA för att uppdatera texten på skärmen
    timerInterval = setInterval(updateTimerViewMar, 90);
  }
  updateServerClockHold();
  updateTimerViewMar(); // Kör en gång direkt för att visa korrekt tid

  // 3. Synka alla andra formulärfält
  const pendingHold = pendingHoldTimes.get(String(currentEquipage?.startNumber));
  // Not while the judge is typing in the hold time or the comment: the value
  // would be taken (and announced) but never reach the field. It is picked up
  // when the field is left (see the focusout re-apply below).
  const holdFieldBusy = ['maratonHoldTime', 'maratonComment'].includes(document.activeElement?.id);
  if (pendingHold && !holdFieldBusy && currentObstacleNumber != null && !parseHoldMinutes(effective.live_holdTimeSec)) {
    const holdText = formatHoldTime(pendingHold.holdTimeSec);
    const holdNote = `Väntetid: ${pendingHold.reason}`;
    const comment = effective.live_comment ? `${effective.live_comment}, ${holdNote}` : holdNote;
    currentLiveState = { ...currentLiveState, live_holdTimeSec: holdText, live_comment: comment };
    pendingHoldTimes.delete(String(currentEquipage.startNumber));
    persistPendingHoldTimes();
    renderWaitingList();
    // Stored on this obstacle at once (it was only on this device)
    pushFormField('live_holdTimeSec', holdText);
    scheduleLiveCommentSave(comment);
    showAlert(`Väntetid (${holdText} min) hämtad för startnr ${currentEquipage.startNumber}!`, true);
  }
  const shown = currentLiveState;

  const routeEl = byId('routeString');
  const kdEl = byId('maratonKnockdowns');
  const penEl = byId('maratonPenalty');
  const holdEl = byId('maratonHoldTime');
  if (routeEl && document.activeElement !== routeEl) routeEl.value = shown.live_routeString || '';
  if (kdEl && document.activeElement !== kdEl) kdEl.value = String(shown.live_knockdowns ?? '0');
  if (penEl && document.activeElement !== penEl) penEl.value = String(shown.live_otherPenalty ?? '0');
  if (holdEl && document.activeElement !== holdEl) holdEl.value = String(shown.live_holdTimeSec ?? '');
  if (commentInput && document.activeElement !== commentInput && pendingLiveComment == null) {
    commentInput.value = shown.live_comment || '';
  }
  if (commentBtn) commentBtn.classList.toggle('has-comment', !!(commentInput?.value || shown.live_comment || ''));
  const elimEl = byId('maratonEliminated');
  if (elimEl) elimEl.checked = !!shown.live_eliminated;

  renderRoutePreview();
  updateTotalPenaltyDisplay();
  updateHeaderInfoMar();
}

// Hold the server-clock offset while this obstacle's clock runs on this
// device: start and stop must be stamped with the same correction
function updateServerClockHold() {
  setServerClockHold(currentLiveState?.running === true);
}

// RAD EFTER (ca 369): // Nollställer endast formuläret lokalt vid kontextbyte (nytt ekipage/hinder)

// Nollställer endast formuläret lokalt vid kontextbyte (nytt ekipage/hinder)
// – INGEN skrivning till Firestore.
function resetFormLocallyForContextSwitch() {
  // Timeretikett(er)
  pageQueryAll('#liveTimerMar').forEach(out => { out.textContent = '00:00,00'; });

  // Fält
  const sel = byId('maratonObstacleSelect');
  if (sel) sel.value = '';
  const route = byId('routeString');
  if (route) route.value = '';

  const kd = byId('maratonKnockdowns');
  if (kd) kd.value = '0';

  const other = byId('maratonPenalty');
  if (other) other.value = '0';

  const hold = byId('maratonHoldTime');
  if (hold) hold.value = '';

  const cmt = byId('maratonComment');
  if (cmt) cmt.value = '';

  const elim = byId('maratonEliminated');
  if (elim) { elim.checked = false; elim.disabled = false; }

  // UI-uppdateringar
  updateKnockdownVisibility();
  renderRouteButtonsForCurrent();
  renderRoutePreview();
  updateTotalPenaltyDisplay();
  updateHeaderInfoMar();
}


// The last state from the server: a field that had focus kept its value then,
// so it is applied again when the judge leaves the field
let lastRemoteLiveData = null;
function reapplyRemoteStateAfterEdit() {
  setTimeout(() => {
    if (!lastRemoteLiveData || !currentEquipage) return;
    if (lastRemoteLiveData.startNumber !== String(currentEquipage.startNumber)) return;
    applyLiveStateToUI(lastRemoteLiveData.data);
  }, 0);
}

// Startar och stoppar lyssnaren
function subscribeToMarathonDoc(startNumber) {
  if (unsubMaratonDoc) unsubMaratonDoc(); // Stäng tidigare lyssnare

  const docRef = marathonDocRef(startNumber);
  // The sync indicator follows the writes themselves (trackWrite), not this
  // one document's pending state
  unsubMaratonDoc = onSnapshot(docRef, (snap) => {
    // Pending server timestamps as estimates (not empty) until the server answers
    const data = snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : readMarathonBackup(startNumber);
    if (snap.exists() && data) mirrorToLocal(startNumber, data); // Backuppa lokalt
    lastRemoteLiveData = { startNumber: String(startNumber), data };
    applyLiveStateToUI(data);
  }, (error) => {
    console.error("Fel vid lyssning på maratondokument:", error);
    applyLiveStateToUI(readMarathonBackup(startNumber));
  });
}

// ---- Firestore doc för live maraton (en per ekipage) ----
function marathonDocRef(startNumber) {
  return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`, String(startNumber));
}

// Tidsstämplar för in- och utpassage i obstacleTimes.{number} på /maraton/{sn}.
// Kartan slås ihop per nyckel (merge): ett hinder rör aldrig ett annat hinders.
function upsertObstacleTimestamp(equipageId, obstacleNumber, patch) {
  const summaryDocRef = marathonDocRef(equipageId);
  const key = String(Number(obstacleNumber)); // map-nyckel måste vara sträng
  const entry = {};
  if (patch?.enteredAtClient) {
    entry.enteredAt = serverTimestamp();
    entry.enteredAtClient = patch.enteredAtClient;
  }
  if (patch?.exitAtClient) {
    entry.exitAt = serverTimestamp();
    entry.exitAtClient = patch.exitAtClient;
  }
  // Not awaited to the server by the caller's flow: queued without signal
  return trackWrite('Stämplar hinderpassage', setDoc(summaryDocRef, { obstacleTimes: { [key]: entry } }, { merge: true }));
}

function markObstacleEntered(equipageId, obstacleNumber) {
  return upsertObstacleTimestamp(equipageId, obstacleNumber, {
    enteredAtClient: new Date(serverNow()).toISOString()
  });
}

function markObstacleExit(equipageId, obstacleNumber) {
  return upsertObstacleTimestamp(equipageId, obstacleNumber, {
    exitAtClient: new Date(serverNow()).toISOString()
  });
}

// The equipage's document as last seen here (for the obstacle being shown)
function lastSeenDocFor(equipage) {
  return equipage && lastRemoteLiveData && lastRemoteLiveData.startNumber === String(equipage.startNumber)
    ? lastRemoteLiveData.data
    : null;
}

// Writes a live change of one obstacle: only its own entry obstacleLive.{n}
async function pushLiveSafe(update, target = null) {
  const eq = target?.equipage || currentEquipage;
  const obsNo = target?.obstacleNumber !== undefined ? target.obstacleNumber : currentObstacleNumber;
  // Skriv bara live när ett ekipage och ett hinder är valt
  if (!eq || obsNo == null) return;
  const sameView = String(currentLiveState?.startNumber ?? eq.startNumber) === String(eq.startNumber)
    && Number(obsNo) === Number(currentObstacleNumber);

  // Loading a saved result sends nothing. Any edit of its live fields turns
  // it into unsaved work at this obstacle
  const effectiveUpdate = markObstacleUpdateInProgress(update);

  // The entry holds no work yet (none, or cleared by a save): the form shows
  // the saved result or zeros, which go with the edit, else the next snapshot
  // and Save would use the entry's empty values (read before any await)
  const makesWork = effectiveUpdate.inProgress === true || effectiveUpdate.running === true;
  const seed = sameView && makesWork
    ? obstacleSeedFields(obstacleLiveEntry(lastSeenDocFor(eq) || {}, obsNo), currentLiveState)
    : null;
  if (sameView && effectiveUpdate.inProgress === true) {
    currentLiveState = { ...currentLiveState, inProgress: true };
  }

  try {
    const dataToSend = {
      startNumber: eq.startNumber,
      className: eq.className || '',
      ...obstacleLiveWrite(obsNo, { ...(seed || {}), ...effectiveUpdate }, serverTimestamp)
    };
    await trackWrite('Uppdaterar maraton-status', setDoc(marathonDocRef(eq.startNumber), dataToSend, { merge: true }));
  } catch (e) {
    if (e.code === 'permission-denied') {
      // The result is finalized (locked): what the judge enters is not stored.
      // Once per equipage, since every keystroke and tick ends up here
      if (lockedNoticeShownFor !== String(eq.startNumber)) {
        lockedNoticeShownFor = String(eq.startNumber);
        showAlert(`#${eq.startNumber}: resultatet är låst (slutfört) och ändringar sparas inte. Kontakta sekretariatet.`, false);
      }
    } else {
      console.error('Ett oväntat fel inträffade vid live-push till maraton:', e);
    }
  }
}
let lockedNoticeShownFor = null;

function updateHeaderInfoMar() {
  const setTextAll = (selector, text) => {
    pageQueryAll(selector).forEach(el => { el.textContent = text; });
  };

  if (!currentEquipage) {
    setTextAll('#infoEquipageLineMar', '–');
    setTextAll('#infoObstacleLine', '–');
    return;
  }
  const equipageStr = `#${currentEquipage.startNumber} ${currentEquipage.driverName || ''} (${currentEquipage.className})`;
  const obsStr = currentObstacleNumber ? `#${currentObstacleNumber}` : '–';
  setTextAll('#infoEquipageLineMar', equipageStr);
  setTextAll('#infoObstacleLine', obsStr);
}

function updateTimerViewMar() {
  // Använder ALLTID den nya robusta funktionen och senaste state från Firestore
  const t = getElapsedMsFromState(currentLiveState);
  const txt = partsToString(msToParts(t));
  pageQueryAll('#liveTimerMar').forEach(out => { out.textContent = txt; });
  updateTotalPenaltyDisplay();
}

function updateKnockdownVisibility() {
  const container = byId('knockdown-container');
  if (!container) return;

  const obstacleNumber = byId('maratonObstacleSelect')?.value;
  const list = obstacleList || [];
  const obsConfig = list.find(o => String(o.number) === String(obstacleNumber));

  // Fältet ska visas om det specifika hindret har bollar / rivningsbara element aktiverade
  const shouldShow = shouldShowObstacleKnockdowns(obsConfig, marathonConfigCache);

  container.classList.toggle('hidden', !shouldShow);
  // Nollställ värdet om fältet döljs för att undvika fel
  if (!shouldShow) {
    const input = byId('maratonKnockdowns');
    if (input) input.value = '0';
  }
}
// Funktion för att summera och visa totalt straff
function updateTotalPenaltyDisplay() {
  const display = byId('totalPenaltyDisplayMar');
  if (!display) return;

  // KORRIGERING: Använder den korrekta funktionen 'getElapsedMsFromState'
  const timeInSeconds = getElapsedMsFromState(currentLiveState) / 1000;

  const knockdowns = parseInt(byId('maratonKnockdowns').value) || 0;
  const otherPenalty = parseFloat(byId('maratonPenalty').value) || 0;

  // Hinderstraff från resultatmotorn (koefficient, rivningar, fri runda)
  const { penalty } = calculateObstacleResult(
    { timeSec: timeInSeconds, otherPenalty },
    currentEquipage,
    { knockdowns }
  );

  display.textContent = (penalty ?? 0).toFixed(2);
}

function startTimerMar() {
  if (isGloballyPaused) {
    showAlert('Tävlingen är globalt pausad. Hindertimern kan inte startas förrän pausen är hävd.', false);
    return;
  }
  if (!currentEquipage || !currentObstacleNumber) {
    showAlert(t('marathon_select_equipage_and_obstacle'), false);
    return;
  }
  // Already running here (a double tap): a second Start would restart the
  // clock from zero, since the running time is kept in the start timestamp
  if (currentLiveState.running === true) {
    return;
  }
  // A clock still running for this equipage at another obstacle (forgotten,
  // or not yet stopped there): ask, but never block. The other obstacle's
  // clock and result are its own and are not touched.
  const elsewhere = obstaclesRunningElsewhere(lastSeenDocFor(currentEquipage), currentObstacleNumber);
  if (elsewhere.length > 0
    && !confirm(`#${currentEquipage.startNumber} har en klocka som går i hinder ${elsewhere.join(', ')}. Starta ändå tiden här i hinder ${currentObstacleNumber}? (Den andra klockan påverkas inte.)`)) {
    return;
  }

  const accumulatedMs = Math.max(0, Number(currentLiveState.liveObstacleTimeMs) || 0);

  // The time from earlier segments stays in liveObstacleTimeMs and the new
  // segment starts now (as after a global pause; every reader adds the two).
  // A virtual start (now − accumulated) made the running segment cover the
  // earlier time, so a global pause in that span was subtracted twice.
  const startMs = nowMs();
  const localStartTimestamp = Timestamp.fromMillis(startMs);
  // The obstacle's entry: kept on a restart, else the first start
  const staticStart = accumulatedMs > 0 && currentLiveState.live_staticStartAt
    ? currentLiveState.live_staticStartAt
    : Timestamp.fromMillis(startMs - accumulatedMs);

  // --- OPTIMISTISK UPPDATERING ---
  const optimisticState = {
    ...currentLiveState,
    running: true,
    inProgress: true,
    currentObstacle: currentObstacleNumber,
    liveObstacleTimeMs: accumulatedMs,
    liveObstacleStartAt: localStartTimestamp,
    live_staticStartAt: staticStart,
    pausedByGlobalPause: false
  };

  // 2. Applicera detta state på UI *direkt*.
  renderLiveState(optimisticState);

  // --- SERVERUPPDATERING ---
  pushLiveSafe({
    running: true,
    inProgress: true,
    liveObstacleStartAt: localStartTimestamp,
    live_staticStartAt: staticStart,
    liveObstacleTimeMs: accumulatedMs,
    pausedByGlobalPause: false
  });
  // Only a stamp for statistics: a refusal (locked result) must not surface
  // as an unhandled rejection
  markObstacleEntered(currentEquipage.startNumber, currentObstacleNumber)
    .catch((error) => console.warn('Kunde inte stämpla hinderinpassage:', error));
}

function stopTimerMar() {
  if (isGloballyPaused) {
    showAlert('Tävlingen är globalt pausad. Hindertimern är låst tills tävlingen återupptas.', false);
    return;
  }
  // The state is this obstacle's own: a clock at another obstacle is not seen here
  if (!currentEquipage || !currentLiveState.running) return;

  // 1. Beräkna den slutgiltiga tiden *lokalt*
  const finalTimeMs = getElapsedMsFromState(currentLiveState);

  // --- OPTIMISTISK UPPDATERING ---
  // 2. Skapa ett optimistiskt state som stoppar klockan
  const optimisticState = {
    ...currentLiveState,
    running: false,
    liveObstacleTimeMs: finalTimeMs, // Sätt den slutgiltiga tiden
    liveObstacleStartAt: null
    // live_staticStartAt bevaras!
  };

  // 3. Applicera detta state på UI *direkt*.
  //    Detta rensar `timerInterval` omedelbart.
  renderLiveState(optimisticState);

  // --- SERVERUPPDATERING ---
  // 4. Skicka det *riktiga* kommandot till servern i bakgrunden.
  pushLiveSafe({
    running: false,
    liveObstacleTimeMs: finalTimeMs,
    liveObstacleStartAt: null // Viktigt att nollställa 'aktiv' timer-start
    // live_staticStartAt skickas inte här, så den ligger kvar
  });
  markObstacleExit(currentEquipage.startNumber, currentObstacleNumber)
    .catch((error) => console.warn('Kunde inte stämpla hinderutpassage:', error));
}

function resetTimerMar(force = false) {
  if (isGloballyPaused) {
    showAlert('Tävlingen är globalt pausad. Nollställning är låst tills tävlingen återupptas.', false);
    return;
  }
  if (!currentEquipage) return;
  if (force || confirm(t('marathon_confirm_reset'))) {

    // 1. Definiera exakt vad som ska skickas till servern för nollställning
    cancelPendingLiveCommentSave();
    // Only this obstacle's entry: another obstacle's clock is not touched.
    // Over a saved result the reset is a new timing (unsaved work), so the
    // zeros are shown here and not the saved result again
    const hasSaved = (currentLiveState.obstacles || []).some(o => Number(o?.number) === Number(currentObstacleNumber));
    const serverUpdatePayload = { ...MARATHON_LIVE_DEFAULTS, live_gateSplits: [], inProgress: hasSaved };

    // --- OPTIMISTISK UPPDATERING ---
    // 2. Skapa det nya "låtsas-state" genom att slå ihop det nuvarande
    //    med nollställningsdatan.
    const optimisticResetState = {
      ...currentLiveState,
      ...serverUpdatePayload,
      currentObstacle: currentObstacleNumber
    };

    // 3. Applicera detta state på UI *direkt*.
    //    Detta stoppar klockan och rensar alla fält omedelbart.
    renderLiveState(optimisticResetState);

    // --- SERVERUPPDATERING ---
    // 4. Skicka det *riktiga* kommandot till servern i bakgrunden.
    pushLiveSafe(serverUpdatePayload);
  }
}

// NY funktion för att skicka formulärdata live
function pushFormField(fieldName, value) {
  if (!currentEquipage || currentObstacleNumber == null) return;
  pendingFormFields = { ...(pendingFormFields || {}), [fieldName]: value };
  pendingFormTarget = { equipage: currentEquipage, obstacleNumber: currentObstacleNumber };
  if (formFieldPushTimer) clearTimeout(formFieldPushTimer);
  formFieldPushTimer = setTimeout(() => {
    flushPendingFormFields().catch((error) => {
      console.error('Kunde inte skicka hinderformuläret live:', error);
    });
  }, FORM_FIELD_PUSH_DEBOUNCE_MS);
}

async function onMarathonEquipageSelected(equipage) {
  await flushPendingLiveComment();
  currentEquipage = equipage || null;
  lastRemoteLiveData = null;
  // Kept on the device: a reload (app update, phone closing the app) comes
  // back to the same equipage
  try {
    if (competitionId) {
      if (equipage) localStorage.setItem(`maratonLastEquipage_${competitionId}`, String(equipage.startNumber));
      else localStorage.removeItem(`maratonLastEquipage_${competitionId}`);
    }
  } catch (_) { /* no storage */ }
  // The previous equipage's typed time must not be applied to this one
  const manualDigits = byId('manualTimeDigitsMar');
  if (manualDigits) manualDigits.value = '';
  byId('manualTimeEditorMar')?.classList.add('hidden');

  // Stäng gammal lyssnare
  if (unsubMaratonDoc) unsubMaratonDoc();
  unsubMaratonDoc = null;

  renderRouteButtonsForCurrent();

  if (equipage) {
    // Starta en ny lyssnare för det valda ekipaget
    subscribeToMarathonDoc(equipage.startNumber);
  } else {
    // Rensa UI om inget ekipage är valt
    applyLiveStateToUI(null);
  }

  // Refresh obstacle list to apply class filtering
  if (obstacleList && obstacleList.length > 0) {
    populateObstacleSelector(obstacleList, true);
  }

  // Ladda befintligt resultat för det hinder som eventuellt redan är valt i dropdown
  const sel = byId('maratonObstacleSelect');
  if (sel && sel.value) {
    await loadExistingResult(true); // Tyst inläsning vid ekipage-byte
  } else {
    updateHeaderInfoMar();
  }
}

async function autoSelectRunningDriverMar(obstacleNo) {
  if (isFieldModeEnabled()) return false;
  if (!competitionId || !obstacleNo) return false;
  try {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
    // Ett ekipage vars klocka går i just detta hinder (obstacleLive.{n}.running)
    const q = query(colRef, where(new FieldPath('obstacleLive', String(Number(obstacleNo)), 'running'), '==', true), limit(1));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const firstRunning = snap.docs[0];
      const startNumber = firstRunning.id;

      if (equipageSearchDropdownMar) {
        const current = equipageSearchDropdownMar.getValue();
        if (Number(current) !== Number(startNumber)) {
          // Detta triggar onMarathonEquipageSelected -> loadExistingResult
          equipageSearchDropdownMar.setValue(Number(startNumber));
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('Kunde inte autosöka efter pågående förare i maraton:', err);
  }
  return false;
}

/**
 * Hanterar byte av hinder (från dropdown).
 */
async function handleObstacleChange() {
  await flushPendingLiveComment();
  const newVal = this.value;
  // 1. Spara valet lokalt
  if (newVal) {
    localStorage.setItem(`maratonLastObstacle_${competitionId}`, newVal);
  }
  updateKnockdownVisibility();

  // 2. Försök hitta en löpare i DETTA hinder
  const found = await autoSelectRunningDriverMar(newVal);

  if (!found) {
    // 3. Visa det valda ekipaget i det nya hindret. Inget skrivs: varje
    //    hinder har sin egen post, så en klocka i ett annat hinder påverkas
    //    inte av att hindret byts här
    await loadExistingResult(false); // Visa bekräftelse vid AKTIVT hinderbyte

    // 4. Sortera om ekipagen baserat på det nya hindret
    rebuildSortedEquipages(newVal);
  }
}

/**
 * Fyller dropdown-menyn för hinder.
 * @param {Array<object>} obstacles - Lista på maratonhinder.
 * @param {boolean} skipAutoSelect - Om true, kör INTE autoSelectRunningDriverMar
 */
function populateObstacleSelector(obstacles, skipAutoSelect = false) {
  if (obstacles) {
    // Om obstacles är en array används den direkt, annars kollar vi efter .obstacles i objektet
    obstacleList = Array.isArray(obstacles) ? obstacles : (obstacles.obstacles || []);
  }

  const obstacleSelect = byId('maratonObstacleSelect');
  if (!obstacleSelect) return;

  const currentVal = obstacleSelect.value;
  obstacleSelect.innerHTML = `<option value="">${t('marathon_select_obstacle')}</option>`;

  // Bestäm vad som ska visas
  let obstaclesToRender = [];
  if (obstacleList && obstacleList.length > 0) {
    obstaclesToRender = obstacleList;
  } else {
    // FALLBACK: Generera lista 1..N baserat på config om ingen explicit lista finns
    const maxObs = Number(marathonConfigCache?.maxObstacles) || 8;
    for (let i = 1; i <= maxObs; i++) {
      obstaclesToRender.push({ number: i });
    }
  }

  // Apply Class Filter
  const drivenObs = currentEquipage ? getClassDrivenObstacles(currentEquipage.className) : null;
  const filteredObstacles = drivenObs ? obstaclesToRender.filter(o => drivenObs.includes(Number(o.number))) : obstaclesToRender;

  filteredObstacles.forEach(obs => {
    const option = document.createElement('option');
    option.value = obs.number;
    option.textContent = `${t('marathon_obstacle_prefix')} ${obs.number}${obs.name ? ` (${obs.name})` : ''}`;
    obstacleSelect.appendChild(option);
  });
  obstacleSelect.value = currentVal;

  // Auto-select strategi:
  let pick = null;

  // 1. Kolla localStorage
  const lastSelected = localStorage.getItem(`maratonLastObstacle_${competitionId}`);
  if (lastSelected && filteredObstacles.some(o => o.number == lastSelected)) {
    pick = lastSelected;
  }

  // 2. Om inget i storage, kolla live-state
  if (!pick) {
    const livePref = currentLiveState?.currentObstacle || null;
    if (livePref) pick = livePref;
  }

  // 3. Fallback till första tillgängliga om inget valts
  if (!pick && filteredObstacles.length > 0) {
    pick = filteredObstacles[0].number;
  }

  if (pick) {
    obstacleSelect.value = pick;
    if (!skipAutoSelect) {
      autoSelectRunningDriverMar(pick);
    }
  }

  // Synka UI för valt hinder och ladda ev. sparade fält
  updateKnockdownVisibility();
  renderRouteButtonsForCurrent();
  loadExistingResult(true); 
}

/**
 * Hämtar och visar ett befintligt resultat om det finns sparat.
 */

// UPPDATERAD FÖR ATT LADDA SPARAD DATA
// RAD FÖRE (ca 823): // UPPDATERAD FÖR ATT LADDA SPARAD DATA

async function loadExistingResult(silent = false) {
  const equipageId = currentEquipage?.startNumber;
  const obstacleNumber = byId('maratonObstacleSelect')?.value;
  currentObstacleNumber = obstacleNumber ? Number(obstacleNumber) : null;

  // Uppdatera knapparna (A/B/C) eftersom hindret kan ha specifikt antal portar
  renderRouteButtonsForCurrent();

  updateHeaderInfoMar(); // Uppdatera rubriken direkt

  if (!equipageId || !currentObstacleNumber) {
    // Om ekipage eller hinder av-selekteras, rensa live-vyn lokalt
    renderLiveState(currentEquipage ? {
      startNumber: currentEquipage.startNumber,
      obstacles: currentLiveState?.obstacles || [],
      currentObstacle: null,
      ...MARATHON_LIVE_DEFAULTS
    } : null);
    return;
  }

  // Only shown, never written: selecting an equipage or an obstacle must not
  // change any obstacle's clock (another device at this obstacle may have
  // just started it). This obstacle's unsaved work (a running clock, a time
  // stopped but not saved, typed fields) is shown as it is on the document;
  // else its saved result, else zeros.
  const requested = { sn: String(equipageId), obstacle: currentObstacleNumber };
  try {
    let sourceData = lastSeenDocFor(currentEquipage);
    if (!sourceData) {
      try {
        const docSnap = await getDoc(marathonDocRef(equipageId));
        sourceData = docSnap.exists() ? docSnap.data({ serverTimestamps: 'estimate' }) : null;
        if (sourceData) mirrorToLocal(equipageId, sourceData);
      } catch (error) {
        console.warn('Kunde inte läsa maratondokumentet, använder lokal backup om den finns.', error);
      }
      if (!sourceData) sourceData = readMarathonBackup(equipageId);
    }
    // Another equipage or obstacle chosen meanwhile
    if (String(currentEquipage?.startNumber) !== requested.sn || currentObstacleNumber !== requested.obstacle) return;

    const state = deriveObstacleState(sourceData || { startNumber: equipageId }, currentObstacleNumber);
    const entry = obstacleLiveEntry(sourceData || {}, currentObstacleNumber);
    const hasSaved = (state.obstacles || []).some(o => Number(o?.number) === currentObstacleNumber);
    if (!silent && hasSaved && !(entry && (entry.running === true || entry.inProgress === true))) {
      showAlert(t('marathon_loaded_saved_result').replace('{obstacleNumber}', currentObstacleNumber), true);
    }
    renderLiveState(state);
  } catch (error) {
    console.error("Kunde inte ladda hinderresultat:", error);
    showAlert("Ett fel inträffade vid hämtning av sparat resultat.", false);
  }
}

// RAD EFTER (ca 882): function renderRoutePreview() {

function renderRoutePreview() {
  const preview = byId('routePreview');
  const inp = byId('routeString');
  const eliminatedCheckbox = byId('maratonEliminated');
  if (!preview || !inp || !eliminatedCheckbox) return;

  const cls = currentEquipage?.className || null;
  const result = getGateLettersForClass(cls); // Nu returnerar denna { count, source }

  const allLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const expectedGates = allLetters.slice(0, result.count);

  const validation = validateRouteString(inp.value, expectedGates);

  // Uppdatera den färgkodade förhandsvisningen
  preview.innerHTML = validation.styledHtml;

  // Visa statusmeddelande under
  const statusEl = pageQuery('#routePreview + .text-sm');
  if (statusEl) {
    statusEl.textContent = validation.reason + ` (Källa: ${result.source})`;
    statusEl.className = 'text-sm mt-1'; // Nollställ klasser
    if (validation.isElimination) {
      statusEl.classList.add('text-red-600', 'font-bold');
    } else if (validation.hasCorrectedError) {
      statusEl.classList.add('text-amber-600', 'font-semibold');
    } else {
      statusEl.classList.add('text-green-600');
    }
  }
}

/**
 * Hanterar sparandet av formulärdata.
 * @param {Event} e - Submit-eventet från formuläret.
 */
async function saveResult(e) {
  e.preventDefault();
  if (isGloballyPaused) {
    showAlert('Tävlingen är globalt pausad. Spara hinderresultat när pausen är hävd eller efter manuell hantering.', false);
    return;
  }
  await flushPendingLiveComment();
  const equipageId = currentEquipage?.startNumber ?? equipageSearchDropdownMar?.getValue();
  const obstacleNumber = currentObstacleNumber ?? Number(byId('maratonObstacleSelect').value || 0);
  if (!equipageId || !obstacleNumber) {
    showAlert(t('marathon_select_both'), false);
    return;
  }

  // The time shown is this obstacle's own (obstacleLive.{n}); a save writes
  // only this obstacle's result, another obstacle's is never touched

  // Säkerställ att klockan är stoppad innan vi sparar
  if (currentLiveState.running) {
    stopTimerMar();
  }

  // Stopped above: the elapsed time is the accumulated time
  const timeMs = getElapsedMsFromState(currentLiveState);
  const timeInSeconds = Number((timeMs / 1000).toFixed(2));

  // Time 0 over a saved time is almost always a cleared live field, not a
  // result: the saved time would be lost
  const savedHere = Array.isArray(currentLiveState.obstacles)
    ? currentLiveState.obstacles.find(o => Number(o?.number) === Number(obstacleNumber))
    : null;
  const savedTimeMs = Number(savedHere?.timeMs ?? (Number(savedHere?.timeInSeconds) * 1000)) || 0;
  if (!(timeMs > 0) && savedTimeMs > 0
    && !confirm(`Tiden är 00:00,00 men hinder ${obstacleNumber} har sparad tid ${partsToString(msToParts(savedTimeMs))}. Spara ändå med tid 0?`)) {
    return;
  }

  let comment = byId('maratonComment')?.value || '';
  let eliminated = !!byId('maratonEliminated')?.checked;
  // Typed in minutes ("2", "2,5" or "1:30"), stored in seconds
  const holdTimeSec = parseHoldMinutes(byId('maratonHoldTime')?.value);
  if (holdTimeSec > 0 && !comment.trim()) {
    comment = 'Väntetid: Föregående ekipage i hinder';
  }

  const knockdowns = parseInt(byId('maratonKnockdowns').value) || 0;
  const otherPenalty = parseFloat(byId('maratonPenalty').value) || 0;

  // Hinderstraff från resultatmotorn (koefficient, rivningar, fri runda, maxtid)
  const obstacleCalc = calculateObstacleResult(
    { timeSec: timeInSeconds, otherPenalty },
    currentEquipage,
    { knockdowns }
  );
  if (obstacleCalc.overMaxTime) {
    eliminated = true;
    comment += ' (' + t('marathon_auto_eliminated_time').replace('{max}', getObstacleMaxTime()) + ').';
  }
  const knockdownPenaltyPoints = obstacleCalc.knockdownPenalty;
  const timePenalty = obstacleCalc.timePenalty;
  const totalObstaclePenalty = obstacleCalc.penalty ?? 0;

  // Hämta starttid för att spara den i resultatet (gör statistiken robust)
  const enteredAt = currentLiveState.live_staticStartAt || currentLiveState.liveObstacleStartAt || Timestamp.now();

  const resultData = {
    number: Number(obstacleNumber),
    timeInSeconds, timeMs, timePenalty,
    knockdowns, knockdownPenalty: knockdownPenaltyPoints, otherPenalty,
    holdTimeSec,
    penalty: totalObstaclePenalty,
    comment: comment.trim(), eliminated,
    routeString: (byId('routeString')?.value || '').trim(),
    gateSplits: currentLiveState.live_gateSplits || [],
    enteredAt: enteredAt // Sparas nu direkt i resultatet!
  };

  // A double tap must not save twice and skip an equipage when moving on
  if (obstacleSaveInFlight) return;
  obstacleSaveInFlight = true;
  const equipageAtSave = currentEquipage;
  // The order as the judge saw it: the save's own write re-sorts the list
  // (the saved equipage moves down among the done ones), and "next" from the
  // re-sorted list kept the judge on the equipage just saved
  const orderAtSave = sortedEquipages.slice();
  const competitionIdAtSave = competitionId;
  try {
    const saved = await saveMarathonObstacleResult(competitionId, equipageId, obstacleNumber, resultData, {
      onLateError: (error) => {
        showAlert(`Hinderresultatet för #${equipageId} (hinder ${obstacleNumber}) nekades av servern när det skickades – resultatet kan vara låst. Kontakta sekretariatet.`, false);
        reportRejectedWrite(competitionIdAtSave, {
          discipline: 'marathon',
          startNumber: equipageId,
          obstacle: obstacleNumber,
          payloadSummary: { timeInSeconds, knockdowns, otherPenalty, holdTimeSec, penalty: totalObstaclePenalty, eliminated },
          error,
          source: 'maraton-input'
        });
      }
    });

    if (saved?.status === 'queued') {
      showAlert(t('marathon_result_queued').replace('{obstacleNumber}', obstacleNumber) + queuedNotice('queued'), 'offline');
    } else {
      showAlert(t('marathon_result_saved').replace('{obstacleNumber}', obstacleNumber));
    }

    // Move on from the equipage that was saved, not from one chosen meanwhile
    if (currentEquipage === equipageAtSave) navigateEquipage(1, orderAtSave);

  } catch (error) {
    console.error("Kunde inte spara maratonresultat:", error);
    showAlert(error?.message?.startsWith('Ekipage #')
      ? error.message
      : `Hinderresultatet för #${equipageId} kunde inte sparas. Kontrollera nätet och försök igen.`, false);
  } finally {
    obstacleSaveInFlight = false;
  }
}

let obstacleSaveInFlight = false;

/**
 * Sätter upp alla händelselyssnare för sidan.
 */

// RAD FÖRE (ca 1009): }

function rebuildSortedEquipages(obstacleNo) {
  const allEquipages = (equipagesRawCache || []).map(normalizeEquipage);
  const activeEquipages = allEquipages.filter(e => e.status !== 'struken');

  const num = obstacleNo ? Number(obstacleNo) : null;

  sortedEquipages = [...activeEquipages].sort((a, b) => {
    // Done with THIS obstacle?
    const docA = marathonStateDocsMap.get(String(a.startNumber));
    const docB = marathonStateDocsMap.get(String(b.startNumber));
    
    const obsA = (docA?.obstacles || []).find(o => Number(o.number) === num);
    const obsB = (docB?.obstacles || []).find(o => Number(o.number) === num);

    const doneA = !!obsA;
    const doneB = !!obsB;

    if (doneA !== doneB) return doneA ? 1 : -1;

    const timeA = (currentStartTimesData && currentStartTimesData[a.startNumber]?.marathon) || '99:99';
    const timeB = (currentStartTimesData && currentStartTimesData[b.startNumber]?.marathon) || '99:99';
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return a.startNumber - b.startNumber;
  });

  if (equipageSearchDropdownMar) {
    equipageSearchDropdownMar.updateData(sortedEquipages);
  } else {
    const equipageSearchContainer = byId('equipageSearchContainerMar');
    if (equipageSearchContainer) {
      equipageSearchDropdownMar = createSearchableDropdown(equipageSearchContainer, sortedEquipages, onMarathonEquipageSelected);
    }
  }
}

let equipagesRawCache = [];

function addQuickObstaclePenalty(amount, reason) {
  const penaltyInput = byId('maratonPenalty');
  if (!penaltyInput) return;
  const currentVal = parseFloat(penaltyInput.value) || 0;
  penaltyInput.value = String(currentVal + amount);
  updateTotalPenaltyDisplay();
  pushFormField('live_otherPenalty', penaltyInput.value);

  const commentInput = byId('maratonComment');
  if (commentInput) {
    const existing = commentInput.value.trim();
    const note = `${reason} (+${amount})`;
    if (!existing) {
      commentInput.value = note;
    } else if (!existing.includes(reason)) {
      commentInput.value = `${existing}, ${note}`;
    }
    const btn = pageQuery('.comment-toggle-btn');
    if (btn) btn.classList.toggle('has-comment', commentInput.value.trim() !== '');
    scheduleLiveCommentSave(commentInput.value);
  }
}

let waitingTimerInterval = null;
let waitingStartTime = 0;
const pendingHoldTimes = new Map();

// Waiting times measured here and the running waiting clock are kept on the
// device: a reload (app update, the phone closing the app) does not lose them
const pendingHoldKey = () => (competitionId ? `maratonPendingHold_${competitionId}` : null);
const waitingTimerKey = () => (competitionId ? `maratonWaitingTimer_${competitionId}` : null);

function persistPendingHoldTimes() {
  const key = pendingHoldKey();
  if (!key) return;
  try {
    if (pendingHoldTimes.size === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify([...pendingHoldTimes.entries()]));
  } catch (_) { /* no storage */ }
}

function restorePendingHoldTimes() {
  pendingHoldTimes.clear();
  const key = pendingHoldKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    (Array.isArray(saved) ? saved : []).forEach(([sn, item]) => {
      const sec = Number(item?.holdTimeSec);
      if (sn && Number.isFinite(sec) && sec > 0) pendingHoldTimes.set(String(sn), { holdTimeSec: sec, reason: String(item?.reason || 'Föregående ekipage i hinder') });
    });
  } catch (_) { /* no storage */ }
}

function persistWaitingTimer(sn) {
  const key = waitingTimerKey();
  if (!key) return;
  try {
    if (waitingStartTime) localStorage.setItem(key, JSON.stringify({ sn: sn || '', startedAt: waitingStartTime }));
    else localStorage.removeItem(key);
  } catch (_) { /* no storage */ }
}

function restoreWaitingTimer() {
  const key = waitingTimerKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || !Number.isFinite(saved.startedAt)) return;
    waitingStartTime = saved.startedAt;
    const snInput = byId('waitingStartNumber');
    if (snInput && saved.sn) snInput.value = saved.sn;
    byId('waitingDriverBody')?.classList.remove('hidden');
    byId('btnStartWaitingTimer')?.classList.add('hidden');
    byId('btnStopWaitingTimer')?.classList.remove('hidden');
    if (waitingTimerInterval) clearInterval(waitingTimerInterval);
    waitingTimerInterval = setInterval(updateWaitingTimerDisplay, 500);
    updateWaitingTimerDisplay();
  } catch (_) { /* no storage */ }
}

function updateWaitingTimerDisplay() {
  const disp = byId('waitingTimerDisplay');
  if (!disp) return;
  if (!waitingStartTime) {
    disp.textContent = '00:00';
    return;
  }
  const elapsedSec = Math.floor((Date.now() - waitingStartTime) / 1000);
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  disp.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderWaitingList() {
  const container = byId('waitingListContainer');
  const countBadge = byId('waitingCountBadge');
  if (!container) return;
  if (pendingHoldTimes.size === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    if (countBadge) countBadge.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  if (countBadge) {
    countBadge.textContent = String(pendingHoldTimes.size);
    countBadge.classList.remove('hidden');
  }
  container.innerHTML = Array.from(pendingHoldTimes.entries()).map(([sn, item]) => `
    <div class="flex items-center justify-between gap-2 bg-white dark:bg-gray-800 px-2 py-1 rounded border border-blue-200 dark:border-blue-900 text-xs">
      <span class="font-bold text-blue-900 dark:text-blue-200">#${escapeHtml(sn)}: ${escapeHtml(formatHoldTime(item.holdTimeSec))} min (${escapeHtml(item.reason)})</span>
      <div class="flex items-center gap-2">
        <button type="button" data-apply-waiting="${escapeHtml(sn)}" class="min-h-[44px] px-3 rounded text-xs text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-300 dark:border-emerald-800">Använd</button>
        <button type="button" data-delete-waiting="${escapeHtml(sn)}" class="min-h-[44px] px-3 rounded text-xs text-red-600 dark:text-red-400 font-bold border border-red-200 dark:border-red-900">Ta bort</button>
      </div>
    </div>
  `).join('');
}

// Hold time is entered in minutes (TR V 525.7, FEI 965.8.2: whole or half
// minutes); the field shows m:ss
function addQuickHoldTime(seconds, defaultReason = 'Föregående ekipage i hinder') {
  const holdInput = byId('maratonHoldTime');
  if (!holdInput) return;
  const currentVal = parseHoldMinutes(holdInput.value);
  const nextVal = Math.max(0, currentVal + seconds);
  holdInput.value = formatHoldTime(nextVal);
  pushFormField('live_holdTimeSec', holdInput.value);

  const commentInput = byId('maratonComment');
  if (commentInput && nextVal > 0 && !commentInput.value.trim()) {
    commentInput.value = `Väntetid: ${defaultReason}`;
    const btn = pageQuery('.comment-toggle-btn');
    if (btn) btn.classList.add('has-comment');
    scheduleLiveCommentSave(commentInput.value);
  }
}

function setHoldReason(reason) {
  const commentInput = byId('maratonComment');
  if (!commentInput) return;
  const existing = commentInput.value.trim();
  const note = `Väntetid: ${reason}`;
  if (!existing) {
    commentInput.value = note;
  } else if (!existing.includes(reason)) {
    commentInput.value = `${existing}, ${note}`;
  }
  const btn = pageQuery('.comment-toggle-btn');
  if (btn) btn.classList.add('has-comment');
  scheduleLiveCommentSave(commentInput.value);
}

// Bumped by every load and unload: a load still awaiting its data when the
// page was left or loaded again must not register listeners afterwards
let loadSeq = 0;

async function setupPage(mySeq = loadSeq) {
  try {
    // Hämta all nödvändig data parallellt för snabbare laddning
    const [equipagesRaw, startTimesData, marathonConfig, marathonStateDocs] = await Promise.all([
      getEquipages(competitionId),
      getStartTimes(competitionId),
      getConfig(competitionId, 'maratonConfig'),
      getMarathonStateDocuments(competitionId)
    ]);
    if (mySeq !== loadSeq) return;
    equipagesRawCache = equipagesRaw || [];

    marathonConfigCache = marathonConfig || {};
    setMarathonConfig(marathonConfigCache);

    marathonStateDocsMap = marathonStateDocs || new Map();
    currentStartTimesData = startTimesData;

    // Fyll hinderlistan (standard om ingen kusk är vald)
    // Försök hämta om det finns port-inställningar i config om vi inte har en kusk
    obstacleList = getClassDrivenObstacles(null);
    populateObstacleSelector();

    rebuildSortedEquipages(byId('maratonObstacleSelect')?.value);

    // Request Wake Lock bara i full live-drift
    if (!isFieldModeEnabled()) {
      try {
        await requestWakeLock();
      } catch (wlErr) {
        console.warn('WakeLock failed (expected if page hidden):', wlErr);
      }
    }
    if (mySeq !== loadSeq) return;

  // NYTT: Bättre event-hantering för live-push
  boundHandlers.formInputHandler = (e) => {
    const target = e.target;
    if (!target) return;

    if (target.id === 'maratonKnockdowns') {
      updateTotalPenaltyDisplay();
      pushFormField('live_knockdowns', target.value);
    } else if (target.id === 'maratonPenalty') {
      updateTotalPenaltyDisplay();
      pushFormField('live_otherPenalty', target.value);
    } else if (target.id === 'maratonHoldTime') {
      pushFormField('live_holdTimeSec', target.value);
    } else if (target.id === 'maratonComment') {
      const btn = pageQuery('.comment-toggle-btn');
      if (btn) btn.classList.toggle('has-comment', target.value.trim() !== '');
      scheduleLiveCommentSave(target.value);
    } else if (target.id === 'maratonEliminated') {
      pushFormField('live_eliminated', target.checked);
    }
  };

  boundHandlers.commentBlurHandler = (e) => {
    if (e.target?.id === 'maratonComment') {
      flushPendingLiveComment().catch((error) => {
        console.error('Kunde inte spara hinderkommentar live:', error);
      });
    }
  };

  // NYTT: Klick-hanterare för kommentarsknappen
  boundHandlers.formClickHandler = (e) => {
    const btn = e.target.closest('.comment-toggle-btn');
    if (!btn) return;
    const wrapper = pageQuery('.comment-wrapper');
    if (!wrapper) return;

    wrapper.classList.toggle('comment-visible');
    if (wrapper.classList.contains('comment-visible')) {
      wrapper.querySelector('textarea').focus();
    }
  };

  if (typeof unsubObstacles === 'function') {
    try { unsubObstacles(); } catch { }
  }
  unsubObstacles = listenForMarathonObstacles(competitionId, populateObstacleSelector);
  if (typeof unsubGlobalPause === 'function') {
    try { unsubGlobalPause(); } catch { }
  }
  unsubGlobalPause = listenForGlobalCompetitionPause_Obstacles();
  startServerClockSync();
  syncGlobalPauseUiState();

  // Koppla alla knappar och event

  // KORRIGERING: Använd vår nya handler som både sparar och söker
  boundHandlers.obstacleChange = handleObstacleChange;
  boundHandlers.submitHandler = (e) => saveResult(e);
  boundHandlers.prevClick = () => navigateEquipage(-1);
  boundHandlers.nextClick = () => navigateEquipage(1);
  boundHandlers.startH = () => startTimerMar();
  boundHandlers.stopH = () => stopTimerMar();
  boundHandlers.resetH = () => resetTimerMar();
  boundHandlers.timerClick = () => byId('manualTimeEditorMar')?.classList.remove('hidden');
  boundHandlers.cancelClick = () => byId('manualTimeEditorMar')?.classList.add('hidden');
  boundHandlers.applyClick = () => applyManualTime();
  boundHandlers.manualTimeKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyManualTime();
    }
  };
  boundHandlers.routeUndo = () => updateRouteString('undo');
  boundHandlers.routeClear = () => updateRouteString('clear');

  const form = byId('addMaratonResultForm');
  if (form) {
    form.addEventListener('submit', boundHandlers.submitHandler);
    form.addEventListener('input', boundHandlers.formInputHandler);
    form.addEventListener('click', boundHandlers.formClickHandler); // För kommentarsknappen
    form.addEventListener('focusout', boundHandlers.commentBlurHandler);
    form.addEventListener('focusout', reapplyRemoteStateAfterEdit);
  }

  byId('maratonObstacleSelect')?.addEventListener('change', boundHandlers.obstacleChange);
  byId('btnQuickPenaltyGroom')?.addEventListener('click', () => addQuickObstaclePenalty(5, 'Groom avstigning'));
  byId('btnQuickPenaltyCourse')?.addEventListener('click', () => addQuickObstaclePenalty(20, 'Korrigerad fel väg'));
  byId('btnQuickHold30')?.addEventListener('click', () => addQuickHoldTime(30));
  byId('btnQuickHold60')?.addEventListener('click', () => addQuickHoldTime(60));
  byId('btnQuickHold120')?.addEventListener('click', () => addQuickHoldTime(120));
  byId('btnQuickHoldClear')?.addEventListener('click', () => {
    const holdInput = byId('maratonHoldTime');
    if (holdInput) {
      holdInput.value = '';
      pushFormField('live_holdTimeSec', '');
    }
  });

  pageQueryAll('#holdReasonPills button[data-hold-reason]').forEach(btn => {
    btn.addEventListener('click', () => {
      setHoldReason(btn.dataset.holdReason);
      const holdInput = byId('maratonHoldTime');
      if (holdInput && parseHoldMinutes(holdInput.value) === 0) {
        holdInput.value = formatHoldTime(30);
        pushFormField('live_holdTimeSec', holdInput.value);
      }
    });
  });

  byId('btnToggleWaitingCard')?.addEventListener('click', () => {
    const body = byId('waitingDriverBody');
    if (body) body.classList.toggle('hidden');
  });

  byId('btnStartWaitingTimer')?.addEventListener('click', () => {
    const snInput = byId('waitingStartNumber');
    const sn = (snInput?.value || '').trim();
    if (!sn) {
      showAlert('Ange startnummer för det väntande ekipaget.', false);
      snInput?.focus();
      return;
    }
    waitingStartTime = Date.now();
    persistWaitingTimer(sn);
    byId('btnStartWaitingTimer')?.classList.add('hidden');
    byId('btnStopWaitingTimer')?.classList.remove('hidden');
    if (waitingTimerInterval) clearInterval(waitingTimerInterval);
    waitingTimerInterval = setInterval(updateWaitingTimerDisplay, 500);
    updateWaitingTimerDisplay();
  });

  byId('btnStopWaitingTimer')?.addEventListener('click', () => {
    if (!waitingStartTime) return;
    const snInput = byId('waitingStartNumber');
    const sn = (snInput?.value || '').trim();
    const elapsedSec = Math.max(1, Math.round((Date.now() - waitingStartTime) / 1000));
    waitingStartTime = 0;
    persistWaitingTimer(null);
    if (waitingTimerInterval) {
      clearInterval(waitingTimerInterval);
      waitingTimerInterval = null;
    }
    byId('btnStartWaitingTimer')?.classList.remove('hidden');
    byId('btnStopWaitingTimer')?.classList.add('hidden');
    updateWaitingTimerDisplay();
    if (sn) {
      pendingHoldTimes.set(sn, { holdTimeSec: elapsedSec, reason: 'Föregående ekipage i hinder' });
      persistPendingHoldTimes();
      renderWaitingList();
      if (snInput) snInput.value = '';
      showAlert(`Väntetid ${formatHoldTime(elapsedSec)} min sparad för ekipage #${sn}!`, true);
    }
  });

  byId('waitingListContainer')?.addEventListener('click', (e) => {
    const applySn = e.target.closest('[data-apply-waiting]')?.dataset.applyWaiting;
    const deleteSn = e.target.closest('[data-delete-waiting]')?.dataset.deleteWaiting;
    if (applySn) {
      const item = pendingHoldTimes.get(applySn);
      if (item) {
        const holdInput = byId('maratonHoldTime');
        if (holdInput) {
          holdInput.value = formatHoldTime(item.holdTimeSec);
          pushFormField('live_holdTimeSec', holdInput.value);
        }
        setHoldReason(item.reason);
        pendingHoldTimes.delete(applySn);
        persistPendingHoldTimes();
        renderWaitingList();
        showAlert(`Väntetid (${formatHoldTime(item.holdTimeSec)} min) applicerad!`, true);
      }
    } else if (deleteSn) {
      if (!confirm(`Ta bort den uppmätta väntetiden för #${deleteSn}?`)) return;
      pendingHoldTimes.delete(deleteSn);
      persistPendingHoldTimes();
      renderWaitingList();
    }
  });
  restorePendingHoldTimes();
  renderWaitingList();
  restoreWaitingTimer();
  boundHandlers.clockBadge = () => updateClockSyncBadge();
  window.addEventListener('serverclockchange', boundHandlers.clockBadge);
  updateClockSyncBadge();
  byId('prevEquipageMar')?.addEventListener('click', boundHandlers.prevClick);
  byId('nextEquipageMar')?.addEventListener('click', boundHandlers.nextClick);
  byId('btnStartMar')?.addEventListener('click', boundHandlers.startH);
  byId('btnStopMar')?.addEventListener('click', boundHandlers.stopH);
  byId('btnResetMar')?.addEventListener('click', boundHandlers.resetH);
  byId('btnManualOpenMar')?.addEventListener('click', boundHandlers.timerClick);
  byId('liveTimerMar')?.addEventListener('click', boundHandlers.timerClick);
  byId('btnManualCancelMar')?.addEventListener('click', boundHandlers.cancelClick);
  byId('btnManualApplyMar')?.addEventListener('click', boundHandlers.applyClick);
  byId('manualTimeDigitsMar')?.addEventListener('keydown', boundHandlers.manualTimeKeydown);

  byId('routeUndo')?.addEventListener('click', boundHandlers.routeUndo);
  byId('routeClear')?.addEventListener('click', boundHandlers.routeClear);

  byId('btnBackupMarJson')?.addEventListener('click', () => {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(`bkp_${competitionId}_mar_`)) {
        backup[key] = JSON.parse(localStorage.getItem(key));
      }
    }
    const filename = `backup_maraton_hinder_${competitionId}_${new Date().toISOString().split('T')[0]}.json`;
    downloadJson(filename, backup);
  });

  if (unsubMaratonList) unsubMaratonList();
  unsubMaratonList = listenForMaratonCollection(competitionId, (maratonDocs) => {
    marathonStateDocsMap = new Map();
    (maratonDocs || []).forEach(d => marathonStateDocsMap.set(String(d.id), d));
    rebuildSortedEquipages(byId('maratonObstacleSelect')?.value);
  });

  // Back to the equipage chosen before a reload (app update, the phone
  // closing the app), unless one is chosen already
  restoreSelectedEquipage();
  pruneFieldBackups();

  } catch (err) {
    console.error('[MarathonInput] Allvarligt fel vid initiering:', err);
    showAlert(t('marathon_page_load_error'), false);
  }
}

let unsubMaratonList = null;

function restoreSelectedEquipage() {
  if (!equipageSearchDropdownMar || equipageSearchDropdownMar.getValue()) return;
  let saved = null;
  try { saved = localStorage.getItem(`maratonLastEquipage_${competitionId}`); } catch (_) { /* no storage */ }
  if (saved && sortedEquipages.some(e => String(e.startNumber) === String(saved))) {
    equipageSearchDropdownMar.setValue(Number(saved));
  }
}

// "Klocka ej synkad": no offset to the server is known on this device, so its
// own clock stamps the times (they may differ from other devices' stamps)
function updateClockSyncBadge() {
  byId('clockSyncBadgeMar')?.classList.toggle('hidden', isServerClockSynced());
}

// The update prompt asks before reloading while there is work here: a clock
// running or stopped but not saved, typed fields not sent yet, measured
// waiting times or a running waiting clock, a save under way
function hasUnsavedObstacleWork() {
  return obstaclePageHasUnsavedWork({
    liveState: currentEquipage && currentObstacleNumber != null ? currentLiveState : null,
    pendingFormFields,
    pendingComment: pendingLiveComment,
    pendingHoldCount: pendingHoldTimes.size,
    waitingTimerRunning: waitingStartTime > 0,
    saveInFlight: obstacleSaveInFlight
  });
}

// RAD EFTER (ca 1062): // Hanterar Föregående/Nästa-knapparna

// Hanterar Föregående/Nästa-knapparna
// order: the list to step in (Save passes the order from before its write)
function navigateEquipage(delta, order = sortedEquipages) {
  if (!equipageSearchDropdownMar) return;
  const currentValue = equipageSearchDropdownMar.getValue();
  let currentIndex = -1;

  if (currentValue) {
    currentIndex = order.findIndex(e => e.startNumber == currentValue);
  }

  const nextIndex = currentIndex + delta;

  if (nextIndex >= 0 && nextIndex < order.length) {
    equipageSearchDropdownMar.setValue(order[nextIndex].startNumber);
  } else if (delta > 0) {
    showAlert(t('marathon_end_of_startlist'));
  } else {
    showAlert(t('marathon_start_of_startlist'));
  }
}

// Hanterar när man matar in tid manuellt
function applyManualTime() {
  if (isGloballyPaused) {
    showAlert('Tävlingen är globalt pausad. Manuell hindertid kan inte ändras förrän pausen är hävd.', false);
    return;
  }
  if (!currentEquipage || !currentObstacleNumber) {
    showAlert(t('marathon_select_equipage_and_obstacle'), false);
    return;
  }
  const digitsEl = byId('manualTimeDigitsMar');
  // Empty or invalid input is refused: it used to be stored as 0.00
  const ms = parseManualTimeMs(digitsEl?.value);
  if (ms == null) {
    showAlert('Ogiltig tid. Ange mmsscc (sekunder under 60).', false);
    digitsEl?.focus();
    return;
  }
  if (currentLiveState.running === true
    && !confirm(`Klockan går. Stoppa den och ersätt tiden med ${partsToString(msToParts(ms))}?`)) return;
  if (digitsEl) digitsEl.value = '';

  // Update state locally immediately (prevent race condition)
  renderLiveState({
    ...currentLiveState,
    liveObstacleTimeMs: ms,
    running: false,
    inProgress: true,
    liveObstacleStartAt: null,
    pausedByGlobalPause: false
  });
  byId('manualTimeEditorMar')?.classList.add('hidden');

  // Skicka en komplett ögonblicksbild av tillståndet
  pushLiveSafe({
    running: false,
    inProgress: true,
    liveObstacleTimeMs: ms,
    liveObstacleStartAt: null, // Clear start time so monitor knows it is stopped
    // A typed time replaces one the global pause stopped: not resumed later
    pausedByGlobalPause: false
  });
}

// Förenklad funktion för att hantera rutt-strängen
function updateRouteString(action) {
  const inp = byId('routeString');
  if (!inp) return;

  let splits = currentLiveState.live_gateSplits || [];

  if (action === 'clear') {
    // The whole route goes: asked first (the button sits next to Undo)
    if (inp.value.trim() && !confirm('Rensa hela vägvalet för hindret?')) return;
    inp.value = '';
    splits = [];
  } else if (action === 'undo') {
    const parts = inp.value.trim().split(/\s+/);
    parts.pop();
    inp.value = parts.join(' ');
    // Remove last split
    if (splits.length > 0) {
      splits = splits.slice(0, -1);
    }
  }
  renderRoutePreview();

  // Optimistic update
  currentLiveState.live_gateSplits = splits;

  pushLiveSafe({
    live_routeString: inp.value,
    live_gateSplits: splits
  });
}

const DEFAULT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
function getGateLettersForClass(className) {
  // 1. Check overrides in current obstacle (if any)
  if (currentObstacleNumber != null && Array.isArray(obstacleList)) {
    // Use loose equality (==) to handle string/number mismatch
    const obsConfig = obstacleList.find(o => o.number == currentObstacleNumber);

    // 1a. Prioritera klass-specifikt undantag
    if (obsConfig && obsConfig.classOverrides && className) {
      const override = obsConfig.classOverrides[className];
      if (Number.isInteger(override) && override > 0) {
        return { count: override, source: `Klassundantag (${className})` };
      }
    }

    // 1b. Annars använd hindrets globala inställning (om satt)
    if (obsConfig && Number.isInteger(obsConfig.gateCount) && obsConfig.gateCount > 0) {
      return { count: obsConfig.gateCount, source: 'Hindrets standard' };
    }
  }

  // 2. Annars använd klassens inställning
  if (!className || !marathonConfigCache) return { count: 6, source: 'Standard A-F' };

  const classData = marathonConfigCache.marathonClassData?.[className];
  const count = classData?.gateCount;

  if (Number.isInteger(count) && count > 0) {
    return { count: count, source: `Klassens standard (${className})` };
  }

  // Fallback till standard A-F
  return { count: 6, source: 'Standard A-F' };
}

function renderRouteButtonsForCurrent() {
  const wrap = byId('routeButtons');
  if (!wrap) return;
  wrap.innerHTML = '';

  const cls = currentEquipage?.className || null;
  const result = getGateLettersForClass(cls);
  const count = result.count;
  const letters = DEFAULT_LETTERS.slice(0, count);

  // Grupp: versaler (rätt håll)
  const upperRow = document.createElement('div');
  upperRow.className = 'route-button-grid grid grid-cols-4 sm:grid-cols-6 gap-2'; // 4 columns on mobile is optimal (A,B,C,D)
  letters.forEach(L => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'py-2.5 md:py-4 text-lg md:text-xl font-bold rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100 border-2 border-emerald-600 dark:border-emerald-700 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-700 active:scale-95 transition-all touch-manipulation shadow-sm';
    btn.textContent = L;
    btn.addEventListener('click', () => appendRouteLetter(L));
    upperRow.appendChild(btn);
  });

  // Grupp: gemener (bakifrån)
  const lowerRow = document.createElement('div');
  lowerRow.className = 'route-button-grid grid grid-cols-4 sm:grid-cols-6 gap-2';
  letters.forEach(L => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'py-2 md:py-3 text-base md:text-lg font-medium rounded-lg bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100 border border-red-300 dark:border-red-800 hover:bg-red-500 hover:text-white dark:hover:bg-red-700 active:scale-95 transition-all touch-manipulation opacity-80';
    btn.textContent = L.toLowerCase();
    btn.addEventListener('click', () => appendRouteLetter(L.toLowerCase()));
    lowerRow.appendChild(btn);
  });

  const labelU = document.createElement('div');
  labelU.className = 'text-xs text-gray-600 dark:text-gray-400';
  labelU.textContent = `${t('marathon_gates_forward')} - ${result.source}:`;

  const labelL = document.createElement('div');
  labelL.className = 'text-xs text-gray-600 dark:text-gray-400 mt-1';
  labelL.textContent = `${t('marathon_gates_backward')}:`;

  wrap.appendChild(labelU);
  wrap.appendChild(upperRow);
  wrap.appendChild(labelL);
  wrap.appendChild(lowerRow);
}

function appendRouteLetter(ch) {
  const inp = byId('routeString');
  if (!inp) return;
  const before = (inp.value || '').trim();
  const newValue = before ? `${before} ${ch}` : ch;
  inp.value = newValue; // Uppdatera lokalt för snabb feedback
  renderRoutePreview();

  const splits = currentLiveState.live_gateSplits || [];
  const newSplits = [...splits, { char: ch, ts: Date.now() }];

  // Optimistic update
  currentLiveState.live_gateSplits = newSplits;

  // KORRIGERING: Skicka BARA den ändrade väg-strängen och gateSplits.
  // Detta förhindrar att tiden och andra fält påverkas av misstag.
  pushLiveSafe({
    live_routeString: newValue,
    live_gateSplits: newSplits
  });
}

/**
 * Huvudfunktion som anropas av routern för att ladda och initiera sidan.
 */
// RAD FÖRE (ca 1234): }

export async function load() {
  const mySeq = ++loadSeq;
  const competition = getGlobalState('currentCompetition');
  const page = pageRoot();

  if (!competition) {
    page.innerHTML = `<p class="p-8 text-center text-red-500 dark:text-red-400">${t('marathon_no_competition')}</p>`;
    return;
  }
  competitionId = competition.id;
  // Also when load runs without an unload first
  if (unsubMaratonDoc) {
    try { unsubMaratonDoc(); } catch { }
    unsubMaratonDoc = null;
  }
  resetModuleSelectionState();

  page.innerHTML = `
  <style>
      .comment-wrapper {
          display: none;
          margin-top: 8px;
      }
      .comment-wrapper.comment-visible {
          display: block;
      }
      .toggle-btn {
          background: none;
          border: 1px solid #cbd5e1;
          border-radius: 99px;
          min-height: 44px;
          padding: 4px 14px;
          font-size: 11px;
          line-height: 1.2;
          color: #475569;
          cursor: pointer;
          white-space: nowrap;
      }
      .toggle-btn.has-comment {
          border-color: #2563eb;
          color: #2563eb;
          font-weight: 600;
      }

      .marathon-manual-editor {
          position: absolute;
          right: 1rem;
          top: 100%;
          margin-top: 0.5rem;
          width: 18rem;
          max-width: calc(100vw - 2rem);
      }
      
      @media (max-width: 640px) {
          #page-maraton-input .container { padding: 0.5rem; }
          #page-maraton-input .main-card { padding: 0.75rem !important; border-radius: 0.75rem; }
          #page-maraton-input h2 { font-size: 1.25rem; margin-bottom: 0.5rem; }
          
          .sticky-maraton-controls {
              top: 63px;
              margin-left: -0.75rem;
              margin-right: -0.75rem;
              padding: 0.5rem 0.75rem !important;
          }
          #liveTimerMar { font-size: 2.1rem !important; line-height: 1; }
          .marathon-control-strip {
              display: grid !important;
              grid-template-columns: minmax(0, 1fr) auto;
              gap: 0.5rem;
              align-items: stretch;
          }
          .marathon-primary-controls {
              display: grid !important;
              gap: 0.5rem;
              min-width: 0;
          }
          .marathon-control-strip.is-live .marathon-primary-controls {
              grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .marathon-control-strip.is-field .marathon-primary-controls {
              grid-template-columns: minmax(0, 1fr);
          }
          .marathon-main-btn {
              min-width: 0 !important;
              width: 100%;
          }
          .control-btn { padding: 0.65rem !important; font-size: 0.95rem !important; }
          .marathon-reset-btn {
              width: 3.25rem !important;
              min-width: 3.25rem !important;
              height: auto !important;
              min-height: 3.25rem !important;
          }
          
          .selection-grid { grid-template-columns: 1fr !important; gap: 0.5rem !important; }
          .marathon-equipage-nav {
              display: grid !important;
              grid-template-columns: auto minmax(0, 1fr) auto;
              gap: 0.5rem;
              align-items: center;
          }
          .marathon-equipage-nav #equipageSearchContainerMar {
              min-width: 0;
          }
          .marathon-manual-editor {
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
          .marathon-penalty-grid {
              grid-template-columns: 1fr !important;
          }
      }

      @media (max-width: 1100px) and (orientation: landscape) and (max-height: 760px) {
          #page-maraton-input .container { padding: 0.35rem; }
          #page-maraton-input .main-card { padding: 0.75rem !important; }
          .sticky-maraton-controls {
              top: 0 !important;
              margin-left: -0.75rem;
              margin-right: -0.75rem;
              padding: 0.45rem 0.75rem !important;
          }
          #liveTimerMar {
              font-size: 2.9rem !important;
              line-height: 0.95;
          }
          .marathon-control-strip {
              display: grid !important;
              grid-template-columns: minmax(0, 1fr) auto;
              gap: 0.55rem;
              align-items: stretch;
          }
          .marathon-primary-controls {
              display: grid !important;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 0.55rem;
              min-width: 0;
          }
          .marathon-control-strip.is-field .marathon-primary-controls {
              grid-template-columns: minmax(0, 1fr);
          }
          .marathon-main-btn {
              min-width: 0 !important;
              width: 100%;
          }
          .control-btn {
              padding-top: 0.55rem !important;
              padding-bottom: 0.55rem !important;
              font-size: 0.95rem !important;
          }
          .marathon-reset-btn {
              width: 3rem !important;
              min-width: 3rem !important;
              height: auto !important;
              min-height: 3rem !important;
          }
          .marathon-penalty-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
          }
          .route-button-grid {
              gap: 0.45rem !important;
          }
          .route-button-grid button {
              padding-top: 0.55rem !important;
              padding-bottom: 0.55rem !important;
              font-size: 0.95rem !important;
          }
          .marathon-save-btn {
              padding-top: 0.85rem !important;
              padding-bottom: 0.85rem !important;
              font-size: 1rem !important;
          }
      }

      /* Dark mode styles */
      .dark .toggle-btn { border-color: #4b5563; color: #9ca3af; }
      .dark .toggle-btn.has-comment { border-color: #60a5fa; color: #60a5fa; }
  </style>

  <div class="container mx-auto p-4 md:p-8 max-w-2xl">
    ${getCompetitionHeader(competition, competition?.competitionMode === 'field'
      ? 'Maraton - manuell hinderregistrering'
      : t('marathon_input_header'), { quickGuideRole: 'marathon-obstacle' })}
    ${renderCompetitionModeBanner(competition, {
      message: 'Tävlingen körs i fältläge. Hinder rapporteras manuellt här utan krav på full liveproduktion.'
    })}

    <div class="main-card bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border dark:border-gray-700">
      <h2 class="text-2xl font-semibold mb-4 border-b dark:border-gray-700 pb-2 dark:text-white">${competition?.competitionMode === 'field' ? 'Registrera hinderresultat' : t('marathon_report_result')}</h2>

      <form id="addMaratonResultForm" class="space-y-3">
        
        <!-- EKIPAGE OCH HINDERVAL -->
        <div class="selection-grid grid grid-cols-1 md:grid-cols-2 gap-3 mb-2 relative z-30">
          <div class="p-2 border rounded-lg bg-gray-50/50 dark:bg-gray-700/30 dark:border-gray-700">
            <label class="block text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">${t('marathon_select_equipage')}</label>
            <div class="marathon-equipage-nav flex items-center gap-2">
              <button id="prevEquipageMar" type="button" aria-label="Föregående ekipage" class="w-11 h-11 shrink-0 flex items-center justify-center border rounded-md hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 dark:text-white">«</button>
              <div id="equipageSearchContainerMar" class="flex-grow"></div>
              <button id="nextEquipageMar" type="button" aria-label="Nästa ekipage" class="w-11 h-11 shrink-0 flex items-center justify-center border rounded-md hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 dark:text-white">»</button>
            </div>
          </div>

          <div class="p-2 border rounded-lg bg-gray-50/50 dark:bg-gray-700/30 dark:border-gray-700">
            <label for="maratonObstacleSelect" class="block text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">${t('marathon_obstacle')}</label>
            <select id="maratonObstacleSelect" required class="block w-full p-2 text-base border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"></select>
          </div>
        </div>

        <!-- STICKY TIMER OCH KONTROLLER -->
        <div class="sticky-maraton-controls sticky top-[63px] -mx-6 px-6 py-3 bg-white/95 dark:bg-gray-800/95 backdrop-blur border-b dark:border-gray-700 z-10 shadow-sm mb-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div class="flex-grow min-w-0">
               <div id="infoEquipageLineMar" class="font-bold text-sm md:text-base dark:text-white truncate">–</div>
               <div class="text-xs text-gray-600 dark:text-gray-400">
                 Hinder: <span id="infoObstacleLine" class="font-bold tabular-nums">–</span>
                 <span id="clockSyncBadgeMar" class="hidden ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 text-[10px] font-bold uppercase" title="Enheten har inte kunnat jämföra sin klocka med serverns: tiderna stämplas med enhetens egen klocka">Klocka ej synkad</span>
               </div>
            </div>
            <div id="liveTimerMar" role="button" tabindex="0" data-kbd-click class="text-3xl md:text-5xl font-black tabular-nums cursor-pointer text-gray-800 dark:text-white" title="Ändra tid">00:00,00</div>
          </div>

          <div class="marathon-control-strip ${competition?.competitionMode === 'field' ? 'is-field' : 'is-live'} mt-2 flex flex-wrap items-center gap-2">
            <div class="marathon-primary-controls flex flex-1 flex-wrap items-center gap-2">
            ${competition?.competitionMode === 'field'
              ? `<button id="btnManualOpenMar" type="button" class="control-btn marathon-main-btn flex-1 min-w-[12rem] px-4 py-3 rounded-lg bg-brand-darkblue text-white font-bold text-lg active:scale-95 transition-all shadow-sm hover:bg-brand-gold hover:text-brand-darkblue">Ange tid</button>`
              : `<button id="btnStartMar" type="button" class="control-btn marathon-main-btn flex-1 min-w-[8rem] px-4 py-3 rounded-lg bg-emerald-600 text-white font-bold text-lg active:scale-95 transition-all shadow-sm hover:bg-emerald-700">Start</button>
            <button id="btnStopMar" type="button" class="control-btn marathon-main-btn flex-1 min-w-[8rem] px-4 py-3 rounded-lg bg-red-600 text-white font-bold text-lg active:scale-95 transition-all shadow-sm hover:bg-red-700">Stopp</button>`}
            </div>
            <button id="btnResetMar" type="button" aria-label="Nollställ hindertid och formulär" title="Nollställ hindertid och formulär" class="control-btn marathon-reset-btn ml-4 w-12 h-12 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 text-gray-700 active:scale-95 transition-all hover:bg-gray-200 dark:bg-gray-700 dark:text-white"><span aria-hidden="true">🔄</span></button>
          </div>

          <!-- Manuelltids-editor (floating) -->
          <div id="manualTimeEditorMar" class="marathon-manual-editor hidden p-4 rounded-xl border bg-white dark:bg-gray-800 shadow-2xl z-50 dark:border-gray-700">
            <label class="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">${t('marathon_manual_time_prompt')}</label>
            <input id="manualTimeDigitsMar" type="tel" inputmode="numeric" class="w-full text-3xl font-mono text-center py-3 border rounded-lg mb-3 dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="mmsscc" maxlength="6" />
            <div class="flex gap-2">
              <button id="btnManualApplyMar" type="button" class="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-bold">${t('marathon_apply')}</button>
              <button id="btnManualCancelMar" type="button" class="flex-1 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 dark:text-gray-200">${t('marathon_cancel')}</button>
            </div>
          </div>
        </div>

        <!-- VÄNTANDE EKIPAGE (STOPPTID UTANFÖR HINDRET) -->
        <div id="waitingDriverCard" class="p-2.5 rounded-lg border border-blue-200 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-800">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5 text-xs font-bold text-blue-900 dark:text-blue-200">
              <span class="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              <span>Väntande ekipage utanför hindret</span>
              <span id="waitingCountBadge" class="hidden ml-1 px-1.5 py-0.2 text-[10px] bg-blue-600 text-white rounded-full"></span>
            </div>
            <button type="button" id="btnToggleWaitingCard" class="text-[11px] text-blue-600 dark:text-blue-400 font-semibold hover:underline">Stoppur för kö</button>
          </div>
          <div id="waitingDriverBody" class="hidden mt-2 text-xs space-y-2">
            <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <input type="number" id="waitingStartNumber" placeholder="Startnr" min="1" class="w-20 p-1.5 text-xs border rounded bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600 font-bold" />
              <button type="button" id="btnStartWaitingTimer" class="px-2.5 py-1.5 rounded font-bold bg-blue-600 text-white text-xs hover:bg-blue-700 active:scale-95 transition-all">Starta klocka</button>
              <button type="button" id="btnStopWaitingTimer" class="hidden px-2.5 py-1.5 rounded font-bold bg-amber-600 text-white text-xs hover:bg-amber-700 active:scale-95 transition-all">Stoppa & spara</button>
              <span id="waitingTimerDisplay" class="font-mono font-bold text-sm text-blue-800 dark:text-blue-300 min-w-[45px]">00:00</span>
            </div>
            <div id="waitingListContainer" class="hidden space-y-1 pt-1 border-t border-blue-200 dark:border-blue-800"></div>
          </div>
        </div>

        <!-- VÄGVAL -->
        <div class="space-y-2">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">${t('marathon_route_through_obstacle')}</label>
            <div class="flex gap-6">
                <button id="routeUndo" type="button" class="min-h-[44px] min-w-[44px] px-3 rounded-md border border-blue-200 dark:border-blue-800 text-xs font-bold text-blue-600 dark:text-blue-400">${t('marathon_undo')}</button>
                <button id="routeClear" type="button" class="min-h-[44px] min-w-[44px] px-3 rounded-md border border-red-200 dark:border-red-900 text-xs font-bold text-red-600 dark:text-red-400">${t('marathon_clear')}</button>
            </div>
          </div>
          <div id="routeButtons" class="bg-gray-50 dark:bg-gray-900/40 p-2 rounded-lg border dark:border-gray-700"></div>
          <div id="routePreview" class="min-h-[1.5rem] px-1 text-base font-bold tracking-widest dark:text-gray-200"></div>
          <input id="routeString" type="hidden">
        </div>

        <!-- STRAFF OCH ELIMINERING -->
        <div class="marathon-penalty-grid grid grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t dark:border-gray-700">
          <div id="knockdown-container" class="hidden">
            <label for="maratonKnockdowns" class="block text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">${t('marathon_knockdowns')}</label>
            <input type="number" inputmode="numeric" id="maratonKnockdowns" value="0" min="0" class="block w-full p-2 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
            <p class="mt-1 text-[10px] leading-tight text-gray-500 dark:text-gray-400">${t('marathon_knockdowns_help')}</p>
          </div>
          
          <div>
            <div class="flex items-center justify-between mb-1">
              <label for="maratonPenalty" class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">${t('marathon_other_penalty')}</label>
              <div class="flex flex-wrap justify-end gap-2">
                <button type="button" id="btnQuickPenaltyGroom" class="min-h-[44px] min-w-[44px] px-2 text-xs font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700 active:scale-95 transition-all" title="Groom avstigning (+5)">+5 Groom</button>
                <button type="button" id="btnQuickPenaltyCourse" class="min-h-[44px] min-w-[44px] px-2 text-xs font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700 active:scale-95 transition-all" title="Korrigerad fel väg (+20)">+20 Fel väg</button>
              </div>
            </div>
            <input type="number" inputmode="numeric" id="maratonPenalty" value="0" min="0" class="block w-full p-2 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label for="maratonHoldTime" class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">${t('marathon_hold_time')}</label>
              <div class="flex flex-wrap justify-end gap-2">
                <button type="button" id="btnQuickHold30" class="min-h-[44px] min-w-[44px] px-2 text-xs font-semibold rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300 dark:border-blue-700 active:scale-95 transition-all" title="+½ minut">+½</button>
                <button type="button" id="btnQuickHold60" class="min-h-[44px] min-w-[44px] px-2 text-xs font-semibold rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300 dark:border-blue-700 active:scale-95 transition-all" title="+1 minut">+1</button>
                <button type="button" id="btnQuickHold120" class="min-h-[44px] min-w-[44px] px-2 text-xs font-semibold rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300 dark:border-blue-700 active:scale-95 transition-all" title="+2 minuter">+2</button>
                <button type="button" id="btnQuickHoldClear" class="min-h-[44px] min-w-[44px] px-2 text-xs font-semibold rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-600 active:scale-95 transition-all" title="Nollställ">0</button>
              </div>
            </div>
            <input type="text" inputmode="decimal" id="maratonHoldTime" placeholder="min, t.ex. 2 eller 2,5" class="block w-full p-2 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
            <div class="mt-2 flex flex-wrap gap-2" id="holdReasonPills">
              <button type="button" data-hold-reason="Föregående ekipage i hinder" class="min-h-[44px] px-3 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 hover:text-blue-800 dark:hover:bg-blue-900/50 dark:hover:text-blue-200 border border-gray-200 dark:border-gray-600 transition-all">Föregående ekipage</button>
              <button type="button" data-hold-reason="Domar-/Banchefsstopp" class="min-h-[44px] px-3 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 hover:text-blue-800 dark:hover:bg-blue-900/50 dark:hover:text-blue-200 border border-gray-200 dark:border-gray-600 transition-all">Domarstopp</button>
              <button type="button" data-hold-reason="Hinderreparation" class="min-h-[44px] px-3 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 hover:text-blue-800 dark:hover:bg-blue-900/50 dark:hover:text-blue-200 border border-gray-200 dark:border-gray-600 transition-all">Hinderfel</button>
            </div>
          </div>

          <div class="flex items-end">
            <label for="maratonEliminated" class="flex items-center cursor-pointer px-3 border rounded hover:bg-red-50 dark:hover:bg-red-900/10 w-full min-h-[44px] transition-colors dark:border-gray-700">
              <input type="checkbox" id="maratonEliminated" class="h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500">
              <span class="ml-2 text-xs font-bold text-red-700 dark:text-red-400 uppercase">${t('marathon_elim')}</span>
            </label>
          </div>
        </div>

        <div class="pt-2">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
             <button type="button" class="toggle-btn comment-toggle-btn" data-target="comment">${t('marathon_comment_short')}</button>
             <div class="text-right">
                <span class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block">${t('marathon_total_obstacle_penalty')}</span>
                <span id="totalPenaltyDisplayMar" class="text-lg font-black text-brand-darkblue dark:text-blue-400">0.00</span>
             </div>
          </div>
          <div class="comment-wrapper">
            <textarea id="maratonComment" rows="1" maxlength="1000" class="block w-full p-2 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="${t('marathon_comment_placeholder')}"></textarea>
          </div>
        </div>
        
        <div class="pt-2">
            <button type="submit" class="marathon-save-btn w-full bg-emerald-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:bg-emerald-700 active:scale-[0.98] transition-all text-xl"> ${t('marathon_save_and_next')} </button>
            <button id="btnBackupMarJson" type="button" class="w-full mt-3 text-[10px] text-gray-400 hover:text-blue-500 flex items-center justify-center gap-1">
              <i class="fas fa-file-download"></i> ${t('marathon_export_json')} </button>
        </div>
      </form>
    </div>
  </div>
`;

  // Kör init EFTER att DOM-contenten ovan finns
  await setupPage(mySeq);
}


/**
 * Städas när sidan lämnas (för att inte störa t.ex. precision-input)
 */
// RAD FÖRE (ca 1370): /**

export function __unload() {
  loadSeq++;
  // Send what was typed but not sent yet (the debounce would otherwise drop it
  // when the page is left): both writes start at once, before state is reset
  const pendingComment = pendingLiveComment;
  clearLiveCommentSaveTimer();
  pendingLiveComment = null;
  flushPendingFormFields().catch((error) => console.error('Kunde inte skicka hinderformuläret live:', error));
  if (pendingComment != null && currentEquipage && currentObstacleNumber != null
    && (currentLiveState?.live_comment || '') !== pendingComment) {
    pushLiveSafe({ live_comment: pendingComment }).catch((error) => console.error('Kunde inte spara hinderkommentar live:', error));
  }
  releaseWakeLock();
  stopServerClockSync();
  document.body.style.filter = '';
  try {
    // Stoppa klockan/interval
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    setServerClockHold(false);
    if (boundHandlers.clockBadge) window.removeEventListener('serverclockchange', boundHandlers.clockBadge);

    // Stäng lyssnare mot Firestore
    if (typeof unsubObstacles === 'function') {
      try { unsubObstacles(); } catch { }
      unsubObstacles = null;
    }
    if (typeof unsubGlobalPause === 'function') {
      try { unsubGlobalPause(); } catch { }
      unsubGlobalPause = null;
    }
    if (unsubMaratonDoc) {
      try { unsubMaratonDoc(); } catch { }
      unsubMaratonDoc = null;
    }

    if (unsubMaratonList) {
      try { unsubMaratonList(); } catch { }
      unsubMaratonList = null;
    }

    // Ta bort DOM-lyssnare vi satte i setupPage()
    const rm = (sel, ev, fn) => {
      const el = byId(sel);
      if (el && typeof fn === 'function') {
        try { el.removeEventListener(ev, fn); } catch { }
      }
    };

    // NYTT: Ta bort de nya formulär-lyssnarna
    const form = byId('addMaratonResultForm');
    if (form) {
      if (boundHandlers.submitHandler) form.removeEventListener('submit', boundHandlers.submitHandler);
      if (boundHandlers.formInputHandler) form.removeEventListener('input', boundHandlers.formInputHandler);
      if (boundHandlers.formClickHandler) form.removeEventListener('click', boundHandlers.formClickHandler);
      if (boundHandlers.commentBlurHandler) form.removeEventListener('focusout', boundHandlers.commentBlurHandler);
      if (reapplyRemoteStateAfterEdit) form.removeEventListener('focusout', reapplyRemoteStateAfterEdit);
    }

    rm('maratonObstacleSelect', 'change', boundHandlers.obstacleChange);
    rm('prevEquipageMar', 'click', boundHandlers.prevClick);
    rm('nextEquipageMar', 'click', boundHandlers.nextClick);
    rm('btnStartMar', 'click', boundHandlers.startH);
    rm('btnStopMar', 'click', boundHandlers.stopH);
    rm('btnResetMar', 'click', boundHandlers.resetH);
    rm('btnManualOpenMar', 'click', boundHandlers.timerClick);
    rm('liveTimerMar', 'click', boundHandlers.timerClick);
    rm('btnManualCancelMar', 'click', boundHandlers.cancelClick);
    rm('btnManualApplyMar', 'click', boundHandlers.applyClick);
    rm('manualTimeDigitsMar', 'keydown', boundHandlers.manualTimeKeydown);
    rm('routeUndo', 'click', boundHandlers.routeUndo);
    rm('routeClear', 'click', boundHandlers.routeClear);

    // Stäng ev. dropdown
    if (equipageSearchDropdownMar?.destroy) {
      try { equipageSearchDropdownMar.destroy(); } catch { }
    }
    equipageSearchDropdownMar = null;
    cancelPendingLiveCommentSave();

    if (waitingTimerInterval) {
      clearInterval(waitingTimerInterval);
      waitingTimerInterval = null;
    }

    boundHandlers = {};
  } catch (e) {
    console.warn('maraton-input __unload cleanup issue:', e);
  }
  // The pending writes above have read what they need: re-entering the page
  // (perhaps another competition) must not act on this equipage and state
  resetModuleSelectionState();
}

function resetModuleSelectionState() {
  currentEquipage = null;
  currentLiveState = {};
  currentObstacleNumber = null;
  lastRemoteLiveData = null;
  lockedNoticeShownFor = null;
  isGloballyPaused = false;
  globalPauseStartTime = 0;
  globalPauseStatusKnown = false;
  lastPauseLog = [];
}

// A new version of the app asks before reloading while there is work on the
// obstacle page (see hasUnsavedObstacleWork)
registerUnsavedWork('maraton-input', () => hasUnsavedObstacleWork());
