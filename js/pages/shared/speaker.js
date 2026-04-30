// js/pages/speaker.js
// En specialanpassad vy för speaker med fokus på talarstöd (noteringar, kommande, resultat).

import { getGlobalState } from '../../main.js';
import { openDetails as showDressageDetailsModal } from '../../ui/dressageModal.js';
import { showDetailsModal as showPrecisionDetailsModal } from '../../ui/precisionModal.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { listenForJudges } from '../../services/adminService.js';
import { getJudges } from '../../services/adminService.js';
import { updateEquipage } from '../../services/equipageService.js';
import { listenForConfig } from '../../services/competitionService.js';
import { listenForDressageLiveGroup, listenForDressageStatusCollection, getDressageResultsForEquipage } from '../../services/dressageService.js';
import { listenForDressageProtocolsCollectionGroup } from '../../services/dressageService.js';
import {
    getPrograms,
    getDressagePenaltyCoeff,
    normalizeMovements,
    deduplicateAndFilterProtocols,
    guessProgramKeyFromClass,
    normJudgeId
} from '../../utils/dressageUtils.js';
import { calculateDressageResult, calculateSingleJudgeDressageResult, calculateTotalResult } from '../../services/calculationService.js';
import { openEquipageModal } from '../../ui/equipage-modal.js';

import { getCompetitionHeader } from '../../ui/components.js';
import { onSnapshot, doc, collection } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, appId } from '../../config/firebase-config.js';
import { ensureClubLogosLoaded, getClubLogoHtml } from '../../services/logosService.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { msToLabel, computeTotalPenalty } from '../../utils/sharedUtils.js';
import { dressagePrograms as globalDressagePrograms } from '../../data/dressagePrograms.js';

import {
    getObstacleArray,
    obstacleValues,
    stagePenaltyFromMs,
    stageDurationMsSaved,
    pausedMsBetween,
    stageStartTS,
    stageStopTS,
    formatMsLive,
    pausedMsSince,
    setPauseWindows,
    setMarathonConfig,
    limitsFor,
    calculateMarathonResult,
    getObstacleCoefficient,
    calculateClassObstacleStats,
    calculateProjectedPenalty,
    calculateClassSplitStats,
    analyzeSectorProgress,
    maraton_marathonConfig,
    buildMergeMap,
    ensureMergeDecorations
} from '../../utils/marathonUtils.js';

import { showDetailsModal as showMarathonDetailsModal } from '../../ui/marathonModal.js';

import {
    computeMaxSecondsForClass,
    calculatePrecisionTimePenalty,
    getPrecisionRanking,
    getCalculatedRowData
} from '../../utils/precisionUtils.js';

import { startMarathonSimulation } from '../../utils/simulator.js';

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

let lastFullRenderTime = 0;
let lastActiveRiderId = null;
let lastActiveDiscipline = null;

function ensureMainTicker() {
    if (window.marathonLiveInterval) return;
    window.marathonLiveInterval = setInterval(() => {
        updateLiveClocks();
    }, 100);
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
            const liveInfo = calculateLiveInjection(eq); // Include live prognosis if this is the active rider
            const resultRows = getTotalRanking(cls, liveInfo);
            
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

// ---- Speaker helpers: normalize state/result across sources ----
function normState(v) {
    return String(v || '').toLowerCase().trim();
}

function getDressageFinalPenalty(sn) {
    const S = String(sn || '');
    if (!S) return null;
    const st = dressageStatusMap.get(S) || {};

    // Accept multiple field names (speaker should be robust)
    const candidates = [
        st.finalPenalty,
        st.penalty,
        st.totalPenalty,
        st.total,
        st.resultPenalty
    ];

    for (const v of candidates) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function getDressageFinalPercent(sn) {
    const S = String(sn || '');
    if (!S) return null;
    const st = dressageStatusMap.get(S) || {};

    const candidates = [
        st.finalPercent,
        st.percent,
        st.totalPercent
    ];

    for (const v of candidates) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function normDressageState(st = {}, eq = {}) {
    // Prefer explicit status object, otherwise fall back to equipage status fields
    const s = normState(st.state || st.status || eq.status || eq.dressageStatus || eq.eqStatus);

    // Common synonyms / legacy values
    if (['finished', 'done', 'complete', 'completed', 'slut', 'klar'].includes(s)) return 'finished';
    if (['active', 'in-progress', 'inprogress', 'started', 'pågår', 'paga'].includes(s)) return 'active';
    if (['not-started', 'notstarted', 'ready', 'upcoming', 'väntar', 'vantar'].includes(s)) return 'not-started';

    // If we already have a final result, treat as finished even if state is missing
    const pen = getDressageFinalPenalty(String(eq.startNumber ?? st.startNumber ?? st.id ?? ''));
    if (pen != null) return 'finished';

    return s || 'not-started';
}

let renderTimeout = null;
function triggerRender(force = false) {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        findCurrentRider();
        
        const now = Date.now();
        const riderChanged = currentRider?.eq?.id !== lastActiveRiderId;
        const disciplineChanged = currentDiscipline !== lastActiveDiscipline;

        // Only do a FULL render if forced, or state changed, or it's been a while (2s)
        if (force || riderChanged || disciplineChanged || (now - lastFullRenderTime > 2000)) {
            renderSpeakerDashboard();
            lastFullRenderTime = now;
            lastActiveRiderId = currentRider?.eq?.id;
            lastActiveDiscipline = currentDiscipline;
        } else {
            // Otherwise JUST update the live clocks/timers (which use textContent)
            updateLiveClocks();
        }
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

        if (score !== null || discipline === 'precision') {
            if (discipline === 'precision') {
                const calc = getCalculatedRowData(sn, new Map(), allEquipages, precisionStatusMap, precisionConfig, startTimes);
                score = calc.totalPenalty;
                if (score === null) return;
            }

            if (isBetter(best ? best.score : null, score, discipline)) {
                let time = '';
                if (discipline === 'precision') {
                    const st = precisionStatusMap.get(sn);
                    time = st?.time || (score != null ? msToLabel(st?.timeMs || 0) : '');
                }
                best = { score, name: eq.driverName, sn: eq.startNumber, time };
            }
        }
    });
    return best;
}

// ================= Live Clock =================
let liveClockInterval = null;
function startLiveClock() {
    // Legacy helper - redirected to ensureMainTicker
    ensureMainTicker();
}

function updateLiveClocks() {
    if (!currentRider) return;

    // Precision Live Time
    const pTimeEl = document.getElementById('precision-live-time');
    const pPenEl = document.getElementById('precision-live-time-penalty');
    const pTotEl = document.getElementById('precision-live-total');

    const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();

    if (pTimeEl && currentDiscipline === 'precision') {
        const d = currentRider.data || currentRider.statusData || {};
        const eq = currentRider.eq;

        if (d.running && d.liveStartEpoch) {
            const ms = (d.livePausedMs || 0) + (tickTimeNow - d.liveStartEpoch);
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

    // 3. Central Speaker Card (Rank, Margin, etc)
    const cardRankEl = document.getElementById('speaker-live-rank');
    const cardTotalEl = document.getElementById('speaker-live-total');
    const cardMarginEl = document.getElementById('speaker-live-margin');

    if (currentRider && currentRider.eq && (cardRankEl || cardTotalEl || cardMarginEl)) {
        const eq = currentRider.eq;
        const liveInjection = calculateLiveInjection(eq);
        const totalRanking = getTotalRanking(eq.className, liveInjection);
        const myIdx = totalRanking.findIndex(r => String(r.sn) === String(eq.startNumber));

        if (myIdx !== -1) {
            const myR = totalRanking[myIdx];
            if (cardRankEl) cardRankEl.textContent = (myIdx + 1);
            if (cardTotalEl && myR.total != null && myR.total !== Infinity) cardTotalEl.textContent = myR.total.toFixed(2);

            if (cardMarginEl && totalRanking.length > 1) {
                const others = totalRanking.filter(r => String(r.sn) !== String(eq.startNumber) && !r.isEliminated);
                if (others.length > 0 && myR.total != null) {
                    const leader = others[0];
                    const diff = myR.total - leader.total;
                    const isLeader = myIdx === 0;

                    if (isLeader) {
                        const nextBest = others[0].total; // Wait, if I'm leader, others[0] IS the next best
                        if (nextBest != null) {
                            const margin = nextBest - myR.total;
                            cardMarginEl.textContent = `Segermarginal: ${Math.abs(margin).toFixed(2)}`;
                            cardMarginEl.className = "text-xs mt-1 font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded border border-green-200";
                        }
                    } else {
                        const leaderTotal = totalRanking[0].total;
                        if (leaderTotal != null) {
                            const behind = myR.total - leaderTotal;
                            cardMarginEl.textContent = `Upp till ledning: +${behind.toFixed(2)}`;
                            cardMarginEl.className = "text-xs mt-1 font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded border border-red-200";
                        }
                    }
                }
            }
        }
    }

    // Marathon Live Time
    const mTimeEl = document.getElementById('marathon-live-time');


    if (currentDiscipline === 'maraton') {
        const d = currentRider ? (currentRider.data || currentRider.statusData || {}) : {};
        const active = currentRider ? activeEquipages.get(String(currentRider.eq.startNumber)) : null;

        // 1. Rider Card Timer
        if (mTimeEl) {
            let handled = false;

            // Priority: Active Equipage (Source of Truth)
            if (active && (active.timerBaseMs > 0 || active.fixedElapsedMs != null)) {
                const ms = Math.max(0, active.fixedElapsedMs != null ? active.fixedElapsedMs : (active.timerBaseMs ? (tickTimeNow - active.timerBaseMs) - pausedMsSince(active.timerBaseMs, tickTimeNow) : 0));
                mTimeEl.textContent = formatMsLive(ms);
                handled = true;
            }

            // Fallback: Legacy Logic (if not found in active list but looks running)
            if (!handled && d.running) {
                // ... (Existing fallback logic or simplified) ...
                if (d.liveObstacleStartAt) {
                    const start = d.liveObstacleStartAt.toMillis ? d.liveObstacleStartAt.toMillis() : d.liveObstacleStartAt;
                    if (start > 0) {
                        mTimeEl.textContent = formatMsLive(tickTimeNow - start);
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
                        mTimeEl.textContent = formatMsLive(tickTimeNow - start - pausedMsSince(start, tickTimeNow));
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
            if (act && (act.timerBaseMs > 0 || act.fixedElapsedMs != null)) {
                // Robust Match: If active task started at approximately the same time as the sector timer (data-start),
                // then we can trust the active record's pausedMs and startTime.
                // This avoids issues with key naming ('wait_b' vs 'transport' vs 'A') or case sensitivity.
                if (startStr && Math.abs((act.startTime || act.timerBaseMs) - Number(startStr)) < 2000) {
                    const ms = Math.max(0, act.fixedElapsedMs != null ? act.fixedElapsedMs : (act.timerBaseMs ? (tickTimeNow - act.timerBaseMs) - pausedMsSince(act.timerBaseMs, tickTimeNow) : 0));
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
                const ms = tickTimeNow - start - pausedMsSince(start, tickTimeNow);
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
            if (act && (act.timerBaseMs > 0 || act.fixedElapsedMs != null)) {
                // Robust Match: Proximity check (same as above)
                if (startStr && Math.abs((act.startTime || act.timerBaseMs) - Number(startStr)) < 2000) {
                    ms = Math.max(0, act.fixedElapsedMs != null ? act.fixedElapsedMs : (act.timerBaseMs ? (tickTimeNow - act.timerBaseMs) - pausedMsSince(act.timerBaseMs, tickTimeNow) : 0));
                    handled = true;
                }
            }

            if (!handled && startStr && !isNaN(Number(startStr))) {
                const start = Number(startStr);
                ms = tickTimeNow - start - pausedMsSince(start, tickTimeNow);
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
        attachSwitcherEvents();
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
    const liveInjection = currentRider ? calculateLiveInjection(currentRider.eq || currentRider) : null;
    const ranked = getTotalRanking(className, liveInjection);

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

window.setSidebarClassFocus = (val) => {
    sidebarClassFocus = val;
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
    setupAllListeners();
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
    document.getElementById('btn-totalt')?.addEventListener('click', () => switchDiscipline('totalt'));
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
                const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();
                const ms = Math.max(0, tickTimeNow - start - pausedMsSince(start, tickTimeNow));
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
        <table class="w-full text-sm text-left text-gray-600 dark:text-gray-300">
            <thead class="text-xs text-gray-700 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <tr>
                    <th class="px-3 py-2">#</th>
                    <th class="px-3 py-2">Ekipage</th>
                    <th class="px-3 py-2 text-right">Straff</th>
                </tr>
            </thead>
            <tbody>
                ${top10.map((r, i) => `
                <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onclick="window.selectSpeakerRider('${r.sn}')">
                    <td class="px-3 py-2 font-bold ${i < 3 ? 'text-brand-gold dark:text-yellow-500' : 'text-gray-400 dark:text-gray-500'}">${i + 1}</td>
                    <td class="px-3 py-2">
                        <div class="font-bold text-gray-800 dark:text-gray-200">${r.name}</div>
                        <div class="text-[10px] text-gray-500 dark:text-gray-400">${r.class} • ${r.club}</div>
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums tracking-wide font-black text-gray-900 dark:text-white">${(r.penalty != null) ? r.penalty.toFixed(2) : '—'}</td>
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

        let statusColor = 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border-green-100 dark:border-green-800/50';
        let icon = '🟢';

        // Check if "long time" warning?

        // Calculate Prognosis for this driver
        const res = calculateMarathonResult(eq, d || {}, d || {});
        let progHtml = '';
        if (res) {
            const prog = calculateProjectedPenalty(res, eq.className, null, maratonStatusMap, allEquipages);
            if (prog && Number.isFinite(prog.projectedTotal)) {
                progHtml = `<div class="text-[10px] font-bold text-gray-500 dark:text-gray-400 mt-1">Prognos: ${prog.projectedTotal != null ? prog.projectedTotal.toFixed(1) : '—'}</div>`;
            }
        }

        return `
        <div onclick="window.selectSpeakerRider('${eq.startNumber}')" class="p-3 mb-2 rounded-lg border ${statusColor} hover:shadow-md cursor-pointer transition-all bg-white dark:bg-gray-800 relative group">
             <div class="flex justify-between items-start">
                 <div>
                     <div class="flex items-center gap-2">
                        <span class="font-black text-lg text-gray-800 dark:text-gray-200 w-8">#${eq.startNumber}</span>
                        <span class="font-bold text-sm text-gray-900 dark:text-white truncate max-w-[120px]" title="${eq.driverName}">${eq.driverName}</span>
                     </div>
                     <div class="text-xs text-blue-700 dark:text-blue-300 font-bold mt-0.5 uppercase tracking-wide">${taskName}</div>
                 </div>
                 <div class="text-right">
                     <div class="text-xl tabular-nums tracking-wide font-black text-gray-800 dark:text-gray-100" id="maraton-timer-${eq.startNumber}">${timeLabel}</div>
                 </div>
             </div>
             <div class="flex justify-between items-end mt-1">
                 <div class="text-[10px] text-gray-400 dark:text-gray-500 truncate">${eq.className}</div>
                 ${progHtml}
             </div>
             
             <!-- Hover prompt -->
             <div class="absolute inset-0 bg-blue-50/50 dark:bg-blue-900/50 opacity-0 group-hover:opacity-100 flex items-center justify-center pointer-events-none transition-opacity">
                <span class="bg-white dark:bg-gray-800 shadow px-2 py-1 rounded text-xs font-bold text-blue-800 dark:text-blue-300">Visa Detaljer</span>
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
    const el = document.getElementById('active-list-content');

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
        const bgClass = isSelected ? 'bg-amber-100 border-amber-300 dark:bg-yellow-900/40 dark:border-yellow-700' : 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700 border-transparent';
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
        // Use pauseEndTime instead of true Date.now() if paused
        const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();
        const ms = (tickTimeNow - c.startTime) - c.pausedMs;
        const timeTxt = ms > 0 ? (ms / 1000).toFixed(1) + 's' : '0.0s';

        return `
        <div onclick="selectSpeakerRider(${c.sn})" class="cursor-pointer p-2 rounded border mb-1 last:mb-0 ${bgClass} transition-colors">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="font-bold text-gray-900 dark:text-white text-sm whitespace-nowrap">#${c.sn}</span>
                    <span class="text-sm truncate dark:text-gray-200" title="${c.eq.driverName}">${c.eq.driverName}</span>
                </div>
                <span class="text-xs tabular-nums tracking-wide font-bold w-12 text-right text-gray-700 dark:text-gray-300" id="maraton-timer-${c.sn}">${timeTxt}</span>
            </div>
            <div class="flex justify-between mt-1 text-xs text-gray-600 dark:text-gray-400 items-baseline">
                <span class="bg-white dark:bg-gray-600 px-1 rounded border dark:border-gray-500 ${isObstacle ? 'text-amber-700 dark:text-amber-200 border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/40' : 'text-gray-600 dark:text-gray-300'}">${c.task.name}</span>
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
    if (!className) return '';
    let results = [];

    if (discipline === 'dressyr') {
        allEquipages.forEach(eq => {
            if (eq.className !== className) return;
            const sn = String(eq.startNumber);
            const pen = getDressageFinalPenalty(sn);
            if (pen != null) {
                results.push({
                    sn: sn,
                    name: eq.driverName,
                    club: eq.clubName,
                    eq: eq,
                    penalty: Number(pen),
                    percent: Number(getDressageFinalPercent(sn) || 0)
                });
            }
        });
        results = results.filter(r => r.penalty > 0.01);
        results.sort((a, b) => a.penalty - b.penalty);
    } else if (discipline === 'maraton') {
        allEquipages.forEach(eq => {
            if (eq.className !== className) return;
            const sn = String(eq.startNumber);
            const st = maratonStatusMap.get(sn);
            if (st && st.totalPenalty != null) {
                results.push({
                    sn: sn,
                    name: eq.driverName,
                    club: eq.clubName,
                    eq: eq,
                    penalty: st.totalPenalty
                });
            }
        });
        results.sort((a, b) => a.penalty - b.penalty);
    } else if (discipline === 'precision') {
        const ranking = getPrecisionRanking(allEquipages, precisionStatusMap, className, null, precisionConfig);
        results = ranking.map(r => ({
            sn: r.sn,
            name: r.name,
            club: r.club,
            eq: r.eq,
            penalty: r.penalty,
            time: r.time
        }));
    } else if (discipline === 'totalt') {
        const ranking = getTotalRanking(className);
        results = ranking.map(r => ({
            sn: r.sn,
            name: r.name,
            penalty: r.total,
            eq: allEquipages.find(e => String(e.startNumber) === String(r.sn))
        }));
    }

    const top3 = results.slice(0, 3);
    if (top3.length === 0) return '<div class="text-xs text-center text-gray-400 italic py-2">Inga resultat i klassen ännu</div>';

    return `
    <div class="space-y-1">
        ${top3.map((r, i) => {
            const displayPenalty = r.penalty === Infinity ? 'ELIM' : (r.penalty != null ? r.penalty.toFixed(2) : '—');
            const secondaryHtml = (discipline === 'dressyr') 
                ? `<span class="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums tracking-wide hidden sm:inline">${(r.percent || 0).toFixed(1)}%</span>`
                : (discipline === 'precision' && r.time) 
                    ? `<span class="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums tracking-wide hidden sm:inline">(${r.time})</span>`
                    : '';

            return `
            <div onclick="showRiderDetails('${r.sn}')" class="flex items-center justify-between p-2 border-b dark:border-gray-700 last:border-0 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 cursor-pointer transition-colors group">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="font-bold text-gray-400 dark:text-gray-500 w-4">${i + 1}.</span>
                    <span class="font-bold text-gray-800 dark:text-gray-200 truncate group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors" title="${r.name}">${r.name}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    ${secondaryHtml}
                    <span class="font-black text-gray-900 dark:text-white">${displayPenalty}</span>
                </div>
            </div>`;
        }).join('')}
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
/**
 * Calculates live penalty/time for an equipage during their run.
 * Used for live-injections in class rankings and real-time boxes.
 */
function calculateLiveInjection(eq) {
    if (!eq) return null;
    const sn = String(eq.startNumber);
    const pSt = precisionStatusMap.get(sn);
    
    // 1. Precision Live
    if (pSt && (pSt.running || pSt.inProgress)) {
        let pen = pSt.totalPenalty || 0;
        let timeMs = pSt.liveTimeMs || pSt.timeMs || 0;
        if (pSt.running && pSt.liveStartEpoch) {
            const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
            const nowMs = (pSt.livePausedMs || 0) + (Date.now() - pSt.liveStartEpoch);
            const lp = calculatePrecisionTimePenalty(nowMs, maxSec);
            const op = pSt.liveObstaclePenalty || pSt.obstaclePenalty || 0;
            const ep = pSt.extraPenalty || 0;
            pen = op + lp + ep;
            timeMs = nowMs;
        }
        return { 
            sn: eq.startNumber, 
            discipline: 'precision', 
            disciplinePenalty: pen,
            timeMs: timeMs
        };
    }
    
    // 2. Marathon Live
    const active = activeEquipages.get(sn);
    if (active) {
        const d = active.data || {};
        const res = calculateMarathonResult(eq, d, d);
        return { 
            sn: eq.startNumber, 
            discipline: 'maraton', 
            disciplinePenalty: res.totalPenalty 
        };
    }
    
    // 3. Dressage Live
    const liveMap = liveProtocolMap.get(sn) || new Map();
    if (liveMap.size > 0) {
        const liveProtocols = Array.from(liveMap.values());
        const result = calculateDressageResult(eq, liveProtocols, allJudges, mergedPrograms);
        if (result && result.penalty != null) {
            return { sn: eq.startNumber, discipline: 'dressyr', disciplinePenalty: result.penalty };
        }
    }
    
    return null;
}

function getTotalRanking(className, currentRiderInfo = null) {
    if (!className) return [];

    const results = [];
    const targetClass = className;

    allEquipages.forEach(e => {
        // Robust class check: match either the direct name or the merged label/key
        const clsMatch = (e.className === targetClass || e._mergedLabel === targetClass || e.mergedTestKey === targetClass);
        if (!clsMatch) return;

        const sn = String(e.startNumber);

        // 1. Dressage
        const dSt = dressageStatusMap.get(sn);
        let dPen = dSt?.finalPenalty ?? null;
        let dPct = dSt?.finalPercent ?? dSt?.percent ?? null;
        const elimD = !!(dSt?.eliminated || dSt?.excluded || (dSt?.status && ['utgått', 'utesluten', 'retired', 'eliminated', 'elim', 'ute', 'utg'].some(s => String(dSt.status).toLowerCase().includes(s))));

        // 2. Marathon
        const mSt = maratonStatusMap.get(sn);
        let mPen = mSt?.totalPenalty ?? null;
        let isElimM = false;
        if (mSt) {
            const mRes = calculateMarathonResult(e, mSt, mSt);
            mPen = mRes.totalPenalty;
            isElimM = mRes.eliminated || ['utgått', 'utesluten', 'retired', 'eliminated', 'elim', 'ute', 'utg'].some(s => String(mSt.status || '').toLowerCase().includes(s));
        }

        // 3. Precision
        const pSt = precisionStatusMap.get(sn);
        let pPen = pSt?.totalPenalty ?? null;
        let pTimeMs = pSt?.timeMs || 0;
        let isElimP = !!pSt?.eliminated;
        if (pSt) {
            const pRes = getCalculatedRowData(sn, new Map(), allEquipages, precisionStatusMap, precisionConfig, startTimes);
            pPen = pRes.totalPenalty;
            pTimeMs = pRes.timeMs || 0;
            isElimP = pRes.eliminated;
        }

        const totalEliminated = elimD || isElimM || isElimP;

        // Apply Injections (for live rider)
        if (currentRiderInfo && String(currentRiderInfo.sn) === sn) {
            if (currentRiderInfo.discipline === 'precision') {
                pPen = currentRiderInfo.disciplinePenalty;
                pTimeMs = currentRiderInfo.timeMs || pTimeMs;
            } else if (currentRiderInfo.discipline === 'maraton') {
                mPen = currentRiderInfo.disciplinePenalty;
            } else if (currentRiderInfo.discipline === 'dressyr') {
                dPen = currentRiderInfo.disciplinePenalty;
            }
        }

        results.push({
            startNumber: e.startNumber,
            driverName: e.driverName,
            className: e.className,
            // Compatibility for older sidebar calls
            sn: e.startNumber,
            name: e.driverName,
            total: totalEliminated ? Infinity : computeTotalPenalty(dPen, mPen, pPen),
            totalPenalty: totalEliminated ? null : computeTotalPenalty(dPen, mPen, pPen),
            tieBreakerTime: pTimeMs,
            isEliminated: totalEliminated,
            dressage: { penalty: dPen, percentAvg: dPct, eliminated: elimD },
            marathon: { totalPenalty: mPen, eliminated: isElimM },
            precision: { pen: pPen, eliminated: isElimP }
        });
    });

    // 1. Overall Ranking (for plac and total)
    results.sort((a, b) => {
        if (a.isEliminated !== b.isEliminated) return a.isEliminated ? 1 : -1;
        
        const aTot = (a.total === null || a.total === undefined) ? Infinity : a.total;
        const bTot = (b.total === null || b.total === undefined) ? Infinity : b.total;

        // Main sort: total penalty
        if (Math.abs(aTot - bTot) > 0.001) return aTot - bTot;

        // Tie-breaker 1: Marathon (lowest score better)
        const ma = a.marathon?.totalPenalty ?? Infinity;
        const mb = b.marathon?.totalPenalty ?? Infinity;
        if (ma !== mb) return ma - mb;

        // Tie-breaker 2: Dressage (lowest score better)
        const da = a.dressage?.penalty ?? Infinity;
        const db = b.dressage?.penalty ?? Infinity;
        if (da !== db) return da - db;

        // Tie-breaker 3: Precision (lowest score better)
        const pa = a.precision?.pen ?? Infinity;
        const pb = b.precision?.pen ?? Infinity;
        if (pa !== pb) return pa - pb;

        // Fallback: Start number
        return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
    });

    const leadTotal = (results.length > 0 && results[0].total !== Infinity) ? results[0].total : 0;
    results.forEach((r, idx) => {
        if (r.isEliminated) {
            r.plac = 'ELIM';
            r.diffFromLeader = null;
        } else if (r.total !== Infinity) {
            r.plac = idx + 1;
            r.diffFromLeader = r.total - leadTotal;
        } else {
            r.plac = null;
            r.diffFromLeader = null;
        }
    });

    // 2. Discipline Rankings (posDress, posMar, posPrec)
    const computeDisciplineRank = (list, sortFn, targetKey) => {
        const sorted = [...list].sort(sortFn);
        const mapKey = targetKey === 'posDress' ? 'dressage' : (targetKey === 'posMar' ? 'marathon' : 'precision');
        
        list.forEach(r => {
            const discData = r[mapKey];
            const hasRes = discData && (discData.penalty !== null || discData.totalPenalty !== null || discData.pen !== null);
            if (hasRes && !discData.eliminated) {
                const rank = sorted.findIndex(x => x.startNumber === r.startNumber) + 1;
                r[targetKey] = rank;
            } else {
                r[targetKey] = null;
            }
        });
    };

    // Dressyr Rank
    const dressageSorted = [...results].sort((a, b) => {
        if (a.dressage.eliminated !== b.dressage.eliminated) return a.dressage.eliminated ? 1 : -1;
        return (a.dressage.penalty ?? Infinity) - (b.dressage.penalty ?? Infinity);
    });
    results.forEach(r => {
        if (r.dressage.penalty !== null && !r.dressage.eliminated) {
            r.posDress = dressageSorted.findIndex(x => x.startNumber === r.startNumber) + 1;
        } else r.posDress = null;
    });

    // Maraton Rank
    const marathonSorted = [...results].sort((a, b) => {
        if (a.marathon.eliminated !== b.marathon.eliminated) return a.marathon.eliminated ? 1 : -1;
        return (a.marathon.totalPenalty ?? Infinity) - (b.marathon.totalPenalty ?? Infinity);
    });
    results.forEach(r => {
        if (r.marathon.totalPenalty !== null && !r.marathon.eliminated) {
            r.posMar = marathonSorted.findIndex(x => x.startNumber === r.startNumber) + 1;
        } else r.posMar = null;
    });

    // Precision Rank
    const precisionSorted = [...results].sort((a, b) => {
        if (a.precision.eliminated !== b.precision.eliminated) return a.precision.eliminated ? 1 : -1;
        if (a.precision.pen === b.precision.pen) return (a.tieBreakerTime || 0) - (b.tieBreakerTime || 0);
        return (a.precision.pen ?? Infinity) - (b.precision.pen ?? Infinity);
    });
    results.forEach(r => {
        if (r.precision.pen !== null && !r.precision.eliminated) {
            r.posPrec = precisionSorted.findIndex(x => x.startNumber === r.startNumber) + 1;
        } else r.posPrec = null;
    });

    return results;
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
                <button id="edit-notes-btn" onclick="editSpeakerNotes('${eq.startNumber}')" class="text-xs bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-100 px-2 py-1 rounded hover:bg-yellow-300 dark:hover:bg-yellow-700 transition-colors">✎ Ändra</button>
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
    const liveInjection = calculateLiveInjection(eq);
    let targetToBeatHtml = '';
    let comparisonHtml = ''; 
    let elapsedTime = '—';


    const totalRanking = getTotalRanking(eq.className, liveInjection);
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
        const leader = getDressageLeaderInClass(eq.className);
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
        const allInClass = allEquipages.filter(e => e.className === eq.className).map(e => {
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
    const leader = currentDiscipline === 'precision'
        ? getChasingTarget(className, currentRider.data?.liveTotalPenalty || currentRider.data?.totalPenalty || 0)
        : getLeaderToBeat(className, currentDiscipline);

    if (!leader) return '';

    const label = currentDiscipline === 'dressyr' ? 'Att slå' : (leader.isLeader ? 'Ledarresultat' : 'Jagar');
    let val = currentDiscipline === 'dressyr' ? (leader.score != null ? leader.score.toFixed(1) + '%' : '—') : (leader.score != null ? leader.score.toFixed(2) : '—');

    if (currentDiscipline === 'precision' && leader.time) {
        val += ` <span class="text-xs font-normal">(${leader.time})</span>`;
    }

    let diffHtml = '';
    if (currentDiscipline === 'precision' && currentRider) {
        const currentPen = currentRider.data?.liveTotalPenalty || 0;
        const diff = currentPen - leader.score;
        if (diff > 0) {
            diffHtml = `<span class="ml-2 text-xs font-bold text-red-500">(+${(diff != null) ? diff.toFixed(2) : '—'})</span>`;
        } else if (diff < 0) {
            diffHtml = `<span class="ml-2 text-xs font-bold text-green-500">(${(diff != null) ? diff.toFixed(2) : '—'})</span>`;
        }
    }

    return `
    <div class="mt-2 text-sm text-gray-500 dark:text-gray-400 border-l-2 border-gray-300 dark:border-gray-600 pl-2">
        <div class="uppercase font-bold text-[10px] tracking-wider text-gray-400 dark:text-gray-500">${label}:</div>
        <div>
            <span class="tabular-nums tracking-wide font-bold text-lg text-gray-800 dark:text-gray-200">${val}</span> ${diffHtml}
        </div>
        <div class="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[200px]">${leader.name}</div>
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
    const el = document.getElementById('upcoming-list-content') || document.getElementById('upcoming-list');
    if (!el) return;

    const upcoming = allEquipages.filter(eq => {
        const sn = String(eq.startNumber);

        let state = 'not-started';
        let startTime = 0;

        if (currentDiscipline === 'dressyr') {
            const st = dressageStatusMap.get(sn) || {};
            // Use state directly to avoid normDressageState auto-finishing on zero-penalty
            state = st.state || eq.status || 'not-started';
            if (st.finalPenalty != null && st.state === 'finished') state = 'finished';
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

        // Check if explicitly finished or started by live status
        let isFinished = String(state).toLowerCase() === 'finished' || state === 'started';
        // Check if recently completed and in the result cache
        if (recentResults.some(r => String(r.sn) === sn)) isFinished = true;

        return !isFinished && !isWithdrawnOrExcluded(state, { ...eq });
    }).sort((a, b) => {
        const tA = getStartTimeForSort(a.startNumber);
        const tB = getStartTimeForSort(b.startNumber);
        return tA - tB;
    }).slice(0, 10);

    if (upcoming.length === 0) {
        el.innerHTML = '<div class="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Inga fler starter.</div>';
        return;
    }

    const listHtml = upcoming.map(eq => {
        const t = getStartTimeForDisplay(eq.startNumber);
        return `
    <div class="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded hover:bg-white dark:hover:bg-gray-600 border border-transparent hover:border-gray-200 dark:hover:border-gray-500 transition-colors">
            <div class="min-w-0">
                <div class="font-bold text-gray-900 dark:text-white truncate">#${eq.startNumber} ${eq.driverName}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 truncate">${eq.clubName}</div>
            </div>
            <div class="text-right shrink-0">
                 <div class="tabular-nums tracking-wide font-bold text-brand-darkblue dark:text-blue-300">${t}</div>
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
    let val = null;
    if (currentDiscipline === 'dressyr') val = startTimes[s]?.dressage;
    else if (currentDiscipline === 'maraton') val = startTimes[s]?.maraton;
    else if (currentDiscipline === 'precision') val = startTimes[s]?.precision;

    // Return max value if no time found to push to end
    if (!val) return Number.MAX_SAFE_INTEGER;

    // Convert to comparable timestamp
    if (val.includes('T')) return new Date(val).getTime();

    // Handle "HH:mm" by attaching to a dummy date
    return new Date('1970-01-01T' + (val.length === 5 ? val + ':00' : val)).getTime();
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

function renderRecentResultsList() {
    const el = document.getElementById('recent-results-list');
    if (!el) return;

    const list = [...recentResults].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));


    if (list.length === 0) {
        el.innerHTML = '<div class="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Inga resultat ännu.</div>';
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
                    gapHtml = `<span class="text-[10px] text-red-500 tabular-nums tracking-wide ml-2">(+${diff.toFixed(2)})</span>`;
                } else {
                    gapHtml = `<span class="text-[10px] text-green-600 font-bold ml-2">LEDER</span>`;
                }
            }
        }

        return `
        <div onclick="showRiderDetails('${r.sn}')" class="p-2 border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
            <div class="flex justify-between items-baseline mb-1">
                <div class="flex items-center">
                     <span class="font-bold text-gray-900 dark:text-gray-200 mr-2">#${r.sn} ${r.name}</span>
                     ${gapHtml}
                </div>
                <span class="font-bold text-blue-600 dark:text-blue-400">${Number.isFinite(r.finalPenalty) ? r.finalPenalty.toFixed(2) : '-'} p</span>
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                <span>${r.clubName}</span>
                <span>${Number.isFinite(r.finalPercent) && currentDiscipline === 'dressyr' ? r.finalPercent.toFixed(1) + '%' : ''}</span>
            </div>
        </div>
    `}).join('');
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
                const actives = getActiveMarathonRunners();
                const found = actives.find(a => String(a.sn) === id);
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

function setupDressageListeners() {
    // 1. Status (Group)
    // 1. Status (Group)
    unsubscribes.push(listenForDressageStatusCollection(competitionId, (docs) => {
        docs.forEach(st => {
            const sn = String(st.id || st.startNumber);
            const cur = dressageStatusMap.get(sn) || {};

            // Be robust to legacy field names
            const normalized = { ...st };
            if (normalized.finalPenalty == null && normalized.penalty != null) normalized.finalPenalty = normalized.penalty;
            if (normalized.finalPenalty == null && normalized.totalPenalty != null) normalized.finalPenalty = normalized.totalPenalty;
            if (normalized.finalPercent == null && normalized.percent != null) normalized.finalPercent = normalized.percent;

            // Normalize state
            const sNorm = normState(normalized.state);
            if (!normalized.state && normalized.finalPenalty != null) normalized.state = 'finished';
            else if (['done', 'complete', 'completed', 'klar', 'slut'].includes(sNorm)) normalized.state = 'finished';
            else if (['active', 'in-progress', 'inprogress', 'started', 'pågår', 'paga'].includes(sNorm)) normalized.state = 'active';

            // If just finished, verify result
            if (normalized.state === 'finished' && normalized.finalPenalty != null && cur.state !== 'finished') {
                const eq = allEquipages.find(e => String(e.startNumber) === sn);
                if (eq) verifyDressageResult(sn, normalized, eq);
            }

            dressageStatusMap.set(sn, { ...cur, ...normalized });
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

            const programs = getPrograms();
            const result = calculateDressageResult(eq, cleanProtocols, allJudges, programs);

            if (result && result.penalty != null) {
                const cur = dressageStatusMap.get(sn) || {};
                // Override status values with robust calculation
                dressageStatusMap.set(sn, {
                    ...cur,
                    finalPercent: result.percent,
                    finalPoints: result.points,
                    finalPenalty: result.penalty,
                    errorPoints: result.errorPoints,
                    errorPenalty: result.penalty,
                    _calculated: true
                });
            }
            // Move this OUTSIDE the calculation check to ensure we always try to show it using fallback logic
            maybePushRecent(sn);
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
        ensureSpeakerTicker();
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
                data._receivedLocalAt = Date.now(); // NYTT: För relativ tidssynk
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

    // Nollställ data för den nya disciplinen så vi inte blandar ihop resultat
    recentResults.length = 0;
    dressageStatusMap.clear();
    liveProtocolMap.clear();
    maratonStatusMap.clear();
    activeEquipages.clear();
    precisionStatusMap.clear();

    // Listen for Global Pause Status
    const pauseSub = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'competitions', competitionId, 'config', 'globalStatus'), (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();
            isGloballyPaused = d.isPaused === true;

            // Extract latest pause start time if paused
            if (isGloballyPaused && Array.isArray(d.pauseLog)) {
                setPauseWindows(d.pauseLog);
                const current = d.pauseLog.find(p => p.end === null);
                if (current && current.start) {
                    pauseStartTime = new Date(current.start).getTime();
                } else {
                    pauseStartTime = Date.now();
                }
            } else {
                setPauseWindows(d.pauseLog || []);
                pauseStartTime = 0;
            }
        }
    });
    unsubscribes.push(pauseSub);

    // Listen for Display Config (for Merged Classes)
    unsubscribes.push(listenForConfig(competitionId, 'display', (cfg) => {
        if (cfg) {
            buildMergeMap(cfg);
            allEquipages = ensureMergeDecorations(allEquipages);
            triggerRender(true);
        }
    }));

    // Listen for Judges (Global)
    unsubscribes.push(listenForJudges(competitionId, (judges) => {
        allJudges = (judges || []).map(j => ({
            ...j,
            id: j.id,
            name: j.name || j.fullName || j.id,
            position: (expandDressagePosition(j) || j.position || '').toUpperCase()
        }));
        triggerRender();
        // RE-EVALUATE RESULTS now that we have judges
        if (currentDiscipline === 'dressyr') {
            dressageStatusMap.forEach((val, key) => maybePushRecent(key));
            triggerRender(); // Render again after processing
        }
    }));

    // In Speaker page, we ALWAYS need all data to calculate Total Standings correctly
    // regardless of which tab is active.
    setupDressageListeners();
    setupMarathonListeners();
    setupPrecisionListeners();
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

        // --- Verification Step ---
        // Removed aggressive verifyAllStartups() to prevent network overload/quota issues.
        // We will rely on new finishes triggering verification.

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
    const container = document.getElementById('active-list-container');
    // Consolidate: Try active-list-content, fallback to active-list (dressage/default ID)
    const el = document.getElementById('active-list-content') || document.getElementById('active-list');

    // 1. If not Marathon, hide and exit
    if (currentDiscipline !== 'maraton' && currentDiscipline !== 'totalt') {
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
        if (c.task && (c.task.type === 'obstacle' || c.task.type === 'result_flash')) hotList.push(c);
        else onCourseList.push(c);
    });



    if (hotList.length === 0 && onCourseList.length === 0) {
        el.innerHTML = '<div class="text-xs text-gray-500 dark:text-gray-400 text-center p-8 bg-gray-50 dark:bg-gray-800 rounded italic">Inga aktiva på banan (Väntar på start). <br>Klicka ⚡ för test.</div>';
        return;
    }

    let html = '';

    // --- HOT ZONE (Hinder) ---
    if (hotList.length > 0) {
        html += `<div class="mb-2 space-y-2">`;
        html += hotList.map(c => {
            const isSelected = (manualFocusId && String(manualFocusId) === String(c.sn));
            const obsNum = c.task.type === 'result_flash' ? c.task.data.number : c.task.key;
            const stats = calculateClassObstacleStats(c.eq.className, obsNum, maratonStatusMap, allEquipages);

            let statsHtml = '';
            if (stats && stats.bestTime) {
                statsHtml = `
                 <div class="flex items-center gap-2 mt-1 bg-white/50 dark:bg-gray-800/50 p-1 rounded">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold">Mål att slå:</span>
                    <span class="tabular-nums tracking-wide font-bold text-green-700 dark:text-green-400">${stats.bestTime.toFixed(2)}s</span>
                 </div>`;
            }

            // Check Splits
            let splitText = '';
            const rawSplitsArray = c.task.type === 'result_flash' ? c.task.data.gateSplits : c.data.live_gateSplits;
            const splitsArray = getValidFirstPasses(rawSplitsArray);
            if (splitsArray && splitsArray.length > 0) {
                const classStats = calculateClassSplitStats(c.eq.className, obsNum, maratonStatusMap, allEquipages);

                // Show last 3 splits
                const recentSplits = splitsArray.slice(-3);

                splitText = recentSplits.map(s => {
                    let colorClass = 'text-gray-500';
                    let title = '';

                    let obsStart = null;
                    if (c.task.type === 'result_flash' && c.task.data.enteredAt) {
                        obsStart = c.task.data.enteredAt;
                    } else {
                        obsStart = c.data.liveObstacleStartAt || c.data.live_staticStartAt;
                    }

                    if (obsStart && obsStart.toMillis) obsStart = obsStart.toMillis();
                    else if (typeof obsStart === 'string') obsStart = new Date(obsStart).getTime();

                    if (!obsStart && c.data.obstacleTimes && c.data.obstacleTimes[obsNum]) {
                        const ot = c.data.obstacleTimes[obsNum];
                        obsStart = ot.enteredAt || ot.enteredAtClient;
                        if (typeof obsStart === 'string') obsStart = new Date(obsStart).getTime();
                    }

                    let splitTs = s.ts?.toMillis ? s.ts.toMillis() : (typeof s.ts === 'string' ? new Date(s.ts).getTime() : s.ts);
                    let displayTime = s.time;

                    if (obsStart && splitTs && !Number.isFinite(displayTime)) {
                        displayTime = (splitTs - obsStart) / 1000;
                    }

                    if (s.char && classStats[s.char] && obsStart && splitTs) {
                        const stat = classStats[s.char];
                        const diff = splitTs - obsStart;
                        if (diff <= stat.best + 100) {
                            colorClass = 'text-green-600 dark:text-green-400 font-bold bg-green-50 dark:bg-green-900/30 px-1 rounded';
                            title = `Bäst! (${(stat.best / 1000).toFixed(1)}s)`;
                        } else if (diff < stat.avg) {
                            colorClass = 'text-blue-600 dark:text-blue-400 font-semibold';
                            title = `Bättre än snitt (${(stat.avg / 1000).toFixed(1)}s)`;
                        } else {
                            colorClass = 'text-amber-600 dark:text-amber-400';
                            title = `Sämre än snitt (${(stat.avg / 1000).toFixed(1)}s)`;
                        }
                    }

                    return `<span class="text-[10px] tabular-nums tracking-wide ml-1 ${colorClass}" title="${title}">(${s.char}: ${Number.isFinite(displayTime) ? displayTime.toFixed(1) : '-'})</span>`;
                }).join('');
            }

            // Calculate live time Safely
            let timeTxt = '00:00,00';
            if (c.timerBaseMs > 0 || c.fixedElapsedMs != null) {
                const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();
                const ms = Math.max(0, c.fixedElapsedMs != null ? c.fixedElapsedMs : (c.timerBaseMs ? (tickTimeNow - c.timerBaseMs) - pausedMsSince(c.timerBaseMs, tickTimeNow) : 0));
                timeTxt = formatMsLive(ms);
            }

            return `
            <div onclick="selectSpeakerRider(${c.sn})" class="cursor-pointer bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 dark:border-amber-600 p-3 rounded shadow-sm hover:shadow-md transition-all ${isSelected ? 'ring-2 ring-amber-400' : ''}">
                <div class="flex justify-between items-start">
                    <div>
                        <div class="font-black text-lg text-gray-900 dark:text-white leading-none">#${c.sn} ${c.eq.driverName}</div>
                        <div class="text-xs text-amber-800 dark:text-amber-200 font-bold mt-1 uppercase tracking-wide">${c.task.type === 'result_flash' ? 'Resultat Hinder' : 'Hinder'} ${obsNum} ${splitText}</div>
                    </div>
                    <div class="text-3xl tabular-nums tracking-wide font-black text-gray-800 dark:text-gray-200 tracking-tight" id="maraton-timer-${c.sn}">${timeTxt}</div>
                </div>
                ${statsHtml}
            </div>`;
        }).join('');
        html += `</div>`;
    }

    // --- ON COURSE (Sections) ---
    if (onCourseList.length > 0) {
        if (hotList.length > 0) {
            html += `<div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1 mt-3 px-1">Övriga på banan</div>`;
        }

        html += `<div class="space-y-1">`;
        html += onCourseList.map(c => {
            const isSelected = (manualFocusId && String(manualFocusId) === String(c.sn));
            let timeTxt = '--:--';
            let limitsHtml = '';

            if (c.timerBaseMs > 0 || c.fixedElapsedMs != null) {
                const tickTimeNow = isGloballyPaused ? pauseStartTime : Date.now();
                const ms = Math.max(0, c.fixedElapsedMs != null ? c.fixedElapsedMs : (c.timerBaseMs ? (tickTimeNow - c.timerBaseMs) - pausedMsSince(c.timerBaseMs, tickTimeNow) : 0));
                timeTxt = formatMsLive(ms);

                // Limits Check (Ideal Time)
                if (c.task && (c.task.key === 'A' || c.task.key === 'B')) {
                    const limits = limitsFor(c.eq, c.task.key);
                    if (limits && limits.max) {
                        // max is "Allowed Time" (Ideal)
                        const allowedMs = limits.max * 1000;
                        const allowedTxt = formatMsLive(allowedMs);

                        // Determine Status
                        let color = 'text-gray-400 dark:text-gray-500';
                        if (ms > allowedMs) color = 'text-red-600 dark:text-red-400 font-bold'; // Over time
                        else if (limits.min && ms < (limits.min * 1000) && ms > (allowedMs * 0.8)) color = 'text-yellow-600 dark:text-yellow-400'; // Approaching min? Or just generic
                        // Simple logic: Close to max?
                        const remaining = allowedMs - ms;
                        if (remaining < 60000 && remaining > 0) color = 'text-amber-600 dark:text-amber-400'; // Last minute

                        limitsHtml = `<span class="text-[10px] ${color} ml-1">/ ${allowedTxt}</span>`;
                    }
                }
            }

            return `
             <div onclick="selectSpeakerRider(${c.sn})" class="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' : ''}">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="font-bold text-gray-700 dark:text-gray-300 text-xs w-8">#${c.sn}</span>
                    <span class="text-sm font-semibold text-gray-900 dark:text-white truncate">${c.eq.driverName}</span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 tabular-nums tracking-wide">${c.task.name}</span>
                    <div class="text-right">
                         <span class="text-xs tabular-nums tracking-wide font-bold text-gray-800 dark:text-gray-200" id="maraton-timer-${c.sn}">${timeTxt}</span>
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

    if (currentDiscipline !== 'maraton' && currentDiscipline !== 'totalt') {
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

        el.innerHTML = `<div class="p-4 text-center text-gray-400 dark:text-gray-500 italic text-xs flex justify-center">${msg}</div>`;
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
        <table class="w-full text-xs text-left text-gray-600 dark:text-gray-300">
            <thead class="text-[10px] text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
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
            ? `class="sector-live-timer font-bold tabular-nums tracking-wide px-3 py-2 text-right ${a.color} ${livePulse}" data-sn="${e.sn}" data-stage="${stageKey}" data-start="${realStart}" data-ideal="${a.ideal}"`
            : `class="font-bold tabular-nums tracking-wide px-3 py-2 text-right ${a.color}"`;

        return `
                    <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer" onclick="window.selectSpeakerRider('${e.sn}')">
                        <td class="px-3 py-2">
                             <div class="font-bold text-gray-900 dark:text-white leading-tight">#${e.sn} ${e.eq.driverName}</div>
                             <div class="text-[10px] text-gray-400 capitalize">${e.eq.clubName}</div>
                        </td>
                        <td class="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">${stageLabel}</td>
                        <td class="px-3 py-2 text-right tabular-nums tracking-wide">${msToLabel(a.ideal * 1000, false)}</td>
                        <td ${e.analysis.isLive ? `class="sector-live-elapsed px-3 py-2 text-right tabular-nums tracking-wide text-gray-900 dark:text-gray-200 font-bold" data-sn="${e.sn}" data-stage="${stageKey}" data-start="${realStart}"` : `class="px-3 py-2 text-right tabular-nums tracking-wide text-gray-400 dark:text-gray-500"`}>${formatMsLive(a.ms)}</td>
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
