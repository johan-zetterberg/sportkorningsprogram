import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStartListPdfBody,
  formatPdfStartTime,
  getPdfDisplayClass
} from '../js/pdf/startListPdfRows.js';

test('formatPdfStartTime extracts local time from datetime values', () => {
  assert.equal(formatPdfStartTime('2026-05-25T09:15'), '09:15');
  assert.equal(formatPdfStartTime('09:20'), '09:20');
  assert.equal(formatPdfStartTime(null), '—');
});

test('buildStartListPdfBody groups by display class and keeps source rows aligned', () => {
  const rows = [
    { startNumber: 1, driverName: 'Anna', horses: [{ name: 'Häst A' }], className: 'Lätt A', _mergedLabel: 'Sammanslagen', clubName: 'Klubb', startTime: '2026-05-25T09:00' },
    { startNumber: 2, driverName: 'Bo', horseName: 'Häst B', className: 'Lätt B', _mergedLabel: 'Sammanslagen', clubName: 'Klubb', startTime: '2026-05-25T09:10' }
  ];

  const { body, rowSources } = buildStartListPdfBody(rows, 'dressage', { viewMode: 'byclass' });

  assert.equal(body.length, 3);
  assert.equal(body[0][0].content, 'Sammanslagen');
  assert.equal(rowSources[0], null);
  assert.equal(rowSources[1], rows[0]);
  assert.equal(rowSources[2], rows[1]);
  assert.equal(body[1][0].content, '09:00');
  assert.match(body[1][2], /Anna\nHäst A/);
  assert.equal(body[2][3], 'Sammanslagen');
});

test('buildStartListPdfBody builds participant and horse list rows', () => {
  const participant = buildStartListPdfBody([
    { startNumber: 5, driverName: 'Cilla', horseName: 'Häst C', className: 'MSV' }
  ], 'participants');

  assert.deepEqual(participant.body[0].slice(0, 3), [5, 'Cilla\nHäst C', 'MSV']);

  const horseList = buildStartListPdfBody([
    { name: 'Häst D', sire: 'Far', dam: 'Mor', owner: 'Ägare', driverName: 'Kusk' }
  ], 'horselist');

  assert.equal(horseList.body[0][0], 'Häst D');
  assert.equal(horseList.body[0][5], 'Far x Mor');
  assert.equal(getPdfDisplayClass({ _mergedLabel: 'Visad', className: 'Original' }), 'Visad');
});
