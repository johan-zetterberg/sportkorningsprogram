// js/pages/observator-input.js
// Observatör – Maraton (combobox, start/stop, manuellt, ta bort halt) i stil med maraton-stages.

import { getGlobalState } from '../../main.js';
import { db, appId } from '../../config/firebase-config.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import {
  doc, getDoc, setDoc, serverTimestamp, onSnapshot, Timestamp, runTransaction,
  writeBatch, increment, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { awaitWriteOrQueue, queuedNotice } from '../../utils/offlineWrite.js';
import { t } from '../../utils/i18n.js';
import { registerUnsavedWork } from '../../utils/unsavedWork.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { trackWrite } from '../../services/firestoreService.js';
import { isFeiMarathonClass, wrongGaitIncidentPenalty } from '../../core-engine/marathon.js';
import { releaseWakeLock, requestWakeLock } from '../../utils/wakeLock.js';
import { serverNow, startServerClockSync, stopServerClockSync } from '../../utils/serverClock.js';

// ---------- State ----------
let competitionId = null;
let allEquipages = [];
let filtered = [];
let currentSn = null;

// Combobox state
let comboOpen = false;
let comboActiveIndex = -1;

// Fel gångart
let wrongGaitRunning = false;
let wrongGaitStartTs = 0; // epoch s
let wrongGaitAccum = 0;   // sekunder (ackumulerat)
// Each start–stop is one incident: TR V 523.1 penalises per incident
let wrongGaits = [];       // [{ atSec, durSec }]

// Halt
let haltRunning = false;
let haltStartTs = 0;      // epoch s
let halts = [];           // [{ atSec, durSec }]

// Notes
let notes = "";

// The section the observer follows ('A' | 'transport' | 'B'): each wrong-gait
// incident is stored with it (the penalty belongs to that section)
let observerSection = 'B';
let marathonConfig = null; // the class rule profile (TR/FEI) is stored per class
const OBSERVER_SECTIONS = [['A', 'A'], ['transport', 'Transport'], ['B', 'B']];
const sectionKey = () => `observerSection:${resolveCompetitionId()}`;
function loadObserverSection() {
  try {
    const saved = localStorage.getItem(sectionKey());
    if (OBSERVER_SECTIONS.some(([key]) => key === saved)) observerSection = saved;
  } catch (_) { /* no storage */ }
}

// Ticker
let liveTicker = null;
let unsubscribeGlobalPause = null;
let observerScrollHandler = null;
let loadToken = 0;

// Sökväg till vårt globala status-dokument
function globalStatusDocRef() {
  const cid = resolveCompetitionId();
  if (!cid) throw new Error('competitionId saknas');
  return doc(db, 'artifacts', appId, 'public', 'data', 'competitions', cid, 'config', 'globalStatus');
}

// As saveMarathonObstacleResult: a transaction on weak signal can hang for long
const PAUSE_TRANSACTION_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms);
    })
  ]);
}

// No (usable) connection, as opposed to a refusal such as permission-denied
function isConnectionError(error) {
  return ['unavailable', 'deadline-exceeded', 'failed-precondition'].includes(error?.code)
    || /offline|network/i.test(String(error?.message || ''));
}

// Funktioner för att pausa och återuppta.
// Pausloggen dras av från etapptiderna, så den uppdateras i en transaktion:
// två observatörer som trycker samtidigt kan inte skriva över varandra, och
// "pausa" under en öppen paus (eller "återuppta" utan paus) ändrar ingenting.
async function setGlobalPause(isPaused) {
  try {
    const statusRef = globalStatusDocRef();
    // The pause log is subtracted from stage times stamped in server time
    const now = new Date(serverNow());
    const statusText = isPaused ? t('observer_pause_time').replace('{time}', now.toLocaleTimeString('sv-SE')) : t('observer_resume');

    // Den nya pausloggen, eller null om inget ska ändras
    const nextPauseLog = (data) => {
      const pauseLog = (Array.isArray(data?.pauseLog) ? data.pauseLog : []).map(p => ({ ...p }));
      const openPause = pauseLog.find(p => p && p.end == null);
      if (isPaused) {
        if (openPause) return null; // redan pausat
        pauseLog.push({ start: now.toISOString(), end: null, durationSec: null });
      } else {
        if (!openPause) return null; // ingen pågående paus
        openPause.end = now.toISOString();
        openPause.durationSec = Math.round((now.getTime() - new Date(openPause.start).getTime()) / 1000);
      }
      return pauseLog;
    };
    const statusDoc = (pauseLog) => ({
      isPaused: !!isPaused,
      statusText: statusText,
      pauseLog: pauseLog, // Spara den uppdaterade loggen
      updatedAt: serverTimestamp()
    });

    // Transaktioner kräver nät. Offline: köa skrivningen som tidigare
    // (läser senast kända status), så att pausen inte går förlorad.
    const writeFromDeviceCopy = async () => {
      const docSnap = await getDoc(statusRef);
      const pauseLog = nextPauseLog(docSnap.exists() ? docSnap.data() : {});
      if (!pauseLog) return 'saved';
      // Not awaited until the server answers: the observer gets feedback now
      return awaitWriteOrQueue(trackWrite('Sparar tävlingspaus', setDoc(statusRef, statusDoc(pauseLog), { merge: true })), {
        onLateError: () => showAlert(t('observer_pause_error'), false)
      });
    };

    let queued = false;
    let slowSignal = false;
    if (navigator.onLine === false) {
      queued = (await writeFromDeviceCopy()) === 'queued';
    } else {
      const transactionDone = runTransaction(db, async (tx) => {
        const docSnap = await tx.get(statusRef);
        const pauseLog = nextPauseLog(docSnap.exists() ? docSnap.data() : {});
        if (pauseLog) tx.set(statusRef, statusDoc(pauseLog), { merge: true });
      });
      try {
        await withTimeout(transactionDone, PAUSE_TRANSACTION_TIMEOUT_MS);
      } catch (e) {
        if (!isConnectionError(e)) throw e;
        if (e?.message === 'timeout') {
          // Weak signal: the transaction is slow, not failed, and may still
          // commit. The observer is told now (the pause button no longer
          // hangs); the log is written from the device copy only if the
          // transaction itself fails for lack of connection, since a second
          // write of the whole log could erase another observer's entry
          slowSignal = true;
          transactionDone.catch(async (txError) => {
            if (!isConnectionError(txError)) {
              console.error('Kunde inte ändra paus-status:', txError);
              showAlert(t('observer_pause_error'), false);
              return;
            }
            try {
              await writeFromDeviceCopy();
            } catch (copyError) {
              console.error('Kunde inte ändra paus-status:', copyError);
              showAlert(t('observer_pause_error'), false);
            }
          });
        } else {
          queued = (await writeFromDeviceCopy()) === 'queued';
        }
      }
    }

    if (slowSignal) {
      // Not on the device yet (a transaction is applied only when it commits)
      showAlert(`${statusText} (svag täckning – skickas så snart förbindelsen räcker; kontrollera att pausknappen växlar)`, 'offline');
      return;
    }
    showAlert(`${statusText}${queuedNotice(queued ? 'queued' : 'saved')}`, queued ? 'offline' : true);
  } catch (e) {
    console.error("Kunde inte ändra paus-status:", e);
    showAlert(t('observer_pause_error'), false);
  }
}

function listenForGlobalPause(root) {
  const pauseBtn = qs('#btnEmergencyPause', root);
  const resumeBtn = qs('#btnEmergencyResume', root);
  const statusTextEl = qs('#pause-status-text', root);
  const logContainer = qs('#pause-log-container', root);

  return onSnapshot(globalStatusDocRef(), (docSnap) => {
    const data = docSnap.exists() ? docSnap.data() : {};
    const isPaused = data.isPaused === true;

    if (pauseBtn) pauseBtn.classList.toggle('hidden', isPaused);
    if (resumeBtn) resumeBtn.classList.toggle('hidden', !isPaused);

    if (statusTextEl) {
      statusTextEl.textContent = isPaused ? (data.statusText || t('observer_is_paused')) : '';
      statusTextEl.className = isPaused ? 'text-sm font-semibold mt-2 text-red-800' : '';
    }

    // Rendera historiken
    if (logContainer && Array.isArray(data.pauseLog)) {
      logContainer.innerHTML = data.pauseLog.map((p, i) => {
        const startTime = new Date(p.start).toLocaleTimeString('sv-SE');
        const endTime = p.end ? new Date(p.end).toLocaleTimeString('sv-SE') : t('observer_ongoing');
        // A number only: the log is written by any marathon official
        const durationSec = Math.round(Number(p.durationSec));
        const duration = Number.isFinite(durationSec) && durationSec > 0 ? t('observer_seconds').replace('{sec}', String(durationSec)) : '-';
        return `
          <div class="text-[10px] text-gray-500 font-medium">
            ${t('observer_pause_log_item').replace('{index}', i + 1).replace('{startTime}', startTime).replace('{endTime}', endTime).replace('{duration}', duration)}
          </div>
        `;
      }).join('');
    }
  });
}

// ---------- Helpers ----------
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const nowSec = () => Math.floor(Date.now() / 1000);
const toInt = (v) => Number.isFinite(+v) ? +v : 0;

function fmtMMSS(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const mm = Math.floor(s / 60), ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function parseMMSSorSeconds(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^\d+:[0-5]?\d$/.test(s)) {
    const [m, sec] = s.split(':');
    return (+m) * 60 + (+sec);
  }
  if (/^\d+$/.test(s)) return +s;
  return null;
}
const safeLower = (x) => (x == null ? '' : String(x)).toLowerCase();

function normalizeEquipage(e) {
  const startNumber = Number(e?.startNumber ?? e?.startnr ?? e?.nr ?? e?.start ?? 0);
  const driverName = e?.driverName ?? e?.driver ?? e?.kusk ?? e?.name ?? '';
  const className = e?.className ?? e?.class ?? e?.klass ?? '';
  const clubName = e?.clubName ?? e?.club ?? e?.association ?? '';
  const horse = e?.horseName || e?.horse || '';
  return { ...e, startNumber, driverName, className, clubName, horse };
}

function resolveCompetitionId() {
  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id || window.currentCompetitionId || window.competitionId || competitionId || null;
  return competitionId;
}

// Firestore doc
function summaryDocRef(sn) {
  const cid = resolveCompetitionId();
  if (!cid) throw new Error('competitionId saknas');
  if (!appId) throw new Error('appId saknas');
  return doc(db, 'artifacts', appId, 'public', 'data', 'competitions', cid, 'maraton', String(sn));
}

async function readObserverLog(sn) {
  const snap = await getDoc(summaryDocRef(sn));
  if (!snap.exists()) return { wrongGaitSeconds: 0, wrongGaits: [], halts: [], notes: "" };
  return snap.data().observerLog || { wrongGaitSeconds: 0, wrongGaits: [], halts: [], notes: "" };
}
function normalizeObserverLog(log) {
  return {
    wrongGaitSeconds: Math.max(0, Math.round(toInt(log?.wrongGaitSeconds))),
    wrongGaits: (Array.isArray(log?.wrongGaits) ? log.wrongGaits : []).map(w => ({
      atSec: Math.max(0, Math.round(toInt(w?.atSec))),
      durSec: Math.max(0, Math.round(toInt(w?.durSec))),
      ...(w?.section ? { section: String(w.section) } : {})
    })),
    halts: (Array.isArray(log?.halts) ? log.halts : []).map(h => ({
      atSec: Math.max(0, Math.round(toInt(h?.atSec))),
      durSec: Math.max(0, Math.round(toInt(h?.durSec)))
    })),
    notes: String(log?.notes || '').trim()
  };
}

// What this device last read or saved per start number. Saves send only the
// change from it (seconds added, halts added or removed, a changed note), so a
// second observer's entries, or a log that could not be read (offline), are
// never overwritten by this device's copy.
const logBaselines = new Map();
const emptyLog = () => ({ wrongGaitSeconds: 0, wrongGaits: [], halts: [], notes: '' });
const haltKey = (h) => `${h.atSec}:${h.durSec}`;
// A wrong-gait incident also by its section (arrayRemove needs the stored object)
const wgKey = (w) => `${w.atSec}:${w.durSec}:${w.section || ''}`;

function setLogBaseline(sn, log) {
  logBaselines.set(String(sn), normalizeObserverLog(log));
}

async function writeObserverLog(sn, log) {
  const next = normalizeObserverLog(log);
  const base = logBaselines.get(String(sn)) || emptyLog();
  const ref = summaryDocRef(sn);
  const batch = writeBatch(db);
  let changed = false;

  const fields = {};
  const addedSeconds = next.wrongGaitSeconds - base.wrongGaitSeconds;
  if (addedSeconds !== 0) { fields.wrongGaitSeconds = increment(addedSeconds); changed = true; }
  if (next.notes !== base.notes) { fields.notes = next.notes; changed = true; }
  if (Object.keys(fields).length) {
    batch.set(ref, { observerLog: fields, updatedAt: serverTimestamp() }, { merge: true });
  }

  const baseKeys = new Set(base.halts.map(haltKey));
  const nextKeys = new Set(next.halts.map(haltKey));
  const removed = base.halts.filter(h => !nextKeys.has(haltKey(h)));
  const added = next.halts.filter(h => !baseKeys.has(haltKey(h)));
  // Removing and adding are separate writes on the same field (an edited halt is both)
  if (removed.length) { batch.set(ref, { observerLog: { halts: arrayRemove(...removed) } }, { merge: true }); changed = true; }
  if (added.length) { batch.set(ref, { observerLog: { halts: arrayUnion(...added) }, updatedAt: serverTimestamp() }, { merge: true }); changed = true; }

  const baseWg = new Set(base.wrongGaits.map(wgKey));
  const nextWg = new Set(next.wrongGaits.map(wgKey));
  const removedWg = base.wrongGaits.filter(w => !nextWg.has(wgKey(w)));
  const addedWg = next.wrongGaits.filter(w => !baseWg.has(wgKey(w)));
  if (removedWg.length) { batch.set(ref, { observerLog: { wrongGaits: arrayRemove(...removedWg) } }, { merge: true }); changed = true; }
  if (addedWg.length) { batch.set(ref, { observerLog: { wrongGaits: arrayUnion(...addedWg) }, updatedAt: serverTimestamp() }, { merge: true }); changed = true; }

  if (!changed) return;
  // The baseline moves at once: the next save sends only what comes after this
  logBaselines.set(String(sn), next);
  try {
    await trackWrite(`Sparar observatörslogg #${sn}`, batch.commit());
  } catch (err) {
    // Refused by the server: what this batch sent is not stored, so the next
    // save must send it again. Undo only this batch's change on the baseline
    // as it is now: a newer save may already have moved it, and restoring
    // the old baseline would then send that newer change twice (increment)
    // or drop a still pending one.
    const current = logBaselines.get(String(sn)) || emptyLog();
    if (current === next) {
      logBaselines.set(String(sn), base);
    } else {
      const without = (list, gone) => {
        const keys = new Set(gone.map(haltKey));
        return list.filter(item => !keys.has(haltKey(item)));
      };
      const withBack = (list, back) => {
        const keys = new Set(list.map(haltKey));
        return [...list, ...back.filter(item => !keys.has(haltKey(item)))];
      };
      logBaselines.set(String(sn), {
        wrongGaitSeconds: current.wrongGaitSeconds - addedSeconds,
        wrongGaits: withBack(without(current.wrongGaits, addedWg), removedWg),
        halts: withBack(without(current.halts, added), removed),
        notes: (next.notes !== base.notes && current.notes === next.notes) ? base.notes : current.notes
      });
    }
    throw err;
  }
}

// ---------- Combobox helpers ----------
function comboFormatLabel(e) {
  return `#${e.startNumber} • ${e.driverName}${e.className ? ' • ' + e.className : ''}`;
}
function setComboValue(container, e) {
  const inp = qs('#eqComboInput', container);
  if (inp) inp.value = e ? comboFormatLabel(e) : '';
}
function openCombo(container) {
  comboOpen = true;
  const list = qs('#eqComboList', container);
  if (list) list.classList.remove('hidden');
}
function closeCombo(container) {
  comboOpen = false;
  comboActiveIndex = -1;
  const list = qs('#eqComboList', container);
  if (list) list.classList.add('hidden');
}
function rebuildComboList(container) {
  const list = qs('#eqComboList', container);
  if (!list) return;
  if (!Array.isArray(filtered)) filtered = [];
  const items = filtered.slice(0, 30).map((e, i) => `
    <div class="eq-option px-4 py-3 border-b dark:border-gray-700 last:border-0 ${i === comboActiveIndex ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'dark:text-gray-200'} cursor-pointer" role="option" data-sn="${escapeHtml(e.startNumber)}" data-i="${i}">
      <div class="font-bold">#${escapeHtml(e.startNumber)} ${escapeHtml(e.driverName)}</div>
      <div class="text-[10px] text-gray-500 uppercase tracking-tighter">${escapeHtml(e.className || '')}</div>
    </div>
  `).join('');
  list.innerHTML = items || `<div class="px-4 py-3 text-gray-500 dark:text-gray-400">${t('observer_no_matches')}</div>`;
}
function filterEquipages(term) {
  const q = safeLower(term);
  if (!q) { filtered = allEquipages.slice(); return; }
  filtered = allEquipages.filter(e =>
    String(e.startNumber).includes(q) ||
    safeLower(e.driverName).includes(q) ||
    safeLower(e.className).includes(q)
  );
}

// A running wrong-gait or halt timer is kept on the device, so a reload or
// the phone closing the app does not lose it; opening the equipage resumes it
const runningKey = (sn) => `observerRunning:${resolveCompetitionId()}:${sn}`;

function persistRunning() {
  if (!currentSn) return;
  try {
    if (wrongGaitRunning || haltRunning) {
      localStorage.setItem(runningKey(currentSn), JSON.stringify({
        wrongGaitStartTs: wrongGaitRunning ? wrongGaitStartTs : null,
        haltStartTs: haltRunning ? haltStartTs : null
      }));
    } else {
      localStorage.removeItem(runningKey(currentSn));
    }
  } catch (_) { /* no storage */ }
}

function restoreRunning(sn) {
  try {
    const saved = JSON.parse(localStorage.getItem(runningKey(sn)) || 'null');
    if (!saved) return false;
    if (Number.isFinite(saved.wrongGaitStartTs)) { wrongGaitRunning = true; wrongGaitStartTs = saved.wrongGaitStartTs; }
    if (Number.isFinite(saved.haltStartTs)) { haltRunning = true; haltStartTs = saved.haltStartTs; }
    return wrongGaitRunning || haltRunning;
  } catch (_) {
    return false;
  }
}
// Bumped on every selection: a slow read for the previous equipage must not
// load its log into the one selected now (the next save would store it there)
let selectionSeq = 0;

async function onEquipageSelected(sn, container) {
  const mySelection = ++selectionSeq;
  const previousSn = currentSn;

  // A running halt or wrong-gait timer belongs to the previous equipage: stop
  // it and save it there instead of dropping it
  if (previousSn && previousSn !== String(sn ?? '') && (haltRunning || wrongGaitRunning)) {
    if (haltRunning) halts.push({ atSec: haltStartTs, durSec: Math.max(0, nowSec() - haltStartTs) });
    if (wrongGaitRunning) endWrongGaitIncident();
    const previousLog = { wrongGaitSeconds: wrongGaitAccum, wrongGaits: [...wrongGaits], halts: [...halts], notes: qs('#notesField', container)?.value ?? notes };
    try { localStorage.removeItem(runningKey(previousSn)); } catch (_) { }
    awaitWriteOrQueue(writeObserverLog(previousSn, previousLog), {
      onLateError: () => showAlert(`#${previousSn}: observatörsloggen nekades av servern när den skickades.`, false)
    }).catch((e) => {
      console.error('Kunde inte spara observatörslogg vid byte:', e);
      showAlert(`#${previousSn}: observatörsloggen kunde inte sparas.`, false);
    });
  }

  currentSn = sn ? String(sn) : null;
  const eq = findEquipageBySn(currentSn);

  // Sticky header updates
  const stickySn = qs('#stickySn', container);
  const stickyName = qs('#stickyName', container);
  const stickyHeader = qs('#stickyHeader', container);

  if (stickySn) stickySn.textContent = currentSn ? `#${currentSn}` : '#--';
  if (stickyName) stickyName.textContent = eq ? eq.driverName : 'Välj ekipage';
  if (stickyHeader) stickyHeader.classList.toggle('hidden', !currentSn);

  // nollställ lokalt
  wrongGaitRunning = false; wrongGaitStartTs = 0; wrongGaitAccum = 0; wrongGaits = [];
  haltRunning = false; haltStartTs = 0; halts = [];
  notes = "";

  stopTicker();
  updateWrongGaitUI(container);
  renderHalts(container);

  const status = qs('#statusMsg', container);
  if (!currentSn) {
    setButtonsEnabled(container, false);
    if (status) status.textContent = t('observer_select_to_note');
    return;
  }
  try {
    const log = await readObserverLog(currentSn);
    if (mySelection !== selectionSeq) return;
    setLogBaseline(currentSn, log);
    wrongGaitAccum = Math.max(0, toInt(log.wrongGaitSeconds));
    wrongGaits = Array.isArray(log.wrongGaits) ? log.wrongGaits.map(w => ({
      atSec: Math.max(0, toInt(w.atSec)),
      durSec: Math.max(0, toInt(w.durSec)),
      ...(w.section ? { section: String(w.section) } : {})
    })) : [];
    halts = Array.isArray(log.halts) ? log.halts.map(h => ({
      atSec: Math.max(0, toInt(h.atSec)),
      durSec: Math.max(0, toInt(h.durSec))
    })) : [];
    notes = String(log.notes || '');
    const notesEl = qs('#notesField', container);
    if (notesEl) notesEl.value = notes;

    restoreRunning(currentSn);
    setButtonsEnabled(container, true);
    ensureTicker(container);
    updateWrongGaitUI(container);
    renderHalts(container);
    if (status) status.textContent = '';
  } catch (e) {
    console.error('Kunde inte läsa observerLog:', e);
    if (mySelection !== selectionSeq) return;
    // Not read (offline and not on the device): start from nothing here. Saves
    // only add to the log, so what is already saved is kept
    setLogBaseline(currentSn, emptyLog());
    restoreRunning(currentSn);
    updateWrongGaitUI(container);
    renderHalts(container);
    if (status) status.textContent = t('observer_read_error_additive');
    setButtonsEnabled(container, true);
    ensureTicker(container);
  }
}

// ---------- Styles ----------
function injectObserverStyles() {
  if (document.getElementById('observer-styles')) return;
  const s = document.createElement('style');
  s.id = 'observer-styles';
  s.textContent = `
    .obs-card {
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }
    .obs-card.active-timer {
      border-color: #10b981;
      box-shadow: 0 0 15px rgba(16, 185, 129, 0.2);
    }
    .obs-card.active-halt {
      border-color: #f43f5e;
      box-shadow: 0 0 15px rgba(244, 63, 94, 0.2);
    }
    .pulse-glow {
      animation: pulse-glow 2s infinite;
    }
    @keyframes pulse-glow {
      0% { opacity: 0.1; transform: scale(0.95); }
      50% { opacity: 0.3; transform: scale(1.05); }
      100% { opacity: 0.1; transform: scale(0.95); }
    }
    .sticky-obs-header {
      position: sticky;
      top: 0;
      z-index: 30;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: all 0.3s ease;
    }
    .obs-touch-btn {
      min-height: 48px;
    }
    @media (min-width: 640px) and (orientation: landscape) {
      .obs-main-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }
      .obs-side-panel {
        display: grid;
        grid-template-rows: auto 1fr;
      }
    }
    .manual-overlay {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(4px);
    }
    html.dark .manual-overlay {
      background: rgba(31, 41, 55, 0.9);
    }
    .custom-scrollbar::-webkit-scrollbar { width: 4px; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
  `;
  document.head.appendChild(s);
}

// ---------- UI ----------
function render(container) {
  const comp = getGlobalState('currentCompetition');
  injectObserverStyles();

  container.innerHTML = `
    <div class="min-h-screen bg-gray-50 dark:bg-gray-950 pb-20">
      
      <!-- Sticky Header for Mobil -->
      <div id="stickyHeader" class="sticky-obs-header bg-white/80 dark:bg-gray-900/80 border-b dark:border-gray-800 px-4 py-2 hidden shadow-sm">
        <div class="container mx-auto max-w-2xl flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span id="stickySn" class="bg-blue-600 text-white font-black px-2 py-0.5 rounded text-sm">#--</span>
            <span id="stickyName" class="font-bold text-gray-900 dark:text-white text-sm truncate max-w-[150px]">${t('observer_select_equipage')}</span>
          </div>
          <div id="stickyStatus" class="flex gap-2"></div>
        </div>
      </div>

      <div class="container mx-auto p-4 md:p-8 max-w-4xl">
        <div class="mb-6">
          ${getCompetitionHeader(comp, 'Observatör', { quickGuideRole: 'observer' })}
        </div>

        <!-- Emergency Pause (Compact/Premium) -->
        <div class="mb-6">
          <button id="toggleEmergency" class="w-full flex items-center justify-between p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 text-red-700 dark:text-red-400 font-bold transition-all hover:bg-red-100/50">
            <span class="flex items-center gap-2 text-sm text-red-800 dark:text-red-300">
              <i class="fas fa-exclamation-triangle"></i>
              NÖD-PAUS / TÄVLINGSSTATUS
            </span>
            <i class="fas fa-chevron-down transition-transform"></i>
          </button>
          
          <div id="emergency-panel" class="hidden mt-2 p-4 bg-white dark:bg-gray-900 rounded-2xl border-2 border-red-500 shadow-xl overflow-hidden">
             <div class="flex flex-col md:flex-row gap-4">
                <div class="flex-1">
                   <h3 class="font-black text-red-600 uppercase text-[10px] tracking-widest mb-1">${t('observer_pause_accident')}</h3>
                   <p class="text-[10px] text-gray-500 mb-4">${t('observer_pause_all_desc')}</p>
                   <div class="flex gap-2">
                      <button id="btnEmergencyPause" class="flex-1 obs-touch-btn rounded-xl bg-red-600 text-white font-black hover:bg-red-700 transition-all shadow-lg active:scale-95 text-xs">${t('observer_stop_all')}</button>
                      <button id="btnEmergencyResume" class="flex-1 obs-touch-btn rounded-xl bg-emerald-600 text-white font-black hidden hover:bg-emerald-700 transition-all shadow-lg active:scale-95 text-xs">${t('observer_resume_all')}</button>
                   </div>
                </div>
                <div class="flex-1 border-t md:border-t-0 md:border-l dark:border-gray-800 pt-4 md:pt-0 md:pl-4">
                   <div id="pause-status-text" class="text-sm font-bold mb-2"></div>
                   <div id="pause-log-container" class="space-y-1 max-h-32 overflow-auto custom-scrollbar"></div>
                </div>
             </div>
          </div>
        </div>

        <div class="obs-main-grid space-y-6 sm:space-y-0">
          
          <!-- Column 1: Selector & Timing -->
          <div class="space-y-6">
            <!-- Search & Selector -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm">
              <label class="block text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 tracking-widest mb-2">${t('observer_select_startnumber')}</label>
              <div class="relative" role="combobox" aria-expanded="false">
                <div class="flex gap-2">
                  <button id="prevEqBtn" type="button" aria-label="Föregående ekipage" class="w-12 h-12 flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-all active:scale-90">
                    <i class="fas fa-chevron-left text-gray-500 dark:text-gray-300" aria-hidden="true"></i>
                  </button>
                  <div class="relative flex-1">
                    <input id="eqComboInput" type="text" aria-label="${t('observer_select_startnumber')}"
                      class="w-full border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 rounded-xl px-4 h-12 text-base font-bold dark:text-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                      placeholder="${t('observer_search_placeholder')}" />
                    <div id="eqComboList" class="absolute mt-2 left-0 right-0 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-2xl shadow-2xl max-h-80 overflow-auto hidden z-50 overflow-hidden"></div>
                  </div>
                  <button id="nextEqBtn" type="button" aria-label="Nästa ekipage" class="w-12 h-12 flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-all active:scale-90">
                    <i class="fas fa-chevron-right text-gray-500 dark:text-gray-300" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
              <div id="statusMsg" class="mt-2 text-[11px] font-bold text-amber-600 text-center min-h-[1rem]"></div>
            </div>

            <!-- Sträcka som observatören följer -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-3 shadow-sm">
              <span class="block text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 tracking-widest mb-2">Sträcka (fel gångart räknas på den)</span>
              <div id="obsSectionButtons" class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Sträcka">
                ${OBSERVER_SECTIONS.map(([key, label]) => `<button type="button" role="radio" data-section="${key}" class="obs-section-btn min-h-[44px] rounded-xl border dark:border-gray-700 font-bold text-sm">${label}</button>`).join('')}
              </div>
            </div>

            <!-- Reglage Grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Wrong Gait -->
              <div id="wgCard" class="obs-card bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 tracking-widest">${t('observer_wrong_gait')}</span>
                  <i class="fas fa-running text-gray-200 dark:text-gray-700"></i>
                </div>
                <div id="wgVal" role="button" tabindex="0" data-kbd-click class="text-4xl font-black tabular-nums dark:text-white mb-6 text-center cursor-pointer hover:text-blue-500 transition-colors">00:00</div>
                <div class="flex gap-2">
                  <button id="btnWgStart" class="flex-1 obs-touch-btn rounded-xl bg-emerald-600 text-white font-black hover:bg-emerald-700 disabled:opacity-20 transition-all active:scale-95 shadow-md shadow-emerald-600/20">${t('observer_start')}</button>
                  <button id="btnWgStop" class="flex-1 obs-touch-btn rounded-xl bg-rose-600 text-white font-black hover:bg-rose-700 disabled:opacity-20 transition-all active:scale-95 shadow-md shadow-rose-600/20">${t('observer_stop')}</button>
                </div>
                <div id="wgList" class="mt-3 space-y-1.5"></div>
                
                <!-- Manual Overlay -->
                <div id="wgManual" class="manual-overlay hidden absolute inset-0 z-10 p-5 flex flex-col justify-center items-center">
                   <h4 class="text-xs font-black uppercase text-gray-500 dark:text-gray-400 mb-2">${t('observer_add_wrong_gait')}</h4>
                   <input id="wgManualInput" class="w-full h-12 text-center text-xl font-bold bg-white dark:bg-gray-801 border-2 border-blue-500 rounded-xl mb-4 dark:text-white" placeholder="mm:ss" />
                   <div class="flex gap-2 w-full">
                      <button id="wgManualApply" class="flex-1 h-10 rounded-lg bg-blue-600 text-white font-bold">${t('observer_ok')}</button>
                      <button id="wgManualCancel" class="flex-1 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-bold">${t('observer_cancel')}</button>
                   </div>
                </div>
              </div>

              <!-- Halt -->
              <div id="haltCard" class="obs-card bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 tracking-widest">${t('observer_halt')}</span>
                  <i class="fas fa-hand-paper text-gray-200 dark:text-gray-700"></i>
                </div>
                <div id="haltLive" class="text-4xl font-black tabular-nums text-gray-900 dark:text-white mb-6 text-center">—</div>
                <div class="flex gap-2">
                  <button id="btnHaltStart" class="flex-1 obs-touch-btn rounded-xl bg-emerald-600 text-white font-black hover:bg-emerald-700 disabled:opacity-20 transition-all active:scale-95 shadow-md shadow-emerald-600/20">${t('observer_start')}</button>
                  <button id="btnHaltStop" class="flex-1 obs-touch-btn rounded-xl bg-rose-600 text-white font-black hover:bg-rose-700 disabled:opacity-20 transition-all active:scale-95 shadow-md shadow-rose-600/20">${t('observer_stop')}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Column 2: Halts & Notes -->
          <div class="space-y-6 obs-side-panel">
            <!-- Halt Lista -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm h-fit">
               <div class="flex justify-between items-center mb-4">
                  <span class="text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 tracking-widest">${t('observer_halt_log')}</span>
                  <button id="btnHaltManualOpen" class="min-h-[44px] text-[10px] font-black text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 uppercase px-3 disabled:opacity-20" disabled>${t('observer_manual_add')}</button>
               </div>
               
               <div id="haltList" class="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                  <div class="text-gray-400 text-xs italic text-center py-4">${t('observer_no_halts_yet')}</div>
               </div>

               <!-- Manual Halt Input Tray -->
               <div id="haltManualWrapper" class="hidden mt-3 p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-xl space-y-3">
                  <input id="haltManualInput" class="w-full h-10 text-center font-bold rounded-lg border dark:border-gray-600 dark:bg-gray-800 dark:text-white" placeholder="${t('observer_manual_halt_placeholder')}" />
                  <div class="flex gap-2">
                    <button id="haltManualApply" class="flex-1 h-10 bg-blue-600 text-white rounded-lg font-bold text-xs uppercase">${t('observer_add')}</button>
                    <button id="haltManualCancel" class="flex-1 h-10 bg-white dark:bg-gray-800 text-gray-500 rounded-lg font-bold text-xs uppercase">${t('observer_close')}</button>
                  </div>
               </div>
            </div>

            <!-- Anteckningar -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm">
               <span class="text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 tracking-widest block mb-4">${t('observer_notes')}</span>
               <textarea id="notesField" rows="4" aria-label="${t('observer_notes')}" class="w-full bg-gray-50 dark:bg-gray-900/50 border dark:border-gray-700 rounded-xl p-3 text-sm dark:text-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all resize-none" placeholder="${t('observer_notes_placeholder')}"></textarea>
               <div id="notesSaveStatus" class="flex items-center justify-end gap-1 mt-2 text-[10px] font-bold text-gray-400"></div>
            </div>

            <!-- Manual Save (Backup) -->
            <div class="flex gap-4">
               <button id="btnObsSave" class="flex-1 h-12 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-300 transition-all disabled:opacity-20" disabled>${t('observer_save_manually')}</button>
               <div id="saveMsg" class="flex items-center text-xs font-bold text-emerald-600"></div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
}

function renderHalts(container) {
  const list = qs('#haltList', container);
  const live = qs('#haltLive', container);
  const card = qs('#haltCard', container);
  const stickyStatus = qs('#stickyStatus', container);

  if (!list || !live) return;

  if (haltRunning) {
    card?.classList.add('active-halt', 'border-rose-500');
    live.classList.add('text-rose-600');
    live.textContent = fmtMMSS(nowSec() - haltStartTs);
    if (stickyStatus) stickyStatus.innerHTML = `<span class="bg-rose-600 text-white text-[10px] px-1.5 rounded font-black animate-pulse">HALT</span>`;
  } else {
    card?.classList.remove('active-halt', 'border-rose-500');
    live.classList.remove('text-rose-600');
    live.textContent = '—';
    if (stickyStatus && !wrongGaitRunning) stickyStatus.innerHTML = '';
  }

  if (halts.length === 0) {
    list.innerHTML = `<div class="text-gray-400 text-xs italic text-center py-4">${t('observer_no_halts_yet')}</div>`;
  } else {
    list.innerHTML = halts.map((h, i) => `
        <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-900 p-2.5 rounded-xl border dark:border-gray-800 shadow-xs group">
          <div class="min-w-0">
             <div class="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-tighter">${t('observer_halt_n').replace('{n}', i + 1)}</div>
             <div class="font-bold tabular-nums text-gray-900 dark:text-white">${fmtMMSS(h.durSec)} <span class="text-xs text-gray-400 font-medium ml-1">${fmtTime(h.atSec)}</span></div>
          </div>
          <div class="flex gap-3 shrink-0">
            <button type="button" class="btnEditHalt w-11 h-11 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 flex items-center justify-center" data-i="${i}" aria-label="Ändra halt ${i + 1}"><i class="fas fa-edit text-xs" aria-hidden="true"></i></button>
            <button type="button" class="btnDelHalt w-11 h-11 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 flex items-center justify-center" data-i="${i}" aria-label="Ta bort halt ${i + 1}"><i class="fas fa-trash text-xs" aria-hidden="true"></i></button>
          </div>
        </div>
      `).join('');
  }
}

function fmtTime(sec) {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderSectionButtons(container) {
  qsa('.obs-section-btn', container).forEach(btn => {
    const active = btn.dataset.section === observerSection;
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
    btn.classList.toggle('bg-brand-darkblue', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('dark:text-gray-200', !active);
  });
}

function setButtonsEnabled(container, enabled) {
  ['#btnWgStart', '#btnWgStop', '#btnHaltStart', '#btnHaltStop', '#btnObsSave', '#btnHaltManualOpen'].forEach(id => {
    const el = qs(id, container);
    if (el) el.disabled = !enabled;
  });
}

function updateWrongGaitUI(container) {
  const el = qs('#wgVal', container);
  const card = qs('#wgCard', container);
  const stickyStatus = qs('#stickyStatus', container);
  if (!el) return;

  const base = wrongGaitAccum;
  const extra = wrongGaitRunning ? (nowSec() - wrongGaitStartTs) : 0;
  const total = base + extra;

  el.textContent = fmtMMSS(total);
  renderWrongGaits(container);

  if (wrongGaitRunning) {
    card?.classList.add('active-timer', 'border-emerald-500');
    el.classList.add('text-emerald-600');
    if (stickyStatus) {
      const haltHtml = haltRunning ? `<span class="bg-rose-600 text-white text-[10px] px-1.5 rounded font-black mr-1">HALT</span>` : '';
      stickyStatus.innerHTML = `${haltHtml}<span class="bg-emerald-600 text-white text-[10px] px-1.5 rounded font-black animate-pulse">GÅNGART</span>`;
    }
  } else {
    card?.classList.remove('active-timer', 'border-emerald-500');
    el.classList.remove('text-emerald-600');
    if (stickyStatus && !haltRunning) stickyStatus.innerHTML = '';
  }
}

function endWrongGaitIncident() {
  const durSec = Math.max(0, nowSec() - wrongGaitStartTs);
  wrongGaits.push({ atSec: wrongGaitStartTs, durSec, section: observerSection });
  wrongGaitAccum += durSec;
  wrongGaitRunning = false; wrongGaitStartTs = 0;
}

function renderWrongGaits(container) {
  const list = qs('#wgList', container);
  if (!list) return;
  const className = findEquipageBySn(currentSn)?.className;
  const fei = isFeiMarathonClass(className, marathonConfig);
  const earlierSec = Math.max(0, wrongGaitAccum - wrongGaits.reduce((sum, w) => sum + w.durSec, 0));
  const sectionLabel = (s) => (OBSERVER_SECTIONS.find(([key]) => key === s) || [null, ''])[1];
  const row = (label, durSec, i, section = null) => `
        <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-900 px-2.5 py-1.5 rounded-lg border dark:border-gray-800">
          <div class="text-xs"><span class="font-bold text-gray-500 dark:text-gray-400">${escapeHtml(label)}</span>
            <span class="font-bold tabular-nums text-gray-900 dark:text-white ml-1">${fmtMMSS(durSec)}</span>
            <span class="text-gray-500 ml-1">→ ${wrongGaitIncidentPenalty(durSec, { fei })} p</span>${section ? ` <span class="ml-1 text-[10px] font-bold uppercase text-gray-500">(${escapeHtml(sectionLabel(section))})</span>` : ''}</div>
          ${i == null ? '' : `<button type="button" class="btnDelWg w-11 h-11 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 flex items-center justify-center" data-i="${i}" aria-label="${escapeHtml(t('observer_remove_wrong_gait_confirm'))}"><i class="fas fa-trash text-[10px]"></i></button>`}
        </div>`;
  const rows = wrongGaits.map((w, i) => row(t('observer_wrong_gait_n').replace('{n}', i + 1), w.durSec, i, w.section));
  if (earlierSec > 0) rows.unshift(row(t('observer_wrong_gait_earlier'), earlierSec, null));
  list.innerHTML = rows.length
    ? rows.join('')
    : `<div class="text-gray-400 text-[11px] italic text-center">${escapeHtml(t('observer_no_wrong_gaits_yet'))}</div>`;
}

function ensureTicker(container) {
  if (liveTicker) return;
  liveTicker = setInterval(() => {
    updateWrongGaitUI(container);
    renderHalts(container);
  }, 200);
}
function stopTicker() {
  if (liveTicker) { clearInterval(liveTicker); liveTicker = null; }
}

// ---------- Events ----------
function wire(container) {
  const status = qs('#statusMsg', container);
  const notesEl = qs('#notesField', container);
  const btnSave = qs('#btnObsSave', container);

  function selectPrevNext(dir) {
    if (!allEquipages.length) return;
    let idx = currentSn ? allEquipages.findIndex(e => String(e.startNumber) === String(currentSn)) : -1;
    if (idx === -1) idx = (dir > 0 ? -1 : 0);
    idx = Math.max(0, Math.min(allEquipages.length - 1, idx + (dir > 0 ? 1 : -1)));
    const e = allEquipages[idx];
    setComboValue(container, e);
    closeCombo(container);
    onEquipageSelected(e.startNumber, container);
  }

  // === Toggle Emergency Panel ===
  const btnToggleEmergency = qs('#toggleEmergency', container);
  const emergencyPanel = qs('#emergency-panel', container);
  if (btnToggleEmergency && emergencyPanel) {
    btnToggleEmergency.addEventListener('click', () => {
      const isHidden = emergencyPanel.classList.toggle('hidden');
      if (btnToggleEmergency.querySelector('.fa-chevron-down')) {
         btnToggleEmergency.querySelector('.fa-chevron-down').classList.toggle('rotate-180', !isHidden);
      }
    });
  }

  // === Sticky Header Scroll Behavior ===
  const stickyHeader = qs('#stickyHeader', container);
  if (observerScrollHandler) {
    window.removeEventListener('scroll', observerScrollHandler);
  }
  observerScrollHandler = () => {
    if (stickyHeader && currentSn) {
      if (window.scrollY > 150) {
        stickyHeader.classList.add('py-3', 'shadow-md');
        stickyHeader.querySelector('div')?.classList.add('scale-105');
      } else {
        stickyHeader.classList.remove('py-3', 'shadow-md');
        stickyHeader.querySelector('div')?.classList.remove('scale-105');
      }
    }
  };
  window.addEventListener('scroll', observerScrollHandler, { passive: true });

  // === Helper: Auto-Save ===
  async function autoSave() {
    if (!currentSn) return;

    const msg = qs('#saveMsg', container);
    const notesStatus = qs('#notesSaveStatus', container);

    if (notesStatus) notesStatus.textContent = t('observer_saving');

    const sn = currentSn;
    try {
      // Without signal the write is kept on the device; say so instead of
      // showing "Sparar…" until the network returns. A queued write the server
      // refuses later (e.g. the result was finalized) is reported then.
      const result = await awaitWriteOrQueue(writeObserverLog(sn, {
        wrongGaitSeconds: wrongGaitAccum,
        wrongGaits,
        halts,
        notes: notesEl ? notesEl.value : notes
      }), {
        onLateError: () => showAlert(`#${sn}: observatörsloggen nekades av servern när den skickades – resultatet kan vara låst. Kontakta sekretariatet.`, false)
      });
      const savedText = result === 'queued' ? 'Sparat på enheten – skickas när nätet är tillbaka' : t('observer_saved_check');
      if (msg) {
        msg.textContent = savedText;
        setTimeout(() => msg.textContent = '', 2000);
      }
      if (notesStatus) {
        notesStatus.textContent = savedText;
        setTimeout(() => notesStatus.textContent = "", 2000);
      }
    } catch (e) {
      console.error('Auto-save failed', e);
      if (msg) msg.textContent = t('observer_save_error');
    }
  }

  // === Combobox wiring ===
  const inp = qs('#eqComboInput', container);
  const list = qs('#eqComboList', container);

  qs('#prevEqBtn', container)?.addEventListener('click', () => selectPrevNext(-1));
  qs('#nextEqBtn', container)?.addEventListener('click', () => selectPrevNext(1));

  const openAndRender = () => {
    openCombo(container);
    rebuildComboList(container);
    comboActiveIndex = (filtered.length ? 0 : -1);
    rebuildComboList(container);
  };

  function selectByIndex(i) {
    if (i < 0 || i >= filtered.length) return;
    const e = filtered[i];
    setComboValue(container, e);
    closeCombo(container);
    onEquipageSelected(e.startNumber, container);
  }

  if (inp) {
    inp.addEventListener('focus', () => { filterEquipages(inp.value); openAndRender(); });
    inp.addEventListener('input', () => { filterEquipages(inp.value); openAndRender(); });
    inp.addEventListener('keydown', (e) => {
      if (!comboOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        filterEquipages(inp.value); openAndRender(); e.preventDefault(); return;
      }
      if (!comboOpen) return;
      if (e.key === 'ArrowDown') {
        comboActiveIndex = Math.min(filtered.length - 1, comboActiveIndex + 1);
        rebuildComboList(container); e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        comboActiveIndex = Math.max(0, comboActiveIndex - 1);
        rebuildComboList(container); e.preventDefault();
      } else if (e.key === 'Enter') {
        if (comboActiveIndex >= 0) { selectByIndex(comboActiveIndex); e.preventDefault(); }
      } else if (e.key === 'Escape') {
        closeCombo(container); e.preventDefault();
      }
    });
    inp.addEventListener('blur', () => { setTimeout(() => closeCombo(container), 200); });
  }

  if (list) {
    list.addEventListener('mousedown', (e) => {
      const row = e.target.closest('.eq-option');
      if (row) { selectByIndex(+row.dataset.i); e.preventDefault(); }
    });
  }

  // === Section ===
  qs('#obsSectionButtons', container)?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]');
    if (!btn) return;
    observerSection = btn.dataset.section;
    try { localStorage.setItem(sectionKey(), observerSection); } catch (_) { /* no storage */ }
    renderSectionButtons(container);
  });

  // === Buttons & logic ===
  qs('#btnWgStart', container)?.addEventListener('click', () => {
    if (!currentSn || wrongGaitRunning) return;
    wrongGaitRunning = true; wrongGaitStartTs = nowSec(); persistRunning();
    ensureTicker(container); updateWrongGaitUI(container);
  });
  qs('#btnWgStop', container)?.addEventListener('click', () => {
    if (!currentSn || !wrongGaitRunning) return;
    endWrongGaitIncident(); persistRunning();
    updateWrongGaitUI(container); autoSave();
  });

  const wgVal = qs('#wgVal', container);
  const wgWrap = qs('#wgManual', container);
  const wgInp = qs('#wgManualInput', container);
  wgVal?.addEventListener('click', () => { if (currentSn) { wgWrap?.classList.remove('hidden'); wgInp?.focus(); } });
  qs('#wgManualCancel', container)?.addEventListener('click', () => wgWrap?.classList.add('hidden'));
  qs('#wgManualApply', container)?.addEventListener('click', () => {
    const secs = parseMMSSorSeconds(wgInp?.value || '');
    if (secs == null) { alert(t('observer_invalid_format')); return; }
    if (wrongGaitRunning) endWrongGaitIncident();
    const durSec = Math.max(0, Math.round(secs));
    if (durSec > 0) { wrongGaits.push({ atSec: nowSec(), durSec, section: observerSection }); wrongGaitAccum += durSec; }
    persistRunning();
    if (wgInp) wgInp.value = '';
    updateWrongGaitUI(container); wgWrap?.classList.add('hidden'); autoSave();
  });

  const wgList = qs('#wgList', container);
  if (wgList && !wgList._bound) {
    wgList._bound = true;
    wgList.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btnDelWg');
      if (!delBtn) return;
      const i = +delBtn.dataset.i;
      if (!wrongGaits[i] || !confirm(t('observer_remove_wrong_gait_confirm'))) return;
      wrongGaitAccum = Math.max(0, wrongGaitAccum - wrongGaits[i].durSec);
      wrongGaits.splice(i, 1);
      updateWrongGaitUI(container); autoSave();
    });
  }

  qs('#btnHaltStart', container)?.addEventListener('click', () => {
    if (!currentSn || haltRunning) return;
    haltRunning = true; haltStartTs = nowSec(); persistRunning();
    ensureTicker(container); renderHalts(container);
  });
  qs('#btnHaltStop', container)?.addEventListener('click', () => {
    if (!currentSn || !haltRunning) return;
    const dur = Math.max(0, nowSec() - haltStartTs);
    halts.push({ atSec: haltStartTs, durSec: dur });
    haltRunning = false; haltStartTs = 0; persistRunning();
    renderHalts(container); autoSave();
  });

  const haltManualWrapper = qs('#haltManualWrapper', container);
  const haltManualInput = qs('#haltManualInput', container);
  qs('#btnHaltManualOpen', container)?.addEventListener('click', () => {
    if (currentSn) { haltManualWrapper?.classList.remove('hidden'); haltManualInput?.focus(); }
  });
  qs('#haltManualCancel', container)?.addEventListener('click', () => haltManualWrapper?.classList.add('hidden'));
  qs('#haltManualApply', container)?.addEventListener('click', () => {
    if (!currentSn) return;
    const sec = parseMMSSorSeconds(haltManualInput.value);
    if (sec === null) { alert(t('observer_invalid_format')); return; }
    halts.push({ atSec: nowSec(), durSec: sec });
    renderHalts(container); haltManualWrapper.classList.add('hidden'); autoSave();
  });

  const haltList = qs('#haltList', container);
  if (haltList && !haltList._bound) {
    haltList._bound = true;
    haltList.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btnDelHalt');
      if (delBtn) {
        const i = +delBtn.dataset.i;
        if (confirm(t('observer_remove_halt_confirm'))) { halts.splice(i, 1); renderHalts(container); autoSave(); }
        return;
      }
      const editBtn = e.target.closest('.btnEditHalt');
      if (editBtn) {
        const i = +editBtn.dataset.i;
        const input = prompt(t('observer_edit_halt_prompt').replace('{n}', i + 1), fmtMMSS(halts[i].durSec));
        if (input !== null) {
          const newSec = parseMMSSorSeconds(input);
          if (newSec !== null) { halts[i].durSec = newSec; renderHalts(container); autoSave(); }
        }
      }
    });
  }

  if (notesEl) {
    notesEl.addEventListener('input', () => { notes = notesEl.value || ""; });
    notesEl.addEventListener('blur', () => autoSave());
  }

  btnSave?.addEventListener('click', async () => {
    if (!currentSn) return;
    if (haltRunning) { halts.push({ atSec: haltStartTs, durSec: Math.max(0, nowSec() - haltStartTs) }); haltRunning = false; haltStartTs = 0; }
    if (wrongGaitRunning) endWrongGaitIncident();
    // The ended timers are dropped from the device too: reopening the equipage
    // would otherwise resume them from the old start and add them twice
    persistRunning();
    updateWrongGaitUI(container); renderHalts(container); await autoSave();
  });
}

function findEquipageBySn(sn) {
  return allEquipages.find(e => String(e.startNumber) === String(sn));
}

// ---------- Entrypoint ----------
export async function load() {
  __unload();
  const currentLoadToken = ++loadToken;

  const root =
    document.getElementById('page-observator-input') ||
    document.getElementById('page-maraton-observator') ||
    document.getElementById('root');

  if (!root) return;

  resolveCompetitionId();
  loadObserverSection();
  render(root);
  wire(root);
  renderSectionButtons(root);

  if (!competitionId) {
    const status = qs('#statusMsg', root);
    if (status) status.textContent = t('observer_no_competition');
    setButtonsEnabled(root, false);
    return;
  }

  startServerClockSync();
  unsubscribeGlobalPause = listenForGlobalPause(root);
  const emPause = qs('#btnEmergencyPause', root);
  const emResume = qs('#btnEmergencyResume', root);
  emPause?.addEventListener('click', () => { if (confirm(t('observer_pause_all_confirm'))) setGlobalPause(true); });
  emResume?.addEventListener('click', () => setGlobalPause(false));

  try {
    const [raw, cfg] = await Promise.all([
      getEquipages(competitionId),
      getConfig(competitionId, 'maratonConfig').catch(() => null)
    ]);
    if (currentLoadToken !== loadToken) return;
    marathonConfig = cfg || null;

    allEquipages = (raw || []).map(normalizeEquipage).sort((a, b) => (a.startNumber || 0) - (b.startNumber || 0));
    filtered = allEquipages.slice();
    rebuildComboList(root);

    const snParam = new URLSearchParams(location.hash.split('?')[1] || '').get('sn');
    if (snParam) {
      const pref = allEquipages.find(x => String(x.startNumber) === String(snParam));
      if (pref) { setComboValue(root, pref); await onEquipageSelected(pref.startNumber, root); }
    }
    await requestWakeLock();
  } catch (e) {
    if (currentLoadToken !== loadToken) return;
    console.error(t('observer_load_error'), e);
  }
}

export function __unload() {
  releaseWakeLock();
  stopServerClockSync();
  loadToken++;
  stopTicker();

  if (unsubscribeGlobalPause) {
    unsubscribeGlobalPause();
    unsubscribeGlobalPause = null;
  }

  if (observerScrollHandler) {
    window.removeEventListener('scroll', observerScrollHandler);
    observerScrollHandler = null;
  }

  competitionId = null;
  allEquipages = [];
  filtered = [];
  currentSn = null;
  comboOpen = false;
  comboActiveIndex = -1;
  wrongGaitRunning = false;
  wrongGaitStartTs = 0;
  wrongGaitAccum = 0;
  haltRunning = false;
  haltStartTs = 0;
  halts = [];
  notes = "";
}

// A new version of the app asks before reloading while a wrong-gait or halt clock runs
registerUnsavedWork('observator-input', () => wrongGaitRunning || haltRunning);
