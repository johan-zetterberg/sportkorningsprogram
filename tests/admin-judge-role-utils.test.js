import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeJudgeRoles } from '../js/pages/admin/adminJudgeRoleUtils.js';

test('normalizeJudgeRoles keeps one role per non-dressage discipline', () => {
    const roles = normalizeJudgeRoles([
        { discipline: 'marathon' },
        { discipline: 'marathon' },
        { discipline: 'precision' },
        { discipline: 'overjudge' },
        { discipline: 'overjudge' }
    ]);

    assert.deepEqual(roles, [
        { discipline: 'marathon' },
        { discipline: 'precision' },
        { discipline: 'overjudge' }
    ]);
});

test('normalizeJudgeRoles keeps one dressage role and prefers a position', () => {
    const roles = normalizeJudgeRoles([
        { discipline: 'dressage', position: '' },
        { discipline: 'dressage', position: 'c' },
        { discipline: 'dressage', position: 'e' }
    ]);

    assert.deepEqual(roles, [
        { discipline: 'dressage', position: 'C' }
    ]);
});
