import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterPrecisionEquipages,
  isWithdrawnPrecisionEquipage,
  matchesPrecisionSearch
} from '../js/pages/precision/precisionResultFilters.js';

const equipages = [
  { startNumber: 1, driverName: 'Anna Andersson', className: 'Lätt A', _mergedLabel: 'Lätt sammanslagen' },
  { startNumber: 2, driverName: 'Bo Bengtsson', className: 'Msv B' },
  { startNumber: 3, driverName: 'Cecilia Carlsson', className: 'Lätt A', status: 'struken' },
  { startNumber: 4, driverName: 'David Dahl', className: 'Svår', withdrawn: true }
];

test('matchesPrecisionSearch checks start number, driver and class labels', () => {
  assert.equal(matchesPrecisionSearch(equipages[0], 'anna'), true);
  assert.equal(matchesPrecisionSearch(equipages[0], '1'), true);
  assert.equal(matchesPrecisionSearch(equipages[0], 'sammanslagen'), true);
  assert.equal(matchesPrecisionSearch(equipages[0], 'msv'), false);
});

test('isWithdrawnPrecisionEquipage detects withdrawn variants', () => {
  assert.equal(isWithdrawnPrecisionEquipage({ status: 'struken' }), true);
  assert.equal(isWithdrawnPrecisionEquipage({ status: 'withdrawn' }), true);
  assert.equal(isWithdrawnPrecisionEquipage({ struken: true }), true);
  assert.equal(isWithdrawnPrecisionEquipage({ status: 'Klar' }), false);
});

test('filterPrecisionEquipages applies search and removes withdrawn', () => {
  const result = filterPrecisionEquipages(equipages, { searchText: 'lätt' });

  assert.deepEqual(result.map((equipage) => equipage.startNumber), [1]);
});

test('filterPrecisionEquipages applies finalized and class filters', () => {
  const precisionMap = new Map([
    ['1', { finalized: true, totalPenalty: 0 }],
    ['2', { finalized: true, totalPenalty: 4 }],
    ['3', { finalized: true, totalPenalty: 5 }]
  ]);
  const activeClassFilters = new Set(['Msv B']);

  const result = filterPrecisionEquipages(equipages, {
    showOnlyFinalized: true,
    activeClassFilters,
    precisionMap
  });

  assert.deepEqual(result.map((equipage) => equipage.startNumber), [2]);
});
