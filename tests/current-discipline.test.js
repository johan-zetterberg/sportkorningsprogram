import test from 'node:test';
import assert from 'node:assert/strict';

import { currentDiscipline, disciplineSchedule } from '../js/utils/currentDiscipline.js';

const times = {
    1: { dressage: '2026-05-15T09:00', marathon: '2026-05-16T10:00', precision: '2026-05-17T09:30' },
    2: { dressage: '2026-05-15T08:30', marathon: '2026-05-16T10:10', precision: '2026-05-17T09:40' }
};
const at = (iso) => new Date(iso);

test('current discipline: the discipline of the day', () => {
    assert.equal(currentDiscipline({ times, now: at('2026-05-15T12:00') }), 'dressage');
    assert.equal(currentDiscipline({ times, now: at('2026-05-16T07:00') }), 'marathon');
    assert.equal(currentDiscipline({ times, now: at('2026-05-17T15:00') }), 'precision');
});

test('current discipline: before, between and after the days', () => {
    assert.equal(currentDiscipline({ times, now: at('2026-05-10T12:00') }), 'dressage');
    assert.equal(currentDiscipline({ times, now: at('2026-05-18T08:00') }), 'total');
    const gap = { 1: { dressage: '2026-05-15T09:00', marathon: '2026-05-17T10:00' } };
    assert.equal(currentDiscipline({ times: gap, now: at('2026-05-16T12:00') }), 'dressage');
});

test('current discipline: two disciplines on one day switch at the second one\'s first start', () => {
    const sameDay = { 1: { dressage: '2026-05-15T09:00', marathon: '2026-05-15T14:00' } };
    assert.equal(currentDiscipline({ times: sameDay, now: at('2026-05-15T08:00') }), 'dressage');
    assert.equal(currentDiscipline({ times: sameDay, now: at('2026-05-15T13:59') }), 'dressage');
    assert.equal(currentDiscipline({ times: sameDay, now: at('2026-05-15T14:00') }), 'marathon');
});

test('current discipline: an admin\'s choice wins; no start times is dressage', () => {
    assert.equal(currentDiscipline({ times, override: 'total', now: at('2026-05-15T12:00') }), 'total');
    assert.equal(currentDiscipline({ times, override: 'bogus', now: at('2026-05-15T12:00') }), 'dressage');
    assert.equal(currentDiscipline({ times: {}, now: at('2026-05-15T12:00') }), 'dressage');
    assert.deepEqual(disciplineSchedule({ 1: { dressage: 'not a time' } }), {});
});
