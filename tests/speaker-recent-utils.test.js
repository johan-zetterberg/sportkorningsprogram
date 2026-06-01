import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findRecentResultIndex,
  removeRecentResult,
  upsertRecentResult
} from '../js/pages/shared/speakerRecentUtils.js';

test('speaker recent helpers find and remove by normalized start number', () => {
  const recent = [
    { sn: '1', finalPenalty: 40 },
    { sn: 2, finalPenalty: 41 }
  ];

  assert.equal(findRecentResultIndex(recent, 2), 1);
  assert.equal(removeRecentResult(recent, '2'), true);
  assert.deepEqual(recent, [{ sn: '1', finalPenalty: 40 }]);
  assert.equal(removeRecentResult(recent, 9), false);
});

test('speaker recent helpers insert new rows at the top', () => {
  const recent = [{ sn: '1', finalPenalty: 40 }];

  const changed = upsertRecentResult(recent, { sn: '2', finalPenalty: 39 });

  assert.equal(changed, true);
  assert.deepEqual(recent.map(row => row.sn), ['2', '1']);
});

test('speaker recent helpers can skip unchanged updates', () => {
  const entry = { sn: '1', finalPenalty: 40 };
  const recent = [entry];

  const changed = upsertRecentResult(recent, { sn: '1', finalPenalty: 40 }, { skipUnchanged: true });

  assert.equal(changed, false);
  assert.equal(recent[0], entry);
});

test('speaker recent helpers can merge existing marathon rows', () => {
  const existing = { sn: '1', finalPenalty: 40, status: 'running', note: 'kept' };
  const recent = [existing];

  const changed = upsertRecentResult(recent, { sn: '1', finalPenalty: 38, status: 'finished' }, { mergeExisting: true });

  assert.equal(changed, true);
  assert.equal(recent[0], existing);
  assert.deepEqual(recent[0], { sn: '1', finalPenalty: 38, status: 'finished', note: 'kept' });
});
