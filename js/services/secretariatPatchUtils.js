// Secretariat edits are made on rows loaded once. Saving the whole row would
// write back values a judge has changed since then, so only the fields the
// secretariat actually edited are saved, and an edit of a field the judge
// changed meanwhile is refused instead of silently overwriting it.

// A list (a precision knock list) as one comparable key: the labels sorted and
// joined. null is "no list" (a legacy result with only a stored penalty),
// which differs from an empty list
const listKey = (value) => (Array.isArray(value) ? value.map(String).sort().join('\u0001') : null);

const sameValue = (a, b) => {
    if (Array.isArray(a) || Array.isArray(b)) return listKey(a) === listKey(b);
    const na = Number(a);
    const nb = Number(b);
    if (a !== '' && b !== '' && a != null && b != null && Number.isFinite(na) && Number.isFinite(nb)) {
        return Math.abs(na - nb) < 1e-9;
    }
    return String(a ?? '') === String(b ?? '');
};

// A row's value of a field, else its default. A list field (its default is a
// list) keeps null: the sentinel for "no list" (see listKey)
const valueOf = (row, field, defaults) => (
    row?.[field] === null && Array.isArray(defaults[field]) ? null : (row?.[field] ?? defaults[field])
);

/** The fields in `fields` whose value in `patch` differs from the loaded row */
export function pickEditedFields(patch = {}, baseRow = {}, fields = [], defaults = {}) {
    const edited = {};
    fields.forEach((field) => {
        if (!(field in patch)) return;
        const before = valueOf(baseRow, field, defaults);
        if (!sameValue(patch[field], before)) edited[field] = patch[field];
    });
    return edited;
}

/**
 * Edited fields whose server value changed after the row was loaded:
 * the judge (or another secretariat) changed them in between.
 */
export function findEditConflicts(edited = {}, baseRow = {}, current = {}, defaults = {}) {
    return Object.keys(edited).filter((field) => {
        const loaded = valueOf(baseRow, field, defaults);
        const now = valueOf(current, field, defaults);
        return !sameValue(loaded, now);
    });
}

// The form numbers a movement without momentNo by its position, like here
const movementKey = (movement, index) => String(movement?.momentNo ?? index + 1);

// A dressage protocol as flat fields: eliminated, and score/comment per movement
function flattenProtocol(protocol = {}) {
    const flat = { eliminated: !!protocol.eliminated };
    (protocol.movements || []).forEach((movement, index) => {
        const key = movementKey(movement, index);
        flat[`score:${key}`] = movement.score;
        flat[`comment:${key}`] = movement.comment ?? '';
    });
    return flat;
}

/**
 * Applies the secretariat's edits of a dressage protocol (the form compared
 * with the protocol as it was loaded) to the protocol now on the server, so
 * movements the judge saved in between are kept. `conflicts` lists the edited
 * fields the judge also changed; the caller must refuse the save then.
 */
export function mergeProtocolEdits(edited = {}, loaded = {}, current = {}) {
    const editedFlat = flattenProtocol(edited);
    const loadedFlat = flattenProtocol(loaded);
    const currentFlat = flattenProtocol(current);
    const changes = pickEditedFields(editedFlat, loadedFlat, Object.keys(editedFlat));
    const conflicts = findEditConflicts(changes, loadedFlat, currentFlat);

    const base = (current.movements && current.movements.length > 0) ? current.movements : (loaded.movements || []);
    const movements = base.map((movement, index) => {
        const key = movementKey(movement, index);
        const next = { ...movement };
        if (`score:${key}` in changes) next.score = changes[`score:${key}`];
        if (`comment:${key}` in changes) next.comment = changes[`comment:${key}`];
        return next;
    });
    // A movement only in the form (none on the server yet)
    (edited.movements || []).forEach((movement, index) => {
        const key = movementKey(movement, index);
        if (!movements.some((m, i) => movementKey(m, i) === key)) movements.push({ ...movement });
    });

    return {
        eliminated: 'eliminated' in changes ? changes.eliminated : !!current.eliminated,
        movements,
        changedFields: Object.keys(changes),
        conflicts
    };
}

/** A result that is still being timed must not be saved over or finalized (precision: any round) */
export function isStillRunning(doc = {}) {
    return doc?.running === true || !!doc?.runningStage
        || doc?.rounds?.phase2?.running === true || doc?.rounds?.driveOff?.running === true;
}

const toNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

// Obstacle fields the secretariat edits (time penalty and total follow from them)
export const OBSTACLE_EDIT_FIELDS = ['timeInSeconds', 'knockdowns', 'knockdownPenalty', 'otherPenalty', 'holdTimeSec', 'eliminated', 'comment'];
export const OBSTACLE_EDIT_DEFAULTS = { timeInSeconds: 0, knockdowns: 0, knockdownPenalty: 0, otherPenalty: 0, holdTimeSec: 0, eliminated: false, comment: '' };

/** One stored obstacle result in the secretariat's shape */
export function normalizeSecretariatObstacle(obstacle = {}, number = null) {
    const timeMsSec = Number.isFinite(Number(obstacle.timeMs)) && obstacle.timeMs !== null ? Number(obstacle.timeMs) / 1000 : null;
    return {
        obstacleNumber: Number(number ?? obstacle.obstacleNumber ?? obstacle.number),
        timeInSeconds: toNumber(obstacle.timeInSeconds ?? obstacle.timeSeconds ?? obstacle.timeSec ?? timeMsSec, 0),
        knockdowns: toNumber(obstacle.knockdowns, 0),
        knockdownPenalty: toNumber(obstacle.knockdownPenalty ?? obstacle.knockDownPenalty, 0),
        otherPenalty: toNumber(obstacle.otherPenalty, 0),
        timePenalty: toNumber(obstacle.timePenalty, 0),
        penalty: toNumber(obstacle.penalty, 0),
        holdTimeSec: toNumber(obstacle.holdTimeSec, 0),
        eliminated: !!obstacle.eliminated,
        comment: obstacle.comment || '',
        routeString: obstacle.routeString || '',
    };
}

/**
 * The obstacle results of one equipage by number, from every place they are
 * stored: the obstacle documents, the maraton document's list and (newer
 * storage) a map of entries keyed by obstacle number. The maraton document
 * wins, as on the result pages.
 */
export function mergeObstacleSources(savedObstacles = [], summary = null) {
    const byNumber = new Map();
    const put = (obstacle, fallbackNumber, override) => {
        if (!obstacle || typeof obstacle !== 'object') return;
        const key = Number(obstacle.obstacleNumber ?? obstacle.number ?? fallbackNumber);
        if (!Number.isFinite(key)) return;
        byNumber.set(key, override ? { ...(byNumber.get(key) || {}), ...obstacle, obstacleNumber: key } : { ...obstacle, obstacleNumber: key });
    };
    (savedObstacles || []).forEach(obstacle => put(obstacle, obstacle?.id, false));
    const list = Array.isArray(summary?.obstacles) ? summary.obstacles : [];
    list.forEach(obstacle => put(obstacle, null, true));
    // A map of entries keyed by obstacle number
    const map = summary?.obstacleResults;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
        Object.entries(map).forEach(([key, obstacle]) => put(obstacle, key, true));
    }
    return byNumber;
}

/**
 * A secretariat correction of one obstacle: the fields edited compared with
 * the row as loaded (`baseRow`), the edited fields the judge changed on the
 * server since (`conflicts`, the save must be refused) and the obstacle to
 * save: the server's current values with only the edited fields replaced.
 */
export function planObstacleCorrection(patch = {}, baseRow = {}, current = {}) {
    const currentRow = normalizeSecretariatObstacle(current || {}, baseRow?.obstacleNumber);
    const edited = pickEditedFields(patch, baseRow || {}, OBSTACLE_EDIT_FIELDS, OBSTACLE_EDIT_DEFAULTS);
    const conflicts = findEditConflicts(edited, baseRow || {}, currentRow, OBSTACLE_EDIT_DEFAULTS);
    const payload = { ...currentRow };
    Object.entries(edited).forEach(([field, value]) => {
        payload[field] = field === 'eliminated' ? !!value : (field === 'comment' ? String(value ?? '') : toNumber(value, 0));
    });
    return { edited, conflicts, payload, current: currentRow };
}

// Where a correction comes from (optional, besides the free-text reason)
export const CORRECTION_REFERENCE_TYPES = {
    protest: 'Protest nr',
    groundJury: 'Domarjurybeslut',
    judgeRequest: 'Domarens begäran'
};

/**
 * The reason saved with a secretariat correction: a free text is required,
 * the reference (protest number, ground jury decision, judge's request) is
 * optional. Throws with a Swedish message when the reason is missing.
 */
export function buildCorrectionReason({ reason = '', referenceType = '', referenceValue = '' } = {}) {
    const text = String(reason || '').trim().slice(0, 1000);
    if (!text) throw new Error('Ange en orsak till korrigeringen.');
    const type = String(referenceType || '').trim();
    const value = String(referenceValue || '').trim().slice(0, 200);
    const reference = type && CORRECTION_REFERENCE_TYPES[type] ? { type, value } : null;
    return { reason: text, reference };
}

/** The correction reason as one line (finalization log, messages) */
export function formatCorrectionReason(correction = {}) {
    const reason = String(correction?.reason || '').trim();
    const ref = correction?.reference;
    if (!ref || !CORRECTION_REFERENCE_TYPES[ref.type]) return reason;
    const label = `${CORRECTION_REFERENCE_TYPES[ref.type]}${ref.value ? ` ${ref.value}` : ''}`;
    return reason ? `${reason} (${label})` : label;
}
