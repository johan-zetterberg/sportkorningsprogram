import test from 'node:test';
import assert from 'node:assert/strict';

import { activeBottomNavTab, bottomNavRoleTab, bottomNavTabs } from '../js/ui/bottomNavUtils.js';
import { canOpenPage } from '../js/utils/roleAccess.js';

test('bottom nav: the fourth tab follows who is signed in', () => {
    assert.equal(bottomNavRoleTab({ signedIn: false }).key, 'competition-center');
    assert.equal(bottomNavRoleTab({ roles: ['publik'], signedIn: true }).key, 'portal');
    assert.equal(bottomNavRoleTab({ roles: ['marathon'], signedIn: true }).key, 'official');
    assert.equal(bottomNavRoleTab({ roles: ['td'], signedIn: true }).key, 'official');
    assert.equal(bottomNavRoleTab({ roles: ['vet'], signedIn: true }).key, 'vet-check');
    assert.equal(bottomNavRoleTab({ roles: ['admin'], signedIn: true }).key, 'admin');
    assert.equal(bottomNavRoleTab({ roles: ['superadmin'], signedIn: true }).key, 'admin');
});

test('bottom nav: every tab is a page the user may open', () => {
    for (const roles of [['publik'], ['marathon'], ['vet'], ['td'], ['speaker'], ['admin']]) {
        for (const signedIn of [false, true]) {
            const tabs = bottomNavTabs({ roles, signedIn });
            assert.equal(tabs.length, 5);
            tabs.filter(tab => tab.href).forEach((tab) => {
                assert.ok(canOpenPage(tab.key, signedIn ? roles : ['publik']), `${roles} ${tab.key}`);
            });
        }
    }
});

test('bottom nav: the active tab covers related pages', () => {
    const tabs = bottomNavTabs({ roles: ['marathon'], signedIn: true });
    assert.equal(activeBottomNavTab(tabs, '#maraton-results'), 'total-resultat');
    assert.equal(activeBottomNavTab(tabs, 'maraton-input'), 'official');
    assert.equal(activeBottomNavTab(tabs, '#starttider?id=x'), 'starttider');
    assert.equal(activeBottomNavTab(tabs, ''), 'hub');
    assert.equal(activeBottomNavTab(tabs, 'manual'), null);
});
