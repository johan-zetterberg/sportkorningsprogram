// Who a competition message (admin → Kommunikation, messages collection) is
// for, and the per-viewer state around it (read, dismissed). Pure: shared by
// the admin page, the driver portal, the speaker page and the field-page
// banner (js/ui/fieldMessages.js). The server's driver filter mirrors the
// driver part in functions/src/driverInbox.js.
//
// audience: { public, drivers, officials, officialRoles }
//   public     everyone (the public info page) - drivers get these too
//   drivers    all drivers, or only targetStartNumbers when given
//   officials  the competition's officials; officialRoles narrows it to
//              some roles ([] = all officials). The rules let every official
//              of the competition read these; the role filter is the client's.

// The official audiences, in the order the admin page lists them
export const OFFICIAL_ROLE_KEYS = Object.freeze(['dressage', 'marathon', 'precision', 'vet', 'speaker', 'secretariat']);

const normalizeList = (value) => (Array.isArray(value) ? value : [])
    .map(v => String(v ?? '').trim())
    .filter(Boolean);

/**
 * The stored fields for an audience chosen on the admin page.
 * mode: 'public' | 'drivers' | 'selected_drivers' | 'officials' | 'official:<role>'
 * ('public_and_drivers' and 'public_only' are older names of 'public').
 */
export function buildMessageAudience(mode, { selectedDrivers = [] } = {}) {
    const m = String(mode || '');
    if (m === 'public' || m === 'public_and_drivers' || m === 'public_only') {
        return { audience: { public: true, drivers: true, officials: false, officialRoles: [] }, targetStartNumbers: [] };
    }
    if (m === 'drivers' || m === 'drivers_only') {
        return { audience: { public: false, drivers: true, officials: false, officialRoles: [] }, targetStartNumbers: [] };
    }
    if (m === 'selected_drivers') {
        return { audience: { public: false, drivers: true, officials: false, officialRoles: [] }, targetStartNumbers: normalizeList(selectedDrivers) };
    }
    if (m === 'officials') {
        return { audience: { public: false, drivers: false, officials: true, officialRoles: [] }, targetStartNumbers: [] };
    }
    if (m.startsWith('official:')) {
        const role = m.slice('official:'.length);
        if (OFFICIAL_ROLE_KEYS.includes(role)) {
            return { audience: { public: false, drivers: false, officials: true, officialRoles: [role] }, targetStartNumbers: [] };
        }
    }
    throw new Error(`Unknown message audience: ${m}`);
}

/** Whether a message is for (some of) the officials */
export function isOfficialMessage(message) {
    return message?.audience?.officials === true;
}

/** The roles an official message is for ([] = all officials) */
export function messageOfficialRoles(message) {
    return normalizeList(message?.audience?.officialRoles).filter(role => OFFICIAL_ROLE_KEYS.includes(role));
}

/** The admin page's audience choice for a stored message (to edit it) */
export function messageAudienceMode(message) {
    if (isOfficialMessage(message)) {
        const roles = messageOfficialRoles(message);
        return roles.length === 1 ? `official:${roles[0]}` : 'officials';
    }
    const targets = normalizeList(message?.targetStartNumbers);
    if (targets.length || (message?.targetStartNumber != null && String(message.targetStartNumber).trim() !== '')) {
        return 'selected_drivers';
    }
    if (message?.audience && typeof message.audience === 'object') {
        return message.audience.public === true ? 'public' : 'drivers';
    }
    // Legacy: no audience and no target = everyone
    return 'public';
}

/**
 * The official audience keys of a viewer: their competition roles, an admin
 * (or superadmin) as the secretariat, plus the role of the page they are on
 * (an admin on the vet page sees the vet's messages there).
 */
export function viewerOfficialRoleKeys(roles = [], pageRole = '') {
    const keys = new Set();
    (Array.isArray(roles) ? roles : [roles]).forEach((role) => {
        const r = String(role || '');
        // The technical delegate / ground jury reads the secretariat's messages
        if (r === 'admin' || r === 'superadmin' || r === 'td') keys.add('secretariat');
        else if (OFFICIAL_ROLE_KEYS.includes(r)) keys.add(r);
    });
    if (pageRole && OFFICIAL_ROLE_KEYS.includes(pageRole)) keys.add(pageRole);
    return [...keys];
}

/** Whether an official message is for a viewer with these audience keys */
export function isMessageForOfficial(message, viewerKeys = []) {
    if (!isOfficialMessage(message)) return false;
    const roles = messageOfficialRoles(message);
    if (!roles.length) return true;
    const mine = new Set(Array.isArray(viewerKeys) ? viewerKeys : []);
    return roles.some(role => mine.has(role));
}

/** Title and text in the viewer's language (English ones are optional) */
export function localizedMessage(message, lang = 'sv') {
    const en = lang === 'en';
    const pick = (svValue, enValue) => {
        const english = String(enValue ?? '').trim();
        return en && english ? english : String(svValue ?? '');
    };
    return {
        title: pick(message?.title, message?.titleEn),
        body: pick(message?.body ?? message?.message, message?.bodyEn)
    };
}

function stampMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (Number.isFinite(value.seconds)) return value.seconds * 1000;
    if (typeof value === 'number') return value;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

/**
 * A key that changes when the message is edited: a dismissed or read message
 * comes back when the organiser changes it.
 */
export function messageStateKey(message, competitionId = '') {
    const edited = stampMillis(message?.editedAt) || stampMillis(message?.timestamp);
    return `${competitionId}:${message?.id || ''}:${edited}`;
}

/** The messages not in the read (or dismissed) set */
export function unreadMessages(messages = [], readKeys = [], keyOf = (m) => messageStateKey(m, m?._compId || '')) {
    const read = readKeys instanceof Set ? readKeys : new Set(Array.isArray(readKeys) ? readKeys : []);
    return (Array.isArray(messages) ? messages : []).filter(m => m && !read.has(keyOf(m)));
}

export function countUnread(messages = [], readKeys = [], keyOf) {
    return unreadMessages(messages, readKeys, keyOf).length;
}

/** The stored key list with keys added, newest kept, at most `max` */
export function addStateKeys(stored = [], keys = [], max = 500) {
    const list = (Array.isArray(stored) ? stored : []).filter(k => typeof k === 'string');
    const add = (Array.isArray(keys) ? keys : [keys]).filter(k => typeof k === 'string' && k);
    const merged = [...list.filter(k => !add.includes(k)), ...add];
    return merged.slice(Math.max(0, merged.length - max));
}

/** Newest first (edited or sent) */
export function sortMessagesNewestFirst(messages = []) {
    return [...(Array.isArray(messages) ? messages : [])]
        .sort((a, b) => stampMillis(b?.timestamp) - stampMillis(a?.timestamp));
}

// localStorage wrappers: storage may be blocked (private mode), never fatal
export function readStoredKeys(storageKey) {
    try {
        const value = JSON.parse(globalThis.localStorage?.getItem(storageKey) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (_) {
        return [];
    }
}

export function writeStoredKeys(storageKey, keys) {
    try { globalThis.localStorage?.setItem(storageKey, JSON.stringify(keys)); } catch (_) { /* no storage */ }
}
