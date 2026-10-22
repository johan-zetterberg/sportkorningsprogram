// The retention run (purgeExpiredPersonalData) with the database passed in,
// so the emulator test (tests/retention.emulator.mjs) runs the same code.
import {
    RETENTION_ANONYMIZED_LOGS,
    RETENTION_PRIVATE_TREE_COLLECTIONS,
    RETENTION_PUBLIC_TREE_COLLECTIONS,
    anonymizePauseLog,
    isStaleCounter,
    personalLogFieldsPresent,
    selectCompetitionsForPurge
} from './personalData.js';
import { purgeStaleTokens, removeCompetitionFromTokens } from './push/pushService.js';

export const PERSONAL_DATA_APP_IDS = ['combined-driving', 'drivelive'];
export const COMPETITION_LIST_FIELDS = ['name', 'createdBy', 'ownerId', 'admins', 'staffUids', 'locked', 'status',
    'finalizedAt', 'archiveSnapshotId', 'dates', 'date', 'createdAt', 'retentionMonths', 'deleting'];

// Every competition document of the app ids (only the fields named)
export async function listAllCompetitions(db, { appIds = PERSONAL_DATA_APP_IDS, fields = COMPETITION_LIST_FIELDS } = {}) {
    const lists = await Promise.all(appIds.map(async (appId) => {
        const snap = await db.collection(`artifacts/${appId}/public/data/competitions`).select(...fields).get();
        return snap.docs.map((d) => ({ id: d.id, appId, ref: d.ref, data: d.data() }));
    }));
    return lists.flat();
}

async function deleteDocuments(db, refs) {
    if (!refs.length) return 0;
    const writer = db.bulkWriter();
    refs.forEach((ref) => writer.delete(ref));
    await writer.close();
    return refs.length;
}

async function purgeCompetitionPersonalData(db, FieldValue, competition) {
    const { appId, id } = competition;
    const counts = {};
    const collections = [
        ...RETENTION_PUBLIC_TREE_COLLECTIONS.map((name) => [name, competition.ref.collection(name)]),
        ...RETENTION_PRIVATE_TREE_COLLECTIONS.map((name) => [name, db.collection(`artifacts/${appId}/private/data/competitions/${id}/${name}`)])
    ];
    for (const [name, collectionRef] of collections) {
        const count = (await collectionRef.count().get()).data().count;
        // Subcollections too; running it again is harmless
        if (count) await db.recursiveDelete(collectionRef);
        counts[name] = count;
    }
    // Logs are kept without names and email addresses
    const logCollection = {
        private: (name) => db.collection(`artifacts/${appId}/private/data/competitions/${id}/${name}`),
        public: (name) => competition.ref.collection(name),
        root: (name) => db.collection(`competitions/${id}/${name}`)
    };
    for (const { tree, name } of RETENTION_ANONYMIZED_LOGS) {
        const snap = await logCollection[tree](name).get();
        const writer = db.bulkWriter();
        let anonymized = 0;
        snap.docs.forEach((d) => {
            const fields = personalLogFieldsPresent(d.data());
            if (!fields.length) return;
            anonymized++;
            writer.update(d.ref, Object.fromEntries(fields.map((field) => [field, FieldValue.delete()])));
        });
        await writer.close();
        counts[`${name}Anonymized`] = anonymized;
    }
    // The public pause log is kept (the results use its times) without who
    // pressed: the names go, in a transaction
    const statusRef = competition.ref.collection('config').doc('globalStatus');
    counts.pauseLogAnonymized = await db.runTransaction(async (tx) => {
        const snap = await tx.get(statusRef);
        if (!snap.exists) return 0;
        const { log, changed } = anonymizePauseLog(snap.data()?.pauseLog);
        if (!changed) return 0;
        tx.update(statusRef, { pauseLog: log });
        return 1;
    });
    // Devices no longer follow the competition (push)
    counts.pushTokensUnlinked = await removeCompetitionFromTokens(db, FieldValue, appId, id);
    return counts;
}

/**
 * Deletes private competition data (contact details, ICE, health and vet data,
 * volunteer sign-ups, refused writes, rate limits) `retentionMonths` (admin
 * setting, default 12) after the competition was archived (never archived:
 * after its last date, else its creation), and PIN attempt
 * and rate limit counters without a write in 30 days everywhere. Results and
 * the archive stay. Idempotent: purged competitions are recorded in
 * personalDataRetention; each run is summarised in retentionRuns.
 */
export async function runPersonalDataRetention({ db, FieldValue, logger = console, nowMs = Date.now(), appIds } = {}) {
    const startedAt = Date.now();
    const [competitions, stateSnap] = await Promise.all([
        listAllCompetitions(db, appIds ? { appIds } : {}),
        db.collection('personalDataRetention').get()
    ]);
    const purgedAtByKey = new Map(stateSnap.docs.map((d) => [d.id, d.data()?.purgedAt || null]));
    const due = selectCompetitionsForPurge(competitions.map((c) => ({
        ...c,
        data: { ...c.data, personalDataPurgedAt: purgedAtByKey.get(`${c.appId}__${c.id}`) || null }
    })), nowMs);

    const purged = [];
    const errors = [];
    for (const competition of due) {
        try {
            const counts = await purgeCompetitionPersonalData(db, FieldValue, competition);
            const entry = {
                competitionId: competition.id,
                appId: competition.appId,
                name: competition.data?.name || '',
                archivedAt: competition.decision.archivedAt,
                retentionMonths: competition.decision.months,
                counts
            };
            await db.collection('personalDataRetention').doc(`${competition.appId}__${competition.id}`)
                .set({ ...entry, purgedAt: nowMs }, { merge: true });
            purged.push(entry);
        } catch (error) {
            logger.error('Gallring av personuppgifter misslyckades för tävlingen', { competitionId: competition.id, error: String(error?.message || error) });
            errors.push({ competitionId: competition.id, error: String(error?.message || error).slice(0, 300) });
        }
    }

    // Counters without a recent write: PIN attempts (top level) and rate
    // limits; and e-mail retry entries nobody acted on (mailRetry, no
    // personal data, only the path of the mail)
    const [attemptsSnap, rateLimitsSnap, mailRetrySnap] = await Promise.all([
        db.collection('pinJoinAttempts').get(),
        db.collectionGroup('rateLimits').get(),
        db.collection('mailRetry').get()
    ]);
    const stale = (snap) => snap.docs
        .filter((d) => isStaleCounter(d.data(), d.updateTime?.toMillis?.() ?? null, nowMs))
        .map((d) => d.ref);
    const pinAttemptsDeleted = await deleteDocuments(db, stale(attemptsSnap));
    const rateLimitsDeleted = await deleteDocuments(db, stale(rateLimitsSnap));
    const mailRetryDeleted = await deleteDocuments(db, stale(mailRetrySnap));
    // Push devices the app has not refreshed in 60 days
    const pushTokensDeleted = await purgeStaleTokens(db, { nowMs });

    const summary = {
        startedAt,
        finishedAt: Date.now(),
        competitionsChecked: competitions.length,
        competitionsPurged: purged,
        pinAttemptsDeleted,
        rateLimitsDeleted,
        mailRetryDeleted,
        pushTokensDeleted,
        errors
    };
    await db.collection('retentionRuns').add(summary);
    logger.info('Gallring av personuppgifter klar', {
        competitionsPurged: purged.map((p) => p.competitionId),
        pinAttemptsDeleted,
        rateLimitsDeleted,
        errors: errors.length
    });
    return summary;
}
