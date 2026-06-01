import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrecisionLiveTick,
  calculatePrecisionLiveElapsed,
  calculatePrecisionLivePenalty,
  calculatePrecisionLiveRank
} from '../js/pages/precision/precisionResultLive.js';

test('calculatePrecisionLiveElapsed compensates from received snapshot time', () => {
  const elapsed = calculatePrecisionLiveElapsed({
    liveStartEpoch: 1000,
    livePausedMs: 200,
    _receivedLocalAt: 4000
  }, 4500);

  assert.equal(elapsed, 3700);
});

test('calculatePrecisionLivePenalty computes live penalty parts', () => {
  const penalty = calculatePrecisionLivePenalty(
    { liveObstaclePenalty: 6, extraPenalty: 1 },
    {},
    { maxSec: 100, timePenaltyRate: 0.5 },
    104000
  );

  assert.equal(penalty.timePenalty, 2);
  assert.equal(penalty.obstaclePenalty, 6);
  assert.equal(penalty.extraPenalty, 1);
  assert.equal(penalty.totalPenalty, 9);
});

test('calculatePrecisionLiveRank ranks within the current group', () => {
  const equipages = [
    { startNumber: 1, className: 'A' },
    { startNumber: 2, className: 'A' },
    { startNumber: 3, className: 'B' }
  ];
  const precisionMap = new Map([
    ['1', { finalized: true, totalPenalty: 8 }],
    ['3', { finalized: true, totalPenalty: 1 }]
  ]);

  const rank = calculatePrecisionLiveRank(5, '2', equipages[1], equipages, precisionMap);

  assert.equal(rank, 1);
});

test('buildPrecisionLiveTick returns elapsed, over-time, penalty and rank', () => {
  const equipages = [
    { startNumber: 1, className: 'A' },
    { startNumber: 2, className: 'A' }
  ];
  const tick = buildPrecisionLiveTick(
    {
      liveStartEpoch: 1000,
      livePausedMs: 0,
      _receivedLocalAt: 1000,
      liveObstaclePenalty: 3
    },
    {
      now: 106000,
      equipage: equipages[1],
      maxSec: 100,
      config: { timePenaltyRate: 0.5 },
      allEquipages: equipages,
      precisionMap: new Map([['1', { finalized: true, totalPenalty: 10 }]])
    }
  );

  assert.equal(tick.elapsedMs, 105000);
  assert.equal(tick.overTime, true);
  assert.equal(tick.penalty.timePenalty, 2.5);
  assert.equal(tick.penalty.totalPenalty, 5.5);
  assert.equal(tick.rank, 1);
});
