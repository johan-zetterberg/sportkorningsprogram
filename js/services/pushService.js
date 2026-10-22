// Web push notifications on this device (Firebase Cloud Messaging). The
// server keeps the devices and decides who gets what (functions/src/push):
// this file asks for permission, gets the FCM token with the project's public
// VAPID key (appSettings/push) and the app's own service worker registration,
// and registers it with the callables. Push is "not available" until a
// superadmin saved the key and switched it on; nothing here throws for that.
//
// Errors thrown carry a `code`: 'push/unsupported', 'push/not-available',
// 'push/permission-denied', 'push/permission-dismissed', 'push/no-service-worker',
// 'push/token-failed'.
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { app, db, functions } from '../config/firebase-config.js';
import {
    DEFAULT_PUBLIC_TOPICS,
    detectPushPlatform,
    iosPushDecision,
    isValidVapidKey,
    normalizeTopics,
    pushSupport
} from '../utils/pushUtils.js';

export { PUSH_TOPICS, DEFAULT_DRIVER_TOPICS, DEFAULT_OFFICIAL_TOPICS, DEFAULT_PUBLIC_TOPICS, iosPushDecision } from '../utils/pushUtils.js';

const MESSAGING_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js';
// This device's token and choices (a convenience: the server has the truth)
const LOCAL_KEY = 'drivelive.push';
const SW_READY_TIMEOUT_MS = 10000;

function pushError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
}

async function call(name, data) {
    const result = await httpsCallable(functions, name)(data || {});
    return result?.data || {};
}

function readLocal() {
    try {
        const value = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
}

function writeLocal(value) {
    try {
        if (value) localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
        else localStorage.removeItem(LOCAL_KEY);
    } catch {
        // private mode: the server still has the registration
    }
}

function isStandalone() {
    try {
        return navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
    } catch {
        return false;
    }
}

function environment() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    return {
        isSecureContext: typeof window !== 'undefined' && window.isSecureContext === true,
        hasServiceWorker: 'serviceWorker' in nav,
        hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
        hasNotification: typeof window !== 'undefined' && 'Notification' in window,
        userAgent: nav.userAgent || '',
        platform: nav.platform || '',
        maxTouchPoints: nav.maxTouchPoints || 0,
        standalone: isStandalone()
    };
}

/** { supported, reason, ios } (pushUtils pushSupport) */
export function getPushSupport() {
    return pushSupport(environment());
}

/** Whether this browser can get push notifications at all */
export function isPushSupported() {
    return getPushSupport().supported;
}

/**
 * The iPhone/iPad "add to home screen" decision for this device: 'not-ios',
 * 'unsupported-version', 'add-to-home-screen' or 'ok'
 */
export function getIosPushDecision() {
    const env = environment();
    return iosPushDecision(env);
}

const permission = () => (typeof Notification !== 'undefined' ? Notification.permission : 'default');
const lang = () => (String(document?.documentElement?.lang || navigator.language || 'sv').toLowerCase().startsWith('en') ? 'en' : 'sv');

let settingsCache = null;

/** appSettings/push: { available, vapidKey } (read once per page load) */
export async function getPushSettings({ fresh = false } = {}) {
    if (settingsCache && !fresh) return settingsCache;
    try {
        const snap = await getDoc(doc(db, 'appSettings/push'));
        const data = snap.exists() ? snap.data() : {};
        const vapidKey = isValidVapidKey(data.vapidKey) ? data.vapidKey : null;
        settingsCache = { available: data.enabled === true && !!vapidKey, vapidKey };
    } catch {
        settingsCache = { available: false, vapidKey: null };
    }
    return settingsCache;
}

async function serviceWorkerRegistration() {
    if (!('serviceWorker' in navigator)) throw pushError('push/no-service-worker');
    // The registration js/appUpdate.js made (scope './'); wait for it to be active
    const ready = navigator.serviceWorker.ready;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS));
    const registration = await Promise.race([ready, timeout]);
    if (!registration) throw pushError('push/no-service-worker', 'Service worker not ready');
    return registration;
}

let messagingModule = null;
async function messagingApi() {
    if (!messagingModule) messagingModule = await import(MESSAGING_URL);
    return messagingModule;
}

/** This device's FCM token (needs permission already granted) */
async function currentToken(vapidKey) {
    const registration = await serviceWorkerRegistration();
    const { getMessaging, getToken } = await messagingApi();
    try {
        const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
        if (!token) throw new Error('empty token');
        return token;
    } catch (error) {
        throw pushError('push/token-failed', String(error?.message || error));
    }
}

/**
 * The state for the UI:
 * { supported, reason, ios, available, permission, enabled, topics,
 *   competitions, following }
 * enabled: this device is registered (and permission granted). With
 * competitionId, following tells whether it follows that competition.
 */
export async function getPushStatus({ competitionId = null, verify = false } = {}) {
    const support = getPushSupport();
    const settings = support.supported ? await getPushSettings() : { available: false };
    const local = readLocal();
    const status = {
        supported: support.supported,
        reason: support.reason,
        ios: support.ios,
        available: settings.available,
        permission: support.supported ? permission() : 'unsupported',
        enabled: !!local?.token && permission() === 'granted',
        topics: local?.topics || [],
        competitions: local?.competitions || [],
        following: competitionId ? (local?.competitions || []).includes(competitionId) : null
    };
    if (verify && status.enabled) {
        try {
            const server = await call('getPushRegistration', { token: local.token, ...(competitionId ? { competitionId } : {}) });
            status.enabled = server.registered === true;
            status.topics = server.topics || [];
            status.competitions = server.competitions || [];
            if (competitionId) status.following = server.following === true;
            if (!server.registered) writeLocal(null);
            else writeLocal({ ...local, topics: status.topics, competitions: status.competitions });
        } catch {
            // offline: the local state stands
        }
    }
    return status;
}

async function register(token, { competitionId = null, topics = null, previousToken = null } = {}) {
    const payload = { token, platform: detectPushPlatform(environment()), lang: lang() };
    if (topics) payload.topics = normalizeTopics(topics);
    if (competitionId) payload.competitionId = competitionId;
    if (previousToken && previousToken !== token) payload.previousToken = previousToken;
    const result = await call('registerPushToken', payload);
    writeLocal({ token, topics: result.topics || [], competitions: result.competitions || [], updatedAt: Date.now() });
    return result;
}

/**
 * The browser renewed this device's token: registers the new one with the old
 * one as previousToken (the server carries its topics and competitions over
 * and removes it). If the server no longer had the old registration, the
 * device's own copy fills in: its topics, and each competition it followed.
 */
async function registerRenewed(token, previous, { competitionId = null, topics = null } = {}) {
    let result = await register(token, {
        competitionId,
        topics: topics || (previous?.topics?.length ? previous.topics : null),
        previousToken: previous?.token || null
    });
    if (!result.renewed) {
        const missing = (previous?.competitions || []).filter((c) => c && !(result.competitions || []).includes(c));
        for (const id of missing) {
            try {
                result = await register(token, { competitionId: id });
            } catch {
                // a deleted competition: not followed any more
            }
        }
        if (previous?.token && previous.token !== token) call('unregisterPushToken', { token: previous.token }).catch(() => { });
    }
    return result;
}

/**
 * Turns push on for this device (call from a click: the browser asks for
 * permission). competitionId: follow that competition; topics: PUSH_TOPICS
 * subset. -> the server's registration { registered, topics, competitions }
 */
export async function enablePush({ competitionId = null, topics = null } = {}) {
    const support = getPushSupport();
    if (!support.supported) throw pushError('push/unsupported', support.reason || 'unsupported');
    // Ask first, before any other await: Safari on iPhone only shows the
    // permission prompt while the tap's user activation is still valid
    let result = permission();
    if (result === 'default') result = await Notification.requestPermission();
    if (result === 'denied') throw pushError('push/permission-denied');
    if (result !== 'granted') throw pushError('push/permission-dismissed');
    const settings = await getPushSettings({ fresh: true });
    if (!settings.available) throw pushError('push/not-available');
    const token = await currentToken(settings.vapidKey);
    const previous = readLocal();
    // A new token replaces the old one (the browser renewed its subscription):
    // the competitions followed with the old one are kept
    if (previous?.token && previous.token !== token) {
        return registerRenewed(token, previous, { competitionId, topics: topics || previous.topics || DEFAULT_PUBLIC_TOPICS });
    }
    return register(token, { competitionId, topics: topics || previous?.topics || DEFAULT_PUBLIC_TOPICS });
}

/** New topics for this device (and optionally follow a competition) */
export async function updateTopics(topics, { competitionId = null } = {}) {
    const local = readLocal();
    if (!local?.token) throw pushError('push/not-enabled');
    return register(local.token, { competitionId, topics });
}

/**
 * Turns push off: for one competition ({ competitionId }) or for this device
 * altogether (the FCM token is deleted too).
 */
export async function disablePush({ competitionId = null } = {}) {
    const local = readLocal();
    if (competitionId) {
        if (!local?.token) return { removed: false };
        const result = await call('unregisterPushToken', { token: local.token, competitionId });
        writeLocal({ ...local, competitions: (local.competitions || []).filter((c) => c !== competitionId) });
        return result;
    }
    let result = { removed: false };
    if (local?.token) {
        try {
            result = await call('unregisterPushToken', { token: local.token });
        } catch {
            // offline: the server drops the device after 60 days unseen
        }
    }
    writeLocal(null);
    // The token itself (getToken first: deleteToken needs the registration)
    try {
        const settings = await getPushSettings();
        if (settings.vapidKey && permission() === 'granted') {
            const registration = await serviceWorkerRegistration();
            const { getMessaging, getToken, deleteToken } = await messagingApi();
            const messaging = getMessaging(app);
            await getToken(messaging, { vapidKey: settings.vapidKey, serviceWorkerRegistration: registration });
            await deleteToken(messaging);
        }
    } catch {
        // the server registration is gone already
    }
    return result;
}

/**
 * At app start when push was turned on here: refreshes the registration (the
 * server drops devices unseen for 60 days) and picks up a renewed token.
 * Quiet: returns false when nothing was done.
 */
export async function refreshPush() {
    const local = readLocal();
    if (!local?.token || !isPushSupported() || permission() !== 'granted') return false;
    try {
        const settings = await getPushSettings();
        if (!settings.available) return false;
        const token = await currentToken(settings.vapidKey);
        if (token !== local.token) await registerRenewed(token, local);
        else await register(token, {});
        return true;
    } catch {
        return false;
    }
}

/** A test notification to this account's devices -> { status, sent, failed } */
export const sendTestPush = () => call('sendTestPush');

// Superadmin
export const setPushSettings = (payload) => call('setPushSettings', payload).then((r) => { settingsCache = null; return r; });
export const getPushAdminStatus = () => call('getPushAdminStatus');

/**
 * Changed start times as push notices (admins, TD):
 * { competitionId, changes: [{ startNumber, text, textEn? }], dedupeKey? }
 */
export const notifyStartTimeChange = (payload) => call('notifyStartTimeChange', payload);

/**
 * How many devices a push would reach (admins, secretariat, TD):
 * { competitionId, topic, category?, startNumbers? | message? } -> { available, devices }
 */
export const previewPushAudience = (payload) => call('previewPushAudience', payload);
