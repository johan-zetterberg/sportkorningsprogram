// E-mail queue processing with the database passed in (db, FieldValue), so
// the emulator test (tests/mail.emulator.mjs) runs the same code as the
// functions. The provider comes from providerFactory(settings): tests pass a
// fake, functions/index.js the real one.
//
// Paths
//   serverSettings/email        provider settings (server only; API key never returned)
//   serverSettings/mailSigning  HMAC key for links (created on first use)
//   serverSettings/mailUsage    global daily counter { dayKey, count }
//   mailRetry/{app__comp__mail} mails waiting for a retry (retryAt) or for a
//                               superadmin (reason not_configured / blocked)
//   artifacts/{app}/private/data/competitions/{comp}/
//     mailQueue/{id}            the mails (admins read; server writes)
//     mailLog/{id}              one summary per attempt (no addresses)
//     mailOptOuts/{emailHash}   opt-outs from information mail
//     rateLimits/mail_day       the competition's daily counter
import { randomBytes } from 'node:crypto';
import {
    MAIL_LIMITS,
    buildRecipientMessage,
    buildSenderName,
    effectiveReplyTo,
    emailHash,
    filterOptOuts,
    isEssentialMail,
    mailDayKey,
    mailQuotaLimits,
    nextRetryDelayMs,
    normalizeEmail,
    normalizeExplicitRecipients,
    readEmailSettings,
    releaseDailyQuota,
    reserveDailyQuota,
    resolveRecipients,
    signMailToken,
    summarizeSendResults
} from './mailCore.js';
import { sendAll } from './providers.js';

export const SERVER_EMAIL_SETTINGS = 'serverSettings/email';
export const SERVER_MAIL_SIGNING = 'serverSettings/mailSigning';
export const SERVER_MAIL_USAGE = 'serverSettings/mailUsage';
export const MAIL_RETRY_COLLECTION = 'mailRetry';
export const MAIL_DAY_COUNTER = 'mail_day';
// System mail (volunteer confirmations, reply-to checks, tests): own counters
export const MAIL_SYSTEM_DAY_COUNTER = 'mail_system_day';
export const SERVER_MAIL_SYSTEM_USAGE = 'serverSettings/mailSystemUsage';
// A mail left in 'sending' this long is taken as stopped half-way (longer
// than any function that sends: 540 s at most)
export const STUCK_SENDING_MS = 15 * 60 * 1000;
// Messages sent between two records of who got the mail (deliveredHashes)
export const MAIL_SEND_CHUNK = 50;
// A start time change older than this is no use any more (retryQueuedMail)
export const START_TIME_MAIL_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export const competitionPath = (appId, compId) => `artifacts/${appId}/public/data/competitions/${compId}`;
export const privateCompetitionPath = (appId, compId) => `artifacts/${appId}/private/data/competitions/${compId}`;
export const mailQueuePath = (appId, compId) => `${privateCompetitionPath(appId, compId)}/mailQueue`;
export const mailLogPath = (appId, compId) => `${privateCompetitionPath(appId, compId)}/mailLog`;
export const mailOptOutsPath = (appId, compId) => `${privateCompetitionPath(appId, compId)}/mailOptOuts`;
export const emailSettingsPath = (appId, compId) => `${competitionPath(appId, compId)}/config/emailSettings`;
export const retryEntryId = (appId, compId, mailId) => `${appId}__${compId}__${mailId}`;

/**
 * A queue document. mail: { kind, category?, subject, text, html?,
 * audience? | to?, personalTexts?, createdBy, createdByRole?, source? }
 * (checked by the caller: mailCore validateMailContent / normalizeAudience).
 */
export function buildQueueDoc(mail, { FieldValue, now = Date.now() }) {
    return {
        kind: mail.kind,
        category: mail.category || (isEssentialMail(mail) ? 'essential' : 'info'),
        subject: mail.subject,
        text: mail.text,
        html: mail.html || '',
        audience: mail.audience || null,
        to: mail.to ? normalizeExplicitRecipients(mail.to) : null,
        personalTexts: mail.personalTexts || null,
        createdBy: mail.createdBy || 'system',
        createdByRole: mail.createdByRole || null,
        // Why an essential mail was sent (queueCompetitionMail), for the log
        reason: mail.reason || null,
        source: mail.source || null,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: now,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: null,
        counts: { recipients: 0, sent: 0, failed: 0, skippedOptOut: 0, withoutEmail: 0 },
        error: null,
        providerMessageIds: []
    };
}

export function newMailRef(db, appId, compId) {
    return db.collection(mailQueuePath(appId, compId)).doc();
}

/** Queues a mail (the onMailQueued trigger sends it); in `tx` when given */
export async function enqueueMail({ db, FieldValue, appId, compId, mail, tx = null, now = Date.now() }) {
    const ref = newMailRef(db, appId, compId);
    const doc = buildQueueDoc(mail, { FieldValue, now });
    if (tx) tx.set(ref, doc);
    else await ref.set(doc);
    return ref;
}

export async function loadProviderSettings(db) {
    const snap = await db.doc(SERVER_EMAIL_SETTINGS).get();
    return snap.exists ? snap.data() : null;
}

/** The HMAC key for link tokens, created on first use */
export async function getSigningKey(db) {
    const ref = db.doc(SERVER_MAIL_SIGNING);
    const snap = await ref.get();
    if (snap.exists && snap.data()?.key) return Buffer.from(snap.data().key, 'base64');
    try {
        await ref.create({ key: randomBytes(32).toString('base64'), createdAt: Date.now() });
    } catch {
        // Created by a parallel call: read it below
    }
    const again = await ref.get();
    return Buffer.from(again.data().key, 'base64');
}

const EQUIPAGE_FIELDS = ['className', 'driverName', 'status', 'struken', 'withdrawn', 'scratched', 'email'];

async function loadAudienceDocs(db, appId, compId, audience) {
    const base = competitionPath(appId, compId);
    const list = async (name, fields = null) => {
        const ref = db.collection(`${base}/${name}`);
        const snap = await (fields ? ref.select(...fields) : ref).get();
        return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    };
    const asMap = (docs) => new Map(docs.map((d) => [d.id, d.data]));
    const out = {};
    if (audience?.drivers) {
        const [equipages, priv] = await Promise.all([list('equipages', EQUIPAGE_FIELDS), list('equipagePrivate', ['email', 'contactEmail', 'driverEmail'])]);
        out.equipages = equipages;
        out.equipagePrivate = asMap(priv);
    }
    if (audience?.officials) {
        const [officials, officialsPrivate, judges, judgesPrivate] = await Promise.all([
            list('officials', ['name', 'role', 'roleLabel', 'email']),
            list('officialsPrivate', ['email']),
            list('judges', ['name', 'email']),
            list('judgesPrivate', ['email'])
        ]);
        Object.assign(out, { officials, officialsPrivate: asMap(officialsPrivate), judges, judgesPrivate: asMap(judgesPrivate) });
    }
    return out;
}

/**
 * The recipients of a queued mail: the retry list, the explicit list from a
 * server producer, or the audience resolved from the competition's documents.
 */
export async function resolveMailRecipients(db, appId, compId, mail) {
    if (Array.isArray(mail.retryRecipients) && mail.retryRecipients.length) {
        return { recipients: normalizeExplicitRecipients(mail.retryRecipients), withoutEmail: [], unknownStartNumbers: [] };
    }
    if (Array.isArray(mail.to) && mail.to.length) {
        return { recipients: normalizeExplicitRecipients(mail.to), withoutEmail: [], unknownStartNumbers: [] };
    }
    if (mail.audience) {
        const docs = await loadAudienceDocs(db, appId, compId, mail.audience);
        return resolveRecipients({ audience: mail.audience, ...docs });
    }
    return { recipients: [], withoutEmail: [], unknownStartNumbers: [] };
}

/** The emailHash ids of the recipients who opted out of the competition's information mail */
export async function readOptOuts(db, appId, compId, recipients) {
    const refs = recipients.map((r) => db.doc(`${mailOptOutsPath(appId, compId)}/${emailHash(r.email)}`));
    const found = new Set();
    for (let i = 0; i < refs.length; i += 100) {
        const snaps = await db.getAll(...refs.slice(i, i + 100));
        snaps.filter((s) => s.exists).forEach((s) => found.add(s.id));
    }
    return found;
}

// The counters a mail counts against, with their caps (mailCore mailQuotaLimits)
function quotaCounters(db, { appId, compId, mail, settings }) {
    const limits = mailQuotaLimits(mail, settings);
    const counters = [
        { scope: 'competition', ref: db.doc(`${privateCompetitionPath(appId, compId)}/rateLimits/${MAIL_DAY_COUNTER}`), limit: limits.competition },
        { scope: 'global', ref: db.doc(SERVER_MAIL_USAGE), limit: limits.global }
    ];
    if (limits.systemCompetition !== null) {
        counters.push(
            { scope: 'system', ref: db.doc(`${privateCompetitionPath(appId, compId)}/rateLimits/${MAIL_SYSTEM_DAY_COUNTER}`), limit: limits.systemCompetition },
            { scope: 'system', ref: db.doc(SERVER_MAIL_SYSTEM_USAGE), limit: limits.systemGlobal }
        );
    }
    return counters;
}

/**
 * Counts `count` messages against the daily caps, all or nothing: the
 * competition's (a share of the global one), the global one (less the
 * reserve for essential competition mail) and, for system mail, its own caps.
 * mail: { kind, category } (the old callers' mail-less calls count as info).
 */
export async function reserveMailQuota(db, { appId, compId, count, settings, mail = {}, now = Date.now() }) {
    const dayKey = mailDayKey(now);
    const counters = quotaCounters(db, { appId, compId, mail, settings });
    return db.runTransaction(async (tx) => {
        const snaps = await Promise.all(counters.map((c) => tx.get(c.ref)));
        const results = counters.map((c, i) => reserveDailyQuota(snaps[i].exists ? snaps[i].data() : null, dayKey, count, c.limit, now));
        const blocked = results.findIndex((r) => !r.allowed);
        if (blocked >= 0) {
            return { allowed: false, scope: counters[blocked].scope, remaining: results[blocked].remaining, limit: counters[blocked].limit };
        }
        results.forEach((r, i) => tx.set(counters[i].ref, r.next));
        return { allowed: true, remaining: Math.min(...results.map((r) => r.remaining)) };
    });
}

/** Gives back the quota of `count` messages that were not delivered (today's counters only) */
export async function releaseMailQuota(db, { appId, compId, count, settings, mail = {}, now = Date.now() }) {
    if (!(count > 0)) return;
    const dayKey = mailDayKey(now);
    const counters = quotaCounters(db, { appId, compId, mail, settings });
    await db.runTransaction(async (tx) => {
        const snaps = await Promise.all(counters.map((c) => tx.get(c.ref)));
        counters.forEach((c, i) => {
            const next = releaseDailyQuota(snaps[i].exists ? snaps[i].data() : null, dayKey, count, now);
            if (next) tx.set(c.ref, next);
        });
    });
}

/** Today's use of the caps (for status calls) */
export async function readMailUsage(db, { appId = null, compId = null, now = Date.now() } = {}) {
    const dayKey = mailDayKey(now);
    const count = (snap) => (snap.exists && snap.data()?.dayKey === dayKey ? Number(snap.data().count) || 0 : 0);
    const globalSnap = await db.doc(SERVER_MAIL_USAGE).get();
    const usage = { dayKey, global: count(globalSnap) };
    if (appId && compId) {
        usage.competition = count(await db.doc(`${privateCompetitionPath(appId, compId)}/rateLimits/${MAIL_DAY_COUNTER}`).get());
    }
    return usage;
}

async function setRetryEntry(db, { appId, compId, mailId, reason, retryAt = null, now }) {
    const ref = db.collection(MAIL_RETRY_COLLECTION).doc(retryEntryId(appId, compId, mailId));
    if (!reason) {
        await ref.delete();
        return;
    }
    await ref.set({ appId, compId, mailId, reason, retryAt: reason === 'retry' ? retryAt : null, updatedAt: now });
}

async function writeMailLog(db, FieldValue, { appId, compId, mailId, mail, update, provider, now }) {
    const counts = update.counts || mail.counts || {};
    await db.collection(mailLogPath(appId, compId)).add({
        mailId,
        kind: mail.kind,
        category: mail.category || null,
        createdBy: mail.createdBy || 'system',
        createdByRole: mail.createdByRole || null,
        reason: mail.reason || null,
        status: update.status,
        attempt: update.attempts ?? mail.attempts ?? 0,
        recipients: counts.recipients || 0,
        sent: counts.sent || 0,
        failed: counts.failed || 0,
        skippedOptOut: counts.skippedOptOut || 0,
        withoutEmail: counts.withoutEmail || 0,
        error: update.error || null,
        provider: provider || null,
        at: FieldValue.serverTimestamp(),
        atMs: now
    });
}

export function defaultLinkBaseUrl(env = process.env) {
    let projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || '';
    if (!projectId && env.FIREBASE_CONFIG) {
        try {
            projectId = JSON.parse(env.FIREBASE_CONFIG).projectId || '';
        } catch {
            projectId = '';
        }
    }
    if (env.FUNCTIONS_EMULATOR === 'true') return `http://127.0.0.1:5001/${projectId}/europe-west1`;
    return `https://europe-west1-${projectId}.cloudfunctions.net`;
}

/**
 * Sends one queued mail: claims it (queued -> sending, in a transaction, so a
 * second run does nothing), resolves the recipients, drops opt-outs (info
 * mail), checks the daily caps and sends one message per recipient. Failed
 * deliveries the provider may accept later are retried with a delay
 * (mailRetry, processDueMailRetries); no Functions retry is used. Returns
 * { status, counts? } ('skipped' when the mail was not due).
 */
export async function processMailDoc({
    db, FieldValue, logger = console, ref, appId, compId, providerFactory,
    linkBaseUrl = null, now = Date.now()
}) {
    const sendAttemptId = randomBytes(8).toString('hex');
    const mail = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const data = snap.data();
        if (data.status !== 'queued' || (data.nextAttemptAt && data.nextAttemptAt > now)) return null;
        // The recoverable marker: if this run stops half-way (the instance
        // dies), the watchdog entry makes processDueMailRetries take the mail
        // over after STUCK_SENDING_MS and send to the recipients not yet
        // recorded in deliveredHashes
        tx.update(ref, { status: 'sending', sendingAt: now, sendAttemptId });
        tx.set(db.collection(MAIL_RETRY_COLLECTION).doc(retryEntryId(appId, compId, ref.id)),
            { appId, compId, mailId: ref.id, reason: 'retry', retryAt: now + STUCK_SENDING_MS, watchdog: true, updatedAt: now });
        return data;
    });
    if (!mail) return { status: 'skipped' };
    // Recipients already sent to (earlier attempts or a run that stopped)
    const delivered = new Set(Array.isArray(mail.deliveredHashes) ? mail.deliveredHashes : []);

    const finish = async (update, provider = null) => {
        const full = { ...update, sendingAt: FieldValue.delete(), sendAttemptId: FieldValue.delete(), updatedAt: now };
        await ref.update(full);
        const retry = update.status === 'queued'
            ? { reason: 'retry', retryAt: update.nextAttemptAt }
            : (['not_configured', 'blocked'].includes(update.status) ? { reason: update.status } : { reason: null });
        await setRetryEntry(db, { appId, compId, mailId: ref.id, now, ...retry });
        await writeMailLog(db, FieldValue, { appId, compId, mailId: ref.id, mail, update, provider, now });
        return { status: update.status, counts: update.counts || mail.counts };
    };

    // Kept outside the try: an error after sending must not lose who got it
    let sending = null;
    let sendError = null;
    let baseCounts = null;
    let earlierSent = delivered.size;
    let earlierFailed = 0;
    try {
        const settings = await loadProviderSettings(db);
        const provider = providerFactory(settings);
        if (!provider) {
            return await finish({ status: 'not_configured', error: 'E-post är inte konfigurerad ännu. Mejlet ligger kvar i kön.' });
        }
        const [compSnap, emailSettingsSnap] = await Promise.all([
            db.doc(competitionPath(appId, compId)).get(),
            db.doc(emailSettingsPath(appId, compId)).get()
        ]);
        if (!compSnap.exists || compSnap.data()?.deleting === true) {
            return await finish({ status: 'failed', error: 'Tävlingen finns inte.' });
        }
        const comp = compSnap.data() || {};
        const emailSettings = readEmailSettings(emailSettingsSnap.exists ? emailSettingsSnap.data() : {});
        const essential = isEssentialMail(mail);
        const firstAttempt = !(Array.isArray(mail.retryRecipients) && mail.retryRecipients.length);

        const resolved = await resolveMailRecipients(db, appId, compId, mail);
        let recipients = resolved.recipients;
        let skipped = 0;
        if (!essential && recipients.length) {
            ({ recipients, skipped } = filterOptOuts(recipients, await readOptOuts(db, appId, compId, recipients), false));
        }
        baseCounts = firstAttempt
            ? { recipients: recipients.length, sent: 0, failed: 0, skippedOptOut: skipped, withoutEmail: resolved.withoutEmail.length }
            : { ...mail.counts };
        earlierSent = Math.max(firstAttempt ? 0 : Number(mail.counts?.sent) || 0, delivered.size);
        earlierFailed = firstAttempt ? 0 : Number(mail.counts?.failed) || 0;
        if (recipients.length > MAIL_LIMITS.maxRecipients) {
            return await finish({ status: 'failed', counts: baseCounts, error: `För många mottagare (högst ${MAIL_LIMITS.maxRecipients}).` });
        }
        // Never twice to the same address: those recorded as sent are left out
        recipients = recipients.filter((r) => !delivered.has(emailHash(r.email)));
        if (!recipients.length) {
            return await finish(resolved.recipients.length
                ? { status: 'sent', counts: { ...baseCounts, sent: earlierSent }, error: null, sentAt: now, retryRecipients: FieldValue.delete() }
                : { status: 'failed', counts: baseCounts, error: 'Inga mottagare med e-postadress.' });
        }

        const quota = await reserveMailQuota(db, { appId, compId, count: recipients.length, settings, mail, now });
        if (!quota.allowed) {
            const scope = quota.scope === 'competition' ? 'tävlingens' : (quota.scope === 'system' ? 'systemets automatiska' : 'DriveLives');
            return await finish({
                status: 'blocked',
                counts: baseCounts,
                error: `Dagens gräns för ${scope} e-post är nådd (${quota.remaining} av ${quota.limit} kvar, utskicket har ${recipients.length} mottagare).`
            });
        }

        const key = essential ? null : await getSigningKey(db);
        const replyTo = effectiveReplyTo(emailSettings);
        const from = {
            email: settings.fromAddress,
            name: buildSenderName(emailSettings.senderName || comp.organizerName || comp.club || comp.name)
        };
        const linkBase = settings.linkBaseUrl || linkBaseUrl || defaultLinkBaseUrl();
        const messages = recipients.map((recipient) => {
            const headers = {};
            let unsubscribeUrl = null;
            if (!essential) {
                const token = signMailToken({ p: 'u', a: appId, c: compId, h: emailHash(recipient.email), x: now + MAIL_LIMITS.unsubscribeTokenMs }, key);
                unsubscribeUrl = `${linkBase}/unsubscribeEmail?t=${token}`;
                headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
                headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
            }
            const content = buildRecipientMessage(mail, recipient, {
                competitionName: comp.name,
                signature: emailSettings.signature,
                replyTo,
                unsubscribeUrl
            });
            return { from, replyTo, ...content, headers, tags: [mail.kind] };
        });

        // In chunks: after each, who got it is recorded (deliveredHashes), so
        // a run that stops half-way is resumed without sending anyone twice
        sending = { provider, settings, reserved: recipients.length, results: [] };
        for (let i = 0; i < messages.length; i += MAIL_SEND_CHUNK) {
            const chunk = (await sendAll(provider, messages.slice(i, i + MAIL_SEND_CHUNK)))
                .map((result, j) => ({ ...result, recipient: recipients[i + j] }));
            sending.results.push(...chunk);
            const sentHashes = chunk.filter((r) => r.ok).map((r) => emailHash(r.recipient.email));
            if (sentHashes.length) {
                try {
                    await ref.update({ deliveredHashes: FieldValue.arrayUnion(...sentHashes), sendingProgressAt: Date.now() });
                } catch (recordError) {
                    logger.warn('E-post: mottagare kunde inte noteras som skickade', { appId, compId, mailId: ref.id, error: String(recordError?.message || recordError) });
                }
            }
        }
    } catch (error) {
        sendError = error;
        logger.error('E-postutskicket misslyckades', { appId, compId, mailId: ref.id, error: String(error?.message || error) });
    }

    // Bookkeeping on its own: a failure here never sends the mail again to
    // those who got it (they are in deliveredHashes; the watchdog entry from
    // the claim takes the mail over if even this fails)
    try {
        const results = sending?.results || [];
        const sentNow = results.filter((r) => r.ok).length;
        const attempts = (mail.attempts || 0) + 1;
        if (sending) {
            // Undelivered (or never tried) messages do not use up the day's caps (a retry reserves again)
            await releaseMailQuota(db, { appId, compId, count: sending.reserved - sentNow, settings: sending.settings, mail, now })
                .catch((error) => logger.warn('E-postkvoten kunde inte återlämnas', { appId, compId, mailId: ref.id, error: String(error?.message || error) }));
        }
        if (sendError) {
            const delay = nextRetryDelayMs(attempts);
            const update = {
                status: delay === null ? 'failed' : 'queued',
                attempts,
                error: String(sendError?.message || sendError).slice(0, 300),
                nextAttemptAt: delay === null ? null : now + delay
            };
            if (baseCounts) update.counts = { ...baseCounts, sent: earlierSent + sentNow, failed: earlierFailed };
            return await finish(update, sending?.provider?.name || null);
        }
        const summary = summarizeSendResults(results, { attempts, earlierSent });
        const counts = {
            ...baseCounts,
            sent: earlierSent + summary.sent,
            failed: earlierFailed + summary.failed
        };
        const update = {
            status: summary.status,
            attempts,
            counts,
            error: summary.error,
            provider: sending.provider.name,
            providerMessageIds: [...(mail.providerMessageIds || []), ...summary.messageIds].slice(0, MAIL_LIMITS.maxRecipients),
            nextAttemptAt: summary.status === 'queued' ? now + summary.retryDelayMs : null,
            retryRecipients: summary.retryRecipients.length ? summary.retryRecipients : FieldValue.delete()
        };
        if (summary.status !== 'queued') update.sentAt = now;
        return await finish(update, sending.provider.name);
    } catch (error) {
        logger.error('E-post: utskicket kunde inte bokföras (tas över av nästa körning)', { appId, compId, mailId: ref.id, error: String(error?.message || error) });
        return { status: 'error', counts: mail.counts };
    }
}

/** Mails whose retry time has come (scheduled processMailRetries) */
export async function processDueMailRetries({ db, FieldValue, logger = console, providerFactory, linkBaseUrl = null, now = Date.now(), limit = 20 }) {
    const snap = await db.collection(MAIL_RETRY_COLLECTION).where('retryAt', '<=', now).limit(limit).get();
    const results = [];
    for (const entry of snap.docs) {
        const { appId, compId, mailId } = entry.data();
        const ref = db.doc(`${mailQueuePath(appId, compId)}/${mailId}`);
        const mailSnap = await ref.get();
        const status = mailSnap.exists ? mailSnap.data()?.status : null;
        if (status === 'sending') {
            // The watchdog entry of a run that stopped half-way: taken over,
            // sent to the recipients not yet recorded as sent
            if (!(await takeOverStuckMail(db, ref, now))) continue;
            logger.warn('E-post: avbrutet utskick tas över', { appId, compId, mailId });
        } else if (status !== 'queued') {
            await entry.ref.delete();
            continue;
        }
        const result = await processMailDoc({ db, FieldValue, logger, ref, appId, compId, providerFactory, linkBaseUrl, now });
        results.push({ appId, compId, mailId, status: result.status });
    }
    return results;
}

/** A mail left in 'sending' longer than STUCK_SENDING_MS back to 'queued': true when taken over */
export async function takeOverStuckMail(db, ref, now = Date.now()) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const mail = snap.exists ? snap.data() : null;
        if (!mail || mail.status !== 'sending' || now - (Number(mail.sendingAt) || 0) <= STUCK_SENDING_MS) return false;
        tx.update(ref, { status: 'queued', nextAttemptAt: null, takeovers: (Number(mail.takeovers) || 0) + 1, updatedAt: now });
        return true;
    });
}

/** A start time change mail too old to be any use (START_TIME_MAIL_MAX_AGE_MS) */
export function isStaleStartTimeMail(mail = {}, now = Date.now()) {
    return mail.kind === 'startTimeChange' && now - (Number(mail.createdAtMs) || 0) > START_TIME_MAIL_MAX_AGE_MS;
}

/**
 * Puts a mail that waited (not_configured, blocked), failed or stopped
 * half-way back in the queue and sends it now (retryQueuedMail). Mails older
 * than maxAgeMs are closed as failed instead (an old start time is no use).
 */
export async function requeueMail({ db, FieldValue, logger = console, appId, compId, mailId, providerFactory, linkBaseUrl = null, now = Date.now(), maxAgeMs = null }) {
    const ref = db.doc(`${mailQueuePath(appId, compId)}/${mailId}`);
    const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return 'missing';
        const mail = snap.data();
        const stuck = mail.status === 'sending' && now - (Number(mail.sendingAt) || 0) > STUCK_SENDING_MS;
        if (!['not_configured', 'blocked', 'failed', 'queued'].includes(mail.status) && !stuck) return mail.status;
        if (maxAgeMs && now - (Number(mail.createdAtMs) || 0) > maxAgeMs) {
            tx.update(ref, { status: 'failed', error: 'För gammalt för att skickas.', updatedAt: now });
            return 'expired';
        }
        // Changed start times more than 12 h old: the start is likely over
        if (isStaleStartTimeMail(mail, now)) {
            tx.update(ref, { status: 'expired', error: 'Starttidsändringen är för gammal för att skickas.', sendingAt: FieldValue.delete(), updatedAt: now });
            return 'expired-start-time';
        }
        const update = { status: 'queued', nextAttemptAt: null, error: null, updatedAt: now };
        // A mail that never reached the provider starts over
        if (['not_configured', 'blocked', 'failed'].includes(mail.status)) update.attempts = 0;
        tx.update(ref, update);
        return 'requeued';
    });
    if (outcome === 'requeued') {
        const result = await processMailDoc({ db, FieldValue, logger, ref, appId, compId, providerFactory, linkBaseUrl, now });
        return { appId, compId, mailId, status: result.status, counts: result.counts };
    }
    if (outcome === 'expired' || outcome === 'expired-start-time' || outcome === 'missing') {
        await setRetryEntry(db, { appId, compId, mailId, reason: null, now });
    }
    const status = outcome === 'expired' ? 'failed' : (outcome === 'expired-start-time' ? 'expired' : outcome);
    return { appId, compId, mailId, status, skipped: true };
}

/** The mails waiting for a superadmin (not configured, over a cap) */
export async function listWaitingMail(db, { appId = null, compId = null, limit = 100 } = {}) {
    const snap = await db.collection(MAIL_RETRY_COLLECTION).where('reason', 'in', ['not_configured', 'blocked']).limit(limit).get();
    return snap.docs.map((d) => d.data()).filter((e) => (!appId || e.appId === appId) && (!compId || e.compId === compId));
}

/** An opt-out from the competition's information mail (no address stored) */
export async function recordOptOut(db, { appId, compId, hash, now = Date.now() }) {
    if (!/^[0-9a-f]{40}$/.test(String(hash))) return false;
    const compSnap = await db.doc(competitionPath(appId, compId)).get();
    if (!compSnap.exists) return false;
    await db.doc(`${mailOptOutsPath(appId, compId)}/${hash}`).set({ scope: 'info', createdAt: now });
    return true;
}

/**
 * Marks the club's reply-to address checked, if it is still the address set
 * in config/emailSettings. Returns 'verified', 'changed' or 'missing'.
 */
export async function markReplyToVerified(db, { appId, compId, address, now = Date.now() }) {
    const ref = db.doc(emailSettingsPath(appId, compId));
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return 'missing';
        if (normalizeEmail(snap.data()?.replyTo) !== normalizeEmail(address)) return 'changed';
        tx.update(ref, { replyToVerified: true, replyToVerifiedAddress: normalizeEmail(address), replyToVerifiedAt: now });
        return 'verified';
    });
}
