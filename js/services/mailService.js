// E-mail from the app: callables (functions/index.js, region europe-west1) and
// the competition's e-mail settings. The server resolves recipients, applies
// the caps and opt-outs, and keeps mail waiting (not_configured) until a
// provider is set up.
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { collection, getDocs, limit, orderBy, query } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, appId, functions } from '../config/firebase-config.js';
import { getConfig, saveConfig } from './competitionService.js';
import { normalizeEmailSettingsInput } from '../utils/mailUtils.js';

async function call(name, data) {
    const result = await httpsCallable(functions, name)(data || {});
    return result?.data || {};
}

export const queueCompetitionMail = (payload) => call('queueCompetitionMail', payload);
export const previewMailAudience = (payload) => call('previewMailAudience', payload);
export const queueStartTimeChangeMail = (payload) => call('queueStartTimeChangeMail', payload);
export const getCompetitionMailStatus = (competitionId) => call('getCompetitionMailStatus', { competitionId });
export const requestReplyToVerification = (competitionId) => call('requestReplyToVerification', { competitionId });

// Superadmin
export const setEmailProviderSettings = (payload) => call('setEmailProviderSettings', payload);
export const getEmailProviderStatus = () => call('getEmailProviderStatus');
export const sendTestEmail = () => call('sendTestEmail');
export const retryQueuedMail = (payload) => call('retryQueuedMail', payload);

/** config/emailSettings (read fresh: the verified fields are written by the server) */
export function getEmailSettings(competitionId) {
    return getConfig(competitionId, 'emailSettings', true);
}

/** Saves the fields an admin may write (never replyToVerified*) */
export function saveEmailSettings(competitionId, input) {
    return saveConfig(competitionId, 'emailSettings', normalizeEmailSettingsInput(input));
}

/** The latest queued mails of the competition (admins read the private queue) */
export async function getRecentMailQueue(competitionId, max = 20) {
    const ref = collection(db, `artifacts/${appId}/private/data/competitions/${competitionId}/mailQueue`);
    const snap = await getDocs(query(ref, orderBy('createdAtMs', 'desc'), limit(max)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
