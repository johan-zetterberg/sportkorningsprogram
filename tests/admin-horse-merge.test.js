import test from 'node:test';
import assert from 'node:assert/strict';
import { findSavedHorse, mergeFormHorse } from '../js/pages/admin/adminParticipantHorseFields.js';

const saved = [
  { id: '101 A', name: 'Blixten', chip: '752001', vetStatus: 'besiktigad', inspections: { initial: { status: 'besiktigad' } }, tdbId: 'T1' },
  { id: '101 B', name: 'Stjärna', ueln: '752ABC', vetStatus: 'ombesiktning' }
];

test('a horse keeps its own vet results and import data when edited', () => {
  const merged = mergeFormHorse(saved, { id: '101 A', name: 'Blixten', color: 'Brun' });
  assert.equal(merged.vetStatus, 'besiktigad');
  assert.equal(merged.tdbId, 'T1');
  assert.equal(merged.color, 'Brun');
});

test('a new horse in a slot does not inherit the old horse\'s approval', () => {
  const merged = mergeFormHorse(saved, { id: '101 A', name: 'Ny Häst' });
  assert.equal(merged.vetStatus, undefined);
  assert.equal(merged.inspections, undefined);
  assert.equal(merged.name, 'Ny Häst');
});

test('horses are matched on chip, UELN or name, not on position', () => {
  // Swapped order in the form: each keeps its own record
  assert.equal(findSavedHorse(saved, { name: 'Stjärna' })?.vetStatus, 'ombesiktning');
  assert.equal(findSavedHorse(saved, { name: 'Omdöpt', chip: '752001' })?.name, 'Blixten');
  assert.equal(findSavedHorse(saved, { name: 'x', ueln: '752abc' })?.name, 'Stjärna');
  assert.equal(findSavedHorse(saved, { name: '' }), null);
});

test('an empty id in the form never overwrites the saved one', () => {
  assert.equal(mergeFormHorse(saved, { id: '', name: 'Blixten' }).id, '101 A');
});
