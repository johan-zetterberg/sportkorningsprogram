import { getGlobalState } from '../../main.js';
import { listenForEquipages, saveEquipage, updateEquipageFromLatest } from '../../services/equipageService.js';
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
    getHorsePhaseInspection,
    getHorseStableKey,
    getHorseVetStatus,
    getVetRemainingCount,
    isPulseWarning,
    resolveVetFilteredState,
    updateHorsePhaseInspection,
    updateHorseVetStatus,
    VET_PHASES,
    MAX_RECOMMENDED_PULSE_BPM
} from './vetCheckUtils.js';

let competitionId = null;
let allEquipages = [];
let filteredEquipages = [];
let unsubscribe = null;
let currentIndex = 0;
let currentSearchTerm = '';
let currentPhase = 'initial'; // 'initial' | 'harness' | 'restArea' | 'final'
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
    currentPhase = 'initial';
    renderPage(pageContainer, competition);
    attachPageHandlers();
    loadTemperatureSettings(competition);

    unsubscribe = listenForEquipages(competitionId, update => {
        allEquipages = Array.isArray(update) ? update : [];
        updatePhaseTabs();
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
    currentPhase = 'initial';
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

function renderPhaseTabsHtml() {
    return `
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 border-b dark:border-gray-700">
            ${Object.values(VET_PHASES).map(phase => {
                const isActive = currentPhase === phase.id;
                const remaining = getVetRemainingCount(allEquipages, phase.id);
                const activeClass = isActive
                    ? 'bg-blue-600 text-white shadow-sm font-black'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-bold';
                return `
                    <button type="button" class="vet-phase-btn whitespace-nowrap px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all ${activeClass}" data-phase="${phase.id}">
                        <span>${escapeHtml(phase.shortLabel)}</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'} font-mono">${remaining}</span>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

function renderPage(pageContainer, competition) {
    const activePhaseInfo = VET_PHASES[currentPhase] || VET_PHASES.initial;

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
            ${getCompetitionHeader(competition, 'Veterinärbesiktning', { quickGuideRole: 'vet-check' })}
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col h-[85vh]">
                <div class="vet-header shrink-0 p-4 bg-white dark:bg-gray-900 border-b dark:border-gray-700 z-30 shadow-sm space-y-3">
                    <div id="vet-phase-tabs-container">
                        ${renderPhaseTabsHtml()}
                    </div>

                    <div class="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
                        <div>
                            <h2 class="text-base font-black text-gray-800 dark:text-white uppercase tracking-tight" id="vet-phase-title">
                                ${escapeHtml(activePhaseInfo.label)}
                            </h2>
                            <p class="text-[11px] text-gray-500 dark:text-gray-400" id="vet-phase-desc">
                                ${escapeHtml(activePhaseInfo.desc)} • <span class="font-mono text-[10px]">${escapeHtml(activePhaseInfo.trRule)}</span>
                            </p>
                        </div>
                        <div class="text-right shrink-0 flex flex-col items-end gap-1">
                            <div class="flex items-center gap-2">
                                <div class="text-[11px] font-bold uppercase text-blue-600 dark:text-blue-400" id="vet-queue-count">Laddar...</div>
                                <button id="btn-print-vet-pdf" class="px-2 py-0.5 text-[11px] font-semibold rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 flex items-center gap-1 transition-colors" title="Skriv ut besiktningslista som PDF">
                                    <i class="fa fa-print text-[10px]"></i> PDF
                                </button>
                            </div>
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

function updatePhaseTabs() {
    const container = byId('vet-phase-tabs-container');
    if (container) {
        container.innerHTML = renderPhaseTabsHtml();
        attachPhaseTabHandlers();
    }
}

function attachPhaseTabHandlers() {
    document.querySelectorAll('.vet-phase-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextPhase = btn.dataset.phase;
            if (nextPhase && nextPhase !== currentPhase) {
                currentPhase = nextPhase;
                updatePhaseTabs();
                const phaseInfo = VET_PHASES[currentPhase] || VET_PHASES.initial;
                const titleEl = byId('vet-phase-title');
                const descEl = byId('vet-phase-desc');
                if (titleEl) titleEl.textContent = phaseInfo.label;
                if (descEl) descEl.innerHTML = `${escapeHtml(phaseInfo.desc)} • <span class="font-mono text-[10px]">${escapeHtml(phaseInfo.trRule)}</span>`;
                updateDatalist();
                processData(currentSearchTerm);
            }
        });
    });
}

function attachPageHandlers() {
    attachPhaseTabHandlers();
    byId('vet-search')?.addEventListener('input', event => {
        currentSearchTerm = event.target.value.toLowerCase();
        processData(currentSearchTerm);
    });
    byId('btn-prev-eq')?.addEventListener('click', () => navigate(-1));
    byId('btn-next-eq')?.addEventListener('click', () => navigate(1));
    byId('btn-print-vet-pdf')?.addEventListener('click', async () => {
        const competition = getGlobalState('currentCompetition');
        const { generateVetCheckPdf } = await import('../../pdf/vetCheckPdf.js');
        await generateVetCheckPdf(allEquipages, competition);
    });
}

function navigate(direction) {
    if (filteredEquipages.length === 0) return;

    const newIndex = Math.max(0, Math.min(filteredEquipages.length - 1, currentIndex + direction));
    if (newIndex === currentIndex) return;
    currentIndex = newIndex;
    renderCard();
}

function processData(searchTerm = '') {
    const state = resolveVetFilteredState(allEquipages, searchTerm, currentPhase);
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
    if (countEl) {
        const remaining = getVetRemainingCount(allEquipages, currentPhase);
        const phaseLabel = VET_PHASES[currentPhase]?.shortLabel || 'Besiktning';
        countEl.textContent = `${remaining} kvar i ${phaseLabel}`;
    }

    const tempEl = byId('vet-temp-count');
    if (!tempEl) return;

    if (currentPhase !== 'initial') {
        tempEl.textContent = '';
        return;
    }

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

    dataList.innerHTML = buildVetDatalistOptions(allEquipages, currentPhase)
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
        container.innerHTML = '<div class="text-center text-gray-500 dark:text-gray-400 mt-12 bg-white dark:bg-gray-800 p-8 rounded shadow">Inga ekipage matchar sökningen för denna besiktningsfas.</div>';
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
    const phaseInspection = getHorsePhaseInspection(horse, currentPhase);
    const horseStatus = phaseInspection.status || 'anmäld';
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

    // Clinical parameters for Vilobox (TR Mom 526.4 & FEI Art 948.3)
    let clinicalSectionHtml = '';
    if (currentPhase === 'restArea') {
        const pulse = phaseInspection.pulseBpm || '';
        const pulseHigh = isPulseWarning(pulse);
        const resp = phaseInspection.respiration || 'normal';
        const mucosa = phaseInspection.mucosa || 'ok';

        clinicalSectionHtml = `
            <div class="mt-2.5 pt-2.5 border-t dark:border-gray-700 bg-blue-50/50 dark:bg-blue-900/10 p-2.5 rounded-lg space-y-2">
                <div class="flex items-center justify-between">
                    <span class="text-[10px] font-black uppercase text-blue-900 dark:text-blue-300">Puls & andning (Vilobox)</span>
                    ${pulseHigh ? `<span class="text-[10px] font-bold text-rose-600 dark:text-rose-400 animate-pulse">⚠️ Puls >${MAX_RECOMMENDED_PULSE_BPM} bpm (TR Mom 526.4)</span>` : ''}
                </div>
                
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 mb-0.5">Puls (bpm):</label>
                        <div class="flex items-center gap-1.5">
                            <input type="number" min="20" max="150" step="1" inputmode="numeric"
                                class="vet-pulse-input w-20 px-2 py-1 text-sm font-bold rounded border dark:border-gray-600 dark:bg-gray-700 dark:text-white ${pulseHigh ? 'border-rose-500 bg-rose-50 text-rose-900' : ''}"
                                placeholder="bpm" value="${escapeHtml(pulse)}" data-horse-key="${escapeHtml(horseKey)}">
                            <div class="flex items-center gap-1 text-[10px]">
                                ${[48, 56, 60, 64, 68].map(pVal => `
                                    <button type="button" class="quick-pulse-btn px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30" data-horse-key="${escapeHtml(horseKey)}" data-pulse="${pVal}">${pVal}</button>
                                `).join('')}
                            </div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 mb-0.5">Andning / Allmäntillstånd:</label>
                        <div class="flex gap-2">
                            <select class="vet-resp-select text-xs font-medium rounded border dark:border-gray-600 dark:bg-gray-700 dark:text-white px-2 py-1" data-horse-key="${escapeHtml(horseKey)}">
                                <option value="normal" ${resp === 'normal' ? 'selected' : ''}>Andning: Normal</option>
                                <option value="elevated" ${resp === 'elevated' ? 'selected' : ''}>Andning: Flåsande / Förhöjd</option>
                            </select>
                            <select class="vet-mucosa-select text-xs font-medium rounded border dark:border-gray-600 dark:bg-gray-700 dark:text-white px-2 py-1" data-horse-key="${escapeHtml(horseKey)}">
                                <option value="ok" ${mucosa === 'ok' ? 'selected' : ''}>Slemhinnor: U.a.</option>
                                <option value="remark" ${mucosa === 'remark' ? 'selected' : ''}>Slemhinnor: Anmärkning</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else if (currentPhase === 'harness') {
        const bitOk = phaseInspection.bitOk ?? true;
        const harnessOk = phaseInspection.harnessOk ?? true;
        clinicalSectionHtml = `
            <div class="mt-2.5 pt-2 border-t dark:border-gray-700 flex items-center gap-4 text-xs font-bold text-gray-700 dark:text-gray-300">
                <label class="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" class="vet-harness-check h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600" data-horse-key="${escapeHtml(horseKey)}" data-check="bitOk" ${bitOk ? 'checked' : ''}>
                    <span>Bett & träns u.a.</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" class="vet-harness-check h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600" data-horse-key="${escapeHtml(horseKey)}" data-check="harnessOk" ${harnessOk ? 'checked' : ''}>
                    <span>Sele & draglinor u.a.</span>
                </label>
            </div>
        `;
    }

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

            ${clinicalSectionHtml}

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mt-2.5 pt-2 border-t dark:border-gray-700">
                <button type="button" class="vet-horse-status-btn rounded-md px-2 py-1 text-[10px] font-black uppercase ${horseStatus === 'besiktigad' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'}" data-horse-key="${escapeHtml(horseKey)}" data-status="besiktigad">
                    ${currentPhase === 'restArea' ? 'Godkänd för B' : 'Godkänd'}
                </button>
                <button type="button" class="vet-horse-status-btn rounded-md px-2 py-1 text-[10px] font-black uppercase ${horseStatus === 'ombesiktning' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'}" data-horse-key="${escapeHtml(horseKey)}" data-status="ombesiktning">
                    ${currentPhase === 'restArea' ? 'Omkontroll' : 'Ombesikt'}
                </button>
                <button type="button" class="vet-horse-status-btn rounded-md px-2 py-1 text-[10px] font-black uppercase ${horseStatus === 'struken' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'}" data-horse-key="${escapeHtml(horseKey)}" data-status="struken">
                    ${currentPhase === 'restArea' ? 'Startförbud B' : 'Stryk'}
                </button>
            </div>
        </div>
    `;
}

function formatTemperatureValue(value) {
    const normalized = normalizeHorseTemperatureValue(value);
    return normalized === null ? '-' : `${String(normalized).replace('.', ',')} °C`;
}

function renderTemperatureReport(eq = {}) {
    if (currentPhase !== 'initial' || !horseTemperatureConfig.enabled) return '';

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
    const status = deriveVetStatusFromHorses(eq.horses, eq.status, currentPhase);
    const conf = statusConfig[status] || statusConfig['anmäld'];
    const horses = Array.isArray(eq.horses) ? eq.horses : [];
    const horsesHtml = horses.map((horse, index) => renderHorseCard(horse, index)).join('');
    const isProcessable = ['anmäld', 'incheckad', 'ombesiktning'].includes(status);
    const cardOpacity = !isProcessable ? 'opacity-70' : '';

    const phaseNoteKey = `vetNotes_${currentPhase}`;
    const phaseNoteVal = eq[phaseNoteKey] || (currentPhase === 'initial' ? eq.vetNotes : '') || '';

    // Action button labels per phase
    let approvedBtnLabel = 'GODKÄND';
    let holdBtnLabel = 'HÅLL / OMBESIKTNING';
    let rejectBtnLabel = 'STRYK EKIPAGE';

    if (currentPhase === 'restArea') {
        approvedBtnLabel = 'GODKÄND FÖR STRÄCKA B';
        holdBtnLabel = 'OMKONTROLL I VILOBOX';
        rejectBtnLabel = 'STARTFÖRBUD STRÄCKA B';
    } else if (currentPhase === 'harness') {
        approvedBtnLabel = 'SELNING GODKÄND';
        holdBtnLabel = 'BEHÖVER ÅTGÄRDAS';
        rejectBtnLabel = 'EJ GODKÄND';
    }

    return `
        <div class="vet-card w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-lg border dark:border-gray-700 p-4 sm:p-5 md:p-6 ${cardOpacity} transition-all relative">
            <div class="mb-5">
                <div class="flex flex-col gap-1">
                    <div class="flex items-start justify-between gap-3">
                        <span class="text-4xl font-black text-gray-900 dark:text-white tracking-tighter">#${escapeHtml(eq.startNumber)}</span>
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${conf.border} ${conf.color}">${conf.label}</span>
                        </div>
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
                    Hästar & identitet (${VET_PHASES[currentPhase]?.label})
                </div>
                <div class="grid gap-2">
                    ${horsesHtml || '<div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border dark:border-gray-700 text-gray-500 italic text-center text-xs">Inga hästar registrerade</div>'}
                </div>
                ${renderTemperatureReport(eq)}
            </div>

            <div class="mb-5 relative group">
                <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                    Veterinärnotering (${VET_PHASES[currentPhase]?.shortLabel})
                </label>
                <textarea class="w-full text-sm border dark:border-gray-700 rounded-lg p-3 vet-notes focus:ring-2 focus:ring-blue-500/20 transition-all min-h-[60px] dark:bg-gray-900/40 dark:text-white placeholder-gray-500"
                    placeholder="Anteckna t.ex. puls, andning, rörelsestörning..."
                    data-sn="${escapeHtml(eq.startNumber)}">${escapeHtml(phaseNoteVal)}</textarea>
                <div class="absolute right-2 bottom-2">
                    <button class="text-[10px] font-black bg-brand-darkblue text-white px-3 py-1.5 rounded-lg shadow-sm save-notes-btn hidden uppercase tracking-wide" data-sn="${escapeHtml(eq.startNumber)}">Spara</button>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t dark:border-gray-700">
                <button class="vet-status-btn bg-emerald-600 text-white font-black py-3.5 sm:py-4 px-3 rounded-xl shadow-lg active:scale-95 transition-all flex flex-col items-center justify-center gap-1 group" data-status="besiktigad">
                    <span class="text-sm tracking-widest">${approvedBtnLabel}</span>
                </button>
                <button class="vet-status-btn bg-amber-500 text-white font-black py-3.5 sm:py-4 px-3 rounded-xl shadow-lg active:scale-95 transition-all flex flex-col items-center justify-center gap-1 group" data-status="ombesiktning">
                    <span class="text-sm tracking-widest">${holdBtnLabel}</span>
                </button>
            </div>

            <div class="mt-4 flex justify-center">
                <button class="vet-status-btn text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity" data-status="struken">
                    ${rejectBtnLabel}
                </button>
            </div>
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
        button.addEventListener('click', () => {
            const horseKey = button.dataset.horseKey;
            const status = button.dataset.status;
            // Collect any clinical fields
            const cardEl = button.closest('.horse-id-grid');
            const pulseInput = cardEl?.querySelector('.vet-pulse-input');
            const respSelect = cardEl?.querySelector('.vet-resp-select');
            const mucosaSelect = cardEl?.querySelector('.vet-mucosa-select');
            const bitCheck = cardEl?.querySelector('input[data-check="bitOk"]');
            const harnessCheck = cardEl?.querySelector('input[data-check="harnessOk"]');

            const extra = {};
            if (pulseInput && pulseInput.value) extra.pulseBpm = Number(pulseInput.value);
            if (respSelect) extra.respiration = respSelect.value;
            if (mucosaSelect) extra.mucosa = mucosaSelect.value;
            if (bitCheck) extra.bitOk = bitCheck.checked;
            if (harnessCheck) extra.harnessOk = harnessCheck.checked;

            setHorseVetStatus(eq, horseKey, status, extra);
        });
    });

    // Quick pulse buttons
    container.querySelectorAll('.quick-pulse-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const horseKey = btn.dataset.horseKey;
            const pulseVal = btn.dataset.pulse;
            const cardEl = btn.closest('.horse-id-grid');
            const pulseInput = cardEl?.querySelector(`.vet-pulse-input[data-horse-key="${horseKey}"]`);
            if (pulseInput) {
                pulseInput.value = pulseVal;
                pulseInput.dispatchEvent(new Event('change'));
            }
        });
    });

    // Pulse input auto-save on change
    container.querySelectorAll('.vet-pulse-input').forEach(input => {
        input.addEventListener('change', () => {
            const horseKey = input.dataset.horseKey;
            const bpm = Number(input.value) || null;
            saveHorseClinicalField(eq, horseKey, { pulseBpm: bpm });
        });
    });

    // Respiration & mucosa selects auto-save
    container.querySelectorAll('.vet-resp-select').forEach(select => {
        select.addEventListener('change', () => {
            const horseKey = select.dataset.horseKey;
            saveHorseClinicalField(eq, horseKey, { respiration: select.value });
        });
    });
    container.querySelectorAll('.vet-mucosa-select').forEach(select => {
        select.addEventListener('change', () => {
            const horseKey = select.dataset.horseKey;
            saveHorseClinicalField(eq, horseKey, { mucosa: select.value });
        });
    });
}

async function saveHorseClinicalField(eq = {}, horseKey, updateData = {}) {
    if (!competitionId || !eq.startNumber) return;
    const phase = currentPhase;
    try {
        // Built from the latest copy: another vet may have saved another horse
        await updateEquipageFromLatest(competitionId, eq.startNumber, (latest) => ({
            horses: updateHorsePhaseInspection(latest.horses, horseKey, phase, updateData)
        }), eq);
    } catch (err) {
        console.warn('Failed to save horse clinical data:', err);
    }
}

async function saveVetNote(startNumber, note, saveBtn) {
    try {
        const noteKey = currentPhase === 'initial' ? 'vetNotes' : `vetNotes_${currentPhase}`;
        await saveEquipage(competitionId, startNumber, { [noteKey]: note });
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
    const phaseInfo = VET_PHASES[currentPhase] || VET_PHASES.initial;
    if (status === 'struken' && !confirm(`Är du säker på att ekipage #${startNumber} ska strykas / få startförbud i ${phaseInfo.shortLabel}?`)) {
        return;
    }

    const phase = currentPhase;
    try {
        const local = allEquipages.find(item => String(item.startNumber) === String(startNumber)) || {};
        // Built from the latest copy of the equipage (see updateEquipageFromLatest)
        const buildPayload = (eq) => {
            const horses = Array.isArray(eq?.horses) && eq.horses.length
                ? eq.horses.map(horse => {
                    const currentData = horse.inspections?.[phase] || {};
                    const nowIso = new Date().toISOString();
                    const newInspections = {
                        ...(horse.inspections || {}),
                        [phase]: {
                            ...currentData,
                            status: normalizeVetStatus(status),
                            checkedAt: nowIso
                        }
                    };
                    const updated = {
                        ...horse,
                        inspections: newInspections
                    };
                    if (phase === 'initial') {
                        updated.vetStatus = normalizeVetStatus(status);
                        updated.vetCheckedAt = nowIso;
                    }
                    return updated;
                })
                : null;

            const derived = horses ? deriveVetStatusFromHorses(horses, eq?.status, phase) : status;
            const payload = horses ? { horses } : {};
            if (phase === 'initial') {
                payload.status = derived;
            } else if (phase === 'restArea' && status === 'struken') {
                payload.vetUnfitStageB = true;
            }

            payload[`vetInspection_${phase}`] = {
                status: derived,
                updatedAt: new Date().toISOString()
            };
            return payload;
        };

        await updateEquipageFromLatest(competitionId, startNumber, buildPayload, local);
        showAlert(`Ekipage #${startNumber}: ${phaseInfo.shortLabel} -> ${String(status).toUpperCase()}`);
    } catch (error) {
        console.error('Vet update failed', error);
        showAlert('Kunde inte uppdatera status', false);
    }
}

async function setHorseVetStatus(eq = {}, horseKey, status, extraData = {}) {
    if (!competitionId || !eq.startNumber) return;
    const phaseInfo = VET_PHASES[currentPhase] || VET_PHASES.initial;
    if (status === 'struken' && !confirm(`Ska vald häst i ekipage #${eq.startNumber} underkännas / få startförbud i ${phaseInfo.shortLabel}?`)) {
        return;
    }

    const phase = currentPhase;
    try {
        // Built from the latest copy: another vet may have saved another horse
        await updateEquipageFromLatest(competitionId, eq.startNumber, (latest) => {
            const horses = updateHorsePhaseInspection(latest.horses, horseKey, phase, {
                status,
                ...extraData
            });
            const derivedStatus = deriveVetStatusFromHorses(horses, latest.status, phase);
            const payload = {
                horses,
                [`vetInspection_${phase}`]: {
                    status: derivedStatus,
                    updatedAt: new Date().toISOString()
                }
            };
            if (phase === 'initial') {
                payload.status = derivedStatus;
            } else if (phase === 'restArea' && derivedStatus === 'struken') {
                payload.vetUnfitStageB = true;
            }
            return payload;
        }, eq);
        showAlert(`Ekipage #${eq.startNumber}: häst ${String(status).toUpperCase()}`);
    } catch (error) {
        console.error('Vet horse update failed', error);
        showAlert('Kunde inte uppdatera häststatus', false);
    }
}
