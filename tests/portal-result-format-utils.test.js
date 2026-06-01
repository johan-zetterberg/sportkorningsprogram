import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePortalTotalPenaltyLabel,
  formatPortalPenalty,
  getPortalPenaltyToneClass
} from '../js/pages/shared/portalResultFormatUtils.js';

test('formatPortalPenalty handles finite, empty and eliminated values', () => {
  assert.equal(formatPortalPenalty(12.345), '12.35');
  assert.equal(formatPortalPenalty(null), '—');
  assert.equal(formatPortalPenalty(Infinity), 'ELIM');
});

test('calculatePortalTotalPenaltyLabel prefers explicit total and avoids Infinity text', () => {
  assert.equal(calculatePortalTotalPenaltyLabel([10, 2.5, null]), '12.50');
  assert.equal(calculatePortalTotalPenaltyLabel([10, Infinity, 3]), 'ELIM');
  assert.equal(calculatePortalTotalPenaltyLabel([], Infinity), 'ELIM');
  assert.equal(calculatePortalTotalPenaltyLabel([]), '—');
});

test('getPortalPenaltyToneClass only highlights finite non-zero penalties', () => {
  assert.match(getPortalPenaltyToneClass(1), /text-gray-900/);
  assert.match(getPortalPenaltyToneClass(0), /text-gray-400/);
  assert.match(getPortalPenaltyToneClass(Infinity), /text-gray-400/);
});

test('calculatePortalTotalPenaltyLabel lets explicit elimination override numeric total', () => {
  assert.equal(calculatePortalTotalPenaltyLabel([10, 2], 12, { eliminated: true }), 'ELIM');
});
