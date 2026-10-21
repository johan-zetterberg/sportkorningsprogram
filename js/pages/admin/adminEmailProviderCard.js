// "E-posttjänst" in the admin settings, for the superadmin only: the app's one
// e-mail provider (Brevo): sender address, limits, on/off and the API key
// (write-only: never shown, kept when the field is left empty).
import {
    getEmailProviderStatus,
    setEmailProviderSettings,
    sendTestEmail,
    retryQueuedMail
} from '../../services/mailService.js';
import { showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { fillTemplate } from '../../utils/officialTaskUtils.js';
import { isPlausibleEmail } from '../../utils/mailUtils.js';

const INPUT = 'mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white';
const BTN = 'min-h-[44px] px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50';

export function isSuperadminUser(user) {
    if (!user) return false;
    const roles = Array.isArray(user.roles) ? user.roles : [];
    return user.superadmin === true || user.role === 'superadmin' || roles.includes('superadmin');
}

export function getEmailProviderCardHtml() {
    return `
    <div id="emailProviderCard" class="md:col-span-2 mt-8 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-sky-200 dark:border-sky-800" style="display:none;">
        <h2 class="text-2xl font-semibold mb-1 dark:text-white">${escapeHtml(t('mailp_title'))}</h2>
        <p class="text-sm text-gray-500 mb-3 dark:text-gray-400">${escapeHtml(t('mailp_intro'))}</p>
        <div id="mailpStatus" class="rounded-md border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200" aria-live="polite">${escapeHtml(t('loading_data'))}</div>

        <form id="mailpForm" class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4" autocomplete="off">
            <div>
                <label for="mailpProvider" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mailp_provider'))}</label>
                <input type="text" id="mailpProvider" value="brevo" readonly class="${INPUT} bg-gray-50">
            </div>
            <div>
                <label for="mailpFromAddress" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mailp_from_address'))}</label>
                <input type="email" id="mailpFromAddress" class="${INPUT}" placeholder="noreply@drivelive.example">
            </div>
            <div>
                <label for="mailpFromDomain" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mailp_from_domain'))}</label>
                <input type="text" id="mailpFromDomain" class="${INPUT}" placeholder="drivelive.example">
            </div>
            <div>
                <label for="mailpLinkBase" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mailp_link_base'))}</label>
                <input type="url" id="mailpLinkBase" class="${INPUT}" placeholder="https://...">
                <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">${escapeHtml(t('mailp_link_base_hint'))}</p>
            </div>
            <div>
                <label for="mailpDailyLimit" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mailp_daily_limit'))}</label>
                <input type="number" id="mailpDailyLimit" min="0" step="1" inputmode="numeric" class="${INPUT}">
            </div>
            <div>
                <label for="mailpCompLimit" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mailp_comp_limit'))}</label>
                <input type="number" id="mailpCompLimit" min="0" step="1" inputmode="numeric" class="${INPUT}">
            </div>
            <div class="md:col-span-2">
                <label for="mailpApiKey" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mailp_api_key'))}</label>
                <input type="password" id="mailpApiKey" autocomplete="new-password" class="${INPUT}" placeholder="">
                <p id="mailpApiKeyHint" class="mt-1 text-[11px] text-gray-500 dark:text-gray-400"></p>
                <label id="mailpClearKeyWrap" class="hidden flex items-center gap-3 min-h-[44px] text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" id="mailpClearKey" class="h-5 w-5"> ${escapeHtml(t('mailp_clear_key'))}</label>
            </div>
            <label class="md:col-span-2 flex items-center gap-3 min-h-[44px] text-sm font-medium text-gray-800 dark:text-gray-100"><input type="checkbox" id="mailpEnabled" class="h-5 w-5"> ${escapeHtml(t('mailp_enabled'))}</label>
            <div class="md:col-span-2 flex flex-col sm:flex-row flex-wrap gap-2">
                <button type="submit" id="mailpSaveBtn" class="${BTN} bg-sky-600 text-white hover:bg-sky-700">${escapeHtml(t('mailp_save'))}</button>
                <button type="button" id="mailpTestBtn" class="${BTN} border border-sky-600 text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/30">${escapeHtml(t('mailp_test'))}</button>
                <button type="button" id="mailpRetryBtn" class="${BTN} border border-sky-600 text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/30">${escapeHtml(t('mailp_retry'))}</button>
            </div>
            <p id="mailpResult" class="md:col-span-2 text-sm text-gray-700 dark:text-gray-200 break-words" aria-live="polite"></p>
        </form>
    </div>`;
}

/** Shows and wires the card (call only for a superadmin) */
export function setupEmailProviderCard() {
    const card = document.getElementById('emailProviderCard');
    if (!card) return;
    card.style.display = 'block';
    const $ = (id) => document.getElementById(id);
    const result = (text) => { $('mailpResult').textContent = text; };

    function renderStatus(s) {
        const waiting = s.waiting || {};
        const badge = s.configured
            ? (s.enabled ? t('mail_configured') : t('mail_paused'))
            : t('mail_not_configured');
        $('mailpStatus').innerHTML = `
            <div class="font-semibold">${escapeHtml(badge)}${s.provider ? ` · ${escapeHtml(s.provider)}` : ''}</div>
            <div class="mt-1 text-xs">${escapeHtml(fillTemplate(t('mailp_usage'), { sent: s.sentToday || 0, limit: s.dailyLimit || 0 }))}</div>
            <div class="mt-1 text-xs">${escapeHtml(fillTemplate(t('mailp_waiting'), { notConfigured: waiting.notConfigured || 0, blocked: waiting.blocked || 0 }))}</div>`;
        $('mailpFromAddress').value = s.fromAddress || '';
        $('mailpFromDomain').value = s.fromDomain || '';
        $('mailpDailyLimit').value = s.dailyLimit ?? '';
        $('mailpCompLimit').value = s.competitionDailyLimit ?? '';
        $('mailpEnabled').checked = s.enabled === true;
        // The key is never shown: only whether one is saved
        $('mailpApiKey').value = '';
        $('mailpApiKeyHint').textContent = s.hasApiKey ? t('mailp_key_keep') : t('mailp_key_missing');
        $('mailpClearKeyWrap').classList.toggle('hidden', !s.hasApiKey);
        $('mailpClearKey').checked = false;
    }

    async function load() {
        try {
            renderStatus(await getEmailProviderStatus());
        } catch (err) {
            console.warn('E-posttjänstens status kunde inte läsas', err);
            $('mailpStatus').textContent = t('mail_status_unavailable');
        }
    }

    $('mailpForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const fromAddress = $('mailpFromAddress').value.trim();
        if (!isPlausibleEmail(fromAddress)) { showAlert(t('mail_address_invalid'), false); return; }
        const num = (id) => {
            const raw = $(id).value.trim();
            return raw === '' ? undefined : Number(raw);
        };
        const payload = {
            provider: 'brevo',
            fromAddress,
            enabled: $('mailpEnabled').checked
        };
        const fromDomain = $('mailpFromDomain').value.trim();
        if (fromDomain) payload.fromDomain = fromDomain;
        const linkBase = $('mailpLinkBase').value.trim();
        if (linkBase) payload.linkBaseUrl = linkBase;
        const dailyLimit = num('mailpDailyLimit');
        if (dailyLimit !== undefined) payload.dailyLimit = dailyLimit;
        const compLimit = num('mailpCompLimit');
        if (compLimit !== undefined) payload.competitionDailyLimit = compLimit;
        // Empty key = keep the saved one
        const apiKey = $('mailpApiKey').value.trim();
        if (apiKey) payload.apiKey = apiKey;
        if ($('mailpClearKey').checked && !apiKey) payload.clearApiKey = true;
        const button = $('mailpSaveBtn');
        button.disabled = true;
        try {
            await setEmailProviderSettings(payload);
            showAlert(t('mailp_saved'));
            await load();
        } catch (err) {
            console.error(err);
            showAlert(err?.message || t('mail_save_failed'), false);
        } finally {
            button.disabled = false;
        }
    });

    $('mailpTestBtn').addEventListener('click', async () => {
        const button = $('mailpTestBtn');
        button.disabled = true;
        result(t('mailp_testing'));
        try {
            const res = await sendTestEmail();
            result(res.ok ? t('mailp_test_ok') : fillTemplate(t('mailp_test_failed'), { error: res.error || '' }));
        } catch (err) {
            console.error(err);
            result(fillTemplate(t('mailp_test_failed'), { error: err?.message || '' }));
        } finally {
            button.disabled = false;
        }
    });

    $('mailpRetryBtn').addEventListener('click', async () => {
        const button = $('mailpRetryBtn');
        button.disabled = true;
        result(t('mailp_retrying'));
        try {
            const res = await retryQueuedMail({});
            const n = Array.isArray(res.results) ? res.results.length : 0;
            result(fillTemplate(t('mailp_retry_done'), { n }));
            await load();
        } catch (err) {
            console.error(err);
            result(err?.message || t('mailp_retry_failed'));
        } finally {
            button.disabled = false;
        }
    });

    load();
}
