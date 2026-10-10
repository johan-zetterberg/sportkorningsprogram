import test from 'node:test';
import assert from 'node:assert/strict';

import { rankDressageRows } from '../js/pages/dressage/dressageResultRanking.js';

test('rankDressageRows gives equal place for equal penalties regardless of general impression', () => {
  const rows = [
    { startNumber: 8, className: 'A', finalPenalty: 50, generalImpressionsSum: 30 },
    { startNumber: 2, className: 'A', finalPenalty: 50, generalImpressionsSum: 40 },
    { startNumber: 5, className: 'A', finalPenalty: 51, generalImpressionsSum: 50 }
  ];

  const ranked = rankDressageRows(rows, { groupPicker: row => row.className });

  assert.deepEqual(ranked.map(row => row.startNumber), [2, 8, 5]);
  assert.deepEqual(ranked.map(row => row.plac), [1, 1, 3]);
});

test('rankDressageRows ranks classes separately and excludes eliminated or incomplete rows', () => {
  const rows = [
    { startNumber: 1, className: 'A', finalPenalty: 40 },
    { startNumber: 2, className: 'A', finalPenalty: 39, eliminated: true, plac: 2 },
    { startNumber: 3, className: 'A', finalPenalty: null, plac: 3 },
    { startNumber: 4, className: 'B', finalPenalty: 60 }
  ];

  rankDressageRows(rows, {
    groupPicker: row => row.className,
    eliminatedPicker: row => !!row.eliminated
  });

  assert.equal(rows[0].plac, 1);
  assert.equal(rows[1].plac, null);
  assert.equal(rows[2].plac, null);
  assert.equal(rows[3].plac, 1);
});
