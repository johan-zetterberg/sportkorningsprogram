import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePrecisionResult,
  computeMaxSecondsForClass
} from '../js/utils/precisionCalculation.js';
import {
  buildPlaceMap,
  getPortAllowanceCm,
  getStandardPortWidth,
  isStandardPortWidthClass,
  computePortWidth
} from '../js/utils/precisionUtils.js';
import { klassTempoData } from '../js/data/competitionData.js';

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

test('precision UI calculation keeps a manual time penalty (timePenaltyOverride)', () => {
  const higher = calculatePrecisionResult(
    { finalized: true, timeMs: 101000, knocks: [], timePenalty: 4, timePenaltyOverride: true },
    equipage,
    config
  );
  assert.equal(higher.timePenalty, 4);
  assert.equal(higher.totalPenalty, 4);

  // A manual correction downwards is kept as well (the old max() rule ignored it)
  const lower = calculatePrecisionResult(
    { finalized: true, timeMs: 110000, knocks: [], timePenalty: 1, timePenaltyOverride: true },
    equipage,
    config
  );
  assert.equal(lower.timePenalty, 1);
});

test('precision UI calculation recalculates a stale stored time penalty without override', () => {
  const result = calculatePrecisionResult(
    { finalized: true, timeMs: 101000, knocks: [], timePenalty: 4 },
    equipage,
    config
  );
  assert.equal(result.timePenalty, calculatePrecisionResult({ finalized: true, timeMs: 101000, knocks: [] }, equipage, config).timePenalty);
  assert.notEqual(result.timePenalty, 4);
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

test('precision max time uses merged course length with original class tempo', () => {
  const maxSeconds = computeMaxSecondsForClass({
    className: 'Originalklass',
    useMergedTestForDisplay: true,
    mergedTestLabel: 'Sammanslagen klass'
  }, {
    classTempo: {
      Originalklass: 150
    },
    courses: {
      'Sammanslagen klass': {
        trackLengthMeters: 450
      }
    }
  });

  assert.equal(maxSeconds, 180);
});

test('buildPlaceMap breaks ties by fastest time under TR Mom 530.1.2 and FEI Art 977', () => {
  const rows = [
    { startNumber: 1, className: 'Lätt B' },
    { startNumber: 2, className: 'Lätt B' },
    { startNumber: 3, className: 'Lätt B' },
    { startNumber: 4, className: 'Lätt B' }
  ];

  const precisionMap = new Map([
    // Eq 1: 0 penalties, 125.40s
    ['1', { finalized: true, timeMs: 125400, knocks: [], eliminated: false }],
    // Eq 2: 0 penalties, 118.20s (faster -> 1st place)
    ['2', { finalized: true, timeMs: 118200, knocks: [], eliminated: false }],
    // Eq 3: 0 penalties, 118.20s (exact same time and penalties -> tied 1st place)
    ['3', { finalized: true, timeMs: 118200, knocks: [], eliminated: false }],
    // Eq 4: 3 penalties -> 4th place
    ['4', { finalized: true, timeMs: 110000, knocks: [5], eliminated: false }]
  ]);

  const placeMap = buildPlaceMap(rows, precisionMap);

  assert.equal(placeMap.get('2'), 1, 'Eq 2 is fastest clean round -> 1st');
  assert.equal(placeMap.get('3'), 1, 'Eq 3 shares 1st place due to identical time and penalties');
  assert.equal(placeMap.get('1'), 3, 'Eq 1 is 3rd place with slower clean round');
  assert.equal(placeMap.get('4'), 4, 'Eq 4 is 4th with 3 penalties');
});

test('klassTempoData defaults match TR V 2025 Bilaga 5 and FEI 2026', () => {
  assert.equal(klassTempoData['Lätt B Enbet Ponny'].precision, 160);
  assert.equal(klassTempoData['Lätt B Enbet Häst'].precision, 180);
  assert.equal(klassTempoData['Lätt A Enbet Ponny'].precision, 200);
  assert.equal(klassTempoData['Lätt A Enbet Häst'].precision, 210);
  assert.equal(klassTempoData['MSV 4 Enbet Ponny'].precision, 230);
  assert.equal(klassTempoData['MSV 4 Enbet Häst'].precision, 230);
  assert.equal(klassTempoData['Svår Enbet Ponny'].precision, 260);
  assert.equal(klassTempoData['Svår Enbet Häst'].precision, 250);
  assert.equal(klassTempoData['Svår Par Ponny'].precision, 250);
  assert.equal(klassTempoData['Svår Par Häst'].precision, 250);
  assert.equal(klassTempoData['Svår Fyrspann Ponny'].precision, 240);
  assert.equal(klassTempoData['Svår Fyrspann Häst'].precision, 240);
  assert.equal(klassTempoData['Lätt B Barn Ponny'].precision, 100);
  assert.equal(klassTempoData['Lätt A Barn Ponny'].precision, 180);
  assert.equal(klassTempoData['Msv Para Häst'].precision, 220);
  assert.equal(klassTempoData['Msv Para Ponny'].precision, 210);
});

test('getPortAllowanceCm adds +10 cm clearance for four-in-hand in LB, LA, and MSV per TR Bilaga 5 fotnot *', () => {
  // Enbet
  assert.equal(getPortAllowanceCm('Lätt B Enbet Häst'), 35);
  assert.equal(getPortAllowanceCm('Lätt A Enbet Häst'), 30);
  assert.equal(getPortAllowanceCm('Medelsvår Häst Enbet'), 25);

  // Fyrspann via class name
  assert.equal(getPortAllowanceCm('Lätt B Fyrspann Häst'), 45);
  assert.equal(getPortAllowanceCm('Lätt A Fyrspann Häst'), 40);
  assert.equal(getPortAllowanceCm('Medelsvår Fyrspann Häst'), 35);

  // Fyrspann via equipage object (class is just 'Lätt B', but hitch/horses indicate four-in-hand)
  const eqLbFour = { className: 'Lätt B', hitch: 'fyrspann' };
  assert.equal(getPortAllowanceCm(eqLbFour), 45);

  const eqLaFour = { className: 'Lätt A', horses: [{}, {}, {}, {}] };
  assert.equal(getPortAllowanceCm(eqLaFour), 40);

  const eqMsvFour = { className: 'Medelsvår', hitch: 'fyrspann' };
  assert.equal(getPortAllowanceCm(eqMsvFour), 35);
});

test('getStandardPortWidth returns fixed standard cone width for Svår and FEI per TR Bilaga 2 & 5 and FEI Art 974', () => {
  // FEI classes (Art 974)
  assert.equal(isStandardPortWidthClass('FEI 3* Fyrspann Häst'), true);
  assert.equal(getStandardPortWidth('FEI 3* Fyrspann Häst'), 190);
  assert.equal(getStandardPortWidth('FEI 3* Par Häst'), 180);
  assert.equal(getStandardPortWidth('FEI 3* Enbet Häst'), 160);
  assert.equal(getStandardPortWidth('FEI 3* Enbet Ponny'), 150);

  // TR Svår klass (Bilaga 2 & 5: alltid fast)
  assert.equal(isStandardPortWidthClass('Svår Häst Enbet'), true);
  assert.equal(getStandardPortWidth('Svår Häst Enbet'), 158);
  assert.equal(getStandardPortWidth('Svår Häst Par'), 168);
  assert.equal(getStandardPortWidth('Svår Häst Fyrspann'), 183);

  // Non-standard classes
  assert.equal(isStandardPortWidthClass('Lätt B Häst Enbet'), false);
  assert.equal(getStandardPortWidth('Lätt B Häst Enbet'), null);
});

test('computePortWidth respects fixed standard width in Svår/FEI and calculates trackWidth + allow in LB/LA/MSV', () => {
  // In Svår klass: cones do NOT widen if carriage is wider, cones remain fixed standard width
  const eqSvarWide = { className: 'Svår Häst Enbet', trackWidth: 142 };
  assert.equal(computePortWidth(eqSvarWide), 158, 'Cones stay fixed at standard width (158 cm) in Svår klass');

  // In Svår klass even if trackWidth is not yet measured, standard cone width is known
  const eqSvarNoTrack = { className: 'Svår Häst Enbet' };
  assert.equal(computePortWidth(eqSvarNoTrack), 158, 'Standard cone width returned even if carriage width not yet recorded');

  // In FEI Fyrspann: 190 cm
  const eqFei = { className: 'FEI 3* Fyrspann Häst', trackWidth: 160 };
  assert.equal(computePortWidth(eqFei), 190);

  // In LB: variable width (track width 125 cm + 35 cm allowance = 160 cm)
  const eqLb = { className: 'Lätt B Häst Enbet', trackWidth: 125 };
  assert.equal(computePortWidth(eqLb), 160);

  // In LB Fyrspann: variable width (track width 125 cm + 45 cm allowance = 170 cm)
  const eqLbFour = { className: 'Lätt B Fyrspann Häst', trackWidth: 125 };
  assert.equal(computePortWidth(eqLbFour), 170);

  // Missing track width in LB returns null
  const eqLbMissing = { className: 'Lätt B Häst Enbet' };
  assert.equal(computePortWidth(eqLbMissing), null);
});
