import { dressagePrograms } from '../data/dressagePrograms.js';
import {
    calculateTotalResult,
    calculateDressageResult,
    calculateMarathonResult,
    calculatePrecisionResult
} from './calculationService.js';

function pickDefined(primaryObj, primaryKey, fallbackObj, fallbackKey) {
    if (primaryObj && Object.prototype.hasOwnProperty.call(primaryObj, primaryKey)) {
        return primaryObj[primaryKey];
    }
    return fallbackObj ? fallbackObj[fallbackKey] : undefined;
}

function buildPlacements(rows) {
    const grouped = new Map();
    rows.forEach(row => {
        const key = row.className || '';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
    });

    grouped.forEach(list => {
        const ranked = list
            .filter(row => !row.isEliminated && row.totalPenalty != null && Number.isFinite(row.totalPenalty))
            .sort((a, b) => a.totalPenalty - b.totalPenalty);

        ranked.forEach((row, index) => {
            row.plac = index + 1;
        });

        list.forEach(row => {
            if (row.plac == null) row.plac = '';
        });
    });
}

function sortRowsForPdf(rows) {
    rows.sort((a, b) => {
        const byClass = String(a.className || '').localeCompare(String(b.className || ''));
        if (byClass !== 0) return byClass;

        if (a.isEliminated && !b.isEliminated) return 1;
        if (!a.isEliminated && b.isEliminated) return -1;

        if (a.totalPenalty == null && b.totalPenalty == null) return 0;
        if (a.totalPenalty == null) return 1;
        if (b.totalPenalty == null) return -1;

        return a.totalPenalty - b.totalPenalty;
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
        const marathon = calculateMarathonResult(eq, marathonDoc, timingDoc);
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
