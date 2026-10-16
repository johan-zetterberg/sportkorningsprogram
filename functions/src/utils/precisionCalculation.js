import { klassTempoData } from '../data/competitionData.js';
import {
    PRECISION_TIME_PENALTY_RATE,
    PRECISION_KNOCKDOWN_PENALTY,
    isNum,
    round2 as roundNumber
} from '../core-engine/rules-ledger.js';
import { detectKnownTRCategory } from '../core-engine/marathon.js';

const norm = (value) => String(value || '').replace(/^[\d\s\.,&\;-]+/, '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
const round2 = (value) => isNum(value) ? roundNumber(value) : value;

function getClassName(value) {
    return typeof value === 'string' ? value : (value?.className || '');
}

export function getMergedClassName(value) {
    if (typeof value === 'string') return '';
    if (value?._mergedLabel) return String(value._mergedLabel);
    return value?.useMergedTestForDisplay && value?.mergedTestLabel ? String(value.mergedTestLabel) : '';
}

export function getCourseCandidates(value) {
    const className = getClassName(value);
    const mergedClassName = getMergedClassName(value);
    return [className, mergedClassName].filter(Boolean);
}

// Children's class in Lätt B ("Lätt B Barn", "LB Barn"; "Lätt C Barn" is
// driven as Lätt B, as in the marathon; "Barnklass")
export function isLattBBarnClass(value) {
    const names = typeof value === 'string' ? [value] : getCourseCandidates(value);
    return names.some((name) => {
        const s = String(name || '').toLowerCase();
        if (/\bbarnklass\b/.test(s)) return true;
        return /\bbarn\b/.test(s) && /(l[äa]tt\s*[bc]\b|\bl[bc]\b)/.test(s);
    });
}

export function calculatePrecisionTimePenalty(timeMs, maxTimeSec, timePenaltyRate = PRECISION_TIME_PENALTY_RATE) {
    if (!Number.isFinite(timeMs) || !Number.isFinite(maxTimeSec) || maxTimeSec <= 0) return 0;
    const maxMs = maxTimeSec * 1000;
    if (timeMs <= maxMs) return 0;
    return round2(((timeMs - maxMs) / 1000) * timePenaltyRate);
}

export function getTrackLengthMeters(cls, config = {}) {
    const courses = config?.courses || {};
    const courseKey = getCourseCandidates(cls).find((key) => courses[key]);
    const course = courses[courseKey] || {};
    const value = Number(course.trackLengthMeters ?? course.length ?? course.trackLength);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * FEI Art 975.10.5: cones speed by hitch and horse/pony (Children excepted):
 * four-in-hand 240, pair 250, single horse 250, single pony 260 m/min. null
 * when the class is not FEI, or the hitch or (for singles) the horse/pony
 * category cannot be told; the class table applies then.
 */
export function feiConesTempoMpm(cls) {
    const className = getClassName(cls);
    const s = String(className || '').toLowerCase();
    if (!/\b(fei|cai)/.test(s) || /children|\bbarn\b/.test(s)) return null;
    if (/fyrspann|four[\s-]*in[\s-]*hand|\bfour\b/.test(s)) return 240;
    if (/\bpar\b|\bpair\b|tvåspann/.test(s)) return 250;
    const isSingle = /enbet|\bsingle\b/.test(s);
    let pony = /ponny|pony/.test(s) ? true : (/häst|hast|horse/.test(s) ? false : null);
    if (pony === null && Array.isArray(cls?.horses)) {
        const types = cls.horses.map(h => String(h?.type || h?.category || '').toLowerCase()).filter(Boolean);
        if (types.length && types.every(t => /ponny|pony/.test(t))) pony = true;
        else if (types.length && types.every(t => /häst|hast|horse/.test(t))) pony = false;
    }
    if (pony === null && cls && typeof cls === 'object') {
        const category = detectKnownTRCategory(cls);
        if (category) pony = category !== 'horse';
    }
    if (!isSingle) {
        // Hitch not in the name (e.g. "FEI Junior 2*"): one driven horse is a single
        const driven = Array.isArray(cls?.horses) ? cls.horses.filter(h => h && !h.reserve && !h.isReserve).length : 0;
        if (driven === 1 && pony !== null) return pony ? 260 : 250;
        if (driven === 2) return 250;
        if (driven >= 4) return 240;
        return null;
    }
    if (pony === null) return null;
    return pony ? 260 : 250;
}

export function getClassTempoMpm(cls, config = {}) {
    const byClass = config?.tempoByClass || config?.classTempo || {};
    const className = getClassName(cls);
    const mergedClassName = getMergedClassName(cls);
    const allCourses = config?.courses || {};
    const courses = allCourses[className] || {};
    const mergedCourses = mergedClassName ? (allCourses[mergedClassName] || {}) : {};
    const tryNum = (value) => {
        const num = Number(value);
        return Number.isFinite(num) && num > 0 ? num : null;
    };

    const configured = tryNum(
        byClass[className]
        ?? byClass[norm(className)]
        ?? courses.tempo
        ?? courses.tempoMpm
        ?? courses.mPerMin
    );
    if (configured) return configured;

    // FEI classes by hitch and horse/pony (FEI 975.10.5), before the class table
    const fei = feiConesTempoMpm(cls);
    if (fei) return fei;

    const keys = Object.keys(klassTempoData || {});
    const normalizedClass = norm(className);
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
    if (key && klassTempoData[key]?.precision) return klassTempoData[key].precision;

    // A tempo the admin set for the merged class applies to all in it
    const mergedTempo = tryNum(mergedCourses.tempo ?? mergedCourses.tempoMpm ?? mergedCourses.mPerMin);
    if (mergedTempo) return mergedTempo;

    // A class for ponies and horses together ("Lätt B Enbet", TR 535.1): each
    // equipage drives its own tempo, from its horse/pony category (Bilaga 5).
    // Without a stated category or height the tempo stays unknown, so the
    // result is withheld instead of guessing horse
    const category = cls && typeof cls === 'object' && !/(häst|hast|ponny|pony)/i.test(className)
        ? detectKnownTRCategory(cls)
        : null;
    if (category) {
        const withCategory = norm(`${className} ${category === 'horse' ? 'Häst' : 'Ponny'}`);
        const byCategory = keys.find((candidate) => norm(candidate) === withCategory)
            || keys
                .filter((candidate) => withCategory.startsWith(norm(candidate)))
                .sort((a, b) => norm(b).length - norm(a).length)[0];
        if (byCategory && klassTempoData[byCategory]?.precision) return klassTempoData[byCategory].precision;
    }

    return null;
}

export function computeMaxSecondsForClass(cls, config = {}) {
    const className = getClassName(cls);
    const direct = config?.maxTimeByClass?.[className] || config?.maxTimeByClass?.[norm(className)];
    if (direct) {
        const value = Number(direct);
        if (Number.isFinite(value) && value > 0) return value;
    }

    const lengthMeters = getTrackLengthMeters(cls, config);
    const tempoMpm = getClassTempoMpm(cls, config);
    if (lengthMeters > 0 && tempoMpm > 0) {
        // Rounded up to a whole second (in the driver's favour); neither TR nor
        // FEI states the rounding. The small margin keeps an exact result
        // (600 m at 250 m/min = 144 s) from going up by float noise.
        return Math.ceil((lengthMeters * 60) / tempoMpm - 1e-9);
    }
    return null;
}

// Run time of a live precision doc at nowMs (paused time + time since the clock (re)started)
export function precisionElapsedMs(d, nowMs = Date.now()) {
    if (!d?.liveStartEpoch) return null;
    return (Number(d.livePausedMs) || 0) + (nowMs - Number(d.liveStartEpoch));
}

/**
 * Result for a doc that may be running: the ticking time at nowMs is used as
 * the live time. Not-running docs give the normal result.
 */
export function calculatePrecisionLiveResult(data, equipage, config = {}, options = {}, nowMs = Date.now()) {
    const d = data || {};
    const elapsed = (d.running === true || d.inProgress === true) ? precisionElapsedMs(d, nowMs) : null;
    if (!isNum(elapsed)) return calculatePrecisionResult(d, equipage, config, options);
    const result = calculatePrecisionResult(
        { ...d, running: true, finalized: false, liveTimeMs: elapsed },
        equipage,
        config,
        options
    );
    return { ...result, elapsedMs: elapsed };
}

export function calculatePrecisionResult(data, equipage, config = {}, options = {}) {
    const d = data || {};
    const safeConfig = config || {};

    const finalized = d.finalized === true;
    const eliminated = !!d.eliminated;
    const running = d.running === true;

    const liveMs = isNum(d.liveTimeMs) ? d.liveTimeMs : null;
    const finalMs = isNum(d.timeMs) ? d.timeMs : null;
    const timeMs = finalized ? finalMs : (liveMs ?? null);

    const knocksArr = Array.isArray(d.knocks) ? d.knocks.slice() : [];
    const knocksCount = knocksArr.length;

    const knockdownPenalty = (safeConfig.knockdownPenalty != null) ? Number(safeConfig.knockdownPenalty) : PRECISION_KNOCKDOWN_PENALTY;
    const inferredObstacle = knocksCount > 0 ? knocksCount * knockdownPenalty : null;
    const obstaclePenalty = isNum(d.obstaclePenalty) ? d.obstaclePenalty
        : (isNum(inferredObstacle) ? inferredObstacle
            : (isNum(d.liveObstaclePenalty) ? d.liveObstaclePenalty : null));

    const maxSec = isNum(options.maxSec) && options.maxSec > 0
        ? options.maxSec
        : computeMaxSecondsForClass(equipage, safeConfig);
    const comp = options.currentCompetition || null;
    let rate = PRECISION_TIME_PENALTY_RATE;
    if (Number.isFinite(safeConfig?.timePenaltyRate)) {
        rate = safeConfig.timePenaltyRate;
    } else if (Number.isFinite(comp?.ruleSettings?.precisionTimePenaltyRate)) {
        rate = comp.ruleSettings.precisionTimePenaltyRate;
    }

    // Time penalty: calculated from the time when the max time is known, unless
    // the secretariat set it manually (timePenaltyOverride). Without a max time
    // the stored value is the only source.
    const storedTimePenalty = isNum(d.timePenalty) ? d.timePenalty
        : (isNum(d.liveTimePenalty) ? d.liveTimePenalty : 0);
    let timePenalty;
    if (d.timePenaltyOverride === true && isNum(d.timePenalty)) {
        timePenalty = d.timePenalty;
    } else if (isNum(maxSec) && maxSec > 0) {
        timePenalty = calculatePrecisionTimePenalty(timeMs, maxSec, rate);
    } else {
        timePenalty = storedTimePenalty;
    }
    const hasTimeResult = (isNum(timeMs) && timeMs > 0)
        || (d.timePenaltyOverride === true && isNum(d.timePenalty))
        || isNum(d.timePenalty);
    timePenalty = (isNum(timePenalty) && (timePenalty > 0 || hasTimeResult)) ? timePenalty : null;

    const extraPenalty = isNum(d.extraPenalty) ? d.extraPenalty : null;
    const hasPerformance = (isNum(timeMs) && timeMs > 0)
        || (isNum(obstaclePenalty) && obstaclePenalty > 0)
        || (isNum(extraPenalty) && extraPenalty !== 0);
    const hasValidResult = hasPerformance || (finalized && !eliminated) || running;
    const sumParts = hasValidResult
        ? ((obstaclePenalty || 0) + (timePenalty || 0) + (extraPenalty || 0))
        : null;

    // A driven time cannot be penalised without the course's max time (track
    // length and tempo) unless the secretariat set the time penalty by hand;
    // like marathon, such a result gets no total and is never 'Klar'
    const configMissing = isNum(timeMs) && timeMs > 0
        && !(isNum(maxSec) && maxSec > 0)
        && !(d.timePenaltyOverride === true && isNum(d.timePenalty));

    let totalPenalty = configMissing ? null : sumParts;
    if (totalPenalty === null && !configMissing) {
        if (finalized) {
            totalPenalty = isNum(d.totalPenalty) ? d.totalPenalty : null;
        } else if (running) {
            totalPenalty = isNum(d.liveTotalPenalty) ? d.liveTotalPenalty : null;
        }
    }

    let autoEliminated = false;
    // Lätt B Barn: the time is the time allowed itself; exceeding it stops the
    // equipage (TR Bilaga 5 #). Other classes: twice the time allowed (TR 529.10)
    const timeLimitFactor = isLattBBarnClass(equipage) ? 1 : 2;
    if (isNum(timeMs) && isNum(maxSec) && timeMs > (maxSec * timeLimitFactor * 1000)) {
        autoEliminated = true;
    }

    const isInitiallyEliminated = eliminated || autoEliminated;
    let status = 'Ej startat';
    if (equipage?.status === 'struken') status = 'Struken';
    else if (running) status = 'Pågår';
    else if (isInitiallyEliminated) status = 'Utesluten';
    else if (finalized || (isNum(timeMs) && timeMs > 0)) {
        status = configMissing ? 'Pågår' : 'Klar';
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
        maxTimeSec: isNum(maxSec) ? maxSec : null,
        timePenaltyRate: rate,
        timePenaltyOverride: d.timePenaltyOverride === true,
        configMissing, // no max time for the class: totalPenalty withheld
        knocks: knocksArr,
        knockDownTimes: d.knockDownTimes || {},
        knocksCount: knocksCount || (isNum(d.liveObstaclePenalty) ? Math.floor(d.liveObstaclePenalty / knockdownPenalty) : 0),
        obstaclePenalty: isNum(obstaclePenalty) ? round2(obstaclePenalty) : null,
        timePenalty: isNum(timePenalty) ? round2(timePenalty) : null,
        extraPenalty: round2(extraPenalty),
        totalPenalty: isNum(totalPenalty) ? round2(totalPenalty) : null
    };
}
