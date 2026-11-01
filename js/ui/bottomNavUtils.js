// The bottom navigation bar on phones (js/ui/bottomNav.js): which tabs it
// shows and which one is active. The tabs follow who is signed in and the
// competition's current discipline (js/utils/currentDiscipline.js). Pure, so
// it can be tested without a page.

import { canOpenPage } from '../utils/roleAccess.js';

// Per phase: its results, live monitor and secretariat page
export const PHASE_PAGES = Object.freeze({
    dressage: { results: 'dressyr-results', live: 'dressyr-monitor', secretariat: 'sekretariat-dressyr', input: 'dressyr-input' },
    marathon: { results: 'maraton-results', live: 'maraton-monitor', secretariat: 'sekretariat-maraton', input: 'maraton-input' },
    precision: { results: 'precision-results', live: 'precision-monitor', secretariat: 'sekretariat-precision', input: 'precision-input' },
    total: { results: 'total-resultat', live: null, secretariat: 'sekretariat-precision', input: null }
});

const RESULT_PAGES = ['dressyr-results', 'maraton-results', 'precision-results', 'total-resultat', 'maraton-tider', 'prize-giving'];
const LIVE_PAGES = ['dressyr-monitor', 'maraton-monitor', 'precision-monitor'];
const SECRETARIAT_PAGES = ['sekretariat-dressyr', 'sekretariat-maraton', 'sekretariat-precision'];
const INPUT_PAGES = ['dressyr-input', 'maraton-input', 'maraton-stages', 'observator-input',
    'precision-input', 'precision-split-input', 'vagnbredd', 'speaker'];
const ADMIN_PAGES = ['admin', 'ekipage', 'dressyr-admin', 'maraton-admin', 'precision-admin', 'reports'];

// An official's own page per role, the first one their roles open
const ROLE_INPUT = [['dressage', 'dressyr-input'], ['marathon', 'maraton-input'], ['precision', 'precision-input'], ['speaker', 'speaker']];

/** Whether a page is an input page an official returns to (the "Min uppgift" tab) */
export function isTaskPage(pageKey) {
    return INPUT_PAGES.includes(pageKey);
}

/**
 * The official's input page: the one last opened on this device (it may be
 * Etapper or Observatör, not only Inmatning Hinder), else the role's own
 * page, the current discipline's first when the roles hold several; else
 * the official portal.
 */
export function officialTaskPage({ roles = [], phase = 'dressage', lastTask = null } = {}) {
    if (lastTask && isTaskPage(lastTask) && canOpenPage(lastTask, roles)) return lastTask;
    const own = ROLE_INPUT.filter(([role, page]) => roles.includes(role) && canOpenPage(page, roles)).map(([, page]) => page);
    const current = PHASE_PAGES[phase]?.input;
    if (current && own.includes(current)) return current;
    return own[0] || 'official';
}

const tab = (key, page, labelKey, icon, pages = [page]) => ({ key, href: `#${page}`, page, labelKey, icon, pages });
const menuTab = () => ({ key: 'menu', href: null, page: null, labelKey: 'bottom_nav_menu', icon: 'menu', pages: [] });

/**
 * The tabs, left to right; the last one opens the menu.
 * roles / signedIn: the user; hasCompetition: a competition is chosen;
 * phase: its current discipline; fieldMode: no live monitors;
 * lastTask: the input page this device last opened.
 */
export function bottomNavTabs({ roles = ['publik'], signedIn = false, hasCompetition = false, phase = 'dressage', fieldMode = false, lastTask = null } = {}) {
    const can = (page) => canOpenPage(page, signedIn ? roles : ['publik']);
    if (!hasCompetition) {
        return [
            tab('hub', 'hub', 'bottom_nav_home', 'home'),
            ...(signedIn ? [tab('portal', 'portal', 'bottom_nav_portal', 'person')] : []),
            tab('manual', 'manual', 'bottom_nav_help', 'info'),
            menuTab()
        ];
    }
    const pages = PHASE_PAGES[phase] || PHASE_PAGES.dressage;
    const results = tab('results', pages.results, 'bottom_nav_results', 'trophy', RESULT_PAGES);
    const live = pages.live && !fieldMode ? tab('live', pages.live, 'bottom_nav_live', 'live', LIVE_PAGES) : null;
    const startTimes = tab('starttider', 'starttider', 'bottom_nav_start_times', 'clock', ['starttider', 'deltagare', 'hastar']);
    const competition = tab('competition', 'competition-center', 'bottom_nav_competition', 'flag', ['competition-center']);
    const secretariat = tab('secretariat', pages.secretariat, 'bottom_nav_secretariat', 'desk', SECRETARIAT_PAGES);
    const incidents = tab('incidents', 'incidents', 'bottom_nav_incidents', 'log', ['incidents']);
    const list = (...tabs) => [...tabs.filter(Boolean).filter(t => can(t.page)), menuTab()];

    if (signedIn && can('admin')) {
        return list(secretariat, startTimes, live || results, tab('admin', 'admin', 'bottom_nav_admin', 'admin', ADMIN_PAGES));
    }
    if (signedIn && roles.includes('td')) {
        return list(incidents, secretariat, live, results);
    }
    if (signedIn && can('official')) {
        const task = officialTaskPage({ roles, phase, lastTask });
        const taskTab = task === 'official'
            ? tab('task', 'official', 'bottom_nav_my_task', 'task', ['official'])
            : tab('task', task, 'bottom_nav_my_task', 'task', INPUT_PAGES);
        const portal = task === 'official' ? startTimes : tab('portal-official', 'official', 'bottom_nav_messages', 'chat', ['official']);
        return list(taskTab, live || startTimes, portal, results);
    }
    if (signedIn && can('vet-check')) {
        return list(tab('vet', 'vet-check', 'bottom_nav_vet', 'task'), startTimes, incidents, results);
    }
    if (signedIn) {
        return list(competition, tab('portal', 'portal', 'bottom_nav_my_starts', 'person'), live || startTimes, results);
    }
    return list(competition, startTimes, live, results);
}

/** The key of the tab for the page shown, or null (a page no tab stands for) */
export function activeBottomNavTab(tabs = [], pageKey = '') {
    const page = String(pageKey || '').replace(/^#/, '').split('?')[0] || 'hub';
    return tabs.find((t) => t.page === page)?.key
        || tabs.find((t) => t.pages.includes(page))?.key
        || null;
}

/** The pages of one kind for the discipline row (results / live / secretariat) */
export function phaseFamily(pageKey) {
    if (RESULT_PAGES.slice(0, 4).includes(pageKey)) return 'results';
    if (LIVE_PAGES.includes(pageKey)) return 'live';
    if (SECRETARIAT_PAGES.includes(pageKey)) return 'secretariat';
    return null;
}
