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

test('arena class: no track length or tempo needed, an obstacle list is', () => {
  const ok = validatePrecisionClassSettings({
    format: 'arena',
    arena: { rules: 'FEI', obstacles: [{ label: '1', type: 'cone' }, { label: 'A', type: 'marathon' }] }
  }, { hasStandardTempo: false });
  assert.equal(ok.length, 0);

  const none = validatePrecisionClassSettings({ format: 'arena', arena: { rules: 'FEI', obstacles: [{ label: '  ', type: 'cone' }] } });
  assert.deepEqual(none.map(error => error.field), ['arenaObstacles']);
});

test('arena obstacle labels must be unique, without # and at most 12 characters', () => {
  const field = (obstacles) => validatePrecisionClassSettings({ format: 'arena', arena: { rules: 'FEI', obstacles } }).map(error => error.field);
  assert.deepEqual(field([{ label: '1' }, { label: '1' }]), ['arenaObstacles']);
  assert.deepEqual(field([{ label: 'a' }, { label: 'A' }]), ['arenaObstacles']);
  assert.deepEqual(field([{ label: '5#2' }]), ['arenaObstacles']);
  assert.deepEqual(field([{ label: '1234567890123' }]), ['arenaObstacles']);
  assert.deepEqual(field([{ label: '1' }, { label: '2' }]), []);
});

test('arena TR seconds must be numbers >= 0, FEI seconds are not checked', () => {
  const obstacles = [{ label: '1', type: 'cone' }];
  const tr = (knockSec, incidentSec = {}) => validatePrecisionClassSettings({ format: 'arena', arena: { rules: 'TR', knockSec, incidentSec, obstacles } }).map(error => error.field);
  assert.deepEqual(tr('4', { groomReins: '20', whipChange: '0' }), []);
  assert.deepEqual(tr('4,5'), []);
  assert.deepEqual(tr('-1'), ['arenaSeconds']);
  assert.deepEqual(tr(''), ['arenaSeconds']);
  assert.deepEqual(tr('4', { wrongCourse: 'abc' }), ['arenaSeconds']);
  const fei = validatePrecisionClassSettings({ format: 'arena', arena: { rules: 'FEI', knockSec: '-1', obstacles } });
  assert.equal(fei.length, 0);
});

test('arena class still checks the manual port allowance; other formats keep the track checks', () => {
  const arena = validatePrecisionClassSettings({ format: 'arena', allowanceOverride: '-5', arena: { rules: 'FEI', obstacles: [{ label: '1' }] } });
  assert.deepEqual(arena.map(error => error.field), ['allowanceOverride']);
  const normal = validatePrecisionClassSettings({ format: 'normal', obstacleLabelsText: '1' }, { hasStandardTempo: true });
  assert.deepEqual(normal.map(error => error.field), ['trackLengthMeters']);
});

test('validatePrecisionAdminSettings validates an arena class by its obstacles', () => {
  const result = validatePrecisionAdminSettings({
    classes: {
      Arena: { format: 'arena', arena: { rules: 'FEI', obstacles: [{ label: '1', type: 'cone' }] } },
      Tom: { format: 'arena', arena: { rules: 'FEI', obstacles: [] } }
    }
  }, () => ({ hasStandardTempo: false }));
  assert.equal(result.classes.Arena, undefined);
  assert.deepEqual(result.classes.Tom.map(error => error.field), ['arenaObstacles']);
});
