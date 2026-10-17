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
    // Clear round: the class is not ranked, in any phase or the total (TR V 509.3)
    const isClearRound = dr.isClearRound === true || ma.isClearRound === true || pr.isClearRound === true;

    let elimReason = null;
    if (elimD) elimReason = 'ELIM (DR)';
    else if (elimM) elimReason = 'ELIM (MA)';
    else if (elimP) elimReason = 'ELIM (PR)';

    // A total (and so a placing) requires all three disciplines to be finished:
    // dressage fully judged by every judge assigned to the class, marathon
    // finished, precision not running
    const dressageComplete = isNum(dr.penalty) && !dr.isLive && dr.judgesComplete !== false;
    const marathonComplete = isNum(ma.totalPenalty) && ma.status === 'Klar';
    const precisionComplete = isNum(pr.totalPenalty) && !pr.running && !pr.configMissing
        && (pr.finalized || pr.status === 'Klar');

    let total = null;
    if (!isEliminated && dressageComplete && marathonComplete && precisionComplete) {
        total = round2(dr.penalty + ma.totalPenalty + pr.totalPenalty);
    }

    const hasAnyData = (dr.points != null) || (ma.totalPenalty != null) || (pr.totalPenalty != null) || !!pr.running;
    const isOngoing = !isEliminated && total === null && hasAnyData;

    return {
        totalPenalty: total,
        isEliminated,
        elimReason,
        isOngoing,
        isClearRound,
        dressageComplete,
        marathonComplete,
        precisionComplete,
        dressagePenalty: dr.penalty,
        marathonPenalty: ma.totalPenalty,
        precisionPenalty: pr.totalPenalty,
        dressage: dr,
        marathon: ma,
        precision: pr
    };
}
