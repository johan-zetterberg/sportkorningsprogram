import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVetDatalistOptions,
  filterVetEquipages,
  getVetRemainingCount,
  getVetSearchStartNumber,
  resolveVetFilteredState,
  sortVetEquipages
} from '../js/pages/shared/vetCheckUtils.js';

const equipages = [
  { startNumber: 3, driverName: 'Clara', clubName: 'C', status: 'besiktigad', horses: [{ name: 'Nova' }] },
  { startNumber: 1, driverName: 'Anna', clubName: 'A', status: 'ombesiktning', horses: [{ name: 'Luna' }] },
  { startNumber: 2, driverName: 'Bo', clubName: 'B', status: 'anmäld', horses: [{ name: 'Zorro' }] },
  { startNumber: 4, driverName: 'Dan', clubName: 'D', status: 'struken', horses: [] }
];

test('sortVetEquipages prioritizes hold and waiting before approved and withdrawn', () => {
  assert.deepEqual(sortVetEquipages(equipages).map(eq => eq.startNumber), [1, 2, 3, 4]);
});

test('getVetRemainingCount excludes approved and withdrawn equipages', () => {
  assert.equal(getVetRemainingCount(equipages), 2);
});

test('filterVetEquipages searches start number, driver, club and horse names', () => {
  assert.deepEqual(filterVetEquipages(equipages, 'zorro').map(eq => eq.startNumber), [2]);
  assert.deepEqual(filterVetEquipages(equipages, 'Clara').map(eq => eq.startNumber), [3]);
});

test('getVetSearchStartNumber parses datalist values', () => {
  assert.equal(getVetSearchStartNumber('12 - Driver'), '12');
  assert.equal(getVetSearchStartNumber('Driver'), '');
});

test('resolveVetFilteredState jumps to selected start number and requests cleared search', () => {
  const state = resolveVetFilteredState(equipages, '3 - Clara');

  assert.equal(state.clearSearch, true);
  assert.equal(state.filtered[state.index].startNumber, 3);
});

test('buildVetDatalistOptions builds stable datalist labels in sorted order', () => {
  assert.deepEqual(buildVetDatalistOptions(equipages).map(item => item.value), [
    '1 - Anna',
    '2 - Bo',
    '3 - Clara',
    '4 - Dan'
  ]);
});
