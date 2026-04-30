// js/core-engine/precision.js
import { PRECISION_TIME_PENALTY_RATE, PRECISION_KNOCKDOWN_PENALTY, round2, isNum } from './rules-ledger.js';

const _norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');

export function computeMaxSecondsForClass(cls, config) {
    const direct = config?.maxTimeByClass?.[cls] || config?.maxTimeByClass?.[_norm(cls)];
    if (direct) {
        const n = Number(direct);
        if (Number.isFinite(n) && n > 0) return n;
    }
    const course = config?.courses?.[cls];
    if (course) {
        const len = Number(course.trackLength || course.length);
        const tempo = Number(course.tempo || course.tempoMpm);
        if (len > 0 && tempo > 0) return Math.round((len / tempo) * 60);
    }
    return null;
}

export function calculatePrecisionTimePenalty(timeMs, maxTimeSec, rate = PRECISION_TIME_PENALTY_RATE) {
    if (!Number.isFinite(timeMs) || !Number.isFinite(maxTimeSec) || maxTimeSec <= 0) return 0;
    const maxMs = maxTimeSec * 1000;
    if (timeMs <= maxMs) return 0;
    const diffMs = timeMs - maxMs;
    const secondsOver = diffMs / 1000;
    return round2(secondsOver * rate);
}

export function calculatePrecisionResult(state) {
    const { equipage, precision, config } = state;
    const d = precision.resultDoc || {};
    const precConfig = config.precisionConfig || {};

    const finalized = d.finalized === true;
    const eliminated = !!d.eliminated;
    const timeMs = finalized ? d.timeMs : (d.liveTimeMs || null);

    const knocksCount = (Array.isArray(d.knocks) ? d.knocks.length : 0);
    const kp = precConfig.knockdownPenalty != null ? Number(precConfig.knockdownPenalty) : PRECISION_KNOCKDOWN_PENALTY;

    const obstaclePenalty = isNum(d.obstaclePenalty) ? d.obstaclePenalty
        : (knocksCount > 0 ? knocksCount * kp : (d.liveObstaclePenalty || 0));

    const maxSec = computeMaxSecondsForClass(equipage?.className, precConfig);
    const rate = Number.isFinite(precConfig.timePenaltyRate) ? Number(precConfig.timePenaltyRate) : PRECISION_TIME_PENALTY_RATE;
    const calcTimePen = calculatePrecisionTimePenalty(timeMs, maxSec, rate);

    const timePenalty = isNum(d.timePenalty) ? d.timePenalty
        : (d.liveTimePenalty != null ? d.liveTimePenalty : calcTimePen);

    const extra = d.extraPenalty || 0;

    let total = null;
    if (eliminated) total = Infinity;
    else if (finalized || timeMs > 0 || knocksCount > 0) {
        total = (obstaclePenalty || 0) + (timePenalty || 0) + (extra || 0);
    }

    return {
        totalPenalty: isNum(total) ? round2(total) : null,
        eliminated,
        obstaclePenalty,
        timePenalty
    };
}
