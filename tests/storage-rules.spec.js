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

function documentPath(name = 'course.pdf') {
  return `competitions/${COMP_ID}/documents/${name}`;
}

async function upload(context, path, content, contentType) {
  return context.storage().ref(path).putString(content, 'raw', { contentType });
}

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, compPath()), {
      name: 'Storage Rules Competition',
      createdBy: 'owner-1',
      admins: []
    });
    await upload(context, logoPath(), 'png-data', 'image/png');
    await upload(context, documentPath(), 'pdf-data', 'application/pdf');
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
  await assertFails(storage.ref(`competitions/${COMP_ID}/documents`).listAll());
});

test('the competition owner can upload, list and delete allowed files', { skip: !HAS_EMULATORS }, async () => {
  const context = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com', email_verified: true });
  const storage = context.storage();

  await assertSucceeds(upload(context, logoPath('new.webp'), 'webp-data', 'image/webp'));
  await assertSucceeds(upload(context, documentPath('start-list.csv'), 'nr,name', 'text/csv'));
  await assertSucceeds(storage.ref(`competitions/${COMP_ID}/documents`).listAll());
  await assertSucceeds(storage.ref(logoPath('new.webp')).delete());
});

test('an authenticated non-admin cannot upload, list or delete competition files', { skip: !HAS_EMULATORS }, async () => {
  const context = testEnv.authenticatedContext('outsider-1', { email: 'outsider@example.com', email_verified: true });
  const storage = context.storage();

  await assertFails(upload(context, logoPath('unauthorized.png'), 'png-data', 'image/png'));
  await assertFails(storage.ref(`competitions/${COMP_ID}/documents`).listAll());
  await assertFails(storage.ref(documentPath()).delete());
});

test('uploads reject unsafe types, oversized logos and unknown paths', { skip: !HAS_EMULATORS }, async () => {
  const context = testEnv.authenticatedContext('owner-1', { email: 'owner@example.com', email_verified: true });
  const oversized = 'x'.repeat(5 * 1024 * 1024);

  await assertFails(upload(context, logoPath('unsafe.svg'), '<svg/>', 'image/svg+xml'));
  await assertFails(upload(context, documentPath('unsafe.html'), '<script></script>', 'text/html'));
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
