// The global pause written from a device without (usable) connection. Such a
// device cannot run the pause transaction, and writing the whole pause log
// from its own copy could erase another official's entry. It writes one event
// instead (private pauseEvents/{eventId}: { type: 'start' | 'end', at, by,
// reason?, note?, where?, processed: false }), and the onPauseEventCreated
// trigger folds the competition's unprocessed events into
// config/globalStatus.pauseLog in a transaction: in the order they happened
// (`at`), each event once (processed), never removing an entry. The readers
// of pauseLog are unchanged. The entry shapes are those of
// js/utils/globalPauseUtils.js (buildPauseEntry, closePauseEntry).
//
// How an event is folded (pure: foldPauseEvents):
//   start  no open pause and nothing logged after `at` -> a new open pause.
//          An open pause already -> nothing (already paused). A pause or
//          resume logged after `at` (the device was offline while others
//          paused and resumed) -> nothing: the log is not rewritten afterwards.
//   end    an open pause that started at or before `at` -> closed at `at`.
//          Otherwise nothing (already resumed, or an end older than the pause).

export const PAUSE_EVENTS = 'pauseEvents';
export const PAUSE_EVENT_TYPES = ['start', 'end'];
const PAUSE_REASONS = ['accident', 'vet', 'course', 'weather', 'other'];
// Events folded per run (the rest on the next event or run)
export const PAUSE_EVENTS_PER_RUN = 200;

export const pauseEventsPath = (appId, compId) => `artifacts/${appId}/private/data/competitions/${compId}/${PAUSE_EVENTS}`;
export const globalStatusPath = (appId, compId) => `artifacts/${appId}/public/data/competitions/${compId}/config/globalStatus`;

const trimTo = (value, max) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);
const timeOf = (iso) => {
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
};

function actor(by) {
    if (!by || typeof by !== 'object' || !by.uid) return null;
    const out = { uid: trimTo(by.uid, 128) };
    const name = trimTo(by.name, 80);
    if (name) out.name = name;
    const role = trimTo(by.role, 40);
    if (role) out.role = role;
    return out;
}

/** An event as stored, checked: { id, type, at, atMs, by, reason, note, where } or null */
export function normalizePauseEvent(id, data = {}) {
    const type = String(data.type || '');
    const atMs = timeOf(data.at);
    if (!PAUSE_EVENT_TYPES.includes(type) || atMs === null) return null;
    return {
        id: String(id),
        type,
        at: new Date(atMs).toISOString(),
        atMs,
        by: actor(data.by),
        reason: PAUSE_REASONS.includes(data.reason) ? data.reason : 'other',
        note: trimTo(data.note, 200),
        where: trimTo(data.where, 60)
    };
}

/** Events in the order they happened (`at`, then id: the same order on every run) */
export function sortPauseEvents(events = []) {
    return [...events].sort((a, b) => (a.atMs - b.atMs) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
}

function openIndexOf(log) {
    return log.findIndex((p) => p && p.end == null);
}

function latestLoggedMs(log) {
    let latest = null;
    log.forEach((p) => {
        [p?.start, p?.end].forEach((iso) => {
            const ms = iso ? timeOf(iso) : null;
            if (ms !== null && (latest === null || ms > latest)) latest = ms;
        });
    });
    return latest;
}

/**
 * Folds checked events (normalizePauseEvent, any order) into a pause log.
 * -> { log, results: { [eventId]: 'started' | 'ended' | 'ignored-*' }, changed }
 * Earlier entries are kept as they are; nothing is removed.
 */
export function foldPauseEvents(pauseLog, events = []) {
    const log = list(pauseLog).map((p) => ({ ...p }));
    const results = {};
    let changed = false;
    sortPauseEvents(events.filter(Boolean)).forEach((event) => {
        const openIndex = openIndexOf(log);
        if (event.type === 'start') {
            if (openIndex !== -1) {
                results[event.id] = 'ignored-already-paused';
                return;
            }
            const latest = latestLoggedMs(log);
            if (latest !== null && event.atMs < latest) {
                results[event.id] = 'ignored-late';
                return;
            }
            const entry = { start: event.at, end: null, durationSec: null, reason: event.reason };
            if (event.note) entry.note = event.note;
            if (event.by) entry.by = event.by;
            if (event.where) entry.where = event.where;
            log.push(entry);
            results[event.id] = 'started';
            changed = true;
            return;
        }
        if (openIndex === -1) {
            results[event.id] = 'ignored-not-paused';
            return;
        }
        const open = log[openIndex];
        const startMs = timeOf(open.start);
        if (startMs !== null && event.atMs < startMs) {
            results[event.id] = 'ignored-before-start';
            return;
        }
        const closed = { ...open, end: event.at };
        closed.durationSec = startMs !== null ? Math.max(0, Math.round((event.atMs - startMs) / 1000)) : null;
        if (event.by) closed.endedBy = event.by;
        log[openIndex] = closed;
        results[event.id] = 'ended';
        changed = true;
    });
    return { log, results, changed };
}

/**
 * Folds the competition's unprocessed pause events into config/globalStatus
 * (onPauseEventCreated). Idempotent: an event is marked processed in the same
 * transaction, so a re-delivered trigger finds nothing to do. isPaused always
 * follows the log (an offline device sets it ahead of the fold for its own
 * screen). -> { processed, results }
 */
export async function applyPauseEvents(db, FieldValue, { appId, compId, now = Date.now() }) {
    const eventsRef = db.collection(pauseEventsPath(appId, compId));
    const statusRef = db.doc(globalStatusPath(appId, compId));
    return db.runTransaction(async (tx) => {
        const pending = await tx.get(eventsRef.where('processed', '==', false).limit(PAUSE_EVENTS_PER_RUN));
        if (pending.empty) return { processed: 0, results: {} };
        const statusSnap = await tx.get(statusRef);
        const status = statusSnap.exists ? statusSnap.data() || {} : {};
        const events = pending.docs.map((d) => normalizePauseEvent(d.id, d.data()));
        const { log, results, changed } = foldPauseEvents(status.pauseLog, events);
        const isPaused = openIndexOf(log) !== -1;
        if (changed || status.isPaused !== isPaused) {
            const update = { isPaused, updatedAt: FieldValue.serverTimestamp() };
            if (changed) {
                update.pauseLog = log;
                update.statusText = FieldValue.delete();
            }
            tx.set(statusRef, update, { merge: true });
        }
        pending.docs.forEach((d) => {
            tx.update(d.ref, { processed: true, processedAtMs: now, result: results[d.id] || 'ignored-invalid' });
        });
        return { processed: pending.size, results };
    });
}
