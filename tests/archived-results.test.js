import test from 'node:test';
import assert from 'node:assert/strict';

import { applyArchivedSnapshot, isArchivedCompetition } from '../js/pages/shared/archivedResults.js';

test('an archived competition shows the values it was archived with', () => {
    const rows = [
        { startNumber: 1, dressage: { penalty: 40, percentAvg: 70 }, marathon: { totalPenalty: 60 }, precision: { pen: 3 }, totalPenalty: 103, isEliminated: false },
        { startNumber: 2, dressage: { penalty: 45 }, marathon: { totalPenalty: 50 }, precision: { pen: 0 }, totalPenalty: 95 },
        { startNumber: 3, totalPenalty: 120 }   // not in the archive: left as calculated
    ];
    const snapshot = { rows: [
        { startNumber: '1', dressagePenalty: 40.4, marathonPenalty: 60, precisionPenalty: 3, totalPenalty: 103.4, isEliminated: false },
        { startNumber: '2', dressagePenalty: 45, marathonPenalty: null, precisionPenalty: null, totalPenalty: null, isEliminated: true }
    ] };
    assert.equal(applyArchivedSnapshot(rows, snapshot), 2);
    assert.equal(rows[0].totalPenalty, 103.4);
    assert.equal(rows[0].dressage.penalty, 40.4);
    assert.equal(rows[0].dressage.percentAvg, 70, 'details stay');
    assert.equal(rows[1].isEliminated, true);
    assert.equal(rows[2].totalPenalty, 120);
    assert.equal(rows[2].fromArchive, undefined);
});

test('only locked or completed competitions count as archived; no snapshot changes nothing', () => {
    assert.equal(isArchivedCompetition({ locked: true }), true);
    assert.equal(isArchivedCompetition({ status: 'completed' }), true);
    assert.equal(isArchivedCompetition({ status: 'active' }), false);
    assert.equal(applyArchivedSnapshot([{ startNumber: 1 }], null), 0);
});
