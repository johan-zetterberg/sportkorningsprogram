import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UPDATE_CHECK_INTERVAL_MS,
  MIN_UPDATE_CHECK_GAP_MS,
  shouldCheckForUpdate,
  isOtherVersion,
  decideOnNewVersion,
  isEditingElement
} from '../js/utils/appUpdateLogic.js';
import { registerUnsavedWork, unsavedWorkReasons } from '../js/utils/unsavedWork.js';

const MIN = 60 * 1000;

test('update checks: never offline or hidden, throttled, the periodic one always passes', () => {
  assert.ok(UPDATE_CHECK_INTERVAL_MS >= 30 * MIN && UPDATE_CHECK_INTERVAL_MS <= 60 * MIN);
  assert.ok(MIN_UPDATE_CHECK_GAP_MS < UPDATE_CHECK_INTERVAL_MS);

  assert.equal(shouldCheckForUpdate({ now: 0, lastCheckAt: null }), true);
  assert.equal(shouldCheckForUpdate({ now: 0, lastCheckAt: null, online: false }), false);
  assert.equal(shouldCheckForUpdate({ now: 0, lastCheckAt: null, hidden: true }), false);
  const last = 1_000_000;
  assert.equal(shouldCheckForUpdate({ now: last + 2 * MIN, lastCheckAt: last }), false);
  assert.equal(shouldCheckForUpdate({ now: last + MIN_UPDATE_CHECK_GAP_MS, lastCheckAt: last }), true);
  assert.equal(shouldCheckForUpdate({ now: last + UPDATE_CHECK_INTERVAL_MS, lastCheckAt: last }), true);
  assert.equal(shouldCheckForUpdate({ now: last + UPDATE_CHECK_INTERVAL_MS, lastCheckAt: last, online: false }), false);
});

test('version mismatch: an unknown worker version is not another version', () => {
  assert.equal(isOtherVersion('v79', 'v80'), true);
  assert.equal(isOtherVersion('v79', 'v79'), false);
  assert.equal(isOtherVersion('v79', ''), false);
});

test('new version: reload an idle tab, ask a busy one, never reload twice for one version', () => {
  assert.equal(decideOnNewVersion({ busyReasons: [], reloadedFor: null, version: 'v80' }), 'reload');
  assert.equal(decideOnNewVersion({ busyReasons: [], reloadedFor: 'v79', version: 'v80' }), 'reload');
  assert.equal(decideOnNewVersion({ busyReasons: ['maraton-input'], version: 'v80' }), 'prompt');
  assert.equal(decideOnNewVersion({ busyReasons: ['sync'], version: 'v80' }), 'prompt');
  assert.equal(decideOnNewVersion({ busyReasons: [], reloadedFor: 'v80', version: 'v80' }), 'prompt');
});

test('editing: text fields count, buttons and read-only fields do not', () => {
  assert.equal(isEditingElement(null), false);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isEditingElement({ tagName: 'INPUT' }), true);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'number' }), true);
  assert.equal(isEditingElement({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditingElement({ tagName: 'SELECT' }), true);
  assert.equal(isEditingElement({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'submit' }), false);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'text', readOnly: true }), false);
  assert.equal(isEditingElement({ tagName: 'TEXTAREA', disabled: true }), false);
  assert.equal(isEditingElement({ tagName: 'BUTTON' }), false);
  assert.equal(isEditingElement({ tagName: 'BODY' }), false);
});

test('unsaved work: registered checks, a failing check counts as work, unregister', () => {
  let running = false;
  const off = registerUnsavedWork('test-clock', () => running);
  const offBroken = registerUnsavedWork('test-broken', () => { throw new Error('x'); });
  assert.deepEqual(unsavedWorkReasons(), ['test-broken']);
  running = true;
  assert.deepEqual(unsavedWorkReasons(), ['test-clock', 'test-broken']);
  off();
  offBroken();
  assert.deepEqual(unsavedWorkReasons(), []);
});
