import test from 'node:test';
import assert from 'node:assert/strict';

import {
    addStateKeys,
    buildMessageAudience,
    countUnread,
    isMessageForOfficial,
    localizedMessage,
    messageAudienceMode,
    messageStateKey,
    viewerOfficialRoleKeys
} from '../js/utils/messageAudience.js';
import { pickFieldMessages, renderFieldMessagesHtml } from '../js/ui/fieldMessagesView.js';
import { renderSpeakerMessagesHtml } from '../js/pages/shared/speakerMessagesView.js';
import {
    addMinutes,
    buildChangeStamps,
    buildStartTimeChangeMessage,
    detectPublishedTimeChanges,
    planTimeShift,
    applyTimeShift,
    startTimeChangedAt
} from '../js/pages/admin/startTimeChangeUtils.js';
import { buildMyStartTimes } from '../js/pages/shared/portalStartTimes.js';
import {
    buildPauseDetails,
    buildPauseEntry,
    describePauseEntry,
    formatPauseLogLine,
    nextPauseLog,
    pauseDetailsId,
    pauseHeadline,
    pauseWhere
} from '../js/utils/globalPauseUtils.js';
import { buildContactGroups, mailtoBccHref, officialRoleKeysOf } from '../js/utils/contactLists.js';
import { effectiveLockdownMinutes, parseLockdownMinutesInput } from '../js/utils/lockdownMinutes.js';
import { isMessageForDriver } from '../functions/src/driverInbox.js';
import { DICTIONARY, translateTo } from '../js/utils/i18n.js';

const tr = (key) => translateTo(key, 'sv');
const trEn = (key) => translateTo(key, 'en');

test('audiences: exact modes, officials per role, round trip for editing', () => {
    assert.deepEqual(buildMessageAudience('public').audience, { public: true, drivers: true, officials: false, officialRoles: [] });
    // The old misleading "public only" is the same as public (drivers get it too)
    assert.deepEqual(buildMessageAudience('public_only'), buildMessageAudience('public'));
    assert.deepEqual(buildMessageAudience('selected_drivers', { selectedDrivers: [' 7', 12, ''] }).targetStartNumbers, ['7', '12']);
    const vet = buildMessageAudience('official:vet');
    assert.deepEqual(vet.audience, { public: false, drivers: false, officials: true, officialRoles: ['vet'] });
    assert.throws(() => buildMessageAudience('official:cook'));
    for (const mode of ['public', 'drivers', 'selected_drivers', 'officials', 'official:speaker']) {
        assert.equal(messageAudienceMode(buildMessageAudience(mode, { selectedDrivers: ['3'] })), mode);
    }
    assert.equal(messageAudienceMode({ audience: { public: true, drivers: false } }), 'public');
    assert.equal(messageAudienceMode({ targetStartNumber: 4 }), 'selected_drivers');
    assert.equal(messageAudienceMode({}), 'public');
});

test('official messages match the viewer\'s roles and the page role', () => {
    const all = { audience: { officials: true, officialRoles: [] } };
    const vet = { audience: { officials: true, officialRoles: ['vet'] } };
    const pub = { audience: { public: true, drivers: true } };
    assert.deepEqual(viewerOfficialRoleKeys(['admin']).sort(), ['secretariat']);
    // The TD reads the secretariat's messages and its own
    assert.deepEqual(viewerOfficialRoleKeys(['td']), ['secretariat', 'td']);
    assert.deepEqual(viewerOfficialRoleKeys(['marathon'], 'marathon'), ['marathon']);
    assert.equal(isMessageForOfficial(all, ['speaker']), true);
    assert.equal(isMessageForOfficial(vet, ['speaker']), false);
    assert.equal(isMessageForOfficial(vet, viewerOfficialRoleKeys(['admin'], 'vet')), true);
    assert.equal(isMessageForOfficial(pub, ['speaker']), false);
    assert.equal(isMessageForDriver(vet, ['7']), false);
});

test('English text when chosen and given; Swedish otherwise', () => {
    const m = { title: 'Lunch', body: 'Kl 12', titleEn: 'Lunch break', bodyEn: '' };
    assert.deepEqual(localizedMessage(m, 'en'), { title: 'Lunch break', body: 'Kl 12' });
    assert.deepEqual(localizedMessage(m, 'sv'), { title: 'Lunch', body: 'Kl 12' });
});

test('unread count per device; an edited message is unread again', () => {
    const a = { id: 'a', _compId: 'c1', timestamp: 1000 };
    const b = { id: 'b', _compId: 'c1', timestamp: 2000 };
    const read = addStateKeys([], [messageStateKey(a, 'c1')]);
    assert.equal(countUnread([a, b], read), 1);
    assert.equal(countUnread([{ ...a, editedAt: 5000 }, b], read), 2);
    assert.equal(addStateKeys(['x', 'y'], ['z'], 2).join(), 'y,z');
});

test('field banner: for the viewer, not dismissed, newest first, escaped, important red', () => {
    const list = [
        { id: '1', title: 'Old', timestamp: 1000, audience: { officials: true } },
        { id: '2', title: '<b>Vet</b>', type: 'alert', timestamp: 3000, audience: { officials: true, officialRoles: ['vet'] } },
        { id: '3', title: 'Marathon', timestamp: 2000, audience: { officials: true, officialRoles: ['marathon'] } }
    ];
    const shown = pickFieldMessages(list, { viewerKeys: ['marathon'], dismissed: [messageStateKey(list[0], 'c')], competitionId: 'c' });
    assert.deepEqual(shown.map(m => m.id), ['3']);
    const html = renderFieldMessagesHtml(pickFieldMessages(list, { viewerKeys: ['vet'], competitionId: 'c' }), { competitionId: 'c', newKeys: new Set([messageStateKey(list[1], 'c')]) });
    assert.match(html, /&lt;b&gt;Vet/);
    assert.match(html, /bg-red-50/);
    assert.match(html, /animate-pulse/);
    assert.equal(renderFieldMessagesHtml([]), '');
});

test('speaker banner marks officials-only messages as internal', () => {
    const html = renderSpeakerMessagesHtml([
        { id: '1', title: 'Till alla', timestamp: 1, audience: { public: true } },
        { id: '2', title: 'Internt', timestamp: 2, audience: { officials: true } }
    ], { internalLabel: 'Internt – ej utrop' });
    assert.equal((html.match(/data-speaker-internal/g) || []).length, 1);
});

test('changed times on published lists only; stamps and "ändrad HH:MM"', () => {
    const baseline = { 7: { dressage: '2026-10-21T09:00', marathon: '2026-10-22T10:00' }, 8: { dressage: '2026-10-21T09:10' } };
    const current = { 7: { dressage: '2026-10-21T09:15', marathon: '2026-10-22T10:30' }, 8: { dressage: '2026-10-21T09:10' } };
    const changes = detectPublishedTimeChanges(current, baseline, { dressage: true, marathon: false });
    assert.deepEqual(changes, [{ startNumber: '7', discipline: 'dressage', from: '2026-10-21T09:00', to: '2026-10-21T09:15' }]);
    const at = new Date(2026, 9, 21, 8, 5).getTime();
    const stamps = buildChangeStamps(changes, { at, by: 'uid-1' });
    assert.equal(stamps['7'].fields.dressage.from, '2026-10-21T09:00');
    assert.equal(startTimeChangedAt(stamps, '7', 'dressage', '2026-10-21T09:15'), '08:05');
    // Changed again later (to another time): the old stamp no longer applies
    assert.equal(startTimeChangedAt(stamps, '7', 'dressage', '2026-10-21T09:30'), null);
    assert.equal(startTimeChangedAt(stamps, '8', 'dressage', '2026-10-21T09:10'), null);
});

test('my start times: published only, with class and the change mark', () => {
    const at = new Date(2026, 9, 21, 8, 5).getTime();
    const config = {
        times: { 7: { dressage: '2026-10-21T09:15', precision: '2026-10-23T11:00' } },
        published: { dressage: true, precision: false },
        changes: { 7: { at, fields: { dressage: { from: '2026-10-21T09:00', to: '2026-10-21T09:15', at } } } }
    };
    const rows = buildMyStartTimes(config, '7', { className: 'Lätt klass' });
    assert.equal(rows.length, 1);
    assert.deepEqual({ d: rows[0].discipline, c: rows[0].clock, cl: rows[0].className, ch: rows[0].changedAt }, { d: 'dressage', c: '09:15', cl: 'Lätt klass', ch: '08:05' });
});

test('shift the rest: from a start number or a time, not started ones, per class', () => {
    const times = {
        1: { dressage: '2026-10-21T09:00' }, 2: { dressage: '2026-10-21T09:10' },
        3: { dressage: '2026-10-21T09:20' }, 4: { dressage: '2026-10-21T09:30' }
    };
    const eqs = [1, 2, 3, 4].map(n => ({ startNumber: n, className: n === 4 ? 'B' : 'A' }));
    const now = new Date(2026, 9, 21, 9, 5);
    const plan = planTimeShift(times, eqs, { discipline: 'dressage', minutes: 15, fromStartNumber: '2', now });
    assert.deepEqual(plan.map(p => `${p.startNumber}:${p.to.slice(11)}`), ['2:09:25', '3:09:35', '4:09:45']);
    const byTime = planTimeShift(times, eqs, { discipline: 'dressage', minutes: -5, fromTime: '2026-10-21T08:00', className: 'A', now });
    // 09:00 already started: left
    assert.deepEqual(byTime.map(p => p.startNumber), ['2', '3']);
    assert.deepEqual(planTimeShift(times, eqs, { discipline: 'dressage', minutes: 0, fromStartNumber: '1', now }), []);
    assert.equal(addMinutes('2026-10-21T23:50', 20), '2026-10-22T00:10');
    applyTimeShift(times, plan, 'dressage');
    assert.equal(times[4].dressage, '2026-10-21T09:45');
    // The ready message: chosen drivers, old → new, Swedish and English
    const msg = buildStartTimeChangeMessage(plan.map(p => ({ ...p, discipline: 'dressage' })), [{ startNumber: 2, driverName: 'Anna' }], translateTo);
    assert.deepEqual(msg.startNumbers, ['2', '3', '4']);
    assert.match(msg.body, /#2 Anna – Dressyr: 09:10 → 09:25/);
    assert.match(msg.bodyEn, /Dressage: 09:10 → 09:25/);
});

test('pause entries: when, why and where public; who and the note private; text in the viewer\'s language', () => {
    const by = { uid: 'u1', name: 'Anna', role: 'observer', email: 'x@y' };
    const press = { reason: 'accident', note: ' Häst omkull ', by, where: pauseWhere({ section: 'B' }) };
    const log1 = nextPauseLog([], true, '2026-10-21T08:00:00.000Z', press);
    assert.deepEqual(log1[0], {
        start: '2026-10-21T08:00:00.000Z', end: null, durationSec: null, reason: 'accident', where: 'section:B'
    });
    const details = buildPauseDetails('2026-10-21T08:00:00.000Z', press);
    assert.deepEqual(details, { start: '2026-10-21T08:00:00.000Z', note: 'Häst omkull', by: { uid: 'u1', name: 'Anna', role: 'observer' } });
    assert.equal(pauseDetailsId('2026-10-21T08:00:00.000Z'), `p${Date.parse('2026-10-21T08:00:00.000Z')}`);
    assert.deepEqual(buildPauseDetails('x', { by: { uid: 'u2', role: 'sekretariat' } }, { resume: true }), { endedBy: { uid: 'u2', role: 'sekretariat' } });
    assert.equal(buildPauseDetails('x', { reason: 'vet' }), null);
    assert.equal(nextPauseLog(log1, true, '2026-10-21T08:01:00.000Z'), null);
    const log2 = nextPauseLog(log1, false, '2026-10-21T08:15:00.000Z', { by: { uid: 'u2', role: 'sekretariat' } });
    assert.equal(log2[0].durationSec, 900);
    assert.equal(log2[0].reason, 'accident');
    assert.equal(log2[0].endedBy, undefined);
    assert.equal(nextPauseLog(log2, false, '2026-10-21T08:20:00.000Z'), null);
    assert.equal(buildPauseEntry('x', { reason: 'lunch' }).reason, 'other');
    // Staff: with the private details
    assert.equal(describePauseEntry(log1[0], tr, { details }), 'Olycka – Häst omkull · Anna (Observatör) vid Sträcka B');
    assert.equal(describePauseEntry(log1[0], trEn, { details }), 'Accident – Häst omkull · Anna (Observer) at Section B');
    // Public: the reason only, also for an older entry with a note and a name
    assert.equal(describePauseEntry({ ...log1[0], ...details }, tr, { publicView: true }), 'Olycka');
    assert.match(pauseHeadline(log1[0], trEn, 'en-GB'), /^COMPETITION PAUSED SINCE \d\d:\d\d$/);
    assert.match(formatPauseLogLine(log2[0], 0, tr), /^Paus 1: .* \(15 min\) · Olycka/);
    assert.equal(describePauseEntry({ start: 'x', where: 'obstacle:3' }, tr), 'vid Hinder 3');
});
test('contact lists: per class and role, deduplicated, BCC link', () => {
    const groups = buildContactGroups({
        equipages: [
            { startNumber: 1, className: 'A', email: 'One@x.se' }, { startNumber: 2, className: 'A', email: 'one@x.se' },
            { startNumber: 3, className: 'B' }
        ],
        officials: [
            { id: 'o1', name: 'Vet', role: 'Veterinär', email: 'vet@x.se', mobile: '070-1' },
            { id: 'o2', name: 'Sek', roles: ['admin'], email: 'sek@x.se', phone: '070-2' }
        ],
        judges: [{ id: 'j1', roles: [{ discipline: 'dressage', position: 'C' }], email: 'VET@x.se' }]
    });
    const byId = Object.fromEntries(groups.map(g => [g.id, g]));
    assert.deepEqual(byId['drivers:all'].emails, ['one@x.se']);
    assert.equal(byId['drivers:all'].missingEmail, 1);
    assert.equal(byId['drivers:class:B'].emails.length, 0);
    assert.deepEqual(byId['officials:all'].emails, ['vet@x.se', 'sek@x.se']);
    assert.deepEqual(byId['officials:vet'].phones, ['070-1']);
    assert.deepEqual(byId['officials:dressage'].emails, ['vet@x.se']);
    assert.deepEqual(byId['officials:secretariat'].emails, ['sek@x.se']);
    assert.deepEqual(officialRoleKeysOf({ role: 'Hinderdomare' }), ['marathon']);
    assert.equal(mailtoBccHref(['a@x.se', 'b+c@x.se']), 'mailto:?bcc=a%40x.se,b%2Bc%40x.se');
    assert.equal(mailtoBccHref([]), '');
});

test('declaration lock time: empty means the default, invalid is refused', () => {
    assert.deepEqual(parseLockdownMinutesInput(''), { value: 60, error: null });
    assert.deepEqual(parseLockdownMinutesInput('0'), { value: 0, error: null });
    assert.equal(parseLockdownMinutesInput('-5').error, 'out_of_range');
    assert.equal(parseLockdownMinutesInput('1,5').error, 'not_a_number');
    assert.equal(effectiveLockdownMinutes(''), 60);
    assert.equal(effectiveLockdownMinutes(null), 60);
    assert.equal(effectiveLockdownMinutes(15), 15);
});

test('every new text has Swedish and English', () => {
    const prefixes = ['pause_', 'msg_aud', 'msg_', 'field_messages', 'contact_', 'portal_my_start', 'starttime_', 'shift_times', 'lockdown_minutes'];
    Object.entries(DICTIONARY)
        .filter(([key]) => prefixes.some(p => key.startsWith(p)))
        .forEach(([key, value]) => assert.ok(value.sv && value.en, key));
});
