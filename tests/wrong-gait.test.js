import test from 'node:test';
import assert from 'node:assert/strict';
import { wrongGaitIncidentPenalty, wrongGaitPenaltyFromLog, isFeiMarathonClass } from '../js/core-engine/marathon.js';

test('TR V 523.1: corrected within 5 s is free, then 1 per commenced 5 s period', () => {
  assert.equal(wrongGaitIncidentPenalty(0), 0);
  assert.equal(wrongGaitIncidentPenalty(4), 0);
  assert.equal(wrongGaitIncidentPenalty(5), 0);
  assert.equal(wrongGaitIncidentPenalty(6), 1);
  assert.equal(wrongGaitIncidentPenalty(10), 1);
  assert.equal(wrongGaitIncidentPenalty(11), 2);
  assert.equal(wrongGaitIncidentPenalty(16), 3);
});

test('FEI 960.6.4: 1 for the incident plus 1 per further completed 5 s period', () => {
  assert.equal(wrongGaitIncidentPenalty(5, { fei: true }), 0);
  assert.equal(wrongGaitIncidentPenalty(6, { fei: true }), 1);
  assert.equal(wrongGaitIncidentPenalty(9, { fei: true }), 1);
  assert.equal(wrongGaitIncidentPenalty(10, { fei: true }), 2);
  assert.equal(wrongGaitIncidentPenalty(15, { fei: true }), 3);
});

test('each incident is penalised on its own, not the total', () => {
  // Three 4 s breaks, each corrected in time: no penalty (the old 0.2/s gave 2.4)
  const log = { wrongGaitSeconds: 12, wrongGaits: [{ atSec: 1, durSec: 4 }, { atSec: 20, durSec: 4 }, { atSec: 40, durSec: 4 }] };
  assert.equal(wrongGaitPenaltyFromLog(log, 'Lätt A Enbet Häst'), 0);
  // A 7 s and a 12 s break: 1 + 2
  assert.equal(wrongGaitPenaltyFromLog({ wrongGaitSeconds: 19, wrongGaits: [{ atSec: 1, durSec: 7 }, { atSec: 50, durSec: 12 }] }, 'Msv Par'), 3);
});

test('a log from before incidents were kept counts its total as one incident', () => {
  assert.equal(wrongGaitPenaltyFromLog({ wrongGaitSeconds: 7 }, 'Lätt A'), 1);
  assert.equal(wrongGaitPenaltyFromLog({ wrongGaitSeconds: 4 }, 'Lätt A'), 0);
  // Earlier total plus a new incident: the earlier seconds are their own incident
  assert.equal(wrongGaitPenaltyFromLog({ wrongGaitSeconds: 13, wrongGaits: [{ atSec: 9, durSec: 6 }] }, 'Lätt A'), 2);
  assert.equal(wrongGaitPenaltyFromLog(undefined, 'Lätt A'), 0);
});

test('FEI classes are recognised by name', () => {
  assert.equal(isFeiMarathonClass('FEI 2* Enbet Häst'), true);
  assert.equal(isFeiMarathonClass('CAI2* Pair'), true);
  assert.equal(isFeiMarathonClass('CAI 2* Pair'), true);
  assert.equal(isFeiMarathonClass('Lätt B Barn'), false);
  assert.equal(wrongGaitPenaltyFromLog({ wrongGaits: [{ atSec: 1, durSec: 10 }] }, 'FEI 3* Fyrspann'), 2);
});
