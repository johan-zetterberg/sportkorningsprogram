import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupTotalEquipagesForDisplay,
  resolveTotalMergeGrouping
} from '../js/pages/shared/totalResultGrouping.js';

test('resolveTotalMergeGrouping prefers equipage display override', () => {
  const group = resolveTotalMergeGrouping({
    className: 'Latt A',
    useMergedTestForDisplay: true,
    mergedTestKey: 'merged-la-lb',
    mergedTestLabel: 'Latt A + Latt B'
  }, {
    mergeByClassNumber: {
      other: { label: 'Other', members: [1] }
    }
  });

  assert.deepEqual(group, {
    key: 'merged-la-lb',
    label: 'Latt A + Latt B'
  });
});

test('resolveTotalMergeGrouping uses configured TDB class groups', () => {
  const group = resolveTotalMergeGrouping({
    tdbClassNumber: '12',
    tdbClassLabel: 'TDB klass 12',
    className: 'Latt A'
  }, {
    mergeByClassNumber: {
      'group-1': { label: 'Sammanslagen klass', members: [11, 12] }
    }
  });

  assert.deepEqual(group, {
    key: 'group-1',
    label: 'Sammanslagen klass'
  });
});

test('resolveTotalMergeGrouping falls back to original class', () => {
  assert.deepEqual(resolveTotalMergeGrouping({ className: 'Medelsvar B' }, null), {
    key: 'CLASS:Medelsvar B',
    label: 'Medelsvar B'
  });
});

test('groupTotalEquipagesForDisplay groups and sorts by display label', () => {
  const groups = groupTotalEquipagesForDisplay([
    { startNumber: 3, className: 'Klass 10' },
    { startNumber: 1, className: 'Klass 2' },
    { startNumber: 2, className: 'Klass 2' }
  ]);

  assert.deepEqual(groups.map(group => group.label), ['Klass 2', 'Klass 10']);
  assert.deepEqual(groups[0].items.map(equipage => equipage.startNumber), [1, 2]);
});
