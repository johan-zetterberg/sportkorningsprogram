import test from 'node:test';
import assert from 'node:assert/strict';

import { findEditConflicts, isStillRunning, pickEditedFields } from '../js/services/secretariatPatchUtils.js';

const FIELDS = ['timeMs', 'obstaclePenalty', 'comment', 'eliminated'];
const DEFAULTS = { timeMs: 0, obstaclePenalty: 0, comment: '', eliminated: false };

test('only fields the secretariat changed are saved', () => {
    const loaded = { timeMs: 0, obstaclePenalty: 0, comment: '', eliminated: false };
    // Row untouched: nothing to save (finalizing then only locks)
    assert.deepEqual(pickEditedFields({ ...loaded }, loaded, FIELDS, DEFAULTS), {});
    // Only the comment edited
    assert.deepEqual(pickEditedFields({ ...loaded, comment: 'Ok' }, loaded, FIELDS, DEFAULTS), { comment: 'Ok' });
    // Number formats count as the same value
    assert.deepEqual(pickEditedFields({ timeMs: '45300' }, { timeMs: 45300 }, FIELDS, DEFAULTS), {});
    // Missing values compare as their default
    assert.deepEqual(pickEditedFields({ obstaclePenalty: 0, eliminated: false }, {}, FIELDS, DEFAULTS), {});
});

test('the old row values never overwrite what the judge saved meanwhile', () => {
    // Page loaded before the judge saved; secretariat finalizes without edits
    const loaded = { timeMs: 0, obstaclePenalty: 0, comment: '' };
    const judgeSaved = { timeMs: 45300, obstaclePenalty: 6, comment: '' };
    const edited = pickEditedFields({ ...loaded }, loaded, FIELDS, DEFAULTS);
    assert.deepEqual(edited, {});
    assert.deepEqual(findEditConflicts(edited, loaded, judgeSaved, DEFAULTS), []);
});

test('editing a field the judge changed meanwhile is a conflict', () => {
    const loaded = { timeMs: 0, obstaclePenalty: 0, comment: '' };
    const judgeSaved = { timeMs: 45300, obstaclePenalty: 6, comment: '' };
    // Secretariat corrected the penalty from the old 0 to 3: refused, the judge saved 6
    const edited = pickEditedFields({ ...loaded, obstaclePenalty: 3 }, loaded, FIELDS, DEFAULTS);
    assert.deepEqual(findEditConflicts(edited, loaded, judgeSaved, DEFAULTS), ['obstaclePenalty']);
    // A comment edit does not clash with the judge's time
    const commentOnly = pickEditedFields({ ...loaded, comment: 'Ok' }, loaded, FIELDS, DEFAULTS);
    assert.deepEqual(findEditConflicts(commentOnly, loaded, judgeSaved, DEFAULTS), []);
});

test('a running clock or stage counts as still running', () => {
    assert.equal(isStillRunning({ running: true }), true);
    assert.equal(isStillRunning({ runningStage: 'B' }), true);
    assert.equal(isStillRunning({ running: false, runningStage: null }), false);
    assert.equal(isStillRunning(undefined), false);
});
