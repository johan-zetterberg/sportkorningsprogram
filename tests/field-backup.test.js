import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeBackupPayload,
  readBackupRecord,
  readNewestBackupData,
  writeMergedBackup
} from '../js/utils/fieldBackup.js';

function createStorageStub() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

test('mergeBackupPayload preserves earlier top-level data while applying latest patch', () => {
  const merged = mergeBackupPayload(
    { live: { running: true }, general: { errorPoints: 2 } },
    { protocol: { judgeId: 'judge-1' }, live: { running: false } }
  );

  assert.deepEqual(merged, {
    live: { running: false },
    general: { errorPoints: 2 },
    protocol: { judgeId: 'judge-1' }
  });
});

test('writeMergedBackup merges records and readNewestBackupData selects the freshest backup', () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = createStorageStub();

  try {
    writeMergedBackup('backup-a', { live: { running: true } });
    writeMergedBackup('backup-a', { protocol: { judgeId: 'judge-1' } });

    const recordA = readBackupRecord('backup-a');
    assert.ok(recordA);
    assert.deepEqual(recordA.data, {
      live: { running: true },
      protocol: { judgeId: 'judge-1' }
    });

    globalThis.localStorage.setItem('backup-b', JSON.stringify({
      ts: recordA.ts + 1000,
      data: { restored: true }
    }));

    assert.deepEqual(readNewestBackupData(['backup-a', 'backup-b']), { restored: true });
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
