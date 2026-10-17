import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dressageDraftKey,
  readDressageDraft,
  writeDressageDraft,
  clearDressageDraft,
  isEmptyDressageDraft,
  shouldRestoreDressageDraft
} from '../js/pages/dressage/dressageDraft.js';

function installStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
  return map;
}

const filled = { ts: 2000, judgeId: 'j1', movements: [{ momentNo: 1, score: '6.5', comment: '' }] };

test('draft key is per competition, start number and judge position', () => {
  assert.equal(dressageDraftKey('c1', 7, { id: 'j1', _pos: 'c' }), 'draft_c1_dre_7_C');
  assert.equal(dressageDraftKey('c1', 7, { id: 'j1' }), 'draft_c1_dre_7_Jj1');
  assert.equal(dressageDraftKey('c1', null, { id: 'j1' }), null);
  assert.equal(dressageDraftKey('c1', 7, null), null);
});

test('drafts round-trip through storage and are cleared', () => {
  installStorage();
  const key = dressageDraftKey('c1', 7, { id: 'j1', _pos: 'C' });
  assert.equal(writeDressageDraft(key, filled), true);
  assert.deepEqual(readDressageDraft(key), filled);
  clearDressageDraft(key);
  assert.equal(readDressageDraft(key), null);
});

test('storage failures do not throw', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('blocked'); }
  };
  assert.equal(readDressageDraft('k'), null);
  assert.equal(writeDressageDraft('k', filled), false);
  assert.doesNotThrow(() => clearDressageDraft('k'));
  installStorage();
});

test('an empty draft is not worth keeping', () => {
  assert.equal(isEmptyDressageDraft({ movements: [{ score: '', comment: ' ' }] }), true);
  assert.equal(isEmptyDressageDraft(filled), false);
  assert.equal(isEmptyDressageDraft({ movements: [], eliminated: true }), false);
  assert.equal(isEmptyDressageDraft({ movements: [], generalDirty: true }), false);
});

test('a draft is restored only for the same judge and when newer than the saved protocol', () => {
  assert.equal(shouldRestoreDressageDraft(filled, null, 'j1'), true);
  assert.equal(shouldRestoreDressageDraft(filled, null, 'j2'), false);
  assert.equal(shouldRestoreDressageDraft(filled, { updatedAt: { toMillis: () => 1000 } }, 'j1'), true);
  assert.equal(shouldRestoreDressageDraft(filled, { updatedAt: { toMillis: () => 3000 } }, 'j1'), false);
  assert.equal(shouldRestoreDressageDraft(filled, { updatedAt: { seconds: 3, nanoseconds: 0 } }, 'j1'), false);
  // Pending or legacy save without a time: a successful save clears the draft
  assert.equal(shouldRestoreDressageDraft(filled, { updatedAt: null }, 'j1'), true);
  assert.equal(shouldRestoreDressageDraft({ ts: 5000, judgeId: 'j1', movements: [] }, null, 'j1'), false);
});
