import { stageStopTS, calculateMarathonResult } from '../../utils/marathonUtils.js';
import { getCalculatedRowData } from '../../utils/precisionUtils.js';
import { hasMarathonStarted, isWithdrawnOrExcluded, normState } from './speakerHelpers.js';

export function getDressageFinalPenalty(dressageStatusMap, sn) {
    const S = String(sn || '');
    if (!S) return null;
    const st = dressageStatusMap.get(S) || {};

    const candidates = [
        st.finalPenalty,
        st.penalty,
        st.totalPenalty,
        st.total,
        st.resultPenalty
    ];

    for (const v of candidates) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

export function getDressageFinalPercent(dressageStatusMap, sn) {
    const S = String(sn || '');
    if (!S) return null;
    const st = dressageStatusMap.get(S) || {};

    const candidates = [
        st.finalPercent,
        st.percent,
        st.totalPercent
    ];

    for (const v of candidates) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

export function normDressageState(dressageStatusMap, st = {}, eq = {}) {
    const s = normState(st.state || st.status || eq.status || eq.dressageStatus || eq.eqStatus);

    if (['finished', 'done', 'complete', 'completed', 'slut', 'klar'].includes(s)) return 'finished';
    if (['active', 'in-progress', 'inprogress', 'started', 'pågår', 'paga'].includes(s)) return 'active';
    if (['not-started', 'notstarted', 'ready', 'upcoming', 'väntar', 'vantar'].includes(s)) return 'not-started';

    const pen = getDressageFinalPenalty(dressageStatusMap, String(eq.startNumber ?? st.startNumber ?? st.id ?? ''));
    if (pen != null) return 'finished';

    return s || 'not-started';
}

export function getSpeakerDisciplineState(eq, discipline, context) {
    const {
        activeEquipages,
        allEquipages,
        dressageStatusMap,
        maratonStatusMap,
        precisionConfig,
        precisionStatusMap,
        startTimes
    } = context;

    const sn = String(eq?.startNumber ?? '');
    if (!sn) return { started: false, active: false, finished: false, eliminated: false };

    if (discipline === 'dressyr') {
        const st = dressageStatusMap.get(sn) || {};
        const normalized = normDressageState(dressageStatusMap, st, eq);
        const eliminated = isWithdrawnOrExcluded(normalized, { ...eq, ...st }) || !!st.eliminated || !!st.excluded;
        return {
            started: normalized !== 'not-started',
            active: normalized === 'active' || normalized === 'ongoing',
            finished: normalized === 'finished',
            eliminated
        };
    }

    if (discipline === 'maraton') {
        const st = maratonStatusMap.get(sn) || {};
        const active = activeEquipages.has(sn) || !!st.running || !!st.inProgress || !!st.currentObstacle;
        const result = st ? calculateMarathonResult(eq, st, st) : null;
        const eliminated = !!result?.eliminated || isWithdrawnOrExcluded(st.status, { ...eq, ...st });
        return {
            started: hasMarathonStarted(st),
            active,
            finished: !!stageStopTS(st, 'B') || !!st.finalized || st.status === 'finalized',
            eliminated
        };
    }

    if (discipline === 'precision') {
        const st = precisionStatusMap.get(sn);
        const calc = st ? getCalculatedRowData(sn, new Map(), allEquipages, precisionStatusMap, precisionConfig, startTimes) : null;
        const eliminated = !!calc?.eliminated || !!st?.eliminated || isWithdrawnOrExcluded(st?.status, { ...eq, ...(st || {}) });
        return {
            started: !!(st && (st.inProgress || st.running || st.finalized || st.totalPenalty != null || st.timeMs || st.liveStartEpoch)),
            active: !!(st && (st.inProgress || st.running)),
            finished: !!(st && (st.finalized || st.status === 'Klar' || (st.totalPenalty != null && !st.inProgress && !st.running))),
            eliminated
        };
    }

    return { started: false, active: false, finished: false, eliminated: isWithdrawnOrExcluded(eq?.status, eq) };
}

export function getSpeakerDisciplineResult(eq, discipline, context) {
    const {
        allEquipages,
        dressageStatusMap,
        maratonStatusMap,
        precisionConfig,
        precisionStatusMap,
        startTimes
    } = context;

    const sn = String(eq?.startNumber ?? '');
    if (!sn) return { penalty: null, percent: null, timeMs: 0, eliminated: false };

    if (discipline === 'dressyr') {
        return {
            penalty: getDressageFinalPenalty(dressageStatusMap, sn),
            percent: getDressageFinalPercent(dressageStatusMap, sn),
            timeMs: 0,
            eliminated: getSpeakerDisciplineState(eq, 'dressyr', context).eliminated
        };
    }

    if (discipline === 'maraton') {
        const st = maratonStatusMap.get(sn);
        if (!st) return { penalty: null, percent: null, timeMs: 0, eliminated: false };
        const res = calculateMarathonResult(eq, st, st);
        return {
            penalty: res.totalPenalty,
            percent: null,
            timeMs: 0,
            eliminated: res.eliminated || getSpeakerDisciplineState(eq, 'maraton', context).eliminated,
            result: res
        };
    }

    if (discipline === 'precision') {
        const st = precisionStatusMap.get(sn);
        if (!st) return { penalty: null, percent: null, timeMs: 0, eliminated: false };
        const calc = getCalculatedRowData(sn, new Map(), allEquipages, precisionStatusMap, precisionConfig, startTimes);
        return {
            penalty: calc.totalPenalty,
            percent: null,
            timeMs: calc.timeMs || 0,
            eliminated: !!calc.eliminated,
            result: calc
        };
    }

    return { penalty: null, percent: null, timeMs: 0, eliminated: false };
}
