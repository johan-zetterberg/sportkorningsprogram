import test from 'node:test';
import assert from 'node:assert/strict';

import { dressagePrograms } from '../js/data/dressagePrograms.js';
import { klassProgramMapping } from '../js/data/competitionData.js';

const expectedPdfMaxScores = {
  SvLB: 160,
  SvLA: 160,
  SvMsvB: 200,
  sv_msv_4_enb_2025: 200,
  sv_msv_4_par_2025: 200,
  FEI_Children_2025_sv: 200,
  FEIJunior: 200,
  FEI_Junior_2025: 200,
  FEI_FU_PE_A: 190,
  FEI3AHP1: 240,
  FEI_2star_2021: 210,
  FEI_2star_HP2_HP4: 210,
  FEI_CAI1_Para: 200,
  FEI_3star_B_HP4_2022: 240,
  FEI_3star_HP2_P2_2025: 260,
  FEI_3star_HP4_2025: 260
};

test('static dressage programs have complete movement definitions', () => {
  assert.ok(Object.keys(dressagePrograms).length > 0);

  for (const [key, program] of Object.entries(dressagePrograms)) {
    assert.ok(program.name, `${key} is missing name`);
    assert.ok(Number(program.penaltyCoeff) > 0, `${key} has invalid penaltyCoeff`);
    assert.ok(Array.isArray(program.movements) && program.movements.length > 0, `${key} is missing movements`);

    const numbers = program.movements.map((movement) => Number(movement.no));
    assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, index) => index + 1), `${key} has non-sequential movement numbers`);

    for (const movement of program.movements) {
      assert.ok(String(movement.text || '').trim(), `${key} movement ${movement.no} is missing text`);
      assert.ok(String(movement.judge || '').trim(), `${key} movement ${movement.no} is missing judge text`);
      assert.ok(Number(movement.coeff) > 0, `${key} movement ${movement.no} has invalid coeff`);
    }
  }
});

test('verified dressage programs match max scores from bundled PDFs', () => {
  for (const [programKey, expectedMaxScore] of Object.entries(expectedPdfMaxScores)) {
    const program = dressagePrograms[programKey];
    assert.ok(program, `${programKey} is missing`);

    const actualMaxScore = program.movements.reduce((sum, movement) => {
      return sum + (10 * Number(movement.coeff || 1));
    }, 0);

    assert.equal(actualMaxScore, expectedMaxScore, `${programKey} has wrong max score`);
  }
});

test('static class-to-program mapping points only to existing dressage programs', () => {
  for (const [className, programKey] of Object.entries(klassProgramMapping)) {
    assert.ok(dressagePrograms[programKey], `${className} maps to missing program ${programKey}`);
  }
});
