import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrivacyNotice, organiserFromCompetition } from '../js/content/privacyNotice.js';
import { isDeletionConfirmed, parseRetentionMonths, personExportFileName } from '../js/utils/personalDataUtils.js';

const REQUIRED_SECTIONS = ['controller', 'processor', 'purposes', 'public', 'retention', 'rights', 'delete-account'];

test('privacy notice has every Art. 13 section in Swedish and English', () => {
  for (const lang of ['sv', 'en']) {
    const sections = buildPrivacyNotice(lang, null);
    assert.deepEqual(sections.map((s) => s.id), REQUIRED_SECTIONS, lang);
    sections.forEach((s) => {
      assert.ok(s.title, `${lang} ${s.id} title`);
      assert.ok((s.paragraphs || []).length + (s.items || []).length > 0, `${lang} ${s.id} text`);
    });
    const text = JSON.stringify(sections);
    assert.match(text, /europe-west1/);
    assert.match(text, /12/);
  }
});

test('privacy notice names the organiser and its retention when opened for a competition', () => {
  const organiser = organiserFromCompetition(
    { name: 'Vårtävlingen', club: 'Körklubben', retentionMonths: 6 },
    { organizer: 'Körklubben Syd', email: 'info@syd.se', phone: '070' }
  );
  assert.deepEqual(organiser, { name: 'Körklubben Syd', contact: 'info@syd.se, 070', competitionName: 'Vårtävlingen', retentionMonths: 6 });
  const sv = JSON.stringify(buildPrivacyNotice('sv', organiser));
  assert.match(sv, /Körklubben Syd \(info@syd\.se, 070\)/);
  assert.match(sv, /6 månader/);
  // The privacy contact setting wins; an invalid retention falls back to 12
  const withContact = organiserFromCompetition({ club: 'K', privacyContact: 'gdpr@k.se', retentionMonths: 0 });
  assert.equal(withContact.contact, 'gdpr@k.se');
  assert.equal(withContact.retentionMonths, 12);
  assert.equal(organiserFromCompetition(null), null);
});

test('account deletion needs the account email typed', () => {
  assert.equal(isDeletionConfirmed(' Anna@Ex.se ', 'anna@ex.se'), true);
  assert.equal(isDeletionConfirmed('anna@ex.s', 'anna@ex.se'), false);
  assert.equal(isDeletionConfirmed('', ''), false);
});

test('retention months input and export file name', () => {
  assert.equal(parseRetentionMonths('24'), 24);
  assert.equal(parseRetentionMonths(' 1 '), 1);
  assert.equal(parseRetentionMonths('0'), null);
  assert.equal(parseRetentionMonths('121'), null);
  assert.equal(parseRetentionMonths('6.5'), null);
  assert.equal(parseRetentionMonths('abc'), null);
  assert.equal(personExportFileName('Anna+x@Ex.se', new Date('2026-10-19T10:00:00Z')), 'registerutdrag_anna_x_ex.se_2026-10-19.json');
});
