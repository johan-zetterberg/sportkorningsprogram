import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrecisionSavePayload,
  checkPrecisionClock,
  clockFaultMessage,
  formatKnockList,
  parseKnockListInput,
  penaltyCorrection,
  phase2HasData,
  plausibleRunLimitMs,
  rebuildLabel,
  shouldPushStop,
  sortKnocks,
  storedKnocks,
  storedRebuildCount,
  storedRoundTimeMs
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
  // No stored obstacle penalty: the engine counts the knock list itself
  assert.equal('obstaclePenalty' in payload, false);
  assert.equal(payload.liveObstaclePenalty, 10);
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
  assert.equal('obstaclePenalty' in empty, false);
  assert.equal(empty.liveObstaclePenalty, 0);
});

test('penaltyCorrection: none when the stored knocks are the counted ones', () => {
  const { payload, knocks } = buildPrecisionSavePayload({ stored: { knocks: ['2'] }, timeMs: 1000, calculate, startNumber: 3 });
  assert.equal(penaltyCorrection(payload, knocks, { ...payload, knocks: ['2'] }, calculate), null);
});

test('penaltyCorrection: a knock that reached the server meanwhile is counted', () => {
  const { payload, knocks } = buildPrecisionSavePayload({ stored: { knocks: ['2'] }, timeMs: 1000, calculate, startNumber: 3 });
  const after = { ...payload, knocks: ['2', '5'] };
  const patch = penaltyCorrection(payload, knocks, after, calculate);
  assert.equal('obstaclePenalty' in patch, false);
  assert.equal(patch.liveObstaclePenalty, 10);
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

test('a Stop is not pushed over a round already saved (here or on another device)', () => {
  assert.equal(shouldPushStop({ running: false, inProgress: false, timeMs: 150000 }), false);
  assert.equal(shouldPushStop({ running: true, inProgress: true }), true);
  // Stopped but not saved: the stopped time is pushed again
  assert.equal(shouldPushStop({ running: false, inProgress: true, liveTimeMs: 61000 }), true);
  // Nothing stored yet (first snapshot not in): the Stop goes out
  assert.equal(shouldPushStop({}), true);
  assert.equal(shouldPushStop(null), true);
});

test('a saved round shows its saved time even when a late Stop rewrote liveTimeMs', () => {
  // Saved at 150.00 s, then a queued Stop from another device wrote 152.30 s
  assert.equal(storedRoundTimeMs({ inProgress: false, running: false, timeMs: 150000, liveTimeMs: 152300 }), 150000);
  // Unsaved: the clock's time
  assert.equal(storedRoundTimeMs({ inProgress: true, running: false, timeMs: 150000, liveTimeMs: 152300 }), 152300);
  // A reset clears timeMs: no old saved time comes back
  assert.equal(storedRoundTimeMs({ inProgress: false, running: false, timeMs: null, liveTimeMs: 0 }), 0);
  assert.equal(storedRoundTimeMs({ finalized: true, timeMs: 140000, liveTimeMs: 1 }), 140000);
  assert.equal(storedRoundTimeMs(null), 0);
});

test('phase2HasData: a started, driven or saved phase 2', () => {
  assert.equal(phase2HasData({}), false);
  assert.equal(phase2HasData({ rounds: { phase2: { status: 'Ej startat', inProgress: false, liveTimeMs: 0 } } }), false);
  assert.equal(phase2HasData({ rounds: { phase2: { running: true } } }), true);
  assert.equal(phase2HasData({ rounds: { phase2: { timeMs: 70000, inProgress: false } } }), true);
  assert.equal(phase2HasData({ rounds: { phase2: { knocks: ['A'] } } }), true);
  assert.equal(phase2HasData({ rounds: { phase2: { status: 'Klar' } } }), true);
});

test('secretariat knock field: typed list to sorted unique labels and back', () => {
  assert.deepEqual(parseKnockListInput(' 5, 3A ;3A  10 '), ['3A', '5', '10']);
  assert.deepEqual(parseKnockListInput(''), []);
  assert.deepEqual(parseKnockListInput(null), []);
  assert.equal(formatKnockList(['5', '3A']), '3A, 5');
  assert.equal(formatKnockList(undefined), '');
});

test('finalize payload drops the knock list', () => {
  const payload = buildPrecisionFinalizePayload({ totalPenalty: 5, knocks: ['1'], knockDownTimes: { 1: 3 } });
  assert.deepEqual(payload, { prioritized: true, totalPenalty: 5, finalized: true });
});
