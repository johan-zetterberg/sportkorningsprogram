import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTotalDisciplinePlacements } from '../js/pages/shared/totalResultRanking.js';

test('discipline placings on the total page are within the merged class', () => {
  const rows = [
    { startNumber: 1, className: 'Lätt A Enbet Ponny', displayGroupKey: 'GROUP:la', dressage: { penalty: 50 }, marathon: { totalPenalty: 80, finished: true }, precision: { pen: 3 } },
    { startNumber: 2, className: 'Lätt A Enbet Häst', displayGroupKey: 'GROUP:la', dressage: { penalty: 40 }, marathon: { totalPenalty: 90, finished: true }, precision: { pen: 0 } },
    { startNumber: 3, className: 'Lätt B', dressage: { penalty: 60 }, marathon: { totalPenalty: 70, finished: true }, precision: { pen: 6 } }
  ];
  applyTotalDisciplinePlacements(rows);
  // One merged class: 1 and 2 are placed against each other, not both first
  assert.deepEqual(rows.map(r => r.posDress), [2, 1, 1]);
  assert.deepEqual(rows.map(r => r.posMar), [1, 2, 1]);
  assert.deepEqual(rows.map(r => r.posPrec), [2, 1, 1]);
});

test('an archived discipline place is kept only where the list groups by the class itself', () => {
  const rows = [
    { startNumber: 1, className: 'A', displayGroupKey: 'GROUP:x', fromArchive: true, archivedDressagePlace: 1, dressage: { penalty: 50 } },
    { startNumber: 2, className: 'B', displayGroupKey: 'GROUP:x', fromArchive: true, archivedDressagePlace: 1, dressage: { penalty: 40 } }
  ];
  applyTotalDisciplinePlacements(rows);
  assert.deepEqual(rows.map(r => r.posDress), [2, 1]);
});
