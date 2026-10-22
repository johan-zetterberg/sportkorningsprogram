// The offline pause events folded into the pause log (functions/src/pauseEvents.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_REVIEW, foldPauseEvents, normalizePauseEvent, pauseDetailsId } from '../functions/src/pauseEvents.js';

const ev = (id, type, at, extra = {}) => normalizePauseEvent(id, { type, at, ...extra });
const by = (uid) => ({ uid, name: `N-${uid}`, role: 'marathon' });

test('pause events: a start opens a public pause with reason and where; who and the note are private details', () => {
    const { log, results, changed, details } = foldPauseEvents([], [ev('a', 'start', '2026-05-01T10:00:00Z', { reason: 'vet', note: ' häst ', where: 'obstacle:3', by: by('u1') })]);
    assert.equal(changed, true);
    assert.equal(results.a, 'started');
    assert.deepEqual(log, [{ start: '2026-05-01T10:00:00.000Z', end: null, durationSec: null, reason: 'vet', where: 'obstacle:3' }]);
    assert.deepEqual(details, { [pauseDetailsId('2026-05-01T10:00:00Z')]: { start: '2026-05-01T10:00:00.000Z', note: 'häst', by: by('u1') } });
});

test('pause events: a press that reached the server more than 2 minutes late is left for review', () => {
    const at = '2026-05-01T10:00:00Z';
    const late = foldPauseEvents([], [ev('late', 'start', at, { atServer: { toMillis: () => Date.parse(at) + 121000 } })]);
    assert.equal(late.results.late, NEEDS_REVIEW);
    assert.equal(late.changed, false);
    assert.deepEqual(late.log, []);
    const onTime = foldPauseEvents([], [ev('ok', 'start', at, { atServer: { seconds: Date.parse(at) / 1000 + 119 } })]);
    assert.equal(onTime.results.ok, 'started');
    // A late resume does not shorten the pause backwards either
    const open = [{ start: '2026-05-01T09:00:00.000Z', end: null, durationSec: null, reason: 'other' }];
    const end = foldPauseEvents(open, [ev('e', 'end', at, { atServer: Date.parse(at) + 10 * 60000 })]);
    assert.equal(end.results.e, NEEDS_REVIEW);
    assert.equal(end.log[0].end, null);
});

test('pause events: start and end are folded in time order whatever order they arrive in', () => {
    const { log, results } = foldPauseEvents([], [
        ev('end', 'end', '2026-05-01T10:20:00Z', { by: by('u2') }),
        ev('start', 'start', '2026-05-01T10:00:00Z', { by: by('u1') })
    ]);
    assert.equal(results.start, 'started');
    assert.equal(results.end, 'ended');
    assert.equal(log.length, 1);
    assert.equal(log[0].end, '2026-05-01T10:20:00.000Z');
    assert.equal(log[0].durationSec, 1200);
    assert.equal(log[0].endedBy, undefined);
    assert.deepEqual(foldPauseEvents([], [ev('s', 'start', '2026-05-01T10:00:00Z'), ev('e2', 'end', '2026-05-01T10:20:00Z', { by: by('u2') })]).details, { [pauseDetailsId('2026-05-01T10:00:00Z')]: { endedBy: by('u2') } });
});

test('pause events: earlier entries are never removed or rewritten', () => {
    const earlier = [{ start: '2026-05-01T09:00:00.000Z', end: '2026-05-01T09:10:00.000Z', durationSec: 600, reason: 'other', by: by('admin') }];
    const { log } = foldPauseEvents(earlier, [ev('s', 'start', '2026-05-01T11:00:00Z')]);
    assert.deepEqual(log[0], earlier[0]);
    assert.equal(log.length, 2);
    assert.equal(log[1].end, null);
});

test('pause events: pausing while paused or resuming without a pause changes nothing', () => {
    const open = [{ start: '2026-05-01T10:00:00.000Z', end: null, durationSec: null, reason: 'other' }];
    const a = foldPauseEvents(open, [ev('s2', 'start', '2026-05-01T10:05:00Z')]);
    assert.equal(a.results.s2, 'ignored-already-paused');
    assert.equal(a.changed, false);
    const b = foldPauseEvents([], [ev('e', 'end', '2026-05-01T10:05:00Z')]);
    assert.equal(b.results.e, 'ignored-not-paused');
    assert.deepEqual(b.log, []);
});

test('pause events: a late start (others paused and resumed after it) does not rewrite the log', () => {
    const log = [{ start: '2026-05-01T10:02:00.000Z', end: '2026-05-01T10:10:00.000Z', durationSec: 480, reason: 'other' }];
    const { results, changed, log: next } = foldPauseEvents(log, [ev('late', 'start', '2026-05-01T10:00:00Z'), ev('lateEnd', 'end', '2026-05-01T10:15:00Z')]);
    assert.equal(results.late, 'ignored-late');
    assert.equal(results.lateEnd, 'ignored-not-paused');
    assert.equal(changed, false);
    assert.deepEqual(next, log);
});

test('pause events: an end older than the open pause does not close it', () => {
    const open = [{ start: '2026-05-01T10:00:00.000Z', end: null, durationSec: null, reason: 'other' }];
    const { results, changed } = foldPauseEvents(open, [ev('e', 'end', '2026-05-01T09:59:00Z')]);
    assert.equal(results.e, 'ignored-before-start');
    assert.equal(changed, false);
});

test('pause events: invalid events are rejected by normalizePauseEvent', () => {
    assert.equal(normalizePauseEvent('x', { type: 'stop', at: '2026-05-01T10:00:00Z' }), null);
    assert.equal(normalizePauseEvent('x', { type: 'start', at: 'not a time' }), null);
    assert.equal(normalizePauseEvent('x', { type: 'start', at: '2026-05-01T10:00:00Z', reason: 'bogus' }).reason, 'other');
});
