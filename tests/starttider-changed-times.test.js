import test from 'node:test';
import assert from 'node:assert/strict';

import { getChangedTimesPayload } from '../js/pages/admin/starttiderUtils.js';

test('only start numbers changed since loading are saved', () => {
    const loaded = { 1: { dressage: '09:00' }, 2: { dressage: '09:07' }, 3: { dressage: '09:14' } };
    const now = { 1: { dressage: '09:00' }, 2: { dressage: '09:10' }, 3: { dressage: '09:14' }, 4: { dressage: '09:21' } };
    Object.defineProperty(now, 'published', { value: { dressage: true }, enumerable: false });
    assert.deepEqual(getChangedTimesPayload(now, loaded), { 2: { dressage: '09:10' }, 4: { dressage: '09:21' } });
    assert.deepEqual(getChangedTimesPayload(loaded, loaded), {});
});