// js/core-engine/calculation.js
import { calculateDressageResult } from './dressage.js';
import { calculateMarathonResult } from './marathon.js';
import { calculatePrecisionResult } from './precision.js';
import { round2, isNum } from './rules-ledger.js';

export function calculateTotalResult(state) {
    const dr = calculateDressageResult(state);
    const ma = calculateMarathonResult(state);
    const pr = calculatePrecisionResult(state);

    const elimD = !!dr.eliminated;
    const elimM = !!ma.eliminated;
    const elimP = !!pr.eliminated;
    const isEliminated = elimD || elimM || elimP;

    let elimReason = null;
    if (elimD) elimReason = 'ELIM (DR)';
    else if (elimM) elimReason = 'ELIM (MA)';
    else if (elimP) elimReason = 'ELIM (PR)';

    // A final total requires all three disciplines
    let total = null;
    if (!isEliminated && isNum(dr.penalty) && isNum(ma.totalPenalty) && isNum(pr.totalPenalty)) {
        total = round2(dr.penalty + ma.totalPenalty + pr.totalPenalty);
    }

    const hasAnyData = (dr.points != null) || (ma.totalPenalty != null) || (pr.totalPenalty != null) || !!pr.running;
    const isOngoing = !isEliminated && total === null && hasAnyData;

    return {
        totalPenalty: total,
        isEliminated,
        elimReason,
        isOngoing,
        dressagePenalty: dr.penalty,
        marathonPenalty: ma.totalPenalty,
        precisionPenalty: pr.totalPenalty,
        dressage: dr,
        marathon: ma,
        precision: pr
    };
}
