import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { listenForJudges } from '../../services/adminService.js';
import { 
  listenForDressageStatus, 
  listenForDressageStatusCollection, 
  listenForDressageFinalizationCollection, 
  listenForDressageLiveGroup, 
  getDressageResultsForEquipage,
  listenForDressageProtocolsCollectionGroup
} from '../../services/dressageService.js';
import { getConfig } from '../../services/competitionService.js';
import { dressagePrograms } from '../../data/dressagePrograms.js';
import { getCompetitionHeader, renderResponsiveClassFilter } from '../../ui/components.js';
import { ensureClubLogosLoaded, getClubLogoHtml, getClubLogoUrl } from '../../services/logosService.js';
import { getFlagHtml, normalizeCountryCode, fetchFlagDataUrl } from '../../services/flagsService.js';
import { doc, onSnapshot, setDoc, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';

// --- NYTT: modulär modal + PDF ---
import { setupDressageModalOnce, openDetails as openDetailsModal, closeDetailsModal } from '../../ui/dressageModal.js';
import { generateDressagePdf, generateDressageListPdf } from '../../pdf/dressagePdf.js';

// === NYTT: Importera all delad logik ===
import {
    getPrograms,
    normalizeMovementNo,
    normalizeMovements,
    fmtPct,
    fmtNum,
    getMomentHorseLabel,
    getMomentHorseLabelStacked,
    deduplicateAndFilterProtocols,
    guessProgramKeyFromClass,
    normJudgeId,
    getDressagePenaltyCoeff
} from '../../utils/dressageUtils.js';
import { calculateDressageResult, calculateSingleJudgeDressageResult } from '../../services/calculationService.js';
import {
    getExpectedDressageJudgePositions,
    getCompletedDressageJudgePositions,
    isDressageReadyToFinalize
} from '../../services/competitionStatusService.js';

import { t } from '../../utils/i18n.js';

import {
    escapeHtml,
    getInitials,
    stackName,
    horseLabel,
    horseLabelStacked,
    isMobile,
    isPrivileged,
    resolveCurrentCompId,
    debounce,
    downloadCsv,
    csvCell,
    sanitizeForFilename,
    isNum
} from '../../utils/sharedUtils.js';

import { injectScrollStyles, initializeScrollSync } from '../../ui/scrollHelper.js';

let processedResults = [];
let allCompetitionJudges = [];
let sortState = { key: 'plac', dir: 'asc' };
let rawByStart = new Map();
let liveUnsubs = new Map();
let currentJudgesPresent = [];
let dressageStatusMap = new Map();
let searchQuery = '';
let showOnlyFinalized = false;
let viewMode = 'byclass';
let masterEquipageList = []; // FIX: En stabil lista över alla ekipage
let liveJudgeData = new Map();
let __tickerCurrentStart = null;

// --- Performance Optimization State ---
let lastStructuralHash = null;
let lastHeaderHash = null;

// Globala refs för att kunna städa på __unload
window.__dressyrResizeHandler = window.__dressyrResizeHandler || null;
window.__dressyrKeydownHandler = window.__dressyrKeydownHandler || null;

// ... (under window.__dressyrKeydownHandler = window.__dressyrKeydownHandler || null;)

// === NYTT: State-variabler för sammanslagning ===
let dressage_displayConfig = {};
let dressage_activeClassFilters = new Set();
let dressage_MERGE_GROUPS = [];
let dressage_MERGE_MAP = new Map();

// === NYTT: Hjälpfunktion för att escapa HTML (används i chips) ===
// (escapeHtml imported from sharedUtils)


// === NYTT: Merge-funktioner (anpassade från maraton/precision) ===
// Bygger den interna kartan över vilka TDB-nummer som tillhör vilken grupp
function dress_buildMergeMap(raw) {
    dressage_MERGE_GROUPS = [];
    dressage_MERGE_MAP.clear();
    if (!raw) return;

    const maybeDisplay = raw && typeof raw === 'object' && raw.mergeByClassNumber ? raw : null;
    const source = maybeDisplay ? maybeDisplay.mergeByClassNumber : raw;

    // Nytt format från admin: { "<grpKey>": { label: string, members: number[] } }
    if (source && typeof source === 'object' && !Array.isArray(source)) {
        for (const [grpKey, info] of Object.entries(source)) {
            const members = (info?.members || []).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
            if (!members.length) continue;
            const label = String(info?.label || `Sammanslagen: TDB #${members.join('/')}`);
            const key = String(grpKey || `TDBGROUP:${members.join('+')}`);
            dressage_MERGE_GROUPS.push({ key, label, members });
            members.forEach(num => dressage_MERGE_MAP.set(num, { key, label }));
        }
        return;
    }
    // Gammalt array-format
    if (Array.isArray(source)) {
        const groups = source
            .map(arr => (Array.isArray(arr) ? arr.map(Number).filter(n => Number.isFinite(n)) : []))
            .filter(arr => arr.length > 0)
            .map(arr => arr.sort((a, b) => a - b));
        groups.forEach(members => {
            const key = `TDBGROUP:${members.join('+')}`;
            const label = `Sammanslagen: TDB #${members.join('/')}`;
            dressage_MERGE_GROUPS.push({ key, label, members });
            members.forEach(num => dressage_MERGE_MAP.set(num, { key, label }));
        });
        return;
    }
    // Äldsta map-formatet
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
            dressage_MERGE_GROUPS.push({ key, label, members });
            members.forEach(num => dressage_MERGE_MAP.set(num, { key, label }));
        }
    }
}

// Slår upp ETT ekipage och returnerar dess merge-key och label
function dress_resolveMergeGrouping(e) {
    // 1) Per-ekipage flagga (från TDB-test merge i admin)
    if (e?.useMergedTestForDisplay && e?.mergedTestKey && e?.mergedTestLabel) {
        return { key: String(e.mergedTestKey), label: String(e.mergedTestLabel) };
    }
    // 2) Global TDB-nummer merge (från config)
    const num = Number(e?.tdbClassNumber);
    const hit = Number.isFinite(num) ? dressage_MERGE_MAP.get(num) : null;
    if (hit) return hit;

    // 3) Fallback: originalklass
    const cls = e?.className || '—';
    return { key: `CLASS:${cls}`, label: cls };
}


const MOBILE_BP = 500;
// isMobile imported from sharedUtils

window.DEBUG_LIVE = window.DEBUG_LIVE ?? false;
window.DEBUG_LIVE = (localStorage.getItem('debug_live') === '1');

// -- global helper for a fixed, window-level x-scrollbar (safe to re-use) --
function initializeDressyrScrollHelpers() {
    initializeScrollSync(window.location.pathname);
}

// Global debouncer för UI-render (återanvänds i snapshot-callbacks)
const renderFinDebounce = debounce(render, 60);

// isPrivileged imported from sharedUtils

// Publik (read-only) ref – samma publikträd som sidan redan läser status ifrån
function dressageFinalizationPublicDocRef(compId, startNo) {
    return doc(
        db, 'artifacts', appId, 'public', 'data',
        'competitions', String(compId), 'dressageStatus', String(startNo),
        'meta', 'finalization'
    );
}

// Sätt upp finaliserings-lyssnare exakt en gång per startnummer – ENDAST för privilegierade
function setupFinalizationListenerOnce(competitionId, startNo) {
    if (!isPrivileged()) return; // ← ny rad: publika får ingen lyssnare, så inga permission-warnings
    const key = `final:${startNo}`;
    if (liveUnsubs.has(key)) return;

    const startKey = String(startNo);
    const ref = dressageFinalizationDocRef(competitionId, startNo);
    const unsub = onSnapshot(
        ref,
        (snap) => {
            const fin = snap.data() || {};
            const cur = dressageStatusMap.get(startKey) || {};
            dressageStatusMap.set(startKey, { ...cur, finalized: !!fin.finalized });
            renderFinDebounce();
        },
        (err) => {
            // inga varningar för permission här – eftersom bara privilegierade lyssnar
            console.warn('[FINALIZATION] Lyssnar-fel:', err);
        }
    );
    liveUnsubs.set(key, unsub);
}

// Lägg högt upp i filen (nära andra UI-hjälpare)
function patchFinalizeBadge(startNo, finalized) {
    const row = document.querySelector(`[data-start-number="${startNo}"]`);
    if (!row) return;

    const badge = row.querySelector(`#badge-final-${startNo}`);
    const btnFinalize = row.querySelector(`button[data-action="finalize"][data-sn="${startNo}"]`);
    const btnUndo = row.querySelector(`button[data-action="unfinalize"][data-sn="${startNo}"]`);

    if (finalized) {
        if (!badge) {
            const b = document.createElement('span');
            b.id = `badge-final-${startNo}`;
            b.className = 'inline-flex items-center px-2 py-1 rounded text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300';
            b.textContent = 'Finaliserad';
            // Sätt den bredvid knapparna
            const holder = row.querySelector('[data-finalize-slot]') || row.querySelector('.flex.items-center.gap-2');
            holder && holder.prepend(b);
        }
        btnFinalize && (btnFinalize.style.display = 'none');
        btnUndo && (btnUndo.style.display = '');
    } else {
        badge && badge.remove();
        btnFinalize && (btnFinalize.style.display = '');
        btnUndo && (btnUndo.style.display = 'none');
    }
}

// === Hjälp: hitta tävlings-ID konsekvent ===
// resolveCurrentCompId imported from sharedUtils

// === Exakt samma path som läsningen använder ===
function dressageStatusDocRef(compId, startNo) {
    return doc(
        db, 'artifacts', appId, 'public', 'data',
        'competitions', String(compId), 'dressageStatus', String(startNo)
    );
}

// === Finaliserings-doc under competitions (skrivbar för domare/admin) ===
function dressageFinalizationDocRef(compId, startNo) {
    // ny, enkel plats: competitions/{compId}/dressageFinalization/{startNo}
    return doc(
        db, 'competitions', String(compId),
        'dressageFinalization', String(startNo)
    );
}

function isFinalized(sn) {
    const st = dressageStatusMap.get(String(sn));
    return st?.finalized === true; // strikt check
}

function injectDressageResultsBaseStyles() {
    if (document.getElementById('dressageResultsBaseStyles')) return;

    // Inject shared styles first
    injectScrollStyles();

    const css = `
    /* Ingen .pr-container behövs här då layouten är annorlunda */
    .pr-table {
      border-collapse: separate; border-spacing: 0;
      table-layout: auto;
      min-width: max-content;
      width: auto;
      font-size: 15px;
    }
    .pr-table thead th {
      position: sticky; top: 0; z-index: 2;
      background: #fff;
      border-bottom: 2px solid #e5e7eb;
      white-space: nowrap;
      height: 44px;
      padding: 8px 12px;
      color: #111827;
    }
    .pr-table tbody td {
      white-space: nowrap;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
      padding: 8px 12px;
      color: #374151;
    }
    
      
      
      /* Z-INDEX FIXES */
      .pr-table thead th, .total-results-table thead th { z-index: 20 !important; }
      .pr-table tbody td.sticky-col-start, .pr-table tbody td.sticky-col-driver, .total-results-table tbody td.sticky-col-start, .total-results-table tbody td.sticky-col-driver { z-index: 15 !important; }
      .pr-table thead th.sticky-col-start, .pr-table thead th.sticky-col-driver, .total-results-table thead th.sticky-col-start, .total-results-table thead th.sticky-col-driver { z-index: 30 !important; }

      /* STICKY COLUMNS */
      .sticky-col-start { position: sticky; left: 0; z-index: 3; min-width: 38px; width: 38px; text-align:center; }
      .sticky-col-driver { position: sticky; left: 38px; z-index: 3; min-width: 130px; max-width: 170px; }
      @media (min-width: 1024px) {
         .sticky-col-start { left: 0; min-width: 48px; width: 48px; }
         .sticky-col-driver { left: 48px; min-width: 180px; max-width: 220px; }
      }
      .dark .bg-white .sticky-col-start, .dark .bg-white .sticky-col-driver { background-color: #1f2937; }
      .dark .bg-gray-50 .sticky-col-start, .dark .bg-gray-50 .sticky-col-driver { background-color: #111827; }
      .dark .bg-red-50 .sticky-col-start, .dark .bg-red-50 .sticky-col-driver { background-color: #450a0a; }
      .dark .bg-yellow-50 .sticky-col-start, .dark .bg-yellow-50 .sticky-col-driver { background-color: #422006; }
      html.dark .pr-table thead th { background: #1f2937; border-bottom-color: #374151; color: #f3f4f6; }
      html.dark .bg-white .sticky-col-start, html.dark .bg-white .sticky-col-driver { background-color: #1f2937; }
      html.dark .bg-gray-50 .sticky-col-start, html.dark .bg-gray-50 .sticky-col-driver { background-color: #374151; }
      html.dark .bg-red-50 .sticky-col-start, html.dark .bg-red-50 .sticky-col-driver { background-color: #7f1d1d; }

      /* Dark Mode Overrides */
    html.dark .pr-table thead th {
      background: #374151; /* gray-700 */
      border-bottom-color: #4b5563; /* gray-600 */
      color: #e5e7eb; /* gray-200 */
    }
    html.dark .pr-table tbody td {
      border-bottom-color: #374151; /* gray-700 */
      color: #f3f4f6; /* gray-100 */
    }
  `;
    const s = document.createElement('style');
    s.id = 'dressageResultsBaseStyles';
    s.textContent = css;
    document.head.appendChild(s);
}

// +++ NYTT: hämta image som dataURL (för utskrift) +++
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
    } catch {
        return null;
    }
}

async function fetchFirstAvailableImageDataUrl(candidates) {
    for (const u of candidates) {
        const img = await fetchImageDataUrl(u);
        if (img && img.dataUrl) return img;
    }
    return null;
}

// ---------- Utils ----------
// --- Exponera API till andra moduler (monitor, modal, PDF) ---
(function exposeDressageResultAPI() {
    window.dressageResult = window.dressageResult || {};
    window.dressageResult.computeFinalFromSaved = computeFinalFromSaved;
})();

function expandDressagePosition(j) {
    // plocka position från roller → disciplines → position
    if (Array.isArray(j.roles)) {
        const withPos = j.roles.find(r => r && r.discipline === 'dressage' && r.position);
        if (withPos) return String(withPos.position).toUpperCase();
        const anyDress = j.roles.find(r => r && r.discipline === 'dressage');
        if (anyDress && anyDress.position != null) return String(anyDress.position).toUpperCase();
    }
    if (j.position) return String(j.position).toUpperCase();
    if (j.disciplines && typeof j.disciplines.dressage === 'string') return String(j.disciplines.dressage).toUpperCase();
    return '';
}

function setSortFromURL() {
    try {
        const url = new URL(window.location.href);
        const s = url.searchParams.get('sort');
        const d = url.searchParams.get('dir');
        if (s) sortState.key = decodeURIComponent(s);
        if (d === 'asc' || d === 'desc') sortState.dir = d;
    } catch { }
}

function updateURLWithSort() {
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('sort', encodeURIComponent(sortState.key));
        url.searchParams.set('dir', sortState.dir);
        window.history.replaceState({}, '', url);
    } catch { }
}

// getInitials imported from sharedUtils

// stackName imported from sharedUtils

function headerLabelWithSort(label, key) {
    const isActive = sortState.key === key;
    const arrow = isActive ? (sortState.dir === 'asc' ? '▲' : '▼') : '';
    return `${label} ${arrow}`;
}

function formatStartTimeLabel(val) {
    if (!val) return '—';
    try {
        // Försök skapa ett giltigt datum-objekt
        const d = new Date(String(val).replace(' ', 'T'));
        if (isNaN(d.getTime())) return '—'; // Om datumet är ogiltigt, returnera '—'

        // Formatera till svenskt klockslag (HH:mm)
        return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '—'; // Om något går fel, returnera '—'
    }
}

function matchesSearch(row, q) {
    if (!q) return true;
    const needle = q.trim().toLowerCase();
    const horses = (typeof horseLabel === 'function' ? horseLabel(row) : '') || '';
    const haystack = [
        String(row.startNumber || ''),
        row.driverName || '',
        horses,
        row.className || ''
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
}

function getVisibleSortedResults() {
    let list = processedResults.slice(); //

    if (showOnlyFinalized) { //
        list = list.filter(r => {
            const st = dressageStatusMap.get(String(r.startNumber)); //
            return (st?.finalized === true) || (st?.state === 'finished');
        });
    }

    if (searchQuery && searchQuery.trim()) { //
        list = list.filter(r => matchesSearch(r, searchQuery)); //
    }

    // === KORRIGERING: LADE TILL FILTRERING FÖR KLASS-KNAPPARNA ===
    if (dressage_activeClassFilters.size > 0) { //
        list = list.filter(r => {
            // Vi använder _mergedLabel från den bearbetade raden (processedResults)
            const label = r._mergedLabel || r.className || '—';
            return dressage_activeClassFilters.has(label);
        });
    }
    // === SLUT PÅ KORRIGERING ===

    sortAny(list); //
    return list;
}

function sortAny(arr) {
    const key = sortState.key;
    const dir = sortState.dir;

    arr.sort((a, b) => {
        // NYTT: Primär sortering på klassnamn om "Gruppera per klass" är aktivt.
        if (viewMode === 'byclass') {
            const classA = a.className || '';
            const classB = b.className || '';
            if (classA !== classB) {
                return classA.localeCompare(classB, 'sv');
            }
        }

        // Befintlig logik fungerar nu som sekundär sortering inom varje klass.
        let va = getSortVal(a, key);
        let vb = getSortVal(b, key);
        if (typeof va === 'string' || typeof vb === 'string') {
            va = String(va);
            vb = String(vb);
            const cmp = va.localeCompare(vb, 'sv');
            return dir === 'asc' ? cmp : -cmp;
        }
        const cmp = va - vb;
        const descPreferred = key.startsWith('judge:') || key === 'percent';
        return (descPreferred ? -cmp : cmp) * (dir === 'asc' ? 1 : -1);
    });
}

// Engångs-hämtare: lyssna på protokoll en gång och avsluta
function fetchProtocolsOnce(competitionId, startNo) {
    return new Promise((resolve) => {
        const unsub = listenForDressageProtocols(competitionId, Number(startNo), (docs) => {
            try { unsub && unsub(); } catch { }
            resolve(Array.isArray(docs) ? docs : (docs ? [docs] : []));
        });
    });
}

async function ensureSavedProtocolsCached(startNumber) {
    const sn = String(startNumber);
    if (rawByStart.has(sn)) return;
    const comp = getGlobalState('currentCompetition');
    if (!comp?.id) return;
    try {
        const saved = await getDressageResultsForEquipage(comp.id, sn);
        rawByStart.set(sn, Array.isArray(saved) ? saved : (saved ? [saved] : []));
    } catch (e) {
        console.warn('Kunde inte hämta sparade protokoll för', sn, e);
        rawByStart.set(sn, []);
    }
}

function getSavedProtocol(startNumber, judgeId) {
    const sn = String(startNumber);
    const arr = rawByStart.get(sn) || [];
    return arr.find(p => p && p.judgeId === judgeId) || null;
}

async function hydrateJudgeMovements(startNumber, equipageData) {
    await ensureSavedProtocolsCached(startNumber);
    const sn = String(startNumber);
    const saved = rawByStart.get(sn) || [];
    const byJudge = new Map(saved.map(p => [p.judgeId, p]));
    for (const jid of Object.keys(equipageData.judges || {})) {
        const jr = equipageData.judges[jid];
        if (Array.isArray(jr.movements) && jr.movements.length) continue;
        const proto = byJudge.get(jid);
        if (proto && Array.isArray(proto.movements)) {
            jr.movements = normalizeMovements(proto.movements);
        }
    }
}

function judgeChip(jr, startNumber) {
    const statusInfo = dressageStatusMap.get(String(startNumber));

    // Fall 1: Domardata saknas helt
    if (!jr) {
        // Om statusen är 'finished', betyder det att datan är på väg. Visa ett "laddar"-läge.
        if (statusInfo?.state === 'finished') {
            return '<span class="inline-block px-2 py-1 text-xs rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400 animate-pulse">---</span>';
        }
        // Annars har domaren inte börjat döma än.
        return `<span class="inline-block px-2 py-1 text-xs rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400" title="${t('dressage_monitor_waiting')}">${t('status_waiting')}</span>`;
    }

    // Fall 2: Eliminerad
    if (jr.eliminated) return `<span class="inline-block px-2 py-1 text-xs rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 font-bold">${t('status_eliminated')}</span>`;

    const tp = Number(jr.totalPoints);
    const cls = jr.isBestForJudge ? 'font-extrabold' : '';
    const title = `${t('penalty')}: ${(Number(jr.penalty) || 0).toFixed(1)} | %: ${(Number(jr.percent) || 0).toFixed(2)}${jr.place ? ` | ${t('rank')}: ${jr.place}` : ''}`;

    // Fall 3: Live-chip (puls + poäng) - Prognos borttagen
    if (jr.isLive) {
        return `<span title="${title}" class="inline-flex flex-col items-center gap-0.5 px-2 py-1 text-xs rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 ${cls}">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                    ${Number.isFinite(tp) ? tp.toFixed(1) : '–'}
                  </span>
                </span>`;
    }

    // Fall 4: Standard-chip med slutgiltig poäng
    return `<span title="${title}" class="inline-block px-2 py-1 text-xs rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 ${cls}">
              ${Number.isFinite(tp) ? tp.toFixed(1) : '–'}
            </span>`;
}


function statusBadgeForDressage(sn) {
    const startNumberStr = String(sn);
    const equipageResult = processedResults.find(r => String(r.startNumber) === startNumberStr);
    const statusInfo = dressageStatusMap.get(startNumberStr);

    let state = 'not-started';

    if (equipageResult && Object.keys(equipageResult.judges).length > 0) {
        const classExpectedPos = getExpectedJudgesForClass(equipageResult.className);
        const completedPositions = getCompletedDressageJudgePositions(Object.values(equipageResult.judges || {}));
        const liveJudgeCount = Object.values(equipageResult.judges).filter(j => j.isLive).length;
        const isEliminated = Object.values(equipageResult.judges).some(j => j.eliminated);

        if (isEliminated) {
            state = 'eliminated';
        } else if (isDressageReadyToFinalize({
            status: statusInfo,
            countedJudgePositions: completedPositions,
            expectedJudgePositions: classExpectedPos,
            finalized: false
        })) {
            state = 'done';
        } else if (liveJudgeCount > 0 || completedPositions.size > 0) {
            state = 'running';
        } else if (statusInfo?.state === 'ongoing') {
            state = 'running';
        }
    }

    const base = 'inline-flex items-center px-2 py-1 rounded text-[11px] font-medium';
    if (state === 'done') return `<span class="${base} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">${t('status_done')}</span>`;
    if (state === 'running') return `<span class="${base} bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">${t('status_running')}</span>`;
    if (state === 'eliminated') return `<span class="${base} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">${t('status_eliminated')}</span>`;
    return `<span class="${base} bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">${t('not_started')}</span>`;
}

// ---------- Aggregation ----------

function pickNum(obj, keys, fallback = null) {
    for (const k of keys) {
        const v = obj?.[k];
        const n = (typeof v === 'number') ? v : Number(v);
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}

function processAndAggregateResults(equipages, allRawResults) {
    const aggregated = {};
    const allJudgesInfo = new Map();

    const updateJudgeInfo = (id, position) => {
        if (!id) return;
        const pos = position || '';
        const existingPos = allJudgesInfo.get(id)?.position || '';
        if (pos || !existingPos) {
            allJudgesInfo.set(id, { id, position: pos || existingPos });
        }
    };

    // STEG 1: Skapa grundstruktur
    equipages.forEach(eq => {
        if (isWithdrawnOrExcluded(eq.status, eq)) return;
        aggregated[eq.startNumber] = { ...eq, judges: {}, __eq: eq };
    });

    // STEG 2: Bearbeta resultat
    Object.values(aggregated).forEach(eq => {
        const startNumberStr = String(eq.startNumber);
        const status = dressageStatusMap.get(startNumberStr);
        const liveProtocols = liveJudgeData.get(startNumberStr);


        // 1. Hämta råa protokoll
        const rawAll = allRawResults.filter(r => String(r.startNumber) === startNumberStr);
        // 2. Filtrera och städa (DIREKT HÄR, så att vi inte loopar över spökdata senare)
        const rawProtocolsForEquipage = deduplicateAndFilterProtocols(rawAll, allCompetitionJudges || []);

        // Säkerställ programnyckel
        if (!eq.testKey) {
            const fromSaved = rawProtocolsForEquipage.find(p => p.testKey || p.programKey);
            let fromLive = null;
            if (liveProtocols) {
                for (const lp of liveProtocols.values()) { if (lp?.testKey || lp?.programKey) { fromLive = lp; break; } }
            }
            eq.testKey = (fromSaved?.testKey || fromSaved?.programKey || fromLive?.testKey || fromLive?.programKey || null);
        }

        // Hämta programmet för att kunna använda utils
        const programs = getPrograms(); // Från utils
        let programKey = eq.testKey;
        if (!programKey && window.klassProgramMapping) {
            programKey = window.klassProgramMapping[eq.className] || window.klassProgramMapping[eq._mergedLabel];
        }
        // New Robust Fallback using guessProgramKeyFromClass
        if (!programKey && eq.className) {
            programKey = guessProgramKeyFromClass(eq.className, programs);
        }
        const program = programKey ? programs[programKey] : null;

        // Samla domar-IDn
        const judgeIdsForEquipage = new Set();


        rawProtocolsForEquipage.forEach(p => {
            // Data is normalized: p.judgeId is clean string.
            if (p.judgeId) judgeIdsForEquipage.add(p.judgeId);
        });

        liveProtocols?.forEach((p, judgeId) => {
            // liveProtocols key might be judgeId (e.g. from map key).
            // Ensure we check p.judgeId too
            const jid = p.judgeId || judgeId;
            if (jid) judgeIdsForEquipage.add(jid);
        });

        // if (startNumberStr === '3') {
        //   console.log('[DEBUG #3] Raw Protocols:', rawProtocolsForEquipage);
        //   console.log('[DEBUG #3] Judge IDs:', Array.from(judgeIdsForEquipage));
        //   console.log('[DEBUG #3] Program:', program ? program.id : 'MISSING');
        //   console.log('[DEBUG #3] TestKey:', eq.testKey);
        // }

        // DEBUG:
        // if (judgeIdsForEquipage.size === 0 && rawProtocolsForEquipage.length > 0) {
        //   console.log('DEBUG: Found protocols but no judgeIds?', { rawProtocolsForEquipage });
        // } else if (judgeIdsForEquipage.size > 0 && Math.random() < 0.01) {
        //   console.log('DEBUG: Match info', { judgeIdsForEquipage, currentJudgesPresent });
        // }

        if (status?.finalJudgeScore?.judgeId) {
            const jid = normJudgeId(status.finalJudgeScore.judgeId);
            if (jid) judgeIdsForEquipage.add(jid);
        }
        // För varje domare...
        const findJudgePos = (jid) => {
            if (!jid) return '';
            const list = Array.isArray(allCompetitionJudges) ? allCompetitionJudges : [];
            const found = list.find(j => j && j.id === jid);
            if (found) return (expandDressagePosition(found) || found.position || '').toUpperCase();
            return '';
        };

        judgeIdsForEquipage.forEach(judgeId => {
            let finalData = null;
            let isFinal = false;
            const jid = normJudgeId(judgeId);

            // A) Sparat protokoll (PRIO 1 för detaljer)
            const rawProto = rawProtocolsForEquipage.find(p => normJudgeId(p.judgeId) === jid);
            if (rawProto) {
                if (program) {
                    const computed = calculateSingleJudgeDressageResult(rawProto, program, eq);

                    if (computed) {
                        finalData = {
                            totalPoints: computed.points,
                            penalty: computed.penalty,
                            percent: computed.percent,
                            eliminated: !!computed.eliminated,
                            position: (rawProto.judgePosition || findJudgePos(judgeId) || '').toUpperCase(),
                            movements: normalizeMovements(rawProto.movements),
                            id: judgeId,
                            name: rawProto.judgeName || rawProto.name || ''
                        };
                        isFinal = true;
                    }
                }

                // Fallback om program saknas eller service failar
                if (!finalData) {
                    finalData = {
                        totalPoints: Number(rawProto.totalPoints),
                        percent: Number(rawProto.percent),
                        penalty: Number(rawProto.penalty),
                        eliminated: !!rawProto.eliminated,
                        position: (rawProto.judgePosition || findJudgePos(judgeId) || '').toUpperCase(),
                        movements: normalizeMovements(rawProto.movements),
                        id: jid,
                        name: rawProto.judgeName || rawProto.name || ''
                    };
                    isFinal = true;
                }
            }
            // B) Live data (PRIO 2)
            else if (liveProtocols?.has(jid)) {
                const liveProto = liveProtocols.get(jid);
                const pos = liveProto.judgePosition || '';
                updateJudgeInfo(judgeId, pos);

                const movementsNorm = liveProto.movements ? normalizeMovements(liveProto.movements) : null;

                let computedLive = null;
                if (program && movementsNorm) {
                    const singleProto = { ...liveProto, movements: movementsNorm };
                    computedLive = calculateSingleJudgeDressageResult(singleProto, program, eq);
                }

                eq.judges[jid] = {
                    totalPoints: computedLive ? computedLive.points : pickNum(liveProto, ['totalPoints', 'points', 'runningTotalPoints', 'sumPoints', 'score', 'currentScore'], 0),
                    percent: computedLive ? computedLive.percent : pickNum(liveProto, ['percent', 'runningPercent'], 0),
                    penalty: computedLive ? computedLive.penalty : pickNum(liveProto, ['penalty', 'runningPenalty', 'totalPenalty'], 0),
                    movements: movementsNorm || undefined,
                    isLive: true,
                    position: (pos || findJudgePos(judgeId) || '').toUpperCase(),
                    eliminated: !!liveProto.eliminated,
                    id: jid,
                    name: liveProto.judgeName || liveProto.name || '',
                    projectedPenalty: computedLive ? computedLive.projectedPenalty : pickNum(liveProto, ['projectedPenalty', 'projPenalty', 'projectedFinalPenalty', 'projectedTotalPenalty'], null),
                    projectedPercent: computedLive ? computedLive.projectedPercent : pickNum(liveProto, ['projectedPercent', 'projPercent', 'projectedFinalPercent', 'projectedAvgPercent'], null),
                };
                return;
            }

            if (isFinal && finalData) {
                const lp = liveProtocols?.get(jid);
                const movementsNorm = (lp && lp.movements) ? normalizeMovements(lp.movements) : null;

                let computedLive = null;
                if (program && movementsNorm) {
                    const singleProto = { ...lp, movements: movementsNorm };
                    computedLive = calculateSingleJudgeDressageResult(singleProto, program, eq);
                }

                eq.judges[jid] = {
                    ...finalData,
                    id: jid,
                    isLive: !!lp && !isFinal,
                    movements: finalData.movements || movementsNorm || undefined,
                    projectedPenalty: computedLive ? computedLive.projectedPenalty : pickNum(lp, ['projectedPenalty', 'projPenalty', 'projectedFinalPenalty', 'projectedTotalPenalty'], null),
                    projectedPercent: computedLive ? computedLive.projectedPercent : pickNum(lp, ['projectedPercent', 'projPercent', 'projectedFinalPercent', 'projectedAvgPercent'], null),
                };
                updateJudgeInfo(judgeId, finalData.position);
            }
        });

        // STEG 3: Summera totaler med Service
        const savedProtos = rawProtocolsForEquipage;
        eq.__savedProtocols = savedProtos;

        // Combine saved protocols with live protocols to get the "Best Current Version" of each judge's sheet
        const unifiedProtocols = [];
        const processedJudges = new Set();

        // 1. Add saved protocols first
        savedProtos.forEach(p => {
            if (p.id === 'general') {
                unifiedProtocols.push(p);
                return;
            }
            const jid = normJudgeId(p.judgeId);
            if (jid) {
                unifiedProtocols.push(p);
                processedJudges.add(jid);
            }
        });

        // 2. Add live protocols if no saved protocol for that judge
        if (liveProtocols) {
            liveProtocols.forEach((p, rawId) => {
                const jid = normJudgeId(rawId) || normJudgeId(p.judgeId);
                if (jid && !processedJudges.has(jid)) {
                    // Ensure it looks like a protocol
                    unifiedProtocols.push({
                        ...p,
                        judgeId: jid,
                        // If live data has movements/score/points, ensure they are accessible
                        movements: p.movements || [],
                        totalPoints: Number(p.totalPoints || p.runningTotalPoints || 0),
                        percent: Number(p.percent || p.runningPercent || 0),
                        penalty: Number(p.penalty || p.runningPenalty || 0),
                        eliminated: !!p.eliminated
                    });
                }
            });
        }

        const validProtos = deduplicateAndFilterProtocols(unifiedProtocols, allCompetitionJudges || []);

        // Always calculate using the service, which handles mix of finished/unfinished judges
        const result = calculateDressageResult(eq, validProtos, allCompetitionJudges || [], programs);

        if (result) {
            eq.finalPenalty = result.penalty;
            eq.avgPercent = result.percent;
            eq.totalJudgePenalty = result.judgePenalty;
            eq.errorPoints = result.errorPoints;
            eq.errorPenalty = result.errorPenalty;

            // Map prognosis from service
            if (result.projectedPercent != null) eq.liveAvgProjectedPercent = result.projectedPercent;
            if (result.projectedPenalty != null) eq.liveAvgProjectedPenalty = result.projectedPenalty;

            if (result.eliminated) {
                eq.eliminated = true;
            }
            // TR Tie-breaker
            eq.generalImpressionsSum = result.generalImpressionsSum || 0;
        }

        // === NYTT: Kopiera live-prognoser till objektet (för ticker) ===

        if (status) {
            // Only overwrite if we don't have a local calculation
            if (eq.liveAvgProjectedPercent == null) {
                const avgP = pickNum(status, ['liveAvgProjectedPercent', 'avgProjectedPercent', 'projectedAvgPercent', 'avgPercent'], null);
                if (avgP != null) eq.liveAvgProjectedPercent = avgP;
            }

            if (eq.liveAvgProjectedPenalty == null) {
                const avgPen = pickNum(status, ['liveAvgProjectedPenalty', 'avgProjectedPenalty', 'projectedAvgPenalty'], null);
                if (avgPen != null) eq.liveAvgProjectedPenalty = avgPen;
            }
        }
    });

    // STEG 4: Placering och Clear Round
    const byClass = {};
    Object.values(aggregated).forEach(eq => {
        const cls = eq.className || '_';
        if (!byClass[cls]) byClass[cls] = [];
        byClass[cls].push(eq);
    });

    const crConfig = window.dressyrClassConfig || {};

    Object.entries(byClass).forEach(([className, eqs]) => {
        // Check Config
        const cfg = crConfig[className];
        const isCR = !!cfg?.clearRound;
        const limit = Number(cfg?.limit) || 0;

        const finalRankables = eqs.filter(eq => !eq.eliminated && eq.finalPenalty != null)
            .sort((a, b) => {
                const diff = (a.finalPenalty || 0) - (b.finalPenalty || 0);
                if (Math.abs(diff) > 0.0001) return diff;
                
                // Tie-breaker: Highest General Impressions sum (TR)
                return (b.generalImpressionsSum || 0) - (a.generalImpressionsSum || 0);
            });

        if (isCR) {
            // Clear Round Logic: Ingen placering, bara Godkänd/Ej Godkänd
            finalRankables.forEach(eq => {
                eq.isClearRound = true;
                eq.plac = null; // Ingen placering
                // Använd avgPercent om det finns, annars får man räkna om från straff om det behövs, 
                // men avgPercent bör finnas från computed
                const pct = Number(eq.avgPercent) || 0;
                eq.crApproved = (pct >= limit);
                eq.crLimit = limit;
            });
        } else {
            // Normal Placering
            let plc = 0, lastPenalty = -Infinity, lastGISum = -Infinity;
            finalRankables.forEach((eq, i) => {
                // Vid lika straff, samma placering (standard hopp/dressyr vid lika resultat?)
                // Här kör vi strikt placering baserat på ordning men delad vid exakt lika
                const p = Number(eq.finalPenalty) || 0;
                const gi = Number(eq.generalImpressionsSum) || 0;
                
                // Tie check: Same penalty AND same general impressions sum
                if (Math.abs(p - lastPenalty) > 0.0001 || Math.abs(gi - lastGISum) > 0.0001) { 
                    plc = i + 1; 
                }
                eq.plac = plc;
                lastPenalty = p;
                lastGISum = gi;
            });
        }
    });

    return { results: Object.values(aggregated), judges: Array.from(allJudgesInfo.values()) };
}

// ---------- Sorting ----------
function getSortVal(row, key) {
    if (key.startsWith('judge:')) {
        const jid = key.split(':')[1];
        const jr = row.judges[jid];
        if (!jr) return -Infinity;
        if (jr.eliminated) return -Infinity + 1;
        return Number(jr.totalPoints) || 0;
    }
    switch (key) {
        case 'plac': return row.plac ?? Infinity;
        case 'startTime': {
            const d = row.startTime ? new Date(String(row.startTime).replace(' ', 'T')) : null;
            return d && !isNaN(d) ? d.getTime() : Infinity;
        }
        case 'startNumber': return Number(row.startNumber) || 0;
        case 'driverName': return row.driverName || '';
        case 'club': return row.clubName || '';
        case 'percent': return row.avgPercent != null ? row.avgPercent : -1;
        case 'errorPoints': return Number(row.errorPoints) || 0;
        case 'className': return (row.className || '').toString().toLowerCase();
        case 'finalPenalty': return row.eliminated ? Infinity : (row.finalPenalty ?? Infinity);
        default: return 0;
    }
}

function sortProcessedResults() {
    const key = sortState.key;
    const dir = sortState.dir;
    processedResults.sort((a, b) => {
        let va = getSortVal(a, key), vb = getSortVal(b, key);
        if (typeof va === 'string' || typeof vb === 'string') {
            va = String(va); vb = String(vb);
            const cmp = va.localeCompare(vb, 'sv');
            return dir === 'asc' ? cmp : -cmp;
        }
        const cmp = va - vb;
        const descPreferred = key.startsWith('judge:') || key === 'percent';
        return (descPreferred ? -cmp : cmp) * (dir === 'asc' ? 1 : -1);
    });
}

function ensureModeToggle() {
    const container = document.getElementById('modeToggle');
    if (!container || container.dataset.listenersAttached) return;
    container.dataset.listenersAttached = 'true';

    const applyActive = () => {
        const btnStart = document.getElementById('btnStartOrder');
        const btnClass = document.getElementById('btnByClass');
        if (btnStart) btnStart.className = `px-4 py-1.5 text-sm font-medium rounded transition-all transition-colors ${viewMode === 'startorder' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;
        if (btnClass) btnClass.className = `px-4 py-1.5 text-sm font-medium rounded transition-all transition-colors ${viewMode === 'byclass' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;

        const fbtn = document.getElementById('toggleFinalized');
        const fact = showOnlyFinalized;
        if (fbtn) {
            fbtn.className = `hidden md:inline-flex px-3 py-1.5 text-sm font-medium rounded border transition-colors ${fact ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}`;
            fbtn.textContent = fact ? t('show_all') : t('show_finalized_only');
        }

        const mSel = document.getElementById('mobileSortSelect');
        if (mSel) mSel.value = viewMode;

        const mChk = document.getElementById('mobileFinalizedCheck');
        if (mChk) mChk.checked = fact;
    };

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-mode]');
        if (btn) {
            viewMode = btn.dataset.mode;
            if (viewMode === 'startorder') { sortState.key = 'startTime'; sortState.dir = 'asc'; }
            else { sortState.key = 'plac'; sortState.dir = 'asc'; }
            applyActive();
            updateURLWithSort();
            render();
            return;
        }
        if (e.target.id === 'toggleFinalized') {
            showOnlyFinalized = !showOnlyFinalized;
            applyActive();
            render();
        }
    });

    container.addEventListener('change', (e) => {
        if (e.target.id === 'mobileSortSelect') {
            viewMode = e.target.value;
            if (viewMode === 'startorder') { sortState.key = 'startTime'; sortState.dir = 'asc'; }
            else { sortState.key = 'plac'; sortState.dir = 'asc'; }
            applyActive();
            updateURLWithSort();
            render();
        } else if (e.target.id === 'mobileFinalizedCheck') {
            showOnlyFinalized = e.target.checked;
            applyActive();
            render();
        }
    });

    applyActive();
}
function ensureSearchBox() {
    const input = document.getElementById('inputDressageSearch');
    if (!input || input.dataset.listenersAttached) return;
    input.dataset.listenersAttached = 'true';

    let t;
    input.addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => {
            searchQuery = e.target.value || '';
            render();
        }, 120);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            input.value = '';
            if (searchQuery) { searchQuery = ''; render(); }
        }
    });

    // Pre-fill
    if (searchQuery) input.value = searchQuery;
}

function compressJudgeText(s, max = 110) {
    if (!s) return '';
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}


function renderMobile(judgesPresent) {
    window.__teardownXbarSync?.();
    const container = document.getElementById('resultsContainer');
    if (!container) return;

    renderClassChips();
    const rows = getVisibleSortedResults();

    const classStarters = new Map();
    masterEquipageList.forEach(e => {
        const lbl = e._mergedLabel || e.className || 'Okänd Klass';
        classStarters.set(lbl, (classStarters.get(lbl) || 0) + 1);
    });

    // Structural Hashing for Mobile
    const structuralHash = [
        'mobile',
        rows.length,
        searchQuery,
        Array.from(dressage_activeClassFilters).join('|'),
        rows.map(r => `${r.startNumber}:${isFinalized(r.startNumber)}:${r.plac}`).join('|')
    ].join('::');

    if (structuralHash === lastStructuralHash && container.children.length > 0) {
        return;
    }
    lastStructuralHash = structuralHash;

    if (rows.length === 0) {
        container.innerHTML = `<div class="p-6 text-center text-gray-500 dark:text-gray-400">Inga ekipage att visa ännu.</div>`;
        return;
    }
    let html = '';
    let lastClass = null;

    // === NEW LOGIC: Deduplicate positions for mobile chips ===
    const order = { 'H': 1, 'C': 2, 'M': 3, 'E': 4, 'B': 5 };
    const uniqueJudgesPositions = [...new Set(
        (judgesPresent || []).map(j => (j.position || '').toUpperCase()).filter(p => /^[CEBHM]$/.test(p))
    )].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99));

    const renderCard = (r) => {
        const eq = masterEquipageList.find(e => String(e.startNumber) === String(r.startNumber)) || r; //

        // === ÄNDRING: Använd _mergedLabel ===
        const currentClassLabel = eq._mergedLabel || eq.className || 'Okänd Klass';
        let classHeader = '';
        if (viewMode === 'byclass' && currentClassLabel !== lastClass) { //
            classHeader = `<div class="px-3 py-1 mt-1.5 mx-1.5 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-bold text-sm rounded-md shadow-sm border border-blue-200 dark:border-blue-800/50">${currentClassLabel}</div>`;
            lastClass = currentClassLabel;
        }
        // === SLUT ÄNDRING ===

        const percentLabel = fmtPct(r.avgPercent); //
        const penaltyLabel = r.eliminated ? '<span class="text-red-600 dark:text-red-400 font-bold">ELIM</span>' : fmtNum(r.finalPenalty); //
        const statusText = statusBadgeForDressage(r.startNumber); //

        const startersCount = classStarters.get(currentClassLabel) || 1;
        const configuredPlaced = window.dressyrClassConfig?.[currentClassLabel]?.placedCount;
        const numPlaced = configuredPlaced ?? (Math.ceil(startersCount / 4) || 1);
        
        const rankNum = Number(r.plac);
        const isPlaced = !isNaN(rankNum) && rankNum > 0 && rankNum <= numPlaced;
        
        let placColor = 'text-gray-600 dark:text-gray-400';
        let placBg = 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';
        if (isPlaced) {
            if (rankNum === 1) { placColor = 'text-yellow-600 dark:text-yellow-400 drop-shadow-sm'; placBg = 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-500/80 border-2'; }
            else if (rankNum === 2) { placColor = 'text-slate-600 dark:text-slate-300 drop-shadow-sm'; placBg = 'bg-slate-100 dark:bg-slate-800/80 border-slate-400 dark:border-slate-500/80 border-2'; }
            else if (rankNum === 3) { placColor = 'text-orange-700 dark:text-orange-400 drop-shadow-sm'; placBg = 'bg-orange-100 dark:bg-orange-950/40 border-orange-500 dark:border-orange-600/80 border-2'; }
            else { placColor = 'text-emerald-600 dark:text-emerald-400'; placBg = 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/50 border-2'; }
        }

        let placBlock = `
     <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5 font-bold tracking-wider">Plac</div>
     <div class="text-base font-black ${placColor} leading-none">${r.plac ?? '—'}</div>
  `;
        if (r.isClearRound) {
            if (r.crApproved) {
                placBlock = `
            <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5">Status</div>
            <div class="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-bold bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800 leading-none">Godkänd</div>
          `;
            } else {
                placBlock = `
             <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5">Status</div>
             <div class="text-base font-bold text-gray-300 dark:text-gray-600 leading-none">–</div>
          `;
            }
        }

        return `
          ${classHeader}
          <div class="m-1 mb-1.5 rounded-lg border shadow-sm overflow-hidden cursor-pointer clickable-row ${placBg}" data-start-number="${r.startNumber}" role="button" tabindex="0">
              <div class="p-1.5 flex items-center justify-between gap-1 border-b dark:border-gray-700/50 ${isPlaced ? '' : 'bg-gray-50 dark:bg-gray-800/50'}">
                  <!-- Left: Name & Flags -->
                  <div class="flex flex-col min-w-0 pr-1">
                      <div class="font-bold text-[13px] dark:text-white leading-tight truncate flex items-center gap-1">
                         <span class="text-gray-500 dark:text-gray-400 text-[10px]">#${r.startNumber}</span> 
                         <span class="truncate">${r.driverName}</span>
                      </div>
                      <div class="flex items-center gap-1 mt-0.5">
                         ${getFlagHtml(eq)} ${getClubLogoHtml(eq)}
                         ${viewMode === 'startorder' ? `<span class="text-[9px] text-gray-500 dark:text-gray-400 truncate ml-1">${currentClassLabel}</span>` : ''}
                      </div>
                  </div>
                  
                  <!-- Right: Stats & Plac -->
                  <div class="flex items-center gap-2 shrink-0">
                      <div class="text-right">
                          <div class="text-[8px] uppercase text-gray-500 dark:text-gray-400 leading-none mb-0.5">Straff</div>
                          <div class="font-bold text-[13px] text-blue-800 dark:text-blue-300 leading-none">${penaltyLabel}</div>
                      </div>
                      <div class="text-right border-l dark:border-gray-300 dark:border-gray-600 pl-2">
                          ${placBlock}
                      </div>
                  </div>
              </div>
              
              <!-- Second Row: Chips & Actions -->
              <div class="px-1.5 py-1 flex items-center justify-between gap-1 bg-white dark:bg-gray-800">
                  <div class="flex flex-wrap gap-1.5 items-center">
                     <span class="text-[9px] text-gray-500 dark:text-gray-400 font-medium">%: <span class="${r.isBestTotalPercent ? 'text-emerald-700 dark:text-emerald-400 font-black' : 'dark:text-gray-200'}">${percentLabel}</span></span>
                     ${uniqueJudgesPositions.length > 0 ? `<div class="flex gap-0.5 ml-1 border-l dark:border-gray-100 dark:border-gray-700 pl-1">` + uniqueJudgesPositions.map(pos => {
                         const match = Object.values(r.judges || {}).find(j => j.position === pos || (expandDressagePosition(j) === pos));
                         return `<div class="flex items-center gap-0.5"><span class="text-[8px] font-bold text-gray-400 dark:text-gray-500">${pos}</span>${judgeChip(match, r.startNumber)}</div>`;
                     }).join('') + `</div>` : ''}
                  </div>
                  <div class="shrink-0 flex items-center gap-1" data-finalize-slot>
                      ${!r.eliminated && !isFinalized(r.startNumber) && r.isDone ? `<span class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800 leading-none">Klar</span>` : statusText}
                      ${(() => {
                const canFinalizeCheck = window.canFinalize || (() => isPrivileged());
                const can = canFinalizeCheck();
                const finalized = isFinalized(r.startNumber);
                const compId = getGlobalState('currentCompetition')?.id;
                if (!can) return '';
                if (finalized) {
                    return `
                                <span id="badge-final-${r.startNumber}" class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 mr-0.5 leading-none">Finaliserad</span>
                                <button type="button"
                                        data-action="unfinalize" data-sn="${r.startNumber}"
                                        class="px-1.5 py-0.5 text-[9px] rounded border border-emerald-600 dark:border-emerald-500 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 leading-none"
                                        >
                                    Ångra
                                </button>
                            `;
                } else {
                    return `
                                 <button type="button"
                                         data-action="finalize" data-sn="${r.startNumber}"
                                         class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-600 text-white hover:bg-emerald-700 leading-none"
                                         >
                                     Lås
                                 </button>
                            `;
                }
            })()} 
                  </div>
              </div>
          </div>
        `;
    };

    html = rows.map(renderCard).join('');
    container.innerHTML = `<div class="bg-gray-50 dark:bg-gray-900 py-1 transition-colors duration-500">${html}</div>`;

    // Koppla klick-lyssnare (denna är ok)
    container.querySelectorAll('.clickable-row').forEach(el => {
        const sn = el.getAttribute('data-start-number');
        el.addEventListener('click', (e) => {
            if (e.target.closest('button, a, [onclick]')) return;
            const safeJudges = (allCompetitionJudges || []).map(j => ({
                ...j,
                position: (expandDressagePosition(j) || j.position || '').toUpperCase()
            }));
            const rawList = rawByStart.get(sn) || [];
            const cleanList = deduplicateAndFilterProtocols(rawList, safeJudges);
            const tempMap = new Map([[String(sn), cleanList]]);
            openDetailsModal(sn, {
                savedProtocolsMap: tempMap,
                equipages: masterEquipageList,
                statusMap: dressageStatusMap,
                currentJudges: (currentJudgesPresent && currentJudgesPresent.length) ? currentJudgesPresent : null
            });
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                if (e.target.closest('button, a, [onclick]')) return;
                const safeJudges = (allCompetitionJudges || []).map(j => ({
                    ...j,
                    position: (expandDressagePosition(j) || j.position || '').toUpperCase()
                }));
                const rawList = rawByStart.get(sn) || [];
                const cleanList = deduplicateAndFilterProtocols(rawList, safeJudges);
                const tempMap = new Map([[String(sn), cleanList]]);
                openDetailsModal(sn, {
                    savedProtocolsMap: tempMap,
                    equipages: masterEquipageList,
                    statusMap: dressageStatusMap,
                    currentJudges: (currentJudgesPresent && currentJudgesPresent.length) ? currentJudgesPresent : null
                });
            }
        });
    });
}

function renderClassChips() {
    const chipHost = document.getElementById('dressageClassChips');
    if (!chipHost) return;

    const labels = [...new Set(masterEquipageList.map(e => e._mergedLabel || e.className || '—'))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'sv'));

    renderResponsiveClassFilter(chipHost, labels, dressage_activeClassFilters, (lbl) => {
        if (dressage_activeClassFilters.has(lbl)) {
            dressage_activeClassFilters.delete(lbl);
        } else {
            dressage_activeClassFilters.add(lbl);
        }
        render();
    });
}



function renderLiveHeader() {
    // Find active rider (PRIORITIZE most recently updated if multiple are active)
    const activeCandidates = processedResults.filter(r => {
        const sn = String(r.startNumber);
        const st = dressageStatusMap.get(sn);
        if (!st) return false;
        if (isFinalized(sn) || r.eliminated) return false;

        // Same logic as in renderDesktop to determine "isRunning"
        const judgesValues = Object.values(r.judges || {});
        if (judgesValues.some(j => j.eliminated)) return false;

        const classExpectedPos = getExpectedJudgesForClass(r.className);
        const completedPositions = getCompletedDressageJudgePositions(judgesValues);
        const liveCount = judgesValues.filter(j => j.isLive).length;
        const isDone = isDressageReadyToFinalize({
            status: st,
            countedJudgePositions: completedPositions,
            expectedJudgePositions: classExpectedPos,
            finalized: false
        });

        if (!isDone && (liveCount > 0 || completedPositions.size > 0 || st.state === 'ongoing')) {
            return true;
        }
        return false;
    });

    let activeRes = null;
    if (activeCandidates.length > 0) {
        // Sort by updatedAt descending (newest first)
        activeCandidates.sort((a, b) => {
            const stA = dressageStatusMap.get(String(a.startNumber));
            const stB = dressageStatusMap.get(String(b.startNumber));
            const timeA = stA && stA.updatedAt ? new Date(stA.updatedAt).getTime() : 0;
            const timeB = stB && stB.updatedAt ? new Date(stB.updatedAt).getTime() : 0;
            return timeB - timeA;
        });
        activeRes = activeCandidates[0];
    }

    if (!activeRes) return '';

    // --- Recalculate everything fresh (Like Monitor) to ensure prognosis is correct ---
    const allPrograms = getPrograms();
    let program = allPrograms[activeRes.testKey] || allPrograms[activeRes.programKey];
    if (!program && activeRes.className) {
        const g = guessProgramKeyFromClass(activeRes.className, allPrograms);
        if (g) program = allPrograms[g];
    }

    // Prepare lists for aggregation
    const freshJudgeProjections = [];

    // --- Restore Moment Detection Logic ---
    const judgesDict = activeRes.judges || {};
    const allJudgeEntries = Object.values(judgesDict).filter(j => j && !j.eliminated);

    const judgeProgress = allJudgeEntries.map(j => {
        let maxIdx = -1;
        const movs = Array.isArray(j.movements) ? j.movements : [];
        movs.forEach((m, i) => {
            const s = m?.score;
            if (s !== null && s !== undefined && s !== '' && Number.isFinite(Number(s))) {
                maxIdx = i;
            }
        });
        return maxIdx;
    });

    // If ANY judge is at -1 (start), use -1.
    let currentMomentIdx = judgeProgress.length > 0 ? Math.min(...judgeProgress) : -1;

    // Bygg score-list för snittet
    let momentText = `<span class="italic opacity-75">${t('status_starting_soon')}</span>`;
    const activeMomentScores = [];
    if (currentMomentIdx >= 0) {
        allJudgeEntries.forEach(j => {
            const mov = j.movements?.[currentMomentIdx];
            const s = mov?.score;
            if (s !== null && s !== undefined && s !== '' && Number.isFinite(Number(s))) {
                activeMomentScores.push(Number(s));
            }
        });

        if (program?.movements?.[currentMomentIdx]) {
            const pm = program.movements[currentMomentIdx];
            momentText = `<span class="opacity-80 font-bold mr-2 text-xl block md:inline">${t('dressage_monitor_moment_label')} ${pm.no}:</span> <span class="text-lg md:text-xl font-medium text-white">${pm.text}</span>`;
        } else {
            momentText = `<span class="text-lg">${t('dressage_monitor_moment_label')} ${currentMomentIdx + 1}</span>`;
        }
    }

    // Judge Average
    const momentAvg = activeMomentScores.length > 0
        ? (activeMomentScores.reduce((a, b) => a + b, 0) / activeMomentScores.length).toFixed(1)
        : '—';

    // Judge Cards 
    const expectedPositions = getExpectedJudgesForClass(activeRes.className);

    const judges = Object.values(activeRes.judges || {})
        .filter(j => {
            if (!j || j.eliminated) return false;
            if (expectedPositions && !expectedPositions.includes((j.position || '').toUpperCase())) {
                return false;
            }
            return true;
        })
        .sort((a, b) => {
            const order = { 'H': 1, 'C': 2, 'M': 3, 'E': 4, 'B': 5 };
            const posA = (a.position || '').toUpperCase();
            const posB = (b.position || '').toUpperCase();
            return (order[posA] || 99) - (order[posB] || 99);
        });

    const judgeCardsHtml = judges.map(j => {
        // Use PRE-CALCULATED values from processAndAggregateResults
        const projPct = (j.projectedPercent != null && Number.isFinite(j.projectedPercent)) ? j.projectedPercent : null;
        const pPct = projPct != null ? projPct.toFixed(1) + '%' : ((j.percent > 0) ? j.percent.toFixed(1) + '%' : '—');

        // Only include in TOTAL if we have a real live judge record (not just a placeholder)
        // AND the projection is > 0
        if (j.isLive && projPct != null && projPct > 0) {
            freshJudgeProjections.push(projPct);
        }

        // DIRECT LOOKUP: Use the judge's own movements!
        let mScore = '—';
        if (currentMomentIdx >= 0 && j.movements) {
            const mov = j.movements[currentMomentIdx];
            const s = mov?.score;
            if (s !== null && s !== undefined && s !== '' && Number.isFinite(Number(s))) {
                mScore = Number(s).toFixed(1);
            }
        }

        const scoreClass = mScore !== '—' ? 'text-yellow-400 scale-105' : 'text-gray-500';

        // --- Name Fix (Robust) ---
        let displayName = j.name;
        if (!displayName || displayName.trim() === '') {
            const allJ = window.allCompetitionJudges || [];
            // Normalize IDs for comparison (strip "judge_" prefix from both sides if present)
            const cleanJid = String(j.id || j.judgeId || '').replace(/^judge_/i, '');

            const found = allJ.find(x => {
                const cleanXid = String(x.id).replace(/^judge_/i, '');
                return cleanXid === cleanJid;
            });

            if (found) displayName = found.name;
            else displayName = t('judge');
        }

        return `
      <div class="bg-indigo-900/40 rounded-md px-1 py-1 text-center border border-indigo-500/30 flex flex-col items-center min-w-[60px] relative group h-full justify-between">
           <!-- Pos -->
           <div class="absolute top-0 right-0 bg-indigo-950/80 text-indigo-200 text-[8px] font-bold px-1 rounded-bl-sm opacity-90">${j.position || '?'}</div>
           
           <!-- Name -->
           <div class="text-[8px] font-semibold text-indigo-300 truncate w-full mt-2.5 mb-0.5 leading-tight max-w-[55px]" title="${displayName}">
             ${stackName(displayName)}
           </div>

           <!-- Score -->
           <div class="text-xl font-black ${scoreClass} leading-none mb-0.5">${mScore}</div>
           
           <!-- Pct -->
           <div class="text-[8px] text-indigo-200 font-medium border-t border-indigo-500/30 w-full pt-0.5 mt-0.5">${pPct}</div>
      </div>`;
    }).join('');

    // --- Totals from activeRes (calculated in processAndAggregateResults) ---
    // If freshJudgeProjections reveals a discrepancy, we could re-calculate, but we trust processedResults now.

    // We prefer the liveAvgProjectedPercent if available and valid
    const percentVal = (activeRes.liveAvgProjectedPercent != null && Number.isFinite(activeRes.liveAvgProjectedPercent))
        ? activeRes.liveAvgProjectedPercent
        : activeRes.avgPercent;

    const percent = (Number.isFinite(percentVal)) ? percentVal.toFixed(1) + '%' : '—';


    const penaltyVal = (activeRes.liveAvgProjectedPenalty != null && Number.isFinite(activeRes.liveAvgProjectedPenalty))
        ? activeRes.liveAvgProjectedPenalty
        : activeRes.finalPenalty;

    const penalty = Number.isFinite(penaltyVal)
        ? penaltyVal.toFixed(2)
        : '—';

    return `
    <div class="mb-2 bg-gradient-to-r from-brand-darkblue to-indigo-950 rounded-lg shadow border-l-4 border-yellow-500 overflow-hidden text-white font-sans animate-fade-in relative 
                flex flex-col gap-1 px-3 py-1.5">
        
        <!-- Row 1: Info (Left) + Stats (Right) -->
        <div class="grid grid-cols-[1fr_max-content] items-center gap-3">
             <!-- Driver & Horse (Flexible + Truncate) -->
             <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-2 mb-0.5 opacity-80">
                     <span class="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest bg-red-600 text-white animate-pulse shadow-sm">Live</span>
                     <span class="text-[10px] font-medium text-indigo-200 truncate">${activeRes.startNumber} ${activeRes.className}</span>
                     <span class="hidden sm:inline italic text-indigo-300 text-[10px]">• ${getMomentHorseLabel(activeRes, 'dressage')}</span>
                </div>
                <div class="text-lg font-black text-white leading-none tracking-tight truncate">
                    ${activeRes.driverName}
                </div>
            </div>

            <!-- Main Stats (Fixed Width to prevent wiggle) -->
            <div class="flex bg-indigo-900/40 rounded border border-indigo-500/30 divide-x divide-indigo-500/30 flex-shrink-0 overflow-hidden h-[32px]">
                 <div class="px-2 py-0.5 text-center w-[52px] flex flex-col justify-center">
                    <div class="text-[7px] uppercase font-bold text-indigo-300 leading-tight">${t('dressage_monitor_moment_label')}</div>
                    <div class="text-base font-black text-yellow-400 leading-none">${momentAvg}</div>
                 </div>
                 <div class="px-2 py-0.5 text-center w-[52px] bg-indigo-500/10 flex flex-col justify-center">
                    <div class="text-[7px] uppercase font-bold text-indigo-200 leading-tight">Total %</div>
                    <div class="text-base font-black text-white leading-none">${percent}</div>
                 </div>
                 <div class="px-2 py-0.5 text-center w-[52px] flex flex-col justify-center">
                    <div class="text-[7px] uppercase font-bold text-indigo-300 leading-tight">${t('dressage_penalty_header')}</div>
                    <div class="text-base font-black text-blue-300 leading-none">${penalty}</div>
                 </div>
            </div>
        </div>

        <!-- Row 2: Moment (Left) + Judges (Right) -->
        <div class="grid grid-cols-[1fr_max-content] items-center gap-3 border-t border-white/5 pt-1">
            <!-- Moment Text (Flexible + Truncate) -->
            <div class="text-[11px] font-medium text-white/90 flex items-center min-w-0 pr-2">
               <div class="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse mr-2 flex-shrink-0"></div>
               <span class="truncate italic">${(momentText || '').replace(/<[^>]+>/g, '')}</span>
            </div>

            <!-- Judges (Fixed Width to prevent wiggle) -->
            <div class="flex items-center gap-1 flex-shrink-0 h-[40px]">
                ${judgeCardsHtml.replace(/min-w-\[60px\]/g, 'w-[52px]').replace(/text-xl/g, 'text-lg').replace(/mt-2.5/g, 'mt-2').replace(/px-1/g, 'px-0.5').replace(/min-w-\[50px\]/g, 'w-[48px]')}
            </div>
        </div>
    </div>
  `;
}

// === NEW: Helper to find expected judge positions for a specific class
function getExpectedJudgesForClass(className) {
    return getExpectedDressageJudgePositions(className, window.dressageJudgeMapping, currentJudgesPresent);
}

function renderTableHead(thead, judgesPresent) {
    const order = { 'H': 1, 'C': 2, 'M': 3, 'E': 4, 'B': 5 };
    const uniquePositions = [...new Set(
        (judgesPresent || []).map(j => (j.position || '').toUpperCase()).filter(p => /^[CEBHM]$/.test(p))
    )].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99));

    const staticHeaders = [
        { key: 'plac', label: t('rank'), align: 'center' }, 
        { key: 'startNumber', label: t('startno'), align: 'center' },
        { key: 'driverName', label: `${t('driver')} <span class="hidden lg:inline">/ ${t('horse')}</span>`, title: `${t('driver')} / ${t('horse')}`, align: 'left' }, 
        { key: 'className', label: t('class'), align: 'left' },
        { key: 'club', label: t('club'), align: 'left' }, 
        { key: 'startTime', label: t('start_time'), align: 'center' }
    ];

    const judgeHeaders = uniquePositions.map(pos => ({
        key: `judge_pos:${pos}`,
        label: `<div class="text-center font-bold text-gray-700">${pos}</div>`,
        title: `${t('judge')} ${pos}`,
        align: 'center',
        position: pos
    }));

    const finalHeaders = [
        { key: 'percent', label: t('dressage_avg_percent'), align: 'right' }, { key: 'errorPoints', label: t('mistakes'), align: 'center' },
        { key: 'finalPenalty', label: t('dressage_penalty_header'), align: 'right' }, { key: 'status', label: t('status'), align: 'center' }
    ];

    const allHeaders = [...staticHeaders, ...judgeHeaders, ...finalHeaders];

    thead.innerHTML = `
        <tr>
            ${allHeaders.map(h => `
              <th scope="col"
                  class="px-2 py-2 lg:px-3 lg:py-3 ${h.align ? 'text-' + h.align : 'text-left'} text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer group hover:bg-gray-100 dark:hover:bg-gray-600 ${h.key === 'startNumber' ? 'sticky-col-start bg-gray-50 dark:bg-gray-700' : ''} ${h.key === 'driverName' ? 'sticky-col-driver bg-gray-50 dark:bg-gray-700' : ''}"
                  data-sort-key="${h.key}" title="${escapeHtml(h.title || h.label)}">
                ${headerLabelWithSort(h.label, h.key)}
              </th>`).join('')}
             <th class="px-2 py-2 lg:px-4 lg:py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">${t('finalize')}</th>
        </tr>
    `;

    // Reattach sort listeners
    thead.querySelectorAll('th[data-sort-key]').forEach(th => th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        if (sortState.key === key) {
            sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.key = key;
            sortState.dir = 'asc';
        }
        updateURLWithSort();
        render();
    }));
}

function renderDesktop(judgesPresent) {
    const container = document.getElementById('resultsContainer');
    if (!container) return;

    renderClassChips();
    const liveBannerHtml = renderLiveHeader();
    const rows = getVisibleSortedResults();
    const allPrograms = getPrograms(); // Fix: Define allPrograms for use in loop

    // Structural Hashing
    const order = { 'H': 1, 'C': 2, 'M': 3, 'E': 4, 'B': 5 };
    const uniquePositions = [...new Set(
        (judgesPresent || []).map(j => (j.position || '').toUpperCase()).filter(p => /^[CEBHM]$/.test(p))
    )].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99));

    const structuralHash = [
        rows.length,
        viewMode,
        sortState.key,
        sortState.dir,
        searchQuery,
        Array.from(dressage_activeClassFilters).join('|'),
        uniquePositions.join(','),
        rows.map(r => `${r.startNumber}:${isFinalized(r.startNumber)}:${r.plac}:${r.finalPenalty}:${r.eliminated}`).join('|')
    ].join('::');

    const headerHash = [uniquePositions.join(','), sortState.key, sortState.dir].join(':');

    // Preliminary shell if needed
    if (!container.querySelector('table')) {
        container.innerHTML = `
            <div id="liveBannerSlot"></div>
            <div id="dressage-x-wrap" class="x-scroll-wrap bg-white dark:bg-gray-900">
                <table id="dressageTable" class="w-max min-w-max divide-y divide-gray-200 dark:divide-gray-700 text-sm pr-table">
                    <thead class="bg-gray-50 dark:bg-gray-700" id="dressageThead"></thead>
                    <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700" id="dressageBody"></tbody>
                </table>
            </div>`;
    }

    // Always update live banner slot (high frequency)
    const bannerSlot = document.getElementById('liveBannerSlot');
    if (bannerSlot) {
        bannerSlot.innerHTML = liveBannerHtml;
    }

    const thead = document.getElementById('dressageThead');
    const tbody = document.getElementById('dressageBody');

    if (thead && headerHash !== lastHeaderHash) {
        renderTableHead(thead, judgesPresent);
        lastHeaderHash = headerHash;
    }

    if (structuralHash === lastStructuralHash && tbody && tbody.children.length > 0) {
        return;
    }
    lastStructuralHash = structuralHash;

    // Body rendering
    let html = '';
    let lastClass = null;
    rows.forEach((res, index) => {
        const currentClassLabel = res._mergedLabel || res.className || 'Okänd Klass';
        if (viewMode === 'byclass' && currentClassLabel !== lastClass) {
            html += `<tr class="bg-gray-100 dark:bg-gray-700 border-t border-b border-gray-200 dark:border-gray-600"><td colspan="20" class="px-4 py-2 font-bold text-gray-700 dark:text-gray-200 text-sm">${t('class')}: ${currentClassLabel}</td></tr>`;
            lastClass = currentClassLabel;
        }

        const sn = String(res.startNumber);
        const statusInfo = dressageStatusMap.get(sn);
        const judgesValues = Object.values(res.judges || {});
        const isEliminated = res.eliminated || judgesValues.some(j => j.eliminated);
        const isFin = isFinalized(sn);

        let isRunning = false;
        let isDone = false;
        if (!isEliminated && !isFin) {
            const classExpectedPos = getExpectedJudgesForClass(res.className);
            const completedPositions = getCompletedDressageJudgePositions(judgesValues);
            const liveCount = judgesValues.filter(j => j.isLive).length;
            isDone = isDressageReadyToFinalize({
                status: statusInfo,
                countedJudgePositions: completedPositions,
                expectedJudgePositions: classExpectedPos,
                finalized: false
            });

            if (!isDone && (liveCount > 0 || statusInfo?.state === 'ongoing')) {
                isRunning = true;
            }
        }

        let rowClass = (index % 2 === 0 ? "bg-white dark:bg-gray-800" : "bg-gray-50 dark:bg-gray-700/50") + " hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors cursor-pointer";
        let rowStyle = "";
        if (isRunning) {
            rowClass = "bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 shadow-sm relative z-10 cursor-pointer";
        } else if (isEliminated) {
            rowClass = "opacity-75 bg-red-50 dark:bg-red-900/10 cursor-pointer";
        }

        // Result Logic
        let penaltyHtml = fmtNum(res.finalPenalty);
        let percentHtml = fmtPct(res.avgPercent);
        let penaltyClass = res.isBestTotalPenalty ? 'font-extrabold text-blue-900 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100';
        let percentClass = res.isBestTotalPercent ? 'font-extrabold text-emerald-700 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-300';

        if (isEliminated) {
            penaltyHtml = '<span class="font-bold text-red-600 dark:text-red-400">ELIMINERAD</span>';
        } else if (isRunning) {
            // Use service-calculated prognosis directly
            const projPre = res.liveAvgProjectedPercent;
            const projPen = res.liveAvgProjectedPenalty;

            const hasProj = (projPre != null && Number.isFinite(projPre)) || (projPen != null && Number.isFinite(projPen));

            if (hasProj) {
                if (Number.isFinite(projPen)) {
                    penaltyHtml = `<div class="flex flex-col items-end leading-tight">
                        <span class="text-sm font-bold text-brand-darkblue dark:text-blue-300 italic">${projPen.toFixed(2)}</span>
                        <span class="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Prognos</span>
                    </div>`;
                    penaltyClass = '';
                }
                if (Number.isFinite(projPre)) {
                    percentHtml = `<div class="flex flex-col items-end leading-tight">
                        <span class="text-sm font-bold text-brand-darkblue dark:text-blue-300 italic">${projPre.toFixed(2)}%</span>
                        <span class="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Prognos</span>
                    </div>`;
                    percentClass = '';
                }
            }
        }

        // Placering Logic
        let placHtml = res.plac ?? '–';
        if (res.isClearRound) {
            if (res.crApproved) {
                placHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800">Godkänd</span>`;
            } else {
                placHtml = '<span class="text-gray-400 dark:text-gray-500">–</span>';
            }
        }

        const compId = getGlobalState('currentCompetition')?.id;
        const finalized = isFinalized(sn);
        const can = isPrivileged();

        let statusHtml = statusBadgeForDressage(sn);
        if (!isFin && !isEliminated && isDone) {
            statusHtml = `<span class="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800 mr-2">Klar</span>`;
        }

        html += `
        <tr class="${rowClass}" data-start-number="${sn}" style="${rowStyle}">
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 whitespace-nowrap text-center font-semibold text-xs lg:text-sm text-gray-900 dark:text-white">${placHtml}</td>
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 whitespace-nowrap text-center text-xs lg:text-sm text-gray-900 dark:text-gray-300 sticky-col-start ${rowClass || ''}">${sn}</td>
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 sticky-col-driver ${rowClass || ''}" style="min-width: 120px;">
                <div class="text-xs lg:text-base font-bold text-gray-900 dark:text-white leading-tight truncate" title="${res.driverName || ''}">${res.driverName || ''}</div>
                <div class="text-[10px] lg:text-xs text-gray-500 dark:text-gray-400 leading-tight whitespace-normal hidden lg:block mb-0.5 mt-0.5">${getMomentHorseLabelStacked(res, 'dressage')}</div>
            </td>
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm text-gray-500 dark:text-gray-400">${currentClassLabel}</td>
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 whitespace-nowrap">
                <div class="flex items-center gap-1.5 lg:gap-2" title="${res.clubName || ''}">
                    ${getFlagHtml(res)}
                    ${getClubLogoHtml(res)}
                    <span class="hidden lg:inline-block text-[11px] lg:text-sm text-gray-700 dark:text-gray-300">${res.clubName || ''}</span>
                </div>
            </td>
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 whitespace-nowrap text-center text-[11px] lg:text-sm text-gray-900 dark:text-gray-300">${formatStartTimeLabel(res.startTime) || '–'}</td>
            ${uniquePositions.map(pos => {
            const classExpectedPos = getExpectedJudgesForClass(res.className);
            if (classExpectedPos && !classExpectedPos.includes(pos)) {
                return `<td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center text-xs text-gray-300 dark:text-gray-600">—</td>`;
            }
            const match = Object.values(res.judges || {}).find(j => (j.position === pos || expandDressagePosition(j) === pos));
            return `<td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center text-xs lg:text-sm" title="${match ? (match.name || match.id) : ''}">${judgeChip(match, sn)}</td>`;
        }).join('')}
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-right text-xs lg:text-sm ${percentClass}">${percentHtml}</td>
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center text-xs lg:text-sm text-gray-500 dark:text-gray-400">${res.errorPoints > 0 ? res.errorPoints : '—'}</td>
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-right text-xs lg:text-sm font-bold ${penaltyClass}">${penaltyHtml}</td>
            <td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-center whitespace-nowrap">${statusHtml}</td>
            <td class="px-1.5 py-1.5 lg:px-4 lg:py-2">
                <div class="flex items-center justify-center gap-1 lg:gap-2 flex-wrap" data-finalize-slot>
                    ${can ? `
                    <span id="badge-final-${sn}" class="inline-flex items-center px-1.5 py-0.5 lg:px-2 lg:py-1 rounded text-[10px] lg:text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300" style="${finalized ? '' : 'display:none'}">Finaliserad</span>
                    <button type="button" data-action="finalize" data-sn="${sn}" class="px-1.5 py-0.5 lg:px-2 lg:py-1 text-[10px] lg:text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700"  style="${finalized ? 'display:none' : ''}">Finalisera</button>
                    <button type="button" data-action="unfinalize" data-sn="${sn}" class="px-1.5 py-0.5 lg:px-2 lg:py-1 text-[10px] lg:text-xs rounded border border-emerald-600 dark:border-emerald-500 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"  style="${finalized ? '' : 'display:none'}">Ångra</button>
                    ` : ''}
                </div>
            </td>
        </tr>`;
    });

    tbody.innerHTML = html;

    // Scroll sync
    try { window.__teardownXbarSync?.(); } catch { }
    const host = document.getElementById('dressage-x-wrap');
    if (window.__setupXbarSync && host) {
        window.__setupXbarSync({ barClass: 'fixed-xbar', innerId: 'dressageXbarInner', hostEl: host });
    }

    // Row click listeners
    if (!tbody.dataset.finalizeWired) {
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action][data-sn]');
            if (!btn) return;

            e.stopPropagation();

            const { action, sn } = btn.dataset;
            const compId = getGlobalState('currentCompetition')?.id;
            if (!compId || !sn) return;

            if (action === 'finalize') {
                window.__finalizeDressyr?.(compId, sn);
            } else if (action === 'unfinalize') {
                window.__unfinalizeDressyr?.(compId, sn);
            }
        });
        tbody.dataset.finalizeWired = '1';
    }

    tbody.querySelectorAll('tr[data-start-number]').forEach(row => row.addEventListener('click', (e) => {
        if (e.target.closest('button, a, [onclick]')) return;
        const sn = row.dataset.startNumber;
        if (sn) {
            const safeJudges = (allCompetitionJudges || []).map(j => ({ ...j, position: (expandDressagePosition(j) || j.position || '').toUpperCase() }));
            const rawList = rawByStart.get(String(sn)) || [];
            const cleanList = deduplicateAndFilterProtocols(rawList, safeJudges);
            const tempMap = new Map([[String(sn), cleanList]]);
            openDetailsModal(sn, { savedProtocolsMap: tempMap, equipages: masterEquipageList, statusMap: dressageStatusMap, currentJudges: (currentJudgesPresent && currentJudgesPresent.length) ? currentJudgesPresent : null });
        }
    }));
}

// ----- HUVUDFUNKTIONER FÖR INITIERING -----
function renderLiveUpdateTicker(lastUpdate, activeEquipageInfo, startNo) {

    const container = document.getElementById('liveUpdateTicker');
    if (!container) return;

    if (!activeEquipageInfo) {
        container.style.display = 'none';
        __tickerCurrentStart = null;
        return;
    }

    const startStr = String(activeEquipageInfo.startNumber || startNo || '');
    const statusInfo = dressageStatusMap.get(startStr);
    const judgesData = activeEquipageInfo.judges || {};

    const anyLive = Object.values(judgesData).some(j => j && j.isLive);
    const hasAnyJudge = Object.keys(judgesData).length > 0;
    const allJudgesNonLive = hasAnyJudge && Object.values(judgesData).every(j => j && !j.isLive);

    // 1) Göm på explicit 'finished'
    if (statusInfo?.state === 'finished') {
        container.style.display = 'none';
        __tickerCurrentStart = null;
        return;
    }

    // 2) Göm när ingen domare är live och vi har åtminstone någon domardata
    if (!anyLive && allJudgesNonLive) {
        container.style.display = 'none';
        __tickerCurrentStart = null;
        return;
    }

    // 3) Visa bara om pågående live
    const s = (statusInfo?.state || '').toLowerCase();
    const isOngoing = (s === 'ongoing' || s === 'running' || s === 'active') || anyLive;
    if (!isOngoing) {
        container.style.display = 'none';
        __tickerCurrentStart = null;
        return;
    }
    __tickerCurrentStart = startStr;

    // Live-domare att visa
    const liveJudges = Object.entries(judgesData)
        .filter(([, j]) => j && j.isLive)
        .map(([jid, j]) => {
            const meta = (currentJudgesPresent || []).find(x => String(x.id) === String(jid))
                || (allCompetitionJudges || []).find(x => String(x.id) === String(jid))
                || { id: jid, name: '', position: '' };
            return { ...meta, ...j };
        });

    // Prognos / statistik
    // Prognos borttagen


    let latestScoreHtml = '<div class="latest-score-section-placeholder">Väntar på första poäng…</div>';
    if (lastUpdate && lastUpdate.momentNo) {
        const program = activeEquipageInfo.testKey ? getPrograms()[activeEquipageInfo.testKey] : null;
        const moment = program?.movements.find(m => m.no === lastUpdate.momentNo);
        const scoreVal = (typeof lastUpdate.score === 'number') ? lastUpdate.score : Number(lastUpdate.score);
        const scoreTxt = Number.isFinite(scoreVal) ? scoreVal.toFixed(1) : '–';
        latestScoreHtml = `
      <div class="latest-score-section">
        <div class="moment-details">
          <div class="moment-no">M.${lastUpdate.momentNo}</div>
          <div>
            <div class="moment-text">${moment?.text || lastUpdate.momentText || ''}</div>
            <div class="moment-judge-text">${moment?.judge || ''}</div>
          </div>
        </div>
        <div class="latest-score-display">
          <span class="judge-pos">${lastUpdate.judgePosition || ''}</span>
          <span class="score">${scoreTxt}</span>
        </div>
      </div>
    `;
    }

    const judgeCount = currentJudgesPresent.length;
    const compact = judgeCount >= 4;
    const summaryOnly = judgeCount >= 8;

    const liveIndicatorHtml = `<span style="display:inline-block;width:10px;height:10px;background-color:#f56565;border-radius:50%;animation:pulse 1.5s infinite;"></span>`;



    container.innerHTML = `
    <div class="ticker-grid ${compact ? 'compact-judges' : ''} ${summaryOnly ? 'summary-only' : ''}">
      <div class="ticker-header">
        ${liveIndicatorHtml} PÅ BANAN:
        <strong>#${activeEquipageInfo.startNumber} ${activeEquipageInfo.driverName || ''}</strong>
      </div>
      ${latestScoreHtml}

    </div>
    `;

    const styleId = 'liveTickerStyles_v2';
    if (!document.getElementById(styleId)) {
        const css = `
  @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
  #liveUpdateTicker { background-color:#1a202c; color: #f7fafc; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; display: none; }
  .ticker-grid { display: grid; grid-template-columns: 2fr 3fr 3fr; align-items: center; gap: 16px; }
  .ticker-header { grid-column: 1; font-size: 1.1em; display: flex; align-items: center; gap: 8px; }
  .latest-score-section, .latest-score-section-placeholder { grid-column: 2; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-left: 1px solid #4a5568; border-right: 1px solid #4a5568; padding: 0 16px; min-height: 48px; }
  .latest-score-section-placeholder { color:#718096; justify-content: center; font-style: italic; }
  .moment-details { display: flex; gap: 8px; } .moment-no { font-weight: 700; color: #a0aec0; } .moment-text { font-weight: 600; } .moment-judge-text { font-size: .9em; color:#718096; font-style: italic; }
  .latest-score-display { display: flex; align-items: baseline; gap: 8px; } .latest-score-display.judge-pos { font-size: 1.1em; font-weight: 700; color: #cbd5e0; } .latest-score-display.score { font-size: 2.1em; font-weight: 800; color:#63b3ed; }

  .prognosis-section { grid-column: 3; display: flex; align-items: center; justify-content: space-around; gap: 16px; flex-wrap: wrap; }
  .prognosis-section.label { font-size: .7rem; font-weight: 600; color: #a0aec0; text-align: center; }
  .main-prognosis.value { font-size: 1.6em; font-weight: 700; color: #fff; text-align: center; }

  .judge-prognosis-list.items { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .judge-prog-item { display: flex; flex-direction: column; align-items: center; background:#2d3748; padding: 2px 6px; border-radius: 4px; }
      .judge-prog-item.pos { font-size: .8em; font-weight: 700; color: #cbd5e0; }
      .judge-prog-item.prog { font-size: .9em; font-weight: 600; color: #a0aec0; }

      /* KOMPAKT från 4+ domare */
      .ticker-grid.compact-judges { gap: 10px; }
      .ticker-grid.compact-judges.judge-prognosis-list.items {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(56px, 1fr)); gap: 6px;
  }
      .ticker-grid.compact-judges.judge-prog-item { padding: 2px 4px; }
      .ticker-grid.compact-judges.judge-prog-item.pos { font-size: .75em; }
      .ticker-grid.compact-judges.judge-prog-item.prog { font-size: .8em; }

      /* Sammanfattning för många domare */
      .judge-summary { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 180px; }
      .judge-summary.label { font-size: .7rem; font-weight: 600; color: #a0aec0; text-align: center; }
      .judge-summary.value { font-size: 1rem; font-weight: 700; color: #e2e8f0; text-align: center; }

      /* Vid 8+ domare – tona ner chip-listan (men behåll i desktop) */
      .ticker-grid.summary-only.judge-prognosis-list.items { opacity: 0.9; }
  @media(max-width: 768px) {
        .ticker-grid { grid-template-columns: 1fr; gap: 10px; }
        .latest-score-section, .latest-score-section-placeholder { grid-column: auto; border: 0; padding: 0; }
        .prognosis-section { grid-column: auto; justify-content: space-between; }
        .main-prognosis.value { font-size: 1.4em; }
        /* På mobil med 8+ domare – visa bara sammanfattningen, göm chips */
        .ticker-grid.summary-only.judge-prognosis-list { display: none; }
  }
  `;
        const st = document.createElement('style');
        st.id = styleId; st.textContent = css;
        document.head.appendChild(st);
    }

    container.style.display = 'block';
}

window.__finalizeDressyr = async (compIdFromBtn, startNo) => {
    try {
        if (!isPrivileged()) { alert('Endast domare/admin.'); return; }
        const compId = compIdFromBtn || resolveCurrentCompId();
        if (!compId) return alert('Ingen tävling vald.');
        if (!confirm(`Finalisera dressyrresultat för #${startNo}?`)) return;

        await setDoc(dressageFinalizationDocRef(compId, startNo), {
            finalized: true,
            finalizedAt: Date.now(),
            finalizedBy: (getGlobalState('currentUser')?.uid || null)
        }, { merge: true });

        // Optimistisk UI
        const cur = dressageStatusMap.get(String(startNo)) || {};
        dressageStatusMap.set(String(startNo), { ...cur, finalized: true });
        patchFinalizeBadge(startNo, true);
    } catch (e) {
        console.warn('Kunde inte finalisera:', e);
        alert('Saknar behörighet att finalisera (eller skrivning nekades).');
    }
};

window.__unfinalizeDressyr = async (compIdFromBtn, startNo) => {
    try {
        if (!isPrivileged()) { alert('Endast domare/admin.'); return; }
        const compId = compIdFromBtn || resolveCurrentCompId();
        if (!compId) return alert('Ingen tävling vald.');
        if (!confirm(`Ångra finalisering för #${startNo}?`)) return;

        await setDoc(dressageFinalizationDocRef(compId, startNo), {
            finalized: false,
            unfinalizedAt: Date.now(),
            unfinalizedBy: (getGlobalState('currentUser')?.uid || null)
        }, { merge: true });

        const cur = dressageStatusMap.get(String(startNo)) || {};
        dressageStatusMap.set(String(startNo), { ...cur, finalized: false });
        patchFinalizeBadge(startNo, false);
    } catch (e) {
        console.warn('Kunde inte ångra finalisering:', e);
        alert('Saknar behörighet att ångra finalisering (eller skrivning nekades).');
    }
};

function render() {
    const nowMobile = isMobile(); //
    const wasMobile = document.body.dataset.wasMobile === '1';

    if (nowMobile) {
        if (!wasMobile) {
            // Byt HÄR till den nya teardown-funktionen
            try { window.__teardownXbarSync?.(); } catch { }
        }
        renderMobile(currentJudgesPresent); //
    } else {
        // Är desktop. renderDesktop kommer att anropa __setupXbarSync.
        renderDesktop(currentJudgesPresent); //
    }

    // Sätt 'wasMobile' *efter* rendering
    document.body.dataset.wasMobile = nowMobile ? '1' : '0';
    // Gör state synligt för modalmodulen (PDF/monitor-brygga)
    window.__dressageProcessedResultsRef = processedResults;
    window.__dressageCurrentJudgesPresentRef = currentJudgesPresent;
}

let __recomputeTimer = null;
function queueRecompute(fn) {
    clearTimeout(__recomputeTimer);
    __recomputeTimer = setTimeout(() => { try { fn(); } catch (e) { console.error(e); } }, 80);
}

window.__dressageRecomputeAll = window.__dressageRecomputeAll || null;

// === ERSÄTT HELA setupLive()-FUNKTIONEN ===
function setupLive(competitionId, activeEquipages) {
    if (typeof listenForDressageProtocolsCollectionGroup !== 'function' || !Array.isArray(activeEquipages)) return;

    // Rensa gamla lyssnare
    try { liveUnsubs.forEach(u => u()); } catch { } //
    liveUnsubs.clear(); //

    // Rensa gammal data
    rawByStart = new Map(); //
    dressageStatusMap = new Map(); //
    liveJudgeData = new Map(); //

    // === NYTT: Starta lyssnaren för merge-config ===
    listenMergeConfig(competitionId); //

    // Skapa en återanvändbar funktion för att räkna om och rita
    const reprocessAndRenderAll = () => {
        const flat = [];
        rawByStart.forEach((docs, sn) => {
            (docs || []).forEach(d => {
                const jid = d.judgeId ?? (typeof d.id === 'string' && d.id.startsWith('judge_') ? d.id.slice(6) : undefined);
                flat.push({ ...d, startNumber: Number(sn), judgeId: jid });
            });
        });

        window.__dressageRecomputeAll = reprocessAndRenderAll;

        const { results, judges } = processAndAggregateResults(masterEquipageList, flat);
        processedResults = results;

        const st = window.startTimes || {};
        processedResults.forEach(r => {
            try {
                const row = st[r.startNumber] || st[String(r.startNumber)] || {};
                r.startTime = row.dressage || row.dressyr || row.start || row.time || null;
            } catch { r.startTime = r.startTime || null; }
        });

        const judgeInfoMap = new Map();
        (currentJudgesPresent || []).forEach(j => judgeInfoMap.set(j.id, j));
        (judges || []).forEach(jInfo => {
            const existing = judgeInfoMap.get(jInfo.id) || { id: jInfo.id };
            const judgesList = Array.isArray(allCompetitionJudges) ? allCompetitionJudges : [];
            const full = judgesList.find(x => x && x.id === jInfo.id);
            const posAdmin = full ? (expandDressagePosition(full) || full.position || '') : '';
            const posObserved = (jInfo.position || existing.position || '');
            judgeInfoMap.set(jInfo.id, {
                id: jInfo.id,
                name: (full?.name || existing.name || jInfo.name || jInfo.id),
                position: (posAdmin || posObserved || '?').toUpperCase()
            });
        });
        const safeAllJudges = Array.isArray(allCompetitionJudges) ? allCompetitionJudges : [];
        if (judgeInfoMap.size === 0 && safeAllJudges.length > 0) {
            safeAllJudges.forEach(full => {
                judgeInfoMap.set(full.id, {
                    id: full.id,
                    name: full.name || full.id,
                    position: (expandDressagePosition(full) || full.position || '?').toUpperCase()
                });
            });
        }
        currentJudgesPresent = Array.from(judgeInfoMap.values())
            .filter(j => /^[CEBHM]$/.test(String(j.position || '').toUpperCase()));
        const order = { C: 0, E: 1, B: 2, H: 3, M: 4 };
        currentJudgesPresent.sort((a, b) => (order[a.position] ?? 99) - (order[b.position] ?? 99));

        render();
    };

    // === Anropa en gång FÖRST för att hämta all befintlig data ===
    queueRecompute(reprocessAndRenderAll);

    // 1) Dressage Status Collection (Ersätter N unStatus-lyssnare)
    const unStatusCol = listenForDressageStatusCollection(competitionId, (docs) => {
        docs.forEach(stDoc => {
            const key = String(stDoc.id);
            const cur = dressageStatusMap.get(key) || {};
            dressageStatusMap.set(key, { ...cur, ...stDoc });
            if (stDoc.state === 'finished') {
                if (liveJudgeData.has(key)) liveJudgeData.delete(key);
            }
        });
        queueRecompute(reprocessAndRenderAll);
    });
    liveUnsubs.set('dressageStatusCollection', unStatusCol);

    // 2) Dressage Finalization (Ersätter N setupFinalizationListenerOnce-lyssnare)
    const unFinCol = listenForDressageFinalizationCollection(competitionId, (docs) => {
        docs.forEach(finDoc => {
            const key = String(finDoc.id);
            const cur = dressageStatusMap.get(key) || {};
            dressageStatusMap.set(key, { ...cur, finalized: !!finDoc.finalized });
        });
        queueRecompute(reprocessAndRenderAll);
    });
    liveUnsubs.set('dressageFinalizationCollection', unFinCol);

    // 3) Dressage Live Group (Ersätter N unsubLive-lyssnare)
    // 3) Dressage Live Group (Ersätter N unsubLive-lyssnare)
    const unLiveGroup = listenForDressageLiveGroup(competitionId, activeEquipages, (docs) => {
        docs.forEach(st => {
            const key = String(st.startNumber);
            const known = dressageStatusMap.get(key);
            if (known?.state === 'finished') return;
            if (st?.updatedAt) {
                const age = Date.now() - new Date(st.updatedAt).getTime();
                if (Number.isFinite(age) && age > 120000) return;
            }
            let proto = st?.protocol || st?.liveProtocol;
            if (!proto && st && (st.judgeId || st.judgeUid || st.judge) && (st.movements || st.totalPoints || st.points || st.score || st.runningTotalPoints)) {
                proto = st;
            }
            const rawJid = proto?.judgeId || proto?.judgeUid || proto?.judge || null;
            // Use consistent lowercase normalization for keys
            const jid = rawJid ? String(rawJid).replace(/^judge_/i, '').trim().toLowerCase() : null;

            if (proto && jid) {
                const tk = st.testKey || st.programKey; // Enrich with key
                proto = { ...proto, judgeId: jid, testKey: proto.testKey || tk, programKey: proto.programKey || tk };
                if (!liveJudgeData.has(key)) liveJudgeData.set(key, new Map());
                liveJudgeData.get(key).set(jid, proto);
            }
            const cur = dressageStatusMap.get(key) || {};
            dressageStatusMap.set(key, { ...cur, ...st, state: st?.state || cur.state });
        });
        reprocessAndRenderAll();
    });
    liveUnsubs.set('dressageLiveGroup', unLiveGroup);
    // 4) Sparade protokoll (NU COLLECTION GROUP)
    // 4) Sparade protokoll (NU COLLECTION GROUP)
    const unProtoGroup = listenForDressageProtocolsCollectionGroup(competitionId, activeEquipages, (docs) => {
        // Gruppera docs efter startNumber
        const grouped = new Map();
        docs.forEach(d => {
            const sn = String(d.startNumber);
            if (sn && sn !== 'undefined' && sn !== 'null') {
                if (!grouped.has(sn)) grouped.set(sn, []);
                grouped.get(sn).push(d);
            }
        });

        // Uppdatera rawByStart
        rawByStart.clear();
        grouped.forEach((list, sn) => rawByStart.set(sn, list));
        queueRecompute(reprocessAndRenderAll);
    });
    liveUnsubs.set('dressageProtocolsGroup', unProtoGroup);
}

// === NY FUNKTION: Live-lyssnare för merge-konfig ===
let mergeUnsubs = [];

function listenMergeConfig(compId) {
    // Städa ev. gamla lyssnare
    if (Array.isArray(mergeUnsubs)) {
        mergeUnsubs.forEach(u => { try { u(); } catch { } });
    }
    mergeUnsubs = [];
    if (!compId || !appId) return;

    // Lyssna på ALLA möjliga config-platser
    const keys = ['display', 'tdbMergeGroups', 'classMergeMap', 'tdbMergeMap', 'dressyrClassConfig', 'dressageJudgeMapping'];

    keys.forEach(key => {
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'config', key); //
        const unsub = onSnapshot(ref, (snap) => { //
            const data = snap.exists() ? (snap.data()?.value ?? snap.data()) : null;

            if (key === 'display') {
                if (data?.mergeByClassNumber) dress_buildMergeMap(data);
                if (data?.useMergedTestForDisplay) { /* ... */ }
            } else if (key === 'tdbMergeGroups' || key === 'classMergeMap' || key === 'tdbMergeMap') {
                dress_buildMergeMap(data);
            } else if (key === 'dressyrClassConfig') {
                window.dressyrClassConfig = data || {};
            } else if (key === 'dressageJudgeMapping') {
                window.dressageJudgeMapping = data || {};
            }

            // Märk om alla ekipage
            masterEquipageList = masterEquipageList.map(e => ({ //
                ...e,
                _mergedKey: dress_resolveMergeGrouping(e).key,
                _mergedLabel: dress_resolveMergeGrouping(e).label
            }));

            // Trigga en full omräkning och omritning
            const fn = window.__dressageRecomputeAll;
            if (typeof fn === 'function') queueRecompute(fn);
            else render();

        }, (err) => {
            console.warn('[merge-config] snapshot error', key, err);
        });
        mergeUnsubs.push(unsub);
    });
}

// === Helper functions for robust data loading ===
function getStartNumber(e) {
    const n = Number(e?.startNumber ?? e?.startnummer ?? e?.startNr ?? e?.sn ?? e?.number ?? e?.no);
    if (Number.isFinite(n)) return n;

    const idNum = Number(e?.id);
    if (Number.isFinite(idNum)) return idNum;

    return null;
}

function isWithdrawnOrExcluded(state, eq) {
    const toStr = v => String(v || '').toLowerCase();
    const bad = new Set(['withdrawn', 'scratched', 'did-not-start', 'dns', 'retired', 'eliminated', 'excluded', 'ute', 'struken', 'strukit']);
    if (bad.has(toStr(state))) return true;

    const flags = [eq?.withdrawn, eq?.scratched, eq?.struken, eq?.didNotStart, eq?.dns, eq?.eliminated, eq?.excluded, eq?.retired];
    if (flags.some(v => v === true)) return true;

    const text = [eq?.status, eq?.eqStatus, eq?.dressageStatus, eq?.result, eq?.outcome, eq?.statusText, eq?.reason].map(toStr);
    return text.some(s => bad.has(s));
}

export async function load() {
    lastStructuralHash = null;
    lastHeaderHash = null;
    initializeDressyrScrollHelpers();
    injectDressageResultsBaseStyles();

    const competition = getGlobalState('currentCompetition');
    const pageEl = document.getElementById('page-dressyr-resultat') || document.getElementById('page-dressyr-results');
    if (!pageEl) return;
    if (!competition) {
        pageEl.innerHTML = `<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>`;
        return;
    }

    await ensureClubLogosLoaded(); //
    setSortFromURL(); //
    const competitionId = competition.id;

    try {
        // Reset global programs to prevent pollution from other pages (e.g. speaker view with partial config)
        // This allows us to load the clean static/config data fresh.
        window.dressagePrograms = null;

        // === STEG 1: Hämta all grunddata ===
        const [
            equipages,
            startCfg,
            progOverrides,
            displayCfg,
            mergeCfgA,
            mergeCfgB,
            mergeCfgC,
            dClassCfg,
            judges,
            mappingCfg
        ] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'startTimes').catch(() => null),
            getConfig(competitionId, 'dressagePrograms').catch(() => null),
            getConfig(competitionId, 'display').catch(() => ({})),
            getConfig(competitionId, 'tdbMergeGroups').catch(() => null), // <-- NY
            getConfig(competitionId, 'classMergeMap').catch(() => null),  // <-- NY
            getConfig(competitionId, 'tdbMergeMap').catch(() => null),    // <-- NY
            getConfig(competitionId, 'dressyrClassConfig').catch(() => null), // Clear Round config
            new Promise(resolve => listenForJudges(competitionId, resolve)),
            getConfig(competitionId, 'dressyrProgramMapping').catch(() => ({}))
        ]);

        // === STEG 2: Bearbeta grunddata ===
        // === STEG 2: Bearbeta grunddata ===
        // Safe merge of programs to avoid wiping out movements if override is partial
        const basePrograms = { ...dressagePrograms }; // Start with static
        const mergedProgs = { ...basePrograms };

        if (progOverrides && typeof progOverrides === 'object') {
            Object.keys(progOverrides).forEach(key => {
                const ovr = progOverrides[key];
                const base = basePrograms[key];
                if (base && ovr) {
                    // If override lacks movements, keep base movements
                    if ((!ovr.movements || !ovr.movements.length) && (base.movements && base.movements.length)) {
                        ovr.movements = base.movements;
                    }
                }
                mergedProgs[key] = ovr;
            });
        }

        // Explicitly set window property for dressageUtils to find it
        window.dressagePrograms = mergedProgs;
        // Also mutate the local import just in case, though window.dressagePrograms takes precedence in 'getPrograms()'
        Object.assign(dressagePrograms, mergedProgs);
        window.startTimes = (startCfg?.times) || (startCfg?.value?.times) || {};

        allCompetitionJudges = judges || []; //
        dressage_displayConfig = displayCfg || {};
        window.dressyrClassConfig = dClassCfg || {};
        window.klassProgramMapping = (mappingCfg && typeof mappingCfg === 'object') ? mappingCfg : {};

        // === NYTT: Bygg merge-map FÖRST ===
        dress_buildMergeMap(mergeCfgA || mergeCfgB || mergeCfgC || displayCfg); //

        masterEquipageList = (equipages || [])
            .map(e => {
                const sn = getStartNumber(e);
                return { ...e, startNumber: sn };
            })
            .filter(e => Number.isFinite(e.startNumber))
            .filter(e => !isWithdrawnOrExcluded(e.status, e))   // tar bort strukna/utelutna/DNS etc
            .map(e => {
                const eq = { ...e };
                const g = dress_resolveMergeGrouping(eq);
                eq._mergedKey = g.key;
                eq._mergedLabel = g.label;
                return eq;
            });

        // === STEG 3: Rita ut layouten ===
        let dressageDateStr = ''; // (Datum-logik är ok)
        // ...
        const dateCounts = {};
        if (window.startTimes) {
            Object.values(window.startTimes).forEach(timeEntry => {
                const dressageTime = timeEntry?.dressage || timeEntry?.dressyr || timeEntry?.start || timeEntry?.time;
                if (dressageTime && typeof dressageTime === 'string') {
                    const datePart = dressageTime.split('T')[0].split(' ')[0];
                    if (datePart) dateCounts[datePart] = (dateCounts[datePart] || 0) + 1;
                }
            });
        }
        let mostCommonDate = Object.keys(dateCounts).reduce((a, b) => dateCounts[a] > dateCounts[b] ? a : b, null);
        if (mostCommonDate) {
            dressageDateStr = new Date(mostCommonDate).toLocaleDateString('sv-SE', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        }

        pageEl.innerHTML = `
    <div class="max-w-8xl mx-auto px-2 sm:px-6 lg:px-8 py-3 md:py-6 min-h-screen dark:bg-gray-900 transition-colors duration-500">
      <div class="mb-2 md:mb-8">
                ${getCompetitionHeader(competition, t('dressage') + ' – ' + t('start_list_and_results'))}
        ${dressageDateStr ? `<h3 class="text-xs md:text-lg text-gray-500 dark:text-gray-400 mt-0.5 md:mt-1 font-medium text-center">${dressageDateStr}</h3>` : ''}
      </div>
      <div class="bg-white dark:bg-gray-800 p-2 md:p-3 rounded-lg md:rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-2 md:mb-4 flex flex-wrap gap-2 md:gap-3 items-center justify-start transition-colors" id="modeToggle">
        
        <!-- Sök -->
        <div class="relative w-full sm:w-48 flex-grow sm:flex-grow-0">
             <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                <svg class="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
             </div>
             <input type="text" id="inputDressageSearch" 
                class="block w-full pl-8 pr-3 py-1.5 md:py-2 text-xs md:text-sm border border-gray-300 dark:border-gray-600 rounded leading-5 bg-gray-50 dark:bg-gray-700 placeholder-gray-500 dark:placeholder-gray-400 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                placeholder="${t('search_placeholder_short')}"
              >
        </div>

        <!-- Desktop Controls -->
        <div class="hidden md:inline-flex shadow-sm rounded-md bg-gray-100 dark:bg-gray-700 p-1 flex-shrink-0">
            <button id="btnStartOrder" data-mode="startorder" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('start_order')}</button>
            <button id="btnByClass" data-mode="byclass" class="px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors">${t('view_by_class_short')}</button>
        </div>
        <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 hidden md:block mx-1"></div>
        <button id="toggleFinalized" class="hidden md:inline-flex px-3 py-1.5 text-xs md:text-sm font-medium rounded border transition-colors"></button>

        <!-- Mobile Controls (Klassvis / Startordning) -->
        <div class="md:hidden relative w-[110px] flex-shrink-0">
             <select id="mobileSortSelect" class="block w-full py-1.5 pl-2 pr-7 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs appearance-none">
                 <option value="byclass">${t('view_by_class_short')}</option>
                 <option value="startorder">${t('start_order')}</option>
             </select>
             <div class="pointer-events-none absolute right-0 top-0 bottom-0 flex items-center px-1.5 text-gray-500">
                 <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
             </div>
        </div>

        <!-- Class Filter Chips/Dropdown injected here -->
        <div id="dressageClassChips" class="flex-shrink-0 z-10 w-[130px] sm:w-auto"></div>

        <!-- Finaliserade Checkbox (Mobile) -->
        <label class="md:hidden flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer flex-shrink-0">
             <input type="checkbox" id="mobileFinalizedCheck" class="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5" />
             <span id="mobileFinalizedLabel">${t('show_finalized_only') || 'Klara'}</span>
        </label>

        <!-- Spacer to push export buttons right if space permits -->
        <div class="flex-grow hidden sm:block"></div>

        <!-- Export Buttons -->
        <div class="flex-shrink-0 flex items-center gap-2 lg:ml-auto w-full sm:w-auto justify-end border-t border-gray-100 sm:border-0 pt-2 sm:pt-0 dark:border-gray-700">
            <button id="btnExportDressageCsv" 
              class="inline-flex items-center px-2 md:px-3 py-1 md:py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-[11px] md:text-sm font-medium rounded text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors">
               <i class="fas fa-file-csv mr-1.5 text-gray-500 dark:text-gray-400"></i>
               CSV
            </button>
            <button id="btnPrintResultsList" 
              class="inline-flex items-center px-2 md:px-3 py-1 md:py-1.5 border border-transparent shadow-sm text-[11px] md:text-sm font-medium rounded text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors">
              <svg class="mr-1.5 h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
               Skriv ut PDF
            </button>
        </div>
      </div>

      <div id="liveUpdateTicker" aria-live="polite"></div>
      <div id="resultsContainer" class="rounded-lg shadow ring-1 ring-black/5 dark:ring-white/10 dark:bg-gray-800"></div>
      `;

        // === STEG 4: Koppla alla lyssnare ===
        setupDressageModalOnce();  //
        ensureModeToggle(); //
        ensureSearchBox(); //

        // PDF-knapp
        // PDF-knapp
        const pbtn = document.getElementById('btnPrintResultsList');
        if (pbtn) {
            pbtn.addEventListener('click', async () => {
                const origText = pbtn.innerHTML;
                pbtn.disabled = true;
                pbtn.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" ...>...</svg>${t('generating_pdf')}`; // Simplified spinner, ideally copy from other button
                // Use getVisibleSortedResults() if available in scope or processedResults
                // getVisibleSortedResults() is defined in this file (dressyr-resultat.js).
                // It returns the currently visible list.
                const list = getVisibleSortedResults();
                const currentClass = dressage_activeClassFilters.size > 0 ? Array.from(dressage_activeClassFilters).join(', ') : 'Alla';
                const comp = getGlobalState('currentCompetition');
                const judges = window.__dressageCurrentJudgesPresentRef || [];
                try {
                    await generateDressageListPdf(list, currentClass, comp, judges);
                } catch (e) {
                    console.error(e);
                    alert('Fel vid PDF-generering: ' + e.message);
                } finally {
                    pbtn.innerHTML = origText;
                    pbtn.disabled = false;
                }
            });
        }

        const btnCsv = document.getElementById('btnExportDressageCsv');
        if (btnCsv) {
            btnCsv.addEventListener('click', () => {
                const comp = getGlobalState('currentCompetition');
                const date = new Date().toISOString().split('T')[0];
                const filename = `dressyr_resultat_${sanitizeForFilename(comp?.name || 'tavling')}_${date}.csv`;

                const list = getVisibleSortedResults();
                const judges = window.__dressageCurrentJudgesPresentRef || [];

                const headers = [
                    t('rank'), t('startno'), t('driver'), t('horse'), t('class'), t('club'), t('start_time')
                ];

                // Judge headers
                judges.forEach(j => {
                    const pos = (j.position || j.id).toUpperCase();
                    headers.push(`${pos} %`, `${pos} ${t('penalty')}`);
                });

                headers.push(t('dressage_avg_percent'), t('mistakes'), t('total_penalty'), t('status'));

                const rows = list.map(res => {
                    const row = [
                        res.plac || '—',
                        String(res.startNumber),
                        res.driverName || '—',
                        getMomentHorseLabel(res, 'dressage'),
                        res._mergedLabel || res.className || '—',
                        res.clubName || '—',
                        res.startTime ? formatStartTimeLabel(res.startTime) : '—'
                    ];

                    judges.forEach(j => {
                        const jp = res.judges[j.id];
                        if (jp) {
                            row.push(
                                isNum(jp.percent) ? jp.percent.toFixed(2) : '—',
                                isNum(jp.penalty) ? jp.penalty.toFixed(1) : '—'
                            );
                        } else {
                            row.push('—', '—');
                        }
                    });

                    row.push(
                        isNum(res.avgPercent) ? res.avgPercent.toFixed(2) : '—',
                        isNum(res.errorPoints) ? res.errorPoints.toFixed(1) : '0.0',
                        isNum(res.finalPenalty) ? res.finalPenalty.toFixed(2) : '—',
                        res.eliminated ? 'ELIM' : (statusBadgeForDressage(res.startNumber).replace(/<[^>]*>/g, '').trim() || '—')
                    );
                    return row;
                });

                downloadCsv(filename, headers, rows);
            });
        }

        // Resize-lyssnare
        document.body.dataset.wasMobile = isMobile() ? '1' : '0'; //
        if (window.__dressyrResizeHandler) { //
            try { window.removeEventListener('resize', window.__dressyrResizeHandler); } catch { } //
        }
        window.__dressyrResizeHandler = () => { //
            const now = isMobile() ? '1' : '0'; //
            if (document.body.dataset.wasMobile !== now) {
                document.body.dataset.wasMobile = now;
                render(); //
            }
        };
        window.addEventListener('resize', window.__dressyrResizeHandler, { passive: true }); //

        // === STEG 5: Starta live-lyssnarna ===
        // setupLive() kommer nu att hämta initial data OCH starta lyssnare
        setupLive(competitionId, masterEquipageList); // 

        // === STEG 6: Kör FÖRSTA render() ===
        // (render() kommer att anropas automatiskt inuti setupLive() när första datan är hämtad)
        // render(); // Behövs inte här längre

    } catch (err) {
        console.error('Fel vid laddning av dressyrresultat:', err);
        const c = document.getElementById('resultsContainer');
        if (c) c.innerHTML = `<p class="p-8 text-center text-red-500">Ett fel uppstod: ${escapeHtml(err.message)}</p>`;
    }
}


export function mountDressyrResults() { return load(); }
export function mountDressyrResultat() { return load(); }
export default { load };

export function __unload() {


    // 1) Stäng av alla aktiva lyssnare
    try { liveUnsubs.forEach(u => u()); } catch { } //
    liveUnsubs.clear(); //
    if (Array.isArray(mergeUnsubs)) { mergeUnsubs.forEach(u => { try { u(); } catch { } }); mergeUnsubs = []; }

    // 2) Ta bort resize/keydown-lyssnare
    if (window.__dressyrResizeHandler) { //
        try { window.removeEventListener('resize', window.__dressyrResizeHandler); } catch { }
        window.__dressyrResizeHandler = null;
    }
    if (window.__dressyrKeydownHandler) { //
        try { document.removeEventListener('keydown', window.__dressyrKeydownHandler); } catch { }
        window.__dressyrKeydownHandler = null;
    }

    // 3) Ta bort DOM-element
    try { document.getElementById('dressageDetailsModal')?.remove(); } catch { }
    try { document.getElementById('dressageModalBaseStyle')?.remove(); } catch { }
    try { document.getElementById('dressageResultsBaseStyles')?.remove(); } catch (e) { }

    // 4) Teardown fast x-scrollbar (NYA STANDARDEN)
    try { window.__teardownXbarSync?.(); } catch { }
    document.body.classList.remove('has-pr-xbar'); //

    // 5) Nollställ state
    processedResults = []; //
    allCompetitionJudges = []; //
    masterEquipageList = []; //
    currentJudgesPresent = []; //
    rawByStart.clear(); //
    dressageStatusMap.clear(); //
    liveJudgeData.clear(); //
    searchQuery = ''; //
    showOnlyFinalized = false; //
    viewMode = 'byclass'; //
    sortState = { key: 'plac', dir: 'asc' }; //

    dressage_displayConfig = {}; //
    dressage_activeClassFilters.clear(); //
    dressage_MERGE_GROUPS = []; //
    dressage_MERGE_MAP.clear(); //

    // 6) Nollställ globala scroll-helpers (NYA STANDARDEN)
    window.__teardownXbarSync = undefined;
    window.__setupXbarSync = undefined;


}



(function clearGlobalScrollLocks() {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;
    body.classList.remove('no-scroll', 'modal-open');
    html.classList.remove('no-scroll', 'modal-open');
    ['overflow', 'overflowY', 'position', 'height', 'top', 'width'].forEach(k => {
        html.style[k] = '';
        body.style[k] = '';
    });
})();

(function () {
    window.dressageResult = window.dressageResult || {};
    let extProviders = null;

    window.dressageResult.injectProviders = function (p) { extProviders = p || null; };

    // Sen, i din egen open-funktion:
    // const prov = extProviders || byggEgnaProviders();
    // const saved = prov.getSavedProtocols(sn); const program = prov.getProgramForEq(sn); osv.
})();

// --- GLOBAL DATA GETTER FÖR MONITORN ---
(function ensureDressageResultGetters() {
    window.dressageResult = window.dressageResult || {};

    // Returnerar slutvärden för ett startnummer:
    // { percent, points, penalty, updatedAt } eller null om ej tillgängligt.
    window.dressageResult.getFinalFor = async function (competitionId, sn) {
        try {
            sn = String(sn);
            // 1) Om resultat-sidan redan har cache/state – använd den
            const s = (window.dressageResultState && window.dressageResultState.statusMap)
                ? window.dressageResultState.statusMap.get(sn)
                : null;

            const pick = (data) => {
                if (!data) return null;
                const percent = Number(
                    data?.finalJudgeScore?.percent ?? data?.finalPercent ?? data?.totalPercent
                );
                const points = Number(
                    data?.finalJudgeScore?.points ?? data?.finalPoints ?? data?.totalPoints
                );
                const penalty = Number(
                    data?.finalJudgeScore?.penalty ?? data?.finalPenalty ?? data?.totalPenalty
                );
                const any =
                    Number.isFinite(percent) || Number.isFinite(points) || Number.isFinite(penalty);
                if (!any) return null;
                return {
                    percent: Number.isFinite(percent) ? percent : null,
                    points: Number.isFinite(points) ? points : null,
                    penalty: Number.isFinite(penalty) ? penalty : null,
                    updatedAt: (data?.updatedAt ? new Date(data.updatedAt).getTime() : Date.now())
                };
            };

            // 2) Försök från intern cache
            const fromCache = pick(s);
            if (fromCache) return fromCache;

            // 3) Fallback: hämta statusdokumentet direkt (samma path som ni använder)
            if (window.db && window.appId) {
                const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
                const ref = doc(window.db, 'artifacts', window.appId, 'public', 'data',
                    'competitions', competitionId, 'dressageStatus', sn);
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    const data = snap.data();
                    const picked = pick(data);
                    if (picked) return picked;
                }
            }

            return null;
        } catch (e) {
            console.warn('[dressageResult.getFinalFor] failed', e);
            return null;
        }
    };
})();

// Global brygga (kompatibel med både monitor och resultat)
(function exposeBridge() {
    const openProto = (competitionId, sn, opts = {}) => {
        try { if (competitionId) window.currentCompetitionId = competitionId; } catch { }

        // Hämta referenser från sidan
        const pr = window.__dressageProcessedResultsRef || [];
        const jp = window.__dressageCurrentJudgesPresentRef || [];

        // ANVÄND OBJEKT-SYNTAX HÄR:
        // ANVÄND OBJEKT-SYNTAX HÄR:
        const safeJudges = (allCompetitionJudges || []).map(j => ({
            ...j,
            position: (expandDressagePosition(j) || j.position || '').toUpperCase()
        }));
        const rawList = rawByStart.get(String(sn)) || [];
        const cleanList = deduplicateAndFilterProtocols(rawList, safeJudges);
        const tempMap = new Map([[String(sn), cleanList]]);
        return openDetailsModal(String(sn), {
            // processedResults: pr, // SKIPPA PROCESSED RESULTS
            savedProtocolsMap: tempMap,
            equipages: masterEquipageList,
            statusMap: dressageStatusMap,
            currentJudges: (jp && jp.length) ? jp : null,
            ...opts
        });
    };

    window.dressageResult = window.dressageResult || {};
    window.dressageResult.openProtocolModal = openProto;
    window.openDressageProtocolModal = openProto;
    window.showDressageResultModal = openProto;
})();
