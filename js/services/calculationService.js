
import {
    computeFinalFromSaved,
    getPrograms,
    guessProgramKeyFromClass,
    deduplicateAndFilterProtocols,
    getDressagePenaltyCoeff
} from '../utils/dressageUtils.js';

import {
    calculateMarathonResult as _calcMarathon
} from '../utils/marathonUtils.js';

import {
    calculatePrecisionResult as _calcPrecision
} from '../utils/precisionUtils.js';

import { round2, isNum } from '../utils/sharedUtils.js';

// =========================================================================
// CALCULATION SERVICE
// -------------------------------------------------------------------------
// Centralizes all score calculation logic for Dressage, Marathon, and Precision.
// This ensures that Result Monitors, PDF exports, and Total Results always
// use the exact same formula, preventing discrepancies.
// =========================================================================

// --- DRESSAGE ---

/**
 * Calculates the final dressage result for an equipage based on their protocols.
 * @param {Object} equipage - The equipage object (should contain errorPoints).
 * @param {Array} protocols - List of protocol objects (will be deduplicated).
 * @param {Array} validJudges - List of valid judges for the competition (optional).
 * @param {Object} programsOverride - Optional dictionary of programs.
 * @returns {Object} Comprehensive result object.
 */
export function calculateDressageResult(equipage, protocols, validJudges = [], programsOverride = null) {
    if (!equipage) return { penalty: null, percent: null, points: null, judgePenalty: null, errorPoints: 0, eliminated: false };

    // 1. Get Programs
    const allPrograms = programsOverride || getPrograms();

    // 2. Determine Program
    let programKey = equipage.testKey || equipage.programKey;
    if (!programKey || !allPrograms[programKey]) {
        // Fallback: search protocols if not on equipage
        const protoWithKey = (protocols || []).find(p => p.testKey || p.programKey);
        if (protoWithKey) programKey = protoWithKey.testKey || protoWithKey.programKey;
    }

    if (!programKey || !allPrograms[programKey]) {
        programKey = guessProgramKeyFromClass(equipage.className, allPrograms);
    }
    const program = programKey ? allPrograms[programKey] : null;

    // 3. Clean Protocols
    const cleanProtocols = deduplicateAndFilterProtocols(protocols || [], validJudges);
    const isEliminated = !!equipage.eliminated || cleanProtocols.some(p => p.eliminated);

    // Extract Error Points from either equipage or the 'general' protocol doc
    const generalDoc = (protocols || []).find(p => p.id === 'general' || typeof p.errorPoints === 'number');
    const eqErrorPoints = Number(equipage.errorPoints) || 0;
    const genErrorPoints = generalDoc ? (Number(generalDoc.errorPoints) || 0) : 0;
    const effectiveErrorPoints = Math.max(eqErrorPoints, genErrorPoints);

    const judgeProtocols = cleanProtocols.filter(p => p.id !== 'general');

    // 4. Calculate
    if (!program || judgeProtocols.length === 0) {
        return {
            penalty: isEliminated ? 0 : null, // If eliminated, total penalty is often irrelevant but points/percent are 0
            judgePenalty: null,
            percent: isEliminated ? 0 : null,
            points: isEliminated ? 0 : null,
            eliminated: isEliminated,
            programName: program ? program.name : null,
            errorPoints: effectiveErrorPoints,
            errorPenalty: effectiveErrorPoints * getDressagePenaltyCoeff(program)
        };
    }

    const result = computeFinalFromSaved(equipage, judgeProtocols, program);

    // --- PROJECTION / PROGNOSIS LOGIC ---
    let pointsNow = 0, maxPointsNow = 0;
    const totalMaxPoints = (program.movements || []).reduce((s, m) => s + 10 * (Number(m.coeff) || 1), 0);

    // Calculate sum of "Ridden" movements (where at least one judge has a score)
    const movs = program.movements || [];
    // Map each movement to its average score across all judges (or null if no score)
    const avgScores = movs.map(pm => {
        let scores = [];
        judgeProtocols.forEach(p => {
            const mv = (p.movements || []).find(m => Number(m.momentNo ?? m.movementNo ?? m.no) === Number(pm.no));
            if (mv && mv.score !== null && mv.score !== '' && Number.isFinite(Number(mv.score))) {
                scores.push(Number(mv.score));
            }
        });
        if (scores.length === 0) return null; // Not judged by anyone
        return scores.reduce((a, b) => a + b, 0) / scores.length;
    });

    // Simplified Prognosis Logic: Only count movements that have been judged.
    // This removes reliance on "lastActiveIndex" and ensures maxPointsNow tracks exactly with pointsNow.
    for (let i = 0; i < avgScores.length; i++) {
        const s = avgScores[i];
        if (s !== null) {
            const val = s;
            const c = Number(movs[i].coeff) || 1;
            pointsNow += val * c;
            maxPointsNow += 10 * c;
        }
    }

    // DEBUG: Log prognosis inputs
    if (pointsNow > 0 && maxPointsNow > totalMaxPoints * 0.1) {
    }

    const isLive = maxPointsNow > 0 && maxPointsNow < totalMaxPoints;
    const currentPrognosisPercent = maxPointsNow > 0 ? (pointsNow / maxPointsNow) * 100 : null;

    // Calculate Final Penalty including Error Points (felkörning)
    let finalPenalty = null;
    let coeff = getDressagePenaltyCoeff(program);
    const errorPoints = effectiveErrorPoints;
    const errorPenalty = errorPoints * coeff;

    if (result) {
        finalPenalty = round2(result.penalty + errorPenalty);
    }

    // Projected Final Result (Prognosis)
    let projPercent = currentPrognosisPercent;
    let projPoints = (projPercent != null) ? (projPercent / 100) * totalMaxPoints : null;
    let projPenalty = (projPoints != null) ? round2(((totalMaxPoints - projPoints) * coeff) + errorPenalty) : null;

    return {
        penalty: isEliminated ? null : finalPenalty, // Final penalty with errors
        judgePenalty: isEliminated ? null : (result ? round2(result.penalty) : null), // Penalty from judges only
        percent: isEliminated ? 0 : (result ? round2(result.percent) : null),
        points: isEliminated ? 0 : (result ? round2(result.points) : null),

        // Prognosis Fields
        projectedPercent: isEliminated ? 0 : (projPercent != null ? round2(projPercent) : null),
        projectedPoints: isEliminated ? 0 : (projPoints != null ? round2(projPoints) : null),
        projectedPenalty: isEliminated ? 0 : projPenalty,

        isLive: isLive,
        eliminated: isEliminated,
        programName: program.name,
        coeff: coeff,
        errorPoints: effectiveErrorPoints,
        errorPenalty: errorPenalty,
        judgeCount: cleanProtocols.length,
        pointsNow: pointsNow, // Added for Monitor
        // TR Tie-breaker
        generalImpressionsSum: result ? result.generalImpressionsSum : null
    };
}

/**
 * Helper to calculate details for a single judge's protocol.
 * Useful for modal detail views and live input feedback.
 */
export function calculateSingleJudgeDressageResult(protocol, program, equipage = {}) {
    if (!protocol || !program) return null;

    // Use a unique enforced key for the one-off calculation to ensure
    // calculateDressageResult finds exactly this program object.
    const uniqueKey = 'forced_program_override';

    // Patch protocol to point to this key, and equipage to fall back to it
    const patchedProtocol = { ...protocol, testKey: uniqueKey, programKey: uniqueKey };
    const patchedEquipage = { ...equipage, errorPoints: 0, testKey: uniqueKey };

    const results = calculateDressageResult(
        patchedEquipage,
        [patchedProtocol],
        [], // validJudges ignored for single judge calc usually
        { [uniqueKey]: program }
    );

    return results;
}

// --- MARATHON ---

/**
 * Calculates marathon result including time penalties, obstacle penalties, and elimination status.
 * @param {Object} equipage - The equipage object.
 * @param {Object} obstacleData - Map or Object containing obstacle timing/penalties.
 * @param {Object} timingData - Object containing stage times (A/T/B).
 * @returns {Object} Standardized marathon result object.
 */
export function calculateMarathonResult(equipage, obstacleData, timingData) {
    return _calcMarathon(equipage, obstacleData, timingData);
}

// --- PRECISION ---

/**
 * Calculates precision result.
 * @param {Object} data - The raw precision result data (from DB).
 * @param {Object} equipage - The equipage object.
 * @param {Object} config - Precision configuration (max time, widths, etc).
 * @returns {Object} Standardized precision result object.
 */
export function calculatePrecisionResult(data, equipage, config) {
    return _calcPrecision(data, equipage, config);
}

// --- TOTAL ---

/**
 * orchestrates result calculation for all disciplines and aggregates the total.
 * @param {Object} equipage - The equipage object.
 * @param {Array} dressageProtocols - Raw dressage protocols.
 * @param {Object} marathonData - { obstacleData: Object, timeData: Object }
 * @param {Object} precisionData - Raw precision data.
 * @param {Object} context - { allPrograms, judges, marathonConfig, precisionConfig }
 * @returns {Object} Comprehensive result including sub-results and total.
 */
export function calculateTotalResult(equipage, dressageProtocols, marathonData, precisionData, context = {}) {
    // 1. Calculate Dressage
    const dressRes = calculateDressageResult(
        equipage,
        dressageProtocols,
        context.judges,
        context.allPrograms
    );

    // 2. Calculate Marathon
    // Ensure we handle missing/empty data gracefully
    const marObstacles = marathonData?.obstacleData || {};
    const marTime = marathonData?.timeData || {};
    const marRes = calculateMarathonResult(equipage, marObstacles, marTime);

    // 3. Calculate Precision
    const precRes = calculatePrecisionResult(precisionData, equipage, context.precisionConfig);

    // 4. Aggregate Total
    const d = dressRes;
    const m = marRes;
    const p = precRes;

    const elimD = !!d.eliminated;
    const elimM = !!m.eliminated;
    const elimP = !!p.eliminated;

    const isEliminated = elimD || elimM || elimP;

    let elimReason = null;
    if (elimD) elimReason = 'ELIM (DR)';
    else if (elimM) elimReason = 'ELIM (MA)';
    else if (elimP) elimReason = 'ELIM (PR)';

    let total = null;

    // Sum if all valid (and not eliminated)
    // We check for null/undefined to ensure we don't sum partial data as "complete" 
    // unless that is the intended behavior. 
    // Here we strictly require all three to be present numbers to generate a "Final Total".
    if (!isEliminated && isNum(d.penalty) && isNum(m.totalPenalty) && isNum(p.totalPenalty)) {
        total = round2(d.penalty + m.totalPenalty + p.totalPenalty);
    }

    // Determine "active/ongoing" status for the whole row
    // If not eliminated and no total yet, but we have SOME data in any branch, it is ongoing.
    const hasAnyData = (d.points !== null) || (m.totalPenalty !== null) || (p.totalPenalty !== null) || (p.running);
    const isOngoing = (!isEliminated && total === null && hasAnyData);

    return {
        dressage: dressRes,
        marathon: marRes,
        precision: precRes,
        totalPenalty: total,
        isEliminated,
        elimReason,
        isOngoing
    };
}
