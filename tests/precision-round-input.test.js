import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQualifiedSummary,
  driveOffStartList,
  phase2QualificationChange,
  pickPrecisionRound,
  precisionGroupKeyFn,
  precisionRoundLabelKey,
  precisionWarningKey,
  roundOnSelect,
} from '../js/pages/precision/precisionRoundInput.js';
import { calculatePrecisionResult } from '../js/utils/precisionCalculation.js';
import { precisionGroupContext } from '../js/core-engine/ranking.js';

const TWO_PHASE = 'CAI2* Singles Horse';
const config = {
  courses: {
    [TWO_PHASE]: { format: 'twoPhase', trackLengthMeters: 650, tempo: 250, obstacleLabels: ['1', '2'], phase2: { trackLengthMeters: 300, tempo: 250, obstacleLabels: ['A', 'B'] } },
    'CAI3* Pairs Horse': { format: 'driveOff', trackLengthMeters: 650, tempo: 250, obstacleLabels: ['1', '2'] },
  },
};
const eq = (startNumber, className, driverName = `Kusk ${startNumber}`) => ({ startNumber, className, driverName });
const clearPhase1 = { status: 'Klar', timeMs: 150000, liveTimeMs: 150000, finalized: false, running: false };

test('round labels follow the format', () => {
  assert.equal(precisionRoundLabelKey('phase1', 'twoPhase'), 'precision_round_phase1');
  assert.equal(precisionRoundLabelKey('phase1', 'driveOff'), 'precision_round_initial');
  assert.equal(precisionRoundLabelKey('phase2', 'twoPhase'), 'precision_round_phase2');
  assert.equal(precisionRoundLabelKey('driveOff', 'driveOff'), 'precision_round_driveoff');
  assert.equal(precisionWarningKey('notQualified'), 'precision_warn_notQualified');
});

test('pickPrecisionRound: a running round wins, else the current one, else phase 1', () => {
  const rounds = ['phase1', 'phase2'];
  assert.equal(pickPrecisionRound(null, rounds, 'phase1'), 'phase1');
  assert.equal(pickPrecisionRound({}, rounds, 'phase2'), 'phase2');
  assert.equal(pickPrecisionRound({ rounds: { phase2: { running: true } } }, rounds, 'phase1'), 'phase2');
  // The class has no drive-off: a leftover current round is dropped
  assert.equal(pickPrecisionRound({}, rounds, 'driveOff'), 'phase1');
  assert.equal(pickPrecisionRound({ rounds: { driveOff: { running: true } } }, rounds, 'phase1'), 'phase1');
  assert.equal(pickPrecisionRound({ rounds: { driveOff: { running: true } } }, ['phase1', 'driveOff'], 'phase1'), 'driveOff');
});

test('pickPrecisionRound: a reload mid-round opens that round, not phase 1', () => {
  const rounds = ['phase1', 'phase2'];
  // Phase 2 stopped but not saved
  assert.equal(pickPrecisionRound({ activeRound: 'phase2', rounds: { phase2: { running: false, inProgress: true } } }, rounds, 'phase1'), 'phase2');
  // Only activeRound says where the equipage is
  assert.equal(pickPrecisionRound({ activeRound: 'phase2', rounds: { phase2: { inProgress: false, timeMs: 70000 } } }, rounds, 'phase1'), 'phase2');
  // An unsaved round without activeRound (older write)
  assert.equal(pickPrecisionRound({ rounds: { phase2: { inProgress: true } } }, rounds, 'phase1'), 'phase2');
  // Phase 1 driven again (phase 2 cleared, activeRound back to phase 1)
  assert.equal(pickPrecisionRound({ running: true, activeRound: 'phase1' }, rounds, 'phase2'), 'phase1');
  // activeRound phase 1 keeps the drive-off the judge works in
  assert.equal(pickPrecisionRound({ activeRound: 'phase1' }, ['phase1', 'driveOff'], 'driveOff'), 'driveOff');
  // A round the class does not have is never picked
  assert.equal(pickPrecisionRound({ activeRound: 'driveOff' }, rounds, 'phase1'), 'phase1');
});

test('roundOnSelect: the next equipage starts in phase 1, a drive-off qualifier stays in the drive-off', () => {
  assert.equal(roundOnSelect('phase2', ['phase1', 'phase2']), 'phase1');
  assert.equal(roundOnSelect('driveOff', ['phase1', 'driveOff'], { isDriveOffQualifier: true }), 'driveOff');
  assert.equal(roundOnSelect('driveOff', ['phase1', 'driveOff'], { isDriveOffQualifier: false }), 'phase1');
  assert.equal(roundOnSelect('driveOff', ['phase1'], { isDriveOffQualifier: true }), 'phase1');
  assert.equal(roundOnSelect('phase1', ['phase1', 'phase2']), 'phase1');
});

test('qualified summary and drive-off start list from the engine', () => {
  const rows = [
    eq(1, TWO_PHASE), eq(2, TWO_PHASE), eq(3, TWO_PHASE),
    eq(11, 'CAI3* Pairs Horse'), eq(12, 'CAI3* Pairs Horse'), eq(13, 'CAI3* Pairs Horse'),
  ];
  const docs = new Map([
    ['1', { ...clearPhase1 }],                                  // clear: qualified for phase 2
    ['2', { ...clearPhase1, knocks: ['1'] }],                   // one knock: not qualified
    ['3', { ...clearPhase1, rounds: { phase2: { running: true, liveTimeMs: 1000 } } }], // in phase 2
    ['11', { ...clearPhase1, timeMs: 152000, liveTimeMs: 152000 }],
    ['12', { ...clearPhase1, timeMs: 155000, liveTimeMs: 155000 }],
    ['13', { ...clearPhase1, knocks: ['2'] }],
  ]);
  const resultOf = (r) => calculatePrecisionResult(docs.get(String(r.startNumber)) || {}, r, config);
  const ctx = precisionGroupContext(rows, resultOf, (r) => `CLASS:${r.className}`, { requireFinished: true });
  const startTimes = { 12: { precision: '09:00' }, 11: { precision: '10:00' } };

  const summary = buildQualifiedSummary(rows, resultOf, ctx.groups, startTimes);
  assert.deepEqual(summary.phase2.map((m) => [m.startNumber, m.state]), [[1, 'waiting'], [3, 'live']]);
  assert.equal(summary.driveOff.length, 1);
  assert.equal(summary.driveOff[0].complete, false);
  // Drive-off qualifiers are the equal best penalties (11 and 12), in start order (12 first)
  assert.deepEqual(summary.driveOff[0].members.map((m) => m.startNumber), [12, 11]);

  assert.deepEqual(driveOffStartList(rows, ctx.groups, startTimes).map((e) => e.startNumber), [12, 11]);
});

test('phase2QualificationChange tells when a phase-1 correction changes who qualified', () => {
  const eqp = eq(1, TWO_PHASE);
  const before = calculatePrecisionResult({ ...clearPhase1 }, eqp, config);
  const after = calculatePrecisionResult({ ...clearPhase1, knocks: ['1'] }, eqp, config);
  assert.equal(before.phase2Qualified, true);
  assert.equal(after.phase2Qualified, false);
  assert.deepEqual(phase2QualificationChange(before, after), { before: true, after: false, hasPhase2Data: false });
  assert.equal(phase2QualificationChange(before, before), null);
  // Not a two-phase class: nothing to warn about
  const normal = calculatePrecisionResult({ ...clearPhase1 }, eq(5, 'LÃ¤tt A'), {});
  assert.equal(phase2QualificationChange(normal, normal), null);
});

test('drive-off qualifiers are drawn across a merged placing group', () => {
  const A = 'CAI3* Pairs Horse';
  const B = 'CAI3* Pairs Pony';
  const cfg = { courses: {
    [A]: { format: 'driveOff', trackLengthMeters: 650, tempo: 250, obstacleLabels: ['1'] },
    [B]: { format: 'driveOff', trackLengthMeters: 650, tempo: 250, obstacleLabels: ['1'] }
  } };
  const rows = [
    { ...eq(21, A), tdbClassNumber: 7 },
    { ...eq(22, B), tdbClassNumber: 8 },
    { ...eq(23, B), tdbClassNumber: 8 }
  ];
  // 21 (class A) and 22 (class B) are clear, 23 has a knock
  const docs = new Map([['21', { ...clearPhase1 }], ['22', { ...clearPhase1 }], ['23', { ...clearPhase1, knocks: ['1'] }]]);
  const resultOf = (r) => calculatePrecisionResult(docs.get(String(r.startNumber)), r, cfg);

  // Separate classes: no group has two clear equipages, so no drive-off
  const plain = precisionGroupContext(rows, resultOf, precisionGroupKeyFn(null), { requireFinished: true });
  assert.equal(plain.pending, false);

  // Merged (TDB 7 + 8): one group, the two clear equipages drive off across the classes
  const merged = precisionGroupContext(rows, resultOf, precisionGroupKeyFn({ mergeByClassNumber: { G: { members: [7, 8] } } }), { requireFinished: true });
  assert.equal(merged.groups.size, 1);
  assert.deepEqual(driveOffStartList(rows, merged.groups).map((e) => e.startNumber), [21, 22]);
  assert.equal(merged.pending, true);
});
