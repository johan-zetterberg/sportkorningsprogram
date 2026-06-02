import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPrecisionValidationErrors,
  parsePrecisionObstacleLabels,
  validatePrecisionAdminSettings,
  validatePrecisionClassSettings,
  validatePrecisionMapSettings
} from '../js/pages/precision/precisionAdminValidation.js';

test('parsePrecisionObstacleLabels accepts comma and newline separated labels', () => {
  assert.deepEqual(parsePrecisionObstacleLabels('1, 2\n3A\r\n3B'), ['1', '2', '3A', '3B']);
});

test('validatePrecisionClassSettings requires track length and obstacle labels', () => {
  const errors = validatePrecisionClassSettings({
    trackLengthMeters: '',
    tempo: '',
    obstacleLabelsText: ''
  }, {
    hasStandardTempo: true
  });

  assert.deepEqual(errors.map(error => error.field), ['trackLengthMeters', 'obstacleLabels']);
});

test('validatePrecisionClassSettings accepts standard tempo fallback', () => {
  const errors = validatePrecisionClassSettings({
    trackLengthMeters: 500,
    tempo: '',
    obstacleLabelsText: '1,2,3'
  }, {
    hasStandardTempo: true
  });

  assert.equal(errors.length, 0);
});

test('validatePrecisionClassSettings requires manual tempo when no standard tempo exists', () => {
  const errors = validatePrecisionClassSettings({
    trackLengthMeters: 500,
    tempo: '',
    obstacleLabelsText: '1,2,3'
  }, {
    hasStandardTempo: false
  });

  assert.deepEqual(errors.map(error => error.field), ['tempo']);
});

test('validatePrecisionMapSettings only validates coordinates when enabled', () => {
  assert.equal(validatePrecisionMapSettings({ enabled: false, entitiesParseError: true }).length, 0);
  assert.deepEqual(
    validatePrecisionMapSettings({ enabled: true, entitiesParseError: true }).map(error => error.field),
    ['entities']
  );
  assert.deepEqual(
    validatePrecisionMapSettings({ enabled: true, entities: { start: [1, 2] } }).map(error => error.field),
    ['entities']
  );
  assert.equal(validatePrecisionMapSettings({ enabled: true, entities: { start: [1, 2], finish: [3, 4] } }).length, 0);
});

test('validatePrecisionAdminSettings reports grouped class errors and global errors', () => {
  const result = validatePrecisionAdminSettings({
    classes: {
      'Latt A': { trackLengthMeters: 500, obstacleLabelsText: '1,2,3' },
      'MSV': { trackLengthMeters: '', obstacleLabelsText: '' }
    },
    global: { knockdownPenalty: '-3', timePenaltyRate: '' },
    map: { enabled: false }
  }, (className) => ({ hasStandardTempo: className === 'Latt A' }));

  assert.equal(hasPrecisionValidationErrors(result), true);
  assert.equal(result.classes['Latt A'], undefined);
  assert.deepEqual(result.classes.MSV.map(error => error.field), ['trackLengthMeters', 'tempo', 'obstacleLabels']);
  assert.deepEqual(result.global.map(error => error.field), ['knockdownPenalty']);
});
