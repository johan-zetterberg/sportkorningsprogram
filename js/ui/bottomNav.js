// The bottom navigation bar on phones (shown below 768 px, css/app-shell.css):
// home, start times, results, the user's own page and the menu. The tabs
// follow the roles (bottomNavUtils.js); authService.updateUIVisibility sends
// them with 'app-roles-change', the router the page with 'app-route-change'.

import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { activeBottomNavTab, bottomNavTabs } from './bottomNavUtils.js';

const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    trophy: '<path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3"/><path d="M12 12v4M8.5 20h7M10 16h4v4h-4z"/>',
    admin: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    task: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12l2 2 4-4"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
};

let state = { roles: ['publik'], signedIn: false, pageKey: '' };

const iconSvg = (name) => `<svg class="app-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

function render() {
    const host = document.getElementById('bottomNav');
    if (!host) return;
    const tabs = bottomNavTabs({ roles: state.roles, signedIn: state.signedIn });
    const active = activeBottomNavTab(tabs, state.pageKey);
    const menuOpen = document.getElementById('menu-toggle')?.getAttribute('aria-expanded') === 'true';
    host.setAttribute('aria-label', t('bottom_nav_label'));
    // The same tabs and labels: only the marks change. The tabs are not
    // rebuilt under a tap (the tapped element would leave the page before the
    // click reaches the window, which then took it for a click elsewhere)
    const signature = tabs.map(tab => `${tab.key}:${t(tab.labelKey)}`).join('|');
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
        render();
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
