export function isObstacleStateOwnedByAnotherObstacle(state, obstacleNumber) {
  if (!state || state.currentObstacle == null || obstacleNumber == null) return false;
  if (Number(state.currentObstacle) === Number(obstacleNumber)) return false;

  return state.running === true || state.inProgress === true;
}

export function markObstacleUpdateInProgress(update) {
  const value = update && typeof update === 'object' ? update : {};
  const explicitlySetsProgress = Object.prototype.hasOwnProperty.call(value, 'inProgress');
  const editsLiveField = Object.keys(value).some((key) => key.startsWith('live_'));
  return !explicitlySetsProgress && editsLiveField
    ? { ...value, inProgress: true }
    : value;
}

// The live fields on the shared document show this obstacle only when it is
// the document's current obstacle. After a save they are cleared and
// currentObstacle is null: the saved result is shown then, not 00:00.
export function liveFieldsBelongToObstacle(data, obstacleNumber) {
  if (!data || obstacleNumber == null || data.currentObstacle == null) return false;
  return Number(data.currentObstacle) === Number(obstacleNumber);
}

// Obstacle time: the time kept from earlier running segments plus the running
// segment, minus global pauses inside that segment only. A restart keeps the
// earlier time apart (not baked into a virtual start), so a pause before the
// restart is not subtracted a second time.
export function obstacleElapsedMs({ accumulatedMs = 0, running = false, startMs = 0 } = {}, tickMs, pausedBetween = () => 0) {
  const acc = Math.max(0, Number(accumulatedMs) || 0);
  if (!running || !(startMs > 0) || !Number.isFinite(tickMs)) return acc;
  return acc + Math.max(0, tickMs - startMs - (pausedBetween(startMs, tickMs) || 0));
}

// A clock the global pause stopped resumes once the pause is over, also when
// the page is (re)loaded or the equipage re-selected after the pause ended:
// the pause listener alone saw only the moment the pause was lifted
export function shouldResumeAfterGlobalPause(state, { obstacleNumber, isPaused, pauseStatusKnown } = {}) {
  return pauseStatusKnown === true
    && isPaused !== true
    && !!state
    && state.running !== true
    && state.inProgress === true
    && state.pausedByGlobalPause === true
    && obstacleNumber != null
    && state.currentObstacle != null
    && Number(state.currentObstacle) === Number(obstacleNumber);
}

// Resumed from the end of the last closed pause (every device at the obstacle
// writes the same stamp), or from now when the log has none
export function lastClosedPauseEndMs(pauseLog, fallbackMs) {
  const lastClosed = [...(Array.isArray(pauseLog) ? pauseLog : [])].reverse().find(p => p && p.end != null);
  const endMs = lastClosed ? new Date(lastClosed.end).getTime() : NaN;
  return Number.isFinite(endMs) ? endMs : fallbackMs;
}

// --- Stage clocks (maraton-stages-input) ---
// A stage is saved as wall time from its start to its stop, and the engine
// takes off every global pause between the two. After a restart that also
// took off pauses while the stage stood stopped, and a typed time lost its
// manual flag (its pauses were taken off again). So a restarted stage keeps
// its time as driven time (pauses already off) with manualDuration set: the
// engine then uses the saved time as it is, and each running segment has
// only its own pauses taken off. The engine itself is unchanged.

function clockMs(value) {
  if (value == null || value === '') return NaN;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  return Date.parse(value);
}

// The stage's time so far as driven time, when it is started again
export function stageDrivenMsAtRestart(stageData, pausedBetween = () => 0) {
  const saved = Number(stageData?.durationMs);
  if (!Number.isFinite(saved) || saved <= 0) return 0;
  if (stageData.manualDuration === true) return saved;
  const start = clockMs(stageData.startClock);
  const stop = clockMs(stageData.stopClock);
  if (Number.isFinite(start) && Number.isFinite(stop) && stop > start) {
    return Math.max(0, saved - (pausedBetween(start, stop) || 0));
  }
  return saved;
}

// The duration a Stop saves: the saved time plus the running segment, with
// the segment's pauses taken off when the stage keeps driven time
export function stageStopDurationMs({ savedMs = 0, runningSinceMs, nowMs, driven = false }, pausedBetween = () => 0) {
  const base = Math.max(0, Number(savedMs) || 0);
  if (!Number.isFinite(runningSinceMs) || !Number.isFinite(nowMs)) return base;
  const segment = Math.max(0, nowMs - runningSinceMs);
  return base + (driven ? Math.max(0, segment - (pausedBetween(runningSinceMs, nowMs) || 0)) : segment);
}

// The fields this obstacle writes when it takes the shared document over from
// another obstacle (or after a save cleared it). The document's live fields
// then hold the other obstacle's values (or zeros): writing only the edited
// field would let the next snapshot, and Save, use that time and route.
// null when the document already belongs to this obstacle. Running fields are
// never part of it: the clock is only changed by Start, Stop and the pause.
export function obstacleTakeoverFields(remote, obstacleNumber, shown) {
  if (!remote || obstacleNumber == null) return null;
  if (liveFieldsBelongToObstacle(remote, obstacleNumber)) return null;
  const s = shown || {};
  const fields = {
    live_routeString: s.live_routeString ?? '',
    live_gateSplits: Array.isArray(s.live_gateSplits) ? s.live_gateSplits : [],
    live_knockdowns: s.live_knockdowns ?? '0',
    live_otherPenalty: s.live_otherPenalty ?? '0',
    live_holdTimeSec: s.live_holdTimeSec ?? '',
    live_comment: s.live_comment ?? '',
    live_eliminated: !!s.live_eliminated
  };
  // A clock started here moments ago (its write not seen back yet) keeps its
  // own time fields
  const runsHere = s.running === true && Number(s.currentObstacle) === Number(obstacleNumber);
  if (!runsHere) fields.liveObstacleTimeMs = Math.max(0, Number(s.liveObstacleTimeMs) || 0);
  return fields;
}
