import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVetDatalistOptions,
  deriveVetStatusFromHorses,
  filterVetEquipages,
  getHorsePhaseInspection,
  getViloboxBadgeInfo,
  getVetRemainingCount,
  getVetSearchStartNumber,
  isPulseWarning,
  updateHorsePhaseInspection,
  updateHorseVetStatus,
  resolveVetFilteredState,
  sortVetEquipages,
  VET_PHASES,
  MAX_RECOMMENDED_PULSE_BPM
} from '../js/pages/shared/vetCheckUtils.js';

const equipages = [
  { startNumber: 3, driverName: 'Clara', clubName: 'C', status: 'besiktigad', horses: [{ name: 'Nova' }] },
  { startNumber: 1, driverName: 'Anna', clubName: 'A', status: 'ombesiktning', horses: [{ name: 'Luna' }] },
  { startNumber: 2, driverName: 'Bo', clubName: 'B', status: 'anmäld', horses: [{ name: 'Zorro' }] },
  { startNumber: 4, driverName: 'Dan', clubName: 'D', status: 'struken', horses: [] }
];

test('sortVetEquipages prioritizes hold and waiting before approved and withdrawn', () => {
  assert.deepEqual(sortVetEquipages(equipages).map(eq => eq.startNumber), [1, 2, 3, 4]);
});

test('getVetRemainingCount excludes approved and withdrawn equipages', () => {
  assert.equal(getVetRemainingCount(equipages), 2);
});

test('filterVetEquipages searches start number, driver, club and horse names', () => {
  assert.deepEqual(filterVetEquipages(equipages, 'zorro').map(eq => eq.startNumber), [2]);
  assert.deepEqual(filterVetEquipages(equipages, 'Clara').map(eq => eq.startNumber), [3]);
});

test('getVetSearchStartNumber parses datalist values', () => {
  assert.equal(getVetSearchStartNumber('12 - Driver'), '12');
  assert.equal(getVetSearchStartNumber('Driver'), '');
});

test('resolveVetFilteredState jumps to selected start number and requests cleared search', () => {
  const state = resolveVetFilteredState(equipages, '3 - Clara');

  assert.equal(state.clearSearch, true);
  assert.equal(state.filtered[state.index].startNumber, 3);
});

test('buildVetDatalistOptions builds stable datalist labels in sorted order', () => {
  assert.deepEqual(buildVetDatalistOptions(equipages).map(item => item.value), [
    '1 - Anna',
    '2 - Bo',
    '3 - Clara',
    '4 - Dan'
  ]);
});

test('deriveVetStatusFromHorses summarizes per-horse inspection state', () => {
  assert.equal(deriveVetStatusFromHorses([
    { name: 'A', vetStatus: 'besiktigad' },
    { name: 'B', vetStatus: 'ombesiktning' }
  ], 'incheckad'), 'ombesiktning');

  assert.equal(deriveVetStatusFromHorses([
    { name: 'A', vetStatus: 'besiktigad' },
    { name: 'B', vetStatus: 'besiktigad' }
  ], 'incheckad'), 'besiktigad');

  assert.equal(deriveVetStatusFromHorses([
    { name: 'A', vetStatus: 'besiktigad' },
    { name: 'B', vetStatus: 'struken' }
  ], 'incheckad'), 'struken');
});

test('updateHorseVetStatus updates only the selected horse', () => {
  const updated = updateHorseVetStatus([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' }
  ], 'b', 'ombesiktning');

  assert.equal(updated[0].vetStatus, undefined);
  assert.equal(updated[1].vetStatus, 'ombesiktning');
  assert.ok(updated[1].vetCheckedAt);
});

test('VET_PHASES defines initial, harness, restArea, and final inspections per TR Mom 526', () => {
  assert.ok(VET_PHASES.initial);
  assert.ok(VET_PHASES.harness);
  assert.ok(VET_PHASES.restArea);
  assert.ok(VET_PHASES.final);
  assert.match(VET_PHASES.initial.trRule, /526\.1/);
  assert.match(VET_PHASES.restArea.trRule, /526\.4/);
});

test('isPulseWarning warns if pulse exceeds recommended threshold (64 bpm)', () => {
  assert.equal(isPulseWarning(56), false);
  assert.equal(isPulseWarning(64), false);
  assert.equal(isPulseWarning(68), true);
  assert.equal(isPulseWarning('72'), true);
  assert.equal(isPulseWarning(null), false);
});

test('updateHorsePhaseInspection saves vilobox clinical data per horse', () => {
  const horses = [
    { id: 'h1', name: 'Thunder' },
    { id: 'h2', name: 'Lightning' }
  ];

  const updated = updateHorsePhaseInspection(horses, 'h1', 'restArea', {
    status: 'besiktigad',
    pulseBpm: 56,
    respiration: 'normal',
    mucosa: 'ok',
    notes: 'Fräsch och pigg'
  });

  const inspection1 = getHorsePhaseInspection(updated[0], 'restArea');
  assert.equal(inspection1.status, 'besiktigad');
  assert.equal(inspection1.pulseBpm, 56);
  assert.equal(inspection1.respiration, 'normal');
  assert.ok(inspection1.checkedAt);

  const inspection2 = getHorsePhaseInspection(updated[1], 'restArea');
  assert.equal(inspection2.status, 'anmäld');
});

test('getViloboxBadgeInfo derives clean status and badge styling', () => {
  const approvedEq = {
    horses: [
      { id: '1', inspections: { restArea: { status: 'besiktigad' } } }
    ]
  };
  assert.equal(getViloboxBadgeInfo(approvedEq).status, 'approved');
  assert.equal(getViloboxBadgeInfo(approvedEq).label, 'Godkänd för B');

  const holdEq = {
    horses: [
      { id: '1', inspections: { restArea: { status: 'ombesiktning' } } }
    ]
  };
  assert.equal(getViloboxBadgeInfo(holdEq).status, 'hold');

  const unfitEq = {
    horses: [
      { id: '1', inspections: { restArea: { status: 'struken' } } }
    ]
  };
  assert.equal(getViloboxBadgeInfo(unfitEq).status, 'unfit');
  assert.equal(getViloboxBadgeInfo(unfitEq).label, 'Startförbud B');
});

