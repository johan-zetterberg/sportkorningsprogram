// Rule fixes 2026-10-23: the marathon config document name (maratonConfig)
// for the precision engine's rule profile, the whole clear round over the
// phases a class drives (TR V 509.3, TR 532.4), a precision result needs a
// driven time, legacy stored obstacle penalties, the marathon input screens'
// rounding, no live place without a time, and phase 2 without course config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCompetitionState } from '../js/core-engine/stateSelector.js';
import { calculateTotalResult as coreTotal, classDrivenPhases } from '../js/core-engine/calculation.js';
import { combineClearRoundPhases } from '../js/core-engine/rules-ledger.js';
import { RESULT_ENGINE_VERSION } from '../js/core-engine/version.js';
import { precisionRankKey } from '../js/core-engine/ranking.js';
import {
  calculatePrecisionResult,
  computePrecisionRoundMaxSec,
  isLegacyPrecisionKnockDoc
} from '../js/utils/precisionCalculation.js';
import { buildArchiveRowsFromData } from '../js/services/archiveRowBuilder.js';
import { buildTdbSheet } from '../js/services/tdbSheetUtils.js';
import { pickEditedFields, findEditConflicts } from '../js/services/secretariatPatchUtils.js';
import { precisionHasResult, precisionFinalizeBlockers, precisionFinalizeWarnings } from '../js/services/finalizeCompletenessUtils.js';
import { setMarathonConfig, analyzeSectorProgress, stageSecondsForEquipage } from '../js/utils/marathonUtils.js';
import { calculateTotalResult as serverTotal } from '../functions/src/core-engine/calculation.js';
import { buildCompetitionState as serverState } from '../functions/src/core-engine/stateSelector.js';
import { calculatePrecisionResult as serverPrecision } from '../functions/src/utils/precisionCalculation.js';

const min = (m) => m * 60000;
const sec = (s) => s * 1000;
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('engine version is bumped for the 2026-10-23 rule fixes', () => {
  assert.ok(RESULT_ENGINE_VERSION >= '2026-10-23.1');
});

// --- 1. The marathon config is config/maratonConfig ---

test('no page or service reads the non-existent config/marathonConfig for the precision engine', () => {
  for (const file of [
    'js/services/secretariatService.js',
    'js/pages/precision/precision-input.js',
    'js/pages/marathon/maraton-stages-input.js'
  ]) {
    assert.doesNotMatch(source(file), /getConfig\(competitionId, 'marathonConfig'\)/, file);
  }
  assert.match(source('js/services/finalizationService.js'), /getCompDocRef\(competitionId, 'config', 'maratonConfig'\), notes\)\.catch/);
  // One helper with the legacy fallback
  const helper = source('js/services/competitionService.js');
  assert.match(helper, /export async function loadMarathonConfig/);
  assert.match(helper, /'maratonConfig'[\s\S]*'marathonConfig'/);
});

const FEI_CLASS = 'Int Enbet Häst';
const feiMarathon = { marathonClassData: { [FEI_CLASS]: { distanceB: 6000, tempoB: 240, ruleProfile: 'FEI' } } };
const twoPhase = { courses: { [FEI_CLASS]: { format: 'twoPhase', trackLengthMeters: 700, phase2: { trackLengthMeters: 700 } } } };
const feiEq = { startNumber: 1, className: FEI_CLASS };

test('FEI class (profile from the marathon class settings), two phases: max 168 s, phase 2 time-scored', () => {
  for (const calc of [calculatePrecisionResult, serverPrecision]) {
    const doc = { finalized: true, timeMs: 150000, knocks: [], rounds: { phase2: { timeMs: 60000, inProgress: false, knocks: ['1'] } } };
    // With the marathon config: FEI 975.10.5 single horse 250 m/min, 700 m = 168 s
    const fei = calc(doc, feiEq, twoPhase, { marathonConfig: feiMarathon });
    assert.equal(fei.ruleProfile, 'FEI');
    assert.equal(fei.maxTimeSec, 168);
    assert.equal(fei.rounds.phase2.maxTimeSec, 168);
    assert.equal(fei.rounds.phase2.scoring, 'time');
    // Time competition: 60 s + 3 s for the knocked ball (FEI 978)
    assert.equal(fei.rounds.phase2.score, 63);
    // Without it (the old 'marathonConfig' read gave nothing): TR, no tempo
    // for the name, no max time and a fault-scored phase 2
    const before = calc(doc, feiEq, twoPhase, {});
    assert.equal(before.ruleProfile, 'TR');
    assert.equal(before.maxTimeSec, null);
    assert.equal(before.rounds.phase2.scoring, 'fault');
  }
  assert.equal(computePrecisionRoundMaxSec(feiEq, twoPhase, 'phase2', { ruleProfile: 'FEI' }), 168);
});

// --- 2. Clear round over the phases the class drives ---

const crPrograms = { LA: { id: 'LA', name: 'Svenskt Latt A', movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }] } };
const crMarathon = { marathonClassData: { CR: { distanceB: 6000, tempoB: 300, clearRound: true } }, obstacleNumbers: [1] };
const crPrecision = { maxTimeByClass: { CR: 100 } };
const protocol = (judgeId) => ({ judgeId, movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 7 }] });

// Dressage 70 % = 6 p, marathon 0 p (obstacle time free), precision as given
function crTotal(build, total, { precision = { finalized: true, timeMs: 90000, knocks: [] }, judges = { C: 'c' }, protocols = [protocol('c')], timing = { B: { durationMs: min(19) } }, precisionConfig = crPrecision } = {}) {
  return total(build(
    { startNumber: 1, className: 'CR', category: 'horse', testKey: 'LA' },
    protocols,
    { obstacles: [{ number: 1, timeSeconds: 40 }] },
    timing,
    precision,
    { allPrograms: crPrograms, dressageJudgeMapping: { CR: judges }, marathonConfig: crMarathon, precisionConfig }
  ));
}

test('clear round D=6 M=0: approved only when every driven phase is finished and meets its criterion', () => {
  for (const [build, total] of [[buildCompetitionState, coreTotal], [serverState, serverTotal]]) {
    const ok = crTotal(build, total);
    assert.equal(ok.dressage.penalty, 6);
    assert.equal(ok.marathon.totalPenalty, 0);
    assert.equal(ok.clearRoundApproved, true);

    // Precision not driven yet: undecided (before: true over D and M only)
    assert.equal(crTotal(build, total, { precision: null }).clearRoundApproved, null);
    // Precision finalized without a time ("Ej startat"): not started = struken (TR 532.4)
    assert.equal(crTotal(build, total, { precision: { finalized: true } }).clearRoundApproved, false);
    // No max time for precision: undecided
    const noMax = crTotal(build, total, { precisionConfig: { courses: { CR: {} } } });
    assert.equal(noMax.precision.configMissing, true);
    assert.equal(noMax.clearRoundApproved, null);
    // Retired in precision ("Utgått"): not approved (before: true, 0 p)
    assert.equal(crTotal(build, total, { precision: { finalized: true, retired: true, timeMs: 90000, knocks: [] } }).clearRoundApproved, false);
    // Dressage judged by 1 of 2 judges: undecided (before: true)
    assert.equal(crTotal(build, total, { judges: { C: 'c', E: 'e' } }).clearRoundApproved, null);
    // Marathon not finished (no B time): undecided (before: false)
    assert.equal(crTotal(build, total, { timing: {} }).clearRoundApproved, null);
    // A knocked ball: not approved
    assert.equal(crTotal(build, total, { precision: { finalized: true, timeMs: 90000, knocks: ['1'] } }).clearRoundApproved, false);
  }
});

test('combineClearRoundPhases: any false wins, then undecided, no driven phase is false', () => {
  assert.equal(combineClearRoundPhases([true, true, true]), true);
  assert.equal(combineClearRoundPhases([true, null, true]), null);
  assert.equal(combineClearRoundPhases([true, null, false]), false);
  assert.equal(combineClearRoundPhases([]), false);
});

test('classDrivenPhases: from the configs, an explicit list wins, nothing known is combined driving', () => {
  const configs = { dressageJudgeMapping: { CR: { C: 'c' } }, marathonConfig: crMarathon, precisionConfig: crPrecision };
  assert.deepEqual(classDrivenPhases('CR', configs), ['D', 'M', 'P']);
  assert.deepEqual(classDrivenPhases('CR', { marathonConfig: crMarathon }), ['M']);
  assert.deepEqual(classDrivenPhases('CR', { precisionConfig: { courses: { CR: { trackLengthMeters: 500 } } } }), ['P']);
  assert.deepEqual(classDrivenPhases('CR', { dressageProgramMapping: { mapping: { CR: 'LA' } } }), ['D']);
  assert.deepEqual(classDrivenPhases('Okänd', configs), ['D', 'M', 'P']);
  assert.deepEqual(classDrivenPhases('CR', { ...configs, drivenPhases: ['m', 'P'] }), ['M', 'P']);
  // A marathon-only clear round class: approved over M alone
  const mOnly = coreTotal(buildCompetitionState(
    { startNumber: 1, className: 'CR', category: 'horse' }, [], { obstacles: [{ number: 1, timeSeconds: 40 }] },
    { B: { durationMs: min(19) } }, null, { marathonConfig: crMarathon }
  ));
  assert.equal(mOnly.clearRoundApproved, true);
});

test('archive rows store null for an undecided clear round', () => {
  const equipages = [
    { startNumber: 10, className: 'CR', category: 'horse', testKey: 'LA' },
    { startNumber: 11, className: 'CR', category: 'horse', testKey: 'LA' }
  ];
  setMarathonConfig(crMarathon);
  const rows = buildArchiveRowsFromData({
    equipages,
    dressageProtocols: new Map(equipages.map(e => [String(e.startNumber), [protocol('c')]])),
    marathonTimingMap: new Map(equipages.map(e => [String(e.startNumber), { B: { durationMs: min(19) } }])),
    marathonObstacleRows: equipages.map(e => ({ equipageId: String(e.startNumber), obstacleNumber: 1, timeSeconds: 40 })),
    // #11 has not driven precision yet
    precisionRows: [{ startNumber: 10, finalized: true, timeMs: 90000, knocks: [] }],
    marathonConfig: crMarathon,
    precisionConfig: crPrecision,
    dressageJudgeMapping: { CR: { C: 'c' } },
    dressyrClassConfig: {},
    allPrograms: crPrograms
  });
  const bySn = Object.fromEntries(rows.map(r => [r.startNumber, r]));
  assert.equal(bySn[10].clearRoundApproved, true);
  assert.equal(bySn[11].clearRoundApproved, null);
  setMarathonConfig(null);
});

function tdbRow(sn, d, m, p) {
  return {
    startNumber: sn, className: 'CR', driverName: `Kusk ${sn}`, tdbClassNumber: 1,
    dressage: { penalty: d }, marathon: { totalPenalty: m, isClearRound: true }, precision: { totalPenalty: p },
    isClearRound: true, totalPenalty: null, plac: ''
  };
}

test('TDB: the class\'s moments come from its config; not started in one is 99 (TR 532.4)', () => {
  const drivenPhasesOf = (row) => classDrivenPhases(row, { dressageJudgeMapping: { CR: { C: 'c' } }, marathonConfig: crMarathon, precisionConfig: crPrecision });
  // A single starter D=50 M=0 without precision: before 1 (P not in the
  // starters' results), now 99 not started
  const single = buildTdbSheet([tdbRow(1, 50, 0, null)], { drivenPhasesOf })[0];
  assert.deepEqual(single.entries.map(e => [e.placingCode, e.reason]), [[99, 'notStarted']]);
  assert.equal(buildTdbSheet([tdbRow(1, 50, 0, null)])[0].entries[0].placingCode, 1, 'without config: the starters\' moments');
  const list = buildTdbSheet([tdbRow(1, 50, 0, 0), tdbRow(2, 50, 0, 3), tdbRow(3, 50, 0, null)], { drivenPhasesOf })[0];
  assert.deepEqual(list.entries.map(e => [e.startNumber, e.placingCode, e.reason]), [
    [1, 1, 'clearRoundPassed'], [2, 98, 'clearRoundFailed'], [3, 99, 'notStarted']
  ]);
});

// --- 3. A precision result needs a driven time ---

const TR_CLASS = 'Lätt A Enbet Häst';
const trCourse = { courses: { [TR_CLASS]: { trackLengthMeters: 600, tempo: 230 } } };
const trEq = { startNumber: 1, className: TR_CLASS };

test('finalized precision without a time is no result: knocks, extra or a hand-set time penalty alone (before 3 / 5 / 2)', () => {
  for (const calc of [calculatePrecisionResult, serverPrecision]) {
    for (const doc of [{ knocks: ['1'] }, { extraPenalty: 5 }, { timePenaltyOverride: true, timePenalty: 2 }]) {
      const res = calc({ finalized: true, ...doc }, trEq, trCourse);
      assert.equal(res.totalPenalty, null);
      assert.equal(res.status, 'Ej startat');
      assert.equal(res.placing.tier, null);
    }
    const driven = calc({ finalized: true, timeMs: 150000, knocks: ['1'] }, trEq, trCourse);
    assert.equal(driven.totalPenalty, 3);
  }
  assert.equal(precisionHasResult(calculatePrecisionResult({ finalized: true, knocks: ['1'] }, trEq, trCourse)), false);
  assert.equal(precisionHasResult(calculatePrecisionResult({ finalized: true, retired: true }, trEq, trCourse)), true);
  // finalizePrecision refuses a doc without a result
  assert.match(source('js/services/finalizationService.js'), /await assertPrecisionHasResult\(ref, competitionId, startNumber\)/);
});

// --- 4. Legacy docs: empty list with a stored penalty ---

test('legacy doc: an empty knock list with a stored obstacle penalty and no marker keeps it (before 0)', () => {
  const legacy = { finalized: true, timeMs: 150000, knocks: [], obstaclePenalty: 6 };
  assert.equal(isLegacyPrecisionKnockDoc(legacy), true);
  for (const calc of [calculatePrecisionResult, serverPrecision]) {
    assert.equal(calc(legacy, trEq, trCourse).totalPenalty, 6);
    // Written by a knock-list write since 2026-10-23: the list is the source
    assert.equal(calc({ ...legacy, knocksVersion: 2 }, trEq, trCourse).totalPenalty, 0);
    assert.equal(calc({ ...legacy, knocks: ['3'] }, trEq, trCourse).totalPenalty, 3);
  }
  assert.equal(isLegacyPrecisionKnockDoc({ knocks: [], obstaclePenalty: 0 }), false);
  assert.equal(isLegacyPrecisionKnockDoc({ knocks: [], obstaclePenalty: 6, penaltyFromKnocks: true }), false);
});

test('secretariat: an empty list typed for a legacy row (base null) is an edit; knock lists compare as sorted labels', () => {
  const defaults = { knocks: [], timeMs: 0 };
  // Legacy row loaded with knocks null: an empty list removes the stored penalty
  assert.deepEqual(pickEditedFields({ knocks: [] }, { knocks: null }, ['knocks'], defaults), { knocks: [] });
  // Untouched (null) stays unedited
  assert.deepEqual(pickEditedFields({ knocks: null, timeMs: 5 }, { knocks: null, timeMs: 5 }, ['knocks', 'timeMs'], defaults), {});
  // Before, Number(['3']) === Number(['3']) and Number([]) === Number([]) hid list edits
  assert.deepEqual(pickEditedFields({ knocks: ['3'] }, { knocks: ['4'] }, ['knocks'], defaults), { knocks: ['3'] });
  assert.deepEqual(pickEditedFields({ knocks: ['4', '3'] }, { knocks: ['3', '4'] }, ['knocks'], defaults), {});
  assert.deepEqual(findEditConflicts({ knocks: [] }, { knocks: null }, { knocks: ['1'] }, defaults), ['knocks']);
  assert.deepEqual(findEditConflicts({ knocks: [] }, { knocks: null }, { knocks: null }, defaults), []);
});

// --- 5. Marathon input screens round as the engine ---

test('marathon section status and seconds outside the window use the engine\'s rounding', () => {
  setMarathonConfig({ marathonClassData: { [TR_CLASS]: { distanceB: 6000, tempoB: 240 } }, obstacleNumbers: [1] });
  const eq = { startNumber: 1, className: TR_CLASS };
  // B: min 1320 s. 1319.5 s gives 0 p in the engine (rounded up in the
  // driver's favour); the screen said "FÖR SNABB" before
  assert.equal(stageSecondsForEquipage(sec(1319.5), eq, 'min'), 1320);
  assert.equal(analyzeSectorProgress({ B: { durationMs: sec(1319.5) } }, 'B', eq).status, 'ok');
  assert.equal(analyzeSectorProgress({ B: { durationMs: sec(1318.9) } }, 'B', eq).status, 'fast');
  // Max 1500 s: 1500.9 s is cut down to 1500 (0 p)
  assert.equal(analyzeSectorProgress({ B: { durationMs: sec(1500.9) } }, 'B', eq).status, 'ok');
  assert.equal(analyzeSectorProgress({ B: { durationMs: sec(1501) } }, 'B', eq).status, 'slow');
  setMarathonConfig(null);
  assert.match(source('js/pages/marathon/maraton-stages-input.js'), /stageSecondsForEquipage\(effectiveMs, eq, 'min'\)/);
});

// --- 6. No live place without a time or a running clock ---

test('a not-started driver gets no live precision place, a running one does', () => {
  const notStarted = calculatePrecisionResult({ knocks: ['1'] }, trEq, trCourse);
  assert.equal(notStarted.placing.tier, null);
  assert.equal(precisionRankKey(notStarted, { requireFinished: false }), null);
  const stored = calculatePrecisionResult({ totalPenalty: 0, status: 'Klar' }, trEq, trCourse);
  assert.equal(precisionRankKey(stored, { requireFinished: false }), null);
  const running = calculatePrecisionResult({ running: true, liveTimeMs: 30000, knocks: ['1'] }, trEq, trCourse);
  assert.notEqual(precisionRankKey(running, { requireFinished: false }), null);
});

// --- 7. Phase 2 without course config: a warning, totals unaffected ---

test('phase 2 without course config does not block finalizing; the total counts phase 1', () => {
  const noPhase2 = { courses: { [TR_CLASS]: { format: 'twoPhase', trackLengthMeters: 600, tempo: 230 } } };
  const doc = { finalized: true, timeMs: 150000, knocks: [], rounds: { phase2: { timeMs: 70000, inProgress: false, knocks: [] } } };
  const res = calculatePrecisionResult(doc, trEq, noPhase2);
  assert.deepEqual(precisionFinalizeBlockers(res), []);
  assert.equal(precisionFinalizeWarnings(res).length, 1);
  assert.equal(res.placing.provisional, true);
  assert.equal(res.totalPenalty, 0);
  // Dressage / marathon finalizing does not look at precision at all
  const fin = source('js/services/finalizationService.js');
  const dressageFn = fin.slice(fin.indexOf('export async function finalizeDressage'), fin.indexOf('export async function unfinalizeDressage'));
  const marathonFn = fin.slice(fin.indexOf('export async function finalizeMarathon'), fin.indexOf('export async function unfinalizeMarathon'));
  assert.doesNotMatch(dressageFn + marathonFn, /precision/i);
});
