// A complete copy of one competition as JSON (exportCompetition): every
// document under the competition's public tree, its private tree and the
// finalization tree, as { path, data }. Firestore types are written so a
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
