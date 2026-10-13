import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateDressageResult, getDressagePenaltyCoeff, protocolsForAssignedJudges } from '../js/core-engine/dressage.js';
import { dressagePrograms } from '../js/data/dressagePrograms.js';

const program = {
    name: 'Testprogram',
    penaltyCoeff: 1,
    movements: [{ no: 1, coeff: 1 }, { no: 2, coeff: 1 }, { no: 3, coeff: 1 }, { no: 4, coeff: 1 }]
};
const allPrograms = { T: program };
const protocol = (judgeId, position, scores) => ({
    judgeId, position, movements: scores.map((score, i) => ({ momentNo: i + 1, score }))
});
const stateWith = (protocols, mapping) => ({
    equipage: { startNumber: 1, className: 'K', testKey: 'T' },
    dressage: { protocols },
    config: { allPrograms, dressageJudgeMapping: { K: mapping }, judges: [] }
});

test('a protocol from a judge not assigned to the class does not count', () => {
    const result = calculateDressageResult(stateWith([
        protocol('c1', 'C', [8, 8, 8, 8]),
        protocol('e1', 'E', [8, 8, 8, 8]),
        protocol('b1', 'B', [2])                // stray: B is not assigned
    ], { C: 'c1', E: 'e1' }));
    assert.equal(result.judgePenalty, 8);       // (40 - 32) × 1
    assert.equal(result.judgesComplete, true);
});

test('two protocols at one position count once, the assigned judge first', () => {
    const picked = protocolsForAssignedJudges([
        protocol('old-account', 'C', [5, 5, 5, 5]),
        protocol('c1', 'C', [8, 8, 8, 8]),
        protocol('e1', 'E', [8, 8, 8, 8])
    ], { C: 'c1', E: 'e1' });
    assert.deepEqual(picked.map(p => p.judgeId), ['c1', 'e1']);

    const result = calculateDressageResult(stateWith([
        protocol('old-account', 'C', [5, 5, 5, 5]),
        protocol('c1', 'C', [8, 8, 8, 8]),
        protocol('e1', 'E', [8, 8, 8, 8])
    ], { C: 'c1', E: 'e1' }));
    assert.equal(result.judgePenalty, 8);
});

test('without a judge mapping all protocols are used (provisional)', () => {
    const list = [protocol('a', 'C', [8]), protocol('b', 'E', [7])];
    assert.equal(protocolsForAssignedJudges(list, {}), list);
});

test('a saved program copy without coefficient keeps the built-in one', () => {
    const builtIn = dressagePrograms.FEI_2star_2021;
    assert.ok(builtIn && Number.isFinite(builtIn.penaltyCoeff));
    const savedCopy = { name: builtIn.name, category: builtIn.category, movements: builtIn.movements };
    assert.equal(getDressagePenaltyCoeff(savedCopy, {}), builtIn.penaltyCoeff);
    assert.equal(getDressagePenaltyCoeff('FEI_2star_2021', { FEI_2star_2021: savedCopy }), builtIn.penaltyCoeff);
    // An explicit coefficient still wins
    assert.equal(getDressagePenaltyCoeff({ ...savedCopy, penaltyCoeff: 0.5 }, {}), 0.5);
});
