import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarathonHoldDeductionRows,
  formatMarathonStageTimeLabel
} from '../js/pdf/marathonPdfRows.js';

test('buildMarathonHoldDeductionRows returns only obstacles with hold time', () => {
  const rows = buildMarathonHoldDeductionRows([
    { number: 1, holdTimeSec: 0, comment: 'Ingen väntan' },
    { number: 2, holdTimeSec: 45, comment: 'Väntade på ekipage före', enteredAtClient: '2026-05-25T10:00:00Z' },
    { obstacleNumber: 3, holdTimeSec: '15' }
  ], {
    2: { exitAtClient: '2026-05-25T10:02:00Z' }
  }, ms => new Date(ms).toISOString().slice(11, 19));

  assert.deepEqual(rows, [
    {
      obstacleNumber: '2',
      timeLabel: '10:00:00 / 10:02:00',
      holdTimeSec: 45,
      reason: 'Väntade på ekipage före'
    },
    {
      obstacleNumber: '3',
      timeLabel: '— / —',
      holdTimeSec: 15,
      reason: '—'
    }
  ]);
});

test('formatMarathonStageTimeLabel makes B section deduction explicit', () => {
  assert.equal(
    formatMarathonStageTimeLabel(1200000, 30000, ms => `${ms / 1000}s`),
    'Netto: 1200s\nAvdrag uppehåll: -30s'
  );

  assert.equal(
    formatMarathonStageTimeLabel(1200000, 0, ms => `${ms / 1000}s`),
    '1200s'
  );
});
