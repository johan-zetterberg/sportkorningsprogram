// Rule fixes 2026-10-22: clear round approval over all phases (TR V 509.3),
// TR minimum-time rounding in the driver's favour, CH precision tempos
// (Bilaga 5), Lätt A Barn precision time (TR 509.2), no live precision place
// for formats the engine does not calculate, and the speaker's signed gap.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompetitionState } from '../js/core-engine/stateSelector.js';
import { calculateTotalResult as coreTotal } from '../js/core-engine/calculation.js';
import { stagePenaltyFromMs, stageSecondsForPenalty } from '../js/core-engine/marathon.js';
import {
  CLEAR_ROUND_MAX_DRESSAGE_PENALTY,
  clearRoundPhaseApproved,
  clearRoundApprovedOver
} from '../js/core-engine/rules-ledger.js';
import { RESULT_ENGINE_VERSION } from '../js/core-engine/version.js';
import { klassTempoData } from '../js/data/competitionData.js';
import { getClassTempoMpm, computeMaxSecondsForClass, isLattBBarnClass } from '../js/utils/precisionCalculation.js';
import { buildArchiveRowsFromData } from '../js/services/archiveRowBuilder.js';
import { setMarathonConfig } from '../js/utils/marathonUtils.js';
import { getTotalRanking } from '../js/pages/shared/speakerCalculations.js';
import { formatSpeakerGap } from '../js/pages/shared/speakerFormatUtils.js';
import { calculateTotalResult as serverTotal } from '../functions/src/core-engine/calculation.js';
import { stagePenaltyFromMs as serverStagePenalty } from '../functions/src/core-engine/marathon.js';
import { buildCompetitionState as serverState } from '../functions/src/core-engine/stateSelector.js';
import { getClassTempoMpm as serverTempo } from '../functions/src/utils/precisionCalculation.js';

const sec = (s) => s * 1000;
const min = (m) => m * 60000;

test('engine version is bumped for the 2026-10-22 rule fixes', () => {
  assert.ok(RESULT_ENGINE_VERSION >= '2026-10-22.2');
});

// --- 1. Clear round (TR V 509.3) ---
// "Vid bedömning clear round rangordnas inte ekipagen. Kriterier för clear
// round är i dressyr högst 80 straffpoäng, i maraton och precision 0
// straffpoäng. Tid i maratonhinder ger inte straffpoäng."

test('clear round criteria per phase: dressage at most 80 p, marathon and precision 0 p', () => {
  assert.equal(CLEAR_ROUND_MAX_DRESSAGE_PENALTY, 80);
  assert.equal(clearRoundPhaseApproved('D', 80), true);
  assert.equal(clearRoundPhaseApproved('D', 80.004), true); // 80.00 after rounding
  assert.equal(clearRoundPhaseApproved('D', 80.01), false);
  assert.equal(clearRoundPhaseApproved('D', 40, { eliminated: true }), false);
  assert.equal(clearRoundPhaseApproved('M', 0), true);
  assert.equal(clearRoundPhaseApproved('M', 0.25), false);
  assert.equal(clearRoundPhaseApproved('P', 3), false);
  assert.equal(clearRoundPhaseApproved('P', null), null); // no result
  // Over the phases the class drives (null = not driven)
  assert.equal(clearRoundApprovedOver({ D: { penalty: 40 }, M: { penalty: 0 }, P: { penalty: 3 } }), false);
  assert.equal(clearRoundApprovedOver({ D: { penalty: 95 }, M: { penalty: 0 }, P: { penalty: 0 } }), false);
  assert.equal(clearRoundApprovedOver({ D: { penalty: 80 }, M: { penalty: 0 }, P: { penalty: 0 } }), true);
  assert.equal(clearRoundApprovedOver({ D: null, M: null, P: { penalty: 0 } }), true); // precision only
  assert.equal(clearRoundApprovedOver({ D: { penalty: 40 }, M: { penalty: null }, P: null }), false); // driven, no result
  assert.equal(clearRoundApprovedOver({}), false);
});

const crPrograms = { LA: { id: 'LA', name: 'Svenskt Latt A', movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }] } };
const crMarathon = {
  marathonClassData: {
    CR: { distanceB: 6000, tempoB: 300, clearRound: true },
    Ranked: { distanceB: 6000, tempoB: 300 }
  },
  obstacleNumbers: [1]
};
const crPrecision = { maxTimeByClass: { CR: 100, Ranked: 100 } };

// Two movements of 7 = 70 %: judge penalty 6 p; the error points (TR 518.9) add 1:1
function crState(build, { errorPoints = 0, knockdown = 0, knocks = [], className = 'CR' } = {}) {
  return build(
    { startNumber: 1, className, category: 'horse', testKey: 'LA', errorPoints },
    [{ judgeId: 'c', movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 7 }] }],
    // 40 s in the obstacle: free in clear round (TR 526.1)
    { obstacles: [{ number: 1, timeSeconds: 40, knockdownPenalty: knockdown }] },
    { B: { durationMs: min(19) } },
    { finalized: true, timeMs: 90000, knocks },
    {
      allPrograms: crPrograms,
      dressageJudgeMapping: { [className]: { C: 'c' } },
      marathonConfig: crMarathon,
      precisionConfig: crPrecision
    }
  );
}

test('dressage clear round: approved by the final penalty incl. error points <= 80, not by percent', () => {
  // 70 % + 74 error points = 80 p: approved
  const at80 = coreTotal(crState(buildCompetitionState, { errorPoints: 74 }));
  assert.equal(at80.dressage.percent, 70);
  assert.equal(at80.dressage.penalty, 80);
  assert.equal(at80.dressage.dressageClearRoundApproved, true);
  // 70 % + 75 error points = 81 p: not approved (before: "Godkänd", 70 % >= the 60 % limit)
  const at81 = coreTotal(crState(buildCompetitionState, { errorPoints: 75 }));
  assert.equal(at81.dressage.penalty, 81);
  assert.equal(at81.dressage.dressageClearRoundApproved, false);
  // Not a clear round class: no approval
  assert.equal(coreTotal(crState(buildCompetitionState, { className: 'Ranked' })).dressage.dressageClearRoundApproved, false);
});

test('total clearRoundApproved combines dressage, marathon and precision; the server engine agrees', () => {
  for (const [build, total] of [[buildCompetitionState, coreTotal], [serverState, serverTotal]]) {
    const ok = total(crState(build));
    assert.equal(ok.isClearRound, true);
    assert.equal(ok.marathon.totalPenalty, 0, 'obstacle time free');
    assert.equal(ok.precision.totalPenalty, 0);
    assert.equal(ok.clearRoundApproved, true);

    // Marathon 0 on its own, but the dressage over 80: not approved
    const dressageOver = total(crState(build, { errorPoints: 75 }));
    assert.equal(dressageOver.marathon.clearRoundApproved, true, 'the marathon part alone');
    assert.equal(dressageOver.clearRoundApproved, false);

    // A knockdown in the marathon (2 p)
    assert.equal(total(crState(build, { knockdown: 2 })).clearRoundApproved, false);

    // A knocked-down ball in precision
    const precisionKnock = total(crState(build, { knocks: [1] }));
    assert.equal(precisionKnock.precision.totalPenalty, 3);
    assert.equal(precisionKnock.clearRoundApproved, false);

    // Not a clear round class
    assert.equal(total(crState(build, { className: 'Ranked' })).clearRoundApproved, false);
  }
});

test('archive rows carry the whole clear round, not only the marathon part', () => {
  const equipages = [
    { startNumber: 10, className: 'CR', category: 'horse', testKey: 'LA' },
    { startNumber: 11, className: 'CR', category: 'horse', testKey: 'LA', errorPoints: 75 }
  ];
  const protocol = [{ judgeId: 'c', movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 7 }] }];
  setMarathonConfig(crMarathon);
  const rows = buildArchiveRowsFromData({
    equipages,
    dressageProtocols: new Map(equipages.map(e => [String(e.startNumber), protocol])),
    marathonTimingMap: new Map(equipages.map(e => [String(e.startNumber), { B: { durationMs: min(19) } }])),
    marathonObstacleRows: equipages.map(e => ({ equipageId: String(e.startNumber), obstacleNumber: 1, timeSeconds: 40 })),
    precisionRows: equipages.map(e => ({ startNumber: e.startNumber, finalized: true, timeMs: 90000, knocks: [] })),
    marathonConfig: crMarathon,
    precisionConfig: crPrecision,
    dressageJudgeMapping: { CR: { C: 'c' } },
    dressyrClassConfig: {},
    allPrograms: crPrograms
  });
  const bySn = Object.fromEntries(rows.map(r => [r.startNumber, r]));
  assert.equal(bySn[10].clearRoundApproved, true);
  assert.equal(bySn[10].dressage.clearRoundApproved, true);
  assert.equal(bySn[11].dressage.penalty, 81);
  assert.equal(bySn[11].marathon.clearRoundApproved, true); // the marathon part
  assert.equal(bySn[11].dressage.clearRoundApproved, false);
  assert.equal(bySn[11].clearRoundApproved, false);
});

// --- 2. TR minimum time rounded up, maximum time down (owner 2026-10-22) ---

const profileConfig = {
  marathonClassData: {
    'Lätt A Enbet Häst': { distanceB: 6000, tempoB: 240 }, // B: max 1500 s, min 1320 s
    'Int Enbet Häst': { distanceB: 6000, tempoB: 240, ruleProfile: 'FEI' }
  },
  obstacleNumbers: [1]
};

test('TR section time: whole seconds in the driver\'s favour on both sides; FEI keeps milliseconds', () => {
  const tr = { className: 'Lätt A Enbet Häst' };
  const fei = { className: 'Int Enbet Häst' };
  for (const penalty of [stagePenaltyFromMs, serverStagePenalty]) {
    // 1319.5 s against min 1320 s: 1320 s -> 0 p (before: 1319 s -> 0.25 p)
    assert.deepEqual(penalty(sec(1319.5), tr, 'B', profileConfig), { points: 0, elim: false });
    // 1318.9 s: 1319 s -> 1 s under -> 0.25 p
    assert.deepEqual(penalty(sec(1318.9), tr, 'B', profileConfig), { points: 0.25, elim: false });
    assert.deepEqual(penalty(sec(1320), tr, 'B', profileConfig), { points: 0, elim: false });
    // 1500.999 s against max 1500 s: 1500 s -> 0 p (unchanged)
    assert.deepEqual(penalty(sec(1500.999), tr, 'B', profileConfig), { points: 0, elim: false });
    assert.deepEqual(penalty(sec(1501), tr, 'B', profileConfig), { points: 0.25, elim: false });
    // FEI 968.1.1: no rounding
    assert.deepEqual(penalty(sec(1319.6), fei, 'B', profileConfig), { points: 0.1, elim: false });
    assert.deepEqual(penalty(sec(1500.4), fei, 'B', profileConfig), { points: 0.1, elim: false });
  }
  assert.equal(stageSecondsForPenalty(sec(1319.5), 'TR', 'min'), 1320);
  assert.equal(stageSecondsForPenalty(sec(1320) + 0.0001, 'TR', 'min'), 1320); // float noise
  assert.equal(stageSecondsForPenalty(sec(1319.5), 'TR'), 1319);
  assert.equal(stageSecondsForPenalty(sec(1319.5), 'FEI', 'min'), 1319.5);
});

// --- 4. Lätt A Barn: 180 m/min with normal time penalties (TR 509.2, Bilaga 5, Bilaga 9) ---

test('Lätt A Barn keeps the LA "Barn" tempo 180 and normal time; only Lätt B Barn drives to the 100 m/min limit', () => {
  assert.equal(getClassTempoMpm('Lätt A Barn Ponny', {}, { ruleProfile: 'TR' }), 180);
  assert.equal(isLattBBarnClass('Lätt A Barnklass'), false);
  assert.equal(getClassTempoMpm('Lätt B Barn Ponny', {}, { ruleProfile: 'TR' }), 100);
  assert.equal(isLattBBarnClass('Lätt B Barn Ponny'), true);
  // 540 m at 180 m/min = 180 s time allowed
  assert.equal(computeMaxSecondsForClass('Lätt A Barn Ponny', { courses: { 'Lätt A Barn Ponny': { trackLengthMeters: 540 } } }, { ruleProfile: 'TR' }), 180);
});

// --- 5. CH tempos (TR V Bilaga 5: "LA CH 180 -", "MSV ”CH” 230 -") ---

test('Bilaga 5 CH precision tempos: Lätt A CH 180, Msv CH 230 (ponies, phase 1 only)', () => {
  assert.equal(klassTempoData['Lätt A CH Ponny'].precision, 180);
  assert.equal(klassTempoData['Lätt A CH Ponny'].precisionPhase2, undefined);
  assert.equal(klassTempoData['Msv CH Ponny'].precision, 230);
  assert.equal(klassTempoData['Msv CH Ponny'].precisionPhase2, undefined);
  for (const tempo of [getClassTempoMpm, serverTempo]) {
    // Before: no tempo (null) for these names
    assert.equal(tempo('Lätt A CH Enbet Ponny', {}, { ruleProfile: 'TR' }), 180);
    assert.equal(tempo('LA CH', {}, { ruleProfile: 'TR' }), 180);
    assert.equal(tempo('MSV CH Enbet Ponny', {}, { ruleProfile: 'TR' }), 230);
    assert.equal(tempo('Msv CH', {}, { ruleProfile: 'TR' }), 230);
    // Unchanged neighbours
    assert.equal(tempo('Lätt A Enbet Ponny', {}, { ruleProfile: 'TR' }), 200);
    assert.equal(tempo('Msv Ponny', {}, { ruleProfile: 'TR' }), 230);
  }
});

// --- 6. Speaker: no live precision place for a format the engine does not calculate ---

function speakerCtx(format) {
  const allEquipages = [
    { startNumber: 1, className: 'Tid', driverName: 'A', category: 'horse' },
    { startNumber: 2, className: 'Tid', driverName: 'B', category: 'horse' }
  ];
  return {
    allEquipages,
    activeEquipages: new Map(),
    dressageStatusMap: new Map(),
    maratonStatusMap: new Map(),
    precisionStatusMap: new Map([
      ['1', { finalized: true, timeMs: 80000, knocks: [] }],
      ['2', { finalized: true, timeMs: 90000, knocks: [] }]
    ]),
    precisionConfig: { courses: { Tid: { format, trackLengthMeters: 500 } }, maxTimeByClass: { Tid: 200 } },
    startTimes: {},
    marathonConfig: {},
    dressyrClassConfig: {}
  };
}

test('speaker standings: a time competition / unsupported precision format gets no live precision place', () => {
  const normal = getTotalRanking('Tid', null, speakerCtx('normal'));
  assert.deepEqual(normal.map(r => r.posPrec).sort(), [1, 2]);
  const unsupported = getTotalRanking('Tid', null, speakerCtx('winningRound'));
  assert.equal(unsupported.every(r => r.precision.formatUnsupported === true), true);
  assert.deepEqual(unsupported.map(r => r.posPrec ?? null), [null, null]);
});

// --- 7. Speaker gap sign ---

test('speaker gap: + behind, U+2212 ahead, never "+-"', () => {
  assert.equal(formatSpeakerGap(12.5), '+12.50');
  assert.equal(formatSpeakerGap(-48), '−48.00');
  assert.equal(formatSpeakerGap(0), '±0.00');
  assert.equal(formatSpeakerGap(-0.001), '±0.00');
  assert.equal(formatSpeakerGap(null), '');
  assert.equal(formatSpeakerGap(-48).includes('+'), false);
});
