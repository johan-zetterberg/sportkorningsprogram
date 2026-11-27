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

test('arena checks: the route through a marathon-type obstacle, as in the marathon', async () => {
    const { arenaGateLetters, nextArenaRoute, arenaRouteText, arenaRouteTimeMs, arenaRoundElapsedMs, normalizeArenaCheck: norm } = await import('../js/utils/arenaChecks.js');
    assert.deepEqual(arenaGateLetters({ type: 'marathon' }), ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.deepEqual(arenaGateLetters({ type: 'marathon', gates: 4 }), ['A', 'B', 'C', 'D']);
    // The course keeps a marathon obstacle's gate count, not a cone's
    const s = normalizeArenaSettings({ obstacles: [{ label: 'H1', type: 'marathon', gates: 5 }, { label: '1', type: 'cone', gates: 5 }] });
    assert.deepEqual(s.obstacles, [{ label: 'H1', type: 'marathon', gates: 5 }, { label: '1', type: 'cone' }]);

    let route = [];
    route = nextArenaRoute(route, 'A', { ms: 10000, at: 1 });
    route = nextArenaRoute(route, 'B', { ms: 12500, at: 2 });
    route = nextArenaRoute(route, 'b', { ms: 14000, at: 3 });
    route = nextArenaRoute(route, 'B', { ms: 15000, at: 4 });
    route = nextArenaRoute(route, 'C', { ms: 18250, at: 5 });
    assert.equal(arenaRouteText(route), 'A B b B C');
    assert.equal(arenaRouteTimeMs(route), 8250);
    assert.equal(arenaRouteText(nextArenaRoute(route, 'undo')), 'A B b B');
    assert.deepEqual(nextArenaRoute(route, 'clear'), []);
    assert.equal(nextArenaRoute(route, 'Z'), null);
    // Without a running clock the gate is kept without a split time
    assert.deepEqual(nextArenaRoute([], 'a'), [{ g: 'a', ms: null, at: null }]);
    assert.equal(norm({ obstacle: 'H1', route: [{ g: 'A' }, { g: 'xx' }, null] }).route.length, 1);

    // The split time: the round's clock (server time) while it runs
    assert.equal(arenaRoundElapsedMs({ running: true, liveStartEpoch: 1000, livePausedMs: 500 }, 4000), 3500);
    assert.equal(arenaRoundElapsedMs({ running: false, liveStartEpoch: 1000 }, 4000), null);
});

test('arena checks: split times per round for the results, and the live map\'s data', async () => {
    const { arenaSplitsByRound, arenaMapData } = await import('../js/utils/arenaChecks.js');
    const course = [{ label: '1', type: 'cone' }, { label: 'H1', type: 'marathon' }, { label: '2', type: 'cone' }];
    const checks = [
        { startNumber: 5, round: 'phase1', obstacle: '2', passMs: 30000, passAt: 1030000 },
        { startNumber: 5, round: 'phase1', obstacle: '1', passMs: 8000, passAt: 1008000 },
        { startNumber: 5, round: 'phase1', obstacle: 'H1', result: 'ok', route: [{ g: 'A', ms: 12000 }, { g: 'B', ms: 15000 }] },
        { startNumber: 5, round: 'phase2', obstacle: '1', passMs: 7000, passAt: 2007000 },
        { startNumber: 6, round: 'phase1', obstacle: '1', passMs: 9000, passAt: 1 }
    ];
    const rounds = arenaSplitsByRound(checks, 5, course, ['phase1', 'phase2', 'driveOff']);
    assert.deepEqual(rounds.map((r) => r.round), ['phase1', 'phase2']);
    // Course order, not the order reported
    assert.deepEqual(rounds[0].passages, [{ label: '1', ms: 8000 }, { label: '2', ms: 30000 }]);
    assert.equal(rounds[0].routes[0].text, 'A B');
    assert.equal(rounds[0].routes[0].ms, 3000);

    // The map: passages as gate splits of the round on the course
    const doc = { running: false, rounds: { phase2: { running: true, liveStartEpoch: 2000000, livePausedMs: 0, status: 'Pågår' } } };
    const map = arenaMapData(doc, checks, 5, 'phase2');
    assert.equal(map.running, true);
    assert.deepEqual(map.gateSplits, { start: 2000000, gate_1: 2007000 });
    const first = arenaMapData({ running: true, liveStartEpoch: 1000000 }, checks, 5, 'phase1');
    assert.deepEqual(first.gateSplits, { start: 1000000, gate_1: 1008000, gate_2: 1030000 });
});
