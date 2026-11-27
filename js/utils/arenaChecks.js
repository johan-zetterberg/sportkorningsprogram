// Obstacle controllers in arena driving (optional): a controller at a
// marathon-type obstacle reports, per equipage and round, whether the gates
// were driven right, wrong and corrected, or wrong and not corrected, and the
// knocked elements. The report is its own document (arenaChecks), never the
// result: the judge on the precision input page adds the penalties with one
// tap (the knock buttons and "wrong course" incident as if entered there),
// and decides an elimination. applied = what the judge has added so far, so a
// changed report shows only what is still missing.
//
// Pure helpers; no Firestore, no DOM.

export const ARENA_CHECK_RESULTS = ['ok', 'wrongCorrected', 'wrongUncorrected'];
export const ARENA_CHECK_MAX_KNOCKS = 20;
const ROUNDS = ['phase1', 'driveOff', 'phase2', 'driveOff2'];
const CONTROL_TYPES = ['marathon', 'bridge'];

/** Document id of a report: start number, round and obstacle label */
export function arenaCheckId(startNumber, round, obstacle) {
    return `${String(startNumber)}__${ROUNDS.includes(round) ? round : 'phase1'}__${encodeURIComponent(String(obstacle ?? ''))}`;
}

/** The obstacles a controller can stand at: marathon-type obstacles and bridges */
export function arenaControlObstacles(settings) {
    const list = Array.isArray(settings?.obstacles) ? settings.obstacles : [];
    return list.filter((o) => o && o.label && CONTROL_TYPES.includes(o.type));
}

const clampKnocks = (n) => Math.max(0, Math.min(ARENA_CHECK_MAX_KNOCKS, Math.floor(Number(n) || 0)));

/** A stored report, normalized (null when it is not one) */
export function normalizeArenaCheck(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const obstacle = String(raw.obstacle ?? '').trim();
    if (!obstacle) return null;
    const applied = raw.applied && typeof raw.applied === 'object' ? raw.applied : {};
    return {
        startNumber: String(raw.startNumber ?? ''),
        round: ROUNDS.includes(raw.round) ? raw.round : 'phase1',
        obstacle,
        result: ARENA_CHECK_RESULTS.includes(raw.result) ? raw.result : null,
        knocks: clampKnocks(raw.knocks),
        applied: { knocks: clampKnocks(applied.knocks), wrongCourse: applied.wrongCourse === true },
        at: Number.isFinite(raw.at) ? raw.at : null,
        route: normalizeArenaRoute(raw.route),
        passMs: Number.isFinite(raw.passMs) ? raw.passMs : null,
        passAt: Number.isFinite(raw.passAt) ? raw.passAt : null
    };
}

// --- The route through a marathon-type obstacle (as in the marathon: a
// capital letter = the gate driven forwards, a small letter = backwards),
// each gate with its split time in the round (ms, null without a running
// clock) and the server time of the tap (at) ---

export const ARENA_ROUTE_MAX = 40;
export const ARENA_DEFAULT_GATES = 6;
const LETTERS = 'ABCDEFGHIJKL';

/** The gate letters of an obstacle (gates from the course, default A-F) */
export function arenaGateLetters(obstacle) {
    const n = Number(obstacle?.gates);
    const count = Number.isInteger(n) && n >= 1 && n <= LETTERS.length ? n : ARENA_DEFAULT_GATES;
    return LETTERS.slice(0, count).split('');
}

export function normalizeArenaRoute(route) {
    if (!Array.isArray(route)) return [];
    return route
        .filter((e) => e && typeof e.g === 'string' && /^[A-La-l]$/.test(e.g))
        .map((e) => ({ g: e.g, ms: Number.isFinite(e.ms) ? e.ms : null, at: Number.isFinite(e.at) ? e.at : null }))
        .slice(0, ARENA_ROUTE_MAX);
}

/** "A B c B C" */
export function arenaRouteText(route) {
    return normalizeArenaRoute(route).map((e) => e.g).join(' ');
}

/** Time in the obstacle: the first gate to the last (ms), null when unknown */
export function arenaRouteTimeMs(route) {
    const list = normalizeArenaRoute(route).filter((e) => e.ms != null);
    if (list.length < 2) return null;
    return Math.max(0, list[list.length - 1].ms - list[0].ms);
}

/** The route after a tap: 'A'..'L' / 'a'..'l' appended, 'undo' drops the last, 'clear' empties */
export function nextArenaRoute(route, action, { ms = null, at = null } = {}) {
    const list = normalizeArenaRoute(route);
    if (action === 'undo') return list.slice(0, -1);
    if (action === 'clear') return [];
    if (typeof action === 'string' && /^[A-La-l]$/.test(action) && list.length < ARENA_ROUTE_MAX) {
        return [...list, { g: action, ms: Number.isFinite(ms) ? ms : null, at: Number.isFinite(at) ? at : null }];
    }
    return null;
}

/**
 * The split time in a round at a server time: the round's clock (precision
 * input's liveStartEpoch is server time) while it runs, else null.
 */
export function arenaRoundElapsedMs(roundDoc, serverNowMs) {
    const r = roundDoc || {};
    if (r.running !== true || !Number.isFinite(Number(r.liveStartEpoch))) return null;
    return Math.max(0, (Number(r.livePausedMs) || 0) + (serverNowMs - Number(r.liveStartEpoch)));
}

/**
 * What the judge still has to add from a report: knocks (count) and the
 * "wrong course, corrected" incident; elimination: a wrong course not
 * corrected (the judge decides, nothing is added for it).
 */
export function arenaCheckPending(check) {
    const c = normalizeArenaCheck(check);
    if (!c) return { knocks: 0, wrongCourse: false, elimination: false, any: false };
    const knocks = Math.max(0, c.knocks - c.applied.knocks);
    const wrongCourse = c.result === 'wrongCorrected' && !c.applied.wrongCourse;
    return { knocks, wrongCourse, elimination: c.result === 'wrongUncorrected', any: knocks > 0 || wrongCourse };
}

/** The penalty seconds of the pending part (knockSec per knock, wrongCourse incident) */
export function arenaCheckPendingSeconds(check, settings) {
    const p = arenaCheckPending(check);
    const knockSec = Number(settings?.knockSec) || 0;
    const wrongSec = Number(settings?.incidentSec?.wrongCourse) || 0;
    return p.knocks * knockSec + (p.wrongCourse ? wrongSec : 0);
}

/** The report written by a controller's tap (action on the current report) */
export function nextArenaCheck(current, action) {
    const cur = current && typeof current === 'object' ? current : {};
    const next = {
        result: ARENA_CHECK_RESULTS.includes(cur.result) ? cur.result : null,
        knocks: clampKnocks(cur.knocks)
    };
    if (action === 'ok') next.result = 'ok';
    else if (action === 'wrongCorrected' || action === 'wrongUncorrected') next.result = action;
    else if (action === 'knockAdd') next.knocks = clampKnocks(next.knocks + 1);
    else if (action === 'knockRemove') next.knocks = clampKnocks(next.knocks - 1);
    else return null;
    // A knock reported without a gate verdict: the gates were driven right
    if (!next.result && next.knocks > 0) next.result = 'ok';
    return next;
}

/**
 * The split times of one equipage, per round in driving order: passages
 * (obstacle, split ms) in course order and routes through marathon-type
 * obstacles (text, time in the obstacle, the gates with their splits).
 * Rounds without any are left out.
 */
export function arenaSplitsByRound(checkList, startNumber, courseObstacles = [], rounds = ROUNDS) {
    const sn = String(startNumber);
    const order = new Map((courseObstacles || []).map((o, i) => [String(o?.label ?? ''), i]));
    const byCourse = (a, b) => (order.get(a.obstacle) ?? 999) - (order.get(b.obstacle) ?? 999)
        || a.obstacle.localeCompare(b.obstacle, 'sv', { numeric: true });
    const mine = (checkList || []).map(normalizeArenaCheck).filter((c) => c && c.startNumber === sn);
    return rounds.map((round) => {
        const inRound = mine.filter((c) => c.round === round).sort(byCourse);
        return {
            round,
            passages: inRound.filter((c) => c.passAt != null).map((c) => ({ label: c.obstacle, ms: c.passMs })),
            routes: inRound.filter((c) => c.route.length).map((c) => ({
                label: c.obstacle, text: arenaRouteText(c.route), ms: arenaRouteTimeMs(c.route), gates: c.route
            }))
        };
    }).filter((r) => r.passages.length || r.routes.length);
}

/**
 * The live map's data for an arena equipage (precision-monitor-map reads
 * the top level): the round on the course as the top level, with the
 * passages logged at the obstacles as gateSplits (gate_<label>: server time,
 * start: the round's start), so the map follows the equipage as in precision.
 */
export function arenaMapData(data, checkList, startNumber, round = 'phase1') {
    const d = data || {};
    const r = round === 'phase1' ? d : (d.rounds?.[round] || {});
    const splits = round === 'phase1' && d.gateSplits && typeof d.gateSplits === 'object' ? { ...d.gateSplits } : {};
    if (Number.isFinite(Number(r.liveStartEpoch)) && r.liveStartEpoch != null) splits.start = splits.start || Number(r.liveStartEpoch);
    const sn = String(startNumber);
    for (const c of (checkList || []).map(normalizeArenaCheck)) {
        if (c && c.startNumber === sn && c.round === round && c.passAt != null) splits[`gate_${c.obstacle}`] = c.passAt;
    }
    return {
        ...d,
        running: r.running === true,
        inProgress: r.inProgress === true,
        liveStartEpoch: r.liveStartEpoch ?? null,
        livePausedMs: Number(r.livePausedMs) || 0,
        liveTimeMs: r.liveTimeMs ?? null,
        timeMs: r.timeMs ?? null,
        status: r.status ?? d.status,
        gateSplits: splits
    };
}
