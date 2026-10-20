// Time values as they arrive from Firestore and the app: Timestamps
// (toMillis/toDate), plain {seconds, nanoseconds} objects (cached or
// serialised Timestamps, also _seconds from the Admin SDK), Dates, ms numbers
// and ISO / local date-time strings. new Date(value) gives "Invalid Date" for
// most of these, and String(value) shows "Timestamp(seconds=…)".

/** Milliseconds since the epoch, or null when the value is not a time. */
export function timeValueToMs(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === 'object') {
        try {
            if (typeof value.toMillis === 'function') {
                const ms = Number(value.toMillis());
                return Number.isFinite(ms) ? ms : null;
            }
            if (typeof value.toDate === 'function') {
                const ms = value.toDate()?.getTime?.();
                return Number.isFinite(ms) ? ms : null;
            }
        } catch (_) {
            return null;
        }
        const seconds = typeof value.seconds === 'number' ? value.seconds
            : (typeof value._seconds === 'number' ? value._seconds : null);
        if (seconds !== null && Number.isFinite(seconds)) {
            const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
            return seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1e6) : 0);
        }
        return null;
    }
    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return null;
        // "2026-10-13 09:00" (space instead of T) is read as local time too
        const ms = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(text) ? text.replace(' ', 'T') : text).getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    return null;
}

/**
 * Clock time "HH:MM" (24 h) for a time value; "HH:MM" strings are kept as
 * they are. Anything that is not a time gives the fallback, never the raw
 * object text.
 */
export function formatClockTime(value, { fallback = '—', seconds = false, locale = 'sv-SE' } = {}) {
    if (value == null || value === '') return fallback;
    const clock = typeof value === 'string' ? value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/) : null;
    if (clock) {
        const [, hh, mm, ss] = clock;
        return `${hh.padStart(2, '0')}:${mm}${seconds && ss ? `:${ss}` : ''}`;
    }
    const ms = timeValueToMs(value);
    if (ms === null) return fallback;
    const options = { hour: '2-digit', minute: '2-digit', hour12: false };
    if (seconds) options.second = '2-digit';
    return new Date(ms).toLocaleTimeString(locale, options);
}
