import test from 'node:test';
import assert from 'node:assert/strict';

import { activeBottomNavTab, availablePhases, bottomNavTabs, officialTaskPage, phaseFamily } from '../js/ui/bottomNavUtils.js';
import { canOpenPage } from '../js/utils/roleAccess.js';

const keys = (tabs) => tabs.map(t => t.key);
const pages = (tabs) => tabs.map(t => t.page);

test('bottom nav: per category, with a competition chosen', () => {
    const comp = { hasCompetition: true, phase: 'marathon' };
    assert.deepEqual(keys(bottomNavTabs({ ...comp })), ['competition', 'starttider', 'live', 'results', 'menu']);
    assert.deepEqual(keys(bottomNavTabs({ ...comp, roles: ['publik'], signedIn: true })), ['competition', 'portal', 'live', 'results', 'menu']);
    assert.deepEqual(keys(bottomNavTabs({ ...comp, roles: ['marathon'], signedIn: true })), ['task', 'live', 'portal-official', 'results', 'menu']);
    assert.deepEqual(keys(bottomNavTabs({ ...comp, roles: ['vet'], signedIn: true })), ['vet', 'starttider', 'incidents', 'results', 'menu']);
    assert.deepEqual(keys(bottomNavTabs({ ...comp, roles: ['td'], signedIn: true })), ['incidents', 'secretariat', 'live', 'results', 'menu']);
    assert.deepEqual(keys(bottomNavTabs({ ...comp, roles: ['admin'], signedIn: true })), ['secretariat', 'starttider', 'live', 'admin', 'menu']);
});

test('bottom nav: the tabs follow the current discipline', () => {
    const base = { hasCompetition: true, roles: ['admin'], signedIn: true };
    assert.deepEqual(pages(bottomNavTabs({ ...base, phase: 'dressage' })).slice(0, 3), ['sekretariat-dressyr', 'starttider', 'dressyr-monitor']);
    assert.deepEqual(pages(bottomNavTabs({ ...base, phase: 'precision' })).slice(0, 3), ['sekretariat-precision', 'starttider', 'precision-monitor']);
    // Total: no live monitor, the results tab takes its place
    assert.deepEqual(pages(bottomNavTabs({ ...base, phase: 'total' })).slice(0, 3), ['sekretariat-precision', 'starttider', 'total-resultat']);
    // Field mode has no monitors
    assert.ok(!keys(bottomNavTabs({ hasCompetition: true, phase: 'dressage', fieldMode: true })).includes('live'));
});

test('bottom nav: no competition chosen', () => {
    assert.deepEqual(keys(bottomNavTabs({})), ['hub', 'manual', 'menu']);
    assert.deepEqual(keys(bottomNavTabs({ roles: ['admin'], signedIn: true })), ['hub', 'portal', 'manual', 'menu']);
});

test('bottom nav: every tab is a page the user may open', () => {
    for (const roles of [['publik'], ['marathon'], ['dressage', 'precision'], ['vet'], ['td'], ['speaker'], ['admin']]) {
        for (const signedIn of [false, true]) {
            for (const phase of ['dressage', 'marathon', 'precision', 'total']) {
                bottomNavTabs({ roles, signedIn, hasCompetition: true, phase }).filter(t => t.page).forEach((t) => {
                    assert.ok(canOpenPage(t.page, signedIn ? roles : ['publik']), `${roles} ${phase} ${t.page}`);
                });
            }
        }
    }
});

test('bottom nav: the official\'s own page', () => {
    assert.equal(officialTaskPage({ roles: ['marathon'] }), 'maraton-input');
    assert.equal(officialTaskPage({ roles: ['marathon'], lastTask: 'maraton-stages' }), 'maraton-stages');
    // A page the roles do not open is not remembered
    assert.equal(officialTaskPage({ roles: ['marathon'], lastTask: 'dressyr-input' }), 'maraton-input');
    assert.equal(officialTaskPage({ roles: ['dressage', 'precision'], phase: 'precision' }), 'precision-input');
    assert.equal(officialTaskPage({ roles: ['speaker'] }), 'speaker');
    assert.equal(officialTaskPage({ roles: ['funktionar'] }), 'official');
});

test('bottom nav: the active tab and the discipline row', () => {
    const tabs = bottomNavTabs({ roles: ['marathon'], signedIn: true, hasCompetition: true, phase: 'marathon' });
    assert.equal(activeBottomNavTab(tabs, '#maraton-input'), 'task');
    assert.equal(activeBottomNavTab(tabs, '#maraton-stages'), 'task');
    assert.equal(activeBottomNavTab(tabs, 'dressyr-results'), 'results');
    assert.equal(activeBottomNavTab(tabs, '#precision-monitor'), 'live');
    assert.equal(activeBottomNavTab(tabs, 'manual'), null);
    assert.equal(phaseFamily('dressyr-results'), 'results');
    assert.equal(phaseFamily('maraton-monitor'), 'live');
    assert.equal(phaseFamily('sekretariat-precision'), 'secretariat');
    assert.equal(phaseFamily('maraton-tider'), null);
});

test('bottom nav: an arena competition only offers precision pages', () => {
    const base = { hasCompetition: true, arena: true, phase: 'dressage' };
    assert.deepEqual(pages(bottomNavTabs({ ...base, roles: ['admin'], signedIn: true })).slice(0, 3), ['sekretariat-precision', 'starttider', 'precision-monitor']);
    assert.equal(bottomNavTabs({ ...base }).find(t => t.key === 'results').page, 'precision-results');
    assert.equal(officialTaskPage({ roles: ['dressage', 'precision'], phase: 'dressage', arena: true }), 'precision-input');
    assert.equal(officialTaskPage({ roles: ['dressage'], arena: true }), 'official');
    assert.equal(officialTaskPage({ roles: ['precision'], arena: true, lastTask: 'maraton-stages' }), 'precision-input');
    assert.deepEqual(availablePhases(true).map(([p]) => p), ['precision']);
    assert.equal(availablePhases(false).length, 4);
});
