// Whether a doc has a round clock running (phase 1 on the top level, or rounds.phase2 / rounds.driveOff)
function anyRoundRunning(doc) {
  return doc?.running === true || doc?.rounds?.phase2?.running === true || doc?.rounds?.driveOff?.running === true;
}

// What a full render of phase 2 / drive-off depends on (not the ticking clock)
function roundsSignature(doc) {
  const pick = (r) => (r ? [r.running, r.finalized, r.eliminated, r.retired, r.timeMs, r.totalPenalty, r.extraPenalty, r.rebuildCount,
    r.liveStartEpoch, r.status, r.comment, JSON.stringify(r.knocks || [])] : null);
  return JSON.stringify([pick(doc?.rounds?.phase2), pick(doc?.rounds?.driveOff), doc?.activeRound ?? null]);
}

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

    // A round (phase 2 / drive-off) started, stopped or changed
    if (roundsSignature(newData) !== roundsSignature(oldData)) {
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
    if (anyRoundRunning(data)) anyRunning = true;
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
