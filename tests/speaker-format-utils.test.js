import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSpeakerPenalty,
  formatSpeakerPercent,
  getSpeakerPenaltyOrNull,
  isFiniteSpeakerNumber
} from '../js/pages/shared/speakerFormatUtils.js';

test('speaker number validation only accepts finite numbers', () => {
  assert.equal(isFiniteSpeakerNumber(0), true);
  assert.equal(isFiniteSpeakerNumber(12.34), true);
  assert.equal(isFiniteSpeakerNumber(Infinity), false);
  assert.equal(isFiniteSpeakerNumber(NaN), false);
  assert.equal(isFiniteSpeakerNumber(null), false);
});

test('speaker penalty formatting avoids invalid numeric output', () => {
  assert.equal(formatSpeakerPenalty(12.345), '12.35');
  assert.equal(formatSpeakerPenalty(0), '0.00');
  assert.equal(formatSpeakerPenalty(Infinity), 'ELIM');
  assert.equal(formatSpeakerPenalty(null), '—');
  assert.equal(formatSpeakerPenalty(12.345, { decimals: 1 }), '12.3');
});

test('speaker helpers normalize penalties and percentages', () => {
  assert.equal(getSpeakerPenaltyOrNull(5), 5);
  assert.equal(getSpeakerPenaltyOrNull(Infinity), null);
  assert.equal(formatSpeakerPercent(71.23), '71.2%');
  assert.equal(formatSpeakerPercent(null), '—');
});
