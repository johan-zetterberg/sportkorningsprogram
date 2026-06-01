import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPageUnloadFunction,
  isStaleNavigation
} from '../js/services/navigationLifecycleUtils.js';

test('getPageUnloadFunction prefers __unload and falls back to unload', () => {
  const primary = () => 'primary';
  const fallback = () => 'fallback';

  assert.equal(getPageUnloadFunction({ __unload: primary, unload: fallback }), primary);
  assert.equal(getPageUnloadFunction({ unload: fallback }), fallback);
});

test('getPageUnloadFunction returns null for modules without cleanup', () => {
  assert.equal(getPageUnloadFunction(null), null);
  assert.equal(getPageUnloadFunction({}), null);
  assert.equal(getPageUnloadFunction({ __unload: true, unload: 'nope' }), null);
});

test('isStaleNavigation detects outdated navigation runs', () => {
  assert.equal(isStaleNavigation(1, 1), false);
  assert.equal(isStaleNavigation(1, 2), true);
});
