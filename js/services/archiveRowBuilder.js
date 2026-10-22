import { dressagePrograms } from '../data/dressagePrograms.js';
import {
    calculateTotalResult,
    calculateDressageResult,
    calculateMarathonResult,
    calculatePrecisionResult
} from './calculationService.js';
import {
    assignPlaces,
    compareDressageRank,
    compareMarathonRank,
    comparePrecisionRank,
    compareTotalRank,
    dressageRankKey,
    marathonRankKey,
    precisionGroupContext,
    totalRankKey
} from '../core-engine/ranking.js';
import { isWithdrawnEquipage } from '../utils/sharedUtils.js';
import { buildPrecisionMergeState, resolvePrecisionMergeGrouping } from '../pages/precision/precisionResultMerge.js';

function pickDefined(primaryObj, primaryKey, fallbackObj, fallbackKey) {
    if (primaryObj && Object.prototype.hasOwnProperty.call(primaryObj, primaryKey)) {
        return primaryObj[primaryKey];
    }
    return fallbackObj ? fallbackObj[fallbackKey] : undefined;
}

// Clear round is set for the whole class (TR V 509.3): no place in the total
// or any phase (the phase rank keys read isClearRound on each phase)
const isClearRoundRow = (row) => row.isClearRound === true
    || row.dressage?.isClearRound === true
    || row.marathon?.isClearRound === true
    || row.precision?.isClearRound === true;

// A withdrawn (struken) or clear round row gets no place at all
const isUnplacedRow = (row) => row.isWithdrawn === true || isClearRoundRow(row);

const archiveTotalKey = (row) => (row.isWithdrawn === true ? null : totalRankKey({
    totalPenalty: row.totalPenalty,
    isEliminated: row.isEliminated,
    marathonPenalty: row.marathon?.totalPenalty,
    dressagePenalty: row.dressage?.penalty,
    isClearRound: isClearRoundRow(row)
}));

// The class group a row is placed in: its merged class (as the live result
// pages, from the merge config and useMergedTestForDisplay) or its own class
const archiveGroupOf = (row) => row._mergedKey || `CLASS:${row.className || '-'}`;

// Placings per merged class (TR 533.3 / FEI 904, see core-engine/ranking.js)
function buildPlacements(rows) {
    assignPlaces(rows, {
        key: archiveTotalKey,
        compare: compareTotalRank,
        group: archiveGroupOf
    });
    assignPlaces(rows, {
        key: (row) => (isUnplacedRow(row) ? null : dressageRankKey(row.dressage)),
        compare: compareDressageRank,
        group: archiveGroupOf,
        outField: 'posDress'
    });
    assignPlaces(rows, {
        key: (row) => (isUnplacedRow(row) ? null : marathonRankKey(row.marathon)),
        compare: compareMarathonRank,
        group: archiveGroupOf,
        outField: 'posMar'
    });
    // Two phases / drive-off: tiers and the drive-off qualifiers per group
    const precisionCtx = precisionGroupContext(rows, (row) => row.precision, archiveGroupOf, { requireFinished: true });
    assignPlaces(rows, {
        key: (row) => (isUnplacedRow(row) ? null : precisionCtx.rankKey(row)),
        compare: comparePrecisionRank,
        group: archiveGroupOf,
        outField: 'posPrec'
    });
    rows.forEach(row => {
        if (row.plac == null) row.plac = '';
    });
}

function sortRowsForPdf(rows) {
    rows.sort((a, b) => {
        const byClass = String(a._mergedLabel || a.className || '').localeCompare(String(b._mergedLabel || b.className || ''));
        if (byClass !== 0) return byClass;

        // Withdrawn last, after the eliminated
        if (a.isWithdrawn !== b.isWithdrawn) return a.isWithdrawn ? 1 : -1;
        if (a.isEliminated && !b.isEliminated) return 1;
        if (!a.isEliminated && b.isEliminated) return -1;

        const keyA = archiveTotalKey(a);
        const keyB = archiveTotalKey(b);
        if (keyA && keyB) return compareTotalRank(keyA, keyB) || ((Number(a.startNumber) || 0) - (Number(b.startNumber) || 0));
        if (keyA) return -1;
        if (keyB) return 1;
        return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
    });
}

// The rounds of an archived precision row, only what placing and display need
function archiveRound(r) {
    if (!r) return null;
    return {
        totalPenalty: r.totalPenalty ?? null,
        timeMs: r.timeMs ?? null,
        penaltySec: r.penaltySec ?? null,
        scoring: r.scoring || 'fault',
        eliminated: r.eliminated === true,
        retired: r.retired === true,
        status: r.status || null,
        hasData: r.hasData === true,
        finished: r.finished === true,
        out: r.out === true,
        decided: r.decided === true
    };
}

function archivePrecisionRounds(rounds) {
    if (!rounds) return null;
    return { phase2: archiveRound(rounds.phase2), driveOff: archiveRound(rounds.driveOff) };
}

export function buildArchiveRowsFromData({
    equipages = [],
    dressageProtocols = new Map(),
    marathonTimingMap = new Map(),
    marathonStateMap = new Map(),
    marathonObstacleRows = [],
    precisionRows = [],
    marathonConfig = {},
    precisionConfig = {},
    allPrograms = dressagePrograms,
    judges = [],
    dressageJudgeMapping = {},
    dressyrClassConfig = null,
    mergeSource = null
} = {}) {
    // mergeSource: pickMergeSource of the competition (mergeConfigService)
    const mergeMap = buildPrecisionMergeState(mergeSource).map;
    const normalizedMarathonConfig = marathonConfig?.value || marathonConfig || {};
    const normalizedPrecisionConfig = precisionConfig?.value || precisionConfig || {};
    const normalizedPrograms = allPrograms?.value || allPrograms || dressagePrograms;
    // The class's rule profile (TR/FEI) decides how precision rounds are
    // scored: the archive's marathon config, not only the class name
    const hasMarathonClassData = !!(normalizedMarathonConfig.marathonClassData || normalizedMarathonConfig.maratonClassData);
    const precisionOptions = hasMarathonClassData
        ? { marathonConfig: normalizedMarathonConfig, dressyrClassConfig: dressyrClassConfig?.value || dressyrClassConfig || null }
        : {};

    const precisionMap = new Map(
        (precisionRows || []).map(row => [String(row.startNumber || row.id), row])
    );

    const obstacleMap = new Map();
    (marathonObstacleRows || []).forEach(row => {
        const sn = String(row.equipageId);
        if (!obstacleMap.has(sn)) obstacleMap.set(sn, []);
        obstacleMap.get(sn).push(row);
    });

    const rows = (equipages || []).map(eq => {
        const sn = String(eq.startNumber);
        const protocols = dressageProtocols.get(sn) || [];
        const stateDoc = marathonStateMap.get(sn) || {};
        const subObstacles = obstacleMap.get(sn) || [];
        const resolvedObstacles = subObstacles.length > 0
            ? subObstacles
            : (Array.isArray(stateDoc.obstacles) ? stateDoc.obstacles : []);
        const marathonDoc = {
            ...stateDoc,
            obstacles: resolvedObstacles,
            eliminated: !!stateDoc.eliminated || resolvedObstacles.some(o => o.eliminated)
        };
        const timingDoc = {
            ...(marathonTimingMap.get(sn) || {}),
            ...stateDoc
        };
        const precisionDoc = precisionMap.get(sn) || null;

        const dressage = calculateDressageResult(eq, protocols, judges, normalizedPrograms);
        const marathon = calculateMarathonResult(eq, marathonDoc, timingDoc, normalizedMarathonConfig);
        const precision = calculatePrecisionResult(precisionDoc, eq, normalizedPrecisionConfig, precisionOptions);
        const total = calculateTotalResult(
            eq,
            protocols,
            { obstacleData: marathonDoc, timeData: timingDoc },
            precisionDoc,
            {
                judges,
                dressageJudgeMapping: dressageJudgeMapping?.value || dressageJudgeMapping || {},
                allPrograms: normalizedPrograms,
                marathonConfig: normalizedMarathonConfig,
                precisionConfig: normalizedPrecisionConfig,
                dressyrClassConfig: dressyrClassConfig?.value || dressyrClassConfig || null
            }
        );
        const isClearRound = total.isClearRound === true || marathon.isClearRound === true;
        // The total's marathon was calculated with every clear round setting
        // (dressyrClassConfig too): obstacle time free in clear round (TR V 526.1)
        const marathonRes = total.marathon || marathon;

        const marKey = marathonRankKey(marathonRes, { requireFinished: false });
        const group = resolvePrecisionMergeGrouping(eq, mergeMap);
        const withdrawn = isWithdrawnEquipage(eq);

        return {
            ...eq,
            _mergedKey: group.key,
            _mergedLabel: group.label,
            // Withdrawn (struken): no place in the total or any phase
            isWithdrawn: withdrawn,
            dressage: {
                penalty: pickDefined(total.dressage, 'penalty', total, 'dressagePenalty'),
                judgePenalty: dressage.judgePenalty,
                percent: dressage.percent,
                eliminated: !!dressage.eliminated,
                isClearRound,
                clearRoundApproved: isClearRound && total.dressage?.dressageClearRoundApproved === true,
                status: dressage.eliminated
                    ? 'Eliminerad'
                    : (total.dressageComplete ? 'Klar' : (withdrawn ? 'Struken' : 'Ej startad'))
            },
            marathon: {
                totalPenalty: pickDefined(total.marathon, 'totalPenalty', total, 'marathonPenalty'),
                bPenalty: marKey ? marKey.bPenalty : null,
                stages: marathonRes.stages,
                obstaclePenaltySum: marathonRes.obstaclePenaltySum,
                eliminated: !!marathonRes.eliminated,
                status: marathonRes.status,
                // FEI 968.1.4: no B tie-break; TR V 509.3: clear round, no place
                feiClass: marathonRes.feiClass === true,
                isClearRound,
                clearRoundApproved: marathonRes.clearRoundApproved === true
            },
            precision: {
                pen: pickDefined(total.precision, 'totalPenalty', total, 'precisionPenalty'),
                totalPenalty: pickDefined(total.precision, 'totalPenalty', total, 'precisionPenalty'),
                timeMs: precision.timeMs,
                finalized: !!precision.finalized,
                running: !!precision.running,
                eliminated: !!precision.eliminated,
                isClearRound,
                status: precision.status,
                // pen/totalPenalty/timeMs stay phase 1 (the total, TR 533.2 /
                // FEI 971); the placing of two phases / drive-off from these
                format: precision.precisionFormat || 'normal',
                formatUnsupported: precision.formatUnsupported === true,
                placing: precision.placing || null,
                driveOffScheduled: precision.driveOffScheduled === true,
                phase2Qualified: precision.phase2Qualified === true,
                phase2Ignored: precision.phase2Ignored === true,
                rounds: archivePrecisionRounds(precision.rounds)
            },
            totalPenalty: total.totalPenalty,
            isEliminated: total.isEliminated,
            isClearRound,
            // The whole clear round (TR V 509.3: dressage at most 80 p,
            // marathon and precision 0 p), not only the marathon's part; null
            // while a phase the class drives is not finished (undecided)
            clearRoundApproved: isClearRound
                ? (total.clearRoundApproved === null ? null : total.clearRoundApproved === true)
                : false,
            plac: '',
            posDress: null,
            posMar: null,
            posPrec: null
        };
    });

    buildPlacements(rows);
    sortRowsForPdf(rows);

    return rows;
}
