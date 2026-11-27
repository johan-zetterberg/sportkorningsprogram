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
        at: Number.isFinite(raw.at) ? raw.at : null
    };
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
