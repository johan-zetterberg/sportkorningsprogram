import test from 'node:test';
import assert from 'node:assert/strict';

import { formatClockTime, timeValueToMs } from '../js/utils/timeValueUtils.js';
import { compareByTimeThenStartNumber, compareStartNumbers } from '../js/utils/startNumberSort.js';
import { isStartTimePublished, publishedStartTimes, publishedTimesFor, startTimesPublishedFlags } from '../js/utils/publishedStartTimes.js';
import { isStartTimePublished as reexported } from '../js/pages/admin/starttiderUtils.js';
import { formatStartTimeLabel, clubLabel } from '../js/pages/marathon/marathonResultFormatters.js';
import { sortStateForViewMode } from '../js/pages/marathon/marathonResultRanking.js';
import { totalSortConfigForMode, sortTotalRows } from '../js/pages/shared/totalResultRanking.js';
import { speakerLeaderboardRanks } from '../js/pages/shared/speakerFormatUtils.js';
import { prizeGivingPlacedBadgeText, prizeGivingSpeakerScript } from '../js/pages/shared/prizeGivingUtils.js';
import { isTvModeRequested, tvModeHash } from '../js/pages/shared/tvMode.js';
import { hasMoreToTheRight } from '../js/pages/shared/scrollHint.js';
import { pickSpeakerMessages, renderSpeakerMessagesHtml } from '../js/pages/shared/speakerMessagesView.js';

const at = (h, m) => new Date(2026, 9, 19, h, m).getTime();

test('time values: Firestore Timestamps, {seconds,nanoseconds}, ms and strings', () => {
    const ms = at(9, 5);
    const timestamp = { toMillis: () => ms, toDate: () => new Date(ms) };
    assert.equal(timeValueToMs(timestamp), ms);
    assert.equal(timeValueToMs({ toDate: () => new Date(ms) }), ms);
    assert.equal(timeValueToMs({ seconds: ms / 1000, nanoseconds: 500000000 }), ms + 500);
    assert.equal(timeValueToMs({ _seconds: ms / 1000 }), ms);
    assert.equal(timeValueToMs(ms), ms);
    assert.equal(timeValueToMs('2026-10-19T09:05'), ms);
    assert.equal(timeValueToMs('2026-10-19 09:05'), ms);
    assert.equal(timeValueToMs(''), null);
    assert.equal(timeValueToMs('nonsense'), null);
    assert.equal(timeValueToMs({ foo: 1 }), null);

    for (const value of [timestamp, { seconds: ms / 1000, nanoseconds: 0 }, ms, '2026-10-19T09:05', '09:05', '9:05']) {
        assert.equal(formatClockTime(value), '09:05');
        assert.equal(formatStartTimeLabel(value), '09:05');
    }
    // Never "Timestamp(seconds=…)" or [object Object]
    assert.equal(formatStartTimeLabel({ toString: () => 'Timestamp(seconds=1, nanoseconds=0)' }), '—');
    assert.equal(formatStartTimeLabel(null), '—');
    assert.equal(formatStartTimeLabel(undefined, '-'), '-');
});

test('start numbers sort numerically, ties after time by start number', () => {
    const sorted = ['6', '1', '10', '11', '12', '2', '3', 9, '12a'].sort(compareStartNumbers);
    assert.deepEqual(sorted.map(String), ['1', '2', '3', '6', '9', '10', '11', '12', '12a']);
    const rows = [
        { sn: '10', t: null }, { sn: '2', t: null }, { sn: '7', t: at(9, 0) }, { sn: '3', t: at(9, 0) }, { sn: '1', t: at(10, 0) }
    ].sort((a, b) => compareByTimeThenStartNumber(a.t, b.t, a.sn, b.sn));
    assert.deepEqual(rows.map(r => r.sn), ['3', '7', '1', '2', '10']);
});

test('the result sort menu: "Startordning" sorts by start number, "Placering" by place', () => {
    assert.deepEqual(sortStateForViewMode('startorder'), { key: 'startNumber', dir: 'asc' });
    assert.deepEqual(sortStateForViewMode('place'), { key: 'place', dir: 'asc' });
    assert.deepEqual(sortStateForViewMode('byclass'), { key: 'place', dir: 'asc' });
    assert.equal(totalSortConfigForMode('startorder').key, 'startNumber');
    assert.equal(totalSortConfigForMode('place').key, 'plac');
    const rows = ['6', '1', '10', '2'].map((sn, i) => ({ startNumber: sn, plac: i === 0 ? 1 : null }));
    assert.deepEqual(sortTotalRows(rows, totalSortConfigForMode('startorder')).map(r => r.startNumber), ['1', '2', '6', '10']);
    // Unplaced rows after the placed ones, in numeric start-number order
    assert.deepEqual(sortTotalRows(rows, totalSortConfigForMode('place')).map(r => r.startNumber), ['6', '1', '2', '10']);
});

test('club column shows the club name, else the country code', () => {
    assert.equal(clubLabel({ clubName: 'Skånska Körsällskapet', country: 'SE' }), 'Skånska Körsällskapet');
    assert.equal(clubLabel({ country: 'swe' }), 'SWE');
    assert.equal(clubLabel({}), '—');
});

test('published start times: unpublished disciplines are left out (all doc shapes)', () => {
    const doc = {
        times: {
            1: { dressage: '2026-10-19T09:00', marathon: '2026-10-20T10:00', maraton: '2026-10-20T10:00', precision: '2026-10-21T11:00' },
            2: { dressage: '2026-10-19T09:07' }
        },
        published: { dressage: true, marathon: false }
    };
    assert.deepEqual(startTimesPublishedFlags(doc), { dressage: true, marathon: false, precision: false });
    assert.equal(isStartTimePublished(doc, 'dressage'), true);
    assert.equal(isStartTimePublished(doc, 'maraton'), false);
    assert.equal(reexported(doc, 'dressage'), true);
    assert.deepEqual(publishedTimesFor(doc, 1), { dressage: '2026-10-19T09:00' });
    assert.deepEqual(publishedStartTimes(doc), { 1: { dressage: '2026-10-19T09:00' }, 2: { dressage: '2026-10-19T09:07' } });
    // { value: {...} } wrapper and the times map with .published attached (starttider.js)
    assert.deepEqual(publishedTimesFor({ value: { times: doc.times, published: { marathon: true } } }, 1), { marathon: '2026-10-20T10:00', maraton: '2026-10-20T10:00' });
    const attached = { ...doc.times, published: { precision: true } };
    assert.deepEqual(publishedStartTimes(attached), { 1: { precision: '2026-10-21T11:00' } });
    // Nothing published / no document: nothing
    assert.deepEqual(publishedStartTimes({ times: doc.times }), {});
    assert.deepEqual(publishedStartTimes(null), {});
});

test('speaker leaderboard: a position only for rows with a result', () => {
    const rows = [
        { total: 10 }, { total: 12.5 }, { total: Infinity }, { total: null }, { total: 14, isWithdrawn: true }, { total: 15 }
    ];
    assert.deepEqual(speakerLeaderboardRanks(rows), [1, 2, null, null, null, 3]);
    assert.deepEqual(speakerLeaderboardRanks([{ total: undefined }, { total: NaN }]), [null, null]);
});

test('prize giving: no "placed" badge without placings; natural speaker line', () => {
    assert.equal(prizeGivingPlacedBadgeText(1, 0), '');
    assert.equal(prizeGivingPlacedBadgeText(3, 2, '{n} placeras'), '3 placeras');
    assert.equal(
        prizeGivingSpeakerScript('Vinnaren, {name}, ombeds komma fram först.', 'Anna Andersson'),
        'Vinnaren, Anna Andersson, ombeds komma fram först.'
    );
});

test('TV mode is asked for with tv=1 in the hash or the search', () => {
    assert.equal(isTvModeRequested({ hash: '#maraton-monitor?tv=1', search: '' }), true);
    assert.equal(isTvModeRequested({ hash: '#speaker?id=abc&tv=true', search: '' }), true);
    assert.equal(isTvModeRequested({ hash: '#speaker', search: '?tv=1' }), true);
    assert.equal(isTvModeRequested({ hash: '#speaker?tv=0', search: '' }), false);
    assert.equal(isTvModeRequested({ hash: '#speaker', search: '' }), false);
    assert.equal(tvModeHash('maraton-monitor', '#maraton-monitor?id=x'), '#maraton-monitor?id=x&tv=1');
});

test('scroll hint shows while columns are cut off at the right', () => {
    assert.equal(hasMoreToTheRight({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 1400 }), true);
    assert.equal(hasMoreToTheRight({ scrollLeft: 400, clientWidth: 1000, scrollWidth: 1400 }), false);
    assert.equal(hasMoreToTheRight({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 1000 }), false);
});

test('speaker messages: newest first, escaped, nothing when empty', () => {
    const list = [
        { title: 'Old', body: 'a', timestamp: { seconds: 100 } },
        { title: '<b>New</b>', body: 'Paus 15 min', type: 'alert', timestamp: { seconds: 300 } },
        { title: '', body: '' },
        { title: 'Mid', timestamp: { seconds: 200 } }
    ];
    assert.deepEqual(pickSpeakerMessages(list, { limit: 2 }).map(m => m.body || m.title), ['Paus 15 min', 'Mid']);
    const html = renderSpeakerMessagesHtml(list, { title: 'Meddelanden' });
    assert.match(html, /&lt;b&gt;New&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<b>New/);
    assert.equal(renderSpeakerMessagesHtml([]), '');
});
