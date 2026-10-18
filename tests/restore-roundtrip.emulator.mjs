// End to end: export a competition the way exportCompetition does, delete
// it, restore it with scripts/restore-competition.mjs and compare. Needs the
// Firestore emulator: npm run test:restore (not part of npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  collectDocuments,
  competitionRootPaths,
  redactExportDocuments,
  rewriteCompetitionId
} from '../functions/src/competitionExport.js';

const PROJECT_ID = 'demo-combined-driving';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST saknas: kör via npm run test:restore');
  process.exit(1);
}

const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = requireFromFunctions('firebase-admin/app');
const { getFirestore, Timestamp, GeoPoint, DocumentReference } = requireFromFunctions('firebase-admin/firestore');
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const SCRIPT = fileURLToPath(new URL('../scripts/restore-competition.mjs', import.meta.url));
const APP_ID = 'restore-test-app';
const COMP_ID = `restore-${Date.now()}`;
const COPY_ID = `${COMP_ID}-copy`;
const [PUBLIC, PRIVATE, FINAL] = competitionRootPaths(APP_ID, COMP_ID);
const workDir = mkdtempSync(join(tmpdir(), 'restore-test-'));
const backupFile = join(workDir, 'backup.json');

function restore(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, backupFile, ...args], { encoding: 'utf8', env: process.env });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
}

async function readTrees(roots) {
  const out = [];
  for (const root of roots) await collectDocuments(db.doc(root), { out });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function deleteTrees(roots) {
  for (const root of roots) await db.recursiveDelete(db.doc(root));
}

// A small competition with every kind of value and nesting the app stores
async function seed() {
  const at = Timestamp.fromMillis(1760000000123);
  const docs = {
    [PUBLIC]: {
      id: COMP_ID, name: 'Återställningstest', createdBy: 'owner-uid', accessCode: '11112222',
      createdAt: at, place: new GeoPoint(55.7, 13.2), dates: ['2026-10-17', '2026-10-18']
    },
    [`${PUBLIC}/config/secrets`]: { accessCode: '11112222', accessCode_vet: '33334444' },
    [`${PUBLIC}/config/maratonConfig`]: { stages: [{ name: 'A', km: 2.5 }, { name: 'B', km: 4 }], updatedAt: at },
    [`${PUBLIC}/equipages/5`]: { startNumber: 5, driverName: 'Anna', driverSSN: '19800101-1234', klass: 'Latt A', horses: [{ name: 'Blixt' }] },
    [`${PUBLIC}/equipages/7`]: { startNumber: 7, driverName: 'Bo', klass: 'Latt A', horses: [] },
    [`${PUBLIC}/equipagePrivate/5`]: { email: 'anna@example.se', ssn: '19800101-1234', phone: '070-1' },
    // Protocols below a dressage document that has no data of its own
    [`${PUBLIC}/dressage/5/protocols/C`]: { judgeId: 'C', scores: [7, 6.5, { parts: [8, 7] }], total: 210.5, savedAt: at },
    [`${PUBLIC}/dressage/5/protocols/E`]: { judgeId: 'E', scores: [6, 7], total: 199, savedAt: at },
    [`${PUBLIC}/computed_equipages/5`]: {
      total: 52.3, marathon: { penalties: Infinity, eliminated: true }, low: -Infinity, odd: NaN,
      calculatedAt: at, equipageRef: db.doc(`${PUBLIC}/equipages/5`), checksum: Buffer.from([1, 2, 3, 254])
    },
    [`${PUBLIC}/archive/final`]: {
      competitionId: COMP_ID,
      rows: [{ startNumber: 5, at, ref: db.doc(`${PUBLIC}/equipages/5`), ssn: 'x' }, { startNumber: 7, parts: [{ at }] }]
    },
    [`${PRIVATE}/rateLimits/u1`]: { count: 3, windowStart: at },
    [`${FINAL}/dressageFinalization/5`]: { competitionId: COMP_ID, lockedBy: 'owner-uid', lockedAt: at }
  };
  const batch = db.batch();
  Object.entries(docs).forEach(([path, data]) => batch.set(db.doc(path), data));
  await batch.commit();
  return Object.keys(docs).length;
}

// The same steps as the exportCompetition callable
async function exportCompetition() {
  const documents = await readTrees(competitionRootPaths(APP_ID, COMP_ID));
  const { documents: kept, redacted } = redactExportDocuments(documents, { includePersonalNumbers: false });
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    competitionId: COMP_ID,
    appId: APP_ID,
    name: 'Återställningstest',
    exportedAt: new Date().toISOString(),
    exportedBy: 'owner-uid',
    documentCount: kept.length,
    includesPersonalNumbers: false,
    redacted,
    documents: kept,
    storageFiles: [`competitions/${COMP_ID}/logo.png`]
  };
}

test('a competition comes back from its backup, and a copy can be restored next to it', async (t) => {
  t.after(async () => {
    await deleteTrees([...competitionRootPaths(APP_ID, COMP_ID), ...competitionRootPaths(APP_ID, COPY_ID)]);
    rmSync(workDir, { recursive: true, force: true });
  });

  const seeded = await seed();
  const exportData = await exportCompetition();
  assert.equal(exportData.documents.length, seeded - 1, 'config/secrets is not exported');
  writeFileSync(backupFile, JSON.stringify(exportData));

  await deleteTrees(competitionRootPaths(APP_ID, COMP_ID));
  assert.equal((await readTrees(competitionRootPaths(APP_ID, COMP_ID))).length, 0);

  // Guards: an explicit project, and never production without --yes-production
  let run = restore();
  assert.notEqual(run.code, 0);
  assert.match(run.out, /--project krävs/);
  run = restore('--project', 'combined-driving');
  assert.notEqual(run.code, 0);
  assert.match(run.out, /PRODUKTIONSPROJEKTET/);
  assert.match(run.out, /--yes-production/);
  run = restore('--project', PROJECT_ID, '--dry-run');
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /Inget skrevs/);
  assert.equal((await readTrees(competitionRootPaths(APP_ID, COMP_ID))).length, 0);

  // The restore
  run = restore('--project', PROJECT_ID);
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /PIN-koder/);
  assert.match(run.out, /Personnummer/);
  assert.match(run.out, /logo\.png/);
  const restored = await readTrees(competitionRootPaths(APP_ID, COMP_ID));
  const expected = [...exportData.documents].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(restored, expected);

  // Real Firestore types, not maps that look like them
  const computed = (await db.doc(`${PUBLIC}/computed_equipages/5`).get()).data();
  assert.ok(computed.calculatedAt instanceof Timestamp);
  assert.equal(computed.calculatedAt.toMillis(), 1760000000123);
  assert.ok(computed.equipageRef instanceof DocumentReference);
  assert.ok(Buffer.isBuffer(computed.checksum));
  assert.equal(computed.marathon.penalties, Infinity);
  assert.equal(computed.low, -Infinity);
  assert.ok(Number.isNaN(computed.odd));
  assert.ok((await db.doc(PUBLIC).get()).data().place instanceof GeoPoint);
  assert.equal((await db.doc(`${PUBLIC}/config/secrets`).get()).exists, false);

  // A second restore refuses; --overwrite writes it again
  run = restore('--project', PROJECT_ID);
  assert.notEqual(run.code, 0);
  assert.match(run.out, /finns redan/);
  await db.doc(`${PUBLIC}/equipages/5`).update({ driverName: 'Ändrad' });
  run = restore('--project', PROJECT_ID, '--overwrite');
  assert.equal(run.code, 0, run.out);
  assert.equal((await db.doc(`${PUBLIC}/equipages/5`).get()).data().driverName, 'Anna');
  assert.deepEqual(await readTrees(competitionRootPaths(APP_ID, COMP_ID)), expected);

  // A copy next to the original
  run = restore('--project', PROJECT_ID, '--as-new-id', COPY_ID);
  assert.equal(run.code, 0, run.out);
  const copy = await readTrees(competitionRootPaths(APP_ID, COPY_ID));
  const expectedCopy = rewriteCompetitionId(expected, COMP_ID, COPY_ID).documents.sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(copy, expectedCopy);
  assert.equal(copy.length, expected.length);
  const [COPY_PUBLIC, , COPY_FINAL] = competitionRootPaths(APP_ID, COPY_ID);
  assert.equal((await db.doc(COPY_PUBLIC).get()).data().id, COPY_ID);
  assert.equal((await db.doc(`${COPY_FINAL}/dressageFinalization/5`).get()).data().competitionId, COPY_ID);
  const copyRef = (await db.doc(`${COPY_PUBLIC}/computed_equipages/5`).get()).data().equipageRef;
  assert.equal(copyRef.path, `${COPY_PUBLIC}/equipages/5`);
  // The original is untouched
  assert.deepEqual(await readTrees(competitionRootPaths(APP_ID, COMP_ID)), expected);
});
