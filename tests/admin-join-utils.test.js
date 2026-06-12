import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompetitionAdminJoinPayload,
  normalizeJoinEmail,
  normalizeJoinRoles,
  resolveJoinRoleForPin
} from '../functions/src/adminJoin.js';

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
