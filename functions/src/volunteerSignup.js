// Volunteer sign-up (submitVolunteerSignup): the stored payload, the light
// anti-bot checks and the answer to the sign-up form. No Firebase imports, so
// the tests run without emulators.

export const VOLUNTEER_DIET_OPTIONS = ['Ingen', 'Vegetarisk', 'Vegansk', 'Glutenfri', 'Laktosfri', 'Annat'];
// A form sent sooner than this after the page loaded is taken for a bot
export const VOLUNTEER_MIN_FILL_MS = 3000;
// Earlier sign-ups with the same email inside this window mark a new one as a
// possible duplicate (shown to the admin, never told to the sender)
export const VOLUNTEER_DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_NOTES_LENGTH = 500;
const MAX_AVAILABILITY = 28;

export class VolunteerSignupError extends Error {}

export function normalizeSignupText(value, maxLength = 160) {
    return String(value || '')
        .replace(/[<>"'`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

export function isValidSignupEmail(value) {
    return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(String(value || ''));
}

// Days or shifts the volunteer can help: "YYYY-MM-DD" or "YYYY-MM-DD_fm|em|heldag"
function normalizeAvailability(value) {
    const list = Array.isArray(value) ? value : [];
    const valid = list
        .map((item) => String(item || '').trim())
        .filter((item) => /^\d{4}-\d{2}-\d{2}(_(fm|em|heldag))?$/.test(item));
    return [...new Set(valid)].slice(0, MAX_AVAILABILITY);
}

/**
 * The document stored for a sign-up. Throws VolunteerSignupError with a
 * Swedish message for missing or invalid fields.
 */
export function buildVolunteerSignupPayload(raw = {}, now = Date.now()) {
    const dietChoice = VOLUNTEER_DIET_OPTIONS.includes(raw.diet) ? raw.diet : '';
    const payload = {
        name: normalizeSignupText(raw.name, 120),
        phone: normalizeSignupText(raw.phone, 40),
        email: normalizeSignupText(raw.email, 200).toLowerCase(),
        club: normalizeSignupText(raw.club, 120),
        shirtSize: normalizeSignupText(raw.shirtSize, 10),
        // A choice from the list; "Annat" with a short text of its own
        diet: dietChoice,
        dietOther: dietChoice === 'Annat' ? normalizeSignupText(raw.dietOther, 80) : '',
        availability: normalizeAvailability(raw.availability),
        iceName: normalizeSignupText(raw.iceName, 120),
        icePhone: normalizeSignupText(raw.icePhone, 40),
        role: normalizeSignupText(raw.role, 80),
        notes: normalizeSignupText(raw.notes, MAX_NOTES_LENGTH),
        consent: raw.consent === true,
        consentAt: now,
        status: 'new',
        createdAt: now
    };

    if (!payload.name || !payload.phone || !payload.email || !payload.iceName || !payload.icePhone) {
        throw new VolunteerSignupError('Obligatoriska fält saknas.');
    }
    if (!isValidSignupEmail(payload.email)) {
        throw new VolunteerSignupError('Ogiltig e-postadress.');
    }
    if (!payload.consent) {
        throw new VolunteerSignupError('Du behöver godkänna att arrangören sparar uppgifterna.');
    }
    return payload;
}

/**
 * Light anti-bot checks without App Check: the hidden field (website) must be
 * empty and the form must have been open at least VOLUNTEER_MIN_FILL_MS
 * (elapsedMs, measured by the page). A bot gets the normal answer and nothing
 * is stored.
 */
export function isLikelyBotSignup(raw = {}) {
    if (String(raw.website || '').trim()) return true;
    const elapsed = Number(raw.elapsedMs);
    return !Number.isFinite(elapsed) || elapsed < VOLUNTEER_MIN_FILL_MS;
}

// Whether earlier sign-ups ({ createdAt }) with the same email are recent
export function hasRecentSignup(earlier = [], now = Date.now(), windowMs = VOLUNTEER_DUPLICATE_WINDOW_MS) {
    return earlier.some((item) => Number(item?.createdAt || 0) >= now - windowMs);
}

// The answer to the form: the same whether the email had signed up before,
// was ignored as a bot or was stored, so the form tells nobody who signed up
export function volunteerSignupResponse() {
    return { accepted: true };
}
