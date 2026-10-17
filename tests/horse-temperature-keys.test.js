import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHorseTemperatureChanges,
  buildHorseTemperatureKeyMigration,
  getHorseTemperatureRecord,
  getTemperatureHorseKeys,
  summarizeHorseTemperatures
} from '../js/pages/shared/horseTemperatureUtils.js';

test('the registration id is the stable key, the name an older key', () => {
  assert.deepEqual(getTemperatureHorseKeys({ name: 'Nova', id: 'SE001' }), ['SE001', 'Nova']);
  assert.deepEqual(getTemperatureHorseKeys({ name: 'Nova' }), ['Nova']);
  assert.deepEqual(getTemperatureHorseKeys({}, 2), ['horse-3']);
});

test('temperatures saved under the name are still read once the horse has an id', () => {
  const eq = {
    horses: [{ name: 'Nova', id: 'SE001' }],
    horseTemperatures: { Nova: { '2026-06-01_morning': { temperatureC: 37.8 } } }
  };
  assert.equal(getHorseTemperatureRecord(eq, 'SE001', '2026-06-01_morning')?.temperatureC, 37.8);
  const summary = summarizeHorseTemperatures(eq, '2026-06-02', { enabled: true, daysBefore: 1, checksPerDay: 2 });
  assert.equal(summary.completed, 1);
});

test('only changed slots are written; untouched and empty slots are left alone', () => {
  const shown = {
    horses: [{ name: 'Nova', id: 'SE001' }],
    horseTemperatures: { SE001: { a: { temperatureC: 37.8, takenAt: '2026-06-01T08:00' } } }
  };
  const rows = [
    // unchanged
    { horseKeys: ['SE001', 'Nova'], slotId: 'a', value: '37,8', takenAt: '2026-06-01T08:00', defaultTakenAt: '2026-06-01T08:00' },
    // empty and nothing shown: not written (no null over a value saved elsewhere)
    { horseKeys: ['SE001', 'Nova'], slotId: 'b', value: '', takenAt: '', defaultTakenAt: '2026-06-01T18:00' },
    // new value
    { horseKeys: ['SE001', 'Nova'], slotId: 'c', value: '38,1', takenAt: '', defaultTakenAt: '2026-06-02T08:00' }
  ];
  const { writes, errors } = buildHorseTemperatureChanges(shown, rows, { now: 'x', uid: 'u1' });
  assert.deepEqual(errors, []);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].horseKey, 'SE001');
  assert.equal(writes[0].slotId, 'c');
  assert.equal(writes[0].record.temperatureC, 38.1);
  assert.equal(writes[0].record.updatedBy, 'u1');
});

test('clearing a shown value removes it; invalid values are refused', () => {
  const shown = { horses: [{ name: 'Nova' }], horseTemperatures: { Nova: { a: { temperatureC: 37.8 } } } };
  const cleared = buildHorseTemperatureChanges(shown, [{ horseKeys: ['Nova'], slotId: 'a', value: '' }]);
  assert.deepEqual(cleared.writes, [{ horseKey: 'Nova', slotId: 'a', record: null }]);
  const bad = buildHorseTemperatureChanges(shown, [{ horseKeys: ['Nova'], slotId: 'a', value: '50' }]);
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.writes.length, 0);
});

test('older keys are moved to the stable key, skipping slots being saved', () => {
  const eq = {
    horses: [{ name: 'Nova', id: 'SE001' }, { name: 'Luna' }],
    horseTemperatures: {
      Nova: { a: { temperatureC: 37.5 }, b: { temperatureC: 37.6 }, c: { temperatureC: 37.7 } },
      SE001: { b: { temperatureC: 38.0 } },
      Luna: { a: { temperatureC: 37.9 } }
    }
  };
  const { copies, removeKeys } = buildHorseTemperatureKeyMigration(eq, new Set(['SE001|c']));
  assert.deepEqual(copies.map(c => `${c.horseKey}|${c.slotId}`), ['SE001|a']);
  assert.deepEqual(removeKeys, ['Nova']);
});

test('a key that is another horse\'s stable key is never removed', () => {
  const eq = {
    horses: [{ name: 'Nova', id: 'SE001' }, { name: 'Nova' }],
    horseTemperatures: { Nova: { a: { temperatureC: 37.5 } } }
  };
  assert.deepEqual(buildHorseTemperatureKeyMigration(eq).removeKeys, []);
});
