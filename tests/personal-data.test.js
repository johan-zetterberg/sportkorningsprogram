import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETENTION_MONTHS,
  PURGE_GRACE_MS,
  addMonthsMs,
  archivedAtMs,
  buildAccountDeletionPlan,
  buildPersonExport,
  counterLastActivityMs,
  driverContactFieldsToRemove,
  isStaleCounter,
  lastActivityMs,
  matchesPerson,
  normalizeRetentionMonths,
  personalLogFieldsPresent,
  purgeScheduleDecision,
  retentionDecision,
  selectCompetitionsForPurge,
  toPlainValue
} from '../functions/src/personalData.js';

const DAY = 24 * 60 * 60 * 1000;
const ts = (iso) => ({ toMillis: () => Date.parse(iso) });

test('archive time: finalizedAt, then the snapshot id, then the last date', () => {
  assert.equal(archivedAtMs({ status: 'active', finalizedAt: 5 }), null);
  assert.equal(archivedAtMs({ locked: true, finalizedAt: ts('2025-06-01T10:00:00Z') }), Date.parse('2025-06-01T10:00:00Z'));
  assert.equal(archivedAtMs({ status: 'completed', archiveSnapshotId: 'snapshot_1717236000000' }), 1717236000000);
  assert.equal(archivedAtMs({ locked: true, dates: '2025-05-15 - 2025-05-17' }), Date.parse('2025-05-17T23:59:59Z'));
  assert.equal(archivedAtMs({ locked: true }), null);
});

test('retention months: whole months 1-120, else the default', () => {
  assert.equal(normalizeRetentionMonths(undefined), DEFAULT_RETENTION_MONTHS);
  assert.equal(normalizeRetentionMonths('abc'), DEFAULT_RETENTION_MONTHS);
  assert.equal(normalizeRetentionMonths(2.5), DEFAULT_RETENTION_MONTHS);
  assert.equal(normalizeRetentionMonths(0), 1);
  assert.equal(normalizeRetentionMonths(500), 120);
  assert.equal(normalizeRetentionMonths(24), 24);
});

test('adding months keeps the day or uses the last day of a short month', () => {
  assert.equal(new Date(addMonthsMs(Date.parse('2025-01-31T00:00:00Z'), 1)).toISOString(), '2025-02-28T00:00:00.000Z');
  assert.equal(new Date(addMonthsMs(Date.parse('2025-06-15T12:00:00Z'), 12)).toISOString(), '2026-06-15T12:00:00.000Z');
});

test('retention selects archived competitions past their months, once', () => {
  const archived = Date.parse('2025-01-10T00:00:00Z');
  const comp = { locked: true, status: 'completed', finalizedAt: archived };
  assert.equal(retentionDecision(comp, archived + 300 * DAY).due, false);
  assert.equal(retentionDecision(comp, archived + 370 * DAY).due, true);
  assert.equal(retentionDecision({ ...comp, retentionMonths: 24 }, archived + 370 * DAY).due, false);
  assert.equal(retentionDecision({ ...comp, retentionMonths: 1 }, archived + 40 * DAY).due, true);
  // Already purged after this archiving: not again
  assert.equal(retentionDecision({ ...comp, personalDataPurgedAt: archived + 371 * DAY }, archived + 400 * DAY).reason, 'already-purged');
  // Reopened and archived again after the purge: selected again later
  const rearchived = { ...comp, finalizedAt: archived + 500 * DAY, personalDataPurgedAt: archived + 371 * DAY };
  assert.equal(retentionDecision(rearchived, archived + 600 * DAY).due, false);
  assert.equal(retentionDecision(rearchived, archived + 900 * DAY).due, true);
  // Being deleted, or archived without a date: never
  assert.equal(retentionDecision({ ...comp, deleting: true }, archived + 900 * DAY).due, false);
  assert.equal(retentionDecision({ locked: true }, Date.now()).due, false);
});

test('retention also purges competitions never archived: months after the last date, else creation', () => {
  const lastDay = Date.parse('2025-05-17T23:59:59Z');
  const open = { status: 'active', dates: '2025-05-15 - 2025-05-17' };
  assert.equal(lastActivityMs(open), lastDay);
  assert.equal(retentionDecision(open, lastDay + 300 * DAY).due, false);
  const due = retentionDecision(open, lastDay + 370 * DAY);
  assert.equal(due.due, true);
  assert.equal(due.reason, 'expired-not-archived');
  assert.equal(due.archivedAt, lastDay);
  assert.equal(retentionDecision({ ...open, retentionMonths: 24 }, lastDay + 370 * DAY).due, false);
  // A draft without dates: from its creation (Timestamp-like or millis)
  const created = Date.parse('2024-01-01T00:00:00Z');
  assert.equal(retentionDecision({ status: 'draft', createdAt: { toMillis: () => created } }, created + 370 * DAY).due, true);
  assert.equal(retentionDecision({ status: 'draft', createdAt: created }, created + 300 * DAY).due, false);
  // Neither dates nor creation: nothing to go by
  assert.equal(retentionDecision({ status: 'active' }, Date.now()).reason, 'no-date');
  // Purged once: not again
  assert.equal(retentionDecision({ ...open, personalDataPurgedAt: lastDay + 371 * DAY }, lastDay + 900 * DAY).reason, 'already-purged');
});

test('a competition not archived counts its newest activity, not only an old or wrong date', () => {
  const now = Date.parse('2026-10-19T00:00:00Z');
  // Created yesterday with a date years ago (typo, copied competition)
  const fresh = { status: 'draft', dates: '2019-05-01', createdAt: now - DAY };
  assert.equal(lastActivityMs(fresh), now - DAY);
  assert.equal(retentionDecision(fresh, now).due, false);
  // Updated, or a result / audit entry, within retentionMonths: not due
  const old = { status: 'active', dates: '2024-05-01', createdAt: Date.parse('2024-01-01T00:00:00Z') };
  assert.equal(retentionDecision(old, now).due, true);
  assert.equal(retentionDecision({ ...old, updatedAt: ts('2026-09-01T00:00:00Z') }, now).due, false);
  assert.equal(retentionDecision({ ...old, lastResultAt: now - 10 * DAY }, now).due, false);
  assert.equal(retentionDecision({ ...old, recentActivityMs: now - 100 * DAY }, now).due, false);
  // Archived: from the archiving, as before
  assert.equal(retentionDecision({ locked: true, finalizedAt: Date.parse('2025-01-01T00:00:00Z'), updatedAt: now }, now).due, true);
});

test('a due competition is scheduled first and purged a week later at the earliest', () => {
  const now = Date.parse('2026-10-19T00:00:00Z');
  const decision = retentionDecision({ locked: true, finalizedAt: Date.parse('2025-01-01T00:00:00Z') }, now);
  const first = purgeScheduleDecision(decision, null, now);
  assert.deepEqual(first, { action: 'schedule', scheduledAt: now, purgeAt: now + PURGE_GRACE_MS });
  assert.equal(purgeScheduleDecision(decision, now, now + 6 * DAY).action, 'wait');
  assert.equal(purgeScheduleDecision(decision, ts(new Date(now).toISOString()), now + 7 * DAY).action, 'purge');
  // A schedule from before this due date (an earlier cycle) starts again
  assert.equal(purgeScheduleDecision(decision, decision.dueAt - DAY, now).action, 'schedule');
  // No longer due (reopened, written to, retention extended): unscheduled
  assert.equal(purgeScheduleDecision({ due: false }, now, now + 8 * DAY).action, 'unschedule');
  assert.equal(purgeScheduleDecision({ due: false }, null, now).action, 'none');
});

test('selectCompetitionsForPurge keeps only due competitions with the decision', () => {
  const now = Date.parse('2026-10-19T00:00:00Z');
  const selected = selectCompetitionsForPurge([
    { id: 'old', appId: 'a', data: { locked: true, dates: '2025-05-01 - 2025-05-03' } },
    { id: 'recent', appId: 'a', data: { locked: true, dates: '2026-05-01' } },
    { id: 'open', appId: 'a', data: { status: 'active', dates: '2020-05-01' } },
    { id: 'openRecent', appId: 'a', data: { status: 'active', dates: '2026-09-01' } }
  ], now);
  assert.deepEqual(selected.map((c) => c.id), ['old', 'open']);
  assert.equal(selected[0].decision.months, 12);
});

test('log entries lose names and email addresses, not uids', () => {
  assert.deepEqual(personalLogFieldsPresent({ by: 'uid1', byName: 'Anna', reason: 'x' }), ['byName']);
  assert.deepEqual(personalLogFieldsPresent({ initiatedBy: { uid: 'u', email: 'a@b.se' } }), ['initiatedBy.email']);
  assert.deepEqual(personalLogFieldsPresent({ editedBy: 'u', changes: {} }), []);
});

test('stale counters: last write older than 30 days', () => {
  const now = Date.parse('2026-10-19T00:00:00Z');
  assert.equal(counterLastActivityMs({ failures: [1, 5, 3] }, null), 5);
  assert.equal(isStaleCounter({ windowStart: now - 31 * DAY }, null, now), true);
  assert.equal(isStaleCounter({ windowStart: now - 31 * DAY }, now - DAY, now), false);
  assert.equal(isStaleCounter({ failures: [now - 2 * DAY] }, null, now), false);
  assert.equal(isStaleCounter({}, null, now), true);
});

test('driver contact fields: all when the user is the only linked person', () => {
  const own = { email: 'Kusk@Ex.se', phone: '070', address: 'Väg 1', licence: 'L1' };
  assert.deepEqual(driverContactFieldsToRemove(own, 'kusk@ex.se'), ['email', 'phone', 'address']);
  // A parent's contact email on the entry: only the user's own email goes
  const shared = { email: 'kusk@ex.se', contactEmail: 'parent@ex.se', phone: '070' };
  assert.deepEqual(driverContactFieldsToRemove(shared, 'kusk@ex.se'), ['email']);
  assert.deepEqual(driverContactFieldsToRemove(shared, 'other@ex.se'), []);
  assert.deepEqual(driverContactFieldsToRemove(own, ''), []);
  // Imported entries: driverEmail and the emergency contact
  assert.deepEqual(driverContactFieldsToRemove({ driverEmail: 'kusk@ex.se', iceName: 'Mamma', icePhone: '112' }, 'kusk@ex.se'),
    ['driverEmail', 'iceName', 'icePhone']);
});

test('account deletion is blocked while the user owns competitions', () => {
  const plan = buildAccountDeletionPlan({ uid: 'u1', email: 'a@b.se', ownedCompetitions: [{ path: 'x/c1', name: 'Vårtävlingen' }] });
  assert.equal(plan.blocked, true);
  assert.deepEqual(plan.ownedCompetitions, ['Vårtävlingen']);
});

test('account deletion plan removes roles and anonymises archived entries only', () => {
  const base = 'artifacts/combined-driving/public/data/competitions';
  const plan = buildAccountDeletionPlan({
    uid: 'u1',
    email: 'a@b.se',
    adminDocs: [{ path: `${base}/c1/admins/u1` }, { path: `${base}/c1/admins/u1` }],
    roleEmailDocs: [{ path: `${base}/c2/roleEmails/a@b.se` }],
    memberCompetitions: [
      { path: `${base}/c1`, data: { admins: ['u1', 'u2'], staffUids: ['u1'] } },
      { path: `${base}/c2`, data: { staffUids: ['u2'] } }
    ],
    driverEntries: [
      { path: `${base}/c3/equipagePrivate/7`, data: { email: 'a@b.se', phone: '1' }, archived: true },
      { path: `${base}/c4/equipagePrivate/2`, data: { email: 'a@b.se' }, archived: false },
      { path: `${base}/c5/equipagePrivate/9`, data: { email: 'x@y.se' }, archived: true }
    ]
  });
  assert.equal(plan.blocked, false);
  assert.deepEqual(plan.deletePaths, [`${base}/c1/admins/u1`, `${base}/c2/roleEmails/a@b.se`]);
  assert.deepEqual(plan.arrayRemovals, [{ path: `${base}/c1`, fields: ['admins', 'staffUids'] }]);
  assert.deepEqual(plan.anonymize, [{ path: `${base}/c3/equipagePrivate/7`, fields: ['email', 'phone'] }]);
  assert.deepEqual(plan.keptActiveEntries, [`${base}/c4/equipagePrivate/2`]);
  assert.equal(plan.userDocPath, 'users/u1');
  assert.throws(() => buildAccountDeletionPlan({}));
});

test('person export: matches on email fields, plain JSON, empty competitions left out', () => {
  assert.equal(matchesPerson({ contactEmail: ' A@B.se ' }, ['email', 'contactEmail'], 'a@b.se'), true);
  assert.equal(matchesPerson({ email: 'x@b.se' }, ['email'], 'a@b.se'), false);
  const when = new Date('2026-05-01T08:00:00Z');
  assert.deepEqual(toPlainValue({ at: { toDate: () => when }, list: [when] }), { at: when.toISOString(), list: [when.toISOString()] });
  const result = buildPersonExport({
    email: 'A@b.se',
    competitions: [
      { id: 'c1', name: 'Tävling', documents: [{ path: 'p/equipagePrivate/1', data: { email: 'a@b.se', updatedAt: { toDate: () => when } } }] },
      { id: 'c2', name: 'Annan', documents: [] }
    ],
    exportedBy: 'admin1',
    now: when.getTime()
  });
  assert.equal(result.email, 'a@b.se');
  assert.equal(result.competitionCount, 1);
  assert.equal(result.documentCount, 1);
  assert.equal(result.competitions[0].documents[0].data.updatedAt, when.toISOString());
  assert.equal(result.exportedAt, when.toISOString());
});
