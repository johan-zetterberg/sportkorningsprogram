import { getClassJudgeAssignments } from '../core-engine/dressage.js';

function parseTS(v) {
  if (!v) return null;
  try {
    if (typeof v?.toMillis === 'function') {
      const t = v.toMillis();
      return Number.isFinite(t) ? t : null;
    }
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof v === 'number') {
      return Number.isFinite(v) ? v : null;
    }
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function stageStartTS(t, s) {
  const upper = String(s).toUpperCase();
  const flat = (s === 'transport') ? 'transfer' : s;
  let val = t?.[`start_${upper}`] || t?.[`start_${flat}`] || t?.stages?.[s]?.startClock || t?.timing?.[s]?.startClock;
  if (!val && s === 'A') val = t?.timing?.warmup?.startClock;
  return parseTS(val);
}

function stageStopTS(t, s) {
  if (!t) return null;
  const upper = String(s).toUpperCase();
  const flat = (s === 'transport') ? 'transfer' : s;
  let val = t?.[`finish_${upper}`] || t?.[`finish_${flat}`] || t?.stages?.[s]?.stopClock || t?.timing?.[s]?.stopClock;
  if (!val && s === 'A') val = t?.timing?.warmup?.stopClock;
  return parseTS(val);
}

/**
 * Judge positions whose protocols a class needs before its dressage is done:
 * the class's judges in the dressage judge mapping, the same rule as the result
 * engine. A class without a mapping has no known judges, so it is never done
 * from protocols alone.
 */
export function getExpectedDressageJudgePositions(className, judgeMapping = {}) {
  return Object.keys(getClassJudgeAssignments(className, judgeMapping));
}

/**
 * Judge positions to show for a class: its mapped judges, or (without a
 * mapping) every dressage judge position in the competition. For display only;
 * completeness uses getExpectedDressageJudgePositions.
 */
export function getDisplayedDressageJudgePositions(className, judgeMapping = {}, judges = []) {
  const positions = getExpectedDressageJudgePositions(className, judgeMapping);
  if (positions.length > 0) return positions;

  const fallbackPositions = new Set();
  (judges || []).forEach(judge => {
    if (Array.isArray(judge?.roles)) {
      judge.roles.forEach(role => {
        if (role?.discipline === 'dressage' && role?.position) {
          fallbackPositions.add(String(role.position).toUpperCase());
        }
      });
      return;
    }
    if (judge?.position) {
      fallbackPositions.add(String(judge.position).toUpperCase());
    }
  });

  return Array.from(fallbackPositions);
}

export function getCompletedDressageJudgePositions(judges = []) {
  const completedPositions = new Set();
  (judges || []).forEach(judge => {
    if (!judge || judge.isLive || judge.eliminated) return;
    const pos = String(judge.position || judge.judgePosition || '').toUpperCase();
    if (pos) completedPositions.add(pos);
  });
  return completedPositions;
}

export function isDressageReadyToFinalize({ status, countedJudgePositions, expectedJudgePositions, finalized }) {
  if (finalized === true) return false;

  const statusSaysDone = status?.state === 'finished';
  const expectedCount = Array.isArray(expectedJudgePositions)
    ? expectedJudgePositions.length
    : (expectedJudgePositions instanceof Set ? expectedJudgePositions.size : 0);
  const countedCount = Array.isArray(countedJudgePositions)
    ? countedJudgePositions.length
    : (countedJudgePositions instanceof Set ? countedJudgePositions.size : 0);
  const protocolsSayDone = expectedCount > 0 && countedCount >= expectedCount;

  return statusSaysDone || protocolsSayDone;
}

export function getMarathonActiveState(data = {}) {
  const startA = stageStartTS(data, 'A');
  const startT = stageStartTS(data, 'transport');
  const startB = stageStartTS(data, 'B');
  const stopA = stageStopTS(data, 'A');
  const stopT = stageStopTS(data, 'transport');
  const stopB = stageStopTS(data, 'B');

  const obstacleIsLive =
    Number(data.currentObstacle) > 0 &&
    data.running === true;

  const hasActiveStageA = !!(startA && !stopA);
  const hasActiveStageT = !!(startT && !stopT);
  const hasActiveStageB = !!(startB && !stopB);

  let currentTaskKey = 'inactive';
  if (hasActiveStageA) currentTaskKey = 'A';
  if (hasActiveStageT) currentTaskKey = 'transport';
  if (hasActiveStageB) currentTaskKey = 'B';
  if (obstacleIsLive) currentTaskKey = 'obstacle';

  return {
    startA,
    startT,
    startB,
    stopA,
    stopT,
    stopB,
    obstacleIsLive,
    hasActiveStageA,
    hasActiveStageT,
    hasActiveStageB,
    isActive: hasActiveStageA || hasActiveStageT || hasActiveStageB || obstacleIsLive,
    currentTaskKey
  };
}
