import test from 'node:test';
import assert from 'node:assert/strict';

import { removeMergeGroupsBySelection } from '../js/pages/admin/adminParticipantMergeUtils.js';

test('removeMergeGroupsBySelection removes checked groups and returns affected TDB numbers', () => {
  const result = removeMergeGroupsBySelection({
    'TDBGROUP:1+2': { label: 'Lätt A', members: [1, 2] },
    'TDBGROUP:3+4': { label: 'MSV', members: [3, 4] }
  }, ['TDBGROUP:1+2'], []);

  assert.equal(result.changed, true);
  assert.deepEqual(result.nextGroups, {
    'TDBGROUP:3+4': { label: 'MSV', members: [3, 4] }
  });
  assert.deepEqual(result.numsToUnmerge, [1, 2]);
});

test('removeMergeGroupsBySelection removes groups containing selected TDB numbers', () => {
  const result = removeMergeGroupsBySelection({
    'TDBGROUP:1+2': { label: 'Lätt A', members: [1, 2] },
    'TDBGROUP:3+4': { label: 'MSV', members: [3, 4] }
  }, [], [4]);

  assert.equal(result.changed, true);
  assert.deepEqual(result.nextGroups, {
    'TDBGROUP:1+2': { label: 'Lätt A', members: [1, 2] }
  });
  assert.deepEqual(result.numsToUnmerge, [3, 4]);
});
