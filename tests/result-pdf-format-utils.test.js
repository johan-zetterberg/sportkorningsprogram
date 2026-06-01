import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPdfPenalty,
  formatTotalDisciplinePdfPenalty,
  formatTotalPdfPenalty,
  isWithdrawnStatus
} from '../js/pdf/resultPdfFormatUtils.js';

test('formatPdfPenalty handles finite, empty, eliminated, infinity and withdrawn values', () => {
  assert.equal(formatPdfPenalty(12.345), '12.35');
  assert.equal(formatPdfPenalty(null), '—');
  assert.equal(formatPdfPenalty(undefined, { empty: '-' }), '-');
  assert.equal(formatPdfPenalty(Infinity), 'ELIM');
  assert.equal(formatPdfPenalty(9, { eliminated: true }), 'ELIM');
  assert.equal(formatPdfPenalty(9, { withdrawn: true }), 'STR');
});

test('formatTotalDisciplinePdfPenalty uses discipline elimination flags', () => {
  const row = {
    dressage: { penalty: 45.123 },
    marathon: { totalPenalty: Infinity, eliminated: true },
    precision: { pen: 3 }
  };

  assert.equal(formatTotalDisciplinePdfPenalty(row, 'dressage'), '45.12');
  assert.equal(formatTotalDisciplinePdfPenalty(row, 'marathon'), 'ELIM');
  assert.equal(formatTotalDisciplinePdfPenalty(row, 'precision'), '3.00');
});

test('formatTotalPdfPenalty and withdrawn status avoid Infinity output', () => {
  assert.equal(isWithdrawnStatus('Struken'), true);
  assert.equal(isWithdrawnStatus('withdrawn by vet'), true);
  assert.equal(isWithdrawnStatus('klar'), false);

  assert.equal(formatTotalPdfPenalty({ totalPenalty: Infinity, isEliminated: true }), 'ELIM');
  assert.equal(formatTotalPdfPenalty({ status: 'struken', totalPenalty: 12 }), 'STR');
  assert.equal(formatTotalPdfPenalty({ totalPenalty: null }), '—');
});
