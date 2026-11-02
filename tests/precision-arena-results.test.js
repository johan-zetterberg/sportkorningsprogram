import test from 'node:test';
import assert from 'node:assert/strict';

import { calculatePrecisionResult } from '../js/utils/precisionCalculation.js';
import {
    arenaDesktopHtml,
    arenaMobileHtml,
    buildArenaSections,
    formatArenaSeconds,
    isArenaEquipage,
    splitArenaEquipages
} from '../js/pages/precision/precisionArenaResults.js';

const CLASS = 'Fyrspann Arena';
const configOf = (arena = {}) => ({ courses: { [CLASS]: { format: 'arena', arena } } });
const done = (timeMs, extra = {}) => ({ timeMs, finalized: false, inProgress: false, status: 'Klar', ...extra });
const row = (startNumber, driverName = `Kusk ${startNumber}`, extra = {}) => ({ startNumber, driverName, className: CLASS, ...extra });

function sectionsOf(entries, config, opts = {}) {
    const docs = new Map(entries.map((e) => [String(e.row.startNumber), e.doc]));
    const rows = entries.map((e) => e.row);
    return buildArenaSections(rows, (r) => calculatePrecisionResult(docs.get(String(r.startNumber)) || {}, r, config), opts);
}

const compactStub = ({ columns, items, scrollKey }) => `<table data-key="${scrollKey}" data-cols="${columns.map((c) => c.key).join(',')}">${items.map((i) => `<tr data-start="${i.startNumber ?? ''}">${i.place ?? ''}</tr>`).join('')}</table>`;

test('arena results: places in order of seconds, eliminated at the bottom, running without place', () => {
    const config = configOf({ rules: 'TR' });
    const [section] = sectionsOf([
        { row: row(1), doc: done(70000, { knocks: ['3'], knocksVersion: 2 }) }, // 74 s
        { row: row(2), doc: done(66000) },
        { row: row(3), doc: { eliminated: true, inProgress: false, status: 'Utesluten', timeMs: 50000 } },
        { row: row(4), doc: { running: true, liveTimeMs: 30000 } },
        { row: row(5), doc: {} }
    ], config);
    assert.equal(section.label, CLASS);
    assert.equal(section.competition, 1);
    assert.equal(section.open, 'none');
    assert.deepEqual(section.entries.map((e) => e.sn), ['2', '1', '4', '5']);
    assert.deepEqual(section.entries.map((e) => e.state), ['placed', 'placed', 'live', 'wait']);
    assert.deepEqual(section.entries.slice(0, 2).map((e) => e.place), [1, 2]);
    assert.equal(section.entries[1].score, 74);
    assert.equal(section.entries[1].penaltySec, 4);
    assert.equal(section.entries[1].knocks, '3');
    assert.equal(section.entries[1].timeLabel, '01:10,00');
    assert.equal(section.entries[2].place, null);
    assert.deepEqual(section.outEntries.map((e) => e.sn), ['3']);
    assert.equal(section.outEntries[0].outText.length > 0, true);
    assert.equal(section.noteKey, null);
    assert.equal(section.startOrder, null);
});

test('arena results: a visible filter changes the rows, not the places', () => {
    const config = configOf({ rules: 'TR' });
    const [section] = sectionsOf([
        { row: row(1), doc: done(60000) },
        { row: row(2), doc: done(65000) }
    ], config, { visible: new Set(['2']) });
    assert.deepEqual(section.entries.map((e) => [e.sn, e.place]), [['2', 2]]);
    assert.equal(sectionsOf([{ row: row(1), doc: done(60000) }], config, { visible: new Set() }).length, 0);
});

test('arena results: drive-off column for the best three, provisional places while pending', () => {
    const config = configOf({ rules: 'FEI' });
    const entries = [
        { row: row(1), doc: done(60000) },
        { row: row(2), doc: done(62000) },
        { row: row(3), doc: done(64000) },
        { row: row(4), doc: done(70000) }
    ];
    let [section] = sectionsOf(entries, config);
    assert.equal(section.open, 'top3');
    assert.equal(section.noteKey, 'arena_result_note_top3_zero');
    assert.deepEqual(section.entries.map((e) => e.driveOff?.text ?? null), ['–', '–', '–', null]);
    assert.deepEqual(section.entries.map((e) => e.provisional), [true, true, true, false]);
    assert.equal(section.entries[0].placeLabel, '(1)');
    // Reverse order of merit, the leader last
    assert.deepEqual(section.driveOffOrder.map((e) => e.sn), ['3', '2', '1']);

    entries[0].doc = { ...entries[0].doc, rounds: { driveOff: done(41000) } };
    entries[1].doc = { ...entries[1].doc, rounds: { driveOff: { eliminated: true, inProgress: false, status: 'Utesluten' } } };
    entries[2].doc = { ...entries[2].doc, rounds: { driveOff: done(40000) } };
    [section] = sectionsOf(entries, config);
    assert.deepEqual(section.entries.map((e) => e.sn), ['3', '1', '2', '4']);
    assert.deepEqual(section.entries.map((e) => e.driveOff?.text ?? null), ['40,00', '41,00', 'Utesluten', null]);
    assert.equal(section.entries[2].driveOff.tone, 'elim');
    assert.deepEqual(section.entries.map((e) => e.provisional), [false, false, false, false]);
    assert.equal(section.driveOffOrder.length, 0);
});

test('arena results: drive-off open to all added to the first round has its own note', () => {
    const [section] = sectionsOf([
        { row: row(1), doc: { ...done(60000), rounds: { driveOff: done(50000) } } },
        { row: row(2), doc: { ...done(65000), rounds: { driveOff: done(40000) } } }
    ], configOf({ rules: 'FEI', driveOff1: 'all' }));
    assert.equal(section.noteKey, 'arena_result_note_all_added');
    // 60 + 50 = 110 against 65 + 40 = 105
    assert.deepEqual(section.entries.map((e) => e.sn), ['2', '1']);
});

test('arena results: competition 2 with its own places and the start order from competition 1', () => {
    const config = configOf({ rules: 'FEI', competitions: 2 });
    const entries = [
        { row: row(1), doc: done(60000) },
        { row: row(2), doc: done(62000) },
        { row: row(3), doc: done(64000) },
        { row: row(4), doc: done(70000) },
        { row: row(5), doc: { eliminated: true, inProgress: false, status: 'Utesluten' } }
    ];
    // Drive-off 1 decided: 1 wins, 2 and 3 behind
    const driveOff = [[0, 41000], [1, 42000], [2, 43000]];
    driveOff.forEach(([i, ms]) => { entries[i].doc = { ...entries[i].doc, rounds: { driveOff: done(ms) } }; });
    let sections = sectionsOf(entries, config);
    assert.deepEqual(sections.map((s) => [s.competition, s.empty]), [[1, false], [2, true]]);
    const [c1, c2] = sections;
    assert.equal(c1.competitions, 2);
    assert.deepEqual(c1.entries.map((e) => e.sn), ['1', '2', '3', '4']);
    // Reverse order of merit, the eliminated first
    assert.deepEqual(c2.startOrder.map((e) => e.sn), ['5', '4', '3', '2', '1']);
    assert.equal(c2.entries.length, 0);

    // Competition 2: 4 fastest, 2 next
    entries[3].doc = { ...entries[3].doc, rounds: { phase2: done(55000) } };
    entries[1].doc = { ...entries[1].doc, rounds: { ...entries[1].doc.rounds, phase2: done(58000) } };
    sections = sectionsOf(entries, config);
    const c2b = sections.find((s) => s.competition === 2);
    assert.equal(c2b.empty, false);
    assert.deepEqual(c2b.entries.map((e) => [e.sn, e.place]), [['4', 1], ['2', 2]]);
    assert.equal(c2b.open, 'top3');
    assert.equal(c2b.entries[0].provisional, true);
    // The not yet driven rows are not listed in competition 2 (they are in the start order)
    assert.equal(c2b.entries.some((e) => e.sn === '1'), false);
    assert.equal(c2b.startOrder.length, 5);
});

test('arena results: only arena classes, per merged group and sorted by label', () => {
    const config = { courses: { [CLASS]: { format: 'arena', arena: { rules: 'TR' } } } };
    const other = { startNumber: 9, className: 'Ponny', driverName: 'Pelle' };
    assert.equal(isArenaEquipage(row(1), config), true);
    assert.equal(isArenaEquipage(other, config), false);
    const { arena, other: rest } = splitArenaEquipages([row(1), other], config);
    assert.equal(arena.length, 1);
    assert.equal(rest.length, 1);

    const rows = [row(1, 'A', { _mergedKey: 'MERGE', _mergedLabel: 'Slogan' }), row(2, 'B', { _mergedKey: 'MERGE', _mergedLabel: 'Slogan' }), row(3, 'C')];
    const docs = { 1: done(60000), 2: done(59000), 3: done(61000) };
    const sections = buildArenaSections([...rows, other], (r) => calculatePrecisionResult(docs[r.startNumber] || {}, r, config));
    assert.deepEqual(sections.map((s) => s.label), [CLASS, 'Slogan']);
    assert.deepEqual(sections[1].entries.map((e) => [e.sn, e.place]), [['2', 1], ['1', 2]]);
});

test('arena results: html for desktop and phone', () => {
    const config = configOf({ rules: 'FEI', competitions: 2 });
    const sections = sectionsOf([
        { row: row(1, 'Anna <b>', { clubName: 'Klubben' }), doc: done(60000, { knocks: ['5', '5#2'], knocksVersion: 2 }) },
        { row: row(2), doc: done(62000) },
        { row: row(3), doc: { eliminated: true, inProgress: false, status: 'Utesluten' } }
    ], config);
    const html = arenaDesktopHtml(sections);
    assert.match(html, /Tävling 1/);
    assert.match(html, /Tävling 2/);
    assert.match(html, /Omkörning: de tre bästa, tiden från noll/);
    assert.match(html, /Startordning omkörning/);
    assert.match(html, /Startordning tävling 2/);
    assert.match(html, /Resultat \(s\)/);
    assert.match(html, /5 ×2/);
    assert.match(html, /Anna &lt;b&gt;/); // escaped
    assert.match(html, /Uteslutna/);
    assert.doesNotMatch(html, /<script|onclick=/);

    const phone = arenaMobileHtml(sections, compactStub);
    assert.match(phone, /data-key="precision-arena-CLASS:Fyrspann Arena\|1"/);
    assert.match(phone, /data-cols="result,driveOff,time,knocks,penalty"/);
    assert.match(phone, /Startordning tävling 2/);

    // One competition: the heading is just the class
    const single = sectionsOf([{ row: row(1), doc: done(60000) }], configOf({ rules: 'TR' }));
    assert.match(arenaDesktopHtml(single), new RegExp(`<h3 class="arena-title">${CLASS}</h3>`));
    assert.doesNotMatch(arenaDesktopHtml(single), /Omkörning/);
});

test('arena seconds format', () => {
    assert.equal(formatArenaSeconds(88.2), '88,20');
    assert.equal(formatArenaSeconds(null), '—');
});
