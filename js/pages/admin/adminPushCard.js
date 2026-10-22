// "Push-notiser" in the admin settings, for the superadmin only: the public
// VAPID key (not a secret), on/off, the app address notices open, and the
// per-competition daily limit. Push stays "not available" until the key is
// saved and the switch is on.
import { getPushAdminStatus, sendTestPush, setPushSettings } from '../../services/pushService.js';
import { showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { fillTemplate } from '../../utils/officialTaskUtils.js';
import { mountPushPanel } from '../../ui/pushSettingsPanel.js';

const INPUT = 'mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white';
const BTN = 'min-h-[44px] px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50';

export function getPushCardHtml() {
    return `
    <div id="pushCard" class="md:col-span-2 mt-8 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-sky-200 dark:border-sky-800" style="display:none;">
        <h2 class="text-2xl font-semibold mb-1 dark:text-white">${escapeHtml(t('pushp_title'))}</h2>
        <p class="text-sm text-gray-500 mb-3 dark:text-gray-400">${escapeHtml(t('pushp_intro'))}</p>
        <div id="pushpStatus" class="rounded-md border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200" aria-live="polite">${escapeHtml(t('loading_data'))}</div>
        <details class="mt-3 text-sm text-gray-700 dark:text-gray-200">
            <summary class="summary-cue cursor-pointer font-semibold min-h-[44px] flex items-center">${escapeHtml(t('pushp_howto_title'))}</summary>
            <ol class="list-decimal list-inside space-y-1 mt-1">
                <li>${escapeHtml(t('pushp_howto_1'))}</li>
                <li>${escapeHtml(t('pushp_howto_2'))}</li>
                <li>${escapeHtml(t('pushp_howto_3'))}</li>
                <li>${escapeHtml(t('pushp_howto_4'))}</li>
            </ol>
        </details>
        <form id="pushpForm" class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4" autocomplete="off">
            <!-- 1) key, 2) switched on, 3) save -->
            <div class="md:col-span-2">
                <label for="pushpVapidKey" class="block text-sm font-medium text-gray-700 dark:text-gray-300">1. ${escapeHtml(t('pushp_vapid_key'))}</label>
                <input type="text" id="pushpVapidKey" class="${INPUT} font-mono text-xs" spellcheck="false" autocapitalize="off">
                <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">${escapeHtml(t('pushp_vapid_hint'))}</p>
            </div>
            <label class="md:col-span-2 flex items-center gap-3 min-h-[44px] text-sm font-medium text-gray-800 dark:text-gray-100"><input type="checkbox" id="pushpEnabled" class="h-5 w-5"> 2. ${escapeHtml(t('pushp_enabled'))}</label>
            <div class="md:col-span-2">
                <button type="submit" id="pushpSaveBtn" class="${BTN} w-full sm:w-auto bg-sky-600 text-white hover:bg-sky-700">3. ${escapeHtml(t('pushp_save'))}</button>
            </div>
            <details class="md:col-span-2 text-sm text-gray-700 dark:text-gray-200">
                <summary class="summary-cue cursor-pointer font-semibold min-h-[44px] flex items-center">${escapeHtml(t('pushp_more_settings'))}</summary>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
                    <div>
                        <label for="pushpAppUrl" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('pushp_app_url'))}</label>
                        <input type="url" id="pushpAppUrl" class="${INPUT}" placeholder="https://...">
                        <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">${escapeHtml(t('pushp_app_url_hint'))}</p>
                    </div>
                    <div>
                        <label for="pushpCompLimit" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('pushp_comp_limit'))}</label>
                        <input type="number" id="pushpCompLimit" min="0" step="1" inputmode="numeric" class="${INPUT}">
                    </div>
                </div>
            </details>
            <!-- 4) this device, 5) test -->
            <div class="md:col-span-2 rounded-md border border-sky-200 dark:border-sky-800 p-3">
                <h3 class="text-sm font-bold text-gray-900 dark:text-white">4. ${escapeHtml(t('pushp_device_title'))}</h3>
                <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">${escapeHtml(t('pushp_device_hint'))}</p>
                <div id="pushpDevice" class="mt-2"></div>
            </div>
            <div class="md:col-span-2">
                <button type="button" id="pushpTestBtn" class="${BTN} w-full sm:w-auto border border-sky-600 text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/30">5. ${escapeHtml(t('pushp_test'))}</button>
            </div>
            <p id="pushpResult" class="md:col-span-2 text-sm text-gray-700 dark:text-gray-200 break-words" aria-live="polite"></p>
        </form>    </div>`;
}

/** Shows and wires the card (call only for a superadmin) */
export function setupPushCard() {
    const card = document.getElementById('pushCard');
    if (!card) return;
    card.style.display = 'block';
    const $ = (id) => document.getElementById(id);
    const result = (text) => { $('pushpResult').textContent = text; };

    function renderStatus(s) {
        const badge = s.configured
            ? (s.enabled ? t('pushp_on') : t('pushp_paused'))
            : t('pushp_not_configured');
        $('pushpStatus').innerHTML = `
            <div class="font-semibold">${escapeHtml(badge)}</div>
            <div class="mt-1 text-xs">${escapeHtml(fillTemplate(t('pushp_devices'), { n: Number(s.devices) || 0 }))}</div>`;
        $('pushpVapidKey').value = s.vapidKey || '';
        // The hosting address is the sensible default for the notice links
        $('pushpAppUrl').value = s.appUrl || `${window.location.origin}/`;
        $('pushpCompLimit').value = s.competitionDailyLimit ?? '';
        $('pushpEnabled').checked = s.enabled === true;
    }

    async function load() {
        try {
            renderStatus(await getPushAdminStatus());
        } catch (err) {
            console.warn('Push-notisernas status kunde inte läsas', err);
            $('pushpStatus').textContent = t('pushp_status_unavailable');
        }
    }

    $('pushpForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = { enabled: $('pushpEnabled').checked };
        const vapidKey = $('pushpVapidKey').value.trim();
        if (vapidKey) payload.vapidKey = vapidKey;
        else payload.clearVapidKey = true;
        const appUrl = $('pushpAppUrl').value.trim();
        if (appUrl) payload.appUrl = appUrl;
        const limitRaw = $('pushpCompLimit').value.trim();
        if (limitRaw !== '') payload.competitionDailyLimit = Number(limitRaw);
        const button = $('pushpSaveBtn');
        button.disabled = true;
        try {
            await setPushSettings(payload);
            showAlert(t('pushp_saved'));
            await load();
        } catch (err) {
            console.error(err);
            showAlert(err?.message || t('pushp_save_failed'), false);
        } finally {
            button.disabled = false;
        }
    });

    $('pushpTestBtn').addEventListener('click', async () => {
        const button = $('pushpTestBtn');
        button.disabled = true;
        result(t('pushp_testing'));
        try {
            const res = await sendTestPush();
            result(Number(res?.sent) > 0 ? t('pushp_test_ok') : fillTemplate(t('pushp_test_none'), { status: res?.status || '' }));
        } catch (err) {
            console.error(err);
            result(fillTemplate(t('pushp_test_failed'), { error: err?.message || '' }));
        } finally {
            button.disabled = false;
        }
    });

    // Turning notifications on for this device can be done right here
    mountPushPanel($('pushpDevice'), { role: 'device', compact: true, title: '' })
        .catch((error) => console.warn('Notiser kunde inte visas:', error));

    load();
}
