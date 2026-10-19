import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrecisionSavePayload,
  checkPrecisionClock,
  clockFaultMessage,
  penaltyCorrection,
  plausibleRunLimitMs,
  rebuildLabel,
  sortKnocks,
  storedKnocks,
  storedRebuildCount
} from '../js/pages/precision/precisionInputUtils.js';
import { buildPrecisionFinalizePayload } from '../js/pages/precision/precisionResultFinalize.js';

// A stand-in for the result engine: 5 p per knock, no time penalty
const calculate = (data) => {
  const obstaclePenalty = (data.knocks || []).length * 5;
  return {
    obstaclePenalty,
    timePenalty: 0,
    totalPenalty: obstaclePenalty + (data.extraPenalty || 0),
    configMissing: false
  };
};

test('sortKnocks sorts numerically as strings', () => {
  assert.deepEqual(sortKnocks([10, '2', '1B', '1A']), ['1A', '1B', '2', '10']);
  assert.deepEqual(sortKnocks(null), []);
  assert.deepEqual(storedKnocks({ knocks: ['3', 1] }), ['1', '3']);
});

test('save payload never carries the knock list and counts the stored knocks', () => {
  // This device shows knock 1, another device has added knock 4 (in the stored doc)
  const stored = { knocks: ['1', '4'], knockDownTimes: { 1: 1000, 4: 2000 } };
  const { payload, knocks } = buildPrecisionSavePayload({
    stored,
    timeMs: 123456.4,
    extraPenalty: 0,
    eliminated: false,
    comment: '',
    startNumber: 7,
    className: 'Häst',
    calculate,
    now: 1
  });
  assert.equal('knocks' in payload, false);
  assert.equal('knockDownTimes' in payload, false);
  assert.deepEqual(knocks, ['1', '4']);
  assert.equal(payload.obstaclePenalty, 10);
  assert.equal(payload.totalPenalty, 10);
  assert.equal(payload.timeMs, 123456);
  assert.equal(payload.status, 'Klar');
  assert.equal(payload.running, false);
});

test('save payload: eliminated has no total, empty round keeps the not-started label', () => {
  const elim = buildPrecisionSavePayload({ stored: {}, eliminated: true, calculate, startNumber: 1 }).payload;
  assert.equal(elim.totalPenalty, null);
  assert.equal(elim.status, 'Utesluten');
  const empty = buildPrecisionSavePayload({ stored: null, calculate, startNumber: 1, notStartedLabel: 'Ej startat' }).payload;
  assert.equal(empty.status, 'Ej startat');
  assert.equal(empty.obstaclePenalty, 0);
});

test('penaltyCorrection: none when the stored knocks are the counted ones', () => {
  const { payload, knocks } = buildPrecisionSavePayload({ stored: { knocks: ['2'] }, timeMs: 1000, calculate, startNumber: 3 });
  assert.equal(penaltyCorrection(payload, knocks, { ...payload, knocks: ['2'] }, calculate), null);
});

test('penaltyCorrection: a knock that reached the server meanwhile is counted', () => {
  const { payload, knocks } = buildPrecisionSavePayload({ stored: { knocks: ['2'] }, timeMs: 1000, calculate, startNumber: 3 });
  const after = { ...payload, knocks: ['2', '5'] };
  const patch = penaltyCorrection(payload, knocks, after, calculate);
  assert.equal(patch.obstaclePenalty, 10);
  assert.equal(patch.totalPenalty, 10);
  assert.equal('knocks' in patch, false);
});

test('penaltyCorrection leaves a clock started again alone', () => {
  const { payload, knocks } = buildPrecisionSavePayload({ stored: { knocks: [] }, timeMs: 1000, calculate, startNumber: 3 });
  assert.equal(penaltyCorrection(payload, knocks, { knocks: ['1'], running: true }, calculate), null);
});

test('checkPrecisionClock: normal running clock', () => {
  const r = checkPrecisionClock({ startEpoch: 1_000_000, pausedMs: 500, nowMs: 1_060_000, maxSec: 150 });
  assert.deepEqual(r, { ok: true, elapsedMs: 60500 });
});

test('checkPrecisionClock: missing start never gives the time since 1970', () => {
  const now = Date.UTC(2026, 9, 18);
  for (const startEpoch of [null, undefined, 0, '', NaN, 'x']) {
    const r = checkPrecisionClock({ startEpoch, pausedMs: 1200, nowMs: now, maxSec: 150 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'missing-start');
    assert.equal(r.elapsedMs, 1200);
  }
});

test('checkPrecisionClock: start in the future and far too long ago', () => {
  const now = 10_000_000;
  const future = checkPrecisionClock({ startEpoch: now + 60_000, nowMs: now, maxSec: 150 });
  assert.equal(future.reason, 'future-start');
  // Small skew between devices is tolerated
  assert.equal(checkPrecisionClock({ startEpoch: now + 2000, nowMs: now, maxSec: 150 }).ok, true);
  const old = checkPrecisionClock({ startEpoch: now - plausibleRunLimitMs(150) - 1, nowMs: now, maxSec: 150 });
  assert.equal(old.reason, 'too-long');
  assert.equal(old.elapsedMs, 0);
  // Without a max time: 30 min
  assert.equal(plausibleRunLimitMs(null), 30 * 60000);
  assert.ok(clockFaultMessage('too-long').length > 0);
  assert.equal(clockFaultMessage('ok'), '');
});

test('save counts the stored rebuilds but never writes rebuildCount', () => {
  const seen = [];
  const calc = (data) => { seen.push(data.rebuildCount); return calculate(data); };
  const { payload } = buildPrecisionSavePayload({ stored: { knocks: [], rebuildCount: 2 }, timeMs: 1000, calculate: calc, startNumber: 1 });
  assert.deepEqual(seen, [2]);
  assert.equal('rebuildCount' in payload, false);
});

test('penaltyCorrection: a rebuild added on another device meanwhile triggers a correction', () => {
  const { payload, knocks } = buildPrecisionSavePayload({ stored: { knocks: ['1'], rebuildCount: 1 }, timeMs: 1000, calculate, startNumber: 3 });
  assert.equal(penaltyCorrection(payload, knocks, { ...payload, knocks: ['1'], rebuildCount: 1 }, calculate, 1), null);
  assert.notEqual(penaltyCorrection(payload, knocks, { ...payload, knocks: ['1'], rebuildCount: 2 }, calculate, 1), null);
});

test('rebuild helpers', () => {
  assert.equal(storedRebuildCount({ rebuildCount: 2.7 }), 2);
  assert.equal(storedRebuildCount({ rebuildCount: -1 }), 0);
  assert.equal(storedRebuildCount(null), 0);
  assert.equal(rebuildLabel(0), '');
  assert.equal(rebuildLabel(2), '+10 s × 2');
});

test('finalize payload drops the knock list', () => {
  const payload = buildPrecisionFinalizePayload({ totalPenalty: 5, knocks: ['1'], knockDownTimes: { 1: 3 } });
  assert.deepEqual(payload, { prioritized: true, totalPenalty: 5, finalized: true });
});
