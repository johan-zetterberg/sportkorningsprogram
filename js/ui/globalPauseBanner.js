// A clear "TÄVLINGEN PAUSAD" banner above the secretariat pages, the speaker
// page and the dressage/cones monitors, with why, who and where in the
// viewer's language (globalPauseUtils). The secretariat's marathon page also
// gets the buttons: "PAUSA TÄVLINGEN" (asks the reason) and "ÅTERUPPTA"
// (asks for confirmation). The marathon monitor and the marathon input pages
// show the pause themselves.

import { getGlobalState } from '../main.js';
import { onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { currentPauseActor, globalStatusDocRef, setGlobalPause } from '../services/globalPauseService.js';
import { getCurrentLanguage, t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { describePauseEntry, openPause, pauseHeadline, pauseWhere } from '../utils/globalPauseUtils.js';
import { ensureRouteBannerHost } from './fieldMessages.js';
import { askPauseReason } from './pauseReasonDialog.js';
import { showConfirm } from './components.js';

const BANNER_ROUTES = new Set([
    'sekretariat-maraton', 'sekretariat-dressyr', 'sekretariat-precision',
    'speaker', 'dressyr-monitor', 'precision-monitor'
]);
// Where the pause can be started and ended from the banner
const CONTROL_ROUTES = new Set(['sekretariat-maraton']);

let unsubscribe = null;
let currentCompId = null;
let currentRoute = null;
let lastStatus = {};

function render() {
    const host = document.getElementById('globalPauseBannerHost');
    if (!host) return;
    const isPaused = lastStatus.isPaused === true;
    const withControls = CONTROL_ROUTES.has(currentRoute);
    if (!isPaused && !withControls) { host.innerHTML = ''; return; }
    const locale = getCurrentLanguage() === 'en' ? 'en-GB' : 'sv-SE';
    if (!isPaused) {
        host.innerHTML = `<div class="px-2 sm:px-4 pt-2 flex justify-end">
            <button type="button" data-global-pause="pause" class="min-h-[44px] px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-black uppercase hover:bg-red-700 shadow">${escapeHtml(t('observer_stop_all'))}</button>
        </div>`;
        return;
    }
    const current = openPause(lastStatus.pauseLog);
    const headline = current ? pauseHeadline(current, t, locale) : t('paused_banner');
    const detail = describePauseEntry(current, t);
    host.innerHTML = `<div class="px-2 sm:px-4 pt-2">
        <div role="status" aria-live="assertive" class="rounded-xl bg-red-600 text-white px-4 py-3 shadow-lg flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between" data-global-pause-banner>
            <div class="min-w-0">
                <div class="text-base sm:text-lg font-black uppercase tracking-wide">${escapeHtml(headline)}</div>
                ${detail ? `<div class="text-sm font-semibold opacity-95 break-words">${escapeHtml(detail)}</div>` : ''}
                <div class="text-xs opacity-90">${escapeHtml(t('pause_banner_clocks_stopped'))}</div>
            </div>
            ${withControls ? `<button type="button" data-global-pause="resume" class="min-h-[44px] shrink-0 px-4 py-2 rounded-lg bg-white text-red-700 text-sm font-black uppercase hover:bg-red-50">${escapeHtml(t('observer_resume_all'))}</button>` : ''}
        </div>
    </div>`;
}

function stop() {
    try { unsubscribe?.(); } catch (_) { /* already stopped */ }
    unsubscribe = null;
    currentCompId = null;
    lastStatus = {};
    const host = document.getElementById('globalPauseBannerHost');
    if (host) host.innerHTML = '';
}

export function syncGlobalPauseBanner(pageKey) {
    const compId = getGlobalState('currentCompetition')?.id || null;
    if (!BANNER_ROUTES.has(pageKey) || !compId) { stop(); currentRoute = null; return; }
    currentRoute = pageKey;
    ensureRouteBannerHost('globalPauseBannerHost');
    if (compId === currentCompId && unsubscribe) { render(); return; }
    stop();
    currentCompId = compId;
    render();
    unsubscribe = onSnapshot(globalStatusDocRef(compId), (snap) => {
        if (currentCompId !== compId) return;
        lastStatus = snap.exists() ? (snap.data() || {}) : {};
        render();
    }, (err) => {
        console.warn('Pause status could not be read:', err?.code || err);
    });
}

async function onControlClick(action) {
    const compId = currentCompId;
    if (!compId) return;
    if (action === 'pause') {
        const answer = await askPauseReason();
        if (!answer) return;
        await setGlobalPause(compId, true, {
            reason: answer.reason,
            note: answer.note,
            by: currentPauseActor('sekretariat'),
            where: pauseWhere({ place: 'secretariat' })
        });
        return;
    }
    const ok = await showConfirm(t('pause_resume_confirm'), {
        title: t('observer_resume_all'),
        confirmLabel: t('observer_resume_all')
    });
    if (ok) await setGlobalPause(compId, false, { by: currentPauseActor('sekretariat') });
}

let initialized = false;
export function initGlobalPauseBanner() {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    document.addEventListener('app-route-change', (event) => syncGlobalPauseBanner(event?.detail?.pageKey || ''));
    document.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-global-pause]');
        if (!button) return;
        onControlClick(button.dataset.globalPause);
    });
}
