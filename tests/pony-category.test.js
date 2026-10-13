import test from 'node:test';
import assert from 'node:assert/strict';

import { detectTRCategoryFromEquipage } from '../js/core-engine/marathon.js';
import { buildEquipageState } from '../js/core-engine/stateSelector.js';

const eq = (className, horses = [], extra = {}) => buildEquipageState({ startNumber: 1, className, horses, ...extra });

test('the class letter is the class level, not the pony category', () => {
    // TR V Moment 163: A ≤107, B ≤130, C ≤140, D ≤148 cm
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt A Enbet Ponny', [{ heightCm: 140 }])), 'ponyCD');
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt B Enbet Ponny', [{ heightCm: 125 }])), 'ponyB');
    assert.equal(detectTRCategoryFromEquipage(eq('MSV A Par Ponny', [{ heightCm: 105 }])), 'ponyA');
});

test('a pony class without a height falls back to C-D as before; a horse class is horse', () => {
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt A Enbet Ponny')), 'ponyCD');
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt A Enbet Häst', [{ heightCm: 140 }])), 'horse');
});

test('heights typed as text count', () => {
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt B Enbet Ponny', [{ height: '128' }])), 'ponyB');
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt B Enbet Ponny', [{ height: '1,05' }])), 'ponyA');
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt B Enbet Ponny', [{ heightCm: '128 cm' }])), 'ponyB');
});

test('a merged class without horse/pony in the name uses the height', () => {
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt B Enbet', [{ heightCm: 128 }])), 'ponyB');
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt B Enbet', [{ heightCm: 160 }])), 'horse');
});

test('a stated category wins; a stated "ponny" without letter uses the height', () => {
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt A Enbet Ponny', [{ heightCm: 140 }], { ponyCategory: 'B' })), 'ponyB');
    assert.equal(detectTRCategoryFromEquipage(eq('Lätt A Enbet', [{ heightCm: 125 }], { category: 'Ponny' })), 'ponyB');
});
