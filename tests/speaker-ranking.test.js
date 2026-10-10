import test from 'node:test';
import assert from 'node:assert/strict';

import { rankSpeakerResultRows } from '../js/pages/shared/speakerCalculations.js';

function buildRow(startNumber, {
  totalPenalty,
  dressagePenalty,
  marathonPenalty,
  precisionPenalty = 0,
  eliminated = false,
  dressageEliminated = false
}) {
  return {
    startNumber,
    totalPenalty,
    total: eliminated ? Infinity : totalPenalty,
    isEliminated: eliminated,
    dressage: { penalty: dressagePenalty, eliminated: dressageEliminated },
    marathon: { totalPenalty: marathonPenalty, eliminated: false },
    precision: { pen: precisionPenalty, eliminated: false }
  };
}

test('speaker total ranking shares place when stated tiebreakers are equal', () => {
  const rows = [
    buildRow(9, { totalPenalty: 100, dressagePenalty: 40, marathonPenalty: 50, precisionPenalty: 10 }),
    buildRow(2, { totalPenalty: 100, dressagePenalty: 40, marathonPenalty: 50, precisionPenalty: 2 }),
    buildRow(3, { totalPenalty: 101, dressagePenalty: 39, marathonPenalty: 49, precisionPenalty: 13 })
  ];

  rankSpeakerResultRows(rows);

  assert.deepEqual(rows.map(row => row.startNumber), [9, 2, 3]);
  assert.deepEqual(rows.map(row => row.plac), [1, 1, 3]);
});

test('speaker dressage ranking shares place for equal dressage penalties', () => {
  const rows = [
    buildRow(1, { totalPenalty: 100, dressagePenalty: 42, marathonPenalty: 50 }),
    buildRow(2, { totalPenalty: 101, dressagePenalty: 42, marathonPenalty: 50 }),
    buildRow(3, { totalPenalty: 102, dressagePenalty: 43, marathonPenalty: 50 }),
    buildRow(4, { totalPenalty: null, dressagePenalty: 40, marathonPenalty: 50, dressageEliminated: true })
  ];

  rankSpeakerResultRows(rows);

  assert.deepEqual(rows.map(row => row.posDress), [1, 1, 3, null]);
});
