// "PAUSA TÄVLINGEN": asks why (Olycka / Veterinär / Banproblem / Väder /
// Annat, with an optional text) before the pause is recorded. Resolves
// { reason, note } or null when cancelled.

import { activateDialog } from './dialogA11y.js';
import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { PAUSE_NOTE_MAX, PAUSE_REASONS } from '../utils/globalPauseUtils.js';

export function askPauseReason() {
    return new Promise((resolve) => {
        if (typeof document === 'undefined' || !document.body) { resolve(null); return; }
        document.getElementById('pauseReasonModal')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'pauseReasonModal';
        overlay.className = 'app-confirm-modal fixed inset-0 bg-gray-800/60 flex items-end sm:items-center justify-center p-4';
        overlay.innerHTML = `
            <form class="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl p-5 text-left" data-pause-panel>
                <h2 id="pauseReasonTitle" class="text-lg font-black text-red-700 dark:text-red-300 uppercase">${escapeHtml(t('observer_stop_all'))}</h2>
                <p id="pauseReasonDesc" class="mt-1 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(t('observer_pause_all_desc'))}</p>
                <fieldset class="mt-4">
                    <legend class="text-sm font-semibold text-gray-800 dark:text-gray-100">${escapeHtml(t('pause_reason_label'))}</legend>
                    <div class="mt-2 grid grid-cols-2 gap-2">
                        ${PAUSE_REASONS.map((reason, i) => `
                        <label class="flex items-center gap-2 min-h-[44px] px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 cursor-pointer has-[:checked]:border-red-500 has-[:checked]:bg-red-50 dark:has-[:checked]:bg-red-900/30">
                            <input type="radio" name="pauseReason" value="${escapeHtml(reason)}" class="h-4 w-4"${i === 0 ? ' checked' : ''}>
                            <span>${escapeHtml(t(`pause_reason_${reason}`))}</span>
                        </label>`).join('')}
                    </div>
                </fieldset>
                <label for="pauseReasonNote" class="mt-4 block text-sm font-semibold text-gray-800 dark:text-gray-100">${escapeHtml(t('pause_note_label'))}</label>
                <input id="pauseReasonNote" type="text" maxlength="${PAUSE_NOTE_MAX}" class="mt-1 block w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" autocomplete="off">
                <div class="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button type="button" id="pauseReasonCancel" class="min-h-[44px] px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 font-medium">${escapeHtml(t('btn_cancel'))}</button>
                    <button type="submit" id="pauseReasonOk" class="min-h-[44px] px-4 py-2 rounded-md text-white font-black bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500">${escapeHtml(t('observer_stop_all'))}</button>
                </div>
            </form>
        `;
        const panel = overlay.querySelector('[data-pause-panel]');
        panel.setAttribute('aria-describedby', 'pauseReasonDesc');
        let release = null;
        const finish = (answer) => {
            release?.();
            overlay.remove();
            resolve(answer);
        };
        overlay.querySelector('#pauseReasonCancel').addEventListener('click', () => finish(null));
        panel.addEventListener('submit', (event) => {
            event.preventDefault();
            const reason = panel.querySelector('input[name="pauseReason"]:checked')?.value || 'other';
            const note = String(panel.querySelector('#pauseReasonNote')?.value || '').trim().slice(0, PAUSE_NOTE_MAX);
            finish({ reason, note });
        });
        overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
        try { document.dispatchEvent(new CustomEvent('app-overlay-open')); } catch (_) { /* old browsers */ }
        document.body.appendChild(overlay);
        release = activateDialog(panel, {
            role: 'alertdialog',
            labelledBy: 'pauseReasonTitle',
            initialFocus: '#pauseReasonOk',
            onEscape: () => finish(null)
        });
    });
}
