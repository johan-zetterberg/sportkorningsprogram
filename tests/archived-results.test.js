import test from 'node:test';
import assert from 'node:assert/strict';

import { applyArchivedSnapshot, archivedDisciplineDetails, archivedDisciplinePenalty, archivedNoticeHtml, isArchivedCompetition } from '../js/pages/shared/archivedResults.js';
import { applyArchivedPrizeGivingRow } from '../js/pages/shared/prizeGivingUtils.js';

test('an archived competition shows the values it was archived with', () => {
    const rows = [
        { startNumber: 1, dressage: { penalty: 40, percentAvg: 70 }, marathon: { totalPenalty: 60 }, precision: { pen: 3 }, totalPenalty: 103, isEliminated: false },
        { startNumber: 2, dressage: { penalty: 45 }, marathon: { totalPenalty: 50 }, precision: { pen: 0 }, totalPenalty: 95 },
        { startNumber: 3, totalPenalty: 120 }   // not in the archive: left as calculated
    ];
    const snapshot = { rows: [
        { startNumber: '1', plac: 1, dressagePenalty: 40.4, dressagePlace: 1, dressageEliminated: false, marathonPenalty: 60, marathonPlace: 2, marathonBPenalty: 55, precisionPenalty: 3, precisionPlace: 1, precisionTimeMs: 88000, totalPenalty: 103.4, isEliminated: false },
        { startNumber: '2', dressagePenalty: 45, dressageEliminated: false, marathonPenalty: null, marathonEliminated: true, precisionPenalty: null, precisionEliminated: false, totalPenalty: null, isEliminated: true }
    ] };
    assert.equal(applyArchivedSnapshot(rows, snapshot), 2);
    assert.equal(rows[0].totalPenalty, 103.4);
    assert.equal(rows[0].dressage.penalty, 40.4);
    assert.equal(rows[0].dressage.percentAvg, 70, 'details stay');
    assert.equal(rows[0].posDress, 1);
    assert.equal(rows[0].posMar, 2);
    assert.equal(rows[0].posPrec, 1);
    assert.equal(rows[0].marathon.bPenalty, 55);
    assert.equal(rows[0].precision.timeMs, 88000);
    assert.equal(rows[1].isEliminated, true);
    assert.equal(rows[1].dressage.eliminated, false);
    assert.equal(rows[1].marathon.eliminated, true);
    assert.equal(rows[2].totalPenalty, 120);
    assert.equal(rows[2].fromArchive, undefined);
});

test('only locked or completed competitions count as archived; no snapshot changes nothing', () => {
    assert.equal(isArchivedCompetition({ locked: true }), true);
    assert.equal(isArchivedCompetition({ status: 'completed' }), true);
    assert.equal(isArchivedCompetition({ status: 'active' }), false);
    assert.equal(applyArchivedSnapshot([{ startNumber: 1 }], null), 0);
});

test('archivedDisciplinePenalty: per discipline, with what the snapshot can tell about elimination', () => {
    const snapshot = { rows: [
        { startNumber: '1', dressagePenalty: 40.4, marathonPenalty: 60, precisionPenalty: 3, totalPenalty: 103.4, isEliminated: false },
        { startNumber: '2', dressagePenalty: 45, marathonPenalty: null, precisionPenalty: null, totalPenalty: null, isEliminated: true },
        { startNumber: '3', dressagePenalty: 42, dressageEliminated: false, dressagePlace: 2, marathonPenalty: null, marathonEliminated: true, totalPenalty: null, isEliminated: true }
    ] };
    assert.deepEqual(archivedDisciplinePenalty(snapshot, 1, 'dressage'), { found: true, penalty: 40.4, isEliminated: false });
    assert.deepEqual(archivedDisciplinePenalty(snapshot, '1', 'total'), { found: true, penalty: 103.4, isEliminated: false });
    // Older snapshot, eliminated, no marathon penalty: maybe never started on the
    // marathon (eliminated elsewhere), so unknown: the page keeps its own
    assert.deepEqual(archivedDisciplinePenalty(snapshot, 2, 'marathon'), { found: true, penalty: null, isEliminated: null });
    // Legacy snapshot without per-discipline flag: null when it has a penalty here
    assert.equal(archivedDisciplinePenalty(snapshot, 2, 'dressage').isEliminated, null);
    // New snapshot with explicit dressageEliminated: false knows dressage was not eliminated
    assert.equal(archivedDisciplinePenalty(snapshot, 3, 'dressage').isEliminated, false);
    assert.equal(archivedDisciplineDetails(snapshot, 3, 'dressage').place, 2);
    assert.equal(archivedDisciplinePenalty(snapshot, 2, 'total').isEliminated, true);
    assert.equal(archivedDisciplinePenalty(snapshot, 9, 'dressage').found, false);
    assert.equal(archivedDisciplinePenalty(null, 1, 'dressage').found, false);
    assert.equal(archivedDisciplinePenalty(snapshot, 1, 'unknown').found, false);
});

test('archived notice is only shown with a snapshot', () => {
    assert.equal(archivedNoticeHtml(null), '');
    assert.match(archivedNoticeHtml({ archivedAt: Date.UTC(2026, 9, 12) }), /Arkiverat resultat \(2026-10-1[23]\)/);
});

test('prize giving uses the archived values for the active discipline', () => {
    const snapshot = { rows: [
        { startNumber: '1', dressagePenalty: 40, marathonPenalty: 60, precisionPenalty: 3, totalPenalty: 103, isEliminated: false },
        { startNumber: '2', dressagePenalty: 45, marathonPenalty: null, precisionPenalty: null, totalPenalty: null, isEliminated: true }
    ] };
    const row = { startNumber: 1, dPen: 41, mPen: 61, pPen: 4, score: 106, mRes: { totalPenalty: 61 }, pCalc: { totalPenalty: 4 } };
    const total = applyArchivedPrizeGivingRow(row, snapshot, 'total');
    assert.equal(total.score, 103);
    assert.equal(total.mRes.totalPenalty, 60);
    assert.equal(applyArchivedPrizeGivingRow(row, snapshot, 'marathon').score, 60);
    const elim = applyArchivedPrizeGivingRow({ startNumber: 2, score: 99 }, snapshot, 'total');
    assert.equal(elim.isEliminated, true);
    assert.equal(elim.score, null);
    // Not archived, or no snapshot: unchanged
    assert.equal(applyArchivedPrizeGivingRow({ startNumber: 7, score: 5 }, snapshot).score, 5);
    assert.equal(applyArchivedPrizeGivingRow(row, null), row);
});