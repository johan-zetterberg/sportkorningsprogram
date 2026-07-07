import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findBestClassMatch,
  inferParaGradeFromClassName,
  normalizeEqClassName,
  normalizeTestForMerge,
  resolveTestLevelMergeForClass,
  resolveProgramKeyForClass
} from '../js/pages/admin/adminParticipantClassUtils.js';

test('inferParaGradeFromClassName resolves common para grade labels', () => {
  assert.equal(inferParaGradeFromClassName('Para Lätt A'), '1');
  assert.equal(inferParaGradeFromClassName('Para MSV'), '2');
  assert.equal(inferParaGradeFromClassName('Lätt A'), '');
});

test('resolveProgramKeyForClass resolves para classes from grade', () => {
  assert.equal(resolveProgramKeyForClass('Para Lätt A'), 'FEIParaG1');
  assert.equal(resolveProgramKeyForClass('Para MSV', '2'), 'FEIParaG2');
  assert.equal(resolveProgramKeyForClass(''), '');
});

test('normalizeTestForMerge removes turnout and horse labels', () => {
  const normalized = normalizeTestForMerge('Enbet Häst Lätt A');
  assert.equal(normalized.label, 'Lätt A');
  assert.equal(normalized.key, 'TEST:LÄTT A ');
});

test('resolveTestLevelMergeForClass builds display merge from actual mapped class', () => {
  assert.deepEqual(resolveTestLevelMergeForClass('Lätt A Enbet Ponny'), {
    key: 'PROG:SvLA ',
    label: 'Lätt A'
  });
  assert.deepEqual(resolveTestLevelMergeForClass('MSV 4 Par Häst'), {
    key: 'PROG:sv_msv_4_par_2025 ',
    label: 'MSV 4'
  });
});

test('normalizeEqClassName standardizes short labels and horse types', () => {
  assert.equal(normalizeEqClassName('LA enb häst'), 'Lätt A Enbet Häst');
  assert.equal(normalizeEqClassName('MSV III fyr ponny'), 'Msv 3 Fyrspann Ponny');
});

test('findBestClassMatch prefers matching para and turnout class', () => {
  const classes = ['Lätt A Enbet Häst', 'Lätt A Par Häst', 'Para Lätt A'];
  assert.equal(findBestClassMatch('Lätt A Par Häst', classes), 'Lätt A Par Häst');
  assert.equal(findBestClassMatch('Para Lätt A', classes), 'Para Lätt A');
});
