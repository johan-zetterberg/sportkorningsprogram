import { klassTempoData, matchClassTableKey, classNameWords } from '../data/competitionData.js';
import {
    PRECISION_TIME_PENALTY_RATE,
    PRECISION_KNOCKDOWN_PENALTY,
    PRECISION_REBUILD_ADDED_SEC,
    truncatePrecisionTimeMs,
    isNum,
    round2 as roundNumber
} from '../core-engine/rules-ledger.js';
import { detectKnownTRCategory, getClassRuleProfile, normalizeClassKey } from '../core-engine/marathon.js';

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
// driven as Lätt B, as in the marathon; "Barnklass"). TR V 509.2 / Bilaga 5 /
// Bilaga 9 (509 2 "Barnkusk i Lätt B överskrider tillåten tid i precision"):
// only Lätt B Barn drives 100 m/min with the time allowed as its limit. The
// Lätt A children's class ("Lätt A Barnklass", "LA Barn") drives the Lätt A
// "Barn" tempo 180 with normal time penalties.
const LATT_A_RE = /(l[äa]tt\s*a\b|\bla\b)/;
export function isLattBBarnClass(value) {
    const names = typeof value === 'string' ? [value] : getCourseCandidates(value);
    return names.some((name) => {
        const s = String(name || '').toLowerCase();
        if (/\bbarnklass\b/.test(s)) return !LATT_A_RE.test(s);
        return /\bbarn\b/.test(s) && /(l[äa]tt\s*[bc]\b|\bl[bc]\b)/.test(s);
    });
}

export function calculatePrecisionTimePenalty(timeMs, maxTimeSec, timePenaltyRate = PRECISION_TIME_PENALTY_RATE) {
    if (!Number.isFinite(timeMs) || !Number.isFinite(maxTimeSec) || maxTimeSec <= 0) return 0;
    const maxMs = maxTimeSec * 1000;
    // Hundredths (FEI 975.10.6 "any time over the Time Allowed in hundredths
    // of a second", TR 530.8): a time is truncated to hundredths first
    const ms = truncatePrecisionTimeMs(timeMs);
    if (ms <= maxMs) return 0;
    return round2(((ms - maxMs) / 1000) * timePenaltyRate);
}

// --- Obstacle rebuilds (+10 s each) ---

/**
 * Number of obstacle rebuilds stored on a precision result doc
 * (`rebuildCount`, a whole number >= 0). Each adds 10 s to the time: TR V
 * 530.15/530.19 (Bilaga 9 "+ 10 sek"), FEI 975.4.4, 975.5.1, 975.8.5.
 */
export function precisionRebuildCount(doc) {
    const n = Number(doc?.rebuildCount);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Milliseconds added to the time for the doc's rebuilds. */
export function precisionAddedTimeMs(doc) {
    return precisionRebuildCount(doc) * PRECISION_REBUILD_ADDED_SEC * 1000;
}

/**
 * The rebuild count after pressing "+10 s" (delta 1) or undoing it (-1); for
 * input pages: write the returned value to the doc's `rebuildCount`.
 */
export function nextPrecisionRebuildCount(current, delta = 1) {
    const n = Number(current);
    const base = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return Math.max(0, base + Math.trunc(Number(delta) || 0));
}

/** Short label for the added time: 0 -> '', 1 -> '+10 s', 2 -> '+20 s'. */
export function formatPrecisionAddedTime(rebuildCount) {
    const n = nextPrecisionRebuildCount(rebuildCount, 0);
    return n > 0 ? `+${n * PRECISION_REBUILD_ADDED_SEC} s` : '';
}

// --- Precision formats ---

/**
 * Precision competition formats (precisionConfig.courses[cls].format). Only
 * 'normal' is calculated: a fault competition with penalties then time (TR V
 * 530.1.1 clear round, 530.1.2 A:0; FEI 976). The others are selectable so a
 * class can be marked, but get no placing (calculate by hand):
 *   time         – TR 510.4 tidstävling, FEI 978 Time Competition
 *   twoPhase     – TR 530.1.3 A med två faser, FEI 979 Competition in Two Phases
 *   winningRound – FEI 980 Competition with a Winning Round
 *   driveOff     – FEI 977 Drive-Off
 *   youngHorse   – FEI Annex 13 Young Horses/Ponies (marks; 1/10 deductions,
 *                  0.1 penalty per second over the Time Allowed, Art. 6.4)
 * excludesTotal: the cones result of a time competition (FEI 971.2.1 "only to
 * be used to determine the placings in Cones") and Young Horse marks cannot be
 * added to a combined total; two phases, winning round and drive-off count
 * their first round / phase 1 in the total (TR 533.2 "Till totalresultatet
 * räknas precisionsstraffen från fas 1"; FEI 971.1.1, 971.3.1, 971.4.1).
 */
export const PRECISION_FORMATS = {
    normal: { label: 'Normal (fel)', supported: true, excludesTotal: false },
    time: { label: 'Tidstävling (TR 510.4 / FEI 978)', supported: false, excludesTotal: true },
    twoPhase: { label: 'Två faser (TR 530.1.3 / FEI 979)', supported: false, excludesTotal: false },
    winningRound: { label: 'Med vinnarrunda (FEI 980)', supported: false, excludesTotal: false },
    driveOff: { label: 'Med omkörning / Drive-Off (FEI 977)', supported: false, excludesTotal: false },
    youngHorse: { label: 'FEI Young Horse/Pony (Annex 13, reducerade avdrag)', supported: false, excludesTotal: true }
};

// FEI Young Horses / Young Ponies classes (Annex 13): "CAI-YH", "CH-M-YP",
// "Young Horse(s)", "Unghäst". Not "Young Drivers" (U25).
const YOUNG_HORSE_RE = /young\s*(horse|pony|ponies)|\b(cai|ch-m)-?y[hp]\d?\b|\bungh[äa]st/i;
export function isYoungHorseClass(value) {
    const names = typeof value === 'string' ? [value] : getCourseCandidates(value);
    return names.some((name) => YOUNG_HORSE_RE.test(String(name || '')));
}

/**
 * The class's precision format key: the admin's setting for the class (or
 * its merged class), else 'youngHorse' for a Young Horse/Pony class name,
 * else 'normal'.
 */
export function getPrecisionFormat(cls, config = {}) {
    const courses = config?.courses || {};
    for (const key of getCourseCandidates(cls)) {
        const f = courses[key]?.format;
        if (f && PRECISION_FORMATS[f]) return f;
    }
    return isYoungHorseClass(cls) ? 'youngHorse' : 'normal';
}

export function getTrackLengthMeters(cls, config = {}) {
    const courses = config?.courses || {};
    const courseKey = getCourseCandidates(cls).find((key) => courses[key]);
    const course = courses[courseKey] || {};
    const value = Number(course.trackLengthMeters ?? course.length ?? course.trackLength);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * FEI Art 975.10.5: cones speed by hitch and horse/pony (Children and Para
 * excepted): four-in-hand 240, pair 250, single horse 250, single pony 260
 * m/min. Para (FEI Annex 8.14): 230 for horses and ponies. null when the
 * class is not FEI, or the hitch or (for singles) the horse/pony category
 * cannot be told; the class table applies then.
 */
export const FEI_PARA_CONES_TEMPO_MPM = 230;
export function feiConesTempoMpm(cls, { feiProfile = false } = {}) {
    const className = getClassName(cls);
    const s = String(className || '').toLowerCase();
    // feiProfile: the class's rule profile is FEI even if its name is not
    if ((!feiProfile && !/\b(fei|cai)/.test(s)) || /children|\bbarn\b/.test(s)) return null;
    if (/\bpara\b|cai-?p\b/.test(s) || cls?.isPara === true) return FEI_PARA_CONES_TEMPO_MPM;
    // The hitch from the class name, else from the equipage's hitch/division
    const hitch = `${s} ${String(cls?.hitch || '').toLowerCase()} ${String(cls?.division || '').toLowerCase()}`;
    if (/fyrspann|four[\s-]*in[\s-]*hand|\bfour\b/.test(hitch)) return 240;
    if (/\bpar\b|\bpairs?\b|tvåspann/.test(hitch)) return 250;
    const isSingle = /enbet|\bsingles?\b/.test(hitch);
    let pony = /ponny|pony/.test(s) ? true : (/häst|hast|horse/.test(s) ? false : null);
    const drivenHorses = Array.isArray(cls?.horses) ? cls.horses.filter(h => h && !h.reserve && !h.isReserve) : [];
    if (pony === null && drivenHorses.length) {
        const types = drivenHorses.map(h => String(h?.type || h?.category || '').toLowerCase()).filter(Boolean);
        if (types.length && types.every(t => /ponny|pony/.test(t))) pony = true;
        else if (types.length && types.every(t => /häst|hast|horse/.test(t))) pony = false;
    }
    if (pony === null && cls && typeof cls === 'object') {
        const category = detectKnownTRCategory(cls);
        if (category) pony = category !== 'horse';
    }
    if (!isSingle) {
        // Hitch not in the name (e.g. "FEI Junior 2*"): one driven horse is a single
        const driven = drivenHorses.length;
        if (driven === 1 && pony !== null) return pony ? 260 : 250;
        if (driven === 2) return 250;
        if (driven >= 4) return 240;
        return null;
    }
    if (pony === null) return null;
    return pony ? 260 : 250;
}

/**
 * TR V 534.8: a para driver with a medical card may start in ordinary
 * classes, and 534.9: "Parakuskar tävlar med sina tempon etcetera". TR V
 * Bilaga 5 gives para cones speeds (phase 1) for MSV "PARA" (pony 210, horse
 * 220) and SVÅR "PARA" (230, 230); Lätt B and Lätt A have no para row, so the
 * class tempo applies there. null when not a para driver in an ordinary MSV /
 * Svår class, or when the MSV pony/horse category is unknown.
 */
const TR_PARA_CONES_TEMPO_MPM = {
    Msv: { pony: 210, horse: 220 },
    'Svår': { pony: 230, horse: 230 }
};
export function trParaDriverTempoMpm(cls) {
    if (!cls || typeof cls !== 'object' || cls.isPara !== true) return null;
    const className = getClassName(cls);
    // A para class ("Msv Para Ponny") has its own table entry
    const row = TR_PARA_CONES_TEMPO_MPM[normalizeClassKey(className)];
    if (!row) return null;
    if (row.pony === row.horse) return row.pony;
    const s = className.toLowerCase();
    let pony = /ponny|pony/.test(s) ? true : (/häst|hast|horse/.test(s) ? false : null);
    if (pony === null) {
        const category = detectKnownTRCategory(cls);
        if (category) pony = category !== 'horse';
    }
    if (pony === null) return null;
    return pony ? row.pony : row.horse;
}

// Hitch words and the MSV level number ("MSV 3"): a class table row is per
// level and horse/pony, so "Lätt B Par Ponny" drives as "Lätt B Ponny"
const HITCH_WORDS = new Set(['enbet', 'par', 'tandem', 'fyrspann', 'singel', 'single', 'singles', 'pair', 'pairs', 'four', 'in', 'hand', 'fourinhand']);
function tempoTableKey(className, keys) {
    const direct = matchClassTableKey(className, keys);
    if (direct) return direct;
    const words = classNameWords(className);
    const stripped = words.filter((w, i) => !HITCH_WORDS.has(w) && !(/^[1-4]$/.test(w) && words[i - 1] === 'msv'));
    if (stripped.length === words.length || stripped.length === 0) return null;
    return matchClassTableKey(stripped.join(' '), keys);
}

/**
 * The class's cones tempo (m/min).
 * @param {object} [opts] - { ruleProfile: 'TR' | 'FEI' } (getClassRuleProfile);
 *        default from the class name
 */
export function getClassTempoMpm(cls, config = {}, { ruleProfile = null } = {}) {
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

    const profile = ruleProfile === 'FEI' || ruleProfile === 'TR'
        ? ruleProfile
        : getClassRuleProfile(className, null);
    // FEI classes by hitch and horse/pony (FEI 975.10.5), before the class table
    if (profile === 'FEI') {
        const fei = feiConesTempoMpm(cls, { feiProfile: true });
        if (fei) return fei;
    } else {
        // A para driver in an ordinary TR class: the para tempo (TR 534.9)
        const para = trParaDriverTempoMpm(cls);
        if (para) return para;
    }

    const keys = Object.keys(klassTempoData || {});
    // Whole words only (see matchClassTableKey): "Barnklass" is Lätt B Barn;
    // else by level and horse/pony without the hitch ("Lätt B Par Ponny")
    const key = tempoTableKey(className, keys);
    if (key && klassTempoData[key]?.precision) return klassTempoData[key].precision;
    // A name the table only has longer keys for ("Barnklass" -> "Lätt B Barn
    // Ponny"): their tempo when they all agree (TR V Bilaga 5: LB "Barn" 100)
    const words = classNameWords(className);
    const longer = keys.filter((candidate) => {
        const w = classNameWords(candidate);
        return words.length > 0 && w.length > words.length && words.every((x, i) => w[i] === x);
    }).map((candidate) => klassTempoData[candidate]?.precision).filter(Boolean);
    if (longer.length > 0 && longer.every((v) => v === longer[0])) return longer[0];

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
        const byCategory = tempoTableKey(`${className} ${category === 'horse' ? 'Häst' : 'Ponny'}`, keys);
        if (byCategory && klassTempoData[byCategory]?.precision) return klassTempoData[byCategory].precision;
    }

    return null;
}

export function computeMaxSecondsForClass(cls, config = {}, { ruleProfile = null } = {}) {
    const className = getClassName(cls);
    const direct = config?.maxTimeByClass?.[className] || config?.maxTimeByClass?.[norm(className)];
    if (direct) {
        const value = Number(direct);
        if (Number.isFinite(value) && value > 0) return value;
    }

    const lengthMeters = getTrackLengthMeters(cls, config);
    const tempoMpm = getClassTempoMpm(cls, config, { ruleProfile });
    if (lengthMeters > 0 && tempoMpm > 0) {
        // Rounded up to a whole second (in the driver's favour); neither TR
        // (530.10, Bilaga 5) nor FEI (975.10.5) states the rounding. Only an
        // upper bound, unlike the marathon's ideal time, which bounds both the
        // minimum and the maximum time and so is rounded to the nearest second
        // (docs/reference/sport_driving_results_rules_en.md, "Rounding of
        // ideal times"). The small margin keeps an exact result
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

    // Rule profile (TR / FEI) from the marathon class settings when the caller
    // has them (options.marathonConfig), else from the class name
    const ruleProfile = getClassRuleProfile(getClassName(equipage), options.marathonConfig || null);

    // The driven time in hundredths (truncated, FEI 975.10.3 / TR 530.8),
    // plus 10 s per obstacle rebuild (TR 530.15/530.19, FEI 975.4.4/975.5.1/
    // 975.8.5): the time used for the time penalty, the time limit and ranking
    const liveMs = isNum(d.liveTimeMs) ? truncatePrecisionTimeMs(d.liveTimeMs) : null;
    const finalMs = isNum(d.timeMs) ? truncatePrecisionTimeMs(d.timeMs) : null;
    const drivenTimeMs = finalized ? finalMs : (liveMs ?? null);
    const rebuildCount = precisionRebuildCount(d);
    const addedTimeMs = precisionAddedTimeMs(d);
    const timeMs = isNum(drivenTimeMs) && drivenTimeMs > 0 ? drivenTimeMs + addedTimeMs : drivenTimeMs;

    const knocksArr = Array.isArray(d.knocks) ? d.knocks.slice() : [];
    const knocksCount = knocksArr.length;

    const knockdownPenalty = (safeConfig.knockdownPenalty != null) ? Number(safeConfig.knockdownPenalty) : PRECISION_KNOCKDOWN_PENALTY;
    const inferredObstacle = knocksCount > 0 ? knocksCount * knockdownPenalty : null;
    const obstaclePenalty = isNum(d.obstaclePenalty) ? d.obstaclePenalty
        : (isNum(inferredObstacle) ? inferredObstacle
            : (isNum(d.liveObstaclePenalty) ? d.liveObstaclePenalty : null));

    const maxSec = isNum(options.maxSec) && options.maxSec > 0
        ? options.maxSec
        : computeMaxSecondsForClass(equipage, safeConfig, { ruleProfile });
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

    // A format the engine does not calculate: no placing (precisionRankKey),
    // and for a time competition / Young Horse no combined total either
    const precisionFormat = getPrecisionFormat(equipage, safeConfig);
    const formatInfo = PRECISION_FORMATS[precisionFormat] || PRECISION_FORMATS.normal;

    return {
        finalized,
        eliminated: isInitiallyEliminated,
        autoEliminated,
        running,
        status,
        timeMs, // driven time (hundredths) + added rebuild time
        drivenTimeMs, // the clock's time, truncated to hundredths
        rebuildCount, // obstacle rebuilds, +10 s each
        addedTimeMs,
        liveMs,
        finalMs,
        ruleProfile,
        precisionFormat,
        formatUnsupported: formatInfo.supported !== true,
        formatExcludesTotal: formatInfo.excludesTotal === true,
        timeDiffFromAllowed,
        maxTimeSec: isNum(maxSec) ? maxSec : null,
        timePenaltyRate: rate,
        timePenaltyOverride: d.timePenaltyOverride === true,
        configMissing, // no max time for the class: totalPenalty withheld
        // Clear round class (TR V 509.3, isClearRoundClass): the caller knows the configs
        isClearRound: options.isClearRound === true,
        knocks: knocksArr,
        knockDownTimes: d.knockDownTimes || {},
        knocksCount: knocksCount || (isNum(d.liveObstaclePenalty) ? Math.floor(d.liveObstaclePenalty / knockdownPenalty) : 0),
        obstaclePenalty: isNum(obstaclePenalty) ? round2(obstaclePenalty) : null,
        timePenalty: isNum(timePenalty) ? round2(timePenalty) : null,
        extraPenalty: round2(extraPenalty),
        totalPenalty: isNum(totalPenalty) ? round2(totalPenalty) : null
    };
}
