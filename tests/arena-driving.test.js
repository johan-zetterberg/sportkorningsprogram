import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeArenaSettings,
    arenaRoundsOf,
    arenaKnockToAdd,
    arenaKnockToRemove,
    arenaKnockCounts,
    formatArenaKnocks,
    arenaIncidentPenalty,
    nextArenaIncidents
} from '../js/utils/arenaRules.js';
import { calculatePrecisionResult, PRECISION_FORMATS } from '../js/utils/precisionCalculation.js';
import { precisionRoundsForFormat } from '../js/utils/precisionRounds.js';
import {
    precisionGroupContext,
    assignPlaces,
    comparePrecisionRank,
    arenaCompetition2StartOrder
} from '../js/core-engine/ranking.js';

const CLASS = 'Fyrspann Arena';
const configOf = (arena = {}) => ({ courses: { [CLASS]: { format: 'arena', arena } } });
const eq = (sn) => ({ startNumber: sn, className: CLASS });
const done = (timeMs, extra = {}) => ({ timeMs, finalized: false, inProgress: false, status: 'Klar', ...extra });

test('arena settings: FEI values are fixed, TR takes the organiser\'s seconds', () => {
    const fei = normalizeArenaSettings({ rules: 'FEI', knockSec: 9, incidentSec: { whipChange: 1 }, driveOff1: 'none' });
    assert.equal(fei.knockSec, 4);
    assert.equal(fei.incidentSec.whipChange, 20);
    // A World Cup Leg's Competition 1 always has a drive-off (WC 5.2)
    assert.equal(fei.driveOff1, 'top3');
    assert.equal(fei.driveOff1Timing, 'fromZero');
    const all = normalizeArenaSettings({ rules: 'FEI', driveOff1: 'all', driveOff1Timing: 'fromZero' });
    assert.equal(all.driveOff1Timing, 'added'); // WC 5.2.2

    const tr = normalizeArenaSettings({ rules: 'TR', knockSec: 5, incidentSec: { groomDismount: 3 }, driveOff1: 'all', driveOff1Timing: 'fromZero' });
    assert.equal(tr.knockSec, 5);
    assert.equal(tr.incidentSec.groomDismount, 3);
    assert.equal(tr.incidentSec.wrongCourse, 20);
    assert.equal(tr.driveOff1Timing, 'fromZero');
    assert.equal(normalizeArenaSettings({ rules: 'TR' }).driveOff1, 'none');

    const two = normalizeArenaSettings({ rules: 'FEI', competitions: 2 });
    assert.deepEqual(arenaRoundsOf(two), ['phase1', 'driveOff', 'phase2', 'driveOff2']);
    assert.deepEqual(precisionRoundsForFormat('arena', { arenaSettings: normalizeArenaSettings({ rules: 'TR' }) }), ['phase1']);
    assert.equal(PRECISION_FORMATS.arena.excludesTotal, true);
});

test('arena knocks: several knocks on one obstacle get a suffix and count each', () => {
    let knocks = [];
    knocks.push(arenaKnockToAdd(knocks, '5'));
    knocks.push(arenaKnockToAdd(knocks, '5'));
    knocks.push(arenaKnockToAdd(knocks, 'H1'));
    assert.deepEqual(knocks, ['5', '5#2', 'H1']);
    assert.equal(arenaKnockCounts(knocks).get('5'), 2);
    assert.equal(formatArenaKnocks(knocks), '5 ×2, H1');
    assert.equal(arenaKnockToRemove(knocks, '5'), '5#2');
    assert.equal(arenaKnockToRemove(['5'], '5'), '5');
    assert.equal(arenaKnockToRemove(['H1'], '5'), null);
});

test('arena incidents: seconds per incident, the third groom dismount eliminates', () => {
    const s = normalizeArenaSettings({ rules: 'FEI' });
    let counts = nextArenaIncidents({}, 'groomDismount', 1);
    counts = nextArenaIncidents(counts, 'wrongCourse', 1);
    assert.deepEqual(arenaIncidentPenalty({ arenaIncidents: counts }, s), { counts: { ...counts }, sec: 25, eliminated: false });
    counts = nextArenaIncidents(counts, 'groomDismount', 2);
    const third = arenaIncidentPenalty({ arenaIncidents: counts }, s);
    assert.equal(third.eliminated, true);
    assert.equal(third.sec, 30); // two dismounts (10) + wrong course (20)
    assert.equal(nextArenaIncidents({ whipChange: 0 }, 'whipChange', -1).whipChange, 0);
});

test('arena result: time + knocks (4 s) + rebuilds (10 s) + incidents, no Time Allowed', () => {
    const r = calculatePrecisionResult(
        done(61234, { knocks: ['3', 'H1', 'H1#2'], knocksVersion: 2, rebuildCount: 1, arenaIncidents: { groomDismount: 1 } }),
        eq(1),
        configOf({ rules: 'FEI' })
    );
    assert.equal(r.precisionFormat, 'arena');
    assert.equal(r.configMissing, false);
    assert.equal(r.status, 'Klar');
    // 61.23 (hundredths) + 10 rebuild + 3 × 4 + 5 = 88.23
    assert.equal(r.score, 88.23);
    assert.equal(r.totalPenalty, 88.23);
    assert.equal(r.penaltySec, 17);
    assert.equal(r.formatExcludesTotal, true);
    assert.equal(r.rounds.phase1.finished, true);
    assert.equal(r.rounds.phase2, null);

    const tr = calculatePrecisionResult(done(60000, { knocks: ['3'], knocksVersion: 2 }), eq(1), configOf({ rules: 'TR', knockSec: 3 }));
    assert.equal(tr.score, 63);

    const out = calculatePrecisionResult(done(60000, { arenaIncidents: { groomDismount: 3 } }), eq(1), configOf({ rules: 'FEI' }));
    assert.equal(out.eliminated, true);
    assert.equal(out.status, 'Utesluten');
});

function place(rows, config, { competition = 1 } = {}) {
    const resultOf = (row) => calculatePrecisionResult(row.doc, eq(row.startNumber), config);
    const ctx = precisionGroupContext(rows, resultOf, () => CLASS, { requireFinished: true, competition });
    const { placeOf } = assignPlaces(rows, { key: (row) => ctx.rankKey(row), compare: comparePrecisionRank, outField: null });
    return { ctx, places: Object.fromEntries(rows.map((r) => [r.startNumber, placeOf.get(r)])) };
}

test('arena drive-off for the best three: a tie for third drives, the drive-off decides from zero', () => {
    const config = configOf({ rules: 'FEI' });
    const rows = [
        { startNumber: 1, doc: done(60000) },
        { startNumber: 2, doc: done(62000) },
        { startNumber: 3, doc: done(64000) },
        { startNumber: 4, doc: done(64000) },
        { startNumber: 5, doc: done(70000) }
    ];
    let { ctx, places } = place(rows, config);
    assert.deepEqual([...ctx.groups.get(CLASS).driveOffQualifiers].sort(), ['1', '2', '3', '4']);
    // Reverse order of merit, the leader last
    assert.deepEqual(ctx.groups.get(CLASS).qualifierStartNumbers, ['3', '4', '2', '1']);
    assert.equal(ctx.groups.get(CLASS).driveOffPending, true);
    assert.equal(places[5], 5);

    // Drive-off: 4 fastest, 1 next, 2 eliminated, 3 slower
    rows[3].doc = { ...rows[3].doc, rounds: { driveOff: done(40000) } };
    rows[0].doc = { ...rows[0].doc, rounds: { driveOff: done(41000) } };
    rows[1].doc = { ...rows[1].doc, rounds: { driveOff: { eliminated: true, inProgress: false, status: 'Utesluten' } } };
    rows[2].doc = { ...rows[2].doc, rounds: { driveOff: done(45000, { knocks: ['2'], knocksVersion: 2 }) } };
    ({ ctx, places } = place(rows, config));
    assert.equal(ctx.groups.get(CLASS).driveOffComplete, true);
    assert.deepEqual(places, { 1: 2, 2: 4, 3: 3, 4: 1, 5: 5 });
});

test('arena drive-off open to all: the time is added to the first round', () => {
    const config = configOf({ rules: 'FEI', driveOff1: 'all' });
    const rows = [
        { startNumber: 1, doc: { ...done(60000), rounds: { driveOff: done(50000) } } },
        { startNumber: 2, doc: { ...done(65000), rounds: { driveOff: done(40000) } } }
    ];
    const { places } = place(rows, config);
    // 1: 110 s, 2: 105 s
    assert.deepEqual(places, { 1: 2, 2: 1 });
});

test('arena: FEI equal scores share the place, TR breaks the tie on the driven time', () => {
    const rows = [
        { startNumber: 1, doc: done(64000) },
        { startNumber: 2, doc: done(60000, { knocks: ['1'], knocksVersion: 2 }) },
        { startNumber: 3, doc: done(70000) }
    ];
    assert.deepEqual(place(rows, configOf({ rules: 'FEI', driveOff1: 'all' })).places, { 1: 1, 2: 1, 3: 3 });
    assert.deepEqual(place(rows, configOf({ rules: 'TR', knockSec: 4 })).places, { 1: 2, 2: 1, 3: 3 });
});

test('arena with two competitions: competition 2 in reverse order of merit, then placed on its own', () => {
    const config = configOf({ rules: 'FEI', competitions: 2, driveOff1: 'top3' });
    const rows = [
        { startNumber: 1, doc: { ...done(60000), rounds: { phase2: done(70000) } } },
        { startNumber: 2, doc: { ...done(62000), rounds: { phase2: done(61000) } } },
        { startNumber: 3, doc: { ...done(80000, { eliminated: true }), rounds: { phase2: done(66000) } } },
        { startNumber: 4, doc: { ...done(64000), rounds: { phase2: done(69000) } } }
    ];
    // Competition 1 without the drive-off driven yet: 1, 2, 4 placed, 3 eliminated
    const resultOf = (row) => calculatePrecisionResult(row.doc, eq(row.startNumber), config);
    const order = arenaCompetition2StartOrder(rows, resultOf, () => CLASS);
    assert.deepEqual(order.get(CLASS), ['3', '4', '2', '1']);

    const { ctx, places } = place(rows, config, { competition: 2 });
    // Top three of competition 2 qualify for Drive-Off 2: 2 (61), 3 (66), 4 (69)
    assert.deepEqual([...ctx.groups.get(CLASS).driveOffQualifiers].sort(), ['2', '3', '4']);
    assert.deepEqual(places, { 1: 4, 2: 1, 3: 2, 4: 3 });
});
