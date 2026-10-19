import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDressageResult,
  defaultDressagePenaltyCoeff,
  dressagePenaltyFromPoints,
  getDressagePenaltyCoeff,
  getProgramMaxScore,
  getUnscoredMovementNumbers,
  isProtocolComplete,
  resolveDressageErrorPoints
} from '../js/core-engine/dressage.js';
import { buildCompetitionState } from '../js/core-engine/stateSelector.js';
import { dressagePrograms } from '../js/data/dressagePrograms.js';
import { normalizeSavedScore, plainDressageProtocolsFromDocs } from '../js/services/dressageProtocolDocs.js';
import {
  deriveDressageStatusState,
  expectedDressagePositions,
  isLiveDocStale,
  judgeStatusKey,
  liveDocIdFor,
  timestampToMs
} from '../js/services/dressageStatusUtils.js';

const program = {
  name: 'Testprogram',
  movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }, { no: 3, coeff: 2 }]
};

function dressageResult(equipage, protocols, config = {}) {
  const state = buildCompetitionState(equipage, protocols, null, null, null, {
    allPrograms: { P: program },
    dressageJudgeMapping: { K: { C: 'c', E: 'e' } },
    ...config
  });
  return calculateDressageResult(state);
}

// --- Error points (TR 518.9 / FEI 958.1.4: only C) ---

test('error points come from the general doc and the equipage, not from a judge protocol', () => {
  const judgeE = { id: 'judge_e', judgeId: 'e', position: 'E', errorPoints: 10, movements: [] };
  assert.equal(resolveDressageErrorPoints({}, [judgeE]), 0);
  assert.equal(resolveDressageErrorPoints({}, [judgeE, { id: 'general', errorPoints: 5 }]), 5);
  assert.equal(resolveDressageErrorPoints({ errorPoints: 7 }, [{ id: 'general', errorPoints: 5 }]), 7);
});

test('error points loaded through the loader reach the dressage total', () => {
  const protocols = plainDressageProtocolsFromDocs([
    { id: 'judge_c', data: { judgeId: 'c', judgePosition: 'C', testKey: 'P', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }, { momentNo: 3, score: 8 }] } },
    { id: 'judge_e', data: { judgeId: 'e', judgePosition: 'E', testKey: 'P', errorPoints: 10, movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }, { momentNo: 3, score: 8 }] } },
    { id: 'general', data: { errorPoints: 5, errorComment: '1:a fel' } }
  ], '7');

  const general = protocols.find(p => p.id === 'general');
  assert.equal(general.errorPoints, 5);
  assert.equal(general.judgeId, '');
  assert.deepEqual(general.movements, []);

  const result = dressageResult({ startNumber: 7, className: 'K', testKey: 'P' }, protocols);
  // 32 of 40 points, TR: (40 - 32) x 1 = 8, plus 5 error points from C
  assert.equal(result.judgePenalty, 8);
  assert.equal(result.errorPoints, 5);
  assert.equal(result.penalty, 13);
  assert.equal(result.judgeCount, 2);
});

// --- Empty movements are null, not 0 ---

test('normalizeSavedScore keeps an empty movement null', () => {
  assert.equal(normalizeSavedScore(''), null);
  assert.equal(normalizeSavedScore('  '), null);
  assert.equal(normalizeSavedScore(null), null);
  assert.equal(normalizeSavedScore(undefined), null);
  assert.equal(normalizeSavedScore('abc'), null);
  assert.equal(normalizeSavedScore('7,5'), 7.5);
  assert.equal(normalizeSavedScore(0), 0);
  assert.equal(normalizeSavedScore('0'), 0);
});

test('a protocol with a null movement is not complete and lists the missing movement', () => {
  const partial = { movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: null }, { momentNo: 3, score: 0 }] };
  assert.equal(isProtocolComplete(partial, program), false);
  assert.deepEqual(getUnscoredMovementNumbers(partial, program), [2]);

  const full = { movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 6 }, { momentNo: 3, score: 0 }] };
  assert.equal(isProtocolComplete(full, program), true);
  assert.deepEqual(getUnscoredMovementNumbers(full, program), []);
});

test('a partly saved protocol leaves the judge position missing', () => {
  const protocols = [
    { id: 'judge_c', judgeId: 'c', position: 'C', testKey: 'P', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }, { momentNo: 3, score: 8 }] },
    { id: 'judge_e', judgeId: 'e', position: 'E', testKey: 'P', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: null }, { momentNo: 3, score: 8 }] }
  ];
  const result = dressageResult({ startNumber: 8, className: 'K', testKey: 'P' }, protocols);
  assert.deepEqual(result.missingJudgePositions, ['E']);
  assert.equal(result.judgesComplete, false);
});

// --- Finished = every expected position done ---

test('finished is derived from every judge position, not from the last writer', () => {
  // E saved last with "ongoing", C had finished: still not all done
  assert.equal(deriveDressageStatusState({ state: 'ongoing', judgesDone: { C: true }, expectedPositions: ['C', 'E'] }).state, 'ongoing');
  // The last writer wrote "ongoing" although everyone is done
  assert.equal(deriveDressageStatusState({ state: 'ongoing', judgesDone: { C: true, E: true }, expectedPositions: ['C', 'E'] }).state, 'finished');
  // The last writer wrote "finished" although E saved a partial protocol
  assert.equal(deriveDressageStatusState({ state: 'finished', judgesDone: { C: true, E: false }, expectedPositions: ['C', 'E'] }).state, 'ongoing');
  // Older documents and other states are left alone
  assert.equal(deriveDressageStatusState({ state: 'finished' }).state, 'finished');
  assert.equal(deriveDressageStatusState({ state: 'withdrawn', judgesDone: { C: true }, expectedPositions: ['C'] }).state, 'withdrawn');
  // Without expected positions the judges that saved decide
  assert.equal(deriveDressageStatusState({ judgesDone: { C: true } }).state, 'finished');
  assert.equal(deriveDressageStatusState(null), null);
});

test('expected positions come from the class mapping, else from the judges', () => {
  const mapping = { '1. Lätt B': { C: 'c', E: 'e', B: '' } };
  assert.deepEqual(expectedDressagePositions('1. Lätt B', mapping, ['C', 'E', 'B', 'H']), ['C', 'E']);
  assert.deepEqual(expectedDressagePositions('1.lätt b', { mapping }, []), ['C', 'E']);
  assert.deepEqual(expectedDressagePositions('Okänd', mapping, ['c', 'E', '', 'E']), ['C', 'E']);
});

test('each judge has its own status key and live document', () => {
  assert.equal(judgeStatusKey('c', 'x1'), 'C');
  assert.equal(judgeStatusKey('', 'x/1'), 'ID_x_1');
  assert.equal(liveDocIdFor('E', 'x'), 'E');
  assert.equal(liveDocIdFor('', ''), 'data');
});

test('live staleness compares server time with the server stamp', () => {
  const now = 1_000_000_000;
  assert.equal(isLiveDocStale({ updatedAtMs: now - 60_000 }, now), false);
  assert.equal(isLiveDocStale({ updatedAtMs: now - 121_000 }, now), true);
  assert.equal(isLiveDocStale({ updatedAt: { toMillis: () => now - 1000 } }, now), false);
  assert.equal(isLiveDocStale({ updatedAt: new Date(now - 200_000).toISOString() }, now), true);
  assert.equal(isLiveDocStale({}, now), false);
  assert.equal(timestampToMs({ seconds: 10, nanoseconds: 5e6 }), 10_005);
});

test('a live document read with a server timestamp gets updatedAtMs and an ISO updatedAt', () => {
  const [plain] = plainDressageProtocolsFromDocs([
    { id: 'C', data: { state: 'ongoing', protocol: { judgeId: 'c', judgePosition: 'C', movements: [] }, updatedAt: { toMillis: () => 1_700_000_000_000 } } }
  ], '3');
  assert.equal(plain.updatedAtMs, 1_700_000_000_000);
  assert.equal(plain.updatedAt, new Date(1_700_000_000_000).toISOString());
  assert.equal(plain.judgeId, 'c');
});

// --- Coefficient for programs that name none ---

test('a program without a coefficient gets 160 / max points, never a guess from its name', () => {
  const movements = (n) => Array.from({ length: n }, (_, i) => ({ no: i + 1, coeff: 1 }));
  // "Alla" used to match /la/ (Lätt A) and get 1.0 for a 200-point program
  const alla = { name: 'Svenska Alla klasser', category: 'Svenskt', movements: movements(20) };
  assert.equal(getDressagePenaltyCoeff(alla, {}), 0.8);
  assert.equal(defaultDressagePenaltyCoeff({ movements: movements(16) }), 1);
  assert.equal(getDressagePenaltyCoeff({ name: 'Eget program', movements: movements(14) }, {}), 1);
  // An explicit coefficient still wins
  assert.equal(getDressagePenaltyCoeff({ ...alla, penaltyCoeff: '0,76' }, {}), 0.76);
  // TR penalty of a custom program stays within 0–160
  assert.equal(dressagePenaltyFromPoints(0, { name: 'Eget', scoring: 'tr', movements: movements(28) }, {}), 160);
});

test('no built-in program gives a penalty above 160', () => {
  for (const [key, p] of Object.entries(dressagePrograms)) {
    const worst = dressagePenaltyFromPoints(0, p, dressagePrograms);
    assert.ok(worst <= 160 + 1e-9, `${key}: penalty for 0 points is ${worst}`);
    const best = dressagePenaltyFromPoints(getProgramMaxScore(p), p, dressagePrograms);
    assert.ok(best >= 0, `${key}: penalty for full marks is ${best}`);
  }
});
