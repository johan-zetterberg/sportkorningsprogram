// The browser (calculationService / marathonUtils) and the Cloud Function
// (functions/src/core-engine, fed the way functions/index.js feeds it) must
// produce the same results. Each case below used to differ between them.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDressageResult,
  calculateMarathonResult,
  calculateTotalResult
} from '../js/services/calculationService.js';
import { setMarathonConfig, setPauseWindows, tlSecondsFor } from '../js/utils/marathonUtils.js';
import { deduplicateAndFilterProtocols } from '../js/utils/dressageUtils.js';
import { buildCompetitionState } from '../functions/src/core-engine/stateSelector.js';
import { buildServerCompetitionState } from '../functions/src/resultRecalculationUtils.js';
import { calculateTotalResult as serverTotal } from '../functions/src/core-engine/calculation.js';
import { calculateDressageResult as serverDressage } from '../functions/src/core-engine/dressage.js';
import { calculateMarathonResult as serverMarathon } from '../functions/src/core-engine/marathon.js';
import { calculatePrecisionResult as serverPrecision } from '../functions/src/core-engine/precision.js';

const allPrograms = {
  LA: { id: 'LA', name: 'Svenskt Latt A', movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }] }
};

const marathonConfig = {
  marathonClassData: {
    KlassA: { distanceA: 5000, tempoA: 250, distanceT: 1000, tempoT: 200, distanceB: 6000, tempoB: 300 },
    FastA: { fixedTimeA: 20, distanceB: 6000, tempoB: 300 },
    PonnyKlass: { distanceA: 6000, distanceB: 6000, trTemplate: 'Lätt B' },
    Utvalda: { distanceB: 6000, tempoB: 300, drivenObstacles: '1, 3' }
  }
};

const precisionConfig = {
  maxTimeByClass: { KlassA: 100 },
  courses: { 'Sammanslagen': { trackLengthMeters: 500, tempo: 250 } },
  knockdownPenalty: 3,
  timePenaltyRate: 0.5
};

// Same context shape that functions/index.js getContext() builds
const serverContext = { allPrograms, dressageProgramMapping: {}, judges: [], marathonConfig, precisionConfig, ruleSettings: null, pauseWindows: [] };

const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);
const min = (m) => m * 60000;

// The Cloud Function's own document-to-state assembly (functions/index.js)
function serverState(equipage, protocols, marathonDoc, timingDoc, precisionDoc = {}) {
  return buildServerCompetitionState({ equipage, dressageProtocols: protocols, marathonDoc, timingDoc, precisionDoc }, serverContext);
}

function both(equipage, marathonDoc, timingDoc) {
  setMarathonConfig(marathonConfig);
  setPauseWindows([]);
  return {
    browser: calculateMarathonResult(equipage, marathonDoc, timingDoc),
    server: serverMarathon(serverState(equipage, [], marathonDoc, timingDoc))
  };
}

test('marathon: wrong gait and other penalties count on both sides', () => {
  const eq = { startNumber: 1, className: 'KlassA', category: 'horse' };
  const doc = { obstacles: [{ number: 1, timeSeconds: 20 }], otherPenalty: 10, observerLog: { wrongGaitSeconds: 5 } };
  const timing = { A: { durationMs: 1200000 }, transport: { durationMs: 300000 }, B: { durationMs: 1200000 } };
  const { browser, server } = both(eq, doc, timing);

  assert.equal(browser.totalPenalty, 5 + 10 + 1);
  assert.equal(server.totalPenalty, browser.totalPenalty);
});

test('marathon: stage times from start/stop timestamps only', () => {
  const eq = { startNumber: 2, className: 'KlassA', category: 'horse' };
  const timing = {
    start_A: T0, finish_A: T0 + min(20) + 20000,
    start_B: T0 + min(40), finish_B: T0 + min(60)
  };
  const { browser, server } = both(eq, { obstacles: [] }, timing);

  assert.equal(browser.stages.A.timePenalty, 5);
  assert.equal(server.stages.A.timePenalty, 5);
  assert.equal(server.totalPenalty, browser.totalPenalty);
});

test('marathon: obstacle time stored as timeInSeconds (maraton-input)', () => {
  const eq = { startNumber: 3, className: 'KlassA', category: 'horse' };
  const { browser, server } = both(eq, { obstacles: [{ number: 1, timeInSeconds: 40 }] }, {});

  assert.equal(browser.obstacles.sum, 10);
  assert.equal(server.obstacles.sum, 10);
});

test('marathon: fixed time on A gives the same ideal time and no penalty for exceeding it', () => {
  const eq = { startNumber: 4, className: 'FastA', category: 'horse' };
  const timing = { A: { durationMs: min(21) } };
  const { browser, server } = both(eq, { obstacles: [] }, timing);

  assert.equal(browser.stages.A.limits.ideal, 1200);
  assert.equal(server.stages.A.limits.ideal, 1200);
  assert.equal(server.stages.A.timePenalty, 0);
  assert.deepEqual(server.stages.A.limits, browser.stages.A.limits);
});

test('marathon: "Ponny kat B" is pony B, not pony A', () => {
  setMarathonConfig(marathonConfig);
  const eq = { startNumber: 5, className: 'PonnyKlass', category: 'Ponny kat B' };
  // Lätt B, A-stage, ponyB = 10.5 km/h -> 6000 m / 175 m/min = 2057 s
  assert.equal(tlSecondsFor(eq, 'A'), 2057);

  const { browser, server } = both(eq, { obstacles: [] }, { A: { durationMs: 2057000 } });
  assert.equal(server.stages.A.limits.ideal, 2057);
  assert.deepEqual(server.stages.A.limits, browser.stages.A.limits);
});

test('marathon: obstacles the class does not drive are ignored on both sides', () => {
  const eq = { startNumber: 6, className: 'Utvalda', category: 'horse' };
  const doc = { obstacles: [
    { number: 1, timeSeconds: 20 },
    { number: 2, timeSeconds: 400 },
    { number: 3, timeSeconds: 20 }
  ] };
  const { browser, server } = both(eq, doc, {});

  assert.equal(browser.eliminated, false);
  assert.equal(server.eliminated, false);
  assert.equal(server.obstacles.sum, 10);
});

test('marathon: stage times saved on the maraton doc (stage input) count on the server', () => {
  setMarathonConfig(marathonConfig);
  setPauseWindows([]);
  const eq = { startNumber: 13, className: 'KlassA', category: 'horse' };
  // maraton-stages-input writes the stage times onto the maraton document
  const maratonDoc = {
    obstacles: [{ number: 1, timeSeconds: 20 }],
    start_A: T0, finish_A: T0 + min(20) + 20000, duration_A_ms: min(20) + 20000
  };

  const browser = calculateMarathonResult(eq, maratonDoc, maratonDoc);
  const server = serverMarathon(serverState(eq, [], maratonDoc, {}));

  assert.equal(browser.stages.A.timePenalty, 5);
  assert.equal(server.stages.A.timePenalty, 5);
  assert.equal(server.totalPenalty, browser.totalPenalty);
});

test('dressage: error points from the general doc and the equipage agree (highest wins)', () => {
  const eq = { startNumber: 7, className: 'KlassA', testKey: 'LA', errorPoints: 1 };
  const protocols = [
    { id: 'c', judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] },
    { id: 'general', errorPoints: 4 }
  ];

  const browser = calculateDressageResult(eq, protocols, [], allPrograms);
  const server = serverDressage(serverState(eq, protocols, {}, {}));

  assert.equal(browser.penalty, 8);
  assert.equal(server.penalty, 8);
});

test('dressage: duplicate and empty protocols are dropped even without a judge list', () => {
  const eq = { startNumber: 8, className: 'KlassA', testKey: 'LA' };
  const protocols = [
    { judgeId: 'judge_C', movements: [{ momentNo: 1, score: 5 }, { momentNo: 2, score: 5 }] },
    { judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] },
    { judgeId: 'e', movements: [] }
  ];

  const browser = calculateDressageResult(eq, protocols, [], allPrograms);
  const server = serverDressage(serverState(eq, protocols, {}, {}));

  assert.equal(browser.judgeCount, 1);
  assert.equal(browser.penalty, 4);
  assert.equal(server.penalty, 4);
});

test('dressage: deduplicateAndFilterProtocols keeps the general doc for later error-point lookup', () => {
  const cleaned = deduplicateAndFilterProtocols([
    { judgeId: 'c', movements: [{ momentNo: 1, score: 8 }] },
    { id: 'general', errorPoints: 2 }
  ], []);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[1].id, 'general');
});

test('dressage: eliminated equipage is eliminated on both sides', () => {
  const eq = { startNumber: 9, className: 'KlassA', testKey: 'LA', eliminated: true };
  const protocols = [{ judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] }];

  assert.equal(calculateDressageResult(eq, protocols, [], allPrograms).eliminated, true);
  assert.equal(serverDressage(serverState(eq, protocols, {}, {})).eliminated, true);
});

test('dressage: class mapping is used by the browser as well as the server', () => {
  const eq = { startNumber: 10, className: 'Specialklass' };
  const protocols = [{ judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] }];
  globalThis.window = { klassProgramMapping: { Specialklass: 'LA' }, dressagePrograms: allPrograms };
  try {
    const browser = calculateDressageResult(eq, protocols, []);
    const server = serverDressage(buildCompetitionState(eq, protocols, {}, {}, {}, {
      ...serverContext,
      dressageProgramMapping: { Specialklass: 'LA' }
    }));
    assert.equal(browser.programKey, 'LA');
    assert.equal(server.programKey, 'LA');
    assert.equal(server.penalty, browser.penalty);
  } finally {
    delete globalThis.window;
  }
});

test('precision: merged-class course is found on the server too', () => {
  const eq = { startNumber: 11, className: 'Ingen egen bana', _mergedLabel: 'Sammanslagen' };
  const result = serverPrecision(serverState(eq, [], {}, {}, { finalized: true, timeMs: 130000, knocks: [] }));
  // 500 m at 250 m/min = 120 s; 10 s over at 0.5/s
  assert.equal(result.timePenalty, 5);
});

test('total: browser calculateTotalResult equals the stored server total', () => {
  setMarathonConfig(marathonConfig);
  setPauseWindows([]);
  const eq = { startNumber: 12, className: 'KlassA', category: 'horse', testKey: 'LA' };
  const protocols = [
    { id: 'c', judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 7 }] },
    { id: 'general', errorPoints: 2 }
  ];
  const marathonDoc = { obstacles: [{ number: 1, timeInSeconds: 20 }], observerLog: { wrongGaitSeconds: 10 } };
  const timing = { start_A: T0, finish_A: T0 + min(20), A: {}, B: { durationMs: 1200000 } };
  const precisionDoc = { finalized: true, timeMs: 105000, knocks: [3] };

  const browser = calculateTotalResult(eq, protocols, { obstacleData: marathonDoc, timeData: timing }, precisionDoc, {
    allPrograms, precisionConfig
  });
  const server = serverTotal(serverState(eq, protocols, marathonDoc, timing, precisionDoc));

  // dressage 5 + 2, marathon 5 + 2, precision 3 + 2.5
  assert.equal(browser.totalPenalty, 19.5);
  assert.equal(server.totalPenalty, browser.totalPenalty);
  assert.equal(server.dressagePenalty, browser.dressage.penalty);
  assert.equal(server.marathonPenalty, browser.marathon.totalPenalty);
  assert.equal(server.precisionPenalty, browser.precision.totalPenalty);
});
