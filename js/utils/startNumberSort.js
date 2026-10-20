// Start numbers in numeric order everywhere: 1, 2, 3, 10, 11 — not the text
// order 1, 10, 11, 2 that localeCompare / String sorting gives. Numbers with
// a suffix ("12a") come right after their number; anything non-numeric last.

function startNumberParts(value) {
    const text = String(value ?? '').trim();
    const m = text.match(/^(\d+)(.*)$/);
    if (!m) return { num: Infinity, rest: text };
    return { num: Number(m[1]), rest: m[2] };
}

/** Comparator for two start numbers (strings or numbers), ascending */
export function compareStartNumbers(a, b) {
    const pa = startNumberParts(a);
    const pb = startNumberParts(b);
    if (pa.num !== pb.num) return pa.num < pb.num ? -1 : 1;
    return pa.rest.localeCompare(pb.rest, 'sv', { numeric: true });
}

/**
 * Start-time order (ms; missing times last), ties and rows without a time in
 * numeric start-number order. For "next to start" lists.
 */
export function compareByTimeThenStartNumber(timeA, timeB, startNumberA, startNumberB) {
    const a = Number.isFinite(timeA) ? timeA : Infinity;
    const b = Number.isFinite(timeB) ? timeB : Infinity;
    if (a !== b) return a < b ? -1 : 1;
    return compareStartNumbers(startNumberA, startNumberB);
}

/** Comparator for rows with a startNumber field, ascending */
export function byStartNumber(a, b) {
    return compareStartNumbers(a?.startNumber, b?.startNumber);
}
