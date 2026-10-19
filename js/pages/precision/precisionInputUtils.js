// Pure helpers for the precision input page (no Firestore, no DOM): the knock
// list and penalties a save uses, and a sanity check of the shared clock.

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
    now = Date.now()
} = {}) {
    const knocks = storedKnocks(stored);
    const safeTime = Math.max(0, Math.round(Number(timeMs) || 0));
    // Rebuilds (+10 s each) are their own field, written by the +10 s button:
    // counted here, never written by a save
    const calc = calculate({
        timeMs: safeTime,
        liveTimeMs: safeTime,
        knocks,
        rebuildCount: storedRebuildCount(stored),
        extraPenalty,
        eliminated
    }) || {};
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
        obstaclePenalty,
        liveObstaclePenalty: obstaclePenalty,
        extraPenalty,
        totalPenalty,
        liveTotalPenalty: totalPenalty,
        eliminated,
        comment,
        status: eliminated ? 'Utesluten' : (calc.configMissing ? 'Pågår' : (hasAnyData ? 'Klar' : notStartedLabel)),
        updatedAt: now
    };
    return { payload, calc, knocks };
}

/**
 * After a save: when the stored document's knocks or rebuilds differ from the
 * ones the save counted (another device added one in between), the penalty
 * fields to write again; null when nothing changed.
 */
export function penaltyCorrection(savedPayload, savedKnocks, storedAfter, calculate, savedRebuildCount = 0) {
    if (!savedPayload || !storedAfter) return null;
    const after = storedKnocks(storedAfter);
    const before = sortKnocks(savedKnocks);
    const sameKnocks = after.length === before.length && after.every((k, i) => k === before[i]);
    const sameRebuilds = storedRebuildCount(storedAfter) === storedRebuildCount({ rebuildCount: savedRebuildCount });
    if (sameKnocks && sameRebuilds) return null;
    // A clock started again since then is that device's to finish
    if (storedAfter.running === true) return null;
    // Everything from the stored document: another device may have saved too
    const { payload } = buildPrecisionSavePayload({
        stored: storedAfter,
        timeMs: storedAfter.timeMs ?? savedPayload.timeMs,
        extraPenalty: Number(storedAfter.extraPenalty ?? savedPayload.extraPenalty) || 0,
        eliminated: storedAfter.eliminated === true,
        comment: String(storedAfter.comment ?? savedPayload.comment ?? ''),
        startNumber: savedPayload.startNumber,
        className: savedPayload.className,
        calculate,
        notStartedLabel: savedPayload.status,
        now: savedPayload.updatedAt
    });
    return {
        obstaclePenalty: payload.obstaclePenalty,
        liveObstaclePenalty: payload.liveObstaclePenalty,
        timePenalty: payload.timePenalty,
        liveTimePenalty: payload.liveTimePenalty,
        totalPenalty: payload.totalPenalty,
        liveTotalPenalty: payload.liveTotalPenalty,
        status: payload.status
    };
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
