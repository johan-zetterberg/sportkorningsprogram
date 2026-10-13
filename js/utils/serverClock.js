// Server time for timestamps that other devices compare with their own: a
// marathon section started on one phone and stopped on another would
// otherwise carry the difference between the two phones' clocks.
//
// The offset to the server is measured with a small callable (a few round
// trips, the fastest one wins) and remembered on the device, so it is also
// used offline. Without any measurement the device clock is used as before.

const STORAGE_KEY = 'serverClockOffset';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;   // a remembered offset older than this is not used
const RESYNC_MS = 10 * 60 * 1000;
const MAX_ROUND_TRIP_MS = 3000;           // slower answers are too imprecise
const SAMPLES = 3;

let offsetMs = 0;          // the offset serverNow() uses
let measuredOffsetMs = null; // the latest measurement, held back while timing
let holdOffset = false;
let syncTimer = null;
let syncing = null;

try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Number.isFinite(saved.offsetMs) && Date.now() - saved.measuredAt < MAX_AGE_MS) {
        offsetMs = saved.offsetMs;
    }
} catch (_) { /* no storage */ }

/** Current time in milliseconds, corrected to the server's clock */
export function serverNow() {
    return Date.now() + offsetMs;
}

export function getServerClockOffset() {
    return offsetMs;
}

/**
 * While a stopwatch runs on this device the offset must not change: start and
 * stop would be stamped with different corrections and the duration would
 * absorb the difference. A measurement made meanwhile is applied on release.
 */
/** A new measurement: used at once, or after the hold is released */
export function applyMeasuredOffset(measured) {
    if (!Number.isFinite(measured)) return;
    measuredOffsetMs = measured;
    if (!holdOffset) offsetMs = measured;
}

export function setServerClockHold(hold) {
    holdOffset = !!hold;
    if (!holdOffset && Number.isFinite(measuredOffsetMs)) offsetMs = measuredOffsetMs;
}

/**
 * The best offset from samples of { sentAt, receivedAt, serverMs }: the one
 * with the shortest round trip, assuming the answer was made halfway.
 */
export function offsetFromSamples(samples = []) {
    const usable = samples
        .filter((s) => Number.isFinite(s?.serverMs) && Number.isFinite(s?.sentAt) && Number.isFinite(s?.receivedAt))
        .map((s) => ({ ...s, roundTrip: s.receivedAt - s.sentAt }))
        .filter((s) => s.roundTrip >= 0 && s.roundTrip <= MAX_ROUND_TRIP_MS)
        .sort((a, b) => a.roundTrip - b.roundTrip);
    if (usable.length === 0) return null;
    const best = usable[0];
    return Math.round(best.serverMs - (best.sentAt + best.roundTrip / 2));
}

async function measure() {
    const [{ functions }, { httpsCallable }] = await Promise.all([
        import('../config/firebase-config.js'),
        import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js')
    ]);
    const getServerTime = httpsCallable(functions, 'getServerTime');
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
        const sentAt = Date.now();
        try {
            const result = await getServerTime();
            samples.push({ sentAt, receivedAt: Date.now(), serverMs: Number(result?.data?.now) });
        } catch (error) {
            if (i === 0) throw error;
        }
    }
    return offsetFromSamples(samples);
}

/** Measures the offset now (one measurement at a time) */
export function syncServerClock() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(offsetMs);
    if (!syncing) {
        syncing = measure()
            .then((measured) => {
                if (Number.isFinite(measured)) {
                    applyMeasuredOffset(measured);
                    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ offsetMs: measured, measuredAt: Date.now() })); } catch (_) { }
                }
                return offsetMs;
            })
            .catch((error) => {
                console.warn('[serverClock] Kunde inte mäta serverns klocka; enhetens klocka används.', error?.message || error);
                return offsetMs;
            })
            .finally(() => { syncing = null; });
    }
    return syncing;
}

/** Keeps the offset measured while a timing page is open */
export function startServerClockSync() {
    syncServerClock();
    if (!syncTimer) {
        syncTimer = setInterval(syncServerClock, RESYNC_MS);
        if (typeof window !== 'undefined') window.addEventListener('online', syncServerClock);
    }
}

export function stopServerClockSync() {
    setServerClockHold(false);
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    if (typeof window !== 'undefined') window.removeEventListener('online', syncServerClock);
}
