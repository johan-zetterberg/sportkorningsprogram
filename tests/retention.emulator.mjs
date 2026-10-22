// The personal data retention run (purgeExpiredPersonalData) against the
// Firestore emulator: private data of a competition archived long ago goes,
// results stay, logs lose names, a recent competition is untouched, and a
// second run changes nothing. npm run test:restore (not part of npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runPersonalDataRetention } from '../functions/src/retentionRunner.js';

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

const APP_ID = 'retention-test-app';
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const OLD = `old-${now}`;
const RECENT = `recent-${now}`;
const pub = (id) => `artifacts/${APP_ID}/public/data/competitions/${id}`;
const priv = (id) => `artifacts/${APP_ID}/private/data/competitions/${id}`;
const quietLogger = { info: () => {}, error: (...args) => console.error(...args) };

async function seedCompetition(id, archivedAt) {
  await db.doc(pub(id)).set({ name: id, locked: true, status: 'completed', finalizedAt: archivedAt });
  await db.doc(`${pub(id)}/equipages/1`).set({ driverName: 'Anna Kusk', club: 'Klubben', horse: 'Blixten' });
  await db.doc(`${pub(id)}/computed_equipages/1`).set({ totalPenalty: 42 });
  await db.doc(`${pub(id)}/equipagePrivate/1`).set({ email: 'anna@example.se', phone: '070-1' });
  await db.doc(`${pub(id)}/horseTemperatures/1`).set({ horseTemperatures: { h1: { d1: 38.1 } } });
  await db.doc(`${pub(id)}/vetNotes/1`).set({ notes: { initial: 'ok' } });
  await db.doc(`${pub(id)}/volunteerSignups/v1`).set({ name: 'Volontär', email: 'v@example.se', icePhone: '112' });
  await db.doc(`${pub(id)}/maintenanceRuns/m1`).set({ type: 'result-recalculation', initiatedBy: { uid: 'u1', email: 'admin@example.se' } });
  await db.doc(`${priv(id)}/auditLog/a1`).set({ editedBy: 'u1', editedByName: 'Admin Person', reason: 'rättelse' });
  await db.doc(`${priv(id)}/rejectedWrites/r1`).set({ discipline: 'marathon', startNumber: '1', reportedBy: 'u2' });
  await db.doc(`${priv(id)}/rateLimits/volunteerSignup_competition`).set({ windowStart: now, count: 1 });
  await db.doc(`${priv(id)}/pauseDetails/p1`).set({ start: '2026-05-16T08:00:00Z', note: 'Häst', by: { uid: 'u1', name: 'Tess TD', role: 'td' } });
  await db.doc(`competitions/${id}/finalizationLog/f1`).set({ discipline: 'dressage', action: 'finalize', by: 'u1', byName: 'Domare D' });
  await db.doc(`${pub(id)}/config/globalStatus`).set({
    pauseLog: [{ start: '2026-05-16T08:00:00Z', end: '2026-05-16T08:10:00Z', reason: 'weather', by: { uid: 'u1', name: 'Tess TD', role: 'td' }, endedBy: { uid: 'u2', name: 'Adam Admin', role: 'admin' } }]
  });
}

const count = async (path) => (await db.collection(path).count().get()).data().count;

test('retention deletes expired private data and keeps results', async () => {
  await seedCompetition(OLD, now - 400 * DAY);
  await seedCompetition(RECENT, now - 30 * DAY);
  await db.doc(`pinJoinAttempts/${OLD}`).set({ failures: [now - 40 * DAY] });

  // The first run only schedules the deletion (shown to the admin)
  const scheduleAt = now + 23 * DAY;
  const first = await runPersonalDataRetention({ db, FieldValue, logger: quietLogger, nowMs: scheduleAt, appIds: [APP_ID] });
  assert.deepEqual(first.competitionsPurged, []);
  assert.deepEqual(first.competitionsScheduled.map((c) => c.competitionId), [OLD]);
  assert.equal((await db.doc(pub(OLD)).get()).data().personalDataPurgeScheduledAt, scheduleAt);
  assert.equal((await db.doc(pub(RECENT)).get()).data().personalDataPurgeScheduledAt, undefined);
  assert.equal(await count(`${pub(OLD)}/equipagePrivate`), 1);
  // Less than a week later: still waiting
  const early = await runPersonalDataRetention({ db, FieldValue, logger: quietLogger, nowMs: scheduleAt + 6 * DAY, appIds: [APP_ID] });
  assert.deepEqual(early.competitionsPurged, []);

  // 31 days ahead (8 days after scheduling): the counters written now are stale too
  const runAt = now + 31 * DAY;
  const summary = await runPersonalDataRetention({ db, FieldValue, logger: quietLogger, nowMs: runAt, appIds: [APP_ID] });
  assert.deepEqual(summary.competitionsPurged.map((c) => c.competitionId), [OLD]);
  assert.equal(await count(`${priv(OLD)}/pauseDetails`), 0);
  assert.equal(await count(`${priv(RECENT)}/pauseDetails`), 1);
  assert.equal(summary.competitionsPurged[0].counts.equipagePrivate, 1);
  assert.ok(summary.pinAttemptsDeleted >= 1);

  for (const name of ['equipagePrivate', 'horseTemperatures', 'vetNotes', 'volunteerSignups']) {
    assert.equal(await count(`${pub(OLD)}/${name}`), 0, name);
    assert.equal(await count(`${pub(RECENT)}/${name}`), 1, `${name} (recent)`);
  }
  assert.equal(await count(`${priv(OLD)}/rejectedWrites`), 0);
  assert.equal(await count(`${priv(OLD)}/rateLimits`), 0);
  // Results and the public entry stay
  assert.equal((await db.doc(`${pub(OLD)}/equipages/1`).get()).data().driverName, 'Anna Kusk');
  assert.equal((await db.doc(`${pub(OLD)}/computed_equipages/1`).get()).data().totalPenalty, 42);
  // Logs stay without names and email addresses
  const audit = (await db.doc(`${priv(OLD)}/auditLog/a1`).get()).data();
  assert.equal(audit.editedByName, undefined);
  assert.equal(audit.reason, 'rättelse');
  assert.equal((await db.doc(`competitions/${OLD}/finalizationLog/f1`).get()).data().byName, undefined);
  assert.deepEqual((await db.doc(`${pub(OLD)}/maintenanceRuns/m1`).get()).data().initiatedBy, { uid: 'u1' });
  assert.equal((await db.doc(`${priv(RECENT)}/auditLog/a1`).get()).data().editedByName, 'Admin Person');
  // The public pause log keeps its times and roles, not who pressed
  const [pause] = (await db.doc(`${pub(OLD)}/config/globalStatus`).get()).data().pauseLog;
  assert.deepEqual(pause.by, { uid: 'u1', role: 'td' });
  assert.deepEqual(pause.endedBy, { uid: 'u2', role: 'admin' });
  assert.equal(pause.end, '2026-05-16T08:10:00Z');
  assert.equal(summary.competitionsPurged[0].counts.pauseLogAnonymized, 1);
  assert.equal((await db.doc(`${pub(RECENT)}/config/globalStatus`).get()).data().pauseLog[0].by.name, 'Tess TD');
  // The run is recorded
  const state = (await db.doc(`personalDataRetention/${APP_ID}__${OLD}`).get()).data();
  assert.equal(state.purgedAt, runAt);

  // Idempotent: a second run selects nothing
  const again = await runPersonalDataRetention({ db, FieldValue, logger: quietLogger, nowMs: runAt + DAY, appIds: [APP_ID] });
  assert.deepEqual(again.competitionsPurged, []);
});

test('retention never purges a new competition with an old date, nor one written to recently', async () => {
  const FRESH = `fresh-${now}`;
  const ACTIVE = `active-${now}`;
  await db.doc(pub(FRESH)).set({ name: FRESH, status: 'draft', dates: '2019-05-01', createdAt: new Date(now - DAY) });
  await db.doc(`${pub(FRESH)}/equipagePrivate/1`).set({ email: 'x@example.se' });
  await db.doc(pub(ACTIVE)).set({ name: ACTIVE, status: 'active', dates: '2019-05-01', createdAt: new Date(now - 900 * DAY) });
  await db.doc(`${pub(ACTIVE)}/equipagePrivate/1`).set({ email: 'y@example.se' });
  // A correction in the audit log a month ago
  await db.doc(`${priv(ACTIVE)}/auditLog/a1`).set({ editedBy: 'u1', editedAt: new Date(now - 30 * DAY) });
  for (const at of [now, now + 8 * DAY]) {
    const summary = await runPersonalDataRetention({ db, FieldValue, logger: quietLogger, nowMs: at, appIds: [APP_ID] });
    const ids = [...summary.competitionsPurged, ...summary.competitionsScheduled].map((c) => c.competitionId);
    assert.ok(!ids.includes(FRESH) && !ids.includes(ACTIVE), ids.join(','));
  }
  assert.equal(await count(`${pub(FRESH)}/equipagePrivate`), 1);
  assert.equal(await count(`${pub(ACTIVE)}/equipagePrivate`), 1);
});