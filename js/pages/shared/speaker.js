// js/pages/speaker.js
// En specialanpassad vy för speaker med fokus på talarstöd (noteringar, kommande, resultat).

import { getGlobalState } from '../../main.js';
import { openDetails as showDressageDetailsModal } from '../../ui/dressageModal.js';
import { showDetailsModal as showPrecisionDetailsModal } from '../../ui/precisionModal.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getJudges } from '../../services/adminService.js';
import { updateEquipage } from '../../services/equipageService.js';
import { getDressageResultsForEquipage } from '../../services/dressageService.js';
import {
    getPrograms,
    normalizeMovements,
    deduplicateAndFilterProtocols,
    guessProgramKeyFromClass,
    normJudgeId
} from '../../utils/dressageUtils.js';
import { calculateDressageResult, calculateSingleJudgeDressageResult, calculateTotalResult } from '../../services/calculationService.js';
import { openEquipageModal } from '../../ui/equipage-modal.js';

import { getCompetitionHeader } from '../../ui/components.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { msToLabel } from '../../utils/sharedUtils.js';
import { dressagePrograms as globalDressagePrograms } from '../../data/dressagePrograms.js';

import {
    stageDurationMsSaved,
    stageStartTS,
    stageStopTS,
    formatMsLive,
    pausedMsSince,
    setMarathonConfig,
    limitsFor,
    calculateMarathonResult,
    getObstacleCoefficient,
    calculateClassObstacleStats,
    calculateProjectedPenalty,
    calculateClassSplitStats,
    maraton_marathonConfig
} from '../../utils/marathonUtils.js';

import { showDetailsModal as showMarathonDetailsModal } from '../../ui/marathonModal.js';

import {
    computeMaxSecondsForClass,
    getCalculatedRowData
} from '../../utils/precisionUtils.js';

import { startMarathonSimulation } from '../../utils/simulator.js';
import {
    expandDressagePosition,
    formatTime,
    isWithdrawnOrExcluded,
    matchesDisplayClass,
    normState
} from './speakerHelpers.js';
import {
    getDressageFinalPenalty as readDressageFinalPenalty,
    getDressageFinalPercent as readDressageFinalPercent,
    getSpeakerDisciplineResult as readSpeakerDisciplineResult,
    getSpeakerDisciplineState as readSpeakerDisciplineState
} from './speakerResults.js';
import { getLeaderToBeat, getDressageLeaderInClass, calculateLiveInjection, getTotalRanking } from './speakerCalculations.js';
import {
    getChasingTarget as renderListChasingTarget,
    getStartTimeForDisplay as renderListStartTimeForDisplay,
    getStartTimeForSort as renderListStartTimeForSort,
    renderActiveListNew as renderListActiveListNew,
    renderLeaderToBeat as renderListLeaderToBeat,
    renderRecentResultsList as renderListRecentResultsList,
    renderTop3List as renderListTop3List,
    renderUpcomingList as renderListUpcomingList
} from './speakerLists.js';
import {
    renderObstacleFocus as renderMarathonObstacleFocus,
    renderObstacleLeaderboard as renderMarathonObstacleLeaderboard,
    renderSectorAnalysis as renderMarathonSectorAnalysis
} from './speakerMarathon.js';
import {
    ensureMainTicker as ensureTimerMainTicker,
    stopLiveClock as stopTimerLiveClock,
    updateLiveClocks as updateTimerLiveClocks
} from './speakerTimer.js';
import { setupAllListeners as setupSpeakerStateListeners } from './speakerState.js';

// ================= State =================
let competitionId = null;
let currentDiscipline = 'dressyr'; // 'dressyr', 'maraton', 'precision'
let allEquipages = [];
let startTimes = {};
let allJudges = [];
let mergedPrograms = {};

// Data-cachar (Dressyr)
const dressageStatusMap = new Map();
const liveProtocolMap = new Map();
const savedProtocolsMap = new Map();

// Data-cachar (Maraton)
const maratonStatusMap = new Map();
// activeEquipages tracks running state for ALL marathon drivers simultaneously
const activeEquipages = new Map();

// Data-cachar (Precision)
const precisionStatusMap = new Map();
let precisionConfig = {};

// Render-variabler
let currentRider = null;
let recentResults = [];
let manualFocusId = null; // För att manuellt välja vem man tittar på i maraton/active-list
let obstacleFocusVal = null; // New: Selected obstacle number for "Obstacle Focus View"
let sidebarClassFocus = null; // New: Manually selected class for the sidebar leaderboard

let lastFullRenderTime = 0;
let lastActiveRiderId = null;
let lastActiveDiscipline = null;

function ensureMainTicker() {
    ensureTimerMainTicker(getSpeakerViewContext);
}

window.showRiderDetails = (sn) => {
    try {
        const eq = allEquipages.find(e => String(e.startNumber) === String(sn));
        if (!eq) return;

        if (currentDiscipline === 'maraton') {
            showMarathonDetailsModal(sn, allEquipages, maratonStatusMap);
        } else if (currentDiscipline === 'dressyr') {
            showDressageDetailsModal(sn, { equipages: allEquipages, statusMap: dressageStatusMap, currentJudges: allJudges });
        } else if (currentDiscipline === 'precision') {
            showPrecisionDetailsModal(sn, allEquipages, precisionStatusMap, precisionConfig, startTimes);
        } else {
            // 'totalt' tab needs the unified equipage modal
            // Use the same class/grouping logic as the sidebar and result page
            const cls = eq.className || '';
            const mergedKey = eq.mergedTestKey || eq._mergedKey;
            
            // Try to provide a full list for the class to support rankings/placings in modal
            const liveInfo = calculateLiveInjection(eq, getSpeakerCalculationContext()); // Include live prognosis if this is the active rider
            const resultRows = getTotalRanking(cls, liveInfo, getSpeakerCalculationContext());
            
            const ctx = {
                competitionId: competitionId || (getGlobalState ? getGlobalState('currentCompetition')?.id : null),
                equipages: allEquipages || [],
                resultRows: resultRows,
                dressageMap: dressageStatusMap,
                maratonMap: maratonStatusMap,
                precisionMap: precisionStatusMap,
                allCompetitionJudges: allJudges,
                marathonConfig: maraton_marathonConfig,
                precisionConfig: precisionConfig || {},
                // Add these for full compatibility
                limitsFor: limitsFor,
                secondsToMMSS: (s) => { if (s == null || isNaN(s)) return null; const m = Math.floor(s / 60); const ss = Math.round(s % 60).toString().padStart(2, '0'); return `${m}:${ss}`; }
            };
            
            if (typeof openEquipageModal === 'function') {
                openEquipageModal(sn, ctx);
            } else {
                console.error('openEquipageModal not found');
            }
        }
    } catch (err) {
        console.error('Error in showRiderDetails:', err);
    }
};

let isGloballyPaused = false;
let pauseStartTime = 0;

let unsubscribes = [];


window.handleSpeakerSearch = (val) => {
    if (!val) return;
    val = val.toLowerCase().trim();
    // Try to find exact start number
    let match = allEquipages.find(e => String(e.startNumber) === val);
    // If not, try name match
    if (!match) match = allEquipages.find(e => (e.driverName || '').toLowerCase().includes(val));
    
    if (match) {
        window.selectSpeakerRider(match.startNumber);
    } else {
        alert('Hittade inget ekipage som matchar: ' + val);
    }
};

window.clearSpeakerFocus = () => {
    manualFocusId = null;
    document.getElementById('speaker-search-input').value = '';
    triggerRender(true);
};

// ================= Helpers =================


function getSpeakerResultContext() {
    return {
        activeEquipages,
        allEquipages,
        dressageStatusMap,
        maratonStatusMap,
        precisionConfig,
        precisionStatusMap,
        startTimes
    };
}

function getSpeakerCalculationContext() {
    return {
        ...getSpeakerResultContext(),
        liveProtocolMap,
        allJudges,
        mergedPrograms
    };
}

function getSpeakerViewContext() {
    return {
        ...getSpeakerCalculationContext(),
        currentDiscipline,
        currentRider,
        recentResults,
        manualFocusId,
        isGloballyPaused,
        pauseStartTime,
        formatMsLive,
        pausedMsSince,
        limitsFor,
        marathonConfig: maraton_marathonConfig
    };
}

function getSpeakerStateContext() {
    return {
        competitionId,
        unsubscribes,
        triggerRender,
        ensureSpeakerTicker,
        dressageStatusMap,
        liveProtocolMap,
        savedProtocolsMap,
        maratonStatusMap,
        activeEquipages,
        precisionStatusMap,
        recentResults,
        getAllEquipages: () => allEquipages,
        setAllEquipages: value => { allEquipages = value || []; },
        getAllJudges: () => allJudges,
        setAllJudges: value => { allJudges = value || []; },
        setStartTimes: value => { startTimes = value || {}; },
        setPrecisionConfig: value => { precisionConfig = value || {}; },
        setGloballyPaused: value => { isGloballyPaused = value === true; },
        setPauseStartTime: value => { pauseStartTime = value || 0; },
        getCurrentDiscipline: () => currentDiscipline,
        maybePushRecent,
        maybePushRecentMarathon,
        maybePushRecentPrecision,
        evaluateActiveState,
        verifyDressageResult: typeof verifyDressageResult !== 'undefined' ? verifyDressageResult : null
    };
}

function getDressageFinalPenalty(sn) {
    return readDressageFinalPenalty(dressageStatusMap, sn);
}

function getDressageFinalPercent(sn) {
    return readDressageFinalPercent(dressageStatusMap, sn);
}

function getSpeakerDisciplineState(eq, discipline) {
    return readSpeakerDisciplineState(eq, discipline, getSpeakerResultContext());
}

function getSpeakerDisciplineResult(eq, discipline) {
    return readSpeakerDisciplineResult(eq, discipline, getSpeakerResultContext());
}

let renderTimeout = null;
function triggerRender(force = false) {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        findCurrentRider();
        
        const now = Date.now();
        const activeRiderKey = currentRider?.eq?.startNumber != null ? String(currentRider.eq.startNumber) : null;
        const riderChanged = activeRiderKey !== lastActiveRiderId;
        const disciplineChanged = currentDiscipline !== lastActiveDiscipline;

        // Only do a FULL render if forced, or state changed, or it's been a while (2s)
        if (force || riderChanged || disciplineChanged || (now - lastFullRenderTime > 2000)) {
            renderSpeakerDashboard();
            lastFullRenderTime = now;
            lastActiveRiderId = activeRiderKey;
            lastActiveDiscipline = currentDiscipline;
        } else {
            // Otherwise JUST update the live clocks/timers (which use textContent)
            updateLiveClocks();
        }
    }, 100);
}



// ================= Live Clock =================
let liveClockInterval = null;
function startLiveClock() {
    // Legacy helper - redirected to ensureMainTicker
    ensureMainTicker();
}

function updateLiveClocks() {
    updateTimerLiveClocks(getSpeakerViewContext());
}

// Start the clock
startLiveClock();

// ================= Notes Editing =================
window.editSpeakerNotes = (sn) => {
    // Current Notes
    const notesEl = document.getElementById('speaker-notes-content');
    const container = document.getElementById('speaker-notes-card');
    if (!notesEl || !container) return;

    // Check if already editing
    if (document.getElementById('edit-notes-area')) return;

    const currentText = notesEl.innerText === "Inga specifika noteringar inlagda." ? "" : notesEl.innerText;

    // Replace with textarea
    const area = document.createElement('textarea');
    area.id = 'edit-notes-area';
    area.className = 'w-full h-32 p-2 border rounded text-lg text-gray-800  mb-2';
    area.value = currentText;

    const btnContainer = document.createElement('div');
    btnContainer.className = 'flex justify-end gap-2';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'px-4 py-1 bg-green-600 text-white rounded font-bold hover:bg-green-700';
    saveBtn.innerText = 'Spara';
    saveBtn.onclick = async () => {
        const newVal = area.value;
        notesEl.textContent = newVal || "Sparar...";
        try {
            await updateEquipage(resolveCurrentCompId(), String(sn), { speakerNotes: newVal });
            notesEl.textContent = newVal || "Inga specifika noteringar inlagda.";
            cleanup();
        } catch (e) {
            alert('Kunde inte spara noteringar.');
            console.error(e);
        }
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-4 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400';
    cancelBtn.innerText = 'Avbryt';
    cancelBtn.onclick = () => {
        notesEl.textContent = currentText || "Inga specifika noteringar inlagda.";
        cleanup();
    };

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(saveBtn);

    function cleanup() {
        if (container.contains(area)) container.removeChild(area);
        if (container.contains(btnContainer)) container.removeChild(btnContainer);
        notesEl.style.display = 'block';
        document.getElementById('edit-notes-btn')?.classList.remove('hidden');
    }

    // Hide original text and edit button
    notesEl.style.display = 'none';
    document.getElementById('edit-notes-btn')?.classList.add('hidden');

    container.appendChild(area);
    container.appendChild(btnContainer);
    area.focus();
};

function resolveCurrentCompId() {
    return competitionId;
}

// ================= UI =================

// (calculateClassObstacleStats imported from marathonUtils)

function renderLayout() {
    const comp = getGlobalState('currentCompetition');
    const root = document.getElementById('page-speaker');
    if (!root) return;

    if (!document.getElementById('discipline-switcher')) {
        root.innerHTML = `
            <div class="container mx-auto p-4 flex flex-col h-screen max-h-screen overflow-hidden">
                ${getCompetitionHeader(comp, 'Speaker Dashboard', true)}
                <div id="discipline-switcher" class="flex justify-center gap-2 mb-4 pt-4 shrink-0"></div>
                <div id="speaker-page-content" class="flex-1 min-h-0 overflow-y-auto"></div>
            </div>
        `;
    }

    const container = document.getElementById('speaker-page-content');
    if (!container) return;

    if (!document.getElementById('unified-grid-layout')) {
        container.innerHTML = `
        <div id="unified-grid-layout" class="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-8 h-full">
            <!-- Left Main Column (9) -->
            <div class="lg:col-span-9 flex flex-col gap-6 h-full overflow-hidden">
                <!-- Top Left: Current Rider Card + Obstacles/Sectors -->
                <div class="flex flex-col shrink-0 gap-6">
                    <!-- Main Rider Card -->
                    <div id="current-rider-card" class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
                        <!-- renderCurrentRiderCard renders here -->
                    </div>
                    
                    <!-- Marathon Specific: Obstacle Focus -->
                     <div id="marathon-obstacle-focus" class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex-col h-fit ${currentDiscipline === 'maraton' ? 'flex' : 'hidden'}">
                        <div class="bg-gray-50 dark:bg-gray-700/50 px-4 py-2 border-b border-gray-100 dark:border-gray-600 flex justify-between items-center">
                            <h3 class="font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide text-xs">Hinderresultat (Fokus)</h3>
                             <div class="flex items-center gap-2">
                                <label class="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase">Välj Hinder:</label>
                                <select onchange="window.setObstacleFocus(this.value)" class="text-xs border-gray-300 dark:border-gray-600 rounded shadow-sm focus:border-blue-500 focus:ring-blue-500 py-1 dark:bg-gray-700 dark:text-white">
                                    <option value="">- Göm -</option>
                                    ${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${Number(obstacleFocusVal) === n ? 'selected' : ''}>Hinder ${n}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                         <div id="obstacle-focus-content" class="p-0 animate-fade-in"></div>
                      </div>

                    <!-- Marathon Specific: Sector Analysis -->
                    <div id="marathon-sector-analysis" class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex-col h-fit ${currentDiscipline === 'maraton' ? 'flex' : 'hidden'}">
                        <div class="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 border-b border-indigo-100 dark:border-indigo-800 flex justify-between items-center">
                            <h3 class="font-bold text-indigo-800 dark:text-indigo-200 uppercase tracking-wide text-xs">Sektoranalys (Vägsträckor A / T)</h3>
                        </div>
                        <div id="sector-analysis-content" class="p-0"></div>
                    </div>

                     <!-- Speaker Notes -->
                     <div id="speaker-notes-card" class="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl shadow-sm border border-yellow-200 dark:border-yellow-800/50 p-4 shrink-0 h-fit min-h-[150px]">
                        <div class="flex justify-between items-center mb-2">
                            <h3 class="font-bold text-yellow-800 dark:text-yellow-200 uppercase tracking-wide text-xs">Speaker Noteringar</h3>
                             <button onclick="window.editSpeakerNotes(currentRider?.eq?.startNumber)" class="text-yellow-600 hover:text-yellow-800 dark:text-yellow-300 dark:hover:text-yellow-100 text-xs font-bold px-2 py-1 bg-yellow-100 dark:bg-yellow-800/50 rounded">✎ Ändra</button>
                        </div>
                        <div id="speaker-notes-content" class="text-gray-800 dark:text-gray-200 text-lg  italic leading-relaxed">
                            Inga specifika noteringar inlagda.
                        </div>
                     </div>
                </div>

                <!-- Upcoming / Startlist (Stretches) -->
                <div id="upcoming-list-container" class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col flex-1 min-h-0">
                    <div class="bg-gray-50 dark:bg-gray-700/50 px-4 py-2 border-b border-gray-100 dark:border-gray-600 shrink-0">
                         <h3 class="font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-xs">Kommande startande</h3>
                    </div>
                     <div id="upcoming-list-content" class="p-2 space-y-1 overflow-y-auto custom-scrollbar flex-1"></div>
                </div>
            </div>

            <!-- Right Sidebar Column (3) -->
            <div class="lg:col-span-3 flex flex-col gap-4 h-full overflow-hidden">
                 <!-- Active List -->
                <div id="active-list-container" class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col shrink-0 max-h-[50%]">
                    <div class="bg-amber-50 dark:bg-amber-900/30 px-4 py-2 border-b border-amber-100 dark:border-amber-800 flex justify-between items-center shrink-0">
                        <h3 class="font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wide text-xs">På banan just nu</h3>
                        <span class="text-xs font-bold text-amber-600 dark:text-amber-300 bg-amber-100 dark:bg-amber-800/50 px-2 py-0.5 rounded-full" id="active-count-badge">0</span>
                    </div>
                    <div id="active-list-content" class="p-2 space-y-2 relative overflow-y-auto custom-scrollbar"></div>
                </div>

                 <!-- Leaderboard (Stretches) -->
                 <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col flex-1 min-h-0">
                     <div class="bg-blue-900 dark:bg-blue-950 text-white px-4 py-3 flex justify-between items-center shrink-0">
                         <h3 id="sidebar-leaderboard-title" class="font-bold uppercase tracking-wider text-sm">Ställning</h3>
                         <div class="text-[10px] bg-blue-800 dark:bg-blue-900 px-2 py-0.5 rounded text-blue-200" id="sidebar-class-name">--</div>
                     </div>
                     
                     <div class="p-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 shrink-0">
                         <div class="grid grid-cols-6 text-[10px] uppercase font-bold text-gray-400 px-2">
                             <div class="col-span-1">#</div>
                             <div class="col-span-3">Namn</div>
                             <div class="col-span-2 text-right">Straff</div>
                         </div>
                     </div>

                     <div id="sidebar-leaderboard-content" class="flex-1 p-0 overflow-y-auto custom-scrollbar"></div>
                 </div>
            </div>
        </div>`;
    } else {
        // Toggle marathon specific blocks without fully rerendering
        const mObs = document.getElementById('marathon-obstacle-focus');
        const mSec = document.getElementById('marathon-sector-analysis');
        if (mObs) mObs.className = `bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex-col h-fit ${currentDiscipline === 'maraton' ? 'flex' : 'hidden'}`;
        if (mSec) mSec.className = `bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex-col h-fit ${currentDiscipline === 'maraton' ? 'flex' : 'hidden'}`;
    }

    renderSpeakerDashboard();
}


// === EXPOSE INTERNALS FOR SIMULATOR ===
window.speakerInternals = {
    get allEquipages() { return allEquipages; },
    get maratonStatusMap() { return maratonStatusMap; },
    get activeEquipages() { return activeEquipages; },
    triggerRender: () => triggerRender()
};
window.startStressTest = startMarathonSimulation;

function renderLeaderboardSidebar() {
    const el = document.getElementById('sidebar-leaderboard-content');
    const badge = document.getElementById('sidebar-class-name');
    const titleEl = document.getElementById('sidebar-leaderboard-title');
    if (!el) return;

    // Update Title based on discipline
    if (titleEl) {
        if (currentDiscipline === 'maraton') titleEl.textContent = "Maratonställning";
        else if (currentDiscipline === 'dressyr') titleEl.textContent = "Dressyrställning";
        else if (currentDiscipline === 'precision') titleEl.textContent = "Precisionställning";
        else if (currentDiscipline === 'totalt') titleEl.textContent = "Totalställning";
        else titleEl.textContent = "Ställning";
    }

    // 1. Determine which class to show
    let className = sidebarClassFocus || currentRider?.eq?.className;

    // Fallback: Pick first class from allEquipages if still null
    if (!className && allEquipages.length > 0) {
        className = allEquipages[0].className;
    }

    // 2. Build Class Switcher HTML
    if (badge) {
        const uniqueClasses = [...new Set(allEquipages.map(e => e._mergedLabel || e.mergedTestLabel || e.className))].sort();
        if (uniqueClasses.length > 1) {
            // Check if we already have the select to avoid flicker/reset
            const existingSelect = badge.querySelector('select');
            if (existingSelect) {
                if (existingSelect.value !== className) {
                    existingSelect.value = className;
                }
            } else {
                badge.innerHTML = `
                    <select onchange="window.setSidebarClassFocus(this.value)" class="bg-blue-800 text-white text-[10px] border-none rounded focus:ring-0 py-0.5 cursor-pointer pr-4">
                        ${uniqueClasses.map(c => `<option value="${c}" ${c === className ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                `;
            }
        } else {
            badge.textContent = className || 'Ingen klass';
        }
    }

    if (!className) {
        el.innerHTML = '<div class="p-4 text-center text-gray-400 italic text-xs">Inga ekipage laddade</div>';
        return;
    }

    // 3. Get Unified Ranking
    const liveInjection = currentRider ? calculateLiveInjection(currentRider.eq || currentRider, getSpeakerCalculationContext()) : null;
    const ranked = getTotalRanking(className, liveInjection, getSpeakerCalculationContext());

    if (ranked.length === 0) {
        el.innerHTML = '<div class="p-4 text-center text-gray-400 italic text-xs">Inga ekipage i denna klass</div>';
        return;
    }

    const leaderScore = (ranked.length > 0 && Number.isFinite(ranked[0].total)) ? ranked[0].total : 0;

    el.innerHTML = ranked.map((r, i) => {
        const rank = i + 1;
        const isLeader = i === 0;
        const diff = (Number.isFinite(r.total) && !isLeader) ? (r.total - leaderScore) : 0;

        let diffHtml = '';
        if (Number.isFinite(r.total)) {
            if (isLeader) diffHtml = `<span class="text-[10px] text-green-600 font-bold uppercase">LedarBoll</span>`;
            else diffHtml = `<span class="text-[10px] text-red-400 tabular-nums tracking-wide">+${diff.toFixed(2)}</span>`;
        }

        const isRunning = liveInjection && String(liveInjection.sn) === String(r.sn);
        const scoreClass = isRunning ? 'text-blue-600 dark:text-blue-400 animate-pulse' : 'text-gray-900 dark:text-gray-100';
        const rowBg = isRunning ? 'bg-blue-50 dark:bg-blue-900/20' : (isLeader ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30');
        const isSelected = (currentRider && String(currentRider.eq.startNumber) === String(r.sn));
        const selectedClass = isSelected ? 'ring-2 ring-inset ring-blue-400' : '';

        // Note: r has { sn, name, total, tieBreakerTime } 
        const eq = allEquipages.find(e => String(e.startNumber) === String(r.sn));
        const club = eq?.clubName || '';

        return `
        <div onclick="window.showRiderDetails('${r.sn}')" class="grid grid-cols-6 items-center p-2 border-b border-gray-100 dark:border-gray-700 last:border-0 cursor-pointer transition-colors ${rowBg} ${selectedClass}">
            <div class="col-span-1 font-bold text-gray-500 dark:text-gray-400 text-xs">${rank}.</div>
            <div class="col-span-3 min-w-0 pr-1">
                <div class="font-bold text-gray-800 dark:text-gray-200 text-sm truncate leading-tight">${r.name}</div>
                <div class="text-[10px] text-gray-400 dark:text-gray-500 truncate">${club}</div>
            </div>
            <div class="col-span-2 text-right">
                <div class="tabular-nums tracking-wide font-bold text-sm ${scoreClass}">${r.total === Infinity ? 'UT' : (Number.isFinite(r.total) ? r.total.toFixed(1) : '—')}</div>
                ${diffHtml}
            </div>
        </div>`;
    }).join('');
}

// Make global for inline clicks

window.setComparisonRider = (val) => {
    window.compareRiderId = val;
    triggerRender(true);
};

function updateDisciplineUI() {
    const nav = document.getElementById('discipline-switcher');
    if (nav) {
        // Compact segmented control
        nav.className = "flex bg-gray-200 rounded-lg p-1 gap-1 text-xs font-bold items-center";
        nav.innerHTML = `
            <button onclick="switchDiscipline('dressyr')" class="flex-1 px-3 py-1.5 rounded-md transition-all ${currentDiscipline === 'dressyr' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}">Dressyr</button>
            <button onclick="switchDiscipline('maraton')" class="flex-1 px-3 py-1.5 rounded-md transition-all ${currentDiscipline === 'maraton' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}">Maraton</button>
            <button onclick="switchDiscipline('precision')" class="flex-1 px-3 py-1.5 rounded-md transition-all ${currentDiscipline === 'precision' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}">Precision</button>
            <button onclick="switchDiscipline('totalt')" class="flex-1 px-3 py-1.5 rounded-md transition-all ${currentDiscipline === 'totalt' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}">Totalt</button>
            
            <button onclick="if(confirm('Starta Stress-test?')) window.startStressTest()" class="text-xs px-2 py-1 text-red-300 hover:text-red-500 hover:bg-red-50 rounded hidden" title="Simulera">⚡</button>
            
            <div class="flex items-center gap-2 ml-4 relative">
                <input type="text" id="speaker-search-input" placeholder="Sök # eller Namn..." class="px-2 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900" onkeyup="if(event.key==='Enter') window.handleSpeakerSearch(this.value)">
                <button onclick="window.handleSpeakerSearch(document.getElementById('speaker-search-input').value)" class="bg-blue-600 text-white px-2 py-1 text-xs rounded font-bold hover:bg-blue-700">Sök</button>
                <button id="speaker-clear-focus-btn" onclick="window.clearSpeakerFocus()" class="${manualFocusId ? 'block animate-pulse' : 'hidden'} absolute -right-[110px] bg-red-600 text-white px-2 py-1 text-xs rounded font-bold hover:bg-red-700 whitespace-nowrap z-50">Återgå till Live</button>
            </div>

        `;
    }
}

function switchDiscipline(newDisc) {
    if (currentDiscipline === newDisc) return;
    currentDiscipline = newDisc;
    renderLayout(); // Rebuild shell
    updateDisciplineUI();
    manualFocusId = null;
    triggerRender(true);
}
window.switchDiscipline = switchDiscipline;

// Verification Helper
async function verifyDressageResult(sn, st, eq) {
    try {
        const programKey = st.testKey || st.programKey || eq.testKey || (window.klassProgramMapping?.[eq?.className] ?? null);
        const programObj = programKey ? mergedPrograms[programKey] : null;

        if (programObj) {
            const protocols = await getDressageResultsForEquipage(competitionId, eq.id || sn);
            const programs = getPrograms();
            const result = calculateDressageResult(eq, protocols, allJudges, programs);

            if (result && result.penalty != null) {
                // Update map with VERIFIED calculation
                const current = dressageStatusMap.get(sn) || {};
                dressageStatusMap.set(sn, {
                    ...current,
                    finalPercent: result.percent,
                    finalPoints: result.points,
                    finalPenalty: result.penalty,
                    errorPoints: result.errorPoints,
                    errorPenalty: result.penalty,
                    _verified: true
                });
                triggerRender();
            }
        }
    } catch (e) {
        console.warn('Verification failed for', sn, e);
    }
}

function renderSpeakerDashboard() {
    renderCurrentRiderCard();
    renderObstacleFocus();
    renderActiveListNew();
    renderSectorAnalysis();
    renderUpcomingList();
    renderRecentResultsList();
    renderLeaderboardSidebar();
    ensureSpeakerTicker();
}

function selectRider(sn) {
    manualFocusId = String(sn);
    triggerRender();
}
window.selectSpeakerRider = selectRider;

window.setObstacleFocus = (val) => {
    obstacleFocusVal = val ? Number(val) : null;
    triggerRender();
};

window.setSidebarClassFocus = (val) => {
    sidebarClassFocus = val || null;
    triggerRender();
};

function renderObstacleFocus() {
    const el = document.getElementById('obstacle-focus-content');
    if (!el) return;
    el.innerHTML = renderMarathonObstacleFocus(obstacleFocusVal, getSpeakerViewContext());
}

// New: Render Obstacle Leaderboard (Focus View)
function renderObstacleLeaderboard(obstacleNum) {
    return renderMarathonObstacleLeaderboard(obstacleNum, getSpeakerViewContext());
}

// ================= Dressage Helpers (Phase 4) =================

// function calcLiveJudgeProjection removed (imported from utils)

function renderSpeakerJudgeGrid(liveProtocolsArray, currentMomentIdx, startNumber) {
    // Robust sort and filter
    const sorted = deduplicateAndFilterProtocols(liveProtocolsArray || [], window.currentJudgesPresent || allJudges || []);
    const posOrder = { 'C': 0, 'E': 1, 'B': 2, 'H': 3, 'M': 4 };
    sorted.sort((a, b) => (posOrder[String(a.position).toUpperCase()] ?? 99) - (posOrder[String(b.position).toUpperCase()] ?? 99));

    if (sorted.length === 0) return '';

    const cells = sorted.map(d => {
        const pos = String(d.position || d.judgePosition || '?').toUpperCase();

        // --- LOOKUP JUDGE NAME ---
        let judgeName = '';
        const cleanId = String(d.judgeId || '').replace(/^judge_/i, '').trim().toLowerCase();
        let judgeObj = (window.currentJudgesPresent || []).find(j => String(j.id).toLowerCase() === cleanId);
        if (!judgeObj) judgeObj = (window.currentJudgesPresent || []).find(j => String(j.position).toUpperCase() === pos);
        if (!judgeObj) judgeObj = (allJudges || []).find(j => String(j.id).toLowerCase() === cleanId);
        if (judgeObj) judgeName = judgeObj.name || judgeObj.fullname || '';
        const nameHtml = judgeName ? `<div class="text-[10px] text-gray-400 truncate -mt-0.5 mb-1">${judgeName}</div>` : '';
        const eq = allEquipages.find(e => String(e.startNumber) === String(startNumber)) || {};
        const programs = getPrograms();
        const testKey = d.testKey || d.programKey || eq?.testKey;
        const pObj = programs[testKey] || (eq?.className ? programs[guessProgramKeyFromClass(eq.className, programs)] : null);

        // Calculate projection
        const jr = calculateSingleJudgeDressageResult(d, pObj, eq);
        const pTxt = jr && Number.isFinite(jr.projectedPercent) ? `${jr.projectedPercent.toFixed(1)}%` : (jr && Number.isFinite(jr.percent) ? `${jr.percent.toFixed(1)}%` : '–');

        // Live Moment Text
        // Try to find the program definition for better text (description)

        // UI Variables
        let lastTxt = '—', lastScoreTxt = '';
        let lastMomentNo = null, lastScoreVal = null;

        if (currentMomentIdx >= 0 && d.movements && d.movements[currentMomentIdx]) {
            const m = d.movements[currentMomentIdx];
            const momentNo = m.momentNo;
            lastMomentNo = momentNo;
            lastScoreVal = Number.isFinite(m.score) ? Number(m.score) : null;

            let pText = '';
            const testKey = d.testKey || d.programKey || eq?.testKey;
            const allProgs = mergedPrograms || {};
            const pObj = allProgs[testKey] || (eq?.className ? allProgs[guessProgramKeyFromClass(eq.className, allProgs)] : null);
            if (pObj && pObj.movements) {
                const pm = pObj.movements.find(mov => mov.no === momentNo);
                if (pm) pText = pm.text || pm.description || pm.movement || '';
            }

            lastTxt = pText || m.momentText || `M${momentNo}`;
            if (Number.isFinite(m.score)) lastScoreTxt = ` (${Number(m.score).toFixed(1)})`;
        } else if (d.movements && d.movements.length > 0) {
            // Show last entered if not synced
            const m = d.movements[d.movements.length - 1];
            lastMomentNo = m.momentNo;
            lastScoreVal = Number.isFinite(m.score) ? Number(m.score) : null;

            lastTxt = m.momentText || `M${m.momentNo}`;
            if (Number.isFinite(m.score)) lastScoreTxt = ` (${Number(m.score).toFixed(1)})`;
        }

        return `
      <div class="p-2 bg-gray-50 dark:bg-gray-700/50 rounded border dark:border-gray-600 flex flex-col items-center">
         <div class="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">Domare ${pos}</div>
         ${nameHtml}
         <div class="text-xl font-bold text-brand-darkblue dark:text-blue-200 my-1">${pTxt}</div>
         
         <div class="grid grid-cols-2 gap-2 w-full mt-1 border-t border-gray-200 dark:border-gray-600 pt-1">
            <div class="text-center border-r border-gray-200 dark:border-gray-600">
                <div class="text-[9px] uppercase text-gray-400">Moment</div>
                <div class="text-xs font-bold text-gray-700 dark:text-gray-300">M${lastMomentNo || '-'}</div>
            </div>
            <div class="text-center">
                 <div class="text-[9px] uppercase text-gray-400">Betyg</div>
                 <div class="text-xs font-bold text-gray-900 dark:text-white">${lastScoreVal !== null ? lastScoreVal.toFixed(1) : '-'}</div>
            </div>
         </div>
      </div>`;
    }).join('');

    return `<div class="grid grid-cols-5 gap-2 mt-2">${cells}</div>`;
}


// New Helper: Render Top 3
function renderTop3List(className, discipline) {
    return renderListTop3List(className, discipline, getSpeakerViewContext());
}

function getValidFirstPasses(splits) {
    if (!splits || !Array.isArray(splits)) return [];
    const valid = [];
    const seen = new Set();
    for (const s of splits) {
        if (!s.char || s.char !== s.char.toUpperCase()) continue;
        if (!seen.has(s.char)) {
            seen.add(s.char);
            valid.push(s);
        }
    }
    return valid;
}

function renderCurrentRiderCard() {
    const el = document.getElementById('current-rider-card');
    const notesEl = document.getElementById('speaker-notes-content');
    if (!el || !notesEl) return;

    if (!currentRider) {
        el.innerHTML = `<div class="flex items-center justify-center h-full text-gray-400 text-2xl font-light">Inget ekipage på banan just nu</div>`;
        notesEl.innerHTML = `<span class="text-gray-400 italic">Inväntar ekipage...</span>`;
        return;
    }

    const { eq } = currentRider;
    const data = currentRider.data || currentRider.statusData;
    const notes = eq.speakerNotes ? eq.speakerNotes : "Inga specifika noteringar inlagda.";
    notesEl.textContent = notes;

    // Inject Edit Button into Notes Header if check present
    const notesCard = document.getElementById('speaker-notes-card');
    if (notesCard) {
        const h3 = notesCard.querySelector('h3');
        if (h3) {
            h3.innerHTML = `
            <div class="flex justify-between items-center">
                <span>📢 Speaker Noteringar</span>
                <button id="edit-notes-btn" onclick="editSpeakerNotes('${eq.startNumber}')" class="text-xs bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-100 px-2 py-1 rounded hover:bg-yellow-300 dark:hover:bg-gray-700 transition-colors">✎ Ändra</button>
            </div> `;
        }
    }

    let horseText = '';
    const horses = eq.horses || [];
    if (horses.length > 0) {
        horseText = horses.map(h => {
            const gender = h.gender ? `<span class="text-gray-400 font-medium">${h.gender}</span>` : '';
            const lineage = h.lineage ? `<div class="text-[10px] text-gray-500 dark:text-gray-400 ml-4  italic">Härstamning: ${h.lineage}</div>` : '';
            const owner = h.owner ? `<div class="text-[10px] text-gray-500 dark:text-gray-400 ml-4 ">Ägare: ${h.owner}</div>` : '';
            return `
                <div class="mb-2">
                    <div class="flex items-baseline gap-2">
                        <span class="font-bold text-gray-800 dark:text-gray-200">${h.name}</span>
                        ${gender}
                    </div>
                    ${lineage}
                    ${owner}
                </div>`;
        }).join('');
    } else {
        horseText = '<span class="text-gray-500 italic">Inga hästar registrerade</span>';
    }

    // --- Total Ranking Calculation (with Live Detection) ---
    const liveInjection = calculateLiveInjection(eq, getSpeakerCalculationContext());
    let targetToBeatHtml = '';
    let comparisonHtml = ''; 
    let elapsedTime = '—';


    const totalRanking = getTotalRanking(eq.className, liveInjection, getSpeakerCalculationContext());
    const myTotalRankIndex = totalRanking.findIndex(r => String(r.sn) === String(eq.startNumber));
    const myTotalRank = myTotalRankIndex !== -1 ? myTotalRankIndex + 1 : '-';
    // Find my total score
    const myTotalScore = myTotalRankIndex !== -1 ? totalRanking[myTotalRankIndex].total : null;

    // --- Win Requirement / Live Margin (Phase 3) ---
    let marginHtml = '';

    if (myTotalRankIndex !== -1) {
        // Find best OTHER score
        const others = totalRanking.filter(r => String(r.sn) !== String(eq.startNumber));
        if (others.length > 0) {
            const leader = others[0]; // Leader of the OTHERS
            const bestOther = leader.total;
            const diff = myTotalScore - bestOther;

            // "Target to Beat" Box
            // For Marathon: Only meaningful if they are close to finishing or we compare penalties directly.
            // If the values are small (like 6.0), it might be just the marathon penalty.
            // Let's clarify label or hide if marathon active.

            let targetLabel = "Mål att slå";
            if (currentDiscipline === 'maraton') {
                targetLabel = "Ledande Straff";
            }

            targetToBeatHtml = `
            <div class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">${targetLabel}</div>
                <div class="text-lg font-black text-gray-800 dark:text-gray-100 leading-tight">${leader.name}</div>
                <div class="text-lg tabular-nums tracking-wide font-bold text-gray-600 dark:text-gray-300">${(bestOther != null) ? bestOther.toFixed(2) : '—'}</div>
            </div> `;

            if (diff < 0) {
                // I am leading!
                // Balls Margin: How many 3.0 balls can I afford?
                const balls = Math.floor(Math.abs(diff) / 3.0);
                const ballsText = balls > 0 ? `(Råd med ${balls} boll${balls === 1 ? '' : 'ar'}!)` : '(Tajy! Inga bollar!)';

                // Hide balls text for Marathon (irrelevant/confusing?)
                const extraText = currentDiscipline === 'maraton' ? '' : `<br> <span class="text-[10px]">${ballsText}</span>`;

                marginHtml = `<div id="speaker-live-margin" class="text-xs mt-1 font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded border border-green-200">
    Segermarginal: ${(diff != null) ? Math.abs(diff).toFixed(2) : '—'} ${extraText}
    </div>`;
            } else {
                // I am behind
                marginHtml = `<div id="speaker-live-margin" class="text-xs mt-1 font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded border border-red-200">
    Upp till ledning: +${(diff != null) ? diff.toFixed(2) : '—'}
                 </div> `;

                // Tie-Breaker Logic (Only relevant if NOT dressage, or if we define a dressage tie-breaker)
                // For Dressage, we hide the time difference.
                if (Math.abs(diff) < 0.01 && currentDiscipline !== 'dressyr') {
                    // Check time
                    const myTime = liveInjection?.timeMs || 0;
                    const targetTime = leader.tieBreakerTime || 0;
                    const timeDiffSec = (myTime - targetTime) / 1000;
                    const timeColor = timeDiffSec < 0 ? 'text-green-600' : 'text-red-600';
                    const timeSign = timeDiffSec > 0 ? '+' : '';
                    marginHtml += `<div class="text-[10px] font-bold ${timeColor} mt-0.5">Lika straff! Tidsskillnad: ${timeSign}${timeDiffSec.toFixed(2)}s</div>`;
                }
            }
        } else {
            marginHtml = `<div class="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded border border-green-200">Leder klassen</div>`;
        }
    }

    let headerHtml = `
    <div class="flex justify-between items-start">
            <div>
                <div class="text-sm font-bold text-brand-darkblue dark:text-blue-300 uppercase tracking-wider mb-1 flex items-center gap-2">
                    På Banan Just Nu
                    
                    ${(currentDiscipline === 'maraton' || currentDiscipline === 'totalt') ? (() => {
            const targetClass = String(eq.className || '').trim().toLowerCase();
            let others = allEquipages.filter(e => {
                const eClass = String(e.className || '').trim().toLowerCase();
                return eClass === targetClass && String(e.startNumber) !== String(eq.startNumber);
            });

            // FALLBACK: If no others in same class, show all others (avoid empty list)
            let isFallback = false;
            if (others.length === 0 && allEquipages.length > 1) {
                others = allEquipages.filter(e => String(e.startNumber) !== String(eq.startNumber));
                isFallback = true;
            }



            return `
                        <select id="compare-select" onchange="window.setComparisonRider(this.value)" class="ml-2 text-[10px] py-0.5 pl-2 pr-6 border-gray-200 dark:border-gray-600 rounded-full bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 focus:ring-0 cursor-pointer">
                            <option value="">+ Jämför...</option>
                            ${others.map(r => `<option value="${r.startNumber}" ${String(window.compareRiderId) === String(r.startNumber) ? 'selected' : ''}>#${r.startNumber} ${r.driverName}</option>`).join('')}
                        </select>`;
        })() : ''}

                </div>
                <div class="text-2xl md:text-3xl font-black text-gray-900 dark:text-white mb-0 truncate leading-tight">
                    ${eq.driverName}
                </div>
                <div class="text-xl text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-2">
                    ${getClubLogoHtml(eq)} ${eq.clubName} ${eq.address?.city ? `<span class="text-gray-400 mx-1">•</span> <span class="text-sm font-medium text-gray-500 dark:text-gray-400">${eq.address.city}</span>` : ''} ${getFlagHtml(eq)}
                </div>
                ${eq.groom ? `<div class="text-sm font-bold text-blue-600 dark:text-blue-400 mb-4 bg-blue-50 dark:bg-blue-900/30 w-fit px-2 py-0.5 rounded">Groom: ${eq.groom}</div>` : '<div class="mb-4"></div>'}
                
                <!-- CLICKABLE MAIN NAME -->
                <div onclick="window.showRiderDetails('${eq.startNumber}')" class="flex flex-wrap gap-2 mb-4 items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded p-1 -ml-1 transition-colors group">
                    <div class="inline-block bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-sm font-bold px-3 py-1 rounded-full group-hover:bg-blue-200 dark:group-hover:bg-blue-800">
                        #${eq.startNumber} • ${eq.className}
                    </div>
                     <div class="flex flex-col items-start justify-center gap-1">
                        <div class="flex items-center gap-2">
                             <div class="inline-block bg-purple-100 dark:bg-purple-900 text-purple-900 dark:text-purple-100 text-sm font-bold px-3 py-1 rounded-full border border-purple-200 dark:border-purple-800 group-hover:bg-purple-200 dark:group-hover:bg-purple-800">
                                Total: <span id="speaker-live-rank">${myTotalRank}</span> (<span id="speaker-live-total">${myTotalScore ? myTotalScore.toFixed(2) : '—'}</span>)
                            </div>
                            ${marginHtml ? marginHtml : ''}
                        </div>
                    </div>
                    <div class="ml-2 text-xs text-gray-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        Klicka för detaljer ↗
                    </div>
                </div>

            </div>
            <div class="text-right hidden md:block">
                 <div class="text-5xl font-black text-gray-200 dark:text-gray-600">LIVE</div>
                 ${targetToBeatHtml || renderLeaderToBeat(eq.className)}
            </div>
        </div>
    `;

    // --- Content (Discipline Specific) ---
    let contentHtml = '';

    if (currentDiscipline === 'dressyr') {

        const liveMapForAgg = liveProtocolMap.get(String(eq.startNumber)) || new Map();
        const liveProtocols = Array.from(liveMapForAgg.values());
        const programs = getPrograms();
        const liveRes = calculateDressageResult(eq, liveProtocols, allJudges, programs);

        const avgPercent = (liveRes && liveRes.projectedPercent != null) ? liveRes.projectedPercent : (liveRes ? liveRes.percent : null);
        const avgPenalty = (liveRes && liveRes.projectedPenalty != null) ? liveRes.projectedPenalty : (liveRes ? liveRes.penalty : null);
        const isLiveRide = liveRes && liveRes.isLive;

        // Judge Grid
        const liveMap = liveProtocolMap.get(String(eq.startNumber)) || new Map();
        const liveProtoArray = Array.from(liveMap.values()).map(p => ({
            ...p,
            position: String(p.position || p.judgePosition || '').toUpperCase(),
            movements: normalizeMovements(p.movements || [])
        }));
        // --- Calculate Current Global Moment (Minimum Progress) ---
        // This makes sure we show the moment that *all* active judges have reached (or are about to)
        // Similar to monitor, find the MAX index that MIN judge has reached? 
        // Or actually, monitor shows "Current Moment" as the one being ridden.
        // If judges are at diff speeds, we usually pick the "furthest behind" as the safe bet?
        // Let's use the same logic as monitor: 
        // 1. Filter active judges (last update < 60s ago)
        // 2. Find their lengths. 
        // 3. Use Min length.
        const activeJudges = liveProtoArray.filter(p => {
            const ts = p.updatedAt?.toMillis ? p.updatedAt.toMillis() : (Number(p.updatedAt) || 0);
            const fresh = (Date.now() - ts) < 60000;
            return fresh && p.movements && p.movements.length > 0;
        });

        let currentMomentIdx = -1;
        if (activeJudges.length > 0) {
            const lengths = activeJudges.map(p => p.movements.length);
            const minLen = Math.min(...lengths);
            // Verify if minLen-1 is valid? 
            // If length is 5, it means they have scored indices 0..4. Next is 5.
            // Monitor logic: "current" is usually length-1 (last entered) OR length (next to come).
            // Let's show the LAST ENTERED score by all judges.
            currentMomentIdx = minLen - 1;
        } else if (liveProtoArray.length > 0) {
            // If no one active, maybe show max?
            const lengths = liveProtoArray.map(p => p.movements ? p.movements.length : 0);
            currentMomentIdx = Math.max(...lengths) - 1;
        }

        const judgeGridHtml = renderSpeakerJudgeGrid(liveProtoArray, currentMomentIdx, eq.startNumber);

        // Trend vs Leader
        const leader = getDressageLeaderInClass(eq.className, getSpeakerCalculationContext());
        let trendHtml = '';
        if (leader && avgPercent !== null && isLiveRide) {
            // Compare Percentages (Higher is better)
            const gap = avgPercent - leader.percent;
            const gapColor = gap >= 0 ? 'text-green-600' : 'text-red-600';
            const gapSign = gap >= 0 ? '+' : '';
            const leaderName = (leader.name || '');
            trendHtml = `
            <div class="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded-lg shadow-sm border border-gray-100 dark:border-gray-600 h-full flex flex-col justify-center">
                <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold mb-0">Trend vs Ledare (${leaderName})</div>
                <div class="text-2xl font-black ${gapColor} leading-tight">${gapSign}${gap.toFixed(2)} %</div>
                <div class="text-[10px] text-gray-400 dark:text-gray-500 mt-0">Ledare: ${leader.percent ? leader.percent.toFixed(2) : '-'}%</div>
            </div> `;
        } else if (!leader) {
            trendHtml = `
            <div class="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded-lg shadow-sm border border-gray-100 dark:border-gray-600 h-full flex flex-col justify-center">
                <div class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-bold mb-0">Ingen ledare</div>
                <div class="text-lg font-bold text-gray-300 dark:text-gray-600">Första start</div>
            </div> `;
        }

        contentHtml = `
     <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
                 <div class="md:col-span-12">
                    <div class="text-sm uppercase text-gray-500 dark:text-gray-400 font-bold mb-1">Häst(ar)</div>
                    <div class="text-xl text-gray-900 dark:text-white leading-snug mb-2">${horseText}</div>
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                <div class="text-center p-2 bg-brand-darkblue/5 dark:bg-blue-900/20 rounded-lg border border-brand-darkblue/10 dark:border-blue-800 shadow-sm flex flex-col justify-center h-20">
                    <div class="text-[10px] uppercase tracking-wider text-brand-darkblue dark:text-blue-300 font-extrabold mb-0 leading-none">${isLiveRide ? 'Prognos' : 'Aktuell'} %</div>
                    <div class="text-3xl font-black text-brand-darkblue dark:text-blue-200 tracking-tight leading-none mt-1">${Number.isFinite(avgPercent) ? avgPercent.toFixed(1) + '%' : '—'}</div>
                </div>
                <div class="text-center p-2 bg-brand-darkblue/5 dark:bg-blue-900/20 rounded-lg border border-brand-darkblue/10 dark:border-blue-800 shadow-sm flex flex-col justify-center h-20">
                    <div class="text-[10px] uppercase tracking-wider text-brand-darkblue dark:text-blue-300 font-extrabold mb-0 leading-none">StraffP</div>
                    <div class="text-3xl font-black text-brand-darkblue dark:text-blue-200 tracking-tight leading-none mt-1">${Number.isFinite(avgPenalty) ? avgPenalty.toFixed(2) : '—'}</div>
                </div>
                <!-- Trend Box -->
                <div class="col-span-2 md:col-span-1 h-20">
                     ${trendHtml}
                </div>
            </div>
            
            <!--Judge Grid-->
            <div class="mt-8">
                 <div class="flex items-center gap-2 mb-3">
                    <div class="h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
                    <span class="text-xs uppercase text-gray-400 dark:text-gray-500 font-bold tracking-widest">Domarstatus</span>
                    <div class="h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
                 </div>
                 ${judgeGridHtml}
            </div>
            
             <!--Top 3 List(Dressage)-->
    <div class="mt-6 border-t border-gray-100 dark:border-gray-700 pt-4">
        <div class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Topp 3 i klassen (${eq.className})</div>
        ${renderTop3List(eq.className, 'dressyr')}
    </div>
        </div> `;

    } else if (currentDiscipline === 'maraton') {
        const active = activeEquipages.get(String(eq.startNumber)) || { data: data, task: { name: 'På banan', type: 'stage' }, startTime: 0, pausedMs: 0 };
        const d = active.data || data || {};
        const liveResult = calculateMarathonResult(eq, d, d);
        const totalPenalty = liveResult.totalPenalty;
        const task = active.task || { name: 'På banan' };

        let currentState = task.name;
        let targetHtml = '';

        // --- Comparison View (Compact) ---
        if (window.compareRiderId) {
            const cmpEq = allEquipages.find(e => String(e.startNumber) === String(window.compareRiderId));
            if (cmpEq) {
                const cmpData = maratonStatusMap.get(String(cmpEq.startNumber));
                const cmpRes = cmpData ? calculateMarathonResult(cmpEq, cmpData, cmpData) : null;
                const diff = (liveResult.totalPenalty || 0) - (cmpRes?.totalPenalty || 0);
                const diffColor = (cmpRes && diff < 0) ? 'text-green-600' : ((cmpRes && diff > 0) ? 'text-red-600' : 'text-gray-400');
                const diffSign = (cmpRes && diff > 0) ? '+' : '';
                const diffVal = cmpRes ? Math.abs(diff).toFixed(2) : '—';

                comparisonHtml = `
                <div class="mb-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 p-2 text-[10px] relative">
                    <button onclick="window.setComparisonRider('')" class="absolute top-1 right-2 text-gray-400 hover:text-red-500">×</button>
                    <div class="flex justify-around items-center">
                        <div class="text-center">
                            <span class="text-gray-500 dark:text-gray-400">${eq.driverName}:</span> 
                            <span class="font-bold dark:text-white">${(liveResult.totalPenalty || 0).toFixed(2)}</span>
                        </div>
                        <div class="px-2 py-0.5 rounded ${diffColor} font-black text-xs bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-600">
                            ${diffSign}${diffVal}
                        </div>
                        <div class="text-center opacity-75">
                            <span class="text-gray-500 dark:text-gray-400">${cmpEq.driverName}:</span> 
                            <span class="font-bold dark:text-gray-300">${cmpRes ? (cmpRes.totalPenalty || 0).toFixed(2) : 'Ej startat'}</span>
                        </div>
                    </div>
                </div>`;
            }
        }

        // Live Timer calculation
        if (active && (active.timerBaseMs > 0 || active.fixedElapsedMs != null)) {
            const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();
            const ms = Math.max(0, active.fixedElapsedMs != null ? active.fixedElapsedMs : (active.timerBaseMs ? (tickTimeNow - active.timerBaseMs) - pausedMsSince(active.timerBaseMs, tickTimeNow) : 0));
            elapsedTime = formatMsLive(ms);
        }

        // Target / Splits Logic
        let splitDiffHtml = '';
        if (task.type === 'obstacle' || task.type === 'result_flash') {
            const obsNum = task.type === 'result_flash' ? task.data.number : task.key;
            currentState = task.type === 'result_flash' ? `Resultat Hinder ${obsNum}` : `Hinder ${obsNum}`;
            const stats = calculateClassObstacleStats(eq.className, obsNum, maratonStatusMap, allEquipages);

            const rawSplitsArray = task.type === 'result_flash' ? task.data.gateSplits : d.live_gateSplits;
            const splitsArray = getValidFirstPasses(rawSplitsArray);

            if (splitsArray && splitsArray.length > 0) {
                let myStart = null;
                if (task.type === 'result_flash' && task.data.enteredAt) {
                    myStart = task.data.enteredAt?.toMillis ? task.data.enteredAt.toMillis() : (typeof task.data.enteredAt === 'string' ? new Date(task.data.enteredAt).getTime() : task.data.enteredAt);
                } else {
                    myStart = d.liveObstacleStartAt || d.live_staticStartAt;
                    if (myStart && myStart.toMillis) myStart = myStart.toMillis();
                    else if (typeof myStart === 'string') myStart = new Date(myStart).getTime();

                    if (!myStart && d.obstacleTimes && d.obstacleTimes[obsNum]) {
                        const ot = d.obstacleTimes[obsNum];
                        myStart = ot.enteredAt || ot.enteredAtClient;
                        if (typeof myStart === 'string') myStart = new Date(myStart).getTime();
                    }
                    if (!myStart) myStart = active.startTime; // Legacy fallback
                }

                if (myStart) {
                    const bestSplits = calculateClassSplitStats(eq.className, obsNum, maratonStatusMap, allEquipages);
                    const rows = splitsArray.map(g => {
                        const ts = g.ts?.toMillis ? g.ts.toMillis() : (typeof g.ts === 'string' ? new Date(g.ts).getTime() : g.ts);
                        const myDiff = ts - myStart;
                        const best = bestSplits[g.char]?.best;

                        if (!best) {
                            return `<div class="flex flex-col items-center bg-white dark:bg-gray-800 p-1 rounded border border-gray-100 dark:border-gray-700 shadow-sm min-w-[40px]">
                                <div class="text-[8px] font-bold text-gray-400 uppercase">${g.char}</div>
                                <div class="tabular-nums tracking-wide font-bold text-[10px] text-gray-800 dark:text-gray-200">${(myDiff / 1000).toFixed(1)}s</div>
                            </div>`;
                        }

                        const delta = myDiff - best;
                        const color = delta < 0 ? 'text-green-600' : 'text-red-600';
                        return `<div class="flex flex-col items-center bg-white dark:bg-gray-800 p-1 rounded border border-gray-100 dark:border-gray-700 shadow-sm min-w-[40px]">
                            <div class="text-[8px] font-bold text-gray-400 uppercase">${g.char}</div>
                            <div class="tabular-nums tracking-wide font-bold text-[10px] ${color}">${delta > 0 ? '+' : ''}${(delta / 1000).toFixed(1)}s</div>
                        </div>`;
                    }).filter(Boolean).slice(-5);

                    if (rows.length > 0) {
                        splitDiffHtml = `<div class="flex gap-1 mt-1">${rows.join('')}</div>`;
                        const last = splitsArray[splitsArray.length - 1];
                        if (last) currentState = task.type === 'result_flash' ? `Resultat Hinder ${obsNum}` : `Hinder ${obsNum} (${last.char})`;
                    }
                }
            }

            const bestTimeHtml = (stats && Number.isFinite(stats.bestTime))
                ? `<div class="text-2xl font-black text-green-700 tabular-nums tracking-wide">${stats.bestTime.toFixed(2)}s</div>`
                : `<div class="text-sm font-bold text-gray-400">Inget ref.</div>`;

            targetHtml = `
            <div class="bg-green-50 dark:bg-green-900/20 p-5 rounded-lg border border-green-100 dark:border-green-800 flex flex-col justify-center items-center h-full">
                <div class="text-[10px] uppercase font-bold text-green-800 dark:text-green-300 mb-1">Mål att slå</div>
                ${bestTimeHtml}
                <div class="text-[8px] text-green-500 dark:text-green-400 uppercase font-bold">${stats?.avg ? 'Snitt: ' + (stats.avg / getObstacleCoefficient(eq.className)).toFixed(2) + 's' : 'Första start'}</div>
            </div>`;
        }

        const prog = calculateProjectedPenalty(liveResult, eq.className, null, maratonStatusMap, allEquipages);
        const totalPenaltyDisplay = (totalPenalty === Infinity) ? 'ELIM' : (Number.isFinite(totalPenalty) ? totalPenalty.toFixed(2) : '—');

        const obsArr = liveResult.obstacles.items || [];
        const chips = obsArr.slice(-6).map(o => {
            const p = Number(o.penalty);
            const stats = calculateClassObstacleStats(eq.className, o.number, maratonStatusMap, allEquipages);
            let colorClass = 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
            if (o.eliminated || p === Infinity) colorClass = 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
            else if (Number.isFinite(p) && stats && Number.isFinite(stats.bestTime)) {
                if (p <= stats.bestTime + 0.01) colorClass = 'bg-green-100 text-green-800 font-bold border-green-200 dark:bg-green-900/50 dark:text-green-300 dark:border-green-800';
                else if (stats.avg && p < stats.avg) colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/50 dark:text-yellow-300 dark:border-yellow-800';
            }
            return `<span class="px-1.5 py-0.5 rounded text-[10px] tabular-nums tracking-wide border ${colorClass}">H${o.number}: ${Number.isFinite(p) ? p.toFixed(2) : '-'}</span>`;
        }).join('');

        contentHtml = `
        <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            ${comparisonHtml}
            
            <div class="grid grid-cols-12 gap-4 items-stretch">
                <!-- Main Activity (Left) -->
                <div class="col-span-12 md:col-span-7 bg-amber-50 dark:bg-amber-900/40 p-6 rounded-xl border border-amber-100 dark:border-amber-800 shadow-sm flex flex-col justify-center">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <div class="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-200 opacity-60">Nuvarande Aktivitet</div>
                            <div class="text-xl font-black text-gray-900 dark:text-white leading-tight">${currentState === 'På banan' ? 'Kör sträcka' : currentState}</div>
                        </div>
                        <div class="text-right">
                            <div class="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-200 opacity-60">Live Tid</div>
                            <div class="text-3xl tabular-nums tracking-wide font-black text-amber-600 dark:text-amber-400 tabular-nums leading-none mt-2" id="marathon-live-time">${elapsedTime}</div>
                        </div>
                    </div>
                    ${splitDiffHtml}
                </div>

                <!-- Secondary Stats (Right) -->
                <div class="col-span-12 md:col-span-5 flex flex-col gap-3">
                    ${targetHtml ? `<div class="flex-1">${targetHtml}</div>` : `
                    <div class="bg-gray-50 dark:bg-gray-700 p-5 rounded-xl border border-gray-200 dark:border-gray-600 flex flex-col justify-center items-center flex-1">
                        <div class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">Totalt i Maraton</div>
                        <div class="text-3xl font-black text-gray-900 dark:text-white">${totalPenaltyDisplay}</div>
                    </div>`}

                    <!-- Prognosis Bubble -->
                    ${prog && Number.isFinite(prog.projectedTotal) && prog.basedOnStats ? `
                    <div class="bg-indigo-900 dark:bg-indigo-950 text-white p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div class="text-[10px] leading-tight opacity-75 uppercase font-bold">Prognos<br><span class="text-[8px] font-normal lowercase">Baserat på snitt</span></div>
                        <div class="text-2xl font-black tabular-nums">${prog.projectedTotal.toFixed(2)}</div>
                    </div>` : ''}
                </div>
            </div>

            <!-- Bottom Row: Recent Obstacles & Top 3 -->
            <div class="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4">
                <div class="md:col-span-6">
                    <div class="text-[10px] uppercase text-gray-400 font-bold mb-2 flex justify-between">
                        <span>Senaste Hinder</span>
                        <span class="font-normal opacity-50">${obsArr.length} klara</span>
                    </div>
                    <div class="flex flex-wrap gap-2">${chips || '<span class="text-xs text-gray-300 dark:text-gray-600">Inga hinder klara ännu</span>'}</div>
                </div>

                <div class="md:col-span-6">
                    <div class="text-[10px] uppercase text-gray-400 font-bold mb-2">Topplista (${eq.className})</div>
                    <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 border border-gray-100 dark:border-gray-600">
                        ${renderTop3List(eq.className, 'maraton')}
                    </div>
                </div>
            </div>
        </div>`;

    } else if (currentDiscipline === 'precision') {
        const sn = String(eq.startNumber);
        const d = data || {};

        // Use central calculation logic
        const calcData = getCalculatedRowData(sn, new Map(), allEquipages, precisionStatusMap, precisionConfig, startTimes);

        // Time display
        let timeStr = '—';
        if (d.running && d.liveStartEpoch) {
            const ms = (d.livePausedMs || 0) + (Date.now() - d.liveStartEpoch);
            timeStr = formatMsLive(ms);
        } else if (calcData.timeMs) {
            timeStr = formatMsLive(calcData.timeMs);
        }

        // Compute Top 3 for this class (Precision only)
        const allInClass = allEquipages.filter(e => matchesDisplayClass(e, eq._mergedLabel || eq.mergedTestLabel || eq.className)).map(e => {
            const sn = String(e.startNumber);
            const pSt = precisionStatusMap.get(sn);
            let pen = pSt?.totalPenalty ?? null;

            // Robust elimination check (including previous phases)
            const mSt = maratonStatusMap.get(sn);
            const elimM = mSt && ['utgått', 'utesluten', 'retired', 'eliminated', 'elim', 'ute', 'utg'].some(s => String(mSt.status || '').toLowerCase().includes(s));
            const dSt = dressageStatusMap.get(sn);
            const elimD = dSt?.eliminated || dSt?.excluded;
            const isElimP = !!pSt?.eliminated;

            const isEliminatedOverall = elimD || elimM || isElimP;

            // If live, inject live data
            if (liveInjection && String(liveInjection.sn) === sn && liveInjection.discipline === 'precision') {
                pen = liveInjection.disciplinePenalty;
            } else if (pen === null && pSt) {
                 const pRes = getCalculatedRowData(sn, new Map(), allEquipages, precisionStatusMap, precisionConfig, startTimes);
                 pen = pRes.totalPenalty;
            }
            
            return { sn, name: e.driverName, penalty: pen, timeMs: pSt?.timeMs || 0, eliminated: isEliminatedOverall };
        }).sort((a,b) => {
            const pA = a.eliminated ? Infinity : (a.penalty ?? Infinity);
            const pB = b.eliminated ? Infinity : (b.penalty ?? Infinity);
            if (pA === pB) return (a.timeMs || 0) - (b.timeMs || 0);
            return pA - pB;
        });

        const top3 = allInClass.slice(0, 3);
        const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
        const maxTimeLabel = maxSec ? msToLabel(maxSec * 1000) : '—';

        // Fix ReferenceErrors: Define myRank and gapHtml locally
        const myRankIndex = allInClass.findIndex(r => String(r.sn) === String(eq.startNumber));
        const myRank = myRankIndex !== -1 ? myRankIndex + 1 : '-';

        let gapHtml = '';
        if (myRankIndex > 0) {
            const first = allInClass[0];
            const diff = (allInClass[myRankIndex].penalty || 0) - (first.penalty || 0);
            gapHtml = `<div class="text-[10px] text-blue-600 dark:text-blue-300 font-bold mt-1">Marginal till ledare: +${diff.toFixed(2)}</div>`;
        }


        contentHtml = `
    <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-12 gap-4">
            <div class="col-span-12">
                <div class="text-sm uppercase text-gray-500 dark:text-gray-400 font-bold mb-2">Häst(ar)</div>
                <div class="text-lg text-gray-800 dark:text-white leading-snug mb-4">${horseText}</div>
            </div>

            <!--Stats Column(Narrower)-->
            <div class="col-span-12 md:col-span-5 grid grid-cols-2 gap-2">
                <div class="bg-gray-50 dark:bg-gray-700 p-2 rounded-lg text-center shadow-inner border border-gray-200 dark:border-gray-600 col-span-2 flex justify-between items-center px-4">
                    <div class="text-left">
                        <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold">Maxtid</div>
                        <div class="text-sm tabular-nums tracking-wide text-gray-600 dark:text-gray-300">${maxTimeLabel}</div>
                    </div>
                    <div class="text-right">
                         <div class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold">Tid</div>
                         <div id="precision-live-time" class="text-3xl tabular-nums tracking-wide font-black text-gray-900 dark:text-white tracking-tight leading-none">${timeStr}</div>
                    </div>
                </div>
                
                <div class="bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg text-center shadow-sm border border-blue-100 dark:border-blue-800 col-span-2 relative overflow-hidden">
                    <div class="text-[10px] uppercase tracking-wide text-blue-800 dark:text-blue-300 font-bold">Totalt Straff</div>
                    <div id="precision-live-total" class="text-3xl font-black text-brand-darkblue dark:text-blue-200 leading-none py-1">${calcData.eliminated ? 'ELIM' : (calcData.totalPenalty || 0).toFixed(2)}</div>
                    ${!calcData.eliminated ? `<div class="absolute top-1 right-1 bg-white/80 dark:bg-gray-800/80 backdrop-blur px-2 py-0.5 rounded text-[10px] font-bold text-gray-600 dark:text-gray-300 shadow-sm border border-gray-200 dark:border-gray-700">Rank: ${myRank}</div>` : ''}
                    ${gapHtml}
                </div>

                <div class="bg-white dark:bg-gray-800 p-2 rounded-lg text-center border border-gray-200 dark:border-gray-700 col-span-2">
                    <div class="grid grid-cols-2 gap-2 text-sm border-b dark:border-gray-700 pb-2 mb-2">
                        <div>
                            <span class="block text-red-800 dark:text-red-400 font-bold text-lg leading-none">${(calcData.obstaclePenalty || 0).toFixed(0)}</span>
                            <span class="text-[10px] text-red-600 dark:text-red-300 uppercase">Hinder</span>
                        </div>
                        <div>
                            <span id="precision-live-time-penalty" class="block text-amber-800 dark:text-amber-400 font-bold text-lg leading-none">${(calcData.timePenalty || 0).toFixed(2)}</span>
                            <span class="text-[10px] text-amber-600 dark:text-amber-300 uppercase">Tidsfel</span>
                        </div>
                    </div>
                    <div class="text-left">
                        <div class="text-[10px] uppercase text-gray-400 font-bold mb-1">Rivningar</div>
                        <div class="text-xs font-bold text-red-700 dark:text-red-400 whitespace-normal leading-tight">
                            ${calcData.display.knocksText}
                        </div>
                    </div>
                </div>
            </div>

            <!--Top 3 Column (Wider)-->
            <div class="col-span-12 md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <!-- Precision Top 3 -->
                <div class="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 overflow-hidden text-sm flex flex-col">
                    <div class="bg-indigo-50 dark:bg-indigo-900/40 px-3 py-2 text-[10px] font-bold text-indigo-800 dark:text-indigo-200 uppercase tracking-wide border-b border-indigo-100 dark:border-indigo-800">
                        Topp 3 Precision (${eq.className})
                    </div>
                    <div class="divide-y divide-gray-100 dark:divide-gray-700 flex-1 overflow-y-auto max-h-[180px]">
                        ${top3.length ? top3.map((r, i) => `
                            <div onclick="window.showRiderDetails('${r.sn}')" class="flex justify-between items-center p-2 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors ${String(r.sn) === String(eq.startNumber) ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}">
                                <div class="flex items-center gap-2 overflow-hidden">
                                    <span class="font-bold text-gray-400 w-4 text-center">${i + 1}.</span>
                                    <span class="font-bold text-gray-800 dark:text-gray-200 truncate">${r.name}</span>
                                </div>
                                <span class="font-black text-gray-900 dark:text-white ml-2">${(r.penalty || 0).toFixed(2)}</span>
                            </div>
                        `).join('') : '<div class="p-4 text-center text-gray-400 italic text-sm">Inga resultat</div>'}
                    </div>
                </div>

                <!-- Overall Top 3 -->
                <div class="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 overflow-hidden text-sm flex flex-col">
                    <div class="bg-brand-gold bg-opacity-10 dark:bg-yellow-900/40 px-3 py-2 text-[10px] font-bold text-yellow-900 dark:text-yellow-200 uppercase tracking-wide border-b border-brand-gold border-opacity-20 dark:border-yellow-800">
                        Topp 3 Totalt (${eq.className})
                    </div>
                    <div class="divide-y divide-gray-100 dark:divide-gray-700 flex-1 overflow-y-auto max-h-[180px]">
                        ${totalRanking.slice(0, 3).map((r, i) => `
                            <div onclick="window.showRiderDetails('${r.sn}')" class="flex justify-between items-center p-2 cursor-pointer hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-colors ${String(r.sn) === String(eq.startNumber) ? 'bg-yellow-50/50 dark:bg-yellow-900/10' : ''}">
                                <div class="flex items-center gap-2 overflow-hidden">
                                    <span class="font-bold text-yellow-600 w-4 text-center">${i + 1}.</span>
                                    <span class="font-bold text-gray-800 dark:text-gray-200 truncate">${allEquipages.find(e => String(e.startNumber) === String(r.sn))?.driverName}</span>
                                </div>
                                <span class="font-black text-gray-900 dark:text-white ml-2">${r.total.toFixed(2)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div> `;
    } else if (currentDiscipline === 'totalt') {
        const sn = String(eq.startNumber);
        
        // Fetch all individual phase scores (robustly)
        const dSt = dressageStatusMap.get(sn);
        let dPen = dSt?.finalPenalty ?? null;

        const mSt = maratonStatusMap.get(sn);
        let mPen = mSt?.totalPenalty ?? null;
        if (mPen === null && mSt) {
            const mRes = calculateMarathonResult(eq, mSt, mSt);
            mPen = mRes.totalPenalty;
        }
        const pSt = precisionStatusMap.get(sn);
        let pPen = pSt?.totalPenalty ?? null;
        if (liveInjection && liveInjection.discipline === 'precision' && liveInjection.disciplinePenalty != null) {
            pPen = liveInjection.disciplinePenalty;
        } else if (pPen === null && pSt) {
            const pRes = getCalculatedRowData(sn, new Map(), allEquipages, precisionStatusMap, precisionConfig, startTimes);
            pPen = pRes.totalPenalty;
        }

        if (liveInjection && liveInjection.discipline === 'maraton' && liveInjection.disciplinePenalty != null) {
            mPen = liveInjection.disciplinePenalty;
        }

        contentHtml = `
        <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Dressage Score -->
                <div class="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-center">
                    <div class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">Dressyr</div>
                    <div class="text-3xl font-black text-gray-900 dark:text-white">${dPen !== null ? dPen.toFixed(2) : '—'}</div>
                    <div class="text-[10px] text-gray-400">${dSt?.finalPercent ? dSt.finalPercent.toFixed(1) + '%' : ''}</div>
                </div>
                
                <!-- Marathon Score -->
                <div class="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-center">
                    <div class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">Maraton</div>
                    <div class="text-3xl font-black text-gray-900 dark:text-white">${mPen !== null ? mPen.toFixed(2) : '—'}</div>
                </div>
                
                <!-- Precision Score -->
                <div class="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-center">
                    <div class="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">Precision</div>
                    <div class="text-3xl font-black text-gray-900 dark:text-white">${pPen !== null ? pPen.toFixed(2) : '—'}</div>
                </div>
            </div>

            <!-- Grand Total -->
            <div class="mt-6 bg-brand-darkblue dark:bg-blue-900 text-white p-6 rounded-2xl shadow-xl flex flex-col items-center relative overflow-hidden">
                <div class="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-400/10 to-transparent pointer-events-none"></div>
                <div class="text-xs uppercase font-black tracking-widest text-blue-200 mb-2">Total Ställning</div>
                <div class="text-6xl font-black tracking-tighter">${myTotalScore === Infinity ? 'UT' : (myTotalScore !== null ? myTotalScore.toFixed(2) : '—')}</div>
                <div class="mt-4 flex items-center gap-4">
                    <div class="bg-white/10 px-4 py-1 rounded-full border border-white/20">
                        <span class="text-xs font-bold text-blue-100 uppercase mr-2">Placering:</span>
                        <span class="text-2xl font-black text-white">${myTotalRank} / ${totalRanking.length}</span>
                    </div>
                </div>
                ${marginHtml ? `<div class="mt-4 w-full">${marginHtml}</div>` : ''}
            </div>

            <!-- Class Quick List -->
            <div class="mt-6">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 flex justify-between">
                    <span>Topplista (${eq.className})</span>
                </div>
                <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 border border-gray-100 dark:border-gray-600 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                    ${renderTop3List(eq.className, 'totalt') || renderTop3List(eq.className, 'precision')}
                </div>
            </div>
        </div>`;
    }

    // --- FINAL STABLE RENDER ---
    const sel = el.querySelector('#compare-select');
    const isCompareActive = document.activeElement && document.activeElement.id === 'compare-select';
    const hasOptions = sel && sel.options.length > 1;

    // If user is interacting with comparison AND it already has options, preserve state
    if (isCompareActive && sel && hasOptions) {
        // Targeted updates to preserve select state
        const timeEl = document.getElementById('marathon-live-time');
        if (timeEl && elapsedTime !== '—') timeEl.textContent = elapsedTime;

        // Update comparison box if present
        const compContainer = el.querySelector('.comparison-container');
        if (compContainer) compContainer.innerHTML = comparisonHtml;

        // Don't replace full innerHTML to avoid closing the select
        return;
    }

    el.innerHTML = `<div class="p-4 md:p-6">
        ${headerHtml}
        <div class="comparison-container">${comparisonHtml}</div>
        ${contentHtml}
    </div>`;
}

function renderLeaderToBeat(className) {
    return renderListLeaderToBeat(className, getSpeakerViewContext());
}

function getChasingTarget(className, currentPenalty) {
    return renderListChasingTarget(className, currentPenalty, getSpeakerViewContext());
}

function renderUpcomingList() {
    renderListUpcomingList(getSpeakerViewContext());
}

function getStartTimeForSort(sn) {
    return renderListStartTimeForSort(sn, getSpeakerViewContext());
}

function getStartTimeForDisplay(sn) {
    return renderListStartTimeForDisplay(sn, getSpeakerViewContext());
}

function renderRecentResultsList() {
    renderListRecentResultsList(getSpeakerViewContext());
}

// ================= Logic =================

function findCurrentRider() {
    if (manualFocusId) {
        const id = String(manualFocusId);
        const eq = allEquipages.find(e => String(e.startNumber) === id);
        if (eq) {
            if (currentDiscipline === 'dressyr') {
                const data = dressageStatusMap.get(id);
                currentRider = { eq, statusData: data, liveData: liveProtocolMap.get(id) };
                return;
            } else if (currentDiscipline === 'maraton') {
                const data = maratonStatusMap.get(id);
                const found = activeEquipages.get(id);
                if (found) currentRider = found;
                else currentRider = { eq, data, taskName: 'Vald (Ej aktiv?)' };
                return;
            } else if (currentDiscipline === 'precision') {
                const data = precisionStatusMap.get(id);
                currentRider = { eq, data };
                return;
            } else {
                // Totalt or fallback
                const pData = precisionStatusMap.get(id);
                const mData = maratonStatusMap.get(id);
                const dData = dressageStatusMap.get(id);
                currentRider = { eq, statusData: dData, data: pData || mData };
                return;
            }
        }
    }

    if (currentDiscipline === 'dressyr') findCurrentDressageRider();
    else if (currentDiscipline === 'maraton') findCurrentMarathonRider();
    else if (currentDiscipline === 'precision') findCurrentPrecisionRider();
    else if (currentDiscipline === 'totalt') {
        // Priority for 'totalt' view auto-focus: Precision > Marathon > Dressage
        findCurrentPrecisionRider();
        if (!currentRider) findCurrentMarathonRider();
        if (!currentRider) findCurrentDressageRider();
    }
}

function findCurrentDressageRider() {
    let latest = null;
    let latestTs = 0;
    for (const [sn, data] of dressageStatusMap.entries()) {
        const state = String(data?.state || '').toLowerCase();
        if (state === 'ongoing' || state === 'active') {
            const ts = new Date(data.updatedAt || 0).getTime();
            if (Number.isFinite(ts) && ts > latestTs) {
                latestTs = ts;
                const eq = allEquipages.find(e => String(e.startNumber) === sn);
                if (eq) latest = { eq, statusData: data, liveData: liveProtocolMap.get(sn) };
            }
        }
    }
    currentRider = latest;
}


function findCurrentMarathonRider() {
    const actives = Array.from(activeEquipages.values()).sort((a, b) => {
        const priority = { obstacle: 0, result_flash: 1, stage: 2, transport: 3 };
        const pa = priority[a.task?.type] ?? 9;
        const pb = priority[b.task?.type] ?? 9;
        if (pa !== pb) return pa - pb;
        return (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
    });
    currentRider = actives.length > 0 ? actives[0] : null;
}

function maybePushRecentMarathon(sn, data) {
    const finishedB = stageStopTS(data, 'B');
    const hasScore = (data.totalPenalty !== undefined && data.totalPenalty !== null);

    // Only show if they have actually done something (score or finish)
    if (!finishedB && !hasScore) return;

    const eq = allEquipages.find(e => String(e.startNumber) === sn);
    if (!eq) return;

    const existing = recentResults.find(r => String(r.sn) === String(sn));
    const result = getSpeakerDisciplineResult(eq, 'maraton');
    const penalty = result.penalty ?? data.totalPenalty ?? 0;

    // Determine timestamp to sort by (Finish time OR Last Update)
    const sortTime = finishedB || data.updatedAt || Date.now();

    const entry = {
        sn: String(sn),
        name: eq.driverName,
        clubName: eq.clubName,
        finalPenalty: penalty,
        finalPercent: null,
        updatedAt: sortTime,
        status: finishedB ? 'finished' : 'running' // Track status
    };

    if (existing) {
        Object.assign(existing, entry);
    } else {
        recentResults.unshift(entry);
    }
}

// Check if a driver is active and update the Active Map
// Ported from maraton-monitor.js
function evaluateActiveState(sn, data) {
    if (!data) { activeEquipages.delete(String(sn)); return; }
    const eq = allEquipages.find(e => String(e.startNumber) === sn);
    if (!eq) { activeEquipages.delete(String(sn)); return; }

    let isActive = false;
    let task = { type: 'unknown', name: '', key: '' };
    let startTime = 0;
    let pausedMs = 0;

    let fixedElapsedMs = null;
    let timerBaseMs = 0;

    // 1. Check Obstacle Activity
    if (data.currentObstacle && (data.liveObstacleStartAt || (data.liveObstacleTimeMs && data.liveObstacleTimeMs > 0))) {
        isActive = true;
        task = { type: 'obstacle', name: `Hinder ${data.currentObstacle}`, key: data.currentObstacle };

        if (data.running === true) {
            const lastUpdateMs = Number(data.liveObstacleTimeMs) || 0;
            const lastUpdateTime = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now();
            // Real-time calculation basis
            timerBaseMs = lastUpdateTime - lastUpdateMs;
        } else {
            // Clock is stopped by user
            fixedElapsedMs = Number(data.liveObstacleTimeMs) || 0;
        }
    } else {
        // 2. Result Flash
        let flashFound = false;
        if (data.obstacles && data.obstacles.length > 0) {
            let latestExit = 0;
            let latestObs = null;
            const obstacleTimes = data.obstacleTimes || {};
            data.obstacles.forEach(o => {
                const numStr = String(o.number || o.obstacleNumber || o.id);
                const t = obstacleTimes[numStr];
                let exit = t?.exitAt || t?.exitAtClient || o.exitAt || o.exitAtClient;
                if (exit) {
                    if (exit.toMillis) exit = exit.toMillis();
                    else if (typeof exit === 'string') exit = new Date(exit).getTime();
                    else if (typeof exit === 'number') { }
                    else exit = 0;
                }
                if (exit > latestExit) { latestExit = exit; latestObs = o; }
            });
            if (latestObs && latestExit > 0 && (Date.now() - latestExit < 20000)) {
                isActive = true; flashFound = true;
                task = { type: 'result_flash', name: `Resultat Hinder ${latestObs.number}`, key: 'flash', data: latestObs };
                fixedElapsedMs = latestObs.timeMs || (latestObs.timeInSeconds * 1000) || 0;
                startTime = latestExit;
            }
        }

        // 3. Stages Check (A, B, Transport)
        if (!flashFound) {
            const limitsA = limitsFor(eq, 'A');
            const isFixedTimeA = limitsA && limitsA.ideal > 0 && limitsA.max === limitsA.ideal && limitsA.min === 0;
            const stages = [{ key: 'A', name: isFixedTimeA ? 'Warm-up' : 'Etapp A' }, { key: 'B', name: 'Etapp B' }, { key: 'transport', name: 'Transport' }];
            for (const stage of stages) {
                const start = stageStartTS(data, stage.key);
                const stop = stageStopTS(data, stage.key);
                if (start && !stop) {
                    isActive = true;
                    task = { type: 'stage', name: stage.name, key: stage.key };
                    timerBaseMs = start;
                    pausedMs = stageDurationMsSaved(data, stage.key) || 0;
                    startTime = start; // Legacy compat
                    break;
                }
            }
        }
    }

    // 4. Fallback (Waiting)
    if (!isActive) {
        const stateStr = String(data.state || eq.status || '').toLowerCase();
        const isGone = ['utgått', 'utesluten', 'retired', 'eliminated'].some(s => stateStr.includes(s));
        if (!isGone) {
            const hasStartA = stageStartTS(data, 'A');
            const hasStopA = stageStopTS(data, 'A');
            const hasStartB = stageStartTS(data, 'B');
            if (hasStopA && !hasStartB) {
                isActive = true;
                task = { type: 'transport', name: 'Transport / Paus', key: 'wait_b' };
                timerBaseMs = hasStopA;
                startTime = hasStopA; // Legacy compat
            }
        }
    }

    if (isActive) {
        activeEquipages.set(String(sn), { sn, eq, data, task, startTime, pausedMs, timerBaseMs, fixedElapsedMs, updatedAt: Date.now() });
    } else {
        activeEquipages.delete(String(sn));
    }
}


function ensureSpeakerTicker() {
    ensureMainTicker();
}

function findCurrentPrecisionRider() {
    let active = null;
    let maxTs = 0;

    for (const [sn, data] of precisionStatusMap.entries()) {
        if (data.inProgress === true) {
            const ts = data.updatedAt || 0;
            if (ts > maxTs) {
                maxTs = ts;
                const eq = allEquipages.find(e => String(e.startNumber) === sn);
                if (eq) active = { eq, data };
            }
        }
    }
    currentRider = active;
}

function maybePushRecentPrecision(sn, data) {
    if (data.inProgress === true) return;
    if (!data.finalized && data.status !== 'Klar') {
        if (data.totalPenalty == null) return;
    }

    const eq = allEquipages.find(e => String(e.startNumber) === sn);
    if (!eq) return;

    // Use central calculation logic to ensure penalties are accurate (not trusting stale Firestore fields)
    const calc = getCalculatedRowData(sn, new Map(), allEquipages, precisionStatusMap, precisionConfig, startTimes);
    
    const entry = {
        sn: String(sn),
        name: eq.driverName,
        clubName: eq.clubName,
        finalPenalty: calc.totalPenalty,
        finalPercent: null,
        updatedAt: data.updatedAt || Date.now()
    };

    const idx = recentResults.findIndex(r => String(r.sn) === String(sn));
    if (idx >= 0) {
        recentResults[idx] = entry;
    } else {
        recentResults.unshift(entry);
    }
}

// Wrapper to prevent crash and logging
function maybePushRecent(sn) {
    try {
        return maybePushRecentInternal(sn);
    } catch (e) {
        console.error('Error in maybePushRecent for', sn, e);
        return false;
    }
}

function maybePushRecentInternal(sn) {
    const S = String(sn);
    const st = dressageStatusMap.get(S) || {};
    const eq = allEquipages.find(e => String(e.startNumber) === S) || null;
    if (!eq) return false;

    const stateStr = String(st.state || eq.status || '').toLowerCase();
    if (isWithdrawnOrExcluded(stateStr, { ...eq, ...st })) {
        const idx = recentResults.findIndex(r => String(r.sn) === S);
        if (idx >= 0) { recentResults.splice(idx, 1); return true; }
        return false;
    }

    // 1. Collect all protocols (Saved + Live)
    let protocolsArr = [];
    const saved = savedProtocolsMap.get(S);
    if (saved) protocolsArr = Array.isArray(saved) ? [...saved] : [saved];

    const liveMap = liveProtocolMap.get(S);
    if (liveMap) {
        liveMap.forEach(liveProto => {
            const jid = liveProto.judgeId || liveProto.id;
            const pos = (liveProto.position || liveProto.judgePosition || '').toUpperCase();

            // Normalize live protocol structure
            const normalizedLive = {
                ...liveProto,
                judgeId: jid || pos,
                position: pos,
                movements: Array.isArray(liveProto.movements) ? normalizeMovements(liveProto.movements) : []
            };

            const idx = protocolsArr.findIndex(p =>
                (p.judgeId && String(p.judgeId) === String(jid)) ||
                (p.position && String(p.position).toUpperCase() === pos)
            );

            if (idx >= 0) protocolsArr[idx] = normalizedLive;
            else protocolsArr.push(normalizedLive);
        });
    }

    // Determine Relevant Judges FIRST
    let relevantJudges = allJudges;
    if (eq && eq.className) {
        const clsNorm = String(eq.className).trim().toLowerCase();
        relevantJudges = allJudges.filter(j => {
            if (!j.classes || !Array.isArray(j.classes) || j.classes.length === 0) return true;

            // Aggressive normalization: remove all non-alphanumeric chars (except maybe basic ones) and lowercase
            // This handles "Lätt A" vs "Lätt A " vs "Lätt A  Enbet"
            const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
            const target = normalize(eq.className);

            return j.classes.some(c => normalize(c) === target);
        });

    }

    const merged = deduplicateAndFilterProtocols(protocolsArr, relevantJudges);

    // Auto-detect finished status based on judge count
    let finished = stateStr === 'finished'; // Note: using let
    if (!finished && relevantJudges && relevantJudges.length > 0) {

        const uniquePos = new Set(merged.map(p => (p.position || p.judgePosition || '').toUpperCase()).filter(x => x));
        const expectedPos = new Set(relevantJudges.map(j => (j.position || '').toUpperCase()));

        // Only mark finished if we actually expect judges
        if (expectedPos.size > 0 && uniquePos.size >= expectedPos.size && uniquePos.size > 0) {
            finished = true;
        }
    }

    // Attempt Calculation if we have data
    let result = null;
    if (merged.length > 0) {
        const programs = getPrograms();
        result = calculateDressageResult(eq, merged, relevantJudges, programs);
    }

    let hasMeaningfulData = false;
    let finalPen = st.finalPenalty;
    let finalPct = st.finalPercent;

    if (result && result.penalty != null) {
        finalPen = result.penalty;
        finalPct = result.percent;

        const newSt = { ...st };
        newSt.finalPercent = finalPct;
        newSt.finalPoints = result.points;
        newSt.finalPenalty = finalPen;
        newSt.finalJudgeScore = { percent: finalPct, points: result.points, penalty: result.penalty };
        newSt.errorPoints = result.errorPoints;
        newSt.errorPenalty = result.penalty;
        dressageStatusMap.set(S, newSt);
    }

    if (finished) {
        hasMeaningfulData = (finalPen != null || finalPct != null);
    } else {
        hasMeaningfulData = (finalPen != null && finalPen > 0);
    }

    // EXTENDED DEBUG


    if (!hasMeaningfulData) {
        const idx = recentResults.findIndex(r => String(r.sn) === S);
        if (idx >= 0) {

            recentResults.splice(idx, 1);
            return true;
        }
        return false;
    }

    const entry = {
        sn: S,
        name: eq.driverName || `#${S}`,
        clubName: eq.clubName || '',
        finalPercent: finalPct,
        finalPenalty: finalPen,
        updatedAt: st.updatedAt || Date.now()
    };

    const idx = recentResults.findIndex(r => String(r.sn) === S);
    if (idx >= 0) {
        if (JSON.stringify(recentResults[idx]) !== JSON.stringify(entry)) {
            recentResults[idx] = entry;
            return true;
        }
    } else {
        recentResults.unshift(entry);
        return true;
    }
    return false;
}

function setupAllListeners() {
    setupSpeakerStateListeners(getSpeakerStateContext());
}

export async function load() {
    const comp = getGlobalState('currentCompetition');
    competitionId = comp?.id;

    if (!competitionId) {
        const root = document.getElementById('page-speaker');
        if (root) root.innerHTML = '<p class="p-8 text-center dark:text-gray-400">Ingen tävling vald.</p>';
        return;
    }

    // Safety: Clear any existing intervals (if unload didn't catch them or dirty reload)
    stopTimerLiveClock();

    renderLayout();
    updateDisciplineUI();

    let equipagesRaw; // Define outside try/catch for use in verify
    try {
        let startTimesData, precisionConfigRaw, programsRaw, mappingCfg, judgesRaw, maratonConfigRaw;
        [equipagesRaw, startTimesData, precisionConfigRaw, programsRaw, mappingCfg, judgesRaw, maratonConfigRaw] = await Promise.all([
            getEquipages(competitionId),
            getConfig(competitionId, 'startTimes').catch(() => ({})),
            getConfig(competitionId, 'precisionConfig').catch(() => ({})),
            getConfig(competitionId, 'dressagePrograms').catch(() => ({})),
            getConfig(competitionId, 'dressyrProgramMapping').catch(() => ({})),
            getJudges(competitionId).catch(() => []),
            getConfig(competitionId, 'maratonConfig').catch(() => null)
        ]);

        if (maratonConfigRaw) {
            setMarathonConfig(maratonConfigRaw);
        }

        allJudges = (judgesRaw || []).map(j => ({
            ...j,
            id: j.id,
            name: j.name || j.fullName || j.id,
            position: (expandDressagePosition(j) || j.position || '').toUpperCase()
        }));

        precisionConfig = precisionConfigRaw || {};
        const base = (typeof globalDressagePrograms !== 'undefined' ? globalDressagePrograms : {});
        mergedPrograms = { ...base, ...(window.dressagePrograms || {}), ...(programsRaw || {}) };

        // Expose for helpers if needed
        window.klassProgramMapping = mappingCfg || {};
        window.dressagePrograms = mergedPrograms;

        allEquipages = (equipagesRaw || [])
            .filter(e => e && e.startNumber != null)
            .map(e => ({
                ...e,
                startNumber: Number(e.startNumber)
            }));



        startTimes = (startTimesData?.times) || (startTimesData?.value?.times) || {};

        setupAllListeners();

        triggerRender(true);

        // Start unified live ticker
        ensureMainTicker();

    } catch (err) {
        console.error('Kunde inte ladda speaker-sidan:', err);
        const root = document.getElementById('page-speaker');
        if (root) root.innerHTML = '<p class="p-8 text-center text-red-500">Fel vid laddning av data.</p>';
    }
}

function renderActiveListNew() {
    renderListActiveListNew(getSpeakerViewContext());
}

/**
 * renderSectorAnalysis()
 * - Shows a table of all drivers currently or recently in road sections (A/Transport).
 * - Displays deviations from ideal time.
 */
function renderSectorAnalysis() {
    const el = document.getElementById('sector-analysis-content');
    const container = document.getElementById('marathon-sector-analysis');
    if (!el || !container) return;

    const result = renderMarathonSectorAnalysis(getSpeakerViewContext());
    if (result.isHidden) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    el.innerHTML = result.html;
}

export function __unload() {
    stopTimerLiveClock();

    if (liveClockInterval) clearInterval(liveClockInterval);
    liveClockInterval = null;

    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = null;

    unsubscribes.forEach(u => u());
    unsubscribes = [];
    currentRider = null;
    dressageStatusMap.clear();
    liveProtocolMap.clear();
    maratonStatusMap.clear();
    // maratonLiveMap.clear(); // Removed: not used
    precisionStatusMap.clear();
    recentResults.length = 0;
}


export default { load };
