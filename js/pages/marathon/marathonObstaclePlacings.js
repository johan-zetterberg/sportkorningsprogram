export function marathonDisplayClassKey(eq) {
  return eq?._mergedKey || `CLS:${eq?.className || 'Okänd klass'}`;
}

export function buildObstaclePlacementsByClass({
  equipages,
  marathonMap,
  calculateResult,
  timingDocFor
}) {
  const grouped = new Map();
  const placements = new Map();

  (equipages || []).forEach((eq) => {
    const sn = String(eq?.startNumber ?? '');
    if (!sn) return;

    const summaryDoc = marathonMap?.get?.(sn) || {};
    const timingDoc = typeof timingDocFor === 'function' ? (timingDocFor(sn) || summaryDoc) : summaryDoc;
    const res = calculateResult(eq, summaryDoc, timingDoc);
    const classKey = marathonDisplayClassKey(eq);

    (res?.obstacles?.items || []).forEach((obs) => {
      const obstacleNumber = Number(obs?.number);
      const timeSec = Number(obs?.timeSec);
      if (!Number.isFinite(obstacleNumber) || !Number.isFinite(timeSec) || obs?.eliminated) return;

      const bucketKey = `${classKey}|${obstacleNumber}`;
      if (!grouped.has(bucketKey)) grouped.set(bucketKey, []);
      grouped.get(bucketKey).push({
        sn,
        startNumber: Number(eq?.startNumber ?? 999999),
        timeSec
      });
    });
  });

  grouped.forEach((entries, bucketKey) => {
    entries.sort((a, b) => {
      if (Math.abs(a.timeSec - b.timeSec) > 1e-9) return a.timeSec - b.timeSec;
      return a.startNumber - b.startNumber;
    });

    let currentPlace = 0;
    let previousTime = null;

    entries.forEach((entry, index) => {
      if (previousTime === null || Math.abs(entry.timeSec - previousTime) > 1e-9) {
        currentPlace = index + 1;
        previousTime = entry.timeSec;
      }
      placements.set(`${bucketKey}|${entry.sn}`, currentPlace);
    });
  });

  return placements;
}

export function getObstaclePlacement(placementMap, eq, obstacleNumber) {
  if (!placementMap) return null;
  const sn = String(eq?.startNumber ?? '');
  const obstacleNo = Number(obstacleNumber);
  if (!sn || !Number.isFinite(obstacleNo)) return null;
  const key = `${marathonDisplayClassKey(eq)}|${obstacleNo}|${sn}`;
  return placementMap.get(key) ?? null;
}
