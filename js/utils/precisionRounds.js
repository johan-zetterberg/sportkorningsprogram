// Pure write builders for the precision rounds (no Firestore import, no DOM).
// One doc per equipage, precision/{startNo}: the top level is phase 1 / the
// initial round, doc.rounds.phase2 and doc.rounds.driveOff hold the other
// rounds with the same field names, doc.activeRound says which clock the live
// views follow. Every builder returns a payload for
// setDoc(ref, payload, { merge: true }); Firestore sentinels are passed in
// (fs = { arrayUnion, arrayRemove, increment, deleteField }), so the pages
// keep importing them from the Firebase SDK and tests can pass fakes.

import { PRECISION_ROUNDS } from './precisionCalculation.js';

export { PRECISION_ROUNDS };

// Fields a round sub-doc may hold (firestore.rules optPrecisionRound)
export const PRECISION_ROUND_FIELDS = Object.freeze([
    'timeMs', 'liveTimeMs', 'liveStartEpoch', 'livePausedMs', 'running', 'inProgress',
    'knocks', 'knockDownTimes', 'rebuildCount', 'extraPenalty', 'eliminated', 'retired',
    'timePenalty', 'timePenaltyOverride', 'obstaclePenalty', 'totalPenalty',
    'liveObstaclePenalty', 'liveTimePenalty', 'liveTotalPenalty', 'status', 'comment',
    'finalized', 'updatedAt'
]);

/** A known round key, else 'phase1' */
export function normalizePrecisionRound(round) {
    return PRECISION_ROUNDS.includes(round) ? round : 'phase1';
}

/** The rounds a class drives: ['phase1'], plus 'phase2' (two phases) and/or 'driveOff' (scheduled) */
export function precisionRoundsForFormat(format, { driveOffScheduled = false } = {}) {
    const list = ['phase1'];
    if (format === 'twoPhase') list.push('phase2');
    if (format === 'driveOff' || driveOffScheduled) list.push('driveOff');
    return list;
}

/** Dotted field path of a round's field: 'knocks' or 'rounds.phase2.knocks' (for updateDoc / where) */
export function precisionRoundFieldPath(round, field) {
    const r = normalizePrecisionRound(round);
    return r === 'phase1' ? field : `rounds.${r}.${field}`;
}

/** The stored fields of a round: the doc itself for phase 1, doc.rounds[round] (or {}) otherwise */
export function readPrecisionRound(doc, round) {
    const r = normalizePrecisionRound(round);
    if (r === 'phase1') return doc || {};
    const sub = doc?.rounds?.[r];
    return sub && typeof sub === 'object' ? sub : {};
}

/** Whether any round of the doc has its clock running */
export function isAnyPrecisionRoundRunning(doc) {
    if (!doc) return false;
    return doc.running === true
        || doc.rounds?.phase2?.running === true
        || doc.rounds?.driveOff?.running === true;
}

/**
 * Nests round fields for a merge write: phase 1 on the top level, other rounds
 * under rounds.<round>. `top` (startNumber, className, updatedAt, activeRound)
 * always goes on the top level.
 */
export function nestPrecisionRoundPayload(round, fields = {}, top = {}) {
    const r = normalizePrecisionRound(round);
    if (r === 'phase1') return { ...top, ...fields };
    return { ...top, rounds: { [r]: { ...fields } } };
}

/**
 * One knock toggle (gate label) in a round: arrayUnion/arrayRemove and one
 * knockDownTimes key, and the stored obstacle penalty removed so the engine
 * counts the knocks (as precision-input saveKnockToggle). A phase-1 cone hit
 * while driving phase 2 counts in phase 2 (owner Q10): pass the round driven.
 */
export function buildPrecisionKnockWrite({
    round = 'phase1',
    gate,
    add = true,
    elapsedMs = null,
    liveObstaclePenalty = null,
    liveTotalPenalty = null,
    extraPenalty = undefined,
    startNumber,
    className,
    now = Date.now()
} = {}, fs) {
    const label = String(gate);
    const fields = {
        knocks: add ? fs.arrayUnion(label) : fs.arrayRemove(label),
        knockDownTimes: { [label]: add ? elapsedMs : fs.deleteField() },
        obstaclePenalty: fs.deleteField(),
        updatedAt: now
    };
    if (liveObstaclePenalty !== null) fields.liveObstaclePenalty = liveObstaclePenalty;
    if (liveTotalPenalty !== null) fields.liveTotalPenalty = liveTotalPenalty;
    if (extraPenalty !== undefined) fields.extraPenalty = extraPenalty;
    return nestPrecisionRoundPayload(round, fields, { startNumber, className, updatedAt: now });
}

/**
 * "+10 s (ombyggnad)" in a round: an atomic increment for +1 (two devices
 * both count), the explicit lower count for an undo (never below 0).
 */
export function buildPrecisionRebuildWrite({ round = 'phase1', delta = 1, next = 0, startNumber, className, now = Date.now() } = {}, fs) {
    const value = delta > 0 ? fs.increment(delta) : Math.max(0, Math.floor(Number(next) || 0));
    return nestPrecisionRoundPayload(round, { rebuildCount: value, updatedAt: now }, { startNumber, className, updatedAt: now });
}

/** Starting (or resuming) a round's clock; activeRound follows it */
export function buildPrecisionRoundStartWrite({ round = 'phase1', startEpoch = Date.now(), pausedMs = 0, startNumber, className, now = Date.now() } = {}) {
    const paused = Math.max(0, Math.round(Number(pausedMs) || 0));
    return nestPrecisionRoundPayload(round, {
        running: true,
        inProgress: true,
        liveStartEpoch: startEpoch,
        livePausedMs: paused,
        liveTimeMs: paused,
        status: 'Pågår',
        updatedAt: now
    }, { startNumber, className, activeRound: normalizePrecisionRound(round), updatedAt: now });
}

/** Stopping a round's clock without saving (the time stays to be saved) */
export function buildPrecisionRoundStopWrite({ round = 'phase1', elapsedMs = 0, startNumber, className, now = Date.now() } = {}) {
    const ms = Math.max(0, Math.round(Number(elapsedMs) || 0));
    return nestPrecisionRoundPayload(round, {
        running: false,
        inProgress: true,
        liveStartEpoch: null,
        livePausedMs: ms,
        liveTimeMs: ms,
        updatedAt: now
    }, { startNumber, className, updatedAt: now });
}

/**
 * "Ej startat omkörning" / a driver who does not continue: the round retired
 * (no time). Placed after the round's finishers (owner Q2/Q3).
 */
export function buildPrecisionRoundRetireWrite({ round, retired = true, startNumber, className, now = Date.now() } = {}) {
    return nestPrecisionRoundPayload(round, {
        retired: retired === true,
        running: false,
        inProgress: false,
        liveStartEpoch: null,
        status: retired === true ? 'Utgått' : 'Ej startat',
        updatedAt: now
    }, { startNumber, className, updatedAt: now });
}

/**
 * A round removed as a whole (a deliberate phase-1 re-run clears the old
 * phase 2: its time, knocks and status would otherwise survive). A
 * rounds-only write (firestore.rules isPrecisionRoundsWrite: a removed round
 * passes optPrecisionRound), sent before the phase-1 start; activeRound back
 * to phase 1.
 */
export function buildPrecisionRoundClearWrite({ round, now = Date.now() } = {}, fs) {
    const r = normalizePrecisionRound(round);
    if (r === 'phase1') throw new Error('buildPrecisionRoundClearWrite: phase 1 is the top level');
    return { rounds: { [r]: fs.deleteField() }, activeRound: 'phase1', updatedAt: now };
}

/** Which round the live views follow (activeRound only) */
export function buildPrecisionActiveRoundWrite({ round = 'phase1', now = Date.now() } = {}) {
    return { activeRound: normalizePrecisionRound(round), updatedAt: now };
}

/**
 * Whether a round may be started for this equipage: phase 2 only after a
 * clear phase 1 (TR 530.1.3, FEI 979.4.1-4.2; result.phase2Qualified); a
 * drive-off only for a qualifier of its group (groupCtx from
 * precisionGroupContext, FEI 977.2.1). { ok, reason } with reason
 * 'notQualified' | 'noDriveOff' | 'notDriveOffQualifier' | 'formatHasNoRound'.
 */
export function canStartPrecisionRound(result, round, { groupCtx = null, startNumber = null } = {}) {
    const r = normalizePrecisionRound(round);
    if (r === 'phase1') return { ok: true, reason: null };
    if (r === 'phase2') {
        if (result?.precisionFormat !== 'twoPhase') return { ok: false, reason: 'formatHasNoRound' };
        return result?.phase2Qualified === true ? { ok: true, reason: null } : { ok: false, reason: 'notQualified' };
    }
    if (!result?.driveOffScheduled) return { ok: false, reason: 'noDriveOff' };
    if (groupCtx) {
        const sn = String(startNumber ?? '');
        if (!groupCtx.driveOffNeeded || !groupCtx.driveOffQualifiers?.has(sn)) return { ok: false, reason: 'notDriveOffQualifier' };
    }
    return { ok: true, reason: null };
}

/** Short Swedish texts for the engine's and the group context's warning codes */
export const PRECISION_ROUND_WARNING_TEXT = Object.freeze({
    trDriveOffVariant: 'TR 530.1.2 avgör lika straff på tid; omkörning endast enligt proposition (variant, TR 510).',
    phase2Ignored: 'Fas 2 räknas inte: fas 1 är inte felfri.',
    phase2ConfigMissing: 'Fas 2 saknar banlängd eller tempo – maxtiden kan inte räknas.',
    driveOffConfigMissing: 'Omkörningen saknar banlängd eller tempo – maxtiden kan inte räknas.',
    driveOffIgnored: 'Omkörningsresultatet räknas inte: ekipaget är inte kvalificerat till omkörningen.',
    driveOffPending: 'Omkörning återstår – placeringarna 1–k är preliminära.',
    notQualified: 'Fas 2 kan inte startas: fas 1 är inte felfri.',
    noDriveOff: 'Klassen har ingen omkörning.',
    notDriveOffQualifier: 'Ekipaget är inte kvalificerat till omkörningen.',
    formatHasNoRound: 'Klassens format har ingen sådan omgång.',
    phase2HasData: 'Fas 1 sparad. Fas 2 startades inte: den har redan data (nollställ fas 2 eller kör om fas 1 för att börja om).',
    phase2RerunConfirm: 'Fas 2 har redan data för ekipaget. Köra om fas 1? Fas 2 (tid, rivningar, status) nollställs.',
    phase2Undecided: 'Fas 2 är inte avgjord: tid saknas eller är inte sparad (eller utesluten/utgått).',
    phase2Live: 'Fas 2 är inte sparad: klockan går eller är stoppad utan att ha sparats.',
    driveOffUndecided: 'Omkörningen är inte avgjord: tid saknas eller är inte sparad (eller utesluten/ej startat).',
    driveOffLive: 'Omkörningen är inte sparad: klockan går eller är stoppad utan att ha sparats.',
    splitRoundsUnsupported: 'Passagerapporteringen stöds inte för klasser med två faser eller omkörning. Registrera start och mål i precisionsinmatningen.'
});
