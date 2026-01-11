// starttider.js — Korrigerad och rensad version

import {
    getEquipages,
    getConfig,
    saveConfig,
    listenForDressageProtocolsCollectionGroup,
    listenForPrecisionResults,
    getMarathonTimingData,
    getMarathonResults,
    listenForMaratonCollection,
    listenForDressageFinalizationCollection,
    listenForDressageStatusCollection,
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
    sanitizeForFilename
} from '../utils/sharedUtils.js';
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';

import { injectScrollStyles, initializeScrollSync } from '../ui/scrollHelper.js';
import { calculateAggregateDressagePenalty } from '../utils/dressageUtils.js';
import { calculateTotalCompetitionPenalties } from '../utils/sharedUtils.js';

// ======= Modulstat =======
let competitionId = null;
let equipages = [];
let startTimes = {};
let unsubscribers = new Map();
let precisionResultsMap = new Map();
let marathonTimingMap = new Map();
let marathonObstacleTouch = 0;
let marathonStatusMap = new Map();
let dressageStatusMap = new Map();
let dressageFinalizationMap = new Map();
let publicMode = false;
let sortConfig = { key: 'startNumber', direction: 'asc' };
let clockTimer = null;
let currentUserRole = 'publik';
let marathonResultsMap = new Map();
let viewMode = 'startorder'; // 'startorder' eller 'byclass'

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
    const list = [...equipages];

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
            displayElement.textContent = 'Första tid?';
            return;
        }

        const latestTime = existingTimes[existingTimes.length - 1];
        const nextTimestamp = latestTime.getTime() + (intervalMin * 60 * 1000);
        const nextDate = new Date(nextTimestamp);
        displayElement.textContent = `Nästa: ${formatDateTime(nextDate)}`;
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
    if (state === 'done') return `<span class="${base} bg-green-100 text-green-800">Klart</span>`;
    if (state === 'running') return `<span class="${base} bg-yellow-100 text-yellow-800">Pågår</span>`;
    return `<span class="${base} bg-gray-100 text-gray-700">Ej startat</span>`;
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
        return `<span class="${base} bg-red-100 text-red-700">Nu</span>`;
    }
    if (liveStatus.next && liveStatus.next.sn === sn && liveStatus.next.discipline === discipline) {
        return `<span class="${base} bg-blue-100 text-blue-700">Nästa</span>`;
    }
    return '';
}

function timeCell(key, sn, value, editable) {
    const id = `${key}-${sn}`;
    const badges = `${chipNowNext(key, sn)} <span class="ml-1">${statusBadge(key, sn)}</span>`;
    const dateObj = parseDateTime(value);
    const displayValue = formatDateTime(dateObj);

    if (!editable || publicMode) {
        return `<div class="flex flex-col gap-1">${displayValue}<div class="flex items-center gap-1">${badges}</div></div>`;
    }

    const inputValue = value || '';

    return `
    <div class="flex flex-col gap-1">
      <input id="${id}" type="datetime-local" class="w-36 px-1 py-1 text-xs rounded border border-gray-300 focus:ring-2 focus:ring-blue-500" value="${inputValue}">
      <div class="flex items-center gap-1">${badges}</div>
    </div>`;
}


// ======= Rendering =======
function renderLayout() {
    const competition = getGlobalState('currentCompetition');
    const page = document.getElementById('page-starttider');

    page.innerHTML = `
    <div class="container mx-auto p-4 md:p-8">
        ${getCompetitionHeader(competition, 'Startlista & Live')}
        
        <div class="${publicMode ? 'text-[15px]' : ''}">
          <div class="flex flex-col md:flex-row gap-4 mb-4 justify-between items-center">
             <div id="controlsContainer"></div>
             <div id="controlsContainer"></div>
             ${publicMode ? '' : ''}
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

// BORTTAGEN: installAutoTeardownForStarttider() har tagits bort.

// ======= Rendering =======
function render() {
    // NYTT: Logik från deltagare.js
    if (isMobile()) {
        window.__teardownXbarSync?.(); // Städa upp scrollbaren i mobilvy
        renderMobile();
    } else {
        renderDesktop();
    }
    // BORTTAGEN: try { __stEnsureXbar(); } catch {}
}

// Renderar mobilvyn med kort
function renderMobile() {
    // NYTT: Ändrad container-logik
    const container = document.getElementById('startlist-container');
    if (!container) return;

    const isEditable = !publicMode && currentUserRole === 'admin';
    const sorted = getSortedEquipages();
    let lastClass = null;

    const cardsHtml = sorted.map((e, index) => {
        const st = startTimes[String(e.startNumber)] || {};
        let classHeader = '';
        if (viewMode === 'byclass' && (e._mergedLabel || e.className) !== lastClass) { // Ändrad kontroll
            lastClass = (e._mergedLabel || e.className); // Ändrad tilldelning
            classHeader = `<div class="px-4 py-2 mt-2 bg-blue-100 text-blue-800 font-bold text-lg rounded-md">${e._mergedLabel || e.className}</div>`; // Ändrad visning
        }

        const timeRow = (discipline, value) => {
            const dateObj = parseDateTime(value);
            if (isEditable) {
                return `<input id="${discipline}-${e.startNumber}" type="datetime-local" class="flex-1 w-full px-2 py-1 rounded border border-gray-300" value="${value || ''}">`;
            }
            return `<span class="font-semibold">${formatDateTime(dateObj)}</span>`;
        };

        // NY HJÄLPFUNKTION: Skapar åtgärdsknapparna för en disciplin
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
                    <button class="action-btn text-gray-600 hover:text-blue-600" data-action="pause" data-discipline="${discipline}" data-sn="${e.startNumber}" title="Paus">☕</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${index === 0 ? 'opacity-25' : ''}" data-action="move" data-discipline="${discipline}" data-dir="up" data-sn="${e.startNumber}" title="Flytta upp">▲</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${index === sorted.length - 1 ? 'opacity-25' : ''}" data-action="move" data-discipline="${discipline}" data-dir="down" data-sn="${e.startNumber}" title="Flytta ner">▼</button>
                </div>
            </div>`;
        };

        return `
            ${classHeader}
            <div class="m-2 rounded-xl border shadow-sm bg-white overflow-hidden">
                <div class="px-4 py-3 border-b bg-gray-50">
                    <div class="font-semibold text-lg">#${e.startNumber} ${e.driverName}</div>
                    <div class="text-sm text-gray-500 italic">${horseLabel(e)}</div>
                </div>
                <div class="p-4 space-y-3 text-sm">
                    <div class="flex justify-between items-center"><span class="text-gray-500">Klass:</span><span class="font-medium">${e._mergedLabel || e.className || '—'}</span></div>
                    <div class="flex justify-between items-center gap-2 pt-2 border-t"><span class="text-gray-500 w-16">Dressyr:</span>${timeRow('dressage', st.dressage)}<div class="flex items-center gap-1">${statusBadge('dressage', e.startNumber)}</div></div>
                    <div class="flex justify-between items-center gap-2 pt-2 border-t"><span class="text-gray-500 w-16">Maraton:</span>${timeRow('marathon', st.marathon)}<div class="flex items-center gap-1">${statusBadge('marathon', e.startNumber)}</div></div>
                    <div class="flex justify-between items-center gap-2 pt-2 border-t"><span class="text-gray-500 w-16">Precision:</span>${timeRow('precision', st.precision)}<div class="flex items-center gap-1">${statusBadge('precision', e.startNumber)}</div></div>
                </div>
                ${isEditable ? `
                <div class="px-4 py-2 border-t bg-gray-50 space-y-2">
                    <div class="text-xs font-semibold text-gray-500">Åtgärder</div>
                    ${actionButtons('dressage')}
                    ${actionButtons('marathon')}
                    ${actionButtons('precision')}
                </div>
                ` : ''}
            </div>
        `;
    }).join('');

    // NYTT: Uppdatera container.innerHTML
    container.innerHTML = `<div class="bg-gray-50 py-1">${cardsHtml}</div>`;
    // BORTTAGEN: Manuell hantering av .tr-xbar
}

function renderDesktop() {
    // NYTT: Ändrad container-logik
    const container = document.getElementById('startlist-container');
    if (!container) return;

    // Återskapa desktop-strukturen som den var i renderLayout
    container.innerHTML = `
      <div class="rounded-lg shadow ring-1 ring-black/5">
        <div id="starttider-x-wrap" class="x-scroll-wrap">
          <table id="startlist-table" class="min-w-full divide-y divide-gray-100 bg-white">
            </table>
        </div>
      </div>`;

    const table = container.querySelector('#startlist-table'); // Hitta den nyss skapade tabellen
    if (!table) return;

    const isEditable = !publicMode && currentUserRole === 'admin';
    const sortedEquipages = getSortedEquipages();

    const renderEquipageRow = (e, index, totalEquipages) => {
        const st = startTimes[String(e.startNumber)] || {};
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
                    <button class="action-btn text-gray-600 hover:text-blue-600" data-action="pause" data-discipline="${discipline}" data-sn="${e.startNumber}" title="Lägg in paus i ${discipline} efter detta ekipage">☕</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${index === 0 ? 'opacity-25 cursor-not-allowed' : ''}" data-action="move" data-discipline="${discipline}" data-dir="up" data-sn="${e.startNumber}" title="Flytta upp i ${discipline}" ${index === 0 ? 'disabled' : ''}>▲</button>
                    <button class="action-btn text-gray-600 hover:text-green-600 ${index === totalEquipages - 1 ? 'opacity-25 cursor-not-allowed' : ''}" data-action="move" data-discipline="${discipline}" data-dir="down" data-sn="${e.startNumber}" title="Flytta ner i ${discipline}" ${index === totalEquipages - 1 ? 'disabled' : ''}>▼</button>
                </div>
            </div>`;
        };

        return `
            <tr class="align-top ${publicMode ? 'hover:bg-gray-50' : ''}">
                <td class="px-3 py-3 text-sm text-gray-700 text-center">${e.startNumber ?? ''}</td>
                <td class="px-3 py-3 text-sm min-w-[12rem]">
                  <div class="font-medium text-gray-900">${e.driverName || ''}</div>
                    <div class="text-xs text-gray-600 italic">${horseLabel(e)}</div>
                </td>
                <td class="px-3 py-3 text-sm text-gray-700">${e._mergedLabel || e.className || ''}</td>
                <td class="px-3 py-3 text-sm text-gray-700">
                    <div class="flex items-center gap-2" title="${e.clubName || ''}">
                        ${getFlagHtml(e)}
                        ${getClubLogoHtml(e)}
                        <span class="hidden lg:inline-block truncate" style="max-width: 150px;">${e.clubName || ''}</span>
                    </div>
                </td>
                <td class="px-3 py-3">${timeCell('dressage', e.startNumber, st.dressage, isEditable)}</td>
                <td class="px-3 py-3">${timeCell('marathon', e.startNumber, st.marathon, isEditable)}</td>
                <td class="px-3 py-3">${timeCell('precision', e.startNumber, st.precision, isEditable)}</td>
                ${isEditable ? `
                <td class="px-3 py-3 text-sm">
                    <div class="flex flex-col items-center gap-1.5">
                        ${actionButtons('dressage')}
                        ${actionButtons('marathon')}
                        ${actionButtons('precision')}
                    </div>
                </td>` : ''}
            </tr>`;
    };

    const headers = [
        { key: 'startNumber', label: 'Nr' }, { key: 'driverName', label: 'Ekipage' },
        { key: 'className', label: 'Klass' }, { key: 'clubName', label: 'Förening/Nation' },
        { key: 'dressage', label: 'Dressyr' }, { key: 'marathon', label: 'Maraton' },
        { key: 'precision', label: 'Precision' }
    ];
    if (isEditable) headers.push({ key: 'actions', label: 'Åtgärder' });

    const headerHtml = `<thead class="bg-gray-50 text-xs"><tr>${headers.map(h => {
        const isSortable = !!h.key;
        const cursor = isSortable ? 'cursor-pointer' : '';
        const isSorted = sortConfig.key === h.key;
        const arrow = isSorted ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '';
        return `<th data-key="${h.key}" class="${isSortable ? 'sortable-header' : ''} px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider select-none ${cursor}">${h.label} ${arrow}</th>`;
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
            bodyHtml += `<tr><td colspan="${colspan}" class="px-3 py-2 bg-gray-100 font-bold text-gray-800 sticky top-0 z-10">${className}</td></tr>`;
            bodyHtml += grouped[className].map((e, i) => renderEquipageRow(e, i, sortedEquipages.length)).join('');
        }
    } else {
        bodyHtml = sortedEquipages.map((e, i) => renderEquipageRow(e, i, sortedEquipages.length)).join('');
    }

    // NYTT: Sätt innerHTML på tabellen
    table.innerHTML = `${headerHtml}<tbody>${bodyHtml}</tbody>`;

    // NYTT: Anropa __setupXbarSync (från deltagare.js)
    const hostEl = document.getElementById('starttider-x-wrap');
    if (hostEl && window.__setupXbarSync) {
        window.__setupXbarSync({
            barClass: 'tr-xbar', // Behåll din klass
            innerId: 'starttiderXbarInner',
            hostEl: hostEl
        });
    }
}

// ======= Kontroller och Event Listeners =======
function doBulkFill(key) {
    const cls = document.getElementById('bulkClass').value;
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));
    const onlyEmpty = document.getElementById('bulkOnlyEmpty').checked;

    if (!firstDateTimeStr) {
        showAlert('Ange en giltig första starttid (datum och tid).', 'warning');
        return;
    }

    const firstDateTime = new Date(firstDateTimeStr);
    if (isNaN(firstDateTime.getTime())) {
        showAlert('Det angivna datumet eller tiden är ogiltig.', 'warning');
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
            showAlert('Vänligen välj en metod för att generera startlistan.', 'warning');
            break;
    }
}

/**
 * Genererar startlista för koner baserat på startordningen i dressyren.
 */
function generatePrecisionByDressageOrder() {
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));

    if (!firstDateTimeStr) {
        showAlert('Ange en giltig första starttid för konerna.', 'warning');
        return;
    }
    const firstDateTime = new Date(firstDateTimeStr);

    // Sortera ekipage baserat på deras befintliga dressyrtid
    const sortedByDressage = [...equipages].sort((a, b) => {
        const timeA = parseDateTime(startTimes[String(a.startNumber)]?.dressage)?.getTime() || Infinity;
        const timeB = parseDateTime(startTimes[String(b.startNumber)]?.dressage)?.getTime() || Infinity;
        return timeA - timeB;
    });

    let currentTimestamp = firstDateTime.getTime();
    sortedByDressage.forEach(e => {
        const sn = String(e.startNumber);
        if (!startTimes[sn]) startTimes[sn] = {};
        startTimes[sn].precision = toDateTimeLocalString(new Date(currentTimestamp));
        currentTimestamp += intervalMin * 60 * 1000;
    });

    render();
    updateNextStartTimes();
    showAlert('Startlista för koner har genererats baserat på dressyrordningen.', 'success');
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
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));

    if (!firstDateTimeStr) {
        showAlert('Ange en giltig första starttid för maratonen.', 'warning');
        return;
    }
    const firstDateTime = new Date(firstDateTimeStr);

    const rankedEquipages = equipages.map(e => {
        const sn = String(e.startNumber);
        const protos = window.__dressageCache?.get(sn);
        return {
            ...e,
            dressagePenalty: calculateAggregateDressagePenalty(protos, dressagePrograms)
        };
    }).filter(e => e.dressagePenalty !== null);

    // Sortera: Högst straffpoäng (sämst resultat) startar först.
    rankedEquipages.sort((a, b) => b.dressagePenalty - a.dressagePenalty);

    let currentTimestamp = firstDateTime.getTime();
    rankedEquipages.forEach(e => {
        const sn = String(e.startNumber);
        if (!startTimes[sn]) startTimes[sn] = {};
        startTimes[sn].marathon = toDateTimeLocalString(new Date(currentTimestamp));
        currentTimestamp += intervalMin * 60 * 1000;
    });

    render();
    updateNextStartTimes();
    showAlert(`Startlista för maraton har genererats för ${rankedEquipages.length} ekipage baserat på dressyrresultat.`, 'success');
}

/**
 * Genererar startlista för koner baserat på omvänd resultatordning från Dressyr + Maraton.
 */
function generatePrecisionByResults() {
    const firstDateTimeStr = document.getElementById('bulkFirst').value;
    const intervalMin = Math.max(1, Number(document.getElementById('bulkInterval').value || 7));

    if (!firstDateTimeStr) {
        showAlert('Ange en giltig första starttid för konerna.', 'warning');
        return;
    }
    const firstDateTime = new Date(firstDateTimeStr);

    // Skapa en lista med ekipage och deras summerade straffpoäng
    const rankedEquipages = equipages.map(e => {
        const sn = String(e.startNumber);
        const protos = window.__dressageCache?.get(sn);
        const dPenalty = calculateAggregateDressagePenalty(protos, dressagePrograms);
        const mResult = marathonResultsMap.get(sn);
        return {
            ...e,
            totalPenalty: calculateTotalCompetitionPenalties(dPenalty, mResult)
        };
    })
        // Filtrera bort de som är eliminerade eller saknar resultat (totalPenalty är null)
        .filter(e => e.totalPenalty !== null);

    // Sortera listan: Högst straffpoäng startar först (omvänd sortering).
    rankedEquipages.sort((a, b) => b.totalPenalty - a.totalPenalty);

    let currentTimestamp = firstDateTime.getTime();
    rankedEquipages.forEach(e => {
        const sn = String(e.startNumber);
        if (!startTimes[sn]) startTimes[sn] = {};
        startTimes[sn].precision = toDateTimeLocalString(new Date(currentTimestamp));
        currentTimestamp += intervalMin * 60 * 1000;
    });

    render();
    updateNextStartTimes();
    showAlert(`Startlista för koner har genererats för ${rankedEquipages.length} ekipage baserat på resultat (D+M).`, 'success');
}

/**
 * Lägger in en paus i en tidslinje genom att skjuta fram alla efterföljande tider.
 */
function insertPause(discipline, afterStartNumber) {
    const pauseMinutes = parseInt(prompt("Ange pausens längd i minuter:", "15"), 10);
    if (isNaN(pauseMinutes) || pauseMinutes <= 0) return;

    // Sortera ekipagen baserat på den aktuella grenens starttid för att få rätt ordning
    const sortedEquipages = [...equipages].sort((a, b) => {
        const timeA = parseDateTime(startTimes[String(a.startNumber)]?.[discipline])?.getTime() || Infinity;
        const timeB = parseDateTime(startTimes[String(b.startNumber)]?.[discipline])?.getTime() || Infinity;
        return timeA - timeB;
    });

    const startIndex = sortedEquipages.findIndex(e => e.startNumber == afterStartNumber);

    if (startIndex === -1 || startIndex === sortedEquipages.length - 1) {
        showAlert('Kan inte lägga in paus efter sista ekipaget.', 'warning');
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
    showAlert(`Paus på ${pauseMinutes} minuter tillagd i ${discipline}.`, 'info');
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

    // Byt plats på de två ekipagen i vår sorterade array
    [sortedEquipages[currentIndex], sortedEquipages[newIndex]] = [sortedEquipages[newIndex], sortedEquipages[currentIndex]];

    // Nu räknar vi om alla tider från den första av de två som bytte plats
    recalculateTimesFrom(sortedEquipages, discipline, Math.min(currentIndex, newIndex));

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
            showAlert('Kan inte räkna om tider, föregående tid saknas.', 'error');
            return;
        }
        // Nästa tid ska vara ankartiden + ett intervall
        baseTime = anchorTime.getTime() + (intervalMin * 60 * 1000);

    } else {
        // Om vi börjar från allra första, behåll dess tid och räkna om resten
        const firstSn = String(sortedList[0].startNumber);
        baseTime = parseDateTime(startTimes[firstSn]?.[discipline])?.getTime();
        if (!baseTime) {
            showAlert('Kan inte räkna om tider, första starttid saknas.', 'error');
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

async function saveTimes() {
    const payload = { times: startTimes, updatedAt: Date.now() };
    await saveConfig(competitionId, 'startTimes', payload);
    showAlert('Starttider sparade.', 'success');
}

async function clearDisciplineTimes(discipline) {
    const confirmed = confirm(`Är du säker på att du vill rensa ALLA starttider för ${discipline}? Detta kan inte ångras.`);
    if (confirmed) {
        for (const sn in startTimes) {
            if (startTimes[sn][discipline]) {
                delete startTimes[sn][discipline];
            }
        }
        render();
        updateNextStartTimes();
        await saveTimes();
        showAlert(`${discipline}-tiderna har rensats.`, 'success');
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
    const classOptions = ['<option value="">— Alla klasser —</option>'].concat(classes.map(c => `<option value="${c}">${c}</option>`)).join('');

    controlsContainer.innerHTML = `
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4 p-4 bg-gray-50 rounded-lg border">
    <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-gray-700">Filter för klass:</label>
        <select id="bulkClass" class="px-2 py-1.5 rounded-md border border-gray-300">${classOptions}</select>
    </div>
    <div class="grid grid-cols-2 gap-2">
        <div>
            <label for="bulkFirst" class="text-sm font-medium text-gray-700">Första start</label>
            <input id="bulkFirst" type="datetime-local" class="w-full mt-1 px-2 py-1.5 rounded-md border border-gray-300">
        </div>
        <div>
            <label for="bulkInterval" class="text-sm font-medium text-gray-700">Intervall (min)</label>
            <input id="bulkInterval" type="number" min="1" max="60" value="7" class="w-full mt-1 px-2 py-1.5 rounded-md border border-gray-300">
        </div>
    </div>
    <div class="flex items-center pt-6">
        <input id="bulkOnlyEmpty" type="checkbox" class="h-4 w-4 rounded border-gray-300" checked>
        <label for="bulkOnlyEmpty" class="ml-2 text-sm text-gray-700">Fyll endast i tomma fält</label>
    </div>
</div>

<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
    <div class="p-3 bg-gray-100 rounded-lg border space-y-3">
        <button id="bulkDressage" class="w-full px-2 py-2 text-sm rounded-md bg-slate-600 text-white hover:bg-slate-700">
            Generera Dressyr (standardordning) <span id="nextTimeDressage" class="block text-xs opacity-70"></span>
        </button>
        <div class="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
            <h4 class="text-sm font-medium text-emerald-800 mb-2">Generera startlista för Maraton</h4>
            <div class="space-y-2 text-sm">
                <div class="flex items-center">
                    <input type="radio" id="modeMarathonStartOrder" name="marathonSortMode" value="startorder" class="h-4 w-4" checked>
                    <label for="modeMarathonStartOrder" class="ml-2">Efter startnummer (standard)</label>
                </div>
                <div class="flex items-center">
                    <input type="radio" id="modeMarathonResultsOrder" name="marathonSortMode" value="resultsOrder" class="h-4 w-4">
                    <label for="modeMarathonResultsOrder" class="ml-2">Efter dressyrresultat (3-dagars)</label>
                </div>
            </div>
            <button id="generateMarathonAdvancedBtn" class="mt-3 w-full px-2 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700">
                Generera Maraton <span id="nextTimeMarathon" class="block text-xs opacity-70"></span>
            </button>
        </div>
    </div>
    
    <div class="p-3 bg-indigo-50 rounded-lg border border-indigo-200">
        <h4 class="text-sm font-medium text-indigo-800 mb-2">Generera startlista för Koner</h4>
        <div class="space-y-2 text-sm">
            <div class="flex items-center">
                <input type="radio" id="modePrecisionStartOrder" name="precisionSortMode" value="startorder" class="h-4 w-4" checked>
                <label for="modePrecisionStartOrder" class="ml-2">Efter startnummer (standard)</label>
            </div>
            <div class="flex items-center">
                <input type="radio" id="modePrecisionDressageOrder" name="precisionSortMode" value="dressageOrder" class="h-4 w-4">
                <label for="modePrecisionDressageOrder" class="ml-2">Samma ordning som dressyr (2-dagars)</label>
            </div>
            <div class="flex items-center">
                <input type="radio" id="modePrecisionResultsOrder" name="precisionSortMode" value="resultsOrder" class="h-4 w-4">
                <label for="modePrecisionResultsOrder" class="ml-2">Efter resultat D+M (3-dagars)</label>
            </div>
        </div>
        <button id="generatePrecisionAdvancedBtn" class="mt-3 w-full px-2 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
            Generera Precision <span id="nextTimePrecision" class="block text-xs opacity-70"></span>
        </button>
    </div>
</div>
        
        ${userRole === 'admin' ? `
        <div class="mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
            <h4 class="text-sm font-medium text-red-800 mb-2">Återställning</h4>
            <div class="grid grid-cols-3 gap-2">
                <button id="clearDressage" class="w-full px-2 py-1.5 text-xs rounded-md bg-red-100 text-red-700 border border-red-300 hover:bg-red-200">Rensa Dressyr</button>
                <button id="clearMarathon" class="w-full px-2 py-1.5 text-xs rounded-md bg-red-100 text-red-700 border border-red-300 hover:bg-red-200">Rensa Maraton</button>
                <button id="clearPrecision" class="w-full px-2 py-1.5 text-xs rounded-md bg-red-100 text-red-700 border border-red-300 hover:bg-red-200">Rensa Precision</button>
            </div>
        </div>
        ` : ''}
        
        <div class="flex items-center justify-between gap-3 mb-3">
            <button id="togglePublic" class="px-3 py-2 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 text-sm">${publicMode ? 'Redaktörsläge' : 'Publikläge'}</button>
            ${publicMode ? '' : `<button id="btnSaveTimes" class="px-4 py-2 rounded-md bg-brand-darkblue text-white hover:bg-brand-gold hover:text-brand-darkblue text-sm">Spara tider</button>`}
        </div>
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <!-- Vänster: Vy-växlare -->
        <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-700">Vy:</span>
            <div class="inline-flex rounded-md shadow-sm" role="group">
                <button id="viewModeStartOrder" data-mode="startorder" class="px-4 py-2 text-sm font-medium border border-gray-300 rounded-l-lg hover:bg-gray-100 focus:z-10 focus:ring-2 focus:ring-blue-500 focus:text-blue-700">
                    Startordning
                </button>
                <button id="viewModeByClass" data-mode="byclass" class="px-4 py-2 text-sm font-medium border-t border-b border-r border-gray-300 rounded-r-lg hover:bg-gray-100 focus:z-10 focus:ring-2 focus:ring-blue-500 focus:text-blue-700">
                    Grupperat per klass
                </button>
            </div>
        </div>

        <!-- Höger: Export-knappar -->
        <div class="flex items-center gap-2">
            <button id="btnExportStarttiderCsv" class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                <i class="fas fa-file-csv mr-2 -ml-1 text-gray-500"></i>CSV
            </button>
            
            <div class="relative inline-block text-left" id="pdfDropdownContainer">
                <button type="button" id="btnPdfDropdown" class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500">
                    <svg class="mr-2 -ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 1 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    Startlista PDF
                    <svg class="-mr-1 ml-2 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
                <!-- Dropdown menu -->
                <div id="pdfDropdownMenu" class="hidden origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                    <div class="py-1" role="menu" aria-orientation="vertical" aria-labelledby="btnPdfDropdown">
                        <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900" role="menuitem" data-action="pdf-dressage">Startlista Dressyr</button>
                        <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900" role="menuitem" data-action="pdf-marathon">Startlista Maraton</button>
                        <button class="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900" role="menuitem" data-action="pdf-precision">Startlista Precision</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4 p-4 bg-gray-50 rounded-lg border">
        </div>
    `;

    document.getElementById('btnSaveTimes')?.addEventListener('click', saveTimes);
    document.getElementById('bulkDressage')?.addEventListener('click', () => doBulkFill('dressage'));
    document.getElementById('generateMarathonAdvancedBtn')?.addEventListener('click', generateMarathonAdvanced);
    document.getElementById('generatePrecisionAdvancedBtn')?.addEventListener('click', generatePrecisionAdvanced);
    document.getElementById('togglePublic')?.addEventListener('click', () => {
        publicMode = !publicMode;
        bindAllControls();
        render();
    });
    document.getElementById('bulkInterval')?.addEventListener('input', updateNextStartTimes);
    document.getElementById('clearDressage')?.addEventListener('click', () => clearDisciplineTimes('dressage'));
    document.getElementById('clearMarathon')?.addEventListener('click', () => clearDisciplineTimes('marathon'));
    document.getElementById('clearPrecision')?.addEventListener('click', () => clearDisciplineTimes('precision'));

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

    const updateViewModeButtons = () => {
        document.querySelectorAll('[data-mode]').forEach(btn => {
            const isActive = btn.dataset.mode === viewMode;
            btn.classList.toggle('bg-gray-800', isActive);
            btn.classList.toggle('text-white', isActive);
            btn.classList.toggle('border-gray-800', isActive);
        });
    };

    document.getElementById('viewModeStartOrder')?.addEventListener('click', () => {
        viewMode = 'startorder';
        sortConfig = { key: 'startNumber', direction: 'asc' }; // Återställ sortering
        updateViewModeButtons();
        render();
    });

    document.getElementById('viewModeByClass')?.addEventListener('click', () => {
        viewMode = 'byclass';
        sortConfig = { key: 'className', direction: 'asc' }; // Sortera per klass initialt
        updateViewModeButtons();
        render();
    });

    updateViewModeButtons(); // Sätt rätt knapp som aktiv vid laddning

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
            const comp = getGlobalState('currentCompetition');
            let type = '';

            if (action === 'pdf-dressage') type = 'dressage';
            else if (action === 'pdf-marathon') type = 'marathon';
            else if (action === 'pdf-precision') type = 'precision';

            if (!type) return;

            // Prepare list with start times for the selected discipline
            let list = getSortedEquipages().map(e => {
                const sn = String(e.startNumber);
                const st = startTimes[sn] || {};
                const timeStr = st[type] || null; // e.g. "2024-05-10T09:00"
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
        });
    }
}

// ======= Datainhämtning & Realtidslyssnare =======
async function loadData() {
    // === ÄNDRING: Lade till displayCfg och de gamla merge-filerna ===
    const [cfgDoc, equipagesData, marathonDocs, displayCfg, mergeCfgA, mergeCfgB, mergeCfgC] = await Promise.all([
        getConfig(competitionId, 'startTimes'),
        getEquipages(competitionId),
        getMarathonResults(competitionId),
        getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'display')).catch(() => null),
        getConfig(competitionId, 'tdbMergeGroups').catch(() => null),
        getConfig(competitionId, 'classMergeMap').catch(() => null),
        getConfig(competitionId, 'tdbMergeMap').catch(() => null)
    ]);

    startTimes = cfgDoc?.times || {};

    // === ÄNDRING: Bygg merge-map FÖRST ===
    const cfgData = (displayCfg && displayCfg.exists()) ? (displayCfg.data()?.value ?? displayCfg.data()) : {};
    starttider_displayConfig = cfgData || {};
    starttider_buildMergeMap(mergeCfgA || mergeCfgB || mergeCfgC || starttider_displayConfig);

    // === ÄNDRING: Dekorera ekipage-listan ===
    equipages = (equipagesData || [])
        .filter(e => e.startNumber && e.status !== 'struken')
        .map(e => {
            const g = starttider_resolveMergeGrouping(e);
            return {
                ...e,
                _mergedKey: g.key,
                _mergedLabel: g.label
            };
        })
        .sort(byStartNumberAsc); // Sortera efteråt

    // Fyller på marathonResultsMap
    marathonResultsMap.clear();
    (marathonDocs || []).forEach(d => marathonResultsMap.set(String(d.equipageId ?? d.id), d));
}


function attachAllListeners() {
    window.__dressageCache ||= new Map();
    unsubscribers.forEach(fn => { try { fn && fn(); } catch { } });
    unsubscribers.clear();

    // 4) Sparade protokoll (NU COLLECTION GROUP)
    const unProtoGroup = listenForDressageProtocolsCollectionGroup(competitionId, (docs) => {
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
        marathonStatusMap.clear();
        docs.forEach(d => marathonStatusMap.set(String(d.startNumber || d.id), d));
        render();
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
    marathonTimingMap.clear();
    if (Array.isArray(tmap)) tmap.forEach(t => marathonTimingMap.set(String(t.startNumber || t.id || ''), t));
    else if (tmap && typeof tmap === 'object') Object.keys(tmap).forEach(k => marathonTimingMap.set(String(k), tmap[k]));
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