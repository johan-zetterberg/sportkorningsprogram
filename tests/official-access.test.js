import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import * as server from '../functions/src/adminJoin.js';
import * as client from '../js/utils/officialAccessUtils.js';
import { buildExportAuditEntry, canExportPersonalNumbers } from '../functions/src/competitionExport.js';
import {
  VolunteerSignupError,
  buildVolunteerSignupPayload,
  hasRecentSignup,
  isLikelyBotSignup,
  volunteerSignupResponse
} from '../functions/src/volunteerSignup.js';
import { VOLUNTEER_SIGNUP_LIMITS } from '../functions/src/rateLimit.js';
import { encodeQr, qrSvg } from '../lib/qrcode-svg.js';

const AMBIGUOUS = /[0O1Il]/;

test('role codes: 10 symbols from 32 without look-alikes, client and server alike', () => {
  assert.equal(server.ROLE_CODE_ALPHABET, client.ROLE_CODE_ALPHABET);
  assert.equal(server.ROLE_CODE_ALPHABET.length, 32);
  assert.equal(new Set(server.ROLE_CODE_ALPHABET).size, 32);
  assert.doesNotMatch(server.ROLE_CODE_ALPHABET, AMBIGUOUS);
  for (let i = 0; i < 200; i++) {
    const a = server.generateRoleCode(randomBytes);
    const b = client.generateRoleCode();
    for (const code of [a, b]) {
      assert.equal(code.length, 10);
      assert.doesNotMatch(code, AMBIGUOUS);
      assert.equal(server.isStrongRoleCode(code), true);
      assert.equal(client.isStrongRoleCode(code), true);
      // The rules' pattern accepts it too
      assert.match(code, /^[A-HJ-NP-Z2-9]{10,12}$/);
    }
  }
});

test('role codes are shown grouped and typed in any form', () => {
  assert.equal(server.formatRoleCode('ABCDEFGHJK'), 'ABCD-EFGH-JK');
  assert.equal(client.formatRoleCode('abcdefghjk'), 'ABCD-EFGH-JK');
  for (const typed of ['abcd-efgh-jk', ' ABCD EFGH JK ', 'AbCdEfGhJk', 'ABCD--EFGH-JK']) {
    assert.equal(server.normalizeRoleCode(typed), 'ABCDEFGHJK');
    assert.equal(client.normalizeRoleCode(typed), 'ABCDEFGHJK');
  }
  assert.equal(server.isStrongRoleCode('12345678'), false, 'old PINs are not strong');
  assert.equal(server.isStrongRoleCode('ABCDEFGHJ0'), false, 'look-alike 0');
});

test('the settings page replaces missing and short codes', () => {
  assert.deepEqual(client.rolesNeedingNewCode({
    accessCode_dressage: 'ABCDEFGHJK',
    accessCode_marathon: '12345678',
    accessCode_speaker: 'ABCD-EFGH-JK'
  }), ['marathon', 'precision', 'vet', 'td']);
});

test('codes expire after the given day, Swedish time', () => {
  // 2026-05-18 ends at 2026-05-18T22:00Z (summer time, UTC+2)
  const end = server.endOfDayStockholmMs('2026-05-18');
  assert.equal(new Date(end).toISOString(), '2026-05-18T22:00:00.000Z');
  // Winter time (UTC+1)
  assert.equal(new Date(server.endOfDayStockholmMs('2026-01-10')).toISOString(), '2026-01-10T23:00:00.000Z');
  const secrets = { accessCodesExpireAt: '2026-05-18' };
  assert.equal(server.roleCodesExpired(secrets, Date.parse('2026-05-18T21:59:59Z')), false);
  assert.equal(server.roleCodesExpired(secrets, Date.parse('2026-05-18T22:00:00Z')), true);
  assert.equal(server.roleCodesExpired({}, Date.now()), false, 'no date: no expiry');
  assert.equal(server.roleCodesExpired({ accessCodesExpireAt: null }), false);
  assert.equal(server.roleCodesExpired({ accessCodesExpireAt: 'nonsense' }), false);
});

test('default expiry: the day after the competition ends', () => {
  assert.equal(client.defaultCodeExpiryDate('2026-05-15 - 2026-05-17'), '2026-05-18');
  assert.equal(client.defaultCodeExpiryDate('2026-12-31'), '2027-01-01');
  assert.equal(client.defaultCodeExpiryDate('15-17 maj'), '');
  assert.deepEqual(client.competitionDays('2026-05-15 - 2026-05-17'), ['2026-05-15', '2026-05-16', '2026-05-17']);
  assert.deepEqual(client.competitionDays(''), []);
});

test('join links open the code dialog for a role with the competition filled in', () => {
  const link = client.buildRoleJoinLink('https://app.example.se/index.html?id=X#admin?tab=settings', 'Comp_1', 'marathon');
  assert.equal(link, 'https://app.example.se/index.html?id=Comp_1#portal?join=marathon');
  const url = new URL(link);
  assert.deepEqual(client.readJoinRequest({ search: url.search, hash: url.hash }), { competitionId: 'Comp_1', role: 'marathon' });
  assert.equal(client.readJoinRequest({ search: '', hash: '#portal?join=admin' }), null, 'no admin join by code');
  assert.deepEqual(client.readJoinRequest({ search: '?id=../x', hash: '#portal?join=vet' }), { competitionId: '', role: 'vet' });
});

test('only the owner or a global admin may export personal identity numbers', () => {
  const comp = { createdBy: 'owner', ownerId: 'owner2' };
  assert.equal(canExportPersonalNumbers({ uid: 'owner', competitionData: comp }), true);
  assert.equal(canExportPersonalNumbers({ uid: 'owner2', competitionData: comp }), true);
  assert.equal(canExportPersonalNumbers({ uid: 'g', token: { superadmin: true }, competitionData: comp }), true);
  assert.equal(canExportPersonalNumbers({ uid: 'g', userData: { role: 'admin' }, competitionData: comp }), true);
  assert.equal(canExportPersonalNumbers({ uid: 'g', userData: { roles: ['superadmin'] }, competitionData: comp }), true);
  // A competition admin (roleEmails, admins[], an admins/{uid} doc) is not enough
  assert.equal(canExportPersonalNumbers({ uid: 'compAdmin', competitionData: { ...comp, admins: ['compAdmin'] } }), false);
  assert.equal(canExportPersonalNumbers({ uid: '', token: { superadmin: true } }), false);

  const entry = buildExportAuditEntry({ uid: 'u1', email: ' A@B.se ', includePersonalNumbers: true, documentCount: 3, at: 5 });
  assert.deepEqual(entry, {
    source: 'exportCompetition', action: 'export', exportedBy: 'u1', exportedByEmail: 'a@b.se',
    includePersonalNumbers: true, documentCount: 3, exportedAt: 5
  });
});

const VALID = {
  name: 'Anna', phone: '070', email: 'Anna@Example.com', iceName: 'Bo', icePhone: '071',
  diet: 'Annat', dietOther: 'Nötallergi', availability: ['2026-05-15_fm', 'bad', '2026-05-16'],
  consent: true, elapsedMs: 5000
};

test('volunteer sign-up payload: diet choices, availability, consent', () => {
  const payload = buildVolunteerSignupPayload(VALID, 1000);
  assert.equal(payload.email, 'anna@example.com');
  assert.equal(payload.diet, 'Annat');
  assert.equal(payload.dietOther, 'Nötallergi');
  assert.deepEqual(payload.availability, ['2026-05-15_fm', '2026-05-16']);
  assert.equal(payload.status, 'new');
  assert.equal(payload.consent, true);
  assert.equal(buildVolunteerSignupPayload({ ...VALID, diet: 'Pizza', dietOther: 'x' }).diet, '');
  assert.equal(buildVolunteerSignupPayload({ ...VALID, diet: 'Vegansk', dietOther: 'x' }).dietOther, '');
  assert.throws(() => buildVolunteerSignupPayload({ ...VALID, consent: false }), VolunteerSignupError);
  assert.throws(() => buildVolunteerSignupPayload({ ...VALID, email: 'nope' }), VolunteerSignupError);
});

test('volunteer sign-up: honeypot and minimum fill time', () => {
  assert.equal(isLikelyBotSignup(VALID), false);
  assert.equal(isLikelyBotSignup({ ...VALID, website: 'http://spam' }), true);
  assert.equal(isLikelyBotSignup({ ...VALID, elapsedMs: 1200 }), true);
  assert.equal(isLikelyBotSignup({ ...VALID, elapsedMs: undefined }), true);
});

test('volunteer sign-up: the same answer whether or not the email signed up before', () => {
  const now = 10_000_000;
  assert.equal(hasRecentSignup([{ createdAt: now - 1000 }], now), true);
  assert.equal(hasRecentSignup([{ createdAt: now - 7 * 60 * 60 * 1000 }], now), false);
  // The answer has nothing that tells a duplicate apart
  assert.deepEqual(volunteerSignupResponse(), { accepted: true });
  assert.equal('duplicate' in volunteerSignupResponse(), false);
  assert.equal(VOLUNTEER_SIGNUP_LIMITS.perCompetition, 20);
  assert.equal(VOLUNTEER_SIGNUP_LIMITS.perCompetitionDay, 200);
});

test('QR codes: size grows with the text and the SVG has no text content', () => {
  assert.equal(encodeQr('A').length, 21);
  const link = client.buildRoleJoinLink('https://example.web.app/', 'HHm4tBR1K5aYGXv1DssB', 'marathon');
  const size = encodeQr(link).length;
  assert.ok(size >= 29 && size <= 57);
  const svg = qrSvg(link, { label: 'QR <x>' });
  assert.match(svg, /^<svg /);
  assert.doesNotMatch(svg, /<x>/);
  assert.throws(() => encodeQr('x'.repeat(400)));
});
