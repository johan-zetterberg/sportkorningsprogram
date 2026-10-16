import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClassKey } from '../js/core-engine/marathon.js';
import { isLattBBarnClass } from '../js/utils/precisionCalculation.js';

test('the Barnklass template and children\'s Lätt B/C classes are the children\'s class (TR V 500.2)', () => {
  // The template name chosen in the marathon admin used to give no tempo at all
  assert.equal(normalizeClassKey('Barnklass'), 'Barnklass');
  assert.equal(normalizeClassKey('Lätt B Barn Ponny'), 'Barnklass');
  assert.equal(normalizeClassKey('Lätt C Barn Ponny'), 'Barnklass');
  assert.equal(normalizeClassKey('Lätt B'), 'Lätt B');
  assert.equal(normalizeClassKey('Lätt A Barn'), 'Lätt A');
});

test('precision treats Lätt C Barn and Barnklass like Lätt B Barn', () => {
  assert.equal(isLattBBarnClass('Lätt B Barn Ponny'), true);
  assert.equal(isLattBBarnClass('Lätt C Barn Ponny'), true);
  assert.equal(isLattBBarnClass('LC Barn'), true);
  assert.equal(isLattBBarnClass('Barnklass'), true);
  assert.equal(isLattBBarnClass('Lätt A Barn'), false);
  assert.equal(isLattBBarnClass('Lätt B Enbet Ponny'), false);
});
