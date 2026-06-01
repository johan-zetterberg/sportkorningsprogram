import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTotalCsvExport } from '../js/pages/shared/totalResultCsv.js';

test('buildTotalCsvExport builds filename, headers and rows', () => {
  const csv = buildTotalCsvExport({
    competitionName: 'Vår Tävling',
    date: new Date('2026-05-23T10:00:00Z'),
    translate: (key) => ({
      startno: 'Startnr',
      driver: 'Kusk',
      class: 'Klass',
      club: 'Klubb',
      dressage: 'Dressyr',
      penalty: 'Straff',
      marathon: 'Maraton',
      time: 'Tid',
      obs_penalty: 'Hinderstraff',
      total: 'Totalt',
      precision: 'Precision',
      ranking: 'Placering',
      elim: 'Utesluten'
    }[key] || key),
    equipages: [
      { startNumber: 12, clubName: 'Lunds KK' }
    ],
    rows: [
      {
        startNumber: 12,
        driverName: 'Anna Andersson',
        className: 'Latt A',
        dressage: { penalty: 45.123, percentAvg: 67.89 },
        marathon: { timePenalty: 3, obstaclePenalty: 4.5, totalPenalty: 7.5 },
        precision: { pen: 1 },
        totalPenalty: 54.123,
        plac: 2,
        isEliminated: false
      }
    ]
  });

  assert.equal(csv.filename, 'total_resultat_var_tavling_2026-05-23.csv');
  assert.deepEqual(csv.headers.slice(0, 4), ['Startnr', 'Kusk', 'Klass', 'Klubb']);
  assert.deepEqual(csv.rows[0], [
    12,
    'Anna Andersson',
    'Latt A',
    'Lunds KK',
    '45.12',
    '67.89',
    '3.00',
    '4.50',
    '7.50',
    '1.00',
    '54.12',
    2,
    ''
  ]);
});

test('buildTotalCsvExport marks eliminated rows', () => {
  const csv = buildTotalCsvExport({
    date: '2026-05-23',
    rows: [{ startNumber: 1, totalPenalty: Infinity, isEliminated: true, plac: 3 }]
  });

  assert.equal(csv.rows[0][10], 'ELIM');
  assert.equal(csv.rows[0][11], '');
  assert.equal(csv.rows[0].at(-1), 'JA');
});

test('buildTotalCsvExport formats discipline eliminations without Infinity text', () => {
  const csv = buildTotalCsvExport({
    date: '2026-05-23',
    rows: [{
      startNumber: 2,
      dressage: { penalty: 44.12, percentAvg: 70.5 },
      marathon: { totalPenalty: Infinity, eliminated: true },
      precision: { pen: Infinity, eliminated: true },
      totalPenalty: Infinity,
      isEliminated: true
    }]
  });

  assert.deepEqual(csv.rows[0].slice(4, 11), [
    '44.12',
    '70.50',
    'ELIM',
    'ELIM',
    'ELIM',
    'ELIM',
    'ELIM'
  ]);
});
