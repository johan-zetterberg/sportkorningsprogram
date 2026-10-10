import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHoldTimeInput,
  getTotalHoldTimeMs,
  calculateMarathonResult,
  setMarathonConfig
} from '../js/utils/marathonUtils.js';

test('parseHoldTimeInput parses seconds, mm:ss, decimals, and gracefully handles edge cases', () => {
  // Plain integers and numeric strings
  assert.equal(parseHoldTimeInput(30), 30);
  assert.equal(parseHoldTimeInput('45'), 45);
  assert.equal(parseHoldTimeInput('  60  '), 60);

  // mm:ss format
  assert.equal(parseHoldTimeInput('1:15'), 75);
  assert.equal(parseHoldTimeInput('02:30'), 150);
  assert.equal(parseHoldTimeInput('0:45'), 45);

  // Decimals (both dot and comma)
  assert.equal(parseHoldTimeInput('45.4'), 45);
  assert.equal(parseHoldTimeInput('45,6'), 46);

  // Zero, empty, null, undefined, invalid
  assert.equal(parseHoldTimeInput(0), 0);
  assert.equal(parseHoldTimeInput('0'), 0);
  assert.equal(parseHoldTimeInput(''), 0);
  assert.equal(parseHoldTimeInput(null), 0);
  assert.equal(parseHoldTimeInput(undefined), 0);
  assert.equal(parseHoldTimeInput('invalid'), 0);
  assert.equal(parseHoldTimeInput(-10), 0);
});

test('getTotalHoldTimeMs aggregates hold times from obstacles', () => {
  const obstaclesList = [
    { number: 1, holdTimeSec: 25 },
    { number: 2, holdTimeSec: '1:10' }, // 70s
    { number: 3, holdTimeSec: 0 },
    { number: 4 }
  ];

  // Pass directly as array
  assert.equal(getTotalHoldTimeMs(obstaclesList), 95000);

  // Pass inside data object
  assert.equal(getTotalHoldTimeMs({ obstacles: obstaclesList }), 95000);

  // Empty or invalid input
  assert.equal(getTotalHoldTimeMs([]), 0);
  assert.equal(getTotalHoldTimeMs(null), 0);
  assert.equal(getTotalHoldTimeMs({}), 0);
});

test('calculateMarathonResult deducts obstacle hold time from Stage B elapsed time', () => {
  // Set config with B-stage: distance 6000m, tempo 240 m/min -> optimum time = 1500s.
  // Window = 3 min -> min time = 1320s, max time = 1500s.
  setMarathonConfig({
    timePenaltyRate: 0.25,
    marathonClassData: {
      Msv: {
        distanceB: 6000,
        tempoB: 240 // 1500s ideal
      }
    }
  });

  const equipage = {
    startNumber: 1,
    className: 'Msv'
  };

  // Driver was on track for 1550 seconds (raw).
  // Without deduction: 1550 > 1500 (max) -> 50s overtime -> 50 * 0.25 = 12.5 penalties.
  // Driver was held at obstacle 2 for 60 seconds.
  // Net time = 1550 - 60 = 1490s (inside [1320s, 1500s] window).
  // Net penalty = 0.
  const rawDurationMs = 1550 * 1000;
  const marathonDoc = {
    obstacles: [
      { number: 1, timeSeconds: 45.0, ballsDown: 0 },
      { number: 2, timeSeconds: 50.0, ballsDown: 0, holdTimeSec: 60, holdTimeReason: 'Föregående ekipage i hinder' }
    ]
  };

  const timingDoc = {
    duration_B_ms: rawDurationMs
  };

  const result = calculateMarathonResult(equipage, marathonDoc, timingDoc);

  assert.ok(result.stages.B);
  assert.equal(result.stages.B.rawDurationMs, 1550 * 1000, 'Preserves raw gross duration');
  assert.equal(result.stages.B.holdTimeMs, 60 * 1000, 'Tracks applied hold time in milliseconds');
  assert.equal(result.stages.B.durationMs, 1490 * 1000, 'Deducts hold time from net driving duration');
  assert.equal(result.stages.B.timePenalty, 0, 'No time penalty when net time is within allowed limits');
});
