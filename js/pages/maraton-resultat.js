// js/pages/maraton-resultat.js
import { getGlobalState } from '../main.js';
import { getEquipages, getConfig, getMarathonResults, getMaratonTimingData, listenForMaratonTimingUpdates, getMarathonObstacleResults } from '../services/firestoreService.js';
import { collection, onSnapshot, updateDoc, query, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { getCompetitionHeader } from '../ui/components.js';
import { ensureClubLogosLoaded, getClubLogoHtml, getClubLogoUrl } from '../services/logosService.js';
import { getFlagHtml, normalizeCountryCode, fetchFlagDataUrl } from '../services/flagsService.js';
import { saveComputedEquipageResult } from '../services/aggregateService.js';
import {
  maraton_marathonConfig,
  setMarathonConfig,
  tlSecondsFor,
  limitsFor,
  stagePenaltyFromMs,
  getObstacleArray,
  obstacleValues,
  detectTRCategoryFromEquipage,
  buildDominantTRCategoryByClass,
  // De som saknades:
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved,
  pausedMsBetween,
  pausedMsSince,
  formatMsLive,
  setPauseWindows,
  calculateMarathonResult, // <-- NY
  TRV_2025_MARATON_TEMPOS_KMH
} from '../utils/marathonUtils.js';

import {
  printMarathonPdf,
  generateMarathonListPdf
} from '../pdf/marathonPdf.js';
import {
  escapeHtml,
  isMobile,
  debounce,
  horseLabel,
  downloadCsv,
  sanitizeForFilename,
  isNum
} from '../utils/sharedUtils.js';

import { injectScrollStyles, initializeScrollSync } from '../ui/scrollHelper.js';

import { showDetailsModal } from '../ui/marathonModal.js';
// ---- Cross-page X-Scroll Guard (shared) ----


// === Modal/bridge-ägarskap för att undvika krock mellan sidor ===
const MARATHON_MODAL_OWNER = 'marathon-results';

// Städa bort ev. främmande overlay från en annan sida
(function adoptOrResetModalOnce() {
  // Om någon annan lämnat kvar sin overlay → ta bort den
  const foreign = document.querySelector('#marathon-details-modal, #precisionDetailsModal');
  if (foreign && !foreign.dataset?.owner) {
    // okänd → ta bort
    try { foreign.remove(); } catch (_) { }
  }
  // vår egen (results) heter "detailsModal"
  const mine = document.getElementById('detailsModal');
  if (mine) mine.dataset.owner = MARATHON_MODAL_OWNER;
})();

// [NYTT] CSS för sticky scrollbar (samma som i precision)

function injectMarathonTableStyles() {
  if (document.getElementById('marathonResultsTableStyles')) return;
  const s = document.createElement('style');
  s.id = 'marathonResultsTableStyles';
  s.textContent = `
    .pr-table {
      border-collapse: separate; 
      border-spacing: 0;
      table-layout: auto;
      min-width: max-content;
      width: auto;
      font-size: 15px;
    }
    
    .pr-table thead th {
      position: sticky; top: 0; z-index: 2;
      background: #f9fafb;
      border-bottom: 2px solid #e5e7eb;
      white-space: nowrap;
      height: 44px;
    }
    
    .pr-table tbody td {
      white-space: nowrap;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
    }

    /* Wrap styles specifically for the new layout (no pr-card) */
    #marathon-x-wrap {
      width: 100%;
      overflow-x: auto;
      background: #fff;
    }

    /* Ensure utility classes work if Tailwind doesn't catch them */
    .w-max { width: max-content; }
    .min-w-max { min-width: max-content; }

    /* Standardläge (Mobil/Kortvy) */
    #marathon-x-wrap > table.pr-table { display: none; }
    #marathonCards { display: grid; }

    /* Desktop/Tabellvy */
    @media (min-width: 768px), (orientation: landscape) and (hover: none) {
      #marathon-x-wrap > table.pr-table { display: table; }
      #marathonCards { display: none; }
    }
  `;
  document.head.appendChild(s);
}

// === ETA helpers ===
let MARATHON_CONFIG = {};
let maraton_sortState = { key: 'startNumber', dir: 'asc' }; // Init sorting state

// === Merge helpers (TDB-klassnummer) ===
let MERGE_GROUPS = [];         // t.ex. [[1,2,4], [6,8]]
let MERGE_MAP = new Map();     // tdbClassNumber:number -> { key:string, label:string }

/**
 * Bygg merge-map från flera möjliga konfigformat.
 * Stödjer:
 *  - { groups: [[1,2,4],[6,8], ...] }
 *  - [[1,2,4],[6,8], ...]
 *  - { "NUM:1":"MERGE:1","NUM:2":"MERGE:1", ... } (äldre “map”-format)
 */
function buildMergeMap(raw) {
  MERGE_GROUPS = [];
  MERGE_MAP.clear();

  if (!raw) return;

  // 0) Om vi direkt får hela display-objektet: plocka ut mergeByClassNumber
  const maybeDisplay = raw && typeof raw === 'object' && raw.mergeByClassNumber ? raw : null;
  const source = maybeDisplay ? maybeDisplay.mergeByClassNumber : raw;

  // 1) Nytt format från admin: { "<grpKey>": { label: string, members: number[] }, ... }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [grpKey, info] of Object.entries(source)) {
      const members = (info?.members || []).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      if (!members.length) continue;
      const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
      const key = String(grpKey || `TDBGROUP:${members.join('+')}`);
      MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => MERGE_MAP.set(num, { key, label }));
    }
    return;
  }

  // 2) Arrayformat [[1,2,4], [6,8], ...]
  if (Array.isArray(source)) {
    const groups = source
      .map(arr => (Array.isArray(arr) ? arr.map(Number).filter(n => Number.isFinite(n)) : []))
      .filter(arr => arr.length > 0)
      .map(arr => arr.sort((a, b) => a - b));

    groups.forEach(members => {
      const key = `TDBGROUP:${members.join('+')}`;
      const label = `Sammanslagen: TDB #${members.join('/')}`;
      MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => MERGE_MAP.set(num, { key, label }));
    });
    return;
  }

  // 3) Äldre map-format: { "NUM:1":"MERGE:1", ... } – gruppera om
  if (source && typeof source === 'object') {
    const buckets = new Map(); // mergeKey -> Set(classNumbers)
    for (const [k, v] of Object.entries(source)) {
      const num = Number(String(k).replace(/^num:/i, ''));
      if (!Number.isFinite(num)) continue;
      const gk = String(v || '').trim() || `TDBGROUP:${num}`;
      if (!buckets.has(gk)) buckets.set(gk, new Set());
      buckets.get(gk).add(num);
    }
    for (const [gk, set] of buckets) {
      const members = [...set].sort((a, b) => a - b);
      const key = String(gk);
      const label = `Sammanslagen: TDB #${members.join('/')}`;
      MERGE_GROUPS.push({ key, label, members });
      members.forEach(num => MERGE_MAP.set(num, { key, label }));
    }
  }
}


/**
 * Beräkna merge-nyckel för ett ekipage.
 * Läser först per-ekipage-flagga, sedan global config.
 */
function mergedClassKeyFor(eq) {
  // 1) Per-ekipage flagga (från TDB-test merge)
  if (eq?.useMergedTestForDisplay && eq?.mergedTestKey) {
    return eq.mergedTestKey;
  }
  // 2) Global TDB-nummer merge (från config)
  const num = Number(eq?.tdbClassNumber);
  const hit = Number.isFinite(num) ? MERGE_MAP.get(num) : null;
  if (hit) return hit.key;

  // 3) Fallback
  return `CLS:${eq?.className || 'Okänd klass'}`;
}

/**
 * Beräkna merge-etikett för ett ekipage.
 * Läser först per-ekipage-flagga, sedan global config.
 */
function mergedClassLabelFor(eq) {
  // 1) Per-ekipage flagga
  if (eq?.useMergedTestForDisplay && eq?.mergedTestLabel) {
    return eq.mergedTestLabel;
  }
  // 2) Global TDB-nummer merge
  const num = Number(eq?.tdbClassNumber);
  const hit = Number.isFinite(num) ? MERGE_MAP.get(num) : null;
  if (hit) return hit.label;

  // 3) Fallback
  return eq?.className || 'Okänd klass';
}

// Säkerställ att alla ekipage har _mergedKey/_mergedLabel enligt aktuell MERGE_MAP
function ensureMergeDecorations() {
  if (!Array.isArray(maraton_equipages) || maraton_equipages.length === 0) return;
  let changed = false;
  maraton_equipages = maraton_equipages.map(e => {
    const newKey = mergedClassKeyFor(e);
    const newLabel = mergedClassLabelFor(e);
    if (e._mergedKey !== newKey || e._mergedLabel !== newLabel) {
      changed = true;
      return { ...e, _mergedKey: newKey, _mergedLabel: newLabel };
    }
    return e;
  });
  if (changed) {
    // trigga lätt omritning om vi redan är igång
    try { if (typeof render === 'function') render(); } catch { }
  }
}

function renderActiveMerges() {
  const host = document.getElementById('activeMerges');
  if (!host) return;

  if (!Array.isArray(MERGE_GROUPS) || MERGE_GROUPS.length === 0) {
    host.innerHTML = '';
    return;
  }

  const chips = MERGE_GROUPS.map(g => {
    const lbl = g.label || `TDB #${(g.members || []).join('/')}`;
    const count = maraton_equipages.filter(e =>
      Number.isFinite(Number(e.tdbClassNumber)) && g.members.includes(Number(e.tdbClassNumber))
    ).length;

    return `
      <span class="inline-flex items-center gap-2 px-2 py-1 rounded-full
                  bg-blue-50 border border-blue-200 text-blue-700">
        ${lbl}
        <span class="text-xs text-blue-600">(${count} ekipage)</span>
      </span>`;
  }).join('');

  host.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="font-semibold text-gray-700">Aktiva sammanslagningar:</span>
      ${chips}
    </div>`;
}

// === NY FUNKTION: Renderar klass-knapparna ===
function renderMaratonClassChips() {
  const chipHost = document.getElementById('maratonClassChips');
  if (!chipHost) return;

  // Använd maraton_equipages som redan har _mergedLabel
  const labels = [...new Set(maraton_equipages.map(e => e._mergedLabel || e.className || '—'))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'sv'));

  const base = "px-2 py-1 rounded border text-sm cursor-pointer";
  const on = "bg-gray-800 text-white border-gray-800";
  const off = "bg-white text-gray-700 border-gray-300 hover:bg-gray-50";

  chipHost.innerHTML = labels.map(lbl => {
    // Använd den nya state-variabeln
    const active = maraton_activeClassFilters.has(lbl); //
    return `<button type="button" data-class="${escapeHtml(lbl)}" class="${base} ${active ? on : off}">${escapeHtml(lbl)}</button>`; //
  }).join('');

  // Vi kopplar lyssnaren i load() för att undvika dubbletter
}

function getClassDistancesFromConfig(className) {
  const distCfg = MARATHON_CONFIG?.marathonClassDistances;
  if (distCfg) {
    const k = Object.keys(distCfg).find(x => className.startsWith(x)) || className;
    return distCfg[k] || null;
  }
  const dataCfg = MARATHON_CONFIG?.marathonClassData
    || MARATHON_CONFIG?.maratonClassData
    || {};
  const key = Object.keys(dataCfg).find(k => className.startsWith(k)) || className;
  const row = dataCfg[key];
  if (!row) return null;
  const tempoMpm = Number.isFinite(Number(row.tempoT)) ? Number(row.tempoT) : null;
  return {
    A: { distance: Number(row.distanceA) || 0 },
    T: { distance: Number(row.distanceT) || 0, tempo_mpm: tempoMpm },
    B: { distance: Number(row.distanceB) || 0 },
  };
}

// Fyll på dina TR-tempon här (m/min) om du vill ha klass-/kategori-specifika värden
const TR_TEMPO = {
  ponyA: { A: null, B: null },
  ponyB: { A: null, B: null },
  ponyCD: { A: null, B: null },
  horse: { A: null, B: null },
};

function tempoFor(stage, className, categoryKey, cfg) {
  if (stage === 'T') return cfg?.T?.tempo_mpm ?? null;            // Transport: från admin
  const tr = TR_TEMPO[categoryKey]?.[stage];                      // A/B: valfritt från TR
  return Number.isFinite(tr) ? tr : null;
}

function idealMillis(stage, className, categoryKey) {
  const cfg = getClassDistancesFromConfig(className);
  if (!cfg) return null;
  const dist = stage === 'A' ? (cfg.A?.distance || 0)
    : stage === 'B' ? (cfg.B?.distance || 0)
      : (cfg.T?.distance || 0);
  const tempo = tempoFor(stage, className, categoryKey, cfg);     // m/min
  if (!Number.isFinite(dist) || !Number.isFinite(tempo) || tempo <= 0) return null;
  return Math.round((dist / tempo) * 60 * 1000);
}

function fmtClock(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


// ---------- Global state ----------
let competitionId = null;
let isGloballyPaused = false;
let pauseStartTime = 0;

// === Responsive helpers ===
const MOBILE_BP = 600;
// isMobile imported from sharedUtils

// Debounce för live-snapshots så UI inte re-rendras för ofta
const renderLiveDebounce = debounce(render, 60);
const renderFinDebounce = debounce(render, 60);

// Väljer rätt vy
function render() {
  if (!ensureShell()) return;

  // LOGIC: Mobile (Small) AND Portrait = Cards. Else = Table.
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  const isSmall = window.innerWidth < 768; // Align with Tailwind md

  // Om användaren vill ha "Table mode" i landscape, så är det default om isSmall är false eller isLandscape är true
  // Kortvy endast om liten skärm OCH portrait.
  const useCards = isSmall && !isLandscape;

  const tableWrapper = document.getElementById('marathonTableWrapper');
  const cardWrapper = document.getElementById('marathonCards');

  // Toggle visibility
  if (tableWrapper) tableWrapper.style.display = useCards ? 'none' : 'block';
  if (cardWrapper) cardWrapper.style.display = useCards ? 'grid' : 'none';

  if (useCards) {
    window.__teardownXbarSync?.();
    renderMobile();
  } else {
    renderTable();
    // se till att X-baren syns i desktop
    try { window.__teardownXbarSync?.(); } catch { }

    const hostEl = document.getElementById('marathon-x-wrap');
    if (hostEl && window.__setupXbarSync) {
      // Viktigt: vänta 1–2 frames så att tabellen hinner få korrekt scrollWidth
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__setupXbarSync({
            barClass: 'fixed-xbar',
            innerId: 'marathonXbarInner',
            hostEl
          });
        });
      });
    }
  }
}

// Lista med globala pausintervall: { from:number, to:number|null }
let pauseWindows = [];

// === Finalisering (Maraton) ===
// I maraton sparas 'finalized: true' direkt i maraton-dokumentet (t.ex. artifacts/.../maraton/{sn}).
// Vi läser det från maraton_marathonMap som redan synkas via listenLive.

function isMarathonFinalized(sn) {
  const d = maraton_marathonMap.get(String(sn));
  return !!(d?.finalized || d?.status === 'Klar');
}

// Åtgärder (samma behörighetskontroll som i dressyr)
export function __finalizeMaraton(compId, sn) {
  const ref = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'maraton', String(sn));
  updateDoc(ref, { finalized: true, status: 'Klar', updatedAt: serverTimestamp() })
    .catch(err => {
      console.error('Finalize failed:', err);
      if (window.showAlert) window.showAlert('Kunde inte finalisera resultatet.', false);
    });
}
window.__finalizeMaraton = __finalizeMaraton;

export function __unfinalizeMaraton(compId, sn) {
  const ref = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'maraton', String(sn));
  updateDoc(ref, { finalized: false, status: 'Pågår', updatedAt: serverTimestamp() })
    .catch(err => {
      console.error('Unfinalize failed:', err);
      if (window.showAlert) window.showAlert('Kunde inte ångra finalisering.', false);
    });
}
window.__unfinalizeMaraton = __unfinalizeMaraton;

// Summera pausad tid mellan två klockslag
let maraton_equipages = [];
let maraton_marathonMap = new Map(); // ...
let maraton_startTimes = {};

// Skriv inte computed från klient i publik miljö
const CAN_PUBLISH_COMPUTED = false;

let maraton_viewMode = 'startorder';
let maraton_showOnlyFinalized = false;
let maraton_showOnlyOnB = false;
let maraton_searchQuery = '';
// === Klassfilter (för chips/knappar) ===
window.maraton_activeClassFilters ??= new Set();
const maraton_activeClassFilters = window.maraton_activeClassFilters;

// ---- Stage (A/T/B) state ----
let stageCols = [];              // vilka kolumner som ska visas, t.ex. ['A','transport','B']
let localStageTickers = {};      // "sn|stage" -> intervalId

// ---------- Utils ----------
const safeLower = (x) => (x == null ? '' : String(x)).toLowerCase();

// escapeHtml imported from sharedUtils



// === Hjälpare: säker extrahering av hinderdata ===
// Rendera hinderchips H1..H8 kompakt
function renderObstacleChips(res, max = 8) {
  const arr = getObstacleArray(res);
  const chips = [];

  for (let i = 1; i <= max; i++) {
    const o =
      arr.find(x => (x.no ?? x.nr ?? x.hinderNr) === i) ||
      arr[i - 1] ||
      null;

    let label = `H${i}`;
    if (o) {
      const { timeSec, penalty } = obstacleValues(o);
      const t = (timeSec != null && !Number.isNaN(timeSec))
        ? `${Number(timeSec).toFixed(1)}s`
        : '–';
      const p = Number(penalty || 0);
      label += ` ${t} (+${p.toFixed(2)})`;
    } else {
      label += ` – (+0)`;
    }

    chips.push(
      `<span class="inline-flex items-center px-2 py-1 rounded text-[11px] bg-gray-100 text-gray-700 border border-gray-200">
         ${label}
       </span>`
    );
  }

  return `<div class="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4 md:grid-cols-8">${chips.join('')}</div>`;
}


// FUNKTION FÖR PAUS-LYSSNARE
function listenForGlobalCompetitionPause_Results() {
  if (!competitionId || !appId) return;
  const statusRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus');

  return onSnapshot(statusRef, (docSnap) => {
    const isPausedNow = docSnap.exists() && docSnap.data().isPaused === true;

    if (isPausedNow && !isGloballyPaused) {
      // Paus startar nu
      pauseStartTime = Date.now();
      pauseWindows.push({ from: pauseStartTime, to: null });
      setPauseWindows(pauseWindows);
      render(); // <-- lägg till: frys UI direkt
    }

    isGloballyPaused = isPausedNow;
    document.body.style.filter = isPausedNow ? 'grayscale(80%)' : '';

    if (!isPausedNow) {
      // Paus slutar nu
      const last = pauseWindows[pauseWindows.length - 1];
      if (last && last.to == null) last.to = Date.now();
      render(); // redan fanns kvar
    }


  });
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

function classSettingsFor(cls) {
  return maraton_marathonConfig?.marathonClassData?.[cls] || {};
}
function globalRules() {
  return {
    timePenaltyRate: maraton_marathonConfig?.timePenaltyRate ?? 0.25,
    knockdownPenaltyDefault: maraton_marathonConfig?.knockdownPenaltyDefault ?? 5,
    obstacleMaxTime: maraton_marathonConfig?.obstacleMaxTime ?? 300,
    pauseTime: maraton_marathonConfig?.pauseTime ?? null
  };
}

// function sanitizeForFilename moved to sharedUtils


/**
 * Hämtar hästnamn för ett ekipage för ett specifikt moment.
 * Om 'moment' anges (t.ex. 'marathon') och val finns, visas de valda hästarna.
 * Annars visas alla registrerade hästar som fallback.
 * @param {object} equipage - Ekipageobjektet.
 * @param {'dressage' | 'marathon' | 'precision'} moment - Momentet att hämta hästar för.
 * @returns {string} - En sträng med hästnamn, separerade av ' & ', eller '—'.
 */
function getMomentHorseLabel(equipage, moment) {
  // === KOD FRÅN dressyr-resultat.js ===
  if (!equipage || typeof equipage !== 'object') return '—';
  const allHorsesRaw = equipage.horses || equipage.horseNames || equipage.horse || [];
  let allHorses = [];
  if (Array.isArray(allHorsesRaw)) {
    allHorses = allHorsesRaw.map(h => (typeof h === 'string' ? { name: h } : h)).filter(h => h && h.name);
  } else if (typeof allHorsesRaw === 'string' && allHorsesRaw.trim()) {
    allHorses = allHorsesRaw.split(/[\/,&+]|(?:\s*&\s*)/).map(name => ({ name: name.trim() })).filter(h => h.name);
  } else if (typeof allHorsesRaw === 'object' && allHorsesRaw.name) {
    allHorses = [allHorsesRaw];
  }
  if (allHorses.length === 0) return '—';
  const horseMap = new Map(allHorses.map(h => [h.id || h.name, h.name]));
  let horseIdsToShow = [];
  if (moment && equipage.momentHorses && Array.isArray(equipage.momentHorses[moment]) && equipage.momentHorses[moment].length > 0) {
    horseIdsToShow = equipage.momentHorses[moment];
  }
  if (horseIdsToShow.length > 0) {
    return horseIdsToShow.map(id => horseMap.get(id) || id).join(' & ');
  } else {
    return allHorses.map(h => h.name).filter(Boolean).join(' & ');
  }
  // === SLUT PÅ KOD FRÅN dressyr-resultat.js ===
}

/**
 * Hämtar hästnamn för ett specifikt moment och formaterar dem som stackade HTML-span.
 * @param {object} equipage - Ekipageobjektet.
 * @param {'dressage' | 'marathon' | 'precision'} moment - Momentet att hämta hästar för.
 * @returns {string} - HTML-sträng med stackade hästnamn, eller '—'.
 */
function getMomentHorseLabelStacked(equipage, moment) {
  const label = getMomentHorseLabel(equipage, moment);
  if (label === '—') return '—';
  const names = label.split(/\s*&\s*/); // Dela upp på " & "
  return names.map(n => `<span class="block">${n}</span>`).join('');
}

function getMaxObstacleNo() {
  let maxN = 0;
  maraton_marathonMap.forEach(d => {
    if (Array.isArray(d?.obstacles)) {
      d.obstacles.forEach(o => {
        if (Number.isFinite(o?.number)) maxN = Math.max(maxN, o.number);
      });
    }
  });
  if (maxN <= 0) maxN = 6;
  return Math.min(maxN, 8);
}


// --- Timing helpers (A/T/B) ---
// =====================================================
// CANONICAL A/T/B helpers – klassmedvetna & live-säkra
// =====================================================

const STAGE_KEYS = ['A', 'transport', 'B'];  // 'transport' = T

function rowStageCellsHTML(res) {
  return (stageCols || []).map(stKey => {
    const sData = res.stages[stKey];
    let val = '—';
    if (sData) {
      if (sData.eliminated) val = 'ELIM';
      else if (Number.isFinite(sData.timePenalty)) val = sData.timePenalty.toFixed(2);
    }

    return `<td class="px-3 py-2 text-center text-sm">
      <span class="tabular-nums" data-stage-pts="${res.startNumber}" data-stage="${stKey}">${val}</span>
    </td>`;
  }).join('');
}

const localLiveTickers = {};
const localObsTickers = {};

function stopLocalLiveTicker(sn) {
  const key = String(sn);
  if (localLiveTickers[key]) {
    clearInterval(localLiveTickers[key]);
    delete localLiveTickers[key];
  }
}

// attach/cleanupMarathonFinalizeListeners tas bort då listenLive sköter realtidsuppdatering för alla rader

function startOrUpdateLiveTicker(sn) {
  const key = String(sn);
  if (localLiveTickers[key]) return;

  // Hämta korrekt ekipage-objekt (behövs för limitsFor)
  const eq = maraton_equipages.find(e => String(e.startNumber) === key);

  const run = () => {
    // --- Paus-logik: Om tävlingen är pausad, "fryser" vi tiden helt ---
    if (isGloballyPaused) {
      return;
    }

    const d = maraton_marathonMap.get(key) || {};
    const t = timingDocFor(key);
    const liveLabelEl = document.querySelector(`[data-live-label="${key}"]`);
    const liveTimeEl = document.querySelector(`[data-live-time="${key}"]`);

    if (!liveTimeEl) {
      stopLocalLiveTicker(key);
      return;
    }

    let isAnythingRunning = false;

    document.querySelectorAll(`td[data-sn="${key}"] span[data-cell="obsVal"]`).forEach(el => {
      el.classList.remove('text-amber-700', 'animate-pulse', 'font-semibold');
    });

    // --- Hinder-logik ---
    if (d.running === true && isNum(d.currentObstacle)) {
      isAnythingRunning = true;
      const lastUpdateMs = d.liveObstacleTimeMs || 0;
      const lastUpdateTime = d.updatedAt?.toMillis ? d.updatedAt.toMillis() : Date.now();
      // Justera för global paus sedan senaste uppdateringsstämpeln
      const currentTimeMs = lastUpdateMs
        + (Date.now() - lastUpdateTime - pausedMsSince(lastUpdateTime));


      if (liveLabelEl) liveLabelEl.textContent = `H${d.currentObstacle}`;
      liveTimeEl.textContent = formatMsLive(currentTimeMs);
      liveTimeEl.classList.add('text-amber-700', 'animate-pulse', 'font-semibold');

      // --- Etapp-logik ---
    } else {
      for (const stage of STAGE_KEYS) {
        const s = stageStartTS(t, stage), e = stageStopTS(t, stage);
        if (s && !e) { // Etappen är aktiv
          isAnythingRunning = true;
          // Beräkna tiden från start till nu. Pausen hanteras av att denna funktion inte körs.
          const elapsedMs = (stageDurationMsSaved(t, stage) || 0)
            + (Date.now() - s - pausedMsSince(s));

          if (liveLabelEl) liveLabelEl.textContent = stage === 'transport' ? 'T' : stage;
          liveTimeEl.textContent = formatMsLive(elapsedMs);
          liveTimeEl.classList.add('text-amber-700', 'animate-pulse', 'font-semibold');

          // FIX: Använd 'eq'-objektet, inte className-sträng (om vi ska kunna slå upp idealtider)
          const { points, elim } = stagePenaltyFromMs(elapsedMs, eq, stage);
          const cellEl = document.querySelector(`[data-stage-pts="${key}"][data-stage="${stage}"]`);
          if (cellEl) cellEl.textContent = elim ? 'ELIM' : (isNum(points) ? points.toFixed(2) : '—');
          break;
        }
      }
    }

    // --- Städa upp om inget är igång ---
    if (!isAnythingRunning) {
      liveTimeEl.textContent = '—';
      liveTimeEl.classList.remove('text-amber-700', 'animate-pulse', 'font-semibold');
      if (liveLabelEl) liveLabelEl.textContent = '';
      stopLocalLiveTicker(key);
    }
  };

  run();
  localLiveTickers[key] = setInterval(run, 95);
}

function formatMsMMSS(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function startTimeFor(startNumber) {
  const row = maraton_startTimes?.[String(startNumber)] ?? maraton_startTimes?.[Number(startNumber)] ?? null;
  const val = row?.marathon ?? row?.b ?? row?.start_B ?? row?.start ?? row?.time ?? null;
  return val || null;
}

function formatStartTimeLabel(val) {
  if (!val) return '—';
  if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) return val;
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (_) { }
  return String(val);
}

function isFinalizedDoc(d) {
  return d?.finalized === true || d?.status === 'finalized' || d?.isFinal === true;
}





function statusClass(s) {
  if (s === 'Klar') return 'bg-green-100 text-green-800';
  if (s === 'Pågår') return 'bg-amber-100 text-amber-800';
  if (s === 'Eliminerad') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-600';
}

function activeRankFor(startNumber) {
  const sn = String(startNumber);
  const live = maraton_marathonMap.get(sn) || {};
  if (live.running === true || live.inProgress === true) return 0;
  const t = timingDocFor(sn) || {};
  if (t.start_B && !t.finish_B) return 1;
  if (isFinalizedDoc(live)) return 3;
  return 2;
}

function matchesSearch(eq) {
  if (!maraton_searchQuery) return true;
  const q = safeLower(maraton_searchQuery);
  const sn = String(eq.startNumber);
  if (sn.includes(q)) return true;
  if (safeLower(eq.driverName).includes(q)) return true;
  if (safeLower(eq.className).includes(q)) return true;
  if (safeLower(eq._mergedLabel || '').includes(q)) return true;
  const horses = Array.isArray(eq.horses) ? eq.horses.map(h => h?.name || h).join(' ') : (eq.horse || '');
  if (safeLower(horses).includes(q)) return true;
  return false;
}

function shortClubOrCountry(eq) {
  const club = eq.club || eq.clubName || eq.association || eq.federation || eq.team || eq.organisation || '';
  const country = (eq.country || eq.nation || eq.nationality || '').toString().trim();
  const c3 = country ? country.slice(0, 3).toUpperCase() : '';
  const clubShort = (club || '').toString().trim();
  return clubShort || c3 || '—';
}



// ---------- Stage helpers ----------
function hasAnyTimingForStage(s) {
  for (const v of maraton_marathonMap.values()) {
    const t = v || {};
    if (stageStartTS(t, s) || stageStopTS(t, s) || stageDurationMsSaved(t, s)) return true;
  }
  return false;
}

async function fetchImageDataUrl(url) {
  if (!url) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}

function _normClass(s) {
  return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}
function _pickClassRow(map, className) {
  if (!map) return null;
  if (map[className]) return map[className];
  const n = _normClass(className);
  for (const k of Object.keys(map)) {
    if (_normClass(k) === n) return map[k];
  }
  let bestKey = null, bestScore = 0;
  const tokens = n.split(' ').filter(Boolean);
  for (const k of Object.keys(map)) {
    const kn = _normClass(k);
    let score = 0;
    for (const t of tokens) if (t && kn.includes(t)) score++;
    if (score > bestScore) { bestScore = score; bestKey = k; }
  }
  if (bestKey && bestScore >= 2) return map[bestKey];
  return null;
}

function stageEnabled(s) {
  if (hasAnyTimingForStage(s)) return true;

  const distancesByClass = maraton_marathonConfig?.marathonClassData;
  if (!distancesByClass) {
    return false;
  }
  const field = s === 'A' ? 'distanceA' : s === 'B' ? 'distanceB' : 'distanceT';

  return Object.values(distancesByClass).some(classSettings => {
    const stageData = classSettings?.[s];
    return stageData && Number.isFinite(stageData.distance) && stageData.distance > 0;
  });
}

function timingDocFor(sn) {
  return maraton_marathonMap.get(String(sn)) || {};
}

function filteredSortedEquipages() {

  // Se till att _mergedKey/_mergedLabel speglar aktuell MERGE_MAP innan vi sorterar
  ensureMergeDecorations();

  let list = maraton_equipages.slice();

  list = list.filter(matchesSearch);

  // 1. Filter
  if (maraton_searchQuery) {
    const q = maraton_searchQuery.toLowerCase();
    list = list.filter(e =>
      String(e.startNumber).includes(q) ||
      (e.driverName || '').toLowerCase().includes(q) ||
      (e.className || '').toLowerCase().includes(q)
    );
  }

  list = list.filter(e => e.status !== 'struken'); // Re-applying the filter from previous task if it was there.

  if (maraton_activeClassFilters.size > 0) {
    list = list.filter(e => maraton_activeClassFilters.has(e._mergedLabel || e.className));
  }

  if (maraton_showOnlyFinalized) {
    list = list.filter(e => isMarathonFinalized(e.startNumber));
  } else if (maraton_showOnlyOnB) {
    list = list.filter(eq => {
      const sn = String(eq.startNumber);
      const d = maraton_marathonMap.get(sn) || {};
      const res = calculateMarathonResult(eq, d, timingDocFor(sn));
      return res.status === 'Pågår' || d.running === true;
    });
  }

  // 2. Sort
  const key = maraton_sortState.key;
  const dir = maraton_sortState.dir === 'asc' ? 1 : -1;
  const placeMap = buildPlacementsByClass(); // Optimization: Calculate once? It depends on `filteredSortedEquipages`? circular?
  // `buildPlacementsByClass` uses `maraton_equipages` (all), so it's safe.

  const getVal = (eq, k) => {
    const sn = String(eq.startNumber);
    const d = maraton_marathonMap.get(sn) || {};
    const res = calculateMarathonResult(eq, d, timingDocFor(sn));

    // Sort keys
    if (k === 'place') return placeMap.get(sn) || 9999;
    if (k === 'startNumber') return Number(eq.startNumber) || 0;
    if (k === 'driverName') return (eq.driverName || '').toLowerCase();
    if (k === 'className') return (eq._mergedLabel || eq.className || '').toLowerCase();
    if (k === 'clubName') return (eq.clubName || '').toLowerCase();
    if (k === 'startTime') return startTimeFor(sn) || '99:99'; // ISO-time string sorts correctly
    if (k === 'eta') {
      // Sort by ETA B, then A
      const eta = res.eta.B || res.eta.A;
      return eta ? new Date(eta).getTime() : 9999999999999;
    }
    if (k === 'live') return 0; // Not really sortable?
    if (k === 'obsSum') return isNum(res.obstacles.sum) ? res.obstacles.sum : 9999;
    if (k === 'otherPenalty') return isNum(res.otherPenalty) ? res.otherPenalty : 9999;
    if (k === 'totalPenalty') return (res.totalPenalty === Infinity) ? 99999 : (res.totalPenalty || 0);
    if (k === 'status') return res.status || '';

    // Stages/Obstacles
    if (k.startsWith('stage-')) {
      const st = k.split('stage-')[1]; // e.g. 'A'
      const p = res.stages[st]?.penalty;
      return isNum(p) ? p : 9999;
    }
    if (k.startsWith('obs-')) {
      const n = parseInt(k.split('obs-')[1]);
      const item = (res.obstacles.items || []).find(o => Number(o.number) === n);
      return (item && isNum(item.penalty)) ? Number(item.penalty) : 9999;
    }
    return 0;
  };

  list.sort((a, b) => {
    if (maraton_viewMode === 'byclass' && key === 'place') {
      // If viewing by class AND sorting by place (default), grouping logic overrides or wraps.
      // Actually `renderTable` handles grouping visually. Sorting here should just sort.
      // But if we sort by Place globally, the grouping might look weird if we don't group first.
      // Standard behavior: Sort by Class first, then Key.
      const aLabel = safeLower(a._mergedLabel || a.className || '');
      const bLabel = safeLower(b._mergedLabel || b.className || '');
      const classCompare = aLabel.localeCompare(bLabel, 'sv');
      if (classCompare !== 0) return classCompare;
    }

    const va = getVal(a, key);
    const vb = getVal(b, key);

    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'sv') * dir;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  return list;
}

function calculateMarathonDateStr() {
  const dateCounts = {};
  Object.values(maraton_startTimes).forEach(timeEntry => {
    const marathonTime = timeEntry?.marathon || timeEntry?.maraton;
    if (marathonTime) {
      const datePart = marathonTime.split('T')[0];
      if (datePart) dateCounts[datePart] = (dateCounts[datePart] || 0) + 1;
    }
  });
  let mostCommonDate = null;
  let maxCount = 0;
  for (const date in dateCounts) {
    if (dateCounts[date] > maxCount) { maxCount = dateCounts[date]; mostCommonDate = date; }
  }
  if (mostCommonDate) {
    return new Date(mostCommonDate).toLocaleDateString('sv-SE', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
  return '';
}

function ensureShell() {
  const root = document.getElementById('page-maraton-results');
  if (!root) return false;
  const shellId = 'maraton-results-shell';
  if (document.getElementById(shellId)) return true;

  root.innerHTML = `
        <div id="${shellId}" class="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen">
          <div class="mb-8">
             ${getCompetitionHeader(getGlobalState('currentCompetition'), 'Maraton – Start- & Resultatlista')}
             <h3 id="maratonDateHeader" class="text-lg text-gray-500 mt-1 font-medium text-center"></h3>
          </div>

          <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-col lg:flex-row gap-4 items-center justify-between" id="modeToggle">
            
            <div class="flex flex-col md:flex-row items-center gap-4 w-full lg:w-auto">
                <div class="relative w-full md:w-72">
                     <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg class="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                     </div>
                     <input type="text" id="marSearchBox" 
                        class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-gray-50 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-shadow"
                        placeholder="Sök kusk, häst..."
                      >
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <div class="inline-flex shadow-sm rounded-md bg-gray-100 p-1">
                        <button id="marBtnStartOrder" data-mode="startorder" class="px-4 py-1.5 text-sm font-medium rounded transition-all">Startordning</button>
                        <button id="marBtnByClass" data-mode="byclass" class="px-4 py-1.5 text-sm font-medium rounded transition-all">Klassvis</button>
                    </div>
                    
                    <div class="w-px h-6 bg-gray-300 mx-2 hidden md:block"></div>

                    <button id="marToggleOnB" class="px-3 py-1.5 text-sm font-medium rounded border transition-colors">
                      <!-- Text updated via JS -->
                    </button>
                    <button id="marToggleFinalized" class="px-3 py-1.5 text-sm font-medium rounded border transition-colors">
                       <!-- Text updated via JS -->
                    </button>
                </div>
            </div>

            <div class="flex-shrink-0 flex items-center gap-2">
                <button id="marBtnExportCsv" 
                  class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors">
                   <i class="fas fa-file-csv mr-2 -ml-1 text-gray-500"></i>
                   CSV
                </button>
                <button id="marBtnExportMarathonPdf" 
                  class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors">
                  <svg class="mr-2 -ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                   Skriv ut PDF
                </button>
            </div>
          </div>
          
          <div id="activeMerges" class="mb-4"></div>
          <div id="maratonClassChips" class="flex flex-wrap gap-2 mb-6"></div>

          <div id="marathonTableWrapper" class="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
             <div id="marathon-x-wrap" class="x-scroll-wrap bg-white w-full overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200" id="marathonTable">
                    <thead class="bg-gray-50" id="marathonTableHead"></thead>
                    <tbody class="bg-white divide-y divide-gray-200" id="marathonBody"></tbody>
                </table>
             </div>
          </div>
          
          <div id="marathonCards" class="mt-6 grid gap-4 grid-cols-1"></div>
        </div>
      `;
  wireControls(); // Bind listeners ONLY ONCE
  const sb = document.getElementById('marSearchBox');
  if (sb) sb.value = maraton_searchQuery || '';
  return true;
}

function renderTable() {
  if (!ensureShell()) return;

  const marathonDateStr = calculateMarathonDateStr();
  const list = filteredSortedEquipages();
  const maxObs = getMaxObstacleNo();
  const placeMap = buildPlacementsByClass();

  const isOnB = maraton_showOnlyOnB;
  const isClass = maraton_viewMode === 'byclass';
  const isFin = maraton_showOnlyFinalized;

  // --- 2. UPDATE STATIC ELEMENTS ---
  const dateEl = document.getElementById('maratonDateHeader');
  if (dateEl) dateEl.innerText = marathonDateStr || '';

  const btnStartOrder = document.getElementById('marBtnStartOrder');
  const btnByClass = document.getElementById('marBtnByClass');
  if (btnStartOrder) {
    btnStartOrder.className = `px-4 py-1.5 text-sm font-medium rounded transition-all ${!isClass ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`;
  }
  if (btnByClass) {
    btnByClass.className = `px-4 py-1.5 text-sm font-medium rounded transition-all ${isClass ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`;
  }

  const btnOnB = document.getElementById('marToggleOnB');
  if (btnOnB) {
    btnOnB.className = `px-3 py-1.5 text-sm font-medium rounded border transition-colors ${isOnB ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`;
    btnOnB.innerText = isOnB ? 'Visa alla' : 'Endast pågående';
  }

  const btnFin = document.getElementById('marToggleFinalized');
  if (btnFin) {
    btnFin.className = `px-3 py-1.5 text-sm font-medium rounded border transition-colors ${isFin ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`;
    btnFin.innerText = isFin ? 'Visa alla' : 'Endast klara';
  }


  // --- 3. DYNAMIC CONTENT ---
  const tableHead = document.getElementById('marathonTableHead');
  const tableBody = document.getElementById('marathonBody');
  const xWrap = document.getElementById('marathon-x-wrap');

  // Helper for dynamic headers
  const thClass = "px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider align-middle";
  const thCenter = "px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider align-middle";

  stageCols = STAGE_KEYS.filter(stageEnabled);
  const getSortIcon = (k) => {
    if (maraton_sortState.key !== k) return '<span class="text-gray-300 opacity-50 text-[10px] w-3 text-center">↕</span>';
    return maraton_sortState.dir === 'asc'
      ? '<span class="text-gray-800 text-[10px] w-3 text-center">↓</span>'
      : '<span class="text-gray-800 text-[10px] w-3 text-center">↑</span>';
  };
  const thSort = (cls, key, txt) => {
    const justify = cls.includes('text-center') ? 'justify-center' : 'justify-start';
    return `<th class="${cls} cursor-pointer hover:bg-gray-100 select-none" data-sort-key="${key}">
                <div class="flex items-center gap-1 ${justify}">
                  <span>${txt}</span>${getSortIcon(key)}
                </div>
              </th>`;
  };

  const stageHead = stageCols.map(st => thSort("px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider align-middle", `stage-${st}`, stageLabel(st))).join('');
  const obsHead = Array.from({ length: maxObs }, (_, i) => thSort("px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider align-middle", `obs-${i + 1}`, `H${i + 1}`)).join('');
  const klassTH = isClass ? '' : thSort(thClass, 'className', 'Klass');

  if (tableHead) {
    tableHead.innerHTML = `
        <tr>
            ${thSort(`${thClass} w-10 text-center`, 'place', '#')}
            ${thSort(`${thClass} w-12`, 'startNumber', 'Nr')}
            ${thSort(thClass, 'driverName', 'Ekipage')}
            ${klassTH}
            ${thSort(thClass, 'clubName', 'Klubb')}
            ${thSort(thClass, 'startTime', 'Start')}
            ${thSort(thClass, 'eta', 'ETA')}
            ${thSort(thClass, 'live', 'Live')}
            ${stageHead}
            ${obsHead}
            ${thSort(thCenter, 'obsSum', 'H-Straff')}
            ${thSort(thCenter, 'otherPenalty', 'Övr')}
            ${thSort(thCenter, 'totalPenalty', 'Totalt')}
            ${thSort(thClass, 'status', 'Status')}
            <th class="${thClass}">Admin</th>
        </tr>
      `;
  }

  const renderRow = (eq, index) => {
    const sn = String(eq.startNumber), d = maraton_marathonMap.get(sn) || {};
    const res = calculateMarathonResult(eq, d, timingDocFor(sn));
    const isStruken = eq.status === 'struken';
    const status = res.status;
    const isActive = status && status.includes('Påg');

    let rowBgClass;
    let rowStyle = '';

    if (isStruken) {
      rowBgClass = 'opacity-60 bg-red-50';
    } else if (isActive) {
      rowBgClass = 'bg-yellow-50 border-l-4 border-yellow-500 shadow-sm relative z-10';
      rowStyle = 'background-color: #fefce8; border-left: 4px solid #eab308;';
    } else {
      rowBgClass = (index % 2 === 0 ? 'bg-white' : 'bg-gray-50');
    }

    const startTimeValue = startTimeFor(sn);
    const startLabel = startTimeValue ? (startTimeValue.split('T')[1] || '—') : '—';
    const etaLabel = res.eta.B ? fmtClock(res.eta.B) : (res.eta.A ? fmtClock(res.eta.A) : '—');

    const place = placeMap.get(sn);
    const totalPen = res.totalPenalty;
    const totalLabel = (totalPen === Infinity) ? 'ELIM' : (isNum(totalPen) ? totalPen.toFixed(2) : '—');

    return `<tr class="${rowBgClass} hover:bg-blue-50 transition-colors" data-sn="${sn}" style="cursor: pointer; ${rowStyle}">
        <td class="px-3 py-4 text-center font-bold text-gray-700">${isNum(place) ? place : '—'}</td>
        <td class="px-3 py-4 text-sm font-medium text-gray-900">${sn}</td>
        <td class="px-3 py-4">
            <div class="text-base font-bold text-gray-900">${eq.driverName || '-'}</div>
            <div class="text-xs text-gray-500 mt-0.5">${getMomentHorseLabelStacked(eq, 'marathon')}</div>
        </td>
        ${isClass ? '' : `<td class="px-3 py-4 text-sm text-gray-500">${eq._mergedLabel || eq.className || '-'}</td>`}
        <td class="px-3 py-4 text-sm text-gray-500">
             <div class="flex items-center gap-1.5">
                  ${getFlagHtml(eq)}
                  ${getClubLogoHtml(eq)}
                  <span class="truncate max-w-[120px]" title="${eq.clubName || ''}">${eq.clubName || ''}</span>
             </div>
        </td>
        <td class="px-3 py-4 text-sm text-gray-900">${startLabel}</td>
        <td class="px-3 py-4 text-sm font-mono">${etaLabel}</td>
        <td class="px-3 py-4 text-sm tabular-nums">
             <span data-live-label="${sn}" class="text-xs font-bold text-gray-400 mr-1"></span>
             <span data-live-time="${sn}" class="font-bold text-gray-700">—</span>
        </td>

        ${rowStageCellsHTML(res)}
        ${rowObstacleCells(res, maxObs)}

        <td class="px-3 py-4 text-center text-sm font-bold text-gray-700">${isNum(res.obstacles.sum) ? res.obstacles.sum.toFixed(2) : '-'}</td>
        <td class="px-3 py-4 text-center text-sm text-gray-500">${isNum(res.otherPenalty) ? res.otherPenalty.toFixed(2) : '-'}</td>
        <td class="px-3 py-4 text-center text-sm font-black text-gray-900">${totalLabel}</td>
        <td class="px-3 py-4 text-sm">
             <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass(status)}">
               ${status}
             </span>
        </td>
        <td class="px-3 py-4 text-sm">
             <div class="flex items-center gap-2" data-finalize-slot>
               ${(() => {
        const compId = getGlobalState('currentCompetition')?.id;
        const can = window.canFinalize && window.canFinalize();
        const finalized = isMarathonFinalized(sn);
        if (!can) return '';
        return finalized
          ? `<button class="text-emerald-600 hover:text-emerald-800 text-xs border border-emerald-200 bg-emerald-50 px-2 py-1 rounded" onclick="event.stopPropagation(); __unfinalizeMaraton('${compId}','${sn}')">Ångra</button>`
          : `<button class="text-white bg-emerald-600 hover:bg-emerald-700 text-xs px-2 py-1 rounded shadow-sm" onclick="event.stopPropagation(); __finalizeMaraton('${compId}','${sn}')">Finalisera</button>`;
      })()}
             </div>
        </td>
    </tr>`;
  };

  if (tableBody) {
    if (list.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="99" class="p-12 text-center text-gray-400 italic">Inga resultat att visa.</td></tr>`;
    } else if (isClass) {
      let html = '';
      const groups = new Map();
      list.forEach(e => {
        const k = e._mergedKey || `CLS:${e.className || 'Okänd'}`;
        if (!groups.has(k)) groups.set(k, { label: e._mergedLabel || e.className || 'Okänd', rows: [] });
        groups.get(k).rows.push(e);
      });
      [...groups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'sv')).forEach(([, grp]) => {
        html += `<tr class="bg-gray-100 border-t border-b border-gray-200"><td colspan="99" class="px-4 py-2 font-bold text-gray-700 text-sm">${grp.label}</td></tr>`;
        grp.rows.forEach((eq, index) => html += renderRow(eq, index));
      });
      tableBody.innerHTML = html;
    } else {
      tableBody.innerHTML = list.map((eq, index) => renderRow(eq, index)).join('');
    }
  }

  // Chips & Mobile
  renderActiveMerges();
  renderMaratonClassChips();
  renderMobile();

  // Scroll Sync & Tickers
  if (xWrap && window.__setupXbarSync) {
    try { window.__setupXbarSync({ barClass: 'fixed-xbar', innerId: 'marathonXbarInner', hostEl: xWrap }); } catch { }
  }
  try { list.forEach(eq => startOrUpdateLiveTicker(eq.startNumber, eq.className || '')); } catch { }
}


function wireControls() {
  const input = document.getElementById('marSearchBox');
  const wrap = document.getElementById('modeToggle');

  if (input) {
    input.addEventListener('input', (e) => {
      maraton_searchQuery = e.target.value || '';
      render();
    });
  }

  // Bind direkt på knapparna (robust även om wrapper saknas)
  const btnStart = document.getElementById('marBtnStartOrder');
  const btnClass = document.getElementById('marBtnByClass');
  const btnFin = document.getElementById('marToggleFinalized');
  const btnOnB = document.getElementById('marToggleOnB');

  if (btnStart) btnStart.onclick = () => { maraton_viewMode = 'startorder'; render(); };
  if (btnClass) btnClass.onclick = () => { maraton_viewMode = 'byclass'; render(); };

  if (btnFin) btnFin.onclick = () => { maraton_showOnlyFinalized = !maraton_showOnlyFinalized; render(); };
  if (btnOnB) btnOnB.onclick = () => { maraton_showOnlyOnB = !maraton_showOnlyOnB; render(); };


  const btnPdf = document.getElementById('marBtnExportMarathonPdf');
  if (btnPdf) {
    // Remove old listeners? No easy way, but since wireControls is only called once per shell creation, it should be fine.
    // Ideally we clone and replace to strip listeners if we were re-wiring. 
    // But now we are only wiring once.
    btnPdf.onclick = async () => {
      try {
        const freshComp = getGlobalState('currentCompetition') || {};
        let list = (typeof maraton_equipages !== 'undefined') ? [...maraton_equipages] : [];
        const search = document.getElementById('marSearchBox')?.value.toLowerCase();

        // MERGE WITH LIVE RESULTS + NORMALIZE
        if (typeof maraton_marathonMap !== 'undefined') {
          list = list.map(eq => {
            const norm = normalizeEquipage(eq);
            const sn = String(norm.startNumber);
            const raw = maraton_marathonMap.get(sn);
            const calc = calculateMarathonResult(norm, raw, maraton_marathonConfig);
            return { ...norm, place: eq.place, results: { marathon: calc } };
          });
        }

        if (search) {
          list = list.filter(e => (e.driverName || '').toLowerCase().includes(search) || String(e.startNumber).includes(search));
        }
        list.sort((a, b) => (a.place || 9999) - (b.place || 9999));

        await generateMarathonListPdf(list, freshComp);
      } catch (err) {
        console.error(err);
        alert('Kunde inte skapa PDF: ' + err.message);
      }
    };
  }

  const btnCsv = document.getElementById('marBtnExportCsv');
  if (btnCsv) {
    btnCsv.onclick = () => {
      const comp = getGlobalState('currentCompetition');
      const date = new Date().toISOString().split('T')[0];
      const filename = `maraton_resultat_${sanitizeForFilename(comp?.name || 'tavling')}_${date}.csv`;

      const list = filteredSortedEquipages();
      const maxObs = getMaxObstacleNo();
      const activeStages = STAGE_KEYS.filter(stageEnabled);
      const placeMap = buildPlacementsByClass();

      const headers = [
        'Plac', 'Nr', 'Kusk', 'Häst', 'Klass', 'Klubb', 'Start', 'ETA'
      ];

      activeStages.forEach(st => headers.push(`Sträcka ${st}`));
      for (let i = 1; i <= maxObs; i++) headers.push(`H${i}`);

      headers.push('H-Straff', 'Övr-Straff', 'Totalt', 'Status');

      const rows = list.map(eq => {
        const sn = String(eq.startNumber);
        const d = maraton_marathonMap.get(sn) || {};
        const t = timingDocFor(sn);
        const res = calculateMarathonResult(eq, d, t);

        const startTimeValue = startTimeFor(sn);
        const startLabel = startTimeValue ? (startTimeValue.split('T')[1] || '—') : '—';
        const etaLabel = res.eta.B ? fmtClock(res.eta.B) : (res.eta.A ? fmtClock(res.eta.A) : '—');

        const place = placeMap.get(sn);
        const totalPen = res.totalPenalty;
        const totalLabel = (totalPen === Infinity) ? 'ELIM' : (isNum(totalPen) ? totalPen.toFixed(2) : '—');

        const row = [
          isNum(place) ? place : '—',
          sn,
          eq.driverName || '—',
          getMomentHorseLabel(eq, 'marathon'),
          eq._mergedLabel || eq.className || '—',
          eq.clubName || '—',
          startLabel,
          etaLabel
        ];

        // Stage penalties
        activeStages.forEach(st => {
          const sData = res.stages[st];
          let val = '—';
          if (sData) {
            if (sData.eliminated) val = 'ELIM';
            else if (isNum(sData.timePenalty)) val = sData.timePenalty.toFixed(2);
          }
          row.push(val);
        });

        // Obstacle penalties
        const obsArr = getObstacleArray(d);
        for (let i = 1; i <= maxObs; i++) {
          const o = obsArr.find(x => (x.number ?? x.no ?? x.nr ?? x.hinderNr) === i) || null;
          if (o) {
            const { penalty } = obstacleValues(o);
            const p = isNum(penalty) ? penalty : 0;
            row.push(p.toFixed(2));
          } else {
            row.push('0,00');
          }
        }

        row.push(
          isNum(res.obstacles.sum) ? res.obstacles.sum.toFixed(2) : '0,00',
          isNum(res.otherPenalty) ? res.otherPenalty.toFixed(2) : '0,00',
          totalLabel,
          res.status || '—'
        );

        return row;
      });

      downloadCsv(filename, headers, rows);
    };
  }

  const table = document.getElementById('marathonTable');
  if (table) {
    // Header click
    const thead = document.getElementById('marathonTableHead');
    if (thead) {
      thead.onclick = (e) => {
        const th = e.target.closest('th[data-sort-key]');
        if (!th) return;
        const key = th.dataset.sortKey;
        if (maraton_sortState.key === key) {
          maraton_sortState.dir = maraton_sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
          maraton_sortState.key = key;
          maraton_sortState.dir = 'asc';
        }
        render();
      };
    }

    table.onclick = (e) => {
      // Ignore header clicks on sorting (handled above, or if bubble)
      if (e.target.closest('thead')) return;

      const targetEl = e.target.closest('tr[data-sn]') || e.target.closest('button[data-sn]');
      if (!targetEl) return;
      const sn = targetEl.getAttribute('data-sn');
      if (!sn) return;

      if (e.target.closest('button') && !e.target.closest('.eqLink')) return; // Allow eqLink (driver name) to bubble, block admin buttons if any?
      // Actually admin buttons have their own onclick with stopPropagation.
      // So we just need to handle row click.

      e.preventDefault();
      showDetailsModal(sn, maraton_equipages, maraton_marathonMap);
    };
  }
}




function rowObstacleCells(res, maxObs) {
  return Array.from({ length: maxObs }, (_, i) => {
    const n = i + 1;
    const obsItem = (res.obstacles.items || []).find(o => Number(o.number) === n);
    const finalP = (obsItem && Number.isFinite(Number(obsItem.penalty))) ? Number(obsItem.penalty) : null;
    const label = (finalP !== null) ? finalP.toFixed(2) : '—';

    return `<td class="px-3 py-2 text-center text-sm font-normal tabular-nums" data-sn="${res.startNumber}" data-obs="${n}">
                    <span data-cell="obsVal">${label}</span>
                </td>`;
  }).join('');
}

function stageLabel(s) {
  return s === 'transport' ? 'T' : String(s || '').toUpperCase();
}



function buildPlacementsByClass() {
  const byGroup = {};
  const map = new Map();

  for (const eq of maraton_equipages) {
    const sn = String(eq.startNumber);
    const d = maraton_marathonMap.get(sn) || {};
    if (!isFinalizedDoc(d)) continue;

    const res = calculateMarathonResult(eq, d, timingDocFor(sn));
    const tot = res.totalPenalty;

    if (!Number.isFinite(tot)) continue;

    // 🧩 Gruppnyckel för placering: sammanslagen klass om vald, annars original
    const grpKey = eq._mergedKey || `CLS:${eq.className || 'Okänd klass'}`;
    (byGroup[grpKey] ||= []).push({ sn, tot });
  }

  for (const grpKey of Object.keys(byGroup)) {
    const arr = byGroup[grpKey].sort((a, b) => a.tot - b.tot);
    let place = 1;
    let prev = null;
    arr.forEach((row, i) => {
      if (prev !== null && Math.abs(row.tot - prev) < 1e-6) {
        // delad plac — låt samma “place”
      } else {
        place = i + 1;
        prev = row.tot;
      }
      map.set(row.sn, place);
    });
  }

  return map;
}






// Hjälp: bygg etiketter vi använder på korten
function buildCardData(eq) {
  const sn = String(eq.startNumber);
  const d = maraton_marathonMap.get(sn) || {};
  const res = calculateMarathonResult(eq, d, timingDocFor(sn));

  const status = res.status;
  const placeMap = buildPlacementsByClass();
  const place = placeMap.get(sn) || '—';

  const totalPen = res.totalPenalty;
  const totalLabel = (totalPen === Infinity) ? 'ELIM' : (isNum(totalPen) ? totalPen.toFixed(2) : '—');

  // ETA-beräkning (samma logik som i tabell-raden)
  const etaLabel = res.eta.B ? fmtClock(res.eta.B) : (res.eta.A ? fmtClock(res.eta.A) : '—');

  const startVal = startTimeFor(sn);
  const startLabel = startVal ? (String(startVal).split('T')[1] || String(startVal)) : '—';

  return { sn, d, status, place, totalLabel, etaLabel, startLabel };
}

// Mobilvy (kort) – samma idé som i precision
function renderMobile() {
  renderMaratonClassChips();
  const wrap = document.getElementById('marathonCards');
  if (!wrap) return;

  const list = filteredSortedEquipages(); // Hämtar filtrerad/sorterad lista
  renderActiveMerges();

  if (list.length === 0) {
    wrap.innerHTML = `<div class="p-6 text-center text-gray-500">Inga ekipage matchar din sökning.</div>`;
    const xbar = document.querySelector('.pr-xbar');
    if (xbar) xbar.style.display = 'none';
    return;
  }

  const compId = getGlobalState('currentCompetition')?.id;
  const can = window.canFinalize && window.canFinalize();

  let lastClass = null; // För att hålla koll på klass-byten

  const html = list.map(eq => { // 'eq' är nu ekipage-objektet
    const cd = buildCardData(eq); //
    const statusCls = statusClass(cd.status); //
    const finalized = isMarathonFinalized(eq.startNumber); //

    const currentClassLabel = eq._mergedLabel || eq.className || 'Okänd Klass'; //
    let classHeader = '';
    if (maraton_viewMode === 'byclass' && currentClassLabel !== lastClass) { //
      classHeader = `<div class="px-4 py-2 mt-2 bg-blue-100 text-blue-800 font-bold text-lg rounded-md">${currentClassLabel}</div>`;
      lastClass = currentClassLabel;
    }

    return `
      <div class="m-2 rounded-xl border shadow-sm bg-white overflow-hidden cursor-pointer" data-sn="${cd.sn}" role="button" tabindex="0">
        <div class="px-4 py-3 border-b bg-gray-50 flex items-start justify-between gap-4">
          <div>
            <div class="font-semibold text-lg">#${eq.startNumber} ${eq.driverName || ''}</div>
            <div class="text-sm text-gray-500 italic">${getMomentHorseLabel(eq, 'marathon')}</div>
          </div>
          <div class="text-center flex-shrink-0">
            <div class="text-xs text-gray-500">Plac.</div>
            <div class="text-2xl font-bold">${cd.place}</div>
          </div>
        </div>

<div class="p-4 grid grid-cols-1 gap-y-2 text-sm">
          <div class="flex justify-between"><span class="text-gray-500">Klass:</span> <span class="font-medium text-right">${currentClassLabel}</span></div>
          <div class="flex justify-between items-center">
            <span class="text-gray-500">Klubb:</span>
            <span class="font-medium flex items-center gap-2 text-right">
              ${getFlagHtml(eq)}
              ${getClubLogoHtml(eq)}
              <span class="truncate">${eq.clubName || '—'}</span>
            </span>
          </div>
          <div class="flex justify-between"><span class="text-gray-500">Starttid:</span> <span class="font-medium text-right">${cd.startLabel}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">ETA (A/B):</span> <span class="font-medium text-right">${cd.etaLabel}</span></div>
        </div>

        <!-- Hinderchips H1–H8 -->
        <div class="px-4">
          ${renderObstacleChips(maraton_marathonMap.get(String(eq.startNumber)) || {}, 8)}
        </div>

        <!-- Summor + status -->
        <div class="px-4 py-3 border-t grid grid-cols-2 gap-4 items-center">
          <div class="text-center">
            <div class="text-xs text-gray-500">Totalt</div>
            <div class="font-bold text-blue-800 text-lg">${cd.totalLabel}</div>
          </div>
          <div class="text-center">
            <div class="text-xs text-gray-500">Status</div>
            <div class="inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusCls}">${cd.status}</div>
          </div>
        </div>

        <!-- Finalisera/Ångra (endast om behörig) -->
        ${!can ? '' : `
          <div class="px-4 pb-3 -mt-2">
            <div class="flex items-center gap-2 flex-wrap" data-finalize-slot>
              ${finalized
          ? `
                  <span class="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">Finaliserad</span>
                  <button type="button"
                          class="px-2 py-1 text-xs rounded border border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                          onclick="event.stopPropagation(); window.__unfinalizeMaraton('${compId}','${eq.startNumber}')">
                    Ångra
                  </button>`
          : `
                  <button type="button"
                          class="px-2 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700"
                          onclick="event.stopPropagation(); window.__finalizeMaraton('${compId}','${eq.startNumber}')">
                    Finalisera
                  </button>`
        }
            </div>
          </div>
        `}
      </div>
    `;
  }).join('');

  // 2. Bygg rader
  wrap.innerHTML = html;

  // Starta/uppdatera klockor för de ekipage som syns
  list.forEach(eq => startOrUpdateLiveTicker(eq.startNumber));
  wrap.querySelectorAll('[data-sn]').forEach(card => {
    const sn = card.getAttribute('data-sn');
    const open = () => showDetailsModal(sn, maraton_equipages, maraton_marathonMap);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open();
    });
  });

  // Dölj x-bar i mobil
  const xbar = document.querySelector('.pr-xbar');
  if (xbar) xbar.style.display = 'none';
}

// ---------- Live ----------
let liveUnsub = [];

function listenLive() {
  if (Array.isArray(liveUnsub)) {
    liveUnsub.forEach(u => { try { u(); } catch { } });
  }
  liveUnsub = [];
  if (!competitionId) return; // starta inte lyssning innan tävling är vald

  const competitionPath = `artifacts/${appId}/public/data/competitions/${competitionId}`;
  const maratonPath = `${competitionPath}/maraton`;
  const timingPath = `${competitionPath}/maraton-timing`;

  const handleSnapshot = async (snap) => {
    let hasChanges = false;
    const pending = [];
    snap.docChanges().forEach(change => {
      hasChanges = true;
      const id = String(change.doc.id);
      const newData = change.doc.data();
      if (change.type === 'removed') {
        maraton_marathonMap.delete(id);
      } else {
        const existingData = maraton_marathonMap.get(id) || {};
        maraton_marathonMap.set(id, { ...existingData, ...newData });
        // --- skriv computed-resultat för detta ekipage (villkorligt) ---
        try {
          if (CAN_PUBLISH_COMPUTED) {
            const eq = maraton_equipages.find(e => String(e.startNumber) === id);
            if (eq) {
              const res = calculateMarathonResult(eq, maraton_marathonMap.get(id), timingDocFor(id));
              // Adaptera till formatet som sparas (samma som förut)
              const agg = {
                marathon: {
                  duration_A: res.stages.A.durationMs ? Math.round(res.stages.A.durationMs / 1000) : null,
                  duration_B: res.stages.B.durationMs ? Math.round(res.stages.B.durationMs / 1000) : null,
                  timePenalty: (res.stages.A.timePenalty || 0) + (res.stages.B.timePenalty || 0),
                  obstaclePenalty: res.obstacles.sum,
                  totalPenalty: res.totalPenalty,
                  eliminated: res.eliminated
                }
              };

              pending.push(
                saveComputedEquipageResult(competitionId, id, agg)
                  .catch(e => console.warn('Kunde inte publicera computed maraton', id, e))
              );
            }
          }
        } catch (e) {
          console.warn('Kunde inte beräkna computed maraton', id, e);
        }
      }
    });
    if (pending.length) await Promise.allSettled(pending);
    if (hasChanges) renderLiveDebounce();
  };

  // Starta live-lyssning på maraton + maraton-timing (nu inne i listenLive)
  const maratonUnsub = onSnapshot(
    collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton'),
    handleSnapshot
  );
  const timingUnsub = onSnapshot(
    collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton-timing'),
    handleSnapshot
  );
  liveUnsub.push(maratonUnsub, timingUnsub);
}

// === Live-lyssnare för merge-konfig (tdbMergeGroups / classMergeMap / tdbMergeMap) ===
let mergeUnsubs = [];

function listenMergeConfig(compId) {
  // Städa ev. gamla lyssnare
  if (Array.isArray(mergeUnsubs)) {
    mergeUnsubs.forEach(u => { try { u(); } catch { } });
  }
  mergeUnsubs = [];

  if (!compId || !appId) return;

  // Vi lyssnar på flera olika config-dokument för bakåtkompatibilitet
  const keys = ['display', 'tdbMergeGroups', 'classMergeMap', 'tdbMergeMap'];

  keys.forEach(key => {
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'config', key);
    const unsub = onSnapshot(ref, (snap) => {

      // 1. Hämta datan från snapshotet. Hanterar både { value: ... } och platt struktur.
      // DETTA VAR RADEN SOM SAKNADES I DIN TRASIGA KOD:
      const data = snap.exists() ? (snap.data()?.value ?? snap.data()) : null;

      // 2. Bygg om merge-map baserat på vilken config-fil som ändrades
      // Om det är 'display'-filen, leta efter 'mergeByClassNumber'-fältet.
      buildMergeMap(snap.id === 'display' ? { mergeByClassNumber: data?.mergeByClassNumber || {} } : data);

      // 3. Märk om alla redan laddade ekipage med nya merge-nycklar/etiketter
      maraton_equipages = maraton_equipages.map(e => ({
        ...e,
        _mergedKey: mergedClassKeyFor(e),
        _mergedLabel: mergedClassLabelFor(e)
      }));

      // 4. Rita om hela vyn och listan över aktiva sammanslagningar
      render();
      renderActiveMerges();

    }, (err) => {
      console.warn('[merge-config] snapshot error', key, err);
    });
    mergeUnsubs.push(unsub);
  });
}


// 🔁 Reset modal on navigation (so it doesn't conflict between pages)
window.addEventListener('beforeunload', () => {
  const modal = document.getElementById('marathonDetailsModal');
  if (modal) {
    modal.classList.remove('visible');
  }
});

function hideDetailsModal() {
  const modal = document.getElementById('marathonDetailsModal');
  if (!modal) return;
  modal.classList.remove('visible');
  modal.style.display = 'none';
  modal.style.opacity = '0';
}


export async function load() {
  // NYTT: Initiera scroll-helpers och stilar VARJE gång sidan laddas
  initializeScrollSync('page-maraton-results');
  injectScrollStyles();
  injectMarathonTableStyles();

  const comp = getGlobalState('currentCompetition');
  competitionId = comp?.id;
  const root = document.getElementById('page-maraton-results');
  if (!competitionId) {
    if (root) root.innerHTML = '<p class="p-8 text-center text-gray-600">Ingen tävling vald.</p>';
    return;
  }

  MARATHON_CONFIG =
    (await getConfig(competitionId, 'maratonConfig'))
    || (await getConfig(competitionId, 'marathonConfig'))
    || {};

  await ensureClubLogosLoaded();

  // Steg 1: Hämta all initial data parallellt
  const [
    equipagesRaw,
    stDoc,
    svCfg,
    enCfg,
    initialTimingData,
    initialObstacleData,
    displayCfg,          // ⬅️ NYTT
    mergeCfgA,
    mergeCfgB,
    mergeCfgC
  ] = await Promise.all([
    getEquipages(competitionId),
    getConfig(competitionId, 'startTimes').catch(() => null),
    getConfig(competitionId, 'maratonConfig').catch(() => null),
    getConfig(competitionId, 'marathonConfig').catch(() => null),
    getMaratonTimingData(competitionId).catch(() => []),
    getMarathonResults(competitionId).catch(() => []),
    getConfig(competitionId, 'display').catch(() => ({})),      // ⬅️ NYTT
    getConfig(competitionId, 'tdbMergeGroups').catch(() => null),
    getConfig(competitionId, 'classMergeMap').catch(() => null),
    getConfig(competitionId, 'tdbMergeMap').catch(() => null)
  ]);

  // Steg 2: Bearbeta all grunddata
  maraton_equipages = (equipagesRaw || []).map(normalizeEquipage);
  buildDominantTRCategoryByClass.cacheMap = buildDominantTRCategoryByClass(maraton_equipages);

  // Bygg merge-mapen från någon av konfigarna och märk equipage
  buildMergeMap(mergeCfgA || mergeCfgB || mergeCfgC || null);
  maraton_equipages = maraton_equipages.map(e => ({
    ...e,
    _mergedKey: mergedClassKeyFor(e),
    _mergedLabel: mergedClassLabelFor(e)
  }));

  // ➕ Börja lyssna live på merge-konfig (uppdatera grupperingen direkt när admin ändras)
  listenMergeConfig(competitionId);

  maraton_startTimes = (stDoc && (stDoc.times || stDoc.value?.times)) || {};
  setMarathonConfig(svCfg || enCfg || {});

  // Steg 3: Slå ihop all initial data till EN karta
  maraton_marathonMap.clear();

  initialTimingData.forEach(doc => {
    const id = String(doc.id);
    const data = (typeof doc.data === 'function') ? doc.data() : doc;
    const existing = maraton_marathonMap.get(id) || {};
    maraton_marathonMap.set(id, { ...existing, ...data });
  });

  initialObstacleData.forEach(obs => {
    const id = String(obs.equipageId);
    if (!id) return;
    const existing = maraton_marathonMap.get(id) || {};
    if (!Array.isArray(existing.obstacles)) {
      existing.obstacles = [];
    }
    const obsIndex = existing.obstacles.findIndex(o => o.number === obs.obstacleNumber);
    if (obsIndex > -1) {
      existing.obstacles[obsIndex] = { ...existing.obstacles[obsIndex], ...obs };
    } else {
      existing.obstacles.push({ number: obs.obstacleNumber, penalty: obs.penalty, eliminated: obs.eliminated });
    }
    maraton_marathonMap.set(id, existing);
  });

  // Steg 4: Om vi får skriva, gör en första beräkning med den kompletta datan
  if (CAN_PUBLISH_COMPUTED) {
    const seeds = [];
    for (const id of maraton_marathonMap.keys()) {
      const eq = maraton_equipages.find(e => String(e.startNumber) === id);
      if (eq) {
        const res = calculateMarathonResult(eq, maraton_marathonMap.get(id), timingDocFor(id));
        const hasData = (res.totalPenalty != null) || res.eliminated === true;

        if (hasData) {
          const agg = {
            marathon: {
              duration_A: res.stages.A.durationMs ? Math.round(res.stages.A.durationMs / 1000) : null,
              duration_B: res.stages.B.durationMs ? Math.round(res.stages.B.durationMs / 1000) : null,
              timePenalty: (res.stages.A.timePenalty || 0) + (res.stages.B.timePenalty || 0),
              obstaclePenalty: res.obstacles.sum,
              totalPenalty: res.totalPenalty,
              eliminated: res.eliminated
            }
          };
          seeds.push(saveComputedEquipageResult(competitionId, id, agg));
        }
      }
    }
    if (seeds.length) await Promise.allSettled(seeds);
  }

  // Steg 5: Rita ut layout och tabell med den initiala datan
  renderTable();
  wireControls();
  render();

  const chipHost = document.getElementById('maratonClassChips');
  if (chipHost) {
    // Koppla lyssnaren bara en gång
    if (!chipHost.dataset.wired) {
      chipHost.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-class]');
        if (!btn) return;

        const lbl = btn.dataset.class;
        if (maraton_activeClassFilters.has(lbl)) {
          maraton_activeClassFilters.delete(lbl);
        } else {
          maraton_activeClassFilters.add(lbl);
        }
        render(); // Rita om
      });
      chipHost.dataset.wired = '1';
    }
  }

  // Steg 6: Starta alla live-lyssnare
  listenLive();
  listenForGlobalCompetitionPause_Results(); // <-- DENNA RAD STARTAR PAUS-LOGIKEN

  // === FIX: Add resize listener ===
  const resizeHandler = debounce(() => {
    // Only re-render if we actually cross a breakpoint or change orientation to avoid spam
    render();
  }, 100);
  window.addEventListener('resize', resizeHandler);

  // Cleanup if page unloads (not perfectSPA cleanup but good enough for now)
  window.addEventListener('beforeunload', () => window.removeEventListener('resize', resizeHandler));

  // Initial render
  setTimeout(() => render(), 50);

  // Känn av brytpunktsbyte (mobil <-> desktop)
  // Efter renderTable(); och wireControls(); men FÖRE första render();
  document.body.dataset.wasMobile = isMobile() ? '1' : '0';
  if (window.__marathonResizeHandler) {
    try { window.removeEventListener('resize', window.__marathonResizeHandler); } catch { }
  }
  window.__marathonResizeHandler = () => {
    const nowMobile = isMobile() ? '1' : '0';
    if (document.body.dataset.wasMobile !== nowMobile) {
      document.body.dataset.wasMobile = nowMobile;
      render();
    }
  };
  window.addEventListener('resize', window.__marathonResizeHandler, { passive: true });

  // …sen:
  render();


  window.addEventListener('resize', window.__marathonResizeHandler, { passive: true });

}

export function __unload() {
  // Städa bort live-lyssnare och timers (som tidigare)
  if (Array.isArray(liveUnsub)) {
    liveUnsub.forEach(u => { try { u(); } catch { } });
  }
  Object.keys(localLiveTickers).forEach(stopLocalLiveTicker);
  liveUnsub = [];

  // Återställ variabler (som tidigare)


  // Lämna CSS och bryggan kvar – monitorn använder dem
  const modal = document.getElementById('marathonDetailsModal');
  if (modal) {
    modal.classList.remove('visible');
    modal.style.display = 'none';
    modal.style.opacity = '0';
  }
  if (Array.isArray(liveUnsub)) {
    liveUnsub.forEach(u => { try { u(); } catch { } });
  }
  Object.keys(localLiveTickers).forEach(stopLocalLiveTicker);
  liveUnsub = [];

  // NYTT: ta bort resize-lyssnare + riv x-bar
  if (window.__marathonResizeHandler) {
    try { window.removeEventListener('resize', window.__marathonResizeHandler); } catch { }
    window.__marathonResizeHandler = null;
  }
  try { window.__teardownXbarSync?.(); } catch { }
  document.body.classList.remove('has-fixed-xbar');
  try { document.querySelector('.pr-xbar')?.remove(); } catch { }
  try { pushedToFinished?.clear?.(); } catch { }

  try { window.__teardownXbarSync?.(); } catch { }
  window.__teardownXbarSync = undefined;
  window.__setupXbarSync = undefined;

  console.log('✅ Maraton unload klar'); // Lade till logg
}

(function exposeMarathonModalBridge() {
  // Vi behöver inte anropa ensureModalExists() här längre, 
  // eftersom showDetailsModal sköter det internt.

  window.openMarathonModalGlobal = async function (arg1, arg2) {
    try {
      // Stöd båda anropssätten:
      // 1) openMarathonModalGlobal({ compId, startNumber })
      // 2) openMarathonModalGlobal(compId, startNumber)
      let compId = null, sn = null;

      if (arg1 && typeof arg1 === 'object') {
        compId = arg1.compId || arg1.competitionId || (getGlobalState('currentCompetition')?.id);
        sn = String(arg1.startNumber ?? arg1.sn ?? arg1.startnr ?? arg1.start ?? '');
      } else {
        compId = arg1 || (getGlobalState('currentCompetition')?.id);
        sn = String(arg2 ?? '');
      }

      if (!sn) return; // inget startnr → inget att visa

      competitionId = String(compId || competitionId || (getGlobalState('currentCompetition')?.id || ''));

      // Säkerställ baskataloger om monitor kallar först
      if (!Array.isArray(maraton_equipages) || maraton_equipages.length === 0) {
        const eqs = await getEquipages(competitionId);
        maraton_equipages = (eqs || []).map(normalizeEquipage);
        await ensureClubLogosLoaded();
      }

      // Anropa modalen (som nu hanterar sin egen HTML/CSS-injektion)
      await showDetailsModal(sn, maraton_equipages, maraton_marathonMap);
    } catch (e) {
      console.error('Kunde inte öppna maraton-detaljer:', e);
      // alert('Ett fel uppstod vid öppning av modal.'); // Valfritt att ta bort alerten om du vill
    }
  };
})();


