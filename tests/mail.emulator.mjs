// The e-mail queue (functions/src/mail/mailService.js) against the Firestore
// emulator with a fake provider (no network): waiting while not configured,
// sending with the club's name and checked Reply-To, opt-outs, retries with
// backoff, the daily cap and idempotency. npm run test:restore (not part of
// npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  START_TIME_MAIL_MAX_AGE_MS,
  STUCK_SENDING_MS,
  enqueueMail,
  markReplyToVerified,
  processDueMailRetries,
  processMailDoc,
  recordOptOut,
  requeueMail,
  takeOverStuckMail
} from '../functions/src/mail/mailService.js';
import { emailHash, verifyMailToken } from '../functions/src/mail/mailCore.js';
import { createFakeProvider, createMailProvider } from '../functions/src/mail/providers.js';

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

const APP_ID = 'mail-test-app';
const run = Date.now();
const COMP = `mailcomp-${run}`;
const pub = `artifacts/${APP_ID}/public/data/competitions/${COMP}`;
const priv = `artifacts/${APP_ID}/private/data/competitions/${COMP}`;
const quietLogger = { info: () => {}, warn: () => {}, error: (...args) => console.error(...args) };
const LINK_BASE = 'https://links.example';

// The provider: a fake recording what it was given; `fail` decides failures
let sink = [];
let fail = null;
const providerFactory = (settings) => (settings?.enabled === true && settings?.provider === 'fake'
  ? createFakeProvider({ sink, fail: (m) => (fail ? fail(m) : null) })
  : createMailProvider(settings));
const ctx = () => ({ db, FieldValue, logger: quietLogger, appId: APP_ID, compId: COMP, providerFactory, linkBaseUrl: LINK_BASE });

async function seed() {
  await db.doc(pub).set({ name: 'Vårtävlingen', club: 'Körklubben' });
  await db.doc(`${pub}/config/emailSettings`).set({ senderName: 'Körklubben Syd', replyTo: 'info@korklubben.se', signature: 'Hälsningar\nKörklubben' });
  const equipages = { 1: ['Anna', 'Lätt B', 'anna@example.se'], 2: ['Bo', 'Lätt B', 'bo@example.se'], 3: ['Cilla', 'Msv', 'cilla@example.se'] };
  for (const [sn, [driverName, className, email]] of Object.entries(equipages)) {
    await db.doc(`${pub}/equipages/${sn}`).set({ driverName, className });
    await db.doc(`${pub}/equipagePrivate/${sn}`).set({ email });
  }
  await db.doc(`${pub}/officials/o1`).set({ name: 'Olle', role: 'marathon' });
  await db.doc(`${pub}/officialsPrivate/o1`).set({ email: 'olle@example.se' });
}

async function setProvider(extra = {}) {
  await db.doc('serverSettings/email').set({ provider: 'fake', fromAddress: 'noreply@drivelive.example', fromDomain: 'drivelive.example', enabled: true, dailyLimit: 1000, competitionDailyLimit: 500, ...extra });
}

const mailData = async (ref) => (await ref.get()).data();
const logs = async (mailId) => (await db.collection(`${priv}/mailLog`).where('mailId', '==', mailId).get()).docs.map((d) => d.data());

test('mail queue: waits until configured, then sends per recipient with club name, opt-outs and no addresses in the log', async () => {
  await seed();
  await db.doc('serverSettings/email').delete();

  const ref = await enqueueMail({
    db, FieldValue, appId: APP_ID, compId: COMP,
    mail: { kind: 'message', category: 'info', subject: 'Välkomna', text: 'Hej alla', audience: { drivers: { all: true } }, createdBy: 'admin-1' }
  });
  // Not configured: stays in the queue, listed for the superadmin
  assert.equal((await processMailDoc({ ...ctx(), ref })).status, 'not_configured');
  assert.equal((await mailData(ref)).status, 'not_configured');
  assert.equal((await db.doc(`mailRetry/${APP_ID}__${COMP}__${ref.id}`).get()).data().reason, 'not_configured');
  assert.equal(sink.length, 0);

  // Bo opted out of information mail
  assert.equal(await recordOptOut(db, { appId: APP_ID, compId: COMP, hash: emailHash('bo@example.se') }), true);
  await setProvider();
  const result = await requeueMail({ ...ctx(), mailId: ref.id, now: Date.now() });
  assert.equal(result.status, 'sent');
  const mail = await mailData(ref);
  assert.equal(mail.status, 'sent');
  assert.deepEqual({ ...mail.counts }, { recipients: 2, sent: 2, failed: 0, skippedOptOut: 1, withoutEmail: 0 });
  assert.equal(mail.providerMessageIds.length, 2);
  assert.equal((await db.doc(`mailRetry/${APP_ID}__${COMP}__${ref.id}`).get()).exists, false);
  // Counted against the competition's daily cap
  assert.equal((await db.doc(`${priv}/rateLimits/mail_day`).get()).data().count, 2);

  // One message per recipient (no BCC), the club as display name, no Reply-To
  // until the address is checked, an unsubscribe link bound to the address
  assert.deepEqual(sink.map((m) => m.to.email).sort(), ['anna@example.se', 'cilla@example.se']);
  const anna = sink.find((m) => m.to.email === 'anna@example.se');
  assert.deepEqual(anna.from, { email: 'noreply@drivelive.example', name: 'Körklubben Syd via DriveLive' });
  assert.equal(anna.replyTo, null);
  assert.match(anna.text, /Hälsningar\nKörklubben/);
  const unsubscribe = anna.headers['List-Unsubscribe'].slice(1, -1);
  assert.ok(unsubscribe.startsWith(`${LINK_BASE}/unsubscribeEmail?t=`));
  const key = Buffer.from((await db.doc('serverSettings/mailSigning').get()).data().key, 'base64');
  const payload = verifyMailToken(new URL(unsubscribe).searchParams.get('t'), key, 'u');
  assert.deepEqual([payload.a, payload.c, payload.h], [APP_ID, COMP, emailHash('anna@example.se')]);

  // The log: counts, no addresses
  const entries = await logs(ref.id);
  assert.deepEqual(entries.map((e) => e.status).sort(), ['not_configured', 'sent']);
  assert.equal(JSON.stringify(entries).includes('@'), false);

  // Idempotent: a second run (a duplicate trigger) sends nothing
  sink = [];
  assert.equal((await processMailDoc({ ...ctx(), ref })).status, 'skipped');
  assert.equal(sink.length, 0);
});

test('essential mail ignores opt-outs and uses the checked Reply-To; personal start times', async () => {
  sink = [];
  assert.equal(await markReplyToVerified(db, { appId: APP_ID, compId: COMP, address: 'other@korklubben.se' }), 'changed');
  assert.equal(await markReplyToVerified(db, { appId: APP_ID, compId: COMP, address: 'INFO@korklubben.se' }), 'verified');
  const ref = await enqueueMail({
    db, FieldValue, appId: APP_ID, compId: COMP,
    mail: {
      kind: 'startTimeChange', category: 'essential', subject: 'Ändrad starttid', text: 'Nya tider:',
      audience: { drivers: { classes: [], startNumbers: ['1', '2'], includeWithdrawn: true } },
      personalTexts: { 1: 'Dressyr 10:20', 2: 'Dressyr 10:30' }, createdBy: 'admin-1'
    }
  });
  assert.equal((await processMailDoc({ ...ctx(), ref })).status, 'sent');
  const bo = sink.find((m) => m.to.email === 'bo@example.se');
  assert.ok(bo, 'opted-out driver still gets the start time');
  assert.equal(bo.replyTo, 'info@korklubben.se');
  assert.match(bo.text, /Dressyr 10:30/);
  assert.doesNotMatch(bo.text, /Dressyr 10:20/);
  assert.equal(bo.headers['List-Unsubscribe'], undefined);
});

test('a failure the provider may accept later is retried with backoff, then sent', async () => {
  sink = [];
  let failures = 0;
  fail = (m) => (m.to.email === 'olle@example.se' && failures++ < 1 ? 'retry' : null);
  const now = Date.now();
  const ref = await enqueueMail({
    db, FieldValue, appId: APP_ID, compId: COMP, now,
    mail: { kind: 'message', category: 'essential', subject: 'Funktionärsmöte', text: 'Kl 7', audience: { officials: { all: true }, drivers: { startNumbers: ['3'] } }, createdBy: 'admin-1' }
  });
  assert.equal((await processMailDoc({ ...ctx(), ref, now })).status, 'queued');
  let mail = await mailData(ref);
  assert.deepEqual(mail.retryRecipients.map((r) => r.email), ['olle@example.se']);
  assert.equal(mail.counts.sent, 1);
  assert.equal(mail.nextAttemptAt, now + 5 * 60 * 1000);
  // Not due yet
  assert.deepEqual(await processDueMailRetries({ ...ctx(), now: now + 60 * 1000 }), []);
  const due = await processDueMailRetries({ ...ctx(), now: now + 6 * 60 * 1000 });
  assert.deepEqual(due.filter((d) => d.mailId === ref.id).map((d) => d.status), ['sent']);
  mail = await mailData(ref);
  assert.equal(mail.status, 'sent');
  assert.equal(mail.counts.sent, 2);
  assert.equal(mail.counts.recipients, 2);
  assert.equal(mail.retryRecipients, undefined);
  assert.deepEqual(sink.filter((m) => m.to.email === 'olle@example.se').length, 1);
  fail = null;
});

test('a run that stopped half-way is taken over and sends only to those not yet sent to', async () => {
  sink = [];
  const now = Date.now();
  const ref = await enqueueMail({
    db, FieldValue, appId: APP_ID, compId: COMP, now: now - STUCK_SENDING_MS - 60 * 1000,
    mail: { kind: 'message', category: 'essential', subject: 'Banvandring', text: 'Kl 18', audience: { drivers: { all: true } }, createdBy: 'admin-1' }
  });
  // As left by a run that died after sending to Anna: 'sending', Anna
  // recorded, and the watchdog entry the claim wrote
  const startedAt = now - STUCK_SENDING_MS - 1000;
  await ref.update({ status: 'sending', sendingAt: startedAt, sendAttemptId: 'dead', deliveredHashes: [emailHash('anna@example.se')] });
  await db.doc(`mailRetry/${APP_ID}__${COMP}__${ref.id}`).set({ appId: APP_ID, compId: COMP, mailId: ref.id, reason: 'retry', retryAt: startedAt + STUCK_SENDING_MS, watchdog: true });
  // Not stuck long enough yet: left alone
  assert.equal(await takeOverStuckMail(db, ref, startedAt + 60 * 1000), false);

  const due = await processDueMailRetries({ ...ctx(), now });
  assert.deepEqual(due.filter((d) => d.mailId === ref.id).map((d) => d.status), ['sent']);
  assert.deepEqual(sink.map((m) => m.to.email).sort(), ['bo@example.se', 'cilla@example.se']);
  const mail = await mailData(ref);
  assert.equal(mail.status, 'sent');
  assert.equal(mail.counts.sent, 3);
  assert.equal(mail.takeovers, 1);
  assert.equal(mail.sendingAt, undefined);
  assert.deepEqual([...mail.deliveredHashes].sort(), ['anna@example.se', 'bo@example.se', 'cilla@example.se'].map(emailHash).sort());
  assert.equal((await db.doc(`mailRetry/${APP_ID}__${COMP}__${ref.id}`).get()).exists, false);
});

test('retryQueuedMail does not send a start time change older than 12 hours', async () => {
  sink = [];
  const ref = await enqueueMail({
    db, FieldValue, appId: APP_ID, compId: COMP, now: Date.now() - START_TIME_MAIL_MAX_AGE_MS - 1000,
    mail: {
      kind: 'startTimeChange', category: 'essential', subject: 'Ändrad starttid', text: 'Nya tider:',
      audience: { drivers: { classes: [], startNumbers: ['1'], includeWithdrawn: true } }, personalTexts: { 1: 'Dressyr 9:00' }, createdBy: 'admin-1'
    }
  });
  await ref.update({ status: 'blocked' });
  const result = await requeueMail({ ...ctx(), mailId: ref.id, now: Date.now() });
  assert.equal(result.status, 'expired');
  assert.equal((await mailData(ref)).status, 'expired');
  assert.equal(sink.length, 0);
});

test('the daily cap blocks a whole mail; a permanent failure is reported', async () => {
  sink = [];
  await setProvider({ competitionDailyLimit: 1 });
  const ref = await enqueueMail({
    db, FieldValue, appId: APP_ID, compId: COMP,
    mail: { kind: 'message', category: 'essential', subject: 'S', text: 'T', audience: { drivers: { all: true } }, createdBy: 'admin-1' }
  });
  assert.equal((await processMailDoc({ ...ctx(), ref })).status, 'blocked');
  const mail = await mailData(ref);
  assert.match(mail.error, /Dagens gräns för tävlingens e-post är nådd \(0 av 1 kvar, utskicket har 3 mottagare\)/);
  assert.equal(sink.length, 0);
  assert.equal((await db.doc(`mailRetry/${APP_ID}__${COMP}__${ref.id}`).get()).data().reason, 'blocked');

  await setProvider();
  fail = (m) => (m.to.email === 'cilla@example.se' ? 'permanent' : null);
  const again = await requeueMail({ ...ctx(), mailId: ref.id, now: Date.now() });
  assert.equal(again.status, 'partial');
  assert.equal((await mailData(ref)).counts.failed, 1);
  fail = null;

  // An explicit recipient list (server producers) goes to that address only
  sink = [];
  const confirm = await enqueueMail({
    db, FieldValue, appId: APP_ID, compId: COMP,
    mail: { kind: 'volunteerConfirmation', subject: 'Tack', text: 'Tack för din anmälan', to: [{ email: 'Vol@Example.se', name: 'Vol' }] }
  });
  assert.equal((await processMailDoc({ ...ctx(), ref: confirm })).status, 'sent');
  assert.deepEqual(sink.map((m) => m.to.email), ['vol@example.se']);
});
