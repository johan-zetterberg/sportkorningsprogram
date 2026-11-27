import test from 'node:test';
import assert from 'node:assert/strict';

import {
    arenaCheckId,
    arenaControlObstacles,
    arenaCheckPending,
    arenaCheckPendingSeconds,
    nextArenaCheck,
    normalizeArenaCheck
} from '../js/utils/arenaChecks.js';
import { normalizeArenaSettings } from '../js/utils/arenaRules.js';

test('arena checks: id per start number, round and obstacle; controllers stand at marathon obstacles and bridges', () => {
    assert.equal(arenaCheckId(12, 'phase2', 'H1'), '12__phase2__H1');
    assert.equal(arenaCheckId('7', 'nonsense', 'A/B'), '7__phase1__A%2FB');
    const settings = normalizeArenaSettings({ obstacles: [
        { label: '1', type: 'cone' }, { label: 'H1', type: 'marathon' }, { label: 'B', type: 'bridge' }, { label: 'S', type: 'speedBox' }
    ] });
    assert.deepEqual(arenaControlObstacles(settings).map((o) => o.label), ['H1', 'B']);
    assert.deepEqual(arenaControlObstacles(null), []);
});

test('arena checks: the controller\'s taps', () => {
    let c = nextArenaCheck(null, 'knockAdd');
    // A knock without a gate verdict: the gates were right
    assert.deepEqual(c, { result: 'ok', knocks: 1 });
    c = nextArenaCheck(c, 'wrongCorrected');
    assert.deepEqual(c, { result: 'wrongCorrected', knocks: 1 });
    c = nextArenaCheck(c, 'knockRemove');
    c = nextArenaCheck(c, 'knockRemove');
    assert.deepEqual(c, { result: 'wrongCorrected', knocks: 0 });
    assert.equal(nextArenaCheck(c, 'eliminate'), null);
    assert.equal(normalizeArenaCheck({ obstacle: '' }), null);
    assert.equal(normalizeArenaCheck({ obstacle: 'H1', knocks: 99 }).knocks, 20);
});

test('arena checks: what the judge still has to add', () => {
    const settings = normalizeArenaSettings({ rules: 'FEI' });
    const report = { startNumber: 3, round: 'phase1', obstacle: 'H1', result: 'wrongCorrected', knocks: 2 };
    assert.deepEqual(arenaCheckPending(report), { knocks: 2, wrongCourse: true, elimination: false, any: true });
    // 2 × 4 s + 20 s
    assert.equal(arenaCheckPendingSeconds(report, settings), 28);
    const applied = { ...report, applied: { knocks: 2, wrongCourse: true } };
    assert.equal(arenaCheckPending(applied).any, false);
    // A knock reported after the judge added the first ones: only the new one
    assert.deepEqual(arenaCheckPending({ ...applied, knocks: 3 }), { knocks: 1, wrongCourse: false, elimination: false, any: true });
    // Not corrected: nothing added, the judge decides the elimination
    const uncorrected = arenaCheckPending({ ...report, result: 'wrongUncorrected', knocks: 0 });
    assert.deepEqual(uncorrected, { knocks: 0, wrongCourse: false, elimination: true, any: false });
});
