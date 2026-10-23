import test from 'node:test';
import assert from 'node:assert/strict';

import { mayEnterErrorPoints } from '../js/pages/dressage/dressageErrorPoints.js';

test('errors of course: only the judge at C enters them when C judges the class', () => {
  assert.equal(mayEnterErrorPoints({ judgePosition: 'C', classPositions: ['C', 'E', 'B'] }), true);
  assert.equal(mayEnterErrorPoints({ judgePosition: 'E', classPositions: ['C', 'E', 'B'] }), false);
  assert.equal(mayEnterErrorPoints({ judgePosition: 'b', classPositions: ['c', 'b'] }), false);
});

test('errors of course: a single judge, or a class without C, enters them', () => {
  assert.equal(mayEnterErrorPoints({ judgePosition: 'E', classPositions: ['E'] }), true);
  assert.equal(mayEnterErrorPoints({ judgePosition: 'E', classPositions: [] }), true);
  assert.equal(mayEnterErrorPoints({ judgePosition: 'E', classPositions: ['E', 'B'] }), true);
  assert.equal(mayEnterErrorPoints({}), true);
});
