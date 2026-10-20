// The organisers' messages for officials (admin → Kommunikation, audience
// "Funktionärer"), as a compact banner above the field input pages and the
// secretariat pages. Shown for the viewer's roles (and the page's role), in
// the viewer's language, newest first; each can be dismissed on this device
// (localStorage) and comes back when the organiser edits it. A message not
// seen before pulses once; "Viktigt" ones are red. The speaker page shows
// these in its own messages banner (speakerMessages.js).

import { getGlobalState } from '../main.js';
import { listenForOfficialMessages } from '../services/documentService.js';
import { getCurrentLanguage, t } from '../utils/i18n.js';
import { mergeUserRoles } from '../utils/roleAccess.js';
import {
    addStateKeys,
    messageStateKey,
    readStoredKeys,
    viewerOfficialRoleKeys,
    writeStoredKeys
} from '../utils/messageAudience.js';
import { pickFieldMessages, renderFieldMessagesHtml } from './fieldMessagesView.js';

export { pickFieldMessages, renderFieldMessagesHtml };

// Route → the official role the page belongs to
export const FIELD_MESSAGE_ROUTES = Object.freeze({
    'maraton-input': 'marathon',
    'maraton-stages': 'marathon',
    'observator-input': 'marathon',
    'dressyr-input': 'dressage',
    'precision-input': 'precision',
    'precision-split-input': 'precision',
    'vet-check': 'vet',
    'sekretariat-maraton': 'secretariat',
    'sekretariat-dressyr': 'secretariat',
    'sekretariat-precision': 'secretariat'
});

const DISMISSED_KEY = 'fieldMessagesDismissed';
const SEEN_KEY = 'fieldMessagesSeen';

let unsubscribe = null;
let currentCompId = null;
let currentPageRole = null;
let latestMessages = [];

/** The banner host above the page (outside it, so a page re-render keeps it) */
export function ensureRouteBannerHost(id) {
    let host = document.getElementById(id);
    if (host) return host;
    const main = document.querySelector('main');
    if (!main) return null;
    let wrap = document.getElementById('routeBanners');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'routeBanners';
        wrap.className = 'route-banners';
        main.prepend(wrap);
    }
    host = document.createElement('div');
    host.id = id;
    // The pause banner first, the messages under it
    if (id === 'globalPauseBannerHost') wrap.prepend(host);
    else wrap.append(host);
    return host;
}

function viewerKeys() {
    const roles = mergeUserRoles(getGlobalState('currentUser'));
    return viewerOfficialRoleKeys(roles, currentPageRole);
}

function render() {
    const host = document.getElementById('fieldMessagesHost');
    if (!host) return;
    if (!currentCompId) { host.innerHTML = ''; return; }
    const dismissed = readStoredKeys(DISMISSED_KEY);
    const shown = pickFieldMessages(latestMessages, { viewerKeys: viewerKeys(), dismissed, competitionId: currentCompId });
    const seen = new Set(readStoredKeys(SEEN_KEY));
    const shownKeys = shown.map(m => messageStateKey(m, currentCompId));
    const newKeys = new Set(shownKeys.filter(key => !seen.has(key)));
    host.innerHTML = renderFieldMessagesHtml(shown, {
        lang: getCurrentLanguage(),
        competitionId: currentCompId,
        newKeys,
        labels: {
            title: t('field_messages_title'),
            important: t('field_messages_important'),
            info: t('field_messages_info'),
            dismiss: t('field_messages_dismiss')
        }
    });
    if (newKeys.size) {
        writeStoredKeys(SEEN_KEY, addStateKeys(readStoredKeys(SEEN_KEY), [...newKeys]));
        // One pulse (the animation's cycle is 2 s)
        setTimeout(() => {
            host.querySelectorAll('.animate-pulse').forEach(el => el.classList.remove('animate-pulse'));
        }, 2000);
    }
}

function stop() {
    try { unsubscribe?.(); } catch (_) { /* already stopped */ }
    unsubscribe = null;
    currentCompId = null;
    latestMessages = [];
    const host = document.getElementById('fieldMessagesHost');
    if (host) host.innerHTML = '';
}

/** Shows the banner for a route (or removes it on other routes) */
export function syncFieldMessages(pageKey) {
    const pageRole = FIELD_MESSAGE_ROUTES[pageKey] || null;
    const compId = getGlobalState('currentCompetition')?.id || null;
    const user = getGlobalState('currentUser');
    if (!pageRole || !compId || !user) { stop(); currentPageRole = null; return; }
    currentPageRole = pageRole;
    ensureRouteBannerHost('fieldMessagesHost');
    if (compId === currentCompId && unsubscribe) { render(); return; }
    stop();
    currentCompId = compId;
    unsubscribe = listenForOfficialMessages(compId, (messages) => {
        if (currentCompId !== compId) return;
        latestMessages = messages;
        render();
    });
}

let initialized = false;
export function initFieldMessages() {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    document.addEventListener('app-route-change', (event) => syncFieldMessages(event?.detail?.pageKey || ''));
    document.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-dismiss-field-message]');
        if (!button) return;
        writeStoredKeys(DISMISSED_KEY, addStateKeys(readStoredKeys(DISMISSED_KEY), [button.dataset.dismissFieldMessage]));
        render();
    });
}
