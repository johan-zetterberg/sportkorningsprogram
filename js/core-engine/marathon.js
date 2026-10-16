// js/core-engine/marathon.js
// The only marathon calculation. Pure: every input (config, pause windows,
// current time) comes in as an argument, so browser and Cloud Function agree.
import {
    PENALTY_RATE,
    MARATHON_OBSTACLE_TIME_PENALTY,
    MARATHON_TIME_LIMIT_FACTOR_A,
    MARATHON_TIME_LIMIT_FACTOR_B,
    MARATHON_TIME_LIMIT_FACTOR_TRANSPORT,
    MARATHON_DEFAULT_WINDOW_A_MIN,
    MARATHON_DEFAULT_WINDOW_B_MIN,
    MARATHON_OBSTACLE_MAX_TIME_SEC,
    MARATHON_WRONG_GAIT_GRACE_SEC,
    MARATHON_WRONG_GAIT_PERIOD_SEC,
    MARATHON_KNOCKDOWN_PENALTY,
    MARATHON_DEFAULT_PAUSE_MIN,
    DEFAULT_TRV_TEMPOS_KMH,
    PONY_CATEGORY_MAX_HEIGHT_CM,
    round2
} from './rules-ledger.js';

const kmhToMmin = (kmh) => (kmh * 1000) / 60;
const isPositive = (v) => Number.isFinite(v) && v > 0;
const STAGE_KEYS = ['A', 'transport', 'B'];

// === Config helpers ===

export function getActiveTempoRules(marathonConfig) {
    return marathonConfig?.tempoRules || DEFAULT_TRV_TEMPOS_KMH;
}

export function getPauseTime(marathonConfig) {
    return Number(marathonConfig?.pauseTime) || MARATHON_DEFAULT_PAUSE_MIN;
}

export function getObstacleMaxTime(marathonConfig) {
    const v = Number(marathonConfig?.obstacleMaxTime);
    return v > 0 ? v : MARATHON_OBSTACLE_MAX_TIME_SEC;
}

// === Class & category ===

export function normalizeClassKey(raw) {
    if (!raw) return null;
    const lower = String(raw).trim().toLowerCase();
    const para = /para/.test(lower);

    // The template itself ("Barnklass", chosen in the marathon admin) or a
    // class named so: the children's class, driven in Lätt B (TR V 500.2)
    if (/\bbarnklass\b/.test(lower)) return "Barnklass";

    if (/(^|[\d\s\.,&\;-]+)l[aä]tt\s*c\b|(\b)lc\b/.test(lower)) {
        if (/barn/.test(lower)) return "Barnklass";
        return para ? "Lätt B Para" : "Lätt B";
    }
    if (/(^|[\d\s\.,&\;-]+)l[aä]tt\s*b\b|(\b)lb\b/.test(lower)) {
        if (/barn/.test(lower)) return "Barnklass";
        return para ? "Lätt B Para" : "Lätt B";
    }
    if (/(^|[\d\s\.,&\;-]+)l[aä]tt\s*a\b|(\b)la\b/.test(lower)) return para ? "Lätt A Para" : "Lätt A";
    if (/(^|[\d\s\.,&\;-]+)(msv|medelsv[aå]r)\b/.test(lower)) return para ? "Msv Para" : "Msv";
    if (/(^|[\d\s\.,&\;-]+)sv[aå]r\b/.test(lower)) return para ? "Svår Para" : "Svår";

    if (/children|ch-/.test(lower)) return "CAI Children";
    if (/junior|j-/.test(lower)) return "CAI Junior";
    if (/u25|young/.test(lower)) return "CAI U25";

    // FEI / CAI
    if (/(?:\bcai|\bfei)\s*3/.test(lower)) return "CAI3*";
    if (/(?:\bcai|\bfei)\s*2/.test(lower)) return "CAI2*";
    if (/(?:\bcai|\bfei)\s*1/.test(lower)) return "CAI1*";

    return null;
}

function normalizeTRCategoryKey(raw) {
    if (raw === 0 || raw) {
        const s = String(raw).trim().toLowerCase();

        if (/(häst|horse)/.test(s)) return 'horse';

        if (/(ponny|pony)/.test(s)) {
            if (/\b(a|cat[\s\-]*a)\b/.test(s)) return 'ponyA';
            if (/\b(b|cat[\s\-]*b)\b/.test(s)) return 'ponyB';
            return 'ponyCD';
        }

        if (/^\s*a\s*$/.test(s)) return 'ponyA';
        if (/^\s*b\s*$/.test(s)) return 'ponyB';
        if (/^\s*(c|d)\s*$/.test(s)) return 'ponyCD';
    }
    return null;
}

// Heights may be stored as text ("128", "128 cm", "1,32")
function heightValue(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
}

function readHeightCmFromEquipage(e) {
    const nums = [];
    const add = (v) => { const n = heightValue(v); if (n != null) nums.push(n); };
    add(e?.heightCm);
    add(e?.horseHeightCm);
    add(e?.withersHeightCm);
    if (Array.isArray(e?.horses)) {
        for (const h of e.horses) {
            add(h?.heightCm);
            add(h?.withersHeightCm);
            add(h?.height);
        }
    }

    let h = nums.find(Number.isFinite);
    // Height entered in metres (e.g. 1.32) -> cm
    if (h > 0 && h < 3) h = Math.round(h * 100);
    return h || null;
}

// TR V Moment 163: A ≤107, B ≤130, C ≤140, D ≤148 cm, above is horse
function categoryFromHeightCm(cm) {
    if (!Number.isFinite(cm) || cm <= 0) return null;
    if (cm <= PONY_CATEGORY_MAX_HEIGHT_CM.ponyA) return 'ponyA';
    if (cm <= PONY_CATEGORY_MAX_HEIGHT_CM.ponyB) return 'ponyB';
    if (cm <= PONY_CATEGORY_MAX_HEIGHT_CM.ponyCD) return 'ponyCD';
    return 'horse';
}

// The class name says horse or pony, but its letter is the class level
// ("Lätt A Enbet Ponny"), not the pony category; only "kat. A/B" names it
function categoryFromClassName(className) {
    const s = String(className || '').toLowerCase();
    if (/(häst|horse)/.test(s)) return 'horse';
    if (!/(ponny|pony)/.test(s)) return null;
    if (/\b(kat|cat)\.?[\s\-]*a\b/.test(s)) return 'ponyA';
    if (/\b(kat|cat)\.?[\s\-]*b\b/.test(s)) return 'ponyB';
    if (/\b(kat|cat)\.?[\s\-]*[cd]\b/.test(s)) return 'ponyCD';
    return 'pony';
}

export function detectTRCategoryFromEquipage(e) {
    return detectKnownTRCategory(e) || 'horse';
}

/**
 * The category when something says it (a stated category, the height or the
 * class name), else null. detectTRCategoryFromEquipage falls back to horse;
 * callers that must not guess (a class for ponies and horses together) use this.
 */
export function detectKnownTRCategory(e) {
    // 1. A category stated on the equipage
    const candidates = [
        e?.category, e?.categoryName, e?.division, e?.animalCategory,
        e?.equineCategory, e?.ponyCategory, e?.horseCategory,
        e?.type, e?.equineType
    ];
    let statedPony = false;
    for (const r of candidates) {
        const k = normalizeTRCategoryKey(r);
        if (!k) continue;
        // "Ponny" without a letter: the height decides the category
        const text = String(r).toLowerCase();
        if (k === 'ponyCD' && /(ponny|pony)/.test(text) && !/\b(c|d|cat[\s\-]*[cd]|kat\.?[\s\-]*[cd])\b/.test(text)) {
            statedPony = true;
            continue;
        }
        return k;
    }
    // 2. The measured height (TR V Moment 163), then 3. the class name
    const byHeight = categoryFromHeightCm(readHeightCmFromEquipage(e));
    const byClass = statedPony ? 'pony' : categoryFromClassName(e?.className);
    if (byClass && byClass !== 'pony') {
        // A pony class with a measured pony height: the height decides A/B/C-D
        if (byClass.startsWith('pony') && byHeight && byHeight.startsWith('pony')) return byHeight;
        return byClass;
    }
    if (byClass === 'pony') return (byHeight && byHeight.startsWith('pony')) ? byHeight : 'ponyCD';
    return byHeight || null;
}

export function detectTRCategory(categoryString) {
    return normalizeTRCategoryKey(categoryString) || 'horse';
}

// Finds class settings even when the class name is longer than the config key
export function getClassSettings(className, marathonConfig) {
    if (!marathonConfig || !className) return null;
    const dataMap = marathonConfig.marathonClassData || marathonConfig.maratonClassData;
    if (!dataMap) return null;

    if (dataMap[className]) return dataMap[className];
    if (typeof className !== 'string') return null;

    const clean = (s) => s.trim().toLowerCase().replace(/\u00a0/g, ' ');
    const normClass = clean(className);
    const key = Object.keys(dataMap).find(k => normClass.startsWith(clean(k)));
    if (key) return dataMap[key];

    const normClassName = normalizeClassKey(className);
    if (normClassName) {
        const normKeyMatch = Object.keys(dataMap).find(k => normalizeClassKey(k) === normClassName);
        if (normKeyMatch) return dataMap[normKeyMatch];
    }
    return null;
}

function equipageClassName(equipage) {
    return equipage?.className || equipage?.class || equipage?.klass || '';
}

export function normStage(rawStage) {
    if (!rawStage) return '';
    const s = String(rawStage).toLowerCase();
    if (s === 'warmup' || s === 'a') return 'A';
    if (s === 'b') return 'B';
    if (s === 'transport' || s === 'transfer') return 'transport';
    return String(rawStage);
}

// === Ideal times & time windows ===

export function tlSecondsFor(equipage, rawStage, marathonConfig) {
    const stage = normStage(rawStage);
    const className = equipageClassName(equipage);
    if (!className || !marathonConfig) return null;

    const classSettings = getClassSettings(className, marathonConfig);
    if (!classSettings) return null;

    const readNum = (v) => (v !== undefined && v !== null && v !== '') ? Number(v) : null;
    const getDist = (s) => readNum(classSettings[`distance${s.toUpperCase()}`])
        ?? readNum(classSettings[s.toUpperCase()]?.distance);
    const getTempoMpm = (s) => readNum(classSettings[s.toUpperCase()]?.tempo_mpm)
        ?? readNum(classSettings[`tempo${s.toUpperCase()}`]);

    if (stage === 'transport') {
        const distM = getDist('T');
        const mpm = getTempoMpm('T');
        if (distM > 0 && mpm > 0) return Math.round((distM / mpm) * 60);
        return null;
    }

    if (stage === 'A' || stage === 'B') {
        // Fixed time (warm-up) on A
        if (stage === 'A') {
            const fixedMin = Number(classSettings.fixedTimeA);
            if (fixedMin > 0) return Math.round(fixedMin * 60);
        }

        const distM = getDist(stage);
        if (!(distM > 0)) return null;

        const manualTempo = getTempoMpm(stage);
        if (manualTempo > 0) return Math.round((distM / manualTempo) * 60);

        let baseKey = classSettings.trTemplate || className;
        if (equipage?.isPara && !/para/i.test(baseKey)) baseKey += " Para";
        const clsKey = normalizeClassKey(baseKey);
        const catKey = detectTRCategoryFromEquipage(equipage);
        const activeRules = getActiveTempoRules(marathonConfig);

        // The children's class is driven in Lätt B (TR V 500.2): a tempo table
        // saved before it had its own entry gives it the Lätt B tempos
        const rulesKey = (clsKey === 'Barnklass' && !activeRules?.[clsKey]) ? 'Lätt B' : clsKey;
        let kmh = activeRules?.[rulesKey]?.[stage]?.[catKey];
        // FEI tables often only distinguish "pony"
        if (!kmh && clsKey && clsKey.startsWith('CAI') && catKey.startsWith('pony')) {
            kmh = activeRules?.[clsKey]?.[stage]?.['pony'] || activeRules?.[clsKey]?.[stage]?.['ponyCD'];
        }

        if (kmh > 0) return Math.round((distM / kmhToMmin(kmh)) * 60);
        return null;
    }

    return null;
}

// Returns { ideal, min, max, timeLimit[, isFixedTime] } in seconds
export function limitsFor(equipage, rawStage, marathonConfig) {
    const stage = normStage(rawStage);
    const idealSec = tlSecondsFor(equipage, stage, marathonConfig);
    if (idealSec === null) return null;
    const classData = getClassSettings(equipageClassName(equipage), marathonConfig) || {};

    if (stage === 'A') {
        const timeLimit = Math.round(idealSec * MARATHON_TIME_LIMIT_FACTOR_A);
        if (Number(classData.fixedTimeA) > 0) {
            return { ideal: idealSec, min: 0, max: idealSec, timeLimit, isFixedTime: true };
        }
        const win = classData.windowA ?? MARATHON_DEFAULT_WINDOW_A_MIN;
        return { ideal: idealSec, min: Math.max(0, idealSec - win * 60), max: idealSec, timeLimit };
    }
    if (stage === 'B') {
        const win = classData.windowB ?? MARATHON_DEFAULT_WINDOW_B_MIN;
        return {
            ideal: idealSec,
            min: Math.max(0, idealSec - win * 60),
            max: idealSec,
            timeLimit: Math.round(idealSec * MARATHON_TIME_LIMIT_FACTOR_B)
        };
    }
    if (stage === 'transport') {
        // TR 523.2 penalises deviations on A and B only; the transfer has just
        // the time limit (TR 523.3: double the max time)
        return {
            ideal: idealSec,
            min: 0,
            max: idealSec,
            timeLimit: Math.round(idealSec * MARATHON_TIME_LIMIT_FACTOR_TRANSPORT),
            noTimePenalty: true
        };
    }
    return null;
}

export function getStageTimePenaltyRate(marathonConfig) {
    const rate = marathonConfig?.timePenaltyRate;
    return isPositive(rate) ? rate : PENALTY_RATE;
}

export function stagePenaltyFromMs(ms, equipage, stage, marathonConfig) {
    if (!Number.isFinite(ms) || ms <= 0) return { points: 0, elim: false };

    const lim = limitsFor(equipage, stage, marathonConfig);
    if (!lim) return { points: 0, elim: false };

    const sec = ms / 1000;
    if (sec > lim.timeLimit) return { points: Infinity, elim: true };
    if (lim.noTimePenalty) return { points: 0, elim: false };

    let diff = 0;
    if (sec < lim.min) {
        diff = lim.min - sec;
    } else if (sec > lim.max && !lim.isFixedTime) {
        // A fixed-time (warm-up) stage gives no penalty for exceeding max
        diff = sec - lim.max;
    }
    if (diff <= 0) return { points: 0, elim: false };

    return { points: round2(diff * getStageTimePenaltyRate(marathonConfig)), elim: false };
}

// True when a duration exceeds the time limit (e.g. forgot to stop the clock)
export function isDurationSuspicious(ms, equipage, stage, marathonConfig) {
    if (!Number.isFinite(ms) || ms <= 0) return false;
    const lim = limitsFor(equipage, stage, marathonConfig);
    if (!lim) return false;
    return ms / 1000 > lim.timeLimit;
}

export function getObstacleCoefficient(className, marathonConfig, ruleSettings = null) {
    const s = getClassSettings(className, marathonConfig);
    if (isPositive(s?.obstaclePenaltyRate)) return s.obstaclePenaltyRate;
    if (isPositive(marathonConfig?.obstaclePenaltyRate)) return marathonConfig.obstaclePenaltyRate;
    if (isPositive(ruleSettings?.marathonObstaclePenaltyRate)) return ruleSettings.marathonObstaclePenaltyRate;
    return MARATHON_OBSTACLE_TIME_PENALTY;
}

// Obstacles this class drives, e.g. "1, 2, 4" -> [1, 2, 4]; null means all
export function getClassDrivenObstacles(className, marathonConfig) {
    const cfg = getClassSettings(className, marathonConfig);
    if (cfg && cfg.drivenObstacles) {
        const parsed = String(cfg.drivenObstacles)
            .split(',')
            .map(s => parseInt(s.trim()))
            .filter(n => Number.isFinite(n) && n > 0);
        if (parsed.length > 0) return parsed;
    }
    return null;
}

/**
 * The obstacles an equipage of the class must drive: the class's "körda hinder",
 * else every obstacle of the competition (maratonConfig.obstacleNumbers, kept in
 * step with the obstacle list by the marathon admin). null when neither is known.
 */
export function getClassCourse(className, marathonConfig) {
    const driven = getClassDrivenObstacles(className, marathonConfig);
    if (driven) return driven;
    const all = (Array.isArray(marathonConfig?.obstacleNumbers) ? marathonConfig.obstacleNumbers : [])
        .map(Number)
        .filter(n => Number.isInteger(n) && n > 0);
    return all.length > 0 ? all : null;
}

export function isMarathonClearRound(equipage, marathonConfig) {
    return getClassSettings(equipage?.className, marathonConfig)?.clearRound === true;
}

export function getKnockdownPenaltyPerElement(marathonConfig) {
    const v = Number(marathonConfig?.knockdownPenaltyDefault);
    return marathonConfig?.knockdownPenaltyDefault != null && Number.isFinite(v) && v >= 0
        ? v
        : MARATHON_KNOCKDOWN_PENALTY;
}

// FEI classes follow the FEI rules, the Swedish ones TR
export function isFeiMarathonClass(className) {
    return /\b(FEI|CAI)(\b|\d)/i.test(String(className || ''));
}

/** Penalty for one wrong-gait incident of durationSec seconds. */
export function wrongGaitIncidentPenalty(durationSec, { fei = false } = {}) {
    const d = Math.max(0, Math.floor(Number(durationSec) || 0));
    if (d <= MARATHON_WRONG_GAIT_GRACE_SEC) return 0;
    const over = d - MARATHON_WRONG_GAIT_GRACE_SEC;
    return fei
        ? 1 + Math.floor(over / MARATHON_WRONG_GAIT_PERIOD_SEC)
        : Math.ceil(over / MARATHON_WRONG_GAIT_PERIOD_SEC);
}

/**
 * Wrong-gait penalty from the observer's log: each incident (wrongGaits,
 * [{ atSec, durSec }]) on its own. A log from before incidents were kept has
 * only the total (wrongGaitSeconds); it counts as one incident.
 */
export function wrongGaitPenaltyFromLog(observerLog, className) {
    const fei = isFeiMarathonClass(className);
    const incidents = Array.isArray(observerLog?.wrongGaits) ? observerLog.wrongGaits : [];
    const incidentSec = incidents.reduce((sum, inc) => sum + Math.max(0, Number(inc?.durSec) || 0), 0);
    // Seconds in the total that no incident accounts for (saved before
    // incidents were kept) count as one more incident
    const unattributedSec = Math.max(0, (Number(observerLog?.wrongGaitSeconds) || 0) - incidentSec);
    return incidents.reduce((sum, inc) => sum + wrongGaitIncidentPenalty(inc?.durSec, { fei }), 0)
        + wrongGaitIncidentPenalty(unattributedSec, { fei });
}

// === Obstacles & hold times ===

export function parseHoldTimeInput(val) {
    if (val == null) return 0;
    const str = String(val).trim();
    if (!str) return 0;
    if (str.includes(':')) {
        const parts = str.split(':');
        const m = parseInt(parts[0], 10) || 0;
        const s = parseFloat(parts[1]) || 0;
        return Math.max(0, Math.round(m * 60 + s));
    }
    const num = parseFloat(str.replace(',', '.'));
    return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
}

export function getObstacleArray(res) {
    const cand = res?.obstacles || res?.hinder || res?.obstacleResults || res?.maratonObstacles || [];
    return Array.isArray(cand) ? cand : [];
}

export function getTotalHoldTimeMs(dataOrObstacles) {
    if (!dataOrObstacles) return 0;
    const list = Array.isArray(dataOrObstacles) ? dataOrObstacles : getObstacleArray(dataOrObstacles);
    return list.reduce((sum, o) => {
        const ht = parseHoldTimeInput(o?.holdTimeSec);
        return ht > 0 ? sum + ht * 1000 : sum;
    }, 0);
}

function firstPresent(...values) {
    return values.find(v => v !== undefined && v !== null && v !== '') ?? null;
}

// Reads time & stored penalty from an obstacle regardless of field naming
export function obstacleValues(o) {
    const timeSecRaw = firstPresent(
        o?.timeSec,
        o?.timeSeconds,
        o?.timeInSeconds,
        o?.seconds,
        o?.tidSek,
        o?.time,
        Number.isFinite(o?.timeMs) ? o.timeMs / 1000 : null
    );
    const penaltyRaw = firstPresent(o?.penalty, o?.penalties, o?.straff, o?.sum, o?.totalPenalty);

    const timeSec = timeSecRaw == null ? null : Number(timeSecRaw);
    const penalty = penaltyRaw == null ? null : Number(penaltyRaw);
    return {
        timeSec: Number.isFinite(timeSec) ? timeSec : null,
        penalty: Number.isFinite(penalty) ? penalty : null,
        eliminated: !!o?.eliminated
    };
}

/**
 * One obstacle's penalties. Used by calculateMarathonResult and by input
 * pages that store/show a single obstacle.
 * @param {object} o - obstacle (timeSec/timeSeconds/timeInSeconds…, knockdownPenalty, otherPenalty)
 * @param {object} [opts] - { knockdowns } converts a knockdown count to points
 */
export function calculateObstacleResult(o, equipage, marathonConfig, ruleSettings = null, { knockdowns = null } = {}) {
    const { timeSec, penalty: storedPenalty } = obstacleValues(o);
    const isClearRound = isMarathonClearRound(equipage, marathonConfig);
    const coeff = getObstacleCoefficient(equipage?.className, marathonConfig, ruleSettings);

    const knockdownPenalty = Number.isFinite(Number(knockdowns)) && knockdowns != null
        ? Number(knockdowns) * getKnockdownPenaltyPerElement(marathonConfig)
        : Number(o?.knockdownPenalty || o?.knockDownPenalty || 0);
    const otherPenalty = Number(o?.otherPenalty || 0);

    if (!Number.isFinite(timeSec)) {
        // No time recorded: the stored obstacle penalty is all we have
        return {
            timeSec: null,
            timePenalty: 0,
            knockdownPenalty,
            otherPenalty,
            penalty: Number.isFinite(storedPenalty) ? storedPenalty : null,
            overMaxTime: false,
            eliminated: !!o?.eliminated
        };
    }

    const overMaxTime = timeSec > getObstacleMaxTime(marathonConfig);
    const timePenalty = isClearRound ? 0 : timeSec * coeff;
    return {
        timeSec,
        timePenalty: round2(timePenalty),
        knockdownPenalty,
        otherPenalty,
        penalty: round2(timePenalty + knockdownPenalty + otherPenalty),
        overMaxTime,
        eliminated: !!o?.eliminated || overMaxTime
    };
}

// === Timing doc ===

export function parseTimestamp(v) {
    if (!v) return null;
    try {
        if (typeof v?.toMillis === 'function') {
            const t = v.toMillis();
            return Number.isFinite(t) ? t : null;
        }
        if (v instanceof Date) {
            const t = v.getTime();
            return Number.isFinite(t) ? t : null;
        }
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        const t = new Date(v).getTime();
        return Number.isFinite(t) ? t : null;
    } catch {
        return null;
    }
}

export function stageStartTS(t, s) {
    const upper = String(s).toUpperCase();
    const flat = (s === 'transport') ? 'transfer' : s;
    let val = t?.[`start_${upper}`] || t?.[`start_${flat}`] || t?.stages?.[s]?.startClock || t?.timing?.[s]?.startClock;
    if (!val && s === 'A') val = t?.timing?.['warmup']?.startClock;
    if (!val) val = t?.times?.[s]?.start || t?.times?.[upper]?.start;
    return parseTimestamp(val);
}

export function stageStopTS(t, s) {
    if (!t) return null;
    const upper = String(s).toUpperCase();
    const flat = (s === 'transport') ? 'transfer' : s;
    let val = t?.[`finish_${upper}`] || t?.[`finish_${flat}`] || t?.stages?.[s]?.stopClock || t?.timing?.[s]?.stopClock;
    if (!val && s === 'A') val = t?.timing?.['warmup']?.stopClock;
    if (!val) val = t?.times?.[s]?.finish || t?.times?.[upper]?.finish;
    return parseTimestamp(val);
}

/**
 * When the stage clock last (re)started: the stage page writes runningSince on
 * start and resume and clears it on a local pause. Returns { known: false }
 * for data without the field (older documents), else { known: true, ms }
 * where ms is null while the stage is paused.
 */
export function stageRunningSince(t, s) {
    if (!t) return { known: false, ms: null };
    const upper = String(s).toUpperCase();
    const flat = (s === 'transport') ? 'transfer' : s;
    for (const key of [`runningSince_${flat}`, `runningSince_${upper}`, `runningSince_${s}`]) {
        if (key in t) return { known: true, ms: t[key] ? parseTimestamp(t[key]) : null };
    }
    const nested = t?.timing?.[s] || t?.stages?.[s];
    if (nested && 'runningSince' in nested) {
        return { known: true, ms: nested.runningSince ? parseTimestamp(nested.runningSince) : null };
    }
    return { known: false, ms: null };
}

// Saved (possibly manually corrected) stage duration
export function stageDurationMsSaved(t, s) {
    if (!t) return null;
    const upper = String(s).toUpperCase();
    const flat = (s === 'transport') ? 'transfer' : s;
    let v = t?.[`duration_${flat}_ms`] || t?.[`duration_${s}_ms`] || t?.[s]?.durationMs || t?.timing?.[s]?.durationMs;
    if (v == null && s === 'A') v = t?.timing?.['warmup']?.durationMs;
    if (v == null && Number.isFinite(t?.times?.[s]?.timeSec)) v = t.times[s].timeSec * 1000;
    if (v == null && Number.isFinite(t?.times?.[upper]?.timeSec)) v = t.times[upper].timeSec * 1000;
    if (v == null && Number.isFinite(t?.times?.[s]?.durationMs)) v = t.times[s].durationMs;
    if (v == null && Number.isFinite(t?.times?.[upper]?.durationMs)) v = t.times[upper].durationMs;
    if (v == null && Number.isFinite(t?.[`duration_${s}`])) v = legacyDurationToMs(t[`duration_${s}`]);
    return Number.isFinite(v) ? Number(v) : null;
}

// maraton-timing.duration_A/B: the secretariat writes milliseconds, older data
// (and the seed script) seconds. A driven stage lasts minutes, so a value of at
// least 36 000 is milliseconds (36 s as ms; 10 h as seconds) and below is seconds.
const LEGACY_DURATION_MS_THRESHOLD = 36000;
export function legacyDurationToMs(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n >= LEGACY_DURATION_MS_THRESHOLD ? n : n * 1000;
}

// Pause windows come from config/globalStatus.pauseLog. An open window
// (no end) lasts until nowMs; without nowMs it lasts indefinitely.
function pauseWindowBounds(w, nowMs) {
    const from = w.from || (w.start ? new Date(w.start).getTime() : 0);
    const to = w.to || (w.end ? new Date(w.end).getTime() : (Number.isFinite(nowMs) ? nowMs : Infinity));
    return [from, to];
}

export function pausedMsSince(ts, pauseWindows = [], nowMs = null) {
    if (!Number.isFinite(ts)) return 0;
    let sum = 0;
    for (const w of pauseWindows || []) {
        const [from, to] = pauseWindowBounds(w, nowMs);
        if (to <= ts || !Number.isFinite(to)) continue;
        const start = Math.max(ts, from);
        if (to > start) sum += (to - start);
    }
    return Math.max(0, sum);
}

export function pausedMsBetween(a, b, pauseWindows = [], nowMs = null) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    let sum = 0;
    for (const w of pauseWindows || []) {
        const [from, to] = pauseWindowBounds(w, nowMs);
        const start = Math.max(a, from);
        const end = Math.min(b, to);
        if (end > start) sum += (end - start);
    }
    return Math.max(0, sum);
}

export function isFinalizedMarathonDoc(d) {
    return d?.finalized === true || d?.status === 'finalized' || d?.isFinal === true;
}

// === Result ===

/**
 * state.config.nowMs: current time for live (running) stages. When omitted
 * (Cloud Function), a running stage only counts its saved duration.
 * state.config.pauseWindows: global pause log.
 * state.config.ruleSettings: competition rule settings (fallback rates).
 */
export function calculateMarathonResult(state) {
    const { equipage, marathon, config = {} } = state;
    const eq = equipage || {};
    const d = marathon?.resultDoc || {};
    const t = marathon?.timingDoc || {};
    const marathonConfig = config.marathonConfig;
    const pauseWindows = config.pauseWindows || [];
    const nowMs = Number.isFinite(config.nowMs) ? config.nowMs : null;
    const sn = String(eq.startNumber);

    if (eq.status === 'struken') {
        return {
            startNumber: sn,
            status: 'Struken',
            totalPenalty: null,
            eliminated: false,
            isClearRound: false,
            clearRoundApproved: false,
            stages: { A: {}, B: {}, transport: {} },
            obstacles: { sum: 0, items: [], eliminated: false, maxNumber: 0 },
            otherPenalty: 0,
            wgPenalty: 0,
            eta: { A: null, B: null },
            obstaclePenaltySum: 0,
            obstacleTimes: []
        };
    }

    const totalHoldTimeMs = getTotalHoldTimeMs(d);

    // 1. Stages
    const stages = {};
    let stagesPenalty = 0;
    let stagesElim = false;
    let running = false;
    let started = false;
    let hasStageTime = false;

    for (const s of STAGE_KEYS) {
        const start = stageStartTS(t, s);
        const stop = stageStopTS(t, s);
        const savedDuration = stageDurationMsSaved(t, s);
        // The latest (re)start on the stage page; null while paused locally
        const since = stageRunningSince(t, s);

        if (start) started = true;
        if (start && !stop && (since.known ? since.ms !== null : !Number.isFinite(savedDuration))) running = true;

        let ms = null;
        if (start && stop) {
            ms = (Number.isFinite(savedDuration) ? savedDuration : (stop - start))
                - pausedMsBetween(start, stop, pauseWindows, nowMs);
        } else if (start && nowMs !== null && since.known && since.ms === null) {
            // Paused on the stage page: the saved time, not ticking
            ms = Number.isFinite(savedDuration) ? savedDuration : 0;
        } else if (start && nowMs !== null) {
            // Live: saved time (before a local pause) plus the time ticking
            // since the latest (re)start; older data has no runningSince and
            // ticks from the stage start
            const tickFrom = since.known && since.ms !== null ? since.ms : start;
            ms = (Number.isFinite(savedDuration) ? savedDuration : 0)
                + (nowMs - tickFrom) - pausedMsSince(tickFrom, pauseWindows, nowMs);
        } else if (Number.isFinite(savedDuration)) {
            ms = savedDuration;
        }
        if (Number.isFinite(ms) && ms > 0) hasStageTime = true;

        const rawMs = ms;
        if (s === 'B' && Number.isFinite(ms)) ms = Math.max(0, ms - totalHoldTimeMs);

        let { points, elim } = stagePenaltyFromMs(ms, eq, s, marathonConfig);
        // A stage still in progress cannot be "too fast" yet: only time over
        // the maximum (or the time limit) counts until it is stopped
        const inProgress = !!start && !stop;
        const stageLimits = limitsFor(eq, s, marathonConfig);
        if (inProgress && !elim && stageLimits && Number.isFinite(ms) && ms / 1000 <= stageLimits.max) {
            points = 0;
        }
        if (elim) stagesElim = true;
        if (Number.isFinite(points)) stagesPenalty += points;

        stages[s] = {
            start,
            stop,
            durationMs: ms,
            rawDurationMs: rawMs,
            timePenalty: points,
            eliminated: elim,
            holdTimeMs: s === 'B' ? totalHoldTimeMs : 0,
            inProgress,
            limits: stageLimits
        };
    }

    // 2. Obstacles
    const obsCoeff = getObstacleCoefficient(eq.className, marathonConfig, config.ruleSettings);
    const drivenObs = getClassDrivenObstacles(eq.className, marathonConfig);
    const isClearRound = isMarathonClearRound(eq, marathonConfig);

    // Obstacle results carry `number` (input page) or `obstacleNumber` (subcollection)
    const obstacleNo = (o) => Number(o?.number ?? o?.obstacleNumber ?? o?.id);

    let obsArr = getObstacleArray(d);
    if (drivenObs) obsArr = obsArr.filter(o => drivenObs.includes(obstacleNo(o)));

    let totalObstacleSeconds = 0;
    let totalOtherObstaclePenalty = 0;
    let obsElim = false;
    let maxObsNumber = 0;
    const obsItems = [];

    for (const o of obsArr) {
        const item = calculateObstacleResult(o, eq, marathonConfig, config.ruleSettings);
        if (item.eliminated) obsElim = true;

        if (Number.isFinite(item.timeSec)) {
            // TR: sum all obstacle times first, then convert
            totalObstacleSeconds += item.timeSec;
            totalOtherObstaclePenalty += item.knockdownPenalty + item.otherPenalty;
        } else if (Number.isFinite(item.penalty)) {
            totalOtherObstaclePenalty += item.penalty;
        }

        if (Number.isFinite(obstacleNo(o))) maxObsNumber = Math.max(maxObsNumber, obstacleNo(o));
        obsItems.push({ ...o, timeSec: item.timeSec, timePenalty: item.timePenalty, penalty: item.penalty ?? 0 });
    }

    // Obstacle times are in hundredths: round the sum first so floating-point
    // noise (273.09999…) cannot flip the final rounding of the penalty
    totalObstacleSeconds = round2(totalObstacleSeconds);
    const obsPenalty = round2((isClearRound ? 0 : totalObstacleSeconds * obsCoeff) + totalOtherObstaclePenalty);

    const isObstacleDone = (hit) => hit && (hit.eliminated
        || Number.isFinite(obstacleValues(hit).penalty)
        || Number.isFinite(obstacleValues(hit).timeSec));
    // Complete when every obstacle of the course is done. Without a known
    // course (no "körda hinder" and no obstacle list) the highest registered
    // obstacle says nothing about the rest, so the course is never complete.
    const course = getClassCourse(eq.className, marathonConfig);
    const obstacleListMissing = !course;
    const obstaclesComplete = !!course
        && course.every(n => isObstacleDone(obsArr.find(x => obstacleNo(x) === n)));

    // 3. Wrong gait (observer) and other penalties
    const wgPenalty = round2(wrongGaitPenaltyFromLog(d.observerLog, equipageClassName(eq)));
    const other = Number(d.otherPenalty ?? d.miscPenalty ?? d.others ?? d.other ?? d.penalty_other) || 0;

    // 4. Settings check: a driven stage without ideal time / limits (no class
    // data in the marathon config) cannot be penalised, so the result would
    // look valid while missing its time penalties
    const hasData = started || hasStageTime || obsArr.length > 0;
    const missingConfig = [];
    if (hasData && !getClassSettings(equipageClassName(eq), marathonConfig)) {
        missingConfig.push('class');
    } else {
        for (const s of STAGE_KEYS) {
            const st = stages[s];
            if (Number.isFinite(st.rawDurationMs) && st.rawDurationMs > 0 && !st.limits) missingConfig.push(s);
        }
    }
    const configMissing = missingConfig.length > 0;

    // 5. Total
    const eliminated = !!d.eliminated || stagesElim || obsElim;
    let totalPenalty = null;
    if (eliminated) {
        totalPenalty = Infinity;
    } else if (hasData && !configMissing) {
        totalPenalty = round2(stagesPenalty + obsPenalty + other + wgPenalty);
    }

    // 6. Status. B is finished when stopped, or when it has a saved duration
    // and is not running (durations entered by the secretariat / field mode).
    // Never 'Klar' while the class settings needed for the penalty are missing.
    const bFinished = !!stages.B.stop
        || (Number.isFinite(stages.B.rawDurationMs) && stages.B.rawDurationMs > 0 && !stages.B.inProgress);
    let status = 'Ej startat';
    if (eliminated) status = 'Eliminerad';
    else if (bFinished && obstaclesComplete && !configMissing) status = 'Klar';
    else if (running || started) status = 'Pågår';
    if (isFinalizedMarathonDoc(d) && status !== 'Eliminerad' && !configMissing) status = 'Klar';

    // 7. ETA
    const etaA = (stages.A.start && !stages.A.stop && stages.A.limits?.ideal > 0)
        ? stages.A.start + stages.A.limits.ideal * 1000 : null;
    let etaB = (stages.B.start && !stages.B.stop && stages.B.limits?.ideal > 0)
        ? stages.B.start + stages.B.limits.ideal * 1000 : null;
    if (stages.A.start && stages.A.stop && stages.A.limits?.isFixedTime && !stages.B.start) {
        etaB = stages.A.start + stages.A.limits.ideal * 1000
            + getPauseTime(marathonConfig) * 60 * 1000
            + pausedMsSince(stages.A.start, pauseWindows, nowMs);
    }

    obsItems.sort((a, b) => obstacleNo(a) - obstacleNo(b));

    return {
        startNumber: sn,
        status,
        totalPenalty, // Infinity when eliminated; null while class settings are missing
        eliminated,
        configMissing,
        missingConfig, // 'class', or the stages (A, transport, B) without limits
        obstacleListMissing, // the course is unknown: never 'Klar'
        obstaclesComplete,
        isClearRound,
        clearRoundApproved: isClearRound && !eliminated && totalPenalty === 0,
        stages,
        obstacles: {
            sum: obsPenalty,
            eliminated: obsElim,
            items: obsItems,
            maxNumber: maxObsNumber
        },
        otherPenalty: other,
        wgPenalty,
        eta: { A: etaA, B: etaB },
        // TR tie-breakers (FEI classes have none: equal penalties share the place)
        feiClass: isFeiMarathonClass(equipageClassName(eq)),
        obstaclePenaltySum: obsPenalty,
        obstacleTimes: obsItems.map(o => o.timeSec || 0)
    };
}
