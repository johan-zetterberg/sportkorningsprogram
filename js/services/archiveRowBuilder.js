import { dressagePrograms } from '../data/dressagePrograms.js';
import {
    calculateTotalResult,
    calculateDressageResult,
    calculateMarathonResult,
    calculatePrecisionResult
} from './calculationService.js';
import { assignPlaces, compareTotalRank, totalRankKey } from '../core-engine/ranking.js';

function pickDefined(primaryObj, primaryKey, fallbackObj, fallbackKey) {
    if (primaryObj && Object.prototype.hasOwnProperty.call(primaryObj, primaryKey)) {
        return primaryObj[primaryKey];
    }
    return fallbackObj ? fallbackObj[fallbackKey] : undefined;
}

const archiveTotalKey = (row) => totalRankKey({
    totalPenalty: row.totalPenalty,
    isEliminated: row.isEliminated,
    marathonPenalty: row.marathon?.totalPenalty,
    dressagePenalty: row.dressage?.penalty
});

// Placings per class (TR 533.3 / FEI 904, see core-engine/ranking.js)
function buildPlacements(rows) {
    assignPlaces(rows, {
        key: archiveTotalKey,
        compare: compareTotalRank,
        group: (row) => row.className || ''
    });
    rows.forEach(row => {
        if (row.plac == null) row.plac = '';
    });
}

function sortRowsForPdf(rows) {
    rows.sort((a, b) => {
        const byClass = String(a.className || '').localeCompare(String(b.className || ''));
        if (byClass !== 0) return byClass;

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
    judges = []
} = {}) {
    const normalizedMarathonConfig = marathonConfig?.value || marathonConfig || {};
    const normalizedPrecisionConfig = precisionConfig?.value || precisionConfig || {};
    const normalizedPrograms = allPrograms?.value || allPrograms || dressagePrograms;

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
        const marathonDoc = {
            ...stateDoc,
            obstacles: obstacleMap.get(sn) || [],
            eliminated: !!stateDoc.eliminated || (obstacleMap.get(sn) || []).some(o => o.eliminated)
        };
        const timingDoc = {
            ...(marathonTimingMap.get(sn) || {}),
            ...stateDoc
        };
        const precisionDoc = precisionMap.get(sn) || null;

        const dressage = calculateDressageResult(eq, protocols, judges, normalizedPrograms);
        const marathon = calculateMarathonResult(eq, marathonDoc, timingDoc, normalizedMarathonConfig);
        const precision = calculatePrecisionResult(precisionDoc, eq, normalizedPrecisionConfig);
        const total = calculateTotalResult(
            eq,
            protocols,
            { obstacleData: marathonDoc, timeData: timingDoc },
            precisionDoc,
            {
                judges,
                allPrograms: normalizedPrograms,
                marathonConfig: normalizedMarathonConfig,
                precisionConfig: normalizedPrecisionConfig
            }
        );

        return {
            ...eq,
            dressage: {
                penalty: pickDefined(total.dressage, 'penalty', total, 'dressagePenalty'),
                judgePenalty: dressage.judgePenalty,
                eliminated: !!dressage.eliminated
            },
            marathon: {
                totalPenalty: pickDefined(total.marathon, 'totalPenalty', total, 'marathonPenalty'),
                eliminated: !!marathon.eliminated,
                status: marathon.status
            },
            precision: {
                pen: pickDefined(total.precision, 'totalPenalty', total, 'precisionPenalty'),
                totalPenalty: pickDefined(total.precision, 'totalPenalty', total, 'precisionPenalty'),
                eliminated: !!precision.eliminated,
                status: precision.status
            },
            totalPenalty: total.totalPenalty,
            isEliminated: total.isEliminated,
            plac: ''
        };
    });

    buildPlacements(rows);
    sortRowsForPdf(rows);

    return rows;
}
