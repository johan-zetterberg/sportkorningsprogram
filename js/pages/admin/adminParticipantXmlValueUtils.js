export function normalizeXmlNumber(value, { integer = false } = {}) {
    if (value === null || value === undefined || value === '') return null;

    const normalized = String(value)
        .trim()
        .replace(/\s+/g, '')
        .replace(',', '.');
    if (!normalized) return null;

    const number = Number(normalized);
    if (!Number.isFinite(number)) return null;

    return integer ? Math.trunc(number) : number;
}

export function normalizeTdbClassNumber(value) {
    const number = normalizeXmlNumber(value, { integer: true });
    return number != null && number > 0 ? number : null;
}

export function isAdministrativeFeeClass(value) {
    const number = normalizeTdbClassNumber(value);
    return number != null && number > 900;
}

export function resolveImportedEntryStatus(status) {
    const normalized = String(status || '').trim().toUpperCase();
    return ['REMOVED', 'WITHDRAWN', 'STRUKEN'].includes(normalized) ? 'struken' : 'anmÃ¤ld';
}

export function resolveImportedPaymentStatus(entryStatus, paidAmount) {
    const normalizedStatus = String(entryStatus || '').trim().toUpperCase();
    const amount = normalizeXmlNumber(paidAmount);
    return normalizedStatus === 'PAID' || (amount != null && amount > 0) ? 'paid' : '';
}

export function calculateImportedHorseAge(bornYear, currentYear = new Date().getFullYear()) {
    const year = normalizeXmlNumber(bornYear, { integer: true });
    if (!year || year < 1900 || year > currentYear) return '';
    return currentYear - year;
}
