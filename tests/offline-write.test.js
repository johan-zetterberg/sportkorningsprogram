import test from 'node:test';
import assert from 'node:assert/strict';

import { awaitWriteOrQueue, queuedNotice } from '../js/utils/offlineWrite.js';

test('an acknowledged write is "saved"', async () => {
    assert.equal(await awaitWriteOrQueue(Promise.resolve(), { timeoutMs: 50 }), 'saved');
});

test('a write without an answer (no signal) is "queued" after the wait, not a frozen page', async () => {
    const neverAcked = new Promise(() => { });
    const started = Date.now();
    assert.equal(await awaitWriteOrQueue(neverAcked, { timeoutMs: 30 }), 'queued');
    assert.ok(Date.now() - started < 1000);
    assert.match(queuedNotice('queued'), /skickas när nätet är tillbaka/);
    assert.equal(queuedNotice('saved'), '');
});

test('a write refused at once is an error for the caller', async () => {
    const refused = Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await assert.rejects(awaitWriteOrQueue(refused, { timeoutMs: 50 }), /denied/);
});

test('a queued write refused later is reported, not left unhandled', async () => {
    let reject;
    const later = new Promise((_, r) => { reject = r; });
    const reported = [];
    const originalError = console.error;
    console.error = () => { };
    try {
        assert.equal(await awaitWriteOrQueue(later, { timeoutMs: 10, onLateError: (e) => reported.push(e.message) }), 'queued');
        reject(new Error('locked'));
        await new Promise(r => setTimeout(r, 20));
    } finally {
        console.error = originalError;
    }
    assert.deepEqual(reported, ['locked']);
});
