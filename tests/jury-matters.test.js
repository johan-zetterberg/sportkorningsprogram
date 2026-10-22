// Open ground jury matters block finalizing, archiving and the TDB report
// (js/services/finalizeCompletenessUtils.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    JURY_OVERRIDE_WORD,
    findOpenJuryMatters,
    isJuryOverrideConfirmed,
    juryBlockMessage
} from '../js/services/finalizeCompletenessUtils.js';

const equipages = [
    { startNumber: '1', className: 'A', driverName: 'Anna', vetStrikePending: { phase: 'harness', incidentId: 'i1' } },
    { startNumber: '2', className: 'A' },
    { startNumber: '3', className: 'B' }
];
const incidents = [
    { type: 'protest', status: 'open', number: 4, startNumber: '2' },
    { type: 'protest', status: 'decided', number: 5, startNumber: '3' },
    { type: 'protest', status: 'open', number: 6, startNumber: '' },
    { type: 'incident', status: 'open', number: 7, startNumber: '3' },
    { type: 'protest', status: 'open', number: 8, startNumber: '3' }
];

test('one equipage: its pending vet strike and open protests naming it', () => {
    const one = findOpenJuryMatters({ equipages, incidents, startNumber: '1' });
    assert.deepEqual(one, ['#1 Anna: veterinärens beslut (selningskontrollen) väntar på domarkollegiets beslut.']);
    assert.deepEqual(findOpenJuryMatters({ equipages, incidents, startNumber: 2 }), ['Öppen protest nr 4 (#2) är inte avgjord.']);
    assert.deepEqual(findOpenJuryMatters({ equipages, incidents: [], startNumber: '9' }), []);
});

test('a class: its equipages; the whole competition: also protests without a start number', () => {
    assert.equal(findOpenJuryMatters({ equipages, incidents, classNames: ['A'] }).length, 2);
    assert.deepEqual(findOpenJuryMatters({ equipages, incidents, classNames: ['B'] }), ['Öppen protest nr 8 (#3) är inte avgjord.']);
    const all = findOpenJuryMatters({ equipages, incidents });
    assert.equal(all.length, 4);
    assert.ok(all.includes('Öppen protest nr 6 är inte avgjord.'));
});

test('the override needs the typed word', () => {
    assert.equal(isJuryOverrideConfirmed(` ${JURY_OVERRIDE_WORD.toLowerCase()} `), true);
    assert.equal(isJuryOverrideConfirmed('ja'), false);
    assert.equal(isJuryOverrideConfirmed(null), false);
    assert.match(juryBlockMessage('Arkiveringen', ['x'], { canOverride: true }), new RegExp(JURY_OVERRIDE_WORD));
    assert.doesNotMatch(juryBlockMessage('Arkiveringen', ['x']), new RegExp(JURY_OVERRIDE_WORD));
});
