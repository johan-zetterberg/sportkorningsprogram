import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignPlaces,
  compareDressageRank,
  compareMarathonRank,
  comparePrecisionRank,
  compareTotalRank,
  marathonRankKey,
  precisionRankKey,
  totalRankKey
} from '../js/core-engine/ranking.js';
import { calculateMarathonPlacements } from '../js/utils/marathonUtils.js';
import { buildMarathonPlacementsByClass } from '../js/pages/marathon/marathonResultRanking.js';
import { buildArchiveRowsFromData } from '../js/services/archiveRowBuilder.js';

const places = (rows) => rows.map(r => r.plac);

test('assignPlaces shares places on ties and skips the next place (1, 2, 2, 4)', () => {
  const rows = [
    { startNumber: 1, p: 10 },
    { startNumber: 2, p: 12 },
    { startNumber: 3, p: 12 },
    { startNumber: 4, p: 15 },
    { startNumber: 5, p: null }
  ];
  const { ranked } = assignPlaces(rows, {
    key: r => (r.p == null ? null : { penalty: r.p }),
    compare: compareDressageRank
  });

  assert.deepEqual(places(rows), [1, 2, 2, 4, null]);
  assert.deepEqual(ranked.map(r => r.startNumber), [1, 2, 3, 4]);
});

test('assignPlaces ranks each group separately', () => {
  const rows = [
    { startNumber: 1, cls: 'A', p: 5 },
    { startNumber: 2, cls: 'B', p: 1 },
    { startNumber: 3, cls: 'A', p: 3 }
  ];
  assignPlaces(rows, { key: r => ({ penalty: r.p }), compare: compareDressageRank, group: r => r.cls });
  assert.deepEqual(places(rows), [2, 1, 1]);
});

test('marathon: equal total is decided by B-section penalty (TR 527.1)', () => {
  const res = (total, b) => ({ status: 'Klar', totalPenalty: total, stages: { B: { timePenalty: b } } });
  const rows = [
    { startNumber: 1, r: res(40, 6) },
    { startNumber: 2, r: res(40, 2) },
    { startNumber: 3, r: res(39, 9) }
  ];
  assignPlaces(rows, { key: x => marathonRankKey(x.r), compare: compareMarathonRank });
  assert.deepEqual(places(rows), [3, 2, 1]);
});

test('marathon: equal total and B-section share the place (no obstacle tie-breaks)', () => {
  const rows = [
    { startNumber: 1, r: { status: 'Klar', totalPenalty: 40, stages: { B: { timePenalty: 2 } }, obstaclePenaltySum: 30, obstacleTimes: [50] } },
    { startNumber: 2, r: { status: 'Klar', totalPenalty: 40, stages: { B: { timePenalty: 2 } }, obstaclePenaltySum: 20, obstacleTimes: [40] } }
  ];
  assignPlaces(rows, { key: x => marathonRankKey(x.r), compare: compareMarathonRank });
  assert.deepEqual(places(rows), [1, 1]);
});

test('marathon: clear round, eliminated and unfinished rows are not placed', () => {
  assert.equal(marathonRankKey({ status: 'Klar', totalPenalty: 0, isClearRound: true }), null);
  assert.equal(marathonRankKey({ status: 'Eliminerad', totalPenalty: Infinity, eliminated: true }), null);
  assert.equal(marathonRankKey({ status: 'Pågår', totalPenalty: 12 }), null);
  assert.deepEqual(marathonRankKey({ status: 'Pågår', totalPenalty: 12 }, { requireFinished: false }), { penalty: 12, bPenalty: 0 });
});

test('marathon: the results page and the PDF/report placings agree', () => {
  const results = {
    1: { status: 'Klar', totalPenalty: 40, stages: { B: { timePenalty: 6 } } },
    2: { status: 'Klar', totalPenalty: 40, stages: { B: { timePenalty: 2 } } },
    3: { status: 'Klar', totalPenalty: 45, stages: { B: { timePenalty: 0 } } }
  };
  const equipages = [1, 2, 3].map(sn => ({ startNumber: sn, className: 'Msv' }));

  const pageMap = buildMarathonPlacementsByClass({
    equipages,
    marathonMap: new Map(),
    timingDocFor: () => ({}),
    calculateResult: eq => results[eq.startNumber]
  });
  const pdfMap = calculateMarathonPlacements(equipages.map(eq => ({ ...eq, results: { marathon: results[eq.startNumber] } })));

  assert.deepEqual([...pageMap.entries()].sort(), [['1', 2], ['2', 1], ['3', 3]]);
  assert.deepEqual([...pdfMap.entries()].sort(), [...pageMap.entries()].sort());
});

test('precision: equal penalty is decided by fastest time, equal time shares', () => {
  const rows = [
    { startNumber: 1, r: { totalPenalty: 0, timeMs: 125400 } },
    { startNumber: 2, r: { totalPenalty: 0, timeMs: 118200 } },
    { startNumber: 3, r: { totalPenalty: 0, timeMs: 118200 } },
    { startNumber: 4, r: { totalPenalty: 3, timeMs: 100000 } },
    { startNumber: 5, r: { totalPenalty: 0, timeMs: 90000, eliminated: true } }
  ];
  assignPlaces(rows, { key: x => precisionRankKey(x.r), compare: comparePrecisionRank });
  assert.deepEqual(places(rows), [3, 1, 1, 4, null]);
});

test('total: total, then marathon, then dressage, then shared (TR 533.3)', () => {
  const row = (sn, total, mar, dr) => ({ startNumber: sn, k: totalRankKey({ totalPenalty: total, marathonPenalty: mar, dressagePenalty: dr }) });
  const rows = [
    row(1, 138, 85, 50),
    row(2, 138, 80, 55),
    row(3, 138, 80, 54),
    row(4, 138, 80, 54),
    row(5, 120, 70, 45)
  ];
  assignPlaces(rows, { key: x => x.k, compare: compareTotalRank });
  assert.deepEqual(places(rows), [5, 4, 2, 2, 1]);
  assert.equal(totalRankKey({ totalPenalty: 100, isEliminated: true }), null);
});

test('archive placings use the total tie-break, shared places and the passed marathon config', () => {
  const allPrograms = { LA: { id: 'LA', name: 'Svenskt Latt A', movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }] } };
  const marathonConfig = { marathonClassData: { KlassA: { distanceA: 5000, tempoA: 250, distanceB: 6000, tempoB: 300 } } };
  const equipages = [60, 61, 62].map(sn => ({ startNumber: sn, className: 'KlassA', category: 'horse', testKey: 'LA' }));
  const scores = { 60: [8, 8], 61: [7, 7], 62: [7, 7] };
  const dressageProtocols = new Map(equipages.map(eq => [String(eq.startNumber), [
    { judgeId: 'c', movements: scores[eq.startNumber].map((score, i) => ({ momentNo: i + 1, score })) }
  ]]));
  const marathonTimingMap = new Map([
    // 20 s over the A ideal time -> 5 penalties (only with the passed config)
    ['60', { A: { durationMs: 1220000 }, B: { durationMs: 1200000 } }],
    ['61', { A: { durationMs: 1200000 }, B: { durationMs: 1200000 } }],
    ['62', { A: { durationMs: 1200000 }, B: { durationMs: 1200000 } }]
  ]);
  const marathonObstacleRows = [
    { equipageId: '60', number: 1, timeSeconds: 20 },
    { equipageId: '61', number: 1, timeSeconds: 32 },
    { equipageId: '62', number: 1, timeSeconds: 32 }
  ];
  const precisionRows = equipages.map(eq => ({ startNumber: eq.startNumber, finalized: true, timeMs: 90000, knocks: [] }));

  const rows = buildArchiveRowsFromData({
    equipages, dressageProtocols, marathonTimingMap, marathonObstacleRows, precisionRows,
    marathonConfig, precisionConfig: { maxTimeByClass: { KlassA: 100 } }, allPrograms
  });
  const bySn = Object.fromEntries(rows.map(r => [r.startNumber, r]));

  // all total 14: #60 = 4 + 10 + 0, #61/#62 = 6 + 8 + 0 -> lower marathon wins
  assert.equal(bySn[60].marathon.totalPenalty, 10);
  assert.deepEqual([bySn[60].totalPenalty, bySn[61].totalPenalty, bySn[62].totalPenalty], [14, 14, 14]);
  assert.deepEqual([bySn[61].plac, bySn[62].plac, bySn[60].plac], [1, 1, 3]);
  assert.deepEqual(rows.map(r => r.startNumber), [61, 62, 60]);
});
