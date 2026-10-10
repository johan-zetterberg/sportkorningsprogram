import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMarathonPlacementsByClass } from '../js/pages/marathon/marathonResultRanking.js';

test('buildMarathonPlacementsByClass excludes clear round classes from ranking', () => {
  const equipages = [
    { startNumber: 1, className: 'Lätt B' },
    { startNumber: 2, className: 'Lätt A' }
  ];
  const marathonMap = new Map([
    ['1', { finalized: true }],
    ['2', { finalized: true }]
  ]);

  const placements = buildMarathonPlacementsByClass({
    equipages,
    marathonMap,
    timingDocFor: () => ({}),
    calculateResult: (eq) => ({
      status: 'Klar',
      totalPenalty: 0,
      isClearRound: eq.startNumber === 1,
      stages: { B: { timePenalty: 0 } },
      obstaclePenaltySum: 0,
      obstacleTimes: []
    })
  });

  assert.equal(placements.has('1'), false);
  assert.equal(placements.get('2'), 1);
});
