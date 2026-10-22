// The "Nödinfo" card: alarm number, first aid point and the persons on duty
// with tel: links. The public sees the public part; signed-in officials and
// the competition's drivers also the persons' phone numbers (the rules decide:
// emergencyPrivate). Used on the public info page, in the driver portal, in
// the officials' portal and in the menu's "Nöd" sheet.
import { getGlobalState } from '../main.js';
import { getEmergencyPrivate, getEmergencyPublic } from '../services/emergencyInfoService.js';
import { buildEmergencyCard, telHref } from '../services/emergencyInfoUtils.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { t } from '../utils/i18n.js';
import { activateDialog } from './dialogA11y.js';

function phoneLink(phone, extraClass = '') {
    const href = telHref(phone);
    if (!href) return escapeHtml(phone || '');
    // A call button on the row, next to the name (a tap calls)
    return `<a href="${escapeHtml(href)}" class="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 font-bold no-underline hover:bg-red-100 dark:border-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 ${extraClass}"><span aria-hidden="true">&#128222;</span>${escapeHtml(phone)}</a>`;
}

/** The card's markup (card: buildEmergencyCard) */
export function renderEmergencyCardHtml(card) {
    if (!card || card.enabled === false) return '';
    const persons = card.persons.map((person) => `
        <li class="flex items-center justify-between gap-2 border-t border-red-100 dark:border-red-900/40 pt-1">
            <span class="min-w-0 break-words"><span class="font-semibold">${escapeHtml(t(person.labelKey))}:</span> ${escapeHtml(person.name || '')}</span>
            ${person.phone ? phoneLink(person.phone, 'text-red-800 dark:text-red-200') : ''}
        </li>`).join('');
    const firstAid = card.firstAid.place || card.firstAid.phone ? `
        <li class="flex items-center justify-between gap-2 border-t border-red-100 dark:border-red-900/40 pt-1">
            <span class="min-w-0 break-words"><span class="font-semibold">${escapeHtml(t('emergency_first_aid'))}:</span> ${escapeHtml(card.firstAid.place || '')}</span>
            ${card.firstAid.phone ? phoneLink(card.firstAid.phone, 'text-red-800 dark:text-red-200') : ''}
        </li>` : '';
    const hiddenPhones = !card.showsPrivate && card.persons.length
        ? `<p class="mt-2 text-xs text-red-800/80 dark:text-red-200/80">${escapeHtml(t('emergency_phones_hidden'))}</p>`
        : '';
    return `
        <section class="emergency-card rounded-xl border-2 border-red-300 bg-red-50 p-3 text-red-950 shadow-sm dark:border-red-800 dark:bg-red-950/30 dark:text-red-50" aria-labelledby="emergency-card-title">
            <h2 id="emergency-card-title" class="text-lg font-black uppercase tracking-wide">🚑 ${escapeHtml(t('emergency_title'))}</h2>
            <div class="mt-2 flex flex-wrap items-center gap-3">
                <span class="text-sm font-semibold">${escapeHtml(t('emergency_number'))}</span>
                <a href="${escapeHtml(telHref(card.emergencyNumber))}" class="inline-flex min-h-[48px] items-center rounded-lg bg-red-600 px-5 text-2xl font-black text-white shadow hover:bg-red-700">${escapeHtml(card.emergencyNumber)}</a>
            </div>
            <ul class="mt-2 space-y-1 text-sm">${firstAid}${persons}</ul>
            ${hiddenPhones}
        </section>`;
}

/**
 * Loads and renders the card in `container`. options.onlyConfigured: render
 * nothing when the competition has no emergency info saved (the public page).
 * Signed in: the phone numbers too when the rules allow (staff, drivers; a
 * driver's access appears once the portal has matched the equipage, so a
 * refusal is tried once more).
 */
export async function mountEmergencyInfoCard(container, competitionId, { onlyConfigured = false } = {}) {
    if (!container || !competitionId) return;
    const signedIn = !!getGlobalState('currentUser');
    const [publicDoc, privateDoc] = await Promise.all([
        getEmergencyPublic(competitionId),
        signedIn ? getEmergencyPrivate(competitionId) : Promise.resolve(null)
    ]);
    const configured = !!(publicDoc && Object.keys(publicDoc).length) || !!(privateDoc && Object.keys(privateDoc).length);
    const draw = (priv) => {
        if (!container.isConnected) return;
        container.innerHTML = onlyConfigured && !configured ? '' : renderEmergencyCardHtml(buildEmergencyCard(publicDoc, priv));
    };
    draw(privateDoc);
    if (signedIn && privateDoc === null && configured) {
        setTimeout(async () => {
            const retry = await getEmergencyPrivate(competitionId);
            if (retry) draw(retry);
        }, 4000);
    }
}

let releaseSheet = null;

function closeSheet() {
    document.getElementById('emergencyInfoSheet')?.remove();
    const release = releaseSheet;
    releaseSheet = null;
    release?.();
}

/** The menu's "Nöd" button: the card of the current competition in a sheet */
export function openEmergencyInfoSheet() {
    const competition = getGlobalState('currentCompetition');
    closeSheet();
    const overlay = document.createElement('div');
    overlay.id = 'emergencyInfoSheet';
    overlay.className = 'fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-gray-900/60 p-3';
    overlay.innerHTML = `
        <div class="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white p-3 shadow-xl dark:bg-gray-800" data-emergency-panel>
            <div class="mb-2 flex items-center justify-between">
                <span id="emergencySheetTitle" class="text-sm font-bold text-gray-700 dark:text-gray-200">${escapeHtml(competition?.name || t('emergency_title'))}</span>
                <button type="button" class="min-h-[44px] min-w-[44px] text-2xl text-gray-500 hover:text-gray-800 dark:text-gray-300" data-emergency-close aria-label="${escapeHtml(t('toast_dismiss'))}">&times;</button>
            </div>
            <div data-emergency-body>${competition ? `<p class="p-4 text-sm text-gray-500">${escapeHtml(t('official_loading'))}</p>` : `<p class="p-4 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('no_comp_selected'))}</p>`}</div>
        </div>`;
    overlay.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (event.target === overlay || target?.closest('[data-emergency-close]')) closeSheet();
    });
    document.body.appendChild(overlay);
    releaseSheet = activateDialog(overlay.querySelector('[data-emergency-panel]'), {
        labelledBy: 'emergencySheetTitle',
        onEscape: closeSheet
    });
    if (competition?.id) mountEmergencyInfoCard(overlay.querySelector('[data-emergency-body]'), competition.id);
}
