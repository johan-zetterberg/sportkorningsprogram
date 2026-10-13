import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertArchiveCanFinalize,
  buildArchiveCompetition,
  buildArchiveSnapshot,
  findIncompleteArchiveRows,
  buildFinalizeCompetitionPatch,
  buildReopenCompetitionPatch
} from '../js/services/archivingUtils.js';

test('assertArchiveCanFinalize rejects missing competition and empty archive rows', () => {
  assert.throws(
    () => assertArchiveCanFinalize({ competitionId: '', competitionExists: true, rows: [{}] }),
    /Competition ID required/
  );
  assert.throws(
    () => assertArchiveCanFinalize({ competitionId: 'abc', competitionExists: false, rows: [{}] }),
    /Tavlingen hittades inte/
  );
  assert.throws(
    () => assertArchiveCanFinalize({ competitionId: 'abc', competitionExists: true, rows: [] }),
    /inga resultat\/ekipage/
  );

  assert.doesNotThrow(() => assertArchiveCanFinalize({
    competitionId: 'abc',
    competitionExists: true,
    rows: [{ startNumber: 1, totalPenalty: 120.5 }]
  }));
});

test('archive patch helpers build stable finalize and reopen payloads', () => {
  const timestamp = { seconds: 123 };

  assert.deepEqual(buildFinalizeCompetitionPatch(timestamp), {
    status: 'completed',
    locked: true,
    finalizedAt: timestamp
  });
  assert.deepEqual(buildReopenCompetitionPatch(), {
    status: 'active',
    locked: false
  });
});

test('buildArchiveCompetition attaches archived competition meta', () => {
  assert.deepEqual(
    buildArchiveCompetition({ name: 'Tavling' }, { manualLockdown: true }),
    { name: 'Tavling', meta: { manualLockdown: true } }
  );
});

test('archiving is refused while equipages lack a final result, unless allowed', () => {
  const rows = [
    { startNumber: 1, totalPenalty: 120.5 },
    { startNumber: 2, totalPenalty: null },                      // incomplete
    { startNumber: 3, totalPenalty: null, isEliminated: true },  // eliminated: final
    { startNumber: 4, totalPenalty: null, status: 'struken' }    // withdrawn: final
  ];
  assert.deepEqual(findIncompleteArchiveRows(rows), ['2']);
  assert.throws(
    () => assertArchiveCanFinalize({ competitionId: 'abc', competitionExists: true, rows }),
    (error) => error.code === 'archive-incomplete' && /#2/.test(error.message)
  );
  assert.doesNotThrow(() => assertArchiveCanFinalize({ competitionId: 'abc', competitionExists: true, rows, allowIncomplete: true }));
});

test('the archive snapshot keeps the published values', () => {
  const snapshot = buildArchiveSnapshot([
    { startNumber: 7, className: 'Lätt A', driverName: 'Anna', plac: 1, dressage: { penalty: 40.2 }, marathon: { totalPenalty: 70 }, precision: { totalPenalty: 3 }, totalPenalty: 113.2 }
  ], { archivedAt: 5, archivedBy: 'u1', engineVersion: 'v' });
  assert.deepEqual(snapshot.rows[0], {
    startNumber: '7', className: 'Lätt A', driverName: 'Anna', plac: 1,
    dressagePenalty: 40.2, marathonPenalty: 70, precisionPenalty: 3, totalPenalty: 113.2,
    isEliminated: false, status: null
  });
  assert.equal(snapshot.engineVersion, 'v');
});