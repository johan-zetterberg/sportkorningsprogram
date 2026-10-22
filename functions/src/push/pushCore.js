// Web push (Firebase Cloud Messaging): the pure parts (no Firebase imports, so
// node:test runs them without emulators). Token documents, topics, who an
// audience reaches (the same audience descriptors as e-mail, mailCore.js),
// the FCM message per language and the clean-up of dead tokens. Firestore and
// sending: pushService.js.
import { createHash } from 'node:crypto';
import { emailHash } from '../mail/mailCore.js';

// What a device can follow. declarationChanges and pause reach officials only
// (the audience decides); results has no producer yet
export const PUSH_TOPICS = ['startTimes', 'messages', 'pause', 'vetDecision', 'declarationChanges', 'results'];
export const PUSH_CATEGORIES = ['info', 'essential'];
export const PUSH_LANGS = ['sv', 'en'];
export const PUSH_PLATFORMS = ['android', 'ios', 'desktop', 'other'];

export const PUSH_LIMITS = {
    tokenMin: 20,
    tokenMax: 4096,
    // A device follows this many competitions at most (the oldest go)
    maxCompetitionsPerToken: 20,
    // Devices per account (the least recently seen go, logged): shared
    // official accounts are signed in on many field devices
    maxTokensPerUser: 30,
    // sendEachForMulticast takes 500 tokens at most
    multicastMax: 500,
    // Notifications per competition and day (Swedish calendar day)
    competitionDailyDefault: 5000,
    dailyLimitMax: 1000000,
    titleMax: 120,
    bodyMax: 400,
    // A token not seen (registered or refreshed by the app) in this long is dropped
    staleTokenMs: 60 * 24 * 60 * 60 * 1000,
    ttlDefaultSec: 24 * 60 * 60,
    ttlPauseSec: 60 * 60,
    // registerPushToken / notifyStartTimeChange / sendTestPush per user and hour
    registerPerUserHour: 200,
    notifyPerUserHour: 20,
    testPerUserHour: 5,
    personalTextMax: 300
};

export const PUSH_ICON = '/icons/DriveLive_192.png';
export const PUSH_BADGE = '/icons/DriveLive_192.png';

// FCM error codes that mean the token will never work again
export const DEAD_TOKEN_CODES = [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument'
];

export class PushError extends Error {}

const cleanLine = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);

// --- Tokens and registration ---

/** The id of a token's document: the token itself is never an id or in a log */
export function pushTokenId(token) {
    return createHash('sha256').update(String(token ?? '')).digest('hex').slice(0, 40);
}

export function isValidPushToken(token) {
    return typeof token === 'string'
        && token.length >= PUSH_LIMITS.tokenMin
        && token.length <= PUSH_LIMITS.tokenMax
        && /^[A-Za-z0-9_:\-.]+$/.test(token);
}

/** The topics of a request, checked: unknown ones throw (a typo must not pass silently) */
export function normalizeTopics(raw) {
    if (!Array.isArray(raw)) throw new PushError('Ogiltiga ämnen.');
    const topics = [...new Set(raw.map((t) => String(t ?? '').trim()).filter(Boolean))];
    const unknown = topics.filter((t) => !PUSH_TOPICS.includes(t));
    if (unknown.length) throw new PushError(`Okänt ämne: ${unknown.join(', ')}.`);
    return PUSH_TOPICS.filter((t) => topics.includes(t));
}

export const normalizePushLang = (value) => (/^en\b/i.test(String(value ?? '').trim()) ? 'en' : 'sv');

export function normalizePlatform(value) {
    const p = String(value ?? '').trim().toLowerCase();
    return PUSH_PLATFORMS.includes(p) ? p : 'other';
}

export const competitionKey = (appId, compId) => `${appId}__${compId}`;

export function parseCompetitionKey(key) {
    const [appId, compId, extra] = String(key ?? '').split('__');
    return appId && compId && extra === undefined ? { appId, compId } : null;
}

/**
 * The token document after a registration. existing: the stored doc or null.
 * A token that moved to another account (another login in the same browser)
 * starts over: the earlier account's competitions are not kept.
 * competition: competitionKey or null (topics only).
 */
export function buildTokenDoc({ existing = null, uid, email = '', token, topics, platform, lang, competition = null, now = Date.now() }) {
    const sameOwner = existing && existing.uid === uid;
    let competitions = sameOwner ? list(existing.competitions).filter((c) => typeof c === 'string') : [];
    if (competition) competitions = [competition, ...competitions.filter((c) => c !== competition)];
    competitions = competitions.slice(0, PUSH_LIMITS.maxCompetitionsPerToken);
    return {
        uid,
        token,
        // Drivers are matched by their verified address; only its hash is kept
        emailHash: email ? emailHash(email) : null,
        topics: topics ?? (sameOwner ? list(existing.topics) : []),
        platform: normalizePlatform(platform),
        lang: normalizePushLang(lang),
        competitions,
        createdAtMs: sameOwner ? (Number(existing.createdAtMs) || now) : now,
        lastSeenMs: now,
        updatedAtMs: now
    };
}

/**
 * The registration a renewed token starts from: the browser replaced the
 * device's token (previous: the old token's doc), so its topics and
 * competitions carry over when the old doc is the same account's. existing:
 * the new token's doc (if any). -> the `existing` for buildTokenDoc
 */
export function inheritRenewedToken({ existing = null, previous = null, uid }) {
    const own = existing && existing.uid === uid ? existing : null;
    if (!previous || previous.uid !== uid) return existing;
    const competitions = [...new Set([...list(own?.competitions), ...list(previous.competitions)].filter((c) => typeof c === 'string'))];
    return {
        ...previous,
        ...(own || {}),
        uid,
        topics: list(own?.topics).length ? list(own.topics) : list(previous.topics),
        competitions,
        createdAtMs: Math.min(...[own?.createdAtMs, previous.createdAtMs].map(Number).filter((n) => Number.isFinite(n) && n > 0), Date.now())
    };
}

/** The ids of an account's tokens beyond the cap, least recently seen first ([{ id, data }]) */
export function tokensOverUserCap(tokens = [], max = PUSH_LIMITS.maxTokensPerUser) {
    const sorted = [...tokens].sort((a, b) => (Number(b.data?.lastSeenMs) || 0) - (Number(a.data?.lastSeenMs) || 0));
    return sorted.slice(max).map((t) => t.id);
}

export function isStaleToken(data = {}, nowMs = Date.now(), maxAgeMs = PUSH_LIMITS.staleTokenMs) {
    const seen = Number(data.lastSeenMs) || Number(data.createdAtMs) || 0;
    return nowMs - seen > maxAgeMs;
}

/** What a client may see of its own registration (never the token or address hash) */
export function publicRegistration(data, appIdFilter = null) {
    if (!data) return { registered: false, topics: [], competitions: [] };
    return {
        registered: true,
        topics: list(data.topics),
        competitions: list(data.competitions).map(parseCompetitionKey).filter(Boolean)
            .filter((c) => !appIdFilter || c.appId === appIdFilter).map((c) => c.compId),
        lang: data.lang || 'sv',
        lastSeenMs: Number(data.lastSeenMs) || null
    };
}

// --- Settings (appSettings/push: public, written by setPushSettings) ---

/** The public VAPID key of the Firebase project (Cloud Messaging → Web Push certificates) */
export function isValidVapidKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(value);
}

/** The settings doc from setPushSettings, checked; `existing` keeps what is not given */
export function normalizePushSettings(raw = {}, existing = {}) {
    let vapidKey = existing.vapidKey || '';
    if (raw.clearVapidKey === true) vapidKey = '';
    if (raw.vapidKey !== undefined && raw.vapidKey !== null && raw.vapidKey !== '') {
        vapidKey = String(raw.vapidKey).trim().replace(/=+$/, '');
        if (!isValidVapidKey(vapidKey)) throw new PushError('Ogiltig VAPID-nyckel (den publika nyckeln, ca 87 tecken).');
    }
    const appUrl = String(raw.appUrl ?? existing.appUrl ?? '').trim().replace(/\/+$/, '');
    if (appUrl && !/^https:\/\/[a-z0-9.\-]+(:\d+)?(\/[\w\-./]*)?$/i.test(appUrl)) throw new PushError('Ogiltig app-adress (https krävs).');
    let limit = existing.competitionDailyLimit ?? PUSH_LIMITS.competitionDailyDefault;
    if (raw.competitionDailyLimit !== undefined && raw.competitionDailyLimit !== null && raw.competitionDailyLimit !== '') {
        limit = Number(raw.competitionDailyLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > PUSH_LIMITS.dailyLimitMax) throw new PushError('Ogiltig daglig gräns.');
    }
    const enabled = raw.enabled === undefined ? existing.enabled === true : raw.enabled === true;
    if (enabled && !vapidKey) throw new PushError('Ange VAPID-nyckeln innan push slås på.');
    return { vapidKey, enabled, appUrl, competitionDailyLimit: limit };
}

/** Whether pushes go out: switched on with a key */
export const pushAvailable = (settings) => !!settings && settings.enabled === true && isValidVapidKey(settings.vapidKey);

// --- Audience ---

// The admin page's official audiences use 'secretariat'; the system role is 'admin'
const ROLE_ALIASES = { secretariat: 'admin', sekretariat: 'admin' };
const normalizeRole = (role) => {
    const r = String(role ?? '').trim().toLowerCase();
    return ROLE_ALIASES[r] || r;
};

const messageTargets = (message = {}) => {
    const selected = list(message.targetStartNumbers).map((v) => String(v).trim()).filter(Boolean);
    if (selected.length) return selected;
    const single = String(message.targetStartNumber ?? '').trim();
    return single ? [single] : [];
};

/**
 * A competition message's audience as a push audience (driverInbox.js
 * isMessageForDriver for the drivers): { everyone?, drivers?, officials? } or
 * null. everyone: every device following the competition (public messages).
 */
export function messagePushAudience(message = {}) {
    const aud = message.audience && typeof message.audience === 'object' ? message.audience : null;
    const targets = messageTargets(message);
    const isPublic = aud ? aud.public === true : !targets.length;
    let drivers = aud ? aud.drivers !== false : true;
    if (aud?.officials === true && !isPublic && aud.drivers !== true) drivers = false;
    const out = {};
    if (isPublic && !targets.length) out.everyone = true;
    if (drivers) {
        out.drivers = targets.length
            ? { classes: [], startNumbers: targets, includeWithdrawn: true }
            : { all: true, includeWithdrawn: false };
    }
    if (aud?.officials === true) {
        const roles = [...new Set(list(aud.officialRoles).map(normalizeRole).filter(Boolean))];
        out.officials = roles.length ? { roles } : { all: true };
    }
    return Object.keys(out).length ? out : null;
}

/**
 * The competition's staff by account and by address hash, with their system
 * roles: admins/{uid} docs, roleEmails/{email} docs, and the owner and
 * admins[] of the competition document (role 'admin').
 * -> { byUid: Map<uid, Set<role>>, byEmailHash: Map<hash, Set<role>> }
 */
export function buildStaffIndex({ competition = {}, admins = [], roleEmails = [] } = {}) {
    const byUid = new Map();
    const byEmailHash = new Map();
    const add = (map, key, roles) => {
        if (!key) return;
        const set = map.get(key) || new Set();
        roles.map(normalizeRole).filter(Boolean).forEach((r) => set.add(r));
        if (set.size) map.set(key, set);
    };
    const rolesOf = (data = {}) => [data.role, ...list(data.roles)];
    [competition?.createdBy, competition?.ownerId, ...list(competition?.admins)]
        .filter((uid) => typeof uid === 'string' && uid)
        .forEach((uid) => add(byUid, uid, ['admin']));
    admins.forEach(({ id, data = {} }) => add(byUid, id, rolesOf(data)));
    roleEmails.forEach(({ id, data = {} }) => add(byEmailHash, emailHash(id), rolesOf(data)));
    return { byUid, byEmailHash };
}

/**
 * Who of the devices an audience reaches. driverRecipients /
 * officialRecipients: mailCore resolveRecipients output for the drivers and
 * the officials part (the competition's own lists, matched by address);
 * staff: buildStaffIndex. Returns (tokenData) -> null | { as, startNumbers }
 * with as 'driver' | 'official' | 'public'.
 */
export function buildAudienceMatcher({ audience = {}, driverRecipients = [], officialRecipients = [], staff = null } = {}) {
    const drivers = new Map();
    driverRecipients.forEach((r) => {
        const key = emailHash(r.email);
        drivers.set(key, [...new Set([...(drivers.get(key) || []), ...list(r.startNumbers)])]);
    });
    const listedOfficials = new Set(officialRecipients.map((r) => emailHash(r.email)));
    const byUid = staff?.byUid || new Map();
    const byEmailHash = staff?.byEmailHash || new Map();
    const wanted = audience.officials?.all ? null : new Set(list(audience.officials?.roles).map(normalizeRole));

    return (data = {}) => {
        const hash = data.emailHash || null;
        if (audience.drivers && hash && drivers.has(hash)) {
            return { as: 'driver', startNumbers: drivers.get(hash) };
        }
        if (audience.officials) {
            const roles = new Set([...(byUid.get(data.uid) || []), ...((hash && byEmailHash.get(hash)) || [])]);
            const listed = !!hash && listedOfficials.has(hash);
            const byRole = wanted === null ? roles.size > 0 : [...wanted].some((r) => roles.has(r));
            if (listed || byRole) return { as: 'official', startNumbers: [] };
        }
        if (audience.everyone) return { as: 'public', startNumbers: [] };
        return null;
    };
}

/**
 * The devices to send to: in the audience and following the topic. An
 * essential competition message reaches devices that switched 'messages'
 * off (as essential mail ignores the opt-out); every other topic is the
 * device's own choice. tokens: [{ id, data }].
 * -> { targets: [{ id, token, lang, as, startNumbers }], matched, skippedTopic }
 */
export function selectPushTargets({ tokens = [], matcher, topic, category = 'info' }) {
    const bypassTopic = category === 'essential' && topic === 'messages';
    const seen = new Set();
    const targets = [];
    let matched = 0;
    let skippedTopic = 0;
    tokens.forEach(({ id, data = {} }) => {
        if (seen.has(id) || !isValidPushToken(data.token)) return;
        seen.add(id);
        const match = matcher(data);
        if (!match) return;
        matched++;
        if (!bypassTopic && !list(data.topics).includes(topic)) {
            skippedTopic++;
            return;
        }
        targets.push({ id, token: data.token, lang: normalizePushLang(data.lang), as: match.as, startNumbers: match.startNumbers || [] });
    });
    return { targets, matched, skippedTopic };
}

// --- Content ---

/** A text in the device's language: a string, or { sv, en } */
export function localized(value, lang = 'sv') {
    if (value && typeof value === 'object') return String(value[lang] || value.sv || value.en || '');
    return String(value ?? '');
}

const HASH_ROUTE = /^#[a-z][a-z0-9-]{0,40}(\?[A-Za-z0-9_=&%.\-]{0,200})?$/;

/** An in-app route (a hash route of this app), else the hub */
export function safePushRoute(url) {
    const value = String(url ?? '').trim();
    return HASH_ROUTE.test(value) ? value : '#hub';
}

/** The route a recipient opens: the portal for drivers, the officials' page for officials */
export function routeFor(as, compId) {
    const id = encodeURIComponent(String(compId ?? ''));
    if (as === 'driver') return `#portal?id=${id}`;
    if (as === 'official') return `#official?id=${id}`;
    return `#competition-center?id=${id}`;
}

/**
 * The FCM message (without tokens) for one language and route.
 * content: { title, body, url, tag }; options: topic, ttlSec, urgency, appUrl.
 * Both a notification (title, body, icon, tag) and data (url, tag, topic):
 * the service worker shows it from either.
 */
export function buildPushMessage({ title, body, url, tag = '' }, { topic = '', ttlSec = PUSH_LIMITS.ttlDefaultSec, urgency = 'normal', appUrl = '' } = {}) {
    const route = safePushRoute(url);
    const cleanTag = cleanLine(tag, 64).replace(/[^\w\-:.]/g, '');
    const notification = {
        title: cleanLine(title, PUSH_LIMITS.titleMax) || 'DriveLive',
        body: cleanText(body, PUSH_LIMITS.bodyMax),
        icon: PUSH_ICON,
        badge: PUSH_BADGE
    };
    if (cleanTag) notification.tag = cleanTag;
    const webpush = {
        headers: { TTL: String(Math.max(0, Math.round(ttlSec))), Urgency: urgency === 'high' ? 'high' : 'normal' },
        notification,
        data: { url: route, tag: cleanTag, topic: String(topic || '') }
    };
    // FCM wants an absolute https link; the app's own worker uses data.url
    if (/^https:\/\//i.test(appUrl)) webpush.fcmOptions = { link: `${appUrl.replace(/\/+$/, '')}/${route}` };
    return { webpush };
}

/** Delivery options per topic: a pause is urgent and short-lived */
export function deliveryOptions(topic) {
    return topic === 'pause'
        ? { ttlSec: PUSH_LIMITS.ttlPauseSec, urgency: 'high' }
        : { ttlSec: PUSH_LIMITS.ttlDefaultSec, urgency: 'normal' };
}

/**
 * The targets grouped by identical message (sendEachForMulticast takes one
 * message for many tokens), at most 500 tokens a group.
 * contentFor(target) -> { title, body, url, tag } (strings for its language).
 */
export function groupPushMessages(targets = [], contentFor, options = {}) {
    const groups = new Map();
    targets.forEach((target) => {
        const message = buildPushMessage(contentFor(target), options);
        const key = JSON.stringify(message);
        const group = groups.get(key) || { message, targets: [] };
        group.targets.push(target);
        groups.set(key, group);
    });
    const out = [];
    groups.forEach(({ message, targets: members }) => {
        for (let i = 0; i < members.length; i += PUSH_LIMITS.multicastMax) {
            out.push({ message, targets: members.slice(i, i + PUSH_LIMITS.multicastMax) });
        }
    });
    return out;
}

/**
 * One multicast's outcome. responses: sendEachForMulticast's responses (same
 * order as targets). Dead tokens are removed, except when every response
 * failed with invalid-argument: then the message itself was wrong, not the tokens.
 */
export function summarizeMulticast(targets = [], responses = []) {
    let sent = 0;
    let failed = 0;
    const dead = [];
    const codes = {};
    responses.forEach((res, i) => {
        if (res?.success) {
            sent++;
            return;
        }
        failed++;
        const code = String(res?.error?.code || 'unknown');
        codes[code] = (codes[code] || 0) + 1;
        if (DEAD_TOKEN_CODES.includes(code) && targets[i]) dead.push(targets[i].id);
    });
    const allInvalidArgument = failed > 0 && failed === responses.length && codes['messaging/invalid-argument'] === failed;
    return { sent, failed, removeIds: allInvalidArgument ? [] : dead, codes };
}

// --- Producers' texts ---

const PAUSE_REASONS = {
    accident: { sv: 'Olycka', en: 'Accident' },
    vet: { sv: 'Veterinär', en: 'Vet' },
    course: { sv: 'Banproblem', en: 'Course problem' },
    weather: { sv: 'Väder', en: 'Weather' },
    other: { sv: 'Annat', en: 'Other' }
};

const openPause = (log) => list(log).find((p) => p && p.start && p.end == null) || null;

/**
 * Pauses started or ended by a write of config/globalStatus.pauseLog.
 * -> [{ kind: 'start' | 'end', entry }]
 */
export function pauseTransitions(beforeLog, afterLog) {
    const before = openPause(beforeLog);
    const after = openPause(afterLog);
    const out = [];
    if (before && (!after || after.start !== before.start)) {
        const closed = list(afterLog).find((p) => p && p.start === before.start && p.end);
        if (closed) out.push({ kind: 'end', entry: closed });
    }
    if (after && (!before || before.start !== after.start)) out.push({ kind: 'start', entry: after });
    return out;
}

const STOCKHOLM_TIME = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });

function clockOf(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : STOCKHOLM_TIME.format(date);
}

function describeWhere(where, lang) {
    const [kind, rest] = String(where || '').split(':');
    if (!kind) return '';
    if (kind === 'obstacle') return lang === 'en' ? `Obstacle ${rest || ''}`.trim() : `Hinder ${rest || ''}`.trim();
    if (kind === 'section') return lang === 'en' ? `Section ${rest || ''}`.trim() : `Sträcka ${rest || ''}`.trim();
    if (kind === 'secretariat') return lang === 'en' ? 'Secretariat' : 'Sekretariatet';
    return cleanLine(where, 60);
}

/** The pause notice in the device's language */
export function buildPauseContent(kind, entry = {}, lang = 'sv') {
    const en = lang === 'en';
    const time = clockOf(kind === 'end' ? entry.end : entry.start);
    if (kind === 'end') {
        const minutes = Number.isFinite(Number(entry.durationSec)) && entry.durationSec !== null
            ? Math.max(1, Math.round(Number(entry.durationSec) / 60)) : null;
        return {
            title: en ? 'Competition resumed' : 'Tävlingen återupptagen',
            body: [
                en ? `The pause ended${time ? ` at ${time}` : ''}. Clocks run again.` : `Pausen slutade${time ? ` kl ${time}` : ''}. Klockorna går igen.`,
                minutes ? (en ? `Pause: ${minutes} min.` : `Paus: ${minutes} min.`) : ''
            ].filter(Boolean).join(' ')
        };
    }
    const reason = entry.reason ? localized(PAUSE_REASONS[entry.reason] || PAUSE_REASONS.other, lang) : '';
    const note = cleanLine(entry.note, 200);
    const where = describeWhere(entry.where, lang);
    const details = [[reason, note].filter(Boolean).join(' – '), where].filter(Boolean).join(' · ');
    return {
        title: en ? 'Competition paused' : 'Tävlingen pausad',
        body: [
            en ? `Paused${time ? ` at ${time}` : ''}. All marathon clocks are stopped.` : `Pausad${time ? ` kl ${time}` : ''}. Alla maratonklockor står still.`,
            details
        ].filter(Boolean).join(' ')
    };
}

/** The vet decision notice (the inbox message's text in Swedish, a short one in English) */
export function buildVetDecisionContent(message = {}, lang = 'sv') {
    const startNumber = cleanLine(list(message.targetStartNumbers)[0], 20);
    if (lang === 'en') {
        return {
            title: `Vet decision – equipage #${startNumber}`,
            body: 'There is a new vet decision about the equipage. Open DriveLive for details.'
        };
    }
    return { title: cleanLine(message.title, PUSH_LIMITS.titleMax), body: cleanText(message.body, PUSH_LIMITS.bodyMax) };
}

/** The declaration change notice for the staff (staffNotifications declarationChange) */
export function buildDeclarationChangeContent(notice = {}, lang = 'sv') {
    const startNumber = cleanLine(notice.startNumber, 20);
    const flag = notice.newHorseAfterVet === true
        ? (lang === 'en' ? ' – New horse after the vet inspection.' : ' – Ny häst efter veterinärbesiktningen.')
        : '';
    return {
        title: lang === 'en' ? `Declaration changed – #${startNumber}` : `Ändrad deklaration – #${startNumber}`,
        body: `${cleanLine(notice.summary, PUSH_LIMITS.bodyMax - 60)}${flag}`
    };
}

/** A competition message in the device's language (titleEn/bodyEn when given) */
export function buildMessageContent(message = {}, lang = 'sv') {
    const en = lang === 'en';
    return {
        title: cleanLine((en && message.titleEn) || message.title || message.titleEn, PUSH_LIMITS.titleMax) || (en ? 'Message' : 'Meddelande'),
        body: cleanText((en && message.bodyEn) || message.body || message.bodyEn, PUSH_LIMITS.bodyMax)
    };
}

/**
 * Per start number texts for start time pushes, checked:
 * [{ startNumber, text, textEn? }] -> { [startNumber]: { sv, en } }
 */
export function normalizeStartTimeChanges(changes) {
    const items = list(changes);
    if (!items.length) throw new PushError('Inga ändrade starttider.');
    if (items.length > 1000) throw new PushError('För många startnummer.');
    const texts = {};
    items.forEach((item) => {
        const startNumber = String(item?.startNumber ?? '').trim();
        if (!/^[\w-]{1,20}$/.test(startNumber)) throw new PushError('Ogiltigt startnummer.');
        const sv = cleanLine(item?.text, PUSH_LIMITS.personalTextMax);
        const en = cleanLine(item?.textEn, PUSH_LIMITS.personalTextMax) || sv;
        if (!sv) throw new PushError(`Text saknas för startnummer ${startNumber}.`);
        const prev = texts[startNumber];
        texts[startNumber] = prev ? { sv: `${prev.sv}\n${sv}`, en: `${prev.en}\n${en}` } : { sv, en };
    });
    return texts;
}

/** A driver's own start time lines (their start numbers only) */
export function buildStartTimeContent(texts = {}, startNumbers = [], lang = 'sv') {
    const lines = list(startNumbers).map((s) => texts[s]?.[lang === 'en' ? 'en' : 'sv']).filter(Boolean);
    return {
        title: lang === 'en' ? 'Start time changed' : 'Ändrad starttid',
        body: lines.join('\n')
    };
}
