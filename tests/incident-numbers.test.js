// The incident log's final entry numbers (functions/src/incidentNumbers.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignIncidentNumber } from '../functions/src/incidentNumbers.js';
import { changedIncidentFields } from '../js/services/incidentUtils.js';

test('incident numbers: the device number stands when it is the next one', () => {
    const first = assignIncidentNumber(null, 'a', 1, []);
    assert.deepEqual(first, { number: 1, changed: false, counter: { last: 1, assigned: { a: 1 } } });
    const second = assignIncidentNumber(first.counter, 'b', 2);
    assert.equal(second.number, 2);
    assert.equal(second.changed, false);
});

test('incident numbers: two devices with the same number get different numbers', () => {
    const a = assignIncidentNumber({ last: 4, assigned: {} }, 'a', 5);
    const b = assignIncidentNumber(a.counter, 'b', 5);
    assert.equal(a.number, 5);
    assert.equal(b.number, 6);
    assert.equal(b.changed, true);
});

test('incident numbers: first use starts from the highest existing number; each entry once', () => {
    const r = assignIncidentNumber(null, 'new', 3, [1, 2, 7, 'x', null]);
    assert.equal(r.number, 8);
    assert.equal(assignIncidentNumber(r.counter, 'new', 8), null, 'numbered already: nothing');
});

test('incident updates write only the changed fields', () => {
    const before = { type: 'protest', status: 'open', description: 'A', decision: '', decidedBy: '' };
    const entry = { type: 'protest', status: 'decided', description: 'A', decision: 'Avslås', decidedBy: '', obstacle: '' };
    assert.deepEqual(changedIncidentFields(before, entry), { status: 'decided', decision: 'Avslås' });
});
