import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompetitionAdminJoinPayload,
  checkPinAttempts,
  isValidCompetitionId,
  normalizeJoinEmail,
  normalizeJoinRoles,
  PIN_ATTEMPT_LIMITS,
  recordPinFailure,
  resolveJoinRoleForPin
} from '../functions/src/adminJoin.js';

test('PIN joining stops after 5 wrong PINs per user within 15 minutes', () => {
  const minute = 60 * 1000;
  const t0 = 1_000_000_000;
  let user = null;
  for (let i = 0; i < 5; i++) {
    assert.equal(checkPinAttempts(user, null, t0 + i * minute).allowed, true, `attempt ${i + 1}`);
    user = recordPinFailure(user, PIN_ATTEMPT_LIMITS.perUser.windowMs, t0 + i * minute);
  }
  const locked = checkPinAttempts(user, null, t0 + 5 * minute);
  assert.equal(locked.allowed, false);
  assert.equal(locked.retryAfterMs, 10 * minute, 'until the first failure is 15 min old');

  // The window slides: after the oldest failure leaves it, one more try is allowed
  assert.equal(checkPinAttempts(user, null, t0 + 15 * minute).allowed, true);
  // Old failures are dropped when a new one is recorded
  assert.equal(recordPinFailure(user, PIN_ATTEMPT_LIMITS.perUser.windowMs, t0 + 60 * minute).failures.length, 1);
});

test('PIN joining stops for the whole competition after 100 wrong PINs in an hour', () => {
  const t0 = 2_000_000_000;
  const competition = { failures: Array.from({ length: 100 }, (_, i) => t0 + i * 1000) };
  // A fresh account (no failures of its own) is still refused
  assert.equal(checkPinAttempts(null, competition, t0 + 200 * 1000).allowed, false);
  assert.equal(checkPinAttempts(null, competition, t0 + 61 * 60 * 1000).allowed, true);
});

test('competition ids from clients must be a single document id', () => {
  assert.equal(isValidCompetitionId('HHm4tBR1K5aYGXv1DssB'), true);
  assert.equal(isValidCompetitionId('demo-e2e_123'), true);
  assert.equal(isValidCompetitionId('X/equipages/12'), false);
  assert.equal(isValidCompetitionId('..'), false);
  assert.equal(isValidCompetitionId(''), false);
  assert.equal(isValidCompetitionId(42), false);
});

test('resolveJoinRoleForPin finds the matching role from secret config', () => {
  const secrets = {
    accessCode: 'admin-pin',
    accessCode_dressage: 'dressage-pin',
    accessCode_marathon: 'marathon-pin',
    accessCode_precision: 'precision-pin',
    accessCode_speaker: 'speaker-pin'
  };

  assert.equal(resolveJoinRoleForPin('speaker-pin', secrets), 'speaker');
  assert.equal(resolveJoinRoleForPin('admin-pin', secrets), 'admin');
  assert.equal(resolveJoinRoleForPin('wrong-pin', secrets), null);
});

test('normalizeJoinEmail lowercases and trims user email', () => {
  assert.equal(normalizeJoinEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(normalizeJoinEmail(null), '');
});

test('normalizeJoinRoles keeps only supported unique roles', () => {
  assert.deepEqual(
    normalizeJoinRoles(['speaker', 'speaker', 'invalid'], 'dressage'),
    ['speaker', 'dressage']
  );
});

test('buildCompetitionAdminJoinPayload merges existing roles without storing PIN data', () => {
  const payload = buildCompetitionAdminJoinPayload(
    { role: 'speaker', roles: ['speaker'] },
    'dressage',
    ' Official@Example.com ',
    1234567890
  );

  assert.deepEqual(payload, {
    email: 'official@example.com',
    joinedAt: 1234567890,
    role: 'dressage',
    roles: ['speaker', 'dressage']
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'accessCode'), false);
});
