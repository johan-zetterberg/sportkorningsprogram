export function applyPrecisionLiveDocChanges(changes, precisionMap, now = Date.now()) {
  let needsFullRender = false;

  changes.forEach((change) => {
    const id = String(change.doc.id);
    const oldData = precisionMap.get(id) || {};

    if (change.type === 'removed') {
      precisionMap.delete(id);
      needsFullRender = true;
      return;
    }

    const newData = {
      ...change.doc.data(),
      _receivedLocalAt: now
    };
    precisionMap.set(id, newData);

    if (newData.running === true && oldData.running !== true && newData.liveStartEpoch) {
      needsFullRender = true;
      return;
    }

    if (newData.running === false && oldData.running === true) {
      needsFullRender = true;
      return;
    }

    if (
      newData.finalized !== oldData.finalized ||
      newData.totalPenalty !== oldData.totalPenalty ||
      newData.liveTotalPenalty !== oldData.liveTotalPenalty ||
      newData.liveObstaclePenalty !== oldData.liveObstaclePenalty ||
      JSON.stringify(newData.knocks) !== JSON.stringify(oldData.knocks) ||
      newData.extraPenalty !== oldData.extraPenalty ||
      newData.comment !== oldData.comment
    ) {
      needsFullRender = true;
    }
  });

  let anyRunning = false;
  precisionMap.forEach((data) => {
    if (data?.running === true) anyRunning = true;
  });

  return { needsFullRender, anyRunning };
}

export function groupDressageProtocolsByStartNumber(docs = []) {
  const grouped = new Map();
  docs.forEach((doc) => {
    const sn = String(doc.startNumber);
    if (!grouped.has(sn)) grouped.set(sn, []);
    grouped.get(sn).push(doc);
  });
  return grouped;
}

export function normalizeMarathonTimingDocs(docs) {
  const list = Array.isArray(docs)
    ? docs
    : (Array.isArray(docs?.docs) ? docs.docs : Object.values(docs || {}));

  const map = new Map();
  for (const doc of list) {
    const data = typeof doc.data === 'function' ? doc.data() : doc;
    const id = doc.id || data.id || data.startNumber;
    if (id) map.set(String(id), data);
  }
  return map;
}

export function unsubscribeAll(unsubs = []) {
  unsubs.forEach((unsubscribe) => {
    try {
      if (typeof unsubscribe === 'function') unsubscribe();
    } catch {
      // best-effort cleanup
    }
  });
}
