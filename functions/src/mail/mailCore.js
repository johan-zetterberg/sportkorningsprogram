// E-mail: the pure parts (no Firebase imports, so node:test runs them without
// emulators). Audience descriptors and recipient resolution, opt-outs, daily
// caps, signed link tokens, HTML sanitizing and the message text. The queue
// processing with Firestore is in mailService.js, the providers in providers.js.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const MAIL_KINDS = ['message', 'startTimeChange', 'vetDecision', 'volunteerConfirmation', 'replyToVerification', 'test'];
// Sent whatever the recipient's opt-out (start times, vet decisions, the
// sign-up and address checks a person asked for). 'message' is essential only
// with category 'essential'.
export const ESSENTIAL_KINDS = ['startTimeChange', 'vetDecision', 'volunteerConfirmation', 'replyToVerification', 'test'];
// Mails the system sends on a person's request (anyone can trigger a
// volunteer confirmation): their own small daily caps, never the reserve
export const SYSTEM_KINDS = ['volunteerConfirmation', 'replyToVerification', 'test'];
export const MAIL_CATEGORIES = ['info', 'essential'];
export const MAIL_STATUSES = ['queued', 'sending', 'sent', 'partial', 'failed', 'not_configured', 'blocked'];
export const MAIL_PROVIDERS = ['brevo'];
export const APP_SENDER_SUFFIX = 'via DriveLive';

export const MAIL_LIMITS = {
    subjectMax: 200,
    textMax: 20000,
    htmlMax: 100000,
    signatureMax: 1000,
    senderNameMax: 60,
    personalTextMax: 1000,
    maxRecipients: 1000,
    maxStartNumbers: 1000,
    maxClasses: 50,
    maxRoles: 20,
    // Defaults for serverSettings/email (Brevo's free plan: 300 a day)
    globalDailyDefault: 300,
    competitionDailyDefault: 500,
    dailyLimitMax: 100000,
    // One competition uses at most this share of the global daily cap
    competitionShareOfGlobal: 0.5,
    // This share of the global cap is kept for essential competition mail
    // (start times, vet decisions, essential messages): other mail stops before
    essentialReserveShare: 0.2,
    // System mails (volunteer confirmations, reply-to checks, test mails): a
    // small cap of their own per competition and, as a share, globally
    systemPerCompetitionDay: 20,
    systemShareOfGlobal: 0.1,
    systemGlobalMin: 10,
    // queueCompetitionMail and queueStartTimeChangeMail per user and
    // competition, and per competition and hour / day
    perUserHour: 10,
    perCompetitionHour: 10,
    perCompetitionDay: 40,
    // The reason an essential message is sent (shown in the mail log)
    reasonMax: 200,
    replyToChecksPerDay: 5,
    // Attempts in all (the first and the retries), with the delays between
    maxAttempts: 4,
    retryDelaysMs: [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000],
    // A reply-to check link works this long
    replyToTokenMs: 7 * 24 * 60 * 60 * 1000,
    // An unsubscribe link works this long
    unsubscribeTokenMs: 2 * 365 * 24 * 60 * 60 * 1000
};

export class MailError extends Error {}

const DRIVER_EMAIL_FIELDS = ['email', 'contactEmail', 'driverEmail'];
const JUDGE_ROLES = ['judge', 'domare', 'judges'];

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

export function isValidEmail(value) {
    const email = normalizeEmail(value);
    return email.length <= 200 && /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(email) && !email.includes('..');
}

const cleanLine = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanList = (value) => (Array.isArray(value) ? value : []);

export function isEssentialMail(mail = {}) {
    if (mail.kind === 'message') return mail.category === 'essential';
    return ESSENTIAL_KINDS.includes(mail.kind);
}

// --- Audience ---

/**
 * The audience descriptor a client may send, checked and normalized:
 * { drivers?: { all } | { classes?, startNumbers?, includeWithdrawn? },
 *   officials?: { all } | { roles } }. Throws MailError (Swedish).
 */
export function normalizeAudience(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MailError('Välj mottagare.');
    const audience = {};
    if (raw.drivers) {
        const d = raw.drivers === true ? { all: true } : raw.drivers;
        if (typeof d !== 'object') throw new MailError('Ogiltigt urval av kuskar.');
        const includeWithdrawn = d.includeWithdrawn === true;
        if (d.all === true) {
            audience.drivers = { all: true, includeWithdrawn };
        } else {
            const classes = [...new Set(cleanList(d.classes).map((c) => cleanLine(c, 60)).filter(Boolean))];
            const startNumbers = [...new Set(cleanList(d.startNumbers).map((s) => String(s ?? '').trim()).filter(Boolean))];
            if (classes.length > MAIL_LIMITS.maxClasses) throw new MailError('För många klasser.');
            if (startNumbers.length > MAIL_LIMITS.maxStartNumbers) throw new MailError('För många startnummer.');
            if (startNumbers.some((s) => !/^[\w-]{1,20}$/.test(s))) throw new MailError('Ogiltigt startnummer.');
            if (!classes.length && !startNumbers.length) throw new MailError('Välj kuskar: alla, klasser eller startnummer.');
            audience.drivers = { classes, startNumbers, includeWithdrawn };
        }
    }
    if (raw.officials) {
        const o = raw.officials === true ? { all: true } : raw.officials;
        if (typeof o !== 'object') throw new MailError('Ogiltigt urval av funktionärer.');
        if (o.all === true) {
            audience.officials = { all: true };
        } else {
            const roles = [...new Set(cleanList(o.roles).map((r) => cleanLine(r, 60).toLowerCase()).filter(Boolean))];
            if (roles.length > MAIL_LIMITS.maxRoles) throw new MailError('För många roller.');
            if (!roles.length) throw new MailError('Välj funktionärer: alla eller roller.');
            audience.officials = { roles };
        }
    }
    if (!audience.drivers && !audience.officials) throw new MailError('Välj mottagare.');
    return audience;
}

// Withdrawn (struken) as js/utils/sharedUtils.js isWithdrawnEquipage
export function isWithdrawnEquipage(equipage) {
    if (!equipage || typeof equipage !== 'object') return false;
    if (equipage.struken === true || equipage.withdrawn === true || equipage.scratched === true) return true;
    return /struken|withdrawn|scratched/i.test(String(equipage.status || ''));
}

const mapOf = (value) => (value instanceof Map ? value : new Map(Object.entries(value || {})));

/**
 * The recipients of an audience from the competition's own documents (never
 * any other address). equipages/officials/judges: [{ id, data }] (public
 * docs); the *Private maps: id -> private doc data. Returns
 * { recipients: [{ email, name, startNumbers }], withoutEmail: [{ type, id }],
 *   unknownStartNumbers } with one recipient per address.
 */
export function resolveRecipients({
    audience,
    equipages = [],
    equipagePrivate = new Map(),
    officials = [],
    officialsPrivate = new Map(),
    judges = [],
    judgesPrivate = new Map()
} = {}) {
    const byEmail = new Map();
    const withoutEmail = [];
    const add = (email, name, startNumber = null) => {
        const key = normalizeEmail(email);
        if (!isValidEmail(key)) return false;
        const entry = byEmail.get(key) || { email: key, name: '', startNumbers: [] };
        if (!entry.name && name) entry.name = cleanLine(name, 120);
        if (startNumber !== null && !entry.startNumbers.includes(startNumber)) entry.startNumbers.push(startNumber);
        byEmail.set(key, entry);
        return true;
    };

    let unknownStartNumbers = [];
    const drivers = audience?.drivers;
    if (drivers) {
        const eqPrivate = mapOf(equipagePrivate);
        const classes = new Set((drivers.classes || []).map((c) => c.toLowerCase()));
        const chosen = new Set(drivers.startNumbers || []);
        const seen = new Set();
        equipages.forEach(({ id, data = {} }) => {
            const startNumber = String(id);
            seen.add(startNumber);
            const byNumber = chosen.has(startNumber);
            const byClass = classes.has(String(data.className || '').trim().toLowerCase());
            if (!drivers.all && !byNumber && !byClass) return;
            // Withdrawn equipages only when named or asked for
            if (!byNumber && !drivers.includeWithdrawn && isWithdrawnEquipage(data)) return;
            const priv = eqPrivate.get(startNumber) || {};
            const emails = [...new Set(DRIVER_EMAIL_FIELDS.map((f) => normalizeEmail(priv[f])).filter(Boolean))];
            if (!emails.length && data.email) emails.push(normalizeEmail(data.email));
            const added = emails.map((email) => add(email, data.driverName, startNumber)).some(Boolean);
            if (!added) withoutEmail.push({ type: 'driver', id: startNumber });
        });
        unknownStartNumbers = [...chosen].filter((s) => !seen.has(s));
    }

    const off = audience?.officials;
    if (off) {
        const roles = new Set(off.roles || []);
        const offPrivate = mapOf(officialsPrivate);
        officials.forEach(({ id, data = {} }) => {
            // The system roles are in `roles` (admin officials form); `role` and
            // `roleLabel` may be free text such as "Hinderdomare"
            const own = [data.role, data.roleLabel, ...(Array.isArray(data.roles) ? data.roles : [])]
                .map((r) => String(r || '').trim().toLowerCase())
                .filter(Boolean);
            if (!off.all && !own.some((r) => roles.has(r))) return;
            const priv = offPrivate.get(id) || {};
            if (!add(priv.email || data.email, data.name)) withoutEmail.push({ type: 'official', id });
        });
        if (off.all || JUDGE_ROLES.some((r) => roles.has(r))) {
            const jPrivate = mapOf(judgesPrivate);
            judges.forEach(({ id, data = {} }) => {
                const priv = jPrivate.get(id) || {};
                if (!add(priv.email || data.email, data.name)) withoutEmail.push({ type: 'judge', id });
            });
        }
    }

    const recipients = [...byEmail.values()];
    recipients.forEach((r) => r.startNumbers.sort((a, b) => a.localeCompare(b, 'sv', { numeric: true })));
    return { recipients, withoutEmail, unknownStartNumbers };
}

/** Explicit recipients ([{ email, name }]) from server producers, checked and merged */
export function normalizeExplicitRecipients(list) {
    const byEmail = new Map();
    cleanList(list).forEach((item) => {
        const email = normalizeEmail(typeof item === 'string' ? item : item?.email);
        if (!isValidEmail(email) || byEmail.has(email)) return;
        byEmail.set(email, { email, name: cleanLine(item?.name, 120), startNumbers: cleanList(item?.startNumbers).map(String).slice(0, 50) });
    });
    return [...byEmail.values()];
}

// --- Opt-outs ---

/** The id of an opt-out document: no address is stored */
export function emailHash(email) {
    return createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 40);
}

/**
 * Recipients left after the competition's opt-outs (a Set of emailHash):
 * essential mail goes to everyone.
 */
export function filterOptOuts(recipients = [], optedOut = new Set(), essential = false) {
    if (essential || !optedOut.size) return { recipients: [...recipients], skipped: 0 };
    const kept = recipients.filter((r) => !optedOut.has(emailHash(r.email)));
    return { recipients: kept, skipped: recipients.length - kept.length };
}

// --- Daily caps ---

const STOCKHOLM_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The calendar day in Sweden ("YYYY-MM-DD") a cap counts in */
export function mailDayKey(nowMs = Date.now()) {
    return STOCKHOLM_DATE.format(new Date(nowMs));
}

/**
 * Whether `requested` more messages fit in the day's cap. All or nothing: a
 * message to half of the drivers is worse than none. `current`: { dayKey, count }.
 */
export function reserveDailyQuota(current, dayKey, requested, limit, nowMs = Date.now()) {
    const count = current?.dayKey === dayKey ? (Number(current.count) || 0) : 0;
    const max = Math.max(0, Number(limit) || 0);
    if (count + requested > max) {
        return { allowed: false, remaining: Math.max(0, max - count), next: { dayKey, count, updatedAt: nowMs } };
    }
    return { allowed: true, remaining: max - count - requested, next: { dayKey, count: count + requested, updatedAt: nowMs } };
}

/** A counter after `released` messages were not delivered (never below 0, today's only) */
export function releaseDailyQuota(current, dayKey, released, nowMs = Date.now()) {
    if (current?.dayKey !== dayKey) return null;
    const count = Math.max(0, (Number(current.count) || 0) - Math.max(0, Number(released) || 0));
    return { dayKey, count, updatedAt: nowMs };
}

/** Whether a mail is essential competition mail that may use the global reserve */
export function isPriorityMail(mail = {}) {
    return isEssentialMail(mail) && !SYSTEM_KINDS.includes(mail.kind);
}

/**
 * The daily caps a mail counts against. settings: serverSettings/email.
 * competition: min(competitionDailyLimit, global share); global: the whole
 * cap for essential competition mail, less the reserve for other mail;
 * system kinds also count against their own caps (systemCompetition,
 * systemGlobal; null for other mail).
 */
export function mailQuotaLimits(mail = {}, settings = {}) {
    const globalLimit = Number(settings?.dailyLimit) || MAIL_LIMITS.globalDailyDefault;
    const compSetting = Number(settings?.competitionDailyLimit) || MAIL_LIMITS.competitionDailyDefault;
    const competition = Math.max(1, Math.min(compSetting, Math.floor(globalLimit * MAIL_LIMITS.competitionShareOfGlobal)));
    const priority = isPriorityMail(mail);
    const global = priority ? globalLimit : Math.max(1, Math.floor(globalLimit * (1 - MAIL_LIMITS.essentialReserveShare)));
    const system = SYSTEM_KINDS.includes(mail.kind);
    return {
        competition,
        global,
        systemCompetition: system ? MAIL_LIMITS.systemPerCompetitionDay : null,
        systemGlobal: system ? Math.max(MAIL_LIMITS.systemGlobalMin, Math.floor(globalLimit * MAIL_LIMITS.systemShareOfGlobal)) : null
    };
}

const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:se|nu|com|net|org|info|biz|eu|io|co|me|ly|app|dev|xyz|top|site|online|shop|link|click|live|ru|cn|uk|de|dk|no|fi|is|pl|fr|nl|be|es|it|us|tk|ml|ga|cf|gq|ws|cc|tv|to|in)\b(?:\/\S*)?/gi;

/**
 * Text from a person (names, competition names, start time lines) for
 * system mail and push: web addresses removed, so neither our HTML nor a
 * mail client turns them into links.
 */
export function stripLinks(value) {
    return String(value ?? '')
        .replace(/\b(?:https?|ftp|mailto|javascript|data):\S*/gi, '')
        .replace(/\bwww\.\S*/gi, '')
        // Bare domains with a common top-level domain ("evil.se/x"), as mail
        // clients link them; "t.ex." and times stay
        .replace(BARE_DOMAIN, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

// --- Signed link tokens (unsubscribe, reply-to check) ---

const b64url = (buffer) => Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text) => Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** payload: a small object (p: purpose, x: expiry ms); key: Buffer or string */
export function signMailToken(payload, key) {
    if (!key || !key.length) throw new Error('signing key missing');
    const body = b64url(JSON.stringify(payload));
    const mac = b64url(createHmac('sha256', key).update(body).digest());
    return `${body}.${mac}`;
}

/** The payload of a valid, unexpired token with the purpose, else null */
export function verifyMailToken(token, key, purpose, nowMs = Date.now()) {
    if (typeof token !== 'string' || token.length > 2000 || !key || !key.length) return null;
    const [body, mac, extra] = token.split('.');
    if (!body || !mac || extra !== undefined) return null;
    const expected = createHmac('sha256', key).update(body).digest();
    const given = fromB64url(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let payload;
    try {
        payload = JSON.parse(fromB64url(body).toString('utf8'));
    } catch {
        return null;
    }
    if (!payload || typeof payload !== 'object' || payload.p !== purpose) return null;
    if (Number.isFinite(payload.x) && nowMs > payload.x) return null;
    return payload;
}

// --- HTML ---

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Plain text as HTML: escaped, blank lines as paragraphs. Addresses become
 * links only with { linkify: true } (a message the competition's admins
 * wrote); system mail and other people's text are never linked.
 */
export function textToHtml(text, { linkify = false } = {}) {
    const link = (escaped) => (!linkify ? escaped : escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
        const trimmed = url.replace(/[.,;:!?)\]]+$/, '');
        const rest = url.slice(trimmed.length);
        return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${trimmed}</a>${rest}`;
    }));
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para) => `<p>${link(escapeHtml(para)).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}

const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'hr', 'a']);
const DROPPED_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'head', 'title', 'template', 'noscript', 'svg', 'math', 'textarea', 'select', 'xmp'];

function safeHref(raw) {
    // Without whitespace and control characters ("java\tscript:")
    const url = [...String(raw ?? '')].filter((ch) => ch.charCodeAt(0) > 32 && ch.charCodeAt(0) !== 127).join('');
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return null;
    // Quotes and angle brackets are escaped; entities stay as written
    return url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * HTML from a client, cut down to simple formatting: p, br, b/strong, i/em,
 * u, lists, h2-h4, blockquote, hr and links (http, https, mailto) with no
 * other attributes. Scripts, styles and their content go; every other tag is
 * removed and its text kept.
 */
export function sanitizeMailHtml(html) {
    let source = String(html ?? '').slice(0, MAIL_LIMITS.htmlMax);
    source = source.replace(/<!--[\s\S]*?(-->|$)/g, '');
    for (const tag of DROPPED_WITH_CONTENT) {
        source = source.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(<\\/${tag}\\s*>|$)`, 'gi'), '');
    }
    const out = [];
    // A tag starts with its name ("a < b" is text)
    const tagPattern = /<\/?[a-zA-Z][^>]*>/g;
    let last = 0;
    let match;
    const pushText = (text) => out.push(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    while ((match = tagPattern.exec(source))) {
        pushText(source.slice(last, match.index));
        last = match.index + match[0].length;
        const parsed = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*)>$/.exec(match[0]);
        if (!parsed) continue;
        const closing = !!parsed[1];
        const name = parsed[2].toLowerCase();
        if (!ALLOWED_TAGS.has(name)) continue;
        if (closing) {
            if (name !== 'br' && name !== 'hr') out.push(`</${name}>`);
            continue;
        }
        if (name === 'a') {
            const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(parsed[3]);
            const href = hrefMatch ? safeHref(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]) : null;
            out.push(href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : '<a>');
            continue;
        }
        out.push(`<${name}>`);
    }
    pushText(source.slice(last));
    return out.join('').trim();
}

// --- Content ---

/** The display name: "<Klubbnamn> via DriveLive" */
export function buildSenderName(clubName) {
    const name = cleanLine(clubName, MAIL_LIMITS.senderNameMax).replace(/["<>,;:\\@]/g, '').trim();
    return name ? `${name} ${APP_SENDER_SUFFIX}` : 'DriveLive';
}

/** The club's address as Reply-To once it was checked for the address set now */
export function effectiveReplyTo(emailSettings = {}) {
    const replyTo = normalizeEmail(emailSettings?.replyTo);
    if (!isValidEmail(replyTo)) return null;
    if (emailSettings.replyToVerified !== true) return null;
    if (normalizeEmail(emailSettings.replyToVerifiedAddress) !== replyTo) return null;
    return replyTo;
}

/**
 * Subject, text and optional HTML from a client, checked. Text is required;
 * HTML is sanitized (without HTML the text is converted; addresses linked
 * only with options.linkify). Throws MailError.
 */
export function validateMailContent({ subject, text, html } = {}, { linkify = false } = {}) {
    const cleanSubject = cleanLine(subject, MAIL_LIMITS.subjectMax + 1);
    const cleanText = String(text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!cleanSubject) throw new MailError('Ämnesrad saknas.');
    if (cleanSubject.length > MAIL_LIMITS.subjectMax) throw new MailError(`Ämnesraden får vara högst ${MAIL_LIMITS.subjectMax} tecken.`);
    if (!cleanText) throw new MailError('Meddelandetext saknas.');
    if (cleanText.length > MAIL_LIMITS.textMax) throw new MailError(`Texten får vara högst ${MAIL_LIMITS.textMax} tecken.`);
    if (html !== undefined && html !== null && html !== '' && typeof html !== 'string') throw new MailError('Ogiltig HTML.');
    if (typeof html === 'string' && html.length > MAIL_LIMITS.htmlMax) throw new MailError('HTML-texten är för lång.');
    const cleanHtml = html ? sanitizeMailHtml(html) : '';
    return { subject: cleanSubject, text: cleanText, html: cleanHtml || textToHtml(cleanText, { linkify }) };
}

/** The reason for an essential message (required, one line, ≤ reasonMax) */
export function normalizeEssentialReason(value) {
    const reason = cleanLine(value, MAIL_LIMITS.reasonMax + 1);
    if (!reason) throw new MailError('Ange varför meddelandet är viktigt (skälet visas i e-postloggen).');
    if (reason.length > MAIL_LIMITS.reasonMax) throw new MailError(`Skälet får vara högst ${MAIL_LIMITS.reasonMax} tecken.`);
    return reason;
}

/**
 * Per start number texts for a start time change: { [startNumber]: text }.
 * field: 'text' (Swedish, required) or 'textEn' (English, optional: entries
 * without one are skipped; {} when none has one).
 */
export function normalizePersonalTexts(changes, field = 'text') {
    const list = cleanList(changes);
    if (!list.length) throw new MailError('Inga ändrade starttider.');
    if (list.length > MAIL_LIMITS.maxStartNumbers) throw new MailError('För många startnummer.');
    const texts = {};
    list.forEach((item) => {
        const startNumber = String(item?.startNumber ?? '').trim();
        if (!/^[\w-]{1,20}$/.test(startNumber)) throw new MailError('Ogiltigt startnummer.');
        // Start time lines: no web addresses (never linked in the mail)
        const text = String(item?.[field] ?? '').replace(/\r\n?/g, '\n').split('\n').map(stripLinks).join('\n').trim().slice(0, MAIL_LIMITS.personalTextMax);
        if (!text) {
            if (field !== 'text') return;
            throw new MailError(`Text saknas för startnummer ${startNumber}.`);
        }
        texts[startNumber] = texts[startNumber] ? `${texts[startNumber]}\n${text}` : text;
    });
    return texts;
}

/**
 * The message one recipient gets. mail: the queue document; recipient:
 * { email, name, startNumbers }; options: competitionName, signature,
 * replyTo (effective or null), unsubscribeUrl (non-essential mail only).
 */
export function buildRecipientMessage(mail, recipient, { competitionName = '', signature = '', replyTo = null, unsubscribeUrl = null } = {}) {
    const personalOf = (texts) => (texts
        ? (recipient.startNumbers || []).map((s) => texts[s]).filter(Boolean).join('\n')
        : '');
    const personal = personalOf(mail.personalTexts);
    // An English part after the Swedish one (start time changes: textEn and
    // personalTextsEn), when given
    const personalEn = personalOf(mail.personalTextsEn);
    const englishText = mail.textEn ? String(mail.textEn) : '';
    const english = englishText || personalEn ? ['---', englishText, personalEn].filter(Boolean).join('\n\n') : '';
    const sig = String(signature ?? '').trim().slice(0, MAIL_LIMITS.signatureMax);
    const competition = stripLinks(cleanLine(competitionName, 200));
    const footerLines = [`Skickat med DriveLive${competition ? ` för ${competition}` : ''}.`];
    if (!replyTo) footerLines.push('Det går inte att svara på det här mejlet. Kontakta arrangören vid frågor.');
    if (unsubscribeUrl) footerLines.push(`Vill du inte få fler informationsutskick från den här tävlingen? Avsluta här: ${unsubscribeUrl}`);

    const textParts = [mail.text, personal, english, sig, `—\n${footerLines.join('\n')}`].filter(Boolean);
    const footerHtml = [`Skickat med DriveLive${competition ? ` för ${escapeHtml(competition)}` : ''}.`];
    if (!replyTo) footerHtml.push('Det går inte att svara på det här mejlet. Kontakta arrangören vid frågor.');
    if (unsubscribeUrl) {
        footerHtml.push(`Vill du inte få fler informationsutskick från den här tävlingen? <a href="${escapeHtml(unsubscribeUrl)}">Avsluta utskicken</a>.`);
    }
    const htmlBody = [
        mail.html || textToHtml(mail.text),
        personal ? textToHtml(personal) : '',
        english ? `<hr>${[englishText, personalEn].filter(Boolean).map((part) => textToHtml(part)).join('\n')}` : '',
        sig ? textToHtml(sig) : '',
        `<hr><p style="color:#666;font-size:12px">${footerHtml.join('<br>')}</p>`
    ].filter(Boolean).join('\n');
    return {
        to: { email: recipient.email, name: recipient.name || '' },
        subject: cleanLine(mail.subject, MAIL_LIMITS.subjectMax),
        text: textParts.join('\n\n'),
        html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">\n${htmlBody}\n</body></html>`
    };
}

/**
 * The volunteer's confirmation after a sign-up (submitVolunteerSignup). Anyone
 * can sign up with any address, so the text is fixed: of what the person
 * wrote only the name (plain text, no web addresses), never the role or notes.
 */
export function buildVolunteerConfirmationMail({ name = '', competitionName = '' } = {}) {
    const competition = stripLinks(cleanLine(competitionName, 200)) || 'tävlingen';
    const person = stripLinks(cleanLine(name, 120)).slice(0, 60);
    const lines = [
        `Hej${person ? ` ${person}` : ''}!`,
        `Tack för din anmälan som funktionär till ${competition}. Arrangören går igenom anmälningarna och hör av sig.`,
        'Har du inte anmält dig? Då kan du bortse från det här mejlet; kontakta gärna arrangören.'
    ];
    return { subject: `Tack för din anmälan – ${competition}`.slice(0, MAIL_LIMITS.subjectMax), text: lines.join('\n\n') };
}

/**
 * The check of the club's reply-to address (requestReplyToVerification). The
 * HTML has one link, the check link; nothing else is linked.
 */
export function buildReplyToVerificationMail({ competitionName = '', verifyUrl } = {}) {
    const competition = stripLinks(cleanLine(competitionName, 200)) || 'tävlingen';
    const intro = `Den här adressen har angetts som svarsadress (Reply-To) för e-post från ${competition} i DriveLive.`;
    const outro = 'Länken gäller i 7 dagar. Har ni inte bett om detta kan ni bortse från mejlet.';
    return {
        subject: `Bekräfta svarsadress för ${competition}`.slice(0, MAIL_LIMITS.subjectMax),
        text: [
            intro,
            `Bekräfta att adressen är er genom att öppna länken och trycka på knappen: ${verifyUrl}`,
            outro
        ].join('\n\n'),
        html: [
            `<p>${escapeHtml(intro)}</p>`,
            `<p>Bekräfta att adressen är er genom att öppna länken och trycka på knappen: <a href="${escapeHtml(verifyUrl)}" target="_blank" rel="noopener noreferrer">Bekräfta svarsadressen</a></p>`,
            `<p>${escapeHtml(outro)}</p>`
        ].join('\n')
    };
}

// --- Results and retries ---

/** The delay before attempt number `attempts + 1`, or null when no attempt is left */
export function nextRetryDelayMs(attempts) {
    if (attempts >= MAIL_LIMITS.maxAttempts) return null;
    return MAIL_LIMITS.retryDelaysMs[Math.min(attempts - 1, MAIL_LIMITS.retryDelaysMs.length - 1)] ?? null;
}

/**
 * The outcome of one sending attempt. results: [{ recipient, ok, messageId,
 * error, retryable }]; earlierSent: messages sent in earlier attempts.
 */
export function summarizeSendResults(results = [], { attempts = 1, earlierSent = 0 } = {}) {
    const sent = results.filter((r) => r.ok);
    const retry = results.filter((r) => !r.ok && r.retryable);
    const failed = results.filter((r) => !r.ok && !r.retryable);
    const delay = retry.length ? nextRetryDelayMs(attempts) : null;
    const permanentFailed = delay === null ? failed.length + retry.length : failed.length;
    const totalSent = earlierSent + sent.length;
    let status;
    if (retry.length && delay !== null) status = 'queued';
    else if (!permanentFailed) status = 'sent';
    else if (totalSent) status = 'partial';
    else status = 'failed';
    const firstError = results.find((r) => !r.ok)?.error || null;
    return {
        status,
        sent: sent.length,
        failed: permanentFailed,
        retryRecipients: delay !== null ? retry.map((r) => r.recipient) : [],
        retryDelayMs: delay,
        messageIds: sent.map((r) => r.messageId).filter(Boolean),
        error: firstError ? String(firstError).slice(0, 300) : null
    };
}

// --- Provider settings (serverSettings/email) ---

/**
 * The settings doc from setEmailProviderSettings, checked. The API key is
 * kept from `existing` when not given (it is never sent back to a client).
 * allowFake: the emulator's fake provider (never in production).
 */
export function normalizeProviderSettings(raw = {}, existing = {}, { allowFake = false } = {}) {
    const providers = allowFake ? [...MAIL_PROVIDERS, 'fake'] : MAIL_PROVIDERS;
    const provider = String(raw.provider ?? existing.provider ?? '').trim().toLowerCase();
    if (!providers.includes(provider)) throw new MailError(`Okänd e-postleverantör. Tillåtna: ${providers.join(', ')}.`);
    let apiKey = existing.apiKey || '';
    if (raw.clearApiKey === true) apiKey = '';
    if (raw.apiKey !== undefined && raw.apiKey !== null && raw.apiKey !== '') {
        apiKey = String(raw.apiKey).trim();
        if (apiKey.length < 10 || apiKey.length > 512 || /\s/.test(apiKey)) throw new MailError('Ogiltig API-nyckel.');
    }
    const fromAddress = normalizeEmail(raw.fromAddress ?? existing.fromAddress);
    if (!isValidEmail(fromAddress)) throw new MailError('Ogiltig avsändaradress.');
    const fromDomain = String(raw.fromDomain ?? existing.fromDomain ?? fromAddress.split('@')[1]).trim().toLowerCase();
    if (!fromAddress.endsWith(`@${fromDomain}`)) throw new MailError('Avsändaradressen måste höra till avsändardomänen.');
    const limit = (value, fallback) => {
        if (value === undefined || value === null || value === '') return fallback;
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > MAIL_LIMITS.dailyLimitMax) throw new MailError('Ogiltig daglig gräns.');
        return n;
    };
    const linkBaseUrl = String(raw.linkBaseUrl ?? existing.linkBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (linkBaseUrl && !/^https:\/\/[a-z0-9.\-]+(:\d+)?(\/[\w\-./]*)?$/i.test(linkBaseUrl)) throw new MailError('Ogiltig länkbas (https krävs).');
    return {
        provider,
        apiKey,
        fromAddress,
        fromDomain,
        dailyLimit: limit(raw.dailyLimit, existing.dailyLimit ?? MAIL_LIMITS.globalDailyDefault),
        competitionDailyLimit: limit(raw.competitionDailyLimit, existing.competitionDailyLimit ?? MAIL_LIMITS.competitionDailyDefault),
        enabled: raw.enabled === undefined ? existing.enabled === true : raw.enabled === true,
        linkBaseUrl
    };
}

/** What a client may see of the settings (never the API key) */
export function providerStatus(settings) {
    const s = settings || {};
    const configured = !!(s.provider && isValidEmail(s.fromAddress) && (s.provider === 'fake' || s.apiKey));
    return {
        configured,
        provider: s.provider || null,
        fromAddress: s.fromAddress || null,
        fromDomain: s.fromDomain || null,
        enabled: configured && s.enabled === true,
        hasApiKey: !!s.apiKey,
        dailyLimit: Number(s.dailyLimit) || MAIL_LIMITS.globalDailyDefault,
        competitionDailyLimit: Number(s.competitionDailyLimit) || MAIL_LIMITS.competitionDailyDefault
    };
}

/** The settings doc from a competition admin (config/emailSettings): what the server uses */
export function readEmailSettings(data = {}) {
    return {
        senderName: cleanLine(data?.senderName, MAIL_LIMITS.senderNameMax),
        replyTo: normalizeEmail(data?.replyTo),
        signature: String(data?.signature ?? '').trim().slice(0, MAIL_LIMITS.signatureMax),
        replyToVerified: data?.replyToVerified === true,
        replyToVerifiedAddress: normalizeEmail(data?.replyToVerifiedAddress),
        // Off unless switched on (as the admin form shows it)
        autoVolunteerConfirmation: data?.autoVolunteerConfirmation === true,
        autoVetDecisionMail: data?.autoVetDecisionMail !== false
    };
}
