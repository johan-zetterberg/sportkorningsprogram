import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTotalDisciplinePlacements,
  applyTotalResultDiffs,
  buildBestDressageByGroup,
  buildDisplayedTotalRows,
  compareTotalTiebreak,
  filterTotalRows,
  placeTotalRowsWithinClass,
  rankTotalRowsWithinClass,
  sortTotalRows
} from '../js/pages/shared/totalResultRanking.js';

const rows = [
  {
    startNumber: 1,
    driverName: 'Anna',
    clubName: 'A-klubben',
    className: 'Lätt A',
    displayGroupKey: 'CLASS:A',
    displayGroupLabel: 'Lätt A',
    totalPenalty: 20,
    marathon: { totalPenalty: 8 },
    dressage: { penalty: 7 },
    precision: { pen: 5 },
    isEliminated: false
  },
  {
    startNumber: 2,
    driverName: 'Bo',
    clubName: 'B-klubben',
    className: 'Lätt A',
    displayGroupKey: 'CLASS:A',
    displayGroupLabel: 'Lätt A',
    totalPenalty: 20,
    marathon: { totalPenalty: 6 },
    dressage: { penalty: 9 },
    precision: { pen: 5 },
    isEliminated: false
  },
  {
    startNumber: 3,
    driverName: 'Cilla',
    clubName: 'C-klubben',
    className: 'Msv',
    displayGroupKey: 'CLASS:M',
    displayGroupLabel: 'Msv',
    totalPenalty: null,
    marathon: {},
    dressage: {},
    precision: {},
    isEliminated: false,
    isOngoing: true
  }
];

test('compareTotalTiebreak prefers lower marathon penalty on tied totals', () => {
  assert.ok(compareTotalTiebreak(rows[0], rows[1]) > 0);
});

test('placeTotalRowsWithinClass ranks per display group', () => {
  const placed = placeTotalRowsWithinClass(rows.map((row) => ({ ...row })));

  assert.equal(placed.find((row) => row.startNumber === 2).plac, 1);
  assert.equal(placed.find((row) => row.startNumber === 1).plac, 2);
  assert.equal(placed.find((row) => row.startNumber === 3).plac, null);
});

test('rankTotalRowsWithinClass ranks valid rows within original class', () => {
  const ranked = [
    { startNumber: 1, className: 'A', dressage: { percentAvg: 70 }, isEliminated: false },
    { startNumber: 2, className: 'A', dressage: { percentAvg: 75 }, isEliminated: false },
    { startNumber: 3, className: 'A', dressage: { percentAvg: 90 }, isEliminated: true },
    { startNumber: 4, className: 'B', dressage: { percentAvg: 65 }, isEliminated: false }
  ];

  rankTotalRowsWithinClass(ranked, (row) => row.dressage.percentAvg, 'posPercent', true);

  assert.equal(ranked[1].posPercent, 1);
  assert.equal(ranked[0].posPercent, 2);
  assert.equal(ranked[2].posPercent, undefined);
  assert.equal(ranked[3].posPercent, 1);
});

test('applyTotalDisciplinePlacements sets dressage, marathon and precision positions', () => {
  const ranked = rows.map((row) => ({ ...row, marathon: { ...row.marathon }, dressage: { ...row.dressage }, precision: { ...row.precision } }));
  applyTotalDisciplinePlacements(ranked);

  assert.equal(ranked.find((row) => row.startNumber === 1).posDress, 1);
  assert.equal(ranked.find((row) => row.startNumber === 2).posDress, 2);
  assert.equal(ranked.find((row) => row.startNumber === 2).posMar, 1);
  assert.equal(ranked.find((row) => row.startNumber === 1).posPrec, 1);
  assert.equal(ranked.find((row) => row.startNumber === 3).posDress, undefined);
});

test('applyTotalResultDiffs sets leader and previous finished differences per display group', () => {
  const ranked = [
    { startNumber: 1, displayGroupKey: 'CLASS:A', className: 'A', totalPenalty: 10, isEliminated: false },
    { startNumber: 2, displayGroupKey: 'CLASS:A', className: 'A', totalPenalty: 12.345, isEliminated: false },
    { startNumber: 3, displayGroupKey: 'CLASS:A', className: 'A', totalPenalty: null, isEliminated: false },
    { startNumber: 4, displayGroupKey: 'CLASS:A', className: 'A', totalPenalty: 14, isEliminated: true },
    { startNumber: 5, displayGroupKey: 'CLASS:B', className: 'B', totalPenalty: 20, isEliminated: false }
  ];

  applyTotalResultDiffs(ranked);

  assert.equal(ranked[0].diffFromLeader, 0);
  assert.equal(ranked[0].diffFromNext, null);
  assert.equal(ranked[1].diffFromLeader, 2.35);
  assert.equal(ranked[1].diffFromNext, 2.35);
  assert.equal(ranked[2].diffFromLeader, null);
  assert.equal(ranked[2].diffFromNext, null);
  assert.equal(ranked[3].diffFromLeader, null);
  assert.equal(ranked[3].diffFromNext, null);
  assert.equal(ranked[4].diffFromLeader, 0);
  assert.equal(ranked[4].diffFromNext, null);
});

test('buildBestDressageByGroup keeps highest dressage percent per display group', () => {
  const best = buildBestDressageByGroup([
    { displayGroupKey: 'CLASS:A', className: 'A', dressage: { percentAvg: 71.2 } },
    { displayGroupKey: 'CLASS:A', className: 'A', dressage: { percentAvg: 74.5 } },
    { className: 'B', dressage: { percentAvg: 68 } },
    { className: 'B', dressage: { percentAvg: null } },
    { className: 'C', dressage: {} }
  ]);

  assert.equal(best.get('CLASS:A'), 74.5);
  assert.equal(best.get('CLASS:B'), 68);
  assert.equal(best.has('CLASS:C'), false);
});

test('filterTotalRows applies class, search and status filters', () => {
  assert.deepEqual(
    filterTotalRows(rows, {
      activeClassFilters: new Set(['Lätt A']),
      searchQuery: 'bo',
      equipages: []
    }).map((row) => row.startNumber),
    [2]
  );

  assert.deepEqual(
    filterTotalRows(rows, { showOnlyOngoing: true }).map((row) => row.startNumber),
    [3]
  );
});

test('sortTotalRows sorts by configured columns', () => {
  assert.deepEqual(
    sortTotalRows(rows, { key: 'driverName', direction: 'desc' }).map((row) => row.startNumber),
    [3, 2, 1]
  );
});

test('buildDisplayedTotalRows combines filtering and sorting', () => {
  const displayed = buildDisplayedTotalRows(rows, {
    activeClassFilters: new Set(['Lätt A']),
    sortConfig: { key: 'totalPenalty', direction: 'asc' }
  });

  assert.deepEqual(displayed.map((row) => row.startNumber), [2, 1]);
});
