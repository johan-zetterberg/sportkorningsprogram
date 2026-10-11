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

  const fallbackRows = buildMarathonHoldDeductionRows([
    { number: 4, holdTimeSec: 20, holdTimeReason: 'Väntan på funktionär' },
    { number: 5, holdTimeSec: 10, reason: 'Tekniskt uppehåll' }
  ]);
  assert.equal(fallbackRows[0].reason, 'Väntan på funktionär');
  assert.equal(fallbackRows[1].reason, 'Tekniskt uppehåll');
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

test('prepareMarathonResults calculates non-zero obstacle penalties and totals for PDF export', async () => {
  const { buildDemoCompetitionDataset } = await import('../js/services/demoCompetitionData.js');
  const { prepareMarathonResults } = await import('../js/utils/marathonUtils.js');

  const data = buildDemoCompetitionDataset();
  const timingMap = new Map();
  const stateMap = new Map();
  const obstaclesMap = new Map();

  data.marathonRecords.forEach(r => {
    stateMap.set(String(r.startNumber), r);
    timingMap.set(String(r.startNumber), r);
  });

  data.marathonRecords.forEach(r => {
    const sn = String(r.startNumber);
    const obs = (r.obstacles || []).map(o => ({
      equipageId: sn,
      obstacleNumber: o.number,
      number: o.number,
      timeSec: o.timeSec,
      timeInSeconds: o.timeSec,
      penalty: o.penalty,
      holdTimeSec: o.holdTimeSec || 0
    }));
    obstaclesMap.set(sn, obs);
  });

  const list = prepareMarathonResults(data.equipages, data.configs.maratonConfig, {
    timingMap,
    stateMap,
    obstaclesMap
  });

  const eq1 = list.find(e => e.startNumber === 1);
  assert.ok(eq1);
  assert.ok(eq1.results?.marathon);
  assert.equal(eq1.results.marathon.obstacles.items.length, 6);
  assert.ok(eq1.results.marathon.obstacles.sum > 60, 'Obstacle sum should be populated with penalties');
  assert.ok(eq1.results.marathon.totalPenalty > 60, 'Total penalty should not be zero');
  assert.equal(eq1.results.marathon.obstacles.items[0].number, 1);
  assert.equal(eq1.results.marathon.obstacles.items[0].timeSec, 42.5);
});
