import test from 'node:test';
import assert from 'node:assert/strict';

import { stagePenaltyFromMs } from '../js/core-engine/marathon.js';
import { marathonRankKey, compareMarathonRank } from '../js/core-engine/ranking.js';
import { dressagePenaltyFromPoints, isFeiProgram } from '../js/core-engine/dressage.js';
import { calculatePrecisionResult, getClassTempoMpm, isLattBBarnClass } from '../js/utils/precisionCalculation.js';
import { dressagePrograms } from '../js/data/dressagePrograms.js';

// Section T 2000 m for a horse at 13 km/h-ish: use a manual config tempo
const marathonConfig = {
    marathonClassData: {
        'Lätt A Enbet Häst': { distanceA: 5000, distanceT: 2000, distanceB: 5000, tempoA: 250, tempoT: 200, tempoB: 250, includeTransport: true }
    }
};
const horse = { className: 'Lätt A Enbet Häst', category: 'horse' };

test('transfer: no time penalty over its max time, only the time limit (TR 523.2-3)', () => {
    // max 600 s (2000 m at 200 m/min): 12 min is over max but within 2 × max
    assert.deepEqual(stagePenaltyFromMs(12 * 60 * 1000, horse, 'transport', marathonConfig), { points: 0, elim: false });
    // over twice the max time: eliminated
    assert.equal(stagePenaltyFromMs(21 * 60 * 1000, horse, 'transport', marathonConfig).elim, true);
    // A still penalises time over its max
    assert.ok(stagePenaltyFromMs(21 * 60 * 1000, horse, 'A', marathonConfig).points > 0);
});

test('marathon tie: lowest penalties on section B, obstacles included (TR 527.1)', () => {
    const x = marathonRankKey({ status: 'Klar', totalPenalty: 52, stages: { B: { timePenalty: 0 } }, obstaclePenaltySum: 50 });
    const y = marathonRankKey({ status: 'Klar', totalPenalty: 52, stages: { B: { timePenalty: 0 } }, obstaclePenaltySum: 52 });
    // X: 2 points on A, 50 on B. Y: 52 on B. X wins
    assert.ok(compareMarathonRank(x, y) < 0);
});

test('dressage: TR programs max − points, FEI programs 160 − points × coefficient (FEI 958)', () => {
    const fei2 = dressagePrograms.FEI_2star_2021;            // max 210, coeff 0.76
    assert.equal(isFeiProgram(fei2), true);
    assert.ok(Math.abs(dressagePenaltyFromPoints(144, fei2) - (160 - 144 * 0.76)) < 1e-9);   // 50.56
    const lb = dressagePrograms.SvLB;                        // max 160, coeff 1
    assert.equal(isFeiProgram(lb), false);
    assert.equal(dressagePenaltyFromPoints(120, lb), 40);
});

test('Lätt B Barn precision: exceeding the time allowed eliminates (TR Bilaga 5 #)', () => {
    assert.equal(isLattBBarnClass('Lätt B Barn Enbet Ponny'), true);
    assert.equal(isLattBBarnClass('Lätt B Enbet Ponny'), false);
    const config = { courses: { 'Lätt B Barn Enbet Ponny': { trackLengthMeters: 500, tempo: 100 } } };   // 300 s
    const barn = { className: 'Lätt B Barn Enbet Ponny' };
    assert.equal(calculatePrecisionResult({ finalized: true, timeMs: 299000, knocks: [] }, barn, config).eliminated, false);
    assert.equal(calculatePrecisionResult({ finalized: true, timeMs: 301000, knocks: [] }, barn, config).eliminated, true);
});

test('a class for ponies and horses together gives each its own precision tempo (TR 535.1)', () => {
    assert.equal(getClassTempoMpm({ className: 'Lätt B Enbet', category: 'horse' }, {}), 180);
    assert.equal(getClassTempoMpm({ className: 'Lätt B Enbet', horses: [{ heightCm: 128 }] }, {}), 160);
});
