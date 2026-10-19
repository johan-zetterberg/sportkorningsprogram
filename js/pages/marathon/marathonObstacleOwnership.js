import { activeObstacleLiveEntries, MARATHON_LIVE_DEFAULTS } from '../../core-engine/stateSelector.js';
import { parseHoldTimeInput, formatHoldTimeMinutes } from '../../core-engine/marathon.js';

// Each obstacle has its own live entry on maraton/{sn} (obstacleLive.{n}): a
// clock or a form at one obstacle never changes another obstacle's entry.

// A running clock or unsaved work (a stopped time or typed fields)
export function isActiveObstacleLive(entry) {
  return !!entry && (entry.running === true || entry.inProgress === true);
}

// Other obstacles where this equipage's clock runs now (numbers). Only shown
// as a question on Start: an equipage is in one obstacle at a time, but a
// clock left running at another obstacle must not block this one.
export function obstaclesRunningElsewhere(doc, obstacleNumber) {
  return activeObstacleLiveEntries(doc)
    .filter(e => e.running === true && Number(e.number) !== Number(obstacleNumber))
    .map(e => e.number);
}

// The write of a live change at one obstacle: only obstacleLive.{n} (merged
// field by field), so another obstacle's entry is never touched
export function obstacleLiveWrite(obstacleNumber, update, stamp = () => null) {
  return { obstacleLive: { [String(Number(obstacleNumber))]: { ...update, updatedAt: stamp() } } };
}

export function markObstacleUpdateInProgress(update) {
  const value = update && typeof update === 'object' ? update : {};
  const explicitlySetsProgress = Object.prototype.hasOwnProperty.call(value, 'inProgress');
  const editsLiveField = Object.keys(value).some((key) => key.startsWith('live_'));
  return !explicitlySetsProgress && editsLiveField
    ? { ...value, inProgress: true }
    : value;
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

// Whether Start on this stage is a restart: it already has a stop or a time
export function isStageRestart(stageData) {
  return !!stageData?.stopClock || (Number(stageData?.durationMs) || 0) > 0;
}

/**
 * The stage fields a Start writes. A first start writes only its own fields
 * (start clock, running since, start comment): a start queued offline that
 * reaches the server after a finish recorded on another device must not
 * erase that finish. Only a restart of a stopped stage (the judge confirms it)
 * clears the stop and keeps the time so far as driven time.
 */
export function stageStartPayload(stageData, { nowMs, drivenMs = 0, commentStart = '', runningStage = null } = {}) {
  const at = new Date(nowMs).toISOString();
  const payload = {
    startClock: stageData?.startClock || at,
    runningSince: at,
    commentStart,
    runningStage
  };
  if (isStageRestart(stageData)) {
    payload.stopClock = null;
    payload.durationMs = Math.max(0, Number(drivenMs) || 0);
    payload.manualDuration = true;
  }
  return payload;
}

// The fields an edit also writes when the obstacle's live entry holds no work
// (none yet, or cleared by a save): the form shows the saved result or zeros,
// and writing only the edited field would let the next snapshot, and Save,
// use the entry's empty values. null when the entry already holds this work.
// Running fields are never part of it: the clock is only changed by Start,
// Stop and the pause.
export function obstacleSeedFields(entry, shown) {
  if (isActiveObstacleLive(entry)) return null;
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
  if (s.running !== true) fields.liveObstacleTimeMs = Math.max(0, Number(s.liveObstacleTimeMs) || 0);
  return fields;
}

// The form of one obstacle: its live entry while it holds work, else the saved
// result, else zeros
export function obstacleFormState(entry, saved) {
  if (isActiveObstacleLive(entry)) return { ...MARATHON_LIVE_DEFAULTS, ...entry };
  const o = saved || null;
  return {
    ...MARATHON_LIVE_DEFAULTS,
    liveObstacleTimeMs: Number(o?.timeMs ?? (Number(o?.timeInSeconds) * 1000)) || 0,
    live_routeString: o?.routeString ?? '',
    live_knockdowns: o?.knockdowns != null ? String(o.knockdowns) : '0',
    live_otherPenalty: o?.otherPenalty != null ? String(o.otherPenalty) : '0',
    live_holdTimeSec: Number(o?.holdTimeSec) > 0 ? formatHoldTime(Number(o.holdTimeSec)) : '',
    live_comment: o?.comment ?? '',
    live_eliminated: !!o?.eliminated,
    live_gateSplits: Array.isArray(o?.gateSplits) ? o.gateSplits : [],
    live_staticStartAt: o?.enteredAt ?? null
  };
}

// --- Hold time (TR V 525.7, FEI 965.8.2: whole or half minutes) ---
// Typed in minutes: "2", "2,5" or "1:30" (m:ss); stored as seconds
// (holdTimeSec). The engine's own parser and formatter, so the field, the
// saved value and the result always agree.
export function parseHoldMinutes(value) {
  return parseHoldTimeInput(value);
}

// Seconds as the minutes text the field takes (120 -> "2", 150 -> "2,5",
// 70 -> "1:10"); empty for none
export function formatHoldTime(seconds) {
  return formatHoldTimeMinutes(seconds);
}
// --- Unsaved work on the obstacle page (the update prompt asks before a reload) ---
export function obstaclePageHasUnsavedWork({
  liveState = null, pendingFormFields = null, pendingComment = null,
  pendingHoldCount = 0, waitingTimerRunning = false, saveInFlight = false
} = {}) {
  return isActiveObstacleLive(liveState)
    || (!!pendingFormFields && Object.keys(pendingFormFields).length > 0)
    || pendingComment != null
    || pendingHoldCount > 0
    || waitingTimerRunning === true
    || saveInFlight === true;
}