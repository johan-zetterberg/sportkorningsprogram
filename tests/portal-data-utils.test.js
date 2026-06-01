import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPortalTimestamp,
  getPortalMinutesToNextStart,
  getPortalStartTimesForEquipage,
  normalizePortalStartTimesConfig,
  resolvePortalDisciplinePenalties,
  sortPortalItemsByTimestampDesc
} from '../js/pages/shared/portalDataUtils.js';

test('portal start times normalization accepts direct and nested config shape', () => {
  const direct = normalizePortalStartTimesConfig({ times: { 4: { dressage: '09:00' } } });
  const nested = normalizePortalStartTimesConfig({ value: { times: { 5: { marathon: '10:00' } } } });

  assert.deepEqual(direct.times['4'], { dressage: '09:00' });
  assert.deepEqual(nested.times['5'], { marathon: '10:00' });
  assert.deepEqual(normalizePortalStartTimesConfig(null).times, {});
});

test('portal start times lookup normalizes start number keys', () => {
  const row = getPortalStartTimesForEquipage({ value: { times: { 7: { precision: '11:00' } } } }, 7);

  assert.deepEqual(row, { precision: '11:00' });
});

test('portal minutes to next start accepts timestamp, date and string values', () => {
  const now = Date.parse('2026-05-26T10:00:00.000Z');
  const minutes = getPortalMinutesToNextStart({
    times: {
      8: {
        precision: { seconds: (now + 45 * 60000) / 1000 },
        marathon: new Date(now + 60 * 60000),
        dressage: '2026-05-26T11:30:00.000Z'
      }
    }
  }, 8, now);

  assert.equal(minutes, 45);
  assert.equal(getPortalMinutesToNextStart({ times: {} }, 8, now), null);
});

test('portal timestamp formatting accepts Firestore, date, number and invalid values', () => {
  const options = { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' };

  assert.equal(formatPortalTimestamp({ seconds: 18000 }, 'sv-SE', options), '1970-01-01 05:00');
  assert.equal(formatPortalTimestamp(new Date('1970-01-01T05:00:00.000Z'), 'sv-SE', options), '1970-01-01 05:00');
  assert.equal(formatPortalTimestamp(18000000, 'sv-SE', options), '1970-01-01 05:00');
  assert.equal(formatPortalTimestamp(null, 'sv-SE', options), '');
});

test('portal timestamp sorting accepts mixed timestamp values', () => {
  const sorted = sortPortalItemsByTimestampDesc([
    { id: 'old', timestamp: { seconds: 10 } },
    { id: 'new', timestamp: new Date(20000) },
    { id: 'missing' }
  ]);

  assert.deepEqual(sorted.map(item => item.id), ['new', 'old', 'missing']);
});

test('portal discipline penalties prefer freshest discipline docs with computed fallback', () => {
  const penalties = resolvePortalDisciplinePenalties({
    computedResult: {
      dressage: { totalPenalty: 45 },
      marathon: { totalPenalty: 70 },
      precision: { totalPenalty: 9 }
    },
    dressagePenalty: 44,
    marathonTiming: { totalPenalty: 68 },
    precisionResult: { totalPenalty: 3 }
  });

  assert.deepEqual(penalties, { dRes: 45, mRes: 70, pRes: 3 });
});

test('portal discipline penalties fallback to calculated and timing values', () => {
  const penalties = resolvePortalDisciplinePenalties({
    computedResult: {},
    dressagePenalty: 44,
    marathonTiming: { totalPenalty: 68 },
    precisionResult: { liveTotalPenalty: 4 }
  });

  assert.deepEqual(penalties, { dRes: 44, mRes: 68, pRes: 4 });
});

test('portal discipline penalties preserve elimination markers', () => {
  const penalties = resolvePortalDisciplinePenalties({
    computedResult: {
      dressage: { totalPenalty: Infinity },
      marathon: { totalPenalty: 12, eliminated: true }
    },
    precisionResult: { totalPenalty: 8, eliminated: true }
  });

  assert.equal(penalties.dRes, Infinity);
  assert.equal(penalties.mRes, Infinity);
  assert.equal(penalties.pRes, Infinity);
});
