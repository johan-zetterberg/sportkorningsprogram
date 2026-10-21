// The small pages of the links in mails (unsubscribeEmail, verifyReplyTo).
// A GET only shows a button: link scanners in mail systems open links, and
// must not unsubscribe or confirm anything; the button POSTs the form.
import { escapeHtml } from './mailCore.js';

export const MAIL_PAGE_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex'
};

/** A page with a heading, a text and optionally a form with one button */
export function renderMailPage({ title, message, form = null }) {
    const formHtml = form
        ? `<form method="post" action="${escapeHtml(form.action)}"><input type="hidden" name="t" value="${escapeHtml(form.token)}"><button type="submit">${escapeHtml(form.button)}</button></form>`
        : '';
    return `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#111;line-height:1.5}button{font-size:1rem;padding:.6rem 1.2rem;border-radius:.4rem;border:0;background:#1d4ed8;color:#fff;cursor:pointer}</style>
</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${formHtml}</body></html>`;
}
