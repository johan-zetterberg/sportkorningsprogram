import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
