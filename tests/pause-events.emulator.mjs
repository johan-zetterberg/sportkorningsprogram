// Offline pause events (functions/src/pauseEvents.js) against the Firestore
// emulator: events folded into config/globalStatus.pauseLog in time order,
// each once (a re-delivered trigger does nothing), an online entry kept, and
// isPaused following the log. Also the incident log's final numbers
// (functions/src/incidentNumbers.js). npm run test:restore (not part of npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyPauseEvents, globalStatusPath, pauseDetailsId, pauseDetailsPath, pauseEventsPath } from '../functions/src/pauseEvents.js';
import { numberIncident } from '../functions/src/incidentNumbers.js';

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

const APP_ID = 'pause-test-app';
const COMP = `pausecomp-${Date.now()}`;
const statusRef = db.doc(globalStatusPath(APP_ID, COMP));
const events = db.collection(pauseEventsPath(APP_ID, COMP));
const addEvent = (id, data) => events.doc(id).set({ processed: false, ...data });

test('pause events: folded in time order, once, next to an online entry', async () => {
    // An online pause, already closed
    const online = { start: '2026-05-01T09:00:00.000Z', end: '2026-05-01T09:05:00.000Z', durationSec: 300, reason: 'other', by: { uid: 'admin' } };
    await statusRef.set({ isPaused: false, pauseLog: [online] });
    // An offline device: pause and resume, synced together (the end first)
    await addEvent('b-end', { type: 'end', at: '2026-05-01T10:20:00.000Z', by: { uid: 'obs' } });
    await addEvent('a-start', { type: 'start', at: '2026-05-01T10:00:00.000Z', by: { uid: 'obs', role: 'marathon' }, reason: 'vet', where: 'obstacle:2' });

    const first = await applyPauseEvents(db, FieldValue, { appId: APP_ID, compId: COMP });
    assert.equal(first.processed, 2);
    const status = (await statusRef.get()).data();
    assert.equal(status.isPaused, false);
    assert.equal(status.pauseLog.length, 2);
    assert.deepEqual(status.pauseLog[0], online);
    assert.equal(status.pauseLog[1].start, '2026-05-01T10:00:00.000Z');
    assert.equal(status.pauseLog[1].end, '2026-05-01T10:20:00.000Z');
    assert.equal(status.pauseLog[1].durationSec, 1200);
    assert.equal(status.pauseLog[1].where, 'obstacle:2');
    // Who pressed is not in the public log but in the private details
    assert.equal(status.pauseLog[1].by, undefined);
    assert.equal(status.pauseLog[1].endedBy, undefined);
    const details = (await db.doc(`${pauseDetailsPath(APP_ID, COMP)}/${pauseDetailsId('2026-05-01T10:00:00.000Z')}`).get()).data();
    assert.deepEqual(details.by, { uid: 'obs', role: 'marathon' });
    assert.deepEqual(details.endedBy, { uid: 'obs' });

    // A re-delivered trigger finds nothing to do
    const again = await applyPauseEvents(db, FieldValue, { appId: APP_ID, compId: COMP });
    assert.equal(again.processed, 0);
    assert.equal((await statusRef.get()).data().pauseLog.length, 2);
    const ended = (await events.doc('b-end').get()).data();
    assert.equal(ended.processed, true);
    assert.equal(ended.result, 'ended');
});

test('incident numbers: duplicates from two devices are renumbered, each entry once', async () => {
    const base = `artifacts/${APP_ID}/private/data/competitions/${COMP}`;
    await db.doc(`${base}/incidents/old`).set({ number: 1, type: 'other', status: 'open', description: 'x' });
    await db.doc(`${base}/incidents/a`).set({ number: 2, type: 'other', status: 'open', description: 'a' });
    await db.doc(`${base}/incidents/b`).set({ number: 2, type: 'other', status: 'open', description: 'b' });
    assert.deepEqual(await numberIncident(db, { appId: APP_ID, compId: COMP, incidentId: 'a' }), { number: 2, changed: false });
    assert.deepEqual(await numberIncident(db, { appId: APP_ID, compId: COMP, incidentId: 'b' }), { number: 3, changed: true });
    assert.equal(await numberIncident(db, { appId: APP_ID, compId: COMP, incidentId: 'b' }), null, 'a re-delivered trigger');
    assert.equal((await db.doc(`${base}/incidents/b`).get()).data().number, 3);
});

test('pause events: isPaused follows the log, also when the device set it ahead', async () => {
    await addEvent('c-start', { type: 'start', at: '2026-05-01T11:00:00.000Z', by: { uid: 'obs' } });
    await applyPauseEvents(db, FieldValue, { appId: APP_ID, compId: COMP });
    assert.equal((await statusRef.get()).data().isPaused, true);
    // A late start (before the last logged change): ignored; the device's
    // isPaused written ahead is put back to the log's
    await statusRef.set({ isPaused: false }, { merge: true });
    await addEvent('d-late', { type: 'start', at: '2026-05-01T09:30:00.000Z', by: { uid: 'obs2' } });
    const result = await applyPauseEvents(db, FieldValue, { appId: APP_ID, compId: COMP });
    assert.equal(result.results['d-late'], 'ignored-already-paused');
    const status = (await statusRef.get()).data();
    assert.equal(status.isPaused, true);
    assert.equal(status.pauseLog.length, 3);
});

test('pause events: a press that reached the server more than 2 minutes late needs review', async () => {
    const before = (await statusRef.get()).data();
    const at = '2026-05-01T12:00:00.000Z';
    await addEvent('e-late', { type: 'end', at, atServer: new Date(Date.parse(at) + 5 * 60000), by: { uid: 'obs', role: 'marathon' } });
    const result = await applyPauseEvents(db, FieldValue, { appId: APP_ID, compId: COMP });
    assert.equal(result.results['e-late'], 'needs-review');
    const status = (await statusRef.get()).data();
    assert.deepEqual(status.pauseLog, before.pauseLog);
    assert.equal(status.isPaused, true);
    const stored = (await events.doc('e-late').get()).data();
    assert.equal(stored.result, 'needs-review');
});