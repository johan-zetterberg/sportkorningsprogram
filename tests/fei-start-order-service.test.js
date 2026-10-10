import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFeiDressageStartOrder,
  buildFeiMarathonStartOrder,
  buildFeiPrecisionStartOrder,
  getFeiDressageStartSlots,
  supportsFeiTeamBlocks,
  validateFeiDressageStartOrder
} from '../js/services/feiStartOrderService.js';

test('FEI block helper supports Championship / CAIO and Para, but not Pony or Youth', () => {
  assert.equal(supportsFeiTeamBlocks('fei_championship_caio'), true);
  assert.equal(supportsFeiTeamBlocks('fei_para_championship'), true);
  assert.equal(supportsFeiTeamBlocks('fei_pony_championship'), false);
  assert.equal(supportsFeiTeamBlocks('fei_youth_championship'), false);
});

test('FEI dressage declaration requires each team member once and one vacant slot for two members', () => {
  const equipages = [{ id: 'a' }, { id: 'b' }];
  const team = { id: 'team-1', name: 'Sweden', members: ['a', 'b'] };

  assert.deepEqual(getFeiDressageStartSlots(team), [null, null, null]);
  assert.match(
    validateFeiDressageStartOrder({ teams: [team], equipages, profileId: 'fei_championship_caio' }).join(' '),
    /deklarera startposition/
  );

  const validTeam = { ...team, feiDressageStartSlots: [null, 'a', 'b'] };
  assert.deepEqual(
    validateFeiDressageStartOrder({ teams: [validTeam], equipages, profileId: 'fei_championship_caio' }),
    []
  );
});

test('FEI dressage order places declared team positions in B, D and F', () => {
  const equipages = [
    { id: 'a', startNumber: 1 }, { id: 'b', startNumber: 2 }, { id: 'c', startNumber: 3 },
    { id: 'i-1', startNumber: 4 }, { id: 'i-2', startNumber: 5 }, { id: 'i-3', startNumber: 6 }
  ];
  const teams = [{ id: 'team-1', name: 'Sweden', members: ['a', 'b', 'c'], feiDressageStartSlots: ['a', 'b', 'c'] }];

  const order = buildFeiDressageStartOrder({
    teams,
    equipages,
    profileId: 'fei_championship_caio',
    seed: 'official-draw-1'
  });

  assert.deepEqual(order.issues, []);
  assert.deepEqual(order.blocks.B.map(row => row.id), ['a']);
  assert.deepEqual(order.blocks.D.map(row => row.id), ['b']);
  assert.deepEqual(order.blocks.F.map(row => row.id), ['c']);
  assert.equal(order.blocks.A.length, 1);
  assert.equal(order.blocks.C.length, 1);
  assert.equal(order.blocks.E.length, 1);
  assert.ok(order.rows.findIndex(row => row.id === 'a') < order.rows.findIndex(row => row.id === 'b'));
  assert.ok(order.rows.findIndex(row => row.id === 'b') < order.rows.findIndex(row => row.id === 'c'));
});

test('FEI marathon order moves best team dressage result to F, second to D and third to B', () => {
  const rows = [
    { id: 'a', startNumber: 1, dressagePenalty: 30 },
    { id: 'b', startNumber: 2, dressagePenalty: 10 },
    { id: 'c', startNumber: 3, dressagePenalty: 20 },
    { id: 'i-1', startNumber: 4, dressagePenalty: 60 },
    { id: 'i-2', startNumber: 5, dressagePenalty: 50 },
    { id: 'i-3', startNumber: 6, dressagePenalty: 40 }
  ];
  const teams = [{ id: 'team-1', name: 'Sweden', members: ['a', 'b', 'c'], feiDressageStartSlots: ['a', 'b', 'c'] }];

  const order = buildFeiMarathonStartOrder({
    teams,
    rows,
    profileId: 'fei_championship_caio',
    dressageAssignments: { '1': 'B', '2': 'D', '3': 'F' }
  });

  assert.deepEqual(order.issues, []);
  assert.deepEqual(order.rows.map(row => row.id), ['i-1', 'a', 'i-2', 'c', 'i-3', 'b']);
  assert.deepEqual(order.blocks.B.map(row => row.id), ['a']);
  assert.deepEqual(order.blocks.D.map(row => row.id), ['c']);
  assert.deepEqual(order.blocks.F.map(row => row.id), ['b']);
});

test('FEI precision order starts retired, then eliminated, then reverse combined results with marathon tie-break', () => {
  const order = buildFeiPrecisionStartOrder([
    { id: 'a', startNumber: 1, dressagePenalty: 40, marathonPenalty: 60 },
    { id: 'b', startNumber: 2, dressagePenalty: 50, marathonPenalty: 50 },
    { id: 'elim', startNumber: 3, eliminated: true },
    { id: 'retired', startNumber: 4, retired: true }
  ]);

  assert.deepEqual(order.issues, []);
  assert.deepEqual(order.rows.map(row => row.id), ['retired', 'elim', 'a', 'b']);
});
