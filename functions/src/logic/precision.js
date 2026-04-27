// functions/src/logic/precision.js
import { standardPortAllowance } from '../data/competitionData.js';
import { round2, isNum } from './sharedUtils.js';

// Normalisera klassnamn
const _norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');

function resolveStandardPortAllowanceInternal(className) {
    if (!className) return isNum(standardPortAllowance['*']) ? standardPortAllowance['*'] : null;
    const normalizedClassName = _norm(className);
    const keys = Object.keys(standardPortAllowance || {}).filter((k) => k !== '*');

    // logic same as client
    const exactKey = keys.find((key) => _norm(key) === normalizedClassName);
    if (exactKey) return standardPortAllowance[exactKey];

    const prefixKey = keys.filter((key) => normalizedClassName.startsWith(_norm(key)))
        .sort((a, b) => _norm(b).length - _norm(a).length)[0];
    if (prefixKey) return standardPortAllowance[prefixKey];

    return standardPortAllowance['*'] || 35;
}

export function computeMaxSecondsForClass(cls, config) {
    // 1. Direct from config (admin override)
    const direct = config?.maxTimeByClass?.[cls] || config?.maxTimeByClass?.[_norm(cls)];
    if (direct) {
        // ... handle time string or number
        const n = Number(direct);
        if (Number.isFinite(n) && n > 0) return n;
    }
    // 2. Calculated from course
    const course = config?.courses?.[cls];
    if (course) {
        const len = Number(course.trackLength || course.length);
        const tempo = Number(course.tempo || course.tempoMpm);
        if (len > 0 && tempo > 0) return Math.round((len / tempo) * 60);
    }
    return null;
}

export function calculatePrecisionTimePenalty(timeMs, maxTimeSec, rate = 0.5) {
    if (!Number.isFinite(timeMs) || !Number.isFinite(maxTimeSec) || maxTimeSec <= 0) return 0;
    const maxMs = maxTimeSec * 1000;
    if (timeMs <= maxMs) return 0;
    const diff = timeMs - maxMs;
    return Math.ceil(diff / 1000) * rate;
}

export function calculatePrecisionResult(data, equipage, config = {}) {
    const d = data || {};

    const finalized = d.finalized === true;
    const eliminated = !!d.eliminated;
    const timeMs = finalized ? d.timeMs : (d.liveTimeMs || null);

    // Krockar
    const knocksCount = (Array.isArray(d.knocks) ? d.knocks.length : 0);
    const kp = config.knockdownPenalty != null ? Number(config.knockdownPenalty) : 3;

    // Priority: Explicit -> Calculated -> Live
    const obstaclePenalty = isNum(d.obstaclePenalty) ? d.obstaclePenalty
        : (knocksCount > 0 ? knocksCount * kp : (d.liveObstaclePenalty || 0));

    // Time
    const maxSec = computeMaxSecondsForClass(equipage?.className, config);
    const rate = Number.isFinite(config.timePenaltyRate) ? Number(config.timePenaltyRate) : 0.5;
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
