import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatOfficialCheckInTime,
  normalizeOfficialTimestamp
} from '../js/pages/admin/adminOfficialDateUtils.js';

test('normalizeOfficialTimestamp accepts Firestore timestamp-like objects', () => {
  const date = normalizeOfficialTimestamp({ seconds: 3600, nanoseconds: 0 });

  assert.equal(date.toISOString(), '1970-01-01T01:00:00.000Z');
});

test('normalizeOfficialTimestamp accepts Firestore Timestamp with toDate', () => {
  const date = normalizeOfficialTimestamp({
    toDate: () => new Date('2026-06-02T09:30:00.000Z')
  });

  assert.equal(date.toISOString(), '2026-06-02T09:30:00.000Z');
});

test('normalizeOfficialTimestamp rejects invalid values', () => {
  assert.equal(normalizeOfficialTimestamp('not a date'), null);
  assert.equal(normalizeOfficialTimestamp(null), null);
});

test('formatOfficialCheckInTime formats valid timestamps and hides invalid values', () => {
  // Local time of the device (CI runs in UTC, the app in Sweden)
  const at = new Date('2026-06-02T09:30:00.000Z');
  const expected = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  assert.equal(formatOfficialCheckInTime(at, 'sv-SE'), expected);
  assert.equal(formatOfficialCheckInTime('not a date', 'sv-SE'), '');
});
