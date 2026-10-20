import { calculatePrecisionLiveResult, calculatePrecisionResult } from '../../utils/precisionUtils.js';
import { precisionElapsedMs } from '../../utils/precisionCalculation.js';
import { assignPlaces, comparePrecisionRank, precisionGroupContext } from '../../core-engine/ranking.js';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function calculatePrecisionLiveElapsed(data, now = Date.now()) {
  return precisionElapsedMs(data, now);
}

// Live penalty parts at elapsedMs, from the result engine
export function calculatePrecisionLivePenalty(data, equipage, config = {}, elapsedMs) {
  const calc = calculatePrecisionResult(
    { ...(data || {}), running: true, finalized: false, liveTimeMs: elapsedMs },
    equipage,
    config,
    { maxSec: config?.maxSec }
  );
  return {
    timePenalty: calc.timePenalty ?? 0,
    obstaclePenalty: calc.obstaclePenalty ?? 0,
    extraPenalty: calc.extraPenalty ?? 0,
    totalPenalty: calc.totalPenalty ?? 0
  };
}

/**
 * Live position of the running equipage in its group (precision ranking
 * rules: penalty, then time; eliminated equipages are not placed).
 */
export function calculatePrecisionLiveRank(currentTotal, currentSn, currentEquipage, allEquipages = [], precisionMap = new Map(), getGroupKey = null, { config = {}, currentTimeMs = null, now = Date.now() } = {}) {
  const groupKeyFor = getGroupKey || ((equipage) => equipage?._mergedLabel || equipage?.className);
  const myGroupKey = groupKeyFor(currentEquipage);
  const rows = [];

  for (const equipage of allEquipages || []) {
    const sn = String(equipage?.startNumber);
    if (sn === String(currentSn)) continue;
    if (groupKeyFor(equipage) !== myGroupKey) continue;

    const data = precisionMap.get(sn);
    if (!data) continue;
    rows.push({ startNumber: equipage.startNumber, result: calculatePrecisionLiveResult(data, equipage, config, now) });
  }

  // The running equipage: in phase 2 / a drive-off by its round (tiers), in
  // phase 1 by the live total and time as before
  const myData = precisionMap.get(String(currentSn));
  const myResult = myData ? calculatePrecisionLiveResult(myData, currentEquipage, config, now) : null;
  const me = { startNumber: currentSn, result: myResult };
  rows.push(me);
  const ctx = precisionGroupContext(rows, r => r.result);
  const phase1Key = { penalty: currentTotal, timeMs: isFiniteNumber(currentTimeMs) ? currentTimeMs : null };
  const myRound = myResult?.activeRound || 'phase1';
  const { placeOf } = assignPlaces(rows, {
    key: r => (r === me && myRound === 'phase1' ? phase1Key : ctx.rankKey(r)),
    compare: comparePrecisionRank,
    outField: null
  });
  return placeOf.get(me);
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

  const effectiveMaxSec = isFiniteNumber(maxSec) ? maxSec : (isFiniteNumber(config?.maxSec) ? config.maxSec : null);

  const penalty = calculatePrecisionLivePenalty(
    data,
    equipage,
    { ...config, maxSec: effectiveMaxSec },
    elapsedMs
  );
  const rank = equipage
    ? calculatePrecisionLiveRank(penalty.totalPenalty, equipage.startNumber, equipage, allEquipages, precisionMap, getGroupKey, {
      config,
      currentTimeMs: elapsedMs,
      now
    })
    : null;

  return {
    elapsedMs,
    overTime: isFiniteNumber(effectiveMaxSec) && elapsedMs > effectiveMaxSec * 1000,
    penalty,
    rank
  };
}
