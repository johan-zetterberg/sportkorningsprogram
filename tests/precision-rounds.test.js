// Precision formats "two phases" (TR 530.1.3 / FEI 979) and "drive-off"
// (FEI 977; TR only as an organiser's variant, TR 510): the cases of the
// design spec (owner answers Q1-Q13), with its numbers.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePrecisionResult,
  calculatePrecisionLiveResult,
  calculatePrecisionRoundResult,
  computePrecisionRoundMaxSec,
  getPrecisionRoundTempoMpm,
  isPrecisionDriveOffScheduled,
  precisionRoundScoring,
  PRECISION_FORMATS
} from '../js/utils/precisionCalculation.js';
import {
  assignPlaces,
  comparePrecisionRank,
  precisionGroupContext,
  precisionRankKey
} from '../js/core-engine/ranking.js';
import { calculateTotalResult } from '../js/core-engine/calculation.js';
import { buildCompetitionState } from '../js/core-engine/stateSelector.js';
import {
  buildPrecisionKnockWrite,
  buildPrecisionRebuildWrite,
  buildPrecisionRoundStartWrite,
  buildPrecisionRoundStopWrite,
  buildPrecisionRoundRetireWrite,
  canStartPrecisionRound,
  precisionRoundFieldPath,
  precisionRoundsForFormat,
  readPrecisionRound
} from '../js/utils/precisionRounds.js';
import {
  buildPhase1FinishWrite,
  buildPrecisionSavePayload,
  penaltyCorrection
} from '../js/pages/precision/precisionInputUtils.js';
import { calculatePrecisionResult as serverPrecision } from '../functions/src/utils/precisionCalculation.js';
import { precisionGroupContext as serverGroupContext } from '../functions/src/core-engine/ranking.js';

const sec = (s) => Math.round(s * 1000);

// --- Shared setup (spec section 5) ---
// TR "MSV Enbet Häst": F1 600 m @230 -> 157 s; F2 300 m @240 -> 75 s (limit 150 s)
const TR_CLASS = 'MSV Enbet Häst';
const trTwoPhase = {
  courses: { [TR_CLASS]: { format: 'twoPhase', trackLengthMeters: 600, tempo: 230, phase2: { trackLengthMeters: 300, tempo: 240 } } }
};
// FEI "CAI2* Singles Horse": F1 650 m @250 -> 156 s; F2 300 m -> 72 s; drive-off 350 m -> 84 s
const FEI_CLASS = 'CAI2* Singles Horse';
const feiTwoPhase = {
  courses: { [FEI_CLASS]: { format: 'twoPhase', trackLengthMeters: 650, tempo: 250, phase2: { trackLengthMeters: 300 } } }
};
const feiDriveOff = (extra = {}) => ({
  courses: { [FEI_CLASS]: { format: 'driveOff', trackLengthMeters: 650, tempo: 250, driveOff: { trackLengthMeters: 350, scheduled: true, ...extra } } }
});

const NAMES = ['A', 'B', 'C', 'D', 'E'];
const eqOf = (name, className) => ({ startNumber: NAMES.indexOf(name) + 1, className, status: 'anmäld' });

// Phase 1 / initial round: finalized time (s), knocks, extra penalty, eliminated
function p1(timeS, { knocks = [], extra = null, eliminated = false, finalized = true } = {}) {
  const d = { finalized, timeMs: sec(timeS), liveTimeMs: sec(timeS), knocks };
  if (extra !== null) d.extraPenalty = extra;
  if (eliminated) d.eliminated = true;
  return d;
}
// A round sub-doc (rounds.phase2 / rounds.driveOff)
function rd(timeS, { knocks = [], rebuilds = 0, eliminated = false, retired = false } = {}) {
  const r = { timeMs: timeS == null ? null : sec(timeS), liveTimeMs: timeS == null ? null : sec(timeS), knocks, running: false, inProgress: false };
  if (rebuilds) r.rebuildCount = rebuilds;
  if (eliminated) r.eliminated = true;
  if (retired) r.retired = true;
  return r;
}
const withRound = (doc, round, sub) => ({ ...doc, rounds: { ...(doc.rounds || {}), [round]: sub } });

// Places of rows { name, doc } in one group (or groupOf), result-list rules
function placeAll(entries, className, config, { requireFinished = true, groupOf = () => 'g', calc = calculatePrecisionResult } = {}) {
  const rows = entries.map((e) => ({ name: e.name, startNumber: NAMES.indexOf(e.name) + 1, eq: eqOf(e.name, e.className || className), doc: e.doc }));
  const ctx = precisionGroupContext(rows, (r) => calc(r.doc, r.eq, config), groupOf, { requireFinished });
  const { placeOf } = assignPlaces(rows, { key: (r) => ctx.rankKey(r), compare: comparePrecisionRank, outField: null });
  const places = Object.fromEntries(rows.map((r) => [r.name, placeOf.get(r)]));
  const keys = Object.fromEntries(rows.map((r) => [r.name, ctx.rankKey(r)]));
  return { places, keys, ctx, rows };
}

// Precision contribution to the combined total (calculateTotalResult)
function totalContribution(name, className, doc, config) {
  const state = buildCompetitionState(eqOf(name, className), [], {}, {}, doc, { precisionConfig: config });
  return calculateTotalResult(state).precisionPenalty;
}

function assertTotals(className, config, entries, expected) {
  for (const e of entries) {
    const res = calculatePrecisionResult(e.doc, eqOf(e.name, className), config);
    const total = totalContribution(e.name, className, e.doc, config);
    // Invariant: the total's precision is phase 1 / the initial round
    assert.equal(total, res.totalPenalty, `${e.name}: total = phase 1`);
    if (expected[e.name] === 'elim') assert.equal(res.eliminated, true, `${e.name} eliminated`);
    else assert.equal(total, expected[e.name], `${e.name} total`);
  }
}

// --- Config and formats ---

test('two phases and drive-off are supported formats counting phase 1 in the total', () => {
  assert.equal(PRECISION_FORMATS.twoPhase.supported, true);
  assert.equal(PRECISION_FORMATS.driveOff.supported, true);
  assert.equal(PRECISION_FORMATS.twoPhase.excludesTotal, false);
  assert.equal(PRECISION_FORMATS.driveOff.excludesTotal, false);
  for (const f of ['time', 'winningRound', 'youngHorse']) assert.equal(PRECISION_FORMATS[f].supported, false, f);
});

test('round max times, Bilaga 5 phase-2 tempos and scoring per profile', () => {
  const tr = { className: TR_CLASS };
  assert.equal(computePrecisionRoundMaxSec(tr, trTwoPhase, 'phase1', { ruleProfile: 'TR' }), 157);
  assert.equal(computePrecisionRoundMaxSec(tr, trTwoPhase, 'phase2', { ruleProfile: 'TR' }), 75);
  // Without a configured phase-2 tempo: Bilaga 5 "Fas 2" (MSV 240)
  const noTempo = { courses: { [TR_CLASS]: { format: 'twoPhase', trackLengthMeters: 600, phase2: { trackLengthMeters: 300 } } } };
  assert.equal(getPrecisionRoundTempoMpm(tr, noTempo, 'phase2', { ruleProfile: 'TR' }), 240);
  assert.equal(getPrecisionRoundTempoMpm({ className: 'Lätt A Enbet Ponny' }, {}, 'phase2', { ruleProfile: 'TR' }), 210);
  assert.equal(getPrecisionRoundTempoMpm({ className: 'Svår Enbet Häst' }, {}, 'phase2', { ruleProfile: 'TR' }), 250);
  assert.equal(getPrecisionRoundTempoMpm({ className: 'MSV Enbet Ponny', isPara: true }, {}, 'phase2', { ruleProfile: 'TR' }), 220);
  // Q11: Lätt B has no phase-2 tempo; the admin must enter it
  assert.equal(getPrecisionRoundTempoMpm({ className: 'Lätt B Enbet Ponny' }, {}, 'phase2', { ruleProfile: 'TR' }), null);
  const lb = { courses: { 'Lätt B Enbet Ponny': { format: 'twoPhase', trackLengthMeters: 500, phase2: { trackLengthMeters: 300 } } } };
  const lbRes = calculatePrecisionResult(withRound(p1(150), 'phase2', rd(60)), { className: 'Lätt B Enbet Ponny' }, lb);
  assert.equal(lbRes.rounds.phase2.configMissing, true);
  assert.ok(lbRes.formatWarnings.includes('phase2ConfigMissing'));
  // FEI: phase 2 and drive-off at the phase-1 speed by default
  const fei = { className: FEI_CLASS };
  assert.equal(computePrecisionRoundMaxSec(fei, feiTwoPhase, 'phase1', { ruleProfile: 'FEI' }), 156);
  assert.equal(computePrecisionRoundMaxSec(fei, feiTwoPhase, 'phase2', { ruleProfile: 'FEI' }), 72);
  assert.equal(computePrecisionRoundMaxSec(fei, feiDriveOff(), 'driveOff', { ruleProfile: 'FEI' }), 84);
  // A drive-off without its own length: the same course
  assert.equal(computePrecisionRoundMaxSec(fei, { courses: { [FEI_CLASS]: { format: 'driveOff', trackLengthMeters: 650 } } }, 'driveOff', { ruleProfile: 'FEI' }), 156);
  assert.equal(precisionRoundScoring('phase2', 'TR'), 'fault');
  assert.equal(precisionRoundScoring('phase2', 'FEI'), 'time');
  assert.equal(precisionRoundScoring('driveOff', 'TR'), 'time');
  assert.equal(isPrecisionDriveOffScheduled(fei, feiDriveOff()), true);
  assert.equal(isPrecisionDriveOffScheduled(fei, feiDriveOff({ scheduled: false })), false);
  assert.equal(isPrecisionDriveOffScheduled(fei, feiTwoPhase), false);
});

// --- 5.1 Two phases - TR ---

test('TR2-1 basic: phase-2 drivers first, then phase 1 only; total is phase 1', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(70)) },
    { name: 'B', doc: withRound(p1(145), 'phase2', rd(65, { knocks: ['3'] })) },
    { name: 'C', doc: p1(140, { knocks: ['5'] }) },
    { name: 'D', doc: p1(158) },
    { name: 'E', doc: p1(120, { eliminated: true }) }
  ];
  const { places, keys } = placeAll(entries, TR_CLASS, trTwoPhase);
  assert.deepEqual(places, { A: 1, B: 2, D: 3, C: 4, E: null });
  assert.equal(keys.A.tier, 2);
  assert.equal(keys.D.tier, undefined); // tier 4: the old key shape
  assertTotals(TR_CLASS, trTwoPhase, entries, { A: 0, B: 0, C: 3, D: 0.5, E: 'elim' });
});

test('TR2-2 tie in phase 2: equal penalties and time share the place', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(70)) },
    { name: 'B', doc: withRound(p1(151), 'phase2', rd(70)) },
    { name: 'C', doc: withRound(p1(149), 'phase2', rd(71.2)) }
  ];
  assert.deepEqual(placeAll(entries, TR_CLASS, trTwoPhase).places, { A: 1, B: 1, C: 3 });
  assertTotals(TR_CLASS, trTwoPhase, entries, { A: 0, B: 0, C: 0 });
});

test('TR2-3 nobody clear: placed by phase-1 penalties and time', () => {
  const entries = [
    { name: 'A', doc: p1(140, { knocks: ['1'] }) },
    { name: 'B', doc: p1(138, { knocks: ['2'] }) },
    { name: 'C', doc: p1(158) }
  ];
  assert.deepEqual(placeAll(entries, TR_CLASS, trTwoPhase).places, { C: 1, B: 2, A: 3 });
  assertTotals(TR_CLASS, trTwoPhase, entries, { C: 0.5, B: 3, A: 3 });
});

test('TR2-4 eliminated in phase 2: after the phase-2 finishers, before phase 1 only (Q1a, Q2a)', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(152), 'phase2', rd(40, { eliminated: true })) },
    { name: 'B', doc: withRound(p1(150), 'phase2', rd(72, { knocks: ['1', '2'] })) },
    { name: 'C', doc: p1(130, { extra: 5 }) }
  ];
  const { places, keys } = placeAll(entries, TR_CLASS, trTwoPhase);
  assert.deepEqual(places, { B: 1, A: 2, C: 3 });
  assert.equal(keys.A.tier, 3);
  assertTotals(TR_CLASS, trTwoPhase, entries, { A: 0, B: 0, C: 5 });
});

test('TR2-5 rebuild in phase 2: +10 s, time penalty over the phase-2 max time', () => {
  const docA = withRound(p1(150), 'phase2', rd(68, { rebuilds: 1, knocks: ['4'] }));
  const docB = withRound(p1(150), 'phase2', rd(74, { knocks: ['2'] }));
  const a = calculatePrecisionResult(docA, eqOf('A', TR_CLASS), trTwoPhase);
  assert.equal(a.rounds.phase2.timeMs, 78000);
  assert.equal(a.rounds.phase2.timePenalty, 1.5);
  assert.equal(a.rounds.phase2.totalPenalty, 4.5);
  assert.deepEqual(placeAll([{ name: 'A', doc: docA }, { name: 'B', doc: docB }], TR_CLASS, trTwoPhase).places, { B: 1, A: 2 });
  assertTotals(TR_CLASS, trTwoPhase, [{ name: 'A', doc: docA }, { name: 'B', doc: docB }], { A: 0, B: 0 });
});

test('TR2-6 phase-2 time limit (2 x 75 s): eliminated in phase 2 only', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(151)) },
    { name: 'B', doc: withRound(p1(150), 'phase2', rd(74)) }
  ];
  const a = calculatePrecisionResult(entries[0].doc, eqOf('A', TR_CLASS), trTwoPhase);
  assert.equal(a.rounds.phase2.autoEliminated, true);
  assert.equal(a.eliminated, false);
  assert.deepEqual(placeAll(entries, TR_CLASS, trTwoPhase).places, { B: 1, A: 2 });
  assertTotals(TR_CLASS, trTwoPhase, entries, { A: 0, B: 0 });
});

test('TR2-7 extra penalty in phase 1: no phase 2, the input refuses to start it', () => {
  const doc = p1(150, { extra: 5 });
  const res = calculatePrecisionResult(doc, eqOf('A', TR_CLASS), trTwoPhase);
  assert.equal(res.phase2Qualified, false);
  assert.deepEqual(canStartPrecisionRound(res, 'phase2'), { ok: false, reason: 'notQualified' });
  assert.deepEqual(precisionRankKey(res, { requireFinished: true }), { penalty: 5, timeMs: 150000 });
  assert.equal(totalContribution('A', TR_CLASS, doc, trTwoPhase), 5);
  // The finish-line button only saves phase 1 (the judge's bell)
  const calc = (data) => calculatePrecisionResult(data, eqOf('A', TR_CLASS), trTwoPhase);
  const finish = buildPhase1FinishWrite({ stored: {}, splitMs: 150000, extraPenalty: 5, startNumber: 1, className: TR_CLASS, calculate: calc, now: 1 });
  assert.equal(finish.qualified, false);
  assert.equal(finish.payload.rounds, undefined);
});

test('TR2-8 correction: a phase-1 knock added later makes phase 2 not count, with a warning', () => {
  const doc = withRound(p1(150, { knocks: ['7'] }), 'phase2', rd(60));
  const res = calculatePrecisionResult(doc, eqOf('A', TR_CLASS), trTwoPhase);
  assert.equal(res.phase2Qualified, false);
  assert.equal(res.phase2Ignored, true);
  assert.ok(res.formatWarnings.includes('phase2Ignored'));
  assert.deepEqual(precisionRankKey(res, { requireFinished: true }), { penalty: 3, timeMs: 150000 });
  const { ctx } = placeAll([{ name: 'A', doc }], TR_CLASS, trTwoPhase);
  assert.deepEqual(ctx.warnings.map((w) => w.code), ['phase2Ignored']);
  assert.equal(totalContribution('A', TR_CLASS, doc, trTwoPhase), 3);
});

test('TR2-9 unfinished: clear phase 1, phase 2 not driven yet', () => {
  const doc = p1(150, { finalized: false });
  const res = calculatePrecisionResult(doc, eqOf('A', TR_CLASS), trTwoPhase);
  assert.equal(res.status, 'Klar');
  assert.equal(res.phase2Qualified, true);
  assert.equal(precisionRankKey(res, { requireFinished: true }), null);
  const live = precisionRankKey(res);
  assert.equal(live.tier, 3);
  assert.equal(live.provisional, true);
  assert.equal(totalContribution('A', TR_CLASS, doc, trTwoPhase), 0);
  // Once finalized without phase 2: did not continue (tier 3)
  const fin = calculatePrecisionResult(p1(150), eqOf('A', TR_CLASS), trTwoPhase);
  assert.equal(precisionRankKey(fin, { requireFinished: true }).tier, 3);
});

// --- 5.2 Two phases - FEI (phase 2 a time competition) ---

test('FEI2-1 phase 2 against the clock differs from TR', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(62, { knocks: ['1'] })) },
    { name: 'B', doc: withRound(p1(150), 'phase2', rd(66)) }
  ];
  const a = calculatePrecisionResult(entries[0].doc, eqOf('A', FEI_CLASS), feiTwoPhase);
  assert.equal(a.rounds.phase2.scoring, 'time');
  assert.equal(a.rounds.phase2.totalPenalty, 65);
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiTwoPhase).places, { A: 1, B: 2 });
  // TR: B wins with 0 penalties
  assert.deepEqual(placeAll(entries, TR_CLASS, trTwoPhase).places, { B: 1, A: 2 });
  assertTotals(FEI_CLASS, feiTwoPhase, entries, { A: 0, B: 0 });
});

test('FEI2-2 over the Time Allowed: +0.5 s per second (Q6)', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(75)) },
    { name: 'B', doc: withRound(p1(150), 'phase2', rd(76)) }
  ];
  const a = calculatePrecisionResult(entries[0].doc, eqOf('A', FEI_CLASS), feiTwoPhase);
  assert.equal(a.rounds.phase2.score, 76.5);
  assert.equal(a.rounds.phase2.penaltySec, 1.5);
  // The spec's table has "B 76.00 clear -> B 1", but 76 s is also 4 s over
  // the 72 s TA: +2 s -> 78.00 s (Q6, as in FEI2-3 and DO-7), so A wins
  const b = calculatePrecisionResult(entries[1].doc, eqOf('B', FEI_CLASS), feiTwoPhase);
  assert.equal(b.rounds.phase2.score, 78);
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiTwoPhase).places, { A: 1, B: 2 });
  // B under the TA (71.00 s) wins
  const under = [entries[0], { name: 'B', doc: withRound(p1(150), 'phase2', rd(71)) }];
  assert.deepEqual(placeAll(under, FEI_CLASS, feiTwoPhase).places, { B: 1, A: 2 });
  assertTotals(FEI_CLASS, feiTwoPhase, entries, { A: 0, B: 0 });
});

test('FEI2-3 rebuild in phase 2: +10 s and the knock seconds', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(60, { rebuilds: 1, knocks: ['2'] })) },
    { name: 'B', doc: withRound(p1(150), 'phase2', rd(72.5)) }
  ];
  const res = entries.map((e) => calculatePrecisionResult(e.doc, eqOf(e.name, FEI_CLASS), feiTwoPhase).rounds.phase2.score);
  assert.deepEqual(res, [73, 72.75]);
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiTwoPhase).places, { B: 1, A: 2 });
});

test('FEI2-4 nobody clear: by phase-1 penalties and time', () => {
  const entries = [
    { name: 'A', doc: p1(140, { knocks: ['1'] }) },
    { name: 'B', doc: p1(157) },
    { name: 'C', doc: p1(138, { knocks: ['1'] }) }
  ];
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiTwoPhase).places, { B: 1, C: 2, A: 3 });
  assertTotals(FEI_CLASS, feiTwoPhase, entries, { B: 0.5, C: 3, A: 3 });
});

test('FEI2-5 eliminated in phase 2: after the phase-2 finishers (Q2a), total phase 1 (Q1a)', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(50, { eliminated: true })) },
    { name: 'B', doc: withRound(p1(150), 'phase2', rd(70)) },
    { name: 'C', doc: p1(140, { knocks: ['1'] }) }
  ];
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiTwoPhase).places, { B: 1, A: 2, C: 3 });
  assertTotals(FEI_CLASS, feiTwoPhase, entries, { A: 0, B: 0, C: 3 });
});

test('FEI2-6 disobedience in phase 2 costs no seconds: equal time shares the place', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(71)) },
    { name: 'B', doc: withRound(p1(151), 'phase2', rd(71)) }
  ];
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiTwoPhase).places, { A: 1, B: 1 });
});

test('FEI2-7 phase-2 Time Limit (2 x 72 s): eliminated in phase 2, total phase 1', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'phase2', rd(145)) },
    { name: 'B', doc: withRound(p1(150), 'phase2', rd(70)) }
  ];
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiTwoPhase).places, { B: 1, A: 2 });
  assertTotals(FEI_CLASS, feiTwoPhase, entries, { A: 0, B: 0 });
});

// --- 5.3 Drive-off (FEI fault competition) ---

const initialDO1 = { A: p1(150), B: p1(152.3), C: p1(149), D: p1(140, { knocks: ['1'] }) };

test('DO-1 basic drive-off: places 1..k from the drive-off, the rest by the initial round', () => {
  const entries = [
    { name: 'A', doc: withRound(initialDO1.A, 'driveOff', rd(75)) },
    { name: 'B', doc: withRound(initialDO1.B, 'driveOff', rd(70, { knocks: ['2'] })) },
    { name: 'C', doc: withRound(initialDO1.C, 'driveOff', rd(72, { rebuilds: 1, knocks: ['3'] })) },
    { name: 'D', doc: initialDO1.D }
  ];
  const { places, keys, ctx } = placeAll(entries, FEI_CLASS, feiDriveOff());
  assert.deepEqual(places, { B: 1, A: 2, C: 3, D: 4 });
  assert.equal(keys.C.penalty, 85);
  assert.equal(keys.B.tier, 0);
  const g = ctx.groups.get('g');
  assert.deepEqual(g.qualifierStartNumbers, ['1', '2', '3']);
  assert.equal(g.driveOffComplete, true);
  assert.equal(ctx.pending, false);
  // Without a drive-off in the schedule: by the initial round's time (977.2.3)
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiDriveOff({ scheduled: false })).places, { C: 1, A: 2, B: 3, D: 4 });
  assertTotals(FEI_CLASS, feiDriveOff(), entries, { A: 0, B: 0, C: 0, D: 3 });
});

test('DO-2 a single leader: no drive-off; drive-off data of others is ignored with a warning', () => {
  const entries = [
    { name: 'A', doc: p1(150) },
    { name: 'B', doc: withRound(p1(140, { knocks: ['1'] }), 'driveOff', rd(60)) },
    { name: 'C', doc: p1(141, { knocks: ['1'] }) }
  ];
  const { places, ctx } = placeAll(entries, FEI_CLASS, feiDriveOff());
  assert.deepEqual(places, { A: 1, B: 2, C: 3 });
  assert.equal(ctx.groups.get('g').driveOffNeeded, false);
  assert.deepEqual(ctx.warnings.map((w) => [w.startNumber, w.code]), [['2', 'driveOffIgnored']]);
  assertTotals(FEI_CLASS, feiDriveOff(), entries, { A: 0, B: 3, C: 3 });
});

test('DO-3 nobody clear: a drive-off among the equal lowest penalties', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150, { knocks: ['1'] }), 'driveOff', rd(81)) },
    { name: 'B', doc: withRound(p1(155, { knocks: ['1'] }), 'driveOff', rd(80)) },
    { name: 'C', doc: p1(120, { knocks: ['1', '2'] }) }
  ];
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiDriveOff()).places, { B: 1, A: 2, C: 3 });
  assertTotals(FEI_CLASS, feiDriveOff(), entries, { A: 3, B: 3, C: 6 });
});

test('DO-4 eliminated in the drive-off: after the drive-off finishers (Q3a)', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'driveOff', rd(40, { eliminated: true })) },
    { name: 'B', doc: withRound(p1(151), 'driveOff', rd(80)) },
    { name: 'C', doc: withRound(p1(152), 'driveOff', rd(78)) }
  ];
  const { places, keys } = placeAll(entries, FEI_CLASS, feiDriveOff());
  assert.deepEqual(places, { C: 1, B: 2, A: 3 });
  assert.equal(keys.A.tier, 1);
  assertTotals(FEI_CLASS, feiDriveOff(), entries, { A: 0, B: 0, C: 0 });
});

test('DO-5 tie in the drive-off: fewer penalty seconds first (Q4b)', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'driveOff', rd(70, { knocks: ['1'] })) },
    { name: 'B', doc: withRound(p1(151), 'driveOff', rd(73)) }
  ];
  const { places, keys } = placeAll(entries, FEI_CLASS, feiDriveOff());
  assert.equal(keys.A.penalty, 73);
  assert.equal(keys.B.penalty, 73);
  assert.deepEqual(places, { B: 1, A: 2 });
});

test('DO-6 pending drive-off: provisional places and a pending flag (Q13)', () => {
  const entries = [
    { name: 'A', doc: p1(150) },
    { name: 'B', doc: p1(151) },
    { name: 'C', doc: p1(140, { knocks: ['1'] }) }
  ];
  const { places, keys, ctx } = placeAll(entries, FEI_CLASS, feiDriveOff());
  assert.deepEqual(places, { A: 1, B: 2, C: 3 });
  assert.equal(keys.A.provisional, true);
  assert.equal(keys.B.provisional, true);
  assert.equal(keys.C.provisional, undefined);
  assert.equal(ctx.pending, true);
  assert.equal(ctx.groups.get('g').driveOffPending, true);
  // A running drive-off is still pending
  const running = withRound(p1(150), 'driveOff', { running: true, inProgress: true, liveStartEpoch: 1000, livePausedMs: 0 });
  const live = placeAll([{ name: 'A', doc: running }, { name: 'B', doc: p1(151) }], FEI_CLASS, feiDriveOff(), {
    calc: (d, eq, cfg) => calculatePrecisionLiveResult(d, eq, cfg, {}, 31000)
  });
  assert.equal(live.ctx.pending, true);
  assertTotals(FEI_CLASS, feiDriveOff(), entries, { A: 0, B: 0, C: 3 });
});

test('DO-7 drive-off over the Time Allowed (84 s)', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'driveOff', rd(90)) },
    { name: 'B', doc: withRound(p1(151), 'driveOff', rd(92)) }
  ];
  const { places, keys } = placeAll(entries, FEI_CLASS, feiDriveOff());
  assert.equal(keys.A.penalty, 93);
  assert.equal(keys.B.penalty, 96);
  assert.deepEqual(places, { A: 1, B: 2 });
});

test('DO-8 drive-off Time Limit (2 x 84 s): eliminated in the drive-off only', () => {
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'driveOff', rd(170)) },
    { name: 'B', doc: withRound(p1(151), 'driveOff', rd(95)) }
  ];
  assert.deepEqual(placeAll(entries, FEI_CLASS, feiDriveOff()).places, { B: 1, A: 2 });
  assertTotals(FEI_CLASS, feiDriveOff(), entries, { A: 0, B: 0 });
});

test('DO-9 merged classes: drive-off qualifiers over the placing group (Q8)', () => {
  const other = 'CAI2* Singles Horse B';
  const config = { courses: { ...feiDriveOff().courses, [other]: feiDriveOff().courses[FEI_CLASS] } };
  const entries = [
    { name: 'A', doc: p1(150), className: FEI_CLASS },
    { name: 'B', doc: p1(152), className: other },
    { name: 'C', doc: p1(140, { knocks: ['1'] }), className: FEI_CLASS }
  ];
  const merged = placeAll(entries, FEI_CLASS, config, { groupOf: () => 'merged' });
  assert.deepEqual([...merged.ctx.groups.get('merged').driveOffQualifiers], ['1', '2']);
  // Per own class each would lead alone
  const perClass = placeAll(entries, FEI_CLASS, config, { groupOf: (r) => r.eq.className });
  assert.equal(perClass.ctx.pending, false);
});

test('DO-10 TR class with a drive-off: FEI mechanics as a variant, with a warning (Q7b)', () => {
  const trDriveOff = { courses: { [TR_CLASS]: { format: 'driveOff', trackLengthMeters: 600, tempo: 230, driveOff: { trackLengthMeters: 300, tempo: 230 } } } };
  const entries = [
    { name: 'A', doc: withRound(p1(150), 'driveOff', rd(75)) },
    { name: 'B', doc: withRound(p1(152.3), 'driveOff', rd(70, { knocks: ['2'] })) },
    { name: 'C', doc: p1(140, { knocks: ['1'] }) }
  ];
  const res = calculatePrecisionResult(entries[0].doc, eqOf('A', TR_CLASS), trDriveOff);
  assert.equal(res.formatUnsupported, false);
  assert.ok(res.formatWarnings.includes('trDriveOffVariant'));
  const { places, ctx } = placeAll(entries, TR_CLASS, trDriveOff);
  assert.deepEqual(places, { B: 1, A: 2, C: 3 });
  assert.ok(ctx.warnings.some((w) => w.code === 'trDriveOffVariant'));
  assertTotals(TR_CLASS, trDriveOff, entries, { A: 0, B: 0, C: 3 });
});

test('DO-11 drive-off writes touch only rounds.driveOff (the locked-result branch, Q12b)', () => {
  const fs = { arrayUnion: (v) => ({ union: v }), arrayRemove: (v) => ({ remove: v }), increment: (n) => ({ inc: n }), deleteField: () => ({ del: true }) };
  const knock = buildPrecisionKnockWrite({ round: 'driveOff', gate: '4', add: true, elapsedMs: 12000, startNumber: 1, className: FEI_CLASS, now: 5 }, fs);
  assert.deepEqual(Object.keys(knock).sort(), ['className', 'rounds', 'startNumber', 'updatedAt']);
  assert.deepEqual(Object.keys(knock.rounds), ['driveOff']);
  const start = buildPrecisionRoundStartWrite({ round: 'driveOff', startEpoch: 100, startNumber: 1, className: FEI_CLASS, now: 5 });
  assert.equal(start.activeRound, 'driveOff');
  assert.deepEqual(Object.keys(start.rounds), ['driveOff']);
});

// --- Write builders ---

test('round write builders: field paths, knocks, rebuilds, start/stop, retire, save', () => {
  const fs = { arrayUnion: (v) => ({ union: v }), arrayRemove: (v) => ({ remove: v }), increment: (n) => ({ inc: n }), deleteField: () => ({ del: true }) };
  assert.equal(precisionRoundFieldPath('phase1', 'knocks'), 'knocks');
  assert.equal(precisionRoundFieldPath('phase2', 'knocks'), 'rounds.phase2.knocks');
  assert.deepEqual(precisionRoundsForFormat('twoPhase'), ['phase1', 'phase2']);
  assert.deepEqual(precisionRoundsForFormat('driveOff'), ['phase1', 'driveOff']);
  assert.deepEqual(precisionRoundsForFormat('normal'), ['phase1']);
  assert.deepEqual(readPrecisionRound({ rounds: { phase2: { timeMs: 1 } } }, 'phase2'), { timeMs: 1 });

  const k1 = buildPrecisionKnockWrite({ round: 'phase1', gate: 3, add: true, elapsedMs: 9000, liveTotalPenalty: 3, startNumber: 7, className: 'X', now: 1 }, fs);
  assert.deepEqual(k1.knocks, { union: '3' });
  assert.equal(k1.liveTotalPenalty, 3);
  const k2 = buildPrecisionKnockWrite({ round: 'phase2', gate: '3', add: false, startNumber: 7, className: 'X', now: 1 }, fs);
  assert.deepEqual(k2.rounds.phase2.knocks, { remove: '3' });
  assert.deepEqual(k2.rounds.phase2.knockDownTimes, { 3: { del: true } });
  assert.deepEqual(k2.rounds.phase2.obstaclePenalty, { del: true });

  assert.deepEqual(buildPrecisionRebuildWrite({ round: 'phase2', delta: 1, startNumber: 7, className: 'X', now: 1 }, fs).rounds.phase2.rebuildCount, { inc: 1 });
  assert.equal(buildPrecisionRebuildWrite({ round: 'phase2', delta: -1, next: 0, startNumber: 7, className: 'X', now: 1 }, fs).rounds.phase2.rebuildCount, 0);

  const stop = buildPrecisionRoundStopWrite({ round: 'phase2', elapsedMs: 61234, startNumber: 7, className: 'X', now: 1 });
  assert.equal(stop.rounds.phase2.running, false);
  assert.equal(stop.rounds.phase2.livePausedMs, 61234);
  const retire = buildPrecisionRoundRetireWrite({ round: 'driveOff', startNumber: 7, className: 'X', now: 1 });
  assert.equal(retire.rounds.driveOff.retired, true);

  // A phase-2 save scores phase 2 and nests the payload
  const eq = eqOf('A', TR_CLASS);
  const stored = withRound(p1(150), 'phase2', { knocks: ['2'], rebuildCount: 1 });
  const calculate = (data) => calculatePrecisionRoundResult(data, eq, trTwoPhase, 'phase2');
  const { payload } = buildPrecisionSavePayload({ stored, timeMs: 68000, startNumber: 1, className: TR_CLASS, calculate, now: 2, round: 'phase2' });
  assert.deepEqual(Object.keys(payload).sort(), ['className', 'rounds', 'startNumber', 'updatedAt']);
  assert.equal(payload.rounds.phase2.totalPenalty, 4.5);
  assert.equal(payload.rounds.phase2.status, 'Klar');
  // Another device added a knock meanwhile: the correction is nested too
  const after = withRound(p1(150), 'phase2', { ...payload.rounds.phase2, knocks: ['2', '5'], rebuildCount: 1 });
  const fix = penaltyCorrection(payload, ['2'], after, calculate, 1, 'phase2');
  assert.equal(fix.rounds.phase2.totalPenalty, 7.5);
});

test('phase-1 finish line: clear phase 1 starts phase 2 in the same write', () => {
  const eq = eqOf('A', TR_CLASS);
  const calculate = (data) => calculatePrecisionResult(data, eq, trTwoPhase);
  const w = buildPhase1FinishWrite({ stored: {}, splitMs: 150000, splitEpoch: 777, startNumber: 1, className: TR_CLASS, calculate, now: 9 });
  assert.equal(w.qualified, true);
  assert.equal(w.payload.running, false);
  assert.equal(w.payload.timeMs, 150000);
  assert.equal(w.payload.activeRound, 'phase2');
  assert.deepEqual(w.payload.rounds.phase2, { running: true, inProgress: true, liveStartEpoch: 777, livePausedMs: 0, liveTimeMs: 0, status: 'Pågår', updatedAt: 9 });
  // The written doc is phase 1 'Klar' and qualified; phase 2 ticks live
  const res = calculatePrecisionLiveResult(w.payload, eq, trTwoPhase, {}, 777 + 30000);
  assert.equal(res.phase2Qualified, true);
  assert.equal(res.rounds.phase2.elapsedMs, 30000);
  assert.equal(res.placing.stage, 'phase2Live');
  assert.equal(precisionRankKey(res, { requireFinished: true }), null);
  assert.equal(canStartPrecisionRound(res, 'phase2').ok, true);
  // Not clear (a knock in phase 1): phase 1 saved only
  const knocked = buildPhase1FinishWrite({ stored: { knocks: ['1'] }, splitMs: 150000, startNumber: 1, className: TR_CLASS, calculate, now: 9 });
  assert.equal(knocked.qualified, false);
  assert.equal(knocked.payload.activeRound, undefined);
});

// --- 5.4 Invariants ---

const SNAPSHOT_EQ = { startNumber: 1, className: 'MSV Enbet Häst' };
const SNAPSHOT_CONFIG = { courses: { 'MSV Enbet Häst': { trackLengthMeters: 600, tempo: 230 } } };
const SNAPSHOT_DOCS = [
  {},
  { finalized: true, timeMs: 150000, knocks: [] },
  { finalized: true, timeMs: 158000, knocks: ['3'], rebuildCount: 1, extraPenalty: 5 },
  { running: true, liveTimeMs: 40000, knocks: ['1'] },
  { eliminated: true, timeMs: 100000, liveTimeMs: 100000 },
  { timeMs: 320000, liveTimeMs: 320000 }
];
// The engine's output before the rounds (RESULT_ENGINE_VERSION 2026-10-19.1)
const SNAPSHOT = [{"finalized":false,"eliminated":false,"autoEliminated":false,"running":false,"status":"Ej startat","timeMs":null,"drivenTimeMs":null,"rebuildCount":0,"addedTimeMs":0,"liveMs":null,"finalMs":null,"ruleProfile":"TR","precisionFormat":"normal","formatUnsupported":false,"formatExcludesTotal":false,"timeDiffFromAllowed":null,"maxTimeSec":157,"timePenaltyRate":0.5,"timePenaltyOverride":false,"configMissing":false,"isClearRound":false,"knocks":[],"knockDownTimes":{},"knocksCount":0,"obstaclePenalty":null,"timePenalty":null,"extraPenalty":null,"totalPenalty":null},{"finalized":true,"eliminated":false,"autoEliminated":false,"running":false,"status":"Klar","timeMs":150000,"drivenTimeMs":150000,"rebuildCount":0,"addedTimeMs":0,"liveMs":null,"finalMs":150000,"ruleProfile":"TR","precisionFormat":"normal","formatUnsupported":false,"formatExcludesTotal":false,"timeDiffFromAllowed":7000,"maxTimeSec":157,"timePenaltyRate":0.5,"timePenaltyOverride":false,"configMissing":false,"isClearRound":false,"knocks":[],"knockDownTimes":{},"knocksCount":0,"obstaclePenalty":null,"timePenalty":0,"extraPenalty":null,"totalPenalty":0},{"finalized":true,"eliminated":false,"autoEliminated":false,"running":false,"status":"Klar","timeMs":168000,"drivenTimeMs":158000,"rebuildCount":1,"addedTimeMs":10000,"liveMs":null,"finalMs":158000,"ruleProfile":"TR","precisionFormat":"normal","formatUnsupported":false,"formatExcludesTotal":false,"timeDiffFromAllowed":11000,"maxTimeSec":157,"timePenaltyRate":0.5,"timePenaltyOverride":false,"configMissing":false,"isClearRound":false,"knocks":["3"],"knockDownTimes":{},"knocksCount":1,"obstaclePenalty":3,"timePenalty":5.5,"extraPenalty":5,"totalPenalty":13.5},{"finalized":false,"eliminated":false,"autoEliminated":false,"running":true,"status":"Pågår","timeMs":40000,"drivenTimeMs":40000,"rebuildCount":0,"addedTimeMs":0,"liveMs":40000,"finalMs":null,"ruleProfile":"TR","precisionFormat":"normal","formatUnsupported":false,"formatExcludesTotal":false,"timeDiffFromAllowed":117000,"maxTimeSec":157,"timePenaltyRate":0.5,"timePenaltyOverride":false,"configMissing":false,"isClearRound":false,"knocks":["1"],"knockDownTimes":{},"knocksCount":1,"obstaclePenalty":3,"timePenalty":0,"extraPenalty":null,"totalPenalty":3},{"finalized":false,"eliminated":true,"autoEliminated":false,"running":false,"status":"Utesluten","timeMs":100000,"drivenTimeMs":100000,"rebuildCount":0,"addedTimeMs":0,"liveMs":100000,"finalMs":100000,"ruleProfile":"TR","precisionFormat":"normal","formatUnsupported":false,"formatExcludesTotal":false,"timeDiffFromAllowed":57000,"maxTimeSec":157,"timePenaltyRate":0.5,"timePenaltyOverride":false,"configMissing":false,"isClearRound":false,"knocks":[],"knockDownTimes":{},"knocksCount":0,"obstaclePenalty":null,"timePenalty":0,"extraPenalty":null,"totalPenalty":0},{"finalized":false,"eliminated":true,"autoEliminated":true,"running":false,"status":"Utesluten","timeMs":320000,"drivenTimeMs":320000,"rebuildCount":0,"addedTimeMs":0,"liveMs":320000,"finalMs":320000,"ruleProfile":"TR","precisionFormat":"normal","formatUnsupported":false,"formatExcludesTotal":false,"timeDiffFromAllowed":163000,"maxTimeSec":157,"timePenaltyRate":0.5,"timePenaltyOverride":false,"configMissing":false,"isClearRound":false,"knocks":[],"knockDownTimes":{},"knocksCount":0,"obstaclePenalty":null,"timePenalty":81.5,"extraPenalty":null,"totalPenalty":81.5}];

test('invariant: a normal doc without rounds gives the same result as before', () => {
  SNAPSHOT_DOCS.forEach((doc, i) => {
    const now = JSON.parse(JSON.stringify(calculatePrecisionResult(doc, SNAPSHOT_EQ, SNAPSHOT_CONFIG)));
    for (const key of Object.keys(SNAPSHOT[i])) assert.deepEqual(now[key], SNAPSHOT[i][key], `doc ${i} ${key}`);
    assert.equal(now.rounds.phase2, null);
    assert.equal(now.rounds.driveOff, null);
    // The rank key keeps the old shape
    const r = calculatePrecisionResult(doc, SNAPSHOT_EQ, SNAPSHOT_CONFIG);
    const key = precisionRankKey(r);
    if (key) assert.deepEqual(Object.keys(key).sort(), ['penalty', 'timeMs']);
  });
});

test('invariant: a two-phase doc without rounds keeps its phase-1 result', () => {
  const normal = { courses: { [TR_CLASS]: { trackLengthMeters: 600, tempo: 230 } } };
  for (const doc of [p1(150, { knocks: ['1'] }), p1(158), p1(150), p1(120, { eliminated: true })]) {
    const a = calculatePrecisionResult(doc, eqOf('A', TR_CLASS), normal);
    const b = calculatePrecisionResult(doc, eqOf('A', TR_CLASS), trTwoPhase);
    for (const key of ['totalPenalty', 'timeMs', 'status', 'eliminated', 'obstaclePenalty', 'timePenalty']) assert.deepEqual(b[key], a[key], key);
    const tier = b.placing.tier;
    if (b.eliminated) assert.equal(tier, null);
    else if (b.totalPenalty === 0) assert.equal(tier, 3); // finalized, did not continue
    else assert.equal(tier, 4);
  }
});

test('invariant: keys without a tier compare as before', () => {
  assert.ok(comparePrecisionRank({ penalty: 0, timeMs: 140000 }, { penalty: 0, timeMs: 141000 }) < 0);
  assert.ok(comparePrecisionRank({ penalty: 3, timeMs: 100000 }, { penalty: 0, timeMs: 141000 }) > 0);
  assert.equal(comparePrecisionRank({ penalty: 0, timeMs: 140000 }, { penalty: 0, timeMs: 140000 }), 0);
  assert.equal(comparePrecisionRank({ penalty: 0, timeMs: 140000 }, { tier: 4, penalty: 0, timeMs: 140000 }), 0);
  // Tiers before penalties
  assert.ok(comparePrecisionRank({ tier: 2, penalty: 6, timeMs: 72000 }, { penalty: 0, timeMs: 100000 }) < 0);
  assert.ok(comparePrecisionRank({ tier: 0, penalty: 73, timeMs: null, penaltySec: 0 }, { tier: 0, penalty: 73, timeMs: null, penaltySec: 3 }) < 0);
});

test('the Cloud Function engine copy scores and places the rounds alike', () => {
  const entries = [
    { name: 'A', doc: withRound(initialDO1.A, 'driveOff', rd(75)) },
    { name: 'B', doc: withRound(initialDO1.B, 'driveOff', rd(70, { knocks: ['2'] })) },
    { name: 'C', doc: withRound(initialDO1.C, 'driveOff', rd(72, { rebuilds: 1, knocks: ['3'] })) }
  ];
  for (const e of entries) {
    const a = calculatePrecisionResult(e.doc, eqOf(e.name, FEI_CLASS), feiDriveOff());
    const b = serverPrecision(e.doc, eqOf(e.name, FEI_CLASS), feiDriveOff());
    assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
  }
  const rows = entries.map((e) => ({ startNumber: NAMES.indexOf(e.name) + 1, r: serverPrecision(e.doc, eqOf(e.name, FEI_CLASS), feiDriveOff()) }));
  const ctx = serverGroupContext(rows, (row) => row.r);
  assert.equal(ctx.groups.get('').driveOffComplete, true);
});

// --- Call sites: result-based keys ---

test('call sites place two phases and drive-off by tiers (place map, archive, total page, live rank)', async () => {
  const { buildPrecisionPlaceInfo, buildPlaceMap } = await import('../js/utils/precisionUtils.js');
  const { buildArchiveRowsFromData } = await import('../js/services/archiveRowBuilder.js');
  const { applyTotalDisciplinePlacements } = await import('../js/pages/shared/totalResultRanking.js');
  const { calculatePrecisionLiveRank } = await import('../js/pages/precision/precisionResultLive.js');

  // TR2-1 through the result page's place map
  const docs = {
    1: withRound(p1(150), 'phase2', rd(70)),
    2: withRound(p1(145), 'phase2', rd(65, { knocks: ['3'] })),
    3: p1(140, { knocks: ['5'] }),
    4: p1(158)
  };
  const equipages = [1, 2, 3, 4].map((n) => ({ startNumber: n, className: TR_CLASS }));
  const map = new Map(Object.entries(docs));
  const places = buildPlaceMap(equipages, map, trTwoPhase);
  assert.deepEqual([...places.entries()], [['1', 1], ['2', 2], ['3', 4], ['4', 3]]);

  // DO-6 pending: provisional places 1..k
  const pendingMap = new Map([['1', p1(150)], ['2', p1(151)], ['3', p1(140, { knocks: ['1'] })]]);
  const fei = [1, 2, 3].map((n) => ({ startNumber: n, className: FEI_CLASS }));
  const info = buildPrecisionPlaceInfo(fei, pendingMap, feiDriveOff());
  assert.deepEqual([...info.provisional].sort(), ['1', '2']);
  assert.equal(info.context.pending, true);

  // Archive: posPrec by tiers, pen stays phase 1
  const rows = buildArchiveRowsFromData({
    equipages,
    precisionRows: Object.entries(docs).map(([sn, d]) => ({ startNumber: sn, ...d })),
    precisionConfig: trTwoPhase
  });
  const bySn = Object.fromEntries(rows.map((r) => [r.startNumber, r]));
  assert.deepEqual([1, 2, 3, 4].map((n) => bySn[n].posPrec), [1, 2, 4, 3]);
  assert.deepEqual([1, 2, 3, 4].map((n) => bySn[n].precision.pen), [0, 0, 3, 0.5]);
  assert.equal(bySn[2].precision.rounds.phase2.totalPenalty, 3);

  // Total page discipline position from the engine's precision result
  const totalRows = equipages.map((eq) => {
    const precision = calculatePrecisionResult(docs[eq.startNumber], eq, trTwoPhase);
    return { startNumber: eq.startNumber, className: TR_CLASS, precision: { ...precision, pen: precision.totalPenalty } };
  });
  applyTotalDisciplinePlacements(totalRows);
  assert.deepEqual(totalRows.map((r) => r.posPrec), [1, 2, 4, 3]);

  // Live rank of an equipage driving phase 2: among the phase-2 drivers
  const running = { ...p1(149), rounds: { phase2: { running: true, inProgress: true, liveStartEpoch: 1000, livePausedMs: 0 } }, activeRound: 'phase2' };
  const liveMap = new Map([['1', docs[1]], ['3', docs[3]], ['5', running]]);
  const all = [{ startNumber: 1, className: TR_CLASS }, { startNumber: 3, className: TR_CLASS }, { startNumber: 5, className: TR_CLASS }];
  // 60 s into phase 2 with 0 penalties: ahead of #1 (70 s), and of #3
  assert.equal(calculatePrecisionLiveRank(0, 5, all[2], all, liveMap, null, { config: trTwoPhase, currentTimeMs: 149000, now: 61000 }), 1);
});