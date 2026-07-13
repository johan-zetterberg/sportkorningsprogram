// starttider.js — Korrigerad och rensad version

import { getEquipages } from '../../services/equipageService.js';
import { getConfig, saveConfig } from '../../services/competitionService.js';
import { listenForDressageProtocolsCollectionGroup, listenForDressageStatusCollection } from '../../services/dressageService.js';
import { listenForPrecisionResults } from '../../services/precisionService.js';
import { getMarathonTimingData, getMarathonStateDocuments, getMarathonResults } from '../../services/marathonService.js';
import { listenForMaratonCollection, listenForMarathonTimingUpdates } from '../../services/marathonService.js';
import { listenForDressageFinalizationCollection } from '../../services/dressageService.js';
import { generateStartListPdf } from '../../pdf/startListPdf.js';
import { getGlobalState } from '../../main.js';
import { getCurrentUserRole } from '../../services/authService.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { dressagePrograms } from '../../data/dressagePrograms.js';
import { getFlagHtml, } from '../../services/flagsService.js';
import {
    ensureClubLogosLoaded,
    getClubLogoHtml
} from '../../services/logosService.js';
import {
    debounce,
    downloadCsv,
    csvCell,
    resolveCurrentCompId,
    normalizeEquipage,
    sanitizeForFilename,
    isMobile,
    MOBILE_BP
} from '../../utils/sharedUtils.js';
import { doc, getDoc, onSnapshot, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../../config/firebase-config.js';

import { injectScrollStyles, initializeScrollSync } from '../../ui/scrollHelper.js';
import { getPrograms, deduplicateAndFilterProtocols } from '../../utils/dressageUtils.js';
import { calculateDressageResult, calculateMarathonResult } from '../../services/calculationService.js';
import { setMarathonConfig } from '../../utils/marathonUtils.js';
import { calculateTotalCompetitionPenalties } from '../../utils/sharedUtils.js';
import { t } from '../../utils/i18n.js';
import {
    addPauseAfterStartNumber,
    assignBulkStartTimes,
    buildLiveStatus,
    buildMarathonDressageResultRows,
    buildPrecisionDressageOrderRows,
    buildPrecisionResultOrderRows,
    buildStarttiderClassOptions,
    buildStarttiderMergeMap,
    byStartNumberAsc,
    formatDateTime,
    getStarttiderPublishButtonView,
    getPublishedState,
    getTimesOnlyPayload,
    moveStartTimeRow,
    parseDateTime,
    recalculateStartTimesFrom,
    renderStarttiderActionButtons,
    renderStarttiderDesktopBody,
    renderStarttiderDesktopHeader,
    renderStarttiderDesktopRow,
    renderStarttiderMobileCard,
    renderStarttiderNowNextChip,
    renderStarttiderPublishResetSection,
    renderStarttiderStatusBadge,
    renderStarttiderTimeCell,
    renderStarttiderToolbarSection,
    reorderStartTimeRow,
    resolveStarttiderStatus,
    resolveStarttiderMergeGrouping,
    sortStarttiderBulkRows,
    toDateTimeLocalString
} from './starttiderUtils.js';

// ======= Modulstat =======
let competitionId = null;
let equipages = [];
let startTimes = {};
let unsubscribers = new Map();
let pendingListenerRenderFrame = null;
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
let pdfDropdownOutsideClickHandler = null;

// Mobil-detektering importeras globalt från sharedUtils.js

// --- refs för att kunna ta bort lyssnare på unload ---
window.__starttiderResizeHandler = window.__starttiderResizeHandler || null;

// === NYTT: State-variabler och funktioner för sammanslagning ===
let starttider_displayConfig = {};
let starttider_MERGE_MAP = new Map();
const STARTTIDER_DISCIPLINES = [
    { key: 'dressage', label: 'Dressyr' },
    { key: 'marathon', label: 'Maraton' },
    { key: 'precision', label: 'Precision' }
];


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
    const state = resolveStarttiderStatus(kind, sn, {
        dressageStatusMap,
        dressageFinalizationMap,
        precisionResultsMap,
        marathonStatusMap,
        marathonTimingMap
    });

    return renderStarttiderStatusBadge(state, {
        doneLabel: t('done_status'),
        runningLabel: t('running_status'),
        notStartedLabel: t('not_started')
    });
}

let liveStatus = {
    current: null,
    next: null
};

function updateLiveStatus() {
    liveStatus = buildLiveStatus(startTimes);
}

function chipNowNext(discipline, sn) {
    return renderStarttiderNowNextChip(discipline, sn, liveStatus, {
        nowLabel: t('now_chip'),
        nextLabel: t('next_chip')
    });
}

function timeCell(key, sn, value, editable) {
    return renderStarttiderTimeCell({
        discipline: key,
        startNumber: sn,
        value,
        editable,
        publicMode,
        nowNextHtml: chipNowNext(key, sn),
        statusHtml: statusBadge(key, sn)
    });
}

function getStarttiderReadinessSummary() {
    const totalEquipages = equipages.length;
    const publishedState = getPublishedState(startTimes);

    return STARTTIDER_DISCIPLINES.map(({ key, label }) => {
        const scheduledCount = equipages.reduce((count, eq) => {
            const sn = String(eq.startNumber);
            return parseDateTime(startTimes?.[sn]?.[key]) ? count + 1 : count;
        }, 0);

        const published = !!publishedState[key];
        const hasAnyTimes = scheduledCount > 0;
        const isComplete = totalEquipages > 0 && scheduledCount === totalEquipages;

        let tone = 'amber';
        let status = 'Inte genererad';
        let detail = 'Inga starttider satta an.';

        if (published && !isComplete) {
            tone = 'red';
            status = 'Publicerad for tidigt';
            detail = `${scheduledCount} av ${totalEquipages} ekipage har tider, men listan ar redan publicerad.`;
        } else if (!hasAnyTimes) {
            tone = 'amber';
            status = 'Inte genererad';
            detail = 'Inga starttider satta an.';
        } else if (!isComplete) {
            tone = 'amber';
            status = 'Delvis klar';
            detail = `${scheduledCount} av ${totalEquipages} ekipage har tider.`;
        } else if (published) {
            tone = 'green';
            status = 'Klar och publicerad';
            detail = `Alla ${totalEquipages} ekipage har tider och listan ar publicerad.`;
        } else {
            tone = 'blue';
            status = 'Klar men opublicerad';
            detail = `Alla ${totalEquipages} ekipage har tider, men listan ar inte publicerad an.`;
        }

        return {
            key,
            label,
            published,
            scheduledCount,
            tone,
            status,
            detail
        };
    });
}

function renderStarttiderReadiness() {
    const container = document.getElementById('starttiderReadiness');
    if (!container) return;

    const isAdminUser = currentUserRole === 'admin' || currentUserRole === 'superadmin';
    if (!isAdminUser) {
        container.className = 'hidden';
        container.innerHTML = '';
        return;
    }

    if (!equipages.length) {
        container.className = 'mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100';
        container.innerHTML = `
            <div class="font-semibold">Starttider kan inte forberedas an</div>
            <div class="mt-1">Inga ekipage hittades. Lagg in ekipage forst.</div>
        `;
        return;
    }

    const readiness = getStarttiderReadinessSummary();
    const hasCritical = readiness.some(item => item.tone === 'red');
    const hasWarning = readiness.some(item => item.tone === 'amber' || item.tone === 'blue');

    let shellClass = 'mb-4 rounded-xl border p-4';
    let title = 'Starttider ser klara ut';
    let intro = 'Alla grenar har kompletta startlistor.';

    if (hasCritical) {
        shellClass += ' border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100';
        title = 'Starttider behover kompletteras';
        intro = 'Minst en startlista ar publicerad innan alla ekipage har fatt tider.';
    } else if (hasWarning) {
        shellClass += ' border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100';
        title = 'Starttider ar delvis forberedda';
        intro = 'Kontrollera grenarna nedan innan publicering.';
    } else {
        shellClass += ' border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100';
    }

    const toneClass = {
        red: 'border-red-200 bg-red-100/80 text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100',
        amber: 'border-amber-200 bg-amber-100/80 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
        blue: 'border-blue-200 bg-blue-100/80 text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100',
        green: 'border-emerald-200 bg-emerald-100/80 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100'
    };

    container.className = shellClass;
    container.innerHTML = `
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
                <h3 class="text-base font-semibold">${title}</h3>
                <p class="mt-1 text-sm opacity-90">${intro}</p>
            </div>
            <div class="text-sm opacity-80">${equipages.length} ekipage i planeringen</div>
        </div>
        <div class="mt-4 grid gap-3 md:grid-cols-3">
            ${readiness.map(item => `
                <div class="rounded-lg border p-3 ${toneClass[item.tone]}">
                    <div class="flex items-center justify-between gap-3">
                        <div class="font-semibold">${item.label}</div>
                        <div class="text-xs uppercase tracking-wide opacity-80">${item.published ? 'Publicerad' : 'Ej publicerad'}</div>
                    </div>
                    <div class="mt-2 text-sm font-medium">${item.status}</div>
                    <div class="mt-1 text-xs opacity-90">${item.detail}</div>
                </div>
            `).join('')}
        </div>
    `;
}


// ======= Drag-and-Drop Helpers =======
let draggedStartNumber = null;

function handleDragStart(e) {
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

    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval')?.value || 7));
    reorderStartTimeRow(startTimes, list, {
        discipline,
        droppedStartNumber: droppedSn,
        targetStartNumber: targetSn,
        intervalMin
    });

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
        <section id="starttiderReadiness" class="hidden"></section>
        
        <div class="${publicMode ? 'text-[15px]' : ''}">
          <div class="flex flex-col gap-3 mb-4 w-full">
             <div id="controlsContainer" class="w-full"></div>
             
             <!-- Public Search & View Filters -->
             <div class="flex flex-col gap-2 sm:flex-row sm:items-center w-full p-2 lg:p-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
                  <div class="search-input-wrap flex-1 min-w-0 relative">
                      <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10 text-xs"></i>
                      <input id="startlistSearch" type="search" placeholder="${t('search') || 'Sök ekipage...'}" class="w-full pl-8 pr-3 py-1.5 border rounded leading-5 dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 shadow-sm text-xs" autocomplete="off">
                  </div>
                      
                  <select id="publicViewModeSelect" class="w-full sm:w-auto flex-shrink-0 border rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 shadow-sm focus:ring-1 focus:ring-blue-500">
                      <option value="startorder"${viewMode === 'startorder' ? ' selected' : ''}>Startordning</option>
                      <option value="byclass"${viewMode === 'byclass' ? ' selected' : ''}>Per klass</option>
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
    renderStarttiderReadiness();
    syncViewModeControls();
}

function applyViewMode(nextMode) {
    viewMode = nextMode === 'byclass' ? 'byclass' : 'startorder';
    sortConfig = viewMode === 'byclass'
        ? { key: 'className', direction: 'asc' }
        : { key: 'startNumber', direction: 'asc' };

    if (viewMode === 'byclass' && document.getElementById('bulkClass')) {
        const classes = Array.from(new Set(equipages.map(eq => eq._mergedLabel || eq.className).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, 'sv'));
        document.getElementById('bulkClass').value = classes[0] || '';
    }
}

function syncViewModeControls() {
    const publicSelect = document.getElementById('publicViewModeSelect');
    if (publicSelect && publicSelect.value !== viewMode) {
        publicSelect.value = viewMode;
    }

    document.querySelectorAll('[data-mode]').forEach(btn => {
        const isActive = btn.dataset.mode === viewMode;
        btn.classList.toggle('bg-gray-100', isActive);
        btn.classList.toggle('dark:bg-gray-700', isActive);
        btn.classList.toggle('text-blue-700', isActive);
        btn.classList.toggle('dark:text-white', isActive);
    });
}

function requestListenerRender() {
    if (pendingListenerRenderFrame) return;
    pendingListenerRenderFrame = requestAnimationFrame(() => {
        pendingListenerRenderFrame = null;
        render();
    });
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
        const renderActions = (discipline) => {
            return renderStarttiderActionButtons({
                discipline,
                startNumber: e.startNumber,
                index,
                totalRows: totalEquipages,
                variant: 'desktop',
                labels: {
                    pause: t('pause_btn'),
                    moveUp: t('move_up'),
                    moveDown: t('move_down')
                }
            });
        };

        return renderStarttiderDesktopRow({
            equipage: e,
            startTimes,
            index,
            totalRows: totalEquipages,
            isEditable,
            publicMode,
            enableDnD,
            isEliminated: isEliminatedOrIncomplete(e),
            getHorseLabel: horseLabel,
            getFlagHtml,
            getClubLogoHtml,
            renderTimeCell: timeCell,
            renderActions,
            unpublishedHtml: '<span class="text-xs text-gray-400 italic">Ej publicerad</span>'
        });
    };

    const headers = [
        { key: 'startNumber', label: '#' }, { key: 'driverName', label: t('equipage') },
        { key: 'className', label: t('class') }, { key: 'clubName', label: t('country_club') },
        { key: 'dressage', label: t('dressage') }, { key: 'marathon', label: t('marathon') },
        { key: 'precision', label: t('precision') }
    ];
    if (isEditable) headers.push({ key: 'actions', label: t('actions') });

    const headerHtml = renderStarttiderDesktopHeader(headers, sortConfig);
    const bodyHtml = renderStarttiderDesktopBody(sortedEquipages, {
        viewMode,
        colspan: headers.length,
        renderRow: renderEquipageRow
    });

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
    const setupXbarSync = window.__setupXbarSync;
    if (hostEl && typeof setupXbarSync === 'function') {
        // Delay to ensure table layout is ready
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!document.body?.contains(hostEl)) return;
                try {
                    setupXbarSync({
                        barClass: 'fixed-xbar',
                        innerId: 'starttiderXbarInner',
                        hostEl: hostEl
                    });
                } catch (error) {
                    console.warn('Kunde inte initiera x-scrollsynk för starttider:', error);
                }
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
    let lastClass = null;

    const cardsHtml = sorted.map((e, index) => {
        let classHeader = '';
        if (viewMode === 'byclass' && (e._mergedLabel || e.className) !== lastClass) {
            lastClass = (e._mergedLabel || e.className);
            classHeader = `<div class="px-2 py-1 mt-2 mb-1 bg-blue-100 text-blue-800 font-bold text-sm rounded-md">${e._mergedLabel || e.className}</div>`;
        }

        const renderActions = (discipline) => {
            if (!isEditable) return '';

            return renderStarttiderActionButtons({
                discipline,
                startNumber: e.startNumber,
                index,
                totalRows: sorted.length,
                variant: 'mobile',
                labels: {
                    pause: t('pause_btn'),
                    moveUp: t('move_up'),
                    moveDown: t('move_down')
                }
            });
        };

        return renderStarttiderMobileCard({
            equipage: e,
            startTimes,
            index,
            totalRows: sorted.length,
            isEditable,
            isEliminated: isEliminatedOrIncomplete(e),
            classHeaderHtml: classHeader,
            getHorseLabel: horseLabel,
            renderStatus: statusBadge,
            renderActions,
            labels: {
                class: 'Klass:',
                dressage: 'Dressyr:',
                marathon: 'Maraton:',
                precision: 'Precision:',
                actions: t('actions')
            },
            unpublishedHtml: '<span class="text-gray-400 italic text-[11px]">Ej publicerad</span>'
        });
    }).join('');

    container.innerHTML = `<div class="bg-transparent py-1">${cardsHtml}</div>`;
}
// ======= Kontroller och Event Listeners =======
function doBulkFill(key) {
    const cls = document.getElementById('bulkClass').value;
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));
    const onlyEmpty = document.getElementById('bulkOnlyEmpty').checked;
    const dressageOrder = document.querySelector('input[name="dressageSortMode"]:checked')?.value || 'startnumber';

    if (!firstDateTimeStr) {
        showAlert(t('valid_start_time_req'), 'warning');
        return;
    }

    const firstDateTime = new Date(firstDateTimeStr);
    if (isNaN(firstDateTime.getTime())) {
        showAlert(t('valid_date_req'), 'warning');
        return;
    }

    const rows = sortStarttiderBulkRows(
        equipages.filter(e => !cls || (e._mergedLabel || e.className) === cls),
        { order: key === 'dressage' ? dressageOrder : 'startnumber' }
    );
    assignBulkStartTimes(startTimes, rows, {
        discipline: key,
        firstDateTime,
        intervalMin,
        onlyEmpty
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
            doBulkFill('precision'); // Använder den befintliga standardfunktionen
            break;
        case 'dressageOrder':
            generatePrecisionByDressageOrder();
            break;
        case 'resultsOrder':
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

    const sortedByDressage = buildPrecisionDressageOrderRows(equipages, startTimes, {
        className: cls,
        includeEliminated: includeElim
    });

    const { assignedCount } = assignBulkStartTimes(startTimes, sortedByDressage, {
        discipline: 'precision',
        firstDateTime,
        intervalMin,
        onlyEmpty
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

    const getDressageResultFor = (e) => {
        const sn = String(e.startNumber);
        const rawProtocols = window.__dressageCache?.get(sn);
        const protocols = rawProtocols ? Array.from(rawProtocols.values()) : [];
        const programs = getPrograms();
        const validProtos = deduplicateAndFilterProtocols(protocols, []);
        return calculateDressageResult(e, validProtos, [], programs);
    };
    const getProtocolCountFor = (e) => {
        const rawProtocols = window.__dressageCache?.get(String(e.startNumber));
        return rawProtocols ? Array.from(rawProtocols.values()).length : 0;
    };
    const { rankedRows: rankedEquipages, diagnostics } = buildMarathonDressageResultRows(equipages, {
        className: cls,
        includeEliminated: includeElim,
        getDressageResult: getDressageResultFor,
        getProtocolCount: getProtocolCountFor
    });

    if (rankedEquipages.length === 0) {
        showAlert(`Kunde inte generera startlista (0 ekipage hittades).\n\nDiagnosinfo:\nStartnummer dubbelkollade i klassen: ${diagnostics.totalChecked}\nAntal hittade protokoll i cache: ${diagnostics.totalProtos}\nAntal ekipage som saknade straffpoäng (null): ${diagnostics.missingPenalties}`, 'error', 15000);
        return;
    }

    const { assignedCount } = assignBulkStartTimes(startTimes, rankedEquipages, {
        discipline: 'marathon',
        firstDateTime,
        intervalMin,
        onlyEmpty
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

    const getDressageResultFor = (e) => {
        const sn = String(e.startNumber);
        const rawProtocols = window.__dressageCache?.get(sn);
        const protocols = rawProtocols ? Array.from(rawProtocols.values()) : [];
        const programs = getPrograms();
        const validProtos = deduplicateAndFilterProtocols(protocols, []);
        return calculateDressageResult(e, validProtos, [], programs);
    };
    const rankedEquipages = buildPrecisionResultOrderRows(equipages, {
        className: cls,
        includeEliminated: includeElim,
        getDressageResult: getDressageResultFor,
        getMarathonData: (e) => marathonMap.get(String(e.startNumber)) || {},
        getMarathonResult: (e, data) => calculateMarathonResult(e, data, data)
    });

    const { assignedCount } = assignBulkStartTimes(startTimes, rankedEquipages, {
        discipline: 'precision',
        firstDateTime,
        intervalMin,
        onlyEmpty
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

    addPauseAfterStartNumber(startTimes, sortedEquipages, {
        discipline,
        afterStartNumber,
        pauseMinutes
    });

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

    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval')?.value || 7));
    const result = moveStartTimeRow(startTimes, sortedEquipages, {
        discipline,
        startNumber,
        direction,
        intervalMin
    });
    if (result.error) return;

    render();
    updateNextStartTimes();
}

/**
 * Hjälpfunktion som räknar om alla starttider från ett visst index i en sorterad lista.
 */
function recalculateTimesFrom(sortedList, discipline, startIndex) {
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval')?.value || 7));
    const result = recalculateStartTimesFrom(startTimes, sortedList, { discipline, startIndex, intervalMin });
    if (result.error === 'previous-missing') showAlert(t('cant_calc_prev_missing'), 'error');
    if (result.error === 'first-missing') showAlert(t('cant_calc_first_missing'), 'error');
}

async function togglePublish(key) {
    if (!startTimes.published) startTimes.published = {};
    startTimes.published[key] = !startTimes.published[key];

    // Optimistisk uppdatering UI
    bindAllControls();
    renderStarttiderReadiness();

    try {
        // Separera times och published för att matcha strukturen i Firestore
        await saveConfig(competitionId, 'startTimes', {
            times: getTimesOnlyPayload(startTimes),
            published: startTimes.published
        });
    } catch (err) {
        console.error("Failed to save publish state", err);
        showAlert("Kunde inte spara publiceringsstatus", "error");
        // Revert vid fel
        startTimes.published[key] = !startTimes.published[key];
        bindAllControls();
        renderStarttiderReadiness();
    }
}

async function saveTimes() {
    const payload = {
        times: getTimesOnlyPayload(startTimes),
        published: getPublishedState(startTimes),
        updatedAt: Date.now()
    };
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
    const isAdminUser = userRole === 'admin' || userRole === 'superadmin';

    if (isAdminUser) {
    const { classes, html: classOptions } = buildStarttiderClassOptions(equipages, t('all_classes_opt'));

    const pubState = getPublishedState(startTimes);
    const readinessByKey = new Map(getStarttiderReadinessSummary().map(item => [item.key, item]));
    const publishButton = (key, options) => {
        const readiness = readinessByKey.get(key);
        const warningState = readiness?.published && readiness?.tone === 'red'
            ? 'published-incomplete'
            : (readiness && readiness.scheduledCount < equipages.length ? 'incomplete' : null);
        const warningText = warningState === 'published-incomplete'
            ? 'Ofullstandig lista'
            : (warningState === 'incomplete'
                ? `${readiness?.scheduledCount || 0}/${equipages.length} tider satta`
                : '');
        return getStarttiderPublishButtonView(key, pubState, {
            ...options,
            warningState,
            warningText
        });
    };
    const pubDressage = publishButton('dressage', { colorClass: 'bg-slate-600', borderClass: 'border-slate-300', shortLabel: 'D' });
    const pubMarathon = publishButton('marathon', { colorClass: 'bg-emerald-600', borderClass: 'border-emerald-300', shortLabel: 'M' });
    const pubPrecision = publishButton('precision', { colorClass: 'bg-indigo-600', borderClass: 'border-indigo-300', shortLabel: 'P' });

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
        <div class="p-3 bg-slate-50 dark:bg-slate-900/20 rounded-md border border-slate-100 dark:border-slate-700">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-2">Generera dressyr</h4>
            <div class="grid gap-2 text-sm sm:grid-cols-2">
                <label class="flex items-center">
                    <input type="radio" id="modeDressageStartNumber" name="dressageSortMode" value="startnumber" class="h-4 w-4 text-slate-600 focus:ring-slate-500" checked>
                    <span class="ml-2 text-gray-700 dark:text-gray-300">Startnummerordning</span>
                </label>
                <label class="flex items-center">
                    <input type="radio" id="modeDressageClasswise" name="dressageSortMode" value="classwise" class="h-4 w-4 text-slate-600 focus:ring-slate-500">
                    <span class="ml-2 text-gray-700 dark:text-gray-300">Klassvis</span>
                </label>
            </div>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Klassvis grupperar valda ekipage per klass och behåller startnummerordning inom varje klass.</p>
            <button id="bulkDressage" class="mt-3 w-full px-3 py-2 text-sm font-semibold rounded-md bg-slate-600 text-white hover:bg-slate-700 shadow flex justify-between items-center">
                ${t('generate_dressage')} <span id="nextTimeDressage" class="text-xs opacity-80 font-normal ml-2"></span>
            </button>
        </div>
        
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

${renderStarttiderPublishResetSection({
    publishButtons: {
        dressage: pubDressage,
        marathon: pubMarathon,
        precision: pubPrecision
    },
    labels: {
        publishTitle: 'Publicering av Startlistor',
        resetTitle: t('reset_sections'),
        clearDressage: t('clear_dressage'),
        clearMarathon: t('clear_marathon'),
        clearPrecision: t('clear_precision')
    }
})}

${renderStarttiderToolbarSection({
    publicMode,
    labels: {
        editorMode: t('editor_mode'),
        publicMode: t('public_mode'),
        saveTimes: t('save_times'),
        startOrder: t('start_order'),
        groupByClass: t('group_by_class'),
        pdfDressage: t('startlist_dressage'),
        pdfMarathon: t('startlist_marathon'),
        pdfPrecision: t('startlist_precision')
    }
})}
    `;
    }

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
        applyViewMode(e.target.value);
        render();
    });
    document.getElementById('bulkInterval')?.addEventListener('input', updateNextStartTimes);
    document.getElementById('clearDressage')?.addEventListener('click', () => clearDisciplineTimes('dressage'));
    document.getElementById('clearMarathon')?.addEventListener('click', () => clearDisciplineTimes('marathon'));
    document.getElementById('clearPrecision')?.addEventListener('click', () => clearDisciplineTimes('precision'));

    // Fix View Mode Buttons (Active State)
    document.getElementById('viewModeStartOrder')?.addEventListener('click', () => {
        applyViewMode('startorder');
        render();
    });
    document.getElementById('viewModeByClass')?.addEventListener('click', () => {
        applyViewMode('byclass');
        render();
    });
    syncViewModeControls();



    document.getElementById('btnExportStarttiderCsv')?.addEventListener('click', generateCsvWrapper);

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
                renderStarttiderReadiness();
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

        if (pdfDropdownOutsideClickHandler) {
            document.removeEventListener('click', pdfDropdownOutsideClickHandler);
        }

        pdfDropdownOutsideClickHandler = (e) => {
            if (pdfContainer && !pdfContainer.contains(e.target)) {
                pdfMenu.classList.add('hidden');
            }
        };
        document.addEventListener('click', pdfDropdownOutsideClickHandler);

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
    starttider_MERGE_MAP = buildStarttiderMergeMap(mergeCfgA || mergeCfgB || mergeCfgC || starttider_displayConfig);

    // === ÄNDRING: Dekorera ekipage-listan ===
    equipages = (equipagesData || [])
        .filter(e => {
            const ne = normalizeEquipage(e);
            return ne.startNumber && ne.status !== 'struken';
        })
        .map(e => {
            const ne = normalizeEquipage(e);
            const g = resolveStarttiderMergeGrouping(ne, starttider_MERGE_MAP);
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
        requestListenerRender();
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
        if (changed) requestListenerRender();
    });
    unsubscribers.set('marathonTiming', unTimingCol);

    const unStatusCol = listenForDressageStatusCollection(competitionId, (docs) => {
        docs.forEach(st => {
            if (st) dressageStatusMap.set(String(st.id), st);
        });
        requestListenerRender();
    });
    unsubscribers.set('dressageStatus', unStatusCol);

    const unPrec = listenForPrecisionResults(competitionId, (docs) => {
        precisionResultsMap.clear();
        docs.forEach(d => precisionResultsMap.set(String(d.startNumber ?? d.id), d));
        requestListenerRender();
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
        if (changed) requestListenerRender();
    });
    unsubscribers.set('marathonStatus', unMarStatus);

    const unDressFin = listenForDressageFinalizationCollection(competitionId, (docs) => {
        dressageFinalizationMap.clear();
        docs.forEach(d => dressageFinalizationMap.set(String(d.id), d)); // id på doc är startnr
        requestListenerRender();
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

            starttider_MERGE_MAP = buildStarttiderMergeMap(snap.id === 'display' ? { mergeByClassNumber: data?.mergeByClassNumber || {} } : data);

            // Märk om alla ekipage
            equipages = equipages.map(e => ({
                ...e,
                _mergedKey: resolveStarttiderMergeGrouping(e, starttider_MERGE_MAP).key,
                _mergedLabel: resolveStarttiderMergeGrouping(e, starttider_MERGE_MAP).label
            }));

            requestListenerRender(); // Rita om

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
    await ensureClubLogosLoaded(competitionId);

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

    // 1) Ta bort resize-lyssnare
    if (window.__starttiderResizeHandler) {
        try { window.removeEventListener('resize', window.__starttiderResizeHandler); } catch { }
        window.__starttiderResizeHandler = null;
    }

    if (pdfDropdownOutsideClickHandler) {
        try { document.removeEventListener('click', pdfDropdownOutsideClickHandler); } catch { }
        pdfDropdownOutsideClickHandler = null;
    }

    if (pendingListenerRenderFrame) {
        try { cancelAnimationFrame(pendingListenerRenderFrame); } catch { }
        pendingListenerRenderFrame = null;
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

}

