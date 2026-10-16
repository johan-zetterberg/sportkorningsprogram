import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTotalDisciplineStatuses,
  buildTotalCalculationContext,
  buildTotalResultRow,
  getMarathonPenaltyBreakdown,
  resolveTotalDisciplineStatuses
} from '../js/pages/shared/totalResultRows.js';

test('buildTotalCalculationContext preserves calculation dependencies', () => {
  const allPrograms = { LA: { name: 'LA' } };
  const judges = [{ id: 'c' }];
  const marathonConfig = { stageB: true };
  const precisionConfig = { maxTimeByClass: { A: 100 } };

  assert.deepEqual(buildTotalCalculationContext({
    allPrograms,
    judges,
    marathonConfig,
    precisionConfig
  }), {
    allPrograms,
    judges,
    marathonConfig,
    precisionConfig
  });
});

test('getMarathonPenaltyBreakdown reads centralized stage and obstacle values', () => {
  assert.deepEqual(getMarathonPenaltyBreakdown({
    stages: { A: { timePenalty: 1.5 }, B: { timePenalty: 2 } },
    obstacles: {
      sum: 14,
      items: [
        { timePenalty: 5, knockdownPenalty: 2, otherPenalty: 1 },
        { timePenalty: 4, knockDownPenalty: 1, otherPenalty: 1 }
      ]
    }
  }), {
    stageTimePenalty: 3.5,
    obstacleTimePenalty: 9,
    knockdownPenalty: 3,
    otherObstaclePenalty: 2,
    obstaclePenalty: 14
  });
});

test('resolveTotalDisciplineStatuses detects ok, partial, missing and eliminated states', () => {
  assert.deepEqual(resolveTotalDisciplineStatuses({
    dressage: { penalty: 12 },
    marathon: { timePenalty: 3 },
    precision: {}
  }), {
    dressageStatus: 'ok',
    marathonStatus: 'partial',
    precisionStatus: 'missing'
  });

  assert.deepEqual(resolveTotalDisciplineStatuses({
    isEliminated: true,
    dressage: { penalty: 12, eliminated: true },
    marathon: { totalPenalty: 9, eliminated: true },
    precision: { pen: 1 }
  }), {
    dressageStatus: 'elim',
    marathonStatus: 'elim',
    precisionStatus: 'ok'
  });

  assert.equal(resolveTotalDisciplineStatuses({
    precision: { eliminated: true }
  }).precisionStatus, 'elim');
});

test('applyTotalDisciplineStatuses mutates rows with current display statuses', () => {
  const rows = [
    { dressage: { percentAvg: 70 }, marathon: {}, precision: { pen: 2 } }
  ];

  assert.equal(applyTotalDisciplineStatuses(rows), rows);
  assert.equal(rows[0].dressageStatus, 'ok');
  assert.equal(rows[0].marathonStatus, 'missing');
  assert.equal(rows[0].precisionStatus, 'ok');
});

test('buildTotalResultRow calls total calculation with merged timing and context object', () => {
  const calls = [];
  const allPrograms = { LA: { name: 'LA' } };
  const judges = [{ id: 'c' }];
  const marathonConfig = { source: 'marathon' };
  const precisionConfig = { source: 'precision' };

  const row = buildTotalResultRow({
    equipage: {
      id: 'eq-12',
      startNumber: 12,
      driverName: 'Anna Andersson',
      clubName: 'Körklubben',
      className: 'Lätt A'
    },
    rawProtocols: [{ judgeId: 'c' }],
    marDoc: { status: 'Klar', B: { durationMs: 2000 } },
    timeDocRaw: { B: { durationMs: 1000 }, A: { durationMs: 500 } },
    precisionDoc: { finalized: true },
    allPrograms,
    judges,
    marathonConfig,
    precisionConfig,
    displayConfig: { mergeByClassNumber: {} },
    resolveMergeGrouping: () => ({ key: 'CLASS:Lätt A', label: 'Lätt A' }),
    calculateTotalResult: (...args) => {
      calls.push(args);
      return {
        dressage: { penalty: 7, judgePenalty: 7, percent: 65 },
        marathon: { totalPenalty: 5, status: 'Klar' },
        precision: { totalPenalty: 2, status: 'Klar' },
        totalPenalty: 14,
        isEliminated: false,
        elimReason: null,
        isOngoing: false
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2], {
    obstacleData: { status: 'Klar', B: { durationMs: 2000 } },
    timeData: { A: { durationMs: 500 }, B: { durationMs: 2000 }, status: 'Klar' }
  });
  assert.deepEqual(calls[0][4], {
    allPrograms,
    judges,
    marathonConfig,
    precisionConfig
  });
  assert.equal(row.totalPenalty, 14);
  assert.equal(row.dressage.percentAvg, 65);
  assert.equal(row.precision.pen, 2);
  assert.equal(row.displayGroupLabel, 'Lätt A');
});


test('discipline elimination only marks the affected discipline', () => {
  const statuses = resolveTotalDisciplineStatuses({
    isEliminated: true,
    dressage: { penalty: 50 },
    marathon: { totalPenalty: null },
    precision: { eliminated: true, pen: null }
  });
  assert.equal(statuses.dressageStatus, 'ok');
  assert.equal(statuses.marathonStatus, 'missing');
  assert.equal(statuses.precisionStatus, 'elim');

  const perPhase = resolveTotalDisciplineStatuses({
    isEliminated: true,
    dressage: { penalty: 50, eliminated: false },
    marathon: { totalPenalty: null, eliminated: true },
    precision: { eliminated: false }
  });
  assert.equal(perPhase.dressageStatus, 'ok');
  assert.equal(perPhase.marathonStatus, 'elim');
});
