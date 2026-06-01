export function groupDocsByStartNumber(docs = []) {
  const grouped = new Map();
  docs.forEach((doc) => {
    const sn = String(doc.startNumber);
    if (!grouped.has(sn)) grouped.set(sn, []);
    grouped.get(sn).push(doc);
  });
  return grouped;
}

export function mapRowsByStartNumber(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row?.id ?? row?.startNumber;
    if (key != null) map.set(String(key), row);
  });
  return map;
}

export function normalizeTimingDocs(docs) {
  if (docs instanceof Map) {
    const map = new Map();
    docs.forEach((value, key) => map.set(String(key), value));
    return map;
  }

  const list = Array.isArray(docs)
    ? docs
    : (Array.isArray(docs?.docs) ? docs.docs : Object.values(docs || {}));

  const map = new Map();
  for (const doc of list) {
    const data = typeof doc?.data === 'function' ? doc.data() : doc;
    const id = doc?.id || data?.id || data?.startNumber;
    if (id != null) map.set(String(id), data);
  }
  return map;
}

export function replaceMapContents(targetMap, sourceMap) {
  targetMap.clear();
  sourceMap.forEach((value, key) => targetMap.set(String(key), value));
  return targetMap;
}

export function unsubscribeAll(unsubscribers = []) {
  unsubscribers.forEach((unsubscribe) => {
    try {
      if (typeof unsubscribe === 'function') unsubscribe();
    } catch {
      // best-effort cleanup
    }
  });
}
