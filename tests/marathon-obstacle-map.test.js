import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeMarathonObstacles,
  obstacleLiveEntry,
  activeObstacleLive,
  normalizeMarathonDoc,
  buildObstacleSaveWrites,
  buildCompetitionState
} from '../js/core-engine/stateSelector.js';
import { buildServerCompetitionState } from '../functions/src/resultRecalculationUtils.js';
import { marathonWriteAffectsResults } from '../functions/src/triggerFilters.js';
import { pruneFieldBackups } from '../js/utils/fieldBackup.js';

// Firestore's merge of a set({ ... }, { merge: true }): maps are merged field
// by field, everything else (arrays too) is replaced
function mergeSet(target, update) {
  const out = { ...target };
  Object.entries(update).forEach(([key, value]) => {
    const isMap = value && typeof value === 'object' && !Array.isArray(value);
    const wasMap = out[key] && typeof out[key] === 'object' && !Array.isArray(out[key]);
    out[key] = isMap && wasMap ? mergeSet(out[key], value) : value;
  });
  return out;
}

const result = (n, timeMs, extra = {}) => ({
  number: n, timeMs, timeInSeconds: timeMs / 1000, penalty: 0, comment: '', eliminated: false, routeString: '', ...extra
});

test('per-obstacle results merge with the older obstacles[] (map wins)', () => {
  const doc = {
    obstacles: [result(1, 20000, { gateSplits: [{ char: 'A' }] }), result(2, 30000)],
    obstacleResults: {
      2: result(2, 31000),
      3: result(3, 40000)
    }
  };
  const list = mergeMarathonObstacles(doc);
  assert.deepEqual(list.map(o => [o.number, o.timeMs]), [[1, 20000], [2, 31000], [3, 40000]]);
  // A legacy field the map entry has not got is kept
  assert.deepEqual(list[0].gateSplits, [{ char: 'A' }]);
  assert.deepEqual(mergeMarathonObstacles({}), []);
  assert.deepEqual(mergeMarathonObstacles({ obstacles: [result(4, 1000)] }).map(o => o.number), [4]);
});

test('two obstacles saving the same equipage, one of them offline, keep both results', () => {
  // The document as both devices last saw it
  const start = { startNumber: 7, obstacles: [result(1, 20000)], obstacleLive: { 3: { running: true, inProgress: true } } };
  // Obstacle 2 saves online; obstacle 3 saved earlier offline from its stale
  // copy and the queued write arrives afterwards
  const save2 = buildObstacleSaveWrites(2, result(2, 33000), () => 'T2');
  const save3 = buildObstacleSaveWrites(3, result(3, 44000), () => 'T3');
  const server = mergeSet(mergeSet(start, save2.summaryUpdate), save3.summaryUpdate);
  const list = mergeMarathonObstacles(server);
  assert.deepEqual(list.map(o => [o.number, o.timeMs]), [[1, 20000], [2, 33000], [3, 44000]]);
  // Either order
  const other = mergeSet(mergeSet(start, save3.summaryUpdate), save2.summaryUpdate);
  assert.deepEqual(mergeMarathonObstacles(other).map(o => o.number), [1, 2, 3]);
  // No save writes the whole list or a flat live field
  assert.equal('obstacles' in save2.summaryUpdate, false);
  assert.equal('running' in save2.summaryUpdate, false);
  assert.equal('currentObstacle' in save2.summaryUpdate, false);
});

test('a save clears only its own clock: another obstacle\'s running clock goes on', () => {
  const start = { obstacleLive: { 4: { running: true, inProgress: true, liveObstacleStartAt: 5000, liveObstacleTimeMs: 0 } } };
  const save2 = buildObstacleSaveWrites(2, result(2, 33000), () => 'T');
  const server = mergeSet(start, save2.summaryUpdate);
  assert.equal(server.obstacleLive['4'].running, true);
  assert.equal(server.obstacleLive['4'].liveObstacleStartAt, 5000);
  assert.equal(server.obstacleLive['2'].running, false);
  assert.equal(server.obstacleLive['2'].inProgress, false);
  // The monitors still see obstacle 4 running
  const shown = normalizeMarathonDoc(server);
  assert.equal(shown.currentObstacle, 4);
  assert.equal(shown.running, true);
});

test('a save without gate splits or entry time keeps the judge\'s', () => {
  const judge = buildObstacleSaveWrites(2, result(2, 33000, { gateSplits: [{ char: 'A' }], enteredAt: 'E' }), () => 'T');
  const secretariat = buildObstacleSaveWrites(2, result(2, 34000, { gateSplits: null, enteredAt: null }), () => 'T');
  assert.equal('gateSplits' in secretariat.entry, false);
  const server = mergeSet(mergeSet({}, judge.summaryUpdate), secretariat.summaryUpdate);
  const o = mergeMarathonObstacles(server)[0];
  assert.equal(o.timeMs, 34000);
  assert.deepEqual(o.gateSplits, [{ char: 'A' }]);
  assert.equal(o.enteredAt, 'E');
  assert.equal(secretariat.obstacleDoc.obstacleNumber, 2);
});

test('the active obstacle: the latest running clock, else the latest unsaved work', () => {
  const doc = {
    obstacleLive: {
      2: { running: false, inProgress: true, updatedAt: 9000 },
      3: { running: true, inProgress: true, liveObstacleStartAt: 4000 },
      5: { running: true, inProgress: true, liveObstacleStartAt: 6000 },
      6: { running: false, inProgress: false }
    }
  };
  assert.equal(activeObstacleLive(doc).number, 5);
  const noClock = { obstacleLive: { 2: { inProgress: true, updatedAt: 1000 }, 4: { inProgress: true, updatedAt: { seconds: 5 } } } };
  assert.equal(activeObstacleLive(noClock).number, 4);
  assert.equal(activeObstacleLive({ obstacleLive: { 6: { running: false } } }), null);
  assert.equal(obstacleLiveEntry(doc, 6).running, false);
  assert.equal(obstacleLiveEntry(doc, 7), null);
});

test('readers get the flat live fields of the active obstacle; older documents stay as they are', () => {
  const doc = {
    startNumber: 3,
    currentObstacle: 1, running: true, // stale flat fields from an older writer
    obstacleLive: { 4: { running: false, inProgress: true, liveObstacleTimeMs: 12000, live_routeString: 'A B' } }
  };
  const n = normalizeMarathonDoc(doc);
  assert.equal(n.currentObstacle, 4);
  assert.equal(n.running, false);
  assert.equal(n.inProgress, true);
  assert.equal(n.liveObstacleTimeMs, 12000);
  assert.equal(n.live_routeString, 'A B');
  assert.equal(n.live_comment, '');
  // Idempotent
  assert.deepEqual(normalizeMarathonDoc(n).currentObstacle, 4);
  // Nothing going on: cleared
  const idle = normalizeMarathonDoc({ obstacleLive: { 4: { running: false, inProgress: false } } });
  assert.equal(idle.currentObstacle, null);
  assert.equal(idle.running, false);
  // An older document without the maps is unchanged
  const legacy = { currentObstacle: 2, running: true, liveObstacleTimeMs: 5 };
  assert.deepEqual(normalizeMarathonDoc(legacy), legacy);
});

test('engine and server read the per-obstacle results', () => {
  const doc = { obstacleResults: { 2: result(2, 31000) } };
  assert.deepEqual(buildCompetitionState({ startNumber: 1 }, [], doc, {}, {}).marathon.resultDoc.obstacles.map(o => o.number), [2]);
  const server = buildServerCompetitionState({ equipage: { startNumber: 1 }, marathonDoc: doc });
  assert.deepEqual(server.marathon.resultDoc.obstacles.map(o => o.timeMs), [31000]);
  // Live entries do not trigger a recalculation, saved results do
  assert.equal(marathonWriteAffectsResults({ a: 1 }, { a: 1, obstacleLive: { 3: { running: true } } }), false);
  assert.equal(marathonWriteAffectsResults({ a: 1 }, { a: 1, obstacleResults: { 3: result(3, 1) } }), true);
});

test('old field backups are removed and only the newest are kept', () => {
  const data = new Map();
  const storage = {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k)
  };
  const now = 100 * 24 * 3600 * 1000;
  const day = 24 * 3600 * 1000;
  storage.setItem('bkp_c1_mar_1', JSON.stringify({ ts: now - 10 * day, data: {} }));
  storage.setItem('bkp_c1_mar_2', JSON.stringify({ ts: now - day, data: {} }));
  storage.setItem('bkp_c1_mar_3', JSON.stringify({ ts: now - 2 * day, data: {} }));
  storage.setItem('bkp_c1_mar_4', 'not json');
  storage.setItem('other', 'kept');
  const removed = pruneFieldBackups({ storage, now, maxEntries: 1 });
  assert.equal(removed, 3);
  assert.deepEqual([...data.keys()].sort(), ['bkp_c1_mar_2', 'other']);
});
