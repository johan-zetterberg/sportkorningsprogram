// Pure parts of the feedback helpers in components.js: which kind of message
// a showAlert() call is, whether it is shown as a toast or a modal, how long
// a toast stays, and the queue of toasts on screen.

/**
 * showAlert's second argument as a type. Callers pass true/false or a type
 * string; 'error' and 'warning' are not successes even though a non-empty
 * string is truthy. 'offline' is a save waiting in the device's queue.
 */
export function normalizeAlertType(value) {
    if (value === false || value === 'error') return 'error';
    if (value === 'warning') return 'warning';
    if (value === 'info') return 'info';
    if (value === 'offline' || value === 'queued') return 'queued';
    return 'success';
}

// Successes, information and queued saves need no answer: a toast. Errors,
// warnings (often long, with numbers to read) and questions stay modal
const TOAST_TYPES = new Set(['success', 'info', 'queued']);

/** showAlert's third argument: a timeout in ms (older callers) or options */
export function normalizeAlertOptions(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return { timeout: value };
    return value && typeof value === 'object' ? { ...value } : {};
}

export function shouldUseToast(type, options = {}) {
    if (options.modal === true) return false;
    if (options.toast === true) return true;
    return TOAST_TYPES.has(type);
}

/** How long a toast stays: longer text stays longer, 4-10 s by default */
export function toastTimeout(message, type, timeout) {
    if (Number.isFinite(timeout) && timeout > 0) return timeout;
    const length = String(message || '').length;
    const base = type === 'queued' || type === 'warning' ? 6000 : 4000;
    return Math.min(10000, base + Math.max(0, length - 60) * 40);
}

/**
 * The toasts on screen, newest last. A new toast with the same type and text
 * replaces the old one (a judge saving twice gets one toast); above max the
 * oldest goes.
 */
export function createToastQueue({ max = 3 } = {}) {
    let items = [];
    let seq = 0;

    return {
        push({ type, message, title = '', persistent = false } = {}) {
            const removed = [];
            const duplicate = items.find(item => item.type === type && item.message === message);
            if (duplicate) {
                items = items.filter(item => item !== duplicate);
                removed.push(duplicate);
            }
            const item = { id: ++seq, type, message, title, persistent };
            items.push(item);
            while (items.length > max) removed.push(items.shift());
            return { item, removed };
        },
        remove(id) {
            const item = items.find(entry => entry.id === id) || null;
            if (item) items = items.filter(entry => entry !== item);
            return item;
        },
        /** Removes the toasts matching predicate (all without one); returns them */
        clear(predicate = () => true) {
            const removed = items.filter(predicate);
            items = items.filter(item => !removed.includes(item));
            return removed;
        },
        list() {
            return items.slice();
        }
    };
}

/** On a route change: page-specific notices go, results of a save stay */
export function isRouteBoundToast(item) {
    return item?.type === 'info' || item?.type === 'warning';
}
