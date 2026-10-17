import assert from 'node:assert/strict';
import test from 'node:test';

import {
  liveFieldsBelongToObstacle,
  obstacleElapsedMs,
  shouldResumeAfterGlobalPause,
  lastClosedPauseEndMs,
  obstacleTakeoverFields,
  stageDrivenMsAtRestart,
  stageStopDurationMs
} from '../js/pages/marathon/marathonObstacleOwnership.js';
import { pausedMsBetween } from '../js/core-engine/marathon.js';

// Pause log entries as the observer writes them (ISO strings, ms since epoch 0)
const iso = (ms) => new Date(ms).toISOString();
const between = (log) => (a, b) => pausedMsBetween(a, b, log, b);

test('saved obstacle is shown after a save cleared the live fields (currentObstacle null)', () => {
  assert.equal(liveFieldsBelongToObstacle({ currentObstacle: null, liveObstacleTimeMs: 0 }, 3), false);
  assert.equal(liveFieldsBelongToObstacle({ currentObstacle: 3 }, 3), true);
  assert.equal(liveFieldsBelongToObstacle({ currentObstacle: '3' }, 3), true);
  assert.equal(liveFieldsBelongToObstacle({ currentObstacle: 5 }, 3), false);
  assert.equal(liveFieldsBelongToObstacle({ currentObstacle: 3 }, null), false);
});

test('a pause inside the running segment is subtracted once', () => {
  const log = [{ start: iso(70000), end: iso(100000) }];
  assert.equal(obstacleElapsedMs({ running: true, startMs: 1, accumulatedMs: 0 }, 120001, between(log)), 90000);
});

test('restarting the obstacle clock does not subtract an earlier pause again', () => {
  // Ran 0–60 s, stopped by the judge; a global pause 70–100 s while stopped;
  // restarted at 110 s. At 120 s the obstacle time is 70 s.
  const log = [{ start: iso(70000), end: iso(100000) }];
  const firstSegment = obstacleElapsedMs({ running: true, startMs: 1, accumulatedMs: 0 }, 60001, between(log));
  assert.equal(firstSegment, 60000);
  const afterRestart = obstacleElapsedMs({ running: true, startMs: 110000, accumulatedMs: firstSegment }, 120000, between(log));
  assert.equal(afterRestart, 70000);
  // The old virtual start (now − accumulated, time 0) covered the pause
  const virtualStart = 110000 - firstSegment;
  const old = obstacleElapsedMs({ running: true, startMs: virtualStart, accumulatedMs: 0 }, 120000, between(log));
  assert.equal(old, 40000);
});

test('stopped clock shows the accumulated time', () => {
  assert.equal(obstacleElapsedMs({ running: false, startMs: 5, accumulatedMs: 12340 }, 99999), 12340);
});

test('reload or re-select during and after a global pause at an obstacle', () => {
  // The clock ran from 0; the global pause (10–40 s) stopped it at 10 s
  const docDuringPause = {
    currentObstacle: 3,
    running: false,
    inProgress: true,
    pausedByGlobalPause: true,
    liveObstacleTimeMs: 10000,
    liveObstacleStartAt: null
  };
  const openLog = [{ start: iso(10000), end: null }];
  const closedLog = [{ start: iso(10000), end: iso(40000) }];

  // Reloaded during the pause: stays stopped at 10 s
  assert.equal(shouldResumeAfterGlobalPause(docDuringPause, { obstacleNumber: 3, isPaused: true, pauseStatusKnown: true }), false);
  assert.equal(obstacleElapsedMs({ running: docDuringPause.running, accumulatedMs: docDuringPause.liveObstacleTimeMs }, 25000, between(openLog)), 10000);
  // Pause status not read yet: nothing is resumed on a guess
  assert.equal(shouldResumeAfterGlobalPause(docDuringPause, { obstacleNumber: 3, isPaused: false, pauseStatusKnown: false }), false);

  // Reloaded / re-selected after the pause ended (the lift was not seen)
  assert.equal(shouldResumeAfterGlobalPause(docDuringPause, { obstacleNumber: 3, isPaused: false, pauseStatusKnown: true }), true);
  const resumedAt = lastClosedPauseEndMs(closedLog, 55000);
  assert.equal(resumedAt, 40000);
  const resumed = { running: true, startMs: resumedAt, accumulatedMs: docDuringPause.liveObstacleTimeMs };
  assert.equal(obstacleElapsedMs(resumed, 55000, between(closedLog)), 25000);

  // Not resumed by a device at another obstacle, nor a time the judge stopped
  assert.equal(shouldResumeAfterGlobalPause(docDuringPause, { obstacleNumber: 5, isPaused: false, pauseStatusKnown: true }), false);
  assert.equal(shouldResumeAfterGlobalPause({ ...docDuringPause, pausedByGlobalPause: false }, { obstacleNumber: 3, isPaused: false, pauseStatusKnown: true }), false);
  // Already resumed by another device: no second resume
  assert.equal(shouldResumeAfterGlobalPause({ ...docDuringPause, running: true, pausedByGlobalPause: false }, { obstacleNumber: 3, isPaused: false, pauseStatusKnown: true }), false);
});

test('resume stamp: last closed pause, else now', () => {
  const log = [
    { start: iso(1000), end: iso(2000) },
    { start: iso(5000), end: iso(9000) },
    { start: iso(12000), end: null }
  ];
  assert.equal(lastClosedPauseEndMs(log, 77), 9000);
  assert.equal(lastClosedPauseEndMs([], 77), 77);
  assert.equal(lastClosedPauseEndMs(undefined, 77), 77);
});

test('taking the document over from another obstacle writes this obstacle\'s whole state', () => {
  const remote = { currentObstacle: 5, running: false, inProgress: false, liveObstacleTimeMs: 0, live_routeString: '' };
  const shown = {
    currentObstacle: 5,
    running: false,
    liveObstacleTimeMs: 45120,
    live_routeString: 'A B C',
    live_gateSplits: [{ char: 'A', ts: 1 }],
    live_knockdowns: '1',
    live_otherPenalty: '0',
    live_holdTimeSec: '',
    live_comment: 'ok',
    live_eliminated: false
  };
  const fields = obstacleTakeoverFields(remote, 3, shown);
  assert.equal(fields.liveObstacleTimeMs, 45120);
  assert.equal(fields.live_routeString, 'A B C');
  assert.equal(fields.live_comment, 'ok');
  assert.deepEqual(fields.live_gateSplits, [{ char: 'A', ts: 1 }]);
  assert.equal('running' in fields, false);

  // After a save (currentObstacle null) too
  assert.ok(obstacleTakeoverFields({ currentObstacle: null }, 3, shown));
  // Already this obstacle's, or nothing known: no takeover
  assert.equal(obstacleTakeoverFields({ currentObstacle: 3 }, 3, shown), null);
  assert.equal(obstacleTakeoverFields(null, 3, shown), null);
  // A clock started here moments ago keeps its time fields
  const running = obstacleTakeoverFields({ currentObstacle: null }, 3, { ...shown, running: true, currentObstacle: 3 });
  assert.equal('liveObstacleTimeMs' in running, false);
});

test('stage restart keeps driven time: pauses while stopped do not count', () => {
  // Stage 0–60 s (wall), pause 20–30 s while running, pause 70–80 s while
  // stopped, restarted at 90 s, pause 100–105 s, stopped at 120 s
  const log = [
    { start: iso(20000), end: iso(30000) },
    { start: iso(70000), end: iso(80000) },
    { start: iso(100000), end: iso(105000) }
  ];
  const stage = { startClock: iso(0), stopClock: iso(60000), durationMs: 60000, manualDuration: false };
  const driven = stageDrivenMsAtRestart(stage, between(log));
  assert.equal(driven, 50000);
  const total = stageStopDurationMs({ savedMs: driven, runningSinceMs: 90000, nowMs: 120000, driven: true }, between(log));
  assert.equal(total, 75000); // 50 s + 30 s − the 5 s pause in the new segment
  // The old way: wall 60 + 30 s minus every pause between start and stop,
  // including the 10 s while the stage stood stopped
  const oldEngine = (60000 + 30000) - between(log)(0, 120000);
  assert.equal(oldEngine, 65000);
});

test('stage restart after a typed time keeps the typed time as it is', () => {
  const log = [{ start: iso(10000), end: iso(20000) }];
  const typed = { startClock: iso(5000), stopClock: iso(47000), durationMs: 42000, manualDuration: true };
  assert.equal(stageDrivenMsAtRestart(typed, between(log)), 42000);
  assert.equal(stageDrivenMsAtRestart({ durationMs: 0 }, between(log)), 0);
});

test('first stage run stays wall time (the engine takes the pauses off)', () => {
  assert.equal(stageStopDurationMs({ savedMs: 0, runningSinceMs: 1000, nowMs: 61000, driven: false }, () => 9999), 60000);
});
