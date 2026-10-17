import { calculatePrecisionLiveResult } from '../../utils/precisionUtils.js';
import { calculateMarathonResult, getMarathonEngineConfig } from '../../utils/marathonUtils.js';
import { calculateDressageResult } from '../../services/calculationService.js';
import { computeTotalPenalty } from '../../utils/sharedUtils.js';
import { getSpeakerDisciplineResult } from './speakerResults.js';
import { matchesDisplayClass } from './speakerHelpers.js';
import { getSpeakerPenaltyOrNull, isFiniteSpeakerNumber } from './speakerFormatUtils.js';
import { isLiveInjectionEliminated, toFiniteNumberOrNull, toFiniteNumberOrZero } from './speakerCalculationUtils.js';
import { rankDressageRows } from '../dressage/dressageResultRanking.js';
import { archivedDisciplinePenalty } from './archivedResults.js';
import {
    assignPlaces,
    compareTotalRank,
    compareMarathonRank,
    comparePrecisionRank,
    totalRankKey,
    marathonRankKey,
    precisionRankKey,
    isClearRoundClass
} from '../../core-engine/ranking.js';

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
        // Live penalty at this moment, from the result engine
        const live = calculatePrecisionLiveResult(pSt, eq, precisionConfig);
        return {
            sn: eq.startNumber,
            discipline: 'precision',
            disciplinePenalty: toFiniteNumberOrZero(live.totalPenalty),
            timeMs: toFiniteNumberOrZero(live.elapsedMs ?? live.timeMs),
            eliminated: live.eliminated === true
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
        // While judging is in progress, use the engine's projection; the final
        // penalty would count unjudged movements as 0 points
        const penalty = (result?.isLive && result.projectedPenalty != null) ? result.projectedPenalty : result?.penalty;
        if (penalty != null) {
            return { sn: eq.startNumber, discipline: 'dressyr', disciplinePenalty: penalty, eliminated: result.eliminated === true };
        }
    }
    
    return null;
}

// Speaker standings use the (possibly partial) running total; placing rules
// come from core-engine/ranking.js
// Disciplines with a result: the live standings are "after N disciplines",
// so an equipage with only dressage done cannot lead those with two (missing
// disciplines would otherwise count as 0)
function phasesDone(row) {
    return [row.dressage?.penalty, row.marathon?.totalPenalty, row.precision?.pen]
        .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v))).length;
}

const compareStanding = (a, b) => (b.phases - a.phases) || compareTotalRank(a, b);

export function rankSpeakerResultRows(results = []) {
    results.forEach(row => { row.phasesDone = phasesDone(row); });
    results.sort((a, b) => {
        if (a.isEliminated !== b.isEliminated) return a.isEliminated ? 1 : -1;
        return compareStanding(
            { phases: a.phasesDone, penalty: a.totalPenalty, marathon: a.marathon?.totalPenalty, dressage: a.dressage?.penalty },
            { phases: b.phasesDone, penalty: b.totalPenalty, marathon: b.marathon?.totalPenalty, dressage: b.dressage?.penalty }
        ) || ((Number(a.startNumber) || 0) - (Number(b.startNumber) || 0));
    });

    assignPlaces(results, {
        key: (row) => {
            const key = totalRankKey({
                totalPenalty: row.totalPenalty,
                isEliminated: row.isEliminated,
                marathonPenalty: row.marathon?.totalPenalty,
                dressagePenalty: row.dressage?.penalty,
                isClearRound: row.isClearRound === true || row.marathon?.isClearRound === true
            });
            return key ? { ...key, phases: row.phasesDone } : null;
        },
        compare: compareStanding
    });

    const leader = results.find(row => !row.isEliminated && Number.isFinite(row.totalPenalty));
    results.forEach((row) => {
        if (row.isEliminated) row.plac = 'ELIM';
        row.diffFromLeader = (leader && row.plac !== 'ELIM' && Number.isFinite(row.totalPenalty))
            ? row.totalPenalty - leader.totalPenalty
            : null;
    });

    results.forEach(row => { row.posDress = null; });
    rankDressageRows(results, {
        // Clear round: no place in any phase (TR V 509.3)
        penaltyPicker: row => ((row.isClearRound === true || row.marathon?.isClearRound === true) ? null : row.dressage?.penalty),
        eliminatedPicker: row => !!row.dressage?.eliminated,
        groupPicker: () => 'speaker',
        outputField: 'posDress'
    });

    return results;
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

        // Archived competition: the values it was archived with, also for the placings
        const archiveSnapshot = context.archiveSnapshot;
        if (archiveSnapshot && archivedDisciplinePenalty(archiveSnapshot, sn, 'total').found) {
            dPen = archivedDisciplinePenalty(archiveSnapshot, sn, 'dressage').penalty;
            mPen = archivedDisciplinePenalty(archiveSnapshot, sn, 'marathon').penalty;
            pPen = archivedDisciplinePenalty(archiveSnapshot, sn, 'precision').penalty;
            totalEliminated = archivedDisciplinePenalty(archiveSnapshot, sn, 'total').isEliminated === true;
        }

        const totalPenalty = totalEliminated ? null : computeTotalPenalty(dPen, mPen, pPen);
        // Clear round is set for the whole class (marathon or dressage admin):
        // no place in the total or any phase (TR V 509.3)
        const isClearRound = mResult.result?.isClearRound === true
            || isClearRoundClass(e.className, {
                marathonConfig: context.marathonConfig || getMarathonEngineConfig().marathonConfig,
                dressyrClassConfig: context.dressyrClassConfig || getMarathonEngineConfig().dressyrClassConfig
            });

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
            isClearRound,
            dressage: { penalty: dPen, percentAvg: dPct, eliminated: elimD, isClearRound },
            marathon: { totalPenalty: mPen, eliminated: isElimM, bPenalty: mResult.result?.stages?.B?.timePenalty ?? 0, obstaclePenaltySum: mResult.result?.obstaclePenaltySum ?? 0, feiClass: mResult.result?.feiClass === true, isClearRound },
            precision: { pen: pPen, eliminated: isElimP, isClearRound }
        });
    });

    rankSpeakerResultRows(results);

    // Discipline positions (live: an unfinished marathon also gets a position)
    assignPlaces(results, {
        key: (r) => marathonRankKey({
            totalPenalty: r.marathon.totalPenalty,
            eliminated: r.marathon.eliminated,
            stages: { B: { timePenalty: r.marathon.bPenalty } },
            obstaclePenaltySum: r.marathon.obstaclePenaltySum,
            feiClass: r.marathon.feiClass,
            isClearRound: r.marathon.isClearRound
        }, { requireFinished: false }),
        compare: compareMarathonRank,
        outField: 'posMar'
    });
    assignPlaces(results, {
        key: (r) => precisionRankKey({
            totalPenalty: r.precision.pen,
            eliminated: r.precision.eliminated,
            timeMs: r.tieBreakerTime,
            isClearRound: r.precision.isClearRound
        }),
        compare: comparePrecisionRank,
        outField: 'posPrec'
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
