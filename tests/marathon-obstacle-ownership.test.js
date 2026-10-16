import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isObstacleStateOwnedByAnotherObstacle,
  markObstacleUpdateInProgress
} from '../js/pages/marathon/marathonObstacleOwnership.js';

test('another obstacle owns both running and stopped unsaved marathon state', () => {
  assert.equal(isObstacleStateOwnedByAnotherObstacle({
    currentObstacle: 2,
    running: true,
    inProgress: true
  }, 3), true);

  assert.equal(isObstacleStateOwnedByAnotherObstacle({
    currentObstacle: 2,
    running: false,
    inProgress: true,
    liveObstacleTimeMs: 12340
  }, 3), true);
});

test('saved or same-obstacle marathon state is not owned elsewhere', () => {
  assert.equal(isObstacleStateOwnedByAnotherObstacle({
    currentObstacle: 2,
    running: false,
    inProgress: false
  }, 3), false);

  assert.equal(isObstacleStateOwnedByAnotherObstacle({
    currentObstacle: 2,
    running: false,
    inProgress: true
  }, 2), false);
});

test('viewing a saved obstacle stays unlocked until a live field is edited', () => {
  const loaded = markObstacleUpdateInProgress({
    liveObstacleTimeMs: 1234,
    inProgress: false
  });
  assert.equal(loaded.inProgress, false);

  const edited = markObstacleUpdateInProgress({ live_comment: 'Kontrollera port C' });
  assert.equal(edited.inProgress, true);
});
