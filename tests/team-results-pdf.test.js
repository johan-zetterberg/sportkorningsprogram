import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTeamMemberDisciplineCell } from '../js/pdf/teamResultsPdfUtils.js';

test('formatTeamMemberDisciplineCell handles counting and dropped discipline scores', () => {
    const counting = formatTeamMemberDisciplineCell(48.5, { isCounting: true });
    assert.equal(counting.content, '48.50 *');
    assert.equal(counting.styles.fontStyle, 'bold');

    const dropped = formatTeamMemberDisciplineCell(55.2, { isCounting: false });
    assert.equal(dropped.content, '55.20 (str)');
    assert.equal(dropped.styles.fontStyle, 'normal');
});

test('formatTeamMemberDisciplineCell formats 500 team penalties specifically', () => {
    const penaltyCounting = formatTeamMemberDisciplineCell(500, {
        isCounting: true,
        isTeamPenalty: true,
        isElim: true
    });
    assert.equal(penaltyCounting.content, '500.00* (Lagstr)');

    const penaltyDropped = formatTeamMemberDisciplineCell(500, {
        isCounting: false,
        isTeamPenalty: true,
        isElim: true
    });
    assert.equal(penaltyDropped.content, '500.00 (Lagstr)');
});

test('formatTeamMemberDisciplineCell handles regular elimination and missing values', () => {
    const elim = formatTeamMemberDisciplineCell(null, { isElim: true });
    assert.equal(elim.content, 'ELIM');

    const missing = formatTeamMemberDisciplineCell(null);
    assert.equal(missing.content, '—');

    const notFinite = formatTeamMemberDisciplineCell(NaN);
    assert.equal(notFinite.content, '—');
});
