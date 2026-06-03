import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEquipageState,
  buildCompetitionState
} from '../js/core-engine/stateSelector.js';
import {
  getDressagePenaltyCoeff,
  guessProgramKeyFromClass,
  calculateDressageResult
} from '../js/core-engine/dressage.js';
import { calculateMarathonResult } from '../js/core-engine/marathon.js';
import {
  computeMaxSecondsForClass,
  calculatePrecisionResult
} from '../js/core-engine/precision.js';
import {
  calculatePrecisionResult as calculateUiPrecisionResult
} from '../js/utils/precisionCalculation.js';
import { calculateTotalResult } from '../js/core-engine/calculation.js';
import { aggregateResults } from '../js/services/resultAggregationService.js';

const allPrograms = {
  LA: {
    id: 'LA',
    name: 'Svenskt Latt A',
    movements: [
      { no: 1, coeff: 1 },
      { no: 2, coeff: 1 }
    ]
  },
  PE_A: {
    id: 'PE_A',
    name: 'FEI Dressage Test FU',
    penaltyCoeff: 0.84,
    movements: Array.from({ length: 19 }, (_, idx) => ({ no: idx + 1, coeff: 1 }))
  }
};

const marathonConfig = {
  marathonClassData: {
    Testklass: {
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
    Testklass: 100
  },
  knockdownPenalty: 3,
  timePenaltyRate: 0.5
};

function createBaseState() {
  return buildCompetitionState(
    {
      startNumber: 12,
      className: 'Testklass',
      category: 'horse',
      errorPoints: 2,
      testKey: 'LA'
    },
    [
      {
        judgeId: 'c',
        movements: [
          { momentNo: 1, score: 8 },
          { momentNo: 2, score: 7 }
        ]
      }
    ],
    {
      obstacles: [
        { obstacleNumber: 1, timeSeconds: 20, otherPenalty: 0, knockdownPenalty: 0 }
      ]
    },
    {
      A: { durationMs: 1200000 },
      transport: { durationMs: 300000 },
      B: { durationMs: 1200000 }
    },
    {
      finalized: true,
      timeMs: 105000,
      knocks: [3, 7]
    },
    {
      allPrograms,
      marathonConfig,
      precisionConfig
    }
  );
}

test('buildEquipageState normalizes common equipage fields', () => {
  const state = buildEquipageState({
    startNo: 5,
    klass: 'MSV 3',
    category: 'Ponny B',
    errorPoints: '3',
    horseHeightCm: '138',
    programKey: 'LA'
  });

  assert.deepEqual(state, {
    startNumber: 5,
    className: 'MSV 3',
    category: 'ponny b',
    isPara: false,
    status: undefined,
    errorPoints: 3,
    heightCm: 138,
    testKey: 'LA'
  });
});

test('getDressagePenaltyCoeff resolves explicit and fallback coefficients', () => {
  assert.equal(getDressagePenaltyCoeff({ penaltyCoeff: '0.8' }, allPrograms), 0.8);
  assert.equal(getDressagePenaltyCoeff('LA', allPrograms), 1);
});

test('guessProgramKeyFromClass only returns keys present in the program dictionary', () => {
  const programs = {
    SvLB: {},
    SvLA: {},
    SvMsvB: {},
    SvMsvC: {},
    sv_msv_4_enb_2025: {},
    sv_msv_4_par_2025: {},
    FEI3AHP1: {},
    FEI_3star_HP2_P2_2025: {},
    FEI_3star_HP4_2025: {},
    FEI_3star_B_HP4_2022: {}
  };

  assert.equal(guessProgramKeyFromClass('Lätt B Enbet Häst', programs), 'SvLB');
  assert.equal(guessProgramKeyFromClass('MSV 2 Enbet Ponny', programs), 'SvMsvC');
  assert.equal(guessProgramKeyFromClass('MSV 3 Par Häst', programs), 'SvMsvB');
  assert.equal(guessProgramKeyFromClass('MSV 4 Enbet Häst', programs), 'sv_msv_4_enb_2025');
  assert.equal(guessProgramKeyFromClass('MSV 4 Par Ponny', programs), 'sv_msv_4_par_2025');
  assert.equal(guessProgramKeyFromClass('Svår Enbet Häst', programs), 'FEI3AHP1');
  assert.equal(guessProgramKeyFromClass('Svår Par Häst', programs), 'FEI_3star_HP2_P2_2025');
  assert.equal(guessProgramKeyFromClass('Svår Fyrspann Ponny', programs), 'FEI_3star_HP4_2025');
  assert.equal(guessProgramKeyFromClass('Svår Fyrspann Häst', programs), 'FEI_3star_B_HP4_2022');
  assert.equal(guessProgramKeyFromClass('Lätt C Enbet Ponny', programs), null);
});

test('calculateDressageResult computes judge penalty plus equipage error points', () => {
  const result = calculateDressageResult(createBaseState());

  assert.equal(result.eliminated, false);
  assert.equal(result.judgePenalty, 5);
  assert.equal(result.penalty, 7);
});

test('calculateDressageResult averages multiple judges', () => {
  const state = createBaseState();
  state.dressage.protocols.push({
    judgeId: 'e',
    movements: [
      { momentNo: 1, score: 6 },
      { momentNo: 2, score: 7 }
    ]
  });

  const result = calculateDressageResult(state);

  assert.equal(result.eliminated, false);
  assert.equal(result.judgePenalty, 6);
  assert.equal(result.penalty, 8);
});

test('calculateDressageResult applies dressage coefficient to error points', () => {
  const state = createBaseState();
  state.config.allPrograms = {
    ...state.config.allPrograms,
    LA: {
      ...state.config.allPrograms.LA,
      penaltyCoeff: 0.8
    }
  };
  state.dressage.protocols.push({
    judgeId: 'e',
    movements: [
      { momentNo: 1, score: 6 },
      { momentNo: 2, score: 7 }
    ]
  });

  const result = calculateDressageResult(state);

  assert.equal(result.eliminated, false);
  assert.equal(result.judgePenalty, 4.8);
  assert.equal(result.penalty, 6.4);
});

test('calculateDressageResult prefers saved protocol program over equipage class fallback', () => {
  const judgeC = Array.from({ length: 19 }, () => 6);
  const judgeE = Array.from({ length: 19 }, () => 8);
  const protocols = [
    { judgeId: 'c', testKey: 'PE_A', movements: judgeC.map((score, idx) => ({ momentNo: idx + 1, score })) },
    { judgeId: 'e', testKey: 'PE_A', movements: judgeE.map((score, idx) => ({ momentNo: idx + 1, score })) }
  ];
  const equipage = {
    startNumber: 11,
    className: 'MSV 3',
    testKey: 'LA',
    errorPoints: 0
  };
  const state = buildCompetitionState(
    equipage,
    protocols,
    { obstacles: [] },
    {},
    {},
    { allPrograms, marathonConfig, precisionConfig }
  );

  const coreResult = calculateDressageResult(state);
  assert.equal(coreResult.judgePenalty, 47.88);
  assert.equal(coreResult.penalty, 47.88);
});

test('calculateDressageResult marks eliminated dressage without numeric penalty', () => {
  const state = createBaseState();
  state.dressage.protocols[0].eliminated = true;

  const result = calculateDressageResult(state);

  assert.equal(result.eliminated, true);
  assert.equal(result.penalty, null);
});

test('calculateMarathonResult computes stage and obstacle penalties', () => {
  const result = calculateMarathonResult(createBaseState());

  assert.equal(result.eliminated, false);
  assert.equal(result.stages.A.timePenalty, 0);
  assert.equal(result.stages.transport.timePenalty, 0);
  assert.equal(result.stages.B.timePenalty, 0);
  assert.equal(result.obstacles.sum, 5);
  assert.equal(result.totalPenalty, 5);
});

test('calculateMarathonResult deducts obstacle hold time from B section', () => {
  const state = createBaseState();
  state.marathon.resultDoc.obstacles[0].holdTimeSec = 30;
  state.marathon.timingDoc.B.durationMs = 1230000;

  const result = calculateMarathonResult(state);

  assert.equal(result.eliminated, false);
  assert.equal(result.stages.B.rawDurationMs, 1230000);
  assert.equal(result.stages.B.durationMs, 1200000);
  assert.equal(result.stages.B.holdTimeMs, 30000);
  assert.equal(result.stages.B.timePenalty, 0);
  assert.equal(result.totalPenalty, 5);
});

test('computeMaxSecondsForClass and calculatePrecisionResult compute penalties', () => {
  assert.equal(computeMaxSecondsForClass('Testklass', precisionConfig), 100);

  const result = calculatePrecisionResult(createBaseState());
  assert.equal(result.eliminated, false);
  assert.equal(result.obstaclePenalty, 6);
  assert.equal(result.timePenalty, 2.5);
  assert.equal(result.totalPenalty, 8.5);
});

test('core precision result mirrors UI precision calculation for stale saved time penalty', () => {
  const state = createBaseState();
  state.precision.resultDoc = {
    finalized: true,
    timeMs: 106000,
    knocks: [],
    timePenalty: 0
  };

  const coreResult = calculatePrecisionResult(state);
  const uiResult = calculateUiPrecisionResult(
    state.precision.resultDoc,
    state.equipage,
    state.config.precisionConfig
  );

  assert.equal(coreResult.timePenalty, 3);
  assert.equal(coreResult.totalPenalty, 3);
  assert.deepEqual(coreResult, uiResult);
});

test('core precision result mirrors UI precision calculation for auto elimination', () => {
  const state = createBaseState();
  state.precision.resultDoc = {
    finalized: true,
    timeMs: 201000,
    knocks: []
  };

  const coreResult = calculatePrecisionResult(state);
  const uiResult = calculateUiPrecisionResult(
    state.precision.resultDoc,
    state.equipage,
    state.config.precisionConfig
  );

  assert.equal(coreResult.eliminated, true);
  assert.equal(coreResult.autoEliminated, true);
  assert.deepEqual(coreResult, uiResult);
});

test('calculateTotalResult combines discipline totals consistently', () => {
  const result = calculateTotalResult(createBaseState());

  assert.equal(result.isEliminated, false);
  assert.equal(result.dressagePenalty, 7);
  assert.equal(result.marathonPenalty, 5);
  assert.equal(result.precisionPenalty, 8.5);
  assert.equal(result.totalPenalty, 20.5);
});

test('calculateTotalResult stays incomplete when a discipline has no finished result', () => {
  const state = buildCompetitionState(
    {
      startNumber: 15,
      className: 'Testklass',
      category: 'horse',
      errorPoints: 0,
      testKey: 'LA'
    },
    [
      {
        judgeId: 'c',
        movements: [
          { momentNo: 1, score: 8 },
          { momentNo: 2, score: 8 }
        ]
      }
    ],
    {
      obstacles: [
        { obstacleNumber: 1, timeSeconds: 20, otherPenalty: 0, knockdownPenalty: 0 }
      ]
    },
    {
      A: { durationMs: 1200000 },
      transport: { durationMs: 300000 },
      B: { durationMs: 1200000 }
    },
    {
      finalized: false,
      running: false,
      timeMs: 0,
      knocks: []
    },
    {
      allPrograms,
      marathonConfig,
      precisionConfig
    }
  );

  const result = calculateTotalResult(state);
  assert.equal(result.isEliminated, false);
  assert.equal(result.dressagePenalty, 4);
  assert.equal(result.marathonPenalty, 5);
  assert.equal(result.precisionPenalty, null);
  assert.equal(result.totalPenalty, null);
});

test('calculateTotalResult marks eliminated results without producing a numeric total', () => {
  const state = buildCompetitionState(
    {
      startNumber: 16,
      className: 'Testklass',
      category: 'horse',
      errorPoints: 0,
      testKey: 'LA'
    },
    [
      {
        judgeId: 'c',
        eliminated: true,
        movements: [
          { momentNo: 1, score: 5 },
          { momentNo: 2, score: 5 }
        ]
      }
    ],
    {
      obstacles: []
    },
    {
      A: { durationMs: 1200000 },
      transport: { durationMs: 300000 },
      B: { durationMs: 1200000 }
    },
    {
      finalized: true,
      timeMs: 99000,
      knocks: []
    },
    {
      allPrograms,
      marathonConfig,
      precisionConfig
    }
  );

  const result = calculateTotalResult(state);
  assert.equal(result.isEliminated, true);
  assert.equal(result.dressagePenalty, null);
  assert.equal(result.totalPenalty, null);
});

test('resultAggregationService throws to prevent reuse of the deprecated path', () => {
  assert.throws(
    () => aggregateResults(),
    /deprecated/i
  );
});
