import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecalculationValidation,
  competitionReopened,
  configChangeAffectsResults,
  resolveRecalculationProgramKey,
  resultSettingsFingerprint,
  ruleSettingsChanged
} from '../functions/src/resultRecalculationUtils.js';
import { findProgramKey } from '../functions/src/core-engine/dressage.js';

test('reopening an archived competition recalculates it; other writes do not', () => {
  assert.equal(competitionReopened({ locked: true, status: 'completed' }, { locked: false, status: 'active' }), true);
  assert.equal(competitionReopened({ locked: true }, { locked: false }), true);
  assert.equal(competitionReopened({ locked: false }, { locked: false, name: 'x' }), false);
  assert.equal(competitionReopened({ locked: false }, { locked: true }), false);
  assert.equal(competitionReopened(null, { locked: false }), false);
});

const context = {
  allPrograms: {
    SvLB: { name: 'Lätt B' },
    CUSTOM: { name: 'Anpassat program' }
  },
  dressageProgramMapping: {
    Specialklass: 'CUSTOM'
  }
};

test('recalculation program resolution prefers protocol and supports class mapping', () => {
  assert.equal(resolveRecalculationProgramKey({
    equipage: { className: 'Specialklass', testKey: 'missing' },
    dressageProtocols: [{ testKey: 'SvLB' }]
  }, context), 'SvLB');

  assert.equal(resolveRecalculationProgramKey({
    equipage: { className: 'Specialklass' },
    dressageProtocols: []
  }, context), 'CUSTOM');
});

test('config writes that change results trigger a recalculation, others do not', () => {
  const cfg = { marathonClassData: { A: { distanceB: 6000, tempoB: 250 } } };
  assert.equal(configChangeAffectsResults('maratonConfig', cfg, { marathonClassData: { A: { distanceB: 6000, tempoB: 240 } } }), true);
  assert.equal(configChangeAffectsResults('maratonConfig', cfg, JSON.parse(JSON.stringify(cfg))), false, 'a save without changes');
  assert.equal(configChangeAffectsResults('dressageJudgeMapping', null, { 'Klass': { C: 'j1' } }), true, 'created');
  assert.equal(configChangeAffectsResults('dressagePrograms', { X: {} }, null), true, 'deleted');
  assert.equal(configChangeAffectsResults('display', { a: 1 }, { a: 2 }), false, 'not a result setting');

  // globalStatus is written for live status; only the pause log matters
  const pause = [{ start: 1, end: 2 }];
  assert.equal(configChangeAffectsResults('globalStatus', { pauseLog: pause, live: 'A' }, { pauseLog: pause, live: 'B' }), false);
  assert.equal(configChangeAffectsResults('globalStatus', { pauseLog: pause }, { pauseLog: [...pause, { start: 5 }] }), true);

  // Key order alone is not a change
  assert.equal(ruleSettingsChanged({ ruleSettings: { a: 1, b: 2 }, name: 'x' }, { ruleSettings: { b: 2, a: 1 }, name: 'y' }), false);
  assert.equal(ruleSettingsChanged({ ruleSettings: { a: 1 } }, { ruleSettings: { a: 2 } }), true);
});

test('the settings fingerprint changes with result settings only', () => {
  const base = {
    competition: { name: 'Tävling', ruleSettings: { marathonObstaclePenaltyRate: 0.25 } },
    globalStatus: { pauseLog: [], live: 'A' },
    configs: { maratonConfig: { marathonClassData: { A: { tempoB: 250 } } }, display: { x: 1 } }
  };
  const fp = resultSettingsFingerprint(base);
  const changed = (patch) => resultSettingsFingerprint({ ...base, ...patch });

  assert.equal(changed({ competition: { ...base.competition, name: 'Nytt namn' } }), fp, 'competition name');
  assert.equal(changed({ globalStatus: { ...base.globalStatus, live: 'B' } }), fp, 'live status');
  assert.equal(changed({ configs: { ...base.configs, display: { x: 2 } } }), fp, 'display config');

  assert.notEqual(changed({ competition: { ruleSettings: { marathonObstaclePenaltyRate: 0.2 } } }), fp, 'rule settings');
  assert.notEqual(changed({ globalStatus: { pauseLog: [{ start: 1 }] } }), fp, 'pause log');
  assert.notEqual(changed({ configs: { maratonConfig: { marathonClassData: { A: { tempoB: 240 } } } } }), fp, 'marathon tempo');
  assert.notEqual(changed({ configs: { ...base.configs, dressageJudgeMapping: { A: { C: 'j' } } } }), fp, 'judge mapping');
});

test('program keys with other capitalisation resolve to the program list key', () => {
  const programs = { SvMsvB: { name: 'Medelsvår B' }, SvMSVb: { name: 'Exakt' } };
  assert.equal(findProgramKey('SvMSVB', programs), 'SvMsvB');
  assert.equal(findProgramKey('SvMSVb', programs), 'SvMSVb', 'an exact match wins');
  assert.equal(findProgramKey('FEI3BHP24', programs), null);
  assert.equal(findProgramKey('', programs), null);

  // Equipage key, protocol key and class mapping all go through the same lookup
  const ctx = { allPrograms: { SvMsvB: {}, SvLB: {} }, dressageProgramMapping: { Klass: 'svlb' } };
  assert.equal(resolveRecalculationProgramKey({ equipage: { className: 'Klass', testKey: 'SvMSVB' } }, ctx), 'SvMsvB');
  assert.equal(resolveRecalculationProgramKey({ equipage: { className: 'Klass' }, dressageProtocols: [{ testKey: 'SVMSVB' }] }, ctx), 'SvMsvB');
  assert.equal(resolveRecalculationProgramKey({ equipage: { className: 'Klass' } }, ctx), 'SvLB');
});

test('recalculation validation does not warn about a key that differs only in capitalisation', () => {
  const validation = buildRecalculationValidation([
    { startNumber: '6', equipage: { className: '4.MSV 3 Enbet Ponny', testKey: 'SvMSVB' } },
    { startNumber: '1', equipage: { className: '10.MSV 4 Par Ponny', testKey: 'FEI3BHP24' } }
  ], { allPrograms: { SvMsvB: {}, sv_msv_4_par_2025: {} } });

  assert.deepEqual(validation.warnings.map((w) => w.startNumber), ['1']);
});

test('recalculation validation blocks broken result data and keeps recoverable keys as warnings', () => {
  const validation = buildRecalculationValidation([
    {
      startNumber: '1',
      equipage: { className: 'Specialklass', testKey: 'old-key' },
      dressageProtocols: [{ testKey: 'CUSTOM' }]
    },
    {
      startNumber: '2',
      equipage: { className: 'Okänd klass' },
      dressageProtocols: [{ testKey: 'missing' }]
    },
    {
      startNumber: '3',
      equipage: {},
      calculationError: 'Ogiltigt tal'
    }
  ], context);

  assert.equal(validation.equipageCount, 3);
  assert.equal(validation.recalculableCount, 1);
  assert.equal(validation.criticalErrors.length, 3);
  assert.equal(validation.warnings.length, 1);
});
