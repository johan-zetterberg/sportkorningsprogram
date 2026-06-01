import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPrizeGivingScore,
  getPrizeGivingStatus,
  isPrizeGivingScore
} from '../js/pages/shared/prizeGivingUtils.js';

test('prize giving score validation only accepts finite numbers', () => {
  assert.equal(isPrizeGivingScore(12.3), true);
  assert.equal(isPrizeGivingScore(0), true);
  assert.equal(isPrizeGivingScore(Infinity), false);
  assert.equal(isPrizeGivingScore(NaN), false);
  assert.equal(isPrizeGivingScore(null), false);
});

test('prize giving score formatting hides invalid values', () => {
  assert.equal(formatPrizeGivingScore(12.345), '12.35');
  assert.equal(formatPrizeGivingScore(0), '0.00');
  assert.equal(formatPrizeGivingScore(Infinity, '-'), '-');
  assert.equal(formatPrizeGivingScore(null, '-'), '-');
});

test('prize giving status separates eliminated and incomplete rows', () => {
  assert.equal(getPrizeGivingStatus({ isEliminated: true, score: 12 }), 'ELIM');
  assert.equal(getPrizeGivingStatus({ score: Infinity }), 'ELIM');
  assert.equal(getPrizeGivingStatus({ score: null }), 'Ej Start');
  assert.equal(getPrizeGivingStatus({ score: 12 }), '');
});
