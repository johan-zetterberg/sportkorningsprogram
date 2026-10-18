import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVetDatalistOptions,
  deriveVetStatusFromHorses,
  hasVetStruckHorse,
  filterVetEquipages,
  getHorsePhaseInspection,
  getViloboxBadgeInfo,
  getVetRemainingCount,
  getVetSearchStartNumber,
  isPulseWarning,
  applyVetResultsToHorses,
  buildVetStatusUpdate,
  planLegacyVetDataMigration,
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

test('buildVetStatusUpdate updates only the selected horse', () => {
  const { horses, payload } = buildVetStatusUpdate({ horses: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' }
  ] }, 'initial', { status: 'ombesiktning', horseKeys: ['b'] });

  assert.equal(horses[0].vetStatus, undefined);
  assert.equal(horses[1].vetStatus, 'ombesiktning');
  assert.ok(horses[1].vetCheckedAt);
  assert.deepEqual(Object.keys(payload.vetInspection_initial.horses), ['b']);
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

test('vilobox result and private clinical data are put back on the horse', () => {
  const equipage = {
    horses: [
      { id: 'h1', name: 'Thunder' },
      { id: 'h2', name: 'Lightning' }
    ],
    vetInspection_restArea: { horses: { h1: { status: 'besiktigad', checkedAt: '2026-05-16T11:45:00Z' } } }
  };
  const clinical = { h1: { restArea: { pulseBpm: 56, respiration: 'normal', mucosa: 'ok' } } };

  const updated = applyVetResultsToHorses(equipage, clinical);

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

  const uninspectedRestAreaEq = {
    status: 'besiktigad',
    horses: [
      { id: '1', vetStatus: 'besiktigad', inspections: { initial: { status: 'besiktigad' } } }
    ]
  };
  assert.equal(getViloboxBadgeInfo(uninspectedRestAreaEq).status, 'waiting');
  assert.equal(getViloboxBadgeInfo(uninspectedRestAreaEq).label, 'Väntar');
});

test('deriveVetStatusFromHorses preserves secretariat scratch in initial phase and isolates non-initial phases', () => {
  const horses = [{ name: 'A', vetStatus: 'besiktigad' }];
  assert.equal(deriveVetStatusFromHorses(horses, 'struken', 'initial'), 'struken');
  assert.equal(deriveVetStatusFromHorses(horses, 'besiktigad', 'harness'), 'anmäld');
  // A withdrawn equipage stays withdrawn in the later phases too (not queued there)
  assert.equal(deriveVetStatusFromHorses(horses, 'struken', 'restArea'), 'struken');
});

test('the vet can undo their own strike; a withdrawal by the secretariat stays', () => {
  const struckByVet = [{ name: 'A', vetStatus: 'struken' }];
  const approvedAgain = [{ name: 'A', vetStatus: 'besiktigad' }];
  // The vet struck the horse (status 'struken' came from the vet), then approved it
  assert.equal(hasVetStruckHorse(struckByVet), true);
  assert.equal(deriveVetStatusFromHorses(approvedAgain, 'struken', 'initial', { keepWithdrawn: !hasVetStruckHorse(struckByVet) }), 'besiktigad');
  // Partly inspected after the undo: not struck
  assert.equal(deriveVetStatusFromHorses([{ name: 'A', vetStatus: 'besiktigad' }, { name: 'B' }], 'struken', 'initial', { keepWithdrawn: false }), 'anmäld');
  // Withdrawn by the secretariat (no horse struck): stays withdrawn
  assert.equal(hasVetStruckHorse(approvedAgain), false);
  assert.equal(deriveVetStatusFromHorses(approvedAgain, 'struken', 'initial', { keepWithdrawn: !hasVetStruckHorse(approvedAgain) }), 'struken');
});

// --- Older vet data on the public equipage (migrateEquipagePrivacy) ---

const NOW = '2026-10-18T10:00:00.000Z';

// Deep merge, as a Firestore set with merge: true
function mergeDeep(target = {}, source = {}) {
  const out = { ...target };
  Object.entries(source).forEach(([key, value]) => {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])
      ? mergeDeep(out[key], value)
      : value;
  });
  return out;
}

// The stored documents after the plan was written (as the transaction does)
function applyMigration(state, plan) {
  const equipage = { ...state.equipage, ...plan.publicSet };
  plan.publicDeletes.forEach(key => { delete equipage[key]; });
  const privateEquipage = { ...(state.privateEquipage || {}) };
  plan.privateEquipageDeletes.forEach(key => { delete privateEquipage[key]; });
  return {
    equipage,
    privateEquipage,
    temperatures: mergeDeep(state.temperatures, plan.temperatures || {}),
    inspections: mergeDeep(state.inspections, plan.inspections || {}),
    notes: mergeDeep(state.notes, plan.notes || {})
  };
}

function migrate(state) {
  const plan = planLegacyVetDataMigration(state, { nowIso: NOW });
  assert.ok(plan, 'something to migrate');
  const after = applyMigration(state, plan);
  assert.equal(planLegacyVetDataMigration(after, { nowIso: NOW }), null, 'a second run changes nothing');
  return { plan, after };
}

test('legacy migration: public temperatures only move to the private document, emails scrubbed', () => {
  const { plan, after } = migrate({
    equipage: {
      startNumber: 5,
      horses: [{ id: 'h1', name: 'Nova' }],
      horseTemperatures: {
        h1: {
          'd1-morning': { temperatureC: 37.8, updatedBy: 'driver@example.com', slotId: 'd1-morning' },
          'd1-evening': { temperatureC: 38.0, updatedBy: 'uid-1', slotId: 'd1-evening' }
        }
      }
    }
  });
  assert.deepEqual(plan.publicDeletes, ['horseTemperatures']);
  assert.equal('horseTemperatures' in after.equipage, false);
  assert.equal(after.temperatures.h1['d1-morning'].temperatureC, 37.8);
  assert.equal(after.temperatures.h1['d1-morning'].updatedBy, '');
  assert.equal(after.temperatures.h1['d1-evening'].updatedBy, 'uid-1');
  // The temperatures alone do not touch the horses
  assert.equal('horses' in plan.publicSet, false);
});

test('legacy migration: a private temperature wins over the public one for the same slot', () => {
  const { plan, after } = migrate({
    equipage: {
      horses: [{ id: 'h1', name: 'Nova' }],
      horseTemperatures: {
        h1: {
          'd1-morning': { temperatureC: 37.5, slotId: 'd1-morning' },
          'd1-evening': { temperatureC: 38.1, slotId: 'd1-evening' }
        },
        // Oldest shape: the record straight under the horse key
        h2: { temperatureC: 37.9, updatedBy: 'x@example.com', slotId: 'd2-morning' }
      }
    },
    temperatures: { h1: { 'd1-morning': { temperatureC: 37.6, slotId: 'd1-morning' } } }
  });
  assert.deepEqual(Object.keys(plan.temperatures.h1), ['d1-evening'], 'only the slot missing privately is written');
  assert.equal(after.temperatures.h1['d1-morning'].temperatureC, 37.6, 'private value kept');
  assert.equal(after.temperatures.h1['d1-evening'].temperatureC, 38.1);
  assert.deepEqual(after.temperatures.h2['d2-morning'], { temperatureC: 37.9, updatedBy: '', slotId: 'd2-morning' });
});

test('legacy migration: clinical findings (pulse or pulseBpm) move to vetInspections, the result stays public', () => {
  const { plan, after } = migrate({
    equipage: {
      status: 'besiktigad',
      horses: [
        {
          id: 'h1', name: 'Thunder', vetStatus: 'besiktigad', vetCheckedAt: '2026-05-15T08:00:00Z',
          inspections: {
            initial: { status: 'besiktigad', checkedAt: '2026-05-15T08:00:00Z', notes: 'Rör sig rent' },
            restArea: { status: 'besiktigad', checkedAt: '2026-05-16T11:45:00Z', pulse: '56', respiration: 'normal', mucosa: 'ok' }
          }
        },
        {
          name: 'Lightning',
          inspections: {
            harness: { status: 'besiktigad', checkedAt: '2026-05-16T09:00:00Z', bitOk: true, harnessOk: false },
            restArea: { status: 'struken', pulseBpm: 72, notes: 'För hög vilopuls' }
          }
        }
      ]
    }
  });

  assert.deepEqual(after.inspections, {
    h1: { restArea: { pulseBpm: 56, respiration: 'normal', mucosa: 'ok', checkedAt: '2026-05-16T11:45:00Z' } },
    Lightning: {
      harness: { bitOk: true, harnessOk: false, checkedAt: '2026-05-16T09:00:00Z' },
      restArea: { pulseBpm: 72 }
    }
  });
  // Only status and checkedAt stay on the public horses
  assert.deepEqual(after.equipage.horses[0].inspections, {
    initial: { status: 'besiktigad', checkedAt: '2026-05-15T08:00:00Z' },
    restArea: { status: 'besiktigad', checkedAt: '2026-05-16T11:45:00Z' }
  });
  assert.deepEqual(after.equipage.horses[1].inspections.restArea, { status: 'struken' });
  assert.equal(after.equipage.horses[0].vetStatus, 'besiktigad');

  // The public per-phase results the current pages read
  assert.deepEqual(after.equipage.vetInspection_restArea.horses, {
    h1: { status: 'besiktigad', checkedAt: '2026-05-16T11:45:00Z' },
    Lightning: { status: 'struken', checkedAt: null }
  });
  assert.equal(after.equipage.vetInspection_restArea.status, 'struken');
  assert.equal(after.equipage.vetInspection_restArea.updatedAt, NOW);
  assert.equal(after.equipage.vetInspection_initial.horses.h1.status, 'besiktigad');
  assert.equal(getViloboxBadgeInfo(after.equipage).status, 'unfit');
  // The equipage status is not rewritten (it counts for the results)
  assert.equal('status' in plan.publicSet, false);

  // Notes per phase, with the horse's name
  assert.deepEqual(after.notes, {
    initial: 'Thunder: Rör sig rent',
    restArea: 'Lightning: För hög vilopuls'
  });
  // Nothing clinical left on the public document
  const publicJson = JSON.stringify(after.equipage);
  ['pulse', 'respiration', 'mucosa', 'bitOk', 'harnessOk', 'notes', 'Rör sig rent'].forEach(word => {
    assert.equal(publicJson.includes(word), false, `${word} left on the public equipage`);
  });
});

test('legacy migration: private findings and an existing phase result win', () => {
  const { plan, after } = migrate({
    equipage: {
      horses: [{ id: 'h1', inspections: { restArea: { status: 'ombesiktning', pulseBpm: 70 } } }],
      vetInspection_restArea: { status: 'besiktigad', updatedAt: '2026-05-16T12:00:00Z', horses: { h1: { status: 'besiktigad', checkedAt: '2026-05-16T12:00:00Z' } } }
    },
    inspections: { h1: { restArea: { pulseBpm: 58, checkedAt: '2026-05-16T12:00:00Z' } } }
  });
  assert.equal(plan.inspections, null, 'the vet\'s newer findings are not overwritten');
  assert.equal(after.inspections.h1.restArea.pulseBpm, 58);
  assert.equal('vetInspection_restArea' in plan.publicSet, false);
  assert.equal(after.equipage.vetInspection_restArea.horses.h1.status, 'besiktigad');
  assert.deepEqual(after.equipage.horses[0].inspections.restArea, { status: 'ombesiktning' });
});

test('legacy migration: vet notes from the public and the private equipage move to vetNotes', () => {
  const { plan, after } = migrate({
    equipage: {
      horses: [{ id: 'h1', name: 'Nova', vetNote: 'Lätt hälta vä fram' }],
      vetNotes: 'Allmänt pigg',
      vetNotes_final: 'OK efter maraton',
      vetNote: { harness: 'Bettet byttes' }
    },
    privateEquipage: { email: 'driver@example.com', vetNotes_restArea: 'Vattnad' },
    notes: { final: 'Nyare anteckning' }
  });
  assert.deepEqual(plan.publicDeletes.sort(), ['vetNote', 'vetNotes', 'vetNotes_final']);
  assert.deepEqual(plan.privateEquipageDeletes, ['vetNotes_restArea']);
  assert.deepEqual(after.notes, {
    initial: 'Allmänt pigg; Nova: Lätt hälta vä fram',
    harness: 'Bettet byttes',
    restArea: 'Vattnad',
    final: 'Nyare anteckning'
  });
  assert.deepEqual(after.privateEquipage, { email: 'driver@example.com' });
  assert.equal('vetNote' in after.equipage.horses[0], false);
});

test('legacy migration: an equipage in the current model has nothing to migrate', () => {
  const current = {
    equipage: {
      status: 'besiktigad',
      speakerNotes: 'Första start',
      horses: [{ id: 'h1', name: 'Nova', vetStatus: 'besiktigad', inspections: { initial: { status: 'besiktigad', checkedAt: NOW } } }],
      vetInspection_initial: { status: 'besiktigad', updatedAt: NOW, horses: { h1: { status: 'besiktigad', checkedAt: NOW } } }
    },
    privateEquipage: { email: 'driver@example.com' },
    temperatures: { h1: { 'd1-morning': { temperatureC: 37.5 } } },
    inspections: { h1: { initial: { pulseBpm: 40 } } },
    notes: { initial: 'OK' }
  };
  assert.equal(planLegacyVetDataMigration(current), null);
  assert.equal(planLegacyVetDataMigration({ equipage: { horses: [{ name: 'A' }] } }), null);
  assert.equal(planLegacyVetDataMigration(), null);
});


