// Firestore keeps a write on the device (IndexedDB) the moment it is made and
// sends it when there is a connection, but the write's promise only resolves
// when the server has acknowledged it. Awaiting it therefore freezes an input
// page for as long as there is no signal. This gives the page an answer after
// a short wait instead: 'saved' (acknowledged) or 'queued' (kept on the device,
// sent later). A write the server refuses after that is reported through
// onLateError, since the caller has already moved on.

export const WRITE_ACK_TIMEOUT_MS = 4000;

export async function awaitWriteOrQueue(writePromise, { timeoutMs = WRITE_ACK_TIMEOUT_MS, onLateError = null } = {}) {
    let timer = null;
    let settled = false;
    const tracked = Promise.resolve(writePromise).then(
        () => { settled = true; return 'saved'; },
        (error) => {
            settled = true;
            if (timedOut) {
                console.error('[offlineWrite] En köad skrivning nekades av servern:', error);
                try { onLateError?.(error); } catch { /* reporting only */ }
            }
            throw error;
        }
    );
    let timedOut = false;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            if (!settled) timedOut = true;
            resolve('queued');
        }, timeoutMs);
    });
    try {
        return await Promise.race([tracked, timeout]);
    } finally {
        clearTimeout(timer);
        // A rejection after the timeout is reported above, not left unhandled
        tracked.catch(() => { });
    }
}

/**
 * Whether the device keeps queued writes over a reload (Firestore's offline
 * storage could be turned on; not in some private browsing modes or with full
 * storage). Unknown counts as yes.
 */
export function deviceKeepsQueuedWrites() {
    return globalThis.__FIRESTORE_OFFLINE_STORAGE__ !== false;
}

/** Short user text for a result of awaitWriteOrQueue */
export function queuedNotice(result) {
    if (result !== 'queued') return '';
    return deviceKeepsQueuedWrites()
        ? ' (sparat på enheten – skickas när nätet är tillbaka)'
        : ' (INTE sparat på enheten: ladda inte om och stäng inte sidan förrän nätet är tillbaka)';
}
