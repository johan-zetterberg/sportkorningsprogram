import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlaceMap, buildOverallStandingPerGroup } from '../js/utils/precisionUtils.js';
import { competingPrecisionEquipages, filterPrecisionEquipages } from '../js/pages/precision/precisionResultFilters.js';
import { buildArchiveRowsFromData } from '../js/services/archiveRowBuilder.js';
import { findIncompleteArchiveRows } from '../js/services/archivingUtils.js';
import { isWithdrawnEquipage } from '../js/utils/sharedUtils.js';
import { formatTotalDisciplinePdfPenalty, formatTotalPdfPenalty, isWithdrawnStatus } from '../js/pdf/resultPdfFormatUtils.js';
import { rankDressageRowsForReportPdf } from '../js/pages/shared/reportsExportUtils.js';
import { getSpeakerDisciplineState } from '../js/pages/shared/speakerResults.js';
import { getTotalRanking, rankSpeakerResultRows } from '../js/pages/shared/speakerCalculations.js';

// --- 1. Precision results: places over the whole field, not the filtered list ---

const precisionConfig = { maxTimeByClass: { 'Lätt B': 130, 'Lätt A': 130 }, knockdownPenalty: 3 };

const precisionEquipages = [
  { startNumber: 1, className: 'Lätt B', driverName: 'Anna Ek' },
  { startNumber: 2, className: 'Lätt B', driverName: 'Bo Ek' },
  { startNumber: 3, className: 'Lätt B', driverName: 'Cia Lind' },
  { startNumber: 4, className: 'Lätt B', driverName: 'Dan Lind', status: 'struken' },
  { startNumber: 5, className: 'Lätt A', driverName: 'Eva Berg' }
];

const precisionMap = new Map([
  ['1', { finalized: true, timeMs: 110000, knocks: [] }],
  ['2', { finalized: true, timeMs: 100000, knocks: [] }],
  ['3', { finalized: true, timeMs: 120000, knocks: [2] }],
  // A withdrawn equipage with a stored round: it must not take a place
  ['4', { finalized: true, timeMs: 90000, knocks: [] }],
  ['5', { finalized: true, timeMs: 115000, knocks: [] }]
]);

test('precision: places are set over the competing field, a search only filters the rows', () => {
  const field = competingPrecisionEquipages(precisionEquipages);
  assert.deepEqual(field.map(e => e.startNumber), [1, 2, 3, 5], 'withdrawn #4 is not in the field');

  const placeMap = buildPlaceMap(field, precisionMap, precisionConfig);
  assert.deepEqual(['1', '2', '3', '4', '5'].map(sn => placeMap.get(sn) ?? null), [2, 1, 3, null, 1]);

  // Searching "Lind" shows #3 only (withdrawn #4 is filtered out): still 3rd,
  // not 1st as when the places were set on the filtered list
  const visible = filterPrecisionEquipages(precisionEquipages, { searchText: 'Lind' });
  assert.deepEqual(visible.map(e => e.startNumber), [3]);
  assert.equal(placeMap.get('3'), 3);
  assert.equal(buildPlaceMap(visible, precisionMap, precisionConfig).get('3'), 1, 'the old way gave 1st');

  // The class filter (Lätt A) does not move #5 either
  const classOnly = filterPrecisionEquipages(precisionEquipages, { activeClassFilters: new Set(['Lätt A']) });
  assert.deepEqual(classOnly.map(e => placeMap.get(String(e.startNumber))), [1]);
});

test('precision: a merged group is placed as one class over the whole field', () => {
  const merged = precisionEquipages.map(e => ({ ...e, _mergedKey: 'GROUP:AB', _mergedLabel: 'Lätt A+B' }));
  const placeMap = buildPlaceMap(competingPrecisionEquipages(merged), precisionMap, precisionConfig);
  // 2 (100 s), 1 (110 s), 5 (115 s), 3 (3 penalties)
  assert.deepEqual(['2', '1', '5', '3'].map(sn => placeMap.get(sn)), [1, 2, 3, 4]);
});

test('precision: the overall standing is placed per class/merged group', () => {
  const entry = (startNumber, className, dressagePenalty, mergedKey) => ({
    eq: { startNumber, className, ...(mergedKey ? { _mergedKey: mergedKey } : {}) },
    dressagePenalty,
    marathonPenalty: 10,
    isElim: false
  });
  const standingOf = (list) => {
    const results = [...list].sort((a, b) => a.dressagePenalty - b.dressagePenalty)
      .map(e => ({ sn: String(e.eq.startNumber), total: e.dressagePenalty }));
    return { results, map: new Map(results.map((r, i) => [r.sn, { ...r, rank: i + 1 }])) };
  };
  const { map } = buildOverallStandingPerGroup([
    entry(1, 'Lätt B', 50),
    entry(2, 'Lätt B', 40),
    entry(5, 'Lätt A', 60),
    entry(7, 'Lätt C', 70, 'GROUP:AC'),
    entry(8, 'Lätt A', 30, 'GROUP:AC')
  ], standingOf);
  assert.deepEqual(['1', '2', '5', '7', '8'].map(sn => map.get(sn).rank), [2, 1, 1, 2, 1]);
});

// --- 2. Withdrawn: no place, shown as withdrawn (not eliminated) ---

test('isWithdrawnEquipage: struken/withdrawn/scratched status or flag, not eliminated', () => {
  assert.equal(isWithdrawnEquipage({ status: 'struken' }), true);
  assert.equal(isWithdrawnEquipage({ status: 'Struken' }), true);
  assert.equal(isWithdrawnEquipage({ status: 'withdrawn' }), true);
  assert.equal(isWithdrawnEquipage({ status: 'scratched' }), true);
  assert.equal(isWithdrawnEquipage({ struken: true }), true);
  assert.equal(isWithdrawnEquipage({ status: 'eliminated' }), false);
  assert.equal(isWithdrawnEquipage({ status: 'anmäld' }), false);
  assert.equal(isWithdrawnEquipage(null), false);
  assert.equal(isWithdrawnStatus('scratched'), true);
});

test('dressage report PDF: a withdrawn row gets no place and does not move the others', () => {
  const rows = [
    { startNumber: 1, className: 'Lätt A', finalPenalty: 40 },
    { startNumber: 2, className: 'Lätt A', finalPenalty: 30, status: 'struken' },
    { startNumber: 3, className: 'Lätt A', finalPenalty: 50 },
    { startNumber: 4, className: 'CR', finalPenalty: 20, marathon: { isClearRound: true } }
  ];
  const ranked = rankDressageRowsForReportPdf(rows);
  assert.deepEqual(ranked.map(r => r.plac), [1, null, 2, null]);
  assert.equal(rows[0].plac, undefined, 'the input rows are not changed');
});

test('total PDF cells: a withdrawn archive row reads STR, not ELIM', () => {
  const row = { isWithdrawn: true, isEliminated: true, totalPenalty: null, dressage: { penalty: 40 } };
  assert.equal(formatTotalPdfPenalty(row), 'STR');
  assert.equal(formatTotalDisciplinePdfPenalty(row, 'dressage'), 'STR');
});

test('speaker: a withdrawn equipage is withdrawn, not eliminated', () => {
  const ctx = {
    activeEquipages: new Map(),
    allEquipages: [],
    dressageStatusMap: new Map([['7', { state: 'finished', finalPenalty: 35 }]]),
    maratonStatusMap: new Map(),
    precisionStatusMap: new Map(),
    precisionConfig: {},
    startTimes: {}
  };
  const withdrawn = { startNumber: 7, className: 'Lätt A', status: 'struken' };
  const state = getSpeakerDisciplineState(withdrawn, 'dressyr', ctx);
  assert.equal(state.eliminated, false);
  assert.equal(state.withdrawn, true);
  for (const discipline of ['maraton', 'precision', 'totalt']) {
    assert.equal(getSpeakerDisciplineState(withdrawn, discipline, ctx).eliminated, false, discipline);
  }
  // A real elimination still counts
  assert.equal(getSpeakerDisciplineState({ startNumber: 8, status: 'eliminated' }, 'totalt', ctx).eliminated, true);
});

test('speaker standings: withdrawn rows read Struken, have no place and come last', () => {
  const rows = [
    { startNumber: 1, totalPenalty: 50, isEliminated: false, isWithdrawn: true, dressage: { penalty: 20 }, marathon: { totalPenalty: 30 }, precision: { pen: null } },
    { startNumber: 2, totalPenalty: null, total: Infinity, isEliminated: true, dressage: { penalty: 25, eliminated: false }, marathon: {}, precision: {} },
    { startNumber: 3, totalPenalty: 60, isEliminated: false, dressage: { penalty: 30 }, marathon: { totalPenalty: 30 }, precision: { pen: null } }
  ];
  rankSpeakerResultRows(rows);
  assert.deepEqual(rows.map(r => [r.startNumber, r.plac]), [[3, 1], [2, 'ELIM'], [1, 'Struken']]);
  assert.equal(rows.find(r => r.startNumber === 1).posDress, null);
  assert.equal(rows.find(r => r.startNumber === 1).diffFromLeader, null);
});

test('speaker total ranking: a withdrawn equipage with a dressage result is not ELIM and not placed', () => {
  const allEquipages = [
    { startNumber: 1, className: 'Lätt A', driverName: 'A' },
    { startNumber: 2, className: 'Lätt A', driverName: 'B', status: 'struken' }
  ];
  const ctx = {
    allEquipages,
    activeEquipages: new Map(),
    dressageStatusMap: new Map([
      ['1', { state: 'finished', finalPenalty: 40 }],
      ['2', { state: 'finished', finalPenalty: 30 }]
    ]),
    maratonStatusMap: new Map(),
    precisionStatusMap: new Map(),
    precisionConfig: {},
    startTimes: {},
    marathonConfig: {},
    dressyrClassConfig: {}
  };
  const rows = getTotalRanking('Lätt A', null, ctx);
  const bySn = Object.fromEntries(rows.map(r => [r.startNumber, r]));
  assert.equal(bySn[1].plac, 1);
  assert.equal(bySn[1].posDress, 1, 'the withdrawn 30 does not beat it');
  assert.equal(bySn[2].isEliminated, false);
  assert.equal(bySn[2].isWithdrawn, true);
  assert.equal(bySn[2].plac, 'Struken');
  assert.equal(bySn[2].total, null);
  assert.equal(bySn[2].posDress, null);
});

// --- 3. Archive: placed per merged class; no place for clear round or withdrawn ---

const allPrograms = { LA: { id: 'LA', name: 'Svenskt Latt A', movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }] } };
const classData = { distanceA: 5000, tempoA: 250, distanceT: 1000, tempoT: 200, distanceB: 6000, tempoB: 300, obstaclePenaltyRate: 0.25 };
const archiveMarathonConfig = {
  marathonClassData: { KlassA: classData, KlassB: classData, KlassCR: { ...classData, clearRound: true } },
  obstacleNumbers: [1]
};
const archivePrecisionConfig = { maxTimeByClass: { KlassA: 100, KlassB: 100, KlassCR: 100 }, knockdownPenalty: 3 };
const fullTiming = { A: { durationMs: 1200000 }, transport: { durationMs: 300000 }, B: { durationMs: 1200000 } };

// Equal marathon and precision: the dressage score decides
function archiveRows(equipages, scores, mergeSource) {
  return buildArchiveRowsFromData({
    equipages,
    dressageProtocols: new Map(equipages.map(e => [String(e.startNumber), [{
      judgeId: 'c',
      movements: [{ momentNo: 1, score: scores[e.startNumber] }, { momentNo: 2, score: scores[e.startNumber] }]
    }]])),
    marathonTimingMap: new Map(equipages.map(e => [String(e.startNumber), fullTiming])),
    marathonObstacleRows: equipages.map(e => ({ equipageId: String(e.startNumber), obstacleNumber: 1, timeSeconds: 20 })),
    precisionRows: equipages.map(e => ({ startNumber: e.startNumber, finalized: true, timeMs: 90000, knocks: [] })),
    marathonConfig: archiveMarathonConfig,
    precisionConfig: archivePrecisionConfig,
    dressageJudgeMapping: { KlassA: { C: 'c' }, KlassB: { C: 'c' }, KlassCR: { C: 'c' } },
    allPrograms,
    mergeSource
  });
}

const mergeEquipages = [
  { startNumber: 10, className: 'KlassA', tdbClassNumber: 101, category: 'horse', testKey: 'LA' },
  { startNumber: 11, className: 'KlassA', tdbClassNumber: 101, category: 'horse', testKey: 'LA' },
  { startNumber: 20, className: 'KlassB', tdbClassNumber: 102, category: 'horse', testKey: 'LA' },
  { startNumber: 21, className: 'KlassB', tdbClassNumber: 102, category: 'horse', testKey: 'LA' }
];
const mergeScores = { 10: 8, 11: 6, 20: 9, 21: 5 };
const places = (rows) => Object.fromEntries(rows.map(r => [r.startNumber, [r.plac, r.posDress, r.posMar, r.posPrec]]));

test('archive: without a merge every class is placed on its own', () => {
  const p = places(archiveRows(mergeEquipages, mergeScores, null));
  assert.deepEqual([p[10][0], p[11][0], p[20][0], p[21][0]], [1, 2, 1, 2]);
});

test('archive: a merged class (display config) is placed as one class, as on the live pages', () => {
  const mergeSource = { mergeByClassNumber: { grp1: { label: 'Klass A+B', members: [101, 102] } } };
  const rows = archiveRows(mergeEquipages, mergeScores, mergeSource);
  const p = places(rows);
  // Dressage 9 > 8 > 6 > 5: #20, #10, #11, #21
  assert.deepEqual([p[20][0], p[10][0], p[11][0], p[21][0]], [1, 2, 3, 4]);
  assert.deepEqual([p[20][1], p[10][1], p[11][1], p[21][1]], [1, 2, 3, 4], 'dressage places merged too');
  // Equal marathon and precision: shared first place in the merged class
  assert.deepEqual(rows.map(r => r.posMar), [1, 1, 1, 1]);
  assert.ok(rows.every(r => r._mergedKey === 'grp1' && r._mergedLabel === 'Klass A+B'));
  // The official PDF lists the merged class in place order
  assert.deepEqual(rows.map(r => r.startNumber), [20, 10, 11, 21]);
});

test('archive: legacy merge groups (tdbMergeGroups array) and useMergedTestForDisplay merge too', () => {
  const legacy = places(archiveRows(mergeEquipages, mergeScores, [[101, 102]]));
  assert.deepEqual([legacy[20][0], legacy[10][0], legacy[11][0], legacy[21][0]], [1, 2, 3, 4]);

  const perEquipage = mergeEquipages.map(e => ({ ...e, useMergedTestForDisplay: true, mergedTestKey: 'TEST:LA', mergedTestLabel: 'Lätt A (alla)' }));
  const fromEquipage = places(archiveRows(perEquipage, mergeScores, null));
  assert.deepEqual([fromEquipage[20][0], fromEquipage[10][0], fromEquipage[11][0], fromEquipage[21][0]], [1, 2, 3, 4]);
});

test('archive: a withdrawn equipage gets no place in the total or any phase and moves no one', () => {
  const equipages = mergeEquipages.slice(0, 2).concat([
    { startNumber: 12, className: 'KlassA', tdbClassNumber: 101, category: 'horse', testKey: 'LA', status: 'struken' }
  ]);
  // #12 has the best results but is withdrawn
  const rows = archiveRows(equipages, { 10: 8, 11: 6, 12: 10 }, null);
  const p = places(rows);
  assert.deepEqual(p[12], ['', null, null, null]);
  assert.deepEqual(p[10], [1, 1, 1, 1]);
  assert.deepEqual(p[11].slice(0, 2), [2, 2]);
  const row12 = rows.find(r => r.startNumber === 12);
  assert.equal(row12.isWithdrawn, true);
  assert.equal(formatTotalPdfPenalty(row12), 'STR');
  assert.equal(rows[rows.length - 1].startNumber, 12, 'withdrawn listed last');
  assert.deepEqual(findIncompleteArchiveRows(rows), [], 'a withdrawn row is not incomplete');
});

test('archive: a clear round class in a merge group gets no places; the rest of the group is placed', () => {
  const equipages = [
    { startNumber: 30, className: 'KlassA', tdbClassNumber: 101, category: 'horse', testKey: 'LA' },
    { startNumber: 31, className: 'KlassCR', tdbClassNumber: 103, category: 'horse', testKey: 'LA' },
    { startNumber: 32, className: 'KlassA', tdbClassNumber: 101, category: 'horse', testKey: 'LA' }
  ];
  const mergeSource = { mergeByClassNumber: { grp: { label: 'A+CR', members: [101, 103] } } };
  const p = places(archiveRows(equipages, { 30: 6, 31: 9, 32: 7 }, mergeSource));
  assert.deepEqual(p[31], ['', null, null, null]);
  assert.deepEqual([p[32][0], p[30][0]], [1, 2]);
});
