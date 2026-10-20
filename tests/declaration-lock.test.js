import test from 'node:test';
import assert from 'node:assert/strict';

import { declarationLockReason, parseCompetitionLocalTime, publishedStartTimeValues } from '../functions/src/declarationLock.js';

test('start times without a zone are Swedish local time (summer and winter)', () => {
    assert.equal(parseCompetitionLocalTime('2026-07-01T10:00'), Date.parse('2026-07-01T08:00:00Z'));   // CEST +2
    assert.equal(parseCompetitionLocalTime('2026-12-01T10:00'), Date.parse('2026-12-01T09:00:00Z'));   // CET +1
    assert.equal(parseCompetitionLocalTime('2026-07-01T10:00:00Z'), Date.parse('2026-07-01T10:00:00Z'));
    assert.equal(parseCompetitionLocalTime(''), null);
});

test('the declaration locks when archived, locked manually, or within the lock time before the first start', () => {
    const startTimes = {
        times: { 7: { dressage: '2026-07-01T10:00', marathon: '2026-07-02T09:00' } },
        published: { dressage: true, marathon: true }
    };
    const twoHoursBefore = Date.parse('2026-07-01T06:00:00Z');   // 08:00 local
    const halfHourBefore = Date.parse('2026-07-01T07:30:00Z');   // 09:30 local
    assert.equal(declarationLockReason({ startTimes, startNumber: 7, now: twoHoursBefore }), null);
    assert.equal(declarationLockReason({ startTimes, startNumber: 7, now: halfHourBefore }), 'time');
    assert.equal(declarationLockReason({ startTimes, startNumber: 7, now: halfHourBefore, meta: { lockdownMinutes: 15 } }), null);
    assert.equal(declarationLockReason({ startTimes, startNumber: 7, now: twoHoursBefore, meta: { manualLockdown: true } }), 'manual');
    assert.equal(declarationLockReason({ competition: { status: 'completed' }, startNumber: 7 }), 'archived');
    // No start time yet: open
    assert.equal(declarationLockReason({ startTimes, startNumber: 8, now: halfHourBefore }), null);
});

test('unpublished (draft) start times do not lock the declaration', () => {
    const times = { 7: { dressage: '2026-07-01T10:00', maraton: '2026-07-01T10:15', marathon: '2026-07-01T10:15' } };
    const halfHourBefore = Date.parse('2026-07-01T07:30:00Z');   // 09:30 local
    // Nothing published: open
    assert.equal(declarationLockReason({ startTimes: { times }, startNumber: 7, now: halfHourBefore }), null);
    assert.equal(declarationLockReason({ startTimes: { times, published: { dressage: false } }, startNumber: 7, now: halfHourBefore }), null);
    // Only marathon published: its 10:15 start is 45 minutes away (locks within 60)
    assert.equal(declarationLockReason({ startTimes: { times, published: { marathon: true } }, startNumber: 7, now: halfHourBefore }), 'time');
    assert.equal(declarationLockReason({ startTimes: { times, published: { marathon: true } }, startNumber: 7, now: halfHourBefore, meta: { lockdownMinutes: 30 } }), null);
    // The { value: { times, published } } shape
    assert.equal(declarationLockReason({ startTimes: { value: { times, published: { dressage: true } } }, startNumber: 7, now: halfHourBefore }), 'time');
    assert.deepEqual(publishedStartTimeValues({ times, published: { marathon: true } }, 7), ['2026-07-01T10:15', '2026-07-01T10:15']);
});
