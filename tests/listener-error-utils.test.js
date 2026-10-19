import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSnapshotErrorHandler,
  resilientBackoffMs,
  resilientSnapshot,
  RESILIENT_BACKOFF_MS
} from '../js/services/listenerErrorUtils.js';

// Silences the expected error logging for the duration of fn
function quietly(fn) {
  const originalError = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = originalError; }
}

// A fake listener source: each subscribe() is one listener whose callbacks
// the test fires by hand; timers run when the test says so
function harness() {
  const subs = [];
  const timers = [];
  const subscribe = (onNext, onError) => {
    const sub = { onNext, onError, unsubscribed: false };
    subs.push(sub);
    return () => { sub.unsubscribed = true; };
  };
  const setTimer = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; };
  const clearTimer = (t) => { t.cleared = true; };
  const runTimers = () => timers.splice(0).forEach(t => { if (!t.cleared) t.fn(); });
  return { subs, timers, subscribe, setTimer, clearTimer, runTimers };
}

test('buildSnapshotErrorHandler with onError reports instead of handing an empty value', () => {
  const received = [];
  const errors = [];
  quietly(() => buildSnapshotErrorHandler('x', (v) => received.push(v), [], (e) => errors.push(e))(new Error('denied')));
  assert.deepEqual(received, []);
  assert.equal(errors.length, 1);
});

test('resilientBackoffMs grows and stays at the last step', () => {
  assert.equal(resilientBackoffMs(0), RESILIENT_BACKOFF_MS[0]);
  assert.equal(resilientBackoffMs(1), RESILIENT_BACKOFF_MS[1]);
  assert.equal(resilientBackoffMs(99), RESILIENT_BACKOFF_MS[RESILIENT_BACKOFF_MS.length - 1]);
  assert.equal(resilientBackoffMs(-3), RESILIENT_BACKOFF_MS[0]);
  assert.equal(resilientBackoffMs(2, [10, 20]), 20);
});

test('resilientSnapshot keeps the data, resubscribes with backoff and reports recovery', () => {
  const h = harness();
  const data = [];
  const statuses = [];
  const stop = resilientSnapshot({
    name: 't',
    subscribe: h.subscribe,
    onData: (v, meta) => data.push([v, meta.fresh]),
    onStatus: (s) => statuses.push(s.ok ? 'ok' : `fail:${s.retryInMs}`),
    backoffMs: [100, 200],
    setTimer: h.setTimer,
    clearTimer: h.clearTimer
  });
  assert.equal(h.subs.length, 1);
  h.subs[0].onNext('a');
  h.subs[0].onNext('b');
  assert.deepEqual(data, [['a', true], ['b', false]]);

  // Error: no empty value handed on, the dead listener is dropped, retry scheduled
  quietly(() => h.subs[0].onError(new Error('unavailable')));
  assert.deepEqual(data.length, 2);
  assert.equal(h.subs[0].unsubscribed, true);
  assert.deepEqual(statuses, ['fail:100']);
  assert.equal(h.timers[0].ms, 100);

  // The retry fails as well: the wait grows
  h.runTimers();
  assert.equal(h.subs.length, 2);
  quietly(() => h.subs[1].onError(new Error('unavailable')));
  assert.deepEqual(statuses, ['fail:100', 'fail:200']);

  // Late callbacks from a dropped listener are ignored
  h.subs[0].onNext('stale');
  assert.equal(data.length, 2);

  // Third subscription works: recovery reported once, first value is fresh
  h.runTimers();
  h.subs[2].onNext('c');
  h.subs[2].onNext('d');
  assert.deepEqual(statuses, ['fail:100', 'fail:200', 'ok']);
  assert.deepEqual(data.slice(2), [['c', true], ['d', false]]);

  // After recovery the backoff starts over
  quietly(() => h.subs[2].onError(new Error('again')));
  assert.equal(statuses.at(-1), 'fail:100');

  // stop() cancels the pending retry and nothing subscribes again
  stop();
  assert.equal(h.timers.at(-1).cleared, true);
  h.runTimers();
  assert.equal(h.subs.length, 3);
});

test('resilientSnapshot treats a throwing subscribe as an error', () => {
  const h = harness();
  const statuses = [];
  let calls = 0;
  quietly(() => resilientSnapshot({
    subscribe: () => { calls++; throw new Error('bad ref'); },
    onData: () => {},
    onStatus: (s) => statuses.push(s.ok),
    backoffMs: [5],
    setTimer: h.setTimer,
    clearTimer: h.clearTimer
  }));
  assert.equal(calls, 1);
  assert.deepEqual(statuses, [false]);
  assert.equal(h.timers.length, 1);
});

test('buildSnapshotErrorHandler logs and sends fallback data to callback', () => {
  const originalError = console.error;
  const logged = [];
  const received = [];

  console.error = (...args) => logged.push(args);
  try {
    const handler = buildSnapshotErrorHandler('testListener', (value) => received.push(value), []);
    const error = new Error('offline');

    handler(error);

    assert.deepEqual(received, [[]]);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], 'testListener listener error:');
    assert.equal(logged[0][1], error);
  } finally {
    console.error = originalError;
  }
});

test('buildSnapshotErrorHandler tolerates missing callback', () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => {
      buildSnapshotErrorHandler('testListener', null, [])(new Error('offline'));
    });
  } finally {
    console.error = originalError;
  }
});
