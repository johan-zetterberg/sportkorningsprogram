// Emergency information of a competition: the public part (alarm number,
// first aid point, who is on duty) in config/emergencyInfo and the phone
// numbers of named persons in the private emergencyPrivate/contacts, read by
// the competition's staff and drivers only (firestore.rules). Pure helpers.

export const DEFAULT_EMERGENCY_NUMBER = '112';
const PHONE_MAX = 40;
const TEXT_MAX = 200;

// The named persons: their name is public, their phone private
export const EMERGENCY_PERSONS = Object.freeze([
    { key: 'vet', nameField: 'vetName', phoneField: 'vetPhone', labelKey: 'emergency_vet' },
    { key: 'farrier', nameField: 'farrierName', phoneField: 'farrierPhone', labelKey: 'emergency_farrier' },
    { key: 'chiefSteward', nameField: 'chiefStewardName', phoneField: 'chiefStewardPhone', labelKey: 'emergency_chief_steward' },
    { key: 'safetyOfficer', nameField: 'safetyOfficerName', phoneField: 'safetyOfficerPhone', labelKey: 'emergency_safety_officer' }
]);

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A phone number as typed, kept readable: digits, +, spaces and dashes */
export function cleanPhone(value) {
    return clip(value, PHONE_MAX).replace(/[^\d+\-\s()]/g, '').trim();
}

/** tel: link for a phone number ('' when there are no digits) */
export function telHref(phone) {
    const digits = String(phone ?? '').replace(/[^\d+]/g, '');
    if (!/\d/.test(digits)) return '';
    // A + only at the start
    const normalized = digits.replace(/(?!^)\+/g, '');
    return `tel:${normalized}`;
}

/**
 * The admin form's values split into { publicDoc, privateDoc }: names and the
 * first aid point public, the persons' phones private.
 */
export function splitEmergencyInfo(form = {}) {
    const publicDoc = {
        enabled: form.enabled !== false,
        emergencyNumber: cleanPhone(form.emergencyNumber) || DEFAULT_EMERGENCY_NUMBER,
        firstAidPlace: clip(form.firstAidPlace, TEXT_MAX),
        firstAidPhone: cleanPhone(form.firstAidPhone)
    };
    const privateDoc = {};
    EMERGENCY_PERSONS.forEach(({ nameField, phoneField }) => {
        publicDoc[nameField] = clip(form[nameField], TEXT_MAX);
        privateDoc[phoneField] = cleanPhone(form[phoneField]);
    });
    return { publicDoc, privateDoc };
}

/**
 * What a card shows: { emergencyNumber, firstAid: { place, phone }, persons:
 * [{ key, labelKey, name, phone }] }. privateDoc is null for the public (no
 * phones of named persons then). Persons without name or phone are left out.
 */
export function buildEmergencyCard(publicDoc = {}, privateDoc = null) {
    const pub = publicDoc && typeof publicDoc === 'object' ? publicDoc : {};
    const priv = privateDoc && typeof privateDoc === 'object' ? privateDoc : {};
    const persons = EMERGENCY_PERSONS
        .map(({ key, nameField, phoneField, labelKey }) => ({
            key,
            labelKey,
            name: clip(pub[nameField], TEXT_MAX),
            phone: privateDoc ? cleanPhone(priv[phoneField]) : ''
        }))
        .filter((person) => person.name || person.phone);
    return {
        enabled: pub.enabled !== false,
        emergencyNumber: cleanPhone(pub.emergencyNumber) || DEFAULT_EMERGENCY_NUMBER,
        firstAid: { place: clip(pub.firstAidPlace, TEXT_MAX), phone: cleanPhone(pub.firstAidPhone) },
        persons,
        showsPrivate: !!privateDoc
    };
}
