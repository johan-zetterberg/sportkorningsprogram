// starttider.js — Korrigerad och rensad version

import {
    getEquipages,
    getConfig,
    saveConfig,
    listenForDressageProtocolsCollectionGroup,
    listenForPrecisionResults,
    getMarathonTimingData,
    getMarathonStateDocuments,
    getMarathonResults,
    listenForMaratonCollection,
    listenForDressageFinalizationCollection,
    listenForDressageStatusCollection,
    listenForMarathonTimingUpdates,
} from '../services/firestoreService.js';
import { generateStartListPdf } from '../pdf/startListPdf.js';
import { getGlobalState } from '../main.js';
import { getCurrentUserRole } from '../services/authService.js';
import { getCompetitionHeader, showAlert } from '../ui/components.js';
import { dressagePrograms } from '../data/dressagePrograms.js';
import { getFlagHtml, } from '../services/flagsService.js';
import {
    ensureClubLogosLoaded,
    getClubLogoHtml
} from '../services/logosService.js';
import {
    debounce,
    downloadCsv,
    csvCell,
    resolveCurrentCompId,
    normalizeEquipage,
    sanitizeForFilename
} from '../utils/sharedUtils.js';
import { doc, getDoc, onSnapshot, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';

import { injectScrollStyles, initializeScrollSync } from '../ui/scrollHelper.js';
import { getPrograms, deduplicateAndFilterProtocols } from '../utils/dressageUtils.js';
import { calculateDressageResult, calculateMarathonResult } from '../services/calculationService.js';
import { setMarathonConfig } from '../utils/marathonUtils.js';
import { calculateTotalCompetitionPenalties } from '../utils/sharedUtils.js';
import { t } from '../utils/i18n.js';

// ======= Modulstat =======
let competitionId = null;
let equipages = [];
let startTimes = {};
let unsubscribers = new Map();
let precisionResultsMap = new Map();
let marathonMap = new Map();
let marathonStatusMap = marathonMap;
let marathonTimingMap = marathonMap;
let marathonResultsMap = marathonMap;
let marathonObstacleTouch = 0;
let dressageStatusMap = new Map();
let dressageFinalizationMap = new Map();
let publicMode = false;
let sortConfig = { key: 'startNumber', direction: 'asc' };
let clockTimer = null;
let currentUserRole = 'publik';
let viewMode = 'startorder'; // 'startorder' eller 'byclass'
let searchTerm = '';

const MOBILE_BP = 768; // Behålls ifall någon CSS skulle behöva den, men isMobile() använder den inte
const isMobile = () => window.matchMedia("(orientation: portrait)").matches;

// --- refs för att kunna ta bort lyssnare på unload ---
window.__starttiderResizeHandler = window.__starttiderResizeHandler || null;

// === NYTT: State-variabler och funktioner för sammanslagning ===
let starttider_displayConfig = {};
let starttider_MERGE_MAP = new Map();

// Bygger den interna kartan över vilka TDB-nummer som tillhör vilken grupp
function starttider_buildMergeMap(raw) {
    starttider_MERGE_MAP.clear();
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
            members.forEach(num => starttider_MERGE_MAP.set(num, { key, label }));
        }
    }
}

// Slår upp ETT ekipage och returnerar dess merge-key och label
function starttider_resolveMergeGrouping(e) {
    // 1) Per-ekipage flagga (från TDB-test merge i admin)
    if (e?.useMergedTestForDisplay && e?.mergedTestKey && e?.mergedTestLabel) {
        return { key: String(e.mergedTestKey), label: String(e.mergedTestLabel) };
    }
    // 2) Global TDB-nummer merge (från config)
    const num = Number(e?.tdbClassNumber);
    const hit = Number.isFinite(num) ? starttider_MERGE_MAP.get(num) : null;

    // Returnera merge-grupp om den finns, annars default klass
    if (hit) return { key: String(hit.key), label: String(hit.label) };
    return { key: String(e?.classId || e?.className || 'okand'), label: String(e?.className || 'Okänd klass') };
}

function horseLabel(eq) {
    if (!eq) return '—';
    const names = Array.isArray(eq.horses)
        ? eq.horses.map(h => h?.name).filter(Boolean)
        : [];
    return names.length ? names.join(' & ') : '—';
}

// Returnerar en sorterad lista av ekipage
function getSortedEquipages() {
    let list = [...equipages];

    if (searchTerm) {
        let termStr = searchTerm.toLowerCase();
        list = list.filter(e => {
            return (
                (e.startNumber && String(e.startNumber).includes(termStr)) ||
                (e.driverName && e.driverName.toLowerCase().includes(termStr)) ||
                (e.clubName && e.clubName.toLowerCase().includes(termStr)) ||
                (horseLabel(e).toLowerCase().includes(termStr)) ||
                ((e._mergedLabel || e.className || '').toLowerCase().includes(termStr))
            );
        });
    }

    list.sort((a, b) => {
        // === ÄNDRING: Använd _mergedLabel för klass-sortering ===
        if (viewMode === 'byclass') {
            const classA = a._mergedLabel || a.className || '';
            const classB = b._mergedLabel || b.className || '';
            const classCompare = classA.localeCompare(classB, 'sv');
            if (classCompare !== 0) return classCompare;
        }
        // === SLUT ÄNDRING ===

        const key = sortConfig.key;
        const dir = sortConfig.direction === 'asc' ? 1 : -1;
        let valA, valB;

        if (['dressage', 'marathon', 'precision'].includes(key)) {
            // ... (logiken för tidssortering är ok) ...
            const dateA = parseDateTime(startTimes[String(a.startNumber)]?.[key]);
            const dateB = parseDateTime(startTimes[String(b.startNumber)]?.[key]);
            valA = dateA ? dateA.getTime() : Infinity;
            valB = dateB ? dateB.getTime() : Infinity;
        } else if (key === 'className') {
            // === ÄNDRING: Använd _mergedLabel när nyckeln är 'className' ===
            valA = a._mergedLabel || a.className || '';
            valB = b._mergedLabel || b.className || '';
        } else {
            valA = a[key] ?? '';
            valB = b[key] ?? '';
        }

        if (valA === Infinity) return 1 * dir;
        if (valB === Infinity) return -1 * dir;
        if (typeof valA === 'number' && typeof valB === 'number') return (valA - valB) * dir;
        return String(valA).localeCompare(String(valB), 'sv', { numeric: true }) * dir;
    });

    return list;
}

// Helper: Generera PDF
async function generatePdfWrapper(type) {
    const comp = getGlobalState('currentCompetition');
    if (!type || !comp) return;

    // Prepare list with start times
    let list = getSortedEquipages().map(e => {
        const sn = String(e.startNumber);
        const st = startTimes[sn] || {};
        const timeStr = st[type] || null;
        return { ...e, startTime: timeStr };
    });

    // Re-sort based on the new start time
    list.sort((a, b) => {
        const tA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const tB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        if (tA !== tB) return tA - tB;
        return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
    });

    try {
        await generateStartListPdf(list, type, comp, { viewMode: viewMode });
    } catch (err) {
        console.error(err);
        alert('Ett fel uppstod vid PDF-generering: ' + err.message);
    }
}

// Helper: Generera CSV
function generateCsvWrapper() {
    const comp = getGlobalState('currentCompetition');
    const date = new Date().toISOString().split('T')[0];
    const filename = `starttider_${sanitizeForFilename(comp?.name || 'tavling')}_${date}.csv`;

    const list = getSortedEquipages();
    const headers = ['Nr', 'Kusk', 'Häst', 'Klass', 'Klubb', 'Start Dressyr', 'Start Maraton', 'Start Precision'];
    const rows = list.map(e => {
        const sn = String(e.startNumber);
        const st = startTimes[sn] || {};
        const f = (val) => {
            if (!val) return '—';
            const obj = parseDateTime(val);
            return formatDateTime(obj);
        };
        return [
            sn, e.driverName || '—', horseLabel(e), e._mergedLabel || e.className || '—', e.clubName || '—',
            f(st.dressage), f(st.marathon), f(st.precision)
        ];
    });
    downloadCsv(filename, headers, rows);
}


function byStartNumberAsc(a, b) { return (a.startNumber || 0) - (b.startNumber || 0); }

function toDateTimeLocalString(date) {
    if (!date || isNaN(date.getTime())) return '';
    const pad = (num) => num.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTime(dateTimeStr) {
    if (!dateTimeStr || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTimeStr)) {
        return null;
    }
    return new Date(dateTimeStr);
}

function formatDateTime(date) {
    if (!date || isNaN(date.getTime())) return '—';
    return date.toLocaleString('sv-SE', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function updateNextStartTimes() {
    const intervalInput = document.getElementById('bulkInterval');
    if (!intervalInput) return;

    const intervalMin = Math.max(1, Number(intervalInput.value || 7));

    ['dressage', 'marathon', 'precision'].forEach(discipline => {
        const cap = discipline[0].toUpperCase() + discipline.slice(1);
        const displayElement = document.getElementById(`nextTime${cap}`);
        if (!displayElement) return;

        const existingTimes = Object.values(startTimes)
            .map(t => parseDateTime(t[discipline]))
            .filter(Boolean)
            .sort((a, b) => a - b);

        if (existingTimes.length === 0) {
            displayElement.textContent = t('unknown_time');
            return;
        }

        const latestTime = existingTimes[existingTimes.length - 1];
        const nextTimestamp = latestTime.getTime() + (intervalMin * 60 * 1000);
        const nextDate = new Date(nextTimestamp);
        displayElement.textContent = `${t('next_time_prefix')}${formatDateTime(nextDate)}`;
    });
}

function statusBadge(kind, sn) {
    let state = 'not-started';

    if (kind === 'dressage') {
        const st = dressageStatusMap.get(String(sn));
        const fin = dressageFinalizationMap.get(String(sn)); // Ny check för finaliserad

        if (fin && fin.finalized) {
            state = 'done';
        } else if (st && st.state === 'finished') {
            // Fallback: om ritten är klar men inte signerad än, visa som klar? 
            // Eller vill vi skilja på "Klar" (grön) och "Riden" (kanske också grön)?
            // Hittills har 'finished' betytt grön. Vi behåller det, men finaliserad är definit.
            state = 'done';
        }
        else if (st && st.state === 'ongoing') state = 'running';
    }

    if (kind === 'precision') {
        const res = precisionResultsMap.get(String(sn));
        if (res) {
            if (res.finalized) state = 'done';
            else if (res.running) state = 'running';
            // Fallback om gamla data saknar flaggor men har resultat
            else if (res.time || res.obstaclePenalty != null || res.timePenalty != null || res.eliminated) state = 'done';
        }
    }

    if (kind === 'marathon') {
        const mStatus = marathonStatusMap.get(String(sn));
        // 1. Prioritera finaliserad status
        if (mStatus && mStatus.finalized) {
            state = 'done';
        }
        // 2. Annars kolla om det pågår (running flagga eller startad tid utan mål)
        else if (mStatus && (mStatus.running || (mStatus.start_A && !mStatus.finish_B))) {
            state = 'running';
        }
        // 3. Fallback: kolla timing-data om ingen status-flagga finns
        else {
            const t = marathonTimingMap.get(String(sn));
            if (t && (t.duration_B || t.finishTime || t.netTimeSeconds)) state = 'done';
            // OBS: Vi tar bort marathonObstacleTouch > 0 som indikator för "running", 
            // då det är globalt och inte per ekipage.
        }
    }

    const base = 'inline-flex items-center px-2 py-1 rounded text-[11px] font-medium';
    if (state === 'done') return `<span class="${base} bg-green-100 text-green-800">${t('done_status')}</span>`;
    if (state === 'running') return `<span class="${base} bg-yellow-100 text-yellow-800">${t('running_status')}</span>`;
    return `<span class="${base} bg-gray-100 text-gray-700">${t('not_started')}</span>`;
}

let liveStatus = {
    current: null,
    next: null
};

function updateLiveStatus() {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const allStarts = [];
    for (const sn in startTimes) {
        for (const discipline of ['dressage', 'marathon', 'precision']) {
            const dateObj = parseDateTime(startTimes[sn][discipline]);
            if (dateObj) {
                allStarts.push({ sn: Number(sn), discipline, dateObj });
            }
        }
    }

    allStarts.sort((a, b) => a.dateObj - b.dateObj);

    const nextStart = allStarts.find(start => start.dateObj > now);
    const currentStart = allStarts.find(start => start.dateObj >= fiveMinutesAgo && start.dateObj <= now);

    liveStatus.current = currentStart ? { sn: currentStart.sn, discipline: currentStart.discipline } : null;
    liveStatus.next = nextStart ? { sn: nextStart.sn, discipline: nextStart.discipline } : null;
}

function chipNowNext(discipline, sn) {
    const base = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium';
    if (liveStatus.current && liveStatus.current.sn === sn && liveStatus.current.discipline === discipline) {
        return `<span class="${base} bg-red-100 text-red-700">${t('now_chip')}</span>`;
    }
    if (liveStatus.next && liveStatus.next.sn === sn && liveStatus.next.discipline === discipline) {
        return `<span class="${base} bg-blue-100 text-blue-700">${t('next_chip')}</span>`;
    }
    return '';
}

function timeCell(key, sn, value, editable) {
    const id = `${key}-${sn}`;
    const badges = `${chipNowNext(key, sn)} <span class="ml-1">${statusBadge(key, sn)}</span>`;
    const dateObj = parseDateTime(value);
    const displayValue = formatDateTime(dateObj);

    if (!editable || publicMode) {
        return `<div class="flex flex-col gap-1 text-gray-900 dark:text-gray-200">${displayValue}<div class="flex items-center gap-1">${badges}</div></div>`;
    }

    const inputValue = value || '';

    return `
    <div class="flex flex-col gap-1">
      <input id="${id}" type="datetime-local" class="w-36 px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500" value="${inputValue}">
      <div class="flex items-center gap-1">${badges}</div>
    </div>`;
}


// ======= Drag-and-Drop Helpers =======
let draggedStartNumber = null;

function handleDragStart(e) {
    console.log("DnD: Drag Start.", e.target);
    draggedStartNumber = e.target.closest('tr').dataset.sn;
    e.dataTransfer.effectAllowed = 'move';
    e.target.closest('tr').classList.add('opacity-50');
}

function handleDragEnd(e) {
    e.target.closest('tr').classList.remove('opacity-50');
    document.querySelectorAll('tr.drag-over').forEach(row => row.classList.remove('drag-over', 'bg-blue-50'));
}

function handleDragOver(e) {
    e.preventDefault();
    const row = e.target.closest('tr');
    if (row && row.dataset.sn && row.dataset.sn !== draggedStartNumber) {
        row.classList.add('drag-over', 'bg-blue-50');
        e.dataTransfer.dropEffect = 'move';
    }
}

function handleDragLeave(e) {
    const row = e.target.closest('tr');
    if (row) row.classList.remove('drag-over', 'bg-blue-50');
}

function handleDrop(e) {
    e.preventDefault();
    const targetRow = e.target.closest('tr');
    if (!targetRow || !draggedStartNumber) return;

    const targetSn = targetRow.dataset.sn;
    if (targetSn === draggedStartNumber) return;

    reorderRow(draggedStartNumber, targetSn);
}

/* function reorderRow_deprecated(droppedSn, targetSn) {
    // 1. Get current sorted list
    const list = getSortedEquipages();
    const fromIndex = list.findIndex(e => String(e.startNumber) === String(droppedSn));
    const toIndex = list.findIndex(e => String(e.startNumber) === String(targetSn));

    if (fromIndex === -1 || toIndex === -1) return;

    // 2. Move item in array
    const item = list.splice(fromIndex, 1)[0];
    list.splice(toIndex, 0, item);

    // 3. Recalculate times for ALL disciplines
    // We must find the "earliest" index changed to minimize recalc, which is min(from, to)
    const recalcIndex = Math.min(fromIndex, toIndex);

    ['dressage', 'marathon', 'precision'].forEach(discipline => {
        recalculateTimesFrom(list, discipline, recalcIndex);
    });

    render();
    updateNextStartTimes();
} */


function reorderRow(droppedSn, targetSn) {
    // 1. Check valid sort configuration for DnD
    const allowedSortKeys = ['dressage', 'marathon', 'precision'];
    if (!allowedSortKeys.includes(sortConfig.key)) {
        showAlert(t('dnd_disabled'), 'warning');
        return;
    }

    const discipline = sortConfig.key;

    // 2. Get current sorted list
    const list = getSortedEquipages();
    const fromIndex = list.findIndex(e => String(e.startNumber) === String(droppedSn));
    const toIndex = list.findIndex(e => String(e.startNumber) === String(targetSn));

    if (fromIndex === -1 || toIndex === -1) return;

    // 3. CAPTURE TIME of the slot we are disturbing.
    // We want the new occupant of the 'recalcIndex' slot to inherit its time,
    // so the schedule stays anchored at that point.
    const recalcIndex = Math.min(fromIndex, toIndex);
    const snAtRecalcIndex = String(list[recalcIndex].startNumber);
    const preservedTime = startTimes[snAtRecalcIndex]?.[discipline];

    // 4. Move item in array to reflect the new desired order
    const item = list.splice(fromIndex, 1)[0];
    list.splice(toIndex, 0, item);

    // 5. Apply preserved time to the new occupant of the slot
    if (preservedTime) {
        const newSnAtRecalcIndex = String(list[recalcIndex].startNumber);
        if (!startTimes[newSnAtRecalcIndex]) startTimes[newSnAtRecalcIndex] = {};
        startTimes[newSnAtRecalcIndex][discipline] = preservedTime;
    }

    // 6. Recalculate times ONLY for the specific discipline from this point onward
    recalculateTimesFrom(list, discipline, recalcIndex);

    render();
    updateNextStartTimes();
}


// ======= Rendering =======
function renderLayout() {
    const competition = getGlobalState('currentCompetition');
    const page = document.getElementById('page-starttider');

    // Inject DnD Styles
    const styleId = 'starttider-dnd-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .draggable-row { cursor: grab; }
            .draggable-row:active { cursor: grabbing; }
            .drag-over { border-top: 2px solid #3b82f6; } /* Blue line indication */
        `;
        document.head.appendChild(style);
    }

    page.innerHTML = `
    <div class="container mx-auto p-4 md:p-8">
        ${getCompetitionHeader(competition, t('startlist_live_title'))}
        
        <div class="${publicMode ? 'text-[15px]' : ''}">
          <div class="flex flex-col md:flex-row gap-2 mb-4 justify-between items-center w-full">
             <div id="controlsContainer" class="w-full"></div>
             
             <!-- Public Search & View Filters -->
             <div class="flex flex-wrap items-center gap-2 w-full lg:w-auto mt-2 lg:mt-0 p-2 lg:p-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
                  <div class="search-input-wrap flex-1 min-w-[200px] relative">
                      <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10 text-xs"></i>
                      <input id="startlistSearch" type="search" placeholder="${t('search') || 'Sök ekipage...'}" class="w-full pl-8 pr-3 py-1.5 border rounded leading-5 dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 shadow-sm text-xs" autocomplete="off">
                  </div>
                      
                  <select id="publicViewModeSelect" class="border rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 shadow-sm focus:ring-1 focus:ring-blue-500">
                      <option value="startorder">Startordning</option>
                      <option value="byclass">Per klass</option>
                  </select>
             </div>
          </div>

          <div id="startlist-container">
            <div class="rounded-lg shadow ring-1 ring-black/5">
              <div id="starttider-x-wrap" class="overflow-x-auto">
                <table id="startlist-table" class="min-w-full divide-y divide-gray-200">
                  </table>
              </div>
            </div>
          </div>

        </div>
    </div>
    `;
}

// Hjälpfunktion för att avgöra om ett ekipage är eliminerat/ofullständigt
function isEliminatedOrIncomplete(e) {
    if (e.status === 'struken') return true;

    const sn = String(e.startNumber);
    const rawProtocols = window.__dressageCache?.get(sn);
    const protocols = rawProtocols ? Array.from(rawProtocols.values()) : [];
    const validProtos = deduplicateAndFilterProtocols(protocols, []);
    const dRes = calculateDressageResult(e, validProtos, [], getPrograms());
    if (dRes?.eliminated) return true;

    const mData = marathonMap.get(sn) || {};
    const mRes = calculateMarathonResult(e, mData, mData);
    if (mRes?.eliminated || mData.eliminated || mData.status === 'Eliminerad' || mData.status === 'elim' || mData.status === 'ELIM') return true;

    const pRes = precisionResultsMap.get(sn);
    if (pRes?.eliminated) return true;

    return false;
}

// ======= Rendering =======
function render() {
    if (isMobile()) {
        try { window.__teardownXbarSync?.(); } catch { }
        renderMobile();
    } else {
        renderDesktop();
    }
}

function renderDesktop() {
    const container = document.getElementById('startlist-container');
    if (!container) return;

    container.innerHTML = `
      <div class="rounded-lg shadow ring-1 ring-black/5 dark:ring-white/10">
        <div id="starttider-x-wrap" class="x-scroll-wrap">
          <table id="startlist-table" class="min-w-full divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
            </table>
        </div>
      </div>`;

    const table = container.querySelector('#startlist-table');
    if (!table) return;

    const isEditable = !publicMode && currentUserRole === 'admin';
    const sortedEquipages = getSortedEquipages();

    // Enable DnD only if editable AND sorted by a specific time discipline
    const timeSortKeys = ['dressage', 'marathon', 'precision'];
    const enableDnD = isEditable && viewMode === 'startorder' && timeSortKeys.includes(sortConfig.key);

    const renderEquipageRow = (e, index, totalEquipages) => {
        const st = startTimes[String(e.startNumber)] || {};
        const isPub = startTimes.published || {};

        // Helper to check if time should be shown
        const getVisibleTime = (discipline, timeVal) => {
            if (isEditable) return timeCell(discipline, e.startNumber, timeVal, true); // Admin editor mode -> always show input

            // Public viewing mode (or admin previewing public)
            // If not published AND not admin (wait, publicMode toggle implies we simulate public view even for admin)
            // Actually, if publicMode is ON, we act as public.
            // If publicMode is OFF, we are admin (and isEditable is true, so we hit the line above).
            // So if we are here, isEditable is false.
            if (!isPub[discipline]) {
                return '<span class="text-xs text-gray-400 italic">Ej publicerad</span>';
            }
            return timeCell(discipline, e.startNumber, timeVal, false);
        };

        const disciplineStyles = {
            dressage: { label: 'D', color: 'bg-slate-100', text: 'text-slate-700' },
            marathon: { label: 'M', color: 'bg-emerald-100', text: 'text-emerald-700' },
            precision: { label: 'P', color: 'bg-indigo-100', text: 'text-indigo-700' }
        };

        const actionButtons = (discipline) => {
            const style = disciplineStyles[discipline];
            return `
            <div class="flex items-center justify-between w-full gap-1 py-1 pl-2 pr-1 rounded-full ${style.color}">
                <span class="font-bold text-xs ${style.text} w-4 text-left">${style.label}</span>
                <div class="flex items-center gap-1">
                    <button class="action-btn text-gray-600 hover:text-blue-600" data-action="pause" data-discipline="${discipline}" data-sn="${e.startNumber}" title="${t('pause_btn')}">☕</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${index === 0 ? 'opacity-25' : ''}" data-action="move" data-discipline="${discipline}" data-dir="up" data-sn="${e.startNumber}" title="${t('move_up')}">▲</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${index === totalEquipages - 1 ? 'opacity-25' : ''}" data-action="move" data-discipline="${discipline}" data-dir="down" data-sn="${e.startNumber}" title="${t('move_down')}">▼</button>
                </div>
            </div>`;
        };

        const isElim = isEliminatedOrIncomplete(e);
        const elimClass = isElim ? 'bg-red-50 dark:bg-red-900/20' : '';
        const hoverEffects = publicMode ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : '';

        const dragAttrs = enableDnD
            ? `draggable="true" class="draggable-row align-top ${elimClass || hoverEffects} border-b dark:border-gray-700 last:border-0" data-sn="${e.startNumber}"`
            : `class="align-top ${elimClass || hoverEffects} border-b dark:border-gray-700 last:border-0"`;

        const grabHandle = enableDnD
            ? `<div class="cursor-grab text-gray-400 hover:text-gray-600 mr-2" title="Dra för att flytta">⋮⋮</div>`
            : '';

        return `
            <tr ${dragAttrs}>
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 text-center select-none align-middle whitespace-nowrap">
                    <div class="flex items-center justify-center font-bold text-gray-900 dark:text-white">
                        ${grabHandle}
                        ${e.startNumber ?? ''}
                    </div>
                </td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm min-w-0 align-middle">
                  <div class="font-medium text-gray-900 dark:text-white whitespace-nowrap truncate max-w-[140px] md:max-w-none" title="${e.driverName || ''}">${e.driverName || ''}</div>
                  <div class="text-[10px] lg:text-xs text-gray-600 dark:text-gray-400 italic truncate max-w-[140px] lg:max-w-[200px] xl:max-w-none" title="${horseLabel(e)}">${horseLabel(e)}</div>
                </td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 align-middle">
                    <div class="truncate max-w-[80px] md:max-w-[120px] xl:max-w-none" title="${e._mergedLabel || e.className || ''}">${e._mergedLabel || e.className || ''}</div>
                </td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm text-gray-700 dark:text-gray-300 align-middle">
                    <div class="flex items-center gap-1.5 whitespace-nowrap" title="${e.clubName || ''}">
                        ${getFlagHtml(e)}
                        ${getClubLogoHtml(e)}
                        <span class="hidden md:inline-block truncate max-w-[100px] lg:max-w-[150px] xl:max-w-none">${e.clubName || ''}</span>
                    </div>
                </td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 align-middle text-[11px] lg:text-sm whitespace-nowrap">${getVisibleTime('dressage', st.dressage)}</td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 align-middle text-[11px] lg:text-sm whitespace-nowrap">${getVisibleTime('marathon', st.marathon)}</td>
                <td class="px-2 py-2 lg:px-3 lg:py-2 align-middle text-[11px] lg:text-sm whitespace-nowrap">${getVisibleTime('precision', st.precision)}</td>
                ${isEditable ? `
                <td class="px-2 py-2 lg:px-3 lg:py-2 text-[11px] lg:text-sm align-middle whitespace-nowrap">
                    <div class="flex flex-col items-center gap-1">
                        ${actionButtons('dressage')}
                        ${actionButtons('marathon')}
                        ${actionButtons('precision')}
                    </div>
                </td>` : ''}
            </tr>`;
    };

    const headers = [
        { key: 'startNumber', label: '#' }, { key: 'driverName', label: t('equipage') },
        { key: 'className', label: t('class') }, { key: 'clubName', label: t('country_club') },
        { key: 'dressage', label: t('dressage') }, { key: 'marathon', label: t('marathon') },
        { key: 'precision', label: t('precision') }
    ];
    if (isEditable) headers.push({ key: 'actions', label: t('actions') });

    const headerHtml = `<thead class="bg-gray-50 dark:bg-gray-700 text-xs"><tr>${headers.map(h => {
        const isSortable = !!h.key;
        const cursor = isSortable ? 'cursor-pointer' : '';
        const isSorted = sortConfig.key === h.key;
        const arrow = isSorted ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '';
        return `<th data-key="${h.key}" class="${isSortable ? 'sortable-header' : ''} px-2 py-2 lg:px-3 lg:py-2 text-left text-[11px] lg:text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider select-none whitespace-nowrap ${cursor}">${h.label} ${arrow}</th>`;
    }).join('')}</tr></thead>`;

    let bodyHtml = '';
    const colspan = headers.length;
    if (viewMode === 'byclass') {
        const grouped = sortedEquipages.reduce((acc, eq) => {
            (acc[eq._mergedLabel || eq.className || 'Okänd'] = acc[eq._mergedLabel || eq.className || 'Okänd'] || []).push(eq);
            return acc;
        }, {});
        const sortedClasses = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'sv'));
        for (const className of sortedClasses) {
            bodyHtml += `<tr><td colspan="${colspan}" class="px-3 py-2 bg-gray-100 dark:bg-gray-700 font-bold text-gray-800 dark:text-gray-200 sticky top-0 z-10">${className}</td></tr>`;
            bodyHtml += grouped[className].map((e, i) => renderEquipageRow(e, i, sortedEquipages.length)).join('');
        }
    } else {
        bodyHtml = sortedEquipages.map((e, i) => renderEquipageRow(e, i, sortedEquipages.length)).join('');
    }

    table.innerHTML = `${headerHtml}<tbody>${bodyHtml}</tbody>`;

    // Attach DnD Listeners
    if (enableDnD) {
        const rows = table.querySelectorAll('tr.draggable-row');
        rows.forEach(r => {
            r.addEventListener('dragstart', handleDragStart);
            r.addEventListener('dragend', handleDragEnd);
            r.addEventListener('dragover', handleDragOver);
            r.addEventListener('dragleave', handleDragLeave);
            r.addEventListener('drop', handleDrop);
        });
    }

    // Scroll helpers
    const hostEl = document.getElementById('starttider-x-wrap');
    if (hostEl && window.__setupXbarSync) {
        // Delay to ensure table layout is ready
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.__setupXbarSync({
                    barClass: 'fixed-xbar',
                    innerId: 'starttiderXbarInner',
                    hostEl: hostEl
                });
            });
        });
    }
}

// Renderar mobilvyn med kort
function renderMobile() {
    const container = document.getElementById('startlist-container');
    if (!container) return;

    const isEditable = !publicMode && currentUserRole === 'admin';
    const sorted = getSortedEquipages();
    const isPub = startTimes.published || {};
    let lastClass = null;

    const cardsHtml = sorted.map((e, index) => {
        const st = startTimes[String(e.startNumber)] || {};
        let classHeader = '';
        if (viewMode === 'byclass' && (e._mergedLabel || e.className) !== lastClass) {
            lastClass = (e._mergedLabel || e.className);
            classHeader = `<div class="px-4 py-2 mt-2 bg-blue-100 text-blue-800 font-bold text-lg rounded-md">${e._mergedLabel || e.className}</div>`;
        }

        const timeRow = (discipline, value) => {
            // Check visibility
            if (!isEditable && !isPub[discipline]) {
                return `<span class="text-gray-400 italic">Ej publicerad</span>`;
            }

            const dateObj = parseDateTime(value);
            if (isEditable) {
                return `<input id="${discipline}-${e.startNumber}" type="datetime-local" class="flex-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" value="${value || ''}">`;
            }
            return `<span class="font-semibold dark:text-white">${formatDateTime(dateObj)}</span>`;
        };

        const actionButtons = (discipline) => {
            if (!isEditable) return '';

            const disciplineStyles = {
                dressage: { label: 'D', color: 'bg-slate-100' },
                marathon: { label: 'M', color: 'bg-emerald-100' },
                precision: { label: 'P', color: 'bg-indigo-100' }
            };
            const style = disciplineStyles[discipline];

            return `
            <div class="flex items-center justify-between w-full gap-2 p-1 rounded-full ${style.color}">
                <span class="font-bold text-xs text-gray-600 w-16 text-left">${discipline.charAt(0).toUpperCase() + discipline.slice(1)}:</span>
                <div class="flex items-center gap-1">
                    <button class="action-btn text-gray-600 hover:text-blue-600" data-action="pause" data-discipline="${discipline}" data-sn="${e.startNumber}" title="${t('pause_btn')}">☕</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${index === 0 ? 'opacity-25' : ''}" data-action="move" data-discipline="${discipline}" data-dir="up" data-sn="${e.startNumber}" title="${t('move_up')}">▲</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${index === sorted.length - 1 ? 'opacity-25' : ''}" data-action="move" data-discipline="${discipline}" data-dir="down" data-sn="${e.startNumber}" title="${t('move_down')}">▼</button>
                </div>
            </div>`;
        };

        const isElim = isEliminatedOrIncomplete(e);
        const elimClass = isElim ? 'bg-red-50 dark:bg-red-900/20' : 'bg-white dark:bg-gray-800';

        return `
            ${classHeader}
            <div class="mx-1 mb-2 rounded-xl border dark:border-gray-700 shadow-sm ${elimClass} overflow-hidden">
                <div class="px-3 py-2 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                    <div class="font-semibold text-base dark:text-white">#${e.startNumber} ${e.driverName}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 italic">${horseLabel(e)}</div>
                </div>
                <div class="p-3 space-y-2 text-sm">
                    <div class="flex justify-between items-center"><span class="text-gray-500 dark:text-gray-400">Klass:</span><span class="font-medium dark:text-gray-200">${e._mergedLabel || e.className || '—'}</span></div>
                    <div class="flex justify-between items-center gap-2 pt-2 border-t dark:border-gray-700"><span class="text-gray-500 dark:text-gray-400 w-16">Dressyr:</span>${timeRow('dressage', st.dressage)}<div class="flex items-center gap-1">${statusBadge('dressage', e.startNumber)}</div></div>
                    <div class="flex justify-between items-center gap-2 pt-2 border-t dark:border-gray-700"><span class="text-gray-500 dark:text-gray-400 w-16">Maraton:</span>${timeRow('marathon', st.marathon)}<div class="flex items-center gap-1">${statusBadge('marathon', e.startNumber)}</div></div>
                    <div class="flex justify-between items-center gap-2 pt-2 border-t dark:border-gray-700"><span class="text-gray-500 dark:text-gray-400 w-16">Precision:</span>${timeRow('precision', st.precision)}<div class="flex items-center gap-1">${statusBadge('precision', e.startNumber)}</div></div>
                </div>
                ${isEditable ? `
                <div class="px-4 py-2 border-t bg-gray-50 space-y-2">
                    <div class="text-xs font-semibold text-gray-500">${t('actions')}</div>
                    ${actionButtons('dressage')}
                    ${actionButtons('marathon')}
                    ${actionButtons('precision')}
                </div>
                ` : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = `<div class="bg-gray-50 py-1">${cardsHtml}</div>`;
}




// ======= Kontroller och Event Listeners =======
// ... (rest of the file from lines 561+)

// ======= Kontroller och Event Listeners =======
function doBulkFill(key) {
    const cls = document.getElementById('bulkClass').value;
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));
    const onlyEmpty = document.getElementById('bulkOnlyEmpty').checked;

    if (!firstDateTimeStr) {
        showAlert(t('valid_start_time_req'), 'warning');
        return;
    }

    const firstDateTime = new Date(firstDateTimeStr);
    if (isNaN(firstDateTime.getTime())) {
        showAlert(t('valid_date_req'), 'warning');
        return;
    }

    const rows = equipages.filter(e => !cls || (e._mergedLabel || e.className) === cls).sort(byStartNumberAsc);
    let currentTimestamp = firstDateTime.getTime();

    rows.forEach(e => {
        const sn = String(e.startNumber);
        const entry = startTimes[sn] ||= {};
        if (onlyEmpty && entry[key]) {
            return;
        }

        const currentDate = new Date(currentTimestamp);
        entry[key] = toDateTimeLocalString(currentDate);
        currentTimestamp += intervalMin * 60 * 1000;
    });

    render();
    updateNextStartTimes();
}

/**
 * Hämtar och summerar straffpoäng för ett ekipage från dressyr och maraton.
 * VIKTIGT: Denna funktion gör antaganden om hur er resultatdata är strukturerad.
 * Den kan behöva justeras för att matcha er exakta datamodell.
 */



/**
 * NY FUNKTION: Anropas av den nya "Generera Precision"-knappen.
 * Läser av valt sorteringsläge och anropar rätt underliggande funktion.
 */
function generatePrecisionAdvanced() {
    const selectedMode = document.querySelector('input[name="precisionSortMode"]:checked')?.value;

    switch (selectedMode) {
        case 'startorder':
            console.log("Genererar Precision efter startnummer...");
            doBulkFill('precision'); // Använder den befintliga standardfunktionen
            break;
        case 'dressageOrder':
            console.log("Genererar Precision efter dressyrordning...");
            generatePrecisionByDressageOrder();
            break;
        case 'resultsOrder':
            console.log("Genererar Precision efter resultat D+M...");
            generatePrecisionByResults();
            break;
        default:
            showAlert(t('select_method_warning'), 'warning');
            break;
    }
}

/**
 * Genererar startlista för koner baserat på startordningen i dressyren.
 */
function generatePrecisionByDressageOrder() {
    const cls = document.getElementById('bulkClass').value;
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));
    const includeElim = document.getElementById('bulkIncludeEliminated')?.checked;
    const onlyEmpty = document.getElementById('bulkOnlyEmpty').checked;

    if (!firstDateTimeStr) {
        showAlert(t('valid_start_time_req'), 'warning');
        return;
    }
    const firstDateTime = new Date(firstDateTimeStr);

    // Filter by class, then sort equipages based on their existing dressage time
    const filteredEquipages = equipages.filter(e => {
        if (cls && (e._mergedLabel || e.className) !== cls) return false;

        const time = parseDateTime(startTimes[String(e.startNumber)]?.dressage)?.getTime();
        // Fall 1: Har en tid -> alltid med
        if (time) return true;
        // Fall 2: Saknar tid -> ta bara med om includeElim är sant
        if (includeElim) return true;
        return false;
    });

    const sortedByDressage = [...filteredEquipages];
    sortedByDressage.sort((a, b) => {
        const timeA = parseDateTime(startTimes[String(a.startNumber)]?.dressage)?.getTime() || -Infinity;
        const timeB = parseDateTime(startTimes[String(b.startNumber)]?.dressage)?.getTime() || -Infinity;
        if (timeA === timeB) {
            return Number(a.startNumber) - Number(b.startNumber);
        }
        return timeA - timeB; // -Infinity startar allra först.
    });

    let currentTimestamp = firstDateTime.getTime();
    let assignedCount = 0;
    sortedByDressage.forEach(e => {
        const sn = String(e.startNumber);
        if (!startTimes[sn]) startTimes[sn] = {};

        if (onlyEmpty && startTimes[sn].precision) {
            return;
        }

        startTimes[sn].precision = toDateTimeLocalString(new Date(currentTimestamp));
        currentTimestamp += intervalMin * 60 * 1000;
        assignedCount++;
    });

    render();
    updateNextStartTimes();
    showAlert(t('generated_precision_dressage').replace('{count}', assignedCount), 'success');
}



/**
 * NY FUNKTION: Anropas av den nya "Generera Maraton"-knappen.
 */
function generateMarathonAdvanced() {
    const selectedMode = document.querySelector('input[name="marathonSortMode"]:checked')?.value;
    if (selectedMode === 'startorder') {
        doBulkFill('marathon');
    } else if (selectedMode === 'resultsOrder') {
        generateMarathonByDressageResults();
    }
}

/**
 * NY FUNKTION: Genererar startlista för maraton baserat på dressyrresultat.
 */
function generateMarathonByDressageResults() {
    const cls = document.getElementById('bulkClass').value;
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));
    const includeElim = document.getElementById('bulkIncludeEliminated')?.checked;
    const onlyEmpty = document.getElementById('bulkOnlyEmpty').checked;

    if (!firstDateTimeStr) {
        showAlert(t('valid_start_time_req'), 'warning');
        return;
    }
    const firstDateTime = new Date(firstDateTimeStr);

    const mappedEquipages = equipages.filter(e => !cls || (e._mergedLabel || e.className) === cls).map(e => {
        const sn = String(e.startNumber);
        const rawProtocols = window.__dressageCache?.get(sn);
        const protocols = rawProtocols ? Array.from(rawProtocols.values()) : [];
        const programs = getPrograms();
        const validProtos = deduplicateAndFilterProtocols(protocols, []);
        const result = calculateDressageResult(e, validProtos, [], programs);

        return {
            ...e,
            debugProtoCount: protocols.length,
            debugResultNull: result == null,
            debugPenaltyVal: result?.penalty,
            dressagePenalty: (result && result.penalty != null && !result.eliminated) ? result.penalty : (includeElim ? Infinity : null)
        };
    });

    const rankedEquipages = mappedEquipages.filter(e => e.dressagePenalty !== null);

    if (rankedEquipages.length === 0) {
        // DIAGNOSTIC ALERT
        const totalChecked = mappedEquipages.length;
        const totalProtos = mappedEquipages.reduce((sum, e) => sum + e.debugProtoCount, 0);
        const missingPenalties = mappedEquipages.filter(e => e.debugPenaltyVal == null).length;

        showAlert(`Kunde inte generera startlista (0 ekipage hittades).\n\nDiagnosinfo:\nStartnummer dubbelkollade i klassen: ${totalChecked}\nAntal hittade protokoll i cache: ${totalProtos}\nAntal ekipage som saknade straffpoäng (null): ${missingPenalties}`, 'error', 15000);
        return;
    }

    // Sortera: Högst straffpoäng (sämst resultat) startar först. Infinity startar alltså *allra först*.
    rankedEquipages.sort((a, b) => {
        const pA = a.dressagePenalty;
        const pB = b.dressagePenalty;
        if (pA === pB) {
            return Number(a.startNumber) - Number(b.startNumber);
        }
        if (pA === Infinity) return -1;
        if (pB === Infinity) return 1;
        return pB - pA;
    });

    let currentTimestamp = firstDateTime.getTime();
    let assignedCount = 0;
    rankedEquipages.forEach(e => {
        const sn = String(e.startNumber);
        if (!startTimes[sn]) startTimes[sn] = {};

        if (onlyEmpty && startTimes[sn].marathon) {
            return; // hoppa över om vi bara ska fylla tomma
        }

        startTimes[sn].marathon = toDateTimeLocalString(new Date(currentTimestamp));
        currentTimestamp += intervalMin * 60 * 1000;
        assignedCount++;
    });

    render();
    updateNextStartTimes();
    showAlert(t('generated_marathon_dressage').replace('{count}', assignedCount), 'success');
}

/**
 * Genererar startlista för koner baserat på omvänd resultatordning från Dressyr + Maraton.
 */
function generatePrecisionByResults() {
    const cls = document.getElementById('bulkClass').value;
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));
    const includeElim = document.getElementById('bulkIncludeEliminated')?.checked;
    const onlyEmpty = document.getElementById('bulkOnlyEmpty').checked;

    if (!firstDateTimeStr) {
        showAlert(t('valid_start_time_req'), 'warning');
        return;
    }
    const firstDateTime = new Date(firstDateTimeStr);

    // Skapa en lista med ekipage och deras summerade straffpoäng
    const rankedEquipages = equipages.filter(e => !cls || (e._mergedLabel || e.className) === cls).map(e => {
        const sn = String(e.startNumber);
        const rawProtocols = window.__dressageCache?.get(sn);
        const protocols = rawProtocols ? Array.from(rawProtocols.values()) : [];
        const programs = getPrograms();
        const validProtos = deduplicateAndFilterProtocols(protocols, []);
        const dRes = calculateDressageResult(e, validProtos, [], programs);
        const dPenalty = (dRes && dRes.penalty != null) ? dRes.penalty : null;

        const mData = marathonMap.get(sn) || {};
        const mRes = calculateMarathonResult(e, mData, mData);

        let total = null;
        const elim = !!dRes?.eliminated || !!mRes?.eliminated || mData.eliminated || mData.status === 'Eliminerad';

        const hasValidDressage = dPenalty !== null;
        const hasValidMarathon = mRes && mRes.totalPenalty !== null;

        if (!elim && hasValidDressage && hasValidMarathon) {
            total = dPenalty + mRes.totalPenalty;
        } else if (includeElim) {
            total = Infinity; // Eliminated or missing starts first
        }

        return {
            ...e,
            totalPenalty: total
        };
    })
        // Filtrera bort de som är eliminerade/saknar resultat OM includeElim är false (totalPenalty är null)
        .filter(e => e.totalPenalty !== null);

    // Sortera listan: Högst straffpoäng startar först (omvänd sortering). Infinity startar allra först.
    rankedEquipages.sort((a, b) => {
        const pA = a.totalPenalty;
        const pB = b.totalPenalty;
        if (pA === pB) {
            return Number(a.startNumber) - Number(b.startNumber);
        }
        if (pA === Infinity) return -1;
        if (pB === Infinity) return 1;
        return pB - pA;
    });

    let currentTimestamp = firstDateTime.getTime();
    let assignedCount = 0;
    rankedEquipages.forEach(e => {
        const sn = String(e.startNumber);
        if (!startTimes[sn]) startTimes[sn] = {};

        if (onlyEmpty && startTimes[sn].precision) {
            return;
        }

        startTimes[sn].precision = toDateTimeLocalString(new Date(currentTimestamp));
        currentTimestamp += intervalMin * 60 * 1000;
        assignedCount++;
    });

    render();
    updateNextStartTimes();
    showAlert(t('generated_precision_results').replace('{count}', assignedCount), 'success');
}

/**
 * Lägger in en paus i en tidslinje genom att skjuta fram alla efterföljande tider.
 */
function insertPause(discipline, afterStartNumber) {
    const pauseMinutes = parseInt(prompt(t('add_pause_prompt'), "15"), 10);
    if (isNaN(pauseMinutes) || pauseMinutes <= 0) return;

    // Sortera ekipagen baserat på den aktuella grenens starttid för att få rätt ordning
    const sortedEquipages = [...equipages].sort((a, b) => {
        const timeA = parseDateTime(startTimes[String(a.startNumber)]?.[discipline])?.getTime() || Infinity;
        const timeB = parseDateTime(startTimes[String(b.startNumber)]?.[discipline])?.getTime() || Infinity;
        return timeA - timeB;
    });

    const startIndex = sortedEquipages.findIndex(e => e.startNumber == afterStartNumber);

    if (startIndex === -1 || startIndex === sortedEquipages.length - 1) {
        showAlert(t('cant_pause_last'), 'warning');
        return;
    }

    // Loopa igenom alla ekipage EFTER punkten där pausen ska in och addera paustiden
    for (let i = startIndex + 1; i < sortedEquipages.length; i++) {
        const sn = String(sortedEquipages[i].startNumber);
        const currentStartTime = parseDateTime(startTimes[sn]?.[discipline]);

        if (currentStartTime) {
            const newTimestamp = currentStartTime.getTime() + (pauseMinutes * 60 * 1000);
            startTimes[sn][discipline] = toDateTimeLocalString(new Date(newTimestamp));
        }
    }

    render();
    updateNextStartTimes();
    showAlert(t('pause_added').replace('{min}', pauseMinutes).replace('{disc}', discipline), 'info');
}

/**
 * Flyttar ett ekipage upp eller ner i listan och räknar om alla efterföljande tider.
 */
function moveEquipage(discipline, startNumber, direction) {
    const sortedEquipages = [...equipages].sort((a, b) => {
        const timeA = parseDateTime(startTimes[String(a.startNumber)]?.[discipline])?.getTime() || Infinity;
        const timeB = parseDateTime(startTimes[String(b.startNumber)]?.[discipline])?.getTime() || Infinity;
        return timeA - timeB;
    });

    const currentIndex = sortedEquipages.findIndex(e => e.startNumber == startNumber);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= sortedEquipages.length) return; // Kan inte flytta utanför listan

    // Capture time of the top-most slot (min index) to preserve the schedule anchor
    const topIndex = Math.min(currentIndex, newIndex);
    const snAtTopIndex = String(sortedEquipages[topIndex].startNumber);
    const preservedTime = startTimes[snAtTopIndex]?.[discipline];

    // Byt plats på de två ekipagen i vår sorterade array
    [sortedEquipages[currentIndex], sortedEquipages[newIndex]] = [sortedEquipages[newIndex], sortedEquipages[currentIndex]];

    // Apply preserved time to the new occupant of the top slot
    if (preservedTime) {
        const newSnAtTopIndex = String(sortedEquipages[topIndex].startNumber);
        if (!startTimes[newSnAtTopIndex]) startTimes[newSnAtTopIndex] = {};
        startTimes[newSnAtTopIndex][discipline] = preservedTime;
    }

    // Nu räknar vi om alla tider från den första av de två som bytte plats
    recalculateTimesFrom(sortedEquipages, discipline, topIndex);

    render();
    updateNextStartTimes();
}

/**
 * Hjälpfunktion som räknar om alla starttider från ett visst index i en sorterad lista.
 */
function recalculateTimesFrom(sortedList, discipline, startIndex) {
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));

    // Hitta startpunkten för omräkningen (ankartiden)
    let baseTime;
    if (startIndex > 0) {
        const anchorSn = String(sortedList[startIndex - 1].startNumber);
        const anchorTime = parseDateTime(startTimes[anchorSn]?.[discipline]);
        if (!anchorTime) {
            showAlert(t('cant_calc_prev_missing'), 'error');
            return;
        }
        // Nästa tid ska vara ankartiden + ett intervall
        baseTime = anchorTime.getTime() + (intervalMin * 60 * 1000);

    } else {
        // Om vi börjar från allra första, behåll dess tid och räkna om resten
        const firstSn = String(sortedList[0].startNumber);
        baseTime = parseDateTime(startTimes[firstSn]?.[discipline])?.getTime();
        if (!baseTime) {
            showAlert(t('cant_calc_first_missing'), 'error');
            return;
        }
    }

    // Loopa från startindex och sätt nya tider
    for (let i = startIndex; i < sortedList.length; i++) {
        const sn = String(sortedList[i].startNumber);
        const newDate = new Date(baseTime + ((i - startIndex) * intervalMin * 60 * 1000));

        if (!startTimes[sn]) startTimes[sn] = {}; // Säkerställ att objektet finns
        startTimes[sn][discipline] = toDateTimeLocalString(newDate);
    }
}

async function togglePublish(key) {
    if (!startTimes.published) startTimes.published = {};
    startTimes.published[key] = !startTimes.published[key];

    // Optimistisk uppdatering UI
    bindAllControls();

    try {
        // Separera times och published för att matcha strukturen i Firestore
        const timesOnly = { ...startTimes };
        delete timesOnly.published;

        await saveConfig(competitionId, 'startTimes', {
            times: timesOnly,
            published: startTimes.published
        });
    } catch (err) {
        console.error("Failed to save publish state", err);
        showAlert("Kunde inte spara publiceringsstatus", "error");
        // Revert vid fel
        startTimes.published[key] = !startTimes.published[key];
        bindAllControls();
    }
}

async function saveTimes() {
    const payload = { times: startTimes, updatedAt: Date.now() };
    await saveConfig(competitionId, 'startTimes', payload);
    showAlert(t('times_saved'), 'success');
}

async function clearDisciplineTimes(discipline) {
    const cls = document.getElementById('bulkClass').value;
    const confirmMsg = cls ? `${t('confirm_clear_times')} ${discipline} (${cls})?` : `${t('confirm_clear_times')} ${discipline} (ALLA KLASSER)?`;

    if (confirm(confirmMsg)) {
        // Hitta vilka startnummer som tillhör klassen (om en klass är vald)
        const relevantStartNumbers = new Set(
            equipages
                .filter(e => !cls || (e._mergedLabel || e.className) === cls)
                .map(e => String(e.startNumber))
        );

        let clearedCount = 0;
        const dbUpdates = {};

        for (const sn in startTimes) {
            if (relevantStartNumbers.has(sn) && startTimes[sn][discipline]) {
                delete startTimes[sn][discipline];
                dbUpdates[`times.${sn}.${discipline}`] = deleteField();
                clearedCount++;
            }
        }

        if (clearedCount > 0) {
            render();
            updateNextStartTimes();

            try {
                const configRef = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'startTimes');
                dbUpdates['updatedAt'] = Date.now();
                await updateDoc(configRef, dbUpdates);
            } catch (err) {
                console.error("Failed to explicitely delete start times", err);
                // Fallback till saveTimes om dokumentet mot förmodan inte existerar
                await saveTimes();
            }

            showAlert(`${discipline} (${cls || 'Alla'}): ${clearedCount} tider rensades.`, 'success');
        } else {
            showAlert(`Inga tider att rensa för vald klass.`, 'info');
        }
    }
}

function bindAllControls() {
    // NYTT: Hitta page-containern istället för bara tabellen
    const pageContainer = document.getElementById('page-starttider');
    const controlsContainer = document.getElementById('controlsContainer');
    if (!controlsContainer || !pageContainer) {
        return;
    }

    const userRole = currentUserRole;
    controlsContainer.innerHTML = '';

    if (userRole !== 'admin') {
        return;
    }

    const classes = Array.from(new Set(equipages.map(e => e._mergedLabel || e.className).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'sv'));
    const classOptions = [`<option value="">${t('all_classes_opt')}</option>`].concat(classes.map(c => `<option value="${c}">${c}</option>`)).join('');

    const pubState = startTimes.published || {};
    const pubBtnClass = (key, colorClass, borderClass) => {
        const isPub = !!pubState[key];
        return isPub
            ? `w-full px-2 py-2 text-sm rounded-md font-bold text-white shadow-sm transition-colors ${colorClass} ring-2 ring-offset-1 ring-${colorClass.split('-')[1]}-500`
            : `w-full px-2 py-2 text-sm rounded-md bg-white text-gray-700 border ${borderClass} hover:bg-gray-50 transition-colors opacity-80`;
    };

    controlsContainer.innerHTML = `
<!-- 1. BULK GENERATION TOOLS -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm">
    <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300">${t('filter_class_label')}</label>
        <select id="bulkClass" class="px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white">${classOptions}</select>
    </div>
    <div class="grid grid-cols-2 gap-2">
        <div>
            <label for="bulkFirst" class="text-sm font-medium text-gray-700 dark:text-gray-300">${t('first_start_label')}</label>
            <input id="bulkFirst" type="datetime-local" class="w-full mt-1 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
        </div>
        <div>
            <label for="bulkInterval" class="text-sm font-medium text-gray-700 dark:text-gray-300">${t('interval_label')}</label>
            <input id="bulkInterval" type="number" min="1" max="60" value="7" class="w-full mt-1 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
        </div>
    </div>
    <div class="flex items-center pt-6 gap-6">
        <label class="flex items-center">
            <input id="bulkOnlyEmpty" type="checkbox" class="h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700" checked>
            <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">${t('fill_empty_only')}</span>
        </label>
        <label class="flex items-center">
            <input id="bulkIncludeEliminated" type="checkbox" class="h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700" checked>
            <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">Starta eliminerade/ofullständiga först</span>
        </label>
    </div>
</div>

<!-- 2. GENERATORS -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
    <div class="p-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm space-y-4">
        <button id="bulkDressage" class="w-full px-3 py-2 text-sm font-semibold rounded-md bg-slate-600 text-white hover:bg-slate-700 shadow flex justify-between items-center">
            ${t('generate_dressage')} <span id="nextTimeDressage" class="text-xs opacity-80 font-normal ml-2"></span>
        </button>
        
        <div class="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-md border border-emerald-100 dark:border-emerald-800">
            <h4 class="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400 mb-2">${t('generate_marathon_advanced')}</h4>
            <div class="space-y-2 text-sm">
                <div class="flex items-center">
                    <input type="radio" id="modeMarathonStartOrder" name="marathonSortMode" value="startorder" class="h-4 w-4 text-emerald-600 focus:ring-emerald-500" checked>
                    <label for="modeMarathonStartOrder" class="ml-2 text-gray-700 dark:text-gray-300">${t('by_startnumber')}</label>
                </div>
                <div class="flex items-center">
                    <input type="radio" id="modeMarathonResultsOrder" name="marathonSortMode" value="resultsOrder" class="h-4 w-4 text-emerald-600 focus:ring-emerald-500">
                    <label for="modeMarathonResultsOrder" class="ml-2 text-gray-700 dark:text-gray-300">${t('by_dressage_results')}</label>
                </div>
            </div>
            <button id="generateMarathonAdvancedBtn" class="mt-3 w-full px-3 py-2 text-sm font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 shadow flex justify-between items-center">
                ${t('generate_marathon')} <span id="nextTimeMarathon" class="text-xs opacity-80 font-normal ml-2"></span>
            </button>
        </div>
    </div>
    
    <div class="p-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm">
        <div class="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-md border border-indigo-100 dark:border-indigo-800 h-full flex flex-col">
            <h4 class="text-xs font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-400 mb-2">${t('generate_precision_advanced')}</h4>
            <div class="space-y-2 text-sm flex-1">
                <div class="flex items-center">
                    <input type="radio" id="modePrecisionStartOrder" name="precisionSortMode" value="startorder" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500" checked>
                    <label for="modePrecisionStartOrder" class="ml-2 text-gray-700 dark:text-gray-300">${t('by_startnumber')}</label>
                </div>
                <div class="flex items-center">
                    <input type="radio" id="modePrecisionDressageOrder" name="precisionSortMode" value="dressageOrder" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500">
                    <label for="modePrecisionDressageOrder" class="ml-2 text-gray-700 dark:text-gray-300">${t('by_dressage_order')}</label>
                </div>
                <div class="flex items-center">
                    <input type="radio" id="modePrecisionResultsOrder" name="precisionSortMode" value="resultsOrder" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500">
                    <label for="modePrecisionResultsOrder" class="ml-2 text-gray-700 dark:text-gray-300">${t('by_results_total')}</label>
                </div>
            </div>
            <button id="generatePrecisionAdvancedBtn" class="mt-3 w-full px-3 py-2 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 shadow flex justify-between items-center">
                ${t('generate_precision')} <span id="nextTimePrecision" class="text-xs opacity-80 font-normal ml-2"></span>
            </button>
        </div>
    </div>
</div>

<!-- 3. PUBLISHING & RESET  -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
    <!-- Publishing -->
    <div class="p-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm border-l-4 border-l-blue-500">
         <h4 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Publicering av Startlistor</h4>
         <div class="grid grid-cols-3 gap-2">
            <button id="pubDressage" class="${pubBtnClass('dressage', 'bg-slate-600', 'border-slate-300')}">
                ${pubState.dressage ? 'Publicerad (D)' : 'Publicera D'}
            </button>
            <button id="pubMarathon" class="${pubBtnClass('marathon', 'bg-emerald-600', 'border-emerald-300')}">
                 ${pubState.marathon ? 'Publicerad (M)' : 'Publicera M'}
            </button>
            <button id="pubPrecision" class="${pubBtnClass('precision', 'bg-indigo-600', 'border-indigo-300')}">
                 ${pubState.precision ? 'Publicerad (P)' : 'Publicera P'}
            </button>
         </div>
    </div>

    <!-- Reset -->
    <div class="p-3 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/30">
        <h4 class="text-xs font-bold uppercase tracking-wider text-red-800 dark:text-red-400 mb-3">${t('reset_sections')}</h4>
        <div class="grid grid-cols-3 gap-2">
            <button id="clearDressage" class="w-full px-2 py-2 text-xs font-semibold rounded-md bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-colors">${t('clear_dressage')}</button>
            <button id="clearMarathon" class="w-full px-2 py-2 text-xs font-semibold rounded-md bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-colors">${t('clear_marathon')}</button>
            <button id="clearPrecision" class="w-full px-2 py-2 text-xs font-semibold rounded-md bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-colors">${t('clear_precision')}</button>
        </div>
    </div>
</div>

<!-- 4. TOOLBAR (Save, Public view, Exports) -->
<div class="flex flex-col md:flex-row items-center justify-between gap-4 mb-4 p-2 bg-gray-100 dark:bg-gray-800 rounded-lg border dark:border-gray-700">
    <!-- Left: Modes -->
    <div class="flex items-center gap-3">
         <button id="togglePublic" class="px-4 py-2 rounded-md border border-gray-300 bg-white dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors">
            ${publicMode ? t('editor_mode') : t('public_mode')}
        </button>
        ${!publicMode ? `<button id="btnSaveTimes" class="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-500 shadow-sm text-sm font-bold transition-colors">${t('save_times')}</button>` : ''}
    </div>

    <!-- View Modes -->
     <div class="inline-flex rounded-md shadow-sm" role="group">
        <button id="viewModeStartOrder" data-mode="startorder" class="px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-l-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus:z-10 bg-white dark:bg-gray-800 dark:text-gray-200">
            ${t('start_order')}
        </button>
        <button id="viewModeByClass" data-mode="byclass" class="px-3 py-2 text-sm font-medium border-t border-b border-r border-gray-300 dark:border-gray-600 rounded-r-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus:z-10 bg-white dark:bg-gray-800 dark:text-gray-200">
            ${t('group_by_class')}
        </button>
    </div>

    <!-- Right: Exports -->
    <div class="flex items-center gap-2">
        <div class="relative inline-block text-left" id="pdfDropdownContainer">
             <button id="btnPdfDropdown" class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-slate-700 hover:bg-slate-600 focus:outline-none ring-1 ring-slate-900/10">
                <svg class="mr-2 -ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                PDF
                <svg class="-mr-1 ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
             <div id="pdfDropdownMenu" class="hidden absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                <div class="py-1">
                    <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="pdf-dressage">${t('startlist_dressage')}</button>
                    <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="pdf-marathon">${t('startlist_marathon')}</button>
                    <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="pdf-precision">${t('startlist_precision')}</button>
                </div>
            </div>
        </div>

        <button id="btnExportStarttiderCsv" class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
             <i class="fas fa-file-csv mr-2 text-green-600"></i>CSV
        </button>
    </div>
</div>
    `;

    document.getElementById('btnSaveTimes')?.addEventListener('click', saveTimes);
    document.getElementById('bulkDressage')?.addEventListener('click', () => doBulkFill('dressage'));
    document.getElementById('generateMarathonAdvancedBtn')?.addEventListener('click', generateMarathonAdvanced);
    document.getElementById('generatePrecisionAdvancedBtn')?.addEventListener('click', generatePrecisionAdvanced);

    // Publish Listeners
    document.getElementById('pubDressage')?.addEventListener('click', () => togglePublish('dressage'));
    document.getElementById('pubMarathon')?.addEventListener('click', () => togglePublish('marathon'));
    document.getElementById('pubPrecision')?.addEventListener('click', () => togglePublish('precision'));

    document.getElementById('togglePublic')?.addEventListener('click', () => {
        publicMode = !publicMode;
        bindAllControls();
        render();
    });

    // Public/Shared UI Listeners for Search and ViewMode
    document.getElementById('startlistSearch')?.addEventListener('input', (e) => {
        searchTerm = e.target.value.trim();
        render();
    });

    document.getElementById('publicViewModeSelect')?.addEventListener('change', (e) => {
        viewMode = e.target.value;
        const classes = Array.from(new Set(equipages.map(eq => eq._mergedLabel || eq.className).filter(Boolean))).sort((a,b) => a.localeCompare(b, 'sv'));
        if (viewMode === 'byclass' && document.getElementById('bulkClass')) {
            document.getElementById('bulkClass').value = classes[0] || ''; 
        }
        render();
    });
    document.getElementById('bulkInterval')?.addEventListener('input', updateNextStartTimes);
    document.getElementById('clearDressage')?.addEventListener('click', () => clearDisciplineTimes('dressage'));
    document.getElementById('clearMarathon')?.addEventListener('click', () => clearDisciplineTimes('marathon'));
    document.getElementById('clearPrecision')?.addEventListener('click', () => clearDisciplineTimes('precision'));

    // Fix View Mode Buttons (Active State)
    const updateViewModeButtons = () => {
        document.querySelectorAll('[data-mode]').forEach(btn => {
            const isActive = btn.dataset.mode === viewMode;
            btn.classList.toggle('bg-gray-100', isActive); // Light mode active
            btn.classList.toggle('dark:bg-gray-700', isActive); // Dark mode active
            btn.classList.toggle('text-blue-700', isActive);
            btn.classList.toggle('dark:text-white', isActive);
        });
    };
    document.getElementById('viewModeStartOrder')?.addEventListener('click', () => {
        viewMode = 'startorder';
        sortConfig = { key: 'startNumber', direction: 'asc' };
        updateViewModeButtons();
        render();
    });
    document.getElementById('viewModeByClass')?.addEventListener('click', () => {
        viewMode = 'byclass';
        sortConfig = { key: 'className', direction: 'asc' };
        updateViewModeButtons();
        render();
    });
    updateViewModeButtons();



    // CSV
    document.getElementById('btnExportStarttiderCsv')?.addEventListener('click', () => {
        // Logic for CSV...
        generateCsvWrapper();
    });

    if (!pageContainer.dataset.listenersBound) {
        // NYTT: Lyssnare på pageContainer istället för tabellen
        pageContainer.addEventListener('click', (e) => {
            const header = e.target.closest('.sortable-header');
            if (header) {

                const key = header.dataset.key;
                if (!key) return;
                sortConfig.direction = (sortConfig.key === key && sortConfig.direction === 'asc') ? 'desc' : 'asc';
                sortConfig.key = key;
                render();
            }
        });

        pageContainer.addEventListener('change', (e) => {
            if (e.target.type === 'datetime-local' && e.target.closest('tbody')) {
                const [key, sn] = e.target.id.split('-');
                const entry = startTimes[sn] ||= {};
                entry[key] = e.target.value;
                updateNextStartTimes();
            }
        });

        // NYTT: Lyssnare på pageContainer istället för tabellen
        pageContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.action-btn');
            if (!button) return;

            const { action, discipline, sn, dir } = button.dataset;

            if (action === 'pause') {
                insertPause(discipline, sn);
            } else if (action === 'move') {
                moveEquipage(discipline, sn, dir);
            }
        });

        pageContainer.dataset.listenersBound = 'true';
    }

    const btnCsv = document.getElementById('btnExportStarttiderCsv');
    if (btnCsv) {
        btnCsv.addEventListener('click', () => {
            const comp = getGlobalState('currentCompetition');
            const date = new Date().toISOString().split('T')[0];
            const filename = `starttider_${sanitizeForFilename(comp?.name || 'tavling')}_${date}.csv`;

            const list = getSortedEquipages();

            const headers = [
                'Nr', 'Kusk', 'Häst', 'Klass', 'Klubb',
                'Start Dressyr', 'Start Maraton', 'Start Precision'
            ];

            const rows = list.map(e => {
                const sn = String(e.startNumber);
                const st = startTimes[sn] || {};

                const f = (val) => {
                    if (!val) return '—';
                    const obj = parseDateTime(val);
                    return formatDateTime(obj);
                };

                return [
                    sn,
                    e.driverName || '—',
                    horseLabel(e),
                    e._mergedLabel || e.className || '—',
                    e.clubName || '—',
                    f(st.dressage),
                    f(st.marathon),
                    f(st.precision)
                ];
            });

            downloadCsv(filename, headers, rows);
        });
    }

    // --- PDF Dropdown Logic ---
    const btnPdfDropdown = document.getElementById('btnPdfDropdown');
    const pdfMenu = document.getElementById('pdfDropdownMenu');
    const pdfContainer = document.getElementById('pdfDropdownContainer');

    if (btnPdfDropdown && pdfMenu) {
        // Toggle menu
        btnPdfDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
            pdfMenu.classList.toggle('hidden');
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (pdfContainer && !pdfContainer.contains(e.target)) {
                pdfMenu.classList.add('hidden');
            }
        });

        // Handle menu actions
        pdfMenu.addEventListener('click', async (e) => {
            const actionBtn = e.target.closest('button[data-action]');
            if (!actionBtn) return;

            e.stopPropagation();
            pdfMenu.classList.add('hidden');

            const action = actionBtn.dataset.action;
            // const comp = getGlobalState('currentCompetition'); // Not needed for wrapper

            let type = '';
            if (action === 'pdf-dressage') type = 'dressage';
            else if (action === 'pdf-marathon') type = 'marathon';
            else if (action === 'pdf-precision') type = 'precision';

            if (type) {
                generatePdfWrapper(type);
            }
        });
    }
}

// ======= Datainhämtning & Realtidslyssnare =======
async function loadData() {
    // === ÄNDRING: Lade till displayCfg och de gamla merge-filerna ===
    const [cfgDoc, equipagesData, marathonDocs, timingDocs, resultsDocs, displayCfg, mergeCfgA, mergeCfgB, mergeCfgC, marathonCfg, marathonCfgLegacy] = await Promise.all([
        getConfig(competitionId, 'startTimes'),
        getEquipages(competitionId),
        getMarathonStateDocuments(competitionId),
        getMarathonTimingData(competitionId),
        getMarathonResults(competitionId).catch(() => []),
        getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'display')).catch(() => null),
        getConfig(competitionId, 'tdbMergeGroups').catch(() => null),
        getConfig(competitionId, 'classMergeMap').catch(() => null),
        getConfig(competitionId, 'tdbMergeMap').catch(() => null),
        getConfig(competitionId, 'marathon').catch(() => null),
        getConfig(competitionId, 'maratonConfig').catch(() => null)
    ]);

    let mergedMarathonConfig = marathonCfg || {};
    if (marathonCfgLegacy && Object.keys(marathonCfgLegacy).length > 0) {
        mergedMarathonConfig = { ...mergedMarathonConfig, ...marathonCfgLegacy };
    }
    setMarathonConfig(mergedMarathonConfig);

    marathonMap.clear();
    // 1. Live status documents
    if (marathonDocs) {
        marathonDocs.forEach((data, id) => marathonMap.set(String(id), data));
    }
    // 2. Timing documents (merges into marathonMap)
    if (timingDocs) {
        timingDocs.forEach((data, id) => {
            const sn = String(id);
            marathonMap.set(sn, { ...(marathonMap.get(sn) || {}), ...data });
        });
    }
    // 3. Official results (merges obstacles into marathonMap)
    if (resultsDocs && Array.isArray(resultsDocs)) {
        const obsMap = new Map();
        resultsDocs.forEach(res => {
            const sn = String(res.equipageId);
            if (!obsMap.has(sn)) obsMap.set(sn, []);
            obsMap.get(sn).push(res);
        });
        obsMap.forEach((obsArr, sn) => {
            const current = marathonMap.get(sn) || {};
            marathonMap.set(sn, { ...current, obstacles: obsArr });
        });
    }

    startTimes = cfgDoc?.times || {};
    // Ensure published state is loaded and attached to startTimes
    if (cfgDoc?.published) {
        Object.defineProperty(startTimes, 'published', {
            value: cfgDoc.published,
            writable: true,
            enumerable: true,
            configurable: true
        });
    } else {
        // Initialize if missing
        startTimes.published = { dressage: false, marathon: false, precision: false };
    }

    // === ÄNDRING: Bygg merge-map FÖRST ===
    const cfgData = (displayCfg && displayCfg.exists()) ? (displayCfg.data()?.value ?? displayCfg.data()) : {};
    starttider_displayConfig = cfgData || {};
    starttider_buildMergeMap(mergeCfgA || mergeCfgB || mergeCfgC || starttider_displayConfig);

    // === ÄNDRING: Dekorera ekipage-listan ===
    equipages = (equipagesData || [])
        .filter(e => {
            const ne = normalizeEquipage(e);
            return ne.startNumber && ne.status !== 'struken';
        })
        .map(e => {
            const ne = normalizeEquipage(e);
            const g = starttider_resolveMergeGrouping(ne);
            return {
                ...ne,
                _mergedKey: g.key,
                _mergedLabel: g.label
            };
        })
        .sort(byStartNumberAsc); // Sortera efteråt

}


function attachAllListeners() {
    window.__dressageCache ||= new Map();
    unsubscribers.forEach(fn => { try { fn && fn(); } catch { } });
    unsubscribers.clear();

    // 4) Sparade protokoll (NU COLLECTION GROUP)
    const unProtoGroup = listenForDressageProtocolsCollectionGroup(competitionId, equipages, (docs) => {
        // Gruppera docs efter startNumber
        const grouped = new Map();
        docs.forEach(d => {
            const sn = String(d.startNumber);
            if (!grouped.has(sn)) grouped.set(sn, new Map());
            grouped.get(sn).set(d.id, d);
        });

        // Uppdatera window.__dressageCache
        (window.__dressageCache ||= new Map()).clear();
        grouped.forEach((m, sn) => window.__dressageCache.set(sn, m));
        render();
    });
    unsubscribers.set('dressageProtocolsGroup', unProtoGroup);

    const unTimingCol = listenForMarathonTimingUpdates(competitionId, (docs) => {
        let changed = false;
        docs.forEach(d => {
            const id = String(d.id);
            const current = marathonMap.get(id) || {};
            marathonMap.set(id, { ...current, ...d.data() });
            changed = true;
        });
        if (changed) render();
    });
    unsubscribers.set('marathonTiming', unTimingCol);

    const unStatusCol = listenForDressageStatusCollection(competitionId, (docs) => {
        docs.forEach(st => {
            if (st) dressageStatusMap.set(String(st.id), st);
        });
        render();
    });
    unsubscribers.set('dressageStatus', unStatusCol);

    const unPrec = listenForPrecisionResults(competitionId, (docs) => {
        precisionResultsMap.clear();
        docs.forEach(d => precisionResultsMap.set(String(d.startNumber ?? d.id), d));
        render();
    });
    unsubscribers.set('precision', unPrec);



    const unMarStatus = listenForMaratonCollection(competitionId, (docs) => {
        let changed = false;
        docs.forEach(d => {
            const sn = String(d.startNumber || d.id);
            const current = marathonMap.get(sn) || {};
            marathonMap.set(sn, { ...current, ...d });
            changed = true;
        });
        if (changed) render();
    });
    unsubscribers.set('marathonStatus', unMarStatus);

    const unDressFin = listenForDressageFinalizationCollection(competitionId, (docs) => {
        dressageFinalizationMap.clear();
        docs.forEach(d => dressageFinalizationMap.set(String(d.id), d)); // id på doc är startnr
        render();
    });
    unsubscribers.set('dressageFin', unDressFin);

    // BORTTAGEN: Den felaktiga lyssnaren för marathonResults har tagits bort härifrån.
}

// === NY FUNKTION: Live-lyssnare för merge-konfig ===
let mergeUnsubs = [];

function listenMergeConfig(compId) {
    if (Array.isArray(mergeUnsubs)) {
        mergeUnsubs.forEach(u => { try { u(); } catch { } });
    }
    mergeUnsubs = [];
    if (!compId || !appId) return;

    // Lyssna på ALLA möjliga config-platser
    const keys = ['display', 'tdbMergeGroups', 'classMergeMap', 'tdbMergeMap'];

    keys.forEach(key => {
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'competitions', compId, 'config', key);
        const unsub = onSnapshot(ref, (snap) => {
            const data = snap.exists() ? (snap.data()?.value ?? snap.data()) : null;

            starttider_buildMergeMap(snap.id === 'display' ? { mergeByClassNumber: data?.mergeByClassNumber || {} } : data);

            // Märk om alla ekipage
            equipages = equipages.map(e => ({
                ...e,
                _mergedKey: starttider_resolveMergeGrouping(e).key,
                _mergedLabel: starttider_resolveMergeGrouping(e).label
            }));

            render(); // Rita om

        }, (err) => {
            console.warn('[merge-config] snapshot error', key, err);
        });
        mergeUnsubs.push(unsub);
    });
}

async function refreshMarathonTiming() {
    const tmap = await getMarathonTimingData(competitionId);
    if (!tmap) return;

    // Handles both Map and Array (and plain object as fallback)
    if (typeof tmap.forEach === 'function') {
        tmap.forEach((data, key) => {
            const sn = String(data.startNumber || data.id || key || '');
            if (sn && sn !== 'undefined') {
                marathonMap.set(sn, { ...(marathonMap.get(sn) || {}), ...data });
            }
        });
    } else {
        Object.keys(tmap).forEach(k => {
            const sn = String(k);
            marathonMap.set(sn, { ...(marathonMap.get(sn) || {}), ...tmap[k] });
        });
    }
}

function startClock() {
    if (clockTimer) clearInterval(clockTimer);

    updateLiveStatus();
    render(); // Kör en render direkt för att visa "Nu" och "Nästa"

    clockTimer = setInterval(() => {
        updateLiveStatus();
        render();
    }, 30000);
}

// ======= Huvudfunktion =======


// ... (imports)

export async function load() {
    injectScrollStyles();
    initializeScrollSync('starttider');

    const competition = getGlobalState('currentCompetition');
    competitionId = competition?.id;
    if (!competitionId) {
        document.getElementById('page-starttider').innerHTML = '<p class="p-8 text-center text-gray-600">Ingen tävling vald.</p>';
        return;
    }

    // (Funktionen injectStarttiderBaseStyles har redan körts via IIFE)

    // NYTT: Säkerställ att loggor laddas innan något annat renderas
    await ensureClubLogosLoaded();

    renderLayout();
    currentUserRole = await getCurrentUserRole();
    try {
        await loadData();
        bindAllControls();
        attachAllListeners();
        listenMergeConfig(competitionId);

        // BORTTAGEN: __stStartXbarAuto();

        await refreshMarathonTiming();
        updateNextStartTimes();
        startClock();
    } catch (err) {
        console.error("❌ Ett fel inträffade i load()-funktionen:", err);
        const container = document.getElementById('startlist-container');
        if (container) container.innerHTML = `<p class="p-4 text-center text-red-500">Ett fel inträffade. Listan kunde inte laddas.</p>`;
    }

    // NYTT: Spara referens till resize-hanteraren
    document.body.dataset.wasMobile = isMobile() ? '1' : '0';
    window.__starttiderResizeHandler = () => {
        const nowMobile = isMobile() ? '1' : '0';
        if (document.body.dataset.wasMobile !== nowMobile) {
            document.body.dataset.wasMobile = nowMobile;
            render();
        }
    };
    window.addEventListener('resize', window.__starttiderResizeHandler, { passive: true });

    // Kör render() en gång manuellt för att visa rätt vy från början
    render();
}


// ===== NYTT: Uppdaterad __unload (matchar deltagare.js) =====
export function __unload() {
    console.log("[Starttider Unload] Startar städning...");

    // 1) Ta bort resize-lyssnare
    if (window.__starttiderResizeHandler) {
        try { window.removeEventListener('resize', window.__starttiderResizeHandler); } catch { }
        window.__starttiderResizeHandler = null;
        console.log("[Starttider Unload] Resize listener borttagen.");
    }

    // 2) Stoppa Firestore-lyssnare
    unsubscribers.forEach(fn => { try { fn && fn(); } catch { } });
    unsubscribers.clear();

    // === NYTT: Stoppa merge-lyssnaren ===
    if (Array.isArray(mergeUnsubs)) { mergeUnsubs.forEach(u => { try { u(); } catch { } }); mergeUnsubs = []; }

    // 3) Stoppa klock-timer
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }

    // === NYTT: Rensa state ===
    starttider_displayConfig = {};
    starttider_MERGE_MAP.clear();

    // 4) Teardown fast x-scrollbar + body-klass
    try { window.__teardownXbarSync?.(); } catch { }
    document.body.classList.remove('has-fixed-xbar');

    // 5) Ta bort sidans egna bas-stilar
    try { document.getElementById('starttiderBaseStyles')?.remove(); } catch { }

    // 6) Ta bort ev. gamla "auto-teardown"-flaggor
    delete window.__stAutoTeardownInstalled;

    // 7) Nollställ globala scroll-helpers (VIKTIGT!)
    // Detta säkerställer att nästa sida kan ladda dem på nytt.
    try { window.__teardownXbarSync?.(); } catch { }
    window.__teardownXbarSync = undefined;
    window.__setupXbarSync = undefined;

    console.log('✅ Starttider unload klar');
}