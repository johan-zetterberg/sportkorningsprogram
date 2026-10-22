// One dialog for "how should the people concerned be told": channel check
// boxes (in-app message, push notice, e-mail ...) with the recipients per
// channel, an optional editable text and a single confirm. Used after changed
// start times (admin Starttider) and for a precision drive-off call-up.
import { escapeHtml } from '../utils/sharedUtils.js';
import { t } from '../utils/i18n.js';
import { activateDialog } from './dialogA11y.js';

/**
 * options:
 *   title, lead          texts
 *   preview              read-only text shown under the lead (optional)
 *   editable             { label, value, rows? }: an editable text (optional)
 *   channels             [{ id, label, checked, disabled?, hint?, count?: () => Promise<string> }]
 *                        count: the recipients line, loaded after opening
 *   confirmLabel, cancelLabel
 *   allowNone            true: confirm also with no channel ticked (the
 *                        caller sends something anyway)
 * Resolves null on cancel, else { channels: [ids checked], text }.
 */
export function showNotifyChannelsDialog(options = {}) {
    return new Promise((resolve) => {
        if (typeof document === 'undefined' || !document.body) { resolve(null); return; }
        document.getElementById('notifyChannelsModal')?.remove();
        const channels = Array.isArray(options.channels) ? options.channels : [];
        const overlay = document.createElement('div');
        overlay.id = 'notifyChannelsModal';
        overlay.className = 'app-confirm-modal fixed inset-0 bg-gray-800/60 flex items-end sm:items-center justify-center p-4';
        const editable = options.editable && typeof options.editable === 'object' ? options.editable : null;
        overlay.innerHTML = `
            <div class="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-800 shadow-xl p-5 text-left" data-notify-panel>
                <h2 id="notifyChannelsTitle" class="text-lg font-semibold text-gray-900 dark:text-white">${escapeHtml(options.title || t('confirm_title'))}</h2>
                ${options.lead ? `<p id="notifyChannelsLead" class="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">${escapeHtml(options.lead)}</p>` : ''}
                ${options.preview ? `<pre class="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-2 text-xs text-gray-700 dark:text-gray-200 font-sans">${escapeHtml(options.preview)}</pre>` : ''}
                ${editable ? `
                <label for="notifyChannelsText" class="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200">${escapeHtml(editable.label || '')}</label>
                <textarea id="notifyChannelsText" rows="${Number(editable.rows) || 5}" maxlength="10000" class="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white p-2 text-sm">${escapeHtml(editable.value || '')}</textarea>` : ''}
                <fieldset class="mt-3 space-y-1">
                    <legend class="text-sm font-medium text-gray-700 dark:text-gray-200">${escapeHtml(t('notify_channels_legend'))}</legend>
                    ${channels.map((c) => `
                    <label class="flex items-start gap-3 min-h-[44px] py-1 text-sm text-gray-800 dark:text-gray-100">
                        <input type="checkbox" class="h-5 w-5 mt-0.5" data-notify-channel="${escapeHtml(c.id)}" ${c.checked ? 'checked' : ''} ${c.disabled ? 'disabled' : ''}>
                        <span class="min-w-0">
                            <span class="font-medium">${escapeHtml(c.label)}</span>
                            <span class="block text-xs text-gray-600 dark:text-gray-300" data-notify-count="${escapeHtml(c.id)}" aria-live="polite">${c.count ? escapeHtml(t('mail_preview_loading')) : ''}</span>
                            ${c.hint ? `<span class="block text-xs text-gray-500 dark:text-gray-400">${escapeHtml(c.hint)}</span>` : ''}
                        </span>
                    </label>`).join('')}
                </fieldset>
                <div class="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button type="button" id="notifyChannelsCancel" class="min-h-[44px] px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 font-medium">${escapeHtml(options.cancelLabel || t('btn_cancel'))}</button>
                    <button type="button" id="notifyChannelsOk" class="min-h-[44px] px-4 py-2 rounded-md text-white font-semibold focus:outline-none focus:ring-2 bg-blue-600 hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50">${escapeHtml(options.confirmLabel || t('btn_ok'))}</button>
                </div>
            </div>
        `;
        const panel = overlay.querySelector('[data-notify-panel]');
        if (options.lead) panel.setAttribute('aria-describedby', 'notifyChannelsLead');
        const okBtn = overlay.querySelector('#notifyChannelsOk');
        const boxes = () => Array.from(overlay.querySelectorAll('[data-notify-channel]'));
        const checkedIds = () => boxes().filter((b) => b.checked && !b.disabled).map((b) => b.dataset.notifyChannel);
        // Without allowNone, confirming needs at least one channel
        const sync = () => { okBtn.disabled = !options.allowNone && checkedIds().length === 0; };
        let release = null;
        let done = false;
        const finish = (answer) => {
            if (done) return;
            done = true;
            release?.();
            overlay.remove();
            resolve(answer);
        };
        boxes().forEach((b) => b.addEventListener('change', sync));
        overlay.querySelector('#notifyChannelsCancel').addEventListener('click', () => finish(null));
        okBtn.addEventListener('click', () => finish({
            channels: checkedIds(),
            text: editable ? String(overlay.querySelector('#notifyChannelsText')?.value || '') : ''
        }));
        overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
        try { document.dispatchEvent(new CustomEvent('app-overlay-open')); } catch (_) { /* old browsers */ }
        document.body.appendChild(overlay);
        sync();
        release = activateDialog(panel, {
            role: 'dialog',
            labelledBy: 'notifyChannelsTitle',
            initialFocus: '#notifyChannelsOk',
            onEscape: () => finish(null)
        });
        // The recipients per channel, as they come
        channels.forEach((c) => {
            if (typeof c.count !== 'function') return;
            const el = overlay.querySelector(`[data-notify-count="${CSS.escape(c.id)}"]`);
            Promise.resolve().then(() => c.count()).then((line) => {
                if (el && !done) el.textContent = line || '';
            }).catch(() => {
                if (el && !done) el.textContent = t('mail_preview_failed');
            });
        });
    });
}
