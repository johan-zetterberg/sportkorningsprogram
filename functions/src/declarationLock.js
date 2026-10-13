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

/**
 * Why the declaration is locked, or null when it may be changed:
 * the competition is archived, the secretariat locked the portal, or the
 * equipage's first start is less than lockdownMinutes away (or has passed).
 */
export function declarationLockReason({ competition = {}, meta = {}, startTimes = {}, startNumber, now = Date.now() } = {}) {
    if (competition?.locked === true || competition?.status === 'completed') return 'archived';
    if (meta?.manualLockdown === true) return 'manual';
    const times = startTimes?.times && typeof startTimes.times === 'object' ? startTimes.times : (startTimes?.value?.times || {});
    const row = times?.[String(startNumber)] || {};
    const starts = Object.values(row).map((value) => parseCompetitionLocalTime(value)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!starts.length) return null;
    const lockdownMinutes = Number.isFinite(Number(meta?.lockdownMinutes)) ? Number(meta.lockdownMinutes) : DEFAULT_LOCKDOWN_MINUTES;
    return (starts[0] - now) / 60000 < lockdownMinutes ? 'time' : null;
}
