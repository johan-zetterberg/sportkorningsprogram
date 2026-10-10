import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVagnbreddDropdownItems,
  buildVagnbreddSavePayload,
  normalizeVagnbreddEquipages,
  parseWidthValue,
  resolveVagnRuleRow,
  getDressageRule,
  getCarriageCompliance,
  saveCarriageToRegistry,
  lookupSavedCarriage,
  applyCarriageRegistryPrefill
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

test('resolveVagnRuleRow resolves correct TR Bilaga 2 row per discipline and category', () => {
  const horseSingle = { className: 'Medelsvår Häst Enbet' };
  const rowSingle = resolveVagnRuleRow(horseSingle);
  assert.equal(rowSingle.label, 'Häst enbet/tandem');
  assert.equal(getDressageRule(rowSingle, horseSingle.className).value, 125);
  assert.equal(getDressageRule(rowSingle, 'Svår Häst Enbet').value, 138);

  const horseFour = { className: 'Svår Häst Fyrspann' };
  const rowFour = resolveVagnRuleRow(horseFour);
  assert.equal(rowFour.label, 'Häst fyrspann');
  assert.equal(getDressageRule(rowFour, horseFour.className).value, 158);

  const ponyA = { className: 'Lätt A Ponny Enbet', horses: [{ type: 'A-ponny' }] };
  const rowPonyA = resolveVagnRuleRow(ponyA);
  assert.equal(rowPonyA.label, 'A-ponny enbet/tandem');
  assert.equal(getDressageRule(rowPonyA, 'Svår A-ponny').kind, 'forbidden');
});

test('getCarriageCompliance evaluates track width and flags narrow carriages', () => {
  // Compliant horse single in MSV (min 125 cm)
  const okEq = { className: 'Msv Häst Enbet', trackWidth: 126, safetyCheck: { approved: true } };
  const okRes = getCarriageCompliance(okEq, 'dressagePrecision');
  assert.equal(okRes.compliant, true);
  assert.equal(okRes.status, 'ok');

  // Too narrow in Svår Häst Enbet (min 138 cm, measured 130 cm)
  const narrowEq = { className: 'Svår Häst Enbet', trackWidth: 130 };
  const narrowRes = getCarriageCompliance(narrowEq, 'dressagePrecision');
  assert.equal(narrowRes.compliant, false);
  assert.equal(narrowRes.status, 'too_narrow');
  assert.equal(narrowRes.minWidth, 138);

  // Free track width in Lätt B
  const lbEq = { className: 'Lätt B Häst Enbet', trackWidth: 110 };
  const lbRes = getCarriageCompliance(lbEq, 'dressagePrecision');
  assert.equal(lbRes.compliant, true);
  assert.equal(lbRes.status, 'free');

  // Missing track width
  const missingEq = { className: 'Svår Häst Par' };
  const missingRes = getCarriageCompliance(missingEq, 'dressagePrecision');
  assert.equal(missingRes.compliant, null);
  assert.equal(missingRes.status, 'missing');
  assert.equal(missingRes.minWidth, 148);
});

test('saveCarriageToRegistry and lookupSavedCarriage persist and retrieve carriage widths', () => {
  const mockStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); }
  };

  const saved = saveCarriageToRegistry('Anna Andersson', {
    trackWidth: '138',
    marathonTrackWidth: '126',
    className: 'Svår Häst Enbet'
  }, mockStorage);
  assert.equal(saved, true);

  const lookup = lookupSavedCarriage('anna andersson', mockStorage);
  assert.ok(lookup);
  assert.equal(lookup.trackWidth, 138);
  assert.equal(lookup.marathonTrackWidth, 126);

  // Apply prefill to an equipage without trackWidth
  const equipage = {
    startNumber: 1,
    driverName: 'Anna Andersson',
    trackWidth: null,
    marathonTrackWidth: null
  };
  const prefilled = applyCarriageRegistryPrefill(equipage, mockStorage);
  assert.equal(prefilled.trackWidth, 138);
  assert.equal(prefilled.marathonTrackWidth, 126);
  assert.equal(prefilled.trackWidthSource, 'registry');
  assert.equal(prefilled.isPrefilledFromRegistry, true);
});
