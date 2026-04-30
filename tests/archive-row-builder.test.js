import test from 'node:test';
import assert from 'node:assert/strict';

import { buildArchiveRowsFromData } from '../js/services/archiveRowBuilder.js';

const allPrograms = {
  LA: {
    id: 'LA',
    name: 'Svenskt Latt A',
    movements: [
      { no: 1, coeff: 1 },
      { no: 2, coeff: 1 }
    ]
  }
};

const marathonConfig = {
  marathonClassData: {
    KlassA: {
      distanceA: 5000,
      tempoA: 250,
      distanceT: 1000,
      tempoT: 200,
      distanceB: 6000,
      tempoB: 300,
      obstaclePenaltyRate: 0.25
    },
    KlassB: {
      distanceA: 5000,
      tempoA: 250,
      distanceT: 1000,
      tempoT: 200,
      distanceB: 6000,
      tempoB: 300,
      obstaclePenaltyRate: 0.25
    }
  }
};

const precisionConfig = {
  maxTimeByClass: {
    KlassA: 100,
    KlassB: 100
  },
  knockdownPenalty: 3,
  timePenaltyRate: 0.5
};

test('buildArchiveRowsFromData builds ranked rows from shared discipline data', () => {
  const equipages = [
    { startNumber: 10, className: 'KlassA', category: 'horse', errorPoints: 2, testKey: 'LA' },
    { startNumber: 11, className: 'KlassA', category: 'horse', errorPoints: 0, testKey: 'LA' },
    { startNumber: 21, className: 'KlassB', category: 'horse', errorPoints: 0, testKey: 'LA' }
  ];

  const dressageProtocols = new Map([
    ['10', [{ judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 7 }] }]],
    ['11', [{ judgeId: 'c', movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 7 }] }]],
    ['21', [{ judgeId: 'c', eliminated: true, movements: [{ momentNo: 1, score: 6 }, { momentNo: 2, score: 6 }] }]]
  ]);

  const marathonTimingMap = new Map([
    ['10', { A: { durationMs: 1200000 }, transport: { durationMs: 300000 }, B: { durationMs: 1200000 } }],
    ['11', { A: { durationMs: 1200000 }, transport: { durationMs: 300000 }, B: { durationMs: 1200000 } }],
    ['21', { A: { durationMs: 1200000 }, transport: { durationMs: 300000 }, B: { durationMs: 1200000 } }]
  ]);

  const marathonObstacleRows = [
    { equipageId: '10', obstacleNumber: 1, timeSeconds: 20, knockdownPenalty: 0, otherPenalty: 0 },
    { equipageId: '11', obstacleNumber: 1, timeSeconds: 24, knockdownPenalty: 0, otherPenalty: 0 },
    { equipageId: '21', obstacleNumber: 1, timeSeconds: 20, knockdownPenalty: 0, otherPenalty: 0, eliminated: true }
  ];

  const precisionRows = [
    { startNumber: 10, finalized: true, timeMs: 105000, knocks: [1, 2] },
    { startNumber: 11, finalized: true, timeMs: 100000, knocks: [1] },
    { startNumber: 21, finalized: true, timeMs: 101000, knocks: [] }
  ];

  const rows = buildArchiveRowsFromData({
    equipages,
    dressageProtocols,
    marathonTimingMap,
    marathonObstacleRows,
    precisionRows,
    marathonConfig,
    precisionConfig,
    allPrograms
  });

  assert.equal(rows.length, 3);

  assert.deepEqual(rows.map(row => row.startNumber), [11, 10, 21]);

  const row11 = rows.find(row => row.startNumber === 11);
  const row10 = rows.find(row => row.startNumber === 10);
  const row21 = rows.find(row => row.startNumber === 21);

  assert.equal(row11.plac, 1);
  assert.equal(row11.isEliminated, false);
  assert.equal(row11.precision.pen, 3);

  assert.equal(row10.plac, 2);
  assert.equal(row10.dressage.penalty, 7);
  assert.equal(row10.marathon.totalPenalty, 5);
  assert.equal(row10.precision.pen, 8.5);
  assert.equal(row10.totalPenalty, 20.5);
  assert.equal(row10.isEliminated, false);
  assert.ok(row10.totalPenalty > row11.totalPenalty);

  assert.equal(row21.className, 'KlassB');
  assert.equal(row21.plac, '');
  assert.equal(row21.isEliminated, true);
  assert.equal(row21.totalPenalty, null);
});

test('buildArchiveRowsFromData keeps incomplete rows after ranked rows and outside placements', () => {
  const equipages = [
    { startNumber: 30, className: 'KlassA', category: 'horse', errorPoints: 0, testKey: 'LA' },
    { startNumber: 31, className: 'KlassA', category: 'horse', errorPoints: 0, testKey: 'LA' },
    { startNumber: 32, className: 'KlassA', category: 'horse', errorPoints: 0, testKey: 'LA' }
  ];

  const dressageProtocols = new Map([
    ['30', [
      { judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] },
      { judgeId: 'e', movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 8 }] }
    ]],
    ['31', [{ judgeId: 'c', movements: [{ momentNo: 1, score: 7 }, { momentNo: 2, score: 7 }] }]],
    ['32', [{ judgeId: 'c', movements: [{ momentNo: 1, score: 8 }, { momentNo: 2, score: 8 }] }]]
  ]);

  const marathonTimingMap = new Map([
    ['30', { A: { durationMs: 1200000 }, transport: { durationMs: 300000 }, B: { durationMs: 1200000 } }],
    ['31', { A: { durationMs: 1200000 }, transport: { durationMs: 300000 }, B: { durationMs: 1200000 } }],
    ['32', { A: { durationMs: 1200000 }, transport: { durationMs: 300000 }, B: { durationMs: 1200000 } }]
  ]);

  const marathonObstacleRows = [
    { equipageId: '30', obstacleNumber: 1, timeSeconds: 20, knockdownPenalty: 0, otherPenalty: 0 },
    { equipageId: '31', obstacleNumber: 1, timeSeconds: 22, knockdownPenalty: 0, otherPenalty: 0 },
    { equipageId: '32', obstacleNumber: 1, timeSeconds: 20, knockdownPenalty: 0, otherPenalty: 0 }
  ];

  const precisionRows = [
    { startNumber: 30, finalized: true, timeMs: 100000, knocks: [] },
    { startNumber: 31, finalized: true, timeMs: 101000, knocks: [4] },
    { startNumber: 32, finalized: false, running: false, timeMs: 0, knocks: [] }
  ];

  const rows = buildArchiveRowsFromData({
    equipages,
    dressageProtocols,
    marathonTimingMap,
    marathonObstacleRows,
    precisionRows,
    marathonConfig,
    precisionConfig,
    allPrograms
  });

  assert.deepEqual(rows.map(row => row.startNumber), [30, 31, 32]);

  const row30 = rows.find(row => row.startNumber === 30);
  const row31 = rows.find(row => row.startNumber === 31);
  const row32 = rows.find(row => row.startNumber === 32);

  assert.equal(row30.plac, 1);
  assert.equal(row31.plac, 2);
  assert.equal(row32.plac, '');

  assert.equal(row30.totalPenalty, 9.5);
  assert.ok(row31.totalPenalty > row30.totalPenalty);
  assert.equal(row32.totalPenalty, null);
  assert.equal(row32.isEliminated, false);
  assert.equal(row32.dressage.penalty, 4);
  assert.equal(row32.marathon.totalPenalty, 5);
  assert.equal(row32.precision.pen, null);
});
