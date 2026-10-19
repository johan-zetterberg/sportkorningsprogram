import test from 'node:test';
import assert from 'node:assert/strict';

import {
    changedPauseWindows,
    marathonOverlapsPauseWindows,
    equipageWriteAffectsResults,
    marathonWriteAffectsResults,
    precisionWriteAffectsResults,
    storedResultUnchanged
} from '../functions/src/triggerFilters.js';
import { configChangeAffectsResults, resultSettingsFingerprint } from '../functions/src/resultRecalculationUtils.js';

test('equipage: speaker notes and temperatures skip the recalculation, class and horses do not', () => {
    const base = { startNumber: 3, className: 'Häst', horses: [{ name: 'Ella' }] };
    assert.equal(equipageWriteAffectsResults(base, { ...base, speakerNotes: 'x', updatedAt: 't' }), false);
    assert.equal(equipageWriteAffectsResults(base, { ...base, horseTemperatures: { a: 37.8 } }), false);
    assert.equal(equipageWriteAffectsResults(base, { ...base, className: 'Ponny' }), true);
    assert.equal(equipageWriteAffectsResults(base, { ...base, horses: [{ name: 'Ella', heightCm: 140 }] }), true);
    assert.equal(equipageWriteAffectsResults(base, { ...base, status: 'struken' }), true);
    // Created and deleted documents always count
    assert.equal(equipageWriteAffectsResults(null, base), true);
    assert.equal(equipageWriteAffectsResults(base, null), true);
});

test('marathon: live form state skips the recalculation, saved obstacles and stage times do not', () => {
    const base = { obstacles: [{ obstacle: 1, timeMs: 40000 }], start_A: 1000 };
    assert.equal(marathonWriteAffectsResults(base, { ...base, live_knockdowns: '2', currentObstacle: 2 }), false);
    assert.equal(marathonWriteAffectsResults(base, { ...base, running: true, liveObstacleStartAt: 5 }), false);
    assert.equal(marathonWriteAffectsResults(base, { ...base, obstacleTimes: { 2: { enteredAtClient: 'x' } } }), false);
    assert.equal(marathonWriteAffectsResults(base, { ...base, obstacles: [...base.obstacles, { obstacle: 2 }] }), true);
    assert.equal(marathonWriteAffectsResults(base, { ...base, stop_A: 9000 }), true);
    assert.equal(marathonWriteAffectsResults(base, { ...base, finalized: true }), true);
});

test('precision: ticks of a running round are skipped; start, stop and knocks are not', () => {
    const running = { running: true, liveStartEpoch: 1, liveTimeMs: 5000, knocks: [] };
    assert.equal(precisionWriteAffectsResults(running, { ...running, liveTimeMs: 10000, liveTotalPenalty: 0 }), false);
    assert.equal(precisionWriteAffectsResults(running, { ...running, gateSplits: { g1: 3 } }), false);
    assert.equal(precisionWriteAffectsResults(running, { ...running, knocks: ['3'] }), true);
    assert.equal(precisionWriteAffectsResults(running, { ...running, running: false, liveTimeMs: 61000 }), true);
    const stopped = { ...running, running: false };
    assert.equal(precisionWriteAffectsResults(stopped, { ...stopped, liveTimeMs: 62000 }), true);
});

test('an equal stored result is not rewritten; a changed value or engine version is', () => {
    const stored = { totalPenalty: 52.3, isEliminated: false, isOngoing: false, dressagePenalty: 40, calculationAudit: { engineVersion: 'v2' }, updatedAt: 'old' };
    const next = { ...stored, updatedAt: 'new', calculationAudit: { engineVersion: 'v2', recalculatedAt: 'now' } };
    assert.equal(storedResultUnchanged(stored, next, 'v2'), true);
    assert.equal(storedResultUnchanged(stored, { ...next, totalPenalty: 53 }, 'v2'), false);
    assert.equal(storedResultUnchanged(stored, next, 'v3'), false);
    assert.equal(storedResultUnchanged(null, next, 'v2'), false);
});

test('saving the course map does not recalculate the competition', () => {
    const cfg = { timePenaltyRate: 0.25, mapSettings: { imageUrl: 'a.png' } };
    assert.equal(configChangeAffectsResults('maratonConfig', cfg, { ...cfg, mapSettings: { imageUrl: 'b.png' } }), false);
    assert.equal(configChangeAffectsResults('maratonConfig', cfg, { ...cfg, timePenaltyRate: 0.5 }), true);
    assert.equal(configChangeAffectsResults('precisionConfig', { mapSettings: {} }, { mapSettings: { enabled: true } }), false);
    // The fingerprint ignores it too, so a map save during a run does not discard its results
    assert.equal(
        resultSettingsFingerprint({ configs: { maratonConfig: cfg } }),
        resultSettingsFingerprint({ configs: { maratonConfig: { ...cfg, mapSettings: null } } })
    );
});

test('pause log: only the changed pauses count, an open pause lasts until closed', () => {
    const p1 = { start: '2026-10-17T10:00:00.000Z', end: '2026-10-17T10:10:00.000Z', durationSec: 600 };
    const open = { start: '2026-10-17T11:00:00.000Z', end: null };
    const closed = { ...open, end: '2026-10-17T11:05:00.000Z', durationSec: 300 };
    const t = (iso) => Date.parse(iso);
    // A new open pause
    assert.deepEqual(changedPauseWindows([p1], [p1, open]), [[t(open.start), Infinity]]);
    // Closing it: the open and the closed versions both count
    assert.deepEqual(changedPauseWindows([p1, open], [p1, closed]), [[t(open.start), Infinity], [t(closed.start), t(closed.end)]]);
    assert.deepEqual(changedPauseWindows([p1], [p1]), []);
    // An entry without a readable start: recalculate everything
    assert.equal(changedPauseWindows([], [{ start: 'not a date' }]), null);
});

test('pause log: only equipages with a stage overlapping the pause are recalculated', () => {
    const at = (hhmm) => Date.parse(`2026-10-17T${hhmm}:00.000Z`);
    const windows = [[at('11:00'), at('11:05')]];
    // Stage B over the pause
    assert.equal(marathonOverlapsPauseWindows({ start_B: at('10:50'), finish_B: at('11:20') }, {}, windows), true);
    // Finished before the pause, started after it
    assert.equal(marathonOverlapsPauseWindows({ start_A: at('09:00'), finish_A: at('09:30') }, {}, windows), false);
    assert.equal(marathonOverlapsPauseWindows({}, { start_A: at('11:10'), finish_A: at('11:40') }, windows), false);
    // Still running at the pause (from the timing document)
    assert.equal(marathonOverlapsPauseWindows(null, { start_A: at('10:30') }, windows), true);
    // No stage times at all
    assert.equal(marathonOverlapsPauseWindows({ obstacles: [] }, null, windows), false);
    assert.equal(marathonOverlapsPauseWindows({ start_B: at('10:50') }, {}, []), false);
});