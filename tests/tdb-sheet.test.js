import test from 'node:test';
import assert from 'node:assert/strict';

import { isClearRoundClass } from '../js/core-engine/marathon.js';
import { buildTdbSheet, deadlineFor, formatTdbPenalty, tdbListToText } from '../js/services/tdbSheetUtils.js';

const horse = (name, license, regNo = '') => ({ name, license, regNo });

function row(sn, className, over = {}) {
    return {
        startNumber: sn,
        className,
        driverName: `Kusk ${sn}`,
        licence: `K${sn}`,
        horses: [horse(`Häst ${sn}`, `H${sn}`)],
        tdbClassNumber: 1,
        tdbClassLabel: className,
        dressage: { penalty: 40.5 },
        marathon: { totalPenalty: 20 },
        precision: { totalPenalty: 10 },
        totalPenalty: 70.5,
        isEliminated: false,
        plac: 1,
        ...over
    };
}

const only = (rows, options) => buildTdbSheet(rows, options)[0];

test('normal class: start order, shared place and D/M/P/total rows', () => {
    const list = only([
        row(3, 'Msv', { plac: 2 }),
        row(1, 'Msv', { plac: 1 }),
        row(2, 'Msv', { plac: 1 })
    ]);
    assert.equal(list.status, 'ok');
    assert.deepEqual(list.entries.map((e) => e.startNumber), [1, 2, 3]);
    assert.deepEqual(list.entries.map((e) => e.placingCode), [1, 1, 2]);
    const first = list.entries[0];
    assert.deepEqual(first.moments.map((m) => m.moment), ['D', 'M', 'P']);
    assert.equal(first.moments[0].penaltyText, '40,50');
    assert.equal(first.totalText, '70,50');
    assert.equal(first.driverLicence, 'K1');
    assert.deepEqual(first.horses, [{ name: 'Häst 1', licence: 'H1', regNo: '' }]);
});

test('horse licence falls back to the registration number; pairs list every horse', () => {
    const list = only([
        row(1, 'Par', { horses: [horse('A', '', 'SE123'), horse('B', 'L2', 'SE456')] }),
        row(2, 'Par', { plac: 2 })
    ]);
    assert.deepEqual(list.entries[0].horses.map((h) => h.licence), ['SE123', 'L2']);
});

test('a struken ekipage that never started is left out', () => {
    const list = only([
        row(1, 'Msv'),
        row(2, 'Msv', { plac: 2 }),
        row(3, 'Msv', { status: 'struken', dressage: { penalty: null }, marathon: { totalPenalty: null }, precision: { totalPenalty: null }, totalPenalty: null, plac: '' })
    ]);
    assert.deepEqual(list.entries.map((e) => e.startNumber), [1, 2]);
});

test('eliminated in the marathon: 99 with a D row and an M row only', () => {
    const list = only([
        row(1, 'Msv'),
        row(2, 'Msv', {
            marathon: { totalPenalty: null, eliminated: true },
            precision: { totalPenalty: null },
            totalPenalty: Infinity,
            isEliminated: true,
            plac: ''
        })
    ]);
    const e = list.entries[1];
    assert.equal(e.placingCode, 99);
    assert.deepEqual(e.moments.map((m) => m.moment), ['D', 'M']);
    assert.equal(e.moments[1].penaltyText, 'ELIM');
    assert.equal(e.total, null);
});

test('struken after the start is 99', () => {
    const list = only([
        row(1, 'Msv'),
        row(2, 'Msv', { status: 'struken', marathon: { totalPenalty: null }, precision: { totalPenalty: null }, totalPenalty: null, plac: '' })
    ]);
    assert.equal(list.entries[1].placingCode, 99);
    assert.deepEqual(list.entries[1].moments.map((m) => m.moment), ['D']);
});

test('clear round class: passed = 1 (shared), not passed = 98', () => {
    const cr = (sn, approved, pen) => row(sn, 'Clear round', {
        dressage: { penalty: null },
        precision: { totalPenalty: null },
        marathon: { totalPenalty: pen, isClearRound: true, clearRoundApproved: approved },
        totalPenalty: pen,
        plac: ''
    });
    const list = only([cr(1, true, 0), cr(2, true, 0), cr(3, false, 4)]);
    assert.equal(list.clearRound, true);
    assert.deepEqual(list.entries.map((e) => e.placingCode), [1, 1, 98]);
    assert.deepEqual(list.entries[0].moments.map((m) => m.moment), ['M']);
});

// TR V 509.3: "Kriterier för clear round är i dressyr högst 80 straffpoäng,
// i maraton och precision 0 straffpoäng. Tid i maratonhinder ger inte
// straffpoäng." Every moment the class drove counts, not only the marathon
test('clear round over all driven moments: D ≤ 80, M 0, P 0 (TR V 509.3)', () => {
    const cr = (sn, d, m, p) => row(sn, 'Lätt B CR', {
        dressage: { penalty: d, isClearRound: true },
        // The marathon alone was clear: its own approval must not decide
        marathon: { totalPenalty: m, isClearRound: true, clearRoundApproved: m === 0 },
        precision: { totalPenalty: p, isClearRound: true },
        totalPenalty: null,
        plac: ''
    });
    const list = only([cr(1, 40, 0, 3), cr(2, 95, 0, 0), cr(3, 80, 0, 0), cr(4, 79.99, 0, 0)]);
    assert.equal(list.clearRound, true);
    // D40 M0 P3 -> 98; D95 M0 P0 -> 98; D80 M0 P0 -> 1
    assert.deepEqual(list.entries.map((e) => [e.startNumber, e.placingCode]), [[3, 1], [4, 1], [1, 98], [2, 98]]);

    // A driven moment without a result: not started there, struken (TR 532.4) = 99
    const missing = only([cr(1, 40, 0, 0), cr(2, 40, 0, null)]);
    assert.deepEqual(missing.entries.map((e) => [e.startNumber, e.placingCode, e.reason]), [[1, 1, 'clearRoundPassed'], [2, 99, 'notStarted']]);
});

test('clear round in a precision-only class: the moments not driven are ignored', () => {
    const pOnly = (sn, p) => row(sn, 'Lätt B CR P', {
        dressage: { penalty: null },
        marathon: { totalPenalty: null },
        precision: { totalPenalty: p, isClearRound: true },
        isClearRound: true,
        totalPenalty: null,
        plac: ''
    });
    const list = only([pOnly(1, 0), pOnly(2, 5), pOnly(3, 0)]);
    assert.deepEqual(list.entries.map((e) => [e.startNumber, e.placingCode]), [[1, 1], [3, 1], [2, 98]]);
    assert.deepEqual(list.entries[0].moments.map((m) => m.moment), ['P']);
});

test('a single starter gets 0', () => {
    const list = only([
        row(1, 'Ensam'),
        row(2, 'Ensam', { dressage: { penalty: null }, marathon: { totalPenalty: null }, precision: { totalPenalty: null }, totalPenalty: null, plac: '' })
    ]);
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0].placingCode, 0);
});

test('a class where no one started is noResults', () => {
    const none = { dressage: { penalty: null }, marathon: { totalPenalty: null }, precision: { totalPenalty: null }, totalPenalty: null, plac: '' };
    const list = only([row(1, 'Tom', none), row(2, 'Tom', none)]);
    assert.equal(list.status, 'noResults');
    assert.deepEqual(list.entries, []);
});

test('merged pony/horse list is one list with both TDB class numbers', () => {
    const merged = { _mergedKey: 'grp-1', _mergedLabel: 'Ponny + Häst Msv' };
    const lists = buildTdbSheet([
        row(1, 'Ponny Msv', { ...merged, tdbClassNumber: 11, tdbClassLabel: 'Ponny Msv' }),
        row(2, 'Häst Msv', { ...merged, tdbClassNumber: 12, tdbClassLabel: 'Häst Msv', plac: 2 })
    ]);
    assert.equal(lists.length, 1);
    assert.equal(lists[0].groupLabel, 'Ponny + Häst Msv');
    assert.deepEqual(lists[0].tdbClasses, [
        { number: '11', label: 'Ponny Msv' },
        { number: '12', label: 'Häst Msv' }
    ]);
    assert.equal(lists[0].entries.length, 2);
});

test('a moment that was not driven gets no row', () => {
    const list = only([
        row(1, 'Lätt', { precision: { totalPenalty: null }, totalPenalty: 60.5 }),
        row(2, 'Lätt', { precision: { totalPenalty: null }, totalPenalty: 70, plac: 2 })
    ]);
    assert.deepEqual(list.entries[0].moments.map((m) => m.moment), ['D', 'M']);
});

test('0* class: placings but no result rows', () => {
    const list = only([row(1, 'Lätt 0*'), row(2, 'Lätt 0*', { plac: 2 })]);
    assert.equal(list.zeroStar, true);
    assert.deepEqual(list.entries.map((e) => e.placingCode), [1, 2]);
    assert.deepEqual(list.entries[0].moments, []);
    assert.equal(list.entries[0].total, null);
});

test('archived rows use the archived placing', () => {
    const list = only([row(1, 'Msv', { plac: 3, archivedPlac: 1 }), row(2, 'Msv', { plac: 1, archivedPlac: 2 })]);
    assert.deepEqual(list.entries.map((e) => e.placingCode), [1, 2]);
});

test('deadlineFor: five days after the last date', () => {
    assert.equal(deadlineFor({ dates: '2026-05-15 - 2026-05-17' }), '2026-05-22');
    assert.equal(deadlineFor({ dates: '2026-05-30' }), '2026-06-04');
    assert.equal(deadlineFor({ dates: 'maj' }), null);
    assert.equal(deadlineFor({}), null);
});

test('penalty format and tab-separated copy text', () => {
    assert.equal(formatTdbPenalty(3), '3,00');
    assert.equal(formatTdbPenalty(null), '');
    const list = only([row(1, 'Msv'), row(2, 'Msv', { plac: 2 })]);
    const lines = tdbListToText(list).split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[1], ['1', 'Kusk 1', 'K1', 'Häst 1', 'H1', '40,50', '20,00', '10,00', '70,50'].join('\t'));
});

test('entries are ordered by placing, then 0/98/99; shared places and 99s keep start-number order', () => {
    const none = { dressage: { penalty: null }, precision: { totalPenalty: null } };
    const elim = (sn) => row(sn, 'Msv', { marathon: { totalPenalty: null, eliminated: true }, precision: { totalPenalty: null }, totalPenalty: Infinity, isEliminated: true, plac: '' });
    const list = only([
        elim(1),
        row(2, 'Msv', { plac: 3 }),
        elim(3),
        row(4, 'Msv', { plac: 1 }),
        row(5, 'Msv', { plac: 1 }),
        row(6, 'Msv', { plac: 2 }),
        row(7, 'Msv', { ...none, marathon: { totalPenalty: null }, totalPenalty: null, plac: '' })
    ]);
    assert.deepEqual(list.entries.map((e) => e.startNumber), [4, 5, 6, 2, 1, 3]);
    assert.deepEqual(list.entries.map((e) => e.placingCode), [1, 1, 2, 3, 99, 99]);
    assert.deepEqual(list.entries.map((e) => e.order), [1, 2, 3, 4, 5, 6]);
    const text = tdbListToText(list).split('\n').slice(1).map((l) => l.split('\t')[0]);
    assert.deepEqual(text, ['1', '1', '2', '3', '99', '99']);
});

test('clear round marked only in the dressage class config is detected', () => {
    const plain = (sn, over = {}) => row(sn, 'Lätt CR', { marathon: { totalPenalty: 0, clearRoundApproved: true }, dressage: { penalty: null }, precision: { totalPenalty: null }, totalPenalty: 0, plac: '', ...over });
    const rows = [plain(1), plain(2, { marathon: { totalPenalty: 4 }, totalPenalty: 4 })];
    const dressyrClassConfig = { 'Lätt CR': { clearRound: true } };
    const list = only(rows, { isClearRoundClass: (name) => isClearRoundClass(name, { marathonConfig: {}, dressyrClassConfig }) });
    assert.equal(list.clearRound, true);
    assert.deepEqual(list.entries.map((e) => e.placingCode), [1, 98]);
    assert.equal(only(rows).clearRound, false);
});