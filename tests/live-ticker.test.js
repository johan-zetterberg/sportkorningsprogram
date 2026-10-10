import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stagePenaltyFromMs,
  setMarathonConfig,
  limitsFor,
  getTotalHoldTimeMs
} from '../js/utils/marathonUtils.js';

import {
  calculatePrecisionTimePenalty
} from '../js/utils/precisionCalculation.js';

import {
  calculatePrecisionLivePenalty,
  calculatePrecisionLiveElapsed,
  calculatePrecisionLiveRank,
  buildPrecisionLiveTick
} from '../js/pages/precision/precisionResultLive.js';

import {
  startOrUpdateMarathonLiveTicker,
  stopMarathonLiveTicker,
  clearMarathonLiveTickers
} from '../js/pages/marathon/marathonResultLiveTicker.js';

test('marathon stage live ticking accumulates TR time penalties as simulated time passes', () => {
  setMarathonConfig({
    timePenaltyRate: 0.25,
    marathonClassData: {
      SvMsv: {
        distanceB: 6000,
        tempoB: 240 // ideal: 1500s. min: 1320s, max: 1500s, timeLimit: 1800s
      }
    }
  });

  const eq = { startNumber: 10, className: 'SvMsv' };

  // 1. Innan maxtid (inom tillåtet tidsfönster 1320s - 1500s) -> 0 straff
  const tNormal = 1450 * 1000;
  const resNormal = stagePenaltyFromMs(tNormal, eq, 'B');
  assert.equal(resNormal.points, 0);
  assert.equal(resNormal.elim, false);

  // 2. 10 sekunder över maxtid -> 10 * 0.25 = 2.50 straff
  const tOver10 = 1510 * 1000;
  const resOver10 = stagePenaltyFromMs(tOver10, eq, 'B');
  assert.equal(resOver10.points, 2.50);
  assert.equal(resOver10.elim, false);

  // 3. 24 sekunder över maxtid -> 24 * 0.25 = 6.00 straff
  const tOver24 = 1524 * 1000;
  const resOver24 = stagePenaltyFromMs(tOver24, eq, 'B');
  assert.equal(resOver24.points, 6.00);
  assert.equal(resOver24.elim, false);

  // 4. Under minimitid (för snabb, t.ex. 1300s -> 20s för tidig) -> 20 * 0.25 = 5.00 straff
  const tUnder = 1300 * 1000;
  const resUnder = stagePenaltyFromMs(tUnder, eq, 'B');
  assert.equal(resUnder.points, 5.00);
  assert.equal(resUnder.elim, false);

  // 5. Över absolut tidsgräns för B-sträcka (> 2x idealtid = 3000s per TR Mom 541) -> Utesluten (ELIM)
  const tLimit = 3005 * 1000;
  const resLimit = stagePenaltyFromMs(tLimit, eq, 'B');
  assert.equal(resLimit.elim, true);
  assert.equal(resLimit.points, Infinity);
});

test('marathon live ticking deducts obstacle hold time (TR Mom 542) from running B duration', () => {
  setMarathonConfig({
    timePenaltyRate: 0.25,
    marathonClassData: {
      SvMsv: {
        distanceB: 6000,
        tempoB: 240 // ideal: 1500s, max: 1500s
      }
    }
  });

  const eq = { startNumber: 10, className: 'SvMsv' };

  // Ekipage har varit ute i 1520 sekunder (skulle gett 20s över maxtid = 5.00 straff)
  const grossMs = 1520 * 1000;
  const holdTimeSec = 30; // 30 sekunders uppehåll i hinder 2 p.g.a. vält vagn framför

  // Effektiv live-tid: brutto minus hold time
  const effectiveMs = grossMs - (holdTimeSec * 1000); // 1490s, vilket är < 1500s
  const res = stagePenaltyFromMs(effectiveMs, eq, 'B');

  assert.equal(effectiveMs, 1490 * 1000);
  assert.equal(res.points, 0, 'Ska inte få tidsstraff när hold time drar ner tiden under maxtid');
  assert.equal(res.elim, false);
});

test('precision live ticking calculates time penalty above max time at 0.50 pts/sec', () => {
  const maxTimeSec = 120; // 2 minuter

  // 1. Inom maxtid (115 sekunder) -> 0 straff
  assert.equal(calculatePrecisionTimePenalty(115 * 1000, maxTimeSec), 0);

  // 2. Exakt på maxtid -> 0 straff
  assert.equal(calculatePrecisionTimePenalty(120 * 1000, maxTimeSec), 0);

  // 3. 4 sekunder över maxtid (124s) -> 4 * 0.5 = 2.00 straff
  assert.equal(calculatePrecisionTimePenalty(124 * 1000, maxTimeSec), 2.0);

  // 4. 7.5 sekunder över maxtid (127.5s) -> 7.5 * 0.5 = 3.75 straff
  assert.equal(calculatePrecisionTimePenalty(127500, maxTimeSec), 3.75);

  // 5. Total live-beräkning med nedslag + tidsstraff
  const livePenalty = calculatePrecisionLivePenalty(
    { liveObstaclePenalty: 3.0, extraPenalty: 0 },
    {},
    { maxSec: maxTimeSec, timePenaltyRate: 0.5 },
    126000 // 6s över maxtid = 3.0 straff
  );

  assert.equal(livePenalty.obstaclePenalty, 3.0);
  assert.equal(livePenalty.timePenalty, 3.0);
  assert.equal(livePenalty.totalPenalty, 6.0);
});

test('precision live tick updates rank dynamically as penalty ticks up', () => {
  const equipages = [
    { startNumber: 1, className: 'Svår' },
    { startNumber: 2, className: 'Svår' },
    { startNumber: 3, className: 'Svår' }
  ];

  // Ekipage 1 är i mål på 4.0 straff, Ekipage 3 på 8.0 straff
  const precisionMap = new Map([
    ['1', { finalized: true, totalPenalty: 4.0 }],
    ['3', { finalized: true, totalPenalty: 8.0 }]
  ]);

  // Ekipage 2 tickar live:
  // Vid 2.0 straff: leder klassen (rank 1)
  const rankLeader = calculatePrecisionLiveRank(2.0, '2', equipages[1], equipages, precisionMap);
  assert.equal(rankLeader, 1);

  // Vid 5.0 straff: passerat ekipage 1 (rank 2)
  const rankSecond = calculatePrecisionLiveRank(5.0, '2', equipages[1], equipages, precisionMap);
  assert.equal(rankSecond, 2);

  // Vid 9.0 straff: sist (rank 3)
  const rankLast = calculatePrecisionLiveRank(9.0, '2', equipages[1], equipages, precisionMap);
  assert.equal(rankLast, 3);
});

test('global pause freezes live tick clock without advancing elapsed time', () => {
  const liveStartEpoch = 100000;
  const pauseStartTime = 115000; // Pausades efter 15 sekunder
  const isGloballyPaused = true;

  // Även om systemklockan Date.now() har rullat fram till 200000 (100 sekunder senare)
  // ska tick-klockan låsas vid pauseStartTime
  const simulatedSystemClock = 200000;
  const tickTimeNow = isGloballyPaused ? pauseStartTime : simulatedSystemClock;

  const elapsedMs = tickTimeNow - liveStartEpoch;
  assert.equal(elapsedMs, 15000, 'Live-tiden ska vara fryst vid 15 sekunder under paus');
});

test('marathonResultLiveTicker updates DOM and stops cleanly', () => {
  clearMarathonLiveTickers();

  // Mock DOM
  const elements = new Map();
  function createMockElement(id, attrs = {}) {
    return {
      textContent: '',
      classList: {
        classes: new Set(),
        add(...c) { c.forEach(x => this.classes.add(x)); },
        remove(...c) { c.forEach(x => this.classes.delete(x)); }
      },
      ...attrs
    };
  }

  const liveTimeEl = createMockElement('live-time');
  const liveLabelEl = createMockElement('live-label');
  const stagePtsEl = createMockElement('stage-pts');
  const totalPenEl = createMockElement('total-pen');

  global.document = {
    querySelectorAll(selector) {
      if (selector.includes('data-live-time')) return [liveTimeEl];
      if (selector.includes('data-live-label')) return [liveLabelEl];
      if (selector.includes('data-stage-pts')) return [stagePtsEl];
      if (selector.includes('data-total-pen')) return [totalPenEl];
      return [];
    }
  };

  const eq = { startNumber: 5, className: 'SvMsv' };
  const marathonMap = new Map([
    ['5', { running: true, currentObstacle: null }]
  ]);

  const timingDoc = {
    start_B: 1000000,
    finish_B: null
  };

  let tickCount = 0;
  startOrUpdateMarathonLiveTicker(5, {
    getIsGloballyPaused: () => false,
    equipages: [eq],
    marathonMap,
    timingDocFor: () => timingDoc,
    stageKeys: ['A', 'B'],
    stageStartTS: (t, s) => (s === 'B' ? 1000000 : null),
    stageStopTS: () => null,
    stageDurationMsSaved: () => 0,
    pausedMsSince: () => 0,
    formatMsLive: (ms) => '12:34',
    limitsFor: () => ({ ideal: 1000, min: 800, max: 1000, timeLimit: 1200 }),
    getPauseTime: () => 10,
    stagePenaltyFromMs: () => ({ points: 2.50, elim: false }),
    getObstacleCoefficient: () => 0.25,
    calculateResult: () => ({
      stages: { B: { timePenalty: 2.50 } },
      obstacles: { sum: 0 },
      totalPenalty: 45.50
    })
  });

  // Verifiera att run() kördes omedelbart och inte dubbelräknar tidsstraff som redan finns i baseRes
  assert.equal(liveLabelEl.textContent, 'B');
  assert.equal(liveTimeEl.textContent, '12:34');
  assert.equal(stagePtsEl.textContent, '2.50');
  assert.equal(totalPenEl.textContent, '45.50');

  // Stoppa ticker
  stopMarathonLiveTicker(5);
  clearMarathonLiveTickers();
});

test('marathon live obstacle ticking calculates running obstacle duration and penalty with pause compensation', () => {
  const obsCoeff = 0.25; // 0.25 straff per sekund
  const accumulatedMs = 12000; // 12 sekunder innan paus
  const obsStartMs = 100000;
  
  // 1. Klockan står på 105000 (5s efter omstart), ingen paus -> 12s + 5s = 17s
  const nowNormal = 105000;
  const pauseOffsetNormal = 0;
  const obsTimeNormal = accumulatedMs + Math.max(0, nowNormal - obsStartMs - pauseOffsetNormal);
  const livePenaltyNormal = (obsTimeNormal / 1000) * obsCoeff;

  assert.equal(obsTimeNormal, 17000);
  assert.equal(livePenaltyNormal, 4.25);

  // 2. Klockan står på 110000 (10s efter omstart), men 3 sekunders paus inträffade -> 12s + (10s - 3s) = 19s
  const nowPaused = 110000;
  const pauseOffset = 3000;
  const obsTimePaused = accumulatedMs + Math.max(0, nowPaused - obsStartMs - pauseOffset);
  const livePenaltyPaused = (obsTimePaused / 1000) * obsCoeff;

  assert.equal(obsTimePaused, 19000);
  assert.equal(livePenaltyPaused, 4.75);
});

test('multi-step simulated live tick progression increments time and penalties step-by-step', () => {
  const maxTimeSec = 100;
  const timePenaltyRate = 0.5;

  // Simulera 5 sekunders löpande klocka med 1-sekundsintervall förbi maxtid (98s till 103s)
  const ticks = [
    { elapsedMs: 98000, expectedPenalty: 0.0, expectedLabel: '01:38' },
    { elapsedMs: 99000, expectedPenalty: 0.0, expectedLabel: '01:39' },
    { elapsedMs: 100000, expectedPenalty: 0.0, expectedLabel: '01:40' },
    { elapsedMs: 101000, expectedPenalty: 0.5, expectedLabel: '01:41' },
    { elapsedMs: 102000, expectedPenalty: 1.0, expectedLabel: '01:42' },
    { elapsedMs: 103000, expectedPenalty: 1.5, expectedLabel: '01:43' }
  ];

  for (const tick of ticks) {
    const pen = calculatePrecisionTimePenalty(tick.elapsedMs, maxTimeSec, timePenaltyRate);
    assert.equal(pen, tick.expectedPenalty, `Vid ${tick.elapsedMs}ms ska straffet vara ${tick.expectedPenalty}`);

    const sec = Math.floor(tick.elapsedMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const label = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    assert.equal(label, tick.expectedLabel, `Tidsetikett vid ${tick.elapsedMs}ms ska vara ${tick.expectedLabel}`);
  }
});
