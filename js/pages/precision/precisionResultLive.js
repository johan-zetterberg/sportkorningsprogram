function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function calculatePrecisionLiveElapsed(data, now = Date.now()) {
  if (!data?.liveStartEpoch) return null;
  const receivedAt = data._receivedLocalAt || now;
  return (data.livePausedMs || 0) + (receivedAt - data.liveStartEpoch) + (now - receivedAt);
}

export function calculatePrecisionLivePenalty(data, equipage, config = {}, elapsedMs) {
  const maxSec = isFiniteNumber(config.maxSec)
    ? config.maxSec
    : null;
  const rate = config.timePenaltyRate != null ? Number(config.timePenaltyRate) : 0.5;
  const liveTimePenalty = isFiniteNumber(maxSec) && elapsedMs > maxSec * 1000
    ? ((elapsedMs / 1000) - maxSec) * rate
    : 0;
  const obstaclePenalty = isFiniteNumber(data?.liveObstaclePenalty)
    ? data.liveObstaclePenalty
    : (isFiniteNumber(data?.obstaclePenalty) ? data.obstaclePenalty : 0);
  const extraPenalty = isFiniteNumber(data?.extraPenalty) ? data.extraPenalty : 0;
  const totalPenalty = liveTimePenalty + obstaclePenalty + extraPenalty;

  return {
    timePenalty: liveTimePenalty,
    obstaclePenalty,
    extraPenalty,
    totalPenalty
  };
}

export function calculatePrecisionLiveRank(currentTotal, currentSn, currentEquipage, allEquipages = [], precisionMap = new Map(), getGroupKey = null) {
  const groupKeyFor = getGroupKey || ((equipage) => equipage?._mergedLabel || equipage?.className);
  const myGroupKey = groupKeyFor(currentEquipage);
  const totals = [];

  for (const equipage of allEquipages || []) {
    const sn = String(equipage?.startNumber);
    if (sn === String(currentSn)) continue;
    if (groupKeyFor(equipage) !== myGroupKey) continue;

    const data = precisionMap.get(sn);
    if (!data) continue;

    let penalty = null;
    if (data.finalized && isFiniteNumber(data.totalPenalty)) penalty = data.totalPenalty;
    else if (isFiniteNumber(data.liveTotalPenalty)) penalty = data.liveTotalPenalty;
    if (isFiniteNumber(penalty)) totals.push(penalty);
  }

  totals.push(currentTotal);
  totals.sort((a, b) => a - b);
  return totals.indexOf(currentTotal) + 1;
}

export function buildPrecisionLiveTick(data, context = {}) {
  const {
    now = Date.now(),
    equipage,
    maxSec = null,
    config = {},
    allEquipages = [],
    precisionMap = new Map(),
    getGroupKey = null
  } = context;

  const elapsedMs = calculatePrecisionLiveElapsed(data, now);
  if (!isFiniteNumber(elapsedMs)) return null;

  const penalty = calculatePrecisionLivePenalty(
    data,
    equipage,
    { ...config, maxSec },
    elapsedMs
  );
  const rank = equipage
    ? calculatePrecisionLiveRank(penalty.totalPenalty, equipage.startNumber, equipage, allEquipages, precisionMap, getGroupKey)
    : null;

  return {
    elapsedMs,
    overTime: isFiniteNumber(maxSec) && elapsedMs > maxSec * 1000,
    penalty,
    rank
  };
}
