// Pure helpers for the precision input page (no Firestore, no DOM): the knock
// list and penalties a save uses, and a sanity check of the shared clock.

import { nestPrecisionRoundPayload, normalizePrecisionRound, readPrecisionRound } from '../../utils/precisionRounds.js';
import { precisionRoundHasData } from '../../utils/precisionCalculation.js';

// Clock skew allowed between devices before a start "in the future" is refused
export const CLOCK_FUTURE_TOLERANCE_MS = 10000;
// Without a known max time: a run longer than this is not a real run
export const CLOCK_FALLBACK_LIMIT_MS = 30 * 60000;

/** Knock labels as strings, sorted the way the page shows them */
export function sortKnocks(list) {
    return (Array.isArray(list) ? list : [])
        .map(String)
        .sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
}

/** A typed knock list ("3A, 5 7b") as sorted unique labels (the secretariat's knock field) */
export function parseKnockListInput(text) {
    const labels = String(text ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    return sortKnocks([...new Set(labels)]);
}

/** A knock list as the secretariat's field shows it: "3A, 5" */
export function formatKnockList(list) {
    return sortKnocks(list).join(', ');
}

/** The knocks of the stored precision document (the only source a save uses) */
export function storedKnocks(stored) {
    return sortKnocks(stored?.knocks);
}

/** The stored obstacle rebuild count (whole number >= 0) */
export function storedRebuildCount(stored) {
    const n = Number(stored?.rebuildCount);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Label next to the clock: '' or '+10 s × 2' */
export function rebuildLabel(count, addedSec = 10) {
    const n = storedRebuildCount({ rebuildCount: count });
    return n > 0 ? `+${addedSec} s × ${n}` : '';
}

/**
 * The fields a judge's Save writes. The knock list itself is not among them:
 * knocks are written one toggle at a time (arrayUnion/arrayRemove), and a
 * whole list from this device would erase knocks entered on another one. The
 * penalties are computed from the stored document's knocks.
 *
 * calculate(data) is the result engine bound to the equipage and config.
 *
 * round: 'phase1' (default, the top level) or 'phase2' / 'driveOff': then
 * `stored` is still the whole stored doc, the round's knocks and rebuilds are
 * read from stored.rounds[round], calculate must score that round
 * (calculatePrecisionRoundResult(data, eq, config, round)), and the payload is
 * nested: { startNumber, className, updatedAt, rounds: { [round]: {...} } }.
 */
export function buildPrecisionSavePayload({
    stored = null,
    timeMs = 0,
    extraPenalty = 0,
    eliminated = false,
    comment = '',
    startNumber,
    className,
    calculate,
    notStartedLabel = 'Ej startat',
    now = Date.now(),
    round = 'phase1'
} = {}) {
    const r = normalizePrecisionRound(round);
    const roundStored = r === 'phase1' ? stored : readPrecisionRound(stored, r);
    const knocks = storedKnocks(roundStored);
    const safeTime = Math.max(0, Math.round(Number(timeMs) || 0));
    // Rebuilds (+10 s each) are their own field, written by the +10 s button:
    // counted here, never written by a save
    const calc = calculate({
        timeMs: safeTime,
        liveTimeMs: safeTime,
        knocks,
        rebuildCount: storedRebuildCount(roundStored),
        extraPenalty,
        eliminated
    }) || {};
    // Shown live, never stored as obstaclePenalty: the result engine counts the
    // stored knock list, which another device may still add to (a queued save
    // could not correct a stored count afterwards)
    const obstaclePenalty = Number.isFinite(calc.obstaclePenalty) ? calc.obstaclePenalty : 0;
    // Without a max time for the class (configMissing) the engine gives no time
    // penalty and no total: saved empty, not as 0, and never as 'Klar'
    const timePenalty = calc.configMissing ? null : (calc.timePenalty ?? 0);
    // Eliminated: no total (a 0 would be read back as a result once finalized)
    const totalPenalty = (calc.configMissing || eliminated) ? null : (calc.totalPenalty ?? 0);
    const hasAnyData = eliminated || safeTime > 0 || knocks.length > 0 || extraPenalty > 0 || String(comment).length > 0;

    const payload = {
        startNumber,
        className,
        running: false,
        inProgress: false,
        liveStartEpoch: null,
        livePausedMs: safeTime,
        liveTimeMs: safeTime,
        timeMs: safeTime,
        timePenalty,
        liveTimePenalty: timePenalty,
        liveObstaclePenalty: obstaclePenalty,
        extraPenalty,
        totalPenalty,
        liveTotalPenalty: totalPenalty,
        eliminated,
        comment,
        status: eliminated ? 'Utesluten' : (calc.configMissing ? 'Pågår' : (hasAnyData ? 'Klar' : notStartedLabel)),
        updatedAt: now
    };
    if (r === 'phase1') return { payload, calc, knocks };
    const fields = { ...payload };
    delete fields.startNumber;
    delete fields.className;
    return { payload: nestPrecisionRoundPayload(r, fields, { startNumber, className, updatedAt: now }), calc, knocks };
}

/**
 * After a save: when the stored document's knocks or rebuilds differ from the
 * ones the save counted (another device added one in between), the penalty
 * fields to write again; null when nothing changed. round as in
 * buildPrecisionSavePayload: savedPayload and the correction are then nested
 * under rounds[round] (storedAfter stays the whole doc).
 */
export function penaltyCorrection(savedPayload, savedKnocks, storedAfter, calculate, savedRebuildCount = 0, round = 'phase1') {
    if (!savedPayload || !storedAfter) return null;
    const r = normalizePrecisionRound(round);
    const roundAfter = r === 'phase1' ? storedAfter : readPrecisionRound(storedAfter, r);
    const saved = r === 'phase1' ? savedPayload : (savedPayload.rounds?.[r] || {});
    const after = storedKnocks(roundAfter);
    const before = sortKnocks(savedKnocks);
    const sameKnocks = after.length === before.length && after.every((k, i) => k === before[i]);
    const sameRebuilds = storedRebuildCount(roundAfter) === storedRebuildCount({ rebuildCount: savedRebuildCount });
    if (sameKnocks && sameRebuilds) return null;
    // A clock started again since then is that device's to finish
    if (roundAfter.running === true) return null;
    // Everything from the stored document: another device may have saved too
    const { payload } = buildPrecisionSavePayload({
        stored: storedAfter,
        timeMs: roundAfter.timeMs ?? saved.timeMs,
        extraPenalty: Number(roundAfter.extraPenalty ?? saved.extraPenalty) || 0,
        eliminated: roundAfter.eliminated === true,
        comment: String(roundAfter.comment ?? saved.comment ?? ''),
        startNumber: savedPayload.startNumber,
        className: savedPayload.className,
        calculate,
        notStartedLabel: saved.status,
        now: savedPayload.updatedAt,
        round: r
    });
    const fields = r === 'phase1' ? payload : payload.rounds[r];
    const correction = {
        liveObstaclePenalty: fields.liveObstaclePenalty,
        timePenalty: fields.timePenalty,
        liveTimePenalty: fields.liveTimePenalty,
        totalPenalty: fields.totalPenalty,
        liveTotalPenalty: fields.liveTotalPenalty,
        status: fields.status
    };
    return r === 'phase1' ? correction : { rounds: { [r]: correction } };
}

/**
 * Two phases: the phase-1 finish line (FEI 979.1.1 "the Finishing Line for the
 * First Section being the Start Line for the Second Section"; TR 530.1.3
 * "direkt utan ny startsignal"). One merge write: the phase-1 save (top
 * level, time = the split) and, when phase 1 is clear, phase 2 started at the
 * same instant (rounds.phase2 running, liveStartEpoch = splitEpoch) with
 * activeRound 'phase2', so the clock runs on without a gap. Not clear: phase
 * 1 is only saved (the judge's bell, TR 530.1.3 / FEI 979.4.1).
 *
 * calculate(data) scores phase 1 (calculatePrecisionResult bound to the
 * equipage and config). Returns { payload, calc, knocks, qualified,
 * phase2Blocked }.
 *
 * A stored phase 2 that already holds data (started, driven, saved) is never
 * started again by this write (a late or repeated "Fas 1 mål" would restart a
 * driven phase 2 and keep its old knocks): phase 1 is then only saved and
 * phase2Blocked is true. A deliberate re-run of phase 1 clears phase 2 first
 * (buildPrecisionRoundClearWrite).
 */
export function buildPhase1FinishWrite({
    stored = null,
    splitMs = 0,
    splitEpoch = Date.now(),
    extraPenalty = 0,
    eliminated = false,
    comment = '',
    startNumber,
    className,
    calculate,
    notStartedLabel = 'Ej startat',
    now = Date.now()
} = {}) {
    const { payload, calc, knocks } = buildPrecisionSavePayload({
        stored, timeMs: splitMs, extraPenalty, eliminated, comment, startNumber, className, calculate, notStartedLabel, now
    });
    const total = Number(payload.totalPenalty);
    const qualified = !eliminated && !calc.configMissing && calc.eliminated !== true
        && payload.totalPenalty !== null && Number.isFinite(total) && Math.abs(total) <= 1e-6;
    if (!qualified) return { payload, calc, knocks, qualified: false, phase2Blocked: false };
    if (phase2HasData(stored)) return { payload, calc, knocks, qualified: true, phase2Blocked: true };
    return {
        payload: {
            ...payload,
            activeRound: 'phase2',
            rounds: {
                phase2: {
                    running: true,
                    inProgress: true,
                    liveStartEpoch: splitEpoch,
                    livePausedMs: 0,
                    liveTimeMs: 0,
                    status: 'Pågår',
                    updatedAt: now
                }
            }
        },
        calc,
        knocks,
        qualified: true,
        phase2Blocked: false
    };
}

/**
 * Whether the stored phase 2 already holds anything: started, driven, knocks,
 * a saved status. Such a phase 2 is not started again by "Fas 1 mål", and a
 * phase-1 re-run clears it first (with the judge's confirmation).
 */
export function phase2HasData(stored) {
    const p2 = readPrecisionRound(stored, 'phase2');
    return precisionRoundHasData(p2) || ['Klar', 'Utesluten', 'Utgått'].includes(p2.status);
}

/**
 * Whether a Stop is pushed for the round: not when the latest stored copy of
 * the round is already saved (inProgress false and not running). A stale
 * Stop would otherwise mark a saved round unsaved again and replace its time.
 */
export function shouldPushStop(storedRound) {
    const r = storedRound || {};
    return !(r.running !== true && r.inProgress === false);
}

/**
 * The time a stored round shows: the saved time once it is finalized or saved
 * (inProgress false, not running, a time), otherwise the clock's liveTimeMs
 * (stops, knocks, corrections write it; an old saved time must not come back
 * after a reset). As the result engine (calculatePrecisionRound).
 */
export function storedRoundTimeMs(round) {
    const r = round || {};
    const timeMs = Number(r.timeMs);
    const saved = r.inProgress === false && r.running !== true && Number.isFinite(timeMs) && timeMs > 0;
    const value = (r.finalized === true || saved)
        ? (r.timeMs ?? r.liveTimeMs ?? 0)
        : (r.liveTimeMs ?? r.timeMs ?? 0);
    return Number(value);
}

/** How long a run may plausibly last (ms), from the class's max time in seconds */
export function plausibleRunLimitMs(maxSec) {
    const max = Number(maxSec);
    return Number.isFinite(max) && max > 0 ? 2 * max * 1000 + 60000 : CLOCK_FALLBACK_LIMIT_MS;
}

/**
 * The running clock's time, or why it cannot be trusted:
 * { ok: true, elapsedMs } or { ok: false, reason: 'missing-start' | 'future-start' | 'too-long', elapsedMs: pausedMs }.
 * A result marked running without a start time would otherwise show the time
 * since 1970.
 */
export function checkPrecisionClock({ startEpoch, pausedMs = 0, nowMs, maxSec = null } = {}) {
    const paused = Number.isFinite(Number(pausedMs)) && Number(pausedMs) > 0 ? Number(pausedMs) : 0;
    const start = Number(startEpoch);
    const now = Number(nowMs);
    if (startEpoch == null || startEpoch === '' || !Number.isFinite(start) || start <= 0 || !Number.isFinite(now)) {
        return { ok: false, reason: 'missing-start', elapsedMs: paused };
    }
    if (start - now > CLOCK_FUTURE_TOLERANCE_MS) {
        return { ok: false, reason: 'future-start', elapsedMs: paused };
    }
    const elapsedMs = paused + Math.max(0, now - start);
    if (elapsedMs > plausibleRunLimitMs(maxSec)) {
        return { ok: false, reason: 'too-long', elapsedMs: paused };
    }
    return { ok: true, elapsedMs };
}

/** Short Swedish warning for a clock that failed checkPrecisionClock */
export function clockFaultMessage(reason) {
    switch (reason) {
        case 'missing-start': return 'Klockan saknar starttid – stoppa och ange tiden manuellt.';
        case 'future-start': return 'Klockans starttid ligger i framtiden – stoppa och ange tiden manuellt.';
        case 'too-long': return 'Klockan har gått orimligt länge – stoppa och ange tiden manuellt.';
        default: return '';
    }
}
