import test from 'node:test';
import assert from 'node:assert/strict';

import { offsetFromSamples, serverNow } from '../js/utils/serverClock.js';

test('the fastest round trip gives the offset, answered halfway', () => {
    // Device 2 s behind the server
    const samples = [
        { sentAt: 1000, receivedAt: 1900, serverMs: 3500 },   // slow (900 ms)
        { sentAt: 5000, receivedAt: 5100, serverMs: 7050 },   // fast (100 ms): 7050 - 5050
        { sentAt: 9000, receivedAt: 9400, serverMs: 11100 }
    ];
    assert.equal(offsetFromSamples(samples), 2000);
});

test('round trips that are too slow or broken are not used', () => {
    assert.equal(offsetFromSamples([{ sentAt: 0, receivedAt: 5000, serverMs: 9000 }]), null);
    assert.equal(offsetFromSamples([{ sentAt: 10, receivedAt: 5, serverMs: 9000 }]), null);
    assert.equal(offsetFromSamples([{ sentAt: 0, receivedAt: 50, serverMs: NaN }]), null);
    assert.equal(offsetFromSamples([]), null);
});

test('without a measurement the device clock is used', () => {
    const before = Date.now();
    const now = serverNow();
    assert.ok(now >= before && now <= Date.now());
});
