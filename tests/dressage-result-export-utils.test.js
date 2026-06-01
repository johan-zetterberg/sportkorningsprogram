import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDressageCsvScore,
  formatDressageCsvStatus,
  stripDressageCsvHtml
} from '../js/pages/dressage/dressageResultExportUtils.js';

test('formatDressageCsvScore formats numeric and empty values', () => {
  assert.equal(formatDressageCsvScore(67.891), '67.89');
  assert.equal(formatDressageCsvScore(12.34, { decimals: 1 }), '12.3');
  assert.equal(formatDressageCsvScore(null), '-');
  assert.equal(formatDressageCsvScore(null, { empty: '0.0' }), '0.0');
});

test('formatDressageCsvScore formats eliminated values as ELIM', () => {
  assert.equal(formatDressageCsvScore(67.89, { eliminated: true }), 'ELIM');
  assert.equal(formatDressageCsvScore(null, { eliminated: true }), 'ELIM');
});

test('formatDressageCsvStatus strips html and preserves elimination', () => {
  assert.equal(stripDressageCsvHtml('<span class="x">Klar</span>'), 'Klar');
  assert.equal(formatDressageCsvStatus({}, '<span>Klar</span>'), 'Klar');
  assert.equal(formatDressageCsvStatus({ eliminated: true }, '<span>Klar</span>'), 'ELIM');
  assert.equal(formatDressageCsvStatus({}, ''), '-');
});
