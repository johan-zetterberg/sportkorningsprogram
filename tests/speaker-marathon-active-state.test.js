import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpeakerMarathonActiveEntry } from '../js/pages/shared/speakerMarathonActiveState.js';

const eq = { startNumber: 12, className: 'LA' };

test('speaker marathon active entry detects running obstacle timers', () => {
  const entry = buildSpeakerMarathonActiveEntry('12', eq, {
    currentObstacle: 3,
    running: true,
    liveObstacleStartAt: 1000,
    liveObstacleTimeMs: 2500,
    updatedAt: { toMillis: () => 10000 }
  }, 12000);

  assert.equal(entry.task.type, 'obstacle');
  assert.equal(entry.task.key, 3);
  assert.equal(entry.timerBaseMs, 7500);
  assert.equal(entry.fixedElapsedMs, null);
  assert.equal(entry.updatedAt, 12000);
});

test('speaker marathon active entry keeps stopped obstacle visible with fixed time', () => {
  const entry = buildSpeakerMarathonActiveEntry('12', eq, {
    currentObstacle: 2,
    running: false,
    liveObstacleTimeMs: 4200
  }, 12000);

  assert.equal(entry.task.type, 'obstacle');
  assert.equal(entry.fixedElapsedMs, 4200);
});

test('speaker marathon active entry shows recent obstacle result flash', () => {
  const entry = buildSpeakerMarathonActiveEntry('12', eq, {
    obstacles: [
      { number: 1, timeMs: 35000, exitAt: 90000 }
    ]
  }, 100000);

  assert.equal(entry.task.type, 'result_flash');
  assert.equal(entry.task.key, 'flash');
  assert.equal(entry.fixedElapsedMs, 35000);
  assert.equal(entry.startTime, 90000);
});

test('speaker marathon active entry detects transport wait before B', () => {
  const entry = buildSpeakerMarathonActiveEntry('12', eq, {
    start_A: 1000,
    finish_A: 2000
  }, 3000);

  assert.equal(entry.task.type, 'transport');
  assert.equal(entry.task.key, 'wait_b');
  assert.equal(entry.timerBaseMs, 2000);
});

test('speaker marathon active entry ignores withdrawn inactive equipages', () => {
  const entry = buildSpeakerMarathonActiveEntry('12', { ...eq, status: 'withdrawn' }, {
    start_A: 1000,
    finish_A: 2000
  }, 3000);

  assert.equal(entry, null);
});
