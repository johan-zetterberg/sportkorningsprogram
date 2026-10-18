import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkStartNumbers, stageResultRecalculation } from '../functions/src/resultRecalculationUtils.js';

// Minimal document store with optimistic transactions: a transaction whose
// reads changed before it commits is retried, as Firestore does
function createFakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([path, data]) => [path, { data, version: 1 }]));
  const version = (path) => docs.get(path)?.version ?? 0;
  const snapshot = (path) => {
    const doc = docs.get(path);
    return { exists: !!doc, data: () => (doc ? structuredClone(doc.data) : undefined) };
  };
  const write = (path, data) => docs.set(path, { data, version: version(path) + 1 });
  const remove = (path) => docs.delete(path);
  const stats = { attempts: 0 };

  async function runTransaction(fn, { onRead = null } = {}) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      stats.attempts += 1;
      const readVersions = new Map();
      const writes = [];
      const tx = {
        get: async (path) => {
          readVersions.set(path, version(path));
          const snap = snapshot(path);
          if (onRead) await onRead(path, attempt);
          return snap;
        },
        set: (path, data) => writes.push([path, data]),
        delete: (path) => writes.push([path, null])
      };
      const result = await fn(tx);
      const stale = [...readVersions].some(([path, seen]) => version(path) !== seen);
      if (stale) continue;
      writes.forEach(([path, data]) => (data === null ? remove(path) : write(path, data)));
      return result;
    }
    throw new Error('ABORTED');
  }

  return { runTransaction, write, remove, read: (path) => docs.get(path)?.data, snapshot, stats };
}

const recalculation = (overrides = {}) => ({
  loadContext: async (read) => {
    const [comp, config] = await Promise.all([read('comp'), read('config')]);
    return {
      competitionGone: !comp.exists,
      archived: comp.data()?.locked === true,
      settingsFingerprint: JSON.stringify(config.data() ?? null),
      rate: config.data()?.rate ?? 1
    };
  },
  loadInputs: async (startNumber, read) => ({ startNumber, marathon: await read(`maraton/${startNumber}`) }),
  calculate: (inputs, context) => (inputs.marathon.exists
    ? { startNumber: inputs.startNumber, total: inputs.marathon.data().penalty * context.rate }
    : null),
  targetRef: (startNumber) => `computed/${startNumber}`,
  buildDoc: (record) => ({ totalPenalty: record.total }),
  ...overrides
});

const run = (db, startNumbers, overrides = {}, txOptions = {}) => db.runTransaction((tx) => stageResultRecalculation({
  read: (path) => tx.get(path),
  write: (path, doc) => tx.set(path, doc),
  startNumbers,
  ...recalculation(overrides)
}), txOptions);

const baseDb = () => createFakeDb({
  comp: { name: 'Test' },
  config: { rate: 1 },
  'maraton/7': { penalty: 10 },
  'maraton/8': { penalty: 3 }
});

// Pauses the first attempt of a run right after it read `path`
function pauseAfterRead(path) {
  let reached;
  let release;
  const atRead = new Promise((resolve) => { reached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const onRead = async (readPath, attempt) => {
    if (readPath === path && attempt === 1) {
      reached();
      await gate;
    }
  };
  return { atRead, release, onRead };
}

test('the old pattern (inputs read outside the write transaction) lets an older run overwrite a newer result', async () => {
  const db = baseDb();
  const settings = JSON.stringify(db.read('config'));
  // Run A reads the marathon before the judge saves a correction
  const staleTotal = db.read('maraton/7').penalty;
  db.write('maraton/7', { penalty: 20 });
  // Run B (triggered by the correction) writes the new total
  await run(db, ['7']);
  assert.equal(db.read('computed/7').totalPenalty, 20);
  // Run A finishes last: the settings are unchanged, so its write goes through
  await db.runTransaction(async (tx) => {
    const config = await tx.get('config');
    if (JSON.stringify(config.data()) !== settings) return;
    tx.set('computed/7', { totalPenalty: staleTotal });
  });
  assert.equal(db.read('computed/7').totalPenalty, 10, 'stale total stored');
});

test('a run that read an input before a newer change is retried and stores the latest result', async () => {
  const db = baseDb();
  const pause = pauseAfterRead('maraton/7');
  const runA = run(db, ['7'], {}, { onRead: pause.onRead });
  await pause.atRead;

  // Meanwhile the input changes and run B completes
  db.write('maraton/7', { penalty: 20 });
  await run(db, ['7']);
  assert.equal(db.read('computed/7').totalPenalty, 20);

  pause.release();
  const outcome = await runA;
  assert.deepEqual(outcome, { written: true, count: 1 });
  assert.equal(db.read('computed/7').totalPenalty, 20, 'the older run did not overwrite the newer result');
  // A (2 attempts) + B (1)
  assert.equal(db.stats.attempts, 3);
});

test('a settings change during a run is picked up on retry', async () => {
  const db = baseDb();
  const pause = pauseAfterRead('maraton/8');
  const runA = run(db, ['7', '8'], {}, { onRead: pause.onRead });
  await pause.atRead;
  db.write('config', { rate: 2 });
  pause.release();
  await runA;
  assert.equal(db.read('computed/7').totalPenalty, 20);
  assert.equal(db.read('computed/8').totalPenalty, 6);
});

test('with a validated fingerprint nothing is written once the settings changed', async () => {
  const db = baseDb();
  const validated = JSON.stringify(db.read('config'));
  db.write('config', { rate: 2 });
  const outcome = await run(db, ['7', '8'], { settingsFingerprint: validated });
  assert.deepEqual(outcome, { written: false, reason: 'settings-changed' });
  assert.equal(db.read('computed/7'), undefined);

  const current = await run(db, ['7'], { settingsFingerprint: JSON.stringify({ rate: 2 }) });
  assert.deepEqual(current, { written: true, count: 1 });
  assert.equal(db.read('computed/7').totalPenalty, 20);
});

test('deleted and archived competitions are not written, and their inputs not read', async () => {
  const archived = baseDb();
  archived.write('comp', { locked: true });
  const reads = [];
  const outcome = await run(archived, ['7'], {}, { onRead: async (path) => { reads.push(path); } });
  assert.deepEqual(outcome, { written: false, reason: 'archived' });
  assert.equal(archived.read('computed/7'), undefined);
  assert.deepEqual(reads.sort(), ['comp', 'config']);

  const gone = createFakeDb({ config: { rate: 1 }, 'maraton/7': { penalty: 10 } });
  assert.deepEqual(await run(gone, ['7']), { written: false, reason: 'competition-gone' });
  assert.equal(gone.read('computed/7'), undefined);
});

test('an equal stored result is left alone; a missing equipage is skipped', async () => {
  const db = baseDb();
  db.write('computed/7', { totalPenalty: 10 });
  const isUnchanged = (stored, doc) => stored?.totalPenalty === doc.totalPenalty;
  const outcome = await run(db, ['7', '8', '9'], { isUnchanged });
  assert.deepEqual(outcome, { written: true, count: 1 });
  assert.equal(db.read('computed/8').totalPenalty, 3);
  assert.equal(db.read('computed/9'), undefined);
});

// As writeLatestResults: the equipage is an input, its result removed when it is gone
const withEquipage = {
  loadInputs: async (startNumber, read) => {
    const [equipage, marathon] = await Promise.all([read(`equipages/${startNumber}`), read(`maraton/${startNumber}`)]);
    return { startNumber, equipage, marathon };
  },
  calculate: (inputs, context) => (inputs.equipage.exists
    ? { startNumber: inputs.startNumber, total: (inputs.marathon.data()?.penalty ?? 0) * context.rate }
    : null)
};
const runWithRemove = (db, startNumbers, overrides = {}) => db.runTransaction((tx) => stageResultRecalculation({
  read: (path) => tx.get(path),
  write: (path, doc) => tx.set(path, doc),
  remove: (path) => tx.delete(path),
  startNumbers,
  ...recalculation({ ...withEquipage, ...overrides })
}));

test('deleting an equipage removes its stored result', async () => {
  const db = baseDb();
  db.write('equipages/7', { className: 'A' });
  db.write('equipages/8', { className: 'A' });
  await runWithRemove(db, ['7', '8']);
  assert.equal(db.read('computed/7').totalPenalty, 10);

  db.remove('equipages/7');
  const outcome = await runWithRemove(db, ['7']);
  assert.deepEqual(outcome, { written: true, count: 1 });
  assert.equal(db.read('computed/7'), undefined, 'orphan result removed');
  assert.equal(db.read('computed/8').totalPenalty, 3, 'other results kept');

  // With isUnchanged (automatic runs) nothing is staged when nothing is stored
  const again = await runWithRemove(db, ['7'], { isUnchanged: (stored, doc) => stored?.totalPenalty === doc.totalPenalty });
  assert.deepEqual(again, { written: true, count: 0 });
});

test('an archived or deleted competition keeps the result of a removed equipage', async () => {
  const db = baseDb();
  db.write('equipages/7', { className: 'A' });
  await runWithRemove(db, ['7']);
  db.write('comp', { locked: true });
  db.remove('equipages/7');
  assert.deepEqual(await runWithRemove(db, ['7']), { written: false, reason: 'archived' });
  assert.equal(db.read('computed/7').totalPenalty, 10);

  db.remove('comp');
  assert.deepEqual(await runWithRemove(db, ['7']), { written: false, reason: 'competition-gone' });
  assert.equal(db.read('computed/7').totalPenalty, 10);
});

test('a calculation error skips that equipage only when a handler is given', async () => {
  const calculate = (inputs, context) => {
    if (inputs.startNumber === '7') throw new Error('broken');
    return recalculation().calculate(inputs, context);
  };
  const db = baseDb();
  const failed = [];
  const outcome = await run(db, ['7', '8'], { calculate, onCalculateError: (startNumber) => failed.push(startNumber) });
  assert.deepEqual(outcome, { written: true, count: 1 });
  assert.deepEqual(failed, ['7']);
  assert.equal(db.read('computed/8').totalPenalty, 3);

  await assert.rejects(run(baseDb(), ['7', '8'], { calculate }), /broken/);
});

test('start numbers are split into transaction-sized groups', () => {
  assert.deepEqual(chunkStartNumbers(['1', '2', '3', '4', '5'], 2), [['1', '2'], ['3', '4'], ['5']]);
  assert.deepEqual(chunkStartNumbers([], 25), []);
  assert.deepEqual(chunkStartNumbers(['1'], 0), [['1']]);
});
