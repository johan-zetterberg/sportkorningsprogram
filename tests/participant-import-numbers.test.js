import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportNumberResolver } from '../js/pages/admin/adminParticipantImportNumbers.js';

const entry = (driverName, tdbClassNumber, horse, startNumber) => ({
  driverName, tdbClassNumber, startNumber,
  tdbOriginalXmlClassName: 'Lätt B Enbet Häst',
  horses: [{ name: horse }]
});

test('a re-imported entry keeps its number even when the file order changed', () => {
  const existing = [entry('Anna', 3, 'Ella', 1), entry('Bo', 3, 'Max', 2)];
  const numberFor = createImportNumberResolver(existing);
  // The new file lists Bo first: by position he would take Anna's number 1
  assert.equal(numberFor(entry('Bo', 3, 'Max', 1)), 2);
  assert.equal(numberFor(entry('Anna', 3, 'Ella', 2)), 1);
});

test('a new entry never takes a number already in the competition', () => {
  const existing = [entry('Anna', 3, 'Ella', 1), entry('Bo', 3, 'Max', 2)];
  const numberFor = createImportNumberResolver(existing);
  assert.equal(numberFor(entry('Cia', 3, 'Zorro', 1)), 3);
  assert.equal(numberFor(entry('Dan', 4, 'Pim', 9)), 9);
  // 9 is now taken: the next free number
  assert.equal(numberFor(entry('Eva', 4, 'Lo', 9)), 4);
});

test('a renamed horse still matches the driver\'s only entry in the class', () => {
  const numberFor = createImportNumberResolver([entry('Anna', 3, 'Ella II', 5)]);
  assert.equal(numberFor(entry('Anna', 3, 'Ella', 1)), 5);
});

test('the first import into an empty competition keeps the file numbers', () => {
  const numberFor = createImportNumberResolver([]);
  assert.deepEqual([1, 2, 3].map(n => numberFor(entry(`D${n}`, 1, 'H', n))), [1, 2, 3]);
});
