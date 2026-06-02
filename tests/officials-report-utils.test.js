import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCheckInPdfRows } from '../js/pdf/officialsReportUtils.js';

test('buildCheckInPdfRows does not use shirt size as vest status', () => {
  const rows = buildCheckInPdfRows([
    { name: 'Nils', role: 'Maraton', shirtSize: 'XL', hasVest: false, hasRadio: false, isCheckedIn: true }
  ]);

  assert.deepEqual(rows[0], ['[ X ]', 'Nils', 'Maraton', '[   ]', '[   ]', '']);
});

test('buildCheckInPdfRows includes check-in notes', () => {
  const rows = buildCheckInPdfRows([
    { name: 'Anna', role: 'Sekretariat', hasVest: true, hasRadio: true, checkInNotes: 'Fick extra radio' }
  ]);

  assert.deepEqual(rows[0], ['[   ]', 'Anna', 'Sekretariat', '[ X ]', '[ X ]', 'Fick extra radio']);
});
