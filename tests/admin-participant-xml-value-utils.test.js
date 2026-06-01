import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateImportedHorseAge,
  isAdministrativeFeeClass,
  normalizeTdbClassNumber,
  normalizeXmlNumber,
  resolveImportedEntryStatus,
  resolveImportedPaymentStatus
} from '../js/pages/admin/adminParticipantXmlValueUtils.js';

test('normalizeXmlNumber accepts comma decimals and rejects invalid input', () => {
  assert.equal(normalizeXmlNumber(' 1 234,50 '), 1234.5);
  assert.equal(normalizeXmlNumber('12.9', { integer: true }), 12);
  assert.equal(normalizeXmlNumber('abc'), null);
  assert.equal(normalizeXmlNumber(''), null);
});

test('tdb class number helpers normalize positive class numbers', () => {
  assert.equal(normalizeTdbClassNumber('12'), 12);
  assert.equal(normalizeTdbClassNumber('0'), null);
  assert.equal(normalizeTdbClassNumber('abc'), null);
  assert.equal(isAdministrativeFeeClass('901'), true);
  assert.equal(isAdministrativeFeeClass('900'), false);
});

test('imported status and payment helpers normalize common TDB variants', () => {
  assert.equal(resolveImportedEntryStatus('WITHDRAWN'), 'struken');
  assert.equal(resolveImportedEntryStatus('removed'), 'struken');
  assert.equal(resolveImportedEntryStatus('PAID'), 'anmÃ¤ld');

  assert.equal(resolveImportedPaymentStatus('PAID', null), 'paid');
  assert.equal(resolveImportedPaymentStatus('', '100,50'), 'paid');
  assert.equal(resolveImportedPaymentStatus('', '0'), '');
});

test('calculateImportedHorseAge validates plausible birth years', () => {
  assert.equal(calculateImportedHorseAge('2018', 2026), 8);
  assert.equal(calculateImportedHorseAge('3020', 2026), '');
  assert.equal(calculateImportedHorseAge('abc', 2026), '');
});
