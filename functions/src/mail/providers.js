// E-mail providers behind one small interface:
//   provider.name
//   provider.send(message) -> { ok, messageId?, error?, retryable? }
// message: { from: { email, name }, replyTo: email|null, to: { email, name },
//   subject, text, html, headers?: {}, tags?: [] }
// Brevo (EU) through its REST API; SES or Mailgun can be added as another
// factory. The fake provider records messages (tests, the emulator).

export const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 15000;

/** The Brevo request body for one message (one recipient: no BCC) */
export function buildBrevoPayload(message) {
    const payload = {
        sender: { email: message.from.email, name: message.from.name },
        to: [message.to.name ? { email: message.to.email, name: message.to.name } : { email: message.to.email }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text
    };
    if (message.replyTo) payload.replyTo = { email: message.replyTo };
    if (message.headers && Object.keys(message.headers).length) payload.headers = { ...message.headers };
    if (Array.isArray(message.tags) && message.tags.length) payload.tags = message.tags.slice(0, 5);
    return payload;
}

/** Whether a failed HTTP status is worth another attempt (rate limit, server error) */
export function isRetryableStatus(status) {
    return status === 429 || status >= 500;
}

export function createBrevoProvider({ apiKey, fetchImpl = globalThis.fetch, endpoint = BREVO_ENDPOINT } = {}) {
    if (!apiKey) throw new Error('Brevo API key missing');
    return {
        name: 'brevo',
        async send(message) {
            let response;
            try {
                response = await fetchImpl(endpoint, {
                    method: 'POST',
                    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
                    body: JSON.stringify(buildBrevoPayload(message)),
                    signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
                });
            } catch (error) {
                return { ok: false, retryable: true, error: `Nätverksfel: ${String(error?.message || error).slice(0, 200)}` };
            }
            let body = null;
            try {
                body = await response.json();
            } catch {
                body = null;
            }
            if (response.ok) {
                return { ok: true, messageId: String(body?.messageId || body?.messageIds?.[0] || '') || null };
            }
            const detail = [body?.code, body?.message].filter(Boolean).join(': ');
            return {
                ok: false,
                retryable: isRetryableStatus(response.status),
                error: `Brevo ${response.status}${detail ? ` ${detail}` : ''}`.slice(0, 300)
            };
        }
    };
}

/** Records every message in `sink` (an array, or a function called per message) */
export function createFakeProvider({ sink = [], fail = null } = {}) {
    let counter = 0;
    return {
        name: 'fake',
        async send(message) {
            const outcome = typeof fail === 'function' ? fail(message) : null;
            if (outcome) return { ok: false, retryable: outcome === 'retry', error: `Fake ${outcome}` };
            counter += 1;
            const messageId = `fake-${Date.now()}-${counter}`;
            if (typeof sink === 'function') await sink({ ...message, messageId });
            else sink.push({ ...message, messageId });
            return { ok: true, messageId };
        }
    };
}

/**
 * The provider for the settings (serverSettings/email), or null when e-mail
 * is not configured or switched off. `fake` options go to the fake provider.
 */
export function createMailProvider(settings, { fetchImpl, fake = {} } = {}) {
    if (!settings || settings.enabled !== true) return null;
    if (settings.provider === 'brevo' && settings.apiKey) return createBrevoProvider({ apiKey: settings.apiKey, fetchImpl });
    if (settings.provider === 'fake') return createFakeProvider(fake);
    return null;
}

/** Sends messages with a few in flight at once; results in the same order */
export async function sendAll(provider, messages, concurrency = 4) {
    const results = new Array(messages.length);
    let next = 0;
    const worker = async () => {
        while (next < messages.length) {
            const index = next++;
            try {
                results[index] = await provider.send(messages[index]);
            } catch (error) {
                results[index] = { ok: false, retryable: true, error: String(error?.message || error).slice(0, 300) };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, messages.length) }, worker));
    return results;
}
