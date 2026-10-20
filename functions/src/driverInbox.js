// Messages and documents a driver may see (the same audience logic as
// js/services/documentService.js): public items, items for all drivers, and
// messages addressed to one of the driver's own start numbers. The rules no
// longer let any signed-in account list driver-only items; the portal asks
// the getDriverInbox function, which checks the driver's verified email.

const normalizeList = (value) => Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : [];

function messageAudience(message = {}) {
    if (message.audience && typeof message.audience === 'object') {
        return { public: message.audience.public === true, drivers: message.audience.drivers !== false };
    }
    // Legacy: no target = everyone, a single target = that driver only
    return { public: !message.targetStartNumber, drivers: true };
}

function messageTargets(message = {}) {
    const selected = normalizeList(message.targetStartNumbers);
    if (selected.length) return selected;
    if (message.targetStartNumber != null && String(message.targetStartNumber).trim() !== '') {
        return [String(message.targetStartNumber).trim()];
    }
    return [];
}

// "public" means everyone, drivers included (the admin page says so); a
// message for the officials only (audience.officials) reaches no driver
export function isMessageForDriver(message, startNumbers = []) {
    const audience = messageAudience(message);
    if (message?.audience?.officials === true && !audience.public && message.audience.drivers !== true) return false;
    const targets = messageTargets(message);
    if (targets.length) {
        return audience.drivers && targets.some(t => startNumbers.includes(t));
    }
    return audience.public || audience.drivers;
}

export function isDocumentForDriver(document = {}) {
    if (document.audience && typeof document.audience === 'object') {
        return document.audience.public === true || document.audience.drivers !== false;
    }
    return true; // legacy documents: everyone
}

/** Firestore Timestamps as milliseconds, so the result can be sent to the client */
export function toPlainTimestamps(data = {}) {
    const out = {};
    Object.entries(data).forEach(([key, value]) => {
        out[key] = value && typeof value.toMillis === 'function' ? value.toMillis() : value;
    });
    return out;
}
