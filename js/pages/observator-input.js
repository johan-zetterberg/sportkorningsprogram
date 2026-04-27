// js/pages/observator-input.js
// Observatör – Maraton (combobox, start/stop, manuellt, ta bort halt) i stil med maraton-stages.

import { getGlobalState } from '../main.js';
import { db, appId } from '../config/firebase-config.js';
import { getEquipages } from '../services/firestoreService.js';
import {
  doc, getDoc, setDoc, serverTimestamp, onSnapshot, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { getCompetitionHeader } from '../ui/components.js';
import { requestWakeLock } from '../utils/wakeLock.js';

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

// Halt
let haltRunning = false;
let haltStartTs = 0;      // epoch s
let halts = [];           // [{ atSec, durSec }]

// Notes
let notes = "";

// Ticker
let liveTicker = null;

// Sökväg till vårt globala status-dokument
function globalStatusDocRef() {
  const cid = resolveCompetitionId();
  if (!cid) throw new Error('competitionId saknas');
  return doc(db, 'artifacts', appId, 'public', 'data', 'competitions', cid, 'config', 'globalStatus');
}

// Funktioner för att pausa och återuppta
async function setGlobalPause(isPaused) {
  try {
    const statusRef = globalStatusDocRef();
    const docSnap = await getDoc(statusRef);
    const data = docSnap.exists() ? docSnap.data() : {};

    let pauseLog = Array.isArray(data.pauseLog) ? data.pauseLog : [];
    const now = new Date();

    if (isPaused) {
      // Startar en ny paus: lägg till en ny post i loggen
      pauseLog.push({ start: now.toISOString(), end: null, durationSec: null });
    } else {
      // Avslutar den senaste pausen
      const lastPause = pauseLog.find(p => p.end === null);
      if (lastPause) {
        const startTime = new Date(lastPause.start).getTime();
        lastPause.end = now.toISOString();
        lastPause.durationSec = Math.round((now.getTime() - startTime) / 1000);
      }
    }

    const statusText = isPaused ? `Tävlingen pausad kl ${now.toLocaleTimeString('sv-SE')}` : "Tävlingen återupptagen.";

    await setDoc(statusRef, {
      isPaused: !!isPaused,
      statusText: statusText,
      pauseLog: pauseLog, // Spara den uppdaterade loggen
      updatedAt: serverTimestamp()
    }, { merge: true });

    showAlert(statusText);
  } catch (e) {
    console.error("Kunde inte ändra paus-status:", e);
    showAlert("Kunde inte ändra paus-status.", false);
  }
}

function listenForGlobalPause() {
  const pauseBtn = document.getElementById('btnEmergencyPause');
  const resumeBtn = document.getElementById('btnEmergencyResume');
  const statusTextEl = document.getElementById('pause-status-text');
  const logContainer = document.getElementById('pause-log-container');

  return onSnapshot(globalStatusDocRef(), (docSnap) => {
    const data = docSnap.exists() ? docSnap.data() : {};
    const isPaused = data.isPaused === true;

    if (pauseBtn) pauseBtn.classList.toggle('hidden', isPaused);
    if (resumeBtn) resumeBtn.classList.toggle('hidden', !isPaused);

    if (statusTextEl) {
      statusTextEl.textContent = isPaused ? (data.statusText || 'Tävlingen är pausad.') : '';
      statusTextEl.className = isPaused ? 'text-sm font-semibold mt-2 text-red-800' : '';
    }

    // Rendera historiken
    if (logContainer && Array.isArray(data.pauseLog)) {
      logContainer.innerHTML = data.pauseLog.map((p, i) => {
        const startTime = new Date(p.start).toLocaleTimeString('sv-SE');
        const endTime = p.end ? new Date(p.end).toLocaleTimeString('sv-SE') : 'Pågår...';
        const duration = p.durationSec ? `${p.durationSec} sek` : '-';
        return `
          <div class="text-[10px] text-gray-500 font-medium">
            Paus ${i + 1}: ${startTime} - ${endTime} (${duration})
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
  if (!snap.exists()) return { wrongGaitSeconds: 0, halts: [], notes: "" };
  return snap.data().observerLog || { wrongGaitSeconds: 0, halts: [], notes: "" };
}
async function writeObserverLog(sn, log) {
  const safeLog = {
    wrongGaitSeconds: Math.max(0, Math.round(toInt(log?.wrongGaitSeconds))),
    halts: (Array.isArray(log?.halts) ? log.halts : []).map(h => ({
      atSec: Math.max(0, Math.round(toInt(h?.atSec))),
      durSec: Math.max(0, Math.round(toInt(h?.durSec)))
    })),
    notes: String(log?.notes || '').trim()
  };

  await setDoc(summaryDocRef(sn), {
    observerLog: safeLog,
    updatedAt: Timestamp.now()
  }, { merge: true });
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
    <div class="eq-option px-4 py-3 border-b dark:border-gray-700 last:border-0 ${i === comboActiveIndex ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'dark:text-gray-200'} cursor-pointer" role="option" data-sn="${e.startNumber}" data-i="${i}">
      <div class="font-bold">#${e.startNumber} ${e.driverName}</div>
      <div class="text-[10px] text-gray-500 uppercase tracking-tighter">${e.className || ''}</div>
    </div>
  `).join('');
  list.innerHTML = items || `<div class="px-4 py-3 text-gray-500 dark:text-gray-400">Inga träffar</div>`;
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

async function onEquipageSelected(sn, container) {
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
  wrongGaitRunning = false; wrongGaitStartTs = 0; wrongGaitAccum = 0;
  haltRunning = false; haltStartTs = 0; halts = [];
  notes = "";

  stopTicker();
  updateWrongGaitUI(container);
  renderHalts(container);

  const status = qs('#statusMsg', container);
  if (!currentSn) {
    setButtonsEnabled(container, false);
    if (status) status.textContent = 'Välj ett ekipage för att börja notera.';
    return;
  }
  try {
    const log = await readObserverLog(currentSn);
    wrongGaitAccum = Math.max(0, toInt(log.wrongGaitSeconds));
    halts = Array.isArray(log.halts) ? log.halts.map(h => ({
      atSec: Math.max(0, toInt(h.atSec)),
      durSec: Math.max(0, toInt(h.durSec))
    })) : [];
    notes = String(log.notes || '');
    const notesEl = qs('#notesField', container);
    if (notesEl) notesEl.value = notes;

    setButtonsEnabled(container, true);
    ensureTicker(container);
    updateWrongGaitUI(container);
    renderHalts(container);
    if (status) status.textContent = '';
  } catch (e) {
    console.error('Kunde inte läsa observerLog:', e);
    if (status) status.textContent = 'Kunde inte läsa tidigare noteringar för ekipaget.';
    setButtonsEnabled(container, true);
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
            <span id="stickyName" class="font-bold text-gray-900 dark:text-white text-sm truncate max-w-[150px]">Välj ekipage</span>
          </div>
          <div id="stickyStatus" class="flex gap-2"></div>
        </div>
      </div>

      <div class="container mx-auto p-4 md:p-8 max-w-4xl">
        <div class="mb-6">
          ${getCompetitionHeader(comp, 'Observatör')}
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
                   <h3 class="font-black text-red-600 uppercase text-[10px] tracking-widest mb-1">Pausa tävlingen vid olycka</h3>
                   <p class="text-[10px] text-gray-500 mb-4">Stoppar ALLA klockor i hela systemet omedelbart.</p>
                   <div class="flex gap-2">
                      <button id="btnEmergencyPause" class="flex-1 obs-touch-btn rounded-xl bg-red-600 text-white font-black hover:bg-red-700 transition-all shadow-lg active:scale-95 text-xs">STOPPA ALLT</button>
                      <button id="btnEmergencyResume" class="flex-1 obs-touch-btn rounded-xl bg-emerald-600 text-white font-black hidden hover:bg-emerald-700 transition-all shadow-lg active:scale-95 text-xs">ÅTERUPPTA</button>
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
              <label class="block text-[10px] font-black uppercase text-gray-400 dark:text-gray-500 tracking-widest mb-2">Välj Startnummer</label>
              <div class="relative" role="combobox" aria-expanded="false">
                <div class="flex gap-2">
                  <button id="prevEqBtn" class="w-12 h-12 flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-all active:scale-90">
                    <i class="fas fa-chevron-left text-gray-500"></i>
                  </button>
                  <div class="relative flex-1">
                    <input id="eqComboInput" type="text"
                      class="w-full border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 rounded-xl px-4 h-12 text-base font-bold dark:text-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                      placeholder="Startnr / Namn..." />
                    <div id="eqComboList" class="absolute mt-2 left-0 right-0 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-2xl shadow-2xl max-h-80 overflow-auto hidden z-50 overflow-hidden"></div>
                  </div>
                  <button id="nextEqBtn" class="w-12 h-12 flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-all active:scale-90">
                    <i class="fas fa-chevron-right text-gray-500"></i>
                  </button>
                </div>
              </div>
              <div id="statusMsg" class="mt-2 text-[11px] font-bold text-amber-600 text-center min-h-[1rem]"></div>
            </div>

            <!-- Reglage Grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Wrong Gait -->
              <div id="wgCard" class="obs-card bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-[10px] font-black uppercase text-gray-400 dark:text-gray-500 tracking-widest">Fel gångart</span>
                  <i class="fas fa-running text-gray-200 dark:text-gray-700"></i>
                </div>
                <div id="wgVal" class="text-4xl font-black tabular-nums dark:text-white mb-6 text-center cursor-pointer hover:text-blue-500 transition-colors">00:00</div>
                <div class="flex gap-2">
                  <button id="btnWgStart" class="flex-1 obs-touch-btn rounded-xl bg-emerald-600 text-white font-black hover:bg-emerald-700 disabled:opacity-20 transition-all active:scale-95 shadow-md shadow-emerald-600/20">START</button>
                  <button id="btnWgStop" class="flex-1 obs-touch-btn rounded-xl bg-rose-600 text-white font-black hover:bg-rose-700 disabled:opacity-20 transition-all active:scale-95 shadow-md shadow-rose-600/20">STOPP</button>
                </div>
                
                <!-- Manual Overlay -->
                <div id="wgManual" class="manual-overlay hidden absolute inset-0 z-10 p-5 flex flex-col justify-center items-center">
                   <h4 class="text-xs font-black uppercase text-gray-500 dark:text-gray-400 mb-2">Ändra tid</h4>
                   <input id="wgManualInput" class="w-full h-12 text-center text-xl font-bold bg-white dark:bg-gray-801 border-2 border-blue-500 rounded-xl mb-4 dark:text-white" placeholder="mm:ss" />
                   <div class="flex gap-2 w-full">
                      <button id="wgManualApply" class="flex-1 h-10 rounded-lg bg-blue-600 text-white font-bold">OK</button>
                      <button id="wgManualCancel" class="flex-1 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-bold">Avbryt</button>
                   </div>
                </div>
              </div>

              <!-- Halt -->
              <div id="haltCard" class="obs-card bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-[10px] font-black uppercase text-gray-400 dark:text-gray-500 tracking-widest">Halt</span>
                  <i class="fas fa-hand-paper text-gray-200 dark:text-gray-700"></i>
                </div>
                <div id="haltLive" class="text-4xl font-black tabular-nums text-gray-900 dark:text-white mb-6 text-center">—</div>
                <div class="flex gap-2">
                  <button id="btnHaltStart" class="flex-1 obs-touch-btn rounded-xl bg-emerald-600 text-white font-black hover:bg-emerald-700 disabled:opacity-20 transition-all active:scale-95 shadow-md shadow-emerald-600/20">START</button>
                  <button id="btnHaltStop" class="flex-1 obs-touch-btn rounded-xl bg-rose-600 text-white font-black hover:bg-rose-700 disabled:opacity-20 transition-all active:scale-95 shadow-md shadow-rose-600/20">STOPP</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Column 2: Halts & Notes -->
          <div class="space-y-6 obs-side-panel">
            <!-- Halt Lista -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm h-fit">
               <div class="flex justify-between items-center mb-4">
                  <span class="text-[10px] font-black uppercase text-gray-400 dark:text-gray-500 tracking-widest">Halt-logg</span>
                  <button id="btnHaltManualOpen" class="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase disabled:opacity-20" disabled>+ Manuel</button>
               </div>
               
               <div id="haltList" class="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                  <div class="text-gray-400 text-xs italic text-center py-4">Inga halter ännu.</div>
               </div>

               <!-- Manual Halt Input Tray -->
               <div id="haltManualWrapper" class="hidden mt-3 p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-xl space-y-3">
                  <input id="haltManualInput" class="w-full h-10 text-center font-bold rounded-lg border dark:border-gray-600 dark:bg-gray-800 dark:text-white" placeholder="mm:ss eller sek" />
                  <div class="flex gap-2">
                    <button id="haltManualApply" class="flex-1 h-10 bg-blue-600 text-white rounded-lg font-bold text-xs uppercase">Lägg till</button>
                    <button id="haltManualCancel" class="flex-1 h-10 bg-white dark:bg-gray-800 text-gray-500 rounded-lg font-bold text-xs uppercase">Stäng</button>
                  </div>
               </div>
            </div>

            <!-- Anteckningar -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 shadow-sm">
               <span class="text-[10px] font-black uppercase text-gray-400 dark:text-gray-500 tracking-widest block mb-4">Anteckningar</span>
               <textarea id="notesField" rows="4" class="w-full bg-gray-50 dark:bg-gray-900/50 border dark:border-gray-700 rounded-xl p-3 text-sm dark:text-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all resize-none" placeholder="Skriv iakttagelser..."></textarea>
               <div id="notesSaveStatus" class="flex items-center justify-end gap-1 mt-2 text-[10px] font-bold text-gray-400"></div>
            </div>

            <!-- Manual Save (Backup) -->
            <div class="flex gap-4">
               <button id="btnSave" class="flex-1 h-12 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-300 transition-all disabled:opacity-20" disabled>Spara manuellt</button>
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
    list.innerHTML = `<div class="text-gray-400 text-xs italic text-center py-4">Inga halter ännu.</div>`;
  } else {
    list.innerHTML = halts.map((h, i) => `
        <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-900 p-2.5 rounded-xl border dark:border-gray-800 shadow-xs group">
          <div class="min-w-0">
             <div class="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-tighter">Halt ${i + 1}</div>
             <div class="font-bold tabular-nums text-gray-900 dark:text-white">${fmtMMSS(h.durSec)} <span class="text-xs text-gray-400 font-medium ml-1">${fmtTime(h.atSec)}</span></div>
          </div>
          <div class="flex gap-2 shrink-0">
            <button class="btnEditHalt w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 flex items-center justify-center" data-i="${i}"><i class="fas fa-edit text-[10px]"></i></button>
            <button class="btnDelHalt w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 flex items-center justify-center" data-i="${i}"><i class="fas fa-trash text-[10px]"></i></button>
          </div>
        </div>
      `).join('');
  }
}

function fmtTime(sec) {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setButtonsEnabled(container, enabled) {
  ['#btnWgStart', '#btnWgStop', '#btnHaltStart', '#btnHaltStop', '#btnSave', '#btnHaltManualOpen'].forEach(id => {
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
  const btnSave = qs('#btnSave', container);

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
  window.addEventListener('scroll', () => {
    if (stickyHeader && currentSn) {
      if (window.scrollY > 150) {
        stickyHeader.classList.add('py-3', 'shadow-md');
        stickyHeader.querySelector('div').classList.add('scale-105');
      } else {
        stickyHeader.classList.remove('py-3', 'shadow-md');
        stickyHeader.querySelector('div').classList.remove('scale-105');
      }
    }
  });

  // === Helper: Auto-Save ===
  async function autoSave() {
    if (!currentSn) return;

    const msg = qs('#saveMsg', container);
    const notesStatus = qs('#notesSaveStatus', container);

    if (notesStatus) notesStatus.textContent = "Sparar...";

    try {
      await writeObserverLog(currentSn, {
        wrongGaitSeconds: wrongGaitAccum,
        halts,
        notes: notesEl ? notesEl.value : notes
      });
      if (msg) {
        msg.textContent = 'Sparat ✔';
        setTimeout(() => msg.textContent = '', 2000);
      }
      if (notesStatus) {
        notesStatus.textContent = "Sparat ✔";
        setTimeout(() => notesStatus.textContent = "", 2000);
      }
    } catch (e) {
      console.error('Auto-save failed', e);
      if (msg) msg.textContent = 'Fel vid sparande!';
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

  // === Buttons & logic ===
  qs('#btnWgStart', container)?.addEventListener('click', () => {
    if (!currentSn || wrongGaitRunning) return;
    wrongGaitRunning = true; wrongGaitStartTs = nowSec();
    ensureTicker(container); updateWrongGaitUI(container);
  });
  qs('#btnWgStop', container)?.addEventListener('click', () => {
    if (!currentSn || !wrongGaitRunning) return;
    wrongGaitAccum += (nowSec() - wrongGaitStartTs);
    wrongGaitRunning = false; wrongGaitStartTs = 0;
    updateWrongGaitUI(container); autoSave();
  });

  const wgVal = qs('#wgVal', container);
  const wgWrap = qs('#wgManual', container);
  const wgInp = qs('#wgManualInput', container);
  wgVal?.addEventListener('click', () => { if (currentSn) { wgWrap?.classList.remove('hidden'); wgInp?.focus(); } });
  qs('#wgManualCancel', container)?.addEventListener('click', () => wgWrap?.classList.add('hidden'));
  qs('#wgManualApply', container)?.addEventListener('click', () => {
    const secs = parseMMSSorSeconds(wgInp?.value || '');
    if (secs == null) { alert('Ogiltigt format.'); return; }
    wrongGaitRunning = false; wrongGaitAccum = Math.max(0, Math.round(secs));
    updateWrongGaitUI(container); wgWrap?.classList.add('hidden'); autoSave();
  });

  qs('#btnHaltStart', container)?.addEventListener('click', () => {
    if (!currentSn || haltRunning) return;
    haltRunning = true; haltStartTs = nowSec();
    ensureTicker(container); renderHalts(container);
  });
  qs('#btnHaltStop', container)?.addEventListener('click', () => {
    if (!currentSn || !haltRunning) return;
    const dur = Math.max(0, nowSec() - haltStartTs);
    halts.push({ atSec: haltStartTs, durSec: dur });
    haltRunning = false; haltStartTs = 0;
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
    if (sec === null) { alert("Ogiltigt format."); return; }
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
        if (confirm('Ta bort denna halt?')) { halts.splice(i, 1); renderHalts(container); autoSave(); }
        return;
      }
      const editBtn = e.target.closest('.btnEditHalt');
      if (editBtn) {
        const i = +editBtn.dataset.i;
        const input = prompt(`Ändra längd på halt ${i + 1} (mm:ss eller sek):`, fmtMMSS(halts[i].durSec));
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
    if (haltRunning) { halts.push({ atSec: haltStartTs, durSec: Math.max(0, nowSec() - haltStartTs) }); haltRunning = false; }
    if (wrongGaitRunning) { wrongGaitAccum += (nowSec() - wrongGaitStartTs); wrongGaitRunning = false; }
    updateWrongGaitUI(container); renderHalts(container); await autoSave();
  });
}

function findEquipageBySn(sn) {
  return allEquipages.find(e => String(e.startNumber) === String(sn));
}

// ---------- Entrypoint ----------
export async function load() {
  const root =
    document.getElementById('page-observator-input') ||
    document.getElementById('page-maraton-observator') ||
    document.getElementById('root');

  if (!root) return;

  resolveCompetitionId();
  render(root);
  wire(root);

  listenForGlobalPause();
  const emPause = qs('#btnEmergencyPause', root);
  const emResume = qs('#btnEmergencyResume', root);
  emPause?.addEventListener('click', () => { if (confirm("Pausa ALLA timers?")) setGlobalPause(true); });
  emResume?.addEventListener('click', () => setGlobalPause(false));

  if (!competitionId) {
    const status = qs('#statusMsg', root);
    if (status) status.textContent = 'Ingen tävling vald.';
    setButtonsEnabled(root, false);
    return;
  }

  try {
    const raw = await getEquipages(competitionId);
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
    console.error('Laddning misslyckades:', e);
  }
}
