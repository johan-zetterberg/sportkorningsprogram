import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyVetResultsToHorses,
  buildVetStatusUpdate,
  getViloboxBadgeInfo,
  VET_CLINICAL_FIELDS
} from '../js/pages/shared/vetCheckUtils.js';
import { buildVetCheckPdfRows, mergeVetPrivateData } from '../js/pdf/vetCheckPdfUtils.js';
import { inspectedHorseKeys, mergeDeclaredHorses } from '../functions/src/declarationUtils.js';
import { normalizeJoinRoles, resolveJoinRoleForPin } from '../functions/src/adminJoin.js';
import { equipageWriteAffectsResults } from '../functions/src/triggerFilters.js';

const equipage = () => ({
  startNumber: 7,
  status: 'anmäld',
  horses: [{ name: 'Ella', id: 'SE001' }, { name: 'Bo', chip: '752' }]
});

const NOW = '2026-10-14T09:00:00.000Z';

test('a vet decision writes only public result fields, never clinical data or horses', () => {
  const { payload, derived } = buildVetStatusUpdate(equipage(), 'restArea', { status: 'besiktigad', nowIso: NOW });
  assert.deepEqual(Object.keys(payload).sort(), ['vetInspection_restArea']);
  assert.equal(derived, 'besiktigad');
  assert.deepEqual(payload.vetInspection_restArea, {
    horses: { SE001: { status: 'besiktigad', checkedAt: NOW }, 752: { status: 'besiktigad', checkedAt: NOW } },
    status: 'besiktigad',
    updatedAt: NOW
  });
  const flat = JSON.stringify(payload);
  VET_CLINICAL_FIELDS.forEach(field => assert.equal(flat.includes(field), false, field));
});

test('the first inspection also sets the equipage status; one horse at a time keeps the others', () => {
  const first = buildVetStatusUpdate(equipage(), 'initial', { status: 'besiktigad', horseKeys: ['SE001'], nowIso: NOW });
  // Bo not inspected yet: the equipage is not approved
  assert.equal(first.payload.status, 'anmäld');
  const afterFirst = { ...equipage(), ...first.payload };
  const second = buildVetStatusUpdate(afterFirst, 'initial', { status: 'besiktigad', horseKeys: ['752'], nowIso: NOW });
  assert.equal(second.payload.status, 'besiktigad');
  assert.deepEqual(Object.keys(second.payload.vetInspection_initial.horses).sort(), ['752', 'SE001']);
  assert.ok(second.horses.every(horse => horse.vetStatus === 'besiktigad'));
});

test('struck in the rest area: unfit for stage B; undoing a struck horse gives the horses\' status', () => {
  const struck = buildVetStatusUpdate(equipage(), 'restArea', { status: 'struken', horseKeys: ['SE001'], nowIso: NOW });
  assert.equal(struck.payload.vetUnfitStageB, true);
  assert.equal(getViloboxBadgeInfo({ ...equipage(), ...struck.payload }).status, 'unfit');

  const initialStruck = buildVetStatusUpdate(equipage(), 'initial', { status: 'struken', nowIso: NOW });
  assert.equal(initialStruck.payload.status, 'struken');
  const undone = buildVetStatusUpdate({ ...equipage(), ...initialStruck.payload }, 'initial', { status: 'besiktigad', nowIso: NOW });
  assert.equal(undone.payload.status, 'besiktigad');
  // A withdrawal by the secretariat stays
  const withdrawn = buildVetStatusUpdate({ ...equipage(), status: 'struken' }, 'initial', { status: 'besiktigad', nowIso: NOW });
  assert.equal(withdrawn.payload.status, 'struken');
});

test('applyVetResultsToHorses merges public results and private findings onto the horses', () => {
  const eq = {
    ...equipage(),
    vetInspection_restArea: { status: 'ombesiktning', horses: { SE001: { status: 'ombesiktning', checkedAt: NOW } } }
  };
  const publicView = applyVetResultsToHorses(eq);
  assert.deepEqual(publicView[0].inspections.restArea, { status: 'ombesiktning', checkedAt: NOW });
  assert.equal(publicView[1], eq.horses[1]);

  const vetView = applyVetResultsToHorses(eq, { SE001: { restArea: { pulseBpm: 68, respiration: 'elevated', checkedAt: 'x' } } });
  assert.equal(vetView[0].inspections.restArea.pulseBpm, 68);
  assert.equal(vetView[0].inspections.restArea.status, 'ombesiktning');
  assert.equal(vetView[0].inspections.restArea.checkedAt, NOW);
  // Older data with the results on the horse itself is still read
  const legacy = applyVetResultsToHorses({ horses: [{ name: 'Old', vetStatus: 'besiktigad', inspections: { harness: { status: 'besiktigad' } } }] });
  assert.equal(legacy[0].vetStatus, 'besiktigad');
  assert.equal(legacy[0].inspections.harness.status, 'besiktigad');
});

test('the vet PDF shows public results for any official, the pulse only with the findings merged', () => {
  const eq = {
    ...equipage(),
    vetInspection_initial: { status: 'besiktigad', horses: { SE001: { status: 'besiktigad' } } },
    vetInspection_restArea: { status: 'besiktigad', horses: { SE001: { status: 'besiktigad' } } }
  };
  const [row] = buildVetCheckPdfRows([eq]);
  assert.equal(row[4], 'Godkänd');
  assert.equal(row[6], 'Godkänd');

  const withFindings = { ...eq, horses: applyVetResultsToHorses(eq, { SE001: { restArea: { pulseBpm: 56 } } }) };
  assert.match(buildVetCheckPdfRows([withFindings])[0][6], /56 bpm/);

  // The reports page for an admin: findings and notes read once and merged
  const merged = mergeVetPrivateData([eq],
    new Map([['7', { SE001: { restArea: { pulseBpm: 70 } } }]]),
    new Map([['7', { initial: 'Halt vä fram', restArea: 'Trött' }]]));
  const [adminRow] = buildVetCheckPdfRows(merged);
  assert.match(adminRow[6], /70 bpm \(!\)/);
  assert.equal(adminRow[8], 'Förbesiktning: Halt vä fram; Vilobox: Trött');
  // Without private data the merge changes nothing that is shown
  assert.deepEqual(buildVetCheckPdfRows(mergeVetPrivateData([eq])), buildVetCheckPdfRows([eq]));
});

test('a horse with a vet result on the equipage keeps its name and key in the declaration', () => {
  const eq = {
    horses: [{ name: 'Bo', chip: '752' }, { name: 'Nisse' }],
    vetInspection_harness: { horses: { 752: { status: 'besiktigad' } } }
  };
  const keys = inspectedHorseKeys(eq);
  assert.deepEqual([...keys], ['752']);
  assert.throws(() => mergeDeclaredHorses(eq.horses, [{ name: 'Bosse' }, { name: 'Nisse' }], keys), /besiktad/);
  assert.throws(() => mergeDeclaredHorses(eq.horses, [{ name: 'Nisse' }], keys), /kan inte tas bort/);
  // An id would change the key the vet's results are stored under
  assert.throws(() => mergeDeclaredHorses(eq.horses, [{ name: 'Bo', id: 'SE9' }, { name: 'Nisse' }], keys), /besiktad/);
  // The uninspected horse can still be renamed
  const merged = mergeDeclaredHorses(eq.horses, [{ name: 'Bo' }, { name: 'Nils' }], keys);
  assert.equal(merged[1].name, 'Nils');
});

test('the vet role joins by its own PIN', () => {
  const secrets = { accessCode: 'admin-pin', accessCode_speaker: 'speaker-pin', accessCode_vet: 'vet-pin' };
  assert.equal(resolveJoinRoleForPin('vet-pin', secrets), 'vet');
  assert.deepEqual(normalizeJoinRoles(['vet', 'speaker']), ['vet', 'speaker']);
});

test('the vet\'s public results do not wake the result recalculation; the status does', () => {
  const before = { status: 'anmäld', horses: [] };
  assert.equal(equipageWriteAffectsResults(before, { ...before, vetInspection_initial: { status: 'besiktigad' }, vetUnfitStageB: true }), false);
  assert.equal(equipageWriteAffectsResults(before, { ...before, status: 'struken' }), true);
});
