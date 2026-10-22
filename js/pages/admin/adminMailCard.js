// E-mail in the competition admin (Kommunikation): the "E-post" card (status,
// sender settings, Reply-To check, test mail, log) and the "send as e-mail too"
// options of the message form. The server does the sending; with no provider
// set up the mail waits with the status not_configured.
import {
    getCompetitionMailStatus,
    getEmailSettings,
    saveEmailSettings,
    requestReplyToVerification,
    queueCompetitionMail,
    previewMailAudience,
    getRecentMailQueue
} from '../../services/mailService.js';
import { showAlert } from '../../ui/components.js';
import { t } from '../../utils/i18n.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { fillTemplate } from '../../utils/officialTaskUtils.js';
import { senderPreviewName } from './adminMailCardUtils.js';
import {
    MAIL_REASON_MAX,
    SENDER_NAME_MAX,
    SIGNATURE_MAX,
    isPlausibleEmail,
    mailCountsSummary,
    mailKindKey,
    mailStatusKey,
    mailStatusTone,
    mailTimeMillis,
    messageModeToMailAudience,
    replyToState,
    summarizePreview
} from '../../utils/mailUtils.js';

const INPUT = 'mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white';
const BTN = 'min-h-[44px] px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50';
const TONE_CLASSES = {
    ok: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
    wait: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
    bad: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
};

export function renderMailStatusBadge(status) {
    return `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_CLASSES[mailStatusTone(status)]}">${escapeHtml(t(mailStatusKey(status)))}</span>`;
}

/** One line per queued mail (kind, subject, time, status, counts, error) */
export function renderMailLog(items) {
    if (!Array.isArray(items) || !items.length) {
        return `<p class="text-sm text-gray-400 italic">${escapeHtml(t('mail_log_empty'))}</p>`;
    }
    return `<ul class="space-y-2">${items.map((item) => {
        const counts = mailCountsSummary(item.counts);
        const ms = mailTimeMillis(item);
        const parts = [];
        if (counts.recipients) parts.push(fillTemplate(t('mail_log_counts'), { sent: counts.sent, total: counts.recipients }));
        if (counts.failed) parts.push(fillTemplate(t('mail_log_failed'), { n: counts.failed }));
        if (counts.skippedOptOut) parts.push(fillTemplate(t('mail_log_opted_out'), { n: counts.skippedOptOut }));
        if (counts.withoutEmail) parts.push(fillTemplate(t('mail_log_without_email'), { n: counts.withoutEmail }));
        return `<li class="rounded-md border border-gray-200 dark:border-gray-700 p-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-semibold text-gray-800 dark:text-gray-100 break-words min-w-0">${escapeHtml(item.subject || '')}</span>
                ${renderMailStatusBadge(item.status)}
            </div>
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(t(mailKindKey(item.kind)))}${ms ? ` · ${escapeHtml(new Date(ms).toLocaleString('sv-SE'))}` : ''}${parts.length ? ` · ${escapeHtml(parts.join(', '))}` : ''}</div>
            ${item.reason ? `<div class="mt-1 text-xs text-gray-600 dark:text-gray-300 break-words">${escapeHtml(fillTemplate(t('mail_log_reason'), { reason: String(item.reason), role: String(item.createdByRole || '') }))}</div>` : ''}
            ${item.error ? `<div class="mt-1 text-xs text-red-700 dark:text-red-300 break-words">${escapeHtml(String(item.error))}</div>` : ''}
        </li>`;
    }).join('')}</ul>`;
}

export function getMailCardHtml() {
    return `
    <div id="mailCard" class="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border-l-4 border-sky-500 border dark:border-gray-700">
        <h2 class="text-2xl font-semibold mb-1 dark:text-white">${escapeHtml(t('mail_card_title'))}</h2>
        <p class="text-sm text-gray-500 mb-3 dark:text-gray-400">${escapeHtml(t('mail_card_intro'))}</p>
        <div id="mailStatusLine" class="rounded-md border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200" aria-live="polite">${escapeHtml(t('loading_data'))}</div>

        <form id="mailSettingsForm" class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <label for="mailSenderName" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mail_sender_name'))}</label>
                <input type="text" id="mailSenderName" maxlength="${SENDER_NAME_MAX}" class="${INPUT}" placeholder="${escapeHtml(t('mail_sender_name_ph'))}">
                <p id="mailSenderPreview" class="mt-1 text-[11px] text-gray-500 dark:text-gray-400"></p>
            </div>
            <div>
                <label for="mailReplyTo" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mail_reply_to'))}</label>
                <input type="email" id="mailReplyTo" autocomplete="off" class="${INPUT}" placeholder="sekretariat@klubben.se">
                <div class="mt-2 flex flex-wrap items-center gap-2">
                    <span id="mailReplyToBadge"></span>
                    <button type="button" id="mailVerifyBtn" class="${BTN} hidden border border-sky-600 text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/30">${escapeHtml(t('mail_verify_btn'))}</button>
                </div>
                <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">${escapeHtml(t('mail_reply_to_hint'))}</p>
            </div>
            <div class="md:col-span-2">
                <label for="mailSignature" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(t('mail_signature'))}</label>
                <textarea id="mailSignature" rows="3" maxlength="${SIGNATURE_MAX}" class="${INPUT}"></textarea>
            </div>
            <div class="md:col-span-2 space-y-1">
                <label class="flex items-center gap-3 min-h-[44px] text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" id="mailAutoVolunteer" class="h-5 w-5"> ${escapeHtml(t('mail_auto_volunteer'))}</label>
                <label class="flex items-center gap-3 min-h-[44px] text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" id="mailAutoVet" class="h-5 w-5"> ${escapeHtml(t('mail_auto_vet'))}</label>
            </div>
            <div class="md:col-span-2 flex flex-col sm:flex-row gap-2">
                <button type="submit" id="mailSaveBtn" class="${BTN} bg-sky-600 text-white hover:bg-sky-700">${escapeHtml(t('mail_save_btn'))}</button>
                <button type="button" id="mailTestBtn" class="${BTN} border border-sky-600 text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/30">${escapeHtml(t('mail_test_btn'))}</button>
            </div>
        </form>

        <div class="mt-6">
            <div class="flex items-center justify-between gap-2 mb-2">
                <h3 class="text-lg font-semibold dark:text-white">${escapeHtml(t('mail_log_title'))}</h3>
                <button type="button" id="mailLogRefreshBtn" class="${BTN} text-sky-800 dark:text-sky-200 hover:underline">${escapeHtml(t('mail_log_refresh'))}</button>
            </div>
            <div id="mailLogList" class="min-h-[40px]"></div>
        </div>
    </div>`;
}

/** Wires the E-post card. */
export function setupMailCard(competition) {
    const card = document.getElementById('mailCard');
    if (!card) return;
    const competitionId = competition.id;
    const $ = (id) => document.getElementById(id);
    let status = null;
    let settings = {};

    function renderStatus() {
        const line = $('mailStatusLine');
        if (!line) return;
        if (!status) { line.textContent = t('mail_status_unavailable'); return; }
        const badge = !status.configured
            ? `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_CLASSES.wait}">${escapeHtml(t('mail_not_configured'))}</span>`
            : !status.enabled
                ? `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_CLASSES.wait}">${escapeHtml(t('mail_paused'))}</span>`
                : `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_CLASSES.ok}">${escapeHtml(t('mail_configured'))}</span>`;
        const note = !status.configured ? t('mail_not_configured_note') : (!status.enabled ? t('mail_paused_note') : '');
        const sender = status.fromName && status.fromAddress ? `<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(fillTemplate(t('mail_sender_line'), { name: status.fromName, address: status.fromAddress }))}</div>` : '';
        line.innerHTML = `<div class="flex flex-wrap items-center gap-2">${badge}<span>${escapeHtml(fillTemplate(t('mail_sent_today'), { sent: status.sentToday || 0, limit: status.dailyLimit || 0 }))}</span></div>
            ${note ? `<div class="mt-1 text-xs">${escapeHtml(note)}</div>` : ''}${sender}`;
        const preview = $('mailSenderPreview');
        if (preview && status.fromName) preview.textContent = fillTemplate(t('mail_sender_preview'), { name: senderPreviewName(status.fromName) });
    }

    function renderReplyToBadge() {
        const state = replyToState({ ...settings, replyTo: $('mailReplyTo')?.value });
        const badge = $('mailReplyToBadge');
        const verifyBtn = $('mailVerifyBtn');
        if (!badge || !verifyBtn) return;
        if (state === 'verified') {
            badge.innerHTML = `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_CLASSES.ok}">${escapeHtml(t('mail_reply_verified'))}</span>`;
        } else if (state === 'unverified') {
            badge.innerHTML = `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_CLASSES.wait}">${escapeHtml(t('mail_reply_unverified'))}</span>`;
        } else {
            badge.innerHTML = '';
        }
        verifyBtn.classList.toggle('hidden', state !== 'unverified');
    }

    async function loadStatus() {
        try {
            status = await getCompetitionMailStatus(competitionId);
        } catch (err) {
            console.warn('E-poststatus kunde inte läsas', err);
            status = null;
        }
        renderStatus();
    }

    async function loadSettings() {
        try {
            settings = await getEmailSettings(competitionId);
        } catch (err) {
            console.warn('E-postinställningar kunde inte läsas', err);
            settings = {};
        }
        $('mailSenderName').value = settings.senderName || '';
        $('mailReplyTo').value = settings.replyTo || '';
        $('mailSignature').value = settings.signature || '';
        $('mailAutoVolunteer').checked = settings.autoVolunteerConfirmation === true;
        $('mailAutoVet').checked = settings.autoVetDecisionMail === true;
        renderReplyToBadge();
    }

    async function loadLog() {
        const host = $('mailLogList');
        if (!host) return;
        try {
            host.innerHTML = renderMailLog(await getRecentMailQueue(competitionId, 20));
        } catch (err) {
            console.warn('E-postloggen kunde inte läsas', err);
            host.innerHTML = `<p class="text-sm text-red-700 dark:text-red-300">${escapeHtml(t('mail_log_failed_load'))}</p>`;
        }
    }

    function readForm() {
        return {
            senderName: $('mailSenderName').value,
            replyTo: $('mailReplyTo').value,
            signature: $('mailSignature').value,
            autoVolunteerConfirmation: $('mailAutoVolunteer').checked,
            autoVetDecisionMail: $('mailAutoVet').checked
        };
    }

    async function save() {
        const values = readForm();
        if (values.replyTo.trim() && !isPlausibleEmail(values.replyTo)) {
            showAlert(t('mail_address_invalid'), false);
            return false;
        }
        await saveEmailSettings(competitionId, values);
        settings = await getEmailSettings(competitionId);
        $('mailReplyTo').value = settings.replyTo || '';
        renderReplyToBadge();
        await loadStatus();
        return true;
    }

    $('mailReplyTo').addEventListener('input', renderReplyToBadge);

    $('mailSettingsForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = $('mailSaveBtn');
        button.disabled = true;
        try {
            if (await save()) showAlert(t('mail_saved'));
        } catch (err) {
            console.error(err);
            showAlert(`${t('mail_save_failed')} ${err?.message || ''}`.trim(), false);
        } finally {
            button.disabled = false;
        }
    });

    $('mailVerifyBtn').addEventListener('click', async () => {
        const button = $('mailVerifyBtn');
        button.disabled = true;
        try {
            if (!await save()) return;
            const result = await requestReplyToVerification(competitionId);
            if (result.alreadyVerified) {
                showAlert(t('mail_reply_already_verified'));
            } else {
                showAlert(fillTemplate(t('mail_verify_sent'), { address: result.address || '' }));
            }
            await loadLog();
        } catch (err) {
            console.error(err);
            showAlert(err?.message || t('mail_verify_failed'), false);
        } finally {
            button.disabled = false;
        }
    });

    $('mailTestBtn').addEventListener('click', async () => {
        const button = $('mailTestBtn');
        button.disabled = true;
        try {
            const result = await queueCompetitionMail({
                competitionId,
                kind: 'test',
                subject: t('mail_test_subject'),
                text: t('mail_test_text')
            });
            showAlert(result.status === 'not_configured' || (status && !status.configured) ? t('mail_test_queued_waiting') : t('mail_test_queued'));
            await Promise.all([loadLog(), loadStatus()]);
        } catch (err) {
            console.error(err);
            showAlert(err?.message || t('mail_test_failed'), false);
        } finally {
            button.disabled = false;
        }
    });

    $('mailLogRefreshBtn').addEventListener('click', () => { loadLog(); loadStatus(); });

    loadStatus();
    loadSettings();
    loadLog();
}

// --- "Send as e-mail too" in the message form ---

export function getMessageMailOptionsHtml() {
    return `
    <div id="msgMailBox" class="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-900/10 p-3 space-y-1">
        <label class="flex items-center gap-3 min-h-[44px] text-sm font-medium text-gray-800 dark:text-gray-100"><input type="checkbox" id="msgSendMail" class="h-5 w-5"> <span id="msgSendMailLabel">${escapeHtml(t('mail_msg_send_too'))}</span></label>
        <div id="msgMailDetails" class="hidden space-y-1 pl-1">
            <label class="flex items-center gap-3 min-h-[44px] text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" id="msgMailEssential" class="h-5 w-5"> ${escapeHtml(t('mail_msg_essential'))}</label>
            <div id="msgMailReasonBox" class="hidden">
                <label for="msgMailReason" class="block text-xs font-medium text-gray-700 dark:text-gray-200">${escapeHtml(t('mail_msg_reason'))}</label>
                <input type="text" id="msgMailReason" maxlength="${MAIL_REASON_MAX}" class="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white p-2 text-sm min-h-[44px]" placeholder="${escapeHtml(t('mail_msg_reason_ph'))}">
            </div>
            <p id="msgMailPreview" class="text-xs text-gray-700 dark:text-gray-200" aria-live="polite"></p>
            <p id="msgMailNotConfigured" class="hidden text-xs text-amber-800 dark:text-amber-200">${escapeHtml(t('mail_msg_waits_note'))}</p>
        </div>
    </div>`;
}

/**
 * Wires the message form's mail options.
 * getAudience() -> { mode, selectedDrivers } for the form's current audience.
 * Returns { requested(), essential(), refresh(), setEditing(bool) }.
 */
export function setupMessageMailOptions(competitionId, getAudience) {
    const box = document.getElementById('msgMailBox');
    if (!box) return null;
    const sendBox = document.getElementById('msgSendMail');
    const details = document.getElementById('msgMailDetails');
    const essentialBox = document.getElementById('msgMailEssential');
    const reasonBox = document.getElementById('msgMailReasonBox');
    const reasonInput = document.getElementById('msgMailReason');
    const previewEl = document.getElementById('msgMailPreview');
    const waitNote = document.getElementById('msgMailNotConfigured');
    let timer = null;
    let seq = 0;
    let configured = null;

    async function loadConfigured() {
        try {
            const status = await getCompetitionMailStatus(competitionId);
            configured = status.configured === true && status.enabled !== false;
        } catch (_) {
            configured = null;
        }
        waitNote?.classList.toggle('hidden', !(sendBox.checked && configured === false));
    }

    async function updatePreview() {
        if (!sendBox.checked) return;
        const { mode, selectedDrivers } = getAudience();
        const audience = messageModeToMailAudience(mode, { selectedDrivers });
        const mine = ++seq;
        if (!audience) { previewEl.textContent = t('mail_preview_none'); return; }
        previewEl.textContent = t('mail_preview_loading');
        try {
            const result = await previewMailAudience({ competitionId, audience, category: essentialBox.checked ? 'essential' : 'info' });
            if (mine !== seq) return;
            const s = summarizePreview(result);
            const parts = [fillTemplate(t('mail_preview_recipients'), { n: s.recipients })];
            if (s.optedOut) parts.push(fillTemplate(t('mail_preview_opted_out'), { n: s.optedOut }));
            if (s.withoutEmail) parts.push(fillTemplate(t('mail_preview_without_email'), { n: s.withoutEmail }));
            if (s.unknown) parts.push(fillTemplate(t('mail_preview_unknown'), { n: s.unknown }));
            previewEl.textContent = parts.join(' · ');
        } catch (err) {
            if (mine !== seq) return;
            previewEl.textContent = t('mail_preview_failed');
        }
    }

    function refresh() {
        details.classList.toggle('hidden', !sendBox.checked);
        reasonBox?.classList.toggle('hidden', !essentialBox.checked);
        waitNote?.classList.toggle('hidden', !(sendBox.checked && configured === false));
        clearTimeout(timer);
        if (sendBox.checked) timer = setTimeout(updatePreview, 350);
    }

    sendBox.addEventListener('change', () => {
        if (sendBox.checked && configured === null) loadConfigured();
        refresh();
    });
    essentialBox.addEventListener('change', refresh);
    loadConfigured();

    return {
        requested: () => sendBox.checked,
        essential: () => sendBox.checked && essentialBox.checked,
        // Why the message is essential (required by the server, shown in the log)
        reason: () => String(reasonInput?.value || '').trim(),
        refresh,
        reset: () => {
            sendBox.checked = false;
            essentialBox.checked = false;
            if (reasonInput) reasonInput.value = '';
            previewEl.textContent = '';
            refresh();
        },
        // "Viktigt / varning" makes the mail essential too (as the push);
        // the admin may still untick it
        setEssential: (on) => {
            essentialBox.checked = !!on;
            refresh();
        },
        // Editing a published message sends mail again only when asked
        // ("Skicka uppdatering som e-post", off by default)
        setEditing: (editing) => {
            const label = document.getElementById('msgSendMailLabel');
            if (label) label.textContent = t(editing ? 'msg_update_send_mail' : 'mail_msg_send_too');
            sendBox.checked = false;
            refresh();
        }
    };
}
