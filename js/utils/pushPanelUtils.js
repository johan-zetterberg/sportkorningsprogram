// The pure parts of the notifications panel (js/ui/pushSettingsPanel.js): which
// topics a role may choose, what the panel shows for a device state, and the
// text keys for errors. No browser or Firebase imports, so node:test runs them.

// Offered per role ('results' has no producer yet: never offered). The
// server's audiences match: drivers get pauses (onGlobalPausePush), the vet
// vet decisions and declaration changes (officials roles admin, td, vet)
const ROLE_TOPICS = Object.freeze({
    driver: ['startTimes', 'messages', 'vetDecision', 'pause'],
    official: ['messages', 'pause'],
    vet: ['vetDecision', 'declarationChanges', 'messages', 'pause'],
    staff: ['messages', 'pause', 'declarationChanges', 'vetDecision']
});
const DEFAULT_TOPICS = Object.freeze({
    driver: ['startTimes', 'messages', 'vetDecision', 'pause'],
    official: ['messages', 'pause'],
    vet: ['vetDecision', 'declarationChanges', 'messages', 'pause'],
    staff: ['messages', 'pause', 'vetDecision', 'declarationChanges'],
    device: ['messages']
});
const STAFF_ROLES = ['admin', 'superadmin', 'sekretariat', 'td'];

export const TOPIC_LABEL_KEYS = Object.freeze({
    startTimes: 'push_topic_startTimes',
    messages: 'push_topic_messages',
    pause: 'push_topic_pause',
    vetDecision: 'push_topic_vetDecision',
    declarationChanges: 'push_topic_declarationChanges'
});

// The iPhone guide, in order (text keys)
export const IOS_GUIDE_STEP_KEYS = Object.freeze(['push_ios_step_share', 'push_ios_step_add', 'push_ios_step_open', 'push_ios_step_enable']);

/**
 * 'staff' for admins, secretariat and TD; 'vet' for the vet; otherwise
 * 'official' (merged roles of the user; staff wins over vet)
 */
export function pushRoleForRoles(roles = []) {
    const list = Array.isArray(roles) ? roles : [];
    if (list.some((r) => STAFF_ROLES.includes(r))) return 'staff';
    return list.includes('vet') ? 'vet' : 'official';
}

/** The topics a role is offered ([] for the device-wide switch) */
export function topicsForRole(role) {
    return [...(ROLE_TOPICS[role] || [])];
}

/**
 * The device's topics when switched on here: what it has plus this role's
 * defaults. The topics are the device's, so a phone first switched on on a
 * public page (messages only) gets a driver's start times when the driver
 * switches it on in the portal
 */
export function initialTopics(role, existing = []) {
    const have = Array.isArray(existing) ? existing : [];
    return [...new Set([...have, ...(DEFAULT_TOPICS[role] || DEFAULT_TOPICS.device)])];
}

/** One topic on or off; topics the role is not offered stay as they are */
export function toggleTopic(current = [], topic, on) {
    const set = new Set(Array.isArray(current) ? current : []);
    if (on) set.add(topic);
    else set.delete(topic);
    return [...set];
}

/**
 * What the panel shows: 'not-available' (no VAPID key yet), 'ios-old',
 * 'ios-guide', 'unsupported', 'denied', 'on' or 'off'.
 * status: getPushStatus (+ available from the settings); competitionId: the
 * scope (the device must follow it), none = the whole device.
 */
export function derivePushView(status = {}, iosDecision = 'not-ios', { competitionId = null } = {}) {
    if (status.available !== true) return 'not-available';
    if (iosDecision === 'unsupported-version') return 'ios-old';
    if (iosDecision === 'add-to-home-screen') return 'ios-guide';
    if (status.supported === false) return 'unsupported';
    if (status.permission === 'denied') return 'denied';
    const on = status.enabled === true && (!competitionId || status.following === true);
    return on ? 'on' : 'off';
}

/** The status line's text key for a view */
export function viewStatusKey(view) {
    return {
        'not-available': 'push_status_not_available',
        'ios-old': 'push_status_ios_old',
        'ios-guide': 'push_status_ios_guide',
        unsupported: 'push_status_unsupported',
        denied: 'push_status_denied',
        on: 'push_status_on',
        off: 'push_status_off'
    }[view] || 'push_status_off';
}

/** The text key for an error thrown by pushService (error.code) */
export function pushErrorKey(code) {
    return {
        'push/unsupported': 'push_err_unsupported',
        'push/not-available': 'push_err_not_available',
        'push/permission-denied': 'push_err_denied',
        'push/permission-dismissed': 'push_err_dismissed',
        'push/no-service-worker': 'push_err_no_sw',
        'push/token-failed': 'push_err_token',
        'push/not-enabled': 'push_err_not_enabled'
    }[code] || 'push_err_generic';
}
