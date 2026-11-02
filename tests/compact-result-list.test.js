import test from 'node:test';
import assert from 'node:assert/strict';

import { compactResultListHtml, getResultDensity, setResultDensity, shortDriverName } from '../js/ui/compactResultList.js';

const columns = [
    { key: 'dressage', label: 'Dr' },
    { key: 'total', label: 'Tot' }
];

test('compact result list: one row per equipage, class headings across all columns', () => {
    const html = compactResultListHtml({
        columns,
        items: [
            { type: 'group', label: 'Lätt A' },
            { startNumber: 7, place: 1, name: 'Anna <A>', sub: 'Lätt A', cells: { dressage: '48.00', total: '<span class="cr-total">48.00</span>' }, state: 'leader' },
            { startNumber: 8, place: null, name: 'Bo', sub: '', cells: { dressage: '50.00' }, state: 'elim' }
        ]
    });
    assert.match(html, /<th scope="colgroup" colspan="5"><span>Lätt A<\/span><\/th>/);
    // No part-result columns: the plain list, no sideways scrolling
    assert.doesNotMatch(html, /cr-scroll/);
    assert.equal((html.match(/<tr class="cr-row/g) || []).length, 2);
    assert.match(html, /class="cr-row cr-leader" data-start="7" tabindex="0"/);
    assert.match(html, /class="cr-row cr-elim" data-start="8"/);
    // Text is escaped, cell HTML is the caller's
    assert.match(html, /Anna &lt;A&gt;/);
    assert.match(html, /<span class="cr-total">48.00<\/span>/);
    // No place and a missing cell show a dash; no sub line without a class
    assert.match(html, /<td class="cr-place">—<\/td>/);
    assert.match(html, /<td class="cr-num">—<\/td>/);
    assert.equal((html.match(/cr-sub/g) || []).length, 1);
});

test('compact result list: an empty list says so', () => {
    const html = compactResultListHtml({ columns, items: [], emptyText: 'Inga resultat' });
    assert.match(html, /<td class="cr-empty" colspan="5">Inga resultat<\/td>/);
});

test('compact result list: the density choice defaults to compact and survives no storage', () => {
    const saved = globalThis.localStorage;
    try {
        const store = new Map();
        globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
        assert.equal(getResultDensity(), 'compact');
        setResultDensity('cards');
        assert.equal(getResultDensity(), 'cards');
        setResultDensity('full');
        assert.equal(getResultDensity(), 'full');
        setResultDensity('anything');
        assert.equal(getResultDensity(), 'compact');
        globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
        assert.equal(getResultDensity(), 'compact');
        assert.doesNotThrow(() => setResultDensity('cards'));
    } finally {
        globalThis.localStorage = saved;
    }
});

test('compact result list: the compact view leaves the part results out', () => {
    const html = compactResultListHtml({
        columns: [...columns, { key: 'o1', label: 'H1', extra: true }],
        items: [{ startNumber: 3, place: 2, name: 'Cia Berg', cells: { dressage: '1', total: '2', o1: '0.00' } }],
        density: 'compact'
    });
    assert.doesNotMatch(html, /cr-scroll|cr-extra|H1/);
    assert.match(html, />Cia Berg</);
});

test('compact result list: a driver name shortens to initials and the last name', () => {
    assert.equal(shortDriverName('Anna Maria Svensson'), 'A. M. Svensson');
    assert.equal(shortDriverName('  Bo   Ek '), 'B. Ek');
    assert.equal(shortDriverName('Cher'), 'Cher');
    assert.equal(shortDriverName('Seeder Kusk 10'), 'S. Kusk 10');
    assert.equal(shortDriverName('Łukasz Řehoř Őrsi'), 'Ł. Ř. Őrsi');
    assert.equal(shortDriverName(null), '');
});

test('compact result list: the full view scrolls the part results sideways next to fixed driver columns', () => {
    const html = compactResultListHtml({
        columns: [...columns, { key: 'o1', label: 'H1', extra: true }, { key: 'o2', label: 'H2', extra: true }],
        items: [{ startNumber: 3, place: 2, name: 'Cia Berg', cells: { dressage: '1', total: '2', o1: '0.00' } }],
        scrollKey: 'maraton',
        density: 'full'
    });
    assert.match(html, /<div class="cr-scroll" data-cr-key="maraton"><table class="compact-results cr-wide">/);
    assert.match(html, /<span class="cr-driver" title="Cia Berg">C. Berg<\/span>/);
    assert.match(html, /class="cr-scroll-hint"/);
    assert.equal((html.match(/<th scope="col" class="cr-num cr-extra"/g) || []).length, 2);
    assert.match(html, /<td class="cr-num cr-extra">0.00<\/td><td class="cr-num cr-extra">—<\/td>|<td class="cr-num cr-extra">0.00<\/td>\s*<td class="cr-num cr-extra">—<\/td>/);
});
