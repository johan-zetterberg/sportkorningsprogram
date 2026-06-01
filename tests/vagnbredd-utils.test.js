import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVagnbreddDropdownItems,
  buildVagnbreddSavePayload,
  normalizeVagnbreddEquipages,
  parseWidthValue
} from '../js/pages/shared/vagnbreddUtils.js';

test('normalizeVagnbreddEquipages sorts valid equipages and separates incomplete data', () => {
  const { valid, invalid } = normalizeVagnbreddEquipages([
    { startNumber: 12, driverName: 'B' },
    { startNumber: null, driverName: 'Missing start' },
    { startNumber: 4, driverName: 'A' },
    { startNumber: 6, driverName: '' }
  ]);

  assert.deepEqual(valid.map(eq => eq.startNumber), [4, 12]);
  assert.equal(invalid.length, 2);
});

test('buildVagnbreddDropdownItems counts checked equipages', () => {
  const result = buildVagnbreddDropdownItems([
    { startNumber: 1, driverName: 'A', safetyCheck: { approved: true } },
    { startNumber: 2, driverName: 'B', safetyCheck: { approved: false } },
    { startNumber: 3, driverName: 'C' }
  ]);

  assert.equal(result.checkedCount, 2);
  assert.equal(result.totalCount, 3);
  assert.deepEqual(result.items.map(item => item.value), [1, 2, 3]);
});

test('parseWidthValue accepts positive integers and treats empty or invalid as null', () => {
  assert.equal(parseWidthValue('138'), 138);
  assert.equal(parseWidthValue('138.5'), 138);
  assert.equal(parseWidthValue(''), null);
  assert.equal(parseWidthValue('0'), null);
  assert.equal(parseWidthValue('-12'), null);
  assert.equal(parseWidthValue('abc'), null);
});

test('buildVagnbreddSavePayload includes null widths so saved values can be cleared', () => {
  assert.deepEqual(buildVagnbreddSavePayload({
    precisionWidth: '',
    marathonWidth: '142',
    approved: true,
    comment: ' kontroll '
  }), {
    trackWidth: null,
    marathonTrackWidth: 142,
    safetyCheck: {
      approved: true,
      comment: 'kontroll'
    }
  });
});
