// Role codes and join links for officials (Admin > Inställningar). The code
// rules match functions/src/adminJoin.js (tests/official-access.test.js
// checks they agree): 10 symbols without look-alikes (no 0/O/1/I), shown
// grouped by four, typed in any case with or without dashes.

export const ROLE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROLE_CODE_LENGTH = 10;
export const PIN_JOIN_ROLES = ['dressage', 'marathon', 'precision', 'speaker', 'vet', 'td'];

export const ROLE_CODE_LABELS = {
    admin: 'Admin (gammal PIN-anslutning)',
    dressage: 'Dressyr',
    marathon: 'Maraton',
    precision: 'Precision',
    speaker: 'Speaker',
    vet: 'Veterinär',
    td: 'TD / Domarkollegium'
};

export function roleCodeField(role) {
    return role === 'admin' ? 'accessCode' : `accessCode_${role}`;
}

export function normalizeRoleCode(value) {
    return typeof value === 'string' ? value.replace(/[\s-]+/g, '').toUpperCase() : '';
}

export function formatRoleCode(value) {
    const code = normalizeRoleCode(value);
    return code.match(/.{1,4}/g)?.join('-') || '';
}

export function isStrongRoleCode(value) {
    const code = normalizeRoleCode(value);
    return code.length >= 10 && code.length <= 12
        && [...code].every((ch) => ROLE_CODE_ALPHABET.includes(ch));
}

// randomValues(Uint8Array) fills the array (crypto.getRandomValues)
export function generateRoleCode(randomValues = (arr) => crypto.getRandomValues(arr), length = ROLE_CODE_LENGTH) {
    const bytes = new Uint8Array(length);
    randomValues(bytes);
    let code = '';
    for (let i = 0; i < length; i++) code += ROLE_CODE_ALPHABET[bytes[i] % ROLE_CODE_ALPHABET.length];
    return code;
}

// The roles whose stored code is missing or an old short PIN
export function rolesNeedingNewCode(secrets = {}) {
    return PIN_JOIN_ROLES.filter((role) => !isStrongRoleCode(secrets?.[roleCodeField(role)]));
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function isoDay(date) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * The first and last day in a competition's free-text dates
 * ("2026-05-15 - 2026-05-17", "2026-05-15"), as YYYY-MM-DD, or null.
 */
export function parseCompetitionDateRange(dates) {
    const found = [...String(dates || '').matchAll(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g)]
        .map((m) => {
            const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
            return date.getUTCDate() === Number(m[3]) ? date : null;
        })
        .filter(Boolean)
        .sort((a, b) => a - b);
    if (!found.length) return null;
    return { start: isoDay(found[0]), end: isoDay(found[found.length - 1]) };
}

// The competition's days (at most 14), for the volunteers' availability
export function competitionDays(dates, maxDays = 14) {
    const range = parseCompetitionDateRange(dates);
    if (!range) return [];
    const days = [];
    const day = new Date(`${range.start}T00:00:00Z`);
    const end = new Date(`${range.end}T00:00:00Z`);
    while (day <= end && days.length < maxDays) {
        days.push(isoDay(day));
        day.setUTCDate(day.getUTCDate() + 1);
    }
    return days;
}

// Default last day for the codes: the day after the competition ends ('' without dates)
export function defaultCodeExpiryDate(dates) {
    const range = parseCompetitionDateRange(dates);
    if (!range) return '';
    const day = new Date(`${range.end}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1);
    return isoDay(day);
}

/**
 * The link that opens Min Portal with the code dialog for one role and the
 * competition filled in: <base>index.html?id=<comp>#portal?join=<role>
 */
export function buildRoleJoinLink(baseUrl, competitionId, role) {
    const base = String(baseUrl || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    return `${base}index.html?id=${encodeURIComponent(competitionId)}#portal?join=${encodeURIComponent(role)}`;
}

/** The join request in the current URL: { competitionId, role } or null */
export function readJoinRequest(locationLike) {
    try {
        const hash = String(locationLike?.hash || '');
        const hashParams = new URLSearchParams(hash.split('?')[1] || '');
        const role = hashParams.get('join');
        if (!role || !PIN_JOIN_ROLES.includes(role)) return null;
        const searchParams = new URLSearchParams(String(locationLike?.search || ''));
        const competitionId = hashParams.get('id') || searchParams.get('id') || '';
        return { competitionId: /^[A-Za-z0-9_-]{1,128}$/.test(competitionId) ? competitionId : '', role };
    } catch {
        return null;
    }
}
