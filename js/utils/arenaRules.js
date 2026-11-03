// js/utils/arenaRules.js
// Arena driving (indoor): cones and marathon-type obstacles on one course,
// a time competition where every penalty is converted to seconds.
//
// Two rule sets:
//   FEI  FEI Driving World Cup Rules 2025/2026 (assets/rules): art. 5 (time
//        competitions, Drive-Off 1 and 2), art. 8 (penalties in seconds),
//        art. 12. The values are fixed.
//   TR   TR V 2025 moment 510.7 Arenakörning: "en tidstävling där teknikhinder
//        och konpar körs i nummerordning ... straffpoäng ... som tidstillägg,
//        omräknat till sekunder". TR does not say how many seconds, so the
//        organiser sets them (the proposition); the defaults are the FEI ones.
//
// Settings live on precisionConfig.courses[className].arena (format 'arena').
// Rounds of a precision doc: phase1 = Competition 1, driveOff = Drive-Off 1,
// phase2 = Competition 2, driveOff2 = Drive-Off 2.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const ARENA_RULE_SETS = ['FEI', 'TR'];

/** Seconds per knocked-down ball / element (FEI WC art. 8.1, 8.3, 12.2) */
export const ARENA_FEI_KNOCK_SEC = 4;

/**
 * Incidents counted on a round (arenaIncidents: { key: count }), with the FEI
 * World Cup seconds (art. 8.1). A rebuild (+10 s, clock stopped) is the
 * precision doc's rebuildCount, as in cones. Combined occurrences are entered
 * as their parts, e.g. art. 8.1 "wrong gate in a marathon-type obstacle with
 * the whole turnout and dislodging an element: 34 s" = wrong course corrected
 * (20) + knock (4) + rebuild (10); "wrong gate in a cones obstacle and
 * dislodging an element: 14 s" = knock (4) + rebuild (10).
 */
export const ARENA_INCIDENTS = {
    groomDismount: { sec: 5, rule: 'FEI WC 8.1 (3:e gången: uteslutning, 8.2)' },
    groomReins: { sec: 20, rule: 'FEI WC 8.1' },
    wrongCourse: { sec: 20, rule: 'FEI WC 8.1, 8.4' },
    wrongGateCones: { sec: 20, rule: 'FEI WC 8.1, 12.4' },
    whipChange: { sec: 20, rule: 'FEI WC 8.1, 8.11' },
    beforeBell: { sec: 10, rule: 'FEI WC 8.8 a' }
};
export const ARENA_INCIDENT_KEYS = Object.keys(ARENA_INCIDENTS);

/** The third groom dismount eliminates (FEI WC 8.2) */
export const ARENA_GROOM_DISMOUNT_ELIMINATES_AT = 3;

/** Drive-off qualifiers: the best three, a tie for third included (FEI WC 5.2, 5.3) */
export const ARENA_DRIVE_OFF_TOP = 3;

export const ARENA_DRIVE_OFF_OPEN = ['none', 'top3', 'all'];
export const ARENA_DRIVE_OFF_TIMING = ['fromZero', 'added'];

/** Obstacle types on an arena course (FEI WC 4.1, 4.5) */
export const ARENA_OBSTACLE_TYPES = ['cone', 'marathon', 'bridge', 'speedBox'];

/** The rounds of an arena class in driving order */
export const ARENA_ROUNDS = ['phase1', 'driveOff', 'phase2', 'driveOff2'];

const positiveOr = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * The class's arena settings, normalized (raw = courses[cls].arena):
 *   rules         'FEI' | 'TR'
 *   knockSec      seconds per knock (FEI fixed 4)
 *   incidentSec   { key: seconds } (FEI fixed)
 *   competitions  1 | 2 (2: Competition 1 and 2 as in a World Cup Leg)
 *   driveOff1     'none' | 'top3' | 'all'
 *   driveOff1Timing 'fromZero' | 'added'. FEI: top three from zero, all added
 *                 to the first round (WC 5.2.2); TR: the organiser's choice
 *   driveOff2     'none' | 'top3' (only with two competitions; FEI: top3, 5.3)
 *   driveOff2Timing 'added' | 'fromZero' (FEI: added unless the schedule says
 *                 from zero, 5.3.2/5.3.3)
 *   obstacles     [{ label, type }] the course (labels for the knock buttons)
 */
export function normalizeArenaSettings(raw = {}) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const rules = oneOf(r.rules, ARENA_RULE_SETS, 'FEI');
    const fei = rules === 'FEI';
    const competitions = Number(r.competitions) === 2 ? 2 : 1;

    const incidentSec = {};
    for (const key of ARENA_INCIDENT_KEYS) {
        incidentSec[key] = fei ? ARENA_INCIDENTS[key].sec : positiveOr(r.incidentSec?.[key], ARENA_INCIDENTS[key].sec);
    }

    let driveOff1 = oneOf(r.driveOff1, ARENA_DRIVE_OFF_OPEN, fei ? 'top3' : 'none');
    let driveOff1Timing = oneOf(r.driveOff1Timing, ARENA_DRIVE_OFF_TIMING, driveOff1 === 'all' ? 'added' : 'fromZero');
    // FEI WC 5.2: a Leg's Competition 1 has a Drive-Off 1; from zero for the
    // best three, added to the first round when open to all (5.2.2)
    if (fei && driveOff1 === 'none') driveOff1 = 'top3';
    if (fei) driveOff1Timing = driveOff1 === 'all' ? 'added' : 'fromZero';

    let driveOff2 = competitions === 2 ? oneOf(r.driveOff2, ['none', 'top3'], 'top3') : 'none';
    if (fei && competitions === 2) driveOff2 = 'top3'; // WC 5.3 "shall be open to the best three"
    const driveOff2Timing = oneOf(r.driveOff2Timing, ARENA_DRIVE_OFF_TIMING, 'added');

    const obstacles = Array.isArray(r.obstacles)
        ? r.obstacles
            .map((o) => ({
                label: String(o?.label ?? '').trim().slice(0, 12),
                type: oneOf(o?.type, ARENA_OBSTACLE_TYPES, 'cone')
            }))
            .filter((o) => o.label)
            .slice(0, 40)
        : [];

    return {
        rules,
        knockSec: fei ? ARENA_FEI_KNOCK_SEC : positiveOr(r.knockSec, ARENA_FEI_KNOCK_SEC),
        incidentSec,
        competitions,
        driveOff1,
        driveOff1Timing,
        driveOff2,
        driveOff2Timing: driveOff2 === 'none' ? 'added' : driveOff2Timing,
        obstacles
    };
}

/**
 * The precisionConfig fields of a competition created as arena driving: every
 * class without its own format is an arena class (defaultFormat), with these
 * settings until the class is saved with its own (arenaDefaults: the choices
 * only, no seconds for FEI, no course). raw = { rules, competitions,
 * driveOff1, driveOff1Timing, driveOff2, driveOff2Timing }.
 */
export function arenaPrecisionConfigPatch(raw = {}) {
    const s = normalizeArenaSettings(raw);
    const arenaDefaults = { rules: s.rules, competitions: s.competitions, driveOff1: s.driveOff1 };
    if (s.rules === 'TR' && s.driveOff1 !== 'none') arenaDefaults.driveOff1Timing = s.driveOff1Timing;
    if (s.competitions === 2) {
        arenaDefaults.driveOff2 = s.driveOff2;
        if (s.rules === 'TR' && s.driveOff2 !== 'none') arenaDefaults.driveOff2Timing = s.driveOff2Timing;
    }
    return { defaultFormat: 'arena', arenaDefaults };
}

/** The rounds the settings drive, in order */
export function arenaRoundsOf(settings) {
    const s = settings || normalizeArenaSettings();
    const rounds = ['phase1'];
    if (s.driveOff1 !== 'none') rounds.push('driveOff');
    if (s.competitions === 2) {
        rounds.push('phase2');
        if (s.driveOff2 !== 'none') rounds.push('driveOff2');
    }
    return rounds;
}

/** Which competition (1 | 2) a round belongs to */
export function arenaCompetitionOfRound(round) {
    return round === 'phase2' || round === 'driveOff2' ? 2 : 1;
}

// --- Knocks ---
// A precision doc's knocks are a set of labels (written with arrayUnion /
// arrayRemove). An arena obstacle can be knocked several times (FEI WC 12.2,
// 12.9: every ball / element counts), so the second and later knocks on an
// obstacle get a suffix: "5", "5#2", "5#3". The count of entries is the
// number of knocks, as for cones.

const KNOCK_SUFFIX_RE = /^(.*)#(\d+)$/;

/** The obstacle label of a stored knock ("5#2" -> "5") */
export function arenaKnockObstacle(entry) {
    const s = String(entry ?? '');
    const m = KNOCK_SUFFIX_RE.exec(s);
    return m && Number(m[2]) >= 2 ? m[1] : s;
}

/** Knocks per obstacle label: Map label -> count */
export function arenaKnockCounts(knocks) {
    const counts = new Map();
    for (const entry of Array.isArray(knocks) ? knocks : []) {
        const label = arenaKnockObstacle(entry);
        counts.set(label, (counts.get(label) || 0) + 1);
    }
    return counts;
}

/** The entry to add for one more knock on an obstacle (the first free one) */
export function arenaKnockToAdd(knocks, label) {
    const have = new Set((Array.isArray(knocks) ? knocks : []).map(String));
    const base = String(label);
    if (!have.has(base)) return base;
    for (let n = 2; n < 100; n += 1) {
        if (!have.has(`${base}#${n}`)) return `${base}#${n}`;
    }
    return null;
}

/** The entry to remove when undoing a knock on an obstacle (the latest one), null when none */
export function arenaKnockToRemove(knocks, label) {
    const base = String(label);
    let best = null;
    let bestN = 0;
    for (const entry of Array.isArray(knocks) ? knocks : []) {
        const s = String(entry);
        if (s === base && bestN < 1) { best = s; bestN = 1; }
        const m = KNOCK_SUFFIX_RE.exec(s);
        if (m && m[1] === base && Number(m[2]) > bestN) { best = s; bestN = Number(m[2]); }
    }
    return best;
}

/** Short text of a knock list: "3, 5 ×2, H1 ×3" */
export function formatArenaKnocks(knocks) {
    return [...arenaKnockCounts(knocks)]
        .map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
        .join(', ');
}

/** Counts of a round's incidents, whole numbers >= 0 (unknown keys dropped) */
export function arenaIncidentCounts(roundDoc) {
    const raw = roundDoc?.arenaIncidents;
    const out = {};
    for (const key of ARENA_INCIDENT_KEYS) {
        const n = Number(raw?.[key]);
        out[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    return out;
}

/** The counts after pressing + (delta 1) or − (delta -1) on an incident */
export function nextArenaIncidents(current, key, delta = 1) {
    const counts = arenaIncidentCounts({ arenaIncidents: current });
    if (!ARENA_INCIDENT_KEYS.includes(key)) return counts;
    counts[key] = Math.max(0, counts[key] + Math.trunc(Number(delta) || 0));
    return counts;
}

/**
 * Seconds of a round's incidents, and whether they eliminate (third groom
 * dismount, FEI WC 8.2; the same in the TR set, where it is the organiser's
 * call but the app follows the FEI table).
 */
export function arenaIncidentPenalty(roundDoc, settings) {
    const s = settings || normalizeArenaSettings();
    const counts = arenaIncidentCounts(roundDoc);
    let sec = 0;
    for (const key of ARENA_INCIDENT_KEYS) {
        // Only the first and second dismount cost seconds; the third eliminates
        const n = key === 'groomDismount' ? Math.min(counts[key], ARENA_GROOM_DISMOUNT_ELIMINATES_AT - 1) : counts[key];
        sec += n * (isNum(s.incidentSec[key]) ? s.incidentSec[key] : 0);
    }
    return {
        counts,
        sec: Math.round(sec * 100) / 100,
        eliminated: counts.groomDismount >= ARENA_GROOM_DISMOUNT_ELIMINATES_AT
    };
}
