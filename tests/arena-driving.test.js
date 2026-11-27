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
    nextArenaIncidents,
    arenaPrecisionConfigPatch
} from '../js/utils/arenaRules.js';
import { calculatePrecisionResult, PRECISION_FORMATS, getPrecisionFormat, getArenaSettings } from '../js/utils/precisionCalculation.js';
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

test('arena competition: classes without their own format are arena classes with the competition defaults', () => {
    const patch = arenaPrecisionConfigPatch({ rules: 'TR', competitions: 2, driveOff1: 'none' });
    assert.deepEqual(patch, {
        defaultFormat: 'arena',
        arenaDefaults: { rules: 'TR', competitions: 2, driveOff1: 'none', driveOff2: 'top3', driveOff2Timing: 'added' }
    });
    // FEI: Drive-Off 1 is always held (WC 5.2), no timing stored (derived)
    assert.deepEqual(arenaPrecisionConfigPatch({ rules: 'FEI', driveOff1: 'none' }).arenaDefaults,
        { rules: 'FEI', competitions: 1, driveOff1: 'top3' });

    const config = { ...patch, courses: { 'Lätt A': { format: 'normal' }, [CLASS]: { arena: { rules: 'FEI', obstacles: [{ label: '1' }] } } } };
    assert.equal(getPrecisionFormat('Ny klass', config), 'arena');
    assert.equal(getPrecisionFormat('Lätt A', config), 'normal', 'a class with its own format keeps it');
    assert.equal(getArenaSettings('Ny klass', config).rules, 'TR', 'competition defaults');
    assert.equal(getArenaSettings('Ny klass', config).competitions, 2);
    assert.equal(getArenaSettings(CLASS, config).rules, 'FEI', 'the class settings win');
    // A combined competition is unchanged
    assert.equal(getPrecisionFormat('Ny klass', {}), 'normal');
    assert.equal(getArenaSettings('Ny klass', {}).rules, 'FEI');
});

test('arena competition: the precision discipline is called Arenakörning', async () => {
  const { setCompetitionLanguageContext, t, translateTo, precisionLabel } = await import('../js/utils/i18n.js');
  try {
    setCompetitionLanguageContext({ competitionKind: 'arena' });
    assert.equal(t('menu_precision'), 'Arenakörning');
    assert.equal(t('menu_admin_precision'), 'Admin Arenakörning');
    assert.equal(translateTo('precision', 'en'), 'Arena driving');
    assert.equal(precisionLabel('sv'), 'Arenakörning');
    // Other labels as before
    assert.equal(t('menu_dressage') !== 'Arenakörning', true);
    setCompetitionLanguageContext({ competitionKind: 'combined' });
    assert.equal(t('menu_precision'), 'Precision');
    assert.equal(precisionLabel('sv'), 'Precision');
  } finally {
    setCompetitionLanguageContext(null);
  }
});

test('arena judging: an untimed class has one competition and no drive-off', () => {
    const s = normalizeArenaSettings({ rules: 'FEI', judging: 'faults', competitions: 2, driveOff1: 'top3' });
    assert.equal(s.judging, 'faults');
    assert.equal(s.competitions, 1);
    assert.equal(s.driveOff1, 'none');
    assert.equal(s.driveOff2, 'none');
    assert.equal(normalizeArenaSettings({ judging: 'nonsense' }).judging, 'timed');
    assert.equal(normalizeArenaSettings({}).judging, 'timed');
});

test('arena judging "faults": placed on knock and incident seconds without a time, equal shares the place', () => {
    const config = configOf({ rules: 'FEI', judging: 'faults' });
    const rows = [
        { startNumber: 1, doc: { knocks: ['1', '2'], knocksVersion: 2, judged: true } },          // 8 s
        { startNumber: 2, doc: { knocks: [], judged: true } },                                     // 0 s
        { startNumber: 3, doc: { knocks: ['4'], knocksVersion: 2, judged: true } },                // 4 s
        { startNumber: 4, doc: { knocks: ['2'], knocksVersion: 2, judged: true } },                // 4 s
        { startNumber: 5, doc: { knocks: ['1'], knocksVersion: 2 } },                              // not judged yet
        { startNumber: 6, doc: { judged: true, eliminated: true } }
    ];
    const r1 = calculatePrecisionResult(rows[0].doc, eq(1), config);
    assert.equal(r1.score, 8);
    assert.equal(r1.status, 'Klar');
    assert.equal(r1.timeMs, null);
    assert.equal(r1.driveOffScheduled, false);
    assert.equal(calculatePrecisionResult(rows[4].doc, eq(5), config).status, 'Pågår');
    const { ctx, places } = place(rows, config);
    assert.deepEqual(places, { 1: 4, 2: 1, 3: 2, 4: 2, 5: null, 6: null });
    assert.equal(ctx.groups.get(CLASS).driveOffNeeded, false);
    // TR seconds per knock count too
    const tr = calculatePrecisionResult({ knocks: ['1'], knocksVersion: 2, judged: true }, eq(1), configOf({ rules: 'TR', knockSec: 5, judging: 'faults' }));
    assert.equal(tr.score, 5);
});

test('arena judging "approval" and "participation": never placed', () => {
    const approval = configOf({ judging: 'approval' });
    const ok = calculatePrecisionResult({ approved: true }, eq(1), approval);
    const notOk = calculatePrecisionResult({ approved: false }, eq(2), approval);
    const none = calculatePrecisionResult({}, eq(3), approval);
    assert.equal(ok.approval, true);
    assert.equal(ok.status, 'Klar');
    assert.equal(notOk.approval, false);
    assert.equal(none.approval, null);
    assert.equal(none.status, 'Ej startat');
    let { places } = place([{ startNumber: 1, doc: { approved: true } }, { startNumber: 2, doc: { approved: false } }], approval);
    assert.deepEqual(places, { 1: null, 2: null });

    const participation = configOf({ judging: 'participation' });
    const p = calculatePrecisionResult({}, eq(1), participation);
    assert.equal(p.arenaJudging, 'participation');
    ({ places } = place([{ startNumber: 1, doc: {} }, { startNumber: 2, doc: {} }], participation));
    assert.deepEqual(places, { 1: null, 2: null });
});

test('arena two rounds summed: placed on round 1 + round 2, equal sums share, an elimination in either round leaves no place', () => {
    const settings = normalizeArenaSettings({ rules: 'FEI', sumRounds: true, competitions: 2, driveOff1: 'top3' });
    assert.equal(settings.sumRounds, true);
    assert.equal(settings.competitions, 1);
    assert.equal(settings.driveOff1, 'none');
    assert.deepEqual(arenaRoundsOf(settings), ['phase1', 'phase2']);
    // Untimed classes never sum
    assert.equal(normalizeArenaSettings({ judging: 'faults', sumRounds: true }).sumRounds, false);
    assert.deepEqual(arenaPrecisionConfigPatch({ rules: 'TR', sumRounds: true }).arenaDefaults.sumRounds, true);

    const config = configOf({ rules: 'TR', sumRounds: true });
    const two = (a, b, extra = {}) => ({ ...done(a), rounds: { phase2: done(b, extra) } });
    const rows = [
        { startNumber: 1, doc: two(60000, 65000) },                // 125
        { startNumber: 2, doc: two(70000, 50000) },                // 120
        { startNumber: 3, doc: two(62000, 58000) },                // 120: shares 1st with 2
        { startNumber: 4, doc: two(50000, 50000, { eliminated: true, status: 'Utesluten' }) },
        { startNumber: 5, doc: done(55000) }                       // round 1 only
    ];
    const r1 = calculatePrecisionResult(rows[0].doc, eq(1), config);
    assert.equal(r1.rounds.sum.score, 125);
    assert.equal(r1.rounds.sum.finished, true);
    assert.equal(r1.rounds.sum.round1Score, 60);
    assert.equal(r1.rounds.sum.round2Score, 65);
    assert.equal(r1.driveOffScheduled, false);
    assert.equal(calculatePrecisionResult(rows[3].doc, eq(4), config).rounds.sum.out, true);

    const { ctx, places } = place(rows, config);
    assert.deepEqual(places, { 1: 3, 2: 1, 3: 1, 4: null, 5: 4 });
    // Round 1 alone: a provisional place after those who drove both rounds
    assert.equal(ctx.isProvisional(rows[4]), true);
    assert.equal(ctx.isProvisional(rows[0]), false);
    // Competition 2 does not exist
    assert.deepEqual(Object.values(place(rows, config, { competition: 2 }).places).filter((p) => p != null), []);

    // While round 1 is driven by all: the standing is on round 1
    const first = [
        { startNumber: 1, doc: done(60000) },
        { startNumber: 2, doc: done(58000) }
    ];
    assert.deepEqual(place(first, config).places, { 1: 2, 2: 1 });
});

test('arena two rounds summed: round 2 starts in reverse order of round 1 and keeps it while round 2 is driven', () => {
    const config = configOf({ rules: 'TR', sumRounds: true });
    const resultOf = (row) => calculatePrecisionResult(row.doc, eq(row.startNumber), config);
    const rows = [
        { startNumber: 1, doc: done(60000) },
        { startNumber: 2, doc: done(58000) },
        { startNumber: 3, doc: done(65000) }
    ];
    assert.deepEqual(arenaCompetition2StartOrder(rows, resultOf, () => CLASS).get(CLASS), ['3', '1', '2']);
    // 3 has driven a slow round 2: the order stays
    rows[2].doc = { ...rows[2].doc, rounds: { phase2: done(90000) } };
    assert.deepEqual(arenaCompetition2StartOrder(rows, resultOf, () => CLASS).get(CLASS), ['3', '1', '2']);
});
