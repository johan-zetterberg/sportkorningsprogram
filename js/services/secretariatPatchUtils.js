// Secretariat edits are made on rows loaded once. Saving the whole row would
// write back values a judge has changed since then, so only the fields the
// secretariat actually edited are saved, and an edit of a field the judge
// changed meanwhile is refused instead of silently overwriting it.

const sameValue = (a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (a !== '' && b !== '' && a != null && b != null && Number.isFinite(na) && Number.isFinite(nb)) {
        return Math.abs(na - nb) < 1e-9;
    }
    return String(a ?? '') === String(b ?? '');
};

/** The fields in `fields` whose value in `patch` differs from the loaded row */
export function pickEditedFields(patch = {}, baseRow = {}, fields = [], defaults = {}) {
    const edited = {};
    fields.forEach((field) => {
        if (!(field in patch)) return;
        const before = baseRow[field] ?? defaults[field];
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
        const loaded = baseRow[field] ?? defaults[field];
        const now = current?.[field] ?? defaults[field];
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

/** A result that is still being timed must not be saved over or finalized */
export function isStillRunning(doc = {}) {
    return doc?.running === true || !!doc?.runningStage;
}
