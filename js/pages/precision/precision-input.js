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
    arrayUnion,
    arrayRemove,
    deleteField
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { awaitWriteOrQueue, queuedNotice } from '../../utils/offlineWrite.js';
import { getCompetitionHeader, renderCompetitionModeBanner, createSearchableDropdown, showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { downloadJson } from '../../utils/sharedUtils.js';
import { releaseWakeLock, requestWakeLock } from '../../utils/wakeLock.js';
import { PRECISION_KNOCKDOWN_PENALTY } from '../../core-engine/rules-ledger.js';
import {
    computeMaxSecondsForClass,
    calculatePrecisionResult,
    getPortAllowanceCm,
    getPrecisionCourseData,
    computePortWidth,
    isStandardPortWidthClass,
    trackWidthFromEq
} from '../../utils/precisionUtils.js';
import { getCarriageCompliance } from '../shared/vagnbreddUtils.js';
import { readNewestBackupData, writeMergedBackup } from '../../utils/fieldBackup.js';

// ---------- State ----------
let competitionId = null;
let equipages = [];
let precisionConfig = {};
let currentEquipage = null;
let searchableDropdown = null;
let currentUnsubscribe = null;

let knocks = new Set();
let knockDownTimes = {}; // NY: { "3A": 12345, ... }
let extraPenalty = 0;
let comment = '';

let timerInterval = null;
let keydownHandler = null;
let startEpoch = 0;
let pausedMs = 0;
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

function precisionBackupKey(sn) {
    if (!competitionId || !sn) return null;
    return `bkp_${competitionId}_pre_${sn}`;
}

function readPrecisionBackup(sn) {
    return readNewestBackupData([precisionBackupKey(sn)]);
}

// Mirror data to localStorage for redundancy
function mirrorToLocal(sn, data) {
    if (!sn || !data || !competitionId) return;
    try {
        writeMergedBackup(precisionBackupKey(sn), data);
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
    return computePortWidth(eq, precisionConfig);
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
function knockdownPenalty() {
    return (precisionConfig.knockdownPenalty != null) ? Number(precisionConfig.knockdownPenalty) : PRECISION_KNOCKDOWN_PENALTY;
}

// Live penalties for the current equipage at elapsedMs, from the result engine
function livePenalties(elapsedMs, knockList = Array.from(knocks)) {
    const extraPenalty = parseFloat(document.getElementById('extraPenaltyInput')?.value) || 0;
    const calc = calculatePrecisionResult({
        running: true,
        liveTimeMs: elapsedMs,
        knocks: knockList,
        extraPenalty
    }, currentEquipage, precisionConfig);
    return {
        timePenalty: calc.timePenalty ?? 0,
        obstaclePenalty: calc.obstaclePenalty ?? 0,
        extraPenalty,
        totalPenalty: calc.totalPenalty ?? 0,
        maxSec: calc.maxTimeSec
    };
}

function obstaclePenalty() {
    return livePenalties(0).obstaclePenalty;
}

// Ny hjälpfunktion som samlar all live-data
function getLivePayload() {
    const t = getElapsedMs();
    const p = livePenalties(t);

    return {
        running: isRunning,
        inProgress: inProgress,
        liveTimeMs: t,
        // NYA fält för perfekt synkning
        liveStartEpoch: isRunning ? startEpoch : null,
        livePausedMs: pausedMs,
        // ---
        liveTimePenalty: p.timePenalty,
        liveObstaclePenalty: p.obstaclePenalty,
        extraPenalty: p.extraPenalty,
        liveTotalPenalty: p.totalPenalty,
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

    const totalP = obstaclePenalty();
    summaryEl.textContent = knocks.size > 0 ? `${knocks.size} st (${totalP} p)` : '';
}

// One knock (or its removal) for `equipage`, already applied to the local
// state. A merge write with arrayUnion/arrayRemove and a single map key, not a
// transaction: Firestore keeps it on the device without signal (a transaction
// needs the server), and two devices toggling different gates don't overwrite
// each other.
async function saveKnockToggle(equipage, gateLabel, shouldAdd, elapsedMs) {
    if (!equipage) return 'saved';

    const knocksArray = Array.from(knocks).sort((a, b) => String(a).localeCompare(String(b), 'sv', { numeric: true }));
    const {
        obstaclePenalty: liveObstaclePenalty,
        totalPenalty: liveTotalPenalty,
        extraPenalty
    } = livePenalties(getElapsedMs(), knocksArray);

    mirrorToLocal(equipage.startNumber, { knocks: knocksArray, knockDownTimes: { ...knockDownTimes }, updatedAt: Date.now() });
    const write = setDoc(precisionDocRef(equipage.startNumber), {
        startNumber: equipage.startNumber,
        className: equipage.className,
        knocks: shouldAdd ? arrayUnion(gateLabel) : arrayRemove(gateLabel),
        knockDownTimes: { [gateLabel]: shouldAdd ? elapsedMs : deleteField() },
        liveObstaclePenalty,
        liveTotalPenalty,
        extraPenalty,
        updatedAt: Date.now()
    }, { merge: true });
    return awaitWriteOrQueue(write, { onLateError: () => showAlert(t('precision_save_error'), false) });
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
    const equipage = currentEquipage;
    if (!equipage) return;
    try {
        const snapshot = {
            startNumber: equipage.startNumber,
            className: equipage.className,
            ...update,
            updatedAt: Date.now()
        };
        // Backup first: the write's promise waits for the server
        mirrorToLocal(equipage.startNumber, snapshot);
        await setDoc(precisionDocRef(equipage.startNumber), snapshot, { merge: true });
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
            .precision-manual-editor {
                position: absolute;
                left: 1rem;
                right: 1rem;
                margin-top: 0.5rem;
            }

            /* Kompakt mobil-layout för precision */
            @media (max-width: 640px) {
                #page-precision-input .container { padding: 0.5rem; }
                #page-precision-input .main-card { padding: 0.75rem; border-radius: 0.75rem; }
                
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
                .sticky-precision-controls {
                    top: 63px;
                    margin-left: -0.5rem;
                    margin-right: -0.5rem;
                    padding: 0.65rem 0.75rem;
                }
                .precision-control-strip {
                    display: grid !important;
                    grid-template-columns: minmax(0, 1fr) auto;
                    gap: 0.5rem;
                    align-items: stretch;
                }
                .precision-primary-controls {
                    display: grid !important;
                    gap: 0.5rem;
                    min-width: 0;
                }
                .precision-control-strip.is-live .precision-primary-controls {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
                .precision-control-strip.is-field .precision-primary-controls {
                    grid-template-columns: minmax(0, 1fr);
                }
                .precision-main-btn {
                    min-width: 0 !important;
                    width: 100%;
                }
                .precision-action-btn {
                    padding-top: 0.7rem !important;
                    padding-bottom: 0.7rem !important;
                    font-size: 1rem !important;
                }
                .precision-reset-top-btn {
                    width: 3.25rem !important;
                    min-width: 3.25rem !important;
                    min-height: 3.25rem !important;
                    height: auto !important;
                }
                .precision-manual-editor {
                    position: fixed;
                    inset: auto 0.75rem auto 0.75rem;
                    top: 50%;
                    left: 0.75rem;
                    right: 0.75rem;
                    margin-top: 0;
                    transform: translateY(-50%);
                    z-index: 70;
                }
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

            @media (max-width: 1100px) and (orientation: landscape) and (max-height: 760px) {
                #page-precision-input .container {
                    padding: 0.35rem;
                }
                .sticky-precision-controls {
                    top: 0 !important;
                    margin-left: -0.35rem;
                    margin-right: -0.35rem;
                    padding: 0.45rem 0.65rem;
                }
                #liveTimer {
                    font-size: 2.4rem !important;
                    line-height: 0.95;
                }
                .precision-control-strip {
                    display: grid !important;
                    grid-template-columns: minmax(0, 1fr) auto;
                    gap: 0.55rem;
                    align-items: stretch;
                }
                .precision-primary-controls {
                    display: grid !important;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 0.55rem;
                    min-width: 0;
                }
                .precision-control-strip.is-field .precision-primary-controls {
                    grid-template-columns: minmax(0, 1fr);
                }
                .precision-main-btn {
                    min-width: 0 !important;
                    width: 100%;
                }
                .precision-action-btn {
                    min-width: 0 !important;
                    padding-top: 0.55rem !important;
                    padding-bottom: 0.55rem !important;
                    font-size: 0.95rem !important;
                }
                .precision-reset-top-btn {
                    width: 3rem !important;
                    min-width: 3rem !important;
                    min-height: 3rem !important;
                    height: auto !important;
                }
                .precision-nav-btn {
                    padding: 0.55rem !important;
                }
                #gatesGrid {
                    grid-template-columns: repeat(7, 1fr) !important;
                    gap: 0.45rem !important;
                }
                .gateBtn {
                    height: 2.8rem !important;
                    font-size: 1rem !important;
                }
                #btnSave {
                    padding-top: 0.85rem !important;
                    padding-bottom: 0.85rem !important;
                    font-size: 1rem !important;
                }
            }
        </style>

        <div class="container mx-auto p-4 md:p-8 max-w-2xl">
            <div class="mb-4">
                ${getCompetitionHeader(comp, comp?.competitionMode === 'field'
                    ? 'Precision - manuell registrering'
                    : t('precision_header'), { quickGuideRole: 'precision' })}
            </div>
            ${renderCompetitionModeBanner(comp, {
                message: 'Tävlingen körs i fältläge. Tid, rivningar och övriga straff registreras manuellt här.'
            })}

            <!-- STICKY KONTROLLPANEL -->
            <div class="sticky-precision-controls rounded-b-xl shadow-lg mb-4">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div class="flex-grow min-w-0">
                        <div id="liveTimer" class="text-3xl md:text-5xl font-black tabular-nums cursor-pointer dark:text-white leading-none" title="${t('precision_click_to_change_time')}">00:00,00</div>
                        <div class="text-xs md:text-sm mt-1 flex items-center gap-1">
                            <span class="text-gray-500 dark:text-gray-400">${t('precision_time_error')}</span>
                            <span id="uiTimePenaltyTop" class="tabular-nums font-bold dark:text-gray-200">0.00</span>
                        </div>
                    </div>
                    <div class="precision-control-strip ${isFieldMode ? 'is-field' : 'is-live'} flex gap-2 sm:shrink-0">
                        <div class="precision-primary-controls flex gap-2">
                        ${isFieldMode
                            ? `<button id="btnManualOpen" class="precision-action-btn precision-main-btn flex-1 sm:flex-none w-full sm:w-32 md:w-36 py-3 text-base md:text-lg font-bold rounded-lg bg-brand-darkblue text-white shadow-sm active:scale-95 transition-all hover:bg-brand-gold hover:text-brand-darkblue">Ange tid</button>`
                            : `<button id="btnStart" class="precision-action-btn precision-main-btn flex-1 sm:flex-none w-full sm:w-20 md:w-28 py-3 text-base md:text-lg font-bold rounded-lg bg-emerald-600 text-white shadow-sm active:scale-95 transition-all hover:bg-emerald-700">${t('precision_start')}</button>
                        <button id="btnStop" class="precision-action-btn precision-main-btn flex-1 sm:flex-none w-full sm:w-20 md:w-28 py-3 text-base md:text-lg font-bold rounded-lg bg-red-600 text-white shadow-sm active:scale-95 transition-all hover:bg-red-700">${t('precision_stop')}</button>`}
                        </div>
                        <button id="btnResetTop" class="precision-nav-btn precision-reset-top-btn p-2 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400" title="${t('precision_reset')}">🔄</button>
                    </div>
                </div>

                <!-- Manuell tid-editorn (flytande under timern) -->
                <div id="manualTimeEditor" class="precision-manual-editor hidden p-4 rounded-xl border bg-white shadow-2xl z-50 dark:bg-gray-800 dark:border-gray-600">
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
                    <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-center">
                        <button id="btnPrevEq" class="precision-nav-btn p-2 border rounded-md bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">&larr;</button>
                        <div id="precisionEquipageSearchContainer" class="min-w-0"></div>
                        <button id="btnNextEq" class="precision-nav-btn p-2 border rounded-md bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">&rarr;</button>
                    </div>
                    
                    <div class="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-800/30">
                        <div class="flex flex-wrap items-center gap-2">
                            <div id="infoEquipageLine" class="font-bold dark:text-white text-base md:text-lg">–</div>
                            <div id="infoCarriageWarning" class="inline-flex"></div>
                        </div>
                        <div class="info-meta text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1 uppercase tracking-wider font-medium">
                            Hinder: <span id="infoPortWidth" class="text-blue-700 dark:text-blue-400 font-bold">–</span> | 
                            Vagn: <span id="infoTrackWidth" class="text-gray-700 dark:text-gray-300 font-semibold">–</span> | 
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
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        <div class="sm:col-span-2">
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
    const trackEl = document.getElementById('infoTrackWidth');
    const maxEl = document.getElementById('infoMaxTime');
    const warningEl = document.getElementById('infoCarriageWarning');

    if (!eq) {
        [equipageEl, portEl, trackEl, maxEl].forEach(el => { if (el) el.textContent = '–'; });
        if (warningEl) warningEl.innerHTML = '';
        return;
    }

    const isStandard = isStandardPortWidthClass(eq, precisionConfig);
    const portWidth = computePortWidthForEquipage(eq);
    const trackWidth = trackWidthFromEq(eq);
    const maxSeconds = computeMaxSecondsForClass(eq, precisionConfig);
    const compliance = getCarriageCompliance(eq, 'dressagePrecision');

    if (equipageEl) {
        equipageEl.textContent = `#${eq.startNumber} ${eq.driverName || ''} (${eq.className})`;
    }

    if (portEl) {
        if (Number.isFinite(portWidth)) {
            portEl.textContent = `${portWidth} cm${isStandard ? ' (Standard)' : ''}`;
        } else {
            portEl.textContent = t('precision_not_specified') || 'Ej angivet';
        }
    }

    if (trackEl) {
        trackEl.textContent = Number.isFinite(trackWidth) ? `${trackWidth} cm` : 'Ej mätt';
    }

    if (maxEl) {
        maxEl.textContent = Number.isFinite(maxSeconds) ? secondsToMMSS(maxSeconds) : t('precision_not_specified');
    }

    if (warningEl) {
        if (compliance.status === 'too_narrow') {
            warningEl.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" title="${compliance.message}">⚠️ Vagn ${compliance.actualWidth}cm (< min ${compliance.minWidth}cm)</span>`;
        } else if (compliance.status === 'forbidden') {
            warningEl.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" title="${compliance.message}">⛔ Ej tillåten (TR Bilaga 2)</span>`;
        } else if (compliance.safetyApproved === false) {
            warningEl.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" title="Funktionskontroll underkänd">⚠️ Ej godkänd vagnkontroll</span>`;
        } else {
            warningEl.innerHTML = '';
        }
    }
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
            const equipage = currentEquipage;
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
                await saveKnockToggle(equipage, g, shouldAdd, elapsedMs);
            } catch (err) {
                console.error('Kunde inte spara rivning:', err);
                // Undo only on the equipage it was made for
                if (currentEquipage !== equipage) return;
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

    const live = livePenalties(t);

    // --- 2) "Tidsfel" i topp-panelen ---
    const topTP = document.getElementById('uiTimePenaltyTop');
    if (topTP) {
        const maxSec = live.maxSec;
        if (maxSec > 0) {
            const overLimitNow = (t / 1000) > maxSec;

            topTP.textContent = live.timePenalty.toFixed(2);
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
        const maxSec = live.maxSec;
        const liveTimePenalty = live.timePenalty;
        const liveObstaclePenalty = live.obstaclePenalty;
        const extraPenaltyVal = live.extraPenalty;
        const total = live.totalPenalty;

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
            const kp = knockdownPenalty();
            const rivningar = Number.isFinite(liveObstaclePenalty) ? Math.round(liveObstaclePenalty / kp) : 0;
            oiEl.textContent = rivningar > 0 ? ` (${rivningar} × ${kp})` : '';
        }
        if (epEl) epEl.textContent = Number.isFinite(extraPenaltyVal) ? extraPenaltyVal.toFixed(2) : '0.00';
        if (ttEl) ttEl.textContent = Number.isFinite(total) ? total.toFixed(2) : '—';
    }

    // --- 4) Summering i hedern (Hinder) ---
    const summaryEl = document.getElementById('uiObstaclePenaltySummary');
    if (summaryEl) {
        const totalP = live.obstaclePenalty;
        summaryEl.textContent = knocks.size > 0 ? `${knocks.size} st (${totalP} p)` : '';
    }
}

/**
 * updateTimerView - Körs av setInterval() och uppdaterar bara skärmen.
 * Ingen periodisk live-push: tittarna räknar tiden själva från liveStartEpoch,
 * och start, stopp, rivning och paus skickas direkt (pushImmediateState).
 */
function updateTimerView() {
    renderTimerUI(getElapsedMs());
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
    clearFormDirty();

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
        // The saved time and comment of the round being reset go too
        timeMs: null,
        comment: '',
        status: t('precision_not_started')
    }).catch((err) => {
        console.error('Fel vid sparning av precision:', err);
        showAlert(t('precision_save_error'), false);
    });
}

function applyLiveDocToState(data = null) {
    const payload = data && typeof data === 'object' ? data : {};
    const liveStartEpoch = Number(payload.liveStartEpoch);
    const livePausedMs = Number(payload.livePausedMs);
    // The clock's current time is liveTimeMs (every stop, knock, correction and
    // the secretariat write it); timeMs is the last saved final time and only
    // counts once the result is finalized. Preferring timeMs made an old saved
    // time come back after a reset or a correction.
    const storedTimeMs = Number(payload.finalized === true
        ? (payload.timeMs ?? payload.liveTimeMs ?? 0)
        : (payload.liveTimeMs ?? payload.timeMs ?? 0));

    knocks = new Set(Array.isArray(payload.knocks) ? payload.knocks.map(String) : []);
    knockDownTimes = payload.knockDownTimes && typeof payload.knockDownTimes === 'object'
        ? { ...payload.knockDownTimes }
        : {};

    extraPenalty = Number(payload.extraPenalty || 0);
    comment = String(payload.comment || '');
    inProgress = payload.inProgress === true || payload.running === true || storedTimeMs > 0;
    isRunning = payload.running === true && Number.isFinite(liveStartEpoch);

    if (isRunning) {
        startEpoch = liveStartEpoch;
        pausedMs = Number.isFinite(livePausedMs) ? livePausedMs : 0;
        if (!timerInterval) {
            timerInterval = setInterval(updateTimerView, 90);
        }
    } else {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        startEpoch = 0;
        pausedMs = Number.isFinite(storedTimeMs)
            ? storedTimeMs
            : (Number.isFinite(livePausedMs) ? livePausedMs : 0);
    }

    const extraPenaltyInput = document.getElementById('extraPenaltyInput');
    if (extraPenaltyInput && !isUserEditing(extraPenaltyInput)) extraPenaltyInput.value = String(extraPenalty);

    const eliminatedInput = document.getElementById('eliminatedInput');
    if (eliminatedInput && !isUserEditing(eliminatedInput)) eliminatedInput.checked = payload.eliminated === true;

    const commentInput = document.getElementById('commentInput');
    if (commentInput && !isUserEditing(commentInput)) commentInput.value = comment;

    updateHeaderInfo();
    renderGates();
    updateObstaclePenaltySummary();
    renderTimerUI(getElapsedMs());
}

function resetSelectionUi() {
    if (currentUnsubscribe) {
        try { currentUnsubscribe(); } catch { }
        currentUnsubscribe = null;
    }

    stopTimerLocal();
    startEpoch = 0;
    pausedMs = 0;
    inProgress = false;
    knocks = new Set();
    knockDownTimes = {};
    extraPenalty = 0;
    comment = '';
    clearFormDirty();
    wireFormDirtyTracking();

    const extraPenaltyInput = document.getElementById('extraPenaltyInput');
    if (extraPenaltyInput) extraPenaltyInput.value = '0';

    const eliminatedInput = document.getElementById('eliminatedInput');
    if (eliminatedInput) eliminatedInput.checked = false;

    const commentInput = document.getElementById('commentInput');
    if (commentInput) commentInput.value = '';

    updateHeaderInfo();
    renderGates();
    updateObstaclePenaltySummary();
    renderTimerUI(0);
}

function subscribeToPrecisionDoc(startNumber) {
    if (currentUnsubscribe) {
        try { currentUnsubscribe(); } catch { }
        currentUnsubscribe = null;
    }

    currentUnsubscribe = onSnapshot(
        precisionDocRef(startNumber),
        (snap) => {
            const liveData = snap.exists() ? snap.data() : readPrecisionBackup(startNumber);
            if (snap.exists() && liveData) mirrorToLocal(startNumber, liveData);
            applyLiveDocToState(liveData);
        },
        (error) => {
            console.error('Kunde inte lyssna på precisiondokument:', error);
            applyLiveDocToState(readPrecisionBackup(startNumber));
        }
    );
}

async function onEquipageSelected(eq) {
    currentEquipage = eq || null;

    if (!currentEquipage) {
        resetSelectionUi();
        return;
    }

    resetSelectionUi();
    currentEquipage = eq;
    updateHeaderInfo();
    renderGates();
    subscribeToPrecisionDoc(currentEquipage.startNumber);

    try {
        const snap = await getDoc(precisionDocRef(currentEquipage.startNumber));
        if (currentEquipage?.startNumber !== eq.startNumber) return;
        const liveData = snap.exists() ? snap.data() : readPrecisionBackup(currentEquipage.startNumber);
        if (snap.exists() && liveData) mirrorToLocal(currentEquipage.startNumber, liveData);
        applyLiveDocToState(liveData);
    } catch (error) {
        console.warn('Kunde inte läsa precisiondokument för valt ekipage:', error);
        applyLiveDocToState(readPrecisionBackup(currentEquipage.startNumber));
    }
}

async function autoSelectRunningDriver() {
    if (!competitionId || !searchableDropdown) return;

    try {
        const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
        const q = query(colRef, where('running', '==', true));
        const snap = await getDocs(q);

        if (!snap.empty) {
            searchableDropdown.setValue(Number(snap.docs[0].id));
        }
    } catch (error) {
        console.warn('Kunde inte auto-välja aktiv precisionsekipage:', error);
    }
}

async function saveFinal() {
    if (!currentEquipage) {
        showAlert(t('precision_select_equipage_first') || 'Välj ekipage först.', false);
        return;
    }

    stopTimer();

    const timeMs = Math.max(0, Math.round(getElapsedMs()));
    const obstaclePenaltyValue = obstaclePenalty();
    const extraPenaltyValue = parseFloat(document.getElementById('extraPenaltyInput')?.value) || 0;
    const eliminated = !!document.getElementById('eliminatedInput')?.checked;
    const commentValue = document.getElementById('commentInput')?.value?.trim() || '';
    const knocksArray = Array.from(knocks).sort((a, b) => String(a).localeCompare(String(b), 'sv', { numeric: true }));
    // Penalties come from the result engine (rate incl. competition rule settings)
    const calc = calculatePrecisionResult({
        timeMs,
        liveTimeMs: timeMs,
        knocks: knocksArray,
        obstaclePenalty: obstaclePenaltyValue,
        extraPenalty: extraPenaltyValue,
        eliminated
    }, currentEquipage, precisionConfig);
    // Without a max time for the class (configMissing) the engine gives no time
    // penalty and no total: save them empty, not as 0, and never as 'Klar'
    const timePenalty = calc.configMissing ? null : (calc.timePenalty ?? 0);
    const totalPenalty = calc.configMissing ? null : (calc.totalPenalty ?? 0);
    const hasAnyData = eliminated || timeMs > 0 || knocksArray.length > 0 || extraPenaltyValue > 0 || commentValue.length > 0;

    const payload = {
        startNumber: currentEquipage.startNumber,
        className: currentEquipage.className,
        running: false,
        inProgress: false,
        liveStartEpoch: null,
        livePausedMs: timeMs,
        liveTimeMs: timeMs,
        timeMs,
        timePenalty,
        liveTimePenalty: timePenalty,
        obstaclePenalty: obstaclePenaltyValue,
        liveObstaclePenalty: obstaclePenaltyValue,
        extraPenalty: extraPenaltyValue,
        totalPenalty,
        liveTotalPenalty: totalPenalty,
        knocks: knocksArray,
        knockDownTimes: { ...knockDownTimes },
        eliminated,
        comment: commentValue,
        status: eliminated ? 'Utesluten' : (calc.configMissing ? 'Pågår' : (hasAnyData ? 'Klar' : t('precision_not_started'))),
        updatedAt: Date.now()
    };

    // The save belongs to this equipage even if the judge moves on before the
    // server answers; backup before the write, since its promise waits for the server
    const equipage = currentEquipage;
    if (saveInFlight) return;
    saveInFlight = true;
    mirrorToLocal(equipage.startNumber, payload);
    clearFormDirty();
    if (currentEquipage === equipage) applyLiveDocToState(payload);
    try {
        const result = await awaitWriteOrQueue(
            setDoc(precisionDocRef(equipage.startNumber), payload, { merge: true }),
            { onLateError: () => showAlert(`#${equipage.startNumber}: ${t('precision_save_error')}`, false) }
        );
        const message = calc.configMissing ? t('precision_saved_course_missing') : t('precision_save_success');
        showAlert(`${message}${queuedNotice(result)}`, result === 'queued' ? 'offline' : !calc.configMissing);
    } catch (error) {
        console.error('Kunde inte spara precisionresultatet:', error);
        showAlert(t('precision_save_error'), false);
    } finally {
        saveInFlight = false;
    }
}

let saveInFlight = false;

// Fields the judge types in: a snapshot (also the 5 s live push while the
// clock runs) must not replace what is being typed
const FORM_FIELD_IDS = ['commentInput', 'extraPenaltyInput', 'eliminatedInput'];

function isUserEditing(el) {
    return !!el && (el.dataset.dirty === '1' || document.activeElement === el);
}

function clearFormDirty() {
    FORM_FIELD_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) delete el.dataset.dirty;
    });
}

function wireFormDirtyTracking() {
    FORM_FIELD_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.dirtyWired) return;
        el.dataset.dirtyWired = '1';
        el.addEventListener('input', () => { el.dataset.dirty = '1'; });
        el.addEventListener('change', () => { el.dataset.dirty = '1'; });
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
        document.getElementById('btnResetTop')?.addEventListener('click', () => {
            // A slip must not wipe the round's time and knockdowns
            if (window.confirm(t('precision_confirm_reset'))) resetTimer();
        });
        document.getElementById('btnSave').addEventListener('click', saveFinal);
        document.getElementById('extraPenaltyInput').addEventListener('input', () => {
            const p = livePenalties(getElapsedMs());
            pushLiveSafe({
                extraPenalty: p.extraPenalty,
                liveTotalPenalty: p.totalPenalty
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
            // Stop first, then set the time: stopTimer() would add the time
            // the clock ran to the time just typed
            stopTimerLocal();
            startEpoch = 0;
            pausedMs = digitsToMs(document.getElementById('manualTimeDigits').value);
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
  releaseWakeLock();
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
