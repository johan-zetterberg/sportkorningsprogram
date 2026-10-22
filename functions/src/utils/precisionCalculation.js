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
 * Precision competition formats (precisionConfig.courses[cls].format).
 * Calculated: 'normal', a fault competition with penalties then time (TR V
 * 530.1.1 clear round, 530.1.2 A:0; FEI 976), 'twoPhase' and 'driveOff' (the
 * rounds on precision/{sn}.rounds, see calculatePrecisionResult). The others
 * are selectable so a class can be marked, but get no placing (by hand):
 *   time         – TR 510.4 tidstävling, FEI 978 Time Competition
 *   twoPhase     – TR 530.1.3 A med två faser, FEI 979 Competition in Two Phases
 *   winningRound – FEI 980 Competition with a Winning Round
 *   driveOff     – FEI 977 Drive-Off (TR: an organiser's variant, TR 510)
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
    twoPhase: { label: 'Två faser (TR 530.1.3 / FEI 979)', supported: true, excludesTotal: false },
    winningRound: { label: 'Med vinnarrunda (FEI 980)', supported: false, excludesTotal: false },
    driveOff: { label: 'Med omkörning / Drive-Off (FEI 977)', supported: true, excludesTotal: false },
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
// Bilaga 5 "Fas 2" of the same rows (A med två faser)
export const TR_PARA_PHASE2_TEMPO_MPM = {
    Msv: { pony: 220, horse: 230 },
    'Svår': { pony: 230, horse: 230 }
};
export function trParaDriverTempoMpm(cls, table = TR_PARA_CONES_TEMPO_MPM) {
    if (!cls || typeof cls !== 'object' || cls.isPara !== true) return null;
    const className = getClassName(cls);
    // A para class ("Msv Para Ponny") has its own table entry
    const row = table[normalizeClassKey(className)];
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

    // A tempo the admin set for the merged class applies to all in it
    const mergedTempo = tryNum(mergedCourses.tempo ?? mergedCourses.tempoMpm ?? mergedCourses.mPerMin);
    return tableTempoMpm(cls, 'precision', mergedTempo);
}

// The class table's tempo (field 'precision' or 'precisionPhase2'); mergedTempo
// comes after the table rows and before the horse/pony category
function tableTempoMpm(cls, field, mergedTempo = null) {
    const className = getClassName(cls);
    const keys = Object.keys(klassTempoData || {});
    // Whole words only (see matchClassTableKey): "Barnklass" is Lätt B Barn;
    // else by level and horse/pony without the hitch ("Lätt B Par Ponny")
    const key = tempoTableKey(className, keys);
    if (key && klassTempoData[key]?.[field]) return klassTempoData[key][field];
    // A name the table only has longer keys for ("Barnklass" -> "Lätt B Barn
    // Ponny"): their tempo when they all agree (TR V Bilaga 5: LB "Barn" 100)
    const words = classNameWords(className);
    const longer = keys.filter((candidate) => {
        const w = classNameWords(candidate);
        return words.length > 0 && w.length > words.length && words.every((x, i) => w[i] === x);
    }).map((candidate) => klassTempoData[candidate]?.[field]).filter(Boolean);
    if (longer.length > 0 && longer.every((v) => v === longer[0])) return longer[0];

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
        if (byCategory && klassTempoData[byCategory]?.[field]) return klassTempoData[byCategory][field];
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

// --- Rounds: phase 2 (two phases) and drive-off ---

/**
 * Rounds of a precision doc. 'phase1' is the doc's top level (phase 1 of two
 * phases, the initial round of a drive-off, the only round otherwise);
 * 'phase2' and 'driveOff' live under doc.rounds with the same field names.
 */
export const PRECISION_ROUNDS = ['phase1', 'phase2', 'driveOff'];

/**
 * How a round is scored: 'fault' (penalties, then time) or 'time' (time plus
 * penalty seconds). TR phase 2 is a fault round (TR 530.1.3 "lägst
 * straffpoäng i fas 2"); FEI phase 2 a time competition (FEI 979.2.1, 979.4.3);
 * a drive-off is against the clock (FEI 977.2.1, also as a TR variant).
 */
export function precisionRoundScoring(round, ruleProfile = 'TR') {
    if (round === 'driveOff') return 'time';
    if (round === 'phase2') return ruleProfile === 'FEI' ? 'time' : 'fault';
    return 'fault';
}

const tryPositive = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
};

/** The course settings of a round: courses[cls] for phase 1, courses[cls][round] otherwise ({} when none) */
export function getPrecisionRoundCourse(cls, config = {}, round = 'phase1') {
    const courses = config?.courses || {};
    for (const key of getCourseCandidates(cls)) {
        const course = courses[key];
        if (!course) continue;
        if (!round || round === 'phase1') return course;
        if (course[round] && typeof course[round] === 'object') return course[round];
    }
    return {};
}

/**
 * The round's tempo (m/min): the configured one (courses[cls][round].tempo),
 * else phase 2: TR Bilaga 5 "Fas 2" (para drivers by their para row, TR
 * 534.9), FEI the phase-1 speed (979.1.1 "identical or different speed");
 * drive-off: the phase-1 tempo. null when unknown (TR Lätt B: the admin
 * enters it).
 */
export function getPrecisionRoundTempoMpm(cls, config = {}, round = 'phase1', { ruleProfile = null } = {}) {
    if (!round || round === 'phase1') return getClassTempoMpm(cls, config, { ruleProfile });
    const course = getPrecisionRoundCourse(cls, config, round);
    const configured = tryPositive(course.tempo ?? course.tempoMpm ?? course.mPerMin);
    if (configured) return configured;
    const profile = ruleProfile === 'FEI' || ruleProfile === 'TR'
        ? ruleProfile
        : getClassRuleProfile(getClassName(cls), null);
    if (round === 'phase2' && profile !== 'FEI') {
        const para = trParaDriverTempoMpm(cls, TR_PARA_PHASE2_TEMPO_MPM);
        if (para) return para;
        return tableTempoMpm(cls, 'precisionPhase2');
    }
    return getClassTempoMpm(cls, config, { ruleProfile: profile });
}

/**
 * The round's max time / Time Allowed in whole seconds (rounded up as in
 * computeMaxSecondsForClass), null without a track length or tempo. A drive-off
 * without its own length is driven over the same course (FEI 977.2.1).
 */
export function computePrecisionRoundMaxSec(cls, config = {}, round = 'phase1', { ruleProfile = null } = {}) {
    if (!round || round === 'phase1') return computeMaxSecondsForClass(cls, config, { ruleProfile });
    const course = getPrecisionRoundCourse(cls, config, round);
    let lengthMeters = tryPositive(course.trackLengthMeters ?? course.length ?? course.trackLength);
    if (!lengthMeters && round === 'driveOff') lengthMeters = getTrackLengthMeters(cls, config);
    const tempoMpm = getPrecisionRoundTempoMpm(cls, config, round, { ruleProfile });
    if (lengthMeters > 0 && tempoMpm > 0) return Math.ceil((lengthMeters * 60) / tempoMpm - 1e-9);
    return null;
}

/** The round's obstacle labels (courses[cls][round].obstacleLabels), else phase 1's for a drive-off */
export function getPrecisionRoundObstacleLabels(cls, config = {}, round = 'phase1') {
    const own = getPrecisionRoundCourse(cls, config, round)?.obstacleLabels;
    if (Array.isArray(own) && own.length) return own.slice();
    if (round === 'driveOff' || round === 'phase1' || !round) {
        const base = getPrecisionRoundCourse(cls, config, 'phase1')?.obstacleLabels;
        return Array.isArray(base) ? base.slice() : [];
    }
    return [];
}

/**
 * Whether the class has a drive-off in its schedule: format 'driveOff' unless
 * courses[cls].driveOff.scheduled is false; two phases only with scheduled true
 * (FEI 979.5.3). Without one, equal penalties go by time (TR 530.1.2, FEI 977.2.3).
 */
export function isPrecisionDriveOffScheduled(cls, config = {}) {
    const format = getPrecisionFormat(cls, config);
    const scheduled = getPrecisionRoundCourse(cls, config, 'driveOff')?.scheduled;
    if (format === 'driveOff') return scheduled !== false;
    if (format === 'twoPhase') return scheduled === true;
    return false;
}

function resolveTimePenaltyRate(config, comp) {
    if (Number.isFinite(config?.timePenaltyRate)) return config.timePenaltyRate;
    if (Number.isFinite(comp?.ruleSettings?.precisionTimePenaltyRate)) return comp.ruleSettings.precisionTimePenaltyRate;
    return PRECISION_TIME_PENALTY_RATE;
}

// Run time of a live precision doc at nowMs (paused time + time since the clock (re)started)
export function precisionElapsedMs(d, nowMs = Date.now()) {
    if (!d?.liveStartEpoch) return null;
    return (Number(d.livePausedMs) || 0) + (nowMs - Number(d.liveStartEpoch));
}

// The doc with each running round's ticking time; null when none runs
function withLiveRounds(d, nowMs) {
    const rounds = d?.rounds;
    if (!rounds || typeof rounds !== 'object') return null;
    let changed = null;
    for (const key of ['phase2', 'driveOff']) {
        const r = rounds[key];
        if (!r || !(r.running === true || r.inProgress === true)) continue;
        const elapsed = precisionElapsedMs(r, nowMs);
        if (!isNum(elapsed)) continue;
        changed = changed || { ...rounds };
        changed[key] = { ...r, running: true, finalized: false, liveTimeMs: elapsed, _elapsedMs: elapsed };
    }
    return changed ? { ...d, rounds: changed } : null;
}

/**
 * Result for a doc that may be running: the ticking time at nowMs is used as
 * the live time (phase 1 on the top level, a running phase 2 / drive-off in
 * result.rounds[round], with rounds[round].elapsedMs). Not-running docs give
 * the normal result.
 */
export function calculatePrecisionLiveResult(data, equipage, config = {}, options = {}, nowMs = Date.now()) {
    const base = data || {};
    const d = withLiveRounds(base, nowMs) || base;
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

/**
 * One round's result. scoring 'fault' is the precision math of TR 530 / FEI
 * 975-976 (unchanged for phase 1). scoring 'time' (FEI 978) adds
 * score = time (incl. +10 s per rebuild) + knock seconds + extra seconds +
 * 0.5 s per second over the Time Allowed (FEI 981 table, owner Q6); the
 * round's totalPenalty is then that score in seconds and penaltySec the
 * penalty seconds alone (the drive-off tie-break, FEI 978.4.1).
 *
 * @param {object} roundDoc - the top-level doc (phase 1) or doc.rounds[round]
 * @param {object} [opts] - { maxSec, scoring, timeLimitFactor, finalized,
 *        ruleProfile, rate, timeFallback, knockdownPenalty }
 */
export function calculatePrecisionRound(roundDoc, equipage, config = {}, {
    maxSec = null,
    scoring = 'fault',
    timeLimitFactor = null,
    finalized = null,
    rate = null,
    timeFallback = false
} = {}) {
    const d = roundDoc || {};
    const safeConfig = config || {};
    const isFinal = finalized == null ? d.finalized === true : finalized === true;
    const eliminated = !!d.eliminated;
    const retired = d.retired === true;
    const running = d.running === true;

    // The driven time in hundredths (truncated, FEI 975.10.3 / TR 530.8),
    // plus 10 s per obstacle rebuild (TR 530.15/530.19, FEI 975.4.4/975.5.1/
    // 975.8.5): the time used for the time penalty, the time limit and ranking
    const liveMs = isNum(d.liveTimeMs) ? truncatePrecisionTimeMs(d.liveTimeMs) : null;
    const finalMs = isNum(d.timeMs) ? truncatePrecisionTimeMs(d.timeMs) : null;
    // A saved round (inProgress false, not running) is its saved time: a late
    // Stop from another device (queued offline) may still rewrite liveTimeMs
    // after the save, but it never sets inProgress again
    const saved = d.inProgress === false && !running && isNum(finalMs) && finalMs > 0;
    // timeFallback (rounds): a time written by the secretariat alone counts too
    const drivenTimeMs = timeFallback
        ? ((isFinal || saved) ? (finalMs ?? liveMs) : (liveMs ?? finalMs))
        : ((isFinal || saved) ? finalMs : (liveMs ?? null));
    const rebuildCount = precisionRebuildCount(d);
    const addedTimeMs = precisionAddedTimeMs(d);
    const timeMs = isNum(drivenTimeMs) && drivenTimeMs > 0 ? drivenTimeMs + addedTimeMs : drivenTimeMs;

    const knocksArr = Array.isArray(d.knocks) ? d.knocks.slice() : [];
    const knocksCount = knocksArr.length;

    const knockdownPenalty = (safeConfig.knockdownPenalty != null) ? Number(safeConfig.knockdownPenalty) : PRECISION_KNOCKDOWN_PENALTY;
    // The knock list is the only source once a doc has one: knocks are written
    // one toggle at a time by every device, while a stored obstaclePenalty is
    // one device's count at its save (a knock from another device in between
    // would go uncounted). Legacy docs without a list keep their stored value.
    const hasKnockList = Array.isArray(d.knocks);
    const storedObstacle = isNum(d.obstaclePenalty) || isNum(d.liveObstaclePenalty);
    const obstaclePenalty = hasKnockList
        ? ((knocksCount > 0 || storedObstacle) ? knocksCount * knockdownPenalty : null)
        : (isNum(d.obstaclePenalty) ? d.obstaclePenalty
            : (isNum(d.liveObstaclePenalty) ? d.liveObstaclePenalty : null));

    const penaltyRate = Number.isFinite(rate) ? rate : PRECISION_TIME_PENALTY_RATE;

    // Time penalty: calculated from the time when the max time is known, unless
    // the secretariat set it manually (timePenaltyOverride). Without a max time
    // the stored value is the only source.
    const storedTimePenalty = isNum(d.timePenalty) ? d.timePenalty
        : (isNum(d.liveTimePenalty) ? d.liveTimePenalty : 0);
    let timePenalty;
    if (d.timePenaltyOverride === true && isNum(d.timePenalty)) {
        timePenalty = d.timePenalty;
    } else if (isNum(maxSec) && maxSec > 0) {
        timePenalty = calculatePrecisionTimePenalty(timeMs, maxSec, penaltyRate);
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
    // A finalized result needs something driven: a time (or a time penalty the
    // secretariat set by hand). Finalized without one is not a 0-penalty
    // result: not started counts as withdrawn (TR 532.4), no total
    const manualTimePenalty = d.timePenaltyOverride === true && isNum(d.timePenalty);
    const hasValidResult = hasPerformance || (isFinal && !eliminated && manualTimePenalty) || running;
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
        if (isFinal) {
            totalPenalty = (hasValidResult && isNum(d.totalPenalty)) ? d.totalPenalty : null;
        } else if (running) {
            totalPenalty = isNum(d.liveTotalPenalty) ? d.liveTotalPenalty : null;
        }
    }

    let autoEliminated = false;
    // Lätt B Barn: the time is the time allowed itself; exceeding it stops the
    // equipage (TR Bilaga 5 #). Other classes: twice the time allowed (TR 529.10)
    const limitFactor = isNum(timeLimitFactor) && timeLimitFactor > 0
        ? timeLimitFactor
        : (isLattBBarnClass(equipage) ? 1 : 2);
    if (isNum(timeMs) && isNum(maxSec) && timeMs > (maxSec * limitFactor * 1000)) {
        autoEliminated = true;
    }

    const isInitiallyEliminated = eliminated || autoEliminated;
    let status = 'Ej startat';
    if (equipage?.status === 'struken') status = 'Struken';
    else if (running) status = 'Pågår';
    else if (isInitiallyEliminated) status = 'Utesluten';
    else if (retired) status = 'Utgått';
    else if ((isFinal && hasValidResult) || (isNum(timeMs) && timeMs > 0)) {
        status = configMissing ? 'Pågår' : 'Klar';
    }

    const timeDiffFromAllowed = (isNum(timeMs) && isNum(maxSec))
        ? Math.abs(timeMs - (maxSec * 1000))
        : Infinity;

    const round = {
        finalized: isFinal,
        eliminated: isInitiallyEliminated,
        autoEliminated,
        running,
        status,
        timeMs,
        drivenTimeMs,
        rebuildCount,
        addedTimeMs,
        liveMs,
        finalMs,
        timeDiffFromAllowed,
        maxTimeSec: isNum(maxSec) ? maxSec : null,
        timePenaltyRate: penaltyRate,
        timePenaltyOverride: d.timePenaltyOverride === true,
        configMissing,
        knocks: knocksArr,
        knockDownTimes: d.knockDownTimes || {},
        knocksCount: knocksCount || (isNum(d.liveObstaclePenalty) ? Math.floor(d.liveObstaclePenalty / knockdownPenalty) : 0),
        obstaclePenalty: isNum(obstaclePenalty) ? round2(obstaclePenalty) : null,
        timePenalty: isNum(timePenalty) ? round2(timePenalty) : null,
        extraPenalty: round2(extraPenalty),
        totalPenalty: isNum(totalPenalty) ? round2(totalPenalty) : null
    };
    if (scoring !== 'time') return round;

    // Time competition: everything in seconds (FEI 978.1.1, 978.4.1)
    const penaltySec = (obstaclePenalty || 0) + (timePenalty || 0) + (extraPenalty || 0);
    const score = (!configMissing && isNum(timeMs) && timeMs > 0)
        ? round2(timeMs / 1000 + penaltySec)
        : null;
    return {
        ...round,
        totalPenalty: score,
        score,
        penaltySec: round2(penaltySec)
    };
}

// Whether a rounds.* sub-doc holds anything (a started, driven or judged round)
export function precisionRoundHasData(r) {
    return roundHasData(r);
}

function roundHasData(r) {
    if (!r || typeof r !== 'object') return false;
    return r.running === true || r.inProgress === true || r.eliminated === true || r.retired === true
        || (isNum(r.timeMs) && r.timeMs > 0) || (isNum(r.liveTimeMs) && r.liveTimeMs > 0)
        || (Array.isArray(r.knocks) && r.knocks.length > 0)
        || (isNum(r.extraPenalty) && r.extraPenalty !== 0)
        || (isNum(r.rebuildCount) && r.rebuildCount > 0);
}

// The result of rounds[round] with the round's settings, and its state flags
function roundResult(doc, round, equipage, config, { ruleProfile, rate, topFinalized }) {
    const rd = doc?.rounds?.[round];
    const scoring = precisionRoundScoring(round, ruleProfile);
    // Phase 2 is closed with the whole result (finalizePrecision); a drive-off
    // after the initial round is finalized on its own (rounds.driveOff.finalized)
    const finalized = rd?.finalized === true
        || (round === 'phase2' && topFinalized === true && rd?.running !== true);
    const maxSec = computePrecisionRoundMaxSec(equipage, config, round, { ruleProfile });
    const r = calculatePrecisionRound(rd || {}, equipage, config, { maxSec, scoring, rate, finalized, timeFallback: true });
    const hasData = roundHasData(rd);
    const live = rd?.running === true || rd?.inProgress === true;
    const out = hasData && !live && (r.eliminated || rd?.retired === true);
    const finished = hasData && !live && !out && r.status === 'Klar' && isNum(r.totalPenalty);
    return {
        ...r,
        round,
        scoring,
        retired: rd?.retired === true,
        hasData,
        live,
        out, // eliminated or retired in this round
        finished,
        decided: finished || out,
        ...(isNum(rd?._elapsedMs) ? { elapsedMs: rd._elapsedMs } : {})
    };
}

/**
 * Placing input of one result, without the class context (see
 * core-engine/ranking.js precisionGroupContext for the drive-off). Tiers,
 * lower first:
 *   2 phase 2 finished: TR phase-2 penalties, then phase-2 time (owner Q5);
 *     FEI phase-2 score in seconds, then shared (FEI 979.5.1)
 *   3 phase 2 eliminated / retired / not driven (owner Q2, FEI 979.5.4):
 *     phase-1 time
 *   4 phase 1 / initial round only: penalties, then time (TR 530.1.2/530.1.3,
 *     FEI 977.2.3, 979.5.2)
 * tier null: not placed. unfinished: no place in a result list
 * (requireFinished), provisional in a live one.
 */
function precisionPlacing({ p1, p2, format, phase2Qualified, topFinalized, placeable }) {
    if (!placeable) return { tier: null, stage: 'none', penalty: null, timeMs: null, provisional: false, unfinished: false };
    const phase1 = { tier: 4, stage: 'phase1', penalty: p1.totalPenalty, timeMs: p1.timeMs, provisional: false, unfinished: false };
    if (format !== 'twoPhase' || !phase2Qualified || !p2) return phase1;
    const fault = p2.scoring !== 'time';
    if (p2.finished) {
        return { tier: 2, stage: 'phase2', penalty: p2.totalPenalty, timeMs: fault ? p2.timeMs : null, provisional: false, unfinished: false };
    }
    if (p2.out) {
        return { tier: 3, stage: 'phase2Out', penalty: p1.totalPenalty, timeMs: p1.timeMs, provisional: false, unfinished: false };
    }
    if (p2.live && isNum(p2.totalPenalty)) {
        return { tier: 2, stage: 'phase2Live', penalty: p2.totalPenalty, timeMs: fault ? p2.timeMs : null, provisional: true, unfinished: true };
    }
    // Phase 2 driven but not decided (stopped and not saved, or no max time
    // for phase 2: owner Q11): never a definitive place by the phase-1 time
    if (p2.hasData) {
        const noMaxTime = p2.configMissing || (!isNum(p2.maxTimeSec) && !p2.timePenaltyOverride);
        return { tier: 3, stage: noMaxTime ? 'phase2ConfigMissing' : 'phase2Pending', penalty: p1.totalPenalty, timeMs: p1.timeMs, provisional: true, unfinished: true };
    }
    // Clear in phase 1, phase 2 not driven: once finalized it did not continue
    if (topFinalized) {
        return { tier: 3, stage: 'phase2NotStarted', penalty: p1.totalPenalty, timeMs: p1.timeMs, provisional: false, unfinished: false };
    }
    return { tier: 3, stage: 'phase2Pending', penalty: p1.totalPenalty, timeMs: p1.timeMs, provisional: true, unfinished: true };
}

/**
 * The precision result of one equipage. All existing top-level fields are
 * phase 1 / the initial round, which alone counts for the combined total
 * (TR 533.2 "precisionsstraffen från fas 1", FEI 971.1.1, 971.3.1, 977.1.1).
 * Added:
 *   activeRound    - doc.activeRound ('phase1' | 'phase2' | 'driveOff')
 *   rounds         - { phase1, phase2, driveOff }: each round's result
 *                    (calculatePrecisionRound plus round, scoring, hasData,
 *                    live, out, finished, decided), null when the format has
 *                    no such round
 *   phase2Qualified - two phases: phase 1 finished clear (0 penalties, TR
 *                    530.1.3, FEI 979.4.2)
 *   phase2Ignored  - phase-2 data on an equipage not (or no longer) qualified
 *   driveOffScheduled - isPrecisionDriveOffScheduled
 *   formatWarnings - codes: 'trDriveOffVariant', 'phase2Ignored',
 *                    'phase2ConfigMissing', 'driveOffConfigMissing'
 *   placing        - { tier, stage, penalty, timeMs, provisional, unfinished }
 *                    (precisionPlacing; the drive-off tiers 0/1 come from the
 *                    class context in ranking.js)
 */
export function calculatePrecisionResult(data, equipage, config = {}, options = {}) {
    const d = data || {};
    const safeConfig = config || {};

    // Rule profile (TR / FEI) from the marathon class settings when the caller
    // has them (options.marathonConfig), else from the class name
    const ruleProfile = getClassRuleProfile(getClassName(equipage), options.marathonConfig || null);

    const maxSec = isNum(options.maxSec) && options.maxSec > 0
        ? options.maxSec
        : computeMaxSecondsForClass(equipage, safeConfig, { ruleProfile });
    const rate = resolveTimePenaltyRate(safeConfig, options.currentCompetition || null);
    const p1 = calculatePrecisionRound(d, equipage, safeConfig, { maxSec, scoring: 'fault', rate });

    // A format the engine does not calculate: no placing (precisionRankKey),
    // and for a time competition / Young Horse no combined total either
    const precisionFormat = getPrecisionFormat(equipage, safeConfig);
    const formatInfo = PRECISION_FORMATS[precisionFormat] || PRECISION_FORMATS.normal;
    const isClearRound = options.isClearRound === true;

    const base = {
        finalized: p1.finalized,
        eliminated: p1.eliminated,
        autoEliminated: p1.autoEliminated,
        running: p1.running,
        status: p1.status,
        timeMs: p1.timeMs, // driven time (hundredths) + added rebuild time
        drivenTimeMs: p1.drivenTimeMs, // the clock's time, truncated to hundredths
        rebuildCount: p1.rebuildCount, // obstacle rebuilds, +10 s each
        addedTimeMs: p1.addedTimeMs,
        liveMs: p1.liveMs,
        finalMs: p1.finalMs,
        ruleProfile,
        precisionFormat,
        formatUnsupported: formatInfo.supported !== true,
        formatExcludesTotal: formatInfo.excludesTotal === true,
        timeDiffFromAllowed: p1.timeDiffFromAllowed,
        maxTimeSec: p1.maxTimeSec,
        timePenaltyRate: p1.timePenaltyRate,
        timePenaltyOverride: p1.timePenaltyOverride,
        configMissing: p1.configMissing, // no max time for the class: totalPenalty withheld
        // Clear round class (TR V 509.3, isClearRoundClass): the caller knows the configs
        isClearRound,
        knocks: p1.knocks,
        knockDownTimes: p1.knockDownTimes,
        knocksCount: p1.knocksCount,
        obstaclePenalty: p1.obstaclePenalty,
        timePenalty: p1.timePenalty,
        extraPenalty: p1.extraPenalty,
        totalPenalty: p1.totalPenalty
    };

    const driveOffScheduled = formatInfo.supported === true && isPrecisionDriveOffScheduled(equipage, safeConfig);
    const ctx = { ruleProfile, rate, topFinalized: p1.finalized };
    const phase1 = { ...p1, round: 'phase1', scoring: 'fault', hasData: true, live: p1.running, out: p1.eliminated };
    const p2 = precisionFormat === 'twoPhase' ? roundResult(d, 'phase2', equipage, safeConfig, ctx) : null;
    const dOff = (driveOffScheduled || precisionFormat === 'driveOff' || roundHasData(d.rounds?.driveOff))
        ? roundResult(d, 'driveOff', equipage, safeConfig, ctx)
        : null;

    const phase1Done = !p1.running && !p1.configMissing && isNum(p1.totalPenalty)
        && (p1.finalized || p1.status === 'Klar');
    const phase2Qualified = precisionFormat === 'twoPhase' && phase1Done && !p1.eliminated
        && Math.abs(p1.totalPenalty) <= 1e-6;
    const phase2Ignored = precisionFormat === 'twoPhase' && !phase2Qualified && !p1.running && !!p2?.hasData;

    const formatWarnings = [];
    // TR has no drive-off in a fault competition, also not after two phases
    // (only an organiser's variant, TR 510)
    if (ruleProfile !== 'FEI' && (precisionFormat === 'driveOff' || driveOffScheduled)) formatWarnings.push('trDriveOffVariant');
    if (phase2Ignored) formatWarnings.push('phase2Ignored');
    if (p2?.configMissing || (p2?.hasData && !isNum(p2.maxTimeSec) && !p2.timePenaltyOverride)) formatWarnings.push('phase2ConfigMissing');
    if (dOff?.configMissing) formatWarnings.push('driveOffConfigMissing');

    const placeable = !base.formatUnsupported && !isClearRound && !p1.eliminated && isNum(p1.totalPenalty);
    const placing = precisionPlacing({ p1, p2, format: precisionFormat, phase2Qualified, topFinalized: p1.finalized, placeable });

    return {
        ...base,
        activeRound: PRECISION_ROUNDS.includes(d.activeRound) ? d.activeRound : 'phase1',
        rounds: { phase1, phase2: p2, driveOff: dOff },
        phase2Qualified,
        phase2Ignored,
        driveOffScheduled,
        formatWarnings,
        placing
    };
}

/**
 * One round's result alone, with the round's max time and scoring (for an
 * input page's save: calculate(data) of buildPrecisionSavePayload). roundDoc
 * is the top-level doc for 'phase1', else doc.rounds[round].
 */
export function calculatePrecisionRoundResult(roundDoc, equipage, config = {}, round = 'phase1', options = {}) {
    if (!round || round === 'phase1') return calculatePrecisionResult(roundDoc, equipage, config, options);
    const safeConfig = config || {};
    const ruleProfile = getClassRuleProfile(getClassName(equipage), options.marathonConfig || null);
    const rate = resolveTimePenaltyRate(safeConfig, options.currentCompetition || null);
    return roundResult({ rounds: { [round]: roundDoc || {} } }, round, equipage, safeConfig, { ruleProfile, rate, topFinalized: false });
}
