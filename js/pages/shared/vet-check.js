import { getGlobalState } from '../../main.js';
import { listenForEquipages, saveEquipage } from '../../services/equipageService.js';
import { getCompetitionById, getConfig } from '../../services/competitionService.js';
import { getCompetitionHeader, showAlert } from '../../ui/components.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import {
    buildHorseTemperatureSlots,
    getHorseTemperatureRecord,
    getTemperatureHorses,
    normalizeHorseTemperatureConfig,
    normalizeHorseTemperatureValue,
    summarizeHorseTemperatures
} from './horseTemperatureUtils.js';
import {
    buildVetDatalistOptions,
    deriveVetStatusFromHorses,
    getHorseStableKey,
    getHorseVetStatus,
    getVetRemainingCount,
    resolveVetFilteredState,
    updateHorseVetStatus
} from './vetCheckUtils.js';

let competitionId = null;
let allEquipages = [];
let filteredEquipages = [];
let unsubscribe = null;
let currentIndex = 0;
let currentSearchTerm = '';
let horseTemperatureConfig = normalizeHorseTemperatureConfig();
let competitionDates = '';

const statusConfig = {
    'anmäld': { label: 'Väntar', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', border: 'border-gray-200 dark:border-gray-600' },
    incheckad: { label: 'Väntar (Incheckad)', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200', border: 'border-blue-200 dark:border-blue-800' },
    besiktigad: { label: 'Godkänd', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200', border: 'border-green-300 dark:border-green-700' },
    ombesiktning: { label: 'Ombesiktning', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200', border: 'border-yellow-300 dark:border-yellow-700' },
    struken: { label: 'Struken/Ej godkänd', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200', border: 'border-red-300 dark:border-red-700' }
};

function byId(id) {
    return document.getElementById(id);
}

export function load() {
    const competition = getGlobalState('currentCompetition');
    const pageContainer = byId('page-vet-check');

    if (!pageContainer) return;
    if (!competition) {
        pageContainer.innerHTML = '<p class="p-8 text-center text-red-500">Ingen tävling vald.</p>';
        return;
    }

    competitionId = competition.id;
    competitionDates = competition.dates || '';
    horseTemperatureConfig = normalizeHorseTemperatureConfig();
    renderPage(pageContainer, competition);
    attachPageHandlers();
    loadTemperatureSettings(competition);

    unsubscribe = listenForEquipages(competitionId, update => {
        allEquipages = Array.isArray(update) ? update : [];
        updateDatalist();
        processData(currentSearchTerm);
    });
}

export function __unload() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    competitionId = null;
    allEquipages = [];
    filteredEquipages = [];
    currentIndex = 0;
    currentSearchTerm = '';
    horseTemperatureConfig = normalizeHorseTemperatureConfig();
    competitionDates = '';
}

async function loadTemperatureSettings(competition) {
    try {
        const [config, compDoc] = await Promise.all([
            getConfig(competition.id, 'horseTemperature').catch(() => ({})),
            getCompetitionById(competition.id).catch(() => null)
        ]);
        if (competitionId !== competition.id) return;
        horseTemperatureConfig = normalizeHorseTemperatureConfig(config);
        competitionDates = compDoc?.dates || competition.dates || '';
        updateQueueDisplay();
        renderCard();
    } catch (error) {
        console.warn('Kunde inte ladda temperaturinställningar:', error);
    }
}

function renderPage(pageContainer, competition) {
    pageContainer.innerHTML = `
        <style>
            @media (max-width: 640px) {
                #page-vet-check .container { padding: 0.5rem; }
                .vet-card { padding: 1rem !important; }
                .vet-header { padding: 0.875rem !important; }
                .horse-id-grid { font-size: 11px !important; }
            }
        </style>

        <div class="container mx-auto p-3 sm:p-4 md:p-8 max-w-3xl">
            ${getCompetitionHeader(competition, 'Veterinärbesiktning')}
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col h-[85vh]">
                <div class="vet-header shrink-0 p-4 bg-white dark:bg-gray-900 border-b dark:border-gray-700 z-30 shadow-sm space-y-4">
                    <div class="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
                        <h2 class="text-lg font-black text-gray-800 dark:text-white uppercase tracking-tighter">Besiktning</h2>
                        <div class="text-right">
                            <div class="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400" id="vet-queue-count">Laddar...</div>
                            <div class="text-[10px] font-bold uppercase text-orange-600 dark:text-orange-300" id="vet-temp-count"></div>
                        </div>
                    </div>
                    <div class="flex gap-2 items-center">
                        <button id="btn-prev-eq" class="w-10 h-10 flex items-center justify-center bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-30 transition-all font-bold" title="Föregående">‹</button>
                        <div class="relative flex-1">
                            <input type="text" id="vet-search" list="vet-search-list" placeholder="Sök ekipage..."
                                class="w-full pl-3 pr-8 py-2.5 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 transition-all">
                            <datalist id="vet-search-list"></datalist>
                            <div class="absolute right-3 top-3 text-gray-400 text-xs">Sök</div>
                        </div>
                        <button id="btn-next-eq" class="w-10 h-10 flex items-center justify-center bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-30 transition-all font-bold" title="Nästa">›</button>
                    </div>
                    <div class="flex justify-center pb-1">
                        <div class="text-[10px] font-black uppercase text-gray-400 tracking-widest bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-full border dark:border-gray-700" id="index-indicator">- / -</div>
                    </div>
                </div>
                <div class="flex-1 bg-gray-100 dark:bg-gray-950 overflow-y-auto p-3 sm:p-4 pt-5 sm:pt-6 pb-20 flex flex-col items-center" id="vet-card-container">
                    <p class="text-center text-gray-400 py-12">Laddar ekipage...</p>
                </div>
            </div>
        </div>
    `;
}

function attachPageHandlers() {
    byId('vet-search')?.addEventListener('input', event => {
        currentSearchTerm = event.target.value.toLowerCase();
        processData(currentSearchTerm);
    });
    byId('btn-prev-eq')?.addEventListener('click', () => navigate(-1));
    byId('btn-next-eq')?.addEventListener('click', () => navigate(1));
}

function navigate(direction) {
    if (filteredEquipages.length === 0) return;

    const newIndex = Math.max(0, Math.min(filteredEquipages.length - 1, currentIndex + direction));
    if (newIndex === currentIndex) return;
    currentIndex = newIndex;
    renderCard();
}

function processData(searchTerm = '') {
    const state = resolveVetFilteredState(allEquipages, searchTerm);
    filteredEquipages = state.filtered;
    currentIndex = state.index;

    if (state.clearSearch) {
        currentSearchTerm = '';
        const searchInput = byId('vet-search');
        if (searchInput) searchInput.value = '';
    }

    updateQueueDisplay();
    renderCard();
}

function updateQueueDisplay() {
    const countEl = byId('vet-queue-count');
    if (countEl) countEl.textContent = `${getVetRemainingCount(allEquipages)} kvar`;

    const tempEl = byId('vet-temp-count');
    if (!tempEl) return;

    const slots = buildHorseTemperatureSlots(competitionDates, horseTemperatureConfig);
    if (!horseTemperatureConfig.enabled || !slots.length) {
        tempEl.textContent = '';
        return;
    }

    const activeEquipages = allEquipages.filter(eq => String(eq?.status || '').toLowerCase() !== 'struken');
    const totals = activeEquipages.reduce((acc, eq) => {
        const summary = summarizeHorseTemperatures(eq, competitionDates, horseTemperatureConfig);
        acc.completed += summary.completed;
        acc.total += summary.total;
        acc.high += summary.highCount;
        return acc;
    }, { completed: 0, total: 0, high: 0 });

    tempEl.textContent = totals.total > 0
        ? `Temp ${totals.completed}/${totals.total}${totals.high ? `, ${totals.high} varning` : ''}`
        : 'Temp: inga hästar';
}

function updateDatalist() {
    const dataList = byId('vet-search-list');
    if (!dataList) return;

    dataList.innerHTML = buildVetDatalistOptions(allEquipages)
        .map(option => `<option value="${escapeHtml(option.value)}">`)
        .join('');
}

function renderCard() {
    const container = byId('vet-card-container');
    const indexInd = byId('index-indicator');
    const prevBtn = byId('btn-prev-eq');
    const nextBtn = byId('btn-next-eq');

    if (!container) return;

    if (filteredEquipages.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 dark:text-gray-400 mt-12 bg-white dark:bg-gray-800 p-8 rounded shadow">Inga ekipage matchar sökningen.</div>';
        if (indexInd) indexInd.textContent = '0 / 0';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    currentIndex = Math.max(0, Math.min(currentIndex, filteredEquipages.length - 1));
    if (indexInd) indexInd.textContent = `${currentIndex + 1} / ${filteredEquipages.length}`;
    if (prevBtn) prevBtn.disabled = currentIndex === 0;
    if (nextBtn) nextBtn.disabled = currentIndex === filteredEquipages.length - 1;

    const eq = filteredEquipages[currentIndex];
    container.innerHTML = renderVetCard(eq);
    attachCardHandlers(container, eq);
}

function renderHorseCard(horse = {}, index = 0) {
    const horseKey = getHorseStableKey(horse, index);
    const horseStatus = getHorseVetStatus(horse);
    const conf = statusConfig[horseStatus] || statusConfig.incheckad;
    const ids = [];
    if (horse.chipNumber) ids.push(`Chip: ${horse.chipNumber}`);
    else if (horse.chip) ids.push(`Chip: ${horse.chip}`);
    if (horse.lic) ids.push(`Lic: ${horse.lic}`);
    else if (horse.license) ids.push(`Lic: ${horse.license}`);
    if (ids.length === 0 && (horse.uid || horse.id)) ids.push(`ID: ${horse.uid || horse.id}`);

    const idString = ids.length > 0
        ? escapeHtml(ids.join(' • '))
        : '<span class="text-red-400 italic">ID saknas</span>';
    const vaccination = horse.vaccinationDate
        ? `<span class="text-[10px] font-bold text-blue-600 dark:text-blue-400">${escapeHtml(horse.vaccinationDate)}</span>`
        : '';

    return `
        <div class="horse-id-grid flex flex-col bg-gray-50 dark:bg-gray-800/50 border dark:border-gray-700 rounded-lg p-2.5 text-xs">
            <div class="flex justify-between items-start gap-2">
                <div class="min-w-0">
                    <div class="font-black text-gray-900 dark:text-white truncate text-sm uppercase">${escapeHtml(horse.name || horse.horseName || '-')}</div>
                    <div class="text-[10px] font-mono text-gray-500 mt-0.5">${idString}</div>
                </div>
                <div class="text-right shrink-0">
                    <div class="mb-1 px-1.5 py-0.5 rounded border text-[9px] font-black uppercase ${conf.border} ${conf.color}">${conf.label}</div>
                    <div class="text-[10px] font-bold text-gray-400 uppercase">${escapeHtml(horse.age ? `${horse.age} år` : '')} ${escapeHtml(horse.gender ? horse.gender.slice(0, 1).toUpperCase() : '')}</div>
                    ${vaccination}
                </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mt-2 pt-2 border-t dark:border-gray-700">
                <button type="button" class="vet-horse-status-btn rounded-md px-2 py-1 text-[10px] font-black uppercase ${horseStatus === 'besiktigad' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'}" data-horse-key="${escapeHtml(horseKey)}" data-status="besiktigad">Godkänd</button>
                <button type="button" class="vet-horse-status-btn rounded-md px-2 py-1 text-[10px] font-black uppercase ${horseStatus === 'ombesiktning' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'}" data-horse-key="${escapeHtml(horseKey)}" data-status="ombesiktning">Ombesikt</button>
                <button type="button" class="vet-horse-status-btn rounded-md px-2 py-1 text-[10px] font-black uppercase ${horseStatus === 'struken' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'}" data-horse-key="${escapeHtml(horseKey)}" data-status="struken">Stryk</button>
            </div>
        </div>
    `;
}

function formatTemperatureValue(value) {
    const normalized = normalizeHorseTemperatureValue(value);
    return normalized === null ? '-' : `${String(normalized).replace('.', ',')} °C`;
}

function renderTemperatureReport(eq = {}) {
    if (!horseTemperatureConfig.enabled) return '';

    const slots = buildHorseTemperatureSlots(competitionDates, horseTemperatureConfig);
    if (!slots.length) {
        return `
            <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                Temperaturkontroll är aktiverad, men tävlingsdatum kunde inte tolkas.
            </div>
        `;
    }

    const horses = getTemperatureHorses(eq);
    if (!horses.length) return '';

    const summary = summarizeHorseTemperatures(eq, competitionDates, horseTemperatureConfig);
    const isComplete = summary.complete;
    const statusClass = summary.highCount
        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-100'
        : (isComplete
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100'
            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100');

    return `
        <div class="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900/30">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Temperaturrapport</div>
                    <div class="mt-1 font-bold text-gray-900 dark:text-white">${summary.completed}/${summary.total} ifyllda</div>
                </div>
                <span class="rounded-full px-2 py-1 text-[10px] font-black uppercase ${statusClass}">
                    ${summary.highCount ? `${summary.highCount} varning` : (isComplete ? 'Klar' : 'Saknas')}
                </span>
            </div>
            <div class="mt-3 space-y-2">
                ${horses.map((horse, index) => {
        const horseKey = horse._temperatureKey;
        const horseSummary = summary.horseSummaries.find(item => item.horseKey === horseKey);
        const latest = horseSummary?.latest;
        return `
            <details class="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800/70" ${index === 0 ? 'open' : ''}>
                <summary class="cursor-pointer font-bold text-gray-900 dark:text-white">
                    ${escapeHtml(horse._temperatureName)}
                    <span class="ml-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400">${horseSummary?.completed || 0}/${slots.length}</span>
                    ${latest ? `<span class="ml-2 text-[10px] font-semibold text-blue-700 dark:text-blue-300">Senaste ${formatTemperatureValue(latest.temperatureC)}</span>` : ''}
                </summary>
                <div class="mt-2 overflow-x-auto">
                    <table class="min-w-full text-left text-[11px]">
                        <tbody>
                            ${slots.map(slot => {
            const record = getHorseTemperatureRecord(eq, horseKey, slot.id);
            const value = normalizeHorseTemperatureValue(record?.temperatureC);
            const isHigh = horseTemperatureConfig.warningTemperatureC !== null && value !== null && value >= horseTemperatureConfig.warningTemperatureC;
            return `
                <tr class="${isHigh ? 'text-orange-700 dark:text-orange-300' : 'text-gray-600 dark:text-gray-300'}">
                    <td class="py-1 pr-2 whitespace-nowrap">${escapeHtml(slot.date)}</td>
                    <td class="py-1 pr-2 whitespace-nowrap">${escapeHtml(slot.periodLabel)}</td>
                    <td class="py-1 pr-2 font-bold whitespace-nowrap">${formatTemperatureValue(value)}</td>
                    <td class="py-1 text-gray-400 whitespace-nowrap">${escapeHtml(record?.takenAt ? record.takenAt.replace('T', ' ') : '')}</td>
                </tr>
            `;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            </details>
        `;
    }).join('')}
            </div>
        </div>
    `;
}

function renderVetCard(eq = {}) {
    const status = deriveVetStatusFromHorses(eq.horses, eq.status);
    const conf = statusConfig[status] || statusConfig['anmäld'];
    const horses = Array.isArray(eq.horses) ? eq.horses : [];
    const horsesHtml = horses.map((horse, index) => renderHorseCard(horse, index)).join('');
    const isProcessable = ['anmäld', 'incheckad', 'ombesiktning'].includes(status);
    const cardOpacity = !isProcessable ? 'opacity-70' : '';

    return `
        <div class="vet-card w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-lg border dark:border-gray-700 p-4 sm:p-5 md:p-6 ${cardOpacity} transition-all relative">
            <div class="mb-5">
                <div class="flex flex-col gap-1">
                    <div class="flex items-start justify-between gap-3">
                        <span class="text-4xl font-black text-gray-900 dark:text-white tracking-tighter">#${escapeHtml(eq.startNumber)}</span>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${conf.border} ${conf.color}">${conf.label}</span>
                    </div>
                    <div class="mt-1">
                        <h2 class="text-2xl font-black text-gray-800 dark:text-gray-100 leading-tight uppercase tracking-tight">${escapeHtml(eq.driverName)}</h2>
                        <div class="text-[10px] font-bold text-gray-400 uppercase mt-1 tracking-wider">${escapeHtml(eq.className || '')} • ${escapeHtml(eq.clubName || '')}</div>
                    </div>
                </div>
            </div>

            <div class="mb-5">
                <div class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span class="w-8 h-[1px] bg-gray-200 dark:bg-gray-700"></span>
                    Hästar & identitet
                </div>
                <div class="grid gap-2">
                    ${horsesHtml || '<div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border dark:border-gray-700 text-gray-500 italic text-center text-xs">Inga hästar registrerade</div>'}
                </div>
                ${renderTemperatureReport(eq)}
            </div>

            <div class="mb-5 relative group">
                <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Veterinärnotering</label>
                <textarea class="w-full text-sm border dark:border-gray-700 rounded-lg p-3 vet-notes focus:ring-2 focus:ring-blue-500/20 transition-all min-h-[60px] dark:bg-gray-900/40 dark:text-white placeholder-gray-500"
                    placeholder="Anteckna t.ex. rörelsestörning..."
                    data-sn="${escapeHtml(eq.startNumber)}">${escapeHtml(eq.vetNotes || '')}</textarea>
                <div class="absolute right-2 bottom-2">
                    <button class="text-[10px] font-black bg-brand-darkblue text-white px-3 py-1.5 rounded-lg shadow-sm save-notes-btn hidden uppercase tracking-wide" data-sn="${escapeHtml(eq.startNumber)}">Spara</button>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t dark:border-gray-700">
                <button class="vet-status-btn bg-emerald-600 text-white font-black py-3.5 sm:py-4 px-3 rounded-xl shadow-lg active:scale-95 transition-all flex flex-col items-center justify-center gap-1 group" data-status="besiktigad">
                    <span class="text-sm tracking-widest">GODKÄND</span>
                </button>
                <button class="vet-status-btn bg-amber-500 text-white font-black py-3.5 sm:py-4 px-3 rounded-xl shadow-lg active:scale-95 transition-all flex flex-col items-center justify-center gap-1 group" data-status="ombesiktning">
                    <span class="text-sm tracking-widest">HÅLL</span>
                </button>
            </div>

            ${isProcessable ? `
            <div class="mt-4 flex justify-center">
                <button class="vet-status-btn text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity" data-status="struken">
                    Stryk ekipage
                </button>
            </div>` : ''}
        </div>
    `;
}

function attachCardHandlers(container, eq) {
    const textArea = container.querySelector('.vet-notes');
    const saveBtn = container.querySelector('.save-notes-btn');
    if (textArea && saveBtn) {
        textArea.addEventListener('input', () => saveBtn.classList.remove('hidden'));
        saveBtn.addEventListener('click', async () => saveVetNote(eq.startNumber, textArea.value, saveBtn));
    }

    container.querySelectorAll('.vet-status-btn').forEach(button => {
        button.addEventListener('click', () => setVetStatus(eq.startNumber, button.dataset.status));
    });

    container.querySelectorAll('.vet-horse-status-btn').forEach(button => {
        button.addEventListener('click', () => setHorseVetStatus(eq, button.dataset.horseKey, button.dataset.status));
    });
}

async function saveVetNote(startNumber, note, saveBtn) {
    try {
        await saveEquipage(competitionId, startNumber, { vetNotes: note });
        saveBtn.textContent = 'KLART!';
        setTimeout(() => {
            saveBtn.textContent = 'SPARA';
            saveBtn.classList.add('hidden');
        }, 1500);
    } catch (error) {
        console.error('Vet note update failed', error);
        showAlert('Fel vid sparning', false);
    }
}

async function setVetStatus(startNumber, status) {
    if (!competitionId) return;
    if (status === 'struken' && !confirm(`Är du säker på att ekipage #${startNumber} ska strykas (ej godkänd)?`)) {
        return;
    }

    try {
        const eq = allEquipages.find(item => String(item.startNumber) === String(startNumber));
        const horses = Array.isArray(eq?.horses) && eq.horses.length
            ? eq.horses.map(horse => ({
                ...horse,
                vetStatus: status,
                vetCheckedAt: new Date().toISOString()
            }))
            : null;
        await saveEquipage(competitionId, startNumber, horses ? { status, horses } : { status });
        showAlert(`Ekipage #${startNumber}: ${String(status).toUpperCase()}`);
    } catch (error) {
        console.error('Vet update failed', error);
        showAlert('Kunde inte uppdatera status', false);
    }
}

async function setHorseVetStatus(eq = {}, horseKey, status) {
    if (!competitionId || !eq.startNumber) return;
    if (status === 'struken' && !confirm(`Ska vald häst i ekipage #${eq.startNumber} strykas/ej godkännas?`)) {
        return;
    }

    try {
        const horses = updateHorseVetStatus(eq.horses, horseKey, status);
        const derivedStatus = deriveVetStatusFromHorses(horses, eq.status);
        await saveEquipage(competitionId, eq.startNumber, {
            horses,
            status: derivedStatus
        });
        showAlert(`Ekipage #${eq.startNumber}: häst ${String(status).toUpperCase()}`);
    } catch (error) {
        console.error('Vet horse update failed', error);
        showAlert('Kunde inte uppdatera häststatus', false);
    }
}

