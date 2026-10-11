import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecalculationValidation,
  resolveRecalculationProgramKey
} from '../functions/src/resultRecalculationUtils.js';
import { findProgramKey } from '../functions/src/core-engine/dressage.js';

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
