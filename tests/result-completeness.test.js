import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompetitionState } from '../js/core-engine/stateSelector.js';
import { calculateDressageResult, getClassJudgeAssignments } from '../js/core-engine/dressage.js';
import { calculateMarathonResult } from '../js/core-engine/marathon.js';
import { calculateTotalResult } from '../js/core-engine/calculation.js';
import { buildRecalculationValidation } from '../functions/src/resultRecalculationUtils.js';

// A result is only complete (and gets a total) when nothing it depends on is missing:
// every judge assigned to the class, and the marathon settings for the class.

const allPrograms = {
  LA: { id: 'LA', name: 'Svenskt Lätt A', movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }] }
};
const judgeMapping = { '2. Lätt A Enbet Ponny': { C: 'judge-c', E: 'judge-e', M: '' } };

const marathonConfig = {
  marathonClassData: {
    '2. Lätt A Enbet Ponny': { distanceA: 5000, tempoA: 250, distanceB: 6000, tempoB: 250 }
  }
};

const protocol = (judgeId, position, scores) => ({
  id: `judge_${judgeId}`, judgeId, position, testKey: 'LA',
  movements: scores.map((score, i) => ({ momentNo: i + 1, score }))
});

// Finished marathon: A and B stopped inside the time window, obstacle 1 driven
const finishedMarathon = {
  start_A: 1_000_000, finish_A: 1_000_000 + 1_200_000,
  start_B: 3_000_000, finish_B: 3_000_000 + 1_440_000,
  obstacles: [{ number: 1, timeSec: 40 }]
};
const finishedPrecision = { finalized: true, timeMs: 90_000, obstaclePenalty: 0 };

function state({ protocols = [], marathon = finishedMarathon, marCfg = marathonConfig, judges = judgeMapping } = {}) {
  return buildCompetitionState(
    { startNumber: 7, className: '2.Lätt A Enbet Ponny', testKey: 'LA' },
    protocols, marathon, marathon, finishedPrecision,
    { allPrograms, marathonConfig: marCfg, dressageJudgeMapping: judges, precisionConfig: {} }
  );
}

test('judge mapping lookup ignores spacing and case in the class name and skips empty positions', () => {
  assert.deepEqual(getClassJudgeAssignments('2.lätt a enbet ponny', judgeMapping), { C: 'judge-c', E: 'judge-e' });
  assert.deepEqual(getClassJudgeAssignments('2.Lätt A Enbet Ponny', { mapping: judgeMapping }), { C: 'judge-c', E: 'judge-e' });
  assert.deepEqual(getClassJudgeAssignments('Okänd klass', judgeMapping), {});
});

test('dressage is not complete, and there is no total, until every assigned judge has a full protocol', () => {
  const onlyC = calculateTotalResult(state({ protocols: [protocol('judge-c', 'C', [7, 8])] }));
  assert.equal(onlyC.marathonComplete, true, 'marathon itself is finished');
  assert.equal(onlyC.precisionComplete, true, 'precision itself is finished');
  assert.ok(Number.isFinite(onlyC.dressagePenalty), 'the provisional dressage penalty is still shown');
  assert.deepEqual(onlyC.dressage.missingJudgePositions, ['E']);
  assert.equal(onlyC.dressageComplete, false);
  assert.equal(onlyC.totalPenalty, null);
  assert.equal(onlyC.isOngoing, true);

  // E has started but not scored every movement
  const partialE = calculateDressageResult(state({
    protocols: [protocol('judge-c', 'C', [7, 8]), protocol('judge-e', 'E', [6])]
  }));
  assert.deepEqual(partialE.missingJudgePositions, ['E']);

  // Matched by the assigned judge's id even without a stored position
  const both = calculateTotalResult(state({
    protocols: [protocol('judge-c', 'C', [7, 8]), protocol('judge-e', '', [6, 7])]
  }));
  assert.deepEqual(both.dressage.missingJudgePositions, []);
  assert.equal(both.dressageComplete, true);
  assert.ok(Number.isFinite(both.totalPenalty));
});

test('without a judge mapping for the class the received protocols decide, as before', () => {
  const r = calculateTotalResult(state({ protocols: [protocol('judge-c', 'C', [7, 8])], judges: {} }));
  assert.deepEqual(r.dressage.expectedJudgePositions, []);
  assert.equal(r.dressageComplete, true);
  assert.ok(Number.isFinite(r.totalPenalty));
});

test('a marathon without class settings gets no result and never becomes Klar', () => {
  const ok = calculateMarathonResult(state());
  assert.equal(ok.configMissing, false);
  assert.equal(ok.status, 'Klar');
  assert.ok(Number.isFinite(ok.totalPenalty));

  const noClass = calculateMarathonResult(state({ marCfg: { marathonClassData: {} } }));
  assert.equal(noClass.configMissing, true);
  assert.deepEqual(noClass.missingConfig, ['class']);
  assert.equal(noClass.totalPenalty, null);
  assert.notEqual(noClass.status, 'Klar');

  const finalized = calculateMarathonResult(state({ marCfg: {}, marathon: { ...finishedMarathon, finalized: true } }));
  assert.notEqual(finalized.status, 'Klar', 'finalizing does not make a result without settings complete');

  // Class found, but no ideal time for B
  const noB = calculateMarathonResult(state({
    marCfg: { marathonClassData: { '2. Lätt A Enbet Ponny': { distanceA: 5000, tempoA: 250 } } }
  }));
  assert.deepEqual(noB.missingConfig, ['B']);
  assert.equal(noB.totalPenalty, null);

  const total = calculateTotalResult(state({ marCfg: {}, protocols: [protocol('judge-c', 'C', [7, 8]), protocol('judge-e', 'E', [6, 7])] }));
  assert.equal(total.marathonComplete, false);
  assert.equal(total.totalPenalty, null);
});

test('an equipage without any marathon data is not reported as missing settings', () => {
  const r = calculateMarathonResult(state({ marCfg: {}, marathon: {} }));
  assert.equal(r.configMissing, false);
  assert.equal(r.status, 'Ej startat');
});

test('recalculation validation warns about results the settings cannot support', () => {
  const noMarathonSettings = calculateTotalResult(state({ marCfg: {} }));
  const noCourse = calculateTotalResult(state());
  const validation = buildRecalculationValidation([
    { startNumber: '7', equipage: { className: '2.Lätt A Enbet Ponny' }, result: noMarathonSettings },
    { startNumber: '8', equipage: { className: '2.Lätt A Enbet Ponny' }, result: noCourse }
  ], { allPrograms });

  assert.equal(validation.criticalErrors.length, 0);
  const messages = validation.warnings.map(w => `${w.startNumber}: ${w.message}`);
  assert.ok(messages.some(m => m.startsWith('7: Maratonresultatet kan inte räknas')), messages.join('\n'));
  assert.ok(messages.some(m => m.startsWith('8: Precisionsbana saknas')), messages.join('\n'));
});
