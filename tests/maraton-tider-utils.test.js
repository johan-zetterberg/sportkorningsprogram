import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarathonCheckpoints,
  buildStageTimingRows,
  calculateStageTiming,
  calculateTransportTiming,
  formatMaratonDuration,
  kmhToMmin,
  parseExtraDistancesInput,
  resolveWarmupMinutes
} from '../js/pages/marathon/maratonTiderUtils.js';

test('formatMaratonDuration formats milliseconds as mm:ss', () => {
  assert.equal(formatMaratonDuration(0), '00:00');
  assert.equal(formatMaratonDuration(65_000), '01:05');
  assert.equal(formatMaratonDuration(null), '-');
  assert.equal(formatMaratonDuration(-1), '-');
});

test('parseExtraDistancesInput accepts comma separated positive meters', () => {
  assert.deepEqual(parseExtraDistancesInput('500, 1000, x, -1, 0, 1500'), [500, 1000, 1500]);
});

test('buildMarathonCheckpoints includes km marks, final 300m and unique extras', () => {
  assert.deepEqual(buildMarathonCheckpoints(2300, [700, 1000, 2400]), [700, 1000, 2000]);
  assert.deepEqual(buildMarathonCheckpoints(800, [], { includeFinal300: true }), [500]);
});

test('resolveWarmupMinutes uses manual value and barn lätt b fallback', () => {
  assert.equal(resolveWarmupMinutes('Lätt B Barn', 15), 15);
  assert.equal(resolveWarmupMinutes('Lätt B Barn', null), 10);
  assert.equal(resolveWarmupMinutes('LÃ¤tt B Barn', null), 10);
  assert.equal(resolveWarmupMinutes('Lätt A', null), 20);
});

test('calculateStageTiming computes allowed, minimum, average and time limit', () => {
  const timing = calculateStageTiming(1400, 14, 2, 'A');

  assert.equal(Math.round(kmhToMmin(14)), 233);
  assert.equal(Math.round(timing.allowedMs), 360000);
  assert.equal(Math.round(timing.minMs), 240000);
  assert.equal(Math.round(timing.avgMs), 300000);
  assert.equal(Math.round(timing.timeLimitMs), 432000);
});

test('buildStageTimingRows returns checkpoint and finish rows for stage tables', () => {
  const timing = buildStageTimingRows(1400, 14, 2, 'B', [500]);

  assert.equal(Math.round(timing.timeLimitMs), 720000);
  assert.deepEqual(
    timing.rows.map(row => ({
      distance: row.distance,
      minMs: Math.round(row.minMs),
      avgMs: Math.round(row.avgMs),
      allowedMs: Math.round(row.allowedMs),
      isFinal: Boolean(row.isFinal),
      isFinal300: Boolean(row.isFinal300)
    })),
    [
      { distance: 500, minMs: 85714, avgMs: 107143, allowedMs: 128571, isFinal: false, isFinal300: false },
      { distance: 1000, minMs: 171429, avgMs: 214286, allowedMs: 257143, isFinal: false, isFinal300: false },
      { distance: 1100, minMs: 188571, avgMs: 235714, allowedMs: 282857, isFinal: false, isFinal300: true },
      { distance: 1400, minMs: 240000, avgMs: 300000, allowedMs: 360000, isFinal: true, isFinal300: false }
    ]
  );
  assert.equal(buildStageTimingRows(1400, 0, 2, 'B'), null);
});

test('calculateTransportTiming computes transport checkpoints without final 300m marker', () => {
  const timing = calculateTransportTiming(2300, 100, [750, 1000, 2400]);

  assert.equal(Math.round(timing.allowedMs), 1380000);
  assert.deepEqual(
    timing.checkpoints.map(row => [row.distance, Math.round(row.timeMs)]),
    [
      [750, 450000],
      [1000, 600000],
      [2000, 1200000]
    ]
  );
  assert.equal(calculateTransportTiming(2300, 0), null);
});
