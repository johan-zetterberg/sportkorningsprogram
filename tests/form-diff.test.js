import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diffFormFields,
  findFormConflicts,
  flattenFormRows,
  formConflictMessage,
  formRowFieldLabel,
  planFormSave,
  sameFormValue,
  unflattenFormRows,
  unstoredFormFields
} from '../js/utils/formDiff.js';

test('form values compare as stored values', () => {
  assert.equal(sameFormValue('12', 12), true);
  assert.equal(sameFormValue(1.0, '1'), true);
  assert.equal(sameFormValue('', undefined), true);
  assert.equal(sameFormValue(null, ''), true);
  assert.equal(sameFormValue(false, undefined), true);
  assert.equal(sameFormValue(true, undefined), false);
  assert.equal(sameFormValue('a', 'b'), false);
  assert.equal(sameFormValue(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameFormValue(['a'], ['a', 'b']), false);
  assert.equal(sameFormValue([], undefined), true);
  assert.equal(sameFormValue({ show: false, phone: false }, undefined), true);
  assert.equal(sameFormValue({ lat: 55.7, lng: 13.2 }, { lat: '55.7', lng: 13.2 }), true);
  assert.equal(sameFormValue({ lat: 55.7 }, null), false);
});

test('only the fields changed in the form are saved', () => {
  const loaded = { name: 'Anna', club: 'KK', roles: ['speaker'] };
  assert.deepEqual(diffFormFields({ ...loaded }, loaded), {});
  assert.deepEqual(diffFormFields({ ...loaded, club: 'LK' }, loaded), { club: 'LK' });
  assert.deepEqual(diffFormFields({ ...loaded, roles: ['admin', 'speaker'] }, loaded), { roles: ['admin', 'speaker'] });
  // Restricted to `fields`, missing values as their default
  assert.deepEqual(diffFormFields({ a: 1, b: 2 }, {}, { fields: ['a'] }), { a: 1 });
  assert.deepEqual(diffFormFields({ placed: 3 }, {}, { defaults: { placed: 3 } }), {});
});

test('a stale form never puts back values saved by someone else', () => {
  const loaded = { driverName: 'Anna', speakerNotes: '' };
  // The speaker wrote notes after the admin opened the form
  const current = { driverName: 'Anna', speakerNotes: 'Första start' };
  // The admin only fixed the name
  const { changes, conflicts } = planFormSave({ driverName: 'Anna B', speakerNotes: '' }, loaded, current);
  assert.deepEqual(changes, { driverName: 'Anna B' });
  assert.deepEqual(conflicts, []);
});

test('a field changed both here and underneath is a conflict', () => {
  const loaded = { className: 'Lätt A' };
  const current = { className: 'Lätt B' };
  assert.deepEqual(planFormSave({ className: 'Msv' }, loaded, current).conflicts, ['className']);
  // Both set the same value: nothing is lost
  assert.deepEqual(planFormSave({ className: 'Lätt B' }, loaded, current).conflicts, []);
  // Without the stored document (offline): no check
  assert.deepEqual(findFormConflicts({ className: 'Msv' }, loaded, null), []);
});

test('defaults shown for unstored fields are stored as before', () => {
  assert.deepEqual(
    unstoredFormFields({ windowA: 2, tempoA: null, gateCount: 6, drivenObstacles: '' }, { gateCount: 8 }),
    { windowA: 2 }
  );
  assert.deepEqual(unstoredFormFields({ clearRound: false }, {}), { clearRound: false });
});

test('per-row settings flatten and come back', () => {
  const rows = { 'Lätt A': { distanceA: 5000, clearRound: false }, 'Klass 1.2': { gateCount: 6 } };
  const flat = flattenFormRows(rows);
  assert.equal(Object.keys(flat).length, 3);
  assert.deepEqual(unflattenFormRows(flat), rows);
  // Only the changed field of the changed class is written
  const changed = diffFormFields({ ...flat, ...flattenFormRows({ 'Lätt A': { distanceA: 5200 } }) }, flat);
  assert.deepEqual(unflattenFormRows(changed), { 'Lätt A': { distanceA: 5200 } });
  const key = Object.keys(changed)[0];
  assert.equal(formRowFieldLabel(key, { distanceA: 'distans A' }), 'distans A (Lätt A)');
});

test('the conflict question names the fields', () => {
  assert.equal(
    formConflictMessage(['club'], { club: 'klubb' }),
    'Någon annan har ändrat klubb sedan du öppnade formuläret. Skriva över med dina värden?'
  );
  assert.match(formConflictMessage(['a', 'b', 'c'], { a: 'A', b: 'B', c: 'C' }), /ändrat A, B och C sedan/);
});
