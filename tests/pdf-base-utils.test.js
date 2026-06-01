import test from 'node:test';
import assert from 'node:assert/strict';

import { fitImageDimensions } from '../js/pdf/pdfImageUtils.js';

test('fitImageDimensions fits wide logos inside a bounded box', () => {
  const fitted = fitImageDimensions({ w: 1200, h: 200 }, 110, 70);

  assert.equal(fitted.w, 110);
  assert.equal(Math.round(fitted.h * 100) / 100, 18.33);
});

test('fitImageDimensions fits tall logos inside a bounded box', () => {
  const fitted = fitImageDimensions({ w: 200, h: 800 }, 110, 70);

  assert.equal(fitted.h, 70);
  assert.equal(fitted.w, 17.5);
});

test('fitImageDimensions falls back to square ratio for missing dimensions', () => {
  assert.deepEqual(fitImageDimensions({}, 90, 50), { w: 50, h: 50 });
});
