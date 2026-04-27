// js/core-engine/calculation.js
import { calculateDressageResult } from './dressage.js';
import { calculateMarathonResult } from './marathon.js';
import { calculatePrecisionResult } from './precision.js';
import { round2, isNum } from './rules-ledger.js';

export function calculateTotalResult(state) {
    // 1. Dressage
    const dr = calculateDressageResult(state);

    // 2. Marathon
    const ma = calculateMarathonResult(state);

    // 3. Precision
    const pr = calculatePrecisionResult(state);

    // 4. Total
    const elim = dr.eliminated || ma.eliminated || pr.eliminated;
    let total = null;

    if (!elim && isNum(dr.penalty) && isNum(ma.totalPenalty) && isNum(pr.totalPenalty)) {
        total = round2(dr.penalty + ma.totalPenalty + pr.totalPenalty);
    }

    return {
        totalPenalty: total,
        isEliminated: elim,
        dressagePenalty: dr.penalty,
        marathonPenalty: ma.totalPenalty,
        precisionPenalty: pr.totalPenalty
    };
}
