// Personal data handling (GDPR): retention of private competition data,
// self-service account deletion and access requests (export of one person's
// data). Pure functions; functions/index.js does the reads and writes.

export const DEFAULT_RETENTION_MONTHS = 12;
export const MIN_RETENTION_MONTHS = 1;
export const MAX_RETENTION_MONTHS = 120;
// PIN attempt and rate limit counters are kept this long after their last write
export const STALE_COUNTER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Collections under artifacts/{appId}/public/data/competitions/{id} with
// private data (contact details, ICE, health and vet data): deleted at expiry
export const RETENTION_PUBLIC_TREE_COLLECTIONS = [
    'equipagePrivate',
    'officialsPrivate',
    'judgesPrivate',
    'volunteerSignups',
    'horseTemperatures',
    'vetInspections',
    'vetNotes'
];
// ...and under artifacts/{appId}/private/data/competitions/{id}
// (field device status, staff notifications, emergency phone numbers, and the
// e-mail queue, its log and the opt-outs, the push log, and the pause events
// already applied to the pause log). Not `counters`: the incident counter
// stays with the kept incident log, so numbers are never reused.
export const RETENTION_PRIVATE_TREE_COLLECTIONS = ['rejectedWrites', 'rateLimits', 'devices',
    'staffNotifications', 'emergencyPrivate', 'mailQueue', 'mailLog', 'mailOptOuts', 'pushLog', 'pauseEvents'];
// Logs that are kept, without names and email addresses (the incident log is
// the ground jury's record: kept, without who typed the entries)
export const RETENTION_ANONYMIZED_LOGS = [
    { tree: 'private', name: 'auditLog' },
    { tree: 'private', name: 'incidents' },
    { tree: 'public', name: 'maintenanceRuns' },
    { tree: 'root', name: 'finalizationLog' }
];
// Field paths with a name or an email address in those logs (uids stay: they
// identify no one once the account is gone)
export const PERSONAL_LOG_FIELDS = [
    'email',
    'byName',
    'editedByName',
    'editedByEmail',
    'userEmail',
    'displayName',
    'reportedByName',
    'reportedByEmail',
    'initiatedBy.email',
    'createdByName',
    'updatedByName'
];

/** Milliseconds from a number, Date, ISO string or Firestore Timestamp; else null */
export function toMillis(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }
    return null;
}

export function isArchivedCompetitionData(data) {
    return data?.locked === true || data?.status === 'completed';
}

/**
 * When the competition was archived: finalizedAt (set when archiving), else
 * the archive snapshot's time, else the end of the last date in `dates`
 * ("2026-05-15 - 2026-05-17"). Null for a competition that is not archived or
 * has no date at all (then nothing is deleted).
 */
export function archivedAtMs(data) {
    if (!isArchivedCompetitionData(data)) return null;
    const finalizedAt = toMillis(data.finalizedAt);
    if (finalizedAt) return finalizedAt;
    const snapshot = /^snapshot_(\d{10,})$/.exec(String(data.archiveSnapshotId || ''));
    if (snapshot) return Number(snapshot[1]);
    const dates = String(data.dates || data.date || '').match(/\d{4}-\d{2}-\d{2}/g);
    if (dates?.length) {
        const end = Date.parse(`${dates[dates.length - 1]}T23:59:59Z`);
        if (Number.isFinite(end)) return end;
    }
    return null;
}

/** The competition's retention in whole months (admin setting), else the default */
export function normalizeRetentionMonths(value) {
    const months = Number(value);
    if (!Number.isInteger(months)) return DEFAULT_RETENTION_MONTHS;
    return Math.min(MAX_RETENTION_MONTHS, Math.max(MIN_RETENTION_MONTHS, months));
}

export function addMonthsMs(ms, months) {
    const date = new Date(ms);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    // 31 Jan + 1 month: the last day of February, not 3 March
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.getTime();
}

/**
 * When a competition that was never archived ended: the end of the last date
 * in `dates`, else when it was created. Null without either.
 */
export function lastActivityMs(data) {
    const dates = String(data?.dates || data?.date || '').match(/\d{4}-\d{2}-\d{2}/g);
    if (dates?.length) {
        const end = Date.parse(`${dates[dates.length - 1]}T23:59:59Z`);
        if (Number.isFinite(end)) return end;
    }
    return toMillis(data?.createdAt);
}

/**
 * Whether the competition's private data is due for deletion at `nowMs`.
 * Archived: retentionMonths after archiving. Never archived (a competition
 * left active or as a draft): retentionMonths after its last date, else after
 * it was created. Idempotent: once purged (personalDataPurgedAt) it is not
 * selected again, unless it was reopened and archived anew after that.
 */
export function retentionDecision(data, nowMs) {
    if (!data || data.deleting === true) return { due: false, reason: 'missing-or-deleting' };
    const archived = isArchivedCompetitionData(data);
    const archivedAt = archived ? archivedAtMs(data) : lastActivityMs(data);
    if (!archivedAt) return { due: false, reason: archived ? 'no-archive-date' : 'no-date' };
    const months = normalizeRetentionMonths(data.retentionMonths);
    const dueAt = addMonthsMs(archivedAt, months);
    const purgedAt = toMillis(data.personalDataPurgedAt);
    if (purgedAt && purgedAt >= archivedAt) return { due: false, reason: 'already-purged', archivedAt, months, dueAt };
    if (nowMs < dueAt) return { due: false, reason: 'not-yet', archivedAt, months, dueAt };
    return { due: true, reason: archived ? 'expired' : 'expired-not-archived', archivedAt, months, dueAt };
}

/** The competitions ({ id, appId, data }) whose private data is to be deleted now */
export function selectCompetitionsForPurge(competitions = [], nowMs = Date.now()) {
    return competitions
        .map((competition) => ({ ...competition, decision: retentionDecision(competition.data, nowMs) }))
        .filter((competition) => competition.decision.due);
}

function getPath(data, path) {
    return path.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), data);
}

/** The personal field paths present in a log entry (to delete them) */
export function personalLogFieldsPresent(data = {}) {
    return PERSONAL_LOG_FIELDS.filter((path) => {
        const value = getPath(data, path);
        return value !== undefined && value !== null && value !== '';
    });
}

/**
 * The time of a counter document's last activity: its newest timestamp field
 * (windowStart, failures[]) or the document's update time.
 */
export function counterLastActivityMs(data = {}, updateTimeMs = null) {
    const candidates = [
        toMillis(updateTimeMs),
        toMillis(data.windowStart),
        toMillis(data.updatedAt),
        toMillis(data.lastFailureAt),
        ...(Array.isArray(data.failures) ? data.failures.map(toMillis) : [])
    ].filter(Boolean);
    return candidates.length ? Math.max(...candidates) : null;
}

export function isStaleCounter(data, updateTimeMs, nowMs, maxAgeMs = STALE_COUNTER_MAX_AGE_MS) {
    const last = counterLastActivityMs(data, updateTimeMs);
    // Without any time it cannot be in use (every write sets one)
    return last === null || nowMs - last > maxAgeMs;
}

// --- Account deletion ---

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

// Contact fields a driver's entry holds about the driver
export const DRIVER_EMAIL_FIELDS = ['email', 'contactEmail', 'driverEmail'];
export const DRIVER_CONTACT_FIELDS = [...DRIVER_EMAIL_FIELDS, 'phone', 'mobile', 'contactPhone', 'address', 'iceName', 'icePhone'];

/**
 * The contact fields to remove from an entry (equipagePrivate) when the
 * account with `email` is deleted. When the entry names no other person's
 * email the user is its only linked person and all contact fields go;
 * otherwise only the fields holding the user's own email.
 */
export function driverContactFieldsToRemove(data = {}, email) {
    const own = normalizeEmail(email);
    if (!own) return [];
    const emails = DRIVER_EMAIL_FIELDS.map((field) => normalizeEmail(data[field])).filter(Boolean);
    if (!emails.includes(own)) return [];
    const onlyLinked = emails.every((value) => value === own);
    const fields = onlyLinked
        ? DRIVER_CONTACT_FIELDS
        : DRIVER_EMAIL_FIELDS.filter((field) => normalizeEmail(data[field]) === own);
    return fields.filter((field) => data[field] !== undefined && data[field] !== null && data[field] !== '');
}

/**
 * What deleting the account removes. Blocked while the user owns a
 * competition (it must be transferred or deleted first). Results are never
 * touched; entries in competitions not archived yet keep their contact details
 * (the organiser still needs them for the event, and the retention deletes
 * them later).
 *
 * @param {object} input
 * @param {string} input.uid
 * @param {string} input.email
 * @param {Array<{path:string,name?:string}>} input.ownedCompetitions
 * @param {Array<{path:string}>} input.adminDocs        competitions/{id}/admins/{doc}
 * @param {Array<{path:string}>} input.roleEmailDocs    competitions/{id}/roleEmails/{doc}
 * @param {Array<{path:string,data:object}>} input.memberCompetitions  competition docs listing the uid
 * @param {Array<{path:string,data:object,archived:boolean}>} input.driverEntries  equipagePrivate docs
 */
export function buildAccountDeletionPlan({
    uid,
    email,
    ownedCompetitions = [],
    adminDocs = [],
    roleEmailDocs = [],
    memberCompetitions = [],
    driverEntries = []
} = {}) {
    if (!uid) throw new Error('uid saknas');
    if (ownedCompetitions.length) {
        return {
            blocked: true,
            ownedCompetitions: ownedCompetitions.map((c) => c.name || c.path.split('/').pop())
        };
    }
    const unique = (paths) => [...new Set(paths)];
    const deletePaths = unique([
        ...adminDocs.map((d) => d.path),
        ...roleEmailDocs.map((d) => d.path)
    ]);
    const arrayRemovals = memberCompetitions
        .map((c) => ({
            path: c.path,
            fields: ['admins', 'staffUids'].filter((field) => Array.isArray(c.data?.[field]) && c.data[field].includes(uid))
        }))
        .filter((c) => c.fields.length);
    const anonymize = [];
    const keptActiveEntries = [];
    driverEntries.forEach((entry) => {
        const fields = driverContactFieldsToRemove(entry.data, email);
        if (!fields.length) return;
        if (entry.archived) anonymize.push({ path: entry.path, fields });
        else keptActiveEntries.push(entry.path);
    });
    return {
        blocked: false,
        ownedCompetitions: [],
        deletePaths,
        arrayRemovals,
        anonymize,
        keptActiveEntries,
        userDocPath: `users/${uid}`
    };
}

// --- Access requests (Art. 15) ---

// Where a person's data is looked for in a competition: the collection, the
// email fields matched, and the documents with the same id that belong to the
// same person (public tree of the competition)
export const PERSON_SEARCH = [
    { collection: 'equipagePrivate', fields: ['email', 'contactEmail', 'driverEmail'], related: ['equipages', 'horseTemperatures', 'vetInspections', 'vetNotes'] },
    { collection: 'officialsPrivate', fields: ['email'], related: ['officials'] },
    { collection: 'judgesPrivate', fields: ['email'], related: ['judges'] },
    { collection: 'volunteerSignups', fields: ['email'], related: [] },
    { collection: 'admins', fields: ['email'], related: [] },
    { collection: 'roleEmails', fields: ['email'], related: [], byId: true }
];

/** Firestore values as plain JSON (Timestamps as ISO strings) */
export function toPlainValue(value) {
    if (value === null || value === undefined) return value ?? null;
    if (Array.isArray(value)) return value.map(toPlainValue);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') return value.toDate().toISOString();
        if (typeof value.path === 'string' && typeof value.firestore === 'object') return value.path;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlainValue(item)]));
    }
    return value;
}

/** Whether a document found by the search holds the email in one of the fields */
export function matchesPerson(data = {}, fields = [], email) {
    const own = normalizeEmail(email);
    return !!own && fields.some((field) => normalizeEmail(data?.[field]) === own);
}

/**
 * The export of one person's data across competitions.
 * `competitions`: [{ id, name, documents: [{ path, data }] }] (only matches
 * and their related documents); `user`: the users/{uid} doc if any.
 */
export function buildPersonExport({ email, competitions = [], user = null, exportedBy = null, now = Date.now() } = {}) {
    const found = competitions
        .filter((c) => (c.documents || []).length)
        .map((c) => ({
            competitionId: c.id,
            competitionName: c.name || '',
            documents: c.documents.map((d) => ({ path: d.path, data: toPlainValue(d.data) }))
        }));
    return {
        format: 'drivelive-person-export',
        formatVersion: 1,
        email: normalizeEmail(email),
        exportedAt: new Date(now).toISOString(),
        exportedBy,
        note: 'Uppgifter om personen i tävlingar som administratören hanterar. Publicerade resultat (namn, klubb, häst, placering) finns i tävlingarnas offentliga resultatlistor.',
        account: user ? toPlainValue(user) : null,
        competitionCount: found.length,
        documentCount: found.reduce((sum, c) => sum + c.documents.length, 0),
        competitions: found
    };
}
