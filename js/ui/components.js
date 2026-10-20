import { escapeHtml } from '../utils/sharedUtils.js';
import { getCompetitionLogoHtml } from '../utils/competitionLogo.js';
import { t } from '../utils/i18n.js';
import { renderQuickGuideButton, openQuickGuide } from './quickGuideDrawer.js';
import { activateDialog } from './dialogA11y.js';
import { createToastQueue, normalizeAlertOptions, normalizeAlertType, shouldUseToast, toastTimeout } from './toastQueue.js';

export { renderQuickGuideButton, openQuickGuide };

/**
 * Renderar ett standardiserat sidhuvud för en tävling.
 * @param {object} competition - Det aktiva tävlingsobjektet.
 * @param {string} pageTitle - Sidans titel.
 * @param {object|boolean} options - Tillvalsobjekt ({ quickGuideRole: string, actionsHtml: string })
 * @returns {string} En HTML-sträng med sidhuvudet.
 */
// Ny kod med DriveLive-färger
export function getCompetitionHeader(competition, pageTitle, options = {}) {
    // Om inget tävlingsobjekt finns, visa en standard-header
    if (!competition) {
        return `<header class="bg-brand-darkblue p-4 rounded-t-lg text-white">${escapeHtml(t('no_comp_selected'))}</header>`;
    }

    // --- Datumformatering (robust) ---
    const competitionDates = competition.dates || {};
    let dateString = '';
    try {
        // Försöker bara formatera om datumen är giltiga strängar
        if (competitionDates.start && competitionDates.end) {
            const startDate = new Date(competitionDates.start).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
            const endDate = new Date(competitionDates.end).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
            if (startDate === endDate.split(' ')[0] + ' ' + endDate.split(' ')[1]) { // Om samma dag och månad
                dateString = endDate;
            } else {
                dateString = `${startDate} – ${endDate}`;
            }
        } else if (competitionDates.start || competitionDates.end) {
            const singleDate = new Date(competitionDates.start || competitionDates.end).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
            dateString = singleDate;
        }
    } catch (e) {
        console.error("Kunde inte formatera datum:", competitionDates);
        // Lämnar dateString tom om datumen är ogiltiga
    }

    const opts = (typeof options === 'object' && options !== null) ? options : {};
    let actionsHtml = opts.actionsHtml || '';
    if (opts.quickGuideRole) {
        actionsHtml = renderQuickGuideButton(opts.quickGuideRole) + (actionsHtml ? ` ${actionsHtml}` : '');
    }

    return `
        <header
            class="competition-page-header bg-gradient-to-r from-brand-darkblue to-indigo-950 dark:from-gray-900 dark:to-gray-800 border-b-4 border-brand-gold dark:border-brand-gold/70 p-2 md:p-4 rounded-t-lg mb-2 md:mb-4 shadow-xl flex items-center gap-3 md:gap-4 transition-colors"
            data-competition-name="${escapeHtml(competition.name || 'Tävling')}"
            data-page-title="${escapeHtml(pageTitle || '')}"
        >
            
            ${getCompetitionLogoHtml(competition, {
                fallbackHtml: '<img src="/icons/DriveLive_512.png" alt="DriveLive Logga" class="h-12 w-12 md:h-16 md:w-16 rounded-md flex-shrink-0">'
            })}

            <div class="flex-grow min-w-0">
                <div class="flex items-center gap-2">
                    <h1 class="text-xl md:text-2xl font-bold font text-white truncate">${escapeHtml(competition.name || 'Tävling')}</h1>
                    ${(competition.published === false) ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-400 text-yellow-900 shadow-sm uppercase tracking-wider">UTKAST</span>' : ''}
                </div>
                <p class="text-sm md:text-base text-brand-lightblue dark:text-blue-300 truncate">${escapeHtml(pageTitle || '')}</p>
                
                ${(competition.location || dateString) ? `
                    <div class="text-xs text-gray-300 dark:text-gray-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        ${competition.location ? `<span>📍 ${escapeHtml(competition.location)}</span>` : ''}
                        ${dateString ? `<span>🗓️ ${escapeHtml(dateString)}</span>` : ''}
                    </div>
                ` : ''}
            </div>

            ${actionsHtml ? `
                <div class="shrink-0 flex items-center gap-2">
                    ${actionsHtml}
                </div>
            ` : ''}
        </header>
    `;
}

export function renderCompetitionModeBanner(competition, options = {}) {
    if ((competition?.competitionMode || 'live') !== 'field') return '';

    const title = options.title || t('field_mode_active');
    const message = options.message || t('field_mode_general_message');

    return `
        <section class="mb-4 rounded-xl border border-amber-300/80 bg-amber-50 text-amber-950 shadow-sm p-4 dark:border-amber-700/70 dark:bg-amber-900/20 dark:text-amber-100">
            <div class="flex flex-col gap-1">
                <div class="text-sm font-semibold uppercase tracking-wide">${escapeHtml(t('field_mode'))}</div>
                <h2 class="text-base font-semibold">${escapeHtml(title)}</h2>
                <p class="text-sm opacity-90">${escapeHtml(message)}</p>
            </div>
        </section>
    `;
}

/**
 * Skapar en återanvändbar, sökbar dropdown-meny.
 * @param {HTMLElement} container - Elementet där dropdownen ska renderas.
 * @param {Array<object>} data - Datan som ska visas (måste innehålla startNumber och driverName).
 * @param {Function} onSelect - Callback som körs när ett val görs.
 * @returns {object} Ett objekt med metoder för att interagera med dropdownen.
 */
export function createSearchableDropdown(container, data, onSelect) {
    container.innerHTML = `
        <div class="searchable-dropdown relative bg-white dark:bg-gray-800">
            <input type="text" class="search-input w-full p-2 border dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400" placeholder="${escapeHtml(t('search_startnumber_or_name'))}" aria-label="${escapeHtml(t('search_startnumber_or_name'))}">
            <div class="searchable-dropdown-list hidden absolute top-full left-0 right-0 bg-white dark:bg-gray-700 border dark:border-gray-600 mt-1 rounded-md shadow-lg z-10 max-h-60 overflow-y-auto"></div>
        </div>
    `;
    const searchInput = container.querySelector('.search-input');
    const list = container.querySelector('.searchable-dropdown-list');
    let selectedValue = null;

    const renderList = (filter = '') => {
        list.innerHTML = '';
        const filteredData = data.filter(item => {
            const term = filter.toLowerCase();
            return item.startNumber.toString().includes(term) || item.driverName.toLowerCase().includes(term);
        });

        if (filteredData.length === 0) {
            list.innerHTML = `<div class="p-3 text-gray-500">${escapeHtml(t('no_results') || 'No results')}</div>`;
        } else {
            filteredData.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'p-3 hover:bg-blue-50 dark:hover:bg-gray-600 cursor-pointer text-gray-900 dark:text-gray-100';
                itemEl.textContent = `#${item.startNumber} - ${item.driverName}`;
                itemEl.dataset.value = item.startNumber;
                itemEl.addEventListener('click', () => {
                    searchInput.value = itemEl.textContent;
                    selectedValue = item.startNumber;
                    list.classList.add('hidden');
                    onSelect(data.find(d => d.startNumber == item.startNumber));
                });
                list.appendChild(itemEl);
            });
        }
        list.classList.remove('hidden');
    };

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    searchInput.addEventListener('focus', () => renderList(searchInput.value));
    const docClickHandler = (e) => {
        if (!container.contains(e.target)) {
            list.classList.add('hidden');
        }
    };
    document.addEventListener('click', docClickHandler);

    return {
        setValue: (value) => {
            const item = data.find(d => d.startNumber == value);
            if (item) {
                searchInput.value = `#${item.startNumber} - ${item.driverName}`;
                selectedValue = item.startNumber;
                onSelect(item);
            } else {
                searchInput.value = '';
                selectedValue = null;
                onSelect(null);
            }
        },
        getValue: () => selectedValue,
        updateData: (newData) => {
            data = newData;
        },
        destroy: () => {
            document.removeEventListener('click', docClickHandler);
            container.innerHTML = '';
        }
    };
}

// --- Feedback: toasts (no answer needed) and the alert modal (errors) ---

const WARNING_ICON = `<svg class="h-6 w-6 text-yellow-600 dark:text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
const SUCCESS_ICON = `<svg class="h-6 w-6 text-green-600 dark:text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
const ERROR_ICON = `<svg class="h-6 w-6 text-red-600 dark:text-red-300" stroke="currentColor" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
const INFO_ICON = `<svg class="h-6 w-6 text-blue-600 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;

const ALERT_STYLES = {
    success: { icon: SUCCESS_ICON, iconBg: 'bg-green-100 dark:bg-green-900', button: 'bg-green-600 hover:bg-green-700 focus:ring-green-500', title: 'alert_title_success' },
    info: { icon: INFO_ICON, iconBg: 'bg-blue-100 dark:bg-blue-900', button: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500', title: 'alert_title_info' },
    warning: { icon: WARNING_ICON, iconBg: 'bg-yellow-100 dark:bg-yellow-900', button: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500', title: 'alert_title_warning' },
    queued: { icon: WARNING_ICON, iconBg: 'bg-yellow-100 dark:bg-yellow-900', button: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500', title: 'alert_title_queued' },
    error: { icon: ERROR_ICON, iconBg: 'bg-red-100 dark:bg-red-900', button: 'bg-red-600 hover:bg-red-700 focus:ring-red-500', title: 'alert_title_error' }
};

const toastQueue = createToastQueue({ max: 3 });
const toastTimers = new Map();
let releaseAlertDialog = null;

// Overlays tell the shell (main.js) so it can close the phone menu first
function announceOverlay() {
    try { document.dispatchEvent(new CustomEvent('app-overlay-open')); } catch (_) { }
}

function ensureToastRegion() {
    let region = document.getElementById('toastRegion');
    if (region) return region;
    region = document.createElement('div');
    region.id = 'toastRegion';
    region.className = 'app-toast-region';
    // Polite: read out after what the user is doing; errors use the modal
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
    return region;
}

function removeToastElement(item) {
    if (!item) return;
    clearTimeout(toastTimers.get(item.id));
    toastTimers.delete(item.id);
    const el = document.querySelector(`#toastRegion [data-toast-id="${item.id}"]`);
    if (!el) return;
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 200);
}

export function dismissToast(id) {
    removeToastElement(toastQueue.remove(Number(id)));
}

/** Removes the toasts on screen: all, or those matching predicate(item) */
export function dismissToasts(predicate) {
    toastQueue.clear(predicate).forEach(removeToastElement);
}

/**
 * A short message that needs no answer, shown near the bottom of the screen
 * (above the phone's safe area) and read out politely by screen readers.
 * options: { type: 'success'|'info'|'warning'|'queued', title, timeout (ms) }
 */
export function showToast(message, options = {}) {
    if (typeof document === 'undefined' || !document.body) return null;
    const type = ALERT_STYLES[options.type] && options.type !== 'error' ? options.type : 'success';
    const text = String(message ?? '');
    const title = options.title ?? t(ALERT_STYLES[type].title);
    const region = ensureToastRegion();
    const { item, removed } = toastQueue.push({ type, message: text, title });
    removed.forEach(removeToastElement);

    const el = document.createElement('div');
    el.className = `app-toast app-toast--${type}`;
    el.dataset.toastId = String(item.id);
    el.dataset.toastType = type;
    el.innerHTML = `
        <span class="app-toast-icon" aria-hidden="true">${ALERT_STYLES[type].icon}</span>
        <div class="app-toast-body">
            ${title ? `<div class="app-toast-title">${escapeHtml(title)}</div>` : ''}
            <div class="app-toast-message">${escapeHtml(text)}</div>
        </div>
        <button type="button" class="app-toast-close" aria-label="${escapeHtml(t('toast_dismiss'))}">&times;</button>
    `;
    el.querySelector('.app-toast-close').addEventListener('click', () => dismissToast(item.id));
    region.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));

    const timeout = toastTimeout(text, type, options.timeout);
    const start = () => {
        clearTimeout(toastTimers.get(item.id));
        toastTimers.set(item.id, setTimeout(() => dismissToast(item.id), timeout));
    };
    // Kept while the pointer or keyboard is on it
    el.addEventListener('pointerenter', () => clearTimeout(toastTimers.get(item.id)));
    el.addEventListener('pointerleave', start);
    el.addEventListener('focusin', () => clearTimeout(toastTimers.get(item.id)));
    el.addEventListener('focusout', start);
    start();
    return item.id;
}

/** Closes the alert modal if it is open (e.g. on a route change) */
export function closeAlertModal({ restoreFocus = true } = {}) {
    const modal = document.getElementById('alertModal');
    if (modal) {
        modal.style.display = 'none';
        modal.style.pointerEvents = 'none';
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.add('hidden');
    }
    const release = releaseAlertDialog;
    releaseAlertDialog = null;
    release?.({ restoreFocus });
}

/**
 * Feedback to the user. Successes, information and saves queued offline are
 * shown as a toast that needs no tap; errors and warnings stay in a modal
 * (role="alertdialog") that must be closed.
 * @param {string} message
 * @param {boolean|string} type true/'success', 'info', 'offline', 'warning', false/'error'
 * @param {number|object} options a timeout in ms, or { modal: true } to force
 *   the modal, { timeout, title }
 */
export function showAlert(message, type = true, options = {}) {
    const kind = normalizeAlertType(type);
    const opts = normalizeAlertOptions(options);
    if (shouldUseToast(kind, opts)) {
        return showToast(message, { type: kind, timeout: opts.timeout, title: opts.title });
    }

    const modal = document.getElementById('alertModal');
    const iconDiv = document.getElementById('alertModalIcon');
    const titleEl = document.getElementById('alertModalTitle');
    const messageEl = document.getElementById('alertModalMessage');
    const button = document.getElementById('closeAlertModal');
    if (!modal || !iconDiv || !titleEl || !messageEl || !button) return null;

    const style = ALERT_STYLES[kind];
    iconDiv.className = `mx-auto flex items-center justify-center h-12 w-12 rounded-full ${style.iconBg}`;
    iconDiv.innerHTML = style.icon;
    titleEl.textContent = opts.title || t(style.title);
    button.className = `px-4 py-3 text-white text-base font-medium rounded-md w-full shadow-sm focus:outline-none focus:ring-2 ${style.button}`;
    button.textContent = t('btn_ok');
    messageEl.textContent = message;

    announceOverlay();
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.pointerEvents = 'auto';
    modal.setAttribute('aria-hidden', 'false');
    button.onclick = () => closeAlertModal();
    modal.onclick = (event) => {
        if (event.target === modal) closeAlertModal();
    };
    const panel = modal.querySelector('[data-alert-panel]') || modal.firstElementChild;
    releaseAlertDialog = activateDialog(panel, {
        role: 'alertdialog',
        labelledBy: 'alertModalTitle',
        initialFocus: button,
        onEscape: () => closeAlertModal()
    });
    return null;
}

/**
 * A yes/no question in a modal (role="alertdialog"). Resolves true when the
 * user confirms, false on cancel, Escape or a tap outside.
 * options: { title, confirmLabel, cancelLabel, danger }
 */
export function showConfirm(message, options = {}) {
    return new Promise((resolve) => {
        if (typeof document === 'undefined' || !document.body) { resolve(false); return; }
        document.getElementById('confirmModal')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'confirmModal';
        overlay.className = 'app-confirm-modal fixed inset-0 bg-gray-800/60 flex items-end sm:items-center justify-center p-4';
        const confirmClass = options.danger
            ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
            : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500';
        overlay.innerHTML = `
            <div class="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl p-5 text-left" data-confirm-panel>
                <h2 id="confirmModalTitle" class="text-lg font-semibold text-gray-900 dark:text-white">${escapeHtml(options.title || t('confirm_title'))}</h2>
                <p id="confirmModalMessage" class="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">${escapeHtml(message)}</p>
                <div class="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button type="button" id="confirmModalCancel" class="min-h-[44px] px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 font-medium">${escapeHtml(options.cancelLabel || t('btn_cancel'))}</button>
                    <button type="button" id="confirmModalOk" class="min-h-[44px] px-4 py-2 rounded-md text-white font-semibold focus:outline-none focus:ring-2 ${confirmClass}">${escapeHtml(options.confirmLabel || t('btn_ok'))}</button>
                </div>
            </div>
        `;
        const panel = overlay.querySelector('[data-confirm-panel]');
        panel.setAttribute('aria-describedby', 'confirmModalMessage');
        let release = null;
        const finish = (answer) => {
            release?.();
            overlay.remove();
            resolve(answer);
        };
        overlay.querySelector('#confirmModalCancel').addEventListener('click', () => finish(false));
        overlay.querySelector('#confirmModalOk').addEventListener('click', () => finish(true));
        overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
        announceOverlay();
        document.body.appendChild(overlay);
        release = activateDialog(panel, {
            role: 'alertdialog',
            labelledBy: 'confirmModalTitle',
            initialFocus: '#confirmModalCancel',
            onEscape: () => finish(false)
        });
    });
}

/**
 * A page that needs a competition when none is chosen: says so and offers
 * the way to the hub instead of a dead end.
 */
export function renderNoCompetitionState({ message = '' } = {}) {
    return `
        <div class="app-empty-state max-w-md mx-auto my-8 p-6 text-center bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div class="text-3xl mb-2" aria-hidden="true">🏁</div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">${escapeHtml(message || t('no_comp_selected'))}</h2>
            <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('no_comp_selected_hint'))}</p>
            <a href="#hub" class="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 py-2 rounded-lg bg-brand-darkblue hover:bg-blue-900 text-white font-semibold dark:bg-blue-600 dark:hover:bg-blue-500">${escapeHtml(t('btn_choose_competition'))}</a>
        </div>
    `;
}

/**
 * Renderar en responsiv klassfilter-komponent.
 * Visar chips på desktop och en dropdown-meny på mobil.
 * @param {HTMLElement} container - Elementet att rendera i.
 * @param {string[]} labels - Lista på klasser/etiketter.
 * @param {Set<string>} activeSet - Set med aktiva filter.
 * @param {Function} onToggle - Callback(label) när ett filter ändras.
 */
export function renderResponsiveClassFilter(container, labels, activeSet, onToggle) {
    if (!container) return;

    // Spara öppet-tillstånd för dropdown (mobil)
    const existingDetails = container.querySelector('.mobile-filter-dropdown');
    const wasOpen = existingDetails ? existingDetails.hasAttribute('open') : false;
    const portalId = container.dataset.responsiveClassFilterId
        || `class-filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    container.dataset.responsiveClassFilterId = portalId;
    container.__classFilterPortalCleanup?.();
    container.__classFilterPortalCleanup = null;
    document.querySelector(`[data-class-filter-portal="${portalId}"]`)?.remove();

    // CSS-klasser
    const chipBase = "max-w-full truncate px-2 py-1 rounded border text-sm cursor-pointer transition-colors select-none";
    const chipOn = "bg-gray-800 text-white border-gray-800 shadow-sm dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200";
    const chipOff = "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600";

    // Desktop: Chips
    // Vi använder 'hidden md:flex' för att dölja på mobil och visa på desktop
    const desktopHtml = `
        <div class="hidden md:flex flex-wrap gap-2 max-w-full min-w-0 overflow-hidden">
            ${labels.map(lbl => {
        const active = activeSet.has(lbl);
        return `<button type="button" data-filter-val="${escapeHtml(lbl)}" title="${escapeHtml(lbl)}" class="${chipBase} ${active ? chipOn : chipOff}">${escapeHtml(lbl)}</button>`;
    }).join('')}
        </div>
    `;

    // Mobil: Dropdown (Details/Summary)
    const activeCount = activeSet.size;
    const summaryText = activeCount > 0 ? `Filtrera klass (${activeCount})` : 'Filtrera klass';

    const mobileItems = labels.map(lbl => {
        const active = activeSet.has(lbl);
        const checkIcon = active
            ? '<i class="fas fa-check-square text-blue-600 dark:text-blue-400"></i>'
            : '<i class="far fa-square text-gray-400 dark:text-gray-500"></i>';
        const rowBg = active ? 'bg-blue-50 dark:bg-blue-900/30' : '';
        const txtColor = active ? 'text-blue-800 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200';

        return `
            <div data-filter-val="${escapeHtml(lbl)}" class="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600 ${rowBg}">
                <div class="w-5 text-center">${checkIcon}</div>
                <span class="text-sm font-medium ${txtColor} min-w-0 truncate" title="${escapeHtml(lbl)}">${escapeHtml(lbl)}</span>
            </div>
         `;
    }).join('');

    const mobileHtml = `
        <details class="mobile-filter-dropdown md:hidden w-full max-w-full group relative z-[90]" ${wasOpen ? 'open' : ''}>
            <summary class="list-none px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer flex items-center justify-between select-none hover:bg-gray-50 dark:hover:bg-gray-600">
                <span class="min-w-0 truncate">${summaryText}</span>
                <i class="fas fa-chevron-down text-gray-400 text-[10px] ml-2 transition-transform group-open:rotate-180"></i>
            </summary>
            <div data-class-filter-menu data-class-filter-portal="${portalId}" class="fixed bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg max-h-80 overflow-y-auto w-[250px] max-w-[calc(100vw-1rem)]" style="z-index: 2147483647; top: 0; left: 0;" hidden>
                ${mobileItems.length > 0 ? mobileItems : '<div class="p-4 text-gray-500 text-sm italic text-center">Inga klasser tillgängliga</div>'}
            </div>
        </details>
    `;

    container.innerHTML = desktopHtml + mobileHtml;

    const mobileDetails = container.querySelector('.mobile-filter-dropdown');
    const mobileSummary = mobileDetails?.querySelector('summary');
    const mobileMenu = mobileDetails?.querySelector('[data-class-filter-menu]');
    if (mobileMenu) document.body.appendChild(mobileMenu);
    const positionMobileDropdown = () => {
        if (!mobileDetails || !mobileSummary || !mobileMenu || !mobileDetails.open) return;

        const margin = 8;
        const rect = mobileSummary.getBoundingClientRect();
        const menuWidth = Math.min(
            Math.max(rect.width, 250),
            Math.max(250, window.innerWidth - margin * 2)
        );
        const menuHeight = Math.min(mobileMenu.scrollHeight || 320, 320);
        const spaceBelow = window.innerHeight - rect.bottom - margin;
        const top = spaceBelow >= Math.min(menuHeight, 180)
            ? rect.bottom + 4
            : Math.max(margin, rect.top - menuHeight - 4);
        const left = Math.min(
            Math.max(margin, rect.left),
            Math.max(margin, window.innerWidth - menuWidth - margin)
        );

        mobileMenu.hidden = false;
        mobileMenu.style.top = `${Math.round(top)}px`;
        mobileMenu.style.left = `${Math.round(left)}px`;
        mobileMenu.style.width = `${Math.round(menuWidth)}px`;
    };

    const hideMobileDropdown = () => {
        if (mobileMenu) mobileMenu.hidden = true;
    };
    const toggleMobileDropdown = () => {
        if (mobileDetails?.open) requestAnimationFrame(positionMobileDropdown);
        else hideMobileDropdown();
    };
    const handlePortalClick = (e) => {
        const target = e.target.closest('[data-filter-val]');
        if (!target) return;

        e.preventDefault();
        e.stopPropagation();

        const val = target.getAttribute('data-filter-val');
        if (val && onToggle) onToggle(val);
    };
    const handleWindowMove = () => {
        if (mobileDetails?.open) requestAnimationFrame(positionMobileDropdown);
    };
    const removalObserver = new MutationObserver(() => {
        if (!document.body.contains(container)) {
            container.__classFilterPortalCleanup?.();
        }
    });

    mobileDetails?.addEventListener('toggle', toggleMobileDropdown);
    mobileSummary?.addEventListener('click', () => requestAnimationFrame(positionMobileDropdown));
    mobileMenu?.addEventListener('click', handlePortalClick);
    window.addEventListener('resize', handleWindowMove);
    window.addEventListener('scroll', handleWindowMove, true);
    removalObserver.observe(document.body, { childList: true, subtree: true });
    container.__classFilterPortalCleanup = () => {
        mobileDetails?.removeEventListener('toggle', toggleMobileDropdown);
        mobileMenu?.removeEventListener('click', handlePortalClick);
        window.removeEventListener('resize', handleWindowMove);
        window.removeEventListener('scroll', handleWindowMove, true);
        removalObserver.disconnect();
        mobileMenu?.remove();
    };
    if (wasOpen) requestAnimationFrame(positionMobileDropdown);

    // Koppla händelselyssnare (om ej redan gjort på containern)
    if (!container.dataset.wiredResponsive) {
        container.addEventListener('click', (e) => {
            const target = e.target.closest('[data-filter-val]');
            if (!target) return;

            e.preventDefault();
            e.stopPropagation();

            const val = target.getAttribute('data-filter-val');
            if (val && onToggle) {
                onToggle(val);
            }
        });
        container.dataset.wiredResponsive = 'true';
    }
}
