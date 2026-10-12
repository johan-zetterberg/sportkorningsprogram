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

/** A result that is still being timed must not be saved over or finalized */
export function isStillRunning(doc = {}) {
    return doc?.running === true || !!doc?.runningStage;
}
