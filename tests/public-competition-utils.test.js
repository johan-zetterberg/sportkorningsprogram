import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPublicClassSummary,
  buildPublicMergeMap,
  resolvePublicDisplayClass
} from '../js/services/publicCompetitionUtils.js';

test('public competition overview groups TDB merged classes', () => {
  const mergeMap = buildPublicMergeMap({
    mergeByClassNumber: {
      'msv-4': { label: 'MSV 4 Ponny', members: [9, 10] }
    }
  });

  const rows = buildPublicClassSummary({
    mergeMap,
    equipages: [
      { startNumber: 1, className: 'MSV 4 Enbet ponny', tdbClassNumber: 9 },
      { startNumber: 2, className: 'MSV 4 Par ponny', tdbClassNumber: 10 },
      { startNumber: 3, className: 'Lätt A Enbet Ponny', tdbClassNumber: 2 }
    ]
  });

  assert.deepEqual(
    rows.map(row => [row.className, row.starters]),
    [
      ['Lätt A Enbet Ponny', 1],
      ['MSV 4 Ponny', 2]
    ]
  );
});

test('public competition overview uses merged display class for start time windows', () => {
  const mergeMap = buildPublicMergeMap({
    mergeByClassNumber: {
      'msv-4': { label: 'MSV 4 Ponny', members: [9, 10] }
    }
  });

  const rows = buildPublicClassSummary({
    mergeMap,
    equipages: [
      { startNumber: 1, className: 'MSV 4 Enbet ponny', tdbClassNumber: 9 },
      { startNumber: 2, className: 'MSV 4 Par ponny', tdbClassNumber: 10 }
    ],
    startTimes: {
      1: { dressage: '2026-06-02T09:00:00' },
      2: { dressage: '2026-06-02T09:20:00' }
    }
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].className, 'MSV 4 Ponny');
  assert.equal(rows[0].dressageWindow, '09:00 - 09:20');
});

test('public display class prefers per-equipage merged test label', () => {
  const group = resolvePublicDisplayClass({
    className: 'Original',
    tdbClassNumber: 1,
    useMergedTestForDisplay: true,
    mergedTestKey: 'program-522',
    mergedTestLabel: 'Lätt B'
  }, buildPublicMergeMap({
    mergeByClassNumber: {
      other: { label: 'Annan grupp', members: [1] }
    }
  }));

  assert.deepEqual(group, { key: 'program-522', label: 'Lätt B' });
});
