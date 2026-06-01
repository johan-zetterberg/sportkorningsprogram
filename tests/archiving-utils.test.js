import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertArchiveCanFinalize,
  buildArchiveCompetition,
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
    rows: [{ startNumber: 1 }]
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
