import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDressageMonitorPenalty,
  formatDressageMonitorScore,
  isDressageMonitorEliminated
} from '../js/pages/dressage/dressageMonitorFormatUtils.js';

test('formatDressageMonitorScore formats finite and empty labels', () => {
  assert.equal(formatDressageMonitorScore(67.89, { suffix: ' %' }), '67.9 %');
  assert.equal(formatDressageMonitorScore(null), '—');
});

test('formatDressageMonitorScore and penalty show ELIM for eliminated results', () => {
  assert.equal(isDressageMonitorEliminated({ eliminated: true }), true);
  assert.equal(formatDressageMonitorScore(null, { eliminated: true, suffix: ' %' }), 'ELIM');
  assert.equal(formatDressageMonitorPenalty(null, { eliminated: true }), 'ELIM');
  assert.equal(formatDressageMonitorPenalty(12.345, {}), '12.35 p');
});
