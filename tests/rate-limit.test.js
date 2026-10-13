import test from 'node:test';
import assert from 'node:assert/strict';

import { nextCounter } from '../functions/src/rateLimit.js';

const HOUR = 60 * 60 * 1000;

test('calls are counted within the window and refused at the limit', () => {
    let state = null;
    for (let i = 1; i <= 3; i++) {
        const r = nextCounter(state, 1000 + i, 3, HOUR);
        assert.equal(r.allowed, true);
        assert.equal(r.next.count, i);
        state = r.next;
    }
    const refused = nextCounter(state, 2000, 3, HOUR);
    assert.equal(refused.allowed, false);
    assert.deepEqual(refused.next, state);
});

test('a new window starts over', () => {
    const full = { windowStart: 0, count: 5 };
    const r = nextCounter(full, HOUR + 1, 5, HOUR);
    assert.equal(r.allowed, true);
    assert.deepEqual(r.next, { windowStart: HOUR + 1, count: 1 });
});
