// TV / kiosk mode for the big-screen pages (monitors, speaker, prize-giving):
// #maraton-monitor?tv=1 (or ?tv=1 in the URL) hides the app's header and
// footer, uses the full width, scales the text up (base ≥ 24 px on a 1920 px
// screen) and forces the high-contrast dark theme. The CSS is in
// css/style.css (html.tv-mode). Pages call enterTvModeIfRequested() on load
// and exitTvMode() on unload; data keeps refreshing as on the normal page.

import { escapeHtml, isPrivileged } from '../../utils/sharedUtils.js';
import { t } from '../../utils/i18n.js';

let addedDark = false;

/** Whether the location asks for TV mode (?tv=1 / tv=true in the hash or the search) */
export function isTvModeRequested(locationLike = (typeof window !== 'undefined' ? window.location : null)) {
    if (!locationLike) return false;
    const hashQuery = String(locationLike.hash || '').split('?')[1] || '';
    const searchQuery = String(locationLike.search || '').replace(/^\?/, '');
    const on = (value) => value === '1' || value === 'true' || value === '';
    const hashParams = new URLSearchParams(hashQuery);
    const searchParams = new URLSearchParams(searchQuery);
    if (hashParams.has('tv')) return on(hashParams.get('tv'));
    if (searchParams.has('tv')) return on(searchParams.get('tv'));
    return false;
}

/** The route's hash with tv=1 added (keeps other parameters such as id) */
export function tvModeHash(route, currentHash = '') {
    const query = String(currentHash || '').split('?')[1] || '';
    const params = new URLSearchParams(query);
    params.set('tv', '1');
    return `#${route}?${params.toString()}`;
}

export function isTvModeActive() {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('tv-mode');
}

export function applyTvMode(enabled) {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.classList.toggle('tv-mode', !!enabled);
    document.body?.classList.toggle('tv-mode', !!enabled);
    if (enabled) {
        if (!html.classList.contains('dark')) {
            html.classList.add('dark');
            addedDark = true;
        }
    } else if (addedDark) {
        html.classList.remove('dark');
        addedDark = false;
    }
}

/** Turns TV mode on when the URL asks for it (off otherwise); returns whether it is on */
export function enterTvModeIfRequested() {
    const on = isTvModeRequested();
    applyTvMode(on);
    return on;
}

export function exitTvMode() {
    applyTvMode(false);
}

/**
 * For admins and officials: a link that opens the page in TV mode (new tab,
 * for the screen), or in TV mode a small link back to the normal page.
 */
export function tvModeLinkHtml(route, { canSee = null } = {}) {
    if (isTvModeActive()) {
        return `<a href="#${escapeHtml(route)}" class="tv-exit-link inline-flex items-center gap-1.5 rounded-md border border-gray-600 px-2 py-1 text-xs font-semibold text-gray-300 hover:text-white" data-tv-exit>
            <i class="fas fa-compress" aria-hidden="true"></i>${escapeHtml(t('tv_mode_exit'))}</a>`;
    }
    const allowed = canSee === null ? isPrivileged() : !!canSee;
    if (!allowed) return '';
    const hash = tvModeHash(route, typeof window !== 'undefined' ? window.location.hash : '');
    return `<a href="${escapeHtml(hash)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700" data-tv-open title="${escapeHtml(t('tv_mode_open_hint'))}">
        <i class="fas fa-tv" aria-hidden="true"></i>${escapeHtml(t('tv_mode_open'))}</a>`;
}
