import test from 'node:test';
import assert from 'node:assert/strict';

import { declarationLockReason, parseCompetitionLocalTime } from '../functions/src/declarationLock.js';

test('start times without a zone are Swedish local time (summer and winter)', () => {
    assert.equal(parseCompetitionLocalTime('2026-07-01T10:00'), Date.parse('2026-07-01T08:00:00Z'));   // CEST +2
    assert.equal(parseCompetitionLocalTime('2026-12-01T10:00'), Date.parse('2026-12-01T09:00:00Z'));   // CET +1
    assert.equal(parseCompetitionLocalTime('2026-07-01T10:00:00Z'), Date.parse('2026-07-01T10:00:00Z'));
    assert.equal(parseCompetitionLocalTime(''), null);
});

test('the declaration locks when archived, locked manually, or within the lock time before the first start', () => {
    const startTimes = { times: { 7: { dressage: '2026-07-01T10:00', marathon: '2026-07-02T09:00' } } };
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
