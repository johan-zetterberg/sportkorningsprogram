import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isActiveObstacleLive,
  obstaclesRunningElsewhere,
  obstacleLiveWrite,
  markObstacleUpdateInProgress
} from '../js/pages/marathon/marathonObstacleOwnership.js';

test('a running clock or a stopped, unsaved time is work at that obstacle', () => {
  assert.equal(isActiveObstacleLive({ running: true }), true);
  assert.equal(isActiveObstacleLive({ running: false, inProgress: true, liveObstacleTimeMs: 12340 }), true);
  assert.equal(isActiveObstacleLive({ running: false, inProgress: false }), false);
  assert.equal(isActiveObstacleLive(null), false);
});

test('another obstacle\'s running clock is reported, a stale unsaved time is not', () => {
  const doc = {
    obstacleLive: {
      2: { running: true, inProgress: true },
      4: { running: false, inProgress: true, liveObstacleTimeMs: 5000 }
    }
  };
  assert.deepEqual(obstaclesRunningElsewhere(doc, 3), [2]);
  assert.deepEqual(obstaclesRunningElsewhere(doc, 2), []);
  // Older documents: the flat fields
  assert.deepEqual(obstaclesRunningElsewhere({ currentObstacle: 5, running: true }, 3), [5]);
  assert.deepEqual(obstaclesRunningElsewhere({ currentObstacle: 5, running: false, inProgress: true }, 3), []);
});

test('a live change writes only the obstacle\'s own entry', () => {
  const write = obstacleLiveWrite(3, { running: false, liveObstacleTimeMs: 4200 }, () => 'NOW');
  assert.deepEqual(Object.keys(write), ['obstacleLive']);
  assert.deepEqual(Object.keys(write.obstacleLive), ['3']);
  assert.deepEqual(write.obstacleLive['3'], { running: false, liveObstacleTimeMs: 4200, updatedAt: 'NOW' });
  // Never a flat field another obstacle shares
  assert.equal('running' in write, false);
  assert.equal('currentObstacle' in write, false);
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
