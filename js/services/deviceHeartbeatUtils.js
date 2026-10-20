// Field device status: what each device on a field input page reports once a
// minute (deviceHeartbeatService.js) and how fresh the secretariat's panel
// shows it. Pure helpers.

// The input pages used in the field (navigationService's JUDGE_PAGES)
export const FIELD_PAGES = Object.freeze([
    'dressyr-input', 'maraton-input', 'maraton-stages', 'observator-input',
    'precision-input', 'precision-split-input', 'vagnbredd', 'vet-check'
]);

export const HEARTBEAT_INTERVAL_MS = 60 * 1000;
// Green under 2 minutes, amber under 10, red after
export const FRESH_MS = 2 * 60 * 1000;
export const STALE_MS = 10 * 60 * 1000;
// Firestore's TTL policy deletes a device document this long after its last beat
export const DEVICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isFieldPage(pageKey) {
    return FIELD_PAGES.includes(String(pageKey || ''));
}

export function isValidDeviceId(value) {
    return typeof value === 'string' && DEVICE_ID_RE.test(value);
}

/** A new random device id (per installation, kept in localStorage) */
export function generateDeviceId(randomValues = (arr) => crypto.getRandomValues(arr)) {
    const bytes = new Uint8Array(12);
    randomValues(bytes);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let id = 'dev_';
    for (let i = 0; i < bytes.length; i++) id += alphabet[bytes[i] % alphabet.length];
    return id;
}

/** 'green' | 'amber' | 'red' for a last-seen time (ms); unknown is red */
export function heartbeatFreshness(lastSeenMs, nowMs = Date.now()) {
    const seen = Number(lastSeenMs);
    if (!Number.isFinite(seen) || seen <= 0) return 'red';
    const age = Math.max(0, nowMs - seen);
    if (age < FRESH_MS) return 'green';
    if (age < STALE_MS) return 'amber';
    return 'red';
}

/** "45 s", "3 min", "2 h" since last seen */
export function formatSince(lastSeenMs, nowMs = Date.now()) {
    const seen = Number(lastSeenMs);
    if (!Number.isFinite(seen) || seen <= 0) return '–';
    const s = Math.max(0, Math.round((nowMs - seen) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

const clip = (value, max) => (value === null || value === undefined ? '' : String(value).trim().slice(0, max));

/**
 * The document a device writes (without lastSeen/expireAt, which the service
 * sets with the server's time and a Timestamp).
 */
export function buildHeartbeatDoc({ deviceId, uid, userName = '', role = '', page = '', startNumber = '', obstacle = '', queueSize = 0, online = true, clockSyncedAt = null, appVersion = '' } = {}) {
    const queue = Number(queueSize);
    const synced = Number(clockSyncedAt);
    return {
        deviceId: String(deviceId || ''),
        uid: String(uid || ''),
        userName: clip(userName, 200),
        role: clip(role, 100),
        page: clip(page, 60),
        startNumber: clip(startNumber, 20),
        obstacle: clip(obstacle, 40),
        queueSize: Number.isFinite(queue) && queue > 0 ? Math.floor(queue) : 0,
        online: online !== false,
        clockSyncedAt: Number.isFinite(synced) && synced > 0 ? Math.floor(synced) : null,
        appVersion: clip(appVersion, 40)
    };
}

/** The panel's rows: newest first, with freshness */
export function summarizeDevices(devices = [], nowMs = Date.now()) {
    return (Array.isArray(devices) ? devices : [])
        .map((device) => {
            const lastSeenMs = Number(device?.lastSeenMs ?? device?.lastSeen);
            return { ...device, lastSeenMs, freshness: heartbeatFreshness(lastSeenMs, nowMs) };
        })
        .sort((a, b) => (b.lastSeenMs || 0) - (a.lastSeenMs || 0));
}

/** The selected equipage / obstacle from the page's hash (#maraton-input?obstacle=3) */
export function contextFromHash(hash = '') {
    try {
        const params = new URLSearchParams(String(hash || '').split('?')[1] || '');
        return {
            startNumber: params.get('startNumber') || params.get('sn') || '',
            obstacle: params.get('obstacle') || params.get('hinder') || ''
        };
    } catch {
        return { startNumber: '', obstacle: '' };
    }
}
