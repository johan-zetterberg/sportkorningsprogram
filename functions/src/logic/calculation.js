// functions/src/logic/calculation.js


import { calculateMarathonResult as calcMarathonInternal } from './marathon.js';
import { calculatePrecisionResult as calcPrecisionInternal } from './precision.js';
import { round2, isNum } from './sharedUtils.js';

import { getPrograms, guessProgramKeyFromClass, deduplicateAndFilterProtocols, computeFinalFromSaved } from './dressage.js';
import { getDressagePenaltyCoeff } from './dressage.js'; // Explicit import needed? 

// Wrapper for Dressage to match Service signature
export function calculateDressageResult(equipage, protocols, validJudges = [], allPrograms) {
    if (!equipage) return { penalty: null };
    const progKey = equipage.testKey || equipage.programKey || guessProgramKeyFromClass(equipage.className, allPrograms);
    const program = allPrograms[progKey];

    const clean = deduplicateAndFilterProtocols(protocols || [], validJudges);
    const isElim = clean.some(p => p.eliminated);

    if (!program || clean.length === 0) return { penalty: null, eliminated: isElim };

    const result = computeFinalFromSaved(equipage, clean, program);
    let penalty = null;
    if (result) {
        const coeff = getDressagePenaltyCoeff(program);
        const err = (Number(equipage.errorPoints) || 0) * coeff;
        penalty = round2(result.penalty + err);
    }
    return { penalty, eliminated: isElim, judgePenalty: result?.penalty };
}

export function calculateTotalResult(equipage, dressageProtocols, marathonDoc, timingDoc, precisionDoc, context = {}) {
    // 1. Dressage
    const dr = calculateDressageResult(equipage, dressageProtocols, context.judges, context.allPrograms);

    // 2. Marathon
    const ma = calcMarathonInternal(equipage, marathonDoc, timingDoc, context.marathonConfig);

    // 3. Precision
    const pr = calcPrecisionInternal(precisionDoc, equipage, context.precisionConfig);

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
