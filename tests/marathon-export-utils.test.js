import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatMarathonExternalOtherPenalty,
  formatMarathonPenaltyExportValue,
  getMarathonExternalOtherPenalty,
  isWithdrawnMarathonExport,
  localizeCsvDecimal
} from '../js/utils/marathonExportUtils.js';

test('formatMarathonPenaltyExportValue handles numeric, empty, eliminated and withdrawn values', () => {
  assert.equal(formatMarathonPenaltyExportValue(12.345), '12.35');
  assert.equal(formatMarathonPenaltyExportValue(null), '—');
  assert.equal(formatMarathonPenaltyExportValue(undefined, { empty: '' }), '');
  assert.equal(formatMarathonPenaltyExportValue(Infinity), 'ELIM');
  assert.equal(formatMarathonPenaltyExportValue(3, { marathonResult: { eliminated: true } }), 'ELIM');
  assert.equal(formatMarathonPenaltyExportValue(3, { equipage: { status: 'struken' } }), 'STR');
});

test('marathon external other penalty includes global and wrong gait but not obstacle-level penalties', () => {
  const result = {
    otherPenalty: 4,
    wgPenalty: 2,
    eliminated: true,
    obstacles: {
      items: [{ otherPenalty: 5 }]
    }
  };

  assert.equal(getMarathonExternalOtherPenalty(result), 6);
  assert.equal(formatMarathonExternalOtherPenalty(result), '6.00');
});

test('isWithdrawnMarathonExport and localizeCsvDecimal format export labels', () => {
  assert.equal(isWithdrawnMarathonExport({ status: 'Struken' }), true);
  assert.equal(isWithdrawnMarathonExport({}, { status: 'Withdrawn' }), true);
  assert.equal(isWithdrawnMarathonExport({ status: 'klar' }), false);
  assert.equal(localizeCsvDecimal('12.50'), '12,50');
  assert.equal(localizeCsvDecimal('ELIM'), 'ELIM');
});
