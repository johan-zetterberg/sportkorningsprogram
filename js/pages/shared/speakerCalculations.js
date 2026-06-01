import { computeMaxSecondsForClass, calculatePrecisionTimePenalty } from '../../utils/precisionUtils.js';
import { calculateMarathonResult } from '../../utils/marathonUtils.js';
import { calculateDressageResult } from '../../services/calculationService.js';
import { computeTotalPenalty } from '../../utils/sharedUtils.js';
import { getSpeakerDisciplineResult } from './speakerResults.js';
import { matchesDisplayClass } from './speakerHelpers.js';
import { getSpeakerPenaltyOrNull, isFiniteSpeakerNumber } from './speakerFormatUtils.js';
import { isLiveInjectionEliminated, toFiniteNumberOrNull, toFiniteNumberOrZero } from './speakerCalculationUtils.js';

export function getLeaderToBeat(className, discipline, context) {
    const { allEquipages, precisionStatusMap, precisionConfig, startTimes } = context;
    if (!className) return null;
    let best = null;

    const isBetter = (currentBest, candidateScore, disc) => {
        if (currentBest === null) return true;
        if (disc === 'dressyr') return candidateScore > currentBest;
        // Lägre straff = bättre i maraton/precision
        return candidateScore < currentBest;
    };

    allEquipages.forEach(eq => {
        if (!matchesDisplayClass(eq, className)) return;
        const sn = String(eq.startNumber);

        let score = null;
        if (discipline === 'dressyr') {
            const result = getSpeakerDisciplineResult(eq, 'dressyr', context);
            if (!result.eliminated && isFiniteSpeakerNumber(result.percent)) score = result.percent;
        } else if (discipline === 'maraton') {
            const result = getSpeakerDisciplineResult(eq, 'maraton', context);
            if (!result.eliminated) score = getSpeakerPenaltyOrNull(result.penalty);
        } else if (discipline === 'precision') {
            const result = getSpeakerDisciplineResult(eq, 'precision', context);
            if (!result.eliminated) score = getSpeakerPenaltyOrNull(result.penalty);
        }

        if (score !== null) {
            if (isBetter(best ? best.score : null, score, discipline)) {
                let time = '';
                if (discipline === 'precision') {
                    const st = precisionStatusMap.get(sn);
                    // Use msToLabel internally or let UI format it?
                    // For now, we'll return timeMs and format in UI, or just format here if we import msToLabel.
                    // Actually, precision result already has timeMs.
                    time = st?.time || (score != null ? formatTimeMs(st?.timeMs || 0) : '');
                }
                best = { score, name: eq.driverName, sn: eq.startNumber, time };
            }
        }
    });
    return best;
}

export function getDressageLeaderInClass(className, context) {
    const { dressageStatusMap, allEquipages } = context;
    let bestPen = Infinity;
    let bestName = null;
    let bestPercent = null;

    dressageStatusMap.forEach((st, sn) => {
        const eq = allEquipages.find(e => String(e.startNumber) === sn);
        if (!eq || !matchesDisplayClass(eq, className)) return;

        const finalPenalty = toFiniteNumberOrNull(st.finalPenalty);
        if (finalPenalty !== null) {
            if (finalPenalty < bestPen) {
                bestPen = finalPenalty;
                bestName = eq.driverName;
                bestPercent = toFiniteNumberOrNull(st.finalPercent);
            }
        }
    });

    if (bestPen === Infinity) return null;
    return { name: bestName, penalty: bestPen, percent: bestPercent };
}

/**
 * Calculates live penalty/time for an equipage during their run.
 * Used for live-injections in class rankings and real-time boxes.
 */
export function calculateLiveInjection(eq, context) {
    if (!eq) return null;
    const {
        precisionStatusMap,
        precisionConfig,
        activeEquipages,
        liveProtocolMap,
        allJudges,
        mergedPrograms
    } = context;

    const sn = String(eq.startNumber);
    const pSt = precisionStatusMap.get(sn);
    
    // 1. Precision Live
    if (pSt && (pSt.running || pSt.inProgress)) {
        let pen = toFiniteNumberOrZero(pSt.totalPenalty);
        let timeMs = toFiniteNumberOrZero(pSt.liveTimeMs ?? pSt.timeMs);
        if (pSt.running && pSt.liveStartEpoch) {
            const maxSec = computeMaxSecondsForClass(eq.className, precisionConfig);
            const nowMs = toFiniteNumberOrZero(pSt.livePausedMs) + (Date.now() - Number(pSt.liveStartEpoch));
            const lp = calculatePrecisionTimePenalty(nowMs, maxSec);
            const op = toFiniteNumberOrZero(pSt.liveObstaclePenalty ?? pSt.obstaclePenalty);
            const ep = toFiniteNumberOrZero(pSt.extraPenalty);
            pen = op + lp + ep;
            timeMs = nowMs;
        }
        return { 
            sn: eq.startNumber, 
            discipline: 'precision', 
            disciplinePenalty: pen,
            timeMs: timeMs,
            eliminated: pSt.eliminated === true || pen === Infinity
        };
    }
    
    // 2. Marathon Live
    const active = activeEquipages.get(sn);
    if (active) {
        const d = active.data || {};
        const res = calculateMarathonResult(eq, d, d);
        return { 
            sn: eq.startNumber, 
            discipline: 'maraton', 
            disciplinePenalty: res.totalPenalty,
            eliminated: res.eliminated || res.totalPenalty === Infinity
        };
    }
    
    // 3. Dressage Live
    const liveMap = liveProtocolMap.get(sn) || new Map();
    if (liveMap.size > 0) {
        const liveProtocols = Array.from(liveMap.values());
        const result = calculateDressageResult(eq, liveProtocols, allJudges, mergedPrograms);
        if (result && result.penalty != null) {
            return { sn: eq.startNumber, discipline: 'dressyr', disciplinePenalty: result.penalty, eliminated: result.eliminated === true };
        }
    }
    
    return null;
}

export function getTotalRanking(className, currentRiderInfo, context) {
    const { allEquipages } = context;
    if (!className) return [];

    const results = [];
    const targetClass = className;

    allEquipages.forEach(e => {
        if (!matchesDisplayClass(e, targetClass)) return;

        const sn = String(e.startNumber);

        const dResult = getSpeakerDisciplineResult(e, 'dressyr', context);
        const mResult = getSpeakerDisciplineResult(e, 'maraton', context);
        const pResult = getSpeakerDisciplineResult(e, 'precision', context);

        let dPen = getSpeakerPenaltyOrNull(dResult.penalty);
        let dPct = toFiniteNumberOrNull(dResult.percent);
        const elimD = dResult.eliminated;

        let mPen = getSpeakerPenaltyOrNull(mResult.penalty);
        const isElimM = mResult.eliminated;

        let pPen = getSpeakerPenaltyOrNull(pResult.penalty);
        let pTimeMs = toFiniteNumberOrZero(pResult.timeMs);
        const isElimP = pResult.eliminated;

        let totalEliminated = elimD || isElimM || isElimP;

        // Apply Injections (for live rider)
        if (currentRiderInfo && String(currentRiderInfo.sn) === sn) {
            if (currentRiderInfo.discipline === 'precision') {
                pPen = getSpeakerPenaltyOrNull(currentRiderInfo.disciplinePenalty);
                pTimeMs = toFiniteNumberOrZero(currentRiderInfo.timeMs) || pTimeMs;
            } else if (currentRiderInfo.discipline === 'maraton') {
                mPen = getSpeakerPenaltyOrNull(currentRiderInfo.disciplinePenalty);
            } else if (currentRiderInfo.discipline === 'dressyr') {
                dPen = getSpeakerPenaltyOrNull(currentRiderInfo.disciplinePenalty);
            }
            totalEliminated = totalEliminated || isLiveInjectionEliminated(currentRiderInfo);
        }

        const totalPenalty = totalEliminated ? null : computeTotalPenalty(dPen, mPen, pPen);

        results.push({
            startNumber: e.startNumber,
            driverName: e.driverName,
            clubName: e.clubName,
            className: e.className,
            // Compatibility for older sidebar calls
            sn: e.startNumber,
            name: e.driverName,
            total: totalEliminated ? Infinity : totalPenalty,
            totalPenalty: totalPenalty,
            tieBreakerTime: pTimeMs,
            isEliminated: totalEliminated,
            dressage: { penalty: dPen, percentAvg: dPct, eliminated: elimD },
            marathon: { totalPenalty: mPen, eliminated: isElimM },
            precision: { pen: pPen, eliminated: isElimP }
        });
    });

    // 1. Overall Ranking (for plac and total)
    results.sort((a, b) => {
        if (a.isEliminated !== b.isEliminated) return a.isEliminated ? 1 : -1;
        
        const aTot = (a.total === null || a.total === undefined) ? Infinity : a.total;
        const bTot = (b.total === null || b.total === undefined) ? Infinity : b.total;

        // Main sort: total penalty
        if (Math.abs(aTot - bTot) > 0.001) return aTot - bTot;

        // Tie-breaker 1: Marathon (lowest score better)
        const ma = a.marathon?.totalPenalty ?? Infinity;
        const mb = b.marathon?.totalPenalty ?? Infinity;
        if (ma !== mb) return ma - mb;

        // Tie-breaker 2: Dressage (lowest score better)
        const da = a.dressage?.penalty ?? Infinity;
        const db = b.dressage?.penalty ?? Infinity;
        if (da !== db) return da - db;

        // Tie-breaker 3: Precision (lowest score better)
        const pa = a.precision?.pen ?? Infinity;
        const pb = b.precision?.pen ?? Infinity;
        if (pa !== pb) return pa - pb;

        // Fallback: Start number
        return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
    });

    const leadTotal = (results.length > 0 && results[0].total !== Infinity) ? results[0].total : 0;
    results.forEach((r, idx) => {
        if (r.isEliminated) {
            r.plac = 'ELIM';
            r.diffFromLeader = null;
        } else if (r.total !== Infinity) {
            r.plac = idx + 1;
            r.diffFromLeader = r.total - leadTotal;
        } else {
            r.plac = null;
            r.diffFromLeader = null;
        }
    });

    // Dressyr Rank
    const dressageSorted = [...results].sort((a, b) => {
        if (a.dressage.eliminated !== b.dressage.eliminated) return a.dressage.eliminated ? 1 : -1;
        return (a.dressage.penalty ?? Infinity) - (b.dressage.penalty ?? Infinity);
    });
    results.forEach(r => {
        if (r.dressage.penalty !== null && !r.dressage.eliminated) {
            r.posDress = dressageSorted.findIndex(x => x.startNumber === r.startNumber) + 1;
        } else r.posDress = null;
    });

    // Maraton Rank
    const marathonSorted = [...results].sort((a, b) => {
        if (a.marathon.eliminated !== b.marathon.eliminated) return a.marathon.eliminated ? 1 : -1;
        return (a.marathon.totalPenalty ?? Infinity) - (b.marathon.totalPenalty ?? Infinity);
    });
    results.forEach(r => {
        if (r.marathon.totalPenalty !== null && !r.marathon.eliminated) {
            r.posMar = marathonSorted.findIndex(x => x.startNumber === r.startNumber) + 1;
        } else r.posMar = null;
    });

    // Precision Rank
    const precisionSorted = [...results].sort((a, b) => {
        if (a.precision.eliminated !== b.precision.eliminated) return a.precision.eliminated ? 1 : -1;
        if (a.precision.pen === b.precision.pen) return (a.tieBreakerTime || 0) - (b.tieBreakerTime || 0);
        return (a.precision.pen ?? Infinity) - (b.precision.pen ?? Infinity);
    });
    results.forEach(r => {
        if (r.precision.pen !== null && !r.precision.eliminated) {
            r.posPrec = precisionSorted.findIndex(x => x.startNumber === r.startNumber) + 1;
        } else r.posPrec = null;
    });

    return results;
}

function formatTimeMs(ms) {
    if (!ms || isNaN(ms)) return '0.00';
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2);
    if (m > 0) return `${m}:${sec.padStart(5, '0')}`;
    return sec;
}
