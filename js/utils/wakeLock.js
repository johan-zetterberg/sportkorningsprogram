/**
 * Request a screen wake lock to prevent the device from sleeping.
 * This is useful for input pages where the user might look away from the screen for a while
 * (e.g. looking at a horse) but wants the screen to stay on when they look back.
 */

let wakeLock = null;

export async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        console.warn('Screen Wake Lock API not supported.');
        return;
    }

    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock is active!');

        wakeLock.addEventListener('release', () => {
            console.log('Wake Lock released');
        });

    } catch (err) {
        console.error(`Wake Lock error: ${err.name}, ${err.message}`);
    }
}

// Automatically re-acquire lock when page becomes visible again
// (e.g. after switching tabs or minimizing)
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});
