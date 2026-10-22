// Communication fixes from review 2 (2026-10-22): "Viktigt" as an essential
// push, the vet's and the drivers' topics, the TD audience, pauses to drivers,
// one notice per save of changed start times (request id, per-driver tag,
// English lines), the vet's withdrawn strike, the staff's vet texts, the
// drive-off call-up, message updates and the pause log without names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PAUSE_PUSH_AUDIENCE,
    buildAudienceMatcher,
    buildDriverPauseContent,
    buildMessageUpdateContent,
    buildPauseContent,
    buildStaffIndex,
    buildStartTimeContent,
    buildVetDecisionContent,
    buildVetStaffContent,
    expandAudienceRoles,
    messagePushAudience,
    messagePushCategory,
    messageUpdateNoticeId,
    normalizeRequestId,
    normalizeStartTimeChanges,
    startTimePushTag
} from '../functions/src/push/pushCore.js';
import { buildRecipientMessage, normalizePersonalTexts } from '../functions/src/mail/mailCore.js';
import { buildVetDecisionDriverMessage, canSendVetNotice, vetDecisionMailContent, vetDecisionNoticeKey } from '../functions/src/vetDecisionNotify.js';
import { anonymizePauseLog } from '../functions/src/personalData.js';
import { configChangeAffectsResults, pauseLogForResults, resultSettingsFingerprint } from '../functions/src/resultRecalculationUtils.js';
import { changedPauseWindows } from '../functions/src/triggerFilters.js';
import { initialTopics, pushRoleForRoles, topicsForRole } from '../js/utils/pushPanelUtils.js';
import { OFFICIAL_ROLE_KEYS, buildMessageAudience, isMessageForOfficial, viewerOfficialRoleKeys } from '../js/utils/messageAudience.js';
import {
    buildMessageMailPayload,
    buildStartTimeNoticeChanges,
    messageCategoryForType,
    messageModeToMailAudience,
    newNoticeRequestId
} from '../js/utils/mailUtils.js';
import { mailCountLine, pushCountLine } from '../js/utils/notifyChannelsUtils.js';
import { buildVetStrikeWithdrawal, gateVetStrikePayload } from '../js/services/vetDecisionUtils.js';
import { buildDriveOffMessages, canCallDriveOff, driveOffCallUpGroups } from '../js/pages/precision/precisionDriveOffNoticeUtils.js';
import { officialRoleKeysOf } from '../js/utils/contactLists.js';

test('"Viktigt / varning" is an essential push and essential mail; info otherwise', () => {
    assert.equal(messagePushCategory({ type: 'alert' }), 'essential', 'older messages store only the type');
    assert.equal(messagePushCategory({ category: 'essential' }), 'essential');
    assert.equal(messagePushCategory({ type: 'info' }), 'info');
    assert.equal(messagePushCategory({}), 'info');
    assert.equal(messageCategoryForType('alert'), 'essential');
    assert.equal(messageCategoryForType('info'), 'info');
    const mail = buildMessageMailPayload({ competitionId: 'c', title: 'Bana', body: 'Ny väg', mode: 'drivers', essential: true, reason: 'Ändrad bana' });
    assert.equal(mail.category, 'essential');
    assert.equal(mail.reason, 'Ändrad bana');
});

test('topics per role: the vet has its own set; drivers follow pauses; the server audiences match', () => {
    assert.equal(pushRoleForRoles(['vet']), 'vet');
    assert.deepEqual(topicsForRole('vet').sort(), ['declarationChanges', 'messages', 'pause', 'vetDecision']);
    assert.deepEqual(initialTopics('vet', []).sort(), ['declarationChanges', 'messages', 'pause', 'vetDecision']);
    assert.ok(topicsForRole('driver').includes('pause'));
    assert.ok(initialTopics('driver', []).includes('pause'));
    // The vet's devices are in the vet decision / declaration audiences
    // (officials roles admin, td, vet) and the pause audience
    const staff = buildStaffIndex({ admins: [{ id: 'v1', data: { roles: ['vet'] } }] });
    const vetAudience = buildAudienceMatcher({ audience: { officials: { roles: ['admin', 'td', 'vet'] } }, staff });
    assert.equal(vetAudience({ uid: 'v1' })?.as, 'official');
    const pause = buildAudienceMatcher({
        audience: PAUSE_PUSH_AUDIENCE,
        driverRecipients: [{ email: 'anna@ex.se', startNumbers: ['4'] }],
        staff
    });
    assert.equal(pause({ uid: 'v1' })?.as, 'official');
});

test('pause pushes reach drivers with a short text of their own', async () => {
    const { emailHash } = await import('../functions/src/mail/mailCore.js');
    const matcher = buildAudienceMatcher({ audience: PAUSE_PUSH_AUDIENCE, driverRecipients: [{ email: 'anna@ex.se', startNumbers: ['4'] }] });
    assert.deepEqual(matcher({ uid: 'x', emailHash: emailHash('anna@ex.se') }), { as: 'driver', startNumbers: ['4'] });
    const entry = { start: '2026-05-16T08:05:00.000Z', reason: 'weather', note: 'Kusk #12 skadad', where: 'obstacle:3' };
    const sv = buildDriverPauseContent('start', entry, 'sv');
    assert.equal(sv.title, 'Tävlingen är pausad: Väder');
    assert.ok(!JSON.stringify(sv).includes('skadad'), 'the official\'s note stays with the officials');
    assert.equal(buildDriverPauseContent('start', entry, 'en').title, 'The competition is paused: Weather');
    assert.equal(buildDriverPauseContent('end', { ...entry, end: '2026-05-16T08:17:00.000Z' }, 'sv').title, 'Tävlingen fortsätter');
    assert.equal(buildDriverPauseContent('end', {}, 'en').title, 'The competition continues');
    assert.equal(buildDriverPauseContent('start', {}, 'sv').title, 'Tävlingen är pausad');
    // The officials keep the details; drivers get theirs through the same builder
    assert.match(buildPauseContent('start', entry, 'sv', 'official').body, /skadad/);
    assert.deepEqual(buildPauseContent('start', entry, 'sv', 'driver'), sv);
});

test('audiences: the secretariat reaches the TD; the TD has its own audience (app, push, mail)', () => {
    assert.ok(OFFICIAL_ROLE_KEYS.includes('td'));
    assert.deepEqual(expandAudienceRoles(['secretariat']).sort(), ['admin', 'secretariat', 'td']);
    assert.deepEqual(expandAudienceRoles(['td', 'vet']), ['td', 'vet']);
    const tdMessage = buildMessageAudience('official:td');
    assert.deepEqual(tdMessage.audience.officialRoles, ['td']);
    assert.deepEqual(messagePushAudience(tdMessage), { officials: { roles: ['td'] } });
    assert.equal(isMessageForOfficial(tdMessage, viewerOfficialRoleKeys(['td'])), true);
    assert.equal(isMessageForOfficial(tdMessage, viewerOfficialRoleKeys(['admin'])), false);
    const secretariat = buildMessageAudience('official:secretariat');
    assert.equal(isMessageForOfficial(secretariat, viewerOfficialRoleKeys(['td'])), true);
    // Push: a TD account matches a secretariat message
    const staff = buildStaffIndex({ admins: [{ id: 'td1', data: { roles: ['td'] } }, { id: 'm1', data: { roles: ['marathon'] } }] });
    const matcher = buildAudienceMatcher({ audience: messagePushAudience(secretariat), staff });
    assert.equal(matcher({ uid: 'td1' })?.as, 'official');
    assert.equal(matcher({ uid: 'm1' }), null);
    // Mail
    assert.deepEqual(messageModeToMailAudience('official:td'), { officials: { roles: ['td'] } });
    assert.deepEqual(messageModeToMailAudience('official:secretariat'), { officials: { roles: ['secretariat', 'td'] } });
    // Contact lists: the TD by system role or by label
    assert.deepEqual(officialRoleKeysOf({ roles: ['td'] }), ['td']);
    assert.ok(officialRoleKeysOf({ role: 'Domarkollegiets ordförande' }).includes('td'));
});

test('one request id per save: checked ids, a per-driver tag, update notices once per id', () => {
    const id = newNoticeRequestId();
    assert.equal(normalizeRequestId(id), id);
    assert.notEqual(newNoticeRequestId(), id);
    assert.match(newNoticeRequestId(null), /^[A-Za-z0-9]{12,}$/, 'without crypto.randomUUID');
    assert.equal(normalizeRequestId('short'), null);
    assert.equal(normalizeRequestId('../../etc/passwd'), null);
    assert.equal(normalizeRequestId('a'.repeat(65)), null);
    assert.equal(startTimePushTag(['7', '3'], 'abcdef1234567890'), 'start-time-3-7-abcdef123456');
    assert.notEqual(startTimePushTag(['3'], 'req1aaaa'), startTimePushTag(['3'], 'req2bbbb'), 'two saves do not replace each other');
    assert.notEqual(startTimePushTag(['3'], 'req1aaaa'), startTimePushTag(['4'], 'req1aaaa'), 'nor two drivers');
    assert.ok(startTimePushTag(Array.from({ length: 40 }, (_, i) => String(i)), 'x'.repeat(64)).length <= 64);
    assert.equal(messageUpdateNoticeId({}, { updateNotice: 'upd12345' }), 'upd12345');
    assert.equal(messageUpdateNoticeId({ updateNotice: 'upd12345' }, { updateNotice: 'upd12345' }), null, 'an edit without a new id sends nothing');
    assert.equal(messageUpdateNoticeId({}, { title: 'x' }), null);
    assert.deepEqual(buildMessageUpdateContent({ title: 'Lunch', titleEn: 'Lunch break', body: 'Kl 12' }, 'en'), { title: 'Updated: Lunch break', body: 'Kl 12' });
    assert.equal(buildMessageUpdateContent({ title: 'Lunch' }, 'sv').title, 'Uppdaterat: Lunch');
    assert.equal(buildMessageMailPayload({ competitionId: 'c', title: 'Lunch', body: 'Kl 12', mode: 'drivers', update: true }).subject, 'Uppdaterat: Lunch');
});

test('changed start times: Swedish and English lines per start number, one notice per driver with all theirs', () => {
    const tr = (key, lang) => ({
        starttime_discipline_dressage: lang === 'en' ? 'Dressage' : 'Dressyr',
        starttime_discipline_marathon: lang === 'en' ? 'Marathon' : 'Maraton',
        starttime_none: '–'
    }[key] || key);
    const changes = [
        { startNumber: '3', discipline: 'dressage', from: '2026-05-16T09:10', to: '2026-05-16T09:30' },
        { startNumber: '3', discipline: 'marathon', from: '2026-05-17T12:00', to: '2026-05-17T12:20' },
        { startNumber: '8', discipline: 'dressage', from: '2026-05-16T10:00', to: '2026-05-16T10:10' }
    ];
    const lines = buildStartTimeNoticeChanges(changes, tr);
    assert.deepEqual(lines, [
        { startNumber: '3', text: 'Dressyr: 09:10 → 09:30\nMaraton: 12:00 → 12:20', textEn: 'Dressage: 09:10 → 09:30\nMarathon: 12:00 → 12:20' },
        { startNumber: '8', text: 'Dressyr: 10:00 → 10:10', textEn: 'Dressage: 10:00 → 10:10' }
    ]);
    // A driver with both equipages gets one notice with every line
    const texts = normalizeStartTimeChanges(lines);
    const both = buildStartTimeContent(texts, ['3', '8'], 'en');
    assert.equal(both.title, 'Start time changed');
    assert.equal(both.body.split('\n').length, 3);
    // The mail: Swedish, then the English part, each driver's own lines only
    const personalTexts = normalizePersonalTexts(lines);
    const personalTextsEn = normalizePersonalTexts(lines, 'textEn');
    assert.deepEqual(normalizePersonalTexts([{ startNumber: '1', text: 'x' }], 'textEn'), {}, 'no English: nothing');
    const mail = { kind: 'startTimeChange', subject: 'Ändrad starttid / Start time changed', text: 'Din starttid har ändrats. Nya tider:', textEn: 'Your start time has changed. New times:', personalTexts, personalTextsEn };
    const out = buildRecipientMessage(mail, { email: 'a@b.se', startNumbers: ['8'] }, {});
    assert.match(out.text, /Dressyr: 10:00 → 10:10[\s\S]*---[\s\S]*Your start time has changed[\s\S]*Dressage: 10:00 → 10:10/);
    assert.ok(!out.text.includes('09:30'), 'not another driver\'s times');
    assert.match(out.html, /Dressage: 10:00/);
    // Without English: as before
    const plain = buildRecipientMessage({ ...mail, textEn: null, personalTextsEn: null }, { email: 'a@b.se', startNumbers: ['8'] }, {});
    assert.ok(!plain.text.includes('---\n'));
});

test('channel dialog lines: devices or push off, mail recipients', () => {
    const tr = (key) => ({ notify_push_off: 'av', notify_count_devices: '{n} enheter', mail_preview_recipients: '{n} mottagare', mail_preview_without_email: '{n} utan' }[key]);
    assert.equal(pushCountLine({ available: false }, tr), 'av');
    assert.equal(pushCountLine({ available: true, devices: 4 }, tr), '4 enheter');
    assert.equal(mailCountLine({ recipientCount: 3, withoutEmail: [{}] }, tr), '3 mottagare · 1 utan');
    assert.equal(mailCountLine({ recipientCount: 0 }, tr), '0 mottagare');
});

test('vet decisions: Swedish and English to the driver, a withdrawn strike, the staff\'s own text', () => {
    const created = { type: 'vet', startNumber: '5', number: 12, vetStrike: { phase: 'initial', outcome: 'pending' } };
    const reported = buildVetDecisionDriverMessage(null, created);
    assert.match(reported.body, /första besiktningen/);
    assert.match(reported.bodyEn, /first inspection/);
    assert.equal(reported.titleEn, 'Vet decision – equipage #5');
    assert.deepEqual(buildVetDecisionContent(reported, 'en'), { title: reported.titleEn, body: reported.bodyEn });
    assert.equal(buildVetDecisionContent(reported, 'sv').title, reported.title);

    const withdrawnAfter = { ...created, status: 'closed', vetStrike: { phase: 'initial', outcome: 'withdrawn' } };
    const withdrawn = buildVetDecisionDriverMessage(created, withdrawnAfter);
    assert.match(withdrawn.title, /Veterinärbeslutet har återkallats/);
    assert.match(withdrawn.titleEn, /The vet decision has been withdrawn/);
    assert.equal(withdrawn.type, 'info');
    assert.deepEqual(withdrawn.targetStartNumbers, ['5']);
    assert.equal(vetDecisionNoticeKey(created, withdrawnAfter), 'withdrawn', 'one notice id per incident: idempotent');
    assert.equal(buildVetDecisionDriverMessage(withdrawnAfter, withdrawnAfter), null);
    // Only a pending strike is withdrawn
    const confirmed = { ...created, vetStrike: { phase: 'initial', outcome: 'confirmed' } };
    assert.equal(buildVetDecisionDriverMessage(confirmed, { ...confirmed, vetStrike: { phase: 'initial', outcome: 'withdrawn' } }), null);
    assert.equal(canSendVetNotice('withdrawn', ['vet']), true);
    assert.equal(canSendVetNotice('withdrawn', ['marathon']), false);
    assert.equal(canSendVetNotice('confirmed', ['vet']), false);

    // The mail carries both languages
    const mail = vetDecisionMailContent(reported);
    assert.equal(mail.subject, 'Veterinärbeslut – ekipage #5 / Vet decision – equipage #5');
    assert.match(mail.text, /---[\s\S]*The vet has not approved/);

    // The staff's notice says what to do, not the driver's text
    assert.deepEqual(buildVetStaffContent('reported', created, 'sv'), {
        title: 'Veterinärbeslut #12 väntar – bekräfta i Händelseloggen',
        body: 'Ekipage #5 (första besiktningen). Veterinären har inte godkänt ekipaget.'
    });
    assert.equal(buildVetStaffContent('reported', created, 'en').title, 'Vet decision #12 pending – confirm in the Incident log');
    assert.match(buildVetStaffContent('withdrawn', created, 'sv').title, /återkallat/);
    assert.match(buildVetStaffContent('confirmed', { startNumber: '5' }, 'en').title, /^Vet decision confirmed$/);
});

test('the vet approves again before the decision: the report is closed as withdrawn', () => {
    const equipage = { startNumber: '5', vetStrikePending: { phase: 'initial', incidentId: 'inc9' } };
    const approved = { vetInspection_initial: { status: 'godkand' } };
    const gated = gateVetStrikePayload(approved, { equipage, phase: 'initial' });
    assert.equal(gated.payload.vetStrikePending, null);
    assert.deepEqual(gated.withdrawn, { incidentId: 'inc9', phase: 'initial' });
    assert.equal(gateVetStrikePayload(approved, { equipage: { startNumber: '5' }, phase: 'initial' }).withdrawn, null);
    assert.equal(gateVetStrikePayload(approved, { equipage, phase: 'final' }).withdrawn, null, 'another phase');

    const incident = { id: 'inc9', type: 'vet', status: 'open', decidedBy: '', vetStrike: { phase: 'initial', outcome: 'pending' } };
    const update = buildVetStrikeWithdrawal(incident, { name: 'Vet Vetsson' });
    assert.equal(update.raw.status, 'closed');
    assert.ok(update.raw.decision.length > 0, 'a closed vet entry needs its text');
    assert.equal(update.raw.decidedBy, 'Vet Vetsson');
    assert.deepEqual(update.extra, { 'vetStrike.outcome': 'withdrawn' });
    assert.equal(buildVetStrikeWithdrawal({ ...incident, status: 'decided' }), null);
    assert.equal(buildVetStrikeWithdrawal({ ...incident, vetStrike: { outcome: 'confirmed' } }), null);
    assert.equal(buildVetStrikeWithdrawal({ ...incident, type: 'protest' }), null);
});

test('drive-off call-up: who may, which classes, the texts', () => {
    assert.equal(canCallDriveOff(['admin']), true);
    assert.equal(canCallDriveOff(['td']), true);
    assert.equal(canCallDriveOff(['precision', 'speaker']), false);
    const rows = [
        { label: 'Lätt B', ctx: { driveOffPending: true, qualifierStartNumbers: ['3', '9'] } },
        { label: 'Lätt B', ctx: { driveOffPending: true, qualifierStartNumbers: ['3', '9'] } },
        { label: 'Msv', ctx: { driveOffPending: false, qualifierStartNumbers: ['1', '2'] } },
        { label: 'Fsv', ctx: null }
    ];
    assert.deepEqual(driveOffCallUpGroups(rows), [{ label: 'Lätt B', startNumbers: ['3', '9'] }]);
    const texts = buildDriveOffMessages({ label: 'Lätt B', startNumbers: ['3', '9'], equipages: [{ startNumber: 3, driverName: 'Anna' }] });
    assert.equal(texts.title, 'Omkörning i precision – Lätt B');
    assert.match(texts.body, /#3 Anna, #9/);
    assert.match(texts.bodyEn, /drive-off/);
    assert.match(texts.speakerBody, /Omkörning i precision i Lätt B: #3 Anna, #9\./);
    // The message goes to the qualifiers only
    assert.deepEqual(buildMessageAudience('selected_drivers', { selectedDrivers: ['3', '9'] }).targetStartNumbers, ['3', '9']);
});

test('the public pause log without names: account deletion and retention; results do not recalculate', () => {
    const log = [
        { start: '2026-05-16T08:00:00Z', end: '2026-05-16T08:10:00Z', reason: 'weather', by: { uid: 'u1', name: 'Anna', role: 'td' }, endedBy: { uid: 'u2', name: 'Bo', role: 'admin' } },
        { start: '2026-05-16T09:00:00Z', by: { uid: 'u2', name: 'Bo', role: 'admin' } }
    ];
    const deleted = anonymizePauseLog(log, { uid: 'u2', replacement: 'Raderad användare' });
    assert.equal(deleted.changed, true);
    assert.equal(deleted.log[0].by.name, 'Anna');
    assert.equal(deleted.log[0].endedBy.name, 'Raderad användare');
    assert.equal(deleted.log[1].by.name, 'Raderad användare');
    assert.equal(deleted.log[1].by.uid, 'u2');
    assert.equal(anonymizePauseLog(deleted.log, { uid: 'u2', replacement: 'Raderad användare' }).changed, false, 'idempotent');
    assert.equal(anonymizePauseLog(log, { uid: 'nobody' }).changed, false);
    const retained = anonymizePauseLog(log);
    assert.ok(!JSON.stringify(retained.log).includes('"name"'));
    assert.equal(retained.log[0].by.role, 'td');
    assert.equal(retained.log[0].start, log[0].start);
    assert.deepEqual(anonymizePauseLog(null), { log: null, changed: false });
    // A name change is not a pause change for the results
    assert.equal(configChangeAffectsResults('globalStatus', { pauseLog: log }, { pauseLog: retained.log }), false);
    assert.deepEqual(changedPauseWindows(log, deleted.log), []);
    assert.equal(resultSettingsFingerprint({ globalStatus: { pauseLog: log } }), resultSettingsFingerprint({ globalStatus: { pauseLog: retained.log } }));
    assert.equal(configChangeAffectsResults('globalStatus', { pauseLog: log }, { pauseLog: [log[0]] }), true);
    assert.deepEqual(pauseLogForResults(null), null);
});
