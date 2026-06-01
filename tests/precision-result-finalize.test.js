import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrecisionFinalizePayload,
  buildPrecisionUnfinalizePayload,
  isPrecisionFinalized,
  renderPrecisionFinalizeButtons
} from '../js/pages/precision/precisionResultFinalize.js';

test('isPrecisionFinalized prefers Firestore map over optimistic cache', () => {
  const precisionMap = new Map([['12', { finalized: false }]]);
  const cache = new Map([['12', true]]);

  assert.equal(isPrecisionFinalized(12, precisionMap, cache), false);
});

test('isPrecisionFinalized falls back to optimistic cache', () => {
  const cache = new Map([['12', true]]);

  assert.equal(isPrecisionFinalized(12, new Map(), cache), true);
});

test('renderPrecisionFinalizeButtons hides output without permission', () => {
  const html = renderPrecisionFinalizeButtons({
    startNumber: 12,
    finalized: false,
    canFinalize: false
  });

  assert.equal(html, '');
});

test('renderPrecisionFinalizeButtons renders finalize and undo state', () => {
  const html = renderPrecisionFinalizeButtons({
    startNumber: 12,
    finalized: true,
    canFinalize: true,
    labels: {
      finalizedBadge: 'Klar',
      finalize: 'Finalisera',
      undo: 'Ångra'
    }
  });

  assert.match(html, /prec-final-badge-12/);
  assert.match(html, /display:inline-flex/);
  assert.match(html, /data-prec-action="unfinalize"/);
});

test('finalize payload preserves current result data and marks finalized', () => {
  const payload = buildPrecisionFinalizePayload({ totalPenalty: 5, finalized: false });

  assert.deepEqual(payload, { prioritized: true, totalPenalty: 5, finalized: true });
});

test('unfinalize payload only clears finalized flag', () => {
  assert.deepEqual(buildPrecisionUnfinalizePayload(), { finalized: false });
});
