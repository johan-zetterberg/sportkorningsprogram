// Rules for e-mail: the club's sender settings (config/emailSettings), the
// mail queue and log, opt-outs and the server-only settings. Its own project
// id, so it can run next to the other rules specs against the same emulator.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-mail-rules';
const APP_ID = 'drivelive';
const COMP_ID = 'comp-mail';
const HAS_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

let testEnv;

const compPath = (path = '') => `artifacts/${APP_ID}/public/data/competitions/${COMP_ID}${path ? `/${path}` : ''}`;
const privPath = (path = '') => `artifacts/${APP_ID}/private/data/competitions/${COMP_ID}${path ? `/${path}` : ''}`;

const ROLES = { 'admin-1': 'admin', 'td-1': 'td', 'spk-1': 'speaker', 'mar-1': 'marathon' };

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
    await setDoc(doc(db, compPath()), { name: 'Mail rules', createdBy: 'owner-1', admins: [] });
    for (const [uid, role] of Object.entries(ROLES)) {
      await setDoc(doc(db, compPath(`admins/${uid}`)), { role, roles: [role], email: `${uid}@example.com` });
    }
    await setDoc(doc(db, privPath('mailQueue/m1')), { kind: 'message', status: 'sent', to: null, subject: 'Hej' });
    await setDoc(doc(db, privPath('mailLog/l1')), { mailId: 'm1', status: 'sent', recipients: 3 });
    await setDoc(doc(db, privPath('mailOptOuts/abc')), { scope: 'info', createdAt: 1 });
    await setDoc(doc(db, 'serverSettings/email'), { provider: 'brevo', apiKey: 'secret-key-123', fromAddress: 'noreply@example.se' });
    await setDoc(doc(db, 'mailRetry/x'), { reason: 'not_configured' });
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test('mail rules tests need the emulator', { skip: HAS_EMULATOR }, () => assert.ok(true));

test('emailSettings: admins write the sender fields, never the verification', { skip: !HAS_EMULATOR }, async () => {
  const ref = (db) => doc(db, compPath('config/emailSettings'));
  const admin = dbOf('admin-1');
  await assertSucceeds(setDoc(ref(admin), {
    senderName: 'Körklubben', replyTo: 'info@korklubben.se', signature: 'Hälsningar\nKörklubben',
    autoVolunteerConfirmation: true, autoVetDecisionMail: false, updatedBy: 'admin-1'
  }));
  await assertSucceeds(getDoc(ref(admin)));
  await assertSucceeds(getDoc(ref(dbOf('owner-1'))));
  // The TD reads; speaker, other officials, other users and the public do not
  await assertSucceeds(getDoc(ref(dbOf('td-1'))));
  await assertFails(getDoc(ref(dbOf('spk-1'))));
  await assertFails(getDoc(ref(dbOf('random-1'))));
  await assertFails(getDoc(ref(testEnv.unauthenticatedContext().firestore())));

  // Verification is the server's
  await assertFails(setDoc(ref(admin), { replyToVerified: true }, { merge: true }));
  await assertFails(setDoc(ref(admin), { replyToVerifiedAddress: 'x@y.se' }, { merge: true }));
  // Shape and sizes
  await assertFails(setDoc(ref(admin), { replyTo: 'not an address' }, { merge: true }));
  await assertFails(setDoc(ref(admin), { senderName: 'x'.repeat(61) }, { merge: true }));
  await assertFails(setDoc(ref(admin), { signature: 'x'.repeat(1001) }, { merge: true }));
  await assertFails(setDoc(ref(admin), { extra: true }, { merge: true }));
  await assertFails(setDoc(ref(admin), { autoVetDecisionMail: 'yes' }, { merge: true }));
  await assertFails(setDoc(ref(admin), { updatedBy: 'someone-else' }, { merge: true }));
  // Non-admins do not write
  await assertFails(setDoc(ref(dbOf('td-1')), { senderName: 'TD' }, { merge: true }));
  await assertFails(setDoc(ref(dbOf('random-1')), { senderName: 'X' }, { merge: true }));

  // Once the server marked it verified, the admin still edits the other fields
  // (a merge keeps the verification fields as they are)
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(ref(context.firestore()), { replyToVerified: true, replyToVerifiedAddress: 'info@korklubben.se', replyToVerifiedAt: 1 });
  });
  await assertSucceeds(setDoc(ref(admin), { replyTo: 'kansli@korklubben.se', senderName: 'Körklubben Syd' }, { merge: true }));
  await assertFails(setDoc(ref(admin), { replyToVerified: false }, { merge: true }));
  // Replacing the doc without the verification fields removes them: refused
  await assertFails(setDoc(ref(admin), { senderName: 'Ny' }));
  await assertSucceeds(deleteDoc(ref(admin)));
});

test('other config docs stay as before', { skip: !HAS_EMULATOR }, async () => {
  await assertSucceeds(setDoc(doc(dbOf('admin-1'), compPath('config/competitionMeta')), { a: 1 }));
  await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), compPath('config/competitionMeta'))));
});

test('mail queue and log: admins (log also the TD) read, nobody writes', { skip: !HAS_EMULATOR }, async () => {
  const admin = dbOf('admin-1');
  await assertSucceeds(getDocs(collection(admin, privPath('mailQueue'))));
  await assertSucceeds(getDoc(doc(admin, privPath('mailQueue/m1'))));
  await assertFails(getDocs(collection(dbOf('td-1'), privPath('mailQueue'))));
  await assertFails(getDocs(collection(dbOf('spk-1'), privPath('mailQueue'))));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), privPath('mailQueue/m1'))));

  await assertSucceeds(getDocs(collection(admin, privPath('mailLog'))));
  await assertSucceeds(getDocs(collection(dbOf('td-1'), privPath('mailLog'))));
  await assertFails(getDocs(collection(dbOf('mar-1'), privPath('mailLog'))));
  await assertFails(getDocs(collection(dbOf('random-1'), privPath('mailLog'))));

  // Only callables queue mail
  await assertFails(setDoc(doc(admin, privPath('mailQueue/new')), { kind: 'message', to: [{ email: 'a@b.se' }], subject: 'x', text: 'y' }));
  await assertFails(updateDoc(doc(admin, privPath('mailQueue/m1')), { status: 'queued' }));
  await assertFails(deleteDoc(doc(admin, privPath('mailQueue/m1'))));
  await assertFails(setDoc(doc(admin, privPath('mailLog/new')), { status: 'sent' }));
  await assertFails(deleteDoc(doc(admin, privPath('mailLog/l1'))));
});

test('opt-outs and server settings: no client access, superadmin neither', { skip: !HAS_EMULATOR }, async () => {
  const superadmin = testEnv.authenticatedContext('super-1', { email: 'super@example.com', email_verified: true, superadmin: true }).firestore();
  for (const db of [dbOf('admin-1'), dbOf('owner-1'), superadmin]) {
    await assertFails(getDoc(doc(db, privPath('mailOptOuts/abc'))));
    await assertFails(setDoc(doc(db, privPath('mailOptOuts/def')), { scope: 'info' }));
    await assertFails(getDoc(doc(db, 'serverSettings/email')));
    await assertFails(getDocs(collection(db, 'serverSettings')));
    await assertFails(setDoc(doc(db, 'serverSettings/email'), { provider: 'brevo' }));
    await assertFails(getDoc(doc(db, 'mailRetry/x')));
    await assertFails(setDoc(doc(db, 'mailRetry/y'), { reason: 'retry' }));
  }
});
