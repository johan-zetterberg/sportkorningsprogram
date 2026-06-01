import { klassTempoData } from '../data/competitionData.js';

const PRECISION_TIME_PENALTY_RATE = 0.5;
const norm = (value) => String(value || '').replace(/^[\d\s\.,&\;-]+/, '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const round2 = (value) => isNum(value) ? Math.round(value * 100) / 100 : value;

export function calculatePrecisionTimePenalty(timeMs, maxTimeSec, timePenaltyRate = 0.5) {
    if (!Number.isFinite(timeMs) || !Number.isFinite(maxTimeSec) || maxTimeSec <= 0) return 0;
    const maxMs = maxTimeSec * 1000;
    if (timeMs <= maxMs) return 0;
    return round2(((timeMs - maxMs) / 1000) * timePenaltyRate);
}

export function getTrackLengthMeters(cls, config = {}) {
    const courses = config?.courses || {};
    const course = courses[cls] || {};
    const value = Number(course.trackLengthMeters ?? course.length ?? course.trackLength);
    return Number.isFinite(value) && value > 0 ? value : null;
}

export function getClassTempoMpm(cls, config = {}) {
    const byClass = config?.tempoByClass || config?.classTempo || {};
    const courses = (config?.courses && config.courses[cls]) || {};
    const tryNum = (value) => {
        const num = Number(value);
        return Number.isFinite(num) && num > 0 ? num : null;
    };

    const configured = tryNum(
        byClass[cls]
        ?? byClass[norm(cls)]
        ?? courses.tempo
        ?? courses.tempoMpm
        ?? courses.mPerMin
    );
    if (configured) return configured;

    const keys = Object.keys(klassTempoData || {});
    const normalizedClass = norm(cls);
    let key = keys.find((candidate) => norm(candidate) === normalizedClass);
    if (!key) {
        key = keys
            .filter((candidate) => normalizedClass.startsWith(norm(candidate)))
            .sort((a, b) => norm(b).length - norm(a).length)[0];
    }
    if (!key) {
        key = keys
            .filter((candidate) => normalizedClass.includes(norm(candidate)))
            .sort((a, b) => norm(b).length - norm(a).length)[0];
    }
    return key && klassTempoData[key]?.precision ? klassTempoData[key].precision : null;
}

export function computeMaxSecondsForClass(cls, config = {}) {
    const direct = config?.maxTimeByClass?.[cls] || config?.maxTimeByClass?.[norm(cls)];
    if (direct) {
        const value = Number(direct);
        if (Number.isFinite(value) && value > 0) return value;
    }

    const lengthMeters = getTrackLengthMeters(cls, config);
    const tempoMpm = getClassTempoMpm(cls, config);
    if (lengthMeters > 0 && tempoMpm > 0) {
        return Math.round((lengthMeters / tempoMpm) * 60);
    }
    return null;
}

export function calculatePrecisionResult(data, equipage, config = {}, options = {}) {
    const d = data || {};

    const finalized = d.finalized === true;
    const eliminated = !!d.eliminated;
    const running = d.running === true;

    const liveMs = isNum(d.liveTimeMs) ? d.liveTimeMs : null;
    const finalMs = isNum(d.timeMs) ? d.timeMs : null;
    const timeMs = finalized ? finalMs : (liveMs ?? null);

    const knocksArr = Array.isArray(d.knocks) ? d.knocks.slice() : [];
    const knocksCount = knocksArr.length;

    const knockdownPenalty = (config.knockdownPenalty != null) ? Number(config.knockdownPenalty) : 3;
    const inferredObstacle = knocksCount > 0 ? knocksCount * knockdownPenalty : null;
    const obstaclePenalty = isNum(d.obstaclePenalty) ? d.obstaclePenalty
        : (isNum(inferredObstacle) ? inferredObstacle
            : (isNum(d.liveObstaclePenalty) ? d.liveObstaclePenalty : null));

    const maxSec = computeMaxSecondsForClass(equipage?.className, config);
    const comp = options.currentCompetition || null;
    let rate = PRECISION_TIME_PENALTY_RATE;
    if (Number.isFinite(config?.timePenaltyRate)) {
        rate = config.timePenaltyRate;
    } else if (Number.isFinite(comp?.ruleSettings?.precisionTimePenaltyRate)) {
        rate = comp.ruleSettings.precisionTimePenaltyRate;
    }

    const calculatedTimePenalty = calculatePrecisionTimePenalty(timeMs, maxSec, rate);
    const storedTimePenalty = isNum(d.timePenalty) ? d.timePenalty
        : (isNum(d.liveTimePenalty) ? d.liveTimePenalty : 0);
    const timePenalty = Math.max(storedTimePenalty, calculatedTimePenalty) || null;

    const extraPenalty = isNum(d.extraPenalty) ? d.extraPenalty : null;
    const hasPerformance = (isNum(timeMs) && timeMs > 0)
        || (isNum(obstaclePenalty) && obstaclePenalty > 0)
        || (isNum(extraPenalty) && extraPenalty !== 0);
    const hasValidResult = hasPerformance || finalized || eliminated || running;
    const sumParts = hasValidResult
        ? ((obstaclePenalty || 0) + (timePenalty || 0) + (extraPenalty || 0))
        : null;

    let totalPenalty = sumParts;
    if (totalPenalty === null) {
        if (finalized) {
            totalPenalty = isNum(d.totalPenalty) ? d.totalPenalty : null;
        } else if (running) {
            totalPenalty = isNum(d.liveTotalPenalty) ? d.liveTotalPenalty : null;
        }
    }

    let autoEliminated = false;
    if (isNum(timeMs) && isNum(maxSec) && timeMs > (maxSec * 2 * 1000)) {
        autoEliminated = true;
    }

    const isInitiallyEliminated = eliminated || autoEliminated;
    let status = 'Ej startat';
    if (equipage?.status === 'struken') status = 'Struken';
    else if (running) status = 'Pågår';
    else if (finalized || (isNum(timeMs) && timeMs > 0)) {
        status = isInitiallyEliminated ? 'Utesluten' : 'Klar';
    }

    const timeDiffFromAllowed = (isNum(timeMs) && isNum(maxSec))
        ? Math.abs(timeMs - (maxSec * 1000))
        : Infinity;

    return {
        finalized,
        eliminated: isInitiallyEliminated,
        autoEliminated,
        running,
        status,
        timeMs,
        liveMs,
        finalMs,
        timeDiffFromAllowed,
        knocks: knocksArr,
        knockDownTimes: d.knockDownTimes || {},
        knocksCount: knocksCount || (isNum(d.liveObstaclePenalty) ? Math.floor(d.liveObstaclePenalty / knockdownPenalty) : 0),
        obstaclePenalty: isNum(obstaclePenalty) ? round2(obstaclePenalty) : null,
        timePenalty: isNum(timePenalty) ? round2(timePenalty) : null,
        extraPenalty: round2(extraPenalty),
        totalPenalty: isNum(totalPenalty) ? round2(totalPenalty) : null
    };
}
