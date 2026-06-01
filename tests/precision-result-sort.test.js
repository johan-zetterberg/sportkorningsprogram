import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPrecisionSortValue,
  sortPrecisionEquipages
} from '../js/pages/precision/precisionResultSort.js';

const equipages = [
  { startNumber: 3, driverName: 'Cecilia', className: 'B' },
  { startNumber: 1, driverName: 'Anna', className: 'A' },
  { startNumber: 2, driverName: 'Bo', className: 'A' }
];

const rows = new Map([
  ['1', { eq: equipages[1], place: 2, totalPenalty: 5, timeDiffFromAllowed: 3000, status: 'Klar', timeMs: 100000, display: { portWidth: 160 } }],
  ['2', { eq: equipages[2], place: 1, totalPenalty: 5, timeDiffFromAllowed: 1000, status: 'Pågår', timeMs: 99000, display: { portWidth: 155 } }],
  ['3', { eq: equipages[0], place: 3, totalPenalty: 8, timeDiffFromAllowed: 2000, status: 'Ej startat', timeMs: null, display: { portWidth: null } }]
]);

function getRowData(equipage) {
  return rows.get(String(equipage.startNumber));
}

test('getPrecisionSortValue reads common result columns', () => {
  const row = rows.get('2');

  assert.equal(getPrecisionSortValue('place', row), 1);
  assert.equal(getPrecisionSortValue('penalty', row), 5);
  assert.equal(getPrecisionSortValue('status', row), 1);
  assert.equal(getPrecisionSortValue('portWidth', row), 155);
});

test('sortPrecisionEquipages sorts by start number', () => {
  const sorted = sortPrecisionEquipages(equipages, {
    sort: { col: 'startNumber', dir: 'asc' },
    getRowData
  });

  assert.deepEqual(sorted.map((equipage) => equipage.startNumber), [1, 2, 3]);
});

test('sortPrecisionEquipages sorts tied penalties by closest allowed time', () => {
  const sorted = sortPrecisionEquipages(equipages, {
    sort: { col: 'penalty', dir: 'asc' },
    getRowData
  });

  assert.deepEqual(sorted.map((equipage) => equipage.startNumber), [2, 1, 3]);
});

test('sortPrecisionEquipages groups by class in byclass view before column sort', () => {
  const sorted = sortPrecisionEquipages(equipages, {
    sort: { col: 'place', dir: 'asc' },
    viewMode: 'byclass',
    getRowData
  });

  assert.deepEqual(sorted.map((equipage) => equipage.startNumber), [2, 1, 3]);
});

test('sortPrecisionEquipages can sort by injected overall value', () => {
  const sorted = sortPrecisionEquipages(equipages, {
    sort: { col: 'overall', dir: 'asc' },
    getRowData,
    getOverallValue: (equipage) => ({ 1: 30, 2: 20, 3: 10 })[equipage.startNumber]
  });

  assert.deepEqual(sorted.map((equipage) => equipage.startNumber), [3, 2, 1]);
});
