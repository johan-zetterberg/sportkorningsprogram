// The bottom navigation bar on phones (js/ui/bottomNav.js): which tabs it
// shows and which one is active. Pure, so it can be tested without a page.

import { canOpenPage } from '../utils/roleAccess.js';

// Pages that light up a tab besides the tab's own page
const RESULT_PAGES = ['total-resultat', 'dressyr-results', 'maraton-results', 'precision-results',
    'maraton-tider', 'prize-giving', 'dressyr-monitor', 'maraton-monitor', 'precision-monitor'];
const START_PAGES = ['starttider', 'deltagare', 'hastar'];
const ADMIN_PAGES = ['admin', 'ekipage', 'dressyr-admin', 'maraton-admin', 'precision-admin',
    'sekretariat-dressyr', 'sekretariat-maraton', 'sekretariat-precision'];
const OFFICIAL_PAGES = ['official', 'dressyr-input', 'maraton-input', 'maraton-stages', 'observator-input',
    'precision-input', 'precision-split-input', 'vagnbredd', 'speaker', 'reports', 'incidents'];

/**
 * The fourth tab follows who is signed in: an admin gets Admin, an official
 * their task (the official portal), the vet the vet page, any other signed-in
 * user (a driver) the portal; signed out it is the competition's public info.
 */
export function bottomNavRoleTab({ roles = ['publik'], signedIn = false } = {}) {
    if (signedIn && canOpenPage('admin', roles)) {
        return { key: 'admin', href: '#admin', labelKey: 'bottom_nav_admin', icon: 'admin', pages: ADMIN_PAGES };
    }
    if (signedIn && canOpenPage('official', roles)) {
        return { key: 'official', href: '#official', labelKey: 'bottom_nav_my_task', icon: 'task', pages: OFFICIAL_PAGES };
    }
    if (signedIn && canOpenPage('vet-check', roles)) {
        return { key: 'vet-check', href: '#vet-check', labelKey: 'bottom_nav_vet', icon: 'task', pages: ['vet-check', 'incidents'] };
    }
    if (signedIn) {
        return { key: 'portal', href: '#portal', labelKey: 'bottom_nav_portal', icon: 'person', pages: ['portal'] };
    }
    return { key: 'competition-center', href: '#competition-center', labelKey: 'bottom_nav_info', icon: 'info', pages: ['competition-center'] };
}

/** The tabs, left to right; the last one opens the menu */
export function bottomNavTabs(options = {}) {
    return [
        { key: 'hub', href: '#hub', labelKey: 'bottom_nav_home', icon: 'home', pages: ['hub'] },
        { key: 'starttider', href: '#starttider', labelKey: 'bottom_nav_start_times', icon: 'clock', pages: START_PAGES },
        { key: 'total-resultat', href: '#total-resultat', labelKey: 'bottom_nav_results', icon: 'trophy', pages: RESULT_PAGES },
        bottomNavRoleTab(options),
        { key: 'menu', href: null, labelKey: 'bottom_nav_menu', icon: 'menu', pages: [] }
    ];
}

/** The key of the tab for the page shown, or null (a page no tab stands for) */
export function activeBottomNavTab(tabs = [], pageKey = '') {
    const page = String(pageKey || '').replace(/^#/, '').split('?')[0] || 'hub';
    return tabs.find((tab) => tab.pages.includes(page))?.key || null;
}
