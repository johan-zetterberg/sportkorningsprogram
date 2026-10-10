// js/core-engine/ranking.js
// The only place where placings and tie-breaks are decided.
//
// Rules (TR V 2025 / FEI 2026):
//   Dressage  – lowest penalty; equal penalties share the place.
//   Marathon  – lowest total, then lowest B-section penalty (TR 527.1);
//               still equal shares the place.
//   Precision – lowest penalty, then fastest time (TR 530, FEI Art 977);
//               still equal shares the place.
//   Total     – lowest total, then marathon, then dressage
//               (TR 533.3, FEI Art 904); still equal shares the place.

export const RANK_TOLERANCE = 1e-6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Lower is better; a missing value ranks after any number
function compareLow(a, b) {
    const x = isNum(a) ? a : Infinity;
    const y = isNum(b) ? b : Infinity;
    if (x === y) return 0;
    if (Math.abs(x - y) <= RANK_TOLERANCE) return 0;
    return x < y ? -1 : 1;
}

// --- Comparators on rank keys ---

export function compareDressageRank(a, b) {
    return compareLow(a.penalty, b.penalty);
}

export function compareMarathonRank(a, b) {
    return compareLow(a.penalty, b.penalty)
        || compareLow(a.bPenalty ?? 0, b.bPenalty ?? 0);
}

export function comparePrecisionRank(a, b) {
    return compareLow(a.penalty, b.penalty)
        || compareLow(a.timeMs, b.timeMs);
}

export function compareTotalRank(a, b) {
    return compareLow(a.penalty, b.penalty)
        || compareLow(a.marathon, b.marathon)
        || compareLow(a.dressage, b.dressage);
}

// --- Rank keys from engine results (null = cannot be placed) ---

export function dressageRankKey(result) {
    if (!result || result.eliminated || !isNum(result.penalty)) return null;
    return { penalty: result.penalty };
}

/**
 * @param {object} result - calculateMarathonResult output
 * @param {object} [opts]
 * @param {boolean} [opts.requireFinished=true] - only finished rows get a place
 *        (false for live/speaker standings)
 */
export function marathonRankKey(result, { requireFinished = true } = {}) {
    if (!result || result.eliminated || result.isClearRound) return null;
    if (!isNum(result.totalPenalty)) return null;
    if (requireFinished && result.status !== 'Klar' && result.status !== 'Färdig') return null;
    return {
        penalty: result.totalPenalty,
        bPenalty: Number(result.stages?.B?.timePenalty) || 0
    };
}

export function precisionRankKey(result) {
    if (!result || result.eliminated || !isNum(result.totalPenalty)) return null;
    return {
        penalty: result.totalPenalty,
        timeMs: isNum(result.timeMs) && result.timeMs > 0 ? result.timeMs : null
    };
}

export function totalRankKey({ totalPenalty, isEliminated, marathonPenalty, dressagePenalty }) {
    if (isEliminated || !isNum(totalPenalty)) return null;
    return { penalty: totalPenalty, marathon: marathonPenalty, dressage: dressagePenalty };
}

// --- Placing ---

const startNumberOf = (row) => Number(row?.startNumber) || 0;

/**
 * Assigns placings within groups. Rows that compare equal share a place
 * (1, 2, 2, 4). Rows whose key is null get place null.
 *
 * @param {Array} rows
 * @param {object} opts
 * @param {(row) => object|null} opts.key - rank key, or null when the row cannot be placed
 * @param {(a, b) => number} opts.compare - comparator on rank keys
 * @param {(row) => string} [opts.group] - group (class) key; default one group
 * @param {string|null} [opts.outField='plac'] - field to write the place to; null to only return
 * @returns {{ ranked: Array, placeOf: Map }} ranked rows (best first, per group in
 *          first-seen group order) and a Map row -> place
 */
export function assignPlaces(rows = [], { key, compare, group = () => '', outField = 'plac' } = {}) {
    const groups = new Map();
    const keys = new Map();
    const placeOf = new Map();

    for (const row of rows) {
        const g = String(group(row) ?? '');
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(row);
        keys.set(row, key(row));
        placeOf.set(row, null);
    }

    const ranked = [];
    for (const groupRows of groups.values()) {
        const rankable = groupRows
            .filter(row => keys.get(row) != null)
            .sort((a, b) => compare(keys.get(a), keys.get(b)) || (startNumberOf(a) - startNumberOf(b)));

        let place = 0;
        rankable.forEach((row, index) => {
            const tied = index > 0 && compare(keys.get(row), keys.get(rankable[index - 1])) === 0;
            if (!tied) place = index + 1;
            placeOf.set(row, place);
        });
        ranked.push(...rankable);
    }

    if (outField) {
        for (const row of rows) row[outField] = placeOf.get(row);
    }
    return { ranked, placeOf };
}
