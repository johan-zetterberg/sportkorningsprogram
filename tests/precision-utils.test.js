import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePrecisionResult,
  computeMaxSecondsForClass
} from '../js/utils/precisionCalculation.js';

const equipage = {
  startNumber: 12,
  className: 'Testklass'
};

const config = {
  maxTimeByClass: {
    Testklass: 100
  },
  knockdownPenalty: 3,
  timePenaltyRate: 0.5
};

test('precision UI calculation keeps empty not-started result incomplete', () => {
  const result = calculatePrecisionResult(
    { finalized: false, running: false, timeMs: 0, knocks: [] },
    equipage,
    config
  );

  assert.equal(result.status, 'Ej startat');
  assert.equal(result.totalPenalty, null);
  assert.equal(result.obstaclePenalty, null);
  assert.equal(result.timePenalty, null);
  assert.equal(result.eliminated, false);
});

test('precision UI calculation computes final penalties from knocks and time', () => {
  const result = calculatePrecisionResult(
    { finalized: true, timeMs: 105000, knocks: ['3', '5A'], extraPenalty: 1 },
    equipage,
    config
  );

  assert.equal(result.status, 'Klar');
  assert.deepEqual(result.knocks, ['3', '5A']);
  assert.equal(result.knocksCount, 2);
  assert.equal(result.obstaclePenalty, 6);
  assert.equal(result.timePenalty, 2.5);
  assert.equal(result.extraPenalty, 1);
  assert.equal(result.totalPenalty, 9.5);
});

test('precision UI calculation recalculates stale stored time penalty upward', () => {
  const result = calculatePrecisionResult(
    { finalized: true, timeMs: 106000, knocks: [], timePenalty: 0 },
    equipage,
    config
  );

  assert.equal(result.timePenalty, 3);
  assert.equal(result.totalPenalty, 3);
});

test('precision UI calculation preserves manually higher stored time penalty', () => {
  const result = calculatePrecisionResult(
    { finalized: true, timeMs: 101000, knocks: [], timePenalty: 4 },
    equipage,
    config
  );

  assert.equal(result.timePenalty, 4);
  assert.equal(result.totalPenalty, 4);
});

test('precision UI calculation uses live values while running', () => {
  const result = calculatePrecisionResult(
    {
      running: true,
      finalized: false,
      liveTimeMs: 104000,
      liveObstaclePenalty: 6,
      liveTimePenalty: 0,
      liveTotalPenalty: 6
    },
    equipage,
    config
  );

  assert.equal(result.running, true);
  assert.equal(result.status, 'Pågår');
  assert.equal(result.timeMs, 104000);
  assert.equal(result.obstaclePenalty, 6);
  assert.equal(result.timePenalty, 2);
  assert.equal(result.totalPenalty, 8);
});

test('precision UI calculation auto-eliminates over maximum time', () => {
  const result = calculatePrecisionResult(
    { finalized: true, timeMs: 201000, knocks: [] },
    equipage,
    config
  );

  assert.equal(result.autoEliminated, true);
  assert.equal(result.eliminated, true);
  assert.equal(result.status, 'Utesluten');
  assert.equal(result.totalPenalty, 50.5);
});

test('precision max time can be derived from course length and tempo', () => {
  const maxSeconds = computeMaxSecondsForClass('Klass med bana', {
    courses: {
      'Klass med bana': {
        trackLengthMeters: 450,
        tempo: 150
      }
    }
  });

  assert.equal(maxSeconds, 180);
});
