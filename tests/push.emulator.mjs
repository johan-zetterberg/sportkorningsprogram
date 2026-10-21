// Web push (functions/src/push/pushService.js) against the Firestore emulator
// with a fake messaging object (no network): nothing sent before a VAPID key
// is saved, devices registered per account and competition, the audience
// resolved from the competition's own documents, topics, languages, dead
// tokens removed, the daily cap, idempotency by key, the push log without
// tokens, and the retention clean-up. npm run test:restore (not part of npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    PUSH_TOKENS,
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
import { PUSH_LIMITS, buildMessageContent, messagePushAudience, pushTokenId } from '../functions/src/push/pushCore.js';

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

    // A draft: a public message reaches drivers (their audience) but not followers
    await db.doc(pub).update({ published: false });
    await register('fan2', { topics: ['messages'] });
    const draftCalls = fakeMessaging();
    await sendPushToAudience(db, draftCalls, {
        appId: APP_ID, compId: COMP, audience: { everyone: true, drivers: { all: true } }, topic: 'messages', title: 't', body: 'b', logger: quietLogger
    });
    const draftTokens = draftCalls.calls.flatMap((c) => c.tokens);
    assert.ok(draftTokens.includes(TOKEN('anna')));
    assert.ok(!draftTokens.includes(TOKEN('fan2')));
    await db.doc(pub).update({ published: true });
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
    await savePushSettings(db, { competitionDailyLimit: PUSH_LIMITS.competitionDailyDefault });
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
