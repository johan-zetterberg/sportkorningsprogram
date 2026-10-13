/**
 * Cloud Functions for Combined Driving
 * Defines triggers to recalculate results on data changes.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { buildDeclarationUpdate } from "./src/declarationUtils.js";
import { declarationLockReason } from "./src/declarationLock.js";
import { isDocumentForDriver, isMessageForDriver, toPlainTimestamps } from "./src/driverInbox.js";
import {
    equipageWriteAffectsResults,
    marathonWriteAffectsResults,
    precisionWriteAffectsResults,
    storedResultUnchanged
} from "./src/triggerFilters.js";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import { nextCounter, VOLUNTEER_SIGNUP_LIMITS } from "./src/rateLimit.js";
import {
    buildCompetitionDeletionPlan,
    canResumeCompetitionDeletion,
    isGlobalAdminIdentity
} from "./src/competitionDeletion.js";

import { calculateTotalResult } from "./src/core-engine/calculation.js";
import { RESULT_ENGINE_VERSION } from "./src/core-engine/version.js";
import { dressagePrograms } from "./src/data/dressagePrograms.js";
import {
    buildRecalculationValidation,
    buildServerCompetitionState,
    configChangeAffectsResults,
    resultSettingsFingerprint,
    ruleSettingsChanged
} from "./src/resultRecalculationUtils.js";
import {
    buildCompetitionAdminJoinPayload,
    checkPinAttempts,
    isValidCompetitionId,
    PIN_ATTEMPT_LIMITS,
    recordPinFailure,
    resolveJoinRoleForPin,
} from "./src/adminJoin.js";

setGlobalOptions({ region: 'europe-west1' });

initializeApp();
const db = getFirestore();
const adminAuth = getAuth();
const OWNER_RECOVERY_EMAIL = 'johan.zetterberg@gmail.com';
const VOLUNTEER_DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_SIGNUP_TEXT_LENGTH = 500;

async function getCompetitionArtifactsDoc(competitionId) {
    const appIdsToTry = ['combined-driving', 'drivelive'];
    for (const candidateAppId of appIdsToTry) {
        const ref = db.doc(`artifacts/${candidateAppId}/public/data/competitions/${competitionId}`);
        const snap = await ref.get();
        if (snap.exists) {
            return { appId: candidateAppId, ref, data: snap.data() };
        }
    }
    return null;
}

function normalizeSignupText(value, maxLength = 160) {
    return String(value || '')
        .replace(/[<>"'`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizeSignupEmail(value) {
    return normalizeSignupText(value, 200).toLowerCase();
}

function isValidEmail(value) {
    return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(String(value || ''));
}

function buildVolunteerSignupPayload(raw = {}) {
    const payload = {
        name: normalizeSignupText(raw.name, 120),
        phone: normalizeSignupText(raw.phone, 40),
        email: normalizeSignupEmail(raw.email),
        club: normalizeSignupText(raw.club, 120),
        shirtSize: normalizeSignupText(raw.shirtSize, 10),
        diet: normalizeSignupText(raw.diet, 200),
        iceName: normalizeSignupText(raw.iceName, 120),
        icePhone: normalizeSignupText(raw.icePhone, 40),
        role: normalizeSignupText(raw.role, 80),
        notes: normalizeSignupText(raw.notes, MAX_SIGNUP_TEXT_LENGTH),
        createdAt: Date.now()
    };

    if (!payload.name || !payload.phone || !payload.email || !payload.iceName || !payload.icePhone) {
        throw new HttpsError('invalid-argument', 'Obligatoriska fält saknas.');
    }

    if (!isValidEmail(payload.email)) {
        throw new HttpsError('invalid-argument', 'Ogiltig e-postadress.');
    }

    return payload;
}

// Load every configurable dependency used by the shared result engine.
// These are the same inputs the browser feeds to buildCompetitionState.
// `read` lets a transaction do the reads (see writeIfSettingsUnchanged).
async function getContext(compRef, read = (ref) => ref.get()) {
    const configRef = (id) => compRef.collection('config').doc(id);
    const [compSnap, marCfgSn, precCfgSn, programsSnap, mappingSnap, judgeMappingSnap, statusSnap] = await Promise.all([
        read(compRef),
        read(configRef('maratonConfig')),
        read(configRef('precisionConfig')),
        read(configRef('dressagePrograms')),
        read(configRef('dressyrProgramMapping')),
        read(configRef('dressageJudgeMapping')),
        read(configRef('globalStatus'))
    ]);
    const data = (snap) => (snap.exists ? snap.data() : null);
    const pauseLog = statusSnap.exists ? statusSnap.data()?.pauseLog : null;

    return {
        // Deleted or being deleted (deleteCompetitionData): nothing is written
        competitionGone: !compSnap.exists || compSnap.data()?.deleting === true,
        // Archived: stored results stay as archived (an admin reopens first)
        archived: compSnap.exists && (compSnap.data()?.locked === true || compSnap.data()?.status === 'completed'),
        settingsFingerprint: resultSettingsFingerprint({
            competition: data(compSnap),
            globalStatus: data(statusSnap),
            configs: {
                maratonConfig: data(marCfgSn),
                precisionConfig: data(precCfgSn),
                dressagePrograms: data(programsSnap),
                dressyrProgramMapping: data(mappingSnap),
                dressageJudgeMapping: data(judgeMappingSnap)
            }
        }),
        allPrograms: {
            ...dressagePrograms,
            ...(programsSnap.exists ? programsSnap.data() : {})
        },
        dressageProgramMapping: mappingSnap.exists ? mappingSnap.data() : {},
        dressageJudgeMapping: judgeMappingSnap.exists ? judgeMappingSnap.data() : {},
        judges: [],
        marathonConfig: marCfgSn.exists ? marCfgSn.data() : {},
        precisionConfig: precCfgSn.exists ? precCfgSn.data() : {},
        ruleSettings: compSnap.exists ? (compSnap.data()?.ruleSettings || null) : null,
        pauseWindows: Array.isArray(pauseLog) ? pauseLog : []
        // nowMs is deliberately omitted: running stages are not ticked on the server
    };
}

// Flat fields stored in computed_equipages (sub-results hold live and
// nested data that is not meant to be persisted)
function toStoredResult(result) {
    return {
        totalPenalty: result.totalPenalty,
        isEliminated: result.isEliminated,
        elimReason: result.elimReason,
        isOngoing: result.isOngoing,
        dressagePenalty: result.dressagePenalty ?? null,
        marathonPenalty: result.marathonPenalty ?? null,
        precisionPenalty: result.precisionPenalty ?? null
    };
}

async function calculateEquipageRecord(compRef, startNumber, context, equipageSnapshot = null) {
    const eqKey = String(startNumber);
    const eqDocRef = compRef.collection('equipages').doc(eqKey);
    const dressColRef = compRef.collection('dressage').doc(eqKey).collection('protocols');
    const marDocRef = compRef.collection('maraton').doc(eqKey);
    const timingDocRef = compRef.collection('maraton-timing').doc(eqKey);
    const precDocRef = compRef.collection('precision').doc(eqKey);

    const [eqSnap, dressSnap, marSnap, timingSnap, precSnap] = await Promise.all([
        equipageSnapshot ? Promise.resolve(equipageSnapshot) : eqDocRef.get(),
        dressColRef.get(),
        marDocRef.get(),
        timingDocRef.get(),
        precDocRef.get()
    ]);

    if (!eqSnap.exists) {
        return null;
    }

    const equipage = { ...eqSnap.data() };

    // The 'general' doc (error points) stays in the list; the engine reads it.
    const dressProtocols = dressSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const state = buildServerCompetitionState({
        equipage,
        dressageProtocols: dressProtocols,
        marathonDoc: marSnap.exists ? marSnap.data() : {},
        timingDoc: timingSnap.exists ? timingSnap.data() : {},
        precisionDoc: precSnap.exists ? precSnap.data() : {}
    }, context);
    const result = calculateTotalResult(state);

    return {
        startNumber: eqKey,
        equipage,
        dressageProtocols: dressProtocols,
        result
    };
}

async function recalculateEquipage(appId, competitionId, startNumber) {
    const compRef = db.doc(`artifacts/${appId}/public/data/competitions/${competitionId}`);
    const context = await getContext(compRef);
    if (context.competitionGone || context.archived) return;
    const record = await calculateEquipageRecord(compRef, startNumber, context);
    if (!record) return;

    const recalculatedAt = new Date().toISOString();
    await writeIfSettingsUnchanged(compRef, context.settingsFingerprint, [record], {
        engineVersion: RESULT_ENGINE_VERSION,
        recalculatedAt,
        triggerType: 'automatic'
    }, { skipUnchanged: true });
}

const beforeData = (event) => (event.data?.before?.exists ? event.data.before.data() : null);
const afterData = (event) => (event.data?.after?.exists ? event.data.after.data() : null);

function storedResultDoc(record, audit) {
    return {
        ...toStoredResult(record.result),
        updatedAt: audit.recalculatedAt,
        calculatedBy: 'server-function',
        calculationAudit: audit
    };
}

// Each written field is replaced as a whole (a nested merge would keep old
// keys inside calculationAudit); fields not written are left alone
function storedResultWriteOptions(doc) {
    return { mergeFields: Object.keys(doc) };
}

// Most writes a transaction may hold, leaving room for the settings reads
const MAX_TRANSACTION_WRITES = 450;

/**
 * Writes the results only if the settings they were calculated with are still
 * current. The settings are re-read in the same transaction as the writes, so
 * a settings change cannot slip in between. When they changed, nothing is
 * written: the change triggered a full recalculation with the newer settings,
 * and an older run finishing last must not overwrite it. Returns whether the
 * results were written.
 */
async function writeIfSettingsUnchanged(compRef, settingsFingerprint, records, audit, { skipUnchanged = false } = {}) {
    const target = (record) => compRef.collection('computed_equipages').doc(record.startNumber);

    if (records.length <= MAX_TRANSACTION_WRITES) {
        const written = await db.runTransaction(async (tx) => {
            const current = await getContext(compRef, (ref) => tx.get(ref));
            if (current.competitionGone) return false;
            if (current.settingsFingerprint !== settingsFingerprint) return false;
            // Automatic runs leave an equal stored result alone: rewriting it
            // would only change updatedAt and wake every listener
            const existing = skipUnchanged
                ? await Promise.all(records.map((record) => tx.get(target(record))))
                : [];
            records.forEach((record, index) => {
                const doc = storedResultDoc(record, audit);
                const stored = existing[index]?.exists ? existing[index].data() : null;
                if (skipUnchanged && storedResultUnchanged(stored, doc, audit.engineVersion)) return;
                tx.set(target(record), doc, storedResultWriteOptions(doc));
            });
            return true;
        });
        if (!written) logger.info('Inställningarna ändrades under beräkningen; en nyare omräkning skriver resultaten.', { competition: compRef.id, triggerType: audit.triggerType });
        return written;
    }

    // Larger competitions: check, then write in batches (a small window remains)
    const current = await getContext(compRef);
    if (current.competitionGone) return false;
    if (current.settingsFingerprint !== settingsFingerprint) {
        logger.info('Inställningarna ändrades under beräkningen; en nyare omräkning skriver resultaten.', { competition: compRef.id, triggerType: audit.triggerType });
        return false;
    }
    for (let offset = 0; offset < records.length; offset += 400) {
        const batch = db.batch();
        records.slice(offset, offset + 400).forEach((record) => {
            const doc = storedResultDoc(record, audit);
            batch.set(target(record), doc, storedResultWriteOptions(doc));
        });
        await batch.commit();
    }
    return true;
}

// Every equipage of the competition, after a change to settings all results depend on
async function recalculateWholeCompetition(appId, competitionId, triggerType) {
    const compRef = db.doc(`artifacts/${appId}/public/data/competitions/${competitionId}`);
    // An archived competition keeps the results it was archived with; a settings
    // write (or a newer engine) must not change them. A manual recalculation by
    // an admin still can.
    const compSnap = await compRef.get();
    const comp = compSnap.exists ? compSnap.data() : null;
    if (!comp || comp.deleting === true) return;
    if (comp?.locked === true || comp?.status === 'completed') {
        logger.info('Arkiverad tävling: automatisk omräkning hoppas över.', { competition: competitionId, triggerType });
        return;
    }
    const context = await getContext(compRef);
    const equipagesSnapshot = await compRef.collection('equipages').get();
    const records = [];
    // A few equipages at a time: in series a large competition takes seconds
    const docs = equipagesSnapshot.docs;
    for (let offset = 0; offset < docs.length; offset += 10) {
        const chunk = await Promise.all(docs.slice(offset, offset + 10).map(async (equipageSnapshot) => {
            try {
                return await calculateEquipageRecord(compRef, equipageSnapshot.id, context, equipageSnapshot);
            } catch (error) {
                // One broken equipage must not keep the others stale
                logger.error(`Omräkning av #${equipageSnapshot.id} misslyckades`, { competitionId, error: String(error?.message || error) });
                return null;
            }
        }));
        chunk.forEach((record) => { if (record) records.push(record); });
    }
    await writeIfSettingsUnchanged(compRef, context.settingsFingerprint, records, {
        engineVersion: RESULT_ENGINE_VERSION,
        recalculatedAt: new Date().toISOString(),
        triggerType
    });
}

// --- TRIGGERS ---

// 0. Settings that every result depends on (marathon/precision config, dressage
// programs and mappings, the pause log, rule settings)
export const onResultConfigWrite = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}/config/{configId}", timeoutSeconds: 540, memory: '512MiB' },
    async (event) => {
        const { appId, compId, configId } = event.params;
        const before = event.data?.before?.exists ? event.data.before.data() : null;
        const after = event.data?.after?.exists ? event.data.after.data() : null;
        if (!configChangeAffectsResults(configId, before, after)) return;
        await recalculateWholeCompetition(appId, compId, `config-change:${configId}`);
    }
);

export const onCompetitionRuleSettingsWrite = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}", timeoutSeconds: 540, memory: '512MiB' },
    async (event) => {
        const { appId, compId } = event.params;
        const before = event.data?.before?.exists ? event.data.before.data() : null;
        const after = event.data?.after?.exists ? event.data.after.data() : null;
        if (!after || !ruleSettingsChanged(before, after)) return;
        await recalculateWholeCompetition(appId, compId, 'config-change:ruleSettings');
    }
);

// 1. Dressage Changes
export const onDressageProtocolWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/dressage/{startNo}/protocols/{protoId}",
    async (event) => {
        const { appId, compId, startNo } = event.params;
        await recalculateEquipage(appId, compId, startNo);
    }
);

// 2. Marathon Changes
export const onMarathonResultWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/maraton/{startNo}",
    async (event) => {
        const { appId, compId, startNo } = event.params;
        // The obstacle input writes its live form state here on every change
        if (!marathonWriteAffectsResults(beforeData(event), afterData(event))) return;
        await recalculateEquipage(appId, compId, startNo);
    }
);
// FIX: Add missing trigger for timing
export const onMarathonTimingWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/maraton-timing/{startNo}",
    async (event) => {
        const { appId, compId, startNo } = event.params;
        await recalculateEquipage(appId, compId, startNo);
    }
);

// 3. Precision Changes
export const onPrecisionResultWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/precision/{startNo}",
    async (event) => {
        const { appId, compId, startNo } = event.params;
        if (!precisionWriteAffectsResults(beforeData(event), afterData(event))) return;
        await recalculateEquipage(appId, compId, startNo);
    }
);

// 4. Equipage Static Data Changes
export const onEquipageUpdate = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/equipages/{startNo}",
    async (event) => {
        const { appId, compId, startNo } = event.params;
        // Speaker notes, temperatures and the like do not change the result
        if (!equipageWriteAffectsResults(beforeData(event), afterData(event))) return;
        await recalculateEquipage(appId, compId, startNo);
    }
);

// Deletes a competition completely: its public and private Firestore data, the
// finalization locks under /competitions/{id} and its Storage files. The
// client could not do this fully (no Storage, no listing of documents without
// parents, permissions removed half-way)
export const deleteCompetitionData = onCall({ timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
    const competitionId = String(request.data?.competitionId || '').trim();
    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltigt Competition ID.');
    }
    // A record of the deletion outside the deleted data (no client access)
    const tombstoneRef = db.collection('deletedCompetitions').doc(competitionId);
    const [competition, tombstoneSnap] = await Promise.all([
        getCompetitionArtifactsDoc(competitionId),
        tombstoneRef.get()
    ]);
    const tombstone = tombstoneSnap.exists ? tombstoneSnap.data() : null;
    const plan = buildCompetitionDeletionPlan(competitionId, competition, tombstone);
    if (!plan) {
        throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
    }

    if (competition) {
        // Irreversible: only the owner or a global admin (the same as the rules
        // allowed for the competition document), not an admin who joined by PIN
        await assertCanDeleteCompetition(request, competition);
    } else {
        if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
        const userSnap = await db.doc(`users/${request.auth.uid}`).get();
        const user = userSnap.exists ? userSnap.data() : {};
        if (!canResumeCompetitionDeletion(request.auth.uid, request.auth.token || {}, user, tombstone || {})) {
            throw new HttpsError('permission-denied', 'Endast den ursprungliga raderaren eller en global administratör får återuppta raderingen.');
        }
        if (plan.alreadyDone) {
            return { deleted: true, storageFilesDeleted: tombstone?.storageFilesDeleted !== false };
        }
    }

    const now = Date.now();
    await tombstoneRef.set({
        competitionId,
        appId: plan.appId,
        name: plan.competitionData?.name || tombstone?.name || null,
        dates: plan.competitionData?.dates || tombstone?.dates || null,
        deletedBy: tombstone?.deletedBy || request.auth.uid,
        deletedByEmail: tombstone?.deletedByEmail || String(request.auth.token?.email || '').toLowerCase() || null,
        startedAt: tombstone?.startedAt || now,
        lastAttemptAt: now,
        lastAttemptBy: request.auth.uid,
        status: 'running'
    }, { merge: true });

    // Recalculation triggers fire for every deleted document; this mark makes
    // them stop, so they cannot write results back while the data goes
    const publicRef = db.doc(plan.publicPath);
    if (plan.hasCompetitionDocument) {
        await publicRef.set({ deleting: true, deletingBy: request.auth.uid, deletingAt: now }, { merge: true });
    }

    const appId = plan.appId;
    let storageFilesDeleted = true;
    let storageError = null;
    try {
        await db.recursiveDelete(db.doc(`artifacts/${appId}/private/data/competitions/${competitionId}`));
        await db.recursiveDelete(db.doc(`competitions/${competitionId}`));
        try {
            await getStorage().bucket().deleteFiles({ prefix: `competitions/${competitionId}/` });
        } catch (error) {
            storageFilesDeleted = false;
            storageError = error;
            logger.error('Kunde inte radera tävlingens filer i Storage', { competitionId, error: String(error?.message || error) });
        }
        // Last: the public tree with the competition document itself
        await db.recursiveDelete(publicRef);
        if (storageError) throw storageError;
    } catch (error) {
        // Half deleted: the record says so, and running it again finishes it
        logger.error('Radering av tävling avbröts', { competitionId, error: String(error?.message || error) });
        await tombstoneRef.set({ status: 'failed', failedAt: Date.now(), error: String(error?.message || error) }, { merge: true });
        throw new HttpsError('internal', 'Raderingen avbröts. Försök igen; det som redan raderats raderas inte två gånger.');
    }

    await tombstoneRef.set({ status: 'done', finishedAt: Date.now(), storageFilesDeleted }, { merge: true });
    logger.info('Tävling raderad', { competitionId, appId, by: request.auth.uid, storageFilesDeleted });
    return { deleted: true, storageFilesDeleted };
});

// Owner (createdBy/ownerId) or a global admin; a competition admin role
// (joined with the admin PIN) is not enough to delete a competition
async function assertCanDeleteCompetition(request, competition) {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    }
    const uid = request.auth.uid;
    const data = competition.data || {};
    const isOwner = data.createdBy === uid || data.ownerId === uid;
    if (isGlobalAdminIdentity(request.auth.token || {}) || isOwner) return;
    const userSnap = await db.doc(`users/${uid}`).get();
    const user = userSnap.exists ? userSnap.data() : {};
    if (!isGlobalAdminIdentity({}, user)) {
        throw new HttpsError('permission-denied', 'Endast tävlingens ägare eller en global administratör får radera tävlingen.');
    }
}

// The caller's network address. Google's front end appends the address it
// saw as the last X-Forwarded-For entry; the first entries can be set by the
// caller, so they are not used.
function callerAddress(request) {
    const forwarded = String(request.rawRequest?.headers?.['x-forwarded-for'] || '')
        .split(',').map((part) => part.trim()).filter(Boolean);
    return forwarded.length ? forwarded[forwarded.length - 1] : String(request.rawRequest?.ip || 'unknown');
}

async function assertCanMaintainResults(request, competition, deniedMessage = 'Endast tävlingsägare eller full administratör får räkna om resultat.') {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    }

    const uid = request.auth.uid;
    const competitionData = competition.data || {};
    const tokenRoles = Array.isArray(request.auth.token?.roles) ? request.auth.token.roles : [];
    const tokenIsAdmin = request.auth.token?.superadmin === true
        || request.auth.token?.role === 'superadmin'
        || request.auth.token?.role === 'admin'
        || tokenRoles.includes('superadmin')
        || tokenRoles.includes('admin');
    const isOwner = competitionData.createdBy === uid || competitionData.ownerId === uid;
    const listedAdmin = Array.isArray(competitionData.admins) && competitionData.admins.includes(uid);
    const [adminSnap, userSnap] = await Promise.all([
        competition.ref.collection('admins').doc(uid).get(),
        db.doc(`users/${uid}`).get()
    ]);
    const adminData = adminSnap.exists ? adminSnap.data() : {};
    const adminRoles = Array.isArray(adminData.roles) ? adminData.roles : [];
    const isCompetitionAdmin = adminData.role === 'admin' || adminRoles.includes('admin');
    const userData = userSnap.exists ? userSnap.data() : {};
    const userRoles = Array.isArray(userData.roles) ? userData.roles : [];
    const isGlobalAdmin = userData.role === 'admin'
        || userData.role === 'superadmin'
        || userRoles.includes('admin')
        || userRoles.includes('superadmin');

    if (!tokenIsAdmin && !isOwner && !listedAdmin && !isCompetitionAdmin && !isGlobalAdmin) {
        throw new HttpsError('permission-denied', deniedMessage);
    }
}

async function buildCompetitionRecalculationPreview(competition) {
    const context = await getContext(competition.ref);
    const equipagesSnapshot = await competition.ref.collection('equipages').get();
    const records = await Promise.all(equipagesSnapshot.docs.map(async (equipageSnapshot) => {
        try {
            return await calculateEquipageRecord(
                competition.ref,
                equipageSnapshot.id,
                context,
                equipageSnapshot
            );
        } catch (error) {
            return {
                startNumber: equipageSnapshot.id,
                equipage: equipageSnapshot.data(),
                dressageProtocols: [],
                calculationError: String(error?.message || error)
            };
        }
    }));
    const availableRecords = records.filter(Boolean);
    const validation = buildRecalculationValidation(availableRecords, context);

    if (availableRecords.length === 0) {
        validation.criticalErrors.push({ startNumber: '', message: 'Tävlingen saknar ekipage.' });
        validation.recalculableCount = 0;
    }

    return { context, records: availableRecords, validation };
}

function getRecalculationRequestData(request) {
    const competitionId = String(request.data?.competitionId || '').trim();
    if (!competitionId) {
        throw new HttpsError('invalid-argument', 'Competition ID saknas.');
    }
    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltigt Competition ID.');
    }
    return { competitionId };
}

export const validateCompetitionResultRecalculation = onCall(
    { timeoutSeconds: 540, memory: '512MiB' },
    async (request) => {
        const { competitionId } = getRecalculationRequestData(request);
        const competition = await getCompetitionArtifactsDoc(competitionId);
        if (!competition) {
            throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
        }

        await assertCanMaintainResults(request, competition);
        const { validation } = await buildCompetitionRecalculationPreview(competition);
        return {
            ...validation,
            archived: isArchivedCompetition(competition.data),
            engineVersion: RESULT_ENGINE_VERSION
        };
    }
);

// Finalized (archived) competitions keep the results they were archived with
function isArchivedCompetition(data) {
    return data?.locked === true || data?.status === 'completed';
}

export const recalculateCompetitionResults = onCall(
    { timeoutSeconds: 540, memory: '512MiB' },
    async (request) => {
        const { competitionId } = getRecalculationRequestData(request);
        const competition = await getCompetitionArtifactsDoc(competitionId);
        if (!competition) {
            throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
        }

        await assertCanMaintainResults(request, competition);
        const { context, records, validation } = await buildCompetitionRecalculationPreview(competition);
        if (validation.criticalErrors.length > 0) {
            throw new HttpsError('failed-precondition', 'Omräkningen blockeras av kritiska valideringsfel.', validation);
        }
        if (validation.warnings.length > 0 && request.data?.confirmedWarnings !== true) {
            throw new HttpsError('failed-precondition', 'Varningarna måste bekräftas före omräkning.', validation);
        }
        // Recalculating an archived competition changes its published results
        // (they no longer match the archived PDF): only when confirmed
        if (isArchivedCompetition(competition.data) && request.data?.confirmedArchived !== true) {
            throw new HttpsError('failed-precondition', 'Tävlingen är arkiverad. Bekräfta att de arkiverade resultaten ska räknas om.', { ...validation, archived: true });
        }

        const recalculatedAt = new Date().toISOString();
        // Stored results are public: they carry only the uid. The email goes to
        // the run log, which is not publicly readable.
        const audit = {
            engineVersion: RESULT_ENGINE_VERSION,
            recalculatedAt,
            initiatedBy: { uid: request.auth.uid },
            triggerType: 'manual-full-competition'
        };

        const written = await writeIfSettingsUnchanged(competition.ref, context.settingsFingerprint, records, audit);
        if (!written) {
            throw new HttpsError('aborted', 'Inställningarna ändrades under omräkningen. Resultaten räknas om automatiskt med de nya inställningarna; kör kontrollen igen om en stund.');
        }

        await competition.ref.collection('maintenanceRuns').add({
            type: 'result-recalculation',
            competitionId,
            equipageCount: records.length,
            warningCount: validation.warnings.length,
            ...audit,
            initiatedBy: {
                uid: request.auth.uid,
                email: String(request.auth.token?.email || '').trim().toLowerCase() || null
            }
        });

        return {
            recalculatedCount: records.length,
            warningCount: validation.warnings.length,
            engineVersion: RESULT_ENGINE_VERSION,
            recalculatedAt
        };
    }
);

export const joinCompetitionAsOfficial = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning kravs.');
    }

    const competitionId = String(request.data?.competitionId || '').trim();
    const pinCode = String(request.data?.pinCode || '').trim();
    const userEmail = String(request.auth.token?.email || '').trim().toLowerCase();

    if (!competitionId) {
        throw new HttpsError('invalid-argument', 'Competition ID saknas.');
    }
    if (!pinCode) {
        throw new HttpsError('invalid-argument', 'PIN-kod saknas.');
    }
    if (!userEmail) {
        throw new HttpsError('failed-precondition', 'Anvandaren maste ha en e-postadress.');
    }

    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltigt Competition ID.');
    }

    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) {
        throw new HttpsError('not-found', 'Tavlingen kunde inte hittas.');
    }

    const secretsSnap = await competition.ref.collection('config').doc('secrets').get();
    const secrets = secretsSnap.exists ? secretsSnap.data() : {};

    // Limit wrong PINs per user and per competition. The counters live outside
    // the public tree and have no client rules, so only this function sees them.
    // Check and count in one transaction so parallel guesses cannot slip past.
    const userAttemptsRef = db.doc(`pinJoinAttempts/${competitionId}__${request.auth.uid}`);
    const competitionAttemptsRef = db.doc(`pinJoinAttempts/${competitionId}`);
    const now = Date.now();
    const attempt = await db.runTransaction(async (tx) => {
        const [userSnap, competitionSnap] = await Promise.all([tx.get(userAttemptsRef), tx.get(competitionAttemptsRef)]);
        const userState = userSnap.exists ? userSnap.data() : null;
        const competitionState = competitionSnap.exists ? competitionSnap.data() : null;
        const emailVerified = request.auth.token?.email_verified === true;
        const check = checkPinAttempts(userState, competitionState, now, PIN_ATTEMPT_LIMITS, { emailVerified });
        if (!check.allowed) return { locked: true, retryAfterMs: check.retryAfterMs, emailVerified };

        const role = resolveJoinRoleForPin(pinCode, secrets);
        if (!role) {
            tx.set(userAttemptsRef, recordPinFailure(userState, PIN_ATTEMPT_LIMITS.perUser.windowMs, now));
            tx.set(competitionAttemptsRef, recordPinFailure(competitionState, PIN_ATTEMPT_LIMITS.perCompetition.windowMs, now));
        }
        return { role };
    });
    if (attempt.locked) {
        const minutes = Math.max(1, Math.ceil(attempt.retryAfterMs / 60000));
        throw new HttpsError('resource-exhausted', attempt.emailVerified
            ? `För många felaktiga PIN-försök. Försök igen om ${minutes} min.`
            : `För många felaktiga PIN-försök i tävlingen. Bekräfta din e-postadress för att fortsätta direkt, eller försök igen om ${minutes} min.`);
    }
    const matchedRole = attempt.role;
    if (!matchedRole) {
        throw new HttpsError('permission-denied', 'Fel PIN-kod.');
    }

    const adminRef = competition.ref.collection('admins').doc(request.auth.uid);
    const adminSnap = await adminRef.get();
    const existingData = adminSnap.exists ? adminSnap.data() : {};
    const payload = buildCompetitionAdminJoinPayload(existingData, matchedRole, userEmail, Date.now());

    await adminRef.set(payload, { merge: true });

    return {
        role: matchedRole,
        roles: payload.roles
    };
});

export const ensureOwnerSuperadminAccess = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning kravs.');
    }

    const authEmail = String(request.auth.token?.email || '').trim().toLowerCase();
    if (!authEmail) {
        throw new HttpsError('failed-precondition', 'Anvandaren maste ha en e-postadress.');
    }

    if (authEmail !== OWNER_RECOVERY_EMAIL) {
        return {
            elevated: false,
            reason: 'not-owner'
        };
    }

    // Superadmin only for the verified owner address: an account registered
    // with the address by someone else is not verified
    const userRecord = await adminAuth.getUser(request.auth.uid);
    if (userRecord.emailVerified !== true) {
        return {
            elevated: false,
            reason: 'email-not-verified'
        };
    }
    const currentClaims = userRecord.customClaims || {};
    const nextClaims = {
        ...currentClaims,
        superadmin: true,
        role: 'superadmin'
    };

    const claimsAlreadySet = currentClaims.superadmin === true && currentClaims.role === 'superadmin';
    if (!claimsAlreadySet) {
        await adminAuth.setCustomUserClaims(request.auth.uid, nextClaims);
    }

    const userRef = db.doc(`users/${request.auth.uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    const nextRoles = Array.from(new Set([...(Array.isArray(userData.roles) ? userData.roles : []), 'superadmin']));

    await userRef.set({
        email: authEmail,
        role: 'superadmin',
        roles: nextRoles,
        recoveryAccessVerifiedAt: Date.now()
    }, { merge: true });

    return {
        elevated: true,
        claimsUpdated: !claimsAlreadySet
    };
});

// A driver's declaration from the portal. Drivers may not write `horses`
// directly (the rules forbid it): the horse entries also hold the vet's
// inspection results, so here only names and ids are taken from the driver and
// everything else on a horse is kept (declarationUtils).
export const updateEquipageDeclaration = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    }
    const authEmail = String(request.auth.token?.email || '').trim().toLowerCase();
    if (!authEmail || request.auth.token?.email_verified !== true) {
        throw new HttpsError('permission-denied', 'Bekräfta din e-postadress innan du ändrar deklarationen.');
    }
    const competitionId = String(request.data?.competitionId || '').trim();
    const startNumber = String(request.data?.startNumber ?? '').trim();
    if (!isValidCompetitionId(competitionId) || !/^[\w-]{1,20}$/.test(startNumber)) {
        throw new HttpsError('invalid-argument', 'Ogiltig tävling eller ogiltigt startnummer.');
    }

    const comp = await getCompetitionArtifactsDoc(competitionId);
    if (!comp) throw new HttpsError('not-found', 'Tävlingen finns inte.');
    const privateSnap = await comp.ref.collection('equipagePrivate').doc(startNumber).get();
    const ownerEmail = String(privateSnap.exists ? privateSnap.data()?.email || '' : '').trim().toLowerCase();
    if (!ownerEmail || ownerEmail !== authEmail) {
        throw new HttpsError('permission-denied', 'Ekipaget är inte kopplat till din e-postadress. Kontakta sekretariatet.');
    }

    // The portal's lock, enforced here: archived, locked by the secretariat,
    // or too close to (or past) the equipage's first start
    const [metaSnap, startTimesSnap] = await Promise.all([
        comp.ref.collection('config').doc('competitionMeta').get(),
        comp.ref.collection('config').doc('startTimes').get()
    ]);
    const lockReason = declarationLockReason({
        competition: comp.data || {},
        meta: metaSnap.exists ? metaSnap.data() : {},
        startTimes: startTimesSnap.exists ? startTimesSnap.data() : {},
        startNumber
    });
    if (lockReason) {
        const messages = {
            archived: 'Tävlingen är avslutad. Deklarationen kan inte ändras.',
            manual: 'Sekretariatet har låst deklarationen. Kontakta sekretariatet för ändringar.',
            time: 'Deklarationen är låst inför start. Kontakta sekretariatet för ändringar.'
        };
        throw new HttpsError('failed-precondition', messages[lockReason]);
    }

    const equipageRef = comp.ref.collection('equipages').doc(startNumber);
    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(equipageRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Ekipaget finns inte.');
        let update;
        try {
            update = buildDeclarationUpdate(request.data || {}, snap.data()?.horses);
        } catch (error) {
            throw new HttpsError('failed-precondition', error.message);
        }
        transaction.set(equipageRef, { ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    return { ok: true };
});

// The server's clock, so timing devices can correct their own: a marathon
// section started on one phone and stopped on another must not carry the
// difference between the phones' clocks (js/utils/serverClock.js)
export const getServerTime = onCall((request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    }
    return { now: Date.now() };
});

// Messages and documents for a driver: the rules let only admins list
// driver-only items, so drivers get theirs here, after their verified email has
// been matched to the competition's equipages (driverInbox).
export const getDriverInbox = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    }
    const authEmail = String(request.auth.token?.email || '').trim().toLowerCase();
    if (!authEmail || request.auth.token?.email_verified !== true) {
        throw new HttpsError('permission-denied', 'Bekräfta din e-postadress för att se förarmeddelanden.');
    }
    const competitionId = String(request.data?.competitionId || '').trim();
    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltig tävling.');
    }
    const comp = await getCompetitionArtifactsDoc(competitionId);
    if (!comp) throw new HttpsError('not-found', 'Tävlingen finns inte.');

    const ownSnap = await comp.ref.collection('equipagePrivate').where('email', '==', authEmail).get();
    const startNumbers = ownSnap.docs.map(d => String(d.id).trim());
    if (!startNumbers.length) {
        throw new HttpsError('permission-denied', 'Inget ekipage i tävlingen är kopplat till din e-postadress.');
    }

    const [messagesSnap, documentsSnap] = await Promise.all([
        comp.ref.collection('messages').get(),
        comp.ref.collection('documents').get()
    ]);
    const messages = messagesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => isMessageForDriver(m, startNumbers))
        .map(toPlainTimestamps);
    const documents = documentsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(isDocumentForDriver)
        .map(toPlainTimestamps);
    return { startNumbers, messages, documents };
});

export const submitVolunteerSignup = onCall(async (request) => {
    const competitionId = String(request.data?.competitionId || '').trim();
    const honeypot = String(request.data?.website || '').trim();

    if (!competitionId) {
        throw new HttpsError('invalid-argument', 'Competition ID saknas.');
    }
    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltigt Competition ID.');
    }

    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) {
        throw new HttpsError('not-found', 'Tavlingen kunde inte hittas.');
    }

    if (honeypot) {
        return { accepted: true, ignored: true };
    }

    const payload = buildVolunteerSignupPayload(request.data || {});
    const signupRef = competition.ref.collection('volunteerSignups');
    const duplicateSnapshot = await signupRef
        .where('email', '==', payload.email)
        .limit(5)
        .get();
    const duplicateExists = duplicateSnapshot.docs.some((docSnap) => {
        const createdAt = Number(docSnap.data()?.createdAt || 0);
        return createdAt >= Date.now() - VOLUNTEER_DUPLICATE_WINDOW_MS;
    });

    // Rate limits (per network address and per competition), checked and
    // counted in the same transaction as the sign-up: changing the email
    // address on every call must not create unlimited documents. A repeated
    // sign-up counts against the address too, so whether an email has signed
    // up cannot be probed without limit.
    const limits = VOLUNTEER_SIGNUP_LIMITS;
    const limitsRef = db.collection(`artifacts/${competition.appId}/private/data/competitions/${competitionId}/rateLimits`);
    const addressKey = createHash('sha256').update(callerAddress(request)).digest('hex').slice(0, 32);
    const addressRef = limitsRef.doc(`volunteerSignup_addr_${addressKey}`);
    const competitionLimitRef = limitsRef.doc('volunteerSignup_competition');
    const now = Date.now();

    const accepted = await db.runTransaction(async (tx) => {
        const [addressSnap, competitionSnap] = await Promise.all([tx.get(addressRef), tx.get(competitionLimitRef)]);
        const byAddress = nextCounter(addressSnap.exists ? addressSnap.data() : null, now, limits.perAddress, limits.windowMs);
        if (!byAddress.allowed) return false;
        tx.set(addressRef, byAddress.next);
        if (duplicateExists) return true;
        const byCompetition = nextCounter(competitionSnap.exists ? competitionSnap.data() : null, now, limits.perCompetition, limits.windowMs);
        if (!byCompetition.allowed) return false;
        tx.set(competitionLimitRef, byCompetition.next);
        tx.set(signupRef.doc(), payload);
        return true;
    });
    if (!accepted) {
        logger.warn('Funktionärsanmälan stoppad av hastighetsgränsen.', { competitionId });
        throw new HttpsError('resource-exhausted', 'För många anmälningar just nu. Försök igen om en stund.');
    }
    return {
        accepted: true,
        duplicate: duplicateExists
    };
});
