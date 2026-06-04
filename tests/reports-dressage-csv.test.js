import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDressageCsvExport } from '../js/pages/shared/reportsExportUtils.js';

test('buildDressageCsvExport includes dynamic judge columns with individual points', () => {
  const csv = buildDressageCsvExport([
    {
      startNumber: 7,
      driverName: 'Sara Svensson',
      className: 'MSV',
      horseName: 'Apollo',
      dressage: {
        judges: {
          c: { position: 'C', totalPoints: 67.5, eliminated: false },
          m: { position: 'M', totalPoints: 66, eliminated: false }
        },
        penalty: 52.34,
        percent: 68.91,
        eliminated: false
      }
    }
  ], { filename: 'dressyr.csv' });

  assert.equal(csv.filename, 'dressyr.csv');
  assert.deepEqual(csv.headers, [
    'StartNr',
    'Kusk',
    'Klass',
    'Häst',
    'Domare C',
    'Domare M',
    'Straff',
    'Procent'
  ]);
  assert.deepEqual(csv.rows[0], [
    7,
    'Sara Svensson',
    'MSV',
    'Apollo',
    '67,5',
    '66,0',
    '52,34',
    '68,91%'
  ]);
});
