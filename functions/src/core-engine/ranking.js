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
//               precision formats are not placed. Two phases and drive-off
//               place by tiers (precisionRankKey, precisionGroupContext).
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

// Precision keys may carry a tier (0 drive-off, 1 out of the drive-off,
// 2 phase 2, 3 out of phase 2, 4 phase 1 only; see precisionRankKey); a key
// without one is tier 4, as before. penaltySec breaks a drive-off tie (FEI
// 978.4.1, owner Q4).
export function comparePrecisionRank(a, b) {
    return compareLow(a.tier ?? 4, b.tier ?? 4)
        || compareLow(a.penalty, b.penalty)
        || compareLow(a.timeMs, b.timeMs)
        || compareLow(a.penaltySec ?? 0, b.penaltySec ?? 0);
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

// Times in hundredths (FEI 975.10.3, TR 530.8): equal hundredths are an
// equal time, and with equal penalties an equal place (TR 530.1.2)
function rankTimeMs(value) {
    const timeMs = truncatePrecisionTimeMs(value);
    return isNum(timeMs) && timeMs > 0 ? timeMs : null;
}

// A placing's key; tier 4 (phase 1 only) keeps the old { penalty, timeMs } shape
function keyFromPlacing(placing) {
    const key = { penalty: placing.penalty, timeMs: rankTimeMs(placing.timeMs) };
    if (placing.tier !== 4) key.tier = placing.tier;
    if (isNum(placing.penaltySec)) key.penaltySec = placing.penaltySec;
    if (placing.provisional === true) key.provisional = true;
    return key;
}

/**
 * @param {object} result - calculatePrecisionResult output (or a row with
 *        { totalPenalty, timeMs, eliminated, placing, rounds, ... })
 * @param {object} [opts]
 * @param {boolean} [opts.requireFinished=false] - true for result lists: a run
 *        still on the course gets no place
 * @param {object} [opts.groupCtx] - the row's group from precisionGroupContext
 *        (drive-off qualifiers); without it no drive-off placing
 * @param {string|number} [opts.startNumber] - the row's start number (for groupCtx)
 *
 * Tiers (lower first): 0 drive-off finished (score, then penalty seconds),
 * 1 drive-off qualifier eliminated / retired (initial-round time, owner Q3),
 * 2-4 from result.placing (calculatePrecisionResult). provisional: true on
 * the qualifiers' keys while the drive-off is pending (owner Q13).
 */
export function precisionRankKey(result, { requireFinished = false, groupCtx = null, startNumber = null } = {}) {
    if (!result || result.eliminated || result.isClearRound === true || !isNum(result.totalPenalty)) return null;
    // A precision format the engine does not calculate (time competition,
    // winning round, FEI Young Horse): no placing rather than a wrong one
    if (result.formatUnsupported === true) return null;
    if (requireFinished && (result.running || !(result.finalized || result.status === 'Klar'))) return null;
    const placing = result.placing;
    if (!placing || typeof placing !== 'object') {
        return { penalty: result.totalPenalty, timeMs: rankTimeMs(result.timeMs) };
    }
    if (placing.tier == null) return null;
    if (requireFinished && placing.unfinished === true) return null;
    // Phase 1 only: the result's own penalty and time (which callers may
    // replace, e.g. with archived values), as before
    const key = placing.tier === 4
        ? keyFromPlacing({ ...placing, penalty: result.totalPenalty, timeMs: result.timeMs })
        : keyFromPlacing(placing);
    const sn = startNumber ?? result.startNumber;
    if (!groupCtx || !groupCtx.driveOffNeeded || sn == null || !groupCtx.driveOffQualifiers?.has(String(sn))) return key;
    // Drive-off qualifier (FEI 977.2.1): places 1..k from the drive-off
    const dOff = result.rounds?.driveOff;
    let out = key;
    if (dOff?.finished && isNum(dOff.totalPenalty)) {
        out = { tier: 0, penalty: dOff.totalPenalty, timeMs: null, penaltySec: isNum(dOff.penaltySec) ? dOff.penaltySec : 0 };
    } else if (dOff?.out) {
        out = { tier: 1, penalty: key.penalty, timeMs: key.timeMs };
    }
    if (!groupCtx.driveOffComplete) out = { ...out, provisional: true };
    return out;
}

// Drive-off qualifiers compare on tier and penalty only (FEI 971.1.2
// "equality of penalties", 977.2.1)
function compareTierPenalty(a, b) {
    return compareLow(a.tier ?? 4, b.tier ?? 4) || compareLow(a.penalty, b.penalty);
}

/**
 * The class context precision placings need: per placing group (a merged
 * class is one group, owner Q8) the drive-off qualifiers (all placeable rows
 * with the group's lowest penalties, when the class schedules a drive-off and
 * at least two share them; FEI 977.2.1), whether the drive-off is complete,
 * and warnings.
 *
 * @param {Array} rows
 * @param {(row) => object} resultOf - the row's calculatePrecisionResult output
 * @param {(row) => string} [groupOf] - placing group; default one group
 * @param {object} [opts] - { requireFinished, startNumberOf }
 * @returns {{
 *   groups: Map<string, object>,   // group key -> ctx
 *   contextOf: (row) => object,    // ctx: { key, driveOffScheduled, driveOffQualifiers:Set<string>,
 *                                  //        qualifierStartNumbers:string[], driveOffNeeded,
 *                                  //        driveOffComplete, driveOffPending, warnings:[{startNumber, code}] }
 *   rankKey: (row, opts) => object|null,  // precisionRankKey with the row's ctx
 *   isProvisional: (row) => boolean,
 *   pending: boolean,              // a drive-off still to be driven in some group
 *   warnings: Array
 * }}
 * Warning codes: 'driveOffIgnored' (drive-off data of a non-qualifier),
 * 'phase2Ignored', 'trDriveOffVariant' (once per group).
 */
export function precisionGroupContext(rows = [], resultOf = (row) => row, groupOf = () => '', {
    requireFinished = false,
    startNumberOf = (row) => row?.startNumber
} = {}) {
    const results = new Map();
    const groups = new Map();
    const rowGroup = new Map();
    for (const row of rows || []) {
        const g = String(groupOf(row) ?? '');
        rowGroup.set(row, g);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(row);
        results.set(row, resultOf(row));
    }

    const contexts = new Map();
    const allWarnings = [];
    for (const [g, groupRows] of groups) {
        const entries = groupRows.map((row) => {
            const result = results.get(row);
            const sn = String(startNumberOf(row) ?? result?.startNumber ?? '');
            return { row, sn, result, key: precisionRankKey(result, { requireFinished }) };
        });
        const scheduled = entries.some((e) => e.result?.driveOffScheduled === true);
        const placeable = entries.filter((e) => e.key && e.sn);
        let qualifiers = [];
        if (scheduled && placeable.length >= 2) {
            const best = placeable.reduce((a, b) => (compareTierPenalty(b.key, a.key) < 0 ? b : a)).key;
            qualifiers = placeable.filter((e) => compareTierPenalty(e.key, best) === 0);
            if (qualifiers.length < 2) qualifiers = [];
        }
        const qualifierSet = new Set(qualifiers.map((e) => e.sn));
        const decided = (e) => {
            const dOff = e.result?.rounds?.driveOff;
            return !!dOff && dOff.decided === true;
        };
        const driveOffNeeded = qualifiers.length >= 2;
        const driveOffComplete = driveOffNeeded && qualifiers.every(decided);
        const warnings = [];
        for (const e of entries) {
            if (!qualifierSet.has(e.sn) && e.result?.rounds?.driveOff?.hasData) warnings.push({ startNumber: e.sn, code: 'driveOffIgnored' });
            if (e.result?.phase2Ignored === true) warnings.push({ startNumber: e.sn, code: 'phase2Ignored' });
        }
        if (entries.some((e) => (e.result?.formatWarnings || []).includes('trDriveOffVariant'))) {
            warnings.push({ startNumber: null, code: 'trDriveOffVariant' });
        }
        const ctx = {
            key: g,
            driveOffScheduled: scheduled,
            driveOffQualifiers: qualifierSet,
            // Start order of the drive-off: as in the initial round (FEI
            // 977.4.1); by start number here, the page may sort by start time
            qualifierStartNumbers: [...qualifierSet].sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b)),
            driveOffNeeded,
            driveOffComplete,
            driveOffPending: driveOffNeeded && !driveOffComplete,
            warnings
        };
        contexts.set(g, ctx);
        allWarnings.push(...warnings.map((w) => ({ ...w, group: g })));
    }

    const contextOf = (row) => contexts.get(rowGroup.has(row) ? rowGroup.get(row) : String(groupOf(row) ?? '')) || null;
    const rankKey = (row, opts = {}) => precisionRankKey(results.has(row) ? results.get(row) : resultOf(row), {
        requireFinished,
        ...opts,
        groupCtx: contextOf(row),
        startNumber: startNumberOf(row)
    });
    return {
        groups: contexts,
        contextOf,
        rankKey,
        isProvisional: (row) => rankKey(row)?.provisional === true,
        pending: [...contexts.values()].some((c) => c.driveOffPending),
        warnings: allWarnings
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
