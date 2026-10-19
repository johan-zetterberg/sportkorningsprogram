import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-combined-driving';
const APP_ID = 'drivelive';
const COMP_ID = 'storage-comp';
const HAS_EMULATORS = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const firestoreRules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const storageRules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');

let testEnv;

function compPath(path = '') {
  const base = `artifacts/${APP_ID}/public/data/competitions/${COMP_ID}`;
  return path ? `${base}/${path}` : base;
}

function logoPath(name = 'logo.png') {
  return `competitions/${COMP_ID}/assets/club-logos/${name}`;
}

function documentPath(name = 'course.pdf', folder = 'public') {
  return `competitions/${COMP_ID}/documents/${folder}/${name}`;
}

function legacyDocumentPath(name = 'legacy.pdf') {
  return `competitions/${COMP_ID}/documents/${name}`;
}

async function upload(context, path, content, contentType) {
  return context.storage().ref(path).putString(content, 'raw', { contentType });
}

const DRIVER_EMAIL = 'driver@example.com';

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath()), {
      name: 'Storage Rules Competition',
      createdBy: 'owner-1',
      admins: []
    });
    await setDoc(doc(db, compPath('equipagePrivate/7')), { email: DRIVER_EMAIL });
    // Written by getDriverInbox
    await setDoc(doc(db, `users/driver-1/driverCompetitions/${COMP_ID}`), { appId: APP_ID, startNumber: '7' });
    await upload(context, logoPath(), 'png-data', 'image/png');
    await upload(context, documentPath(), 'pdf-data', 'application/pdf');
    await upload(context, documentPath('drivers.pdf', 'drivers'), 'pdf-data', 'application/pdf');
    await upload(context, legacyDocumentPath(), 'pdf-data', 'application/pdf');
  });
}

async function setCompetitionPublished(published) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath()), { published }, { merge: true });
  });
}

before(async () => {
  if (!HAS_EMULATORS) return;
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: firestoreRules },
    storage: { rules: storageRules }
  });
});

beforeEach(async () => {
  if (!HAS_EMULATORS) return;
  await Promise.all([testEnv.clearFirestore(), testEnv.clearStorage()]);
  await seedBaseData();
});

after(async () => {
  if (!HAS_EMULATORS || !testEnv) return;
  await testEnv.cleanup();
});

test('storage rules tests require the Firestore and Storage emulators', { skip: HAS_EMULATORS }, () => {
  assert.ok(true, 'Skipped because the required emulator hosts are not set.');
});

test('competition files are readable by link but cannot be listed anonymously', { skip: !HAS_EMULATORS }, async () => {
  const storage = testEnv.unauthenticatedContext().storage();

  await assertSucceeds(storage.ref(logoPath()).getDownloadURL());
  await assertSucceeds(storage.ref(documentPath()).getDownloadURL());
  await assertFails(storage.ref(`competitions/${COMP_ID}/documents/public`).listAll());
  await assertFails(storage.ref(`competitions/${COMP_ID}/documents`).listAll());
});

test('public documents of a draft competition are not readable anonymously', { skip: !HAS_EMULATORS }, async () => {
  await setCompetitionPublished(false);
  const anonymous = testEnv.unauthenticatedContext().storage();
  await assertFails(anonymous.ref(documentPath()).getDownloadURL());

  const owner = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com', email_verified: true }).storage();
  await assertSucceeds(owner.ref(documentPath()).getDownloadURL());

  await setCompetitionPublished(true);
  await assertSucceeds(anonymous.ref(documentPath()).getDownloadURL());
});

test('driver-only documents: drivers and staff only', { skip: !HAS_EMULATORS }, async () => {
  const path = documentPath('drivers.pdf', 'drivers');

  await assertFails(testEnv.unauthenticatedContext().storage().ref(path).getDownloadURL());

  // Any signed-in account, also with a verified email of its own
  const outsider = testEnv.authenticatedContext('outsider-1', { email: 'outsider@example.com', email_verified: true });
  await assertFails(outsider.storage().ref(path).getDownloadURL());

  // The driver: pointer from getDriverInbox and the equipage's email
  const driver = testEnv.authenticatedContext('driver-1', { email: DRIVER_EMAIL, email_verified: true });
  await assertSucceeds(driver.storage().ref(path).getDownloadURL());

  // Not without a verified email
  const unverified = testEnv.authenticatedContext('driver-1', { email: DRIVER_EMAIL, email_verified: false });
  await assertFails(unverified.storage().ref(path).getDownloadURL());

  // A forged or stale pointer grants nothing: the email must match the equipage
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/outsider-1/driverCompetitions/${COMP_ID}`), { appId: APP_ID, startNumber: '7' });
  });
  await assertFails(outsider.storage().ref(path).getDownloadURL());
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('equipagePrivate/7')), { email: 'someone-else@example.com' });
  });
  await assertFails(driver.storage().ref(path).getDownloadURL());

  // Staff: the owner and a joined official
  const owner = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com', email_verified: true });
  await assertSucceeds(owner.storage().ref(path).getDownloadURL());
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('admins/judge-1')), { role: 'dressage', roles: ['dressage'] });
  });
  const judge = testEnv.authenticatedContext('judge-1', {});
  await assertSucceeds(judge.storage().ref(path).getDownloadURL());

  // Only admins may upload there
  await assertFails(upload(driver, documentPath('mine.pdf', 'drivers'), 'pdf', 'application/pdf'));
  await assertFails(upload(judge, documentPath('judge.pdf', 'drivers'), 'pdf', 'application/pdf'));
  await assertSucceeds(upload(owner, documentPath('new.pdf', 'drivers'), 'pdf', 'application/pdf'));
});

test('older documents straight under documents/ are for staff only and take no new uploads', { skip: !HAS_EMULATORS }, async () => {
  const path = legacyDocumentPath();
  await assertFails(testEnv.unauthenticatedContext().storage().ref(path).getDownloadURL());
  const owner = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com', email_verified: true });
  await assertSucceeds(owner.storage().ref(path).getDownloadURL());
  await assertFails(upload(owner, legacyDocumentPath('new.pdf'), 'pdf', 'application/pdf'));
  await assertSucceeds(owner.storage().ref(path).delete());
});

test('an admins/{uid} doc without role or roles grants no file access', { skip: !HAS_EMULATORS }, async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath('admins/no-role-1')), { email: 'norole@example.com', joinedAt: 1 });
  });
  const context = testEnv.authenticatedContext('no-role-1', { email: 'norole@example.com', email_verified: true });
  await assertFails(upload(context, logoPath('norole.png'), 'png-data', 'image/png'));
  await assertFails(context.storage().ref(documentPath('drivers.pdf', 'drivers')).getDownloadURL());
  await assertFails(context.storage().ref(legacyDocumentPath()).getDownloadURL());
});

test('the competition owner can upload, list and delete allowed files', { skip: !HAS_EMULATORS }, async () => {
  const context = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com', email_verified: true });
  const storage = context.storage();

  await assertSucceeds(upload(context, logoPath('new.webp'), 'webp-data', 'image/webp'));
  await assertSucceeds(upload(context, documentPath('start-list.csv'), 'nr,name', 'text/csv'));
  await assertSucceeds(storage.ref(`competitions/${COMP_ID}/documents/public`).listAll());
  await assertSucceeds(storage.ref(documentPath('start-list.csv')).delete());
  await assertSucceeds(storage.ref(logoPath('new.webp')).delete());
});

test('an authenticated non-admin cannot upload, list or delete competition files', { skip: !HAS_EMULATORS }, async () => {
  const context = testEnv.authenticatedContext('outsider-1', { email: 'outsider@example.com', email_verified: true });
  const storage = context.storage();

  await assertFails(upload(context, logoPath('unauthorized.png'), 'png-data', 'image/png'));
  await assertFails(storage.ref(`competitions/${COMP_ID}/documents/public`).listAll());
  await assertFails(storage.ref(documentPath()).delete());
  await assertFails(upload(context, documentPath('outsider.pdf'), 'pdf', 'application/pdf'));
});

test('uploads reject unsafe types, oversized logos and unknown paths', { skip: !HAS_EMULATORS }, async () => {
  const context = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com', email_verified: true });
  const oversized = 'x'.repeat(5 * 1024 * 1024);

  await assertFails(upload(context, logoPath('unsafe.svg'), '<svg/>', 'image/svg+xml'));
  await assertFails(upload(context, documentPath('unsafe.html'), '<script></script>', 'text/html'));
  await assertFails(upload(context, documentPath('unsafe.html', 'drivers'), '<script></script>', 'text/html'));
  await assertFails(upload(context, logoPath('too-large.png'), oversized, 'image/png'));
  await assertFails(upload(context, `competitions/${COMP_ID}/other/file.txt`, 'text', 'text/plain'));
});

test('a verified role-email admin can manage competition files', { skip: !HAS_EMULATORS }, async () => {
  const email = 'role-admin@example.com';
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), compPath(`roleEmails/${email}`)), {
      email,
      roles: ['admin']
    });
  });
  const context = testEnv.authenticatedContext('role-admin-1', { email, email_verified: true });

  await assertSucceeds(upload(context, logoPath('role-admin.jpg'), 'jpg-data', 'image/jpeg'));
  await assertSucceeds(context.storage().ref(logoPath('role-admin.jpg')).delete());
});
