import test from 'node:test';
import assert from 'node:assert/strict';

import { dressagePrograms } from '../js/data/dressagePrograms.js';
import { getPrograms, mergeCompetitionPrograms, normalizeProgramMapping } from '../js/utils/dressageUtils.js';
import { calculateTotalResult } from '../js/services/calculationService.js';
import { setCompetitionSetting } from '../js/services/competitionSettingsStore.js';
import { buildTotalResultRow } from '../js/pages/shared/totalResultRows.js';
import { resolveTotalMergeGrouping } from '../js/pages/shared/totalResultGrouping.js';
import { buildPublicMergeMap } from '../js/services/publicCompetitionUtils.js';

// A competition's own program (config/dressagePrograms): max 2*10 + 10 = 30 points
const customProgram = {
  name: 'Eget program 2026',
  penaltyCoeff: 0.5,
  movements: [
    { no: 1, text: 'Inkörning', coeff: 2 },
    { no: 2, text: 'Hållning', coeff: 1 }
  ]
};
const ownPrograms = { egen_2026: customProgram };

// Scores 7 (x2) and 6 = 20 of 30 points: 66.67 %, penalty (30 - 20) * 0.5 = 5
const protocols = [
  { judgeId: 'c', testKey: 'egen_2026', movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 6 }] }
];

test('mergeCompetitionPrograms puts the competition programs over the built-in ones, as the Cloud Function', () => {
  const merged = mergeCompetitionPrograms({ ...ownPrograms, SvLA: customProgram });

  assert.equal(merged.egen_2026, customProgram);
  assert.equal(merged.SvLA, customProgram);
  assert.equal(merged.SvLB, dressagePrograms.SvLB);
  // The built-in list is shared by every competition and never changed
  assert.notEqual(dressagePrograms.SvLA, customProgram);
  assert.equal(dressagePrograms.egen_2026, undefined);
});

test('mergeCompetitionPrograms ignores a missing or malformed config', () => {
  assert.deepEqual(Object.keys(mergeCompetitionPrograms(null)), Object.keys(dressagePrograms));
  assert.deepEqual(Object.keys(mergeCompetitionPrograms([])), Object.keys(dressagePrograms));
  assert.deepEqual(mergeCompetitionPrograms({ a: 1 }, { b: 2 }), { b: 2, a: 1 });
});

test('normalizeProgramMapping reads the flat and the nested .mapping shape', () => {
  assert.deepEqual(normalizeProgramMapping({ 'Lätt A': 'SvLA' }), { 'Lätt A': 'SvLA' });
  assert.deepEqual(normalizeProgramMapping({ mapping: { 'Lätt A': 'SvLA' } }), { 'Lätt A': 'SvLA' });
  assert.deepEqual(normalizeProgramMapping(null), {});
});

test('total results row: a custom program gives its own percentage and penalty', () => {
  const row = buildTotalResultRow({
    equipage: { startNumber: 1, className: 'Egen klass', errorPoints: 0 },
    rawProtocols: protocols,
    allPrograms: mergeCompetitionPrograms(ownPrograms),
    calculateTotalResult,
    resolveMergeGrouping: resolveTotalMergeGrouping
  });

  assert.equal(row.dressage.percentAvg, 66.67);
  assert.equal(row.dressage.penalty, 5);
});

test('total results row: without the competition programs the result is from another program (the bug)', () => {
  const row = buildTotalResultRow({
    equipage: { startNumber: 1, className: 'Egen klass', errorPoints: 0 },
    rawProtocols: protocols,
    allPrograms: mergeCompetitionPrograms(null),
    calculateTotalResult,
    resolveMergeGrouping: resolveTotalMergeGrouping
  });

  // The engine falls back to a built-in program guessed from the class name
  assert.notEqual(row.dressage.percentAvg, 66.67);
  assert.notEqual(row.dressage.penalty, 5);
});

test('prize giving path: the stored programs and class mapping reach the result engine', () => {
  // A built-in key overridden with fewer movements (max 30 instead of 160)
  // and a class mapped to it; the protocol names no program
  setCompetitionSetting('comp-1', 'dressagePrograms', mergeCompetitionPrograms({ SvLA: customProgram }));
  setCompetitionSetting('comp-1', 'klassProgramMapping', normalizeProgramMapping({ mapping: { 'Lätt A': 'SvLA' } }));

  const res = calculateTotalResult(
    { startNumber: 2, className: 'Lätt A', errorPoints: 0 },
    [{ judgeId: 'c', movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 6 }] }],
    { obstacleData: {}, timeData: {} },
    {},
    { allPrograms: getPrograms() }
  );

  assert.equal(getPrograms().SvLA, customProgram);
  assert.equal(res.dressage.percent, 66.67);
  assert.equal(res.dressage.judgePenalty, 5);
});

test('resolveTotalMergeGrouping reads every merge source shape pickMergeSource returns', () => {
  const eq = { tdbClassNumber: 6, className: 'Lätt B' };

  // Legacy document with the groups at the top level
  assert.deepEqual(resolveTotalMergeGrouping(eq, { g1: { label: 'Lätt A+B', members: ['5', '6'] } }), {
    key: 'g1',
    label: 'Lätt A+B'
  });
  // Legacy array shape
  assert.deepEqual(resolveTotalMergeGrouping(eq, [[6, 5], [9]]), {
    key: 'TDBGROUP:5+6',
    label: 'Sammanslagen: TDB #5/6'
  });
  // Not in any group
  assert.deepEqual(resolveTotalMergeGrouping({ className: 'Lätt B' }, [[5, 6]]), {
    key: 'CLASS:Lätt B',
    label: 'Lätt B'
  });
});

test('buildPublicMergeMap reads the legacy array shape as the result pages do', () => {
  const map = buildPublicMergeMap([[6, 5]]);
  assert.deepEqual(map.get(5), { key: 'TDBGROUP:5+6', label: 'Sammanslagen: TDB #5/6' });
  assert.deepEqual(map.get(6), { key: 'TDBGROUP:5+6', label: 'Sammanslagen: TDB #5/6' });
});
