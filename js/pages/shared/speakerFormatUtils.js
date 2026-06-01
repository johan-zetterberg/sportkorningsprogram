export function isFiniteSpeakerNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

export function formatSpeakerPenalty(value, { eliminated = false, empty = '—', decimals = 2 } = {}) {
    if (eliminated || value === Infinity) return 'ELIM';
    return isFiniteSpeakerNumber(value) ? value.toFixed(decimals) : empty;
}

export function formatSpeakerPercent(value, { empty = '—', decimals = 1 } = {}) {
    return isFiniteSpeakerNumber(value) ? `${value.toFixed(decimals)}%` : empty;
}

export function getSpeakerPenaltyOrNull(value) {
    return isFiniteSpeakerNumber(value) ? value : null;
}
