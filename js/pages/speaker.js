// js/pages/speaker.js
// En specialanpassad vy för speaker med fokus på talarstöd (noteringar, kommande, resultat).

import { getGlobalState } from '../main.js';
import { openDetails as showDressageDetailsModal } from '../ui/dressageModal.js';
import { showDetailsModal as showPrecisionDetailsModal } from '../ui/precisionModal.js';
import {
    getEquipages,
    getConfig,
    listenForJudges,
    listenForDressageProtocolsCollectionGroup,
    listenForDressageLiveGroup,
    listenForDressageStatusCollection,
    getDressageResultsForEquipage,
    updateEquipage,
    listenForConfig
} from '../services/firestoreService.js';
import {
    getDressagePenaltyCoeff,
    computeFinalFromSaved,
    normalizeMovements,
    deduplicateAndFilterProtocols,
    guessProgramKeyFromClass,
    calculateAggregateDressagePenalty,
    normJudgeId,
    calcLiveJudgeProjection
} from '../utils/dressageUtils.js';

import { getCompetitionHeader } from '../ui/components.js';
import { onSnapshot, doc, collection } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, appId } from '../config/firebase-config.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../services/logosService.js';
import { getFlagHtml } from '../services/flagsService.js';
import { msToLabel, computeTotalPenalty } from '../utils/sharedUtils.js';
import { dressagePrograms as globalDressagePrograms } from '../data/dressagePrograms.js';

import {
    getObstacleArray,
    obstacleValues,
    stagePenaltyFromMs,
    stageDurationMsSaved,
    pausedMsBetween,
    stageStartTS,
    stageStopTS,
    toTimeLabel,
    formatMsLive,
    pausedMsSince,
    setMarathonConfig,
    limitsFor,
    calculateMarathonResult,
    getObstacleCoefficient,
    calculateClassObstacleStats,
    calculateProjectedPenalty,
    calculateClassSplitStats,
    analyzeSectorProgress,
    maraton_marathonConfig
} from '../utils/marathonUtils.js';

import { showDetailsModal as showMarathonDetailsModal } from '../ui/marathonModal.js';

import {
    computeMaxSecondsForClass,
    calculatePrecisionTimePenalty,
    getPrecisionRanking
} from '../utils/precisionUtils.js';

import { startMarathonSimulation } from '../utils/simulator.js';

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
let maratonTickerInterval = null;

// Data-cachar (Precision)
const precisionStatusMap = new Map();
let precisionConfig = {};

// Render-variabler
let currentRider = null;
let recentResults = [];
let manualFocusId = null; // För att manuellt välja vem man tittar på i maraton/active-list
let obstacleFocusVal = null; // New: Selected obstacle number for "Obstacle Focus View"
let sidebarClassFocus = null; // New: Manually selected class for the sidebar leaderboard

let unsubscribes = [];

// ================= Helpers =================

const formatTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
};

function isWithdrawnOrExcluded(state, eqLikeObj) {
    const toStr = v => String(v || '').toLowerCase();
    const badStates = new Set(['withdrawn', 'scratched', 'did-not-start', 'dns', 'retired', 'eliminated', 'excluded', 'ute', 'struken', 'struken?']);
    if (badStates.has(toStr(state))) return true;
    const flags = [eqLikeObj?.withdrawn, eqLikeObj?.scratched, eqLikeObj?.struken, eqLikeObj?.didNotStart, eqLikeObj?.dns, eqLikeObj?.eliminated, eqLikeObj?.excluded, eqLikeObj?.retired];
    if (flags.some(v => v === true)) return true;
    const textCandidates = [eqLikeObj?.status, eqLikeObj?.eqStatus, eqLikeObj?.dressageStatus, eqLikeObj?.result, eqLikeObj?.outcome, eqLikeObj?.statusText, eqLikeObj?.reason].map(toStr);
    return textCandidates.some(s => s && (s.includes('withdrawn') || s.includes('scratched') || s.includes('did-not-start') || s === 'dns' || s.includes('eliminated') || s.includes('excluded') || s.includes('struken') || s.includes(' ute')));
}

function expandDressagePosition(j) {
    if (Array.isArray(j?.roles)) {
        const withPos = j.roles.find(r => r && r.discipline === 'dressage' && r.position);
        if (withPos) return String(withPos.position).toUpperCase();
    }
    if (j?.position) return String(j.position).toUpperCase();
    return '';
}

let renderTimeout = null;
function triggerRender() {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        findCurrentRider();
        renderSpeakerDashboard();
    }, 100);
}



function getLeaderToBeat(className, discipline) {
    if (!className) return null;
    let best = null;

    const isBetter = (currentBest, candidateScore, disc) => {
        if (currentBest === null) return true;
        if (disc === 'dressyr') return candidateScore > currentBest;
        // Lägre straff = bättre i maraton/precision
        return candidateScore < currentBest;
    };


    allEquipages.forEach(eq => {
        if (eq.className !== className) return;
        const sn = String(eq.startNumber);

        let score = null;
        if (discipline === 'dressyr') {
            const st = dressageStatusMap.get(sn);
            if (st && st.finalPercent != null) score = st.finalPercent;
        } else if (discipline === 'maraton') {
            const st = maratonStatusMap.get(sn);
            if (st && st.totalPenalty != null) score = st.totalPenalty;
        } else if (discipline === 'precision') {
            const st = precisionStatusMap.get(sn);
            if (st && st.totalPenalty != null) score = st.totalPenalty;
        }

        if (score !== null) {
            if (isBetter(best ? best.score : null, score, discipline)) {
                let time = '';
                if (discipline === 'precision') time = precisionStatusMap.get(sn)?.time || '';
                best = { score, name: eq.driverName, sn: eq.startNumber, time };
            }
        }
    });
    return best;
}

// ================= Live Clock =================
let liveClockInterval = null;
function startLiveClock() {
    if (liveClockInterval) clearInterval(liveClockInterval);
    liveClockInterval = setInterval(() => {
        updateLiveClocks();
    }, 100);
}

function updateLiveClocks() {
    if (!currentRider) return;

    // Precision Live Time
    const pTimeEl = document.getElementById('precision-live-time');
    const pPenEl = document.getElementById('precision-live-time-penalty');
    const pTotEl = document.getElementById('precision-live-total');

    if (pTimeEl && currentDiscipline === 'precision') {
        const d = currentRider.data || currentRider.statusData || {};
        const eq = currentRider.eq;

        if (d.running && d.liveStartEpoch) {
            const ms = (d.livePausedMs || 0) + (Date.now() - d.liveStartEpoch);
            pTimeEl.textContent = formatMsLive(ms);

            // Live Penalty Ticker
            if (pPenEl && pTotEl) {
                const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
                const liveTimePen = calculatePrecisionTimePenalty(ms, maxSec);

                // Update Time Penalty Display
                pPenEl.textContent = liveTimePen > 0 ? liveTimePen.toFixed(2) : (d.timePenalty || 0).toFixed(2);

                // Update Total Penalty Display (Obstacle + Time + Extra)
                const obsPen = d.liveObstaclePenalty || d.obstaclePenalty || 0;
                const extraPen = d.extraPenalty || 0;
                const total = obsPen + liveTimePen + extraPen;

                if (!d.eliminated) {
                    pTotEl.textContent = total.toFixed(2);
                }
            }
        }
    }

    // Marathon Live Time
    const mTimeEl = document.getElementById('marathon-live-time');

    // Debug helper (logs once every 5 seconds)
    const now = Date.now();
    if (!window.lastTickDebug || now - window.lastTickDebug > 5000) {
        console.log('[Tick] running...', {
            discipline: currentDiscipline,
            hasRider: !!currentRider,
            mTimeEl: !!mTimeEl,
            sectorTimers: document.querySelectorAll('.sector-live-timer').length
        });
        window.lastTickDebug = now;
    }

    if (currentDiscipline === 'maraton') {
        const d = currentRider ? (currentRider.data || currentRider.statusData || {}) : {};
        const active = currentRider ? activeEquipages.get(String(currentRider.eq.startNumber)) : null;

        // 1. Rider Card Timer
        if (mTimeEl) {
            let handled = false;

            // Priority: Active Equipage (Source of Truth)
            if (active && active.startTime > 1600000000000) {
                const ms = Math.max(0, (Date.now() - active.startTime) - active.pausedMs);
                mTimeEl.textContent = formatMsLive(ms);
                handled = true;
            }

            // Fallback: Legacy Logic (if not found in active list but looks running)
            if (!handled && d.running) {
                // ... (Existing fallback logic or simplified) ...
                if (d.liveObstacleStartAt) {
                    const start = d.liveObstacleStartAt.toMillis ? d.liveObstacleStartAt.toMillis() : d.liveObstacleStartAt;
                    if (start > 0) {
                        mTimeEl.textContent = formatMsLive(Date.now() - start);
                        handled = true;
                    }
                }
                if (!handled && d.currentStage) {
                    const rawStage = d.currentStage;
                    let s = String(rawStage || '').trim();
                    s = s.replace(/^etapp\s+/i, '').trim();
                    if (/^transport/i.test(s)) s = 'transport';
                    if (s.length > 1 && /[ABT]$/i.test(s)) s = s.slice(-1);
                    if (s.toUpperCase() === 'T') s = 'transport';

                    const start = stageStartTS(d, s);
                    if (start > 0) {
                        mTimeEl.textContent = formatMsLive(Date.now() - start - pausedMsSince(start));
                        handled = true;
                    }
                }
            }
        }

        // 2. Sector Analysis Timers
        const sectorTimers = document.querySelectorAll('.sector-live-timer');
        sectorTimers.forEach(el => {
            const sn = el.dataset.sn;
            const startStr = el.dataset.start;
            const idealStr = el.dataset.ideal;
            const targetStage = el.dataset.stage;

            if (!idealStr) return;

            const ideal = Number(idealStr);
            let sec = 0;
            let handled = false;

            // Check ActiveEquipages first (Strict Stage Match)
            const act = sn ? activeEquipages.get(String(sn)) : null;
            if (act && act.startTime > 1600000000000) {
                // Robust Match: If active task started at approximately the same time as the sector timer (data-start),
                // then we can trust the active record's pausedMs and startTime.
                // This avoids issues with key naming ('wait_b' vs 'transport' vs 'A') or case sensitivity.
                if (startStr && Math.abs(act.startTime - Number(startStr)) < 2000) {
                    const ms = Math.max(0, (Date.now() - act.startTime) - act.pausedMs);
                    sec = ms / 1000;
                    handled = true;
                } else {
                    // If start times don't match, the driver is likely in an obstacle (new start time).
                    // We must fall back to the stage timer using the stored stage start time.
                }
            }

            if (!handled && startStr && !isNaN(Number(startStr))) {
                // Fallback to data-start (calculated via stageStartTS)
                const start = Number(startStr);
                const ms = Date.now() - start - pausedMsSince(start);
                sec = ms / 1000;
            }

            const diff = sec - ideal;

            // Update Text
            const diffSign = diff > 0 ? '+' : '';
            const absDiff = Math.abs(diff);
            const m = Math.floor(absDiff / 60);
            const s = Math.floor(absDiff % 60);
            const renderTime = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

            el.textContent = `${diffSign}${renderTime}`;
            el.textContent = `${diffSign}${renderTime}`;
        });

        // 3. Sector Live Elapsed Time (The "Live / Result" column)
        const sectorElapsed = document.querySelectorAll('.sector-live-elapsed');
        sectorElapsed.forEach(el => {
            const sn = el.dataset.sn;
            const startStr = el.dataset.start;

            let ms = 0;
            let handled = false;

            const act = sn ? activeEquipages.get(String(sn)) : null;
            if (act && act.startTime > 1600000000000) {
                // Robust Match: Proximity check (same as above)
                if (startStr && Math.abs(act.startTime - Number(startStr)) < 2000) {
                    ms = Math.max(0, (Date.now() - act.startTime) - act.pausedMs);
                    handled = true;
                }
            }

            if (!handled && startStr && !isNaN(Number(startStr))) {
                const start = Number(startStr);
                ms = Date.now() - start - pausedMsSince(start);
            }

            if (ms > 0) {
                el.textContent = formatMsLive(ms);
            }
        });
    }
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
    area.className = 'w-full h-32 p-2 border rounded text-lg text-gray-800 font-serif mb-2';
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

    // Check if we already have the structural grid, if not render it
    if (!document.getElementById('discipline-switcher')) {
        root.innerHTML = `
            <div class="container mx-auto p-4 flex flex-col min-h-screen">
                ${getCompetitionHeader(comp, 'Speaker Dashboard', true)}
                <!-- Discipline Switcher (Top Right or Centered) -->
                <div id="discipline-switcher" class="flex justify-center gap-2 mb-4 pt-4 shrink-0">
                    <!-- updateDisciplineUI will populate this -->
                </div>
                <div id="speaker-page-content" class="flex-1 min-h-0">
                    <!-- Content will be rendered here based on discipline -->
                </div>
            </div>
        `;
        attachSwitcherEvents();
    }

    const contentContainer = document.getElementById('speaker-page-content');
    if (!contentContainer) return;

    // Clear content of current view to prevent duplicate IDs or mixed layouts
    contentContainer.innerHTML = '';

    // Render specific layout based on discipline
    if (currentDiscipline === 'maraton') {
        renderMarathon();
    } else {
        // Default layout for Dressage and Precision
        contentContainer.innerHTML = `
            <div class="grid grid-cols-12 gap-4 items-start">
                <!-- VÄNSTER: På banan + Noteringar (Stor yta) -->
                <div class="col-span-12 lg:col-span-8 flex flex-col gap-4 pr-2">
                    <div id="current-rider-card" class="bg-white p-6 rounded-xl shadow-lg border-l-8 border-brand-gold min-h-[200px] shrink-0">
                        <p class="text-gray-500 text-center italic">Laddar pågående ekipage...</p>
                    </div>
                    
                    <div id="speaker-notes-card" class="bg-yellow-50 p-6 rounded-xl shadow border border-yellow-200 h-fit">
                        <h3 class="text-sm uppercase tracking-wide text-yellow-800 font-bold mb-2">📢 Speaker Noteringar</h3>
                        <div id="speaker-notes-content" class="text-lg text-gray-800 leading-relaxed whitespace-pre-wrap font-serif">
                           Ingen information tillgänglig.
                        </div>
                    </div>
                </div>

                <!-- HÖGER: Kommande + Resultat (Smalare yta) -->
                <div class="col-span-12 lg:col-span-4 flex flex-col gap-4">
                    
                    <div id="active-list-container" class="bg-white rounded-lg shadow flex flex-col mb-4 hidden h-fit">
                        <div class="bg-brand-gold bg-opacity-20 px-4 py-2 border-b border-brand-gold border-opacity-30"><h3 class="font-bold text-yellow-900">🔥 På banan</h3></div>
                        <div id="active-list" class="p-2 space-y-2"></div>
                    </div>

                    <div id="upcoming-list-container" class="bg-white rounded-lg shadow flex flex-col max-h-[500px] overflow-hidden">
                        <div class="bg-gray-100 px-4 py-2 border-b"><h3 class="font-bold text-gray-700">Kommande startande</h3></div>
                        <div id="upcoming-list" class="p-2 space-y-2 overflow-y-auto"></div>
                    </div>

                    <div class="bg-white rounded-lg shadow flex flex-col max-h-[400px] overflow-hidden">
                        <div class="bg-gray-100 px-4 py-2 border-b"><h3 class="font-bold text-gray-700">Senaste resultat</h3></div>
                        <div id="recent-results-list" class="p-2 space-y-2 overflow-y-auto"></div>
                    </div>
                </div>
            </div>
        `;
    }
}

// ================= Marathon Renderer =================
function renderMarathon() {
    // Layout: "Hybrid Command Center" with Sidebar
    // Main Area (Left, col-span-9): Active Card + Active Lists + Upcoming
    // Sidebar (Right, col-span-3): Persistent Leaderboard

    // Safety check for active state
    // We already have `activeEquipages` populated by listeners.

    // 1. Top Section: Current Rider (Manual Focus or Auto)
    // Rendered via `renderCurrentRiderCard()` which targets 'current-rider-card'

    // We need to inject the layout SHELL first if not present
    const container = document.getElementById('speaker-page-content');
    if (!container) return; // Should not happen

    // Check if we already have the structural grid, if not render it
    if (!document.getElementById('marathon-grid-layout')) {
        container.innerHTML = `
        <div id="marathon-grid-layout" class="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-8">
            <!-- Left Main Column (9) -->
            <div class="lg:col-span-9 flex flex-col gap-6">
                <!-- Main Rider Card -->
                <div id="current-rider-card" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden shrink-0">
                    <!-- renderCurrentRiderCard renders here -->
                </div>
                
                <!-- Obstacle Focus (Full Width in Left Col) -->
                 <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-fit">
                    <div class="bg-gray-50 px-4 py-2 border-b border-gray-100 flex justify-between items-center">
                        <h3 class="font-bold text-gray-800 uppercase tracking-wide text-xs">Hinderresultat (Fokus)</h3>
                         <div class="flex items-center gap-2">
                            <label class="text-[10px] font-bold text-gray-500 uppercase">Välj Hinder:</label>
                            <select onchange="window.setObstacleFocus(this.value)" class="text-xs border-gray-300 rounded shadow-sm focus:border-blue-500 focus:ring-blue-500 py-1">
                                <option value="">- Göm -</option>
                                ${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${Number(obstacleFocusVal) === n ? 'selected' : ''}>Hinder ${n}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                     <div id="obstacle-focus-content" class="p-0 animate-fade-in">
                        <!-- renderObstacleFocus renders here -->
                     </div>
                  </div>

                <!-- Sector Analysis -->
                <div id="sector-analysis-container" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-fit">
                    <div class="bg-indigo-50 px-4 py-2 border-b border-indigo-100 flex justify-between items-center">
                        <h3 class="font-bold text-indigo-800 uppercase tracking-wide text-xs">Sektoranalys (Vägsträckor A / T)</h3>
                    </div>
                    <div id="sector-analysis-content" class="p-0">
                        <!-- renderSectorAnalysis renders here -->
                    </div>
                </div>

                 <!-- Speaker Notes (Moved to Left) -->
                 <div id="speaker-notes-card" class="bg-yellow-50 rounded-xl shadow-sm border border-yellow-200 p-4 shrink-0 h-fit min-h-[150px]">
                    <div class="flex justify-between items-center mb-2">
                        <h3 class="font-bold text-yellow-800 uppercase tracking-wide text-xs">Speaker Noteringar</h3>
                         <button onclick="window.editSpeakerNotes(currentRider?.eq?.startNumber)" class="text-yellow-600 hover:text-yellow-800 text-xs font-bold px-2 py-1 bg-yellow-100 rounded">✎ Ändra</button>
                    </div>
                    <div id="speaker-notes-content" class="text-gray-800 text-lg font-serif italic leading-relaxed">
                        Inga specifika noteringar inlagda.
                    </div>
                 </div>
                
                <!-- Upcoming / Startlist -->
                <div id="upcoming-list-container" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-fit">
                    <div class="bg-gray-50 px-4 py-2 border-b border-gray-100">
                         <h3 class="font-bold text-gray-500 uppercase tracking-wide text-xs">Kommande startande</h3>
                    </div>
                     <div id="upcoming-list-content" class="p-2 space-y-1">
                        <!-- renderUpcomingList renders here -->
                    </div>
                </div>
            </div>

            <!-- Right Sidebar Column (3) -->
            <div class="lg:col-span-3 flex flex-col gap-4">
                 <!-- Active List (Moved to Top Right) -->
                <div id="active-list-container" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-fit">
                    <div class="bg-amber-50 px-4 py-2 border-b border-amber-100 flex justify-between items-center">
                        <h3 class="font-bold text-amber-800 uppercase tracking-wide text-xs">På banan just nu</h3>
                        <span class="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full" id="active-count-badge">0</span>
                    </div>
                    <div id="active-list-content" class="p-2 space-y-2 relative">
                        <!-- renderActiveListNew renders here -->
                    </div>
                </div>

                 <!-- Leaderboard -->
                 <div class="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col flex-1 overflow-hidden" style="max-height: 800px;">
                     <div class="bg-blue-900 text-white px-4 py-3 flex justify-between items-center shrink-0">
                         <h3 class="font-bold uppercase tracking-wider text-sm">Ställning</h3>
                         <div class="text-[10px] bg-blue-800 px-2 py-0.5 rounded text-blue-200" id="sidebar-class-name">--</div>
                     </div>
                     
                     <div class="p-2 border-b border-gray-100 bg-gray-50 shrink-0">
                         <div class="grid grid-cols-6 text-[10px] uppercase font-bold text-gray-400 px-2">
                             <div class="col-span-1">#</div>
                             <div class="col-span-3">Namn</div>
                             <div class="col-span-2 text-right">Straff</div>
                         </div>
                     </div>

                     <div id="sidebar-leaderboard-content" class="flex-1 p-0 overflow-y-auto">
                         <!-- renderLeaderboardSidebar renders here -->
                     </div>
                 </div>
            </div>
        </div>`;
    }

    // Now call sub-renderers
    renderCurrentRiderCard();
    renderActiveListNew();
    renderUpcomingList();
    renderLeaderboardSidebar(); // Ensure leaderboard updates on main render loop
    renderLeaderboardSidebar();
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
    if (!el) return;

    // 1. Determine which class to show
    let className = sidebarClassFocus || currentRider?.eq?.className;

    // Fallback: Pick first class from allEquipages if still null
    if (!className && allEquipages.length > 0) {
        className = allEquipages[0].className;
    }

    // 2. Build Class Switcher HTML
    if (badge) {
        const uniqueClasses = [...new Set(allEquipages.map(e => e.className))].sort();
        if (uniqueClasses.length > 1) {
            badge.innerHTML = `
                <select onchange="window.setSidebarClassFocus(this.value)" class="bg-blue-800 text-white text-[10px] border-none rounded focus:ring-0 py-0.5 cursor-pointer pr-4">
                    ${uniqueClasses.map(c => `<option value="${c}" ${c === className ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            `;
        } else {
            badge.textContent = className || 'Ingen klass';
        }
    }

    if (!className) {
        el.innerHTML = '<div class="p-4 text-center text-gray-400 italic text-xs">Inga ekipage laddade</div>';
        return;
    }

    // 3. Get Ranking for ALL riders in this class
    const riders = allEquipages.filter(e => e.className === className);
    const ranked = riders.map(e => {
        const sn = String(e.startNumber);
        const mSt = maratonStatusMap.get(sn);

        // Use getTotalRanking logic (Dressage + Marathon + Precision)
        const dSt = dressageStatusMap.get(sn);
        const pSt = precisionStatusMap.get(sn);

        const dPen = dSt?.finalPenalty ?? null;
        const mPen = mSt?.totalPenalty ?? null;
        const pPen = pSt?.totalPenalty ?? null;

        const total = computeTotalPenalty(dPen, mPen, pPen);
        const isLive = activeEquipages.has(sn);

        return {
            sn: e.startNumber,
            name: e.driverName,
            club: e.clubName,
            penalty: total,
            isLive: isLive,
            hasStartedMaraton: mSt != null && mSt.totalPenalty != null
        };
    }).sort((a, b) => {
        const pA = (Number.isFinite(a.penalty)) ? a.penalty : 999999;
        const pB = (Number.isFinite(b.penalty)) ? b.penalty : 999999;
        return pA - pB;
    });

    if (ranked.length === 0) {
        el.innerHTML = '<div class="p-4 text-center text-gray-400 italic text-xs">Inga ekipage i denna klass</div>';
        return;
    }

    const leaderScore = (ranked.length > 0 && Number.isFinite(ranked[0].penalty)) ? ranked[0].penalty : 0;

    el.innerHTML = ranked.map((r, i) => {
        const rank = i + 1;
        const isLeader = i === 0;
        const diff = (Number.isFinite(r.penalty) && !isLeader) ? (r.penalty - leaderScore) : 0;

        let diffHtml = '';
        if (Number.isFinite(r.penalty)) {
            if (isLeader) diffHtml = `<span class="text-[10px] text-green-600 font-bold uppercase">LedarBoll</span>`;
            else diffHtml = `<span class="text-[10px] text-red-400 font-mono">+${diff.toFixed(2)}</span>`;
        }

        const scoreClass = r.isLive ? 'text-blue-600 animate-pulse' : 'text-gray-900';
        const rowBg = r.isLive ? 'bg-blue-50' : (isLeader ? 'bg-yellow-50' : 'hover:bg-gray-50');
        const isSelected = (currentRider && String(currentRider.eq.startNumber) === String(r.sn));
        const selectedClass = isSelected ? 'ring-2 ring-inset ring-blue-400' : '';

        return `
        <div onclick="showRiderDetails('${r.sn}')" class="grid grid-cols-6 items-center p-2 border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${rowBg} ${selectedClass}">
            <div class="col-span-1 font-bold text-gray-500 text-xs">${rank}.</div>
            <div class="col-span-3 min-w-0 pr-1">
                <div class="font-bold text-gray-800 text-sm truncate leading-tight">${r.name}</div>
                <div class="text-[10px] text-gray-400 truncate">${r.club}</div>
            </div>
            <div class="col-span-2 text-right">
                <div class="font-mono font-bold text-sm ${scoreClass}">${Number.isFinite(r.penalty) ? r.penalty.toFixed(1) : '—'}</div>
                ${diffHtml}
            </div>
        </div>`;
    }).join('');
}

// Make global for inline clicks
window.closeRiderModal = () => {
    const modal = document.getElementById('rider-detail-modal');
    if (modal) modal.classList.add('hidden');
};

window.showRiderDetails = (sn) => {
    if (currentDiscipline === 'precision') {
        showDetailsModal(sn, allEquipages, precisionStatusMap, precisionConfig, startTimes);
    } else {
        console.log('Detail view not implemented for ' + currentDiscipline);
    }
};

window.setComparisonRider = (val) => {
    window.compareRiderId = val;
    triggerRender();
};

function updateDisciplineUI() {
    const nav = document.getElementById('discipline-switcher');
    if (nav) {
        // Compact segmented control
        nav.className = "flex bg-gray-200 rounded-lg p-1 gap-1 text-xs font-bold";
        nav.innerHTML = `
            <button onclick="switchDiscipline('dressyr')" class="flex-1 px-3 py-1.5 rounded-md transition-all ${currentDiscipline === 'dressyr' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}">Dressyr</button>
            <button onclick="switchDiscipline('maraton')" class="flex-1 px-3 py-1.5 rounded-md transition-all ${currentDiscipline === 'maraton' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}">Maraton</button>
            <button onclick="switchDiscipline('precision')" class="flex-1 px-3 py-1.5 rounded-md transition-all ${currentDiscipline === 'precision' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}">Precision</button>
            
            <!-- Stress Test Button -->
            <button onclick="if(confirm('Starta Stress-test?')) window.startStressTest()" class="text-xs px-2 py-1 text-red-300 hover:text-red-500 hover:bg-red-50 rounded" title="Simulera">⚡</button>
        `;
    }
}

function switchDiscipline(newDisc) {
    if (currentDiscipline === newDisc) return;
    currentDiscipline = newDisc;
    renderLayout(); // Rebuild shell
    updateDisciplineUI();
    setupAllListeners();
    manualFocusId = null;
    triggerRender();
}
window.switchDiscipline = switchDiscipline;

// Verification Helper
async function verifyDressageResult(sn, st, eq) {
    try {
        const programKey = st.testKey || st.programKey || eq.testKey || (window.klassProgramMapping?.[eq?.className] ?? null);
        const programObj = programKey ? mergedPrograms[programKey] : null;

        if (programObj) {
            const protocols = await getDressageResultsForEquipage(competitionId, eq.id || sn); // Helper might expect ID or SN? logic checks both?
            // getDressageResultsForEquipage usually returns array of protocols

            // Allow for SN based fetch if ID logic fails in service? 
            // The imported service 'getDressageResultsForEquipage(compId, equipageId)'
            // We'll trust it returns what we need.

            if (Array.isArray(protocols) && protocols.length > 0) {
                // strict filter validation
                const cleanProtocols = deduplicateAndFilterProtocols(protocols, allJudges); // Use global allJudges
                const final = computeFinalFromSaved(eq, cleanProtocols, programObj);
                if (final) {
                    // Update map with VERIFIED calculation
                    const current = dressageStatusMap.get(sn) || {};
                    dressageStatusMap.set(sn, {
                        ...current,
                        finalPercent: final.percent,
                        finalPoints: final.points,
                        finalPenalty: final.penalty,
                        _verified: true
                    });
                    triggerRender();
                }
            }
        }
    } catch (e) {
        console.warn('Verification failed for', sn, e);
    }
}

function verifyAllStartups() {
    // Disabled to prevent network flood
    /*
    dressageStatusMap.forEach((st, sn) => {
        if (st.state === 'finished' && !st._verified) {
             const eq = allEquipages.find(e => String(e.startNumber) === sn);
             if (eq) verifyDressageResult(sn, st, eq);
        }
    });
    */
}


function attachSwitcherEvents() {
    document.getElementById('btn-dressyr')?.addEventListener('click', () => switchDiscipline('dressyr'));
    document.getElementById('btn-maraton')?.addEventListener('click', () => switchDiscipline('maraton'));
    document.getElementById('btn-precision')?.addEventListener('click', () => switchDiscipline('precision'));
}

function renderSpeakerDashboard() {
    renderCurrentRiderCard();
    renderObstacleFocus();
    renderActiveListNew();
    renderSectorAnalysis();
    renderUpcomingList();
    renderResultList();
    renderLeaderboardSidebar();
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

    if (!obstacleFocusVal || currentDiscipline !== 'maraton') {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = renderObstacleLeaderboard(obstacleFocusVal);
}



function getActiveMarathonRunners() {
    const active = [];
    maratonStatusMap.forEach((d, sn) => {
        // Include if running OR high priority
        if (!d || (d.state !== 'running' && d.prio !== 2)) return;

        const eq = allEquipages.find(e => String(e.startNumber) === sn);
        if (!eq) return;

        let taskName = d.taskName || 'På banan';
        if (d.currentObstacle) taskName = `Hinder ${d.currentObstacle}`;

        // Calculate a simple time label if possible
        let timeLabel = '';
        if (d.running && d.liveObstacleStartAt) {
            const start = d.liveObstacleStartAt.toMillis ? d.liveObstacleStartAt.toMillis() : d.liveObstacleStartAt;
            if (start > 0) {
                const ms = Date.now() - start;
                timeLabel = (ms / 1000).toFixed(0) + 's';
            }
        }

        active.push({ eq, taskName, timeLabel });
    });

    // Sort logic: Prio 2 (Focus) first, then others
    active.sort((a, b) => {
        const pA = a.eq.startNumber === manualFocusId ? 10 : 0;
        const pB = b.eq.startNumber === manualFocusId ? 10 : 0;
        return pB - pA;
    });

    return active;
}

// New: Render Obstacle Leaderboard (Focus View)
function renderObstacleLeaderboard(obstacleNum) {
    if (!obstacleNum) return '';

    // 1. Collect best times for this obstacle across all drivers
    const results = [];
    maratonStatusMap.forEach((data, sn) => {
        const obsArr = getObstacleArray(data);
        const item = obsArr.find(o => Number(o.number) === Number(obstacleNum));
        if (item && Number.isFinite(item.penalty)) {
            const eq = allEquipages.find(e => String(e.startNumber) === sn);
            if (eq) {
                results.push({
                    sn,
                    name: eq.driverName,
                    club: eq.clubName,
                    class: eq.className,
                    penalty: item.penalty
                });
            }
        }
    });

    results.sort((a, b) => a.penalty - b.penalty);
    const top10 = results.slice(0, 10);

    if (top10.length === 0) return '<div class="text-sm text-gray-400 p-4 text-center">Inga resultat för Hinder ' + obstacleNum + ' ännu.</div>';

    return `
    <div class="overflow-x-auto">
        <table class="w-full text-sm text-left text-gray-600">
            <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                <tr>
                    <th class="px-3 py-2">#</th>
                    <th class="px-3 py-2">Ekipage</th>
                    <th class="px-3 py-2 text-right">Straff</th>
                </tr>
            </thead>
            <tbody>
                ${top10.map((r, i) => `
                <tr class="bg-white border-b hover:bg-gray-50 cursor-pointer" onclick="window.selectSpeakerRider('${r.sn}')">
                    <td class="px-3 py-2 font-bold ${i < 3 ? 'text-brand-gold' : 'text-gray-400'}">${i + 1}</td>
                    <td class="px-3 py-2">
                        <div class="font-bold text-gray-800">${r.name}</div>
                        <div class="text-[10px] text-gray-500">${r.class} • ${r.club}</div>
                    </td>
                    <td class="px-3 py-2 text-right font-mono font-black text-gray-900">${r.penalty.toFixed(2)}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>`;
}

// New: Multi-Driver "Control Tower" List
function renderActiveMarathonList(showFull = false) {
    const list = getActiveMarathonRunners(); // Use existing sort

    // Safety: don't show too many if small view
    const displayList = showFull ? list : list.slice(0, 10);

    if (displayList.length === 0) return '<div class="text-xs text-gray-400 p-2 italic text-center">Inga ekipage på banan.</div>';

    return displayList.map(item => {
        const { eq, taskName, timeLabel } = item;
        const d = maratonStatusMap.get(String(eq.startNumber));

        let statusColor = 'bg-green-50 text-green-800 border-green-100';
        let icon = '🟢';

        // Check if "long time" warning?

        // Calculate Prognosis for this driver
        const res = calculateMarathonResult(eq, d || {}, d || {});
        let progHtml = '';
        if (res) {
            const prog = calculateProjectedPenalty(res, eq.className, null, maratonStatusMap, allEquipages);
            if (prog && Number.isFinite(prog.projectedTotal)) {
                progHtml = `<div class="text-[10px] font-bold text-gray-500 mt-1">Prognos: ${prog.projectedTotal.toFixed(1)}</div>`;
            }
        }

        return `
        <div onclick="window.selectSpeakerRider('${eq.startNumber}')" class="p-3 mb-2 rounded-lg border ${statusColor} hover:shadow-md cursor-pointer transition-all bg-white relative group">
             <div class="flex justify-between items-start">
                 <div>
                     <div class="flex items-center gap-2">
                        <span class="font-black text-lg text-gray-800 w-8">#${eq.startNumber}</span>
                        <span class="font-bold text-sm text-gray-900 truncate max-w-[120px]" title="${eq.driverName}">${eq.driverName}</span>
                     </div>
                     <div class="text-xs text-blue-700 font-bold mt-0.5 uppercase tracking-wide">${taskName}</div>
                 </div>
                 <div class="text-right">
                     <div class="text-xl font-mono font-black text-gray-800" id="maraton-timer-${eq.startNumber}">${timeLabel}</div>
                 </div>
             </div>
             <div class="flex justify-between items-end mt-1">
                 <div class="text-[10px] text-gray-400 truncate">${eq.className}</div>
                 ${progHtml}
             </div>
             
             <!-- Hover prompt -->
             <div class="absolute inset-0 bg-blue-50/50 opacity-0 group-hover:opacity-100 flex items-center justify-center pointer-events-none transition-opacity">
                <span class="bg-white shadow px-2 py-1 rounded text-xs font-bold text-blue-800">Visa Detaljer</span>
             </div>
        </div>`;
    }).join('');
}

// New: Obstacle Comparison View (Inserted into Left Column)
function renderObstacleComparison(rider) {
    if (currentDiscipline !== 'maraton' || !rider || !rider.task || rider.task.type !== 'obstacle') return '';

    // We already do this deep inside "renderCurrentRiderCard" -> "maraton" block? 
    // Yes, but let's extract it or leave it there if it works well.
    // Actually, looking at renderCurrentRiderCard's maraton section, I added "Split Diff Html" there.
    // So this function might not be needed if the logic is embedded.
    // BUT the task says "Obstacle Focus View". 
    // Let's rely on the embedded logic I added earlier for the "Current Rider" focus.

    return '';
}

function renderActiveList() {
    const container = document.getElementById('active-list-container');
    const el = document.getElementById('active-list');

    if (currentDiscipline !== 'maraton') {
        if (container) container.classList.add('hidden');
        if (document.getElementById('upcoming-list-container')) document.getElementById('upcoming-list-container').style.height = '50%';
        return;
    }

    if (container) container.classList.remove('hidden');
    // More space for active list in marathon
    if (document.getElementById('upcoming-list-container')) document.getElementById('upcoming-list-container').style.height = '25%';

    const activeCandidates = getActiveMarathonRunners(); // Uses maratonStatusMap logic

    // Separate "Hot" (Obstacle/Finish) from "Standard" (Sections/Transport)
    const hotList = [];
    const standardList = [];

    // Iterate activeEquipages (Real-time map) instead of candidates if we want full precision,
    // but getActiveMarathonRunners wraps statusMap. 
    // Let's use activeEquipages as primary source if populated.
    const sourceArr = activeEquipages.size > 0 ? Array.from(activeEquipages.values()) : [];

    // Sort by priority (Obstacle > Stage)
    sourceArr.sort((a, b) => {
        if (a.task.type === 'obstacle' && b.task.type !== 'obstacle') return -1;
        if (b.task.type === 'obstacle' && a.task.type !== 'obstacle') return 1;
        return 0; // Keep order
    });

    if (sourceArr.length === 0) {
        el.innerHTML = '<div class="text-xs text-gray-500 text-center p-2">Inga aktiva på banan.</div>';
        return;
    }

    el.innerHTML = sourceArr.map(c => {
        const isSelected = (manualFocusId && String(manualFocusId) === String(c.sn)) || (!manualFocusId && currentRider && String(currentRider.eq.startNumber) === String(c.sn));
        const bgClass = isSelected ? 'bg-amber-100 border-amber-300' : 'bg-gray-50 hover:bg-gray-100 border-transparent';
        const isObstacle = c.task && c.task.type === 'obstacle';

        let statsHtml = '';
        if (isObstacle) {
            const obsNum = c.task.key;
            const stats = calculateClassObstacleStats(c.eq.className, obsNum);
            if (stats && stats.bestTime) {
                statsHtml = `<span class="text-[10px] text-gray-500 ml-2">Mål: <b>${stats.bestTime.toFixed(1)}s</b></span>`;
            }
        }

        // Timer placeholder (updated by Ticker)
        // Calc elapsed for initial render
        const ms = (Date.now() - c.startTime) - c.pausedMs;
        const timeTxt = ms > 0 ? (ms / 1000).toFixed(1) + 's' : '0.0s';

        return `
        <div onclick="selectSpeakerRider(${c.sn})" class="cursor-pointer p-2 rounded border mb-1 last:mb-0 ${bgClass} transition-colors">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="font-bold text-gray-900 text-sm whitespace-nowrap">#${c.sn}</span>
                    <span class="text-sm truncate" title="${c.eq.driverName}">${c.eq.driverName}</span>
                </div>
                <span class="text-xs font-mono font-bold w-12 text-right text-gray-700" id="maraton-timer-${c.sn}">${timeTxt}</span>
            </div>
            <div class="flex justify-between mt-1 text-xs text-gray-600 items-baseline">
                <span class="bg-white px-1 rounded border ${isObstacle ? 'text-amber-700 border-amber-200 bg-amber-50' : ''}">${c.task.name}</span>
                ${statsHtml}
            </div>
        </div>
    `;
    }).join('');
}

// ================= Dressage Helpers (Phase 4) =================
// Helper to get the last movement/score from a specific judge or the last update
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

        // Calculate projection
        const eq = allEquipages.find(e => String(e.startNumber) === String(startNumber));
        const proj = calcLiveJudgeProjection(d, mergedPrograms, eq);

        const pTxt = proj && Number.isFinite(proj.percent) ? `${proj.percent.toFixed(1)}%` : '–';

        // Live Moment Text
        // Try to find the program definition for better text (description)
        let lastTxt = '—', lastScoreTxt = '';
        if (currentMomentIdx >= 0 && d.movements && d.movements[currentMomentIdx]) {
            const m = d.movements[currentMomentIdx];
            const momentNo = m.momentNo;

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
            lastTxt = m.momentText || `M${m.momentNo}`;
            if (Number.isFinite(m.score)) lastScoreTxt = ` (${Number(m.score).toFixed(1)})`;
        }

        return `
      <div class="p-2 bg-gray-50 rounded border flex flex-col items-center">
         <div class="text-[10px] uppercase font-bold text-gray-400">Domare ${pos}</div>
         ${nameHtml}
         <div class="text-xl font-bold text-gray-800 my-1">${pTxt}</div>
         <div class="text-[10px] text-gray-500 truncate w-full text-center" title="${lastTxt}">${lastTxt}${lastScoreTxt}</div>
      </div>`;
    }).join('');

    return `<div class="grid grid-cols-5 gap-2 mt-2">${cells}</div>`;
}


// New Helper: Render Top 3
function renderTop3List(className, discipline) {
    if (!className) return '';
    const results = [];

    // Iterate all equipages to ensure we catch everyone in the class
    allEquipages.forEach(eq => {
        if (eq.className !== className) return;
        const sn = String(eq.startNumber);
        const st = dressageStatusMap.get(sn);

        if (st && st.finalPenalty != null) {
            results.push({
                sn: sn,
                name: eq.driverName,
                club: eq.clubName,
                eq: eq,
                penalty: Number(st.finalPenalty), // Ensure number
                percent: Number(st.finalPercent || 0)
            });
        }
    });

    // Filter out 0.00 if it means "no result" (unless it's a really good score, but 0 penalty is rare in dressage? No, 0 penalty is impossible usually, it's 100-percent. Wait, penalty is coefficient based. 0 penalty means 100%? If so, keep it. But usually defaults are 0).
    // Let's filter> 0.01 just in case
    const validResults = results.filter(r => r.penalty > 0.01);

    validResults.sort((a, b) => a.penalty - b.penalty);
    const top3 = validResults.slice(0, 3);

    if (top3.length === 0) return '<div class="text-xs text-center text-gray-400 italic py-2">Inga resultat i klassen ännu</div>';

    return `
    <div class="space-y-1">
        ${top3.map((r, i) => `
            <div onclick="showRiderDetails('${r.sn}')" class="flex items-center justify-between p-2 border-b last:border-0 hover:bg-yellow-50 cursor-pointer transition-colors group">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="font-bold text-gray-400 w-4">${i + 1}.</span>
                    <span class="font-bold text-gray-800 truncate group-hover:text-blue-700 transition-colors" title="${r.name}">${r.name}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="text-[10px] text-gray-500 font-mono hidden sm:inline">${r.percent.toFixed(1)}%</span>
                    <span class="font-black text-gray-900">${r.penalty.toFixed(2)}</span>
                </div>
            </div>
        `).join('')
        }
    </div> `;
}

function getDressageLeaderInClass(className) {
    let bestPen = Infinity;
    let bestName = null;
    let bestPercent = null;

    dressageStatusMap.forEach((st, sn) => {
        const eq = allEquipages.find(e => String(e.startNumber) === sn);
        if (!eq || eq.className !== className) return;

        // Check final results only? Or running? Usually leader is best FINISHED.
        if (st.finalPenalty != null) {
            if (st.finalPenalty < bestPen) {
                bestPen = st.finalPenalty;
                bestName = eq.driverName;
                bestPercent = st.finalPercent;
            }
        }
    });

    if (bestPen === Infinity) return null;
    return { name: bestName, penalty: bestPen, percent: bestPercent };
}


// Calculates the total penalty (Dressage + Marathon + Precision) for each rider in the class.
// Inject live data for the current rider if available.
function getTotalRanking(className, currentRiderInfo = null) {
    if (!className) return [];

    const results = [];

    allEquipages.forEach(eq => {
        if (eq.className !== className) return;
        const sn = String(eq.startNumber);

        // 1. Dressage
        const dSt = dressageStatusMap.get(sn);
        let dPen = (dSt && dSt.finalPenalty != null) ? dSt.finalPenalty : null;

        // 2. Marathon
        const mSt = maratonStatusMap.get(sn);
        let mPen = (mSt && mSt.totalPenalty != null) ? mSt.totalPenalty : null;

        // 3. Precision
        const pSt = precisionStatusMap.get(sn);
        let pPen = (pSt && pSt.totalPenalty != null) ? pSt.totalPenalty : null;
        let pTimeMs = (pSt && pSt.timeMs) || 0;

        // Apply Injections
        if (currentRiderInfo && String(currentRiderInfo.sn) === sn) {
            if (currentRiderInfo.discipline === 'maraton') {
                mPen = currentRiderInfo.totalPenalty;
            } else if (currentRiderInfo.discipline === 'precision') {
                pPen = currentRiderInfo.totalPenalty;
                pTimeMs = currentRiderInfo.timeMs || 0;
            } else if (currentRiderInfo.discipline === 'dressyr') {
                // Determine if we should override dPen (finalPenalty) with live prognosis
                // Often we want to track live ranking.
                if (currentRiderInfo.totalPenalty != null) {
                    dPen = currentRiderInfo.totalPenalty;
                }
            }
        }

        // Centralized Calculation
        const total = computeTotalPenalty(dPen, mPen, pPen);

        // For precision tie-breaker (rules say lowest time in precision breaks tie if points equal)
        // Adjust as per valid rules. Usually total competition tie-break is complicated, 
        // but let's assume Precision Time is the decider for now as requested.

        results.push({
            sn: eq.startNumber,
            name: eq.driverName,
            total: total,
            tieBreakerTime: pTimeMs
        });
    });

    // Sort: Lowest Total first. If tie, Lowest Precision Time first.
    // FILTER OUT 0.00 Results which likely indicate incomplete data
    const validResults = results.filter(r => r.total > 0.01);

    // Sort logic
    validResults.sort((a, b) => {
        if (Math.abs(a.total - b.total) > 0.001) return a.total - b.total;
        return a.tieBreakerTime - b.tieBreakerTime;
    });

    return validResults;
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
                <button id="edit-notes-btn" onclick="editSpeakerNotes('${eq.startNumber}')" class="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded hover:bg-yellow-300 transition-colors">✎ Ändra</button>
            </div> `;
        }
    }

    let horseText = '';
    const horses = eq.horses || [];
    if (horses.length > 0) {
        horseText = horses.map(h => `<span class="font-semibold">${h.name}</span> <span class="text-xs text-gray-500">(${h.lineage || ''})</span>`).join('<br>');
    } else {
        horseText = '<span class="text-gray-500 italic">Inga hästar registrerade</span>';
    }

    // --- Total Ranking Calculation ---
    let liveInjection = null;
    let targetToBeatHtml = '';
    if (currentDiscipline === 'precision') {
        const d = data || {};
        let pen = d.totalPenalty || 0;
        let timeMs = d.liveTimeMs || d.timeMs || 0;
        if (d.running && d.liveStartEpoch) {
            const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
            const nowMs = (d.livePausedMs || 0) + (Date.now() - d.liveStartEpoch);
            const lp = calculatePrecisionTimePenalty(nowMs, maxSec);
            const op = d.liveObstaclePenalty || d.obstaclePenalty || 0;
            const ep = d.extraPenalty || 0;
            pen = op + lp + ep;
            timeMs = nowMs;
        }
        liveInjection = { sn: eq.startNumber, discipline: 'precision', totalPenalty: pen, timeMs: timeMs };
    } else if (currentDiscipline === 'maraton') {
        liveInjection = { sn: eq.startNumber, discipline: 'maraton', totalPenalty: data.totalPenalty || 0 };
    } else if (currentDiscipline === 'dressyr') {
        // Determine live dressage penalty for total ranking injection
        // ✅ Speaker uses liveProtocolMap (judgeLiveByPos is not populated in this file)
        const liveMap = liveProtocolMap.get(String(eq.startNumber)) || new Map();
        let tPen = 0, cnt = 0;

        for (const proto of liveMap.values()) {
            const pos = String(proto.position || proto.judgePosition || '').toUpperCase();
            if (!pos) continue;

            const proj = calcLiveJudgeProjection(proto, mergedPrograms, eq);
            if (proj && Number.isFinite(proj.penalty)) {
                tPen += proj.penalty;
                cnt++;
            }
        }

        // Only inject if we actually have live data
        if (cnt > 0) {
            const avgP = tPen / cnt;
            liveInjection = { sn: eq.startNumber, discipline: 'dressyr', totalPenalty: avgP };
        }
    }


    const totalRanking = getTotalRanking(eq.className, liveInjection);
    const myTotalRankIndex = totalRanking.findIndex(r => String(r.sn) === String(eq.startNumber));
    const myTotalRank = myTotalRankIndex !== -1 ? myTotalRankIndex + 1 : '-';
    // Find my total score
    const myTotalScore = myTotalRankIndex !== -1 ? totalRanking[myTotalRankIndex].total : 0;

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
            <div class="text-[10px] uppercase font-bold text-gray-500">${targetLabel}</div>
                <div class="text-lg font-black text-gray-800 leading-tight">${leader.name}</div>
                <div class="text-lg font-mono font-bold text-gray-600">${bestOther.toFixed(2)}</div>
            </div> `;

            if (diff < 0) {
                // I am leading!
                // Balls Margin: How many 3.0 balls can I afford?
                const balls = Math.floor(Math.abs(diff) / 3.0);
                const ballsText = balls > 0 ? `(Råd med ${balls} boll${balls === 1 ? '' : 'ar'}!)` : '(Tajy! Inga bollar!)';

                // Hide balls text for Marathon (irrelevant/confusing?)
                const extraText = currentDiscipline === 'maraton' ? '' : `<br> <span class="text-[10px]">${ballsText}</span>`;

                marginHtml = `<div class="text-xs mt-1 font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded border border-green-200">
    Segermarginal: ${Math.abs(diff).toFixed(2)} ${extraText}
    </div>`;
            } else {
                // I am behind
                marginHtml = `<div class="text-xs mt-1 font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded border border-red-200">
    Upp till ledning: +${diff.toFixed(2)}
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
                <div class="text-sm font-bold text-brand-darkblue uppercase tracking-wider mb-1 flex items-center gap-2">
                    På Banan Just Nu
                    
                    ${currentDiscipline === 'maraton' ? (() => {
            const others = allEquipages.filter(e => e.className === eq.className && String(e.startNumber) !== String(eq.startNumber));
            return `
                        <select onchange="window.setComparisonRider(this.value)" class="ml-2 text-[10px] py-0.5 pl-2 pr-6 border-gray-200 rounded-full bg-gray-50 hover:bg-white focus:ring-0 cursor-pointer">
                            <option value="">+ Jämför...</option>
                            ${others.map(r => `<option value="${r.startNumber}" ${window.compareRiderId == r.startNumber ? 'selected' : ''}>#${r.startNumber} ${r.driverName}</option>`).join('')}
                        </select>`;
        })() : ''}

                </div>
                <div class="text-2xl md:text-3xl font-black text-gray-900 mb-0 truncate leading-tight">
                    ${eq.driverName}
                </div>
                <div class="text-xl text-gray-600 mb-4 flex items-center gap-2">
                    ${getClubLogoHtml(eq)} ${eq.clubName} ${getFlagHtml(eq)}
                </div>
                
                <!-- CLICKABLE MAIN NAME -->
                <div onclick="showRiderDetails('${eq.startNumber}')" class="flex flex-wrap gap-2 mb-4 items-center cursor-pointer hover:bg-gray-50 rounded p-1 -ml-1 transition-colors group">
                    <div class="inline-block bg-blue-100 text-blue-800 text-sm font-bold px-3 py-1 rounded-full group-hover:bg-blue-200">
                        #${eq.startNumber} • ${eq.className}
                    </div>
                     <div class="flex flex-col items-start justify-center gap-1">
                        <div class="flex items-center gap-2">
                             <div class="inline-block bg-purple-100 text-purple-900 text-sm font-bold px-3 py-1 rounded-full border border-purple-200 group-hover:bg-purple-200">
                                Total: ${myTotalRank} (${myTotalScore.toFixed(2)})
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
                 <div class="text-5xl font-black text-gray-200">LIVE</div>
                 ${targetToBeatHtml || renderLeaderToBeat(eq.className)}
            </div>
        </div>
    `;

    // --- Content (Discipline Specific) ---
    let contentHtml = '';

    if (currentDiscipline === 'dressyr') {

        // ✅ Aggregation from liveProtocolMap ...
        let totalPercent = 0;
        let totalPenalty = 0;
        let count = 0;

        const liveMapForAgg = liveProtocolMap.get(String(eq.startNumber)) || new Map();
        for (const proto of liveMapForAgg.values()) {
            const proj = calcLiveJudgeProjection(proto, mergedPrograms, eq);
            if (proj && Number.isFinite(proj.percent) && Number.isFinite(proj.penalty)) {
                totalPercent += proj.percent;
                totalPenalty += proj.penalty;
                count++;
            }
        }

        const avgPercent = count > 0 ? (totalPercent / count) : null;
        const avgPenalty = count > 0 ? (totalPenalty / count) : null;

        // Judge Grid
        // Refactor: Use liveProtocolMap for robust data
        const liveMap = liveProtocolMap.get(String(eq.startNumber)) || new Map();

        // ✅ ADD THIS: liveProtoArray is used below but was missing
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
        const leader = getDressageLeaderInClass(eq.className);
        let trendHtml = '';
        if (leader && avgPercent !== null) {
            // Compare Percentages (Higher is better)
            const gap = avgPercent - leader.percent;
            const gapColor = gap >= 0 ? 'text-green-600' : 'text-red-600';
            const gapSign = gap >= 0 ? '+' : '';
            const leaderName = (leader.name || '');
            trendHtml = `
            <div class="text-center p-2 bg-gray-50 rounded-lg shadow-sm border border-gray-100 h-full flex flex-col justify-center">
                <div class="text-[10px] uppercase tracking-wide text-gray-500 font-bold mb-0">Trend vs Ledare (${leaderName})</div>
                <div class="text-2xl font-black ${gapColor} leading-tight">${gapSign}${gap.toFixed(2)} %</div>
                <div class="text-[10px] text-gray-400 mt-0">Ledare: ${leader.percent ? leader.percent.toFixed(2) : '-'}%</div>
            </div> `;
        } else if (!leader) {
            trendHtml = `
            <div class="text-center p-2 bg-gray-50 rounded-lg shadow-sm border border-gray-100 h-full flex flex-col justify-center">
                <div class="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-0">Ingen ledare</div>
                <div class="text-lg font-bold text-gray-300">Första start</div>
            </div> `;
        }

        contentHtml = `
    <div class="mt-4 pt-4 border-t border-gray-100">
            <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
                 <div class="md:col-span-12">
                    <div class="text-sm uppercase text-gray-500 font-bold mb-1">Häst(ar)</div>
                    <div class="text-xl text-gray-900 leading-snug mb-2">${horseText}</div>
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                <div class="text-center p-2 bg-brand-darkblue/5 rounded-lg border border-brand-darkblue/10 shadow-sm flex flex-col justify-center h-20">
                    <div class="text-[10px] uppercase tracking-wider text-brand-darkblue font-extrabold mb-0 leading-none">Prognos %</div>
                    <div class="text-3xl font-black text-brand-darkblue tracking-tight leading-none mt-1">${Number.isFinite(avgPercent) ? avgPercent.toFixed(1) + '%' : '—'}</div>
                </div>
                <div class="text-center p-2 bg-brand-darkblue/5 rounded-lg border border-brand-darkblue/10 shadow-sm flex flex-col justify-center h-20">
                    <div class="text-[10px] uppercase tracking-wider text-brand-darkblue font-extrabold mb-0 leading-none">StraffP</div>
                    <div class="text-3xl font-black text-brand-darkblue tracking-tight leading-none mt-1">${Number.isFinite(avgPenalty) ? avgPenalty.toFixed(2) : '—'}</div>
                </div>
                <!-- Trend Box -->
                <div class="col-span-2 md:col-span-1 h-20">
                     ${trendHtml}
                </div>
            </div>
            
            <!--Judge Grid-->
            <div class="mt-8">
                 <div class="flex items-center gap-2 mb-3">
                    <div class="h-px bg-gray-200 flex-1"></div>
                    <span class="text-xs uppercase text-gray-400 font-bold tracking-widest">Domarstatus</span>
                    <div class="h-px bg-gray-200 flex-1"></div>
                 </div>
                 ${judgeGridHtml}
            </div>
            
             <!--Top 3 List(Dressage)-->
    <div class="mt-6 border-t border-gray-100 pt-4">
        <div class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Topp 3 i klassen (${eq.className})</div>
        ${renderTop3List(eq.className, 'dressyr')}
    </div>
        </div> `;

    } else if (currentDiscipline === 'maraton') {
        const active = activeEquipages.get(String(eq.startNumber)) || { data: data, task: { name: 'På banan', type: 'stage' }, startTime: 0, pausedMs: 0 };
        const d = active.data || data || {};
        const liveResult = calculateMarathonResult(eq, d, d);
        const totalPenalty = liveResult.totalPenalty;
        const task = active.task || { name: 'På banan' };

        let elapsedTime = '—';
        let currentState = task.name;
        let targetHtml = '';

        // --- Comparison View (Compact) ---
        let comparisonHtml = '';
        if (window.compareRiderId) {
            const cmpEq = allEquipages.find(e => String(e.startNumber) === String(window.compareRiderId));
            if (cmpEq) {
                const cmpData = maratonStatusMap.get(String(cmpEq.startNumber));
                const cmpRes = calculateMarathonResult(cmpEq, cmpData, cmpData);
                const diff = (liveResult.totalPenalty || 0) - (cmpRes?.totalPenalty || 0);
                const diffColor = diff < 0 ? 'text-green-600' : 'text-red-600';
                const diffSign = diff > 0 ? '+' : '';

                comparisonHtml = `
                <div class="mb-4 bg-gray-50 rounded-lg border border-gray-200 p-2 text-[10px] relative">
                    <button onclick="window.setComparisonRider('')" class="absolute top-1 right-2 text-gray-400 hover:text-red-500">×</button>
                    <div class="flex justify-around items-center">
                        <div class="text-center">
                            <span class="text-gray-500">${eq.driverName}:</span> 
                            <span class="font-bold">${(liveResult.totalPenalty || 0).toFixed(2)}</span>
                        </div>
                        <div class="px-2 py-0.5 rounded ${diffColor} font-black text-xs bg-white shadow-sm border border-gray-100">
                            ${diffSign}${Math.abs(diff).toFixed(2)}
                        </div>
                        <div class="text-center opacity-75">
                            <span class="text-gray-500">${cmpEq.driverName}:</span> 
                            <span class="font-bold">${(cmpRes?.totalPenalty || 0).toFixed(2)}</span>
                        </div>
                    </div>
                </div>`;
            }
        }

        // Live Timer calculation
        if (active && active.startTime > 1600000000000) {
            const ms = Math.max(0, (Date.now() - active.startTime) - active.pausedMs);
            elapsedTime = formatMsLive(ms);
        }

        // Target / Splits Logic
        let splitDiffHtml = '';
        if (task.type === 'obstacle') {
            const obsNum = task.key;
            currentState = `Hinder ${obsNum}`;
            const stats = calculateClassObstacleStats(eq.className, obsNum, maratonStatusMap, allEquipages);

            if (d.live_gateSplits && d.live_gateSplits.length > 0) {
                const myStart = d.liveObstacleStartEpoch || active.startTime;
                if (myStart) {
                    const bestSplits = calculateClassSplitStats(eq.className, obsNum, maratonStatusMap, allEquipages);
                    const rows = d.live_gateSplits.map(g => {
                        const ts = g.ts?.toMillis ? g.ts.toMillis() : (typeof g.ts === 'string' ? new Date(g.ts).getTime() : g.ts);
                        const myDiff = ts - myStart;
                        const best = bestSplits[g.char]?.best;
                        if (!best) return null;
                        const delta = myDiff - best;
                        const color = delta < 0 ? 'text-green-600' : 'text-red-600';
                        return `<div class="flex flex-col items-center bg-white p-1 rounded border border-gray-100 shadow-sm min-w-[40px]">
                            <div class="text-[8px] font-bold text-gray-400 uppercase">${g.char}</div>
                            <div class="font-mono font-bold text-[10px] ${color}">${delta > 0 ? '+' : ''}${(delta / 1000).toFixed(1)}s</div>
                        </div>`;
                    }).filter(Boolean).slice(-5);

                    if (rows.length > 0) {
                        splitDiffHtml = `<div class="flex gap-1 mt-1">${rows.join('')}</div>`;
                        if (last) currentState = `Hinder ${obsNum} (${last.char})`;
                    }
                }
            }

            const bestTimeHtml = (stats && Number.isFinite(stats.bestTime))
                ? `<div class="text-2xl font-black text-green-700 font-mono">${stats.bestTime.toFixed(2)}s</div>`
                : `<div class="text-sm font-bold text-gray-400">Inget ref.</div>`;

            targetHtml = `
            <div class="bg-green-50 p-5 rounded-lg border border-green-100 flex flex-col justify-center items-center h-full">
                <div class="text-[10px] uppercase font-bold text-green-800 mb-1">Mål att slå</div>
                ${bestTimeHtml}
                <div class="text-[8px] text-green-500 uppercase font-bold">${stats?.avg ? 'Snitt: ' + (stats.avg / getObstacleCoefficient(eq.className)).toFixed(2) + 's' : 'Första start'}</div>
            </div>`;
        }

        const prog = calculateProjectedPenalty(liveResult, eq.className, null, maratonStatusMap, allEquipages);
        const totalPenaltyDisplay = (totalPenalty === Infinity) ? 'ELIM' : (Number.isFinite(totalPenalty) ? totalPenalty.toFixed(2) : '—');

        const obsArr = liveResult.obstacles.items || [];
        const chips = obsArr.slice(-6).map(o => {
            const p = Number(o.penalty);
            const stats = calculateClassObstacleStats(eq.className, o.number, maratonStatusMap, allEquipages);
            let colorClass = 'bg-gray-100 text-gray-800';
            if (o.eliminated || p === Infinity) colorClass = 'bg-red-100 text-red-800';
            else if (Number.isFinite(p) && stats && Number.isFinite(stats.bestTime)) {
                if (p <= stats.bestTime + 0.01) colorClass = 'bg-green-100 text-green-800 font-bold border-green-200';
                else if (stats.avg && p < stats.avg) colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-200';
            }
            return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono border ${colorClass}">H${o.number}: ${Number.isFinite(p) ? p.toFixed(2) : '-'}</span>`;
        }).join('');

        contentHtml = `
        <div class="mt-4 pt-4 border-t border-gray-100">
            ${comparisonHtml}
            
            <div class="grid grid-cols-12 gap-4 items-stretch">
                <!-- Main Activity (Left) -->
                <div class="col-span-12 md:col-span-7 bg-amber-50 p-6 rounded-xl border border-amber-100 shadow-sm flex flex-col justify-center">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <div class="text-[10px] uppercase font-bold text-amber-800 opacity-60">Nuvarande Aktivitet</div>
                            <div class="text-xl font-black text-gray-900 leading-tight">${currentState === 'På banan' ? 'Kör sträcka' : currentState}</div>
                        </div>
                        <div class="text-right">
                            <div class="text-[10px] uppercase font-bold text-amber-800 opacity-60">Live Tid</div>
                            <div class="text-3xl font-mono font-black text-amber-600 tabular-nums leading-none mt-2" id="marathon-live-time">${elapsedTime}</div>
                        </div>
                    </div>
                    ${splitDiffHtml}
                </div>

                <!-- Secondary Stats (Right) -->
                <div class="col-span-12 md:col-span-5 flex flex-col gap-3">
                    ${targetHtml ? `<div class="flex-1">${targetHtml}</div>` : `
                    <div class="bg-gray-50 p-5 rounded-xl border border-gray-200 flex flex-col justify-center items-center flex-1">
                        <div class="text-[10px] uppercase font-bold text-gray-500 mb-1">Totalt i Maraton</div>
                        <div class="text-3xl font-black text-gray-900">${totalPenaltyDisplay}</div>
                    </div>`}

                    <!-- Prognosis Bubble -->
                    ${prog && Number.isFinite(prog.projectedTotal) && prog.basedOnStats ? `
                    <div class="bg-indigo-900 text-white p-4 rounded-xl shadow-lg flex items-center justify-between">
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
                    <div class="flex flex-wrap gap-2">${chips || '<span class="text-xs text-gray-300">Inga hinder klara ännu</span>'}</div>
                </div>

                <div class="md:col-span-6">
                    <div class="text-[10px] uppercase text-gray-400 font-bold mb-2">Topplista (${eq.className})</div>
                    <div class="bg-gray-50 rounded-lg p-3 border border-gray-100">
                        ${renderTop3List(eq.className, 'maraton')}
                    </div>
                </div>
            </div>
        </div>`;

    } else if (currentDiscipline === 'precision') {
        const d = data || {};
        let timeStr = '—';
        if (d.running && d.liveStartEpoch) {
            const ms = (d.livePausedMs || 0) + (Date.now() - d.liveStartEpoch);
            timeStr = formatMsLive(ms);
        } else if (d.liveTimeMs) {
            timeStr = formatMsLive(d.liveTimeMs);
        } else if (d.timeMs) {
            timeStr = formatMsLive(d.timeMs);
        }

        const timePen = d.liveTimePenalty || d.timePenalty || 0;
        const total = d.liveTotalPenalty || d.totalPenalty || 0;

        // --- Live Rank Logic (Phase 2) ---
        const liveStats = {
            sn: eq.startNumber,
            eq: eq,
            totalPenalty: total, // Approximate if live
            timeMs: d.liveTimeMs || (d.running ? (d.livePausedMs || 0) + (Date.now() - d.liveStartEpoch) : d.timeMs),
            timeLabel: timeStr
        };

        // Re-calculate live penalty for ranking accuracy
        if (d.running && d.liveStartEpoch) {
            const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
            const nowMs = (d.livePausedMs || 0) + (Date.now() - d.liveStartEpoch);
            const lp = calculatePrecisionTimePenalty(nowMs, maxSec);
            const op = d.liveObstaclePenalty || d.obstaclePenalty || 0;
            const ep = d.extraPenalty || 0;
            liveStats.totalPenalty = op + lp + ep;
            liveStats.timeMs = nowMs;
        }

        const ranking = getPrecisionRanking(allEquipages, precisionStatusMap, eq.className, liveStats);
        const myRankIndex = ranking.findIndex(r => String(r.sn) === String(eq.startNumber));
        const myRank = myRankIndex !== -1 ? myRankIndex + 1 : '-';

        // Gap to Leader
        let gapHtml = '';
        if (myRankIndex > 0) {
            const leader = ranking[0];
            const diff = (liveStats.totalPenalty || 0) - (leader.penalty || 0);
            gapHtml = `<div class="text-xs font-bold text-red-600 mt-1">+${diff.toFixed(2)} till ledaren</div>`;
        } else if (myRankIndex === 0) {
            gapHtml = `<div class="text-xs font-bold text-green-600 mt-1">Leder klassen!</div>`;
        }

        const top3 = ranking.slice(0, 3);
        const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
        const maxTimeLabel = maxSec ? msToLabel(maxSec * 1000) : '—';

        contentHtml = `
    <div class="mt-4 pt-4 border-t border-gray-100 grid grid-cols-12 gap-4">
            <div class="col-span-12">
                <div class="text-sm uppercase text-gray-500 font-bold mb-2">Häst(ar)</div>
                <div class="text-lg text-gray-800 leading-snug mb-4">${horseText}</div>
            </div>

            <!--Stats Column(Narrower)-->
            <div class="col-span-12 md:col-span-5 grid grid-cols-2 gap-2">
                <div class="bg-gray-50 p-2 rounded-lg text-center shadow-inner border border-gray-200 col-span-2 flex justify-between items-center px-4">
                    <div class="text-left">
                        <div class="text-[10px] uppercase tracking-wide text-gray-500 font-bold">Maxtid</div>
                        <div class="text-sm font-mono text-gray-600">${maxTimeLabel}</div>
                    </div>
                    <div class="text-right">
                         <div class="text-[10px] uppercase tracking-wide text-gray-500 font-bold">Tid</div>
                         <div id="precision-live-time" class="text-3xl font-mono font-black text-gray-900 tracking-tight leading-none">${timeStr}</div>
                    </div>
                </div>
                
                <div class="bg-blue-50 p-2 rounded-lg text-center shadow-sm border border-blue-100 col-span-2 relative overflow-hidden">
                    <div class="text-[10px] uppercase tracking-wide text-blue-800 font-bold">Totalt Straff</div>
                    <div id="precision-live-total" class="text-3xl font-black text-brand-darkblue leading-none py-1">${d.eliminated ? 'ELIM' : total.toFixed(2)}</div>
                    ${!d.eliminated ? `<div class="absolute top-1 right-1 bg-white/80 backdrop-blur px-2 py-0.5 rounded text-[10px] font-bold text-gray-600 shadow-sm border border-gray-200">Rank: ${myRank}</div>` : ''}
                    ${gapHtml}
                </div>

                <div class="bg-white p-2 rounded-lg text-center border border-gray-200 col-span-2">
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        <div>
                            <span class="block text-red-800 font-bold text-lg leading-none">${(d.liveObstaclePenalty || d.obstaclePenalty || 0).toFixed(0)}</span>
                            <span class="text-[10px] text-red-600 uppercase">Hinder</span>
                        </div>
                        <div>
                            <span id="precision-live-time-penalty" class="block text-amber-800 font-bold text-lg leading-none">${timePen.toFixed(2)}</span>
                            <span class="text-[10px] text-amber-600 uppercase">Tidsfel</span>
                        </div>
                    </div>
                </div>
            </div>

            <!--Top 3 Column(Wider)-->
    <div class="col-span-12 md:col-span-7 bg-white rounded border border-gray-200 overflow-hidden text-sm flex flex-col">
        <div class="bg-gray-100 px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wide border-b">
            Topp 3 (${eq.className})
        </div>
        <div class="divide-y divide-gray-100 flex-1 overflow-y-auto max-h-[200px]">
            ${top3.length ? top3.map((r, i) => `
                        <div onclick="showRiderDetails('${r.sn}')" class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 cursor-pointer hover:bg-yellow-100 transition-colors ${String(r.sn) === String(eq.startNumber) ? 'bg-yellow-50' : ''}">
                            <div class="flex items-center gap-3 overflow-hidden w-full sm:w-auto mb-1 sm:mb-0">
                                <span class="font-bold text-gray-400 w-6 text-center text-lg">${i + 1}.</span>
                                <div class="flex flex-col min-w-0">
                                    <span class="font-bold text-gray-800 leading-tight break-words text-base">${r.name}</span>
                                    <div class="flex items-center gap-1 text-xs text-gray-500 truncate">
                                         ${getClubLogoHtml(r.eq)} <span>${r.club}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center justify-end gap-3 w-full sm:w-auto shrink-0 ml-2">
                                <span class="font-black text-gray-900 text-xl">${r.penalty.toFixed(2)}</span>
                                <span class="text-xs text-gray-400 font-mono">(${r.time ? r.time.replace(',', '.') : '—'})</span>
                            </div>
                        </div>
                    `).join('') : '<div class="p-4 text-center text-gray-400 italic text-sm">Inga resultat</div>'}
        </div>
    </div>
        </div> `;
    }

    el.innerHTML = `<div class="p-4 md:p-6">${headerHtml + contentHtml}</div>`;
}

function renderLeaderToBeat(className) {
    const leader = currentDiscipline === 'precision'
        ? getChasingTarget(className, currentRider.data?.liveTotalPenalty || currentRider.data?.totalPenalty || 0)
        : getLeaderToBeat(className, currentDiscipline);

    if (!leader) return '';

    const label = currentDiscipline === 'dressyr' ? 'Att slå' : (leader.isLeader ? 'Ledarresultat' : 'Jagar');
    let val = currentDiscipline === 'dressyr' ? leader.score.toFixed(1) + '%' : leader.score.toFixed(2);

    if (currentDiscipline === 'precision' && leader.time) {
        val += ` <span class="text-xs font-normal">(${leader.time})</span>`;
    }

    let diffHtml = '';
    if (currentDiscipline === 'precision' && currentRider) {
        const currentPen = currentRider.data?.liveTotalPenalty || 0;
        const diff = currentPen - leader.score;
        if (diff > 0) {
            diffHtml = `<span class="ml-2 text-xs font-bold text-red-500">(+${diff.toFixed(2)})</span>`;
        } else if (diff < 0) {
            diffHtml = `<span class="ml-2 text-xs font-bold text-green-500">(${diff.toFixed(2)})</span>`;
        }
    }

    return `
    <div class="mt-2 text-sm text-gray-500 border-l-2 border-gray-300 pl-2">
        <div class="uppercase font-bold text-[10px] tracking-wider text-gray-400">${label}:</div>
        <div>
            <span class="font-mono font-bold text-lg text-gray-800">${val}</span> ${diffHtml}
        </div>
        <div class="text-xs text-gray-600 truncate max-w-[200px]">${leader.name}</div>
    </div>
    `;
}

function getChasingTarget(className, currentPenalty) {
    if (!className) return null;
    const finished = [];
    allEquipages.forEach(eq => {
        if (eq.className !== className) return;
        if (currentRider && eq.startNumber === currentRider.eq.startNumber) return;
        const st = precisionStatusMap.get(String(eq.startNumber));
        if (st && st.totalPenalty != null && st.finalized) {
            finished.push({
                score: st.totalPenalty || 0,
                name: eq.driverName,
                time: st.time || '',
                timeMs: st.timeMs || 0
            });
        }
    });

    finished.sort((a, b) => {
        if (Math.abs(a.score - b.score) > 0.01) return a.score - b.score;
        return a.timeMs - b.timeMs;
    });

    if (finished.length === 0) return null;

    const better = finished.filter(r => r.score <= currentPenalty);

    if (better.length === 0) {
        const l = finished[0];
        return { ...l, isLeader: true };
    }

    const target = better[better.length - 1];
    return { ...target, isLeader: target === finished[0] };
}

function renderUpcomingList() {
    const el = document.getElementById('upcoming-list-content');
    if (!el) return;

    const upcoming = allEquipages.filter(eq => {
        const sn = String(eq.startNumber);

        let state = 'not-started';
        let startTime = 0;

        if (currentDiscipline === 'dressyr') {
            const st = dressageStatusMap.get(sn) || {};
            state = st.state || eq.status || 'not-started';
            startTime = new Date(startTimes[sn]?.dressage || 0).getTime();
            if (currentRider && String(currentRider.eq.startNumber) === sn) return false;
        } else if (currentDiscipline === 'maraton') {
            const st = maratonStatusMap.get(sn) || {};
            startTime = startTimes[sn]?.maraton ? new Date('1970-01-01T' + startTimes[sn].maraton).getTime() : 0;
            if (st.times && Object.keys(st.times).length > 0) state = 'started';
            if (currentRider && String(currentRider.eq.startNumber) === sn) return false;
        } else if (currentDiscipline === 'precision') {
            const st = precisionStatusMap.get(sn) || {};
            startTime = startTimes[sn]?.precision ? new Date('1970-01-01T' + startTimes[sn].precision).getTime() : 0;
            if (st.inProgress || st.finalized || st.totalPenalty != null) state = 'started';
            if (currentRider && String(currentRider.eq.startNumber) === sn) return false;
        }

        const isFinished = String(state).toLowerCase() === 'finished' || state === 'started';
        return !isFinished && !isWithdrawnOrExcluded(state, { ...eq });
    }).sort((a, b) => {
        const tA = getStartTimeForSort(a.startNumber);
        const tB = getStartTimeForSort(b.startNumber);
        return tA - tB;
    }).slice(0, 10);

    if (upcoming.length === 0) {
        el.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm">Inga fler starter.</div>';
        return;
    }

    const listHtml = upcoming.map(eq => {
        const t = getStartTimeForDisplay(eq.startNumber);
        return `
    <div class="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-white border border-transparent hover:border-gray-200 transition-colors">
            <div class="min-w-0">
                <div class="font-bold text-gray-900 truncate">#${eq.startNumber} ${eq.driverName}</div>
                <div class="text-xs text-gray-500 truncate">${eq.clubName}</div>
            </div>
            <div class="text-right shrink-0">
                 <div class="font-mono font-bold text-brand-darkblue">${t}</div>
            </div>
        </div>
    `}).join('');

    el.innerHTML = `
        <div class="h-full overflow-y-auto pr-2 flex flex-col gap-1" style="max-height: 250px;">
            ${listHtml}
        </div>`;
}

function getStartTimeForSort(sn) {
    const s = String(sn);
    let val = '99:99';
    if (currentDiscipline === 'dressyr') val = startTimes[s]?.dressage || '99:99';
    else if (currentDiscipline === 'maraton') val = startTimes[s]?.maraton || '99:99';
    else if (currentDiscipline === 'precision') val = startTimes[s]?.precision || '99:99';
    return val;
}

function getStartTimeForDisplay(sn) {
    const s = String(sn);
    let val = null;
    if (currentDiscipline === 'dressyr') val = startTimes[s]?.dressage;
    else if (currentDiscipline === 'maraton') val = startTimes[s]?.maraton;
    else if (currentDiscipline === 'precision') val = startTimes[s]?.precision;
    if (!val) return '—';
    if (val.includes('T')) return formatTime(val);
    return val;
}

function renderResultList() {
    const el = document.getElementById('recent-results-list');
    if (!el) return;

    const list = [...recentResults].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (list.length === 0) {
        el.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm">Inga resultat ännu.</div>';
        return;
    }

    el.innerHTML = list.map(r => {
        // Find Equipage to get Class
        const eq = allEquipages.find(e => String(e.startNumber) === String(r.sn));
        const className = eq?.className;

        let gapHtml = '';
        if (className && Number.isFinite(r.finalPenalty)) {
            // Find leader score for this class (Global check)
            // leveraging global status maps (dressageStatusMap, precisionStatusMap)
            // This could be expensive if many riders, but usually < 100.
            let minP = Infinity;

            // Helper to check a specific map
            const checkMap = (map) => {
                for (const [sn, data] of map.entries()) {
                    const e2 = allEquipages.find(e => String(e.startNumber) === String(sn));
                    if (e2 && e2.className === className) {
                        // We need to parse result same way 'recentResults' does
                        // Or rely on 'data.finalPenalty' if stored? 
                        // Usually data has .results or we calc it.
                        // Simplification: Check 'recentResults' array first (if it contains all finished)
                        // But recentResults might be truncated.
                        // Best: Iterate allEquipages, check status map, calc score.
                        // To avoid heavy calc, let's assume if it is in recentResults it is valid.
                        // For now, let's scan 'recentResults' to find leader (assuming leader is in the list of finished/recent)
                        // If the leader is old, it might not be in "recent"? 
                        // Actually "recentResults" in this speaker implementation seems to accumulate ALL finished? 
                        // Let's check where it is cleared. If it stays during session, we are good.
                    }
                }
            };

            // Simpler approach: iterate recentResults (which contains all finished for this session usually)
            // or better: iterate allEquipages + statusMap

            const relevantMap = (currentDiscipline === 'dressyr') ? dressageStatusMap : precisionStatusMap;
            // Iterate all to find TRUE leader
            for (const [key, val] of relevantMap.entries()) {
                const tEq = allEquipages.find(e => String(e.startNumber) === String(key));
                if (tEq && tEq.className === className) {
                    // We need the score. 
                    // For Dressage: val.totalPenalty
                    // For Precision: val.totalPenalty (from calc)
                    // This depends on how data is stored.
                    // Let's try to trust 'recentResults' IF it contains all finished. 
                    // But if user reloads, recentResults is empty until populated? 
                    // No, listeners populate it.
                }
            }

            // Fallback: Just scan 'recentResults' for now. 
            // If the leader finished 2 hours ago and we just loaded, recentResults should have it if we fetch all.
            // If we only listen to changes, we might miss old ones. 
            // BUT: 'load()' usually fetches initial state. 
            // Let's iterate `list` (which is `recentResults` sorted).

            const classResults = recentResults.filter(rr => {
                const re = allEquipages.find(e => String(e.startNumber) === String(rr.sn));
                return re && re.className === className && Number.isFinite(rr.finalPenalty);
            });

            if (classResults.length > 0) {
                const best = Math.min(...classResults.map(cr => cr.finalPenalty));
                const diff = r.finalPenalty - best;
                if (diff > 0.001) {
                    gapHtml = `<span class="text-[10px] text-red-500 font-mono ml-2">(+${diff.toFixed(2)})</span>`;
                } else {
                    gapHtml = `<span class="text-[10px] text-green-600 font-bold ml-2">LEDER</span>`;
                }
            }
        }

        return `
        <div onclick="showRiderDetails('${r.sn}')" class="p-2 border-b last:border-0 hover:bg-gray-50 cursor-pointer transition-colors">
            <div class="flex justify-between items-baseline mb-1">
                <div class="flex items-center">
                     <span class="font-bold text-gray-900 mr-2">#${r.sn} ${r.name}</span>
                     ${gapHtml}
                </div>
                <span class="font-bold text-blue-600">${Number.isFinite(r.finalPenalty) ? r.finalPenalty.toFixed(2) : '-'} p</span>
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500">
                <span>${r.clubName}</span>
                <span>${Number.isFinite(r.finalPercent) && currentDiscipline === 'dressyr' ? r.finalPercent.toFixed(1) + '%' : ''}</span>
            </div>
        </div>
    `}).join('');
}

// ================= Logic =================

function findCurrentRider() {
    if (manualFocusId) {
        if (currentDiscipline === 'dressyr') {
            const data = dressageStatusMap.get(String(manualFocusId));
            const eq = allEquipages.find(e => String(e.startNumber) === String(manualFocusId));
            if (eq && data) {
                currentRider = { eq, statusData: data, liveData: liveProtocolMap.get(String(manualFocusId)) };
                return;
            }
        }
        else if (currentDiscipline === 'maraton') {
            const data = maratonStatusMap.get(String(manualFocusId));
            const eq = allEquipages.find(e => String(e.startNumber) === String(manualFocusId));
            if (eq && data) {
                const actives = getActiveMarathonRunners();
                const found = actives.find(a => String(a.eq.startNumber) === String(manualFocusId));
                if (found) currentRider = found;
                else currentRider = { eq, data, taskName: 'Vald (Ej aktiv?)' };
                return;
            }
        }
        else if (currentDiscipline === 'precision') {
            const data = precisionStatusMap.get(String(manualFocusId));
            const eq = allEquipages.find(e => String(e.startNumber) === String(manualFocusId));
            if (eq) {
                currentRider = { eq, data };
                return;
            }
        }
    }

    if (currentDiscipline === 'dressyr') findCurrentDressageRider();
    else if (currentDiscipline === 'maraton') findCurrentMarathonRider();
    else if (currentDiscipline === 'precision') findCurrentPrecisionRider();
}

function findCurrentDressageRider() {
    let latest = null;
    let latestTs = 0;
    for (const [sn, data] of dressageStatusMap.entries()) {
        if (data?.state === 'ongoing') {
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
    const actives = getActiveMarathonRunners();
    currentRider = actives.length > 0 ? actives[0] : null;
}

function maybePushRecentMarathon(sn, data) {
    // OLD: const finishedB = stageStopTS(data, 'B');
    // OLD: if (!finishedB) return;

    // NEW: Allow if Finished OR has Total Penalty (Started scoring)
    const finishedB = stageStopTS(data, 'B');
    const hasScore = (data.totalPenalty !== undefined && data.totalPenalty !== null);

    // Only show if they have actually done something (score or finish)
    if (!finishedB && !hasScore) return;

    const eq = allEquipages.find(e => String(e.startNumber) === sn);
    if (!eq) return;

    const existing = recentResults.find(r => String(r.sn) === String(sn));
    const penalty = data.totalPenalty || 0;

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

    // 1. Check Obstacle Activity
    if (data.currentObstacle && (data.liveObstacleStartAt || (data.liveObstacleTimeMs && data.liveObstacleTimeMs > 0))) {
        isActive = true;
        task = { type: 'obstacle', name: `Hinder ${data.currentObstacle}`, key: data.currentObstacle };

        const liveStart = data.liveObstacleStartAt?.toMillis?.();
        const updatedStart = data.updatedAt?.toMillis?.() || Date.now();
        startTime = liveStart || updatedStart;
        pausedMs = stageDurationMsSaved(data, 'obstacle') || 0;
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
                startTime = latestExit;
            }
        }

        // 3. Stages Check (A, B, Transport)
        if (!flashFound) {
            const stages = [{ key: 'A', name: 'Etapp A' }, { key: 'B', name: 'Etapp B' }, { key: 'transport', name: 'Transport' }];
            for (const stage of stages) {
                const start = stageStartTS(data, stage.key);
                const stop = stageStopTS(data, stage.key);
                if (start && !stop) {
                    isActive = true;
                    task = { type: 'stage', name: stage.name, key: stage.key };
                    startTime = start;
                    pausedMs = stageDurationMsSaved(data, stage.key) || 0;
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
                startTime = hasStopA;
            }
        }
    }

    if (isActive) {
        activeEquipages.set(String(sn), { sn, eq, data, task, startTime, pausedMs, updatedAt: Date.now() });
    } else {
        activeEquipages.delete(String(sn));
    }
}


/*
function evaluateActiveState_OLD(sn, data) {
    if (!data) return;
    const eq = allEquipages.find(e => String(e.startNumber) === sn);
    if (!eq) return;
 
    // --- NEW LOGIC: Broad "On Course" Detection ---
    // If they have started Phase A (or any start) and NOT finished Phase B (Goal)
    // they are technically "On Course".
 
    const hasStart = stageStartTS(data, 'A') || stageStartTS(data, 'D') || stageStartTS(data, 'E'); // A, D, E are common phase starts
    const hasFinish = stageStopTS(data, 'B') || stageStopTS(data, 'E'); // Goal is usually stopB or stopE
 
    // Check strict status (Eliminated/Retired)
    const stateStr = String(data.state || eq.status || '').toLowerCase();
    const isGone = ['utgått', 'utesluten', 'retired', 'eliminated'].some(s => stateStr.includes(s));
 
    if (!hasStart || hasFinish || isGone) {
        if (activeEquipages.has(String(sn))) {
            // Debug removed
        }
        activeEquipages.delete(String(sn));
        return;
    }
 
    // Determine precise task for label
    let task = null;
    let startTime = 0;
 
    // 1. Obstacle (Highest Priority)
    if (data.currentObstacle && data.liveObstacleStartAt) {
        const ts = data.liveObstacleStartAt.toMillis ? data.liveObstacleStartAt.toMillis() : data.liveObstacleStartAt;
        if (ts > 0) {
            task = { type: 'obstacle', name: `Hinder ${data.currentObstacle}`, key: data.currentObstacle };
            startTime = ts;
        }
    }
 
    // 2. Running Sections
    if (!task) {
        const checkSection = (sec, label) => {
            const s = stageStartTS(data, sec);
            const e = stageStopTS(data, sec);
            if (s && !e) {
                const dur = stageDurationMsSaved(data, sec);
                if (!dur) return { type: 'stage', name: label, key: sec, start: s };
            }
            return null;
        };
 
        const secB = checkSection('B', 'Sträcka B (Mål)');
        const secT = checkSection('transport', 'Transport'); // Verify key
        const secA = checkSection('A', 'Sträcka A');
 
        if (secB) { task = secB; startTime = secB.start; }
        else if (secT) { task = secT; startTime = secT.start; }
        else if (secA) { task = secA; startTime = secA.start; }
    }
 
    // 3. Fallback: "Between Phases" (e.g. Finished A, waiting for B)
    if (!task) {
        // Find last finished section to guess where they are
        if (stageStopTS(data, 'A') && !stageStartTS(data, 'B')) {
            // In Transport or Halt?
            task = { type: 'transport', name: 'Transport / Paus', key: 'wait_b' };
            startTime = stageStopTS(data, 'A'); // Count time since A finish
        } else {
            task = { type: 'unknown', name: 'På banan', key: 'unknown' };
            startTime = hasStart;
        }
    }
 
    activeEquipages.set(String(sn), {
        sn,
        eq,
        data,
        task,
        startTime,
        pausedMs: pausedMsSince(startTime),
        updatedAt: Date.now()
    });
}
*/

function ensureMaratonTicker() {
    if (maratonTickerInterval) return;
    maratonTickerInterval = setInterval(() => {
        if (currentDiscipline !== 'maraton') return;

        // Render Active List content (timers)
        // We only re-render the list HTML if items change, 
        // OR we update the DOM elements directly.
        // For smoother UI, we'll try to find DOM elements and update text.

        activeEquipages.forEach(active => {
            const ms = (Date.now() - active.startTime) - active.pausedMs; // Simplify live calc
            const val = (ms / 1000).toFixed(1) + 's';

            const el = document.getElementById(`maraton-timer-${active.sn}`);
            if (el) el.textContent = val;

            // Update Sector Analysis if active in A or Transport
            // This is slightly more complex because analyzeSectorProgress does its own logic
            // but we can approximate the diff here for the ticker or just let it re-render on snapshot.
            // Actually, let's just find the sector timer and update it.
            ['A', 'transport'].forEach(stg => {
                const sEl = document.getElementById(`sector-timer-${active.sn}-${stg}`);
                if (sEl) {
                    sEl.textContent = val;
                    // We'd need limits to update the diff live. 
                    // For now, updating the timer is a good start, the diff will sync on next snapshot.
                }
            });

            // Also update Main Card if this is the current rider
            if (currentRider && String(currentRider.eq?.startNumber) === active.sn) {
                const mainEl = document.getElementById('marathon-live-time-main');
                if (mainEl) mainEl.textContent = val;

                // Update LIVE Total Penalty
                // This is the "Total Straff" box.
                // We re-calculate the result to capture time penalties live
                const liveRes = calculateMarathonResult(active.eq, active.data || {}, active.data || {});
                if (liveRes && Number.isFinite(liveRes.totalPenalty)) {
                    // Check if we have elapsed time on section that MIGHT cause penalty?
                    // Usually calculateMarathonResult handles finished stages. 
                    // If we want "LIVE" penalty for section overrun, we need custom logic here or in calculateMarathonResult.
                    // But for now, let's at least update it if it changes (e.g. invalid gate passed).
                    const totalEl = document.getElementById('marathon-live-total-penalty');
                    // Make sure we have an element with this ID in renderCurrentRiderCard!
                    // I will update renderCurrentRiderCard to include this ID.
                }
            }
        });

    }, 100);
}

// ================= Modal =================

window.showRiderDetails = (sn) => {
    if (currentDiscipline === 'maraton') {
        const eq = allEquipages.find(e => String(e.startNumber) === String(sn));
        if (eq) {
            // Reuse the Shared Marathon Modal
            // We pass maratonStatusMap which contains the live data for all drivers.
            showMarathonDetailsModal(sn, allEquipages, maratonStatusMap);
            return;
        }
    }

    // For other disciplines or fallback:
    const eq = allEquipages.find(e => String(e.startNumber) === String(sn));
    if (!eq) return;

    let content = '';
    let title = `${eq.driverName} (${eq.className})`;

    if (currentDiscipline === 'dressyr') {
        const snKey = String(sn);

        // 1. Collect protocols (Mirror pattern in dressyr-monitor.js)
        let protocolsArr = [];
        const saved = savedProtocolsMap.get(snKey);
        if (saved) protocolsArr = Array.isArray(saved) ? [...saved] : [saved];

        // Merge Live (Map-of-Maps)
        const liveMap = liveProtocolMap.get(snKey);
        if (liveMap) {
            liveMap.forEach(liveProto => {
                const jid = liveProto.judgeId || liveProto.id;
                const pos = (liveProto.position || liveProto.judgePosition || '').toUpperCase();

                const idx = protocolsArr.findIndex(p =>
                    (p.judgeId && String(p.judgeId) === String(jid)) ||
                    (p.position && String(p.position).toUpperCase() === pos)
                );

                const normalizedLive = { ...liveProto, judgeId: jid || pos, position: pos };

                if (idx >= 0) protocolsArr[idx] = { ...protocolsArr[idx], ...normalizedLive };
                else protocolsArr.push(normalizedLive);
            });
        }

        // Filter and wrap in Map for modal
        console.log(`[SpeakerDebug] Opening Dressage Modal for #${snKey}`);
        console.log(`[SpeakerDebug] Protocols before filter:`, protocolsArr);
        console.log(`[SpeakerDebug] Valid Judges:`, allJudges);

        const cleanArr = deduplicateAndFilterProtocols(protocolsArr, allJudges);
        console.log(`[SpeakerDebug] Protocols after filter:`, cleanArr);

        const tempMap = new Map([[snKey, cleanArr]]);

        showDressageDetailsModal(sn, {
            statusMap: dressageStatusMap,
            savedProtocolsMap: tempMap,
            equipages: allEquipages,
            currentJudges: allJudges
        });
        return;
    } else if (currentDiscipline === 'precision') {
        showPrecisionDetailsModal(sn, allEquipages, precisionStatusMap, precisionConfig, startTimes);
        return;
    }

    // If we reach here for some reason (e.g. unknown discipline), show generic error
    console.warn("Unknown discipline for modal:", currentDiscipline);
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
    if (!data.finalized && !data.status === 'Klar') {
        if (data.totalPenalty == null) return;
    }

    const eq = allEquipages.find(e => String(e.startNumber) === sn);
    if (!eq) return;

    const entry = {
        sn: String(sn),
        name: eq.driverName,
        clubName: eq.clubName,
        finalPenalty: data.totalPenalty,
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

function maybePushRecent(sn) {
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

    const hasResult = (st.finalPenalty != null);

    if (!hasResult) {
        const idx = recentResults.findIndex(r => String(r.sn) === S);
        if (idx >= 0) { recentResults.splice(idx, 1); return true; }
        return false;
    }

    const entry = {
        sn: S,
        name: eq.driverName,
        clubName: eq.clubName,
        finalPercent: st.finalPercent,
        finalPenalty: st.finalPenalty,
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

function setupDressageListeners() {
    // 1. Status (Group)
    unsubscribes.push(listenForDressageStatusCollection(competitionId, (docs) => {
        docs.forEach(st => {
            const sn = String(st.id || st.startNumber);
            // Speaker needs merging logic if verifyDressageResult updates keys, 
            // but normally status has finalPenalty.
            const cur = dressageStatusMap.get(sn) || {};
            // If just finished, verify result
            if (st.state === 'finished' && st.finalPenalty != null && cur.state !== 'finished') {
                const eq = allEquipages.find(e => String(e.startNumber) === sn);
                if (eq) verifyDressageResult(sn, st, eq);
            }
            dressageStatusMap.set(sn, { ...cur, ...st });
            maybePushRecent(sn);
        });
        triggerRender();
    }));

    // 2. Live (Group)
    unsubscribes.push(listenForDressageLiveGroup(competitionId, allEquipages, (docs) => {
        docs.forEach(st => {
            const sn = String(st.startNumber);
            const known = dressageStatusMap.get(sn);
            if (known?.state === 'finished') return;

            let proto = st;
            // Robust unwrapping (same as Monitor)
            if (st.protocol && typeof st.protocol === 'object') {
                proto = { ...st, ...st.protocol };
            }

            const rawJid = proto?.judgeId || proto?.judgeUid || proto?.judge || null;
            const jid = normJudgeId(rawJid);

            if (proto && jid) {
                proto = { ...proto, judgeId: jid };

                // Ensure Map-of-Maps structure
                if (!liveProtocolMap.has(sn)) liveProtocolMap.set(sn, new Map());

                // MERGE with existing
                const existing = liveProtocolMap.get(sn).get(jid) || {};
                let merged = { ...existing, ...proto };

                // Säkerställ att domar-position finns (C/E/B/M/H) så att UI kan aggregera korrekt
                if (!merged.position && !merged.judgePosition) {
                    const jObj = (allJudges || []).find(j => {
                        const jId = normJudgeId(j?.id || j?.uid || j?.judgeId || j?.judgeUid);
                        return jId && jId === jid;
                    }) || (allJudges || []).find(j =>
                        String(j?.position || '').toUpperCase() === String(proto?.position || proto?.judgePosition || '').toUpperCase()
                    );
                    if (jObj?.position) merged.position = String(jObj.position).toUpperCase();
                }
                if (!merged.position && merged.judgePosition) merged.position = String(merged.judgePosition).toUpperCase();
                if (!merged.judgePosition && merged.position) merged.judgePosition = merged.position;

                liveProtocolMap.get(sn).set(jid, merged);


                // Legacy cache updates (optional but good for other parts using findCurrentDressageRider logic if any)
                // We will rely on liveProtocolMap in renderCurrentRiderCard mostly.
            }

            // Merge into status map for "ongoing" state
            const cur = dressageStatusMap.get(sn) || {};
            dressageStatusMap.set(sn, {
                ...cur, ...st,
                state: st?.state || cur.state || 'ongoing',
                updatedAt: st?.updatedAt || cur.updatedAt
            });
        });
        triggerRender();
    }));

    // 3. Protocols (Group) - ROBUST CALCULATION
    // We listen to actual protocols and re-calculate scores to avoid "ghost" data (0.00) in status docs.
    unsubscribes.push(listenForDressageProtocolsCollectionGroup(competitionId, allEquipages, (docs) => {
        const grouped = new Map();
        docs.forEach(d => {
            const sn = String(d.startNumber);
            if (!grouped.has(sn)) grouped.set(sn, []);
            grouped.get(sn).push(d);
        });

        grouped.forEach((protocols, sn) => {
            savedProtocolsMap.set(sn, protocols); // Save for modal usage
            const eq = allEquipages.find(e => String(e.startNumber) === sn);
            if (!eq) return;

            // 1. Filter ghosts
            const cleanProtocols = deduplicateAndFilterProtocols(protocols, allJudges);

            // 2. Calculate
            const programKey = eq.testKey || (window.klassProgramMapping?.[eq.className] ?? null);
            const programObj = programKey ? mergedPrograms[programKey] : null;

            if (programObj && cleanProtocols.length > 0) {
                const final = computeFinalFromSaved(eq, cleanProtocols, programObj);
                if (final) {
                    const cur = dressageStatusMap.get(sn) || {};
                    // Override status values with robust calculation
                    dressageStatusMap.set(sn, {
                        ...cur,
                        finalPercent: final.percent,
                        finalPoints: final.points,
                        finalPenalty: final.penalty,
                        _calculated: true
                    });
                    maybePushRecent(sn);
                }
            }
        });
        triggerRender();
    }));

    // 4. Listen for Start Times (Real-time)
    unsubscribes.push(listenForConfig(competitionId, 'startTimes', (data) => {
        startTimes = (data?.times) || (data?.value?.times) || {};
        triggerRender();
    }));
}


function setupMarathonListeners() {
    // 1. Listen for Driver Status
    const maratonRef = collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'maraton');
    const unsub = onSnapshot(maratonRef, (snapshot) => {
        snapshot.docChanges().forEach(change => {
            const sn = change.doc.id;
            const data = change.doc.data();
            if (change.type === 'removed') {
                maratonStatusMap.delete(sn);
            } else {
                maratonStatusMap.set(sn, data);
                evaluateActiveState(sn, data);
            }
            maybePushRecentMarathon(sn, data);
        });
        triggerRender();
        ensureMaratonTicker();
    });
    unsubscribes.push(unsub);

    // 2. Listen for Marathon Config (Real-time)
    unsubscribes.push(listenForConfig(competitionId, 'maratonConfig', (cfg) => {
        setMarathonConfig(cfg);
        triggerRender();
    }));

    // 3. Listen for Start Times (Real-time)
    unsubscribes.push(listenForConfig(competitionId, 'startTimes', (data) => {
        startTimes = (data?.times) || (data?.value?.times) || {};
        triggerRender();
    }));
}

function setupPrecisionListeners() {
    // 1. Listen for Driver Status
    const precisionRef = collection(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'precision');
    const unsub = onSnapshot(precisionRef, (snapshot) => {
        snapshot.docChanges().forEach(change => {
            const sn = change.doc.id;
            const data = change.doc.data();
            if (change.type === 'removed') {
                precisionStatusMap.delete(sn);
            } else {
                precisionStatusMap.set(sn, data);
            }
            maybePushRecentPrecision(sn, data);
        });
        triggerRender();
    });
    unsubscribes.push(unsub);

    // 2. Listen for Precision Config (Real-time)
    unsubscribes.push(listenForConfig(competitionId, 'precisionConfig', (cfg) => {
        precisionConfig = cfg || {};
        triggerRender();
    }));

    // 3. Listen for Start Times (Real-time)
    unsubscribes.push(listenForConfig(competitionId, 'startTimes', (data) => {
        startTimes = (data?.times) || (data?.value?.times) || {};
        triggerRender();
    }));
}

function setupAllListeners() {
    unsubscribes.forEach(u => u());
    unsubscribes = [];

    // Listen for Judges (Global)
    unsubscribes.push(listenForJudges(competitionId, (judges) => {
        allJudges = (judges || []).map(j => ({
            ...j,
            id: j.id,
            name: j.name || j.fullName || j.id,
            position: (expandDressagePosition(j) || j.position || '').toUpperCase()
        }));
        triggerRender();
    }));

    if (currentDiscipline === 'dressyr') {
        setupDressageListeners();
    } else if (currentDiscipline === 'maraton') {
        setupMarathonListeners();
    } else if (currentDiscipline === 'precision') {
        setupPrecisionListeners();
    }
}

export async function load() {
    const comp = getGlobalState('currentCompetition');
    competitionId = comp?.id;

    if (!competitionId) {
        const root = document.getElementById('page-speaker');
        if (root) root.innerHTML = '<p class="p-8 text-center">Ingen tävling vald.</p>';
        return;
    }

    // Safety: Clear any existing intervals (if unload didn't catch them or dirty reload)
    if (maratonTickerInterval) clearInterval(maratonTickerInterval);
    maratonTickerInterval = null;
    if (window.marathonLiveInterval) clearInterval(window.marathonLiveInterval);
    window.marathonLiveInterval = null;

    renderLayout();
    attachSwitcherEvents();
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
            new Promise(res => listenForJudges(competitionId, res)),
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

        allEquipages = (equipagesRaw || []).filter(e => e && e.startNumber != null).map(e => ({
            ...e,
            startNumber: Number(e.startNumber)
        }));
        startTimes = (startTimesData?.times) || (startTimesData?.value?.times) || {};

        setupAllListeners();

        // --- Verification Step ---
        // Removed aggressive verifyAllStartups() to prevent network overload/quota issues.
        // We will rely on new finishes triggering verification.

        triggerRender();

        // Start live clock ticker
        if (!window.marathonLiveInterval) {
            window.marathonLiveInterval = setInterval(updateLiveClocks, 1000);
        }

    } catch (err) {
        console.error('Kunde inte ladda speaker-sidan:', err);
        const root = document.getElementById('page-speaker');
        if (root) root.innerHTML = '<p class="p-8 text-center text-red-500">Fel vid laddning av data.</p>';
    }
}

function renderActiveListNew() {
    const container = document.getElementById('active-list-container');
    // Consolidate: Try active-list-content, fallback to active-list (dressage/default ID)
    const el = document.getElementById('active-list-content') || document.getElementById('active-list');

    // 1. If not Marathon, hide and exit
    if (currentDiscipline !== 'maraton') {
        if (container) container.classList.add('hidden');
        const upcoming = document.getElementById('upcoming-list-container');
        if (upcoming) {
            upcoming.style.height = '50%';
            upcoming.classList.remove('h-1/4');
        }
        return;
    }

    // 2. Safety Check
    if (!container || !el) {
        console.warn("renderActiveListNew: Missing container/element", { container, el });
        return;
    }

    // 3. Force Visibility for Marathon
    container.classList.remove('hidden');
    container.style.display = 'flex';
    container.classList.add('flex-1');
    container.style.height = 'auto'; // allow growth
    container.style.minHeight = '300px';

    // 4. Adjust Upcoming List
    const upcoming = document.getElementById('upcoming-list-container');
    if (upcoming) {
        upcoming.style.height = '15%';
        upcoming.classList.remove('h-1/3', 'h-1/4', 'hidden');
    }

    // 5. Source Data
    const sourceArr = activeEquipages.size > 0 ? Array.from(activeEquipages.values()) : [];

    // Separate Lists
    const hotList = [];
    const onCourseList = [];

    sourceArr.forEach(c => {
        if (c.task && c.task.type === 'obstacle') hotList.push(c);
        else onCourseList.push(c);
    });

    console.log(`LiveUpdate: ${sourceArr.length} active. Hot: ${hotList.length}, Course: ${onCourseList.length}`);

    if (hotList.length === 0 && onCourseList.length === 0) {
        el.innerHTML = '<div class="text-xs text-gray-500 text-center p-8 bg-gray-50 rounded italic">Inga aktiva på banan (Väntar på start). <br>Klicka ⚡ för test.</div>';
        return;
    }

    let html = '';

    // --- HOT ZONE (Hinder) ---
    if (hotList.length > 0) {
        html += `<div class="mb-2 space-y-2">`;
        html += hotList.map(c => {
            const isSelected = (manualFocusId && String(manualFocusId) === String(c.sn));
            const obsNum = c.task.key;
            const stats = calculateClassObstacleStats(c.eq.className, obsNum, maratonStatusMap, allEquipages);

            let statsHtml = '';
            if (stats && stats.bestTime) {
                statsHtml = `
                 <div class="flex items-center gap-2 mt-1 bg-white/50 p-1 rounded">
                    <span class="text-[10px] text-gray-500 uppercase font-bold">Mål att slå:</span>
                    <span class="font-mono font-bold text-green-700">${stats.bestTime.toFixed(2)}s</span>
                 </div>`;
            }

            // Check Splits
            let splitText = '';
            if (c.data.live_gateSplits && c.data.live_gateSplits.length > 0) {
                const classStats = calculateClassSplitStats(c.eq.className, obsNum, maratonStatusMap, allEquipages);

                // Show last 3 splits
                const recentSplits = c.data.live_gateSplits.slice(-3);

                splitText = recentSplits.map(s => {
                    let colorClass = 'text-gray-500';
                    let title = '';

                    if (s.char && classStats[s.char]) {
                        const stat = classStats[s.char];
                        // Calc elapsed for this split relative to start? 
                        // No, we need to compare apples to apples.
                        // calculateClassSplitStats compares ABSOLUTE time from obstacle start.
                        // We need the same here.
                        let obsStart = c.data.liveObstacleStartAt || c.data.live_staticStartAt;
                        if (obsStart && obsStart.toMillis) obsStart = obsStart.toMillis();
                        else if (typeof obsStart === 'string') obsStart = new Date(obsStart).getTime();
                        // Fallback to enteredAt
                        if (!obsStart && c.data.obstacleTimes && c.data.obstacleTimes[obsNum]) {
                            const ot = c.data.obstacleTimes[obsNum];
                            obsStart = ot.enteredAt || ot.enteredAtClient;
                            if (typeof obsStart === 'string') obsStart = new Date(obsStart).getTime();
                        }

                        let splitTs = s.ts;
                        if (splitTs && splitTs.toMillis) splitTs = splitTs.toMillis();
                        else if (typeof splitTs === 'string') splitTs = new Date(splitTs).getTime();

                        if (obsStart && splitTs) {
                            const diff = splitTs - obsStart;
                            if (diff <= stat.best + 100) {
                                colorClass = 'text-green-600 font-bold bg-green-50 px-1 rounded';
                                title = `Bäst! (${(stat.best / 1000).toFixed(1)}s)`;
                            } else if (diff < stat.avg) {
                                colorClass = 'text-blue-600 font-semibold';
                                title = `Bättre än snitt (${(stat.avg / 1000).toFixed(1)}s)`;
                            } else {
                                colorClass = 'text-amber-600';
                                title = `Sämre än snitt (${(stat.avg / 1000).toFixed(1)}s)`;
                            }
                        }
                    }

                    return `<span class="text-[10px] font-mono ml-1 ${colorClass}" title="${title}">(${s.char}: ${Number.isFinite(s.time) ? s.time.toFixed(1) : '-'})</span>`;
                }).join('');
            }

            // Calculate live time Safely
            let timeTxt = '00:00,00';
            if (c.startTime > 1600000000000) {
                const ms = Math.max(0, (Date.now() - c.startTime) - c.pausedMs);
                timeTxt = formatMsLive(ms);
            }

            return `
            <div onclick="selectSpeakerRider(${c.sn})" class="cursor-pointer bg-amber-50 border-l-4 border-amber-500 p-3 rounded shadow-sm hover:shadow-md transition-all ${isSelected ? 'ring-2 ring-amber-400' : ''}">
                <div class="flex justify-between items-start">
                    <div>
                        <div class="font-black text-lg text-gray-900 leading-none">#${c.sn} ${c.eq.driverName}</div>
                        <div class="text-xs text-amber-800 font-bold mt-1 uppercase tracking-wide">Hinder ${obsNum} ${splitText}</div>
                    </div>
                    <div class="text-3xl font-mono font-black text-gray-800 tracking-tight" id="maraton-timer-${c.sn}">${timeTxt}</div>
                </div>
                ${statsHtml}
            </div>`;
        }).join('');
        html += `</div>`;
    }

    // --- ON COURSE (Sections) ---
    if (onCourseList.length > 0) {
        if (hotList.length > 0) {
            html += `<div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 mt-3 px-1">Övriga på banan</div>`;
        }

        html += `<div class="space-y-1">`;
        html += onCourseList.map(c => {
            const isSelected = (manualFocusId && String(manualFocusId) === String(c.sn));
            let timeTxt = '--:--';
            let limitsHtml = '';

            if (c.startTime > 1600000000000) {
                const ms = Math.max(0, (Date.now() - c.startTime) - c.pausedMs);
                timeTxt = formatMsLive(ms);

                // Limits Check (Ideal Time)
                if (c.task && (c.task.key === 'A' || c.task.key === 'B')) {
                    const limits = limitsFor(c.eq, c.task.key);
                    if (limits && limits.max) {
                        // max is "Allowed Time" (Ideal)
                        const allowedMs = limits.max * 1000;
                        const allowedTxt = formatMsLive(allowedMs);

                        // Determine Status
                        let color = 'text-gray-400';
                        if (ms > allowedMs) color = 'text-red-600 font-bold'; // Over time
                        else if (limits.min && ms < (limits.min * 1000) && ms > (allowedMs * 0.8)) color = 'text-yellow-600'; // Approaching min? Or just generic
                        // Simple logic: Close to max?
                        const remaining = allowedMs - ms;
                        if (remaining < 60000 && remaining > 0) color = 'text-amber-600'; // Last minute

                        limitsHtml = `<span class="text-[10px] ${color} ml-1">/ ${allowedTxt}</span>`;
                    }
                }
            }

            return `
             <div onclick="selectSpeakerRider(${c.sn})" class="flex items-center justify-between p-2 bg-white rounded border border-gray-200 hover:border-blue-300 cursor-pointer ${isSelected ? 'bg-blue-50 border-blue-300' : ''}">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="font-bold text-gray-700 text-xs w-8">#${c.sn}</span>
                    <span class="text-sm font-semibold text-gray-900 truncate">${c.eq.driverName}</span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">${c.task.name}</span>
                    <div class="text-right">
                         <span class="text-xs font-mono font-bold text-gray-800" id="maraton-timer-${c.sn}">${timeTxt}</span>
                         ${limitsHtml}
                    </div>
                </div>
             </div>`;
        }).join('');
        html += `</div>`;
    }

    el.innerHTML = html;
}

/**
 * renderSectorAnalysis()
 * - Shows a table of all drivers currently or recently in road sections (A/Transport).
 * - Displays deviations from ideal time.
 */
function renderSectorAnalysis() {
    const el = document.getElementById('sector-analysis-content');
    const container = document.getElementById('sector-analysis-container');
    if (!el || !container) return;

    if (currentDiscipline !== 'maraton') {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    // Gather runners in A or T (or finished A/T recently)
    const sectors = ['A', 'transport', 'B'];
    const entries = [];

    allEquipages.forEach(eq => {
        const sn = String(eq.startNumber);
        const data = maratonStatusMap.get(sn);
        if (!data) return;

        sectors.forEach(s => {
            const analysis = analyzeSectorProgress(data, s, eq);
            if (analysis) {
                // Only show if live OR finished < 5 mins ago
                const stop = stageStopTS(data, s);
                if (!stop || (Date.now() - stop < 300000)) {
                    entries.push({ sn, eq, analysis, data });
                }
            }
        });
    });

    if (entries.length === 0) {
        // Detailed Debug Logic for user feedback
        const reasons = [];
        let activeCount = 0;
        let limitFailures = 0;

        if (!maraton_marathonConfig) {
            reasons.push("DEBUG: Saknar maraton-konfiguration (marathonConfig).");
        } else if (maratonStatusMap.size === 0) {
            reasons.push("DEBUG: Inga status-data laddade (maratonStatusMap empty).");
        } else {
            // Check specific active drivers to see why they failed
            allEquipages.forEach(eq => {
                const sn = String(eq.startNumber);
                const data = maratonStatusMap.get(sn);
                if (!data) return;
                // Check A/B/Transport
                ['A', 'transport', 'B'].forEach(s => {
                    const start = stageStartTS(data, s);
                    const stop = stageStopTS(data, s);
                    // If started but not finished (or finished recently), they SHOULD appear
                    if (start && (!stop || (Date.now() - stop < 300000))) {
                        activeCount++;
                        const lim = limitsFor(eq, s);
                        if (!lim) {
                            limitFailures++;
                            const cls = eq.className;
                            const cfg = maraton_marathonConfig?.marathonClassData || maraton_marathonConfig?.maratonClassData || {};

                            // Try to find the settings like getClassSettings does
                            const keys = Object.keys(cfg);
                            const match = keys.find(k => cls.trim().toLowerCase().startsWith(k.trim().toLowerCase()));

                            if (!match) {
                                if (limitFailures <= 1) console.warn(`[DEBUG] No config match for class "${cls}". Available keys:`, keys);
                                reasons.push(`DEBUG: Klass "${cls}" matchar inte någon nyckel i konfig. (Finns: ${keys.slice(0, 3).join(', ')}...)`);
                            } else {
                                // We have a match, so it must be missing distance
                                const cData = cfg[match];
                                // Check distance for this stage
                                const flatDist = cData[`distance${s}`] || cData[`distance${s.toUpperCase()}`];
                                const nestDist = cData[s] ? cData[s].distance : undefined;
                                const nestDistUpper = cData[s.toUpperCase()] ? cData[s.toUpperCase()].distance : undefined;

                                const hasDist = (flatDist > 0 || nestDist > 0 || nestDistUpper > 0);

                                if (!hasDist) {
                                    reasons.push(`DEBUG: Klass "${cls}" (matchar "${match}") saknar DISTANS för ${s}. Gå till Inställningar.`);
                                } else {
                                    reasons.push(`DEBUG: Okänt fel på gränsvärden för "${cls}" (${s}).`);
                                }
                            }
                        }
                    }
                });
            });

            if (activeCount > 0 && limitFailures > 0) {
                reasons.push(`DEBUG: ${activeCount} aktiva, men ${limitFailures} saknar gränsvärden. <br>`);
            } else if (activeCount === 0) {
                // Technically correct empty state
            }
        }

        const msg = (reasons.length > 0)
            ? `<span class="text-red-500 font-bold text-left block text-xs overflow-x-auto whitespace-pre-wrap">${reasons.join('<br>')}</span>`
            : "Inga ekipage på vägsträckor just nu.";

        el.innerHTML = `<div class="p-4 text-center text-gray-400 italic text-xs flex justify-center">${msg}</div>`;
        return;
    }

    // Sort by: Live first, then deviation magnitude
    entries.sort((a, b) => {
        if (a.analysis.isLive && !b.analysis.isLive) return -1;
        if (!a.analysis.isLive && b.analysis.isLive) return 1;
        return Math.abs(b.analysis.diff) - Math.abs(a.analysis.diff);
    });

    el.innerHTML = `
    <div class="overflow-x-auto">
        <table class="w-full text-xs text-left text-gray-600">
            <thead class="text-[10px] text-gray-500 uppercase bg-gray-50 border-b">
                <tr>
                    <th class="px-3 py-2"># Ekipage</th>
                    <th class="px-3 py-2">Etapp</th>
                    <th class="px-3 py-2 text-right">Ideal</th>
                    <th class="px-3 py-2 text-right">Live / Result</th>
                    <th class="px-3 py-2 text-right">Diff</th>
                </tr>
            </thead>
            <tbody>
                ${entries.map(e => {
        const a = e.analysis;
        const diffSign = a.diff > 0 ? '+' : '';
        const livePulse = a.isLive ? 'animate-pulse' : '';
        const stageLabel = a.stage === 'transport' ? 'Transport' : `Etapp ${a.stage}`;

        const absDiff = Math.abs(a.diff);
        const m = Math.floor(absDiff / 60);
        const s = (absDiff % 60).toFixed(1);
        const diffText = m > 0
            ? `${diffSign}${m}:${s.padStart(4, '0')}` // +1:15.5
            : `${diffSign}${s}s`; // +15.5s

        const stageKey = (String(a.stage || '').toUpperCase() === 'T') ? 'transport' : a.stage;
        const realStart = stageStartTS(e.data, stageKey); // Fetch real start time using e.data and normalized key

        // If live, we add special class and data-attributes for the clock updater
        // If live, we add special class and data-attributes for the clock updater
        const liveAttrs = a.isLive
            ? `class="sector-live-timer font-bold font-mono px-3 py-2 text-right ${a.color} ${livePulse}" data-sn="${e.sn}" data-stage="${stageKey}" data-start="${realStart}" data-ideal="${a.ideal}"`
            : `class="font-bold font-mono px-3 py-2 text-right ${a.color}"`;

        return `
                    <tr class="bg-white border-b hover:bg-gray-50 cursor-pointer" onclick="window.selectSpeakerRider('${e.sn}')">
                        <td class="px-3 py-2">
                             <div class="font-bold text-gray-900 leading-tight">#${e.sn} ${e.eq.driverName}</div>
                             <div class="text-[10px] text-gray-400 capitalize">${e.eq.clubName}</div>
                        </td>
                        <td class="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">${stageLabel}</td>
                        <td class="px-3 py-2 text-right font-mono">${msToLabel(a.ideal * 1000, false)}</td>
                        <td ${e.analysis.isLive ? `class="sector-live-elapsed px-3 py-2 text-right font-mono text-gray-900 font-bold" data-sn="${e.sn}" data-stage="${stageKey}" data-start="${realStart}"` : 'class="px-3 py-2 text-right font-mono text-gray-400"'}>${formatMsLive(a.ms)}</td>
                        <td ${liveAttrs}>
                             ${diffText}
                        </td>
                    </tr>`;
    }).join('')}
            </tbody>
        </table>
    </div>`;
}

export function __unload() {
    if (maratonTickerInterval) clearInterval(maratonTickerInterval);
    maratonTickerInterval = null;

    if (window.marathonLiveInterval) clearInterval(window.marathonLiveInterval);
    window.marathonLiveInterval = null;

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
