// Web push: the pure parts of the server (functions/src/push/pushCore.js) and
// the device helpers (js/utils/pushUtils.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PUSH_LIMITS,
    PUSH_TOPICS,
    PushError,
    buildAudienceMatcher,
    buildDeclarationChangeContent,
    buildMessageContent,
    buildPauseContent,
    buildPushMessage,
    buildStaffIndex,
    buildStartTimeContent,
    buildTokenDoc,
    buildVetDecisionContent,
    competitionKey,
    groupPushMessages,
    isStaleToken,
    isValidPushToken,
    messagePushAudience,
    normalizePushSettings,
    normalizeStartTimeChanges,
    normalizeTopics,
    parseCompetitionKey,
    pauseTransitions,
    publicRegistration,
    pushAvailable,
    pushTokenId,
    safePushRoute,
    selectPushTargets,
    summarizeMulticast,
    tokensOverUserCap
} from '../functions/src/push/pushCore.js';
import { emailHash, resolveRecipients } from '../functions/src/mail/mailCore.js';
import { RETENTION_PRIVATE_TREE_COLLECTIONS } from '../functions/src/personalData.js';
import * as client from '../js/utils/pushUtils.js';

const TOKEN = (n) => `fcm-token-${n}-${'x'.repeat(30)}`;
const VAPID = `B${'a'.repeat(86)}`;

test('tokens: shape, hashed id (the token never is an id), registration doc', () => {
    assert.equal(isValidPushToken(TOKEN(1)), true);
    assert.equal(isValidPushToken('short'), false);
    assert.equal(isValidPushToken(`${TOKEN(1)} <script>`), false);
    assert.equal(isValidPushToken('x'.repeat(PUSH_LIMITS.tokenMax + 1)), false);
    assert.match(pushTokenId(TOKEN(1)), /^[0-9a-f]{40}$/);
    assert.notEqual(pushTokenId(TOKEN(1)), pushTokenId(TOKEN(2)));

    const first = buildTokenDoc({ uid: 'u1', email: 'Anna@Example.se', token: TOKEN(1), topics: ['messages'], platform: 'ANDROID', lang: 'en-GB', competition: 'app__c1', now: 100 });
    assert.deepEqual(first, {
        uid: 'u1', token: TOKEN(1), emailHash: emailHash('anna@example.se'), topics: ['messages'], platform: 'android', lang: 'en',
        competitions: ['app__c1'], createdAtMs: 100, lastSeenMs: 100, updatedAtMs: 100
    });
    // Same owner: competitions kept (latest first), topics kept when not given
    const again = buildTokenDoc({ existing: first, uid: 'u1', email: '', token: TOKEN(1), topics: null, platform: 'x', lang: 'sv', competition: 'app__c2', now: 200 });
    assert.deepEqual(again.competitions, ['app__c2', 'app__c1']);
    assert.deepEqual(again.topics, ['messages']);
    assert.equal(again.createdAtMs, 100);
    assert.equal(again.emailHash, null);
    assert.equal(again.platform, 'other');
    // Another account in the same browser starts over
    const moved = buildTokenDoc({ existing: first, uid: 'u2', token: TOKEN(1), topics: null, competition: null, now: 300 });
    assert.deepEqual(moved.competitions, []);
    assert.deepEqual(moved.topics, []);
    assert.equal(moved.createdAtMs, 300);
    // Capped
    let doc = null;
    for (let i = 0; i < PUSH_LIMITS.maxCompetitionsPerToken + 5; i++) {
        doc = buildTokenDoc({ existing: doc, uid: 'u1', token: TOKEN(1), topics: [], competition: `app__c${i}`, now: i });
    }
    assert.equal(doc.competitions.length, PUSH_LIMITS.maxCompetitionsPerToken);
    assert.equal(doc.competitions[0], `app__c${PUSH_LIMITS.maxCompetitionsPerToken + 4}`);

    assert.deepEqual(parseCompetitionKey(competitionKey('drivelive', 'comp-1')), { appId: 'drivelive', compId: 'comp-1' });
    assert.equal(parseCompetitionKey('nope'), null);
    assert.deepEqual(publicRegistration(first), { registered: true, topics: ['messages'], competitions: ['c1'], lang: 'en', lastSeenMs: 100 });
    assert.equal(JSON.stringify(publicRegistration(first)).includes(TOKEN(1)), false);
    assert.deepEqual(publicRegistration(null), { registered: false, topics: [], competitions: [] });
});

test('topics are checked; stale tokens and the per-account cap', () => {
    assert.deepEqual(normalizeTopics(['pause', 'messages', 'pause', ' startTimes ']), ['startTimes', 'messages', 'pause']);
    assert.deepEqual(normalizeTopics([]), []);
    assert.throws(() => normalizeTopics(['messages', 'spam']), PushError);
    assert.throws(() => normalizeTopics('messages'), PushError);
    assert.deepEqual(client.normalizeTopics(['results', 'nope', 'messages']), ['messages', 'results']);
    assert.deepEqual([...client.PUSH_TOPICS], PUSH_TOPICS, 'the device and the server know the same topics');

    const now = 100 * 24 * 3600 * 1000;
    assert.equal(isStaleToken({ lastSeenMs: now - PUSH_LIMITS.staleTokenMs - 1 }, now), true);
    assert.equal(isStaleToken({ lastSeenMs: now - 1000 }, now), false);
    const tokens = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, data: { lastSeenMs: i } }));
    assert.deepEqual(tokensOverUserCap(tokens, 10).sort(), ['t0', 't1']);
});

test('settings: the public VAPID key, on only with a key, https app url', () => {
    assert.deepEqual(normalizePushSettings({ vapidKey: `${VAPID}=`, enabled: true, appUrl: 'https://app.example/' }), {
        vapidKey: VAPID, enabled: true, appUrl: 'https://app.example', competitionDailyLimit: PUSH_LIMITS.competitionDailyDefault
    });
    assert.throws(() => normalizePushSettings({ vapidKey: 'short' }), PushError);
    assert.throws(() => normalizePushSettings({ enabled: true }), PushError);
    assert.throws(() => normalizePushSettings({ vapidKey: VAPID, appUrl: 'http://x.se' }), PushError);
    assert.throws(() => normalizePushSettings({ vapidKey: VAPID, competitionDailyLimit: 0 }), PushError);
    // Left out: kept; cleared: off
    const kept = normalizePushSettings({ enabled: false }, { vapidKey: VAPID, enabled: true, competitionDailyLimit: 9 });
    assert.deepEqual(kept, { vapidKey: VAPID, enabled: false, appUrl: '', competitionDailyLimit: 9 });
    assert.throws(() => normalizePushSettings({ clearVapidKey: true }, { vapidKey: VAPID, enabled: true }), PushError);
    assert.equal(normalizePushSettings({ clearVapidKey: true, enabled: false }, { vapidKey: VAPID }).vapidKey, '');
    assert.equal(pushAvailable(null), false);
    assert.equal(pushAvailable({ vapidKey: VAPID, enabled: false }), false);
    assert.equal(pushAvailable({ vapidKey: VAPID, enabled: true }), true);
    assert.equal(client.isValidVapidKey(VAPID), true);
});

test('a competition message as a push audience (as the driver inbox reads it)', () => {
    assert.deepEqual(messagePushAudience({ audience: { public: true, drivers: true, officials: false, officialRoles: [] }, targetStartNumbers: [] }),
        { everyone: true, drivers: { all: true, includeWithdrawn: false } });
    assert.deepEqual(messagePushAudience({ audience: { public: false, drivers: true }, targetStartNumbers: ['3', '7'] }),
        { drivers: { classes: [], startNumbers: ['3', '7'], includeWithdrawn: true } });
    assert.deepEqual(messagePushAudience({ audience: { public: false, drivers: false, officials: true, officialRoles: [] } }),
        { officials: { all: true } });
    assert.deepEqual(messagePushAudience({ audience: { public: false, drivers: false, officials: true, officialRoles: ['secretariat', 'vet'] } }),
        { officials: { roles: ['admin', 'vet'] } });
    // An officials message without drivers: true reaches no driver (driverInbox.js)
    assert.deepEqual(messagePushAudience({ audience: { public: false, officials: true } }), { officials: { all: true } });
    // Legacy: no audience = everyone; one target = that driver only
    assert.deepEqual(messagePushAudience({}), { everyone: true, drivers: { all: true, includeWithdrawn: false } });
    assert.deepEqual(messagePushAudience({ targetStartNumber: 5 }), { drivers: { classes: [], startNumbers: ['5'], includeWithdrawn: true } });
    assert.equal(messagePushAudience({ audience: { public: false, drivers: false, officials: false } }), null);
});

function fixture() {
    const equipages = [
        { id: '1', data: { driverName: 'Anna', className: 'Lätt B' } },
        { id: '2', data: { driverName: 'Bo', className: 'Lätt B', status: 'struken' } },
        { id: '3', data: { driverName: 'Anna', className: 'Msv' } }
    ];
    const equipagePrivate = new Map([['1', { email: 'anna@ex.se' }], ['2', { email: 'bo@ex.se' }], ['3', { contactEmail: 'Anna@ex.se' }]]);
    const officials = [{ id: 'o1', data: { name: 'Olle', role: 'marathon' } }];
    const officialsPrivate = new Map([['o1', { email: 'olle@ex.se' }]]);
    const staff = buildStaffIndex({
        competition: { createdBy: 'owner', admins: ['adm2'] },
        admins: [{ id: 'vet1', data: { role: 'vet', roles: ['vet'] } }, { id: 'td1', data: { roles: ['td'] } }, { id: 'none', data: {} }],
        roleEmails: [{ id: 'speaker@ex.se', data: { roles: ['speaker'] } }]
    });
    const tokenDoc = (id, uid, email, topics = PUSH_TOPICS, lang = 'sv') => ({
        id, data: { uid, token: TOKEN(id), emailHash: email ? emailHash(email) : null, topics, lang }
    });
    const tokens = [
        tokenDoc('anna-phone', 'ua', 'anna@ex.se', ['messages', 'startTimes'], 'en'),
        tokenDoc('bo-phone', 'ub', 'bo@ex.se', ['messages']),
        tokenDoc('olle', 'uo', 'olle@ex.se', ['pause', 'messages']),
        tokenDoc('vet', 'vet1', 'vet@ex.se', ['vetDecision', 'messages']),
        tokenDoc('td', 'td1', '', ['vetDecision', 'pause']),
        tokenDoc('owner', 'owner', '', ['declarationChanges', 'pause']),
        tokenDoc('speaker', 'us', 'speaker@ex.se', ['pause']),
        tokenDoc('fan', 'anon', '', ['messages']),
        tokenDoc('none', 'none', '', ['pause'])
    ];
    return { equipages, equipagePrivate, officials, officialsPrivate, staff, tokens };
}

function matcherFor(audience, f) {
    const drivers = audience.drivers ? resolveRecipients({ audience: { drivers: audience.drivers }, equipages: f.equipages, equipagePrivate: f.equipagePrivate }).recipients : [];
    const officials = audience.officials ? resolveRecipients({ audience: { officials: audience.officials }, officials: f.officials, officialsPrivate: f.officialsPrivate }).recipients : [];
    return buildAudienceMatcher({ audience, driverRecipients: drivers, officialRecipients: officials, staff: f.staff });
}

const ids = (result) => result.targets.map((t) => t.id).sort();

test('audience -> devices: drivers by their address, officials by system roles and the officials list, topics', () => {
    const f = fixture();
    // All drivers (withdrawn left out unless named), topic messages
    let result = selectPushTargets({ tokens: f.tokens, matcher: matcherFor({ drivers: { all: true } }, f), topic: 'messages' });
    assert.deepEqual(ids(result), ['anna-phone']);
    const anna = result.targets[0];
    assert.equal(anna.as, 'driver');
    assert.deepEqual(anna.startNumbers, ['1', '3'], 'both of her equipages (email and contactEmail)');
    assert.equal(anna.lang, 'en');

    // Named start numbers include the withdrawn one
    result = selectPushTargets({ tokens: f.tokens, matcher: matcherFor({ drivers: { classes: [], startNumbers: ['2'], includeWithdrawn: true } }, f), topic: 'messages' });
    assert.deepEqual(ids(result), ['bo-phone']);
    assert.deepEqual(result.targets[0].startNumbers, ['2']);

    // All officials: system roles (admins docs, owner, roleEmails) and the officials list
    result = selectPushTargets({ tokens: f.tokens, matcher: matcherFor({ officials: { all: true } }, f), topic: 'pause' });
    assert.deepEqual(ids(result), ['olle', 'owner', 'speaker', 'td']);
    assert.ok(result.targets.every((t) => t.as === 'official'));
    assert.equal(result.skippedTopic, 1, 'the vet does not follow pauses');

    // Roles: the secretariat is the admin role
    result = selectPushTargets({ tokens: f.tokens, matcher: matcherFor({ officials: { roles: ['admin', 'td', 'vet'] } }, f), topic: 'vetDecision' });
    assert.deepEqual(ids(result), ['td', 'vet']);
    assert.equal(result.skippedTopic, 1, 'the owner does not follow vet decisions');
    result = selectPushTargets({ tokens: f.tokens, matcher: matcherFor({ officials: { roles: ['secretariat'] } }, f), topic: 'declarationChanges' });
    assert.deepEqual(ids(result), ['owner']);
    // An officials-list role (free text on the officials doc)
    result = selectPushTargets({ tokens: f.tokens, matcher: matcherFor({ officials: { roles: ['marathon'] } }, f), topic: 'pause' });
    assert.deepEqual(ids(result), ['olle']);

    // Everyone: every device following the competition, the driver as a driver
    result = selectPushTargets({ tokens: f.tokens, matcher: matcherFor({ everyone: true, drivers: { all: true } }, f), topic: 'messages' });
    assert.deepEqual(ids(result), ['anna-phone', 'bo-phone', 'fan', 'olle', 'vet']);
    assert.equal(result.targets.find((t) => t.id === 'anna-phone').as, 'driver');
    assert.equal(result.targets.find((t) => t.id === 'fan').as, 'public');
    assert.equal(result.targets.find((t) => t.id === 'olle').as, 'public', 'not asked for as an official');

    // A device with no address and no role is no driver or official
    result = selectPushTargets({ tokens: f.tokens, matcher: matcherFor({ drivers: { all: true }, officials: { all: true } }, f), topic: 'pause' });
    assert.ok(!ids(result).includes('none'));
});

test('essential competition messages reach devices that switched messages off; other topics stay the device\'s choice', () => {
    const f = fixture();
    const matcher = matcherFor({ officials: { roles: ['td'] } }, f);
    assert.deepEqual(ids(selectPushTargets({ tokens: f.tokens, matcher, topic: 'messages', category: 'info' })), []);
    assert.deepEqual(ids(selectPushTargets({ tokens: f.tokens, matcher, topic: 'messages', category: 'essential' })), ['td']);
    const driverMatcher = matcherFor({ drivers: { classes: [], startNumbers: ['2'], includeWithdrawn: true } }, f);
    assert.deepEqual(ids(selectPushTargets({ tokens: f.tokens, matcher: driverMatcher, topic: 'startTimes', category: 'essential' })), []);
    // The same device twice and a broken token: once / never
    const twice = [...f.tokens, f.tokens[0], { id: 'bad', data: { uid: 'ua', token: 'bad', emailHash: emailHash('anna@ex.se'), topics: ['messages'] } }];
    assert.deepEqual(ids(selectPushTargets({ tokens: twice, matcher: matcherFor({ drivers: { all: true } }, f), topic: 'messages' })), ['anna-phone']);
});

test('the FCM message: notification and data, icon, in-app route only, TTL and urgency per topic', () => {
    const message = buildPushMessage({ title: ' Hej\n alla ', body: 'Text', url: '#portal?id=comp-1', tag: 'msg-1' },
        { topic: 'pause', ttlSec: 3600, urgency: 'high', appUrl: 'https://app.example/' });
    assert.deepEqual(message, {
        webpush: {
            headers: { TTL: '3600', Urgency: 'high' },
            notification: { title: 'Hej alla', body: 'Text', icon: '/icons/DriveLive_192.png', badge: '/icons/DriveLive_192.png', tag: 'msg-1' },
            data: { url: '#portal?id=comp-1', tag: 'msg-1', topic: 'pause' },
            fcmOptions: { link: 'https://app.example/#portal?id=comp-1' }
        }
    });
    // Data values are strings (FCM requires it)
    assert.ok(Object.values(message.webpush.data).every((v) => typeof v === 'string'));
    // Never another site or a script URL
    for (const url of ['https://evil.example', 'javascript:alert(1)', '//evil', '#portal?id=<x>', '']) {
        assert.equal(safePushRoute(url), '#hub', url);
        assert.equal(buildPushMessage({ title: 't', body: 'b', url }).webpush.data.url, '#hub');
    }
    // No https app url: no fcmOptions link; long texts cut; default title
    const plain = buildPushMessage({ title: '', body: 'x'.repeat(1000), url: '#hub' });
    assert.equal(plain.webpush.fcmOptions, undefined);
    assert.equal(plain.webpush.notification.title, 'DriveLive');
    assert.equal(plain.webpush.notification.body.length, PUSH_LIMITS.bodyMax);
    assert.equal(plain.webpush.headers.TTL, String(PUSH_LIMITS.ttlDefaultSec));
    assert.equal(plain.webpush.headers.Urgency, 'normal');
});

test('grouping per identical message, at most 500 tokens per multicast', () => {
    const targets = Array.from({ length: 1203 }, (_, i) => ({ id: `t${i}`, token: TOKEN(i), lang: i % 2 ? 'en' : 'sv', as: 'driver' }));
    const groups = groupPushMessages(targets, (t) => ({ title: t.lang === 'en' ? 'Hi' : 'Hej', body: 'b', url: '#hub' }));
    assert.equal(groups.reduce((n, g) => n + g.targets.length, 0), 1203);
    assert.ok(groups.every((g) => g.targets.length <= 500));
    assert.deepEqual(groups.map((g) => g.targets.length).sort((a, b) => a - b), [101, 102, 500, 500]);
    assert.ok(groups.every((g) => g.targets.every((t) => (t.lang === 'en') === (g.message.webpush.notification.title === 'Hi'))));
});

test('dead tokens are removed, unless every token failed with invalid-argument (a bad message)', () => {
    const targets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const fail = (code) => ({ success: false, error: { code } });
    const summary = summarizeMulticast(targets, [
        { success: true }, fail('messaging/registration-token-not-registered'), fail('messaging/internal-error'), fail('messaging/invalid-argument')
    ]);
    assert.deepEqual(summary, {
        sent: 1, failed: 3, removeIds: ['b', 'd'],
        codes: { 'messaging/registration-token-not-registered': 1, 'messaging/internal-error': 1, 'messaging/invalid-argument': 1 }
    });
    assert.deepEqual(summarizeMulticast(targets.slice(0, 2), [fail('messaging/invalid-argument'), fail('messaging/invalid-argument')]).removeIds, []);
    assert.deepEqual(summarizeMulticast(targets.slice(0, 1), [fail('messaging/invalid-registration-token')]).removeIds, ['a']);
});

test('pause start and end from the pause log, in Swedish and English', () => {
    const open = { start: '2026-10-21T08:05:00Z', end: null, reason: 'accident', note: 'Häst omkullkörd', where: 'obstacle:3' };
    const closed = { ...open, end: '2026-10-21T08:17:00Z', durationSec: 720 };
    assert.deepEqual(pauseTransitions([], [open]), [{ kind: 'start', entry: open }]);
    assert.deepEqual(pauseTransitions([open], [closed]), [{ kind: 'end', entry: closed }]);
    assert.deepEqual(pauseTransitions([open], [open]), []);
    assert.deepEqual(pauseTransitions([closed], [closed, { ...closed, start: 'x' }]), [], 'a closed entry added by an admin');
    assert.deepEqual(pauseTransitions(null, undefined), []);

    const sv = buildPauseContent('start', open, 'sv');
    assert.equal(sv.title, 'Tävlingen pausad');
    assert.match(sv.body, /kl 10:05/);
    assert.match(sv.body, /Olycka – Häst omkullkörd · Hinder 3/);
    const en = buildPauseContent('start', open, 'en');
    assert.equal(en.title, 'Competition paused');
    assert.match(en.body, /Accident – Häst omkullkörd · Obstacle 3/);
    assert.match(buildPauseContent('end', closed, 'sv').body, /kl 10:17.*Paus: 12 min/);
    assert.equal(buildPauseContent('end', closed, 'en').title, 'Competition resumed');
});

test('texts: messages, vet decisions, declaration changes and each driver\'s own start times', () => {
    assert.deepEqual(buildMessageContent({ title: 'Hej', body: 'Text', titleEn: 'Hi', bodyEn: 'Body' }, 'en'), { title: 'Hi', body: 'Body' });
    assert.deepEqual(buildMessageContent({ title: 'Hej', body: 'Text' }, 'en'), { title: 'Hej', body: 'Text' });
    const vet = { title: 'Veterinärbeslut – ekipage #4', body: 'Lång text', targetStartNumbers: ['4'] };
    assert.deepEqual(buildVetDecisionContent(vet, 'sv'), { title: vet.title, body: 'Lång text' });
    assert.match(buildVetDecisionContent(vet, 'en').title, /#4/);
    const decl = buildDeclarationChangeContent({ startNumber: '7', summary: '#7 Anna: häst bytt', newHorseAfterVet: true }, 'sv');
    assert.equal(decl.title, 'Ändrad deklaration – #7');
    assert.match(decl.body, /häst bytt – Ny häst efter veterinärbesiktningen\./);

    const texts = normalizeStartTimeChanges([
        { startNumber: '1', text: 'Dressyr 09:10 → 09:30', textEn: 'Dressage 09:10 → 09:30' },
        { startNumber: '1', text: 'Maraton 12:00 → 12:20' },
        { startNumber: '3', text: 'Dressyr 10:00 → 10:10' }
    ]);
    assert.deepEqual(texts['1'], { sv: 'Dressyr 09:10 → 09:30\nMaraton 12:00 → 12:20', en: 'Dressage 09:10 → 09:30\nMaraton 12:00 → 12:20' });
    assert.deepEqual(buildStartTimeContent(texts, ['1'], 'sv'), { title: 'Ändrad starttid', body: 'Dressyr 09:10 → 09:30\nMaraton 12:00 → 12:20' });
    assert.equal(buildStartTimeContent(texts, ['3', '9'], 'en').body, 'Dressyr 10:00 → 10:10');
    assert.throws(() => normalizeStartTimeChanges([]), PushError);
    assert.throws(() => normalizeStartTimeChanges([{ startNumber: '1 2', text: 'x' }]), PushError);
    assert.throws(() => normalizeStartTimeChanges([{ startNumber: '1', text: ' ' }]), PushError);
});

test('the push log is deleted with the competition\'s private data', () => {
    assert.ok(RETENTION_PRIVATE_TREE_COLLECTIONS.includes('pushLog'));
});

test('device: iPhone/iPad needs 16.4 and the home screen app; support reasons', () => {
    const iphone = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.replace('_', '.')} Mobile/15E148 Safari/604.1`;
    const ipadDesktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
    const mac = ipadDesktop;
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

    assert.equal(client.iosPushDecision({ userAgent: android }), 'not-ios');
    assert.equal(client.iosPushDecision({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 0 }), 'not-ios');
    assert.equal(client.iosPushDecision({ userAgent: iphone('16_3') }), 'unsupported-version');
    assert.equal(client.iosPushDecision({ userAgent: iphone('16_4') }), 'add-to-home-screen');
    assert.equal(client.iosPushDecision({ userAgent: iphone('17_1'), standalone: true }), 'ok');
    assert.equal(client.iosPushDecision({ userAgent: ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 }), 'add-to-home-screen');
    assert.equal(client.iosPushDecision({ userAgent: ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5, standalone: true }), 'ok');
    assert.deepEqual(client.parseIosVersion(iphone('16_4')), [16, 4]);

    const full = { isSecureContext: true, hasServiceWorker: true, hasPushManager: true, hasNotification: true };
    assert.deepEqual(client.pushSupport({ ...full, userAgent: android }), { supported: true, reason: null, ios: 'not-ios' });
    assert.equal(client.pushSupport({ ...full, isSecureContext: false, userAgent: android }).reason, 'insecure');
    assert.equal(client.pushSupport({ ...full, hasPushManager: false, userAgent: android }).reason, 'no-push-manager');
    assert.equal(client.pushSupport({ ...full, hasNotification: false, userAgent: android }).reason, 'no-notification');
    assert.equal(client.pushSupport({ isSecureContext: true, hasServiceWorker: true, userAgent: iphone('17_1') }).reason, 'ios-add-to-home-screen');
    assert.equal(client.pushSupport({ ...full, userAgent: iphone('15_8'), standalone: true }).reason, 'ios-unsupported-version');
    assert.equal(client.pushSupport({ ...full, userAgent: iphone('17_1'), standalone: true }).supported, true);

    assert.equal(client.detectPushPlatform({ userAgent: android }), 'android');
    assert.equal(client.detectPushPlatform({ userAgent: iphone('17_1') }), 'ios');
    assert.equal(client.detectPushPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'desktop');
});

test('device: a clicked notification opens only an in-app route', () => {
    assert.equal(client.pushRouteFromMessage({ type: 'PUSH_NAVIGATE', route: '#portal?id=comp-1' }), '#portal?id=comp-1');
    assert.equal(client.pushRouteFromMessage({ type: 'PUSH_NAVIGATE', route: 'https://evil.example/#hub' }), null);
    assert.equal(client.pushRouteFromMessage({ type: 'OTHER', route: '#hub' }), null);
    assert.equal(client.pushRouteFromMessage(null), null);
    // The service worker uses the same rule
    for (const route of ['#official?id=x', '#hub', '#competition-center?id=a%20b']) {
        assert.equal(client.safePushRoute(route), route);
        assert.equal(safePushRoute(route), route);
    }
});
