// Texts of browser error reports (reportClientError). The client scrubs them
// too (js/utils/errorReportUtils.js), but a report can be sent by anyone, so
// this is the check that counts: no e-mail addresses, no query strings or
// fragments in URLs (tokens, search text), shortened texts.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// scheme://host/path, then ?query and/or #fragment up to whitespace, ')' or
// the end; a stack frame's :line:column after it is kept
const URL_PARAMS_RE = /([a-z][a-z0-9+.-]*:\/\/[^\s?#)]+)[?#][^\s)]*?(:\d+:\d+)?(?=[\s)]|$)/gi;

/** 'https://x/a.js?v=1#y:10:5' -> 'https://x/a.js:10:5' in any text */
export function stripUrlParams(value) {
    return String(value ?? '').replace(URL_PARAMS_RE, (_, url, position = '') => url + position);
}

export function scrubClientText(value, max) {
    return stripUrlParams(value).replace(EMAIL_RE, '[e-post]').slice(0, max);
}

/** The page is a route only: '#admin?tab=x' or 'admin#y' -> 'admin' */
export function scrubClientPage(value, max = 60) {
    return scrubClientText(String(value ?? '').replace(/^#/, '').split(/[?#]/)[0], max);
}
