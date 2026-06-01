import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPrecisionMonitorPartPenalty,
  formatPrecisionMonitorPenalty
} from '../js/pages/precision/precisionMonitorFormatUtils.js';

test('formatPrecisionMonitorPenalty avoids Infinity in public monitor labels', () => {
  assert.equal(formatPrecisionMonitorPenalty(5.678), '5.68');
  assert.equal(formatPrecisionMonitorPenalty(null), '—');
  assert.equal(formatPrecisionMonitorPenalty(Infinity), 'ELIM');
  assert.equal(formatPrecisionMonitorPenalty(3, { eliminated: true }), 'ELIM');
});

test('formatPrecisionMonitorPartPenalty hides parts for eliminated result', () => {
  assert.equal(formatPrecisionMonitorPartPenalty(2.5), '2.50');
  assert.equal(formatPrecisionMonitorPartPenalty(null), '–');
  assert.equal(formatPrecisionMonitorPartPenalty(2.5, { eliminated: true }), '–');
});
