/**
 * Request a screen wake lock to prevent the device from sleeping.
 * This is useful for input pages where the user might look away from the screen for a while
 * (e.g. looking at a horse) but wants the screen to stay on when they look back.
 *
 * The browser releases the lock whenever the page is hidden (screen lock, app
 * switch), so whether the page *wants* the lock is kept separately and the lock
 * is requested again when the page becomes visible. Input pages release it in
 * their __unload.
 */

let wakeLock = null;
let wanted = false;

async function acquire() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
        const sentinel = await navigator.wakeLock.request('screen');
        // Released meanwhile (page left during the request)
        if (!wanted) {
            sentinel.release().catch(() => { });
            return;
        }
        wakeLock = sentinel;
        sentinel.addEventListener('release', () => {
            if (wakeLock === sentinel) wakeLock = null;
        });
    } catch (err) {
        wakeLock = null;
        if (err?.name === 'NotAllowedError') {
            console.warn(`Wake Lock unavailable: ${err.message}`);
            return;
        }
        console.error(`Wake Lock error: ${err.name}, ${err.message}`);
    }
}

export async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        console.warn('Screen Wake Lock API not supported.');
        return;
    }
    wanted = true;
    await acquire();
}

export async function releaseWakeLock() {
    wanted = false;
    const sentinel = wakeLock;
    wakeLock = null;
    if (sentinel) {
        try { await sentinel.release(); } catch { /* already released */ }
    }
}

// Re-acquire when the page becomes visible again (the browser released it when
// the screen locked or the user switched app)
document.addEventListener('visibilitychange', () => {
    if (wanted && !wakeLock && document.visibilityState === 'visible') {
        acquire();
    }
});
