// Officials: name, role and assignments are read by every competition role
// (officials/{id}); contact details are only for admins and the official
// themselves (officialsPrivate/{id}, see firestore.rules).

export const OFFICIAL_PRIVATE_FIELDS = Object.freeze([
    'email', 'phone', 'mobile', 'iceName', 'icePhone', 'diet', 'shirtSize', 'notes', 'address'
]);

const PRIVATE_SET = new Set(OFFICIAL_PRIVATE_FIELDS);

/** { publicData, privateData } for a write; email lower-cased */
export function splitOfficialData(data = {}) {
    const publicData = {};
    const privateData = {};
    Object.entries(data || {}).forEach(([key, value]) => {
        if (value === undefined) return;
        if (PRIVATE_SET.has(key)) {
            privateData[key] = key === 'email' ? String(value || '').trim().toLowerCase() : value;
        } else {
            publicData[key] = value;
        }
    });
    return { publicData, privateData };
}

/** Officials with their private part (where readable) merged in, by id */
export function mergeOfficials(publicList = [], privateList = []) {
    const privateById = new Map((privateList || []).map(p => [String(p.id), p]));
    return (publicList || []).map((official) => {
        const extra = privateById.get(String(official.id));
        if (!extra) return official;
        const { id, ...fields } = extra;
        return { ...official, ...fields, id: official.id };
    });
}

/** Private fields still stored on the public document (from before the split) */
export function legacyPrivateFields(data = {}) {
    return OFFICIAL_PRIVATE_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(data || {}, key));
}
