import test from 'node:test';
import assert from 'node:assert/strict';

import { legacyPrivateFields, mergeOfficials, splitOfficialData } from '../js/services/officialPrivacyUtils.js';

test('contact details go to the private part, the rest stays public', () => {
    const { publicData, privateData } = splitOfficialData({
        id: 'o1', name: 'Anna', role: 'Hinderdomare', roles: ['marathon'],
        email: ' Anna@Example.com ', phone: '070', iceName: 'Bo', icePhone: '071', diet: 'Vego', notes: 'PM'
    });
    assert.deepEqual(publicData, { id: 'o1', name: 'Anna', role: 'Hinderdomare', roles: ['marathon'] });
    assert.deepEqual(privateData, { email: 'anna@example.com', phone: '070', iceName: 'Bo', icePhone: '071', diet: 'Vego', notes: 'PM' });
});

test('admins see officials with their contact details merged in', () => {
    const merged = mergeOfficials(
        [{ id: 'o1', name: 'Anna' }, { id: 'o2', name: 'Bo' }],
        [{ id: 'o1', email: 'anna@example.com', phone: '070' }]
    );
    assert.deepEqual(merged, [{ id: 'o1', name: 'Anna', email: 'anna@example.com', phone: '070' }, { id: 'o2', name: 'Bo' }]);
});

test('contact details still on the public document are found for the move', () => {
    assert.deepEqual(legacyPrivateFields({ name: 'Anna', phone: '070', email: 'a@b.se' }), ['email', 'phone']);
    assert.deepEqual(legacyPrivateFields({ name: 'Anna' }), []);
});
