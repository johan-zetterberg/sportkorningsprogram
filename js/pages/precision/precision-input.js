import { getGlobalState } from '../../main.js';
import { getEquipages } from '../../services/equipageService.js';
import { getConfig } from '../../services/competitionService.js';
import { getPrecisionResults } from '../../services/precisionService.js';
import { getStartTimes } from '../../services/marathonService.js';
import { finalizePrecision } from '../../services/finalizationService.js';
import { db, appId } from '../../config/firebase-config.js';
import {
    doc,
    setDoc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
    runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompetitionHeader, renderCompetitionModeBanner, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { downloadJson, round2 } from '../../utils/sharedUtils.js';
import { requestWakeLock } from '../../utils/wakeLock.js';
import { computeMaxSecondsForClass, calculatePrecisionTimePenalty, getPortAllowanceCm, getPrecisionCourseData } from '../../utils/precisionUtils.js';

// ---------- State ----------
let competitionId = null;
let equipages = [];
let precisionConfig = {};
let currentEquipage = null;
let searchableDropdown = null;

let knocks = new Set();
let knockDownTimes = {}; // NY: { "3A": 12345, ... }
let extraPenalty = 0;
let comment = '';

let timerInterval = null;
let keydownHandler = null;
let startEpoch = 0;
let pausedMs = 0;
let lastPushedTick = -1; // throttlas nu till ~5 s
let inProgress = false; // <-- NY: håll “Pågår” tills Spara
let wasOverLimit = false; // minns om vi passerat maxtiden
let isRunning = false; // <-- NY explicit flagga

// Race-condition skydd
let currentLoadId = 0;

// ---------- Helpers (tid) ----------
const pad2 = (n) => String(n).padStart(2, '0');
const nowMs = () => Date.now();

function secondsToMMSS(seconds) {
    if (isNaN(seconds) || seconds < 0) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function msToParts(ms) {
    const t = Math.max(0, Math.floor(ms || 0));
    const m = Math.floor(t / 60000);
    const s = Math.floor((t % 60000) / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return { m, s, cs };
}
function partsToString({ m, s, cs }) { return `${pad2(m)}:${pad2(s)},${pad2(cs)}`; }
function getElapsedMs() {
    if (isRunning) {
        // Elapsad tid = ackumulerad pausad tid + tid sedan senaste start
        return pausedMs + (nowMs() - startEpoch);
    }
    return pausedMs;
}

function digitsToMs(d) {
    const s = (d || "").replace(/\D/g, '').slice(0, 6).padEnd(6, '0');
    const mm = +s.slice(0, 2), ss = +s.slice(2, 4), cs = +s.slice(4, 6);
    return (mm * 60 + ss) * 1000 + cs * 10;
}

// Mirror data to localStorage for redundancy
function mirrorToLocal(sn, data) {
    if (!sn || !data || !competitionId) return;
    try {
        const key = `bkp_${competitionId}_pre_${sn}`;
        localStorage.setItem(key, JSON.stringify({
            ts: Date.now(),
            data
        }));
    } catch (e) {
        console.warn('Could not mirror to localStorage', e);
    }
}

// ---------- Helpers (klass/port/max) ----------
// Normalisera inkommande ekipage-objekt till fält som dropdownen/appen förväntar sig
function normalizeEquipage(e) {
    const startNumber =
        Number(e?.startNumber ?? e?.startnr ?? e?.nr ?? e?.start ?? e?.startNo ?? e?.bib ?? 0);

    const driverName =
        e?.driverName ?? e?.driver ?? e?.name ?? e?.kusk ?? '';

    const className =
        e?.className ?? e?.class ?? e?.klass ?? '';

    const trackWidth =
        Number(e?.trackWidth ?? e?.trackWidthCm ?? e?.vagnbredd ?? e?.spannvidd ?? NaN);

    return {
        ...e, // behåll övriga fält orörda
        startNumber,
        driverName,
        className,
        trackWidth: Number.isFinite(trackWidth) ? trackWidth : null
    };
}

function getAllowanceForClass(cls) {
    return getPortAllowanceCm(cls, precisionConfig);
}
function computePortWidthForEquipage(eq) {
    const trackWidth = Number(eq?.trackWidth);
    const allowance = getAllowanceForClass(eq?.className || '');
    if (!Number.isFinite(trackWidth) || !Number.isFinite(allowance)) return null;
    return trackWidth + allowance;
}
function getLabelsForClass(cls) {
    const courseData = getPrecisionCourseData(
        currentEquipage && currentEquipage.className === cls ? currentEquipage : cls,
        precisionConfig
    ).course;
    if (courseData && Array.isArray(courseData.obstacleLabels) && courseData.obstacleLabels.length > 0) {
        return courseData.obstacleLabels;
    }
    return [];
}
function obstaclePenalty() {
    const kp = (precisionConfig.knockdownPenalty != null) ? Number(precisionConfig.knockdownPenalty) : 3;
    return knocks.size * kp;
}

// Ny hjälpfunktion som samlar all live-data
function getLivePayload() {
    const t = getElapsedMs();
    
    const maxSec = computeMaxSecondsForClass(currentEquipage, precisionConfig);
    const rate = (precisionConfig.timePenaltyRate != null) ? Number(precisionConfig.timePenaltyRate) : 0.5;
    const liveTimePenalty = calculatePrecisionTimePenalty(t, maxSec, rate);

    const liveObstaclePenalty = obstaclePenalty();
    const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;

    return {
        running: isRunning,
        inProgress: inProgress,
        liveTimeMs: t,
        // NYA fält för perfekt synkning
        liveStartEpoch: isRunning ? startEpoch : null,
        livePausedMs: pausedMs,
        // ---
        liveTimePenalty: round2(liveTimePenalty),
        liveObstaclePenalty: liveObstaclePenalty,
        extraPenalty: extraPenaltyVal,
        liveTotalPenalty: round2(liveTimePenalty + liveObstaclePenalty + extraPenaltyVal),
        // NYTT:
        eliminated: !!document.getElementById('eliminatedInput').checked
    };
}

// Uppdaterad funktion som använder den nya hjälparen
function pushImmediateState() {
    if (!currentEquipage) return;
    // Anropar den nya funktionen för att få ett komplett och korrekt live-paket
    pushLiveSafe(getLivePayload());
}

function updateObstaclePenaltySummary() {
    const summaryEl = document.getElementById('uiObstaclePenaltySummary');
    if (!summaryEl) return;

    const kp = (precisionConfig.knockdownPenalty != null) ? Number(precisionConfig.knockdownPenalty) : 3;
    const totalP = knocks.size * kp;
    summaryEl.textContent = knocks.size > 0 ? `${knocks.size} st (${totalP} p)` : '';
}

async function saveKnockToggle(gateLabel, shouldAdd, elapsedMs) {
    if (!currentEquipage) return;

    const ref = precisionDocRef(currentEquipage.startNumber);
    const maxSec = computeMaxSecondsForClass(currentEquipage, precisionConfig);
    const rate = (precisionConfig.timePenaltyRate != null) ? Number(precisionConfig.timePenaltyRate) : 0.5;
    const liveTimePenalty = calculatePrecisionTimePenalty(getElapsedMs(), maxSec, rate);
    const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;
    const kp = (precisionConfig.knockdownPenalty != null) ? Number(precisionConfig.knockdownPenalty) : 3;

    const saved = await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        const current = snap.exists() ? snap.data() : {};
        const mergedKnocks = new Set(Array.isArray(current.knocks) ? current.knocks.map(String) : []);
        const mergedTimes = current.knockDownTimes && typeof current.knockDownTimes === 'object'
            ? { ...current.knockDownTimes }
            : {};

        if (shouldAdd) {
            mergedKnocks.add(gateLabel);
            if (!Number.isFinite(Number(mergedTimes[gateLabel]))) {
                mergedTimes[gateLabel] = elapsedMs;
            }
        } else {
            mergedKnocks.delete(gateLabel);
            delete mergedTimes[gateLabel];
        }

        const knocksArray = Array.from(mergedKnocks).sort((a, b) => String(a).localeCompare(String(b), 'sv', { numeric: true }));
        const liveObstaclePenalty = knocksArray.length * kp;
        const liveTotalPenalty = round2(liveTimePenalty + liveObstaclePenalty + extraPenaltyVal);

        transaction.set(ref, {
            startNumber: currentEquipage.startNumber,
            className: currentEquipage.className,
            knocks: knocksArray,
            knockDownTimes: mergedTimes,
            liveObstaclePenalty,
            liveTotalPenalty,
            extraPenalty: extraPenaltyVal,
            updatedAt: Date.now()
        }, { merge: true });

        return { knocksArray, mergedTimes };
    });

    knocks = new Set(saved.knocksArray);
    knockDownTimes = saved.mergedTimes;
}

function stringTimeToMs(label) {
    // "MM:SS,cc" -> ms
    if (!label || typeof label !== 'string') return 0;
    const m = label.match(/^(\d{1,2}):(\d{2}),(\d{2})$/);
    if (!m) return 0;
    const mm = parseInt(m[1], 10), ss = parseInt(m[2], 10), cs = parseInt(m[3], 10);
    return (mm * 60 + ss) * 1000 + cs * 10;
}

// ---------- Firestore live-doc ----------
function precisionDocRef(startNumber) {
    return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`, String(startNumber));
}
async function pushLiveSafe(update) {
    if (!currentEquipage) return;
    try {
        const snapshot = {
            startNumber: currentEquipage.startNumber,
            className: currentEquipage.className,
            ...update,
            updatedAt: Date.now() 
        };
        await setDoc(precisionDocRef(currentEquipage.startNumber), snapshot, { merge: true });
        mirrorToLocal(currentEquipage.startNumber, snapshot);
    } catch (e) {
        console.warn('Live push misslyckades (troligen p.g.a. säkerhetsregler):', e.message);
    }
}

// ---------- UI // ===== NY renderLayout() i precision-input.js =====
function renderLayout() {
    const comp = getGlobalState('currentCompetition');
    const isFieldMode = comp?.competitionMode === 'field';
    const root = document.getElementById('page-precision-input');
    root.innerHTML = `
        <style>
            /* Kompakt mobil-layout för precision */
            @media (max-width: 640px) {
                #page-precision-input .container { padding: 0.5rem; }
                #page-precision-input .main-card { padding: 0.75rem; border-radius: 0; border-left: 0; border-right: 0; }
                
                /* Grid-optimering */
                #gatesGrid {
                    grid-template-columns: repeat(5, 1fr) !important;
                    gap: 0.5rem !important;
                }
                .gateBtn {
                    font-size: 1.125rem !important; /* text-lg */
                    padding: 0 !important;
                    height: 50px !important;
                }
                
                /* Kompakt info-rad */
                #infoEquipageLine { font-size: 0.875rem; }
                .info-meta { font-size: 0.75rem; }
            }

            .sticky-precision-controls {
                position: sticky;
                top: 63px; /* Justera beroende på sidans huvud-header */
                z-index: 40;
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(8px);
                border-bottom: 1px solid #e2e8f0;
                margin-left: -1rem;
                margin-right: -1rem;
                padding: 0.75rem 1rem;
            }
            .dark .sticky-precision-controls {
                background: rgba(31, 41, 55, 0.95);
                border-bottom-color: #374151;
            }
            
            #liveTimer {
                text-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
        </style>

        <div class="container mx-auto p-4 md:p-8 max-w-2xl">
            <div class="mb-4">
                ${getCompetitionHeader(comp, comp?.competitionMode === 'field'
                    ? 'Precision - manuell registrering'
                    : t('precision_header'))}
            </div>
            ${renderCompetitionModeBanner(comp, {
                message: 'Tävlingen körs i fältläge. Tid, rivningar och övriga straff registreras manuellt här.'
            })}

            <!-- STICKY KONTROLLPANEL -->
            <div class="sticky-precision-controls rounded-b-xl shadow-lg mb-4">
                <div class="flex items-center justify-between gap-4">
                    <div class="flex-grow">
                        <div id="liveTimer" class="text-3xl md:text-5xl font-black tabular-nums cursor-pointer dark:text-white leading-none" title="${t('precision_click_to_change_time')}">00:00,00</div>
                        <div class="text-xs md:text-sm mt-1 flex items-center gap-1">
                            <span class="text-gray-500 dark:text-gray-400">${t('precision_time_error')}</span>
                            <span id="uiTimePenaltyTop" class="tabular-nums font-bold dark:text-gray-200">0.00</span>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        ${isFieldMode
                            ? `<button id="btnManualOpen" class="w-28 md:w-36 py-3 text-base md:text-lg font-bold rounded-lg bg-brand-darkblue text-white shadow-sm active:scale-95 transition-all hover:bg-brand-gold hover:text-brand-darkblue">Ange tid</button>`
                            : `<button id="btnStart" class="w-20 md:w-28 py-3 text-base md:text-lg font-bold rounded-lg bg-emerald-600 text-white shadow-sm active:scale-95 transition-all hover:bg-emerald-700">${t('precision_start')}</button>
                        <button id="btnStop" class="w-20 md:w-28 py-3 text-base md:text-lg font-bold rounded-lg bg-red-600 text-white shadow-sm active:scale-95 transition-all hover:bg-red-700">${t('precision_stop')}</button>`}
                    </div>
                </div>

                <!-- Manuell tid-editorn (flytande under timern) -->
                <div id="manualTimeEditor" class="hidden absolute left-4 right-4 mt-2 p-4 rounded-xl border bg-white shadow-2xl z-50 dark:bg-gray-800 dark:border-gray-600">
                    <label class="block text-sm font-semibold mb-2 dark:text-white">${t('precision_manual_time_prompt')}</label>
                    <input id="manualTimeDigits" type="tel" inputmode="numeric" class="w-full text-4xl font-mono tracking-widest text-center px-3 py-4 border-2 rounded-lg mb-4 dark:bg-gray-700 dark:border-gray-600 dark:text-white outline-none focus:border-blue-500" placeholder="mmsscc" maxlength="6" />
                    <div class="flex gap-3">
                        <button id="btnManualApply" class="flex-1 py-3 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700">${t('precision_apply')}</button>
                        <button id="btnManualCancel" class="flex-1 py-3 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300">${t('precision_cancel')}</button>
                    </div>
                </div>
            </div>

            <div class="main-card bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-md space-y-4 border dark:border-gray-700">
                <!-- EKIPAGEVAL -->
                <div class="grid grid-cols-1 gap-4">
                    <div class="flex items-center gap-2">
                        <button id="btnPrevEq" class="p-2 border rounded-md bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">&larr;</button>
                        <div id="precisionEquipageSearchContainer" class="flex-grow"></div>
                        <button id="btnNextEq" class="p-2 border rounded-md bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">&rarr;</button>
                        <button id="btnReset" class="p-2 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400" title="${t('precision_reset')}">🔄</button>
                    </div>
                    
                    <div class="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-800/30">
                        <div id="infoEquipageLine" class="font-bold dark:text-white text-base md:text-lg">–</div>
                        <div class="info-meta text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1 uppercase tracking-wider font-medium">
                            Hinder: <span id="infoPortWidth" class="text-blue-700 dark:text-blue-400">–</span> | 
                            Max: <span id="infoMaxTime" class="text-blue-700 dark:text-blue-400">–</span>
                        </div>
                    </div>
                </div>

                <!-- HINDERGRUPP -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="font-bold uppercase text-xs tracking-widest text-gray-500 dark:text-gray-400">${t('precision_obstacles_gates')}</h3>
                        <span id="uiObstaclePenaltySummary" class="text-xs font-bold text-red-600 dark:text-red-400"></span>
                    </div>
                    <div id="gatesGrid" class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    </div>
                </div>

                <!-- EXTRA / KOMMENTAR -->
                <div class="pt-4 border-t dark:border-gray-700">
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">${t('precision_extra_penalty')}</label>
                            <input type="number" id="extraPenaltyInput" value="0" min="0" class="w-full p-2 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div class="flex items-end">
                            <label class="inline-flex items-center cursor-pointer p-2 border rounded hover:bg-red-50 dark:hover:bg-red-900/20 w-full h-[38px] transition-colors dark:border-gray-600">
                                <input type="checkbox" id="eliminatedInput" class="w-5 h-5 rounded border-gray-300 text-red-600 focus:ring-red-500 dark:bg-gray-700 dark:border-gray-600">
                                <span class="ml-2 font-bold text-red-700 dark:text-red-400 text-xs">${t('precision_elim')}</span>
                            </label>
                        </div>
                        <div class="col-span-2">
                            <label class="block text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">${t('precision_comment')}</label>
                            <textarea id="commentInput" rows="1" class="w-full p-2 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="${t('precision_comment_placeholder')}"></textarea>
                        </div>
                    </div>
                </div>
        
                <!-- SAMMANFATTNING -->
                <div id="penaltySummary" class="flex flex-wrap gap-2 text-[10px] uppercase font-bold">
                    <div class="flex-grow rounded bg-gray-100 px-2 py-1 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 flex justify-between">
                        <span>${t('precision_time_label')}</span><span id="uiTimePenalty" class="tabular-nums dark:text-gray-200">0.00</span>
                    </div>
                    <div class="flex-grow rounded bg-gray-100 px-2 py-1 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 flex justify-between">
                        <span>${t('precision_obstacles_label').replace(':','')}</span><span id="uiObstaclePenalty" class="tabular-nums dark:text-gray-200">0</span>
                    </div>
                    <div class="flex-grow rounded bg-gray-100 px-2 py-1 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 flex justify-between">
                        <span>${t('precision_extra_penalty').split(' ')[0]}</span><span id="uiExtraPenalty" class="tabular-nums dark:text-gray-200">0</span>
                    </div>
                    <div class="w-full text-center rounded bg-blue-600 text-white px-3 py-2 text-sm">
                        TOTALT: <span id="uiTotalPenalty" class="tabular-nums">0.00</span>
                    </div>
                </div>

                <!-- ÅTGÄRDER -->
                <div class="flex flex-col gap-3 pt-2">
                    <button id="btnSave" class="w-full text-lg py-4 bg-brand-darkblue text-white font-bold rounded-xl shadow-lg hover:bg-brand-gold hover:text-brand-darkblue active:scale-[0.98] transition-all dark:bg-blue-600">${t('precision_save_results')}</button>
                    <button id="btnBackupPreJson" type="button" class="text-[10px] text-gray-400 hover:text-blue-500 flex items-center justify-center gap-1">
                        <i class="fas fa-file-download"></i> EXPORTERA JSON (BACKUP)
                    </button>
                </div>

            </div> 
        </div> 
    `;
}

function updateHeaderInfo() {
    const eq = currentEquipage;
    const equipageEl = document.getElementById('infoEquipageLine');
    const portEl = document.getElementById('infoPortWidth');
    const maxEl = document.getElementById('infoMaxTime');

    if (!eq) {
        [equipageEl, portEl, maxEl].forEach(el => { if (el) el.textContent = '–'; });
        return;
    }

    const portWidth = computePortWidthForEquipage(eq);
    const maxSeconds = computeMaxSecondsForClass(eq, precisionConfig);

    equipageEl.textContent = `#${eq.startNumber} ${eq.driverName || ''} (${eq.className})`;
    portEl.textContent = Number.isFinite(portWidth) ? `${portWidth} cm` : t('precision_not_specified');
    maxEl.textContent = Number.isFinite(maxSeconds) ? secondsToMMSS(maxSeconds) : t('precision_not_specified');
}

function renderGates() {
    const host = document.getElementById('gatesGrid');
    if (!host) return;
    const labels = getLabelsForClass(currentEquipage?.className);

    if (labels.length === 0) {
        host.innerHTML = `<p class="text-sm text-gray-500">${t('precision_no_obstacles_defined')}</p>`;
        return;
    }

    host.innerHTML = labels.map(label => {
        const active = knocks.has(label);
        return `<button data-g="${label}" class="gateBtn p-1 aspect-square flex items-center justify-center rounded border text-lg ${active ? 'bg-red-600 text-white' : 'bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white'}">${label}</button>`;
    }).join('');

    host.querySelectorAll('.gateBtn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const g = btn.dataset.g;
            const shouldAdd = !knocks.has(g);
            const elapsedMs = getElapsedMs();

            if (shouldAdd) {
                knocks.add(g);
                knockDownTimes[g] = elapsedMs;
            } else {
                knocks.delete(g);
                delete knockDownTimes[g];
            }

            renderGates();
            updateObstaclePenaltySummary();

            try {
                await saveKnockToggle(g, shouldAdd, elapsedMs);
                renderGates();
                updateObstaclePenaltySummary();
            } catch (err) {
                console.error('Kunde inte spara rivning transaktionssäkert:', err);
                if (shouldAdd) {
                    knocks.delete(g);
                    delete knockDownTimes[g];
                } else {
                    knocks.add(g);
                    knockDownTimes[g] = elapsedMs;
                }
                renderGates();
                updateObstaclePenaltySummary();
                showAlert(t('precision_save_error'), false);
            }
        });
    });
}

// ---------- Timer Controls & Event Handlers ----------

/**
 * renderTimerUI - Uppdaterar ENBART DOM-elementen. 
 * Anropas både av den lokala loopen (updateTimerView) och av onSnapshot-lyssnaren.
 */
function renderTimerUI(t) {
    const parts = msToParts(t);
    const timerStr = partsToString(parts);

    const timerEl = document.getElementById('liveTimer');
    if (timerEl) {
        timerEl.textContent = timerStr;
        // Visuell feedback om vi kört över maxtid (valfritt)
        const maxSec = computeMaxSecondsForClass(currentEquipage, precisionConfig);
        if (maxSec > 0 && (t / 1000) > maxSec) {
            timerEl.classList.add('text-red-600', 'dark:text-red-400');
        } else {
            timerEl.classList.remove('text-red-600', 'dark:text-red-400');
        }
    }

    // --- 2) "Tidsfel" i topp-panelen ---
    const topTP = document.getElementById('uiTimePenaltyTop');
    if (topTP) {
        const maxSec = computeMaxSecondsForClass(currentEquipage, precisionConfig);
        if (maxSec > 0) {
            const rate = (precisionConfig.timePenaltyRate != null) ? Number(precisionConfig.timePenaltyRate) : 0.5;
            const liveTimePenaltyTop = calculatePrecisionTimePenalty(t, maxSec, rate);
            const overLimitNow = (t / 1000) > maxSec;

            topTP.textContent = liveTimePenaltyTop.toFixed(2);
            topTP.classList.toggle('text-red-600', overLimitNow);
            topTP.classList.toggle('dark:text-red-400', overLimitNow);
            topTP.classList.toggle('animate-pulse', overLimitNow);
            topTP.classList.toggle('font-semibold', overLimitNow);
        }
    }

    // --- 3) Summeringspanelen längst ner ---
    const tpEl = document.getElementById('uiTimePenalty');
    const opEl = document.getElementById('uiObstaclePenalty');
    const oiEl = document.getElementById('uiObstacleInfo');
    const epEl = document.getElementById('uiExtraPenalty');
    const ttEl = document.getElementById('uiTotalPenalty');

    if (tpEl || opEl || epEl || ttEl) {
        const maxSec = computeMaxSecondsForClass(currentEquipage, precisionConfig);
        const rate = (precisionConfig.timePenaltyRate != null) ? Number(precisionConfig.timePenaltyRate) : 0.5;
        const liveTimePenalty = calculatePrecisionTimePenalty(t, maxSec, rate);

        const liveObstaclePenalty = obstaclePenalty();
        const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;
        const total = liveTimePenalty + liveObstaclePenalty + extraPenaltyVal;

        if (tpEl) {
            tpEl.textContent = liveTimePenalty.toFixed(2);
            const overLimitNow = maxSec > 0 && (t / 1000) > maxSec;
            tpEl.classList.toggle('text-red-600', overLimitNow);
            tpEl.classList.toggle('dark:text-red-400', overLimitNow);
            tpEl.classList.toggle('animate-pulse', overLimitNow);
            tpEl.classList.toggle('font-semibold', overLimitNow);
        }
        if (opEl) opEl.textContent = Number.isFinite(liveObstaclePenalty) ? liveObstaclePenalty.toFixed(0) : '0';
        if (oiEl) {
            const kp = (precisionConfig.knockdownPenalty != null) ? Number(precisionConfig.knockdownPenalty) : 3;
            const rivningar = Number.isFinite(liveObstaclePenalty) ? Math.round(liveObstaclePenalty / kp) : 0;
            oiEl.textContent = rivningar > 0 ? ` (${rivningar} × ${kp})` : '';
        }
        if (epEl) epEl.textContent = Number.isFinite(extraPenaltyVal) ? extraPenaltyVal.toFixed(2) : '0.00';
        if (ttEl) ttEl.textContent = Number.isFinite(total) ? total.toFixed(2) : '—';
    }

    // --- 4) Summering i hedern (Hinder) ---
    const summaryEl = document.getElementById('uiObstaclePenaltySummary');
    if (summaryEl) {
        const kp = (precisionConfig.knockdownPenalty != null) ? Number(precisionConfig.knockdownPenalty) : 3;
        const totalP = knocks.size * kp;
        summaryEl.textContent = knocks.size > 0 ? `${knocks.size} st (${totalP} p)` : '';
    }
}

/**
 * updateTimerView - Körs av setInterval(). 
 * Sköter både rendering (via renderTimerUI) och den throttlade push-logiken.
 */
function updateTimerView() {
    const t = getElapsedMs();

    // 1. Uppdatera UI
    renderTimerUI(t);

    // 2. Throttlad live-push (~ var 5:e sekund)
    const tick = Math.floor(t / 5000);
    if (tick !== lastPushedTick) {
        lastPushedTick = tick;
        
        const maxSec = computeMaxSecondsForClass(currentEquipage, precisionConfig);
        const rate = (precisionConfig.timePenaltyRate != null) ? Number(precisionConfig.timePenaltyRate) : 0.5;
        const liveTimePenalty = calculatePrecisionTimePenalty(t, maxSec, rate);

        const liveObstaclePenalty = obstaclePenalty();
        const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;

        pushLiveSafe({
            running: !!timerInterval,
            liveStartEpoch: startEpoch,
            livePausedMs: pausedMs, 
            liveTimeMs: t,
            liveTimePenalty: round2(liveTimePenalty),
            liveObstaclePenalty: liveObstaclePenalty,
            extraPenalty: extraPenaltyVal,
            liveTotalPenalty: round2(liveTimePenalty + liveObstaclePenalty + extraPenaltyVal)
        });
    }
}


function startTimer() {
    // Städa upp ev. gammalt interval
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (isRunning) return;

    isRunning = true;
    // Viktigt: starta från "nu" – vi ska INTE baka in pausedMs i startEpoch
    startEpoch = nowMs();

    timerInterval = setInterval(updateTimerView, 90); // ~10 fps i UI
    updateTimerView();     // uppdatera UI direkt
    inProgress = true;     // <-- NYTT
    pushImmediateState();  // meddela resultatvyn att vi kör (och att vi är inProgress)
}
function stopTimer() {
    // Om redan stoppad: pusha ändå läget (running:false)
    if (!isRunning) { pushImmediateState(); return; }

    // Lägg till den körda tiden till den ackumulerade
    pausedMs += (nowMs() - startEpoch);
    isRunning = false;

    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    updateTimerView();     // visa stoppad tid korrekt
    pushImmediateState();  // meddela live: running=false
}

function clearLocalState() {
    stopTimerLocal(); // Stoppa timer men pusha inte
    pausedMs = 0;
    lastPushedTick = -1;
    inProgress = false;
    // Töm UI
    updateTimerView();
}

// Hjälpfunktion för att stoppa lokalt utan att pusha
function stopTimerLocal() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    isRunning = false;
}

function resetTimer() {
    stopTimer();

    // 1. Återställ all lokal state för rundan
    pausedMs = 0;
    lastPushedTick = -1;
    inProgress = false;
    knocks.clear();
    knockDownTimes = {};

    // 2. Nollställ UI-ingångar (om de finns)
    const epInput = document.getElementById('extraPenaltyInput');
    if (epInput) epInput.value = 0;

    const elimInput = document.getElementById('eliminatedInput');
    if (elimInput) elimInput.checked = false;

    const commentInput = document.getElementById('commentInput');
    if (commentInput) commentInput.value = '';

    // 3. Uppdatera UI-visning omedelbart (använd rena render-funktioner)
    renderTimerUI(0);
    renderGates();
    updateHeaderInfo();

    // 4. Meddela Firestore (skicka ett fullständigt "nollställt" läge)
    // Vi skickar med explicit nollställning av "slutgiltiga" fält för att undvika att de hänger kvar i Firestore (merge:true)
    pushLiveSafe({
        ...getLivePayload(),
        knocks: [],
        knockDownTimes: {},
        finalized: false,
        status: t('precision_not_started')
    }).catch((err) => {
        console.error('Fel vid sparning av precision:', err);
        showAlert(t('precision_save_error'), false);
    });
}

// ---------- Lifecycle ----------

export async function load() {
    // Öka load-ID för att ogiltigförklara tidigare anrop
    currentLoadId++;
    const myLoadId = currentLoadId;

    const comp = getGlobalState('currentCompetition');
    const isFieldMode = comp?.competitionMode === 'field';
    competitionId = comp?.id;
    const root = document.getElementById('page-precision-input');
    if (!competitionId) {
        if (root) root.innerHTML = '<p class="p-8 text-center">Ingen tävling vald.</p>';
        return;
    }

    renderLayout();

    try {
        // Wrapper för timeout
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(t('precision_timeout'))), 10000)
        );

        // 1) Hämta rådata med timeout
        const [equipagesRaw, precisionCfg, startTimesData, precisionResults] = await Promise.race([
            Promise.all([
                getEquipages(competitionId),
                getConfig(competitionId, 'precisionConfig'),
                getStartTimes(competitionId),
                getPrecisionResults(competitionId)
            ]),
            timeoutPromise
        ]);

        // Om ett nytt anrop har gjorts medan vi väntade, avbryt tyst
        if (myLoadId !== currentLoadId) {
            return;
        }

        precisionConfig = precisionCfg || {};

        // 2) Normalisera + filtrera + sortera
        equipages = (equipagesRaw || []).map(normalizeEquipage);
        const activeEquipages = equipages.filter(e => e.status !== 'struken');

        const resultsMap = new Map();
        (precisionResults || []).forEach(r => resultsMap.set(String(r.id), r));

        const list = [...activeEquipages].sort((a, b) => {
            const resA = resultsMap.get(String(a.startNumber));
            const resB = resultsMap.get(String(b.startNumber));
            
            const doneA = resA?.finalized === true;
            const doneB = resB?.finalized === true;

            // Sortera efter "klar"-status först (ej klara hamnar överst)
            if (doneA !== doneB) return doneA ? 1 : -1;

            const timeA = (startTimesData && startTimesData[a.startNumber]?.precision) || '99:99';
            const timeB = (startTimesData && startTimesData[b.startNumber]?.precision) || '99:99';
            if (timeA !== timeB) return timeA.localeCompare(timeB);
            return (a.startNumber || 0) - (b.startNumber || 0);
        });

        // 3) Skapa sökbar dropdown med den normaliserade listan
        const searchContainer = document.getElementById('precisionEquipageSearchContainer');
        if (searchContainer) {
            searchableDropdown = createSearchableDropdown(searchContainer, list, onEquipageSelected);
        } else {
            console.error("Search container disappeared!");
        }

        // Request Wake Lock bara i full live-drift
        if (!isFieldMode) {
            await requestWakeLock();
        }

        // Event Listeners
        document.getElementById('btnStart')?.addEventListener('click', startTimer);
        document.getElementById('btnStop')?.addEventListener('click', stopTimer);
        document.getElementById('btnReset')?.addEventListener('click', resetTimer);
        document.getElementById('btnSave').addEventListener('click', saveFinal);
        document.getElementById('extraPenaltyInput').addEventListener('input', () => {
            const t = getElapsedMs();
            const maxSec = computeMaxSecondsForClass(currentEquipage, precisionConfig);
            const rate = (precisionConfig.timePenaltyRate != null) ? Number(precisionConfig.timePenaltyRate) : 0.5;
            const liveTimePenalty = calculatePrecisionTimePenalty(t, maxSec, rate);

            const liveObstaclePenalty = obstaclePenalty();
            const extraPenaltyVal = parseFloat(document.getElementById('extraPenaltyInput').value) || 0;

            pushLiveSafe({
                extraPenalty: extraPenaltyVal,
                liveTotalPenalty: round2(liveTimePenalty + liveObstaclePenalty + extraPenaltyVal)
            });
        });

        // Koppla eliminering till live-uppdatering
        document.getElementById('eliminatedInput').addEventListener('change', () => {
            pushImmediateState();
        });



        const goNext = () => {
            const idx = list.findIndex(e => e.startNumber === currentEquipage?.startNumber);
            if (idx > -1 && idx < list.length - 1) {
                searchableDropdown.setValue(list[idx + 1].startNumber);
            }
        };
        const goPrev = () => {
            const idx = list.findIndex(e => e.startNumber === currentEquipage?.startNumber);
            if (idx > 0) {
                searchableDropdown.setValue(list[idx - 1].startNumber);
            }
        };


        document.getElementById('btnNextEq').addEventListener('click', goNext);
        document.getElementById('btnPrevEq').addEventListener('click', goPrev);
        keydownHandler = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') goPrev();
            if (e.key === 'ArrowRight') goNext();
        };
        window.addEventListener('keydown', keydownHandler);

        document.getElementById('btnBackupPreJson')?.addEventListener('click', () => {
            const backup = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(`bkp_${competitionId}_pre_`)) {
                    backup[key] = JSON.parse(localStorage.getItem(key));
                }
            }
            const filename = `backup_precision_${competitionId}_${new Date().toISOString().split('T')[0]}.json`;
            downloadJson(filename, backup);
        });

        // Manuell tid
        const manualEditor = document.getElementById('manualTimeEditor');
        document.getElementById('btnManualOpen')?.addEventListener('click', () => manualEditor.classList.remove('hidden'));
        document.getElementById('liveTimer').addEventListener('click', () => manualEditor.classList.remove('hidden'));
        document.getElementById('btnManualCancel').addEventListener('click', () => manualEditor.classList.add('hidden'));
        document.getElementById('btnManualApply').addEventListener('click', () => {
            pausedMs = digitsToMs(document.getElementById('manualTimeDigits').value);
            stopTimer();         // garanterar running:false och uppdaterar pausedMs
            updateTimerView();   // visar tiden
            pushImmediateState(); // <-- meddela resultatvyn den nya stoppade tiden
            manualEditor.classList.add('hidden');
        });

        // 4) Kolla om någon kör just nu och välj den
        // Vänta en liten stund så UI hinner "sätta sig"
        if (!isFieldMode) setTimeout(() => autoSelectRunningDriver(), 500);

    } catch (error) {
        // Ignorera fel om vi bytt load-session
        if (myLoadId !== currentLoadId) return;

        console.error("Kunde inte ladda precisionsinmatning:", error);
        const el = document.getElementById('precisionEquipageSearchContainer');
        if (el) el.innerHTML = `<span class="text-red-500 font-bold">${t('precision_load_error_html').replace('{error}', error.message)}</span>`;
        // showAlert("Ett kritiskt fel uppstod vid laddning av sidan.", false);
    }
}

export function __unload() {
    // Avsluta ev. pågående prenumeration
    if (currentUnsubscribe) {
        try { currentUnsubscribe(); } catch (e) { }
        currentUnsubscribe = null;
    }

    // Stoppa timer
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    // Ta bort keydown-lyssnaren med rätt referens
    if (keydownHandler) {
        try { window.removeEventListener('keydown', keydownHandler); } catch { }
        keydownHandler = null;
    }

    // Förstör dropdown om den finns
    if (searchableDropdown && typeof searchableDropdown.destroy === 'function') {
        try { searchableDropdown.destroy(); } catch (e) { console.warn("Destroy dropdown misslyckades:", e); }
    }

    // Nollställ state EFTER att vi förstört komponenter
    isRunning = false;
    currentEquipage = null;
    equipages = [];
    searchableDropdown = null;
}
