// Rule decisions 2026-10-17: warm-up as section A, a class without A/WU (FEI
// 2026), clear round for the whole class, FEI cones speeds from the engine
// state (ponies, reserve, Para) and the children's class port/tempo.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEquipageState, buildCompetitionState } from '../js/core-engine/stateSelector.js';
import {
  limitsFor,
  stagePenaltyFromMs,
  calculateMarathonResult,
  isClearRoundClass,
  getClassSettingsKey
} from '../js/core-engine/marathon.js';
import { calculateTotalResult as coreTotal } from '../js/core-engine/calculation.js';
import {
  dressageRankKey,
  marathonRankKey,
  precisionRankKey,
  totalRankKey
} from '../js/core-engine/ranking.js';
import { RESULT_ENGINE_VERSION } from '../js/core-engine/version.js';
import {
  feiConesTempoMpm,
  getClassTempoMpm,
  computeMaxSecondsForClass,
  FEI_PARA_CONES_TEMPO_MPM
} from '../js/utils/precisionCalculation.js';
import { resolveStandardPortAllowance, matchClassTableKey, klassTempoData } from '../js/data/competitionData.js';
import {
  allowanceForClass,
  buildPlaceMap,
  buildOverallStanding,
  calculatePrecisionResult as uiPrecisionResult
} from '../js/utils/precisionUtils.js';
import { setMarathonConfig } from '../js/utils/marathonUtils.js';
import { applyTotalDisciplinePlacements, placeTotalRowsWithinClass } from '../js/pages/shared/totalResultRanking.js';
import { buildArchiveRowsFromData } from '../js/services/archiveRowBuilder.js';
import { rankSpeakerResultRows } from '../js/pages/shared/speakerCalculations.js';
import { calculateMarathonResult as serverMarathon } from '../functions/src/core-engine/marathon.js';
import { buildCompetitionState as serverState } from '../functions/src/core-engine/stateSelector.js';
import { getClassTempoMpm as serverTempo } from '../functions/src/utils/precisionCalculation.js';

const min = (m) => m * 60000;

test('engine version is bumped for the rule decisions', () => {
  // At least this version (later rule fixes bump it again)
  assert.ok(RESULT_ENGINE_VERSION >= '2026-10-17.1');
});

// --- 1. Warm-up = section A (TR V 522.1; FEI 963.2.3, 963.2.5, 963.5) ---

const wuConfig = {
  marathonClassData: {
    WU: { fixedTimeA: 20, distanceB: 6000, tempoB: 300 },
    BarnWU: { fixedTimeA: 10, distanceB: 4000, tempoB: 200 },
    // FEI 2026: neither section A nor a Controlled Warm-Up
    OnlyB: { distanceB: 6000, tempoB: 300 }
  },
  obstacleNumbers: [1]
};

test('warm-up limits: minimum = Time Allowed - 2 min, Time Limit = Time Allowed + 20 %', () => {
  const eq = { className: 'WU', category: 'horse' };
  assert.deepEqual(limitsFor(eq, 'A', wuConfig), { ideal: 1200, min: 1080, max: 1200, timeLimit: 1440, isFixedTime: true });
  // TR V 522.1: 10 min warm-up in the children's class -> minimum 8 min
  assert.deepEqual(limitsFor({ className: 'BarnWU' }, 'A', wuConfig), { ideal: 600, min: 480, max: 600, timeLimit: 720, isFixedTime: true });
});

test('warm-up penalties: 0.25 per second over the Time Allowed or under the minimum', () => {
  const eq = { className: 'WU', category: 'horse' };
  assert.deepEqual(stagePenaltyFromMs(min(21), eq, 'A', wuConfig), { points: 15, elim: false }); // 60 s over
  assert.deepEqual(stagePenaltyFromMs(min(17), eq, 'A', wuConfig), { points: 15, elim: false }); // 60 s under 18 min
  assert.deepEqual(stagePenaltyFromMs(min(18), eq, 'A', wuConfig), { points: 0, elim: false });
  assert.deepEqual(stagePenaltyFromMs(min(20), eq, 'A', wuConfig), { points: 0, elim: false });
  assert.deepEqual(stagePenaltyFromMs(1441000, eq, 'A', wuConfig), { points: Infinity, elim: true }); // over 24 min
});

test('warm-up penalty reaches the marathon total (browser engine and Cloud Function copy)', () => {
  const equipage = { startNumber: 1, className: 'WU', category: 'horse' };
  const timing = { A: { durationMs: min(20) + 40000 }, B: { durationMs: min(20) } };
  const doc = { obstacles: [{ number: 1, timeSeconds: 40 }] };
  const local = calculateMarathonResult(buildCompetitionState(equipage, null, doc, timing, null, { marathonConfig: wuConfig }));
  const server = serverMarathon(serverState(equipage, null, doc, timing, null, { marathonConfig: wuConfig }));
  // A: 40 s over = 10; obstacle 40 s x 0.25 = 10
  assert.equal(local.stages.A.timePenalty, 10);
  assert.equal(local.totalPenalty, 20);
  assert.equal(server.totalPenalty, 20);
});

test('a class with neither section A nor warm-up (FEI 2026) is complete with B only', () => {
  const equipage = { startNumber: 2, className: 'OnlyB', category: 'horse' };
  const timing = { B: { durationMs: min(19) } }; // within B's window (17-20 min)
  const result = calculateMarathonResult(buildCompetitionState(
    equipage, null, { obstacles: [{ number: 1, timeSeconds: 30 }] }, timing, null, { marathonConfig: wuConfig }
  ));
  assert.equal(limitsFor(equipage, 'A', wuConfig), null);
  assert.equal(result.configMissing, false);
  assert.deepEqual(result.missingConfig, []);
  assert.equal(result.stages.A.timePenalty, 0);
  assert.equal(result.totalPenalty, 7.5);
  assert.equal(result.status, 'Klar');
  assert.deepEqual(marathonRankKey(result), { penalty: 7.5, bPenalty: 7.5 });
});

// --- 2. Clear round for the whole class (TR V 509.3) ---

const crPrograms = { LA: { id: 'LA', name: 'Svenskt Latt A', movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }] } };
const crMarathon = {
  marathonClassData: {
    CRMarathon: { distanceB: 6000, tempoB: 300, clearRound: true },
    CRDressage: { distanceB: 6000, tempoB: 300 },
    Ranked: { distanceB: 6000, tempoB: 300 }
  },
  obstacleNumbers: [1]
};
const crDressage = { crdressage: { clearRound: true, limit: 60 } }; // key case differs on purpose
const crPrecision = { maxTimeByClass: { CRMarathon: 100, CRDressage: 100, Ranked: 100 } };

test('isClearRoundClass: either the marathon or the dressage setting makes the class clear round', () => {
  assert.equal(isClearRoundClass('CRMarathon', { marathonConfig: crMarathon }), true);
  assert.equal(isClearRoundClass('CRDressage', { marathonConfig: crMarathon, dressyrClassConfig: crDressage }), true);
  assert.equal(isClearRoundClass('Ranked', { marathonConfig: crMarathon, dressyrClassConfig: crDressage }), false);
  assert.equal(isClearRoundClass('', { marathonConfig: crMarathon }), false);
  assert.equal(getClassSettingsKey('CRMarathon Ponny', crMarathon), 'CRMarathon');
});

function crState(className, startNumber = 1) {
  return buildCompetitionState(
    { startNumber, className, category: 'horse', testKey: 'LA' },
    [{ judgeId: 'c', movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 7 }] }],
    { obstacles: [{ number: 1, timeSeconds: 40, knockdownPenalty: 2 }] },
    { B: { durationMs: min(19) } },
    { finalized: true, timeMs: 90000, knocks: [] },
    {
      allPrograms: crPrograms,
      dressageJudgeMapping: { [className]: { C: 'c' } },
      marathonConfig: crMarathon,
      dressyrClassConfig: crDressage,
      precisionConfig: crPrecision
    }
  );
}

test('engine: a clear round class (dressage setting only) is clear round in every phase and gets no rank key', () => {
  const res = coreTotal(crState('CRDressage'));
  assert.equal(res.isClearRound, true);
  assert.equal(res.dressage.isClearRound, true);
  assert.equal(res.marathon.isClearRound, true);
  assert.equal(res.precision.isClearRound, true);
  // TR V 526.1: time in obstacles gives no penalty in clear round; knockdown 2 still counts
  assert.equal(res.marathon.totalPenalty, 2);
  assert.equal(res.marathon.clearRoundApproved, false);
  assert.equal(res.dressage.penalty, 6);
  assert.equal(res.totalPenalty, 8);
  assert.equal(dressageRankKey(res.dressage), null);
  assert.equal(marathonRankKey(res.marathon), null);
  assert.equal(precisionRankKey(res.precision, { requireFinished: true }), null);
  assert.equal(totalRankKey({ totalPenalty: res.totalPenalty, isClearRound: res.isClearRound }), null);

  const ranked = coreTotal(crState('Ranked'));
  assert.equal(ranked.isClearRound, false);
  assert.equal(ranked.marathon.totalPenalty, 12); // 40 s x 0.25 + 2
  assert.deepEqual(dressageRankKey(ranked.dressage), { penalty: 6 });
});

test('total list: clear round rows get no total place and no posDress/posMar/posPrec', () => {
  const row = (startNumber, className, isClearRound) => ({
    startNumber,
    className,
    totalPenalty: 10 + startNumber,
    isEliminated: false,
    dressage: { penalty: 5 + startNumber, isClearRound },
    marathon: { totalPenalty: 3, status: 'Klar', isClearRound },
    precision: { pen: 2, totalPenalty: 2, finalized: true, status: 'Klar', isClearRound }
  });
  const rows = [row(1, 'CR', true), row(2, 'CR', true), row(3, 'Ranked', false), row(4, 'Ranked', false)];
  placeTotalRowsWithinClass(rows);
  applyTotalDisciplinePlacements(rows);
  const bySn = Object.fromEntries(rows.map(r => [r.startNumber, r]));
  for (const sn of [1, 2]) {
    assert.deepEqual([bySn[sn].plac, bySn[sn].posDress, bySn[sn].posMar, bySn[sn].posPrec], [null, null, null, null]);
  }
  assert.deepEqual([bySn[3].plac, bySn[3].posDress, bySn[3].posMar, bySn[3].posPrec], [1, 1, 1, 1]);
  assert.deepEqual([bySn[4].plac, bySn[4].posDress], [2, 2]);
});

test('archive rows: clear round class has no places; row.marathon carries isClearRound and feiClass', () => {
  const equipages = [
    { startNumber: 10, className: 'CRMarathon', category: 'horse', testKey: 'LA' },
    { startNumber: 11, className: 'CRDressage', category: 'horse', testKey: 'LA' },
    { startNumber: 12, className: 'Ranked', category: 'horse', testKey: 'LA' }
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
    dressageJudgeMapping: { CRMarathon: { C: 'c' }, CRDressage: { C: 'c' }, Ranked: { C: 'c' } },
    dressyrClassConfig: crDressage,
    allPrograms: crPrograms
  });
  const bySn = Object.fromEntries(rows.map(r => [r.startNumber, r]));
  for (const sn of [10, 11]) {
    const r = bySn[sn];
    assert.equal(r.isClearRound, true, `#${sn}`);
    assert.equal(r.marathon.isClearRound, true, `#${sn}`);
    assert.equal(r.marathon.totalPenalty, 0, `#${sn}: obstacle time free`);
    assert.equal(r.marathon.clearRoundApproved, true, `#${sn}`);
    assert.equal(r.totalPenalty, 6, `#${sn}`);
    assert.deepEqual([r.plac, r.posDress, r.posMar, r.posPrec], ['', null, null, null], `#${sn}`);
  }
  assert.equal(bySn[12].marathon.isClearRound, false);
  assert.equal(bySn[12].marathon.feiClass, false);
  assert.equal(bySn[12].totalPenalty, 16);
  assert.deepEqual([bySn[12].plac, bySn[12].posDress, bySn[12].posMar, bySn[12].posPrec], [1, 1, 1, 1]);
});

test('speaker standings: clear round rows get no place and no dressage position', () => {
  const rows = [
    { startNumber: 1, totalPenalty: 10, isEliminated: false, isClearRound: true, dressage: { penalty: 5 }, marathon: { totalPenalty: 3, isClearRound: true }, precision: { pen: 2 } },
    { startNumber: 2, totalPenalty: 12, isEliminated: false, isClearRound: true, dressage: { penalty: 6 }, marathon: { totalPenalty: 4, isClearRound: true }, precision: { pen: 2 } }
  ];
  rankSpeakerResultRows(rows);
  assert.deepEqual(rows.map(r => [r.plac, r.posDress]), [[null, null], [null, null]]);
  assert.equal(marathonRankKey({ totalPenalty: 3, isClearRound: true }, { requireFinished: false }), null);
  assert.equal(precisionRankKey({ totalPenalty: 2, isClearRound: true }), null);
});

test('precision pages: no place and no overall rank in a clear round class (session marathon config)', () => {
  setMarathonConfig(crMarathon);
  const rows = [
    { startNumber: 20, className: 'CRMarathon' },
    { startNumber: 21, className: 'CRMarathon' },
    { startNumber: 22, className: 'Ranked' }
  ];
  const precisionMap = new Map(rows.map(r => [String(r.startNumber), { finalized: true, timeMs: 90000, knocks: [] }]));
  const places = buildPlaceMap(rows, precisionMap, crPrecision);
  assert.deepEqual([places.get('20'), places.get('21'), places.get('22')], [null, null, 1]);
  assert.equal(uiPrecisionResult({ finalized: true, timeMs: 90000 }, rows[0], crPrecision).isClearRound, true);

  const standing = buildOverallStanding(
    rows.map(eq => ({ eq, dressagePenalty: 5, marathonPenalty: 3, isElim: false })),
    precisionMap,
    crPrecision
  );
  assert.deepEqual(['20', '21', '22'].map(sn => standing.map.get(sn).rank), [null, null, 1]);
});

// --- 3. FEI cones speed from the engine state (FEI 975.10.5) ---

test('engine state keeps horse type and reserve: FEI Junior 2* pony single drives 260 m/min', () => {
  const doc = {
    startNumber: 5,
    className: 'FEI Junior 2*',
    horses: [{ name: 'Pia', type: 'B-ponny' }, { name: 'Res', type: 'B-ponny', isReserve: true }]
  };
  const eq = buildEquipageState(doc);
  assert.deepEqual(eq.horses.map(h => [h.type, h.reserve]), [['B-ponny', false], ['B-ponny', true]]);
  assert.equal(getClassTempoMpm(eq, {}), 260);
  assert.equal(serverTempo(serverState(doc, null, null, null, null, {}).equipage, {}), 260);
  // 520 m at 260 m/min = 120 s
  assert.equal(computeMaxSecondsForClass(eq, { courses: { 'FEI Junior 2*': { trackLengthMeters: 520 } } }), 120);

  const horse = buildEquipageState({ ...doc, horses: [{ name: 'Hugo', type: 'Häst' }] });
  assert.equal(getClassTempoMpm(horse, {}), 250);
  const pair = buildEquipageState({ ...doc, horses: [{ type: 'C-ponny' }, { type: 'C-ponny' }] });
  assert.equal(getClassTempoMpm(pair, {}), 250);
});

test('FEI Junior 2* without hitch or horse info falls back to 250 (FEI 975.10.5), not four-in-hand 240', () => {
  assert.equal(feiConesTempoMpm('FEI Junior 2*'), null);
  assert.equal(klassTempoData['FEI Junior 2*'].precision, 250);
  assert.equal(getClassTempoMpm('FEI Junior 2*', {}), 250);
  assert.equal(getClassTempoMpm({ className: 'FEI 2*', hitch: 'Four-in-hand' }, {}), 240);
});

// --- 4. FEI Para cones speed (FEI Annex 8.14) ---

test('FEI Para cones: 230 m/min for horses and ponies', () => {
  assert.equal(FEI_PARA_CONES_TEMPO_MPM, 230);
  assert.equal(feiConesTempoMpm('FEI Para 1* Enbet Ponny'), 230);
  assert.equal(feiConesTempoMpm('CAI2* Para Par Häst'), 230);
  assert.equal(feiConesTempoMpm({ className: 'CAI2* Enbet Ponny', isPara: true }), 230);
  assert.equal(getClassTempoMpm(buildEquipageState({ className: 'FEI 2* Enbet Häst', isPara: true }), {}), 230);
  // 460 m at 230 m/min = 120 s
  assert.equal(computeMaxSecondsForClass('FEI Para 2*', { courses: { 'FEI Para 2*': { trackLengthMeters: 460 } } }), 120);
  // Swedish Para classes keep their TR tempo
  assert.equal(getClassTempoMpm('Lätt A Para Häst', {}), 210);
});

// --- 5. The children's class: Lätt B Barn port allowance and tempo (TR V Bilaga 5) ---

test('Barnklass names get Lätt B Barn: 45 cm and 100 m/min', () => {
  for (const name of ['Barnklass', 'Barnklass Ponny', 'LB Barn', 'Lätt B Barnklass', 'Lätt B Barn']) {
    assert.equal(resolveStandardPortAllowance(name), 45, name);
    assert.equal(allowanceForClass(name), 45, name);
    assert.equal(getClassTempoMpm(name, {}), 100, name);
  }
  // Lätt A children's class: 45 cm and 180 m/min (Bilaga 5 LA "Barn")
  assert.equal(resolveStandardPortAllowance('Lätt A Barnklass'), 45);
  assert.equal(getClassTempoMpm('Lätt A Barnklass', {}), 180);
});

test('short table keys match whole words only', () => {
  assert.equal(matchClassTableKey('Barnklass', ['LA', 'Lätt A']), null);
  assert.equal(resolveStandardPortAllowance('Lagklass Lätt A'), 30);
  assert.equal(resolveStandardPortAllowance('Lätt A Enbet Häst'), 30);
  assert.equal(resolveStandardPortAllowance('LA'), 30);
  assert.equal(resolveStandardPortAllowance('Msv Para Ponny'), 25);
  assert.equal(resolveStandardPortAllowance('Lätt B Fyrspann'), 45);
  assert.equal(resolveStandardPortAllowance('Lätt B Enbet Ponny'), 35);
  assert.equal(getClassTempoMpm('Lätt B Enbet Ponny', {}), 160);
  assert.equal(getClassTempoMpm('MSV 3 Par Häst', {}), 230);
});
