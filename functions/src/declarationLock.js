// When the driver portal's declaration (groom, carriage, horses, …) is locked.
// The portal shows the same rules; the server enforces them, since a driver
// could otherwise change the declaration with the callable at any time.

const COMPETITION_TIME_ZONE = 'Europe/Stockholm';
const DEFAULT_LOCKDOWN_MINUTES = 60;

/**
 * Start times are stored as local wall time without a zone ("2026-10-13T09:00",
 * from the admin's browser in Sweden). Read them in the competition's time
 * zone; a string with Z or an offset is read as it says.
 */
export function parseCompetitionLocalTime(value, timeZone = COMPETITION_TIME_ZONE) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    const text = String(value).trim();
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
        const ms = Date.parse(text);
        return Number.isFinite(ms) ? ms : null;
    }
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
    // The zone's offset at that moment (summer time included)
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const asLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    return guess - (asLocal - guess);
}

// Start-time keys per discipline ("maraton" is an older alias of "marathon")
const START_TIME_DISCIPLINE_OF = { dressage: 'dressage', marathon: 'marathon', maraton: 'marathon', precision: 'precision' };

/**
 * The equipage's start times that count for the lock: only disciplines whose
 * start list the admin has published (config/startTimes.published.<discipline>).
 * Unpublished times are a draft the driver cannot see, so they do not lock.
 * Same rule as js/utils/publishedStartTimes.js on the client.
 */
export function publishedStartTimeValues(startTimes = {}, startNumber) {
    const times = startTimes?.times && typeof startTimes.times === 'object' ? startTimes.times : (startTimes?.value?.times || {});
    const published = startTimes?.published || startTimes?.value?.published || {};
    const row = times?.[String(startNumber)] || {};
    return Object.entries(row && typeof row === 'object' ? row : {})
        .filter(([key]) => {
            const discipline = START_TIME_DISCIPLINE_OF[String(key).toLowerCase()];
            return !!discipline && (published[discipline] === true || (discipline === 'marathon' && published.maraton === true));
        })
        .map(([, value]) => value);
}

/**
 * Why the declaration is locked, or null when it may be changed:
 * the competition is archived, the secretariat locked the portal, or the
 * equipage's first published start is less than lockdownMinutes away (or has passed).
 */
export function declarationLockReason({ competition = {}, meta = {}, startTimes = {}, startNumber, now = Date.now() } = {}) {
    if (competition?.locked === true || competition?.status === 'completed') return 'archived';
    if (meta?.manualLockdown === true) return 'manual';
    const starts = publishedStartTimeValues(startTimes, startNumber)
        .map((value) => parseCompetitionLocalTime(value)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!starts.length) return null;
    // Missing or empty = the default (Number('') and Number(null) are 0, which
    // would turn the lock off); as js/utils/lockdownMinutes.js
    const raw = meta?.lockdownMinutes;
    const isUnset = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
    const lockdownMinutes = !isUnset && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : DEFAULT_LOCKDOWN_MINUTES;
    return (starts[0] - now) / 60000 < lockdownMinutes ? 'time' : null;
}
