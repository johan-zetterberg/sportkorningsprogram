import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSnapshotErrorHandler } from '../js/services/listenerErrorUtils.js';

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
