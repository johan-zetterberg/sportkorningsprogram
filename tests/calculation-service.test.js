import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDressageResult,
  calculateMarathonResult,
  calculatePrecisionResult,
  calculateTotalResult
} from '../js/services/calculationService.js';
import { setMarathonConfig } from '../js/utils/marathonUtils.js';

const allPrograms = {
  LA: {
    id: 'LA',
    name: 'Svenskt Latt A',
    movements: [
      { no: 1, coeff: 1 },
      { no: 2, coeff: 1 }
    ]
  }
};

const marathonConfig = {
  marathonClassData: {
    KlassA: {
      distanceA: 5000,
      tempoA: 250,
      distanceT: 1000,
      tempoT: 200,
      distanceB: 6000,
      tempoB: 300,
      obstaclePenaltyRate: 0.25
    }
  }
};

const precisionConfig = {
  maxTimeByClass: {
    KlassA: 100
  },
  knockdownPenalty: 3,
  timePenaltyRate: 0.5
};

function buildBaseEquipage(overrides = {}) {
  return {
    startNumber: 10,
    className: 'KlassA',
    category: 'horse',
    errorPoints: 0,
    testKey: 'LA',
    ...overrides
  };
}

function buildCompletedMarathonTiming() {
  return {
    A: { durationMs: 1200000 },
    transport: { durationMs: 300000 },
    B: { durationMs: 1200000 }
  };
}

test('calculateDressageResult uses the highest available general error points source', () => {
  const equipage = buildBaseEquipage({ errorPoints: 1 });
  const protocols = [
    { judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] },
    { id: 'general', errorPoints: 2 }
  ];

  const result = calculateDressageResult(equipage, protocols, [], allPrograms);

  assert.equal(result.judgePenalty, 4);
  assert.equal(result.errorPoints, 2);
  assert.equal(result.errorPenalty, 2);
  assert.equal(result.penalty, 6);
  assert.equal(result.eliminated, false);
});

test('calculatePrecisionResult returns shared total penalties for finalized rows', () => {
  const equipage = buildBaseEquipage();
  const precisionData = {
    finalized: true,
    timeMs: 105000,
    knocks: [1, 2]
  };

  const result = calculatePrecisionResult(precisionData, equipage, precisionConfig);

  assert.equal(result.timeMs, 105000);
  assert.equal(result.obstaclePenalty, 6);
  assert.equal(result.timePenalty, 2.5);
  assert.equal(result.totalPenalty, 8.5);
  assert.equal(result.eliminated, false);
});

test('calculateMarathonResult applies shared stage time penalties', () => {
  setMarathonConfig(marathonConfig);

  const equipage = buildBaseEquipage();
  const obstacleData = { obstacles: [] };
  const timingData = {
    A: { durationMs: 1220000 },
    transport: { durationMs: 300000 },
    B: { durationMs: 1200000 }
  };

  const result = calculateMarathonResult(equipage, obstacleData, timingData);

  assert.equal(result.totalPenalty, 5);
  assert.equal(result.stages.A.timePenalty, 5);
  assert.equal(result.obstacles.sum, 0);
  assert.equal(result.eliminated, false);
});

test('calculateTotalResult marks partially entered competitions as ongoing without a final total', () => {
  setMarathonConfig(marathonConfig);

  const equipage = buildBaseEquipage();
  const dressageProtocols = [
    { judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] }
  ];
  const marathonData = {
    obstacleData: {},
    timeData: {}
  };
  const precisionData = {};

  const result = calculateTotalResult(
    equipage,
    dressageProtocols,
    marathonData,
    precisionData,
    {
      allPrograms,
      marathonConfig,
      precisionConfig
    }
  );

  assert.equal(result.totalPenalty, null);
  assert.equal(result.isEliminated, false);
  assert.equal(result.isOngoing, true);
  assert.equal(result.dressage.points, 16);
});

test('calculateTotalResult nulls total and reports precision elimination reason', () => {
  setMarathonConfig(marathonConfig);

  const equipage = buildBaseEquipage();
  const dressageProtocols = [
    { judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] }
  ];
  const marathonData = {
    obstacleData: {
      obstacles: [
        { number: 1, timeSeconds: 20, knockdownPenalty: 0, otherPenalty: 0 }
      ]
    },
    timeData: buildCompletedMarathonTiming()
  };
  const precisionData = {
    finalized: true,
    eliminated: true,
    timeMs: 100000,
    knocks: []
  };

  const result = calculateTotalResult(
    equipage,
    dressageProtocols,
    marathonData,
    precisionData,
    {
      allPrograms,
      marathonConfig,
      precisionConfig
    }
  );

  assert.equal(result.totalPenalty, null);
  assert.equal(result.isEliminated, true);
  assert.equal(result.elimReason, 'ELIM (PR)');
  assert.equal(result.precision.eliminated, true);
});
