import test from 'node:test';
import assert from 'node:assert/strict';

import { isDocumentForDriver, isMessageForDriver, toPlainTimestamps } from '../functions/src/driverInbox.js';

test('a driver sees public messages, messages for all drivers and their own', () => {
    const mine = ['12'];
    assert.equal(isMessageForDriver({ audience: { public: true, drivers: false } }, mine), true);
    assert.equal(isMessageForDriver({ audience: { public: false, drivers: true } }, mine), true);
    assert.equal(isMessageForDriver({ audience: { public: false, drivers: true }, targetStartNumbers: ['12', '14'] }, mine), true);
    assert.equal(isMessageForDriver({ audience: { public: false, drivers: true }, targetStartNumbers: ['14'] }, mine), false);
    // Legacy single-target message
    assert.equal(isMessageForDriver({ targetStartNumber: '14' }, mine), false);
    assert.equal(isMessageForDriver({ targetStartNumber: 12 }, mine), true);
    assert.equal(isMessageForDriver({}, mine), true);
});

test('messages for the officials reach no driver', () => {
    const mine = ['12'];
    assert.equal(isMessageForDriver({ audience: { public: false, drivers: false, officials: true, officialRoles: [] } }, mine), false);
    assert.equal(isMessageForDriver({ audience: { public: false, officials: true, officialRoles: ['vet'] } }, mine), false);
    // Public means everyone: drivers too
    assert.equal(isMessageForDriver({ audience: { public: true, drivers: true, officials: false } }, mine), true);
});

test('documents: public or for drivers, legacy documents for everyone', () => {
    assert.equal(isDocumentForDriver({ audience: { public: false, drivers: true } }), true);
    assert.equal(isDocumentForDriver({ audience: { public: false, drivers: false } }), false);
    assert.equal(isDocumentForDriver({}), true);
});

test('timestamps are sent as milliseconds', () => {
    assert.deepEqual(toPlainTimestamps({ title: 'x', timestamp: { toMillis: () => 1700 } }), { title: 'x', timestamp: 1700 });
});
