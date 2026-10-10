import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrecisionLiveTick,
  calculatePrecisionLiveElapsed,
  calculatePrecisionLivePenalty,
  calculatePrecisionLiveRank
} from '../js/pages/precision/precisionResultLive.js';
import { calculatePrecisionLiveResult } from '../js/utils/precisionCalculation.js';

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
    ['1', { finalized: true, timeMs: 90000, obstaclePenalty: 8 }],
    ['3', { finalized: true, timeMs: 90000, obstaclePenalty: 1 }]
  ]);

  const rank = calculatePrecisionLiveRank(5, '2', equipages[1], equipages, precisionMap);

  assert.equal(rank, 1);
});

test('calculatePrecisionLiveResult ticks the time and uses the competition time penalty rate', () => {
  const doc = { running: true, liveStartEpoch: 1000, livePausedMs: 5000, knocks: ['3'] };
  const eq = { startNumber: 1, className: 'A' };
  const config = { maxTimeByClass: { A: 100 }, knockdownPenalty: 3 };

  // 5 s paused + 105 s since start = 110 s -> 10 s over at the competition's rate 1.0
  const live = calculatePrecisionLiveResult(doc, eq, config, { currentCompetition: { ruleSettings: { precisionTimePenaltyRate: 1 } } }, 106000);
  assert.equal(live.elapsedMs, 110000);
  assert.equal(live.timePenalty, 10);
  assert.equal(live.obstaclePenalty, 3);
  assert.equal(live.totalPenalty, 13);

  // Not running: the normal result
  assert.equal(calculatePrecisionLiveResult({ finalized: true, timeMs: 90000, knocks: [] }, eq, config).totalPenalty, 0);
});

test('calculatePrecisionLiveRank skips eliminated equipages and breaks ties on time', () => {
  const equipages = [1, 2, 3].map(sn => ({ startNumber: sn, className: 'A' }));
  const precisionMap = new Map([
    ['1', { finalized: true, timeMs: 80000, obstaclePenalty: 0, eliminated: true }],
    ['3', { finalized: true, timeMs: 95000, obstaclePenalty: 3 }]
  ]);

  // Same 3 penalties as #3 but faster -> 1st; eliminated #1 is not ahead
  assert.equal(calculatePrecisionLiveRank(3, '2', equipages[1], equipages, precisionMap, null, { currentTimeMs: 90000 }), 1);
  // Same penalties, slower -> 2nd
  assert.equal(calculatePrecisionLiveRank(3, '2', equipages[1], equipages, precisionMap, null, { currentTimeMs: 99000 }), 2);
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
      precisionMap: new Map([['1', { finalized: true, timeMs: 90000, obstaclePenalty: 10 }]])
    }
  );

  assert.equal(tick.elapsedMs, 105000);
  assert.equal(tick.overTime, true);
  assert.equal(tick.penalty.timePenalty, 2.5);
  assert.equal(tick.penalty.totalPenalty, 5.5);
  assert.equal(tick.rank, 1);
});
