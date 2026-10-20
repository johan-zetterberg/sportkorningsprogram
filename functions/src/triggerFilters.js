import { stableJson } from './resultRecalculationUtils.js';
import { stageStartTS, stageStopTS } from './core-engine/marathon.js';

/**
 * Which document writes can change a stored result. Each trigger run costs
 * about 20 reads, and many writes only carry live or display data the result
 * engine never reads (a judge's half-typed form, the speaker's notes).
 */

// Equipage fields the result engine does not read
const EQUIPAGE_NON_RESULT_FIELDS = new Set([
    'speakerNotes', 'horseTemperatures', 'groom', 'carriage', 'clubName',
    'clubLogo', 'lastUpdated', 'updatedAt',
    // The vet's per-phase results (the equipage status, which the vet also
    // sets in the first inspection, does count)
    'vetInspection_initial', 'vetInspection_harness', 'vetInspection_restArea', 'vetInspection_final',
    'vetUnfitStageB',
    // The driver's declaration change log and the vet strike awaiting the
    // ground jury (a confirmed strike changes the status, which counts)
    'declarationChanges', 'declarationChangedAt', 'vetStrikePending', 'vetStrikeDecision'
]);

// Live state of the marathon obstacle input on maraton/{sn}. The engine reads
// the saved obstacles and stage times, never these.
const MARATHON_NON_RESULT_FIELDS = new Set([
    'running', 'inProgress', 'currentObstacle', 'startNumber', 'className',
    'updatedAt', 'lastUpdated',
    // Entry/exit timestamps per obstacle (shown on monitors, not scored)
    'obstacleTimes',
    // Each obstacle's live clock and form (obstacleLive.{n}); saved results
    // are in obstacleResults / obstacles and do count
    'obstacleLive'
]);
const isMarathonLiveField = (key) => MARATHON_NON_RESULT_FIELDS.has(key)
    || key.startsWith('live_') || key.startsWith('liveObstacle');

// Precision fields the engine does not read. The rounds of two phases /
// drive-off (rounds, activeRound) never change the stored result: only
// phase 1 counts for the total (TR 533.2, FEI 971.3.1, 977.1.1)
const PRECISION_NON_RESULT_FIELDS = new Set(['gateSplits', 'updatedAt', 'lastUpdated', 'rounds', 'activeRound']);
// Ticking values of a running round; the server does not tick running rounds,
// so their updates while the round keeps running change nothing that lasts
const PRECISION_TICK_FIELDS = new Set([
    'liveTimeMs', 'liveTimePenalty', 'liveObstaclePenalty', 'liveTotalPenalty',
    'liveStartEpoch', 'livePausedMs'
]);

export function changedFields(before, after) {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    return [...keys].filter((key) => stableJson(before?.[key]) !== stableJson(after?.[key]));
}

// A created or deleted document always counts
function onlyIgnoredFieldsChanged(before, after, isIgnored) {
    if (!before || !after) return false;
    return changedFields(before, after).every(isIgnored);
}

export function equipageWriteAffectsResults(before, after) {
    return !onlyIgnoredFieldsChanged(before, after, (key) => EQUIPAGE_NON_RESULT_FIELDS.has(key));
}

export function marathonWriteAffectsResults(before, after) {
    return !onlyIgnoredFieldsChanged(before, after, isMarathonLiveField);
}

export function precisionWriteAffectsResults(before, after) {
    const stillRunning = before?.running === true && after?.running === true;
    return !onlyIgnoredFieldsChanged(before, after, (key) => PRECISION_NON_RESULT_FIELDS.has(key)
        || (stillRunning && PRECISION_TICK_FIELDS.has(key)));
}

// --- Global pause (config/globalStatus.pauseLog) ---
// The engine subtracts a pause from a stage only where the pause overlaps the
// stage's start-stop interval (pausedMsBetween); a running stage on the
// server counts its saved duration. So a pause change only changes the
// results of equipages with a stage interval overlapping the changed pause.

const STAGES = ['A', 'transport', 'B'];

function pauseBounds(entry) {
    const from = entry?.from ?? (entry?.start ? Date.parse(entry.start) : NaN);
    const to = entry?.to ?? (entry?.end ? Date.parse(entry.end) : Infinity);
    return [Number(from), Number(to)];
}

/**
 * The time windows of pauses added, changed or removed between two pause logs,
 * as [fromMs, toMs] (an open pause lasts to Infinity). null when an entry's
 * start cannot be read: the caller then recalculates everything.
 */
export function changedPauseWindows(beforeLog, afterLog) {
    const before = Array.isArray(beforeLog) ? beforeLog : [];
    const after = Array.isArray(afterLog) ? afterLog : [];
    const keys = (list) => new Set(list.map(stableJson));
    const beforeKeys = keys(before);
    const afterKeys = keys(after);
    const changed = [
        ...before.filter(entry => !afterKeys.has(stableJson(entry))),
        ...after.filter(entry => !beforeKeys.has(stableJson(entry)))
    ];
    const windows = [];
    for (const entry of changed) {
        const [from, to] = pauseBounds(entry);
        if (!Number.isFinite(from) || Number.isNaN(to)) return null;
        windows.push([from, to]);
    }
    return windows;
}

/**
 * Whether an equipage's stage times (maraton and maraton-timing merged, the
 * maraton document winning, as the engine reads them) overlap one of the
 * windows. Unreadable times count as overlapping.
 */
export function marathonOverlapsPauseWindows(marathonDoc, timingDoc, windows = []) {
    if (!windows.length) return false;
    const merged = { ...(timingDoc || {}), ...(marathonDoc || {}) };
    return STAGES.some((stage) => {
        const start = stageStartTS(merged, stage);
        if (!start) return false;
        const stop = stageStopTS(merged, stage) || Infinity;
        if (!Number.isFinite(start)) return true;
        return windows.some(([from, to]) => start < to && stop > from);
    });
}

// Fields of the stored result (computed_equipages) the comparison looks at
const STORED_RESULT_FIELDS = [
    'totalPenalty', 'isEliminated', 'elimReason', 'isOngoing',
    'dressagePenalty', 'marathonPenalty', 'precisionPenalty'
];

/**
 * Whether a newly calculated result equals the stored one (same values, same
 * engine version), so writing it would only touch updatedAt and wake every
 * listener for nothing.
 */
export function storedResultUnchanged(existing, next, engineVersion) {
    if (!existing) return false;
    if (existing.calculationAudit?.engineVersion !== engineVersion) return false;
    return STORED_RESULT_FIELDS.every((field) => stableJson(existing[field]) === stableJson(next[field]));
}
