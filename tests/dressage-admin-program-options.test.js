import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDressageProgramOptionLabel,
  getSelectableDressageProgramKeys,
  getDressageProgramTrNumber,
  isDressageProgramSelectable,
  sortDressageProgramKeys
} from '../js/pages/dressage/dressageAdminProgramOptions.js';

test('getDressageProgramTrNumber reads TR number from program name and source', () => {
  assert.equal(getDressageProgramTrNumber({ name: 'Lätt B (2020) (nr 522)' }), '522');
  assert.equal(getDressageProgramTrNumber({ source: '530. Medelsvårt nr 4. 20250122' }), '530');
  assert.equal(getDressageProgramTrNumber({ trNumber: 508 }), '508');
});

test('formatDressageProgramOptionLabel keeps TR number and internal key visible', () => {
  const label = formatDressageProgramOptionLabel('SvLB', {
    name: 'Lätt B (2020) (nr 522)',
    arena: '40x80'
  });

  assert.equal(label, 'nr 522 - Lätt B (2020), 40x80 - SvLB');
});

test('sortDressageProgramKeys sorts numbered programs by TR number first', () => {
  const sorted = sortDressageProgramKeys({
    FEIParaG1: { name: 'FEI Para Grad 1 (2024)' },
    SvLA: { name: 'Lätt A (2020) (nr 523)' },
    SvLB: { name: 'Lätt B (2020) (nr 522)' }
  });

  assert.deepEqual(sorted, ['SvLB', 'SvLA', 'FEIParaG1']);
});

test('selectable dressage programs exclude historical and explicitly disabled programs', () => {
  const programs = {
    active: { name: 'Aktivt program' },
    deprecated: { name: 'Utgånget program', deprecated: true },
    disabled: { name: 'Historiskt program', selectable: false }
  };

  assert.equal(isDressageProgramSelectable(programs.active), true);
  assert.equal(isDressageProgramSelectable(programs.deprecated), false);
  assert.equal(isDressageProgramSelectable(programs.disabled), false);
  assert.deepEqual(getSelectableDressageProgramKeys(programs), ['active']);
});
