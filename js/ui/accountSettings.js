// "Mitt konto" in the portal: the privacy notice and self-service account
// deletion (callable deleteMyAccount; the user confirms with their email
// address and password).
import { EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { auth, functions } from '../config/firebase-config.js';
import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/sharedUtils.js';
import { isDeletionConfirmed } from '../utils/personalDataUtils.js';

export function renderAccountSettingsSection(email) {
    return `
        <section id="accountSettings" class="mt-4 md:mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-4 md:p-6">
            <h2 class="text-lg md:text-xl font-semibold mb-2 dark:text-gray-100">👤 ${t('account_title')}</h2>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">${escapeHtml(email || '')} · <a href="#privacy" class="text-blue-600 dark:text-blue-400 hover:underline">${t('account_privacy_link')}</a></p>
            <details id="accountDeleteDetails" class="text-sm">
                <summary class="cursor-pointer text-red-700 dark:text-red-400 font-semibold">${t('account_delete_btn')}</summary>
                <form id="accountDeleteForm" class="mt-3 space-y-3 max-w-md">
                    <p class="text-gray-600 dark:text-gray-400">${t('account_delete_info')}</p>
                    <label class="block">
                        <span class="text-xs font-bold text-gray-600 dark:text-gray-300">${t('account_delete_confirm_email')}</span>
                        <input type="email" id="accountDeleteEmail" autocomplete="off" required class="w-full p-2 mt-1 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                    </label>
                    <label class="block">
                        <span class="text-xs font-bold text-gray-600 dark:text-gray-300">${t('password')}</span>
                        <input type="password" id="accountDeletePassword" autocomplete="current-password" required class="w-full p-2 mt-1 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                    </label>
                    <p id="accountDeleteError" class="text-sm text-red-600 dark:text-red-400" role="alert"></p>
                    <button type="submit" id="accountDeleteSubmit" class="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50">${t('account_delete_submit')}</button>
                </form>
            </details>
        </section>`;
}

export function wireAccountSettings(root, { onDeleted } = {}) {
    const form = root?.querySelector('#accountDeleteForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorEl = form.querySelector('#accountDeleteError');
        const submit = form.querySelector('#accountDeleteSubmit');
        const typedEmail = form.querySelector('#accountDeleteEmail')?.value;
        const password = form.querySelector('#accountDeletePassword')?.value || '';
        const user = auth.currentUser;
        errorEl.textContent = '';
        if (!user?.email || !isDeletionConfirmed(typedEmail, user.email)) {
            errorEl.textContent = t('account_delete_mismatch');
            return;
        }
        submit.disabled = true;
        try {
            // A fresh login: the server refuses a deletion with an old one
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
            await httpsCallable(functions, 'deleteMyAccount')({ confirmEmail: typedEmail });
            window.showAlert?.(t('account_deleted'), true);
            await onDeleted?.();
        } catch (error) {
            const wrongPassword = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(error?.code);
            errorEl.textContent = `${t('account_delete_failed')} ${wrongPassword ? t('account_delete_wrong_password') : (error?.message || '')}`;
            submit.disabled = false;
        }
    });
}
