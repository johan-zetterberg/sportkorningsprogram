// The declaration lock time (config/competitionMeta.lockdownMinutes): how many
// minutes before an equipage's first published start the driver portal stops
// self-service changes. An empty field means "not set" - the default - never
// 0 (Number('') is 0, which silently turned the lock off). The server mirrors
// effectiveLockdownMinutes in functions/src/declarationLock.js.

export const DEFAULT_LOCKDOWN_MINUTES = 60;
// A week: anything more is a typing error
export const MAX_LOCKDOWN_MINUTES = 10080;

/** The settings field's value: { value, error } (error: 'not_a_number' | 'out_of_range') */
export function parseLockdownMinutesInput(raw) {
    const text = String(raw ?? '').trim().replace(',', '.');
    if (text === '') return { value: DEFAULT_LOCKDOWN_MINUTES, error: null };
    const number = Number(text);
    if (!Number.isFinite(number) || !Number.isInteger(number)) return { value: DEFAULT_LOCKDOWN_MINUTES, error: 'not_a_number' };
    if (number < 0 || number > MAX_LOCKDOWN_MINUTES) return { value: DEFAULT_LOCKDOWN_MINUTES, error: 'out_of_range' };
    return { value: number, error: null };
}

/** The stored value as minutes: missing, empty or broken → the default */
export function effectiveLockdownMinutes(stored) {
    if (stored === null || stored === undefined) return DEFAULT_LOCKDOWN_MINUTES;
    if (typeof stored === 'string' && stored.trim() === '') return DEFAULT_LOCKDOWN_MINUTES;
    const number = Number(stored);
    return Number.isFinite(number) && number >= 0 ? number : DEFAULT_LOCKDOWN_MINUTES;
}
