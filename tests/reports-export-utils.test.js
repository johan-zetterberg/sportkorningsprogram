import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterReportData,
  formatReportCsvPenalty,
  formatReportCsvPercent,
  getReportClassOptions,
  getReportDisplayClass,
  getReportHorseNames
} from '../js/pages/shared/reportsExportUtils.js';

test('reports export helpers use merged display classes for options and filtering', () => {
  const rows = [
    { startNumber: 1, className: 'Lätt A', _mergedLabel: 'Sammanslagen' },
    { startNumber: 2, className: 'Lätt B', _mergedLabel: 'Sammanslagen' },
    { startNumber: 3, className: 'MSV' }
  ];

  assert.deepEqual(getReportClassOptions(rows), ['MSV', 'Sammanslagen']);
  assert.equal(getReportDisplayClass(rows[0]), 'Sammanslagen');

  const filtered = filterReportData({ rows, filterClass: 'Sammanslagen' });
  assert.deepEqual(filtered.rows.map(row => row.startNumber), [1, 2]);
  assert.deepEqual(filtered.eqs.map(row => row.startNumber), [1, 2]);
});

test('reports export helpers format horses, penalties and percents safely', () => {
  assert.equal(getReportHorseNames({ horses: [{ name: 'Häst A' }, 'Häst B'] }), 'Häst A, Häst B');
  assert.equal(getReportHorseNames({ horseName: 'Solo' }), 'Solo');

  assert.equal(formatReportCsvPenalty(12.345), '12,35');
  assert.equal(formatReportCsvPenalty(Infinity), 'ELIM');
  assert.equal(formatReportCsvPenalty(null), '');
  assert.equal(formatReportCsvPenalty(null, { empty: '-' }), '-');
  assert.equal(formatReportCsvPenalty(1, { eliminated: true }), 'ELIM');

  assert.equal(formatReportCsvPercent(67.891), '67,89%');
  assert.equal(formatReportCsvPercent(null), '');
  assert.equal(formatReportCsvPercent(50, { eliminated: true }), 'ELIM');
});
