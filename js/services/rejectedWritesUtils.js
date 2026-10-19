// A write queued on a device without signal that the server refused when it
// was finally sent (typically: the result was finalized meanwhile). The
// device has moved on by then, so it records the refusal in the competition's
// rejectedWrites list, which the secretariat sees. Pure helpers, see
// rejectedWritesService.

export const REJECTED_WRITE_DISCIPLINES = ['dressage', 'marathon', 'precision'];
export const MAX_PAYLOAD_SUMMARY = 1000;

// Values worth showing; long lists and objects are shortened
function shortValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}...` : value;
    if (Array.isArray(value)) return `[${value.length}]`;
    if (typeof value?.toMillis === 'function') return new Date(value.toMillis()).toISOString();
    return '{...}';
}

/** The refused data as one short line, e.g. "timeInSeconds=41.2, knockdowns=1" */
export function summarizeRejectedPayload(payload) {
    if (payload === null || payload === undefined) return '';
    if (typeof payload === 'string') return payload.slice(0, MAX_PAYLOAD_SUMMARY);
    if (typeof payload !== 'object') return String(payload).slice(0, MAX_PAYLOAD_SUMMARY);
    const parts = Object.entries(payload)
        .filter(([key, value]) => value !== undefined && typeof value !== 'function' && !key.startsWith('__'))
        .map(([key, value]) => `${key}=${shortValue(value)}`);
    return parts.join(', ').slice(0, MAX_PAYLOAD_SUMMARY);
}

/**
 * The document stored in rejectedWrites (without reportedBy / reportedAt,
 * which the service adds). Throws on an unknown discipline or missing start
 * number, so a bad call fails loudly in development.
 */
export function buildRejectedWriteEntry({ discipline, startNumber, obstacle = null, payloadSummary = '', error = null, source = '' } = {}) {
    if (!REJECTED_WRITE_DISCIPLINES.includes(discipline)) throw new Error(`Okänd disciplin: ${discipline}`);
    const sn = String(startNumber ?? '').trim();
    if (!sn || sn.length > 20) throw new Error('Startnummer saknas.');
    const obstacleNumber = obstacle === null || obstacle === undefined || obstacle === '' ? null : Number(obstacle);
    const code = error?.code ?? (typeof error === 'string' ? error : null);
    return {
        discipline,
        startNumber: sn,
        obstacle: Number.isInteger(obstacleNumber) ? obstacleNumber : null,
        payloadSummary: summarizeRejectedPayload(payloadSummary),
        errorCode: code ? String(code).slice(0, 100) : null,
        source: String(source || '').slice(0, 100)
    };
}
