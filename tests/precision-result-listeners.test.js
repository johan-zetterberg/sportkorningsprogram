import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPrecisionLiveDocChanges,
  groupDressageProtocolsByStartNumber,
  normalizeMarathonTimingDocs,
  unsubscribeAll
} from '../js/pages/precision/precisionResultListeners.js';

function change(type, id, data) {
  return {
    type,
    doc: {
      id,
      data: () => data
    }
  };
}

test('applyPrecisionLiveDocChanges stores received timestamp and detects started live result', () => {
  const precisionMap = new Map();

  const result = applyPrecisionLiveDocChanges([
    change('added', '12', { running: true, liveStartEpoch: 1000 })
  ], precisionMap, 5000);

  assert.equal(result.needsFullRender, true);
  assert.equal(result.anyRunning, true);
  assert.equal(precisionMap.get('12')._receivedLocalAt, 5000);
});

test('applyPrecisionLiveDocChanges detects removed result and stopped running result', () => {
  const precisionMap = new Map([
    ['12', { running: true, liveStartEpoch: 1000 }],
    ['13', { finalized: true, totalPenalty: 2 }]
  ]);

  const result = applyPrecisionLiveDocChanges([
    change('modified', '12', { running: false }),
    change('removed', '13', {})
  ], precisionMap, 6000);

  assert.equal(result.needsFullRender, true);
  assert.equal(result.anyRunning, false);
  assert.equal(precisionMap.has('13'), false);
});

test('groupDressageProtocolsByStartNumber groups protocol docs', () => {
  const grouped = groupDressageProtocolsByStartNumber([
    { startNumber: 1, judge: 'C' },
    { startNumber: '1', judge: 'B' },
    { startNumber: 2, judge: 'C' }
  ]);

  assert.equal(grouped.get('1').length, 2);
  assert.equal(grouped.get('2').length, 1);
});

test('normalizeMarathonTimingDocs accepts snapshot-like docs and arrays', () => {
  const map = normalizeMarathonTimingDocs({
    docs: [
      { id: '12', data: () => ({ sectionB: 120 }) },
      { data: () => ({ startNumber: 13, sectionB: 130 }) }
    ]
  });

  assert.equal(map.get('12').sectionB, 120);
  assert.equal(map.get('13').sectionB, 130);
});

test('unsubscribeAll calls functions and ignores cleanup errors', () => {
  let count = 0;

  unsubscribeAll([
    () => { count += 1; },
    () => { throw new Error('already closed'); },
    () => { count += 1; }
  ]);

  assert.equal(count, 2);
});
