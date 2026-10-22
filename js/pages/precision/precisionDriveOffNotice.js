// "Meddela omkörning": when a precision drive-off is still to be driven, the
// admin or the TD tells the qualifiers (an in-app message to the chosen
// drivers, optionally as a push notice and by e-mail) and the speaker, from
// one dialog (js/ui/notifyChannelsDialog.js). The button sits next to the
// provisional banner on the precision results (precision-resultat.js).
import { getGlobalState } from '../../main.js';
import { saveCompetitionMessage } from '../../services/documentService.js';
import { previewMailAudience, queueCompetitionMail } from '../../services/mailService.js';
import { previewPushAudience } from '../../services/pushService.js';
import { showAlert } from '../../ui/components.js';
import { showNotifyChannelsDialog } from '../../ui/notifyChannelsDialog.js';
import { t } from '../../utils/i18n.js';
import { buildMessageAudience } from '../../utils/messageAudience.js';
import { mailCountLine, pushCountLine } from '../../utils/notifyChannelsUtils.js';
import { mergeUserRoles } from '../../utils/roleAccess.js';
import { escapeHtml } from '../../utils/sharedUtils.js';
import { buildDriveOffMessages, canCallDriveOff, driveOffCallUpGroups } from './precisionDriveOffNoticeUtils.js';

const MAIL_REASON = 'Omkörning i precision';

/**
 * Adds a "Meddela omkörning" button per class waiting for a drive-off to
 * `host` (after its banners), for those who may call one.
 * rows: [{ label, ctx }]; equipages: the competing equipages (names).
 */
export function mountDriveOffCallUp(host, { competitionId, rows = [], equipages = [] } = {}) {
    if (!host || !competitionId) return;
    if (!canCallDriveOff(mergeUserRoles(getGlobalState('currentUser')))) return;
    const groups = driveOffCallUpGroups(rows);
    if (!groups.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'precision-driveoff-callup mb-3 flex flex-wrap gap-2';
    wrap.innerHTML = groups.map((g, i) => `
        <button type="button" data-driveoff-callup="${i}" class="min-h-[44px] rounded-md border border-blue-400 bg-white px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 dark:border-blue-600 dark:bg-gray-800 dark:text-blue-200 dark:hover:bg-blue-900/30">
            ${escapeHtml(t('driveoff_callup_btn'))}${groups.length > 1 || g.label ? `: ${escapeHtml(g.label)}` : ''}
        </button>`).join('');
    wrap.querySelectorAll('[data-driveoff-callup]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const group = groups[Number(btn.dataset.driveoffCallup)];
            if (group) openDriveOffCallUp(competitionId, group, equipages);
        });
    });
    host.appendChild(wrap);
}

/** The dialog and the sends for one class */
export async function openDriveOffCallUp(competitionId, { label, startNumbers }, equipages = []) {
    const texts = buildDriveOffMessages({ label, startNumbers, equipages });
    const audience = buildMessageAudience('selected_drivers', { selectedDrivers: startNumbers });
    const choice = await showNotifyChannelsDialog({
        title: t('driveoff_callup_title'),
        lead: t('driveoff_callup_lead').replace('{n}', String(startNumbers.length)),
        editable: { label: t('driveoff_callup_text'), value: texts.body, rows: 4 },
        allowNone: true,
        channels: [
            {
                id: 'push', label: t('notify_channel_push'), checked: true,
                count: async () => pushCountLine(await previewPushAudience({ competitionId, topic: 'messages', category: 'essential', message: audience }), t)
            },
            {
                id: 'mail', label: t('notify_channel_mail'), checked: false,
                count: async () => mailCountLine(await previewMailAudience({
                    competitionId, category: 'essential', audience: { drivers: { startNumbers } }
                }), t)
            },
            { id: 'speaker', label: t('driveoff_callup_speaker'), checked: true, hint: texts.speakerBody }
        ],
        confirmLabel: t('notify_send_btn')
    });
    if (!choice) return;
    const chosen = new Set(choice.channels);
    const body = String(choice.text || '').trim() || texts.body;
    // An edited Swedish text: the English one no longer matches it
    const english = body === texts.body ? { titleEn: texts.titleEn, bodyEn: texts.bodyEn } : { titleEn: texts.titleEn, bodyEn: '' };
    let saveState = 'saved';
    try {
        saveState = await saveCompetitionMessage(competitionId, {
            title: texts.title,
            body,
            ...english,
            type: 'alert',
            category: 'essential',
            push: chosen.has('push'),
            source: 'driveOff',
            ...audience
        });
        // Offline: saved on the device; the message and its push go with the signal
        if (saveState === 'queued') showAlert(t('msg_saved_queued'), 'offline');
        else showAlert(t('driveoff_callup_sent').replace('{n}', String(startNumbers.length)), 'success');
    } catch (err) {
        console.error('Kunde inte skicka meddelandet om omkörning', err);
        showAlert(t('driveoff_callup_failed'), 'error');
        return;
    }
    if (chosen.has('speaker')) {
        saveCompetitionMessage(competitionId, {
            title: texts.speakerTitle,
            body: texts.speakerBody,
            type: 'info',
            category: 'info',
            push: chosen.has('push'),
            source: 'driveOff',
            ...buildMessageAudience('official:speaker')
        }).catch((err) => console.warn('Speakerns notis om omkörningen kunde inte sparas', err));
    }
    // The e-mail needs the server: offline, sent again by hand later
    if (chosen.has('mail') && saveState === 'queued') {
        showAlert(t('notify_needs_connection_resend'), 'offline');
    } else if (chosen.has('mail')) {
        try {
            await queueCompetitionMail({
                competitionId,
                kind: 'message',
                category: 'essential',
                reason: MAIL_REASON,
                audience: { drivers: { startNumbers } },
                subject: texts.title,
                text: english.bodyEn ? `${body}\n\n---\n\n${english.bodyEn}` : body
            });
            showAlert(t('mail_msg_queued'), 'success');
        } catch (err) {
            console.error('Kunde inte köa e-post om omkörningen', err);
            showAlert(`${t('mail_msg_failed')} ${err?.message || ''}`.trim(), 'error');
        }
    }
}
