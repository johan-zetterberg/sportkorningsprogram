import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPrecisionCsvPenalty,
  formatPrecisionCsvText,
  formatPrecisionTimeSeconds
} from '../js/pages/precision/precisionResultExportUtils.js';

test('formatPrecisionCsvPenalty formats finite and empty precision values', () => {
  assert.equal(formatPrecisionCsvPenalty(4.5), '4.50');
  assert.equal(formatPrecisionCsvPenalty(null), '-');
  assert.equal(formatPrecisionCsvPenalty(null, { zeroWhenEmpty: true }), '0.00');
});

test('formatPrecisionCsvPenalty formats eliminated and infinity values as ELIM', () => {
  assert.equal(formatPrecisionCsvPenalty(Infinity), 'ELIM');
  assert.equal(formatPrecisionCsvPenalty(3, { eliminated: true }), 'ELIM');
});

test('formatPrecisionCsvText uses a stable empty fallback', () => {
  assert.equal(formatPrecisionCsvText('Klar'), 'Klar');
  assert.equal(formatPrecisionCsvText(''), '-');
  assert.equal(formatPrecisionCsvText(null), '-');
});

test('formatPrecisionTimeSeconds formats milliseconds as raw seconds', () => {
  assert.equal(formatPrecisionTimeSeconds(82300), '82.30');
  assert.equal(formatPrecisionTimeSeconds(null), '-');
  assert.equal(formatPrecisionTimeSeconds(-1), '-');
});
