export function getTimingDocFor(marathonMap, startNumber) {
  return marathonMap.get(String(startNumber)) || {};
}

export function getStartTimeFor(startNumber, {
  marathonMap,
  startTimes
}) {
  const sn = String(startNumber);
  const d = marathonMap.get(sn);
  let val = null;

  if (d) {
    val = d.start_A || d.start_warmup || d.start_transport || d.start_B;
    if (!val && d.stages) {
      val = d.stages.A?.startClock ||
        d.stages.warmup?.startClock ||
        d.stages.B?.startClock ||
        d.stages.A?.start ||
        d.stages.B?.start;
    }
  }

  if (!val) {
    const row = startTimes?.[sn] ?? startTimes?.[Number(sn)] ?? null;
    val = row?.marathon ??
      row?.b ??
      row?.start_B ??
      row?.start ??
      row?.time ??
      row?.start_A ??
      row?.startTime ??
      null;
  }

  return val || null;
}

export function hasAnyTimingForStage(stage, {
  marathonMap,
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved
}) {
  for (const v of marathonMap.values()) {
    const t = v || {};
    if (stageStartTS(t, stage) || stageStopTS(t, stage) || stageDurationMsSaved(t, stage)) return true;
  }
  return false;
}

export function isStageEnabled(stage, {
  marathonMap,
  marathonConfig,
  stageStartTS,
  stageStopTS,
  stageDurationMsSaved
}) {
  if (hasAnyTimingForStage(stage, {
    marathonMap,
    stageStartTS,
    stageStopTS,
    stageDurationMsSaved
  })) {
    return true;
  }

  const distancesByClass = marathonConfig?.marathonClassData;
  if (!distancesByClass) {
    return false;
  }

  return Object.values(distancesByClass).some(classSettings => {
    const stageData = classSettings?.[stage];
    return stageData && Number.isFinite(stageData.distance) && stageData.distance > 0;
  });
}
