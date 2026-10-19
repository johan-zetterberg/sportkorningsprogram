// Pure helpers for the personal data UI (account deletion in the portal, the
// "Personuppgifter" admin settings)

export const RETENTION_MONTHS_MIN = 1;
export const RETENTION_MONTHS_MAX = 120;
export const RETENTION_MONTHS_DEFAULT = 12;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/** Whether the typed address confirms the deletion of the signed-in account */
export function isDeletionConfirmed(typedEmail, accountEmail) {
    const typed = normalizeEmail(typedEmail);
    return !!typed && typed === normalizeEmail(accountEmail);
}

/** The typed retention as whole months 1-120, or null when invalid */
export function parseRetentionMonths(value) {
    const text = String(value ?? '').trim();
    if (!/^\d{1,3}$/.test(text)) return null;
    const months = Number(text);
    return months >= RETENTION_MONTHS_MIN && months <= RETENTION_MONTHS_MAX ? months : null;
}

export function personExportFileName(email, date = new Date()) {
    const safe = String(email || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 60);
    return `registerutdrag_${safe}_${date.toISOString().slice(0, 10)}.json`;
}
