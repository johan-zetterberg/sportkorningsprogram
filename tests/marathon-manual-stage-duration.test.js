import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateMarathonResult, stageManualDuration } from '../js/core-engine/marathon.js';
import { buildCompetitionState } from '../js/core-engine/stateSelector.js';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 13, 9, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const marathonConfig = {
    marathonClassData: {
        'Lätt A Enbet Häst': { distanceA: 5000, distanceB: 5000, tempoA: 250, tempoB: 250 }
    }
};
// A 5 minute global pause inside the stage's start–stop span
const pauseWindows = [{ start: iso(T0 + 10 * MIN), end: iso(T0 + 15 * MIN), durationSec: 300 }];
const stageA = (timing) => {
    const state = buildCompetitionState(
        { startNumber: 1, className: 'Lätt A Enbet Häst', category: 'horse' },
        [], timing, timing, {}, { marathonConfig, pauseWindows, nowMs: T0 + 60 * MIN }
    );
    return calculateMarathonResult(state).stages.A;
};

test('a timed stage (wall time) has the global pause subtracted', () => {
    const a = stageA({ start_A: iso(T0), finish_A: iso(T0 + 25 * MIN), duration_A_ms: 25 * MIN });
    assert.equal(a.durationMs, 20 * MIN);
});

test('a manually typed stage duration is used as typed, without subtracting the pause', () => {
    // The stage page derives start = now - typed and stop = now
    const a = stageA({
        start_A: iso(T0), finish_A: iso(T0 + 20 * MIN), duration_A_ms: 20 * MIN, manualDuration_A: true
    });
    assert.equal(a.durationMs, 20 * MIN);
});

test('the manual flag is read from the flat and the nested timing fields', () => {
    assert.equal(stageManualDuration({ manualDuration_transfer: true }, 'transport'), true);
    assert.equal(stageManualDuration({ timing: { B: { manualDuration: true } } }, 'B'), true);
    assert.equal(stageManualDuration({ manualDuration_A: false }, 'A'), false);
    assert.equal(stageManualDuration({}, 'A'), false);
});
