// Feedback after sends and late pauses: the push result line after the start
// time dialog, the late offline pause line for the secretariat, the push
// reserve for essential topics and the mail limits
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTimePushResultLine } from '../js/utils/notifyChannelsUtils.js';
import { describePauseReview } from '../js/utils/globalPauseUtils.js';
import { PUSH_ESSENTIAL_TOPICS, pushQuotaLimit } from '../functions/src/push/pushCore.js';
import { MAIL_LIMITS } from '../functions/src/mail/mailCore.js';

const tr = (key) => ({
    starttime_push_sent: 'Skickad till {n}',
    starttime_push_partial: '{n} ok, {failed} fel',
    notify_push_off: 'Push av',
    starttime_push_failed: 'Misslyckades',
    pause_late_start_review: 'Sen paus från {role} kl {time} behöver granskas',
    pause_late_end_review: 'Sent återupptagande från {role} kl {time}',
    pause_review_unknown_role: 'okänd',
    role_observer: 'Observatör'
}[key] || key);

test('the push result after the start time dialog', () => {
    assert.deepEqual(startTimePushResultLine({ status: 'sent', sent: 4 }, tr), { ok: true, text: 'Skickad till 4' });
    assert.deepEqual(startTimePushResultLine({ status: 'partial', sent: 3, failed: 1 }, tr), { ok: false, text: '3 ok, 1 fel' });
    assert.equal(startTimePushResultLine({ status: 'disabled' }, tr).text, 'Push av');
    assert.equal(startTimePushResultLine({ status: 'blocked' }, tr).ok, false);
    assert.equal(startTimePushResultLine(null, tr).text, 'Misslyckades');
});

test('a late offline press as a line for the secretariat', () => {
    const at = '2026-10-22T08:05:00.000Z';
    const line = describePauseReview({ type: 'start', at, by: { role: 'observer' } }, tr, 'sv-SE');
    assert.match(line, /^Sen paus från Observatör kl \d\d:\d\d behöver granskas$/);
    assert.match(describePauseReview({ type: 'end', at }, tr), /^Sent återupptagande från okänd kl/);
});

test('essential push topics keep a reserve of the daily cap; essential mail has its own higher limits', () => {
    assert.deepEqual([...PUSH_ESSENTIAL_TOPICS].sort(), ['pause', 'startTimes', 'vetDecision']);
    assert.equal(pushQuotaLimit(1000, 'pause'), 1000);
    assert.equal(pushQuotaLimit(1000, 'messages'), 700);
    assert.ok(MAIL_LIMITS.essentialPerCompetitionDay > MAIL_LIMITS.perCompetitionDay);
    assert.ok(MAIL_LIMITS.essentialPerCompetitionHour > MAIL_LIMITS.perCompetitionHour);
});
