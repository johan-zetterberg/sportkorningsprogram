// The bottom navigation bar on phones (shown below 768 px, css/app-shell.css).
// The tabs follow the roles and the competition's current discipline
// (bottomNavUtils.js, js/utils/currentDiscipline.js):
// authService.updateUIVisibility sends the roles with 'app-roles-change',
// main.setGlobalState the competition with 'app-competition-change', the
// router the page with 'app-route-change'.

import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { currentDiscipline } from '../utils/currentDiscipline.js';
import { getConfig } from '../services/competitionService.js';
import { activeBottomNavTab, bottomNavTabs, isTaskPage } from './bottomNavUtils.js';

const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    trophy: '<path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3"/><path d="M12 12v4M8.5 20h7M10 16h4v4h-4z"/>',
    admin: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    task: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12l2 2 4-4"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    desk: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    log: '<path d="M7 4h10a1 1 0 0 1 1 1v15H6V5a1 1 0 0 1 1-1Z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
    chat: '<path d="M5 5h14v10H10l-4 4v-4H5z"/>'
};

let state = { roles: ['publik'], signedIn: false, pageKey: '', competition: null, times: {} };

const lastTaskKey = (compId) => `bottomNavTask:${compId}`;
function readLastTask(compId) {
    try { return compId ? localStorage.getItem(lastTaskKey(compId)) : null; } catch (_) { return null; }
}

/** The competition's current phase (dressage / marathon / precision / total) */
export function getCurrentPhase() {
    if (state.competition?.competitionKind === 'arena') return 'precision';
    return currentDiscipline({ times: state.times, override: state.competition?.currentPhase || null });
}

async function loadStartTimes(compId) {
    try {
        const cfg = await getConfig(compId, 'startTimes');
        if (state.competition?.id !== compId) return;
        state = { ...state, times: cfg?.times || {} };
        render();
        try { document.dispatchEvent(new CustomEvent('app-phase-change', { detail: { phase: getCurrentPhase() } })); } catch (_) { }
    } catch (_) { /* no start times: the phase falls back to dressage */ }
}

const iconSvg = (name) => `<svg class="app-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

function render() {
    const host = document.getElementById('bottomNav');
    if (!host) return;
    const comp = state.competition;
    const tabs = bottomNavTabs({
        roles: state.roles,
        signedIn: state.signedIn,
        hasCompetition: !!comp?.id,
        phase: getCurrentPhase(),
        fieldMode: comp?.competitionMode === 'field',
        arena: comp?.competitionKind === 'arena',
        lastTask: readLastTask(comp?.id)
    });
    const active = activeBottomNavTab(tabs, state.pageKey);
    const menuOpen = document.getElementById('menu-toggle')?.getAttribute('aria-expanded') === 'true';
    host.setAttribute('aria-label', t('bottom_nav_label'));
    // The same tabs and labels: only the marks change. The tabs are not
    // rebuilt under a tap (the tapped element would leave the page before the
    // click reaches the window, which then took it for a click elsewhere)
    const signature = tabs.map(tab => `${tab.key}:${tab.href}:${t(tab.labelKey)}`).join('|');
    if (host.dataset.signature !== signature) {
        host.dataset.signature = signature;
        host.innerHTML = tabs.map((tab) => {
            const label = escapeHtml(t(tab.labelKey));
            if (!tab.href) {
                return `<button type="button" class="app-bottom-nav-tab" data-bottom-nav-menu aria-controls="nav-links" aria-expanded="false">${iconSvg(tab.icon)}<span>${label}</span></button>`;
            }
            return `<a href="${tab.href}" class="app-bottom-nav-tab" data-bottom-nav-tab="${escapeHtml(tab.key)}">${iconSvg(tab.icon)}<span>${label}</span></a>`;
        }).join('');
    }
    host.querySelectorAll('[data-bottom-nav-tab]').forEach((el) => {
        if (el.dataset.bottomNavTab === active) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
    });
    host.querySelector('[data-bottom-nav-menu]')?.setAttribute('aria-expanded', String(menuOpen));
}

/** Labels again in the language just chosen */
export function refreshBottomNav() {
    render();
}

// Typing in a field: the bar steps aside (a phone keyboard would push it up
// over the form)
const isTypingField = (el) => el instanceof HTMLElement
    && (el.matches('textarea, select, [contenteditable="true"]')
        || (el.matches('input') && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type)));

export function initBottomNav() {
    const host = document.getElementById('bottomNav');
    if (!host) return;
    state.pageKey = window.location.hash || '#hub';
    render();
    document.body.classList.add('has-bottom-nav');

    host.addEventListener('click', (event) => {
        if (!event.target.closest('[data-bottom-nav-menu]')) return;
        document.getElementById('menu-toggle')?.click();
        render();
    });
    document.addEventListener('app-roles-change', (event) => {
        state = { ...state, roles: event.detail?.roles || ['publik'], signedIn: event.detail?.signedIn === true };
        render();
    });
    document.addEventListener('app-route-change', (event) => {
        state = { ...state, pageKey: event.detail?.pageKey || window.location.hash };
        // The official's own page: "Min uppgift" returns to the input page
        // last opened here (Etapper, Observatör ...), per competition
        const compId = state.competition?.id;
        if (compId && isTaskPage(state.pageKey)) {
            try { localStorage.setItem(lastTaskKey(compId), state.pageKey); } catch (_) { }
        }
        render();
    });
    document.addEventListener('app-competition-change', (event) => {
        const comp = event.detail?.competition || null;
        const changed = comp?.id !== state.competition?.id;
        state = { ...state, competition: comp, times: changed ? {} : state.times };
        if (changed && comp?.id) loadStartTimes(comp.id);
        render();
        try { document.dispatchEvent(new CustomEvent('app-phase-change', { detail: { phase: getCurrentPhase() } })); } catch (_) { }
    });
    // The menu closes on its own too (a link, Escape, the backdrop)
    const toggle = document.getElementById('menu-toggle');
    if (toggle && 'MutationObserver' in window) {
        new MutationObserver(render).observe(toggle, { attributes: true, attributeFilter: ['aria-expanded'] });
    }
    document.addEventListener('focusin', (event) => {
        if (isTypingField(event.target)) document.body.classList.add('bottom-nav-typing');
    });
    document.addEventListener('focusout', () => {
        setTimeout(() => {
            if (!isTypingField(document.activeElement)) document.body.classList.remove('bottom-nav-typing');
        }, 0);
    });
}
