// The notifications panel's pure helpers (js/utils/pushPanelUtils.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    IOS_GUIDE_STEP_KEYS,
    TOPIC_LABEL_KEYS,
    derivePushView,
    initialTopics,
    pushErrorKey,
    pushRoleForRoles,
    toggleTopic,
    topicsForRole,
    viewStatusKey
} from '../js/utils/pushPanelUtils.js';
import { DEFAULT_DRIVER_TOPICS, PUSH_TOPICS, devicePushRole } from '../js/utils/pushUtils.js';

test('topics offered per role', () => {
    // Drivers follow pauses too (owner decision); the vet has its own set
    assert.deepEqual(topicsForRole('driver'), ['startTimes', 'messages', 'vetDecision', 'pause']);
    assert.deepEqual(topicsForRole('official'), ['messages', 'pause']);
    assert.deepEqual(topicsForRole('vet'), ['vetDecision', 'declarationChanges', 'messages', 'pause']);
    assert.deepEqual(topicsForRole('staff'), ['messages', 'pause', 'declarationChanges', 'vetDecision']);
    assert.deepEqual(topicsForRole('device'), []);
    for (const role of ['driver', 'official', 'vet', 'staff']) {
        for (const topic of topicsForRole(role)) {
            assert.ok(PUSH_TOPICS.includes(topic), topic);
            assert.ok(TOPIC_LABEL_KEYS[topic], `label for ${topic}`);
        }
        assert.ok(!topicsForRole(role).includes('results'), 'results has no producer yet');
    }
});

test('staff is admin, secretariat or TD; other officials are officials', () => {
    assert.equal(pushRoleForRoles(['admin']), 'staff');
    assert.equal(pushRoleForRoles(['marathon', 'td']), 'staff');
    assert.equal(pushRoleForRoles(['sekretariat']), 'staff');
    assert.equal(pushRoleForRoles(['superadmin']), 'staff');
    assert.equal(pushRoleForRoles(['marathon', 'funktionar']), 'official');
    assert.equal(pushRoleForRoles([]), 'official');
    // The vet gets vet decisions and declaration changes; staff wins
    assert.equal(pushRoleForRoles(['vet']), 'vet');
    assert.equal(pushRoleForRoles(['vet', 'funktionar']), 'vet');
    assert.equal(pushRoleForRoles(['vet', 'td']), 'staff');
});

test('first topics: what the device has, else the role defaults', () => {
    assert.deepEqual(initialTopics('driver', []), ['startTimes', 'messages', 'vetDecision', 'pause']);
    assert.deepEqual(initialTopics('vet', []), ['vetDecision', 'declarationChanges', 'messages', 'pause']);
    assert.deepEqual(initialTopics('device', []), ['messages']);
    assert.deepEqual(initialTopics('driver', ['pause']), ['pause']);
});

test('toggling a topic keeps the ones the role is not offered', () => {
    assert.deepEqual(toggleTopic(['messages', 'pause'], 'startTimes', true).sort(), ['messages', 'pause', 'startTimes']);
    assert.deepEqual(toggleTopic(['messages', 'pause'], 'messages', false), ['pause']);
    assert.deepEqual(toggleTopic(undefined, 'messages', true), ['messages']);
});

test('the panel view follows the device state and the iPhone decision', () => {
    const base = { available: true, supported: true, permission: 'default', enabled: false };
    // No VAPID key yet: quiet, whatever the device
    assert.equal(derivePushView({ ...base, available: false }, 'ok'), 'not-available');
    assert.equal(derivePushView({ ...base, available: false }, 'add-to-home-screen'), 'not-available');
    assert.equal(derivePushView(base, 'unsupported-version'), 'ios-old');
    assert.equal(derivePushView({ ...base, supported: false }, 'add-to-home-screen'), 'ios-guide');
    assert.equal(derivePushView({ ...base, supported: false }, 'not-ios'), 'unsupported');
    assert.equal(derivePushView({ ...base, permission: 'denied' }, 'not-ios'), 'denied');
    assert.equal(derivePushView(base, 'not-ios'), 'off');
    assert.equal(derivePushView({ ...base, enabled: true, permission: 'granted' }, 'ok'), 'on');
});

test('a competition-scoped panel is on only when the device follows it', () => {
    const on = { available: true, supported: true, permission: 'granted', enabled: true, following: false };
    assert.equal(derivePushView(on, 'not-ios', { competitionId: 'c1' }), 'off');
    assert.equal(derivePushView({ ...on, following: true }, 'not-ios', { competitionId: 'c1' }), 'on');
    assert.equal(derivePushView(on, 'not-ios'), 'on');
});

test('status text and error keys', () => {
    assert.equal(viewStatusKey('not-available'), 'push_status_not_available');
    assert.equal(viewStatusKey('unknown'), 'push_status_off');
    assert.equal(pushErrorKey('push/permission-denied'), 'push_err_denied');
    assert.equal(pushErrorKey('push/token-failed'), 'push_err_token');
    assert.equal(pushErrorKey('something'), 'push_err_generic');
    assert.equal(IOS_GUIDE_STEP_KEYS.length, 4);
});

test('the device switch uses the role from the competition roles', () => {
    assert.equal(devicePushRole(['admin'], true), 'staff');
    assert.equal(devicePushRole(['td'], true), 'staff');
    assert.equal(devicePushRole(['vet'], true), 'vet');
    assert.equal(devicePushRole(['marathon'], true), 'official');
    assert.equal(devicePushRole(['publik'], true), 'device');
    assert.equal(devicePushRole([], true), 'device');
    assert.equal(devicePushRole(['admin'], false), 'device');
    assert.ok(DEFAULT_DRIVER_TOPICS.includes('pause'));
});
