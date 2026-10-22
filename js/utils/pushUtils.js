// Web push on the device: the pure parts of js/services/pushService.js (no
// browser or Firebase imports, so node:test runs them). Whether this browser
// can get notifications, the iPhone/iPad "add to home screen" case, topics,
// and the in-app route a clicked notification opens.

import { pushRoleForRoles } from './pushPanelUtils.js';

// The same list as the server (functions/src/push/pushCore.js PUSH_TOPICS)
export const PUSH_TOPICS = Object.freeze(['startTimes', 'messages', 'pause', 'vetDecision', 'declarationChanges', 'results']);
// Sensible first choices for the UI
export const DEFAULT_DRIVER_TOPICS = Object.freeze(['startTimes', 'messages', 'vetDecision', 'pause']);
export const DEFAULT_OFFICIAL_TOPICS = Object.freeze(['messages', 'pause', 'vetDecision', 'declarationChanges']);
export const DEFAULT_PUBLIC_TOPICS = Object.freeze(['messages']);

/**
 * The role the device-wide notifications switch is mounted with: staff, vet or
 * official topics when the user holds a role in the current competition,
 * otherwise 'device' (drivers, public, no competition selected).
 */
export function devicePushRole(roles = [], hasCompetition = false) {
    const list = (Array.isArray(roles) ? roles : []).filter((r) => r && r !== 'publik');
    if (!hasCompetition || !list.length) return 'device';
    return pushRoleForRoles(list);
}

// Web push on iPhone/iPad: iOS/iPadOS 16.4 and later, only in an app added to
// the home screen
export const IOS_MIN_PUSH_VERSION = Object.freeze([16, 4]);

/** Known topics only, in the canonical order */
export function normalizeTopics(topics) {
    const wanted = new Set((Array.isArray(topics) ? topics : []).map((t) => String(t ?? '').trim()));
    return PUSH_TOPICS.filter((t) => wanted.has(t));
}

/** The VAPID key's shape (the public key, base64url, about 87 characters) */
export function isValidVapidKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(value);
}

/** iPhone, iPod or iPad (iPadOS presents itself as a Mac with touch) */
export function isIosDevice({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
    if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
    return (platform === 'MacIntel' || /Macintosh/i.test(userAgent)) && Number(maxTouchPoints) > 1;
}

/** [major, minor] of iOS from the user agent ("OS 16_4" or Safari's "Version/16.4"), or null */
export function parseIosVersion(userAgent = '') {
    const os = /OS (\d+)[_.](\d+)/.exec(userAgent);
    if (os && /iPhone|iPad|iPod/i.test(userAgent)) return [Number(os[1]), Number(os[2])];
    const safari = /Version\/(\d+)\.(\d+)/.exec(userAgent);
    return safari ? [Number(safari[1]), Number(safari[2])] : null;
}

const versionAtLeast = (version, min) => !!version && (version[0] > min[0] || (version[0] === min[0] && version[1] >= min[1]));

/**
 * The iPhone/iPad case: 'not-ios', 'unsupported-version' (older than 16.4),
 * 'add-to-home-screen' (Safari tab: push only in the home screen app) or 'ok'.
 * standalone: navigator.standalone or display-mode standalone.
 */
export function iosPushDecision({ userAgent = '', platform = '', maxTouchPoints = 0, standalone = false } = {}) {
    if (!isIosDevice({ userAgent, platform, maxTouchPoints })) return 'not-ios';
    const version = parseIosVersion(userAgent);
    // An unknown version in the home screen app: let the feature check decide
    if (version && !versionAtLeast(version, IOS_MIN_PUSH_VERSION)) return 'unsupported-version';
    if (!standalone) return 'add-to-home-screen';
    return 'ok';
}

/**
 * Whether this browser can get push notifications, and why not:
 * { supported, reason } with reason null, 'insecure', 'no-service-worker',
 * 'no-push-manager', 'no-notification', 'ios-add-to-home-screen' or
 * 'ios-unsupported-version'.
 */
export function pushSupport({
    isSecureContext = false, hasServiceWorker = false, hasPushManager = false, hasNotification = false,
    userAgent = '', platform = '', maxTouchPoints = 0, standalone = false
} = {}) {
    const ios = iosPushDecision({ userAgent, platform, maxTouchPoints, standalone });
    if (ios === 'unsupported-version') return { supported: false, reason: 'ios-unsupported-version', ios };
    // iOS Safari outside the home screen has no PushManager at all: say why
    if (ios === 'add-to-home-screen') return { supported: false, reason: 'ios-add-to-home-screen', ios };
    if (!isSecureContext) return { supported: false, reason: 'insecure', ios };
    if (!hasServiceWorker) return { supported: false, reason: 'no-service-worker', ios };
    if (!hasPushManager) return { supported: false, reason: 'no-push-manager', ios };
    if (!hasNotification) return { supported: false, reason: 'no-notification', ios };
    return { supported: true, reason: null, ios };
}

/** The platform the server records (statistics only) */
export function detectPushPlatform({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
    if (isIosDevice({ userAgent, platform, maxTouchPoints })) return 'ios';
    if (/Android/i.test(userAgent)) return 'android';
    if (/Windows|Macintosh|Linux|CrOS/i.test(userAgent)) return 'desktop';
    return 'other';
}

const PUSH_ROUTE = /^#[a-z][a-z0-9-]{0,40}(\?[A-Za-z0-9_=&%.\-]{0,200})?$/;

/** An in-app hash route from a notification, or null (same rule as service-worker.js) */
export function safePushRoute(value) {
    const text = String(value ?? '').trim();
    return PUSH_ROUTE.test(text) ? text : null;
}

/** The route of a service worker message { type: 'PUSH_NAVIGATE', route }, or null */
export function pushRouteFromMessage(data) {
    if (!data || typeof data !== 'object' || data.type !== 'PUSH_NAVIGATE') return null;
    return safePushRoute(data.route);
}
