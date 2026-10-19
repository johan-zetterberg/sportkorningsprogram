import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompetitionAdminJoinPayload,
  checkPinAttempts,
  isValidCompetitionId,
  normalizeJoinEmail,
  normalizeJoinRoles,
  PIN_ATTEMPT_LIMITS,
  pinAttemptBucketId,
  planRoleRemoval,
  recordPinFailure,
  resolveJoinRoleForPin
} from '../functions/src/adminJoin.js';

test('code joining stops after 10 wrong codes per user within 15 minutes', () => {
  const minute = 60 * 1000;
  const t0 = 1_000_000_000;
  let user = null;
  for (let i = 0; i < 10; i++) {
    assert.equal(checkPinAttempts(user, null, t0 + i * minute).allowed, true, `attempt ${i + 1}`);
    user = recordPinFailure(user, PIN_ATTEMPT_LIMITS.perUser.windowMs, t0 + i * minute);
  }
  const locked = checkPinAttempts(user, null, t0 + 10 * minute);
  assert.equal(locked.allowed, false);
  assert.equal(locked.retryAfterMs, 5 * minute, 'until the first failure is 15 min old');

  // The window slides: after the oldest failure leaves it, one more try is allowed
  assert.equal(checkPinAttempts(user, null, t0 + 15 * minute).allowed, true);
  // Old failures are dropped when a new one is recorded
  assert.equal(recordPinFailure(user, PIN_ATTEMPT_LIMITS.perUser.windowMs, t0 + 60 * minute).failures.length, 1);
});

test('code joining stops for a role bucket after 200 wrong codes in an hour (unverified)', () => {
  const t0 = 2_000_000_000;
  const competition = { failures: Array.from({ length: 200 }, (_, i) => t0 + i * 1000) };
  // A fresh account (no failures of its own) is still refused
  assert.equal(checkPinAttempts(null, competition, t0 + 300 * 1000).allowed, false);
  assert.equal(checkPinAttempts(null, competition, t0 + 61 * 60 * 1000 + 300 * 1000).allowed, true);
});

test('a verified email has the higher cap; an invited official is not held by the shared cap', () => {
  const t0 = 2_000_000_000;
  const competition = { failures: Array.from({ length: 200 }, (_, i) => t0 + i * 1000) };
  assert.equal(checkPinAttempts(null, competition, t0 + 300 * 1000, PIN_ATTEMPT_LIMITS, { emailVerified: true }).allowed, true);
  const flood = { failures: Array.from({ length: 1000 }, (_, i) => t0 + i * 1000) };
  assert.equal(checkPinAttempts(null, flood, t0 + 1100 * 1000, PIN_ATTEMPT_LIMITS, { emailVerified: true }).allowed, false);
  // Invited by email (roleEmails / officials register): the flood does not lock them out
  assert.equal(checkPinAttempts(null, flood, t0 + 1100 * 1000, PIN_ATTEMPT_LIMITS, { emailVerified: true, invited: true }).allowed, true);
  // ...but their own limit still applies
  const own = { failures: Array.from({ length: 10 }, (_, i) => t0 + i * 1000) };
  assert.equal(checkPinAttempts(own, null, t0 + 20 * 1000, PIN_ATTEMPT_LIMITS, { emailVerified: true, invited: true }).allowed, false);
});

test('the shared counter is per competition and per role named by the join link', () => {
  assert.equal(pinAttemptBucketId('C1', 'marathon'), 'C1__role__marathon');
  assert.equal(pinAttemptBucketId('C1', ''), 'C1__role__any');
  assert.equal(pinAttemptBucketId('C1', 'admin'), 'C1__role__any', 'admin is not a code role');
  assert.equal(pinAttemptBucketId('C1', '../x'), 'C1__role__any');
});

test('competition ids from clients must be a single document id', () => {
  assert.equal(isValidCompetitionId('HHm4tBR1K5aYGXv1DssB'), true);
  assert.equal(isValidCompetitionId('demo-e2e_123'), true);
  assert.equal(isValidCompetitionId('X/equipages/12'), false);
  assert.equal(isValidCompetitionId('..'), false);
  assert.equal(isValidCompetitionId(''), false);
  assert.equal(isValidCompetitionId(42), false);
});

test('resolveJoinRoleForPin matches role codes in any case, with or without dashes', () => {
  const secrets = {
    accessCode: '12345678',
    accessCode_dressage: 'ABCDEFGHJK',
    accessCode_marathon: 'MNPQRSTUVW',
    accessCode_precision: '23456789AB',
    accessCode_speaker: 'XYZ2345678',
    accessCode_vet: '87654321'
  };

  assert.equal(resolveJoinRoleForPin('XYZ2-3456-78', secrets), 'speaker');
  assert.equal(resolveJoinRoleForPin('abcd efgh jk', secrets), 'dressage');
  assert.equal(resolveJoinRoleForPin('mnpq-rstu-vw', secrets), 'marathon');
  assert.equal(resolveJoinRoleForPin('WRONGCODE2', secrets), null);
  // An old 8-digit role PIN no longer works (the settings page replaces it)
  assert.equal(resolveJoinRoleForPin('87654321', secrets), null);
  // The old admin PIN is recognised only to be refused by the server
  assert.equal(resolveJoinRoleForPin('12345678', secrets), 'admin');
  assert.equal(resolveJoinRoleForPin('', secrets), null);
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

test('buildCompetitionAdminJoinPayload merges existing roles without storing code data', () => {
  const payload = buildCompetitionAdminJoinPayload(
    { role: 'speaker', roles: ['speaker'], joinedAtByRole: { speaker: 5 } },
    'dressage',
    ' Official@Example.com ',
    1234567890,
    ' Anna Andersson '
  );

  assert.deepEqual(payload, {
    email: 'official@example.com',
    joinedAt: 1234567890,
    joinedAtByRole: { speaker: 5, dressage: 1234567890 },
    name: 'Anna Andersson',
    role: 'dressage',
    roles: ['speaker', 'dressage']
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'accessCode'), false);
});

test('planRoleRemoval takes one role away and deletes the doc when none is left', () => {
  assert.deepEqual(planRoleRemoval({ role: 'speaker', roles: ['speaker'] }, 'speaker'), { delete: true });
  assert.deepEqual(
    planRoleRemoval({ role: 'dressage', roles: ['speaker', 'dressage'], joinedAtByRole: { speaker: 1, dressage: 2 } }, 'speaker'),
    { update: { roles: ['dressage'], role: 'dressage', joinedAtByRole: { dressage: 2 } } }
  );
  assert.equal(planRoleRemoval({ roles: ['vet'] }, 'speaker'), null);
  // A doc without role fields was an admin PIN join
  assert.deepEqual(planRoleRemoval({ email: 'x@example.com' }, 'admin'), { delete: true });
});
