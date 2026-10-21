// Pure helpers for the e-mail UI (admin → Kommunikation, Starttider, superadmin
// settings). The server (functions/src/mail) owns the real rules; these only
// shape what the pages send and show.
import { OFFICIAL_ROLE_KEYS } from './messageAudience.js';

export const MAIL_SUBJECT_MAX = 200;
export const MAIL_TEXT_MAX = 20000;
export const SENDER_NAME_MAX = 60;
export const SIGNATURE_MAX = 1000;

// Queue statuses (mailQueue.status) and their dictionary keys
const STATUS_KEYS = {
    queued: 'mail_status_queued',
    sending: 'mail_status_sending',
    sent: 'mail_status_sent',
    partial: 'mail_status_partial',
    failed: 'mail_status_failed',
    not_configured: 'mail_status_not_configured',
    blocked: 'mail_status_blocked'
};

/** Dictionary key for a queue status (unknown ones fall back to a neutral label) */
export function mailStatusKey(status) {
    return STATUS_KEYS[String(status || '')] || 'mail_status_unknown';
}

/** Tone for a status badge: ok | wait | bad */
export function mailStatusTone(status) {
    if (status === 'sent') return 'ok';
    if (status === 'failed' || status === 'blocked' || status === 'partial') return 'bad';
    return 'wait';
}

const KIND_KEYS = {
    message: 'mail_kind_message',
    test: 'mail_kind_test',
    startTimeChange: 'mail_kind_start_time_change',
    vetDecision: 'mail_kind_vet_decision',
    volunteerConfirmation: 'mail_kind_volunteer_confirmation',
    declarationChange: 'mail_kind_declaration_change',
    replyToVerification: 'mail_kind_reply_to_verification'
};

/** Dictionary key for a queue item's kind (anything else: a generic label) */
export function mailKindKey(kind) {
    return KIND_KEYS[String(kind || '')] || 'mail_kind_other';
}

/**
 * The mail audience for the audience chosen in the message form
 * (messageAudience.buildMessageAudience modes). null for a mode that has no
 * recipients (an unknown mode).
 * mode: 'public' | 'drivers' | 'selected_drivers' | 'officials' | 'official:<role>'
 */
export function messageModeToMailAudience(mode, { selectedDrivers = [] } = {}) {
    const m = String(mode || '');
    // A public message reaches the drivers too; e-mail goes to the drivers
    if (m === 'public' || m === 'public_and_drivers' || m === 'public_only' || m === 'drivers' || m === 'drivers_only') {
        return { drivers: { all: true } };
    }
    if (m === 'selected_drivers') {
        const startNumbers = [...new Set((Array.isArray(selectedDrivers) ? selectedDrivers : [])
            .map(v => String(v ?? '').trim()).filter(Boolean))];
        return startNumbers.length ? { drivers: { startNumbers } } : null;
    }
    if (m === 'officials') return { officials: { all: true } };
    if (m.startsWith('official:')) {
        const role = m.slice('official:'.length);
        if (!OFFICIAL_ROLE_KEYS.includes(role)) return null;
        // The dressage judges are stored as judges on the server
        return { officials: { roles: role === 'dressage' ? ['dressage', 'judge'] : [role] } };
    }
    return null;
}

/** The queueCompetitionMail payload for a message from the form (subject/text clamped to the server limits) */
export function buildMessageMailPayload({ competitionId, title, body, titleEn = '', bodyEn = '', mode, selectedDrivers = [], essential = false }) {
    const audience = messageModeToMailAudience(mode, { selectedDrivers });
    if (!audience) return null;
    const english = String(bodyEn || '').trim();
    const text = english ? `${String(body || '').trim()}\n\n---\n\n${english}` : String(body || '').trim();
    const subject = String(title || '').trim() || String(titleEn || '').trim();
    return {
        competitionId,
        kind: 'message',
        category: essential ? 'essential' : 'info',
        audience,
        subject: subject.slice(0, MAIL_SUBJECT_MAX),
        text: text.slice(0, MAIL_TEXT_MAX)
    };
}

/** Counts for the recipient preview: a line key and params, or null when nothing to say */
export function summarizePreview(preview) {
    if (!preview || typeof preview !== 'object') return null;
    const recipients = Number(preview.recipientCount) || 0;
    const optedOut = Number(preview.optedOutCount) || 0;
    const withoutEmail = Array.isArray(preview.withoutEmail) ? preview.withoutEmail.length : 0;
    const unknown = Array.isArray(preview.unknownStartNumbers) ? preview.unknownStartNumbers.length : 0;
    return { recipients, optedOut, withoutEmail, unknown };
}

/**
 * Per-driver lines for queueStartTimeChangeMail: [{ startNumber, text }], one
 * entry per start number (its disciplines joined by new lines).
 * translateTo(key, lang) gives the dictionary text.
 */
export function buildStartTimeMailChanges(changes = [], translateTo = (key) => key, lang = 'sv') {
    const clock = (value) => {
        const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})$/.exec(String(value || ''));
        return m ? `${m[1]}:${m[2]}` : '';
    };
    const none = translateTo('starttime_none', lang);
    const byNumber = new Map();
    (Array.isArray(changes) ? changes : []).forEach((c) => {
        const sn = String(c?.startNumber ?? '').trim();
        if (!sn) return;
        const day = c.to && c.from && String(c.to).slice(0, 10) !== String(c.from).slice(0, 10) ? ` (${String(c.to).slice(0, 10)})` : '';
        const line = `${translateTo(`starttime_discipline_${c.discipline}`, lang)}: ${clock(c.from) || none} → ${clock(c.to) || none}${day}`;
        if (!byNumber.has(sn)) byNumber.set(sn, []);
        byNumber.get(sn).push(line);
    });
    return [...byNumber.entries()].map(([startNumber, lines]) => ({ startNumber, text: lines.join('\n') }));
}

/** A queue item's counts as "sent / recipients" text parts */
export function mailCountsSummary(counts = {}) {
    const n = (v) => Number(v) || 0;
    return {
        recipients: n(counts.recipients),
        sent: n(counts.sent),
        failed: n(counts.failed),
        skippedOptOut: n(counts.skippedOptOut),
        withoutEmail: n(counts.withoutEmail)
    };
}

/** Form values → the emailSettings fields an admin may write (never replyToVerified*) */
export function normalizeEmailSettingsInput(input = {}) {
    return {
        senderName: String(input.senderName || '').trim().slice(0, SENDER_NAME_MAX),
        replyTo: String(input.replyTo || '').trim().toLowerCase(),
        signature: String(input.signature || '').trim().slice(0, SIGNATURE_MAX),
        autoVolunteerConfirmation: input.autoVolunteerConfirmation === true,
        autoVetDecisionMail: input.autoVetDecisionMail === true
    };
}

export function isPlausibleEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

/** Reply-To is used only when the verified address equals the saved one */
export function replyToState(settings = {}) {
    const replyTo = String(settings.replyTo || '').trim().toLowerCase();
    if (!replyTo) return 'none';
    return String(settings.replyToVerifiedAddress || '').trim().toLowerCase() === replyTo ? 'verified' : 'unverified';
}

/** Millis of a Firestore timestamp / number (0 when missing) */
export function mailTimeMillis(item = {}) {
    if (Number.isFinite(item.createdAtMs)) return item.createdAtMs;
    const ts = item.createdAt;
    if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
    if (ts && Number.isFinite(ts.seconds)) return ts.seconds * 1000;
    return 0;
}
