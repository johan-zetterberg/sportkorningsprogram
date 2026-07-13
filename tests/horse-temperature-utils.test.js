import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHorseTemperatureSlots,
  getTemperatureHorses,
  normalizeHorseTemperatureConfig,
  normalizeHorseTemperatureValue,
  parseCompetitionStartDate,
  summarizeHorseTemperatures
} from '../js/pages/shared/horseTemperatureUtils.js';

test('normalizeHorseTemperatureConfig applies practical defaults', () => {
  const config = normalizeHorseTemperatureConfig({
    enabled: true,
    daysBefore: '99',
    checksPerDay: '1',
    warningTemperatureC: '38,5',
    instructions: '  Ta tempen lugnt.  '
  });

  assert.equal(config.enabled, true);
  assert.equal(config.daysBefore, 14);
  assert.equal(config.checksPerDay, 1);
  assert.equal(config.warningTemperatureC, 38.5);
  assert.equal(config.instructions, 'Ta tempen lugnt.');
});

test('buildHorseTemperatureSlots creates days before competition in date order', () => {
  const slots = buildHorseTemperatureSlots('2026-06-02 – 2026-06-04', {
    enabled: true,
    daysBefore: 3,
    checksPerDay: 2
  });

  assert.deepEqual(slots.map(slot => slot.id), [
    '2026-05-30_morning',
    '2026-05-30_evening',
    '2026-05-31_morning',
    '2026-05-31_evening',
    '2026-06-01_morning',
    '2026-06-01_evening'
  ]);
  assert.equal(slots[0].defaultDateTime, '2026-05-30T08:00');
  assert.equal(slots[1].defaultDateTime, '2026-05-30T18:00');
});

test('temperature helpers parse competition dates, horses and decimal values', () => {
  const parsed = parseCompetitionStartDate('2026-06-02');
  assert.equal(parsed?.getFullYear(), 2026);
  assert.equal(parsed?.getMonth(), 5);
  assert.equal(parsed?.getDate(), 2);
  assert.equal(normalizeHorseTemperatureValue('37,8'), 37.8);
  assert.equal(normalizeHorseTemperatureValue('bad'), null);

  const horses = getTemperatureHorses({
    horses: [{ name: 'Nova', chipNumber: '123' }, { horseName: 'Luna' }]
  });

  assert.deepEqual(horses.map(horse => horse._temperatureKey), ['123', 'Luna']);
  assert.deepEqual(horses.map(horse => horse._temperatureName), ['Nova', 'Luna']);
});

test('summarizeHorseTemperatures counts completed, missing and high records', () => {
  const summary = summarizeHorseTemperatures({
    horses: [{ name: 'Nova', id: 'nova' }],
    horseTemperatures: {
      nova: {
        '2026-06-01_morning': { temperatureC: 37.8, takenAt: '2026-06-01T08:10' },
        '2026-06-01_evening': { temperatureC: 38.7, takenAt: '2026-06-01T18:15' }
      }
    }
  }, '2026-06-02', {
    enabled: true,
    daysBefore: 1,
    checksPerDay: 2,
    warningTemperatureC: 38.5
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.completed, 2);
  assert.equal(summary.missing, 0);
  assert.equal(summary.complete, true);
  assert.equal(summary.highCount, 1);
  assert.equal(summary.horseSummaries[0].latest.temperatureC, 38.7);
});
