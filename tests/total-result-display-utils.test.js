import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTotalResultPenalty,
  formatTotalResultPercent,
  isTotalDisciplineEliminated
} from '../js/pages/shared/totalResultDisplayUtils.js';

test('formatTotalResultPenalty formats finite, empty and eliminated values', () => {
  assert.equal(formatTotalResultPenalty(12.345), '12.35');
  assert.equal(formatTotalResultPenalty(null), '—');
  assert.equal(formatTotalResultPenalty(Infinity), 'ELIM');
  assert.equal(formatTotalResultPenalty(12, { eliminated: true }), 'ELIM');
});

test('formatTotalResultPercent renders only finite percentage labels', () => {
  assert.equal(formatTotalResultPercent(67.891), ' <div class="res-pos">(67.89%)</div>');
  assert.equal(formatTotalResultPercent(null), '');
  assert.equal(formatTotalResultPercent(Infinity), '');
});

test('isTotalDisciplineEliminated detects discipline flags and infinity values', () => {
  assert.equal(isTotalDisciplineEliminated({ marathon: { eliminated: true } }, 'marathon'), true);
  assert.equal(isTotalDisciplineEliminated({ marathon: { totalPenalty: Infinity } }, 'marathon'), true);
  assert.equal(isTotalDisciplineEliminated({ precision: { pen: Infinity } }, 'precision'), true);
  assert.equal(isTotalDisciplineEliminated({ dressage: { penalty: 12 } }, 'dressage'), false);
});
