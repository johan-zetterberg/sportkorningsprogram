import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecalculationValidation,
  resolveRecalculationProgramKey
} from '../functions/src/resultRecalculationUtils.js';

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
