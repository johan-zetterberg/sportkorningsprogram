import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLiveInjectionEliminated,
  toFiniteNumberOrNull,
  toFiniteNumberOrZero
} from '../js/pages/shared/speakerCalculationUtils.js';

test('speaker calculation utilities normalize finite numeric input', () => {
  assert.equal(toFiniteNumberOrNull(0), 0);
  assert.equal(toFiniteNumberOrNull('12.5'), 12.5);
  assert.equal(toFiniteNumberOrNull(Infinity), null);
  assert.equal(toFiniteNumberOrNull(''), null);
  assert.equal(toFiniteNumberOrNull('not-a-number'), null);
});

test('speaker calculation zero fallback preserves real zero values', () => {
  assert.equal(toFiniteNumberOrZero(0), 0);
  assert.equal(toFiniteNumberOrZero('0'), 0);
  assert.equal(toFiniteNumberOrZero(null), 0);
  assert.equal(toFiniteNumberOrZero(Infinity), 0);
});

test('speaker live injection elimination detects explicit and infinite states', () => {
  assert.equal(isLiveInjectionEliminated({ eliminated: true, disciplinePenalty: 0 }), true);
  assert.equal(isLiveInjectionEliminated({ disciplinePenalty: Infinity }), true);
  assert.equal(isLiveInjectionEliminated({ disciplinePenalty: 0 }), false);
});
