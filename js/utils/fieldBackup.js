function hasLocalStorage() {
  try {
    return typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage !== null;
  } catch {
    return false;
  }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function mergeBackupPayload(existingData, patch) {
  return {
    ...asObject(existingData),
    ...asObject(patch)
  };
}

export function readBackupRecord(storageKey) {
  if (!storageKey || !hasLocalStorage()) return null;

  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      ts: Number(parsed.ts) || 0,
      data: asObject(parsed.data)
    };
  } catch (error) {
    console.warn('Could not read local field backup', storageKey, error);
    return null;
  }
}

export function readNewestBackupData(storageKeys = []) {
  const records = storageKeys
    .map((key) => readBackupRecord(key))
    .filter(Boolean)
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));

  return records[0]?.data || null;
}

export function writeMergedBackup(storageKey, patch) {
  if (!storageKey || !hasLocalStorage()) return null;

  try {
    const existing = readBackupRecord(storageKey);
    const mergedData = mergeBackupPayload(existing?.data, patch);
    globalThis.localStorage.setItem(storageKey, JSON.stringify({
      ts: Date.now(),
      data: mergedData
    }));
    return mergedData;
  } catch (error) {
    console.warn('Could not write local field backup', storageKey, error);
    return null;
  }
}

// Field backups (bkp_*) are written on every snapshot and were never removed:
// old ones are dropped, and only the newest are kept when there are many
export const BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const BACKUP_MAX_ENTRIES = 300;

export function pruneFieldBackups({ prefix = 'bkp_', maxAgeMs = BACKUP_MAX_AGE_MS, maxEntries = BACKUP_MAX_ENTRIES, now = Date.now(), storage = null } = {}) {
  const store = storage || (hasLocalStorage() ? globalThis.localStorage : null);
  if (!store) return 0;
  try {
    const entries = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      let ts = 0;
      try { ts = Number(JSON.parse(store.getItem(key) || 'null')?.ts) || 0; } catch { ts = 0; }
      entries.push({ key, ts });
    }
    entries.sort((a, b) => b.ts - a.ts);
    const remove = entries.filter((e, i) => i >= maxEntries || !(now - e.ts < maxAgeMs));
    remove.forEach((e) => store.removeItem(e.key));
    return remove.length;
  } catch (error) {
    console.warn('Could not prune local field backups', error);
    return 0;
  }
}