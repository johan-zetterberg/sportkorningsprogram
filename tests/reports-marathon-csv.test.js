import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMarathonCsvExport } from '../js/pages/shared/reportsExportUtils.js';

test('buildMarathonCsvExport includes dynamic obstacle columns and totals', () => {
  const csv = buildMarathonCsvExport([
    {
      startNumber: 12,
      driverName: 'Anna Andersson',
      className: 'Latt A',
      horses: [{ name: 'Nova' }],
      marathon: {
        stages: {
          A: { timePenalty: 1.25 },
          transport: { timePenalty: 0.5 },
          B: { timePenalty: 2.75 }
        },
        obstacles: {
          sum: 15.5,
          items: [
            { number: 1, penalty: 5.25 },
            { number: 2, penalty: 10.25 }
          ]
        },
        otherPenalty: 3,
        wgPenalty: 1,
        totalPenalty: 21
      }
    }
  ], { filename: 'maraton.csv' });

  assert.equal(csv.filename, 'maraton.csv');
  assert.deepEqual(csv.headers, [
    'StartNr',
    'Kusk',
    'Klass',
    'Häst',
    'Straff A',
    'Straff T',
    'Straff B',
    'H1',
    'H2',
    'Hinderstraff',
    'Övrigt',
    'Totalt'
  ]);
  assert.deepEqual(csv.rows[0], [
    12,
    'Anna Andersson',
    'Latt A',
    'Nova',
    '1.25',
    '0.50',
    '2.75',
    '5.25',
    '10.25',
    '15.50',
    '4.00',
    '21.00'
  ]);
});
