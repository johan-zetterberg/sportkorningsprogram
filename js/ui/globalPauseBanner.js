// A clear "TÄVLINGEN PAUSAD" banner above the secretariat pages, the speaker
// page and the dressage/cones monitors, in the viewer's language
// (globalPauseUtils). Staff pages show why, who and where (who and the note
// from the private pauseDetails); the public, the drivers and the monitors
// see the time and the reason only. Admins also see the offline presses the
// server left for review (late: not applied backwards). The secretariat's marathon page also
// gets the buttons: "PAUSA TÄVLINGEN" (asks the reason) and "ÅTERUPPTA"
// (asks for confirmation). The marathon monitor and the marathon input pages
// show the pause themselves.

import { getGlobalState } from '../main.js';
import { onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import {
    currentPauseActor,
    globalStatusDocRef,
    listenPauseDetails,
    listenPauseEventsForReview,
    markPauseEventReviewed,
    setGlobalPause
} from '../services/globalPauseService.js';
import { getCurrentLanguage, t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { mergeUserRoles } from '../utils/roleAccess.js';
import { describePauseEntry, describePauseReview, openPause, pauseDetailsId, pauseHeadline, pauseWhere } from '../utils/globalPauseUtils.js';
import { ensureRouteBannerHost } from './fieldMessages.js';
import { askPauseReason } from './pauseReasonDialog.js';
import { showConfirm } from './components.js';

// Every page where someone works with the clocks or waits for them: field
// input pages, secretariat, speaker, monitors, the official landing page,
// the driver portal and the public competition center
const BANNER_ROUTES = new Set([
    'maraton-input', 'maraton-stages', 'observator-input', 'dressyr-input',
    'precision-input', 'precision-split-input', 'vet-check',
    'sekretariat-maraton', 'sekretariat-dressyr', 'sekretariat-precision',
    'speaker', 'dressyr-monitor', 'precision-monitor', 'maraton-monitor',
    'official', 'portal', 'competition-center'
]);
// Disabled start/stop buttons of the input pages read "Pausad" while paused
const PAUSE_LABEL_BUTTONS = [
    'btnStartMar', 'btnStopMar', 'btnWgStart', 'btnWgStop', 'btnHaltStart', 'btnHaltStop'
];
let labelTimer = null;
// Where the pause can be started and ended from the banner
const CONTROL_ROUTES = new Set(['sekretariat-maraton']);
// The public, the drivers and the monitors: time and reason only
const PUBLIC_ROUTES = new Set(['portal', 'competition-center', 'dressyr-monitor', 'precision-monitor', 'maraton-monitor']);

let unsubscribe = null;
let currentCompId = null;
let currentRoute = null;
let lastStatus = {};
// Staff: the open pause's private details, and late presses to review (admins)
let detailsId = '';
let detailsUnsub = null;
let lastDetails = null;
let reviewUnsub = null;
let reviews = [];

const isStaffRoute = () => !!currentRoute && !PUBLIC_ROUTES.has(currentRoute);
const isAdminUser = () => mergeUserRoles(getGlobalState('currentUser')).some((role) => role === 'admin' || role === 'superadmin');

// Follows the private details of the open pause (staff routes only)
function syncDetails(current) {
    const id = isStaffRoute() && current?.start ? pauseDetailsId(current.start) : '';
    if (id === detailsId) return;
    try { detailsUnsub?.(); } catch (_) { /* already stopped */ }
    detailsUnsub = null;
    lastDetails = null;
    detailsId = id;
    if (!id || !currentCompId) return;
    detailsUnsub = listenPauseDetails(currentCompId, id, (data) => {
        if (detailsId !== id) return;
        lastDetails = data;
        render();
    });
}

function syncReviews() {
    const wanted = isStaffRoute() && !!currentCompId && isAdminUser();
    if (wanted && !reviewUnsub) {
        const compId = currentCompId;
        reviewUnsub = listenPauseEventsForReview(compId, (list) => {
            if (currentCompId !== compId) return;
            reviews = list;
            render();
        });
    } else if (!wanted && reviewUnsub) {
        try { reviewUnsub(); } catch (_) { /* already stopped */ }
        reviewUnsub = null;
        reviews = [];
    }
}

function reviewLinesHtml(locale) {
    if (!isStaffRoute() || !reviews.length) return '';
    return `<div class="px-2 sm:px-4 pt-2 space-y-1" data-pause-reviews>${reviews.slice(0, 5).map((event) => `
        <div role="alert" class="rounded-lg border border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 px-3 py-2 text-sm flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <span class="font-semibold">${escapeHtml(describePauseReview(event, t, locale))}</span>
            <button type="button" data-pause-review="${escapeHtml(event.id)}" class="min-h-[40px] shrink-0 rounded-md border border-current px-3 py-1 text-xs font-bold">${escapeHtml(t('pause_review_done'))}</button>
        </div>`).join('')}</div>`;
}

// Buttons the page disabled for the pause say "Pausad"; restored afterwards
export function applyPausedButtonLabels(paused, root = document) {
    for (const id of PAUSE_LABEL_BUTTONS) {
        const button = root.getElementById ? root.getElementById(id) : null;
        if (!button) continue;
        if (paused && button.disabled) {
            if (button.dataset.pauseOriginal === undefined) button.dataset.pauseOriginal = button.textContent;
            if (button.textContent !== t('pause_button_label')) button.textContent = t('pause_button_label');
        } else if (button.dataset.pauseOriginal !== undefined) {
            button.textContent = button.dataset.pauseOriginal;
            delete button.dataset.pauseOriginal;
        }
    }
}

// Sticky bars under the banner (the precision timer card) move down by its height
function publishBannerHeight(host) {
    try {
        const px = host && host.firstElementChild ? Math.ceil(host.getBoundingClientRect().height) : 0;
        document.documentElement.style.setProperty('--pause-banner-h', `${px}px`);
    } catch (_) { /* no document */ }
}

function render() {
    const host = document.getElementById('globalPauseBannerHost');
    if (!host) return;
    const isPaused = lastStatus.isPaused === true;
    host.classList.toggle('pause-active', isPaused);
    // The page greys itself (not the banner) while paused
    try { document.body.classList.toggle('global-paused', isPaused && !!currentRoute); } catch (_) { /* no body */ }
    applyPausedButtonLabels(isPaused);
    if (isPaused && !labelTimer) labelTimer = setInterval(() => applyPausedButtonLabels(lastStatus.isPaused === true), 1000);
    if (!isPaused && labelTimer) { clearInterval(labelTimer); labelTimer = null; }
    const withControls = CONTROL_ROUTES.has(currentRoute);
    const locale = getCurrentLanguage() === 'en' ? 'en-GB' : 'sv-SE';
    const current = isPaused ? openPause(lastStatus.pauseLog) : null;
    syncDetails(current);
    syncReviews();
    const reviewHtml = reviewLinesHtml(locale);
    if (!isPaused && !withControls) { host.innerHTML = reviewHtml; publishBannerHeight(host); return; }
    if (!isPaused) {
        host.innerHTML = `${reviewHtml}<div class="px-2 sm:px-4 pt-2 flex justify-end">
            <button type="button" data-global-pause="pause" class="min-h-[44px] px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-black uppercase hover:bg-red-700 shadow">${escapeHtml(t('observer_stop_all'))}</button>
        </div>`;
        publishBannerHeight(host);
        return;
    }
    const headline = current ? pauseHeadline(current, t, locale) : t('paused_banner');
    const detail = describePauseEntry(current, t, isStaffRoute() ? { details: lastDetails } : { publicView: true });
    host.innerHTML = `${reviewHtml}<div class="px-2 sm:px-4 pt-2">
        <div role="status" aria-live="assertive" class="rounded-xl bg-red-600 text-white px-4 py-3 shadow-lg flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between" data-global-pause-banner>
            <div class="min-w-0">
                <div class="text-base sm:text-lg font-black uppercase tracking-wide">${escapeHtml(headline)}</div>
                ${detail ? `<div class="text-sm font-semibold opacity-95 break-words">${escapeHtml(detail)}</div>` : ''}
                <div class="text-xs opacity-90">${escapeHtml(t('pause_banner_clocks_stopped'))}</div>
            </div>
            ${withControls ? `<button type="button" data-global-pause="resume" class="min-h-[44px] shrink-0 px-4 py-2 rounded-lg bg-white text-red-700 text-sm font-black uppercase hover:bg-red-50">${escapeHtml(t('observer_resume_all'))}</button>` : ''}
        </div>
    </div>`;
    publishBannerHeight(host);
}

function stop() {
    try { unsubscribe?.(); } catch (_) { /* already stopped */ }
    unsubscribe = null;
    try { detailsUnsub?.(); } catch (_) { /* already stopped */ }
    detailsUnsub = null;
    detailsId = '';
    lastDetails = null;
    try { reviewUnsub?.(); } catch (_) { /* already stopped */ }
    reviewUnsub = null;
    reviews = [];
    currentCompId = null;
    lastStatus = {};
    if (labelTimer) { clearInterval(labelTimer); labelTimer = null; }
    try { document.body.classList.remove('global-paused'); } catch (_) { /* no body */ }
    const host = document.getElementById('globalPauseBannerHost');
    if (host) { host.innerHTML = ''; host.classList.remove('pause-active'); }
    publishBannerHeight(host);
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
        const reviewButton = event.target.closest?.('[data-pause-review]');
        if (reviewButton && currentCompId) {
            reviewButton.disabled = true;
            markPauseEventReviewed(currentCompId, reviewButton.dataset.pauseReview).catch((error) => {
                console.warn('Could not mark the pause reviewed:', error);
                reviewButton.disabled = false;
            });
            return;
        }
        const button = event.target.closest?.('[data-global-pause]');
        if (!button) return;
        onControlClick(button.dataset.globalPause);
    });
}
