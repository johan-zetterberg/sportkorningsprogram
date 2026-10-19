import test from 'node:test';
import assert from 'node:assert/strict';

import {
    finalizeConfirmMessage,
    findDressageGaps,
    findMarathonGaps,
    findPrecisionGaps
} from '../js/services/finalizeCompletenessUtils.js';

const equipage = { startNumber: 12, className: 'Lätt A Enbet Häst' };
const marathonConfig = { obstacleNumbers: [1, 2, 3, 4] };
const timing = { duration_A: 1_200_000, duration_B: 1_400_000 };

test('marathon: missing obstacles of the course, stage times and observer log are listed', () => {
    const gaps = findMarathonGaps({
        equipage,
        summary: { obstacleResults: { 1: { timeInSeconds: 40 } }, obstacles: [{ number: 2, timeInSeconds: 38 }] },
        timing: { duration_A: 1_200_000 },
        savedObstacles: [{ id: '3', obstacleNumber: 3, timeInSeconds: 0 }],
        marathonConfig
    });
    assert.deepEqual(gaps, [
        'Tid för sträcka B saknas.',
        'Hinderresultat saknas för hinder 3, 4.',
        'Ingen observatörslogg har kommit in (kontrollera med observatören).'
    ]);
});

test('marathon: complete data has no gaps; the class course decides which obstacles', () => {
    const config = { obstacleNumbers: [1, 2, 3, 4], marathonClassData: { [equipage.className]: { drivenObstacles: '1, 2' } } };
    const gaps = findMarathonGaps({
        equipage,
        summary: { obstacles: [{ number: 1, timeInSeconds: 40 }, { number: 2, eliminated: false, penalty: 5 }], observerLog: { wrongGaits: [] } },
        timing,
        marathonConfig: config
    });
    assert.deepEqual(gaps, []);
});

test('marathon: eliminated or withdrawn equipages have nothing more to come', () => {
    assert.deepEqual(findMarathonGaps({ equipage, summary: { obstacles: [{ number: 1, eliminated: true }] }, marathonConfig }), []);
    assert.deepEqual(findMarathonGaps({ equipage: { ...equipage, status: 'struken' }, marathonConfig }), []);
    assert.deepEqual(findMarathonGaps({ equipage, marathonConfig }), ['Inga maratondata har kommit in.']);
});

test('marathon: an unknown course is reported', () => {
    const gaps = findMarathonGaps({ equipage, summary: { observerLog: {} }, timing, marathonConfig: {} });
    assert.match(gaps[0], /hinder är inte kända/);
});

test('precision: a result with time and total is complete', () => {
    assert.deepEqual(findPrecisionGaps({ equipage, result: { timeMs: 90_000, totalPenalty: 3 } }), []);
    assert.deepEqual(findPrecisionGaps({ equipage, result: null }), ['Inget precisionsresultat har kommit in.']);
    assert.deepEqual(findPrecisionGaps({ equipage, result: { timeMs: 0, totalPenalty: null } }), [
        'Tid saknas i precisionsresultatet.',
        'Totalt straff saknas (kontrollera klassens maxtid).'
    ]);
    assert.deepEqual(findPrecisionGaps({ equipage, result: { eliminated: true } }), []);
});

test('dressage: a protocol is expected from every judge assigned to the class', () => {
    const judgeMapping = { [equipage.className]: { C: 'judge-c', E: 'judge-e', B: '' } };
    const protocols = [
        { id: 'general', errorPoints: 2 },
        { id: 'judge_judge-c', judgeId: 'judge-c', judgePosition: 'C', movements: [{ score: 7 }] },
        { id: 'judge_x', judgePosition: 'E', movements: [] }
    ];
    assert.deepEqual(findDressageGaps({ equipage, protocols, judgeMapping }), ['Protokollet från domare E har inga poäng.']);
    assert.deepEqual(findDressageGaps({ equipage, protocols: protocols.slice(0, 2), judgeMapping }), ['Protokoll saknas från domare E.']);
    assert.match(findDressageGaps({ equipage, protocols, judgeMapping: {} })[0], /Inga domare/);
});

test('the confirmation lists the gaps', () => {
    assert.match(finalizeConfirmMessage('marathon', 12, []), /^Finalisera maraton för #12\?/);
    const message = finalizeConfirmMessage('dressage', 5, ['Protokoll saknas från domare E.']);
    assert.match(message, /dressyr #5/);
    assert.match(message, /- Protokoll saknas från domare E\./);
    assert.match(message, /Finalisera ändå\?$/);
});
