import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasMarathonValidationErrors,
  validateDrivenObstacles,
  validateMarathonAdminSettings,
  validateMarathonClassSettings
} from '../js/pages/marathon/marathonAdminValidation.js';

test('validateMarathonClassSettings reports missing transport fields only when transport is enabled', () => {
  const errors = validateMarathonClassSettings({
    distanceA: 1000,
    windowA: 2,
    distanceB: 2000,
    windowB: 3,
    gateCount: 6,
    includeTransport: true
  }, {
    hasTempoA: true,
    hasTempoB: true
  });

  assert.deepEqual(errors.map(error => error.field), ['distanceT', 'tempoT']);
});

test('validateMarathonClassSettings accepts fixed warm-up without A distance or A tempo', () => {
  const errors = validateMarathonClassSettings({
    fixedTimeA: 10,
    windowA: 2,
    distanceB: 2000,
    windowB: 3,
    distanceT: 1000,
    tempoT: 200,
    gateCount: 6
  }, {
    hasTempoA: false,
    hasTempoB: true
  });

  assert.equal(errors.length, 0);
});

test('validateMarathonClassSettings accepts classes without transport by default', () => {
  const errors = validateMarathonClassSettings({
    distanceA: 1000,
    windowA: 2,
    distanceB: 2000,
    windowB: 3,
    gateCount: 6
  }, {
    hasTempoA: true,
    hasTempoB: true
  });

  assert.equal(errors.length, 0);
});

test('validateDrivenObstacles accepts comma numbers and rejects free text', () => {
  assert.equal(validateDrivenObstacles('1,2,4,6'), true);
  assert.equal(validateDrivenObstacles(''), true);
  assert.equal(validateDrivenObstacles('1, två, 3'), false);
});

test('validateMarathonAdminSettings groups errors by class', () => {
  const result = validateMarathonAdminSettings({
    'Lätt A': { distanceA: 1000, windowA: 2, distanceB: 2000, windowB: 3, distanceT: 1000, tempoT: 200, gateCount: 6 },
    'MSV': { distanceA: 1000, windowA: 2, distanceB: 2000, windowB: 3, includeTransport: true, distanceT: null, tempoT: 200, gateCount: 6 }
  }, () => ({ hasTempoA: true, hasTempoB: true }));

  assert.equal(hasMarathonValidationErrors(result), true);
  assert.equal(result['Lätt A'], undefined);
  assert.deepEqual(result.MSV.map(error => error.field), ['distanceT']);
});
