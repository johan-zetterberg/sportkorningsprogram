// js/core-engine/ranking.js
// The only place where placings and tie-breaks are decided.
//
// Rules (TR V 2025 / FEI 2026):
//   Dressage  – lowest penalty; equal penalties share the place.
//   Marathon  – lowest total, then lowest B-section penalty (TR 527.1);
//               still equal shares the place. FEI classes (rule profile
//               FEI): equal penalties share the place (FEI Art 968.1.4).
//   Precision – lowest penalty, then fastest time in hundredths (TR 530.1.2,
//               FEI Art 977.2.3); still equal shares the place. Unsupported
//               precision formats are not placed.
//   Total     – lowest total, then marathon, then dressage
//               (TR 533.3, FEI Art 904); still equal shares the place.
//   Clear round – the class is not ranked in any phase or in the total
//               (TR V 509.3); results carry isClearRound (isClearRoundClass).

import { isClearRoundClass } from './marathon.js';
import { truncatePrecisionTimeMs } from './rules-ledger.js';

export { isClearRoundClass };

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
    if (!result || result.eliminated || result.isClearRound === true || !isNum(result.penalty)) return null;
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
    // TR 527.1: on equal penalties the lowest penalties on section B win:
    // the engine's bPenalty holds B's time penalty, the obstacles (all on B)
    // and the other / wrong-gait penalties recorded on B. Rows without it
    // (older callers) fall back to B's time penalty and the obstacles.
    // FEI Art 968.1.4: equal penalties are placed equal, so no tie-break
    // (feiClass: the class's rule profile is FEI).
    if (result.feiClass === true) {
        return { penalty: result.totalPenalty, bPenalty: 0 };
    }
    const bPenalty = isNum(result.bPenalty)
        ? result.bPenalty
        : ((Number(result.stages?.B?.timePenalty) || 0)
            + (Number(result.obstaclePenaltySum ?? result.obstacles?.sum) || 0));
    return {
        penalty: result.totalPenalty,
        bPenalty
    };
}

/**
 * @param {object} result - calculatePrecisionResult output
 * @param {object} [opts]
 * @param {boolean} [opts.requireFinished=false] - true for result lists: a run
 *        still on the course gets no place
 */
export function precisionRankKey(result, { requireFinished = false } = {}) {
    if (!result || result.eliminated || result.isClearRound === true || !isNum(result.totalPenalty)) return null;
    // A precision format the engine does not calculate (time competition, two
    // phases, winning round, drive-off, FEI Young Horse): no placing rather
    // than a wrong one
    if (result.formatUnsupported === true) return null;
    if (requireFinished && (result.running || !(result.finalized || result.status === 'Klar'))) return null;
    // Times in hundredths (FEI 975.10.3, TR 530.8): equal hundredths are an
    // equal time, and with equal penalties an equal place (TR 530.1.2)
    const timeMs = truncatePrecisionTimeMs(result.timeMs);
    return {
        penalty: result.totalPenalty,
        timeMs: isNum(timeMs) && timeMs > 0 ? timeMs : null
    };
}

// isClearRound: a class judged clear round is not ranked (TR V 509.3), in
// the total either (dressageRankKey/precisionRankKey/marathonRankKey also
// return null for a result with isClearRound)
export function totalRankKey({ totalPenalty, isEliminated, marathonPenalty, dressagePenalty, isClearRound = false }) {
    if (isEliminated || isClearRound || !isNum(totalPenalty)) return null;
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
