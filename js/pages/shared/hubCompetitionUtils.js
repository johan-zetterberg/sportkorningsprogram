// The public hub: when a competition is (live, today, upcoming, finished) and
// the order visitors see them in. Pure: the hub page renders the result.

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/g;

function toDayString(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        const match = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
        return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
    }
    const seconds = value?.seconds ?? null;
    const date = seconds != null ? new Date(seconds * 1000) : (value instanceof Date ? value : null);
    if (!date || isNaN(date.getTime())) return '';
    return localDayString(date);
}

/** "YYYY-MM-DD" of a date in local time */
export function localDayString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * The first and last day of a competition ("YYYY-MM-DD"), from dates as a
 * string ("2026-05-01 – 2026-05-03"), an object { start, end } or
 * startDate/endDate. Empty strings when unknown.
 */
export function competitionDateRange(comp = {}) {
    const dates = comp?.dates;
    if (dates && typeof dates === 'object' && !Array.isArray(dates)) {
        const start = toDayString(dates.start) || toDayString(dates.end);
        const end = toDayString(dates.end) || start;
        return { start, end };
    }
    const text = String(dates || comp?.date || '');
    const found = text.match(ISO_DATE) || [];
    let start = found[0] || toDayString(comp?.startDate);
    let end = found[found.length - 1] || toDayString(comp?.endDate) || start;
    if (start && end && end < start) [start, end] = [end, start];
    return { start: start || '', end: end || '' };
}

/**
 * 'live' (on today, live mode), 'today' (on today, field mode: results come
 * in later), 'upcoming', 'finished' or 'unknown' (no dates).
 */
export function competitionTimeStatus(comp = {}, today = localDayString()) {
    if (comp?.archived === true || comp?.locked === true) return 'finished';
    const { start, end } = competitionDateRange(comp);
    if (!start) return 'unknown';
    if (today < start) return 'upcoming';
    if (today > end) return 'finished';
    return comp?.competitionMode === 'field' ? 'today' : 'live';
}

const STATUS_ORDER = { live: 0, today: 1, upcoming: 2, unknown: 3, finished: 4 };

/**
 * Competitions in the order a visitor wants them: on now first, then the
 * next ones (soonest first), then finished ones (latest first).
 */
export function sortCompetitionsForVisitors(comps = [], today = localDayString()) {
    return (Array.isArray(comps) ? comps : [])
        .map(comp => ({ comp, status: competitionTimeStatus(comp, today), range: competitionDateRange(comp) }))
        .sort((a, b) => {
            const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
            if (byStatus) return byStatus;
            if (a.status === 'finished') return (b.range.end || '').localeCompare(a.range.end || '');
            return (a.range.start || '9999').localeCompare(b.range.start || '9999');
        });
}

/** A visitor's search: name, place, club or dates contain the text */
export function matchesCompetitionSearch(comp = {}, query = '') {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const dates = typeof comp.dates === 'string' ? comp.dates : Object.values(comp.dates || {}).join(' ');
    return [comp.name, comp.place, comp.club, dates, comp.date]
        .some(value => String(value || '').toLowerCase().includes(q));
}
