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
