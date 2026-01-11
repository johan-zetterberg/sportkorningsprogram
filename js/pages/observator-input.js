// js/pages/observator-input.js
// Observatör – Maraton (combobox, start/stop, manuellt, ta bort halt) i stil med maraton-stages.

import { getGlobalState } from '../main.js';
import { db, appId } from '../config/firebase-config.js';
import { getEquipages } from '../services/firestoreService.js';
import {
  doc, getDoc, setDoc, serverTimestamp, onSnapshot, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompetitionHeader } from '../ui/components.js';
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

    pauseBtn.classList.toggle('hidden', isPaused);
    resumeBtn.classList.toggle('hidden', !isPaused);

    statusTextEl.textContent = isPaused ? (data.statusText || 'Tävlingen är pausad.') : '';
    statusTextEl.className = isPaused ? 'text-sm font-semibold mt-2 text-red-800' : '';

    // Rendera historiken
    if (logContainer && Array.isArray(data.pauseLog)) {
      logContainer.innerHTML = data.pauseLog.map((p, i) => {
        const startTime = new Date(p.start).toLocaleTimeString('sv-SE');
        const endTime = p.end ? new Date(p.end).toLocaleTimeString('sv-SE') : 'Pågår...';
        const duration = p.durationSec ? `${p.durationSec} sek` : '-';
        return `
          <div class="text-xs text-gray-700">
            <strong>Paus ${i + 1}:</strong> Start: ${startTime} | Stopp: ${endTime} | Längd: ${duration}
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
  return { ...e, startNumber, driverName, className, clubName };
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
  // Ensure log structure is sound to prevent Firestore 400 errors
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
    updatedAt: Timestamp.now() // Use client-side timestamp to avoid potential sentinel issues
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
  // Max 30 träffar för mobil
  const items = filtered.slice(0, 30).map((e, i) => `
    <div class="eq-option px-3 py-2 ${i === comboActiveIndex ? 'bg-gray-100' : ''}" role="option" data-sn="${e.startNumber}" data-i="${i}">
      ${comboFormatLabel(e)}
    </div>
  `).join('');
  list.innerHTML = items || `<div class="px-3 py-2 text-gray-500">Inga träffar</div>`;
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

// ---------- UI ----------
function render(container) {
  const comp = getGlobalState('currentCompetition');

  container.innerHTML = `
    <div class="container mx-auto p-4 md:p-8 max-w-2xl">
      ${getCompetitionHeader(comp, 'Observatör – Maraton')}

      <div class="bg-white rounded-xl border p-4 md:p-6 shadow-sm">
        <h1 class="text-xl font-bold mb-4">Observatör – Maraton</h1>

        <details class="mb-6 group">
          <summary class="cursor-pointer text-red-700 font-semibold border-2 border-red-100 bg-red-50 rounded-lg p-3 select-none flex items-center justify-between">
            <span>⚠️ Nödfunktion / Paus</span>
            <span class="text-xs text-red-500 font-normal group-open:hidden">Klicka för att visa</span>
          </summary>
          <div id="emergency-pause-container" class="mt-2 p-3 border-2 border-red-500 rounded-lg bg-red-50 animate-in fade-in slide-in-from-top-2">
            <h3 class="font-bold text-red-800">Nödfunktion: Pausa Tävlingen</h3>
            <p class="text-xs text-red-700 mt-1">Pausar ALLA pågående tidtagare (etapper och hinder) om en olycka inträffar. Använd med försiktighet.</p>
            <div class="mt-3 flex gap-2">
              <button id="btnEmergencyPause" class="px-4 py-2 rounded bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-sm">PAUSA ALLT</button>
              <button id="btnEmergencyResume" class="px-4 py-2 rounded bg-green-600 text-white font-semibold hidden hover:bg-green-700 transition-colors shadow-sm">ÅTERUPPTA ALLT</button>
            </div>
            <div id="pause-status-text" class="text-sm font-semibold mt-2"></div>
            <div id="pause-log-container" class="mt-2 space-y-1 border-t border-red-200 pt-2"></div>
          </div>
        </details>

        <p class="text-xs md:text-sm text-gray-600 mb-4">Notera fel gångart, halter och anteckningar.</p>
        <div id="statusMsg" class="mb-3 text-sm text-amber-700 h-5"></div>

        <!-- Combobox -->
        <div class="mb-6">
          <label class="block text-sm font-medium mb-1 text-gray-700">Ekipage</label>
          <div class="relative" role="combobox" aria-expanded="false" aria-owns="eqComboList" aria-haspopup="listbox">
            <div class="flex gap-2">
              <button id="prevEqBtn" aria-label="Föregående ekipage" class="px-4 py-3 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors">⟨</button>
              <input id="eqComboInput" type="text"
                    class="flex-1 w-full border border-gray-300 rounded px-3 py-3 text-base shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    autocomplete="off" autocapitalize="none" autocorrect="off"
                    placeholder="Sök startnr eller namn..." />
              <button id="nextEqBtn" aria-label="Nästa ekipage" class="px-4 py-3 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors">⟩</button>
            </div>
            <div id="eqComboList"
                class="absolute mt-1 left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg max-h-80 overflow-auto hidden z-20">
              <!-- byggs dynamiskt -->
            </div>
          </div>
        </div>

        <!-- Fel gångart & Halt -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <!-- Fel Gångart Kort -->
          <div class="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold text-gray-800">Fel gångart</h3>
              <div class="flex gap-2 basis-5/12">
                <button id="btnWgStart" class="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm touch-manipulation active:scale-95">Start</button>
                <button id="btnWgStop"  class="flex-1 py-2 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-sm touch-manipulation active:scale-95">Stop</button>
              </div>
            </div>
            <div class="relative">
              <div id="wgVal" class="text-3xl font-bold tabular-nums text-gray-900 cursor-pointer hover:text-blue-600 transition-colors" title="Klicka för manuell inmating">00:00</div>
              
              <!-- Manuell inmatning Fel Gångart -->
              <div id="wgManual" class="hidden absolute top-0 left-0 right-0 z-10 bg-white p-3 rounded-lg border shadow-lg">
                <label class="block text-xs font-semibold uppercase text-gray-500 mb-1">Manuell tid</label>
                <input id="wgManualInput" class="w-full border rounded px-2 py-1.5 mb-2 text-sm" placeholder="t.ex. 90 eller 01:30" />
                <div class="flex gap-2">
                  <button id="wgManualApply"  class="flex-1 py-1 rounded bg-emerald-600 text-white text-xs font-medium">OK</button>
                  <button id="wgManualCancel" class="flex-1 py-1 rounded bg-gray-200 text-gray-700 text-xs font-medium">Avbryt</button>
                </div>
              </div>
            </div>
            <p class="mt-1 text-xs text-gray-500">Klicka på tiden för att ändra.</p>
          </div>

          <!-- Halt Kort -->
          <div class="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold text-gray-800">Halt</h3>
              <div class="flex gap-2 basis-5/12">
                <button id="btnHaltStart" class="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm touch-manipulation active:scale-95">Start</button>
                <button id="btnHaltStop"  class="flex-1 py-2 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-sm touch-manipulation active:scale-95">Stop</button>
              </div>
            </div>
            
            <div class="mb-3">
              <div id="haltLive" class="font-bold tabular-nums text-2xl text-rose-600 min-h-[2rem]">—</div>
            </div>

            <!-- Manuell Halt Toggle -->
            <div class="mb-3">
               <button id="btnHaltManualOpen" class="text-xs font-medium text-blue-600 hover:text-blue-800 underline disabled:opacity-50 outline-none" disabled>
                 + Lägg till halt manuellt
               </button>
               
               <!-- Manuell inmatning Halt -->
               <div id="haltManualWrapper" class="hidden mt-2 p-3 bg-white border rounded-lg shadow-sm">
                  <label class="block text-xs font-semibold uppercase text-gray-500 mb-1">Haltlängd</label>
                  <input id="haltManualInput" class="w-full border rounded px-2 py-1.5 mb-2 text-sm" placeholder="t.ex. 15 eller 00:15" />
                  <div class="flex gap-2">
                    <button id="haltManualApply" class="flex-1 py-1 rounded bg-emerald-600 text-white text-xs font-medium">Lägg till</button>
                    <button id="haltManualCancel" class="flex-1 py-1 rounded bg-gray-200 text-gray-700 text-xs font-medium">Avbryt</button>
                  </div>
               </div>
            </div>

            <div id="haltList" class="text-sm space-y-2 border-t pt-2 max-h-40 overflow-y-auto"></div>
          </div>
        </div>

        <div class="mb-6">
          <label class="block text-sm font-medium mb-1 text-gray-700">Anteckningar <span class="text-xs font-normal text-gray-500">(sparas automatiskt)</span></label>
          <textarea id="notesField" rows="3" class="w-full border border-gray-300 rounded pointer-events-auto px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="Skriv iakttagelser..."></textarea>
           <!-- Sparas-indikator -->
          <div id="notesSaveStatus" class="text-xs text-gray-400 mt-1 min-h-[1.2em]"></div>
        </div>

        <!-- Spara-knapp (mest för att tvinga spara eller känna sig trygg) -->
        <div class="flex items-center gap-3 border-t pt-4">
          <button id="btnSave" class="px-6 py-2 rounded bg-gray-200 text-gray-700 font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50" disabled>Spara manuellt</button>
          <span id="saveMsg" class="text-sm font-medium text-emerald-600"></span>
        </div>
      </div>
    </div>
  `;
}


function renderHalts(container) {
  const list = qs('#haltList', container);
  const live = qs('#haltLive', container);
  if (!list || !live) return;

  if (halts.length === 0) {
    list.innerHTML = `<div class="text-gray-400 text-xs italic">Inga halter noterade.</div>`;
  } else {
    list.innerHTML = halts.map((h, i) => `
        <div class="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-100 group">
          <span class="font-medium tabular-nums text-gray-700">Halt ${i + 1}: <span class="text-black font-bold">${fmtMMSS(h.durSec)}</span> <span class="text-gray-400 text-xs font-normal">(kl. ${fmtTime(h.atSec)})</span></span>
          <div class="flex gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <button class="btnEditHalt text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline" data-i="${i}">Ändra</button>
            <button class="btnDelHalt text-xs font-medium text-rose-600 hover:text-rose-800 hover:underline" data-i="${i}">Ta bort</button>
          </div>
        </div>
      `).join('');
  }

  live.textContent = haltRunning ? `Pågår: ${fmtMMSS(nowSec() - haltStartTs)}` : '—';
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
  if (!el) return;
  const base = wrongGaitAccum;
  const extra = wrongGaitRunning ? (nowSec() - wrongGaitStartTs) : 0;
  el.textContent = fmtMMSS(base + extra);
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

  // === Helper: Auto-Save ===
  async function autoSave() {
    if (!currentSn) return;

    const msg = qs('#saveMsg', container);
    const notesStatus = qs('#notesSaveStatus', container);

    // Feedback "Sparar..."
    if (notesStatus) notesStatus.textContent = "Sparar...";

    try {
      await writeObserverLog(currentSn, {
        wrongGaitSeconds: wrongGaitAccum,
        halts,
        notes: notesEl ? notesEl.value : notes
      });
      console.log(`Auto-saved for #${currentSn}`);

      if (msg) {
        msg.textContent = 'Sparat ✔';
        msg.className = 'text-sm font-medium text-emerald-600 animate-in fade-in';
        setTimeout(() => msg.textContent = '', 2000);
      }
      if (notesStatus) {
        notesStatus.textContent = "Sparat ✔";
        setTimeout(() => notesStatus.textContent = "", 2000);
      }
    } catch (e) {
      console.error('Auto-save failed', e);
      if (msg) {
        msg.textContent = 'Fel vid sparande!';
        msg.className = 'text-sm font-bold text-rose-600';
      }
    }
  }

  // === Combobox wiring ===
  const inp = qs('#eqComboInput', container);
  const list = qs('#eqComboList', container);

  // Knappar ⟨ / ⟩
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

  function handleInput() {
    filterEquipages(inp.value);
    openAndRender();
  }

  if (inp) {
    inp.addEventListener('focus', () => { filterEquipages(inp.value); openAndRender(); });
    inp.addEventListener('input', handleInput);
    inp.addEventListener('keydown', (e) => {
      if (!comboOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        filterEquipages(inp.value); openAndRender(); e.preventDefault(); return;
      }
      if (!comboOpen) return;

      if (e.key === 'ArrowDown') {
        comboActiveIndex = Math.min(filtered.length - 1, comboActiveIndex + 1);
        rebuildComboList(container);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        comboActiveIndex = Math.max(0, comboActiveIndex - 1);
        rebuildComboList(container);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        if (comboActiveIndex >= 0) { selectByIndex(comboActiveIndex); e.preventDefault(); }
      } else if (e.key === 'Escape') {
        closeCombo(container); e.preventDefault();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.altKey || e.ctrlKey || e.metaKey)) {
        selectPrevNext(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault();
      }
    });
    inp.addEventListener('blur', () => { setTimeout(() => closeCombo(container), 150); });
  }

  if (list) {
    list.addEventListener('mousedown', (e) => {
      const row = e.target.closest('.eq-option');
      if (!row) return;
      selectByIndex(+row.dataset.i);
      e.preventDefault();
    });
    list.addEventListener('mouseenter', () => { });
  }

  // === Buttons & logic ===

  // Fel gångart – Start
  const btnWgStart = qs('#btnWgStart', container);
  btnWgStart && btnWgStart.addEventListener('click', () => {
    if (!currentSn) return;
    if (!wrongGaitRunning) {
      wrongGaitRunning = true;
      wrongGaitStartTs = nowSec();
      ensureTicker(container);
      updateWrongGaitUI(container);
    }
  });

  // Fel gångart – Stop -> AutoSave
  const btnWgStop = qs('#btnWgStop', container);
  btnWgStop && btnWgStop.addEventListener('click', () => {
    if (!currentSn) return;
    if (wrongGaitRunning) {
      wrongGaitAccum += (nowSec() - wrongGaitStartTs);
      wrongGaitRunning = false;
      wrongGaitStartTs = 0;
      updateWrongGaitUI(container);
      autoSave(); // <<-- AUTO SAVE
    }
  });

  // Manuell gångartstid
  const wgVal = qs('#wgVal', container);
  const wgWrap = qs('#wgManual', container);
  const wgInp = qs('#wgManualInput', container);
  const wgApply = qs('#wgManualApply', container);
  const wgCancel = qs('#wgManualCancel', container);
  const openWg = () => { wgWrap?.classList.remove('hidden'); wgInp && (wgInp.value = ''); setTimeout(() => wgInp?.focus(), 0); };
  const closeWg = () => { wgWrap?.classList.add('hidden'); };

  wgVal && wgVal.addEventListener('click', () => { if (currentSn) openWg(); });
  wgCancel && wgCancel.addEventListener('click', closeWg);

  wgApply && wgApply.addEventListener('click', () => {
    const secs = parseMMSSorSeconds(wgInp?.value || '');
    if (secs == null) { alert('Ogiltigt format. Ange mm:ss eller sekunder.'); return; }
    wrongGaitRunning = false;
    wrongGaitStartTs = 0;
    wrongGaitAccum = Math.max(0, Math.round(secs));
    updateWrongGaitUI(container);
    closeWg();
    autoSave(); // <<-- AUTO SAVE
  });

  // Halt – Start
  const btnHaltStart = qs('#btnHaltStart', container);
  btnHaltStart && btnHaltStart.addEventListener('click', () => {
    if (!currentSn) return;
    if (!haltRunning) {
      haltRunning = true;
      haltStartTs = nowSec();
      ensureTicker(container);
      renderHalts(container);
    }
  });

  // Halt – Stop -> AutoSave
  const btnHaltStop = qs('#btnHaltStop', container);
  btnHaltStop && btnHaltStop.addEventListener('click', () => {
    if (!currentSn) return;
    if (haltRunning) {
      const dur = Math.max(0, nowSec() - haltStartTs);
      halts.push({ atSec: haltStartTs, durSec: dur }); // Spara starttiden for loggen
      haltRunning = false;
      haltStartTs = 0;
      renderHalts(container);
      autoSave(); // <<-- AUTO SAVE
    }
  });

  // Halt - Manuell Inmatning
  const btnHaltManualOpen = qs('#btnHaltManualOpen', container);
  const haltManualWrapper = qs('#haltManualWrapper', container);
  const haltManualInput = qs('#haltManualInput', container);
  const haltManualApply = qs('#haltManualApply', container);
  const haltManualCancel = qs('#haltManualCancel', container);

  btnHaltManualOpen && btnHaltManualOpen.addEventListener('click', () => {
    if (!currentSn) return;
    haltManualWrapper.classList.remove('hidden');
    haltManualInput.value = '';
    setTimeout(() => haltManualInput.focus(), 0);
  });

  haltManualCancel && haltManualCancel.addEventListener('click', () => {
    haltManualWrapper.classList.add('hidden');
  });

  haltManualApply && haltManualApply.addEventListener('click', () => {
    if (!currentSn) return;
    const val = haltManualInput.value;
    const sec = parseMMSSorSeconds(val);
    if (sec === null) {
      alert("Ogiltigt format. Ange sekunder eller mm:ss.");
      return;
    }
    halts.push({ atSec: nowSec(), durSec: sec });
    renderHalts(container);
    haltManualWrapper.classList.add('hidden');
    autoSave(); // <<-- AUTO SAVE
  });


  // Halt List Interaction (Ta bort / Ändra)
  const haltList = qs('#haltList', container);
  if (haltList && !haltList._bound) {
    haltList._bound = true;
    haltList.addEventListener('click', (e) => {
      // DELETE
      const delBtn = e.target.closest('.btnDelHalt');
      if (delBtn) {
        const i = +delBtn.dataset.i;
        if (i >= 0 && i < halts.length) {
          if (confirm('Ta bort denna halt?')) {
            halts.splice(i, 1);
            renderHalts(container);
            autoSave(); // <<-- AUTO SAVE
          }
        }
        return;
      }

      // EDIT
      const editBtn = e.target.closest('.btnEditHalt');
      if (editBtn) {
        const i = +editBtn.dataset.i;
        if (i >= 0 && i < halts.length) {
          const h = halts[i];
          const old = fmtMMSS(h.durSec);
          const input = prompt(`Ändra längd på halt ${i + 1} (mm:ss eller sekunder):`, old);
          if (input === null) return; // Cancel
          const newSec = parseMMSSorSeconds(input);
          if (newSec === null) {
            alert('Ogiltigt format.');
            return;
          }
          h.durSec = newSec;
          renderHalts(container);
          autoSave(); // <<-- AUTO SAVE
        }
        return;
      }
    });
  }

  // Notes - Auto-save on blur
  if (notesEl) {
    notesEl.addEventListener('input', () => {
      notes = notesEl.value || "";
    });
    notesEl.addEventListener('blur', () => {
      // Auto-save när man lämnar fältet
      autoSave();
    });
  }

  // Spara-knapp (Manual trigger)
  btnSave && btnSave.addEventListener('click', async () => {
    if (!currentSn) return;

    // Om något rullar, stoppa det och spara ner det
    if (haltRunning) {
      const dur = Math.max(0, nowSec() - haltStartTs);
      halts.push({ atSec: haltStartTs, durSec: dur });
      haltRunning = false; haltStartTs = 0;
    }
    if (wrongGaitRunning) {
      wrongGaitAccum += (nowSec() - wrongGaitStartTs);
      wrongGaitRunning = false; wrongGaitStartTs = 0;
    }

    updateWrongGaitUI(container);
    renderHalts(container);
    await autoSave();
  });
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

  const pauseBtn = qs('#btnEmergencyPause', root);
  const resumeBtn = qs('#btnEmergencyResume', root);
  pauseBtn?.addEventListener('click', () => {
    if (confirm("Är du helt säker på att du vill pausa ALLA timers i hela tävlingen?")) {
      setGlobalPause(true);
    }
  });
  resumeBtn?.addEventListener('click', () => setGlobalPause(false));
  listenForGlobalPause();

  if (!competitionId) {
    const status = qs('#statusMsg', root);
    if (status) status.textContent = 'Ingen tävling vald. Gå till startsidan och välj tävling.';
    setButtonsEnabled(root, false);
    return;
  }

  try {
    const raw = await getEquipages(competitionId);
    allEquipages = (raw || []).map(normalizeEquipage).sort((a, b) => (a.startNumber || 0) - (b.startNumber || 0));
    filtered = allEquipages.slice();

    // Om ?sn= finns: förvalda
    const params = new URLSearchParams((location.hash.split('?')[1] || ''));
    const snParam = params.get('sn');
    if (snParam) {
      const pref = allEquipages.find(x => String(x.startNumber) === String(snParam));
      if (pref) {
        setComboValue(root, pref);
        await onEquipageSelected(pref.startNumber, root);
      }
    }

    // bygg initial lista (öppnas när input får fokus)
    rebuildComboList(root);

    const status = qs('#statusMsg', root);
    if (status) status.textContent = '';
    setButtonsEnabled(root, !!currentSn); // aktiveras när ekipage valts
  } catch (e) {
    console.error('getEquipages failed', e);
    const status = qs('#statusMsg', root);
    if (status) status.textContent = 'Kunde inte hämta startlista. Försök igen från startsidan.';
  }
}

export function __unload() {
  if (liveTicker) { clearInterval(liveTicker); liveTicker = null; }
  currentSn = null;
  wrongGaitRunning = false; wrongGaitStartTs = 0; wrongGaitAccum = 0;
  haltRunning = false; haltStartTs = 0; halts = [];
}
