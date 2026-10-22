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
    getDocFromServer,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
    arrayUnion,
    arrayRemove,
    deleteField,
    increment
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { awaitWriteOrQueue, queuedNotice } from '../../utils/offlineWrite.js';
import { reportRejectedWrite } from '../../services/rejectedWritesService.js';
import { getCompetitionHeader, renderCompetitionModeBanner, createSearchableDropdown, showAlert, renderNoCompetitionState } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { registerUnsavedWork } from '../../utils/unsavedWork.js';
import { downloadJson, escapeHtml } from '../../utils/sharedUtils.js';
import { releaseWakeLock, requestWakeLock } from '../../utils/wakeLock.js';
import { PRECISION_KNOCKDOWN_PENALTY } from '../../core-engine/rules-ledger.js';
import {
    calculatePrecisionResult,
    getPortAllowanceCm,
    getPrecisionCourseData,
    computePortWidth,
    isStandardPortWidthClass,
    trackWidthFromEq
} from '../../utils/precisionUtils.js';
import { getCarriageCompliance } from '../shared/vagnbreddUtils.js';
import { readNewestBackupData, writeMergedBackup } from '../../utils/fieldBackup.js';
import { serverNow, setServerClockHold, startServerClockSync, stopServerClockSync } from '../../utils/serverClock.js';
import {
    buildPrecisionSavePayload,
    checkPrecisionClock,
    clockFaultMessage,
    gateGridColumns,
    buildPhase1FinishWrite,
    penaltyCorrection,
    phase2HasData,
    rebuildLabel,
    shouldPushStop,
    sortKnocks,
    storedRebuildCount,
    storedRoundTimeMs
} from './precisionInputUtils.js';
import {
    calculatePrecisionRoundResult,
    computePrecisionRoundMaxSec,
    formatPrecisionAddedTime,
    getPrecisionFormat,
    getPrecisionRoundObstacleLabels,
    isPrecisionDriveOffScheduled,
    nextPrecisionRebuildCount,
    precisionRebuildCount
} from '../../utils/precisionCalculation.js';
import {
    PRECISION_ROUND_WARNING_TEXT,
    buildPrecisionKnockWrite,
    buildPrecisionRebuildWrite,
    buildPrecisionRoundClearWrite,
    buildPrecisionRoundRetireWrite,
    canStartPrecisionRound,
    nestPrecisionRoundPayload,
    precisionRoundsForFormat,
    readPrecisionRound
} from '../../utils/precisionRounds.js';
import { precisionGroupContext } from '../../core-engine/ranking.js';
import { getClassRuleProfile } from '../../core-engine/marathon.js';
import {
    buildQualifiedSummary,
    driveOffStartList,
    pickPrecisionRound,
    precisionGroupKeyFn,
    precisionRoundLabelKey,
    precisionWarningKey,
    roundOnSelect
} from './precisionRoundInput.js';
import { loadMergeSource } from '../../services/mergeConfigService.js';
import { createConnectionBanner, resilientSnapshot } from '../../services/listenerErrorUtils.js';

import { syncVetStrikeChip } from '../../ui/vetStrikeChip.js';

// ---------- State ----------
let competitionId = null;
let equipages = [];
let precisionConfig = {};
let currentEquipage = null;
let searchableDropdown = null;
let currentUnsubscribe = null;

// Round formats (two phases, drive-off): the round shown and driven. All state
// below (clock, knocks, rebuilds, extra, comment) belongs to this round; phase 1
// is the doc's top level, the others rounds.<round>.
let currentRound = 'phase1';
let marathonConfig = null; // rule profile (TR/FEI) per class
let groupKeyOf = (e) => `CLASS:${e?.className || ''}`; // placing group (merged classes), as the results page
let startTimesMap = {};
let precisionResultsMap = new Map(); // sn -> stored doc, live (only with round formats)
let resultsUnsubscribe = null;
let fullEquipageList = []; // the dropdown's list for the initial round

let knocks = new Set();
let knockDownTimes = {}; // NY: { "3A": 12345, ... }
let extraPenalty = 0;
let comment = '';
let rebuildCount = 0; // obstacle rebuilds, +10 s each (stored doc's rebuildCount)

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
// Server time: liveStartEpoch is shared, and the clock may be stopped on
// another device than the one that started it
const nowMs = () => serverNow();

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
// The running clock checked against its start: a start that is missing, in
// the future or far too long ago gives { ok: false } and the paused time
function clockCheck() {
    if (!isRunning) return { ok: true, elapsedMs: pausedMs };
    return checkPrecisionClock({
        startEpoch,
        pausedMs,
        nowMs: nowMs(),
        maxSec: roundMaxSec()
    });
}

// ---------- Round helpers ----------
const calcOptions = () => ({ marathonConfig });
const ruleProfileOf = (eq) => getClassRuleProfile(eq?.className, marathonConfig);

// The current round's max time / Time Allowed in seconds (null without course data)
function roundMaxSec(eq = currentEquipage, round = currentRound) {
    if (!eq) return null;
    return computePrecisionRoundMaxSec(eq, precisionConfig, round, { ruleProfile: ruleProfileOf(eq) });
}

function equipageFormat(eq = currentEquipage) {
    return eq ? getPrecisionFormat(eq, precisionConfig) : 'normal';
}

// The rounds the equipage's class drives, in order
function roundsFor(eq = currentEquipage) {
    if (!eq) return ['phase1'];
    return precisionRoundsForFormat(equipageFormat(eq), { driveOffScheduled: isPrecisionDriveOffScheduled(eq, precisionConfig) });
}

// The result engine's view of the stored doc (qualification, warnings)
function storedResult(eq = currentEquipage) {
    if (!eq) return null;
    const stored = storedDocFor(eq.startNumber) || readPrecisionBackup(eq.startNumber) || {};
    return calculatePrecisionResult(stored, eq, precisionConfig, calcOptions());
}

// The equipage's stored fields of the round shown
const roundFields = (data) => readPrecisionRound(data, currentRound);

// Scoring of a round's own calculation: 'time' rounds count seconds
const calcUnit = (calc) => (calc?.scoring === 'time' ? ' s' : '');

function getElapsedMs() {
    // Elapsad tid = ackumulerad pausad tid + tid sedan senaste start
    return clockCheck().elapsedMs;
}

// A typed time ("mmsscc" or "mm:ss,cc") → ms, or null when it is empty, zero
// or not a time (seconds ≥ 60), as on the marathon pages: empty input was
// stored as 0.00 and "0175" as 1:75
function parseManualTimeMs(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    let mm, ss, cs;
    const sep = s.match(/^(\d{1,2})[:.](\d{1,2})(?:[,.](\d{1,2}))?$/);
    if (sep) {
        mm = +sep[1]; ss = +sep[2]; cs = sep[3] ? +sep[3].padEnd(2, '0') : 0;
    } else if (/^\d{1,6}$/.test(s)) {
        const d = s.padEnd(6, '0');
        mm = +d.slice(0, 2); ss = +d.slice(2, 4); cs = +d.slice(4, 6);
    } else {
        return null;
    }
    if (ss >= 60) return null;
    const ms = (mm * 60 + ss) * 1000 + cs * 10;
    return ms > 0 ? ms : null;
}

function precisionBackupKey(sn) {
    if (!competitionId || !sn) return null;
    return `bkp_${competitionId}_pre_${sn}`;
}

function readPrecisionBackup(sn) {
    return readNewestBackupData([precisionBackupKey(sn)]);
}

// Firestore sentinels for the round write builders (precisionRounds.js)
const FS = { arrayUnion, arrayRemove, increment, deleteField };

// Backup of one round's fields: phase 1 on the top level, the others under
// rounds.<round> (the backup merge is shallow, so the rounds map is merged here)
function mirrorRound(sn, round, fields) {
    if (!sn || !competitionId) return;
    if (round === 'phase1') { mirrorToLocal(sn, fields); return; }
    const existing = readPrecisionBackup(sn);
    mirrorToLocal(sn, { rounds: { ...(existing?.rounds || {}), [round]: { ...(existing?.rounds?.[round] || {}), ...fields } } });
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
    // Phase 2 and the drive-off have their own cones (drive-off: the initial round's when none)
    if (currentRound !== 'phase1' && currentEquipage) {
        return getPrecisionRoundObstacleLabels(currentEquipage, precisionConfig, currentRound);
    }
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
    const extraPenalty = parseFloat(document.getElementById('pr-extraPenaltyInput')?.value) || 0;
    const calc = calculatePrecisionRoundResult({
        running: true,
        liveTimeMs: elapsedMs,
        knocks: knockList,
        rebuildCount,
        extraPenalty
    }, currentEquipage, precisionConfig, currentRound, calcOptions());
    return {
        timePenalty: calc.timePenalty ?? 0,
        obstaclePenalty: calc.obstaclePenalty ?? 0,
        extraPenalty,
        totalPenalty: calc.totalPenalty ?? 0,
        maxSec: calc.maxTimeSec,
        scoring: calc.scoring || 'fault'
    };
}

function obstaclePenalty() {
    return livePenalties(0).obstaclePenalty;
}

// The clock's live fields (start, stop, manual time). Never the form fields
// (extra penalty, eliminated): each is pushed by its own input, so a clock
// push from this device cannot overwrite what another device entered. Nor
// inProgress: a start sets it, a save clears it, and a late Stop (queued
// offline) must not mark a saved round unsaved again.
function getClockPayload() {
    const t = getElapsedMs();
    const p = livePenalties(t);

    return {
        running: isRunning,
        liveTimeMs: t,
        liveStartEpoch: isRunning ? startEpoch : null,
        livePausedMs: pausedMs,
        liveTimePenalty: p.timePenalty,
        liveObstaclePenalty: p.obstaclePenalty,
        liveTotalPenalty: p.totalPenalty
    };
}

// The stored fields of the round shown for the selected equipage (latest snapshot)
function storedRoundOfCurrent() {
    return roundFields(storedDocFor(currentEquipage?.startNumber) || {});
}

function updateObstaclePenaltySummary() {
    const summaryEl = document.getElementById('pr-uiObstaclePenaltySummary');
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

    const knocksArray = sortKnocks(Array.from(knocks));
    const {
        obstaclePenalty: liveObstaclePenalty,
        totalPenalty: liveTotalPenalty
    } = livePenalties(getElapsedMs(), knocksArray);

    const round = currentRound;
    mirrorRound(equipage.startNumber, round, { knocks: knocksArray, knockDownTimes: { ...knockDownTimes }, updatedAt: Date.now() });
    // The result engine counts the stored knock list (a legacy stored obstacle
    // penalty is removed too). A cone hit in phase 2 counts in phase 2 (round
    // path). The extra penalty is not sent along: another device's entry stays.
    const write = setDoc(precisionDocRef(equipage.startNumber), buildPrecisionKnockWrite({
        round,
        gate: gateLabel,
        add: shouldAdd,
        elapsedMs,
        liveObstaclePenalty,
        liveTotalPenalty,
        startNumber: equipage.startNumber,
        className: equipage.className
    }, FS), { merge: true });
    return awaitWriteOrQueue(write, { onLateError: lateRejection(equipage.startNumber, { gate: gateLabel, knock: shouldAdd, elapsedMs, round }, 'precision-input:knock') });
}

// The rebuild count next to the clock, and the undo only when there is one
function renderRebuildInfo() {
    const info = document.getElementById('pr-rebuildInfo');
    if (info) {
        info.textContent = rebuildLabel(rebuildCount);
        info.title = formatPrecisionAddedTime(rebuildCount);
    }
    document.getElementById('pr-btnRebuildUndo')?.classList.toggle('hidden', rebuildCount <= 0);
}

// "+10 s (ombyggnad)" and its undo: only the rebuildCount field, so a
// knock or a save from another device is not overwritten. Adding is an
// atomic increment (two devices pressing at once both count); the undo
// writes the count one lower, never below 0. Works running and stopped.
async function changeRebuildCount(delta) {
    const equipage = currentEquipage;
    if (!equipage) {
        showAlert(t('precision_select_equipage_first') || 'Välj ekipage först.', false);
        return;
    }
    if (delta < 0 && rebuildCount <= 0) return;
    const next = nextPrecisionRebuildCount(rebuildCount, delta);
    rebuildCount = next;
    renderRebuildInfo();
    updateTimerView();
    const round = currentRound;
    mirrorRound(equipage.startNumber, round, { rebuildCount: next, updatedAt: Date.now() });
    try {
        await awaitWriteOrQueue(
            setDoc(precisionDocRef(equipage.startNumber), buildPrecisionRebuildWrite({
                round,
                delta,
                next,
                startNumber: equipage.startNumber,
                className: equipage.className
            }, FS), { merge: true }),
            { onLateError: lateRejection(equipage.startNumber, { rebuildCount: next, round }, 'precision-input:rebuild') }
        );
    } catch (error) {
        reportWriteError(equipage.startNumber, error);
    }
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
// A refused write is shown, but at most once every few seconds (the extra
// penalty field pushes on every keystroke)
let lastWriteErrorAt = 0;
function reportWriteError(startNumber, error) {
    console.warn('Precision: skrivningen nekades:', error?.message || error);
    const now = Date.now();
    if (now - lastWriteErrorAt < 5000) return;
    lastWriteErrorAt = now;
    showAlert(`#${startNumber}: ${t('precision_save_error')}`, false);
}

// onLateError for a queued write: shown as above and recorded for the
// secretariat (rejectedWrites). Live pushes repeat every few seconds, so one
// entry per start number and source a minute is enough.
const lastRejectionReportAt = new Map();
function lateRejection(startNumber, summary, source = 'precision-input') {
    const cid = competitionId;
    return (error) => {
        reportWriteError(startNumber, error);
        const key = `${cid}|${startNumber}|${source}`;
        const now = Date.now();
        if (now - (lastRejectionReportAt.get(key) || 0) < 60000) return;
        lastRejectionReportAt.set(key, now);
        reportRejectedWrite(cid, { discipline: 'precision', startNumber, payloadSummary: summary, error, source });
    };
}

// Start, stop, penalties and the like: answers 'saved' or 'queued' after a
// short wait (offline), a refusal is shown to the judge, also a late one.
// Never rejects.
// `top` fields (activeRound on a start) go on the doc's top level; the update
// itself goes to the round shown (top level for phase 1, rounds.<round> else)
async function pushLiveSafe(update, top = {}) {
    const equipage = currentEquipage;
    if (!equipage) return null;
    const round = currentRound;
    const now = Date.now();
    const snapshot = nestPrecisionRoundPayload(round, { ...update, updatedAt: now }, {
        startNumber: equipage.startNumber,
        className: equipage.className,
        updatedAt: now,
        ...top
    });
    // Backup first: the write's promise waits for the server
    mirrorRound(equipage.startNumber, round, { ...update, updatedAt: now });
    try {
        return await awaitWriteOrQueue(
            setDoc(precisionDocRef(equipage.startNumber), snapshot, { merge: true }),
            { onLateError: lateRejection(equipage.startNumber, update, 'precision-input:live') }
        );
    } catch (e) {
        reportWriteError(equipage.startNumber, e);
        return null;
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
                /* Gate buttons: an even grid of 3-4 columns (renderGates), large targets */
                #pr-gatesGrid {
                    gap: 0.6rem !important;
                }
                .gateBtn {
                    font-size: 1.35rem !important;
                    font-weight: 700;
                    padding: 0 !important;
                    height: 60px !important;
                    aspect-ratio: auto !important;
                }
                
                /* Kompakt info-rad */
                #pr-infoEquipageLine { font-size: 0.875rem; }
                .info-meta { font-size: 0.75rem; }
                /* The id outranks the base rule below, which comes later in the sheet */
                #page-precision-input .sticky-precision-controls {
                    top: calc(63px + var(--pause-banner-h, 0px));
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
                    min-width: 3.5rem !important;
                    min-height: 3.25rem !important;
                    height: auto !important;
                    padding: 0.25rem 0.5rem !important;
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
                top: calc(63px + var(--pause-banner-h, 0px)); /* under the page header and the pause banner */
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
            
            #pr-liveTimer {
                text-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }

            @media (max-width: 1100px) and (orientation: landscape) and (max-height: 760px) {
                #page-precision-input .container {
                    padding: 0.35rem;
                }
                #page-precision-input .sticky-precision-controls {
                    top: 0 !important;
                    margin-left: -0.35rem;
                    margin-right: -0.35rem;
                    padding: 0.45rem 0.65rem;
                }
                #pr-liveTimer {
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
                    min-width: 3.25rem !important;
                    min-height: 3rem !important;
                    height: auto !important;
                    padding: 0.2rem 0.4rem !important;
                }
                .precision-nav-btn {
                    padding: 0.55rem !important;
                }
                #pr-gatesGrid {
                    grid-template-columns: repeat(7, 1fr) !important;
                    gap: 0.45rem !important;
                }
                .gateBtn {
                    height: 2.8rem !important;
                    font-size: 1rem !important;
                    aspect-ratio: auto !important;
                }
                #pr-btnSave {
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
                        <div id="pr-liveTimer" role="button" tabindex="0" data-kbd-click class="text-3xl md:text-5xl font-black tabular-nums cursor-pointer dark:text-white leading-none" title="${t('precision_click_to_change_time')}">00:00,00</div>
                        <div class="text-xs md:text-sm mt-1 flex items-center gap-1">
                            <span class="text-gray-500 dark:text-gray-400">${t('precision_time_error')}</span>
                            <span id="pr-uiTimePenaltyTop" class="tabular-nums font-bold dark:text-gray-200">0.00</span>
                        </div>
                        <div id="pr-clockWarning" role="alert" class="hidden mt-1 text-xs md:text-sm font-semibold text-amber-800 dark:text-amber-200"></div>
                        <div class="mt-2 flex items-center gap-2">
                            <button id="pr-btnRebuildAdd" type="button" class="min-h-[44px] px-3 rounded-lg border border-amber-400 bg-amber-50 text-amber-900 text-sm font-bold active:scale-95 hover:bg-amber-100 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100" aria-label="${escapeHtml(t('precision_rebuild_add_aria'))}" title="${escapeHtml(t('precision_rebuild_add_aria'))}">${escapeHtml(t('precision_rebuild_add'))}</button>
                            <button id="pr-btnRebuildUndo" type="button" class="hidden min-h-[44px] min-w-[44px] px-3 rounded-lg border text-sm font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200" aria-label="${escapeHtml(t('precision_rebuild_undo_aria'))}" title="${escapeHtml(t('precision_rebuild_undo_aria'))}">−1</button>
                            <span id="pr-rebuildInfo" class="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300"></span>
                        </div>
                        <button id="pr-btnPhase1Finish" type="button" disabled class="hidden mt-2 w-full sm:w-auto min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-base font-bold shadow-sm active:scale-95 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100">${t('precision_phase1_finish')}</button>
                    </div>
                    <div class="precision-control-strip ${isFieldMode ? 'is-field' : 'is-live'} flex gap-2 sm:shrink-0">
                        <div class="precision-primary-controls flex gap-2">
                        ${isFieldMode
                            ? `<button id="pr-btnManualOpen" class="precision-action-btn precision-main-btn flex-1 sm:flex-none w-full sm:w-32 md:w-36 py-3 text-base md:text-lg font-bold rounded-lg bg-brand-darkblue text-white shadow-sm active:scale-95 transition-all hover:bg-brand-gold hover:text-brand-darkblue">Ange tid</button>`
                            : `<button id="pr-btnStart" class="precision-action-btn precision-main-btn flex-1 sm:flex-none w-full sm:w-20 md:w-28 py-3 text-base md:text-lg font-bold rounded-lg bg-emerald-600 text-white shadow-sm active:scale-95 transition-all hover:bg-emerald-700 aria-disabled:opacity-40">${t('precision_start')}</button>
                        <button id="pr-btnStop" class="precision-action-btn precision-main-btn flex-1 sm:flex-none w-full sm:w-20 md:w-28 py-3 text-base md:text-lg font-bold rounded-lg bg-red-600 text-white shadow-sm active:scale-95 transition-all hover:bg-red-700 aria-disabled:opacity-40">${t('precision_stop')}</button>`}
                        </div>
                        <button id="pr-btnResetTop" type="button" class="precision-nav-btn precision-reset-top-btn flex flex-col items-center justify-center gap-0.5 min-w-[56px] px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200" aria-label="${escapeHtml(t('precision_reset'))}" title="${escapeHtml(t('precision_reset'))}"><span aria-hidden="true">🔄</span><span class="text-[11px] font-bold leading-none">${escapeHtml(t('precision_reset'))}</span></button>
                    </div>
                </div>

                <!-- Manuell tid-editorn (flytande under timern) -->
                <div id="pr-manualTimeEditor" class="precision-manual-editor hidden p-4 rounded-xl border bg-white shadow-2xl z-50 dark:bg-gray-800 dark:border-gray-600">
                    <label class="block text-sm font-semibold mb-2 dark:text-white">${t('precision_manual_time_prompt')}</label>
                    <input id="pr-manualTimeDigits" type="tel" inputmode="numeric" class="w-full text-4xl font-mono tracking-widest text-center px-3 py-4 border-2 rounded-lg mb-4 dark:bg-gray-700 dark:border-gray-600 dark:text-white outline-none focus:border-blue-500" placeholder="mmsscc" maxlength="6" />
                    <div class="flex gap-3">
                        <button id="pr-btnManualApply" class="flex-1 py-3 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700">${t('precision_apply')}</button>
                        <button id="pr-btnManualCancel" class="flex-1 py-3 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300">${t('precision_cancel')}</button>
                    </div>
                </div>
            </div>

            <div class="main-card bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-md space-y-4 border dark:border-gray-700">
                <!-- EKIPAGEVAL -->
                <div class="grid grid-cols-1 gap-4">
                    <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-center">
                        <button id="pr-btnPrevEq" type="button" aria-label="Föregående ekipage" class="precision-nav-btn min-w-[44px] min-h-[44px] p-2 border rounded-md bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">&laquo;</button>
                        <div id="pr-precisionEquipageSearchContainer" class="min-w-0"></div>
                        <button id="pr-btnNextEq" type="button" aria-label="Nästa ekipage" class="precision-nav-btn min-w-[44px] min-h-[44px] p-2 border rounded-md bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">&raquo;</button>
                    </div>
                    
                    <div id="pr-roundTabs" role="tablist" aria-label="${escapeHtml(t('precision_round_selector'))}" class="hidden"></div>
                    <div id="pr-roundBanner" role="alert" class="hidden space-y-1"></div>

                    <div class="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-800/30">
                        <div class="flex flex-wrap items-center gap-2">
                            <div id="pr-infoEquipageLine" class="font-bold dark:text-white text-base md:text-lg">–</div>
                            <div id="pr-infoCarriageWarning" class="inline-flex"></div>
                        </div>
                        <div class="info-meta text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1 uppercase tracking-wider font-medium">
                            Hinder: <span id="pr-infoPortWidth" class="text-blue-700 dark:text-blue-400 font-bold">–</span> | 
                            Vagn: <span id="pr-infoTrackWidth" class="text-gray-700 dark:text-gray-300 font-semibold">–</span> | 
                            Max: <span id="pr-infoMaxTime" class="text-blue-700 dark:text-blue-400">–</span>
                        </div>
                    </div>
                </div>

                <!-- HINDERGRUPP -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="font-bold uppercase text-xs tracking-widest text-gray-500 dark:text-gray-400">${t('precision_obstacles_gates')}</h3>
                        <span id="pr-uiObstaclePenaltySummary" class="text-xs font-bold text-red-600 dark:text-red-400"></span>
                    </div>
                    <div id="pr-gatesGrid" class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    </div>
                </div>

                <!-- EXTRA / KOMMENTAR -->
                <div class="pt-4 border-t dark:border-gray-700">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label for="pr-extraPenaltyInput" class="block text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">${t('precision_extra_penalty')}</label>
                            <input type="number" id="pr-extraPenaltyInput" value="0" min="0" inputmode="decimal" class="w-full min-h-[44px] p-2 text-base border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div class="flex items-end">
                            <label for="pr-eliminatedInput" class="flex items-center cursor-pointer px-3 border rounded hover:bg-red-50 dark:hover:bg-red-900/20 w-full min-h-[44px] transition-colors dark:border-gray-600">
                                <input type="checkbox" id="pr-eliminatedInput" class="w-6 h-6 shrink-0 rounded border-gray-300 text-red-600 focus:ring-red-500 dark:bg-gray-700 dark:border-gray-600">
                                <span class="ml-3 font-bold text-red-700 dark:text-red-400 text-sm">${t('precision_elim')}</span>
                            </label>
                        </div>
                        <div class="sm:col-span-2">
                            <label for="pr-commentInput" class="block text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">${t('precision_comment')}</label>
                            <textarea id="pr-commentInput" rows="1" maxlength="1000" class="w-full min-h-[44px] p-2 text-base border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="${t('precision_comment_placeholder')}"></textarea>
                        </div>
                    </div>
                </div>
        
                <!-- SAMMANFATTNING -->
                <div id="pr-penaltySummary" class="flex flex-wrap gap-2 text-[10px] uppercase font-bold">
                    <div class="flex-grow rounded bg-gray-100 px-2 py-1 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 flex justify-between">
                        <span>${t('precision_time_label')}</span><span id="pr-uiTimePenalty" class="tabular-nums dark:text-gray-200">0.00</span>
                    </div>
                    <div class="flex-grow rounded bg-gray-100 px-2 py-1 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 flex justify-between">
                        <span>${t('precision_obstacles_label').replace(':','')}</span><span id="pr-uiObstaclePenalty" class="tabular-nums dark:text-gray-200">0</span>
                    </div>
                    <div class="flex-grow rounded bg-gray-100 px-2 py-1 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 flex justify-between">
                        <span>${t('precision_extra_penalty').split(' ')[0]}</span><span id="pr-uiExtraPenalty" class="tabular-nums dark:text-gray-200">0</span>
                    </div>
                    <div class="w-full text-center rounded bg-blue-600 text-white px-3 py-2 text-sm">
                        TOTALT: <span id="pr-uiTotalPenalty" class="tabular-nums">0.00</span><span id="pr-uiTotalUnit"></span>
                    </div>
                </div>

                <!-- KVALIFICERADE (fas 2 / omkörning) -->
                <div id="pr-qualPanel" class="hidden rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm dark:border-blue-800 dark:bg-blue-900/20 dark:text-gray-100"></div>

                <!-- ÅTGÄRDER -->
                <div class="flex flex-col gap-3 pt-2">
                    <button id="pr-btnSave" class="w-full text-lg py-4 bg-emerald-600 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-700 active:scale-[0.98] transition-all">${t('precision_save_results')}</button>
                    <button id="pr-btnRetire" type="button" class="hidden w-full min-h-[44px] py-3 border-2 border-amber-500 text-amber-800 dark:text-amber-200 font-bold rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20">${t('precision_driveoff_retire')}</button>
                    <button id="pr-btnBackupPreJson" type="button" class="min-h-[44px] text-[10px] text-gray-500 hover:text-blue-500 flex items-center justify-center gap-1">
                        <i class="fas fa-file-download"></i> EXPORTERA JSON (BACKUP)
                    </button>
                </div>

            </div> 
        </div> 
    `;
}

function updateHeaderInfo() {
    const eq = currentEquipage;
    const equipageEl = document.getElementById('pr-infoEquipageLine');
    const portEl = document.getElementById('pr-infoPortWidth');
    const trackEl = document.getElementById('pr-infoTrackWidth');
    const maxEl = document.getElementById('pr-infoMaxTime');
    const warningEl = document.getElementById('pr-infoCarriageWarning');

    if (!eq) {
        [equipageEl, portEl, trackEl, maxEl].forEach(el => { if (el) el.textContent = '–'; });
        if (warningEl) warningEl.innerHTML = '';
        return;
    }

    const isStandard = isStandardPortWidthClass(eq, precisionConfig);
    const portWidth = computePortWidthForEquipage(eq);
    const trackWidth = trackWidthFromEq(eq);
    const maxSeconds = roundMaxSec(eq);
    const compliance = getCarriageCompliance(eq, 'dressagePrecision');

    if (equipageEl) {
        equipageEl.textContent = `#${eq.startNumber} ${eq.driverName || ''} (${eq.className})`;
        syncVetStrikeChip(equipageEl, eq);
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
            warningEl.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" title="${escapeHtml(compliance.message || '')}">⚠️ Vagn ${escapeHtml(String(compliance.actualWidth))}cm (< min ${escapeHtml(String(compliance.minWidth))}cm)</span>`;
        } else if (compliance.status === 'forbidden') {
            warningEl.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" title="${escapeHtml(compliance.message || '')}">⛔ Ej tillåten (TR Bilaga 2)</span>`;
        } else if (compliance.safetyApproved === false) {
            warningEl.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" title="Funktionskontroll underkänd">⚠️ Ej godkänd vagnkontroll</span>`;
        } else {
            warningEl.innerHTML = '';
        }
    }
}

// Literal class names (the CSS build finds them here)
const GATE_COLUMN_CLASS = { 3: 'grid-cols-3', 4: 'grid-cols-4' };

function renderGates() {
    const host = document.getElementById('pr-gatesGrid');
    if (!host) return;
    const labels = getLabelsForClass(currentEquipage?.className);

    if (labels.length === 0) {
        host.innerHTML = `<p class="text-sm text-gray-500">${t('precision_no_obstacles_defined')}</p>`;
        return;
    }

    // An even grid of 3-4 columns on a phone, more on wider screens
    host.className = `grid ${GATE_COLUMN_CLASS[gateGridColumns(labels.length)]} sm:grid-cols-6 md:grid-cols-8 gap-2`;
    host.innerHTML = labels.map(label => {
        const active = knocks.has(label);
        const safeLabel = escapeHtml(String(label));
        return `<button type="button" data-g="${safeLabel}" class="gateBtn p-1 aspect-square flex items-center justify-center rounded border text-lg font-bold ${active ? 'bg-red-600 text-white' : 'bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white'}">${safeLabel}</button>`;
    }).join('');

    host.querySelectorAll('.gateBtn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const g = btn.dataset.g;
            const equipage = currentEquipage;
            // Phase 2 / drive-off: only for an equipage that may drive the round
            const check = roundStartCheck();
            if (!check.ok) {
                showAlert(refusalText(check.reason), false);
                return;
            }
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
function renderTimerUI(t, clock = clockCheck()) {
    const warningEl = document.getElementById('pr-clockWarning');
    if (warningEl) {
        warningEl.textContent = clock.ok ? '' : `⚠️ ${clockFaultMessage(clock.reason)}`;
        warningEl.classList.toggle('hidden', clock.ok);
    }
    if (!clock.ok) {
        // An implausible clock shows no time and no time penalty, never a huge number
        const timerEl = document.getElementById('pr-liveTimer');
        if (timerEl) {
            timerEl.textContent = '–';
            timerEl.classList.remove('text-red-600', 'dark:text-red-400');
        }
        ['pr-uiTimePenaltyTop', 'pr-uiTimePenalty', 'pr-uiTotalPenalty'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = '–';
                el.classList.remove('text-red-600', 'dark:text-red-400', 'animate-pulse', 'font-semibold');
            }
        });
        return;
    }

    const parts = msToParts(t);
    const timerStr = partsToString(parts);

    const timerEl = document.getElementById('pr-liveTimer');
    if (timerEl) {
        timerEl.textContent = timerStr;
        // Visuell feedback om vi kört över maxtid (valfritt)
        const maxSec = roundMaxSec();
        if (maxSec > 0 && (t / 1000) > maxSec) {
            timerEl.classList.add('text-red-600', 'dark:text-red-400');
        } else {
            timerEl.classList.remove('text-red-600', 'dark:text-red-400');
        }
    }

    const live = livePenalties(t);

    // --- 2) "Tidsfel" i topp-panelen ---
    const topTP = document.getElementById('pr-uiTimePenaltyTop');
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
    const tpEl = document.getElementById('pr-uiTimePenalty');
    const opEl = document.getElementById('pr-uiObstaclePenalty');
    const oiEl = document.getElementById('pr-uiObstacleInfo');
    const epEl = document.getElementById('pr-uiExtraPenalty');
    const ttEl = document.getElementById('pr-uiTotalPenalty');

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
        // Time rounds (FEI phase 2, drive-off) count seconds, fault rounds penalty points
        const unitEl = document.getElementById('pr-uiTotalUnit');
        if (unitEl) unitEl.textContent = live.scoring === 'time' ? ' s' : '';
    }

    // --- 4) Summering i hedern (Hinder) ---
    const summaryEl = document.getElementById('pr-uiObstaclePenaltySummary');
    if (summaryEl) {
        const totalP = live.obstaclePenalty;
        summaryEl.textContent = knocks.size > 0 ? `${knocks.size} st (${totalP} p)` : '';
    }
}

/**
 * updateTimerView - Körs av setInterval() och uppdaterar bara skärmen.
 * Ingen periodisk live-push: tittarna räknar tiden själva från liveStartEpoch,
 * och start, stopp, rivning och paus skickas direkt (pushLiveSafe).
 */
function updateTimerView() {
    const clock = clockCheck();
    renderTimerUI(clock.elapsedMs, clock);
    updateRoundControls();
}

// Whether the equipage may start the round shown (phase 2 only after a clear
// phase 1, the drive-off only for a qualifier); { ok, reason }
function roundStartCheck() {
    if (!currentEquipage || currentRound === 'phase1') return { ok: true, reason: null };
    const sn = String(currentEquipage.startNumber);
    return canStartPrecisionRound(storedResult(), currentRound, { groupCtx: groupContextOf(currentEquipage), startNumber: sn });
}

function refusalText(reason) {
    const key = precisionWarningKey(reason);
    const text = t(key);
    return text && text !== key ? text : (PRECISION_ROUND_WARNING_TEXT[reason] || String(reason || ''));
}


// The start number whose clock this device started (null when it runs, if at all,
// on another device): only that one is stopped when switching equipage
let clockStartedHereFor = null;

function startTimer() {
    // Städa upp ev. gammalt interval
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (isRunning) return;

    // Phase 2 / drive-off: not for an equipage that did not qualify
    const startCheck = roundStartCheck();
    if (!startCheck.ok) {
        showAlert(refusalText(startCheck.reason), false);
        return;
    }

    // Phase 1 driven again in a two-phase class: the old phase 2 (time,
    // knocks, status) would survive the re-run; cleared only on purpose
    const stored = storedDocFor(currentEquipage?.startNumber) || readPrecisionBackup(currentEquipage?.startNumber);
    const rerunClearsPhase2 = !!currentEquipage && currentRound === 'phase1'
        && equipageFormat() === 'twoPhase' && phase2HasData(stored);
    if (rerunClearsPhase2) {
        if (!window.confirm(refusalText('phase2RerunConfirm'))) return;
        clearPhase2(currentEquipage);
    }

    isRunning = true;
    clockStartedHereFor = currentEquipage ? String(currentEquipage.startNumber) : null;
    // A new offset measurement mid-run would shift start against stop
    setServerClockHold(true);
    // Viktigt: starta från "nu" – vi ska INTE baka in pausedMs i startEpoch
    startEpoch = nowMs();

    timerInterval = setInterval(updateTimerView, 90); // ~10 fps i UI
    updateTimerView();     // uppdatera UI direkt
    inProgress = true;     // <-- NYTT
    // meddela resultatvyn att vi kör (och att vi är inProgress); the live views
    // follow activeRound (the top-level running stays false in phase 2 / drive-off).
    // A drive-off started again after "Ej startat" is no longer retired.
    const retiredBefore = currentRound !== 'phase1' && readPrecisionRound(storedDocFor(currentEquipage?.startNumber), currentRound).retired === true;
    pushLiveSafe({ ...getClockPayload(), inProgress: true, ...(retiredBefore ? { retired: false } : {}) }, { activeRound: currentRound });
    renderRoundBanner();
}

// The old phase 2 removed as a whole before phase 1 is driven again (a
// rounds-only write, sent before the start so it lands first)
function clearPhase2(equipage) {
    const sn = equipage.startNumber;
    const existing = readPrecisionBackup(sn);
    if (existing?.rounds) {
        const { phase2: _dropped, ...rest } = existing.rounds;
        mirrorToLocal(sn, { rounds: rest, activeRound: 'phase1' });
    }
    awaitWriteOrQueue(
        setDoc(precisionDocRef(sn), buildPrecisionRoundClearWrite({ round: 'phase2' }, FS), { merge: true }),
        { onLateError: lateRejection(sn, { clearRound: 'phase2' }, 'precision-input:clear-phase2') }
    ).catch((error) => reportWriteError(sn, error));
}

function stopTimer() {
    // Already stopped: the stopped state is pushed again, unless the round is
    // saved meanwhile (here or on another device) – a Stop then changes nothing
    if (!isRunning) {
        if (currentEquipage && shouldPushStop(storedRoundOfCurrent())) pushLiveSafe(getClockPayload());
        return;
    }

    // Lägg till den körda tiden till den ackumulerade, but never a time
    // computed from a missing or implausible start
    const clock = clockCheck();
    if (clock.ok) {
        pausedMs = clock.elapsedMs;
    } else {
        showAlert(`${clockFaultMessage(clock.reason)} Klockan stoppades utan att tiden räknades.`, 'warning');
    }
    isRunning = false;
    clockStartedHereFor = null;
    setServerClockHold(false);

    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    updateTimerView();     // visa stoppad tid korrekt
    // meddela live: running=false (not over a round saved meanwhile)
    if (currentEquipage && shouldPushStop(storedRoundOfCurrent())) pushLiveSafe(getClockPayload());
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
    clockStartedHereFor = null;
    setServerClockHold(false);
}

function resetTimer() {
    stopTimer();

    // 1. Återställ all lokal state för rundan
    pausedMs = 0;
    inProgress = false;
    knocks.clear();
    knockDownTimes = {};
    rebuildCount = 0;
    renderRebuildInfo();

    // 2. Nollställ UI-ingångar (om de finns)
    const epInput = document.getElementById('pr-extraPenaltyInput');
    if (epInput) epInput.value = 0;

    const elimInput = document.getElementById('pr-eliminatedInput');
    if (elimInput) elimInput.checked = false;

    const commentInput = document.getElementById('pr-commentInput');
    if (commentInput) commentInput.value = '';
    clearFormDirty();

    // 3. Uppdatera UI-visning omedelbart (använd rena render-funktioner)
    renderTimerUI(0);
    renderGates();
    updateHeaderInfo();

    // 4. Meddela Firestore (skicka ett fullständigt "nollställt" läge)
    // Vi skickar med explicit nollställning av "slutgiltiga" fält för att undvika att de hänger kvar i Firestore (merge:true)
    pushLiveSafe({
        ...getClockPayload(),
        inProgress: false,
        extraPenalty: 0,
        eliminated: false,
        knocks: [],
        knockDownTimes: {},
        rebuildCount: 0,
        finalized: false,
        ...(currentRound !== 'phase1' ? { retired: false } : {}),
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
    // The fields of the round shown (the doc itself for phase 1)
    const payload = roundFields(data && typeof data === 'object' ? data : {});
    const liveStartEpoch = Number(payload.liveStartEpoch);
    const livePausedMs = Number(payload.livePausedMs);
    // The clock's current time is liveTimeMs (every stop, correction and the
    // secretariat write it); timeMs only counts once the round is finalized or
    // saved (inProgress false): a late Stop may have rewritten liveTimeMs after
    // the save (as the result engine). A reset clears timeMs.
    const storedTimeMs = storedRoundTimeMs(payload);

    knocks = new Set(Array.isArray(payload.knocks) ? payload.knocks.map(String) : []);
    knockDownTimes = payload.knockDownTimes && typeof payload.knockDownTimes === 'object'
        ? { ...payload.knockDownTimes }
        : {};

    extraPenalty = Number(payload.extraPenalty || 0);
    comment = String(payload.comment || '');
    rebuildCount = precisionRebuildCount(payload);
    renderRebuildInfo();
    inProgress = payload.inProgress === true || payload.running === true || storedTimeMs > 0;
    // Running without a usable start (missing, in the future, far too long
    // ago) stays "running" so the judge sees the warning and can stop it;
    // clockCheck() keeps the huge time off the screen
    isRunning = payload.running === true;

    if (isRunning) {
        startEpoch = Number.isFinite(liveStartEpoch) ? liveStartEpoch : 0;
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

    const extraPenaltyInput = document.getElementById('pr-extraPenaltyInput');
    if (extraPenaltyInput && !isUserEditing(extraPenaltyInput)) extraPenaltyInput.value = String(extraPenalty);

    const eliminatedInput = document.getElementById('pr-eliminatedInput');
    if (eliminatedInput && !isUserEditing(eliminatedInput)) eliminatedInput.checked = payload.eliminated === true;

    const commentInput = document.getElementById('pr-commentInput');
    if (commentInput && !isUserEditing(commentInput)) commentInput.value = comment;

    updateHeaderInfo();
    renderGates();
    updateObstaclePenaltySummary();
    renderTimerUI(getElapsedMs());
    renderRoundUi();
    renderRoundBanner();
    updateRoundControls();
}

// ---------- Rounds: selector, banner, qualified panel ----------
let roundUiSignature = '';
let roundAdoptedFor = null; // the start number whose round the judge picked by hand
let groupCtx = null; // precisionGroupContext of the class(es) with round formats
let dropdownList = []; // what the equipage dropdown lists now

const roundFormatsInUse = () => equipages.some((e) => e.status !== 'struken' && roundsFor(e).length > 1);

function groupContextOf(eq) {
    if (!groupCtx || !eq) return null;
    const row = equipages.find((e) => String(e.startNumber) === String(eq.startNumber));
    return row ? groupCtx.contextOf(row) : null;
}

function recomputeGroupContext() {
    if (!roundFormatsInUse()) { groupCtx = null; return; }
    const rows = equipages.filter((e) => e.status !== 'struken');
    groupCtx = precisionGroupContext(
        rows,
        (r) => calculatePrecisionResult(precisionResultsMap.get(String(r.startNumber)) || {}, r, precisionConfig, calcOptions()),
        (r) => groupKeyOf(r),
        { requireFinished: true }
    );
}

// The dropdown lists everyone in the initial round, only the qualifiers in the drive-off
function refreshDropdownList() {
    if (!searchableDropdown) return;
    dropdownList = currentRound === 'driveOff' && groupCtx
        ? driveOffStartList(fullEquipageList, groupCtx.groups, startTimesMap)
        : fullEquipageList;
    searchableDropdown.updateData(dropdownList);
}

// On every snapshot: a round whose clock runs wins, unless the judge picked a round by hand
function adoptRoundOnce(sn, data) {
    if (roundAdoptedFor === String(sn)) return;
    const next = pickPrecisionRound(data, roundsFor(), currentRound);
    if (next !== currentRound) {
        currentRound = next;
        refreshDropdownList();
    }
}

function renderRoundUi() {
    const host = document.getElementById('pr-roundTabs');
    if (!host) return;
    const rounds = roundsFor();
    const signature = `${currentEquipage?.startNumber ?? ''}|${rounds.join(',')}|${currentRound}`;
    if (signature === roundUiSignature) return;
    roundUiSignature = signature;
    if (!currentEquipage || rounds.length < 2) {
        host.classList.add('hidden');
        host.innerHTML = '';
        return;
    }
    const format = equipageFormat();
    host.innerHTML = `<div class="grid gap-2 ${rounds.length > 2 ? 'grid-cols-3' : 'grid-cols-2'}">${rounds.map((r) => {
        const active = r === currentRound;
        return `<button type="button" role="tab" aria-selected="${active}" data-round="${escapeHtml(r)}" class="min-h-[44px] px-3 rounded-lg border text-base font-bold ${active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600'}">${escapeHtml(t(precisionRoundLabelKey(r, format)))}</button>`;
    }).join('')}</div>`;
    host.classList.remove('hidden');
}

function renderRoundBanner() {
    const host = document.getElementById('pr-roundBanner');
    if (!host) return;
    const eq = currentEquipage;
    const codes = [];
    if (eq) {
        const result = storedResult(eq);
        (result?.formatWarnings || []).forEach((c) => codes.push(c));
        const ctx = groupContextOf(eq);
        (ctx?.warnings || []).forEach((w) => {
            if (w.startNumber == null || String(w.startNumber) === String(eq.startNumber)) codes.push(w.code);
        });
        if (ctx?.driveOffPending && currentRound === 'driveOff') codes.push('driveOffPending');
        const check = roundStartCheck();
        if (!check.ok && !isRunning) codes.push(check.reason);
    }
    const unique = [...new Set(codes)];
    host.innerHTML = unique.map((c) => `<div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">⚠️ ${escapeHtml(refusalText(c))}</div>`).join('');
    host.classList.toggle('hidden', unique.length === 0);
}

function renderQualifiedPanel() {
    const host = document.getElementById('pr-qualPanel');
    if (!host) return;
    if (!groupCtx) { host.classList.add('hidden'); host.innerHTML = ''; return; }
    const rows = equipages.filter((e) => e.status !== 'struken');
    const summary = buildQualifiedSummary(
        rows,
        (r) => calculatePrecisionResult(precisionResultsMap.get(String(r.startNumber)) || {}, r, precisionConfig, calcOptions()),
        groupCtx.groups,
        startTimesMap
    );
    if (!summary.phase2.length && !summary.driveOff.length) { host.classList.add('hidden'); host.innerHTML = ''; return; }
    const item = (m) => `<li>#${escapeHtml(String(m.startNumber))} ${escapeHtml(m.driverName)} <span class="text-xs text-gray-500 dark:text-gray-400">(${escapeHtml(m.className)}) – ${escapeHtml(t(`precision_qual_state_${m.state}`))}</span></li>`;
    const parts = [`<h3 class="font-bold uppercase text-xs tracking-widest text-blue-800 dark:text-blue-200 mb-1">${escapeHtml(t('precision_qualified_title'))}</h3>`];
    if (summary.phase2.length) {
        parts.push(`<div class="font-semibold">${escapeHtml(t('precision_qualified_phase2'))}</div><ul class="mb-1 list-disc pl-5">${summary.phase2.map(item).join('')}</ul>`);
    }
    summary.driveOff.forEach((g) => {
        const cls = [...new Set(g.members.map((m) => m.className))].join(' + ');
        parts.push(`<div class="font-semibold">${escapeHtml(t('precision_qualified_driveoff'))} – ${escapeHtml(cls)} <span class="text-xs font-normal">${escapeHtml(g.complete ? t('precision_driveoff_complete') : t('precision_warn_driveOffPending'))}</span></div><ul class="mb-1 list-disc pl-5">${g.members.map(item).join('')}</ul>`);
    });
    host.innerHTML = parts.join('');
    host.classList.remove('hidden');
}

// Buttons that depend on the round and the clock: "Fas 1 mål" while phase 1 of a
// two-phase class runs, "Ej startat omkörning" in a stopped drive-off
function updateRoundControls() {
    // "Fas 1 mål" keeps its place for a two-phase class (disabled while the
    // clock is not running), so Start/STOPP do not move when it starts
    const finishBtn = document.getElementById('pr-btnPhase1Finish');
    if (finishBtn) {
        finishBtn.classList.toggle('hidden', !(currentEquipage && equipageFormat() === 'twoPhase' && currentRound === 'phase1'));
        finishBtn.disabled = !isRunning;
    }
    // Start is dimmed while the clock runs, STOPP while it is stopped (still
    // pressable: a second Stop pushes the stopped state again)
    document.getElementById('pr-btnStart')?.setAttribute('aria-disabled', isRunning ? 'true' : 'false');
    document.getElementById('pr-btnStop')?.setAttribute('aria-disabled', isRunning ? 'false' : 'true');
    const retireBtn = document.getElementById('pr-btnRetire');
    if (retireBtn) retireBtn.classList.toggle('hidden', !(currentEquipage && currentRound === 'driveOff' && !isRunning));
}

function switchRound(round) {
    const eq = currentEquipage;
    if (!eq || round === currentRound || !roundsFor(eq).includes(round)) return;
    // This device's clock belongs to the round it started: stop it first
    if (isRunning && clockStartedHereFor === String(eq.startNumber)) {
        showAlert(t('precision_round_switch_running'), 'warning');
        return;
    }
    stopTimerLocal();
    currentRound = round;
    roundAdoptedFor = String(eq.startNumber); // the judge's choice stays
    clearFormDirty();
    refreshDropdownList();
    applyLiveDocToState(storedDocFor(eq.startNumber) || readPrecisionBackup(eq.startNumber));
}

// Live listener over all results: who qualified for phase 2 / the drive-off
function startResultsListener() {
    if (resultsUnsubscribe) { try { resultsUnsubscribe(); } catch { } resultsUnsubscribe = null; }
    if (!roundFormatsInUse()) { groupCtx = null; renderQualifiedPanel(); return; }
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
    resultsUnsubscribe = resilientSnapshot({
        name: 'precision-input:results',
        subscribe: (onNext, onError) => onSnapshot(colRef, onNext, onError),
        onData: (snap) => {
            precisionResultsMap = new Map(snap.docs.map((d) => [String(d.id), d.data()]));
            recomputeGroupContext();
            renderQualifiedPanel();
            renderRoundBanner();
            refreshDropdownList();
        },
        onStatus: (status) => connectionBanner.update('precision-results', status)
    });
}

// "Fas 1 mål" (two phases): one write saves phase 1 at the finish line and, when
// it is clear, starts phase 2 at the same instant (FEI 979.1.1, TR 530.1.3 "direkt
// utan ny startsignal"); otherwise the clock just stops (the judge's bell)
async function finishPhase1() {
    const equipage = currentEquipage;
    if (!equipage || currentRound !== 'phase1' || !isRunning || saveInFlight) return;
    const splitEpoch = nowMs();
    const clock = checkPrecisionClock({ startEpoch, pausedMs, nowMs: splitEpoch, maxSec: roundMaxSec() });
    if (!clock.ok) {
        showAlert(`${clockFaultMessage(clock.reason)} ${t('precision_phase1_finish_fault')}`, 'warning');
        return;
    }
    const splitMs = Math.max(0, Math.round(clock.elapsedMs));
    const extraPenaltyValue = parseFloat(document.getElementById('pr-extraPenaltyInput')?.value) || 0;
    const eliminated = !!document.getElementById('pr-eliminatedInput')?.checked;
    const commentValue = document.getElementById('pr-commentInput')?.value?.trim() || '';
    const calculate = (data) => calculatePrecisionResult(data, equipage, precisionConfig, calcOptions());
    const stored = storedDocFor(equipage.startNumber) || { knocks: Array.from(knocks), rebuildCount };
    const finish = buildPhase1FinishWrite({
        stored,
        splitMs,
        splitEpoch,
        extraPenalty: extraPenaltyValue,
        eliminated,
        comment: commentValue,
        startNumber: equipage.startNumber,
        className: equipage.className,
        calculate,
        notStartedLabel: t('precision_not_started')
    });
    const { payload, calc, knocks: countedKnocks, qualified, phase2Blocked } = finish;
    // Phase 2 continues only when it is clear and its stored round is empty
    const continues = qualified && !phase2Blocked;

    saveInFlight = true;
    const { rounds: nextRounds, activeRound: nextActive, ...topFields } = payload;
    mirrorToLocal(equipage.startNumber, { ...topFields, ...(nextActive ? { activeRound: nextActive } : {}), knocks: countedKnocks });
    if (nextRounds?.phase2) mirrorRound(equipage.startNumber, 'phase2', nextRounds.phase2);
    clearFormDirty();
    if (!continues) stopTimerLocal();
    else { startEpoch = splitEpoch; pausedMs = 0; currentRound = 'phase2'; }
    if (currentEquipage === equipage) {
        applyLiveDocToState({
            ...stored,
            ...payload,
            knocks: countedKnocks,
            rounds: { ...(stored.rounds || {}), ...(nextRounds ? { phase2: { ...(stored.rounds?.phase2 || {}), ...nextRounds.phase2 } } : {}) }
        });
        if (continues) refreshDropdownList();
    }
    try {
        const result = await awaitWriteOrQueue(
            setDoc(precisionDocRef(equipage.startNumber), payload, { merge: true }),
            { onLateError: lateRejection(equipage.startNumber, { ...topFields, phase2Started: continues }, 'precision-input:phase1-finish') }
        );
        if (result === 'saved') correctPenaltiesAfterSave(equipage, topFields, countedKnocks, calculate, storedRebuildCount(stored), 'phase1');
        let message;
        if (calc.configMissing) message = t('precision_saved_course_missing');
        else if (phase2Blocked) message = refusalText('phase2HasData');
        else message = qualified ? t('precision_phase1_continue') : t('precision_phase1_stopped');
        showAlert(`${message}${queuedNotice(result)}`, result === 'queued' ? 'offline' : (continues ? true : 'warning'));
    } catch (error) {
        console.error('Kunde inte spara fas 1:', error);
        showAlert(t('precision_save_error'), false);
    } finally {
        saveInFlight = false;
    }
}

// "Ej startat omkörning": a qualifier who does not drive the drive-off is placed
// after the drive-off finishers (owner Q3)
async function retireDriveOff() {
    const equipage = currentEquipage;
    if (!equipage || currentRound !== 'driveOff') return;
    if (isRunning) { showAlert(t('precision_driveoff_retire_running'), 'warning'); return; }
    if (!window.confirm(t('precision_driveoff_retire_confirm'))) return;
    const payload = buildPrecisionRoundRetireWrite({ round: 'driveOff', retired: true, startNumber: equipage.startNumber, className: equipage.className });
    mirrorRound(equipage.startNumber, 'driveOff', payload.rounds.driveOff);
    try {
        const result = await awaitWriteOrQueue(
            setDoc(precisionDocRef(equipage.startNumber), payload, { merge: true }),
            { onLateError: lateRejection(equipage.startNumber, { retired: true, round: 'driveOff' }, 'precision-input:retire') }
        );
        showAlert(`${t('precision_driveoff_retired')}${queuedNotice(result)}`, result === 'queued' ? 'offline' : true);
    } catch (error) {
        console.error('Kunde inte spara Ej startat omkörning:', error);
        showAlert(t('precision_save_error'), false);
    }
}

function resetSelectionUi() {
    if (currentUnsubscribe) {
        try { currentUnsubscribe(); } catch { }
        currentUnsubscribe = null;
    }
    storedDoc = null;
    roundAdoptedFor = null;
    roundUiSignature = '';
    connectionBanner.clear();

    stopTimerLocal();
    startEpoch = 0;
    pausedMs = 0;
    inProgress = false;
    knocks = new Set();
    knockDownTimes = {};
    extraPenalty = 0;
    comment = '';
    rebuildCount = 0;
    renderRebuildInfo();
    clearFormDirty();
    wireFormDirtyTracking();

    const extraPenaltyInput = document.getElementById('pr-extraPenaltyInput');
    if (extraPenaltyInput) extraPenaltyInput.value = '0';

    const eliminatedInput = document.getElementById('pr-eliminatedInput');
    if (eliminatedInput) eliminatedInput.checked = false;

    const commentInput = document.getElementById('pr-commentInput');
    if (commentInput) commentInput.value = '';

    updateHeaderInfo();
    renderGates();
    updateObstaclePenaltySummary();
    renderTimerUI(0);
    renderRoundUi();
    renderRoundBanner();
    updateRoundControls();
}

function subscribeToPrecisionDoc(startNumber) {
    if (currentUnsubscribe) {
        try { currentUnsubscribe(); } catch { }
        currentUnsubscribe = null;
    }

    // Resubscribes after an error (a dead listener would show a stale
    // document all day); the shown values stay meanwhile
    currentUnsubscribe = resilientSnapshot({
        name: `precision-input:${startNumber}`,
        subscribe: (onNext, onError) => onSnapshot(precisionDocRef(startNumber), onNext, onError),
        onData: (snap) => {
            rememberStoredDoc(startNumber, snap);
            const liveData = snap.exists() ? snap.data() : readPrecisionBackup(startNumber);
            if (snap.exists() && liveData) mirrorToLocal(startNumber, liveData);
            adoptRoundOnce(startNumber, liveData);
            applyLiveDocToState(liveData);
        },
        onStatus: (status) => connectionBanner.update('precision-doc', status)
    });
}

// The latest stored precision document of the selected equipage (with this
// device's pending writes): what a save counts the knocks from
let storedDoc = null;
function rememberStoredDoc(startNumber, snap) {
    storedDoc = { sn: String(startNumber), data: snap.exists() ? snap.data() : null };
}
function storedDocFor(startNumber) {
    return storedDoc && storedDoc.sn === String(startNumber) ? storedDoc.data : null;
}

const connectionBanner = createConnectionBanner(
    () => document.querySelector('#page-precision-input .container')
);

async function onEquipageSelected(eq) {
    // A clock still running belongs to the previous equipage: stop it there
    // (stopTimer saves running: false for the current one) before switching,
    // or its result would stay "running" for the live views and the server.
    // Only a clock started on this device: one running on another device (shown
    // here from the live document) is that device's to stop
    const previous = currentEquipage;
    if (previous && isRunning && clockStartedHereFor === String(previous.startNumber)
        && String(previous.startNumber) !== String(eq?.startNumber ?? '')) {
        stopTimer();
        showAlert(`Klockan för #${previous.startNumber} stoppades vid bytet (${partsToString(msToParts(pausedMs))}). Spara resultatet där om det ska gälla.`, 'warning');
    }

    currentEquipage = eq || null;

    if (!currentEquipage) {
        resetSelectionUi();
        return;
    }

    // The previous equipage's round does not carry over: phase 1 (the doc's
    // running / unsaved / active round is adopted when it is read), except in
    // the drive-off for a qualifier
    const ctx = groupContextOf(eq);
    const nextRound = roundOnSelect(currentRound, roundsFor(eq), {
        isDriveOffQualifier: ctx?.driveOffNeeded === true && ctx.driveOffQualifiers?.has(String(eq.startNumber)) === true
    });
    const roundChanged = nextRound !== currentRound;
    currentRound = nextRound;
    resetSelectionUi();
    currentEquipage = eq;
    if (roundChanged) refreshDropdownList();
    updateHeaderInfo();
    renderGates();
    subscribeToPrecisionDoc(currentEquipage.startNumber);

    try {
        const snap = await getDoc(precisionDocRef(currentEquipage.startNumber));
        if (currentEquipage?.startNumber !== eq.startNumber) return;
        if (!storedDocFor(eq.startNumber)) rememberStoredDoc(eq.startNumber, snap);
        const liveData = snap.exists() ? snap.data() : readPrecisionBackup(currentEquipage.startNumber);
        if (snap.exists() && liveData) mirrorToLocal(currentEquipage.startNumber, liveData);
        adoptRoundOnce(currentEquipage.startNumber, liveData);
        applyLiveDocToState(liveData);
    } catch (error) {
        console.warn('Kunde inte läsa precisiondokument för valt ekipage:', error);
        const backup = readPrecisionBackup(currentEquipage.startNumber);
        adoptRoundOnce(currentEquipage.startNumber, backup);
        applyLiveDocToState(backup);
    }
}

async function autoSelectRunningDriver() {
    if (!competitionId || !searchableDropdown) return;

    try {
        const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
        // The top-level running stays false in phase 2 / drive-off: those clocks
        // are rounds.<round>.running
        const snaps = await Promise.all(
            ['running', 'rounds.phase2.running', 'rounds.driveOff.running']
                .map((field) => getDocs(query(colRef, where(field, '==', true))))
        );
        const running = snaps.find((snap) => !snap.empty);
        if (running) {
            searchableDropdown.setValue(Number(running.docs[0].id));
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

    if (saveInFlight) return;
    // Phase 2 / drive-off: never saved for an equipage that may not drive it
    const check = roundStartCheck();
    if (!check.ok) {
        showAlert(refusalText(check.reason), false);
        return;
    }
    stopTimer();

    const equipage = currentEquipage;
    const timeMs = Math.max(0, Math.round(getElapsedMs()));
    const extraPenaltyValue = parseFloat(document.getElementById('pr-extraPenaltyInput')?.value) || 0;
    const eliminated = !!document.getElementById('pr-eliminatedInput')?.checked;
    const commentValue = document.getElementById('pr-commentInput')?.value?.trim() || '';
    // Penalties come from the result engine (rate incl. competition rule settings)
    const round = currentRound;
    const calculate = (data) => calculatePrecisionRoundResult(data, equipage, precisionConfig, round, calcOptions());
    // The knocks are the stored document's (the listener's copy, this device's
    // own toggles included); the list itself is not written, so knocks entered
    // on another device stay. Without any copy: the knocks shown here.
    const stored = storedDocFor(equipage.startNumber)
        || (round === 'phase1'
            ? { knocks: Array.from(knocks), rebuildCount }
            : { rounds: { [round]: { knocks: Array.from(knocks), rebuildCount } } });
    const { payload, calc, knocks: countedKnocks } = buildPrecisionSavePayload({
        round,
        stored,
        timeMs,
        extraPenalty: extraPenaltyValue,
        eliminated,
        comment: commentValue,
        startNumber: equipage.startNumber,
        className: equipage.className,
        calculate,
        notStartedLabel: t('precision_not_started')
    });

    // The save belongs to this equipage even if the judge moves on before the
    // server answers; backup before the write, since its promise waits for the server
    saveInFlight = true;
    // The saved fields of the round (the payload itself for phase 1)
    const savedFields = round === 'phase1' ? payload : payload.rounds[round];
    mirrorRound(equipage.startNumber, round, { ...savedFields, knocks: countedKnocks });
    clearFormDirty();
    if (currentEquipage === equipage) {
        applyLiveDocToState(round === 'phase1'
            ? { ...stored, ...payload, knocks: countedKnocks }
            : { ...stored, rounds: { ...(stored.rounds || {}), [round]: { ...(stored.rounds?.[round] || {}), ...savedFields, knocks: countedKnocks } } });
    }
    try {
        const result = await awaitWriteOrQueue(
            setDoc(precisionDocRef(equipage.startNumber), payload, { merge: true }),
            { onLateError: lateRejection(equipage.startNumber, { ...savedFields, knocks: countedKnocks, round }, 'precision-input:save') }
        );
        if (result === 'saved') correctPenaltiesAfterSave(equipage, payload, countedKnocks, calculate, storedRebuildCount(readPrecisionRound(stored, round)), round);
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

// Read after write: a knock from another device that reached the server
// between this device's last snapshot and the save is counted now
async function correctPenaltiesAfterSave(equipage, payload, countedKnocks, calculate, countedRebuilds = 0, round = 'phase1') {
    try {
        const snap = await getDocFromServer(precisionDocRef(equipage.startNumber));
        if (!snap.exists()) return;
        const patch = penaltyCorrection(payload, countedKnocks, snap.data(), calculate, countedRebuilds, round);
        if (!patch) return;
        await awaitWriteOrQueue(
            setDoc(precisionDocRef(equipage.startNumber), { ...patch, updatedAt: Date.now() }, { merge: true }),
            { onLateError: lateRejection(equipage.startNumber, patch, 'precision-input:correction') }
        );
    } catch (error) {
        console.warn('Precision: kunde inte kontrollera rivningarna efter sparning:', error);
    }
}

// Fields the judge types in: a snapshot (also the 5 s live push while the
// clock runs) must not replace what is being typed
const FORM_FIELD_IDS = ['pr-commentInput', 'pr-extraPenaltyInput', 'pr-eliminatedInput'];

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
        if (root) root.innerHTML = renderNoCompetitionState();
        return;
    }

    renderLayout();
    startServerClockSync();

    try {
        // Wrapper för timeout
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(t('precision_timeout'))), 10000)
        );

        // 1) Hämta rådata med timeout
        const [equipagesRaw, precisionCfg, startTimesData, precisionResults, marathonCfg, mergeSource] = await Promise.race([
            Promise.all([
                getEquipages(competitionId),
                getConfig(competitionId, 'precisionConfig'),
                getStartTimes(competitionId),
                getPrecisionResults(competitionId),
                // The rule profile (TR/FEI) of a class decides how phase 2 is scored
                getConfig(competitionId, 'marathonConfig').catch(() => null),
                loadMergeSource(competitionId).catch(() => null)
            ]),
            timeoutPromise
        ]);

        // Om ett nytt anrop har gjorts medan vi väntade, avbryt tyst
        if (myLoadId !== currentLoadId) {
            return;
        }

        precisionConfig = precisionCfg || {};
        marathonConfig = marathonCfg || null;
        groupKeyOf = precisionGroupKeyFn(mergeSource);
        startTimesMap = startTimesData || {};
        currentRound = 'phase1';
        roundAdoptedFor = null;
        roundUiSignature = '';
        precisionResultsMap = new Map();

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
        fullEquipageList = list;
        dropdownList = list;
        const searchContainer = document.getElementById('pr-precisionEquipageSearchContainer');
        if (searchContainer) {
            searchableDropdown = createSearchableDropdown(searchContainer, list, onEquipageSelected);
        } else {
            console.error("Search container disappeared!");
        }
        // Who is qualified for phase 2 / the drive-off (only with such classes)
        startResultsListener();

        // Request Wake Lock bara i full live-drift
        if (!isFieldMode) {
            await requestWakeLock();
            // Left the page while it was being granted: give it back
            if (myLoadId !== currentLoadId) {
                releaseWakeLock();
                return;
            }
        }

        // A listener from an earlier load that never reached __unload
        if (keydownHandler) {
            window.removeEventListener('keydown', keydownHandler);
            keydownHandler = null;
        }

        // Event Listeners
        document.getElementById('pr-btnStart')?.addEventListener('click', startTimer);
        document.getElementById('pr-btnStop')?.addEventListener('click', stopTimer);
        document.getElementById('pr-btnResetTop')?.addEventListener('click', () => {
            // A slip must not wipe the round's time and knockdowns
            if (window.confirm(t('precision_confirm_reset'))) resetTimer();
        });
        document.getElementById('pr-btnSave').addEventListener('click', saveFinal);
        document.getElementById('pr-btnRebuildAdd')?.addEventListener('click', () => changeRebuildCount(1));
        document.getElementById('pr-btnRebuildUndo')?.addEventListener('click', () => changeRebuildCount(-1));
        document.getElementById('pr-extraPenaltyInput').addEventListener('input', () => {
            const p = livePenalties(getElapsedMs());
            pushLiveSafe({
                extraPenalty: p.extraPenalty,
                liveTotalPenalty: p.totalPenalty
            });
        });

        // Koppla eliminering till live-uppdatering
        document.getElementById('pr-eliminatedInput').addEventListener('change', (event) => {
            // Only this field (and the live total): no clock or extra penalty along
            const p = livePenalties(getElapsedMs());
            pushLiveSafe({
                eliminated: !!event.target.checked,
                liveTotalPenalty: p.totalPenalty
            });
        });



        document.getElementById('pr-roundTabs')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-round]');
            if (btn) switchRound(btn.dataset.round);
        });
        document.getElementById('pr-btnPhase1Finish')?.addEventListener('click', finishPhase1);
        document.getElementById('pr-btnRetire')?.addEventListener('click', retireDriveOff);

        // The list shown: everyone, or the drive-off qualifiers in the drive-off
        const goNext = () => {
            const idx = dropdownList.findIndex(e => e.startNumber === currentEquipage?.startNumber);
            if (idx > -1 && idx < dropdownList.length - 1) {
                searchableDropdown.setValue(dropdownList[idx + 1].startNumber);
            }
        };
        const goPrev = () => {
            const idx = dropdownList.findIndex(e => e.startNumber === currentEquipage?.startNumber);
            if (idx > 0) {
                searchableDropdown.setValue(dropdownList[idx - 1].startNumber);
            }
        };


        document.getElementById('pr-btnNextEq').addEventListener('click', goNext);
        document.getElementById('pr-btnPrevEq').addEventListener('click', goPrev);
        keydownHandler = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') goPrev();
            if (e.key === 'ArrowRight') goNext();
        };
        window.addEventListener('keydown', keydownHandler);

        document.getElementById('pr-btnBackupPreJson')?.addEventListener('click', () => {
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
        const manualEditor = document.getElementById('pr-manualTimeEditor');
        document.getElementById('pr-btnManualOpen')?.addEventListener('click', () => manualEditor.classList.remove('hidden'));
        document.getElementById('pr-liveTimer').addEventListener('click', () => manualEditor.classList.remove('hidden'));
        document.getElementById('pr-btnManualCancel').addEventListener('click', () => manualEditor.classList.add('hidden'));
        document.getElementById('pr-btnManualApply').addEventListener('click', () => {
            const digitsEl = document.getElementById('pr-manualTimeDigits');
            const ms = parseManualTimeMs(digitsEl?.value);
            if (ms == null) {
                showAlert('Ogiltig tid. Ange mmsscc (sekunder under 60).', false);
                digitsEl?.focus();
                return;
            }
            // A running clock is the judge's live time: replaced only on purpose
            if (isRunning && !confirm(`Klockan går. Stoppa den och ersätt tiden med ${partsToString(msToParts(ms))}?`)) return;
            // Stop first, then set the time: stopTimer() would add the time
            // the clock ran to the time just typed
            stopTimerLocal();
            startEpoch = 0;
            pausedMs = ms;
            if (digitsEl) digitsEl.value = '';
            updateTimerView();   // visar tiden
            // meddela resultatvyn den nya stoppade tiden: a time typed in is not
            // saved yet (inProgress until Spara)
            inProgress = true;
            pushLiveSafe({ ...getClockPayload(), inProgress: true });
            manualEditor.classList.add('hidden');
        });

        // 4) Kolla om någon kör just nu och välj den
        // Vänta en liten stund så UI hinner "sätta sig"
        if (!isFieldMode) setTimeout(() => autoSelectRunningDriver(), 500);

    } catch (error) {
        // Ignorera fel om vi bytt load-session
        if (myLoadId !== currentLoadId) return;

        console.error("Kunde inte ladda precisionsinmatning:", error);
        const el = document.getElementById('pr-precisionEquipageSearchContainer');
        if (el) el.innerHTML = `<span class="text-red-500 font-bold">${t('precision_load_error_html').replace('{error}', escapeHtml(error?.message || String(error)))}</span>`;
        // showAlert("Ett kritiskt fel uppstod vid laddning av sidan.", false);
    }
}

export function __unload() {
    // A load still awaiting its data must not register listeners or take the
    // wake lock afterwards
    currentLoadId++;
    releaseWakeLock();
    stopServerClockSync();
    storedDoc = null;
    connectionBanner.clear();
    // Avsluta ev. pågående prenumeration
    if (currentUnsubscribe) {
        try { currentUnsubscribe(); } catch (e) { }
        currentUnsubscribe = null;
    }

    if (resultsUnsubscribe) {
        try { resultsUnsubscribe(); } catch (e) { }
        resultsUnsubscribe = null;
    }
    groupCtx = null;
    precisionResultsMap = new Map();
    currentRound = 'phase1';
    roundAdoptedFor = null;
    roundUiSignature = '';

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

// A new version of the app asks before reloading while the clock runs
registerUnsavedWork('precision-input', () => isRunning);
