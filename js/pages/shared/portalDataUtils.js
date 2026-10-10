function finiteOrInfinity(value) {
    if (value === Infinity) return Infinity;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isEliminatedSource(source = {}) {
    return !!(
        source?.eliminated ||
        source?.isEliminated ||
        source?.excluded ||
        source?.disqualified ||
        source?.status === 'ELIM'
    );
}

function penaltyFromSource(source, ...keys) {
    if (isEliminatedSource(source)) return Infinity;
    for (const key of keys) {
        const normalized = finiteOrInfinity(source?.[key]);
        if (normalized !== null) return normalized;
    }
    return null;
}

export function normalizePortalStartTimesConfig(config = {}) {
    if (config?.times && typeof config.times === 'object') return { ...config, times: config.times };
    if (config?.value?.times && typeof config.value.times === 'object') return { ...config, times: config.value.times };
    return { ...config, times: {} };
}

export function getPortalStartTimesForEquipage(startTimesConfig, startNumber) {
    const normalized = normalizePortalStartTimesConfig(startTimesConfig);
    return normalized.times?.[String(startNumber)] || {};
}

function timestampToMs(value) {
    if (!value) return null;
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export function formatPortalTimestamp(value, locale = 'sv-SE', options = {}) {
    const ms = timestampToMs(value);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toLocaleString(locale, options);
}

export function sortPortalItemsByTimestampDesc(items = [], timestampKey = 'timestamp') {
    return [...items].sort((a, b) => {
        const aMs = timestampToMs(a?.[timestampKey]) || 0;
        const bMs = timestampToMs(b?.[timestampKey]) || 0;
        return bMs - aMs;
    });
}

export function getPortalMinutesToNextStart(startTimesConfig, startNumber, now = Date.now()) {
    const row = getPortalStartTimesForEquipage(startTimesConfig, startNumber);
    const startTimes = Object.values(row)
        .map(timestampToMs)
        .filter(ms => Number.isFinite(ms))
        .sort((a, b) => a - b);

    if (!startTimes.length) return null;
    return (startTimes[0] - now) / 60000;
}

// computed_equipages (Cloud Function, same engine as the browser) stores flat
// fields: dressagePenalty, marathonPenalty, precisionPenalty, elimReason.
function computedPenalty(computedResult, flatKey, nestedKey, elimReason) {
    if (computedResult?.elimReason === elimReason) return Infinity;
    return finiteOrInfinity(computedResult?.[flatKey])
        ?? penaltyFromSource(computedResult?.[nestedKey], 'totalPenalty', 'penalty');
}

export function resolvePortalDisciplinePenalties({
    computedResult = {},
    dressagePenalty = null,
    marathonTiming = {},
    precisionResult = {}
} = {}) {
    const dRes = computedPenalty(computedResult, 'dressagePenalty', 'dressage', 'ELIM (DR)')
        ?? finiteOrInfinity(dressagePenalty);
    const mRes = computedPenalty(computedResult, 'marathonPenalty', 'marathon', 'ELIM (MA)')
        ?? penaltyFromSource(marathonTiming, 'totalPenalty');
    // The live precision doc is fresher than the server snapshot during a run
    const pRes = penaltyFromSource(precisionResult, 'totalPenalty', 'liveTotalPenalty')
        ?? computedPenalty(computedResult, 'precisionPenalty', 'precision', 'ELIM (PR)');

    return { dRes, mRes, pRes };
}
