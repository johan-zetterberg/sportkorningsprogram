// Error reports from the browser (js/utils/errorReporter.js): no personal data
// is sent. E-mail addresses are removed, query strings dropped and the texts
// shortened; the page is the route only.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function scrubText(value, max) {
    return String(value ?? '')
        .replace(EMAIL_RE, '[e-post]')
        // URLs: no query strings or fragments (tokens, search text)
        .replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, '$1')
        .slice(0, max);
}

/** The route of a location hash, without parameters: '#admin?tab=x' -> 'admin' */
export function routeOf(hash = '') {
    return String(hash || '').replace(/^#/, '').split('?')[0].slice(0, 60) || 'hub';
}

// Noise that says nothing about the app: browser extensions, benign resize
// notices, scripts from other sites without details
export function isIgnorableError({ message = '', filename = '' } = {}, ownOrigin = '') {
    const msg = String(message || '');
    if (/ResizeObserver loop/i.test(msg)) return true;
    if (/^Script error\.?$/i.test(msg)) return true;
    const file = String(filename || '');
    if (/^(chrome|moz|safari)-extension:/i.test(file)) return true;
    if (file && ownOrigin && /^https?:/i.test(file) && !file.startsWith(ownOrigin)) return true;
    return false;
}

/** The report sent for an error event or a rejected promise's reason */
export function buildErrorReport({ error, message, filename, kind = 'error', hash = '', competitionId = '', appVersion = '', engineVersion = '' } = {}) {
    const msg = message || error?.message || (typeof error === 'string' ? error : '') || 'Okänt fel';
    const stack = error?.stack || (filename ? `at ${filename}` : '');
    return {
        kind: kind === 'rejection' ? 'rejection' : 'error',
        name: scrubText(error?.name || '', 60),
        message: scrubText(msg, 500),
        stack: scrubText(stack, 4000),
        page: routeOf(hash),
        competitionId: scrubText(competitionId, 64),
        appVersion: scrubText(appVersion, 20),
        engineVersion: scrubText(engineVersion, 20)
    };
}

/** Key for sending the same error only once per page load */
export function reportKey(report) {
    return `${report.kind}|${report.message}|${String(report.stack).split('\n').slice(0, 2).join('|')}`;
}
