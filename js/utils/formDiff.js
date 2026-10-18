// Admin forms are filled from the stored document once, when they open. Saving
// the whole form would write the values of that moment back over what another
// admin (or the vet, the speaker, a server function) saved meanwhile. These
// helpers keep a save to the fields changed in the form, and find the ones that
// were also changed underneath, so the page can ask before overwriting them.

const isPlainObject = (value) => value !== null && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isNumberLike = (value) => value !== '' && value !== null && value !== undefined
    && typeof value !== 'boolean' && Number.isFinite(Number(value));

/**
 * Whether two stored/form values are the same: numbers and numeric strings by
 * value, empty, null and missing alike, arrays by item and plain objects by
 * key (a missing key as empty).
 */
export function sameFormValue(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
        const left = Array.isArray(a) ? a : (a == null || a === '' ? [] : null);
        const right = Array.isArray(b) ? b : (b == null || b === '' ? [] : null);
        if (!left || !right || left.length !== right.length) return false;
        return left.every((item, index) => sameFormValue(item, right[index]));
    }
    if (isPlainObject(a) || isPlainObject(b)) {
        const left = isPlainObject(a) ? a : (a == null || a === '' ? {} : null);
        const right = isPlainObject(b) ? b : (b == null || b === '' ? {} : null);
        if (!left || !right) return false;
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        return [...keys].every(key => sameFormValue(left[key], right[key]));
    }
    if (typeof a === 'boolean' || typeof b === 'boolean') {
        return (a ?? false) === (b ?? false);
    }
    if (isNumberLike(a) && isNumberLike(b)) {
        return Math.abs(Number(a) - Number(b)) < 1e-9;
    }
    return String(a ?? '') === String(b ?? '');
}

const valueOf = (source, field, defaults) => source?.[field] ?? defaults[field];

/**
 * The fields whose form value differs from the value the form was loaded with.
 * `fields` defaults to the keys of `formValues`.
 */
export function diffFormFields(formValues = {}, loaded = {}, { fields, defaults = {} } = {}) {
    const changed = {};
    (fields || Object.keys(formValues)).forEach((field) => {
        if (!(field in formValues)) return;
        if (!sameFormValue(formValues[field], valueOf(loaded, field, defaults))) {
            changed[field] = formValues[field];
        }
    });
    return changed;
}

/**
 * Changed fields that were also changed in the stored document after the form
 * was loaded (to something else than this form saves). Without the stored
 * document (`current` null, e.g. offline) there is nothing to compare.
 */
export function findFormConflicts(changed = {}, loaded = {}, current = null, { defaults = {} } = {}) {
    if (!current) return [];
    return Object.keys(changed).filter((field) => {
        const now = valueOf(current, field, defaults);
        return !sameFormValue(valueOf(loaded, field, defaults), now)
            && !sameFormValue(changed[field], now);
    });
}

/** The changed fields and their conflicts, for one save */
export function planFormSave(formValues = {}, loaded = {}, current = null, options = {}) {
    const changes = diffFormFields(formValues, loaded, options);
    const conflicts = findFormConflicts(changes, loaded, current, options);
    return { changes, conflicts };
}

/**
 * Form fields with a value whose stored value is missing: the form showed a
 * default for them, which the save should store as before (other pages may
 * not know the default).
 */
export function unstoredFormFields(formValues = {}, stored = {}) {
    const fields = {};
    Object.entries(formValues).forEach(([field, value]) => {
        const storedValue = stored?.[field];
        if ((storedValue === undefined || storedValue === null) && value !== undefined && value !== null && value !== '') {
            fields[field] = value;
        }
    });
    return fields;
}

const ROW_KEY_SEPARATOR = '\u001f';

/** { row: { field: value } } as flat fields (e.g. per-class settings) */
export function flattenFormRows(rows = {}) {
    const flat = {};
    Object.entries(rows || {}).forEach(([row, values]) => {
        Object.entries(values || {}).forEach(([field, value]) => {
            flat[`${row}${ROW_KEY_SEPARATOR}${field}`] = value;
        });
    });
    return flat;
}

/** Flat fields back to { row: { field: value } } */
export function unflattenFormRows(flat = {}) {
    const rows = {};
    Object.entries(flat || {}).forEach(([key, value]) => {
        const index = key.lastIndexOf(ROW_KEY_SEPARATOR);
        if (index < 0) return;
        const row = key.slice(0, index);
        (rows[row] ||= {})[key.slice(index + 1)] = value;
    });
    return rows;
}

/** A flat row field as "field (row)" for the conflict question */
export function formRowFieldLabel(key, fieldLabels = {}) {
    const index = key.lastIndexOf(ROW_KEY_SEPARATOR);
    if (index < 0) return fieldLabels[key] || key;
    const field = key.slice(index + 1);
    return `${fieldLabels[field] || field} (${key.slice(0, index)})`;
}

/** The question before overwriting someone else's changes (Swedish UI text) */
export function formConflictMessage(conflicts = [], labels = {}) {
    const names = conflicts.map(field => labels[field] || field);
    const list = names.length > 1
        ? `${names.slice(0, -1).join(', ')} och ${names[names.length - 1]}`
        : (names[0] || '');
    return `Någon annan har ändrat ${list} sedan du öppnade formuläret. Skriva över med dina värden?`;
}
