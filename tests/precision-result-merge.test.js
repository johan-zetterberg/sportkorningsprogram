import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrecisionMergeState,
  groupPrecisionEquipagesForDisplay,
  resolvePrecisionMergeGrouping
} from '../js/pages/precision/precisionResultMerge.js';

test('buildPrecisionMergeState builds configured TDB merge groups', () => {
  const { groups, map } = buildPrecisionMergeState({
    mergeByClassNumber: {
      groupA: {
        label: 'Lätt klass',
        members: [2, '1']
      }
    }
  });

  assert.deepEqual(groups, [{ key: 'groupA', label: 'Lätt klass', members: [1, 2] }]);
  assert.deepEqual(map.get(1), { key: 'groupA', label: 'Lätt klass' });
  assert.deepEqual(map.get(2), { key: 'groupA', label: 'Lätt klass' });
});

test('resolvePrecisionMergeGrouping prefers explicit equipage display merge', () => {
  const result = resolvePrecisionMergeGrouping({
    className: 'Ordinarie klass',
    useMergedTestForDisplay: true,
    mergedTestKey: 'merged-1',
    mergedTestLabel: 'Sammanslagen klass'
  });

  assert.deepEqual(result, { key: 'merged-1', label: 'Sammanslagen klass' });
});

test('resolvePrecisionMergeGrouping falls back to a plain class placeholder', () => {
  const result = resolvePrecisionMergeGrouping({});

  assert.deepEqual(result, { key: 'CLASS:-', label: '-' });
});

test('groupPrecisionEquipagesForDisplay groups and sorts by merge label', () => {
  const { map } = buildPrecisionMergeState({
    mergeByClassNumber: {
      mergedB: { label: 'B klass', members: [2, 3] }
    }
  });

  const groups = groupPrecisionEquipagesForDisplay([
    { startNumber: 1, className: 'C klass' },
    { startNumber: 2, className: 'B1', tdbClassNumber: 2 },
    { startNumber: 3, className: 'B2', tdbClassNumber: 3 }
  ], map);

  assert.deepEqual(groups.map((group) => group.label), ['B klass', 'C klass']);
  assert.deepEqual(groups[0].items.map((item) => item.startNumber), [2, 3]);
});
