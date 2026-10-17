// A complete copy of one competition as JSON (exportCompetition): every
// document under the competition's public tree, its private tree and the
// finalization tree, as { path, data }, without access PINs and (unless asked
// for) personal identity numbers (redactExportDocuments). Firestore types are written so a
// restore can recreate them: { __type: 'timestamp', ms }, { __type:
// 'geopoint', lat, lng }, { __type: 'ref', path }, and numbers JSON cannot
// hold (a stored Infinity penalty) as { __type: 'number', value: 'Infinity' }.

export const EXPORT_FORMAT = 'drivelive-competition-export';
export const EXPORT_FORMAT_VERSION = 1;

export function toExportValue(value) {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value === 'number' && !Number.isFinite(value)) return { __type: 'number', value: String(value) };
    if (Array.isArray(value)) return value.map(toExportValue);
    if (typeof value !== 'object') return value;
    if (typeof value.toMillis === 'function' && typeof value.seconds === 'number') {
        return { __type: 'timestamp', ms: value.toMillis() };
    }
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && Object.keys(value).length <= 2) {
        return { __type: 'geopoint', lat: value.latitude, lng: value.longitude };
    }
    if (typeof value.path === 'string' && typeof value.collection === 'function' && value.firestore) {
        return { __type: 'ref', path: value.path };
    }
    if (typeof value.toBase64 === 'function') {
        return { __type: 'bytes', base64: value.toBase64() };
    }
    const out = {};
    Object.entries(value).forEach(([key, v]) => { out[key] = toExportValue(v); });
    return out;
}

// Access PINs and other secrets are never exported: whole documents by path,
// fields by name wherever they are (also nested and in archive copies)
const SECRET_DOCUMENT_PATTERNS = [/\/config\/secrets$/];
const SECRET_FIELD_PATTERNS = [
    /^accessCode(_|$)/i,
    /^(pin|pinCode|pinHash|password|passwordHash|secret|secrets|token|apiKey|privateKey)$/i
];
// Swedish personal identity numbers: only when the admin chooses to include them
const PERSONAL_NUMBER_FIELDS = new Set(['ssn', 'driverssn', 'personnummer', 'personalnumber', 'personnumber']);

function isSecretField(key) {
    return SECRET_FIELD_PATTERNS.some(pattern => pattern.test(key));
}

function isPersonalNumberField(key) {
    return PERSONAL_NUMBER_FIELDS.has(String(key).toLowerCase());
}

function redactValue(value, fieldPath, options, removed) {
    if (Array.isArray(value)) {
        return value.map((item, index) => redactValue(item, `${fieldPath}[${index}]`, options, removed));
    }
    if (!value || typeof value !== 'object' || typeof value.__type === 'string') return value;
    const out = {};
    Object.entries(value).forEach(([key, v]) => {
        const path = fieldPath ? `${fieldPath}.${key}` : key;
        if (isSecretField(key)) {
            removed.push({ field: path, reason: 'secret' });
            return;
        }
        if (!options.includePersonalNumbers && isPersonalNumberField(key)) {
            removed.push({ field: path, reason: 'personalNumber' });
            return;
        }
        out[key] = redactValue(v, path, options, removed);
    });
    return out;
}

/**
 * Removes secrets (always) and personal identity numbers (unless
 * includePersonalNumbers) from exported { path, data } documents. Returns the
 * kept documents and what was removed: { path, reason } for a whole document,
 * { path, field, reason } for a field.
 */
export function redactExportDocuments(documents = [], { includePersonalNumbers = false } = {}) {
    const options = { includePersonalNumbers: includePersonalNumbers === true };
    const redacted = [];
    const kept = [];
    documents.forEach(({ path, data }) => {
        if (SECRET_DOCUMENT_PATTERNS.some(pattern => pattern.test(path))) {
            redacted.push({ path, reason: 'secret' });
            return;
        }
        const removed = [];
        const clean = redactValue(data, '', options, removed);
        removed.forEach(entry => redacted.push({ path, ...entry }));
        kept.push({ path, data: clean });
    });
    return { documents: kept, redacted };
}

/**
 * Every document at or under docRef, including documents below a parent that
 * has no data of its own (e.g. dressage/{sn}/protocols). Stops with an error
 * past maxDocuments, so a runaway export cannot exhaust the function.
 */
export async function collectDocuments(docRef, { maxDocuments = 50000, out = [] } = {}) {
    const snap = await docRef.get();
    if (snap.exists) out.push({ path: docRef.path, data: toExportValue(snap.data()) });
    if (out.length > maxDocuments) throw new Error(`Fler än ${maxDocuments} dokument`);
    const collections = await docRef.listCollections();
    for (const collection of collections) {
        const refs = await collection.listDocuments();
        for (const ref of refs) {
            await collectDocuments(ref, { maxDocuments, out });
        }
    }
    return out;
}
