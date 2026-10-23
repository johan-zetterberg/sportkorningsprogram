// Web push (functions/src/push/pushService.js) against the Firestore emulator
// with a fake messaging object (no network): nothing sent before a VAPID key
// is saved, devices registered per account and competition, the audience
// resolved from the competition's own documents, topics, languages, dead
// tokens removed, the daily cap, idempotency by key, the push log without
// tokens, and the retention clean-up. npm run test:restore (not part of npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mailDayKey } from '../functions/src/mail/mailCore.js';
import {
    PUSH_SENDING_TAKEOVER_MS,
    PUSH_TOKENS,
    countPushTargets,
    deleteUserTokens,
    loadCompetitionTokens,
    purgeStaleTokens,
    readPushRegistration,
    registerPushToken,
    removeCompetitionFromTokens,
    savePushSettings,
    sendPushToAudience,
    sendPushToUser,
    unregisterPushToken
} from '../functions/src/push/pushService.js';
import {
    PAUSE_PUSH_AUDIENCE,
    PUSH_LIMITS,
    buildMessageContent,
    buildPauseContent,
    buildStartTimeContent,
    messagePushAudience,
    normalizeStartTimeChanges,
    pushTokenId,
    startTimePushTag
} from '../functions/src/push/pushCore.js';

const PROJECT_ID = 'demo-combined-driving';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('FIRESTORE_EMULATOR_HOST saknas: kör via npm run test:restore');
    process.exit(1);
}

const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, getApps } = requireFromFunctions('firebase-admin/app');
const { getFirestore, FieldValue } = requireFromFunctions('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const APP_ID = 'push-test-app';
const run = Date.now();
const COMP = `pushcomp-${run}`;
const pub = `artifacts/${APP_ID}/public/data/competitions/${COMP}`;
const priv = `artifacts/${APP_ID}/private/data/competitions/${COMP}`;
const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };
const VAPID = `B${'q'.repeat(86)}`;
const uid = (name) => `${name}-${run}`;
const TOKEN = (name) => `tok-${name}-${run}-${'y'.repeat(24)}`;

// The fake FCM: records each multicast; tokens in `dead` are unregistered
function fakeMessaging(dead = new Set()) {
    const calls = [];
    return {
        calls,
        async sendEachForMulticast(message) {
            calls.push(message);
            return {
                responses: message.tokens.map((token) => (dead.has(token)
                    ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
                    : { success: true, messageId: `m-${token.slice(0, 12)}` }))
            };
        }
    };
}

async function seed() {
    await db.doc(pub).set({ name: 'Pushtävlingen', createdBy: uid('owner') });
    const equipages = { 1: ['Anna', 'anna@example.se'], 2: ['Bo', 'bo@example.se'] };
    for (const [sn, [driverName, email]] of Object.entries(equipages)) {
        await db.doc(`${pub}/equipages/${sn}`).set({ driverName, className: 'Lätt B' });
        await db.doc(`${pub}/equipagePrivate/${sn}`).set({ email });
    }
    await db.doc(`${pub}/admins/${uid('vet')}`).set({ role: 'vet', roles: ['vet'] });
    await db.doc(`${pub}/admins/${uid('mar')}`).set({ role: 'marathon', roles: ['marathon'] });
}

const register = (name, { email = '', topics, lang = 'sv', competition = true } = {}) => registerPushToken(db, {
    uid: uid(name), email, token: TOKEN(name), topics, platform: 'android', lang,
    competition: competition ? { appId: APP_ID, compId: COMP } : null
});

test('push: nothing is sent before a VAPID key is saved and push switched on', async () => {
    await seed();
    await db.doc('appSettings/push').delete();
    await register('anna', { email: 'anna@example.se', topics: ['messages'] });
    const messaging = fakeMessaging();
    const result = await sendPushToAudience(db, messaging, {
        appId: APP_ID, compId: COMP, audience: { drivers: { all: true } }, topic: 'messages', title: 'Hej', body: 'x', logger: quietLogger
    });
    assert.equal(result.status, 'disabled');
    assert.equal(messaging.calls.length, 0);
    // A key without enabled: still off
    await savePushSettings(db, { vapidKey: VAPID });
    assert.equal((await sendPushToAudience(db, messaging, {
        appId: APP_ID, compId: COMP, audience: { drivers: { all: true } }, topic: 'messages', title: 'Hej', body: 'x', logger: quietLogger
    })).status, 'disabled');
    assert.equal(messaging.calls.length, 0);
});

test('push: devices are registered per account; the token is only in its own server-side doc', async () => {
    const reg = await register('anna', { email: 'anna@example.se', topics: ['messages', 'startTimes'], lang: 'en' });
    assert.deepEqual(reg.topics, ['startTimes', 'messages']);
    assert.deepEqual(reg.competitions, [COMP]);
    const stored = (await db.collection(PUSH_TOKENS).doc(pushTokenId(TOKEN('anna'))).get()).data();
    assert.equal(stored.uid, uid('anna'));
    assert.equal(stored.lang, 'en');
    assert.ok(stored.emailHash && !JSON.stringify(stored).includes('anna@example.se'), 'no address stored');
    // Topics only: the competitions are kept
    const again = await registerPushToken(db, { uid: uid('anna'), email: 'anna@example.se', token: TOKEN('anna'), topics: ['messages', 'startTimes', 'vetDecision'], lang: 'en' });
    assert.deepEqual(again.competitions, [COMP]);
    assert.deepEqual((await readPushRegistration(db, { token: TOKEN('anna'), uid: uid('anna') })).topics, ['startTimes', 'messages', 'vetDecision']);
    // Someone else's account cannot read it
    assert.equal((await readPushRegistration(db, { token: TOKEN('anna'), uid: uid('other') })).registered, false);
});

test('push: audiences reach drivers, officials and followers by topic and language; dead tokens go; log has no tokens', async () => {
    await savePushSettings(db, { vapidKey: VAPID, enabled: true, appUrl: 'https://app.example' });
    await register('bo', { email: 'bo@example.se', topics: ['messages'] });
    await register('vet', { email: 'vet@example.se', topics: ['vetDecision', 'messages'] });
    await register('mar', { topics: ['pause'] });
    await register('owner', { topics: ['pause', 'declarationChanges'] });
    await register('fan', { topics: ['messages'] });
    await register('quiet', { topics: [] });
    await register('elsewhere', { topics: ['messages'], competition: false });

    // A public message: every follower of the competition, drivers as drivers
    const message = { title: 'Välkomna', body: 'Hej alla', titleEn: 'Welcome', bodyEn: 'Hello all', audience: { public: true, drivers: true, officials: false, officialRoles: [] } };
    const dead = new Set([TOKEN('fan')]);
    const messaging = fakeMessaging(dead);
    const result = await sendPushToAudience(db, messaging, {
        appId: APP_ID, compId: COMP, audience: messagePushAudience(message), topic: 'messages',
        content: (_t, lang) => buildMessageContent(message, lang), tag: 'msg-1', source: 'message', dedupeKey: `msg-${run}`, logger: quietLogger
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.targeted, 4, 'anna, bo, vet, fan');
    assert.equal(result.sent, 3);
    assert.equal(result.removedTokens, 1);
    const sentTo = messaging.calls.flatMap((c) => c.tokens).sort();
    assert.deepEqual(sentTo, [TOKEN('anna'), TOKEN('bo'), TOKEN('fan'), TOKEN('vet')].sort());
    const annaCall = messaging.calls.find((c) => c.tokens.includes(TOKEN('anna')));
    assert.equal(annaCall.webpush.notification.title, 'Welcome', 'her device is in English');
    assert.equal(annaCall.webpush.data.url, `#portal?id=${COMP}`);
    assert.equal(annaCall.webpush.fcmOptions.link, `https://app.example/#portal?id=${COMP}`);
    const fanCall = messaging.calls.find((c) => c.tokens.includes(TOKEN('fan')));
    assert.equal(fanCall.webpush.notification.title, 'Välkomna');
    assert.equal(fanCall.webpush.data.url, `#competition-center?id=${COMP}`);
    // The dead token is gone; the log has counts only
    assert.equal((await db.collection(PUSH_TOKENS).doc(pushTokenId(TOKEN('fan'))).get()).exists, false);
    const log = (await db.doc(`${priv}/pushLog/msg-${run}`).get()).data();
    assert.equal(log.status, 'partial');
    assert.equal(log.sent, 3);
    assert.equal(log.removedTokens, 1);
    assert.ok(!JSON.stringify(log).includes('tok-'), 'no tokens in the log');

    // The same key again (a redelivered trigger): nothing sent twice
    const before = messaging.calls.length;
    assert.equal((await sendPushToAudience(db, messaging, {
        appId: APP_ID, compId: COMP, audience: messagePushAudience(message), topic: 'messages',
        content: (_t, lang) => buildMessageContent(message, lang), dedupeKey: `msg-${run}`, logger: quietLogger
    })).status, 'duplicate');
    assert.equal(messaging.calls.length, before);
});

test('push: officials by system role, pause urgent; vet decision to the driver and the vet; drafts keep public messages in', async () => {
    const messaging = fakeMessaging();
    const pause = await sendPushToAudience(db, messaging, {
        appId: APP_ID, compId: COMP, audience: { officials: { all: true } }, category: 'essential', topic: 'pause',
        title: { sv: 'Tävlingen pausad', en: 'Competition paused' }, body: 'x', tag: 'pause', dedupeKey: `pause-${run}`, logger: quietLogger
    });
    assert.equal(pause.status, 'sent');
    const pauseTokens = messaging.calls.flatMap((c) => c.tokens).sort();
    assert.deepEqual(pauseTokens, [TOKEN('mar'), TOKEN('owner')].sort(), 'the vet does not follow pauses; quiet follows nothing');
    assert.equal(messaging.calls[0].webpush.headers.Urgency, 'high');
    assert.equal(messaging.calls[0].webpush.headers.TTL, String(PUSH_LIMITS.ttlPauseSec));
    assert.equal(messaging.calls[0].webpush.data.url, `#official?id=${COMP}`);

    const vetCalls = fakeMessaging();
    const vet = await sendPushToAudience(db, vetCalls, {
        appId: APP_ID, compId: COMP, category: 'essential', topic: 'vetDecision',
        audience: { drivers: { classes: [], startNumbers: ['1'], includeWithdrawn: true }, officials: { roles: ['admin', 'td', 'vet'] } },
        content: (target, lang) => ({ title: `${target.as}:${lang}`, body: 'b' }), dedupeKey: `vet-${run}`, logger: quietLogger
    });
    assert.equal(vet.targeted, 2);
    const titles = vetCalls.calls.map((c) => [c.webpush.notification.title, c.tokens]).sort();
    assert.deepEqual(titles, [['driver:en', [TOKEN('anna')]], ['official:sv', [TOKEN('vet')]]]);

    // A draft: a public message reaches drivers (their audience) and the
    // officials, but not followers
    await db.doc(pub).update({ published: false });
    await register('fan2', { topics: ['messages'] });
    const draftCalls = fakeMessaging();
    await sendPushToAudience(db, draftCalls, {
        appId: APP_ID, compId: COMP, audience: { everyone: true, drivers: { all: true } }, topic: 'messages', title: 't', body: 'b', logger: quietLogger
    });
    const draftTokens = draftCalls.calls.flatMap((c) => c.tokens);
    assert.ok(draftTokens.includes(TOKEN('anna')));
    assert.ok(draftTokens.includes(TOKEN('vet')));
    assert.ok(!draftTokens.includes(TOKEN('fan2')));
    await db.doc(pub).update({ published: true });
});

test('push: a pause reaches drivers too, with their own text; start times one notice per driver and tag; counting', async () => {
    await register('bo2', { email: 'bo@example.se', topics: ['pause', 'startTimes'] });
    const messaging = fakeMessaging();
    const entry = { start: '2026-05-16T08:05:00.000Z', reason: 'weather', note: 'Hinder 3 stängt' };
    const pause = await sendPushToAudience(db, messaging, {
        appId: APP_ID, compId: COMP, audience: PAUSE_PUSH_AUDIENCE, category: 'essential', topic: 'pause',
        content: (target, lang) => buildPauseContent('start', entry, lang, target.as), tag: 'pause', dedupeKey: `pause-drv-${run}`, logger: quietLogger
    });
    assert.equal(pause.status, 'sent');
    const byToken = new Map(messaging.calls.flatMap((c) => c.tokens.map((tok) => [tok, c])));
    assert.deepEqual([...byToken.keys()].sort(), [TOKEN('bo2'), TOKEN('mar'), TOKEN('owner')].sort(), 'drivers following pauses and the officials');
    assert.equal(byToken.get(TOKEN('bo2')).webpush.notification.title, 'Tävlingen är pausad: Väder');
    assert.ok(!byToken.get(TOKEN('bo2')).webpush.notification.body.includes('Hinder 3'), 'the note stays with the officials');
    assert.equal(byToken.get(TOKEN('bo2')).webpush.data.url, `#portal?id=${COMP}`);
    assert.match(byToken.get(TOKEN('mar')).webpush.notification.body, /Hinder 3 stängt/);

    // Changed start times: each driver's own lines and tag (per save)
    const texts = normalizeStartTimeChanges([{ startNumber: '1', text: 'Dressyr 09:10 → 09:30', textEn: 'Dressage 09:10 → 09:30' }, { startNumber: '2', text: 'Dressyr 10:00 → 10:10' }]);
    const startCalls = fakeMessaging();
    const audience = { drivers: { classes: [], startNumbers: ['1', '2'], includeWithdrawn: true } };
    const sent = await sendPushToAudience(db, startCalls, {
        appId: APP_ID, compId: COMP, audience, category: 'essential', topic: 'startTimes',
        content: (target, lang) => ({ ...buildStartTimeContent(texts, target.startNumbers, lang), tag: startTimePushTag(target.startNumbers, `req${run}`) }),
        tag: 'start-time', dedupeKey: `starttimes-req${run}`, logger: quietLogger
    });
    assert.equal(sent.targeted, 2);
    const anna = startCalls.calls.find((c) => c.tokens.includes(TOKEN('anna')));
    const bo = startCalls.calls.find((c) => c.tokens.includes(TOKEN('bo2')));
    assert.equal(anna.webpush.notification.body, 'Dressage 09:10 → 09:30');
    assert.equal(bo.webpush.notification.body, 'Dressyr 10:00 → 10:10');
    assert.notEqual(anna.webpush.notification.tag, bo.webpush.notification.tag);
    assert.match(bo.webpush.notification.tag, /^start-time-2-req/);
    // The same request id again: nothing twice
    assert.equal((await sendPushToAudience(db, startCalls, {
        appId: APP_ID, compId: COMP, audience, topic: 'startTimes', title: 't', body: 'b', dedupeKey: `starttimes-req${run}`, logger: quietLogger
    })).status, 'duplicate');

    // Counting for the admin's dialog, without sending
    assert.deepEqual(await countPushTargets(db, { appId: APP_ID, compId: COMP, audience, topic: 'startTimes', category: 'essential' }), { available: true, devices: 2 });
    assert.deepEqual(await countPushTargets(db, { appId: APP_ID, compId: COMP, audience: null, topic: 'startTimes' }), { available: true, devices: 0 });
});

test('push: the daily cap is all or nothing and logged', async () => {
    await savePushSettings(db, { competitionDailyLimit: 1 });
    await db.doc(`${priv}/rateLimits/push_day`).delete();
    const messaging = fakeMessaging();
    const result = await sendPushToAudience(db, messaging, {
        appId: APP_ID, compId: COMP, audience: { drivers: { all: true } }, topic: 'messages', title: 't', body: 'b', dedupeKey: `cap-${run}`, logger: quietLogger
    });
    assert.equal(result.status, 'blocked');
    assert.equal(messaging.calls.length, 0);
    assert.equal((await db.doc(`${priv}/pushLog/cap-${run}`).get()).data().status, 'blocked');

    // The essential reserve: at 70 of 100 other notices stop, start times go on
    await savePushSettings(db, { competitionDailyLimit: 100 });
    await db.doc(`${priv}/rateLimits/push_day`).set({ dayKey: mailDayKey(Date.now()), count: 70, updatedAt: Date.now() });
    const bulk = await sendPushToAudience(db, fakeMessaging(), {
        appId: APP_ID, compId: COMP, audience: { drivers: { all: true } }, topic: 'messages', title: 't', body: 'b', dedupeKey: `reserve-msg-${run}`, logger: quietLogger
    });
    assert.equal(bulk.status, 'blocked');
    const essential = await sendPushToAudience(db, fakeMessaging(), {
        appId: APP_ID, compId: COMP, audience: { drivers: { all: true } }, category: 'essential', topic: 'startTimes', title: 't', body: 'b', dedupeKey: `reserve-st-${run}`, logger: quietLogger
    });
    assert.ok(['sent', 'partial'].includes(essential.status), essential.status);
    await db.doc(`${priv}/rateLimits/push_day`).delete();
    await savePushSettings(db, { competitionDailyLimit: PUSH_LIMITS.competitionDailyDefault });
});

test('push: a renewed token keeps the topics and competitions of the old one (same account only)', async () => {
    const other = { appId: APP_ID, compId: `${COMP}-b` };
    await registerPushToken(db, { uid: uid('renew'), token: TOKEN('renew-old'), topics: ['startTimes', 'pause'], competition: other });
    await registerPushToken(db, { uid: uid('renew'), token: TOKEN('renew-old'), competition: { appId: APP_ID, compId: COMP } });
    const renewed = await registerPushToken(db, { uid: uid('renew'), token: TOKEN('renew-new'), previousToken: TOKEN('renew-old'), logger: quietLogger });
    assert.equal(renewed.renewed, true);
    assert.deepEqual(renewed.topics, ['startTimes', 'pause']);
    assert.deepEqual([...renewed.competitions].sort(), [COMP, `${COMP}-b`].sort());
    assert.equal((await db.collection(PUSH_TOKENS).doc(pushTokenId(TOKEN('renew-old'))).get()).exists, false, 'the old doc is gone');
    // Someone else's old token is neither copied nor removed
    await registerPushToken(db, { uid: uid('stranger'), token: TOKEN('stranger-old'), topics: ['messages'], competition: other });
    const notMine = await registerPushToken(db, { uid: uid('renew'), token: TOKEN('renew-new2'), previousToken: TOKEN('stranger-old'), logger: quietLogger });
    assert.equal(notMine.renewed, false);
    assert.deepEqual(notMine.competitions, []);
    assert.equal((await db.collection(PUSH_TOKENS).doc(pushTokenId(TOKEN('stranger-old'))).get()).exists, true);
});

test('push: personal notices go in sendEach batches; a stopped run is taken over; a fresh one is a duplicate', async () => {
    const messaging = fakeMessaging();
    const eachCalls = [];
    messaging.sendEach = async (messages) => {
        eachCalls.push(messages);
        return { responses: messages.map(() => ({ success: true })) };
    };
    const vetLike = {
        appId: APP_ID, compId: COMP, category: 'essential', topic: 'vetDecision',
        audience: { drivers: { classes: [], startNumbers: ['1'], includeWithdrawn: true }, officials: { roles: ['admin', 'td', 'vet'] } },
        content: (target, lang) => ({ title: `${target.as}:${lang}`, body: 'b' }), logger: quietLogger
    };
    const result = await sendPushToAudience(db, messaging, { ...vetLike, dedupeKey: `each-${run}` });
    assert.equal(result.sent, 2);
    assert.equal(eachCalls.length, 1, 'both personal messages in one sendEach call');
    assert.equal(messaging.calls.length, 0);
    assert.deepEqual(eachCalls[0].map((m) => m.token).sort(), [TOKEN('anna'), TOKEN('vet')].sort());

    // A run that claimed the log and stopped: a fresh claim stands, an old one is taken over
    const logRef = db.doc(`${priv}/pushLog/stuck-${run}`);
    await logRef.set({ status: 'sending', atMs: Date.now(), claimedAtMs: Date.now() });
    assert.equal((await sendPushToAudience(db, messaging, { ...vetLike, dedupeKey: `stuck-${run}` })).status, 'duplicate');
    await logRef.set({ status: 'sending', atMs: Date.now() - PUSH_SENDING_TAKEOVER_MS - 1000, claimedAtMs: Date.now() - PUSH_SENDING_TAKEOVER_MS - 1000 });
    const taken = await sendPushToAudience(db, messaging, { ...vetLike, dedupeKey: `stuck-${run}` });
    assert.equal(taken.status, 'sent');
    assert.equal((await logRef.get()).data().status, 'sent');
});

test('push: a test to the own devices; unregistering; retention and account deletion', async () => {
    const messaging = fakeMessaging();
    const test1 = await sendPushToUser(db, messaging, { uid: uid('anna'), title: { sv: 'Test', en: 'Test EN' }, body: 'b', logger: quietLogger });
    assert.equal(test1.sent, 1);
    assert.equal(messaging.calls[0].webpush.notification.title, 'Test EN');

    // Unregister from the competition, then the device
    assert.deepEqual(await unregisterPushToken(db, FieldValue, { token: TOKEN('bo'), competition: { appId: APP_ID, compId: COMP } }), { removed: true, scope: 'competition' });
    assert.ok(!(await loadCompetitionTokens(db, APP_ID, COMP)).some((t) => t.data.token === TOKEN('bo')));
    assert.deepEqual(await unregisterPushToken(db, FieldValue, { token: TOKEN('bo') }), { removed: true, scope: 'device' });
    assert.deepEqual(await unregisterPushToken(db, FieldValue, { token: TOKEN('bo') }), { removed: false });

    // 60 days unseen: dropped
    await db.collection(PUSH_TOKENS).doc(pushTokenId(TOKEN('quiet'))).update({ lastSeenMs: Date.now() - PUSH_LIMITS.staleTokenMs - 1000 });
    assert.ok(await purgeStaleTokens(db) >= 1);
    assert.equal((await db.collection(PUSH_TOKENS).doc(pushTokenId(TOKEN('quiet'))).get()).exists, false);
    assert.equal((await db.collection(PUSH_TOKENS).doc(pushTokenId(TOKEN('anna'))).get()).exists, true);

    // A purged competition is unfollowed; an account's devices go with it
    assert.ok(await removeCompetitionFromTokens(db, FieldValue, APP_ID, COMP) >= 3);
    assert.equal((await loadCompetitionTokens(db, APP_ID, COMP)).length, 0);
    assert.equal(await deleteUserTokens(db, uid('anna')), 1);
    assert.equal((await db.collection(PUSH_TOKENS).doc(pushTokenId(TOKEN('anna'))).get()).exists, false);

    // Clean up this run's devices and the settings
    const left = await db.collection(PUSH_TOKENS).get();
    await Promise.all(left.docs.filter((d) => String(d.data().uid).endsWith(`-${run}`)).map((d) => d.ref.delete()));
    await db.doc('appSettings/push').delete();
});
