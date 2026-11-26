// "Administratörer som kan skapa tävlingar" in the admin settings, for the
// superadmin only: grant or remove the global admin role by e-mail.
import { getGlobalAdmins, setGlobalAdmin } from '../../services/globalAdminService.js';
import { showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { fillTemplate } from '../../utils/officialTaskUtils.js';

const BTN = 'min-h-[44px] px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50';

export function getGlobalAdminsCardHtml() {
    return `
    <div id="globalAdminsCard" class="md:col-span-2 mt-8 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-indigo-200 dark:border-indigo-800" style="display:none;">
        <h2 class="text-2xl font-semibold mb-1 dark:text-white">${escapeHtml(t('gadm_title'))}</h2>
        <p class="text-sm text-gray-500 mb-1 dark:text-gray-400">${escapeHtml(t('gadm_intro'))}</p>
        <p class="text-xs text-amber-700 dark:text-amber-300 mb-3">${escapeHtml(t('gadm_warning'))}</p>
        <form id="gadmForm" class="flex flex-col sm:flex-row gap-2" autocomplete="off">
            <label for="gadmEmail" class="sr-only">${escapeHtml(t('gadm_email'))}</label>
            <input type="email" id="gadmEmail" required placeholder="${escapeHtml(t('gadm_email'))}" class="flex-1 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
            <button type="submit" id="gadmAddBtn" class="${BTN} bg-indigo-600 text-white hover:bg-indigo-700">${escapeHtml(t('gadm_add'))}</button>
        </form>
        <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">${escapeHtml(t('gadm_hint'))}</p>
        <div id="gadmList" class="mt-4 text-sm text-gray-700 dark:text-gray-200" aria-live="polite">${escapeHtml(t('loading_data'))}</div>
    </div>`;
}

/** Shows and wires the card (call only for a superadmin) */
export function setupGlobalAdminsCard() {
    const card = document.getElementById('globalAdminsCard');
    if (!card) return;
    card.style.display = 'block';
    const list = document.getElementById('gadmList');
    const form = document.getElementById('gadmForm');
    const input = document.getElementById('gadmEmail');

    function render(admins) {
        if (!admins.length) {
            list.textContent = t('gadm_none');
            return;
        }
        list.innerHTML = `<ul class="divide-y divide-gray-200 dark:divide-gray-700">${admins.map(a => `
            <li class="flex items-center justify-between gap-2 py-2">
                <span class="break-all">${escapeHtml(a.email || a.uid)}</span>
                ${a.role === 'superadmin'
                    ? `<span class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(t('gadm_superadmin'))}</span>`
                    : `<button type="button" data-gadm-remove="${escapeHtml(a.email)}" class="${BTN} border border-red-300 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30">${escapeHtml(t('gadm_remove'))}</button>`}
            </li>`).join('')}</ul>`;
    }

    async function load() {
        try {
            render(await getGlobalAdmins());
        } catch (err) {
            console.warn('Administratörerna kunde inte läsas', err);
            list.textContent = t('gadm_load_failed');
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = input.value.trim();
        const button = document.getElementById('gadmAddBtn');
        button.disabled = true;
        try {
            const result = await setGlobalAdmin(email, true);
            showAlert(fillTemplate(t(result.changed ? 'gadm_added' : 'gadm_already'), { email: result.email }));
            input.value = '';
            await load();
        } catch (err) {
            console.error(err);
            showAlert(err?.message || t('gadm_failed'), false);
        } finally {
            button.disabled = false;
        }
    });

    list.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-gadm-remove]');
        if (!button) return;
        const email = button.dataset.gadmRemove;
        if (!window.confirm(fillTemplate(t('gadm_remove_confirm'), { email }))) return;
        button.disabled = true;
        try {
            await setGlobalAdmin(email, false);
            showAlert(fillTemplate(t('gadm_removed'), { email }));
            await load();
        } catch (err) {
            console.error(err);
            showAlert(err?.message || t('gadm_failed'), false);
            button.disabled = false;
        }
    });

    load();
}
