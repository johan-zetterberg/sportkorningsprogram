import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDriverContacts } from '../functions/src/driverContacts.js';

test('drivers see only the marked contact persons, with the chosen details only', () => {
  const officials = [
    { id: 'a', data: { name: 'Anna', role: 'Sekretariat', driverContact: { show: true, phone: true, email: false } } },
    { id: 'b', data: { name: 'Bo', role: 'TD', driverContact: { show: true, phone: false, email: true } } },
    { id: 'c', data: { name: 'Cia', role: 'Volontär' } },
    { id: 'd', data: { name: 'Dan', role: 'Banbyggare', driverContact: { show: false, phone: true, email: true } } }
  ];
  const privateById = new Map([
    ['a', { phone: '070-111', email: 'anna@x.se', iceName: 'Mamma', icePhone: '070-999' }],
    ['b', { phone: '070-222', email: 'BO@x.se', diet: 'vegan' }],
    ['c', { phone: '070-333', email: 'cia@x.se' }]
  ]);
  assert.deepEqual(buildDriverContacts(officials, privateById), [
    { id: 'a', name: 'Anna', role: 'Sekretariat', phone: '070-111' },
    { id: 'b', name: 'Bo', role: 'TD', email: 'bo@x.se' }
  ]);
});

test('a marked contact without the chosen details is shown with name and role', () => {
  const officials = [{ id: 'a', data: { name: 'Anna', role: 'TD', driverContact: { show: true, phone: true, email: true } } }];
  assert.deepEqual(buildDriverContacts(officials, new Map()), [{ id: 'a', name: 'Anna', role: 'TD' }]);
});
