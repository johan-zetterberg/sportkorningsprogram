import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DICTIONARY,
  chooseLanguage,
  isInternationalCompetition,
  translateTo,
  t,
  setCompetitionLanguageContext
} from '../js/utils/i18n.js';
import {
  formatPdfPenalty,
  formatTotalDisciplinePdfPenalty,
  formatTotalPdfPenalty
} from '../js/pdf/resultPdfFormatUtils.js';
import { buildMarathonSummaryRow } from '../js/pdf/marathonPdfRows.js';
import { buildStartListPdfBody } from '../js/pdf/startListPdfRows.js';
import { getMarathonPdfBaseStyles } from '../js/pages/marathon/maratonTiderPdfUtils.js';

test('chooseLanguage: the user choice wins, then the competition (FEI = English)', () => {
  assert.equal(chooseLanguage(null, false), 'sv');
  assert.equal(chooseLanguage(null, true), 'en');
  assert.equal(chooseLanguage('sv', true), 'sv');
  assert.equal(chooseLanguage('en', false), 'en');
  assert.equal(chooseLanguage('de', true), 'en'); // unknown choice: competition decides
});

test('isInternationalCompetition reads the competitionMeta flag', () => {
  assert.equal(isInternationalCompetition(null), false);
  assert.equal(isInternationalCompetition({}), false);
  assert.equal(isInternationalCompetition({ meta: { isInternational: true } }), true);
  assert.equal(isInternationalCompetition({ isInternational: true }), true);
  assert.equal(isInternationalCompetition({ meta: { isInternational: false }, isInternational: true }), false);
});

test('t() without a user choice: Swedish by default, English for an international competition', () => {
  setCompetitionLanguageContext(null);
  assert.equal(t('pdf_startlist_dressage'), 'DRESSYR – STARTLISTA');
  assert.equal(t('pdf_startlist_dressage', true), 'DRESSAGE – START LIST');
  setCompetitionLanguageContext({ meta: { isInternational: true } });
  assert.equal(t('total'), 'Total');
  setCompetitionLanguageContext(null);
  assert.equal(t('total'), 'Totalt');
  assert.equal(t('no_such_key_xyz'), 'no_such_key_xyz');
});

test('every PDF label has Swedish and English text', () => {
  const pdfKeys = Object.keys(DICTIONARY).filter(key => key.startsWith('pdf_'));
  assert.ok(pdfKeys.length > 20);
  for (const key of pdfKeys) {
    assert.ok(DICTIONARY[key].sv, `${key}: sv`);
    assert.ok(DICTIONARY[key].en, `${key}: en`);
  }
  // The Swedish headings of the result lists are unchanged
  assert.equal(translateTo('pdf_dressage_results_title', 'sv'), 'DRESSYR – RESULTATLISTA');
  assert.equal(translateTo('pdf_precision_results_title', 'sv'), 'PRECISION – RESULTATLISTA');
  assert.equal(translateTo('pdf_marathon_results_title', 'sv'), 'MARATHON – RESULTAT');
  assert.equal(translateTo('pdf_precision_results_title', 'en'), 'CONES – RESULT LIST');
});

test('formatPdfPenalty is null-safe and prints numbers stored as text', () => {
  assert.equal(formatPdfPenalty(null), '—');
  assert.equal(formatPdfPenalty(undefined), '—');
  assert.equal(formatPdfPenalty(''), '—');
  assert.equal(formatPdfPenalty('abc'), '—');
  assert.equal(formatPdfPenalty(NaN), '—');
  assert.equal(formatPdfPenalty('12.5'), '12.50');
  assert.equal(formatPdfPenalty(-Infinity), '—');
  assert.equal(formatPdfPenalty(7, { decimals: 1 }), '7.0');
});

test('withdrawn label follows the PDF language (STR / WD)', () => {
  const row = { status: 'struken', totalPenalty: 12, dressage: { penalty: 3 } };
  assert.equal(formatTotalPdfPenalty(row), 'STR');
  assert.equal(formatTotalPdfPenalty(row, true), 'WD');
  assert.equal(formatTotalDisciplinePdfPenalty(row, 'dressage'), 'STR');
  assert.equal(formatTotalDisciplinePdfPenalty(row, 'dressage', { withdrawnLabel: 'WD' }), 'WD');
});

test('marathon summary row: null totals print — instead of crashing', () => {
  // Not started: the engine leaves the total null
  assert.deepEqual(
    buildMarathonSummaryRow({ totalPenalty: null, stages: { A: {}, B: {} }, obstacles: { sum: 0 }, otherPenalty: 0 }),
    ['0.00', '—', '—', '—', '0.00', '—']
  );
  // Missing everything (no result at all)
  assert.deepEqual(buildMarathonSummaryRow(null), ['—', '—', '—', '—', '—', '—']);
  assert.deepEqual(buildMarathonSummaryRow(undefined), ['—', '—', '—', '—', '—', '—']);
});

test('marathon summary row: eliminated, withdrawn and complete results', () => {
  assert.deepEqual(
    buildMarathonSummaryRow({
      totalPenalty: Infinity,
      eliminated: true,
      stages: { A: { timePenalty: 2 }, B: { timePenalty: Infinity } },
      obstacles: { sum: 40.5, eliminated: false },
      otherPenalty: null
    }),
    ['40.50', '2.00', 'ELIM', 'ELIM', '—', 'ELIM']
  );
  assert.deepEqual(
    buildMarathonSummaryRow({ totalPenalty: null, stages: {}, obstacles: { sum: 0 } }, { withdrawn: true, withdrawnLabel: 'WD' }),
    ['WD', 'WD', 'WD', 'WD', 'WD', 'WD']
  );
  assert.deepEqual(
    buildMarathonSummaryRow({
      totalPenalty: 61.25,
      stages: { A: { timePenalty: 1 }, B: { timePenalty: 0.25 } },
      obstacles: { sum: 55 },
      otherPenalty: 5
    }),
    ['55.00', '1.00', '0.25', '1.25', '5.00', '61.25']
  );
});

test('start list rows take the PDF language for the unknown class and multiple starts', () => {
  const rows = [{ startNumber: 1, driverName: 'Łukasz Řehoř Őrsi', hasMultipleStarts: true, driverStartCount: 2, horses: [{ name: 'Indra' }] }];
  const sv = buildStartListPdfBody(rows, 'dressage', { viewMode: 'byclass' });
  assert.equal(sv.body[0][0].content, 'Okänd klass');
  assert.equal(sv.body[1][2], 'Łukasz Řehoř Őrsi (2 starter)\nIndra');
  const en = buildStartListPdfBody(rows, 'dressage', { viewMode: 'byclass', unknownClassLabel: 'Unknown class', startsLabel: 'starts' });
  assert.equal(en.body[0][0].content, 'Unknown class');
  assert.equal(en.body[1][2], 'Łukasz Řehoř Őrsi (2 starts)\nIndra');
});

test('marathon hold-time PDF uses the document font (Unicode when loaded)', () => {
  assert.equal(getMarathonPdfBaseStyles().font, 'helvetica');
  assert.equal(getMarathonPdfBaseStyles('NotoSans').font, 'NotoSans');
});
