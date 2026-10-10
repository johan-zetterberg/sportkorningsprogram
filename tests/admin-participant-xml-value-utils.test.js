import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateImportedHorseAge,
  isAdministrativeFeeClass,
  normalizeTdbClassNumber,
  normalizeXmlNumber,
  resolveImportedEntryStatus,
  resolveImportedPaymentStatus,
  extractTrackWidthsFromTexts,
  isSingleHarness,
  buildEquipageImportKey,
  annotateMultipleDriverStarts
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
  assert.equal(resolveImportedEntryStatus('PAID'), 'anmäld');

  assert.equal(resolveImportedPaymentStatus('PAID', null), 'paid');
  assert.equal(resolveImportedPaymentStatus('', '100,50'), 'paid');
  assert.equal(resolveImportedPaymentStatus('', '0'), '');
});

test('calculateImportedHorseAge validates plausible birth years', () => {
  assert.equal(calculateImportedHorseAge('2018', 2026), 8);
  assert.equal(calculateImportedHorseAge('3020', 2026), '');
  assert.equal(calculateImportedHorseAge('abc', 2026), '');
});

test('extractTrackWidthsFromTexts extracts trackWidth and marathonTrackWidth from various notes', () => {
  // Case 1: Standard spårvidd
  assert.deepEqual(extractTrackWidthsFromTexts(['Spårvidd: 138 cm']), { trackWidth: 138, marathonTrackWidth: null });

  // Case 2: Vagn och maraton
  assert.deepEqual(extractTrackWidthsFromTexts(['Vagnbredd 138 cm, maraton 125 cm']), { trackWidth: 138, marathonTrackWidth: 125 });

  // Case 3: Snedstrecksformat
  assert.deepEqual(extractTrackWidthsFromTexts(['138 / 126 cm']), { trackWidth: 138, marathonTrackWidth: 126 });

  // Case 4: Delat i flera fält (ryttarkommentar + hästkommentar)
  assert.deepEqual(extractTrackWidthsFromTexts(['Delar groom med Bengt', 'Vagn: 142cm, maratonvagn 128cm']), { trackWidth: 142, marathonTrackWidth: 128 });

  // Case 5: Inget mått
  assert.deepEqual(extractTrackWidthsFromTexts(['Ingen info']), { trackWidth: null, marathonTrackWidth: null });
});

test('isSingleHarness correctly identifies single vs team harness', () => {
  assert.equal(isSingleHarness('Svår Häst Enbet'), true);
  assert.equal(isSingleHarness('Lätt B Ponny Enbet'), true);
  assert.equal(isSingleHarness('Medelsvår Häst Par'), false);
  assert.equal(isSingleHarness('Svår Ponny Fyrspann'), false);
  assert.equal(isSingleHarness('Msv Tandem'), false);
  assert.equal(isSingleHarness('LB'), true); // default till enbet
});

test('buildEquipageImportKey separates single horse starts and groups team horses', () => {
  // Enbet: två hästar i samma klass får skilda nycklar
  const k1 = buildEquipageImportKey({ driverName: 'Anna', classNumber: '1', horseName: 'Thunder', className: 'Svår Enbet' });
  const k2 = buildEquipageImportKey({ driverName: 'Anna', classNumber: '1', horseName: 'Lightning', className: 'Svår Enbet' });
  assert.notEqual(k1, k2);
  assert.equal(k1, 'Anna|1|Thunder');
  assert.equal(k2, 'Anna|1|Lightning');

  // Par: två hästar i samma klass delar samma nyckel
  const p1 = buildEquipageImportKey({ driverName: 'Bengt', classNumber: '2', horseName: 'Star 1', className: 'Svår Par' });
  const p2 = buildEquipageImportKey({ driverName: 'Bengt', classNumber: '2', horseName: 'Star 2', className: 'Svår Par' });
  assert.equal(p1, p2);
  assert.equal(p1, 'Bengt|2');
});

test('annotateMultipleDriverStarts identifies and annotates multi-start drivers', () => {
  const equipages = [
    { startNumber: 1, driverName: 'Anna Andersson', className: 'Svår Enbet', horses: [{ name: 'Thunder' }] },
    { startNumber: 2, driverName: 'Bengt Bengtsson', className: 'Svår Par', horses: [{ name: 'Star 1' }] },
    { startNumber: 3, driverName: 'Anna Andersson', className: 'Lätt B Enbet', horses: [{ name: 'Lightning' }] }
  ];

  const annotated = annotateMultipleDriverStarts(equipages);
  assert.equal(annotated[0].hasMultipleStarts, true);
  assert.equal(annotated[0].driverStartCount, 2);
  assert.equal(annotated[0].driverOtherStarts.length, 1);
  assert.equal(annotated[0].driverOtherStarts[0].startNumber, 3);

  assert.equal(annotated[1].hasMultipleStarts, false);
  assert.equal(annotated[1].driverStartCount, 1);

  assert.equal(annotated[2].hasMultipleStarts, true);
  assert.equal(annotated[2].driverOtherStarts[0].startNumber, 1);
});
