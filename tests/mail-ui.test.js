import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAIL_SUBJECT_MAX,
    MAIL_TEXT_MAX,
    buildMessageMailPayload,
    buildStartTimeMailChanges,
    mailKindKey,
    mailStatusKey,
    mailStatusTone,
    messageModeToMailAudience,
    normalizeEmailSettingsInput,
    replyToState,
    summarizePreview
} from '../js/utils/mailUtils.js';
import { t } from '../js/utils/i18n.js';

test('message form audiences map to mail audiences', () => {
    assert.deepEqual(messageModeToMailAudience('public'), { drivers: { all: true } });
    assert.deepEqual(messageModeToMailAudience('drivers'), { drivers: { all: true } });
    assert.deepEqual(messageModeToMailAudience('selected_drivers', { selectedDrivers: ['3', ' 5 ', '3', ''] }), { drivers: { startNumbers: ['3', '5'] } });
    assert.equal(messageModeToMailAudience('selected_drivers', { selectedDrivers: [] }), null);
    assert.deepEqual(messageModeToMailAudience('officials'), { officials: { all: true } });
    assert.deepEqual(messageModeToMailAudience('official:vet'), { officials: { roles: ['vet'] } });
    assert.deepEqual(messageModeToMailAudience('official:dressage'), { officials: { roles: ['dressage', 'judge'] } });
    assert.equal(messageModeToMailAudience('official:nope'), null);
    assert.equal(messageModeToMailAudience('weird'), null);
});

test('message mail payload clamps to the server limits and sets the category', () => {
    const payload = buildMessageMailPayload({
        competitionId: 'c1', title: 'T'.repeat(300), body: 'B'.repeat(15000), bodyEn: 'E'.repeat(15000),
        mode: 'drivers', essential: true
    });
    assert.equal(payload.kind, 'message');
    assert.equal(payload.category, 'essential');
    assert.equal(payload.subject.length, MAIL_SUBJECT_MAX);
    assert.equal(payload.text.length, MAIL_TEXT_MAX);
    assert.equal(buildMessageMailPayload({ competitionId: 'c1', title: 'a', body: 'b', mode: 'official:zzz' }), null);
    const info = buildMessageMailPayload({ competitionId: 'c1', title: 'a', body: 'b', bodyEn: 'c', mode: 'officials' });
    assert.equal(info.category, 'info');
    assert.match(info.text, /^b\n\n---\n\nc$/);
});

test('status and kind labels exist in sv and en', () => {
    for (const status of ['queued', 'sending', 'sent', 'partial', 'failed', 'not_configured', 'blocked', 'mystery']) {
        assert.ok(t(mailStatusKey(status)), status);
    }
    for (const kind of ['message', 'test', 'startTimeChange', 'vetDecision', 'volunteerConfirmation', 'declarationChange', 'replyToVerification', 'x']) {
        assert.ok(t(mailKindKey(kind)), kind);
    }
    assert.equal(mailStatusKey('not_configured'), 'mail_status_not_configured');
    assert.equal(mailStatusTone('sent'), 'ok');
    assert.equal(mailStatusTone('failed'), 'bad');
    assert.equal(mailStatusTone('not_configured'), 'wait');
});

test('start time changes become one entry per start number', () => {
    const tr = (key) => ({ starttime_none: '-', starttime_discipline_dressage: 'Dressyr', starttime_discipline_marathon: 'Maraton' }[key] || key);
    const out = buildStartTimeMailChanges([
        { startNumber: '4', discipline: 'dressage', from: '2026-05-01T09:00', to: '2026-05-01T09:15' },
        { startNumber: '4', discipline: 'marathon', from: '', to: '2026-05-02T10:00' },
        { startNumber: '7', discipline: 'dressage', from: '2026-05-01T09:30', to: '' }
    ], tr, 'sv');
    assert.equal(out.length, 2);
    assert.equal(out[0].startNumber, '4');
    assert.equal(out[0].text, 'Dressyr: 09:00 → 09:15\nMaraton: - → 10:00');
    assert.equal(out[1].text, 'Dressyr: 09:30 → -');
});

test('preview summary and reply-to state', () => {
    assert.deepEqual(summarizePreview({ recipientCount: 5, optedOutCount: 2, withoutEmail: [{ type: 'driver', id: '1' }], unknownStartNumbers: [] }),
        { recipients: 5, optedOut: 2, withoutEmail: 1, unknown: 0 });
    assert.equal(summarizePreview(null), null);
    assert.equal(replyToState({}), 'none');
    assert.equal(replyToState({ replyTo: 'a@b.se' }), 'unverified');
    assert.equal(replyToState({ replyTo: 'A@b.se', replyToVerifiedAddress: 'a@B.se' }), 'verified');
    assert.equal(replyToState({ replyTo: 'new@b.se', replyToVerifiedAddress: 'a@b.se' }), 'unverified');
});

test('settings input never carries the verified fields and is clamped', () => {
    const out = normalizeEmailSettingsInput({ senderName: 'x'.repeat(100), replyTo: ' A@B.se ', signature: 'y'.repeat(2000), replyToVerifiedAddress: 'a@b.se', autoVetDecisionMail: true });
    assert.equal(out.senderName.length, 60);
    assert.equal(out.replyTo, 'a@b.se');
    assert.equal(out.signature.length, 1000);
    assert.equal(out.autoVetDecisionMail, true);
    assert.equal(out.autoVolunteerConfirmation, false);
    assert.equal('replyToVerifiedAddress' in out, false);
});
