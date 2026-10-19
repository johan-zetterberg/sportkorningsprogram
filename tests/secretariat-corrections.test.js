import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCorrectionReason,
    formatCorrectionReason,
    mergeObstacleSources,
    normalizeSecretariatObstacle,
    planObstacleCorrection
} from '../js/services/secretariatPatchUtils.js';
import { buildRejectedWriteEntry, summarizeRejectedPayload } from '../js/services/rejectedWritesUtils.js';
import { describeImportWrites, equipageIdentity, sameEquipageIdentity } from '../js/pages/admin/adminParticipantIdentity.js';

const loaded = normalizeSecretariatObstacle({ number: 3, timeInSeconds: 40, knockdowns: 0, knockdownPenalty: 0, otherPenalty: 0, comment: '' });

test('an obstacle correction writes only the edited fields over the judge\'s newer values', () => {
    // The judge added a knockdown and a comment after the page was loaded
    const current = { number: 3, timeInSeconds: 40, knockdowns: 1, knockdownPenalty: 2, comment: 'boll 3b', gateSplits: [1, 2] };
    // The secretariat changed only the time (the form still shows the old knockdowns)
    const patch = { ...loaded, timeInSeconds: 42.5 };
    const plan = planObstacleCorrection(patch, loaded, current);
    assert.deepEqual(plan.edited, { timeInSeconds: 42.5 });
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.payload.timeInSeconds, 42.5);
    assert.equal(plan.payload.knockdowns, 1, 'the judge\'s knockdown is kept');
    assert.equal(plan.payload.knockdownPenalty, 2);
    assert.equal(plan.payload.comment, 'boll 3b');
});

test('an obstacle correction of a field the judge changed meanwhile is a conflict', () => {
    const current = { number: 3, timeInSeconds: 44 };
    const plan = planObstacleCorrection({ ...loaded, timeInSeconds: 42 }, loaded, current);
    assert.deepEqual(plan.conflicts, ['timeInSeconds']);
});

test('an untouched obstacle row has nothing to save', () => {
    const plan = planObstacleCorrection({ ...loaded }, loaded, { number: 3, timeInSeconds: 40 });
    assert.deepEqual(plan.edited, {});
});

test('obstacle results come from the documents, the list and the per-obstacle map (map wins)', () => {
    const merged = mergeObstacleSources(
        [{ id: '1', obstacleNumber: 1, timeInSeconds: 30 }, { id: '2', obstacleNumber: 2, timeInSeconds: 31 }],
        {
            obstacles: [{ number: 2, timeInSeconds: 33 }],
            obstacleResults: { 2: { timeInSeconds: 35 }, 4: { timeInSeconds: 50 } }
        }
    );
    assert.deepEqual([...merged.keys()].sort(), [1, 2, 4]);
    assert.equal(merged.get(1).timeInSeconds, 30);
    assert.equal(merged.get(2).timeInSeconds, 35);
    assert.equal(merged.get(4).obstacleNumber, 4);
});

test('a correction needs a free-text reason; the reference is optional', () => {
    assert.throws(() => buildCorrectionReason({ reason: '  ' }), /orsak/);
    assert.deepEqual(buildCorrectionReason({ reason: ' Fel tid ' }), { reason: 'Fel tid', reference: null });
    const withRef = buildCorrectionReason({ reason: 'Protest godkänd', referenceType: 'protest', referenceValue: '7' });
    assert.deepEqual(withRef.reference, { type: 'protest', value: '7' });
    assert.equal(buildCorrectionReason({ reason: 'x', referenceType: 'unknown' }).reference, null);
    assert.equal(formatCorrectionReason(withRef), 'Protest godkänd (Protest nr 7)');
});

test('a refused write is recorded with discipline, start number and a short summary', () => {
    const entry = buildRejectedWriteEntry({
        discipline: 'marathon',
        startNumber: 12,
        obstacle: '4',
        payloadSummary: { timeInSeconds: 41.2, knockdowns: 1, gateSplits: [1, 2, 3], __base: {} },
        error: { code: 'permission-denied' },
        source: 'maraton-input'
    });
    assert.deepEqual(entry, {
        discipline: 'marathon',
        startNumber: '12',
        obstacle: 4,
        payloadSummary: 'timeInSeconds=41.2, knockdowns=1, gateSplits=[3]',
        errorCode: 'permission-denied',
        source: 'maraton-input'
    });
    assert.throws(() => buildRejectedWriteEntry({ discipline: 'speaker', startNumber: 1 }));
    assert.throws(() => buildRejectedWriteEntry({ discipline: 'precision', startNumber: '' }));
    assert.equal(summarizeRejectedPayload('x'.repeat(2000)).length, 1000);
});

test('an import or form save lands only on the same driver', () => {
    const expected = equipageIdentity({ startNumber: 12, driverName: ' Anna  Svensson' });
    assert.equal(sameEquipageIdentity({ driverName: 'anna svensson' }, expected), true);
    assert.equal(sameEquipageIdentity({ driverName: 'Bo Ek' }, expected), false);
    assert.equal(sameEquipageIdentity({ driverName: 'Bo Ek' }, null), true);
    const lines = describeImportWrites({
        written: [{ startNumber: 1 }, { startNumber: 2 }],
        failed: [{ startNumber: 3, driverName: 'Cia', reason: 'Startnummer #3 används redan av Dan.' }]
    });
    assert.deepEqual(lines, ['Sparade (2): #1, #2', 'Inte sparade (1):', '#3 Cia: Startnummer #3 används redan av Dan.']);
});
