// Staff notifications on the secretariat, vet and speaker pages: declarations
// a driver changed ("Ändrad av kusk"; a new horse after the vet inspection
// flagged) and vet strikes waiting for the ground jury. Shown until an
// official acknowledges them; the secretariat and the TD confirm or overturn
// a strike here.
import { getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getGlobalState } from '../main.js';
import { getCompDocRef } from '../services/firestoreService.js';
import { acknowledgeStaffNotice, getIncidents, listenForStaffNotices } from '../services/incidentService.js';
import { decideVetStrike } from '../services/vetDecisionService.js';
import { vetStrikeStateOf } from '../services/vetDecisionUtils.js';
import { mergeUserRoles } from '../utils/roleAccess.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { t } from '../utils/i18n.js';
import { showAlert, showConfirm } from './components.js';

const KIND_STYLE = {
    declarationChange: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-950 dark:border-fuchsia-800 dark:bg-fuchsia-950/30 dark:text-fuchsia-100',
    vetStrike: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
    vetDecision: 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100'
};

const KIND_LABEL_KEYS = {
    declarationChange: 'notice_kind_declaration',
    vetStrike: 'notice_kind_vet_strike',
    vetDecision: 'notice_kind_vet_decision'
};

function userRoles() {
    return mergeUserRoles(getGlobalState('currentUser'));
}

/** The secretariat (competition or global admin) and the TD decide strikes */
export function canDecideVetStrikes(roles = userRoles()) {
    return roles.some((role) => ['admin', 'superadmin', 'td'].includes(role));
}

// The speaker only reads: an acknowledgement hides the notice for everyone
function canAcknowledge(roles = userRoles()) {
    return roles.some((role) => ['admin', 'superadmin', 'td', 'dressage', 'marathon', 'precision', 'vet'].includes(role));
}

function noticeTime(notice) {
    const ms = notice?.createdAt?.toMillis?.() ?? (Number(notice?.createdAt?.seconds) * 1000 || 0);
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/** Unacknowledged declaration changes per start number (the newest each) */
export function unackedByStartNumber(notices = []) {
    const map = new Map();
    notices.forEach((notice) => {
        if (notice?.ackAt || notice?.kind !== 'declarationChange') return;
        const sn = String(notice.startNumber || '');
        if (sn && !map.has(sn)) map.set(sn, notice);
    });
    return map;
}

/**
 * Confirm and record a ground jury decision on a pending vet strike (shared
 * by this panel and the incident log). action: 'confirm' | 'overturn'.
 * Returns 'cancelled', 'not-pending' or 'decided'; throws when saving fails.
 */
export async function runVetStrikeDecision(competitionId, { startNumber, action, incidentId = '' }) {
    const question = action === 'confirm' ? t('notice_confirm_strike_question') : t('notice_overturn_strike_question');
    if (!await showConfirm(`#${startNumber}: ${question}`, { danger: action === 'confirm' })) return 'cancelled';
    const snap = await getDoc(getCompDocRef(competitionId, 'equipages', String(startNumber)));
    const equipage = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (!equipage || vetStrikeStateOf(equipage) !== 'pending') {
        showAlert(t('notice_strike_not_pending'), 'info');
        return 'not-pending';
    }
    let incident = null;
    const id = incidentId || equipage.vetStrikePending?.incidentId;
    if (id) {
        try { incident = (await getIncidents(competitionId)).find((i) => i.id === id) || null; } catch (_) { /* decided without the entry */ }
    }
    const { state } = await decideVetStrike(competitionId, equipage, action, { incident });
    const done = action === 'confirm' ? t('notice_strike_confirmed') : t('notice_strike_overturned');
    // Offline: saved on the device; the driver is told when it reaches the server
    showAlert(state === 'queued' ? `${done} ${t('notice_decision_queued')}` : done);
    return 'decided';
}
function renderNotice(notice, { canAck, canDecide, highlightNewHorse }) {
    const style = KIND_STYLE[notice.kind] || KIND_STYLE.declarationChange;
    const label = t(KIND_LABEL_KEYS[notice.kind] || 'notice_kind_declaration');
    const newHorse = highlightNewHorse && notice.newHorseAfterVet
        ? `<span class="ml-1 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black uppercase text-white">${escapeHtml(t('notice_new_horse_after_vet'))}</span>`
        : '';
    const decide = canDecide && notice.kind === 'vetStrike' ? `
        <button type="button" class="min-h-[40px] rounded-md bg-rose-700 px-3 py-1 text-xs font-bold text-white hover:bg-rose-800" data-notice-decide="confirm" data-notice-id="${escapeHtml(notice.id)}">${escapeHtml(t('notice_confirm_strike'))}</button>
        <button type="button" class="min-h-[40px] rounded-md border border-current px-3 py-1 text-xs font-bold hover:bg-white/50 dark:hover:bg-black/20" data-notice-decide="overturn" data-notice-id="${escapeHtml(notice.id)}">${escapeHtml(t('notice_overturn_strike'))}</button>` : '';
    // A strike is closed by deciding it (or by the server when withdrawn): no Kvittera
    const ack = canAck && notice.kind !== 'vetStrike' ? `
        <button type="button" class="min-h-[40px] rounded-md border border-current px-3 py-1 text-xs font-semibold hover:bg-white/50 dark:hover:bg-black/20" data-notice-ack="${escapeHtml(notice.id)}">${escapeHtml(t('notice_acknowledge'))}</button>` : '';
    return `
        <li class="rounded-lg border p-2.5 text-sm ${style}">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                    <div class="text-[11px] font-black uppercase tracking-wide">${escapeHtml(label)}${newHorse} <span class="font-normal opacity-70">${escapeHtml(noticeTime(notice))}</span></div>
                    <div class="mt-0.5 break-words">${escapeHtml(notice.summary || '')}</div>
                </div>
                <div class="flex shrink-0 flex-wrap gap-1.5">${decide}${ack}</div>
            </div>
        </li>`;
}

/**
 * The panel for a page that rebuilds its markup on every render (the
 * secretariat pages): the panel lives in its own element, put back in the
 * page's placeholder after each render. Returns { placeholder, attach(root),
 * destroy() }.
 */
export function createStaffNoticesHost(options = {}) {
    const host = typeof document !== 'undefined' ? document.createElement('div') : null;
    if (host) host.className = 'mb-4';
    const unmount = host ? mountStaffNoticesPanel(host, options) : () => { };
    return {
        placeholder: '<div data-staff-notices></div>',
        attach(root) {
            const slot = root?.querySelector?.('[data-staff-notices]');
            if (slot && host) slot.replaceWith(host);
        },
        destroy() {
            unmount();
            host?.remove();
        }
    };
}

/**
 * Mounts the panel in `container`. options: { competitionId, kinds,
 * highlightNewHorse, onUnacked(Map startNumber -> notice) }.
 * Returns the unmount function.
 */
export function mountStaffNoticesPanel(container, { competitionId, kinds = null, highlightNewHorse = false, onUnacked = null } = {}) {
    if (!container || !competitionId) return () => { };
    let notices = [];
    let stopped = false;
    const roles = userRoles();
    const flags = { canAck: canAcknowledge(roles), canDecide: canDecideVetStrikes(roles), highlightNewHorse };

    const render = () => {
        if (stopped) return;
        const relevant = notices.filter((n) => !kinds || kinds.includes(n.kind));
        const open = relevant.filter((n) => !n.ackAt).slice(0, 12);
        onUnacked?.(unackedByStartNumber(relevant));
        if (!open.length) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = `
            <section class="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800" aria-label="${escapeHtml(t('notice_panel_title'))}">
                <h2 class="mb-2 text-sm font-bold text-gray-900 dark:text-white">${escapeHtml(t('notice_panel_title'))} <span class="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">${open.length}</span></h2>
                <ul class="space-y-2">${open.map((n) => renderNotice(n, flags)).join('')}</ul>
            </section>`;
    };

    const onClick = async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const ackBtn = target?.closest('[data-notice-ack]');
        const decideBtn = target?.closest('[data-notice-decide]');
        if (ackBtn) {
            ackBtn.disabled = true;
            acknowledgeStaffNotice(competitionId, ackBtn.dataset.noticeAck).catch((error) => {
                console.warn('Kunde inte kvittera notisen:', error);
                showAlert(t('notice_ack_failed'), false);
                ackBtn.disabled = false;
            });
            return;
        }
        if (!decideBtn) return;
        const notice = notices.find((n) => n.id === decideBtn.dataset.noticeId);
        if (!notice) return;
        decideBtn.disabled = true;
        try {
            const result = await runVetStrikeDecision(competitionId, {
                startNumber: notice.startNumber,
                action: decideBtn.dataset.noticeDecide,
                incidentId: notice.incidentId
            });
            if (result === 'cancelled') {
                decideBtn.disabled = false;
                return;
            }
            // Not awaited (offline it waits in the cache); the server also
            // acknowledges it when the decision arrives (onIncidentWritten)
            acknowledgeStaffNotice(competitionId, notice.id).catch(() => { });
        } catch (error) {
            console.error('Beslutet kunde inte sparas:', error);
            showAlert(`${t('notice_decision_failed')} ${error?.message || ''}`, false);
            decideBtn.disabled = false;
        }
    };
    container.addEventListener('click', onClick);
    const unsubscribe = listenForStaffNotices(competitionId, (list) => {
        notices = list;
        render();
    }, () => {
        // No access (e.g. a public account): nothing to show
        container.innerHTML = '';
    });

    return () => {
        stopped = true;
        container.removeEventListener('click', onClick);
        try { unsubscribe(); } catch (_) { }
        container.innerHTML = '';
    };
}
