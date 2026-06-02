export function normalizeOfficialTimestamp(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    if (Number.isFinite(value?.seconds)) {
        const millis = (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1_000_000);
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatOfficialCheckInTime(value, locale = undefined) {
    const date = normalizeOfficialTimestamp(value);
    if (!date) return '';
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
