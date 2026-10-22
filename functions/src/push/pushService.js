// Web push with the database and the messaging client passed in (db,
// FieldValue, messaging), so the emulator test (tests/push.emulator.mjs) runs
// the same code as the functions with a fake messaging object. Pure parts:
// pushCore.js. Nothing is sent until a superadmin saved a VAPID key and
// switched push on (appSettings/push); before that every send returns
// { status: 'disabled' } quietly.
//
// Paths
//   appSettings/push            { vapidKey, enabled, appUrl, competitionDailyLimit }
//                               (public read: the key is not secret; server writes)
//   pushTokens/{tokenId}        one device: uid, token, emailHash, topics, lang,
//                               platform, competitions [appId__compId], lastSeenMs
//                               (server only)
//   artifacts/{app}/private/data/competitions/{comp}/
//     pushLog/{id}              one summary per send (counts only, no tokens)
//     rateLimits/push_day       the competition's daily counter
import { mailDayKey, reserveDailyQuota } from '../mail/mailCore.js';
import { competitionPath, privateCompetitionPath, resolveMailRecipients } from '../mail/mailService.js';
import {
    PUSH_LIMITS,
    buildAudienceMatcher,
    buildStaffIndex,
    buildTokenDoc,
    competitionKey,
    deliveryOptions,
    groupPushMessages,
    inheritRenewedToken,
    isStaleToken,
    localized,
    normalizePushSettings,
    normalizeTopics,
    publicRegistration,
    pushAvailable,
    pushTokenId,
    routeFor,
    selectPushTargets,
    summarizeMulticast,
    tokensOverUserCap
} from './pushCore.js';

export const PUSH_SETTINGS_DOC = 'appSettings/push';
export const PUSH_TOKENS = 'pushTokens';
export const PUSH_DAY_COUNTER = 'push_day';
export const pushLogPath = (appId, compId) => `${privateCompetitionPath(appId, compId)}/pushLog`;

export async function loadPushSettings(db) {
    const snap = await db.doc(PUSH_SETTINGS_DOC).get();
    if (!snap.exists) return null;
    try {
        return normalizePushSettings({}, snap.data() || {});
    } catch {
        // Switched on without a valid key: treated as off
        return { ...snap.data(), enabled: false };
    }
}

/** Saves the settings from setPushSettings (checked in pushCore) and returns them */
export async function savePushSettings(db, raw, { uid = null, now = Date.now() } = {}) {
    const ref = db.doc(PUSH_SETTINGS_DOC);
    const snap = await ref.get();
    const settings = normalizePushSettings(raw || {}, snap.exists ? snap.data() : {});
    await ref.set({ ...settings, updatedAt: now, updatedBy: uid });
    return settings;
}

/**
 * Registers (or refreshes) a device for an account. competition: { appId,
 * compId } or null; topics: checked list or null (kept). email: the verified
 * login address or '' (drivers are matched by it). previousToken: the token
 * this device had before the browser renewed it; its topics and competitions
 * carry over (same account only) and its doc is removed, in the same
 * transaction. The account's oldest devices beyond the cap are removed (logged).
 */
export async function registerPushToken(db, { uid, email = '', token, previousToken = null, topics = null, platform, lang, competition = null, logger = console, now = Date.now() }) {
    const id = pushTokenId(token);
    const ref = db.collection(PUSH_TOKENS).doc(id);
    const previousRef = previousToken && previousToken !== token ? db.collection(PUSH_TOKENS).doc(pushTokenId(previousToken)) : null;
    const key = competition ? competitionKey(competition.appId, competition.compId) : null;
    const { doc, carried } = await db.runTransaction(async (tx) => {
        const [snap, previousSnap] = await Promise.all([tx.get(ref), previousRef ? tx.get(previousRef) : null]);
        const existing = snap.exists ? snap.data() : null;
        // Holding the old token is the proof, as for unregisterPushToken
        const previous = previousSnap?.exists && previousSnap.data()?.token === previousToken && previousSnap.data()?.uid === uid
            ? previousSnap.data() : null;
        const base = previous ? inheritRenewedToken({ existing, previous, uid }) : existing;
        const next = buildTokenDoc({ existing: base, uid, email, token, topics: topics ? normalizeTopics(topics) : null, platform, lang, competition: key, now });
        tx.set(ref, next);
        if (previous) tx.delete(previousRef);
        return { doc: next, carried: !!previous };
    });
    const own = await db.collection(PUSH_TOKENS).where('uid', '==', uid).select('lastSeenMs').get();
    const extra = tokensOverUserCap(own.docs.map((d) => ({ id: d.id, data: d.data() })));
    if (extra.length) {
        logger.warn('Push: kontots äldsta enheter togs bort (för många enheter)', { uid, removed: extra.length, max: PUSH_LIMITS.maxTokensPerUser });
        await Promise.all(extra.map((tokenDocId) => db.collection(PUSH_TOKENS).doc(tokenDocId).delete()));
    }
    return { ...publicRegistration(doc), renewed: carried };
}

/**
 * Stops pushes to a device: from one competition (competition given) or
 * altogether. Holding the token is the proof (it is only on that device).
 */
export async function unregisterPushToken(db, FieldValue, { token, competition = null }) {
    const ref = db.collection(PUSH_TOKENS).doc(pushTokenId(token));
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.token !== token) return { removed: false };
    if (competition) {
        await ref.update({ competitions: FieldValue.arrayRemove(competitionKey(competition.appId, competition.compId)), updatedAtMs: Date.now() });
        return { removed: true, scope: 'competition' };
    }
    await ref.delete();
    return { removed: true, scope: 'device' };
}

/** A device's registration as its owner may see it (getPushRegistration) */
export async function readPushRegistration(db, { token, uid = null, appId = null }) {
    const snap = await db.collection(PUSH_TOKENS).doc(pushTokenId(token)).get();
    const data = snap.exists ? snap.data() : null;
    if (!data || data.token !== token || (uid && data.uid !== uid)) return publicRegistration(null);
    return publicRegistration(data, appId);
}

/** The devices following a competition */
export async function loadCompetitionTokens(db, appId, compId) {
    const snap = await db.collection(PUSH_TOKENS).where('competitions', 'array-contains', competitionKey(appId, compId)).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/** The matcher for an audience from the competition's own documents (the same as e-mail) */
export async function buildCompetitionMatcher(db, appId, compId, audience, competitionData = {}) {
    const base = competitionPath(appId, compId);
    const [driverResolved, officialResolved, adminsSnap, roleEmailsSnap] = await Promise.all([
        audience.drivers ? resolveMailRecipients(db, appId, compId, { audience: { drivers: audience.drivers } }) : null,
        audience.officials ? resolveMailRecipients(db, appId, compId, { audience: { officials: audience.officials } }) : null,
        audience.officials ? db.collection(`${base}/admins`).get() : null,
        audience.officials ? db.collection(`${base}/roleEmails`).get() : null
    ]);
    const docs = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, data: d.data() })) : []);
    return buildAudienceMatcher({
        audience,
        driverRecipients: driverResolved?.recipients || [],
        officialRecipients: officialResolved?.recipients || [],
        staff: buildStaffIndex({ competition: competitionData, admins: docs(adminsSnap), roleEmails: docs(roleEmailsSnap) })
    });
}

async function reservePushQuota(db, { appId, compId, count, limit, now }) {
    const ref = db.doc(`${privateCompetitionPath(appId, compId)}/rateLimits/${PUSH_DAY_COUNTER}`);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const result = reserveDailyQuota(snap.exists ? snap.data() : null, mailDayKey(now), count, limit, now);
        if (result.allowed) tx.set(ref, result.next);
        return result;
    });
}

const isAlreadyExists = (error) => error?.code === 6 || /ALREADY_EXISTS/i.test(String(error?.message || ''));

// A push log left in 'sending' this long is taken as a run that stopped
// half-way (a send takes seconds; the callables and triggers time out in minutes)
export const PUSH_SENDING_TAKEOVER_MS = 10 * 60 * 1000;
// Send calls (each up to 500 devices) at a time
const PUSH_SEND_CONCURRENCY = 4;
// A write batch takes 500 operations
const DELETE_BATCH = 400;

/** Claims a dedupe log left in 'sending' by a stopped run: true when taken over */
export async function takeOverStalePushLog(db, logRef, now = Date.now()) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(logRef);
        const data = snap.exists ? snap.data() : null;
        if (!data || data.status !== 'sending') return false;
        const claimed = Number(data.claimedAtMs) || Number(data.atMs) || 0;
        if (now - claimed < PUSH_SENDING_TAKEOVER_MS) return false;
        tx.update(logRef, { claimedAtMs: now, takeovers: (Number(data.takeovers) || 0) + 1 });
        return true;
    });
}

/** Deletes token docs in batches of at most DELETE_BATCH */
async function deleteTokenDocs(db, ids) {
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        const writer = db.batch();
        ids.slice(i, i + DELETE_BATCH).forEach((id) => writer.delete(db.collection(PUSH_TOKENS).doc(id)));
        await writer.commit();
    }
}

/**
 * Sends a notification to the devices of an audience in one competition.
 *   audience  { everyone?, drivers?, officials? } (mailCore normalizeAudience
 *             shapes; everyone = every device following the competition)
 *   category  'info' | 'essential' (essential messages ignore a device's
 *             'messages' opt-out, pushCore selectPushTargets)
 *   topic     one of PUSH_TOPICS: only devices following it get it
 *   title, body   strings or { sv, en }; url: a hash route (default: per
 *             recipient, the portal for drivers and the officials' page)
 *   content(target, lang) -> { title, body, url? } for per-recipient texts
 *   tag       replaces an earlier notification with the same tag
 *   dedupeKey the log id: a second call with it sends nothing (triggers)
 * Respects the daily cap (all or nothing), removes dead tokens and writes
 * one pushLog entry (counts only). Returns { status, ...counts }.
 */
export async function sendPushToAudience(db, messaging, {
    appId, compId, audience, category = 'info', topic, title = '', body = '', url = null, tag = '',
    content = null, source = null, dedupeKey = null, createdBy = 'system',
    logger = console, now = Date.now()
}) {
    const settings = await loadPushSettings(db);
    if (!pushAvailable(settings) || !messaging) return { status: 'disabled' };
    if (!audience) return { status: 'no_audience' };
    const compSnap = await db.doc(competitionPath(appId, compId)).get();
    if (!compSnap.exists || compSnap.data()?.deleting === true) return { status: 'no_competition' };
    // A draft is not public yet: its public messages reach its drivers and staff only
    if (audience.everyone && compSnap.data()?.published === false) {
        audience = { ...audience, everyone: false };
    }
    const tokens = await loadCompetitionTokens(db, appId, compId);
    if (!tokens.length) return { status: 'no_tokens' };

    const matcher = await buildCompetitionMatcher(db, appId, compId, audience, compSnap.data() || {});
    const { targets, matched, skippedTopic } = selectPushTargets({ tokens, matcher, topic, category });
    if (!targets.length) return { status: 'no_targets', matched, skippedTopic };

    const logCollection = db.collection(pushLogPath(appId, compId));
    const logRef = dedupeKey ? logCollection.doc(String(dedupeKey).replace(/[^\w\-]/g, '_').slice(0, 200)) : logCollection.doc();
    const baseLog = {
        topic, category, source: source || null, createdBy,
        devices: tokens.length, matched, skippedTopic, targeted: targets.length, atMs: now
    };
    try {
        await logRef.create({ ...baseLog, status: 'sending', claimedAtMs: now });
    } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        // A run that stopped half-way (the instance crashed after claiming)
        // left 'sending': a re-delivered event takes it over after a while
        // instead of losing the notice
        if (!(await takeOverStalePushLog(db, logRef, now))) return { status: 'duplicate' };
        logger.warn('Push: avbrutet utskick tas över', { appId, compId, topic, logId: logRef.id });
    }
    const finish = async (update) => {
        await logRef.set({ ...baseLog, ...update, finishedAtMs: Date.now() });
        return { status: update.status, matched, skippedTopic, targeted: targets.length, sent: update.sent || 0, failed: update.failed || 0, removedTokens: update.removedTokens || 0 };
    };

    const limit = Number(settings.competitionDailyLimit) || PUSH_LIMITS.competitionDailyDefault;
    const quota = await reservePushQuota(db, { appId, compId, count: targets.length, limit, now });
    if (!quota.allowed) {
        return finish({ status: 'blocked', error: `Dagens gräns för push-notiser är nådd (${quota.remaining} av ${limit} kvar).` });
    }

    const contentFor = (target) => {
        const own = content ? content(target, target.lang) || {} : {};
        return {
            title: own.title ?? localized(title, target.lang),
            body: own.body ?? localized(body, target.lang),
            url: own.url || url || routeFor(target.as, compId),
            tag
        };
    };
    const groups = groupPushMessages(targets, contentFor, { topic, appUrl: settings.appUrl, ...deliveryOptions(topic) });
    let sent = 0;
    let failed = 0;
    const removeIds = new Set();
    const codes = {};
    // One call per batch: [{ targets, send }]. Messages shared by several
    // devices go as a multicast; personal ones (start times: one per driver)
    // are gathered into sendEach batches of 500, not sent one by one
    const batches = [];
    const singles = [];
    groups.forEach((group) => {
        if (group.targets.length === 1 && typeof messaging.sendEach === 'function') singles.push(group);
        else batches.push({ targets: group.targets, send: () => messaging.sendEachForMulticast({ ...group.message, tokens: group.targets.map((t) => t.token) }) });
    });
    for (let i = 0; i < singles.length; i += PUSH_LIMITS.multicastMax) {
        const chunk = singles.slice(i, i + PUSH_LIMITS.multicastMax);
        batches.push({ targets: chunk.map((g) => g.targets[0]), send: () => messaging.sendEach(chunk.map((g) => ({ ...g.message, token: g.targets[0].token }))) });
    }
    const runBatch = async (batch) => {
        try {
            const response = await batch.send();
            const summary = summarizeMulticast(batch.targets, response?.responses || []);
            sent += summary.sent;
            failed += summary.failed;
            summary.removeIds.forEach((id) => removeIds.add(id));
            Object.entries(summary.codes).forEach(([code, n]) => { codes[code] = (codes[code] || 0) + n; });
        } catch (error) {
            failed += batch.targets.length;
            const code = String(error?.code || 'send-error');
            codes[code] = (codes[code] || 0) + batch.targets.length;
            logger.error('Push kunde inte skickas', { appId, compId, topic, error: String(error?.message || error) });
        }
    };
    for (let i = 0; i < batches.length; i += PUSH_SEND_CONCURRENCY) {
        await Promise.all(batches.slice(i, i + PUSH_SEND_CONCURRENCY).map(runBatch));
    }
    if (removeIds.size) await deleteTokenDocs(db, [...removeIds]);
    const status = !failed ? 'sent' : (sent ? 'partial' : 'failed');
    return finish({ status, sent, failed, removedTokens: removeIds.size, errorCodes: codes });
}

/** Sends to one account's own devices (sendTestPush); no audience, no cap */
export async function sendPushToUser(db, messaging, { uid, title, body, url = '#hub', tag = 'test', logger = console }) {
    const settings = await loadPushSettings(db);
    if (!pushAvailable(settings) || !messaging) return { status: 'disabled', sent: 0, failed: 0 };
    const snap = await db.collection(PUSH_TOKENS).where('uid', '==', uid).get();
    const targets = snap.docs.map((d) => ({ id: d.id, token: d.data().token, lang: d.data().lang || 'sv', as: 'self' }))
        .filter((t) => typeof t.token === 'string');
    if (!targets.length) return { status: 'no_tokens', sent: 0, failed: 0 };
    const groups = groupPushMessages(targets, (t) => ({ title: localized(title, t.lang), body: localized(body, t.lang), url, tag }), { topic: 'test', appUrl: settings.appUrl, ...deliveryOptions('test') });
    let sent = 0;
    let failed = 0;
    const removeIds = [];
    for (const group of groups) {
        try {
            const response = await messaging.sendEachForMulticast({ ...group.message, tokens: group.targets.map((t) => t.token) });
            const summary = summarizeMulticast(group.targets, response?.responses || []);
            sent += summary.sent;
            failed += summary.failed;
            removeIds.push(...summary.removeIds);
        } catch (error) {
            failed += group.targets.length;
            logger.error('Testpush kunde inte skickas', { error: String(error?.message || error) });
        }
    }
    if (removeIds.length) await deleteTokenDocs(db, removeIds);
    return { status: failed ? (sent ? 'partial' : 'failed') : 'sent', sent, failed, removedTokens: removeIds.length };
}

// --- Retention and deletion ---

/** Drops devices not seen in 60 days (the app refreshes lastSeenMs when opened) */
export async function purgeStaleTokens(db, { nowMs = Date.now(), maxAgeMs = PUSH_LIMITS.staleTokenMs } = {}) {
    const snap = await db.collection(PUSH_TOKENS).where('lastSeenMs', '<', nowMs - maxAgeMs).get();
    const stale = snap.docs.filter((d) => isStaleToken(d.data(), nowMs, maxAgeMs));
    if (!stale.length) return 0;
    const writer = db.bulkWriter();
    stale.forEach((d) => writer.delete(d.ref));
    await writer.close();
    return stale.length;
}

/** A purged or deleted competition is no longer followed by any device */
export async function removeCompetitionFromTokens(db, FieldValue, appId, compId) {
    const key = competitionKey(appId, compId);
    const snap = await db.collection(PUSH_TOKENS).where('competitions', 'array-contains', key).get();
    if (snap.empty) return 0;
    const writer = db.bulkWriter();
    snap.docs.forEach((d) => writer.update(d.ref, { competitions: FieldValue.arrayRemove(key) }));
    await writer.close();
    return snap.size;
}

/** All devices of an account (deleteMyAccount) */
export async function deleteUserTokens(db, uid) {
    const snap = await db.collection(PUSH_TOKENS).where('uid', '==', uid).get();
    if (snap.empty) return 0;
    const writer = db.bulkWriter();
    snap.docs.forEach((d) => writer.delete(d.ref));
    await writer.close();
    return snap.size;
}
