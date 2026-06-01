export function toFiniteNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function toFiniteNumberOrZero(value) {
    return toFiniteNumberOrNull(value) ?? 0;
}

export function isLiveInjectionEliminated(info = {}) {
    return info.eliminated === true || info.disciplinePenalty === Infinity;
}
