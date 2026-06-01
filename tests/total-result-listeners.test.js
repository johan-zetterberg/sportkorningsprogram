import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupDocsByStartNumber,
  mapRowsByStartNumber,
  normalizeTimingDocs,
  replaceMapContents,
  unsubscribeAll
} from '../js/pages/shared/totalResultListeners.js';

test('groupDocsByStartNumber groups docs under string start number', () => {
  const grouped = groupDocsByStartNumber([
    { startNumber: 1, judge: 'C' },
    { startNumber: '1', judge: 'B' },
    { startNumber: 2, judge: 'C' }
  ]);

  assert.equal(grouped.get('1').length, 2);
  assert.equal(grouped.get('2').length, 1);
});

test('mapRowsByStartNumber accepts id or startNumber keys', () => {
  const map = mapRowsByStartNumber([
    { id: '12', totalPenalty: 4 },
    { startNumber: 13, totalPenalty: 5 }
  ]);

  assert.equal(map.get('12').totalPenalty, 4);
  assert.equal(map.get('13').totalPenalty, 5);
});

test('normalizeTimingDocs handles Map, arrays and snapshot-like docs', () => {
  const fromMap = normalizeTimingDocs(new Map([[12, { B: 100 }]]));
  assert.equal(fromMap.get('12').B, 100);

  const fromSnapshot = normalizeTimingDocs({
    docs: [
      { id: '14', data: () => ({ B: 140 }) },
      { data: () => ({ startNumber: 15, B: 150 }) }
    ]
  });
  assert.equal(fromSnapshot.get('14').B, 140);
  assert.equal(fromSnapshot.get('15').B, 150);
});

test('replaceMapContents replaces existing data', () => {
  const target = new Map([['old', {}]]);
  replaceMapContents(target, new Map([[12, { B: 100 }]]));

  assert.equal(target.has('old'), false);
  assert.equal(target.get('12').B, 100);
});

test('unsubscribeAll ignores cleanup errors', () => {
  let count = 0;
  unsubscribeAll([
    () => { count += 1; },
    () => { throw new Error('closed'); },
    () => { count += 1; }
  ]);

  assert.equal(count, 2);
});
