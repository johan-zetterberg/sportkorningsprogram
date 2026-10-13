import { stableJson } from './resultRecalculationUtils.js';

/**
 * Which document writes can change a stored result. Each trigger run costs
 * about 20 reads, and many writes only carry live or display data the result
 * engine never reads (a judge's half-typed form, the speaker's notes).
 */

// Equipage fields the result engine does not read
const EQUIPAGE_NON_RESULT_FIELDS = new Set([
    'speakerNotes', 'horseTemperatures', 'groom', 'carriage', 'clubName',
    'clubLogo', 'lastUpdated', 'updatedAt'
]);

// Live state of the marathon obstacle input on maraton/{sn}. The engine reads
// the saved obstacles and stage times, never these.
const MARATHON_NON_RESULT_FIELDS = new Set([
    'running', 'inProgress', 'currentObstacle', 'startNumber', 'className',
    'updatedAt', 'lastUpdated',
    // Entry/exit timestamps per obstacle (shown on monitors, not scored)
    'obstacleTimes'
]);
const isMarathonLiveField = (key) => MARATHON_NON_RESULT_FIELDS.has(key)
    || key.startsWith('live_') || key.startsWith('liveObstacle');

// Precision fields the engine does not read
const PRECISION_NON_RESULT_FIELDS = new Set(['gateSplits', 'updatedAt', 'lastUpdated']);
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
