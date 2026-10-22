// Rules for the incident log, staff notifications, field devices, emergency
// contacts and the TD / ground jury role. Its own project id, so it can run
// next to tests/firestore-rules.spec.js against the same emulator.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch
} from 'firebase/firestore';

const PROJECT_ID = 'demo-staff-rules';
const APP_ID = 'drivelive';
const COMP_ID = 'comp-staff';
const HAS_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

let testEnv;

const compPath = (path = '') => `artifacts/${APP_ID}/public/data/competitions/${COMP_ID}${path ? `/${path}` : ''}`;
const privPath = (path = '') => `artifacts/${APP_ID}/private/data/competitions/${COMP_ID}${path ? `/${path}` : ''}`;
const rootPath = (path = '') => `competitions/${COMP_ID}${path ? `/${path}` : ''}`;

const ROLES = { 'td-1': 'td', 'mar-1': 'marathon', 'spk-1': 'speaker', 'vet-1': 'vet', 'pre-1': 'precision' };

function dbOf(uid, email = `${uid}@example.com`) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

before(async () => {
  if (!HAS_EMULATOR) return;
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });
});

beforeEach(async () => {
  if (!HAS_EMULATOR) return;
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath()), { name: 'Staff rules', createdBy: 'owner-1', admins: [] });
    for (const [uid, role] of Object.entries(ROLES)) {
      await setDoc(doc(db, compPath(`admins/${uid}`)), { role, roles: [role], email: `${uid}@example.com` });
    }
    await setDoc(doc(db, compPath('equipages/5')), { startNumber: 5, driverName: 'Kim', status: 'anmäld', horses: [{ name: 'A', id: 'H1' }] });
    await setDoc(doc(db, compPath('equipagePrivate/5')), { email: 'driver@example.com' });
    await setDoc(doc(db, privPath('auditLog/a1')), { discipline: 'marathon', startNumber: '5', reason: 'x', editedBy: 'owner-1' });
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

function incident(uid, extra = {}) {
  return {
    number: 1, type: 'protest', status: 'open', receivedAt: '2026-05-16T10:00', startNumber: '5',
    discipline: 'marathon', obstacle: 'H3', description: 'Protest', decision: '', decidedBy: '',
    createdBy: uid, createdByName: uid, createdAt: serverTimestamp(), ...extra
  };
}

test('staff rules tests need the emulator', { skip: HAS_EMULATOR }, () => assert.ok(true));

test('incidents: TD and discipline officials write, the vet adds its own decisions, never public', { skip: !HAS_EMULATOR }, async () => {
  const td = dbOf('td-1');
  const ref = doc(td, privPath('incidents/i1'));
  await assertSucceeds(setDoc(ref, incident('td-1')));
  await assertSucceeds(setDoc(doc(dbOf('mar-1'), privPath('incidents/i2')), incident('mar-1', { number: 2 })));
  await assertSucceeds(setDoc(doc(dbOf('owner-1'), privPath('incidents/i3')), incident('owner-1', { number: 3 })));
  // The vet: only an open vet decision of its own
  await assertSucceeds(setDoc(doc(dbOf('vet-1'), privPath('incidents/v1')), incident('vet-1', {
    number: 4, type: 'vet', source: 'vet', discipline: 'general', vetStrike: { phase: 'initial', outcome: 'pending' }
  })));
  await assertFails(setDoc(doc(dbOf('vet-1'), privPath('incidents/v2')), incident('vet-1', { number: 5 })));
  // Denied: speaker, wrong writer, bad shape, unknown type, the public
  await assertFails(setDoc(doc(dbOf('spk-1'), privPath('incidents/s1')), incident('spk-1')));
  await assertFails(setDoc(doc(td, privPath('incidents/x1')), incident('someone-else')));
  await assertFails(setDoc(doc(td, privPath('incidents/x2')), incident('td-1', { extra: true })));
  await assertFails(setDoc(doc(td, privPath('incidents/x3')), incident('td-1', { type: 'complaint' })));
  await assertFails(setDoc(doc(td, privPath('incidents/x4')), incident('td-1', { description: '' })));
  await assertFails(setDoc(doc(dbOf('random-1'), privPath('incidents/x5')), incident('random-1')));

  // Reads: staff of the log yes, speaker and the public no
  await assertSucceeds(getDoc(doc(dbOf('vet-1'), privPath('incidents/i1'))));
  await assertSucceeds(getDocs(collection(dbOf('pre-1'), privPath('incidents'))));
  await assertFails(getDoc(doc(dbOf('spk-1'), privPath('incidents/i1'))));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), privPath('incidents/i1'))));
  await assertFails(getDocs(collection(dbOf('random-1'), privPath('incidents'))));

  // Update: in the writer's name, creator and number kept; never removed
  await assertSucceeds(updateDoc(ref, { status: 'decided', decision: 'Avslås', updatedBy: 'td-1', updatedByName: 'TD', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { status: 'closed', updatedBy: 'mar-1', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { createdBy: 'td-1x', updatedBy: 'td-1', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { number: 9, updatedBy: 'td-1', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(dbOf('vet-1'), privPath('incidents/v1')), { status: 'decided', decision: 'x', updatedBy: 'vet-1', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(ref));
});

test('incidents: vet decisions (type vet, vetStrike) only by the vet, the TD and admins', { skip: !HAS_EMULATOR }, async () => {
  const vetEntry = (uid, extra = {}) => incident(uid, {
    number: 7, type: 'vet', discipline: 'general', vetStrike: { phase: 'initial', outcome: 'pending' }, ...extra
  });
  // Discipline officials may not fake a vet decision (it reaches the driver)
  await assertFails(setDoc(doc(dbOf('mar-1'), privPath('incidents/f1')), vetEntry('mar-1')));
  await assertFails(setDoc(doc(dbOf('pre-1'), privPath('incidents/f2')), vetEntry('pre-1', { startNumber: '99' })));
  await assertFails(setDoc(doc(dbOf('mar-1'), privPath('incidents/f3')), incident('mar-1', { vetStrike: { outcome: 'confirmed' } })));
  // The TD and the owner may
  await assertSucceeds(setDoc(doc(dbOf('td-1'), privPath('incidents/t1')), vetEntry('td-1')));
  await assertSucceeds(setDoc(doc(dbOf('owner-1'), privPath('incidents/o1')), vetEntry('owner-1', { number: 8 })));
  // The vet's own open report
  const vetRef = doc(dbOf('vet-1'), privPath('incidents/v1'));
  await assertSucceeds(setDoc(vetRef, vetEntry('vet-1', { number: 9, source: 'vet' })));

  const upd = (uid, extra) => ({ updatedBy: uid, updatedAt: serverTimestamp(), ...extra });
  // Officials may not flip the outcome, edit a vet entry or turn an entry into one
  await assertFails(updateDoc(doc(dbOf('mar-1'), privPath('incidents/v1')), upd('mar-1', { vetStrike: { phase: 'initial', outcome: 'confirmed' } })));
  await assertFails(updateDoc(doc(dbOf('mar-1'), privPath('incidents/v1')), upd('mar-1', { status: 'closed' })));
  await assertSucceeds(setDoc(doc(dbOf('mar-1'), privPath('incidents/p1')), incident('mar-1', { number: 10 })));
  await assertFails(updateDoc(doc(dbOf('mar-1'), privPath('incidents/p1')), upd('mar-1', { type: 'vet' })));
  await assertFails(updateDoc(doc(dbOf('mar-1'), privPath('incidents/p1')), upd('mar-1', { vetStrike: { outcome: 'confirmed' } })));
  await assertSucceeds(updateDoc(doc(dbOf('mar-1'), privPath('incidents/p1')), upd('mar-1', { status: 'closed' })));
  // The TD and the owner decide
  await assertSucceeds(updateDoc(doc(dbOf('td-1'), privPath('incidents/v1')), upd('td-1', {
    status: 'decided', vetStrike: { phase: 'initial', outcome: 'confirmed' }
  })));
  await assertSucceeds(updateDoc(doc(dbOf('owner-1'), privPath('incidents/v1')), upd('owner-1', {
    vetStrike: { phase: 'initial', outcome: 'overturned' }
  })));
});

test('incidents: the vet withdraws its own pending report (closed, outcome withdrawn) and nothing else', { skip: !HAS_EMULATOR }, async () => {
  const vet = dbOf('vet-1');
  const report = (id, extra = {}) => setDoc(doc(vet, privPath(`incidents/${id}`)), incident('vet-1', {
    number: 11, type: 'vet', source: 'vet', discipline: 'general', vetStrike: { phase: 'initial', outcome: 'pending' }, ...extra
  }));
  const withdraw = (extra = {}) => ({
    status: 'closed', decision: 'Veterinären godkände ekipaget igen.', decidedBy: 'Vet',
    'vetStrike.outcome': 'withdrawn', updatedBy: 'vet-1', updatedByName: 'Vet', updatedAt: serverTimestamp(), ...extra
  });
  await assertSucceeds(report('w1'));
  await assertSucceeds(updateDoc(doc(vet, privPath('incidents/w1')), withdraw()));
  // Once closed: no second change of the outcome
  await assertFails(updateDoc(doc(vet, privPath('incidents/w1')), withdraw({ 'vetStrike.outcome': 'pending', status: 'open' })));
  // Not another outcome, not other fields, not the phase, not by someone else
  await assertSucceeds(report('w2', { number: 12 }));
  await assertFails(updateDoc(doc(vet, privPath('incidents/w2')), withdraw({ 'vetStrike.outcome': 'overturned' })));
  await assertFails(updateDoc(doc(vet, privPath('incidents/w2')), withdraw({ description: 'Ändrad' })));
  await assertFails(updateDoc(doc(vet, privPath('incidents/w2')), withdraw({ 'vetStrike.phase': 'final' })));
  await assertFails(updateDoc(doc(vet, privPath('incidents/w2')), withdraw({ status: 'decided' })));
  await assertFails(updateDoc(doc(dbOf('mar-1'), privPath('incidents/w2')), withdraw({ updatedBy: 'mar-1' })));
  // A report already decided by the ground jury stays decided
  await assertSucceeds(updateDoc(doc(dbOf('td-1'), privPath('incidents/w2')), {
    status: 'decided', decision: 'Fastställt', 'vetStrike.outcome': 'confirmed', updatedBy: 'td-1', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(vet, privPath('incidents/w2')), withdraw()));
});

test('messages: push fields checked; the TD may call a drive-off (non-public, source driveOff) only', { skip: !HAS_EMULATOR }, async () => {
  const msg = (extra = {}) => ({
    title: 'Omkörning', body: 'Kvalificerade: #5', type: 'alert', category: 'essential', push: true, source: 'driveOff',
    audience: { public: false, drivers: true, officials: false, officialRoles: [] }, targetStartNumbers: ['5'],
    timestamp: serverTimestamp(), ...extra
  });
  const td = dbOf('td-1');
  await assertSucceeds(setDoc(doc(td, compPath('messages/d1')), msg()));
  await assertSucceeds(setDoc(doc(td, compPath('messages/d2')), msg({
    type: 'info', category: 'info', audience: { public: false, drivers: false, officials: true, officialRoles: ['speaker'] }, targetStartNumbers: []
  })));
  // Not public, not another source, no edits or deletes
  await assertFails(setDoc(doc(td, compPath('messages/d3')), msg({ audience: { public: true, drivers: true, officials: false, officialRoles: [] } })));
  await assertFails(setDoc(doc(td, compPath('messages/d4')), msg({ source: 'other' })));
  const { source: _source, ...withoutSource } = msg();
  await assertFails(setDoc(doc(td, compPath('messages/d5')), withoutSource));
  await assertFails(updateDoc(doc(td, compPath('messages/d1')), { body: 'Ändrad' }));
  await assertFails(deleteDoc(doc(td, compPath('messages/d1'))));
  // Other officials never
  await assertFails(setDoc(doc(dbOf('pre-1'), compPath('messages/d6')), msg()));
  // The owner: the push fields are checked
  const owner = dbOf('owner-1');
  await assertSucceeds(setDoc(doc(owner, compPath('messages/o1')), msg({ source: null })));
  await assertSucceeds(updateDoc(doc(owner, compPath('messages/o1')), { updateNotice: 'abcdef123456' }));
  await assertFails(setDoc(doc(owner, compPath('messages/o2')), msg({ category: 'urgent' })));
  await assertFails(setDoc(doc(owner, compPath('messages/o3')), msg({ push: 'yes' })));
  await assertFails(updateDoc(doc(owner, compPath('messages/o1')), { updateNotice: 'x'.repeat(65) }));
});

test('staff notifications: staff read and acknowledge; clients add only vet notices', { skip: !HAS_EMULATOR }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), privPath('staffNotifications/n1')), {
      kind: 'declarationChange', startNumber: '5', summary: '#5: Häst tillagd', changes: ['Häst tillagd: B'], createdAt: Timestamp.now(), createdBy: 'driver'
    });
  });
  await assertSucceeds(getDocs(collection(dbOf('spk-1'), privPath('staffNotifications'))));
  await assertFails(getDocs(collection(dbOf('random-1'), privPath('staffNotifications'))));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), privPath('staffNotifications/n1'))));

  const vet = dbOf('vet-1');
  await assertSucceeds(addDoc(collection(vet, privPath('staffNotifications')), {
    kind: 'vetStrike', startNumber: '5', summary: 'x', phase: 'initial', incidentId: 'v1', createdAt: serverTimestamp(), createdBy: 'vet-1', createdByName: 'Vet'
  }));
  await assertFails(addDoc(collection(vet, privPath('staffNotifications')), {
    kind: 'declarationChange', startNumber: '5', summary: 'forged', createdAt: serverTimestamp(), createdBy: 'vet-1'
  }));
  await assertFails(addDoc(collection(vet, privPath('staffNotifications')), {
    kind: 'vetStrike', startNumber: '5', summary: 'x', createdAt: serverTimestamp(), createdBy: 'vet-1', ackBy: 'vet-1'
  }));
  await assertFails(addDoc(collection(dbOf('random-1'), privPath('staffNotifications')), {
    kind: 'vetStrike', startNumber: '5', summary: 'x', createdAt: serverTimestamp(), createdBy: 'random-1'
  }));

  const n1 = (db) => doc(db, privPath('staffNotifications/n1'));
  await assertSucceeds(updateDoc(n1(dbOf('mar-1')), { ackAt: serverTimestamp(), ackBy: 'mar-1', ackByName: 'M' }));
  await assertFails(updateDoc(n1(dbOf('mar-1')), { ackAt: serverTimestamp(), ackBy: 'someone' }));
  await assertFails(updateDoc(n1(dbOf('mar-1')), { summary: 'changed' }));
  await assertFails(updateDoc(n1(dbOf('random-1')), { ackAt: serverTimestamp(), ackBy: 'random-1' }));
});

test('field devices: staff write their own device document, staff read, expiry bounded', { skip: !HAS_EMULATOR }, async () => {
  const beat = (uid, extra = {}) => ({
    deviceId: 'dev_ABCDEFGH12', uid, userName: uid, role: 'marathon', page: 'maraton-input', startNumber: '', obstacle: '3',
    queueSize: 0, online: true, clockSyncedAt: Date.now(), appVersion: 'v1', lastSeen: serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 3600 * 1000), ...extra
  });
  const ref = (db, id = 'dev_ABCDEFGH12') => doc(db, privPath(`devices/${id}`));
  await assertSucceeds(setDoc(ref(dbOf('mar-1')), beat('mar-1')));
  await assertSucceeds(setDoc(ref(dbOf('mar-1')), beat('mar-1', { queueSize: 4 })));
  await assertFails(setDoc(ref(dbOf('mar-1')), beat('td-1')));
  await assertFails(setDoc(ref(dbOf('mar-1'), 'dev_OTHER12345'), beat('mar-1')));
  await assertFails(setDoc(ref(dbOf('mar-1')), beat('mar-1', { queueSize: -1 })));
  await assertFails(setDoc(ref(dbOf('mar-1')), beat('mar-1', { expireAt: Timestamp.fromMillis(Date.now() + 60 * 24 * 3600 * 1000) })));
  await assertFails(setDoc(ref(dbOf('mar-1')), beat('mar-1', { lastSeen: Timestamp.now() })));
  await assertFails(setDoc(ref(dbOf('mar-1')), beat('mar-1', { gps: 'x' })));
  await assertFails(setDoc(ref(dbOf('random-1')), beat('random-1')));
  await assertSucceeds(getDocs(collection(dbOf('td-1'), privPath('devices'))));
  await assertFails(getDocs(collection(dbOf('random-1'), privPath('devices'))));
  await assertFails(deleteDoc(ref(dbOf('mar-1'))));
  await assertSucceeds(deleteDoc(ref(dbOf('owner-1'))));
});

test('emergency contacts: phones for staff and the competition\'s drivers only', { skip: !HAS_EMULATOR }, async () => {
  const owner = dbOf('owner-1');
  await assertSucceeds(setDoc(doc(owner, compPath('config/emergencyInfo')), { emergencyNumber: '112', vetName: 'Dr Ek' }));
  await assertSucceeds(setDoc(doc(owner, privPath('emergencyPrivate/contacts')), { vetPhone: '070-1', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(owner, privPath('emergencyPrivate/contacts')), { vetPhone: '070-1', email: 'x' }));
  await assertFails(setDoc(doc(owner, privPath('emergencyPrivate/other')), { vetPhone: '070-1' }));
  await assertFails(setDoc(doc(dbOf('td-1'), privPath('emergencyPrivate/contacts')), { vetPhone: '1' }));

  // The public part is public
  await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), compPath('config/emergencyInfo'))));
  // Phones: staff yes, a driver once the inbox matched the equipage, others no
  await assertSucceeds(getDoc(doc(dbOf('spk-1'), privPath('emergencyPrivate/contacts'))));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), privPath('emergencyPrivate/contacts'))));
  await assertFails(getDoc(doc(dbOf('drv-1', 'driver@example.com'), privPath('emergencyPrivate/contacts'))));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/drv-1/driverCompetitions/' + COMP_ID), { appId: APP_ID, startNumber: '5' });
    await setDoc(doc(context.firestore(), 'users/fake-1/driverCompetitions/' + COMP_ID), { appId: APP_ID, startNumber: '5' });
  });
  await assertSucceeds(getDoc(doc(dbOf('drv-1', 'driver@example.com'), privPath('emergencyPrivate/contacts'))));
  // A pointer without the matching verified email is not enough
  await assertFails(getDoc(doc(dbOf('fake-1', 'fake@example.com'), privPath('emergencyPrivate/contacts'))));
  // ...and clients cannot write the pointer
  await assertFails(setDoc(doc(dbOf('fake-1'), 'users/fake-1/driverCompetitions/' + COMP_ID), { appId: APP_ID, startNumber: '5' }));
});

test('td: reads corrections, finalizes marathon results, decides vet strikes; no result or other writes', { skip: !HAS_EMULATOR }, async () => {
  const td = dbOf('td-1');
  await assertSucceeds(getDoc(doc(td, privPath('auditLog/a1'))));
  await assertFails(getDoc(doc(dbOf('mar-1'), privPath('auditLog/a1'))));
  // Secretariat staff docs
  await assertSucceeds(getDocs(collection(td, compPath('officials'))));
  await assertSucceeds(getDocs(collection(td, privPath('rejectedWrites'))));

  // Finalize: result fields and the logged lock in one batch
  const batch = writeBatch(td);
  batch.set(doc(td, compPath('maraton/5')), { finalized: true, status: 'Klar', updatedAt: serverTimestamp(), finalizedBy: 'td-1' }, { merge: true });
  const logRef = doc(collection(td, rootPath('finalizationLog')));
  batch.set(logRef, { discipline: 'marathon', action: 'finalize', startNumber: '5', by: 'td-1', byName: null, at: serverTimestamp() });
  batch.set(doc(td, rootPath('marathonFinalization/5')), { finalized: true, lastLogId: logRef.id }, { merge: true });
  await assertSucceeds(batch.commit());
  // ...but no results
  await assertFails(setDoc(doc(td, compPath('maraton/6')), { obstacleResults: { 1: { penalty: 5 } } }, { merge: true }));
  await assertFails(setDoc(doc(td, compPath('precision/6')), { timeMs: 1000 }, { merge: true }));
  // Precision finalize: in rounds only the drive-off's finalized flag
  await assertSucceeds(setDoc(doc(td, compPath('precision/6')), { prioritized: true, finalized: true, finalizedAt: Date.now(), finalizedBy: 'td-1' }, { merge: true }));
  await assertFails(setDoc(doc(td, compPath('precision/6')), { finalized: true, rounds: { phase2: { timeMs: 1 } } }, { merge: true }));
  await assertFails(setDoc(doc(td, compPath('precision/6')), { finalized: true, rounds: { driveOff: { timeMs: 1 } } }, { merge: true }));
  await assertFails(setDoc(doc(td, compPath('precision/6')), { rounds: { driveOff: { finalized: true, knocks: ['1'] } } }, { merge: true }));
  await assertSucceeds(setDoc(doc(td, compPath('precision/6')), { rounds: { driveOff: { finalized: true, updatedAt: Date.now() } } }, { merge: true }));

  // The vet marks the strike: no 'struken' status, the pending flag instead
  const vet = dbOf('vet-1');
  const eq = (db) => doc(db, compPath('equipages/5'));
  await assertFails(updateDoc(eq(vet), { status: 'struken' }));
  await assertSucceeds(updateDoc(eq(vet), {
    vetInspection_initial: { status: 'struken', updatedAt: 'T', horses: { H1: { status: 'struken', checkedAt: 'T' } } },
    vetStrikePending: { phase: 'initial', at: 'T', by: 'vet-1', horseKeys: [], incidentId: 'v1' }
  }));
  await assertFails(updateDoc(eq(vet), { vetStrikeDecision: { outcome: 'overturned' } }));
  await assertFails(updateDoc(eq(vet), { vetStrikePending: { phase: 'initial', note: 'x' } }));
  // The TD decides; nothing else on the equipage
  await assertFails(updateDoc(eq(td), { driverName: 'Edited' }));
  await assertFails(updateDoc(eq(td), { status: 'besiktigad', vetStrikePending: null }));
  await assertFails(updateDoc(eq(dbOf('mar-1')), { status: 'struken', vetStrikePending: null }));
  await assertSucceeds(updateDoc(eq(td), {
    status: 'struken', vetStrikePending: null, updatedAt: serverTimestamp(),
    vetStrikeDecision: { outcome: 'confirmed', phase: 'initial', at: 'T', by: 'td-1', byName: 'TD', incidentId: 'v1' }
  }));
});

test('td role code: the admin sets a valid code only', { skip: !HAS_EMULATOR }, async () => {
  const owner = dbOf('owner-1');
  const ref = doc(owner, compPath('config/secrets'));
  await assertSucceeds(setDoc(ref, { accessCode_td: 'TDKEYABCDE' }, { merge: true }));
  await assertFails(setDoc(ref, { accessCode_td: '12345678' }, { merge: true }));
  await assertFails(setDoc(doc(dbOf('td-1'), compPath('config/secrets')), { accessCode_td: 'TDKEYABCDF' }, { merge: true }));
});
