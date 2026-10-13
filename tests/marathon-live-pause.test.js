import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateMarathonResult } from '../js/core-engine/marathon.js';
import { buildCompetitionState } from '../js/core-engine/stateSelector.js';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 13, 9, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const marathonConfig = {
    marathonClassData: {
        'Lätt A Enbet Häst': { distanceA: 5000, distanceB: 5000, tempoA: 250, tempoB: 250 }
    }
};
const liveB = (timing, nowMs) => {
    const state = buildCompetitionState(
        { startNumber: 1, className: 'Lätt A Enbet Häst', category: 'horse' },
        [], timing, timing, {}, { marathonConfig, nowMs }
    );
    return calculateMarathonResult(state).stages.B;
};

test('a running stage ticks from its start', () => {
    const b = liveB({ start_B: iso(T0), runningSince_B: iso(T0), duration_B_ms: 0 }, T0 + 10 * MIN);
    assert.equal(b.rawDurationMs ?? b.durationMs ?? b.ms, 10 * MIN);
});

test('a stage paused on the stage page shows its saved time and does not tick', () => {
    // Ran 10 min, paused 5 min ago
    const b = liveB({ start_B: iso(T0), runningSince_B: null, duration_B_ms: 10 * MIN }, T0 + 15 * MIN);
    assert.equal(b.rawDurationMs ?? b.durationMs ?? b.ms, 10 * MIN);
});

test('after resuming, the time is the saved time plus the time since the resume', () => {
    // Ran 10 min, paused 5 min, resumed 5 min ago: 15 min driven (not 20)
    const b = liveB({ start_B: iso(T0), runningSince_B: iso(T0 + 15 * MIN), duration_B_ms: 10 * MIN }, T0 + 20 * MIN);
    assert.equal(b.rawDurationMs ?? b.durationMs ?? b.ms, 15 * MIN);
});

test('older data without runningSince ticks from the start as before', () => {
    const b = liveB({ start_B: iso(T0) }, T0 + 12 * MIN);
    assert.equal(b.rawDurationMs ?? b.durationMs ?? b.ms, 12 * MIN);
});
