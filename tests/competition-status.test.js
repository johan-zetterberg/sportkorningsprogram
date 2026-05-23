import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getExpectedDressageJudgePositions,
  getCompletedDressageJudgePositions,
  isDressageReadyToFinalize,
  getMarathonActiveState
} from '../js/services/competitionStatusService.js';

test('getExpectedDressageJudgePositions prefers class mapping and normalizes positions', () => {
  const mapping = {
    'LA Klass': {
      c: 'judge-c',
      e: 'judge-e',
      h: ''
    }
  };

  const positions = getExpectedDressageJudgePositions('LA Klass', mapping, [
    { position: 'B' }
  ]);

  assert.deepEqual(positions, ['C', 'E']);
});

test('getExpectedDressageJudgePositions falls back to judge roles when class mapping is missing', () => {
  const positions = getExpectedDressageJudgePositions('Unknown', {}, [
    { roles: [{ discipline: 'dressage', position: 'C' }] },
    { roles: [{ discipline: 'dressage', position: 'E' }] },
    { position: 'B' }
  ]);

  assert.deepEqual(positions.sort(), ['B', 'C', 'E']);
});

test('getCompletedDressageJudgePositions ignores live and eliminated judges', () => {
  const completed = getCompletedDressageJudgePositions([
    { position: 'C' },
    { judgePosition: 'A' },
    { position: 'E', isLive: true },
    { position: 'B', eliminated: true },
    { position: 'H' }
  ]);

  assert.deepEqual(Array.from(completed).sort(), ['A', 'C', 'H']);
});

test('isDressageReadyToFinalize accepts either finished status or complete judge coverage', () => {
  assert.equal(
    isDressageReadyToFinalize({
      status: { state: 'finished' },
      countedJudgePositions: new Set(),
      expectedJudgePositions: ['C', 'E'],
      finalized: false
    }),
    true
  );

  assert.equal(
    isDressageReadyToFinalize({
      status: { state: 'ongoing' },
      countedJudgePositions: new Set(['C', 'E']),
      expectedJudgePositions: ['C', 'E'],
      finalized: false
    }),
    true
  );

  assert.equal(
    isDressageReadyToFinalize({
      status: { state: 'ongoing' },
      countedJudgePositions: new Set(['C']),
      expectedJudgePositions: ['C', 'E'],
      finalized: false
    }),
    false
  );

  assert.equal(
    isDressageReadyToFinalize({
      status: { state: 'finished' },
      countedJudgePositions: new Set(['C', 'E']),
      expectedJudgePositions: ['C', 'E'],
      finalized: true
    }),
    false
  );
});

test('getMarathonActiveState identifies active stage A and transport/B transitions', () => {
  const stageA = getMarathonActiveState({
    start_A: 1000
  });
  assert.equal(stageA.isActive, true);
  assert.equal(stageA.currentTaskKey, 'A');

  const transport = getMarathonActiveState({
    start_A: 1000,
    finish_A: 2000,
    start_transfer: 3000
  });
  assert.equal(transport.isActive, true);
  assert.equal(transport.currentTaskKey, 'transport');

  const stageB = getMarathonActiveState({
    start_transfer: 3000,
    finish_transfer: 4000,
    start_B: 5000
  });
  assert.equal(stageB.isActive, true);
  assert.equal(stageB.currentTaskKey, 'B');
});

test('getMarathonActiveState only flags obstacle as live when running', () => {
  const notLive = getMarathonActiveState({
    currentObstacle: 4,
    running: false,
    live_staticStartAt: 1234
  });
  assert.equal(notLive.obstacleIsLive, false);
  assert.equal(notLive.currentTaskKey, 'inactive');

  const live = getMarathonActiveState({
    currentObstacle: 4,
    running: true,
    liveObstacleStartAt: 1234,
    start_B: 1000
  });
  assert.equal(live.obstacleIsLive, true);
  assert.equal(live.currentTaskKey, 'obstacle');

  const liveWithoutStartTimestamp = getMarathonActiveState({
    currentObstacle: 5,
    running: true
  });
  assert.equal(liveWithoutStartTimestamp.obstacleIsLive, true);
  assert.equal(liveWithoutStartTimestamp.currentTaskKey, 'obstacle');

  const restartedAfterFinishedB = getMarathonActiveState({
    start_B: 1000,
    finish_B: 2000,
    currentObstacle: 2,
    running: true
  });
  assert.equal(restartedAfterFinishedB.obstacleIsLive, true);
  assert.equal(restartedAfterFinishedB.isActive, true);
  assert.equal(restartedAfterFinishedB.currentTaskKey, 'obstacle');
});
