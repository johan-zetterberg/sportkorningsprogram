/**
 * Cloud Functions for Combined Driving
 * Defines triggers to recalculate results on data changes.
 */

import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { appendDeclarationChange, buildDeclarationChangeEntry, buildDeclarationNotice, buildDeclarationUpdate, inspectedHorseKeys } from "./src/declarationUtils.js";
import { buildVetDecisionDriverMessage, canSendVetNotice, vetDecisionNoticeKey } from "./src/vetDecisionNotify.js";
import { declarationLockReason } from "./src/declarationLock.js";
import { isDocumentForDriver, isMessageForDriver, toPlainTimestamps } from "./src/driverInbox.js";
import { buildDriverContacts } from "./src/driverContacts.js";
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, buildExportAuditEntry, canExportPersonalNumbers, collectDocuments, redactExportDocuments } from "./src/competitionExport.js";
import { scrubClientPage, scrubClientText } from "./src/clientErrorReport.js";
import {
    changedPauseWindows,
    equipageWriteAffectsResults,
    marathonOverlapsPauseWindows,
    marathonWriteAffectsResults,
    precisionWriteAffectsResults,
    storedResultUnchanged
} from "./src/triggerFilters.js";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { createHash, randomBytes } from "node:crypto";
import { nextCounter, VOLUNTEER_SIGNUP_LIMITS } from "./src/rateLimit.js";
import {
    buildCompetitionDeletionPlan,
    canResumeCompetitionDeletion,
    isGlobalAdminIdentity
} from "./src/competitionDeletion.js";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
    DRIVER_EMAIL_FIELDS,
    PERSON_SEARCH,
    buildAccountDeletionPlan,
    buildPersonExport,
    isArchivedCompetitionData,
    matchesPerson
} from "./src/personalData.js";
import { listAllCompetitions as listAllCompetitionsIn, runPersonalDataRetention } from "./src/retentionRunner.js";

import { calculateTotalResult } from "./src/core-engine/calculation.js";
import { RESULT_ENGINE_VERSION } from "./src/core-engine/version.js";
import { dressagePrograms } from "./src/data/dressagePrograms.js";
import {
    buildRecalculationValidation,
    buildServerCompetitionState,
    chunkStartNumbers,
    configChangeAffectsResults,
    resultSettingsFingerprint,
    ruleSettingsChanged,
    competitionReopened,
    stageResultRecalculation
} from "./src/resultRecalculationUtils.js";
import {
    buildCompetitionAdminJoinPayload,
    checkPinAttempts,
    generateRoleCode,
    isValidCompetitionId,
    OFFICIAL_JOIN_ROLES,
    PIN_ATTEMPT_LIMITS,
    PIN_JOIN_ROLES,
    pinAttemptBucketId,
    planRoleRemoval,
    recordPinFailure,
    resolveJoinRoleForPin,
    roleCodesExpired,
    secretFieldForRole,
} from "./src/adminJoin.js";
import {
    VolunteerSignupError,
    buildVolunteerSignupPayload,
    hasRecentSignup,
    isLikelyBotSignup,
    isValidSignupEmail,
    volunteerSignupResponse
} from "./src/volunteerSignup.js";
import {
    MAIL_LIMITS,
    MailError,
    buildReplyToVerificationMail,
    buildSenderName,
    buildVolunteerConfirmationMail,
    effectiveReplyTo,
    filterOptOuts,
    isValidEmail as isValidMailAddress,
    mailQuotaLimits,
    normalizeAudience,
    normalizeEssentialReason,
    normalizePersonalTexts,
    normalizeProviderSettings,
    providerStatus,
    readEmailSettings,
    signMailToken,
    stripLinks,
    validateMailContent,
    verifyMailToken
} from "./src/mail/mailCore.js";
import { createMailProvider } from "./src/mail/providers.js";
import {
    SERVER_EMAIL_SETTINGS,
    buildQueueDoc,
    defaultLinkBaseUrl,
    emailSettingsPath,
    enqueueMail,
    getSigningKey,
    listWaitingMail,
    loadProviderSettings,
    mailQueuePath,
    markReplyToVerified,
    newMailRef,
    processDueMailRetries,
    processMailDoc,
    readMailUsage,
    readOptOuts,
    recordOptOut,
    requeueMail,
    resolveMailRecipients
} from "./src/mail/mailService.js";
import { MAIL_PAGE_HEADERS, renderMailPage } from "./src/mail/mailPages.js";
import { getMessaging } from "firebase-admin/messaging";
import {
    PUSH_LIMITS,
    PushError,
    buildDeclarationChangeContent,
    buildMessageContent,
    buildPauseContent,
    buildStartTimeContent,
    buildVetDecisionContent,
    isValidPushToken,
    messagePushAudience,
    normalizeStartTimeChanges,
    normalizeTopics,
    pauseTransitions,
    pushAvailable
} from "./src/push/pushCore.js";
import {
    PUSH_TOKENS,
    deleteUserTokens,
    loadPushSettings,
    readPushRegistration,
    registerPushToken as registerPushTokenIn,
    removeCompetitionFromTokens,
    savePushSettings,
    sendPushToAudience,
    sendPushToUser,
    unregisterPushToken as unregisterPushTokenIn
} from "./src/push/pushService.js";
import { applyPauseEvents } from "./src/pauseEvents.js";
import { numberIncident } from "./src/incidentNumbers.js";

// A cap on instances for every function (a runaway client or loop cannot
// scale up the bill); the public callables have lower caps of their own
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

// Result triggers are idempotent (each run recalculates from the stored
// inputs in a transaction), so a failed run is retried instead of leaving a
// stale result
const RESULT_TRIGGER_OPTIONS = { retry: true };

initializeApp();
const db = getFirestore();
const adminAuth = getAuth();
const OWNER_RECOVERY_EMAIL = 'johan.zetterberg@gmail.com';

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

const isValidEmail = isValidSignupEmail;

// Load every configurable dependency used by the shared result engine.
// These are the same inputs the browser feeds to buildCompetitionState.
// `read` lets a transaction do the reads (see writeLatestResults).
async function getContext(compRef, read = (ref) => ref.get()) {
    const configRef = (id) => compRef.collection('config').doc(id);
    const [compSnap, marCfgSn, precCfgSn, programsSnap, mappingSnap, judgeMappingSnap, statusSnap, dressClassSnap] = await Promise.all([
        read(compRef),
        read(configRef('maratonConfig')),
        read(configRef('precisionConfig')),
        read(configRef('dressagePrograms')),
        read(configRef('dressyrProgramMapping')),
        read(configRef('dressageJudgeMapping')),
        read(configRef('globalStatus')),
        read(configRef('dressyrClassConfig'))
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
                dressageJudgeMapping: data(judgeMappingSnap),
                dressyrClassConfig: data(dressClassSnap)
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
        // Its clearRound makes the class clear round in every phase
        dressyrClassConfig: data(dressClassSnap),
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

// The documents one equipage's result is calculated from. `read` lets a
// transaction do the reads (see writeLatestResults).
async function readEquipageInputs(compRef, startNumber, read = (ref) => ref.get(), equipageSnapshot = null) {
    const eqKey = String(startNumber);
    const eqDocRef = compRef.collection('equipages').doc(eqKey);
    const dressColRef = compRef.collection('dressage').doc(eqKey).collection('protocols');
    const marDocRef = compRef.collection('maraton').doc(eqKey);
    const timingDocRef = compRef.collection('maraton-timing').doc(eqKey);
    const precDocRef = compRef.collection('precision').doc(eqKey);

    const [eqSnap, dressSnap, marSnap, timingSnap, precSnap] = await Promise.all([
        equipageSnapshot ? Promise.resolve(equipageSnapshot) : read(eqDocRef),
        read(dressColRef),
        read(marDocRef),
        read(timingDocRef),
        read(precDocRef)
    ]);
    return { eqKey, eqSnap, dressSnap, marSnap, timingSnap, precSnap };
}

async function calculateEquipageRecord(compRef, startNumber, context, equipageSnapshot = null) {
    const inputs = await readEquipageInputs(compRef, startNumber, undefined, equipageSnapshot);
    return buildEquipageRecord(inputs, context);
}

function buildEquipageRecord({ eqKey, eqSnap, dressSnap, marSnap, timingSnap, precSnap }, context) {
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
    // Read, calculated and written in one transaction (deleted and archived
    // competitions are skipped there; a missing equipage's result is removed)
    await writeLatestResults(compRef, [String(startNumber)], {
        engineVersion: RESULT_ENGINE_VERSION,
        recalculatedAt: new Date().toISOString(),
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

// Equipages per transaction: ~8 reads each plus the settings; short
// transactions hold their read locks on the inputs briefly
const EQUIPAGES_PER_TRANSACTION = 25;

/**
 * Recalculates and writes the stored results of the given equipages. Each
 * transaction reads the settings and the equipages' inputs, calculates and
 * writes, so a concurrent change to any input or setting retries it: a run
 * that read older data can no longer overwrite a newer result. With
 * `settingsFingerprint`, nothing more is written once the settings differ from
 * the validated ones (the change triggers a full recalculation itself). Large
 * competitions are written in several transactions, so a run stopped half-way
 * leaves the rest to that newer recalculation. Returns whether all was written.
 */
async function writeLatestResults(compRef, startNumbers, audit, { settingsFingerprint = null, skipUnchanged = false } = {}) {
    const target = (startNumber) => compRef.collection('computed_equipages').doc(String(startNumber));
    let failure = null;
    let skipped = null;
    for (const chunk of chunkStartNumbers(startNumbers, EQUIPAGES_PER_TRANSACTION)) {
        try {
            const outcome = await db.runTransaction((tx) => stageResultRecalculation({
                read: (ref) => tx.get(ref),
                write: (ref, doc) => tx.set(ref, doc, storedResultWriteOptions(doc)),
                // A deleted equipage leaves no orphan result behind
                remove: (ref) => tx.delete(ref),
                startNumbers: chunk,
                loadContext: (read) => getContext(compRef, read),
                loadInputs: (startNumber, read) => readEquipageInputs(compRef, startNumber, read),
                calculate: buildEquipageRecord,
                targetRef: target,
                buildDoc: (record) => storedResultDoc(record, audit),
                // Automatic runs leave an equal stored result alone: rewriting it
                // would only change updatedAt and wake every listener
                isUnchanged: skipUnchanged
                    ? (stored, doc) => storedResultUnchanged(stored, doc, audit.engineVersion)
                    : null,
                settingsFingerprint,
                // One broken equipage must not keep the others stale
                onCalculateError: (startNumber, error) => logger.error(`Omräkning av #${startNumber} misslyckades`, { competition: compRef.id, error: String(error?.message || error) })
            }));
            if (!outcome.written) {
                skipped = outcome.reason;
                break;
            }
        } catch (error) {
            // The other groups are still written; the failure is reported after
            logger.error('Omräkningen kunde inte skrivas', { competition: compRef.id, triggerType: audit.triggerType, error: String(error?.message || error) });
            failure = failure || error;
        }
    }
    if (failure) throw failure;
    if (skipped === 'settings-changed') {
        logger.info('Inställningarna ändrades under beräkningen; en nyare omräkning skriver resultaten.', { competition: compRef.id, triggerType: audit.triggerType });
    }
    return skipped === null;
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
    // Only the start numbers (no fields): each transaction reads the inputs
    // and the current settings itself, so no settings check is needed here
    const equipagesSnapshot = await compRef.collection('equipages').select().get();
    await writeLatestResults(compRef, equipagesSnapshot.docs.map((doc) => doc.id), {
        engineVersion: RESULT_ENGINE_VERSION,
        recalculatedAt: new Date().toISOString(),
        triggerType
    });
}

// A pause started, ended or edited (config/globalStatus.pauseLog): only the
// equipages with a stage interval overlapping the changed pause can change
// (the engine subtracts a pause where it overlaps a stopped stage). Two
// collection reads instead of every equipage's inputs; with a pause entry it
// cannot read, everything is recalculated.
async function recalculatePauseAffected(appId, competitionId, beforeLog, afterLog) {
    const windows = changedPauseWindows(beforeLog, afterLog);
    if (windows === null) {
        await recalculateWholeCompetition(appId, competitionId, 'config-change:globalStatus');
        return;
    }
    if (!windows.length) return;
    const compRef = db.doc(`artifacts/${appId}/public/data/competitions/${competitionId}`);
    const compSnap = await compRef.get();
    const comp = compSnap.exists ? compSnap.data() : null;
    if (!comp || comp.deleting === true) return;
    if (comp.locked === true || comp.status === 'completed') {
        logger.info('Arkiverad tävling: automatisk omräkning hoppas över.', { competition: competitionId, triggerType: 'pause' });
        return;
    }
    const [equipagesSnap, marathonSnap, timingSnap] = await Promise.all([
        compRef.collection('equipages').select().get(),
        compRef.collection('maraton').get(),
        compRef.collection('maraton-timing').get()
    ]);
    const marathonById = new Map(marathonSnap.docs.map((d) => [d.id, d.data()]));
    const timingById = new Map(timingSnap.docs.map((d) => [d.id, d.data()]));
    const affected = equipagesSnap.docs
        .map((d) => d.id)
        .filter((id) => marathonOverlapsPauseWindows(marathonById.get(id), timingById.get(id), windows));
    if (!affected.length) return;
    await writeLatestResults(compRef, affected, {
        engineVersion: RESULT_ENGINE_VERSION,
        recalculatedAt: new Date().toISOString(),
        triggerType: 'config-change:globalStatus'
    });
}

// --- TRIGGERS ---

// 0. Settings that every result depends on (marathon/precision config, dressage
// programs and mappings, the pause log, rule settings)
export const onResultConfigWrite = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}/config/{configId}", timeoutSeconds: 540, memory: '512MiB', ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId, configId } = event.params;
        const before = event.data?.before?.exists ? event.data.before.data() : null;
        const after = event.data?.after?.exists ? event.data.after.data() : null;
        if (!configChangeAffectsResults(configId, before, after)) return;
        if (configId === 'globalStatus') {
            await recalculatePauseAffected(appId, compId, before?.pauseLog, after?.pauseLog);
            return;
        }
        await recalculateWholeCompetition(appId, compId, `config-change:${configId}`);
    }
);

// 0b. A pause or resume pressed without connection (js/services/
// globalPauseService.js): the device wrote an event, folded here into
// config/globalStatus.pauseLog in event order, append-only (src/pauseEvents.js).
// The write of the log triggers onResultConfigWrite (recalculatePauseAffected)
// and the pause push as an online press does. Idempotent (events are marked
// processed in the same transaction), so retried.
export const onPauseEventCreated = onDocumentCreated(
    { document: "artifacts/{appId}/private/data/competitions/{compId}/pauseEvents/{eventId}", ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId } = event.params;
        const result = await applyPauseEvents(db, FieldValue, { appId, compId });
        if (result.processed) logger.info('Pausehändelser inlagda', { competitionId: compId, ...result });
    }
);

// 0c. A new incident log entry gets its final number from the competition's
// counter (two devices, or one offline, may have picked the same number:
// src/incidentNumbers.js). Idempotent per entry, so retried.
export const onIncidentNumbered = onDocumentCreated(
    { document: "artifacts/{appId}/private/data/competitions/{compId}/incidents/{incidentId}", ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId, incidentId } = event.params;
        const result = await numberIncident(db, { appId, compId, incidentId });
        if (result?.changed) logger.info('Händelselogg: nytt nummer', { competitionId: compId, incidentId, number: result.number });
    }
);

export const onCompetitionRuleSettingsWrite = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}", timeoutSeconds: 540, memory: '512MiB', ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId } = event.params;
        const before = event.data?.before?.exists ? event.data.before.data() : null;
        const after = event.data?.after?.exists ? event.data.after.data() : null;
        if (!after) return;
        if (competitionReopened(before, after)) {
            await recalculateWholeCompetition(appId, compId, 'reopened');
            return;
        }
        if (!ruleSettingsChanged(before, after)) return;
        await recalculateWholeCompetition(appId, compId, 'config-change:ruleSettings');
    }
);

// A removed competition official (their /admins/{uid} doc deleted) no longer
// lists the competition: staffUids and admins[] would otherwise keep showing it,
// drafts included, after the role was taken away
export const onCompetitionAdminDeleted = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/admins/{uid}",
    async (event) => {
        if (event.data?.after?.exists || !event.data?.before?.exists) return;
        const { appId, compId, uid } = event.params;
        const compRef = db.doc(`artifacts/${appId}/public/data/competitions/${compId}`);
        try {
            await compRef.update({
                staffUids: FieldValue.arrayRemove(uid),
                admins: FieldValue.arrayRemove(uid)
            });
        } catch (error) {
            // The competition itself was deleted: nothing to clean up
            if (error?.code === 5 || /NOT_FOUND/i.test(String(error?.message))) return;
            throw error;
        }
    }
);

// 1. Dressage Changes
export const onDressageProtocolWrite = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}/dressage/{startNo}/protocols/{protoId}", ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId, startNo } = event.params;
        await recalculateEquipage(appId, compId, startNo);
    }
);

// 2. Marathon Changes
export const onMarathonResultWrite = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}/maraton/{startNo}", ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId, startNo } = event.params;
        // The obstacle input writes its live form state here on every change
        if (!marathonWriteAffectsResults(beforeData(event), afterData(event))) return;
        await recalculateEquipage(appId, compId, startNo);
    }
);
// FIX: Add missing trigger for timing
export const onMarathonTimingWrite = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}/maraton-timing/{startNo}", ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId, startNo } = event.params;
        await recalculateEquipage(appId, compId, startNo);
    }
);

// 3. Precision Changes
export const onPrecisionResultWrite = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}/precision/{startNo}", ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId, startNo } = event.params;
        if (!precisionWriteAffectsResults(beforeData(event), afterData(event))) return;
        await recalculateEquipage(appId, compId, startNo);
    }
);

// 4. Equipage Static Data Changes
export const onEquipageUpdate = onDocumentWritten(
    { document: "artifacts/{appId}/public/data/competitions/{compId}/equipages/{startNo}", ...RESULT_TRIGGER_OPTIONS },
    async (event) => {
        const { appId, compId, startNo } = event.params;
        // Speaker notes, temperatures and the like do not change the result
        if (!equipageWriteAffectsResults(beforeData(event), afterData(event))) return;
        await recalculateEquipage(appId, compId, startNo);
    }
);

// A vet decision in the incident log reaches the driver's inbox: when the vet
// reports it to the ground jury and when the ground jury decides it. The rules
// let only admins write messages, so the server writes them (a message
// addressed to the equipage, see driverInbox.js). The writer's role is checked
// again (vet report: vet, TD, admin; decision: TD, admin), and each notice
// (incident + 'reported'/outcome) is sent once: its message and mail have
// fixed document ids, the push a dedupe key.
const isAlreadyExists = (error) => error?.code === 6 || error?.code === 'already-exists' || /already exists/i.test(String(error?.message || ''));

// The writer's roles in the competition: 'admin' (owners, competition and
// global admins, as assertCanMaintainResults) and the roles of its
// admins/{uid} doc and verified roleEmails entry
async function competitionRolesOfUid(appId, compId, uid) {
    if (!uid || typeof uid !== 'string') return [];
    const ref = db.doc(`artifacts/${appId}/public/data/competitions/${compId}`);
    const [compSnap, user] = await Promise.all([
        ref.get(),
        adminAuth.getUser(uid).catch(() => null)
    ]);
    if (!compSnap.exists || !user) return [];
    const email = String(user.email || '').trim().toLowerCase();
    const verified = user.emailVerified === true;
    const request = { auth: { uid, token: { ...(user.customClaims || {}), email, email_verified: verified } } };
    const roles = [];
    try {
        await assertCanMaintainResults(request, { ref, data: compSnap.data() });
        roles.push('admin');
    } catch (error) {
        if (!(error instanceof HttpsError) || error.code !== 'permission-denied') throw error;
    }
    const [adminSnap, roleEmailSnap] = await Promise.all([
        ref.collection('admins').doc(uid).get(),
        verified && email ? ref.collection('roleEmails').doc(email).get() : Promise.resolve(null)
    ]);
    [adminSnap, roleEmailSnap].forEach((snap) => {
        const data = snap?.exists ? snap.data() : {};
        [data.role, ...(Array.isArray(data.roles) ? data.roles : [])].filter(Boolean).forEach((role) => roles.push(role));
    });
    return roles;
}

export const onIncidentWritten = onDocumentWritten(
    "artifacts/{appId}/private/data/competitions/{compId}/incidents/{incidentId}",
    async (event) => {
        const before = beforeData(event);
        const after = afterData(event);
        const message = buildVetDecisionDriverMessage(before, after);
        if (!message) return;
        const { appId, compId, incidentId } = event.params;
        const noticeKey = vetDecisionNoticeKey(before, after);
        const writer = before ? after.updatedBy : after.createdBy;
        const roles = await competitionRolesOfUid(appId, compId, writer);
        if (!canSendVetNotice(noticeKey, roles)) {
            logger.warn('Veterinärbeslut: skrivaren saknar roll, ingen notis', { competitionId: compId, incidentId, noticeKey, writer: writer || null });
            return;
        }
        const noticeId = `vet_${incidentId}_${noticeKey}`.slice(0, 200);
        try {
            await db.doc(`artifacts/${appId}/public/data/competitions/${compId}/messages/${noticeId}`).create({
                ...message,
                incidentId,
                timestamp: FieldValue.serverTimestamp()
            });
        } catch (error) {
            if (!isAlreadyExists(error)) throw error;
        }
        // The same notice by e-mail to the equipage's addresses (unless the
        // competition switched it off); the inbox message above stands anyway
        try {
            await queueVetDecisionMail(appId, compId, message, incidentId, noticeId);
        } catch (error) {
            logger.error('Veterinärbeslut: e-post kunde inte köas', { competitionId: compId, incidentId, error: String(error?.message || error) });
        }
        // And as a push notice to the driver's devices and the staff who
        // follow vet decisions (the secretariat, the TD, the vet)
        await safePush('vetDecision', () => sendPushToAudience(db, pushMessaging(), {
            appId, compId,
            audience: {
                drivers: { classes: [], startNumbers: message.targetStartNumbers, includeWithdrawn: true },
                officials: { roles: ['admin', 'td', 'vet'] }
            },
            category: 'essential',
            topic: 'vetDecision',
            content: (_target, lang) => buildVetDecisionContent(message, lang),
            tag: `vet-${incidentId}`.slice(0, 64),
            source: 'incident',
            dedupeKey: noticeId,
            logger
        }), { competitionId: compId, incidentId });
    }
);

async function queueVetDecisionMail(appId, compId, message, incidentId, noticeId) {
    const settingsSnap = await db.doc(emailSettingsPath(appId, compId)).get();
    if (!readEmailSettings(settingsSnap.exists ? settingsSnap.data() : {}).autoVetDecisionMail) return;
    const content = validateMailContent({ subject: message.title, text: message.body });
    const mail = {
        kind: 'vetDecision',
        category: 'essential',
        ...content,
        audience: { drivers: { classes: [], startNumbers: message.targetStartNumbers, includeWithdrawn: true } },
        createdBy: 'system',
        source: { type: 'incident', incidentId }
    };
    try {
        // A fixed id: the same notice is never queued twice
        await db.doc(`${mailQueuePath(appId, compId)}/${noticeId}`).create(buildQueueDoc(mail, { FieldValue }));
    } catch (error) {
        if (!isAlreadyExists(error)) throw error;
    }
}

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
        // No device follows the competition any more (push)
        await removeCompetitionFromTokens(db, FieldValue, appId, competitionId);
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

// A complete copy of a competition (all its documents, private ones too) for
// the owner or a full admin to download: a protection against deleting the
// wrong competition. Files in Storage are listed by name, not included.
// Access PINs are never included; personal identity numbers only when the
// admin asks for them (includePersonalNumbers).
export const exportCompetition = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
    const competitionId = String(request.data?.competitionId || '').trim();
    const includePersonalNumbers = request.data?.includePersonalNumbers === true;
    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltigt Competition ID.');
    }
    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
    await assertCanMaintainResults(request, competition, 'Endast tävlingens ägare eller en full administratör får exportera tävlingen.');
    // Personal identity numbers: only the owner or a global admin
    if (includePersonalNumbers) {
        const userSnap = await db.doc(`users/${request.auth.uid}`).get();
        const allowed = canExportPersonalNumbers({
            uid: request.auth.uid,
            token: request.auth.token || {},
            competitionData: competition.data || {},
            userData: userSnap.exists ? userSnap.data() : {}
        });
        if (!allowed) {
            throw new HttpsError('permission-denied', 'Endast tävlingens ägare eller en global administratör får exportera personnummer. Exportera utan personnummer.');
        }
    }

    const appId = competition.appId;
    let documents = [];
    try {
        for (const path of [
            `artifacts/${appId}/public/data/competitions/${competitionId}`,
            `artifacts/${appId}/private/data/competitions/${competitionId}`,
            `competitions/${competitionId}`
        ]) {
            await collectDocuments(db.doc(path), { out: documents });
        }
    } catch (error) {
        logger.error('Export av tävling misslyckades', { competitionId, error: String(error?.message || error) });
        throw new HttpsError('resource-exhausted', 'Tävlingen är för stor att exportera på det här sättet.');
    }
    const { documents: keptDocuments, redacted } = redactExportDocuments(documents, { includePersonalNumbers });
    documents = keptDocuments;

    let storageFiles = [];
    try {
        const [files] = await getStorage().bucket().getFiles({ prefix: `competitions/${competitionId}/` });
        storageFiles = files.map(file => file.name);
    } catch (error) {
        logger.warn('Kunde inte lista tävlingens filer', { competitionId, error: String(error?.message || error) });
    }

    const exportData = {
        format: EXPORT_FORMAT,
        formatVersion: EXPORT_FORMAT_VERSION,
        competitionId,
        appId,
        name: competition.data?.name || '',
        exportedAt: new Date().toISOString(),
        exportedBy: request.auth.uid,
        engineVersion: RESULT_ENGINE_VERSION,
        documentCount: documents.length,
        includesPersonalNumbers: includePersonalNumbers,
        // What was left out: { path, reason } or { path, field, reason }
        redacted,
        documents,
        storageFiles
    };
    // A callable answer has a size limit: well above a normal competition
    if (JSON.stringify(exportData).length > 25 * 1024 * 1024) {
        throw new HttpsError('resource-exhausted', 'Tävlingen är för stor att exportera på det här sättet.');
    }
    // Every export in the private audit log (who, when, with personal numbers)
    await db.collection(`artifacts/${appId}/private/data/competitions/${competitionId}/auditLog`).add(buildExportAuditEntry({
        uid: request.auth.uid,
        email: request.auth.token?.email,
        includePersonalNumbers,
        documentCount: documents.length
    }));
    logger.info('Tävling exporterad', { competitionId, by: request.auth.uid, documents: documents.length, redacted: redacted.length, includePersonalNumbers });
    return exportData;
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
    const email = String(request.auth.token?.email || '').trim().toLowerCase();
    const emailVerified = request.auth.token?.email_verified === true;
    const competitionData = competition.data || {};
    const tokenRoles = Array.isArray(request.auth.token?.roles) ? request.auth.token.roles : [];
    const tokenIsAdmin = request.auth.token?.superadmin === true
        || request.auth.token?.role === 'superadmin'
        || request.auth.token?.role === 'admin'
        || tokenRoles.includes('superadmin')
        || tokenRoles.includes('admin');
    const isOwner = competitionData.createdBy === uid || competitionData.ownerId === uid;
    const listedAdmin = Array.isArray(competitionData.admins) && competitionData.admins.includes(uid);
    const [adminSnap, userSnap, roleEmailSnap] = await Promise.all([
        competition.ref.collection('admins').doc(uid).get(),
        db.doc(`users/${uid}`).get(),
        emailVerified && email ? competition.ref.collection('roleEmails').doc(email).get() : Promise.resolve(null)
    ]);
    const adminData = adminSnap.exists ? adminSnap.data() : {};
    const adminRoles = Array.isArray(adminData.roles) ? adminData.roles : [];
    const roleEmailData = roleEmailSnap && roleEmailSnap.exists ? roleEmailSnap.data() : {};
    const roleEmailRoles = Array.isArray(roleEmailData.roles) ? roleEmailData.roles : [];
    const isCompetitionAdmin = adminData.role === 'admin'
        || adminRoles.includes('admin')
        || roleEmailData.role === 'admin'
        || roleEmailRoles.includes('admin');
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
    const docs = equipagesSnapshot.docs;
    const records = [];
    const CHUNK_SIZE = 25;

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
        const chunk = docs.slice(i, i + CHUNK_SIZE);
        const chunkRecords = await Promise.all(chunk.map(async (equipageSnapshot) => {
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
        records.push(...chunkRecords);
    }
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
        // Archived results are immutable. Reopen first so the recalculation,
        // the public result views and the next archive snapshot stay aligned.
        if (isArchivedCompetition(competition.data)) {
            throw new HttpsError('failed-precondition', 'Tävlingen är arkiverad. Öppna tävlingen igen innan resultaten räknas om.', { archived: true });
        }

        const { context, records, validation } = await buildCompetitionRecalculationPreview(competition);
        if (validation.criticalErrors.length > 0) {
            throw new HttpsError('failed-precondition', 'Omräkningen blockeras av kritiska valideringsfel.', validation);
        }
        if (validation.warnings.length > 0 && request.data?.confirmedWarnings !== true) {
            throw new HttpsError('failed-precondition', 'Varningarna måste bekräftas före omräkning.', validation);
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

        // Recalculated from the latest inputs as written; stops if the
        // settings differ from the validated ones
        const written = await writeLatestResults(competition.ref, records.map((record) => record.startNumber), audit, { settingsFingerprint: context.settingsFingerprint });
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

// A role code (Admin > Inställningar > Funktionärskoder) gives one official
// role in one competition. Competition admins are not joined this way: they are
// invited by email (roleEmails, verified address).
// TODO(App Check): add enforceAppCheck: true here (and on submitVolunteerSignup)
// once App Check is set up in the Firebase console.
export const joinCompetitionAsOfficial = onCall({ maxInstances: 5 }, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    }

    const competitionId = String(request.data?.competitionId || '').trim();
    const pinCode = String(request.data?.pinCode || '').trim();
    // The role named by the join link (only picks the attempt counter)
    const roleHint = String(request.data?.role || '').trim();
    const userEmail = String(request.auth.token?.email || '').trim().toLowerCase();
    const emailVerified = request.auth.token?.email_verified === true;

    if (!competitionId) {
        throw new HttpsError('invalid-argument', 'Tävlings-ID saknas.');
    }
    if (!pinCode) {
        throw new HttpsError('invalid-argument', 'Funktionärskod saknas.');
    }
    if (!userEmail) {
        throw new HttpsError('failed-precondition', 'Användaren måste ha en e-postadress.');
    }

    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltigt tävlings-ID.');
    }

    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) {
        throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
    }

    const secretsSnap = await competition.ref.collection('config').doc('secrets').get();
    const secrets = secretsSnap.exists ? secretsSnap.data() : {};
    if (roleCodesExpired(secrets)) {
        throw new HttpsError('failed-precondition', 'Funktionärskoderna för tävlingen har gått ut. Kontakta tävlingens administratör.');
    }

    // Officials the competition invited by email (verified address in
    // roleEmails or the officials register) are not held by the shared
    // counter, so nobody can lock them out with wrong codes
    let invited = false;
    if (emailVerified) {
        const [roleEmailSnap, officialSnap] = await Promise.all([
            competition.ref.collection('roleEmails').doc(userEmail).get(),
            competition.ref.collection('officialsPrivate').where('email', '==', userEmail).limit(1).get()
        ]);
        invited = roleEmailSnap.exists || !officialSnap.empty;
    }

    // Limit wrong codes per user and per competition and role. The counters
    // live outside the public tree and have no client rules, so only this
    // function sees them. Check and count in one transaction so parallel
    // guesses cannot slip past. Limits and reasoning: PIN_ATTEMPT_LIMITS.
    const userAttemptsRef = db.doc(`pinJoinAttempts/${competitionId}__${request.auth.uid}`);
    const competitionAttemptsRef = db.doc(`pinJoinAttempts/${pinAttemptBucketId(competitionId, roleHint)}`);
    const now = Date.now();
    const attempt = await db.runTransaction(async (tx) => {
        const [userSnap, competitionSnap] = await Promise.all([tx.get(userAttemptsRef), tx.get(competitionAttemptsRef)]);
        const userState = userSnap.exists ? userSnap.data() : null;
        const competitionState = competitionSnap.exists ? competitionSnap.data() : null;
        const check = checkPinAttempts(userState, competitionState, now, PIN_ATTEMPT_LIMITS, { emailVerified, invited });
        if (!check.allowed) return { locked: true, retryAfterMs: check.retryAfterMs };

        const role = resolveJoinRoleForPin(pinCode, secrets);
        if (!role) {
            tx.set(userAttemptsRef, recordPinFailure(userState, PIN_ATTEMPT_LIMITS.perUser.windowMs, now));
            if (!invited) {
                tx.set(competitionAttemptsRef, recordPinFailure(competitionState, PIN_ATTEMPT_LIMITS.perCompetition.windowMs, now));
            }
        }
        return { role };
    });
    if (attempt.locked) {
        const minutes = Math.max(1, Math.ceil(attempt.retryAfterMs / 60000));
        throw new HttpsError('resource-exhausted', emailVerified
            ? `För många felaktiga kodförsök. Försök igen om ${minutes} min.`
            : `För många felaktiga kodförsök i tävlingen. Bekräfta din e-postadress för att fortsätta direkt, eller försök igen om ${minutes} min.`);
    }
    const matchedRole = attempt.role;
    if (matchedRole === 'admin') {
        // The old admin PIN: no longer a way in
        throw new HttpsError('permission-denied', 'Administratörer ansluts inte längre med kod. Be tävlingens ägare bjuda in dig med din e-postadress (Funktionärer > Bjud in administratör).');
    }
    if (!matchedRole) {
        throw new HttpsError('permission-denied', 'Fel kod. Kontrollera koden och försök igen.');
    }
    // The TD can send essential mail and push to the drivers: a code is
    // enough (owner's decision), but not on an account with an unconfirmed
    // address (stops throwaway accounts)
    if (matchedRole === 'td' && !emailVerified) {
        throw new HttpsError('failed-precondition', 'Bekräfta din e-postadress innan du ansluter som TD. Öppna länken i bekräftelsemejlet och försök igen.');
    }

    const adminRef = competition.ref.collection('admins').doc(request.auth.uid);
    const adminSnap = await adminRef.get();
    const existingData = adminSnap.exists ? adminSnap.data() : {};
    const payload = buildCompetitionAdminJoinPayload(existingData, matchedRole, userEmail, Date.now(), request.auth.token?.name);

    // The role doc and the staff listing together, or neither. Only staffUids
    // (lets the hub list the competition, drafts included): admin rights come
    // from the /admins/{uid} doc, so they end when it is deleted, and admins[]
    // stays the owners' list. update(), not set(): a competition deleted
    // meanwhile is not recreated.
    const batch = db.batch();
    batch.set(adminRef, { ...payload, uid: request.auth.uid }, { merge: true });
    batch.update(competition.ref, { staffUids: FieldValue.arrayUnion(request.auth.uid) });
    await batch.commit();

    return {
        role: matchedRole,
        roles: payload.roles
    };
});

/**
 * Takes a role joined with a code away (admins/{uid} docs). With `uid`: that
 * person only. Without: everyone who joined the role, and the role's code is
 * replaced (the old admin PIN is removed instead). The competition's admins
 * only. Returns { removed, code } (code: the new one, grouped by the client).
 */
export const revokeOfficialAccess = onCall({ maxInstances: 5 }, async (request) => {
    const competitionId = String(request.data?.competitionId || '').trim();
    const role = String(request.data?.role || '').trim();
    const uid = request.data?.uid ? String(request.data.uid).trim() : '';
    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltigt tävlings-ID.');
    }
    if (!OFFICIAL_JOIN_ROLES.includes(role)) {
        throw new HttpsError('invalid-argument', 'Okänd roll.');
    }
    if (uid && !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
        throw new HttpsError('invalid-argument', 'Ogiltig användare.');
    }
    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
    await assertCanMaintainResults(request, competition, 'Endast tävlingens administratörer får dra tillbaka åtkomst.');

    const adminsRef = competition.ref.collection('admins');
    const docs = uid
        ? [await adminsRef.doc(uid).get()].filter((snap) => snap.exists)
        : (await adminsRef.get()).docs;
    const batch = db.batch();
    let removed = 0;
    docs.forEach((snap) => {
        const plan = planRoleRemoval(snap.data() || {}, role);
        if (!plan) return;
        removed += 1;
        // Deleting the doc also takes the uid off staffUids (onCompetitionAdminDeleted)
        if (plan.delete) batch.delete(snap.ref);
        else batch.update(snap.ref, plan.update);
    });

    let code = null;
    if (!uid) {
        const secretsRef = competition.ref.collection('config').doc('secrets');
        if (PIN_JOIN_ROLES.includes(role)) {
            code = generateRoleCode(randomBytes);
            batch.set(secretsRef, { [secretFieldForRole(role)]: code, updatedAt: Date.now() }, { merge: true });
        } else {
            batch.set(secretsRef, { accessCode: FieldValue.delete(), updatedAt: Date.now() }, { merge: true });
        }
    }
    await batch.commit();
    logger.info('Funktionärsåtkomst återkallad', { competitionId, role, uid: uid || null, removed, by: request.auth.uid });
    return { removed, code };
});

export const ensureOwnerSuperadminAccess = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    }

    const authEmail = String(request.auth.token?.email || '').trim().toLowerCase();
    if (!authEmail) {
        throw new HttpsError('failed-precondition', 'Användaren måste ha en e-postadress.');
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
// directly (the rules forbid it): the horse entries hold the secretariat's data
// and the vet's results are tied to each horse's key, so here only names and
// ids are taken from the driver and everything else on a horse is kept
// (declarationUtils).
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
    let changed = false;
    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(equipageRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Ekipaget finns inte.');
        const before = snap.data() || {};
        let update;
        try {
            // The vet's results are per horse key on the equipage: inspected
            // horses keep their name and id
            update = buildDeclarationUpdate(request.data || {}, before.horses, inspectedHorseKeys(before));
        } catch (error) {
            throw new HttpsError('failed-precondition', error.message);
        }
        // What changed, on the equipage (capped list) and in the staff
        // notifications: the secretariat, vet and speaker see it until
        // acknowledged; a horse added after the vet inspection is flagged
        const entry = buildDeclarationChangeEntry(before, update);
        changed = !!entry;
        const extra = entry ? {
            declarationChangedAt: FieldValue.serverTimestamp(),
            declarationChanges: appendDeclarationChange(before.declarationChanges, entry)
        } : {};
        transaction.set(equipageRef, { ...update, ...extra, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        if (entry) {
            const notice = buildDeclarationNotice(entry, { startNumber, driverName: before.driverName });
            const noticeRef = db.collection(`artifacts/${comp.appId}/private/data/competitions/${competitionId}/staffNotifications`).doc();
            transaction.set(noticeRef, {
                ...notice,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: request.auth.uid,
                createdByName: String(before.driverName || '').slice(0, 200)
            });
        }
    });
    return { ok: true, changed };
});

// The server's clock, so timing devices can correct their own: a marathon
// section started on one phone and stopped on another must not carry the
// difference between the phones' clocks (js/utils/serverClock.js)
// Every timing device asks at start and now and then: a cap, not a bottleneck
export const getServerTime = onCall({ maxInstances: 10 }, (request) => {
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
    // Pointer for storage.rules (driver-only files): the rules check the
    // verified email against this equipage's private doc on every read
    const accessRef = db.doc(`users/${request.auth.uid}/driverCompetitions/${competitionId}`);
    if (!startNumbers.length) {
        await accessRef.delete().catch(() => {});
        throw new HttpsError('permission-denied', 'Inget ekipage i tävlingen är kopplat till din e-postadress.');
    }
    await accessRef.set({
        appId: comp.appId,
        startNumber: startNumbers[0],
        updatedAt: FieldValue.serverTimestamp()
    });

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

// The competition's contact persons for drivers: the officials the admin
// marked, with the contact details chosen for each. Officials and their
// private details are not readable by drivers; a driver of the competition
// (verified email matched to an equipage, as for getDriverInbox) gets this.
export const getDriverContacts = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    }
    const authEmail = String(request.auth.token?.email || '').trim().toLowerCase();
    if (!authEmail || request.auth.token?.email_verified !== true) {
        throw new HttpsError('permission-denied', 'Bekräfta din e-postadress för att se kontaktpersonerna.');
    }
    const competitionId = String(request.data?.competitionId || '').trim();
    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltig tävling.');
    }
    const comp = await getCompetitionArtifactsDoc(competitionId);
    if (!comp) throw new HttpsError('not-found', 'Tävlingen finns inte.');

    const ownSnap = await comp.ref.collection('equipagePrivate').where('email', '==', authEmail).limit(1).get();
    if (ownSnap.empty) {
        throw new HttpsError('permission-denied', 'Inget ekipage i tävlingen är kopplat till din e-postadress.');
    }

    const officialsSnap = await comp.ref.collection('officials').where('driverContact.show', '==', true).get();
    const officials = officialsSnap.docs.map(d => ({ id: d.id, data: d.data() }));
    const privateDocs = await Promise.all(officials.map(o => comp.ref.collection('officialsPrivate').doc(o.id).get()));
    const privateById = new Map(privateDocs.filter(d => d.exists).map(d => [d.id, d.data()]));
    return { contacts: buildDriverContacts(officials, privateById) };
});

// Uncaught errors from the browser (js/utils/errorReporter.js), logged so they
// show in Cloud Logging and Error Reporting. The client sends no personal data;
// texts are shortened, e-mail addresses and URL query strings/fragments removed
// here as well (src/clientErrorReport.js). A cap per instance and minute, and
// few instances, keep a broken page from filling the logs.
const CLIENT_ERROR_LIMIT_PER_MINUTE = 60;
let clientErrorWindow = { start: 0, count: 0 };
export const reportClientError = onCall({ maxInstances: 2 }, (request) => {
    const now = Date.now();
    if (now - clientErrorWindow.start > 60000) clientErrorWindow = { start: now, count: 0 };
    if (++clientErrorWindow.count > CLIENT_ERROR_LIMIT_PER_MINUTE) return { logged: false };

    const clip = scrubClientText;
    const d = request.data || {};
    const entry = {
        kind: clip(d.kind, 20),
        page: scrubClientPage(d.page, 60),
        competitionId: clip(d.competitionId, 64),
        appVersion: clip(d.appVersion, 20),
        engineVersion: clip(d.engineVersion, 20),
        signedIn: !!request.auth?.uid,
        userAgent: clip(request.rawRequest?.headers?.['user-agent'], 200)
    };
    const message = clip(d.message, 500) || 'Okänt fel';
    const stack = clip(d.stack, 4000);
    // A JavaScript stack in the message lets Error Reporting group the errors
    const name = clip(d.name, 60) || 'Error';
    const text = stack && stack.includes('\n') && !stack.startsWith(name)
        ? `${name}: ${message}\n${stack}`
        : (stack || `${name}: ${message}`);
    logger.error(`[klientfel ${entry.appVersion} #${entry.page}] ${text}`, entry);
    return { logged: true };
});

// Public volunteer sign-up form (volunteer-signup.html). The answer is the same
// whether the email had signed up before, the sender looked like a bot or the
// sign-up was stored, so the form cannot be used to find out who signed up;
// the admin sees possible duplicates in the inbox instead.
// TODO(App Check): add enforceAppCheck: true here once App Check is set up.
export const submitVolunteerSignup = onCall({ maxInstances: 2 }, async (request) => {
    const competitionId = String(request.data?.competitionId || '').trim();

    if (!competitionId) {
        throw new HttpsError('invalid-argument', 'Tävlings-ID saknas.');
    }
    if (!isValidCompetitionId(competitionId)) {
        throw new HttpsError('invalid-argument', 'Ogiltigt tävlings-ID.');
    }

    const competition = await getCompetitionArtifactsDoc(competitionId);
    // A draft is not public: no signups (as if it did not exist)
    if (!competition || competition.data?.published === false) {
        throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
    }

    // Hidden field filled in, or sent faster than a person can: nothing stored
    if (isLikelyBotSignup(request.data || {})) {
        return volunteerSignupResponse();
    }

    let payload;
    try {
        payload = buildVolunteerSignupPayload(request.data || {});
    } catch (error) {
        if (error instanceof VolunteerSignupError) throw new HttpsError('invalid-argument', error.message);
        throw error;
    }
    const signupRef = competition.ref.collection('volunteerSignups');
    const earlierSnapshot = await signupRef
        .where('email', '==', payload.email)
        .limit(5)
        .get();
    // Stored anyway and marked, so the admin decides (merge or remove)
    if (hasRecentSignup(earlierSnapshot.docs.map((docSnap) => docSnap.data()))) {
        payload.possibleDuplicate = true;
    }

    // Rate limits (per network address, per competition and hour, per
    // competition and day), checked and counted in the same transaction as the
    // sign-up: changing the email address on every call must not create
    // unlimited documents.
    const limits = VOLUNTEER_SIGNUP_LIMITS;
    const limitsRef = db.collection(`artifacts/${competition.appId}/private/data/competitions/${competitionId}/rateLimits`);
    const addressKey = createHash('sha256').update(callerAddress(request)).digest('hex').slice(0, 32);
    const addressRef = limitsRef.doc(`volunteerSignup_addr_${addressKey}`);
    const competitionLimitRef = limitsRef.doc('volunteerSignup_competition');
    const competitionDayLimitRef = limitsRef.doc('volunteerSignup_competition_day');
    const now = Date.now();
    // A confirmation by e-mail, queued with the sign-up (not for a possible
    // duplicate: the same address gets one, not one per form sent)
    const emailSettingsSnap = await db.doc(emailSettingsPath(competition.appId, competitionId)).get();
    const confirmationMail = !payload.possibleDuplicate
        && readEmailSettings(emailSettingsSnap.exists ? emailSettingsSnap.data() : {}).autoVolunteerConfirmation
        ? {
            kind: 'volunteerConfirmation',
            category: 'essential',
            // Of what the person wrote only the name, as plain text
            ...buildVolunteerConfirmationMail({ name: payload.name, competitionName: competition.data?.name }),
            to: [{ email: payload.email, name: stripLinks(payload.name).slice(0, 60) }],
            createdBy: 'system',
            source: { type: 'volunteerSignup' }
        }
        : null;

    const accepted = await db.runTransaction(async (tx) => {
        const [addressSnap, competitionSnap, daySnap] = await Promise.all([
            tx.get(addressRef), tx.get(competitionLimitRef), tx.get(competitionDayLimitRef)
        ]);
        const byAddress = nextCounter(addressSnap.exists ? addressSnap.data() : null, now, limits.perAddress, limits.windowMs);
        if (!byAddress.allowed) return false;
        tx.set(addressRef, byAddress.next);
        const byCompetition = nextCounter(competitionSnap.exists ? competitionSnap.data() : null, now, limits.perCompetition, limits.windowMs);
        const byDay = nextCounter(daySnap.exists ? daySnap.data() : null, now, limits.perCompetitionDay, limits.dayWindowMs);
        if (!byCompetition.allowed || !byDay.allowed) return false;
        tx.set(competitionLimitRef, byCompetition.next);
        tx.set(competitionDayLimitRef, byDay.next);
        const signupDocRef = signupRef.doc();
        tx.set(signupDocRef, payload);
        if (confirmationMail) {
            const mail = { ...confirmationMail, source: { ...confirmationMail.source, signupId: signupDocRef.id } };
            tx.set(newMailRef(db, competition.appId, competitionId), buildQueueDoc(mail, { FieldValue, now }));
        }
        return true;
    });
    if (!accepted) {
        logger.warn('Funktionärsanmälan stoppad av hastighetsgränsen.', { competitionId });
        throw new HttpsError('resource-exhausted', 'För många anmälningar just nu. Försök igen om en stund.');
    }
    return volunteerSignupResponse();
});

// --- PERSONAL DATA (GDPR): retention, account deletion, access requests ---
// Pure parts in src/personalData.js, the retention run in src/retentionRunner.js.
// Run records go to retentionRuns, personalDataRetention and accountDeletions
// (no client rules: server only).

export const purgeExpiredPersonalData = onSchedule(
    { schedule: 'every day 03:30', timeZone: 'Europe/Stockholm', timeoutSeconds: 540, memory: '512MiB', maxInstances: 1 },
    async () => {
        await runPersonalDataRetention({ db, FieldValue, logger, nowMs: Date.now() });
    }
);

// A finalized result lock of an equipage being deleted (deleteEquipage):
// the rules let only superadmins delete lock documents, so a competition admin
// has them deleted here, while the competition is not archived. Logged in
// finalizationLog as an unlock with the reason.
export const clearEquipageFinalizationLocks = onCall(async (request) => {
    const competitionId = String(request.data?.competitionId || '').trim();
    const startNumber = String(request.data?.startNumber ?? '').trim();
    if (!isValidCompetitionId(competitionId) || !/^[\w-]{1,20}$/.test(startNumber)) {
        throw new HttpsError('invalid-argument', 'Ogiltig tävling eller ogiltigt startnummer.');
    }
    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
    await assertCanMaintainResults(request, competition, 'Endast tävlingens administratörer får ta bort resultatlås.');
    if (isArchivedCompetition(competition.data)) {
        throw new HttpsError('failed-precondition', 'Tävlingen är arkiverad. Öppna tävlingen igen innan ekipage raderas.');
    }
    const uid = request.auth.uid;
    const byName = String(request.auth.token?.name || request.auth.token?.email || '').slice(0, 200) || null;
    const removed = [];
    const batch = db.batch();
    for (const discipline of ['dressage', 'marathon', 'precision']) {
        const lockRef = db.doc(`competitions/${competitionId}/${discipline}Finalization/${startNumber}`);
        const snap = await lockRef.get();
        if (!snap.exists) continue;
        batch.delete(lockRef);
        batch.set(db.collection(`competitions/${competitionId}/finalizationLog`).doc(), {
            discipline,
            action: 'unfinalize',
            startNumber,
            by: uid,
            byName,
            at: FieldValue.serverTimestamp(),
            reason: 'Ekipaget raderades: resultatlåset togs bort.'
        });
        removed.push(discipline);
    }
    if (removed.length) await batch.commit();
    logger.info('Resultatlås borttagna för ekipage som raderas', { competitionId, startNumber, disciplines: removed, by: uid });
    return { removed };
});

// Self-service account deletion ("Radera mitt konto"). Refused while the user
// owns a competition. Removes the user's roles in competitions (admins docs,
// roleEmails, admins[]/staffUids), the users doc and the Auth account, and
// removes the contact details from the user's driver entries in archived
// competitions. Results are never touched.
const ACCOUNT_DELETION_MAX_AUTH_AGE_MS = 10 * 60 * 1000;
const DELETED_USER_NAME = 'Raderad användare';
const SELF_MAIL_KINDS = ['test', 'volunteerConfirmation', 'replyToVerification'];

// The account's traces in the competitions' private staff data (deleteMyAccount):
// its field devices are removed, its name in staff notifications and the
// incident log is replaced, and queued mail to the account's address alone
// (test mails, its sign-up confirmation) is removed. email: '' when unverified.
async function removeStaffTraces(competitions, { uid, email, writer }) {
    const counts = { devicesRemoved: 0, namesReplaced: 0, mailsRemoved: 0 };
    for (const competition of competitions) {
        const priv = (name) => db.collection(`artifacts/${competition.appId}/private/data/competitions/${competition.id}/${name}`);
        const [devices, noticesBy, noticesAck, incidentsBy, incidentsUpd, selfMail, pauseEvents] = await Promise.all([
            priv('devices').where('uid', '==', uid).get(),
            priv('staffNotifications').where('createdBy', '==', uid).get(),
            priv('staffNotifications').where('ackBy', '==', uid).get(),
            priv('incidents').where('createdBy', '==', uid).get(),
            priv('incidents').where('updatedBy', '==', uid).get(),
            priv('mailQueue').where('kind', 'in', SELF_MAIL_KINDS).get(),
            priv('pauseEvents').where('by.uid', '==', uid).get()
        ]);
        devices.docs.forEach((d) => { writer.delete(d.ref); counts.devicesRemoved++; });
        // One update per document (created and updated by the same account)
        const updates = new Map();
        const rename = (snap, field) => snap.docs.forEach((d) => {
            if (d.data()?.[field] === undefined || d.data()?.[field] === DELETED_USER_NAME) return;
            const entry = updates.get(d.ref.path) || { ref: d.ref, fields: {} };
            entry.fields[field] = DELETED_USER_NAME;
            updates.set(d.ref.path, entry);
            counts.namesReplaced++;
        });
        rename(noticesBy, 'createdByName');
        rename(noticesAck, 'ackByName');
        rename(incidentsBy, 'createdByName');
        rename(incidentsUpd, 'updatedByName');
        // Pause events: who pressed (by.name), as a field path
        pauseEvents.docs.forEach((d) => {
            if (d.data()?.by?.name === undefined || d.data()?.by?.name === DELETED_USER_NAME) return;
            updates.set(d.ref.path, { ref: d.ref, fields: { 'by.name': DELETED_USER_NAME } });
            counts.namesReplaced++;
        });
        updates.forEach(({ ref, fields }) => writer.update(ref, fields));
        selfMail.docs.forEach((d) => {
            const mail = d.data() || {};
            const to = Array.isArray(mail.to) ? mail.to : [];
            const onlyMe = email && to.length > 0 && to.every((r) => String(r?.email || '').toLowerCase() === email);
            if (onlyMe || (mail.kind === 'test' && mail.createdBy === uid)) {
                writer.delete(d.ref);
                counts.mailsRemoved++;
            }
        });
    }
    return counts;
}

export const deleteMyAccount = onCall({ timeoutSeconds: 300, maxInstances: 2 }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    const uid = request.auth.uid;
    const email = String(request.auth.token?.email || '').trim().toLowerCase();
    const confirmEmail = String(request.data?.confirmEmail || '').trim().toLowerCase();
    if (!email || confirmEmail !== email) {
        throw new HttpsError('invalid-argument', 'Skriv din e-postadress exakt som den är registrerad för att bekräfta.');
    }
    const authTimeMs = Number(request.auth.token?.auth_time || 0) * 1000;
    if (!authTimeMs || Date.now() - authTimeMs > ACCOUNT_DELETION_MAX_AUTH_AGE_MS) {
        throw new HttpsError('failed-precondition', 'Logga in på nytt (lösenordet) och försök igen.', { reauthenticate: true });
    }
    // Email-based links count only for a verified address: someone else's
    // unverified account with the address must not remove that person's roles
    const emailVerified = request.auth.token?.email_verified === true;

    const competitions = await listAllCompetitionsIn(db);
    const owned = competitions.filter((c) => c.data?.createdBy === uid || c.data?.ownerId === uid);
    if (owned.length) {
        const plan = buildAccountDeletionPlan({ uid, email, ownedCompetitions: owned.map((c) => ({ path: c.ref.path, name: c.data?.name })) });
        throw new HttpsError('failed-precondition',
            `Du äger ${plan.ownedCompetitions.length} tävling(ar): ${plan.ownedCompetitions.join(', ')}. Överlåt eller radera dem först.`,
            { ownedCompetitions: plan.ownedCompetitions });
    }

    const adminDocs = [];
    const roleEmailDocs = [];
    const driverEntries = [];
    for (const competition of competitions) {
        const archived = isArchivedCompetitionData(competition.data);
        const reads = [competition.ref.collection('admins').doc(uid).get()];
        if (emailVerified) {
            reads.push(
                competition.ref.collection('roleEmails').doc(email).get(),
                competition.ref.collection('admins').where('email', '==', email).get(),
                ...DRIVER_EMAIL_FIELDS.map((field) => competition.ref.collection('equipagePrivate').where(field, '==', email).get())
            );
        }
        const [ownAdmin, roleEmail, adminsByEmail, ...entrySnaps] = await Promise.all(reads);
        if (ownAdmin.exists) adminDocs.push({ path: ownAdmin.ref.path });
        if (roleEmail?.exists) roleEmailDocs.push({ path: roleEmail.ref.path });
        adminsByEmail?.docs.forEach((d) => adminDocs.push({ path: d.ref.path }));
        const entries = new Map();
        entrySnaps.flatMap((snap) => snap.docs).forEach((d) => entries.set(d.ref.path, d));
        entries.forEach((d) => driverEntries.push({ path: d.ref.path, data: d.data(), archived }));
    }
    const plan = buildAccountDeletionPlan({
        uid,
        email: emailVerified ? email : '',
        adminDocs,
        roleEmailDocs,
        memberCompetitions: competitions.map((c) => ({ path: c.ref.path, data: c.data })),
        driverEntries
    });

    const writer = db.bulkWriter();
    plan.deletePaths.forEach((path) => writer.delete(db.doc(path)));
    plan.arrayRemovals.forEach(({ path, fields }) => writer.update(db.doc(path),
        Object.fromEntries(fields.map((field) => [field, FieldValue.arrayRemove(uid)]))));
    plan.anonymize.forEach(({ path, fields }) => writer.update(db.doc(path), {
        ...Object.fromEntries(fields.map((field) => [field, FieldValue.delete()])),
        contactRemovedAt: Date.now()
    }));
    const staffTraces = await removeStaffTraces(competitions, { uid, email: emailVerified ? email : '', writer });
    await writer.close();
    // users/{uid} with its subcollections (driverCompetitions/*: the Storage
    // access pointers getDriverInbox writes)
    await db.recursiveDelete(db.doc(plan.userDocPath));
    // The account's devices for push notifications
    await deleteUserTokens(db, uid);
    // Last: a failure above leaves the account, so the user can try again
    try {
        await adminAuth.deleteUser(uid);
    } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
    }

    const summary = {
        rolesRemoved: plan.deletePaths.length,
        competitionsUnlisted: plan.arrayRemovals.length,
        entriesAnonymized: plan.anonymize.length,
        activeEntriesKept: plan.keptActiveEntries.length,
        ...staffTraces
    };
    await db.collection('accountDeletions').add({
        uidHash: createHash('sha256').update(uid).digest('hex').slice(0, 16),
        deletedAt: Date.now(),
        ...summary
    });
    logger.info('Konto raderat på användarens begäran', summary);
    return { deleted: true, ...summary };
});

// An access request (GDPR Art. 15): everything the competitions the caller
// administers hold about one email address (private collections and the
// documents belonging to the same entry), as JSON for the admin to send on.
const PERSON_EXPORT_MAX_COMPETITIONS = 300;
export const exportPersonData = onCall({ timeoutSeconds: 300, memory: '512MiB', maxInstances: 2 }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    const email = String(request.data?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) throw new HttpsError('invalid-argument', 'Ogiltig e-postadress.');

    const all = await listAllCompetitionsIn(db);
    const managed = [];
    for (const competition of all) {
        try {
            await assertCanMaintainResults(request, competition);
            managed.push(competition);
        } catch {
            // Not one of the caller's competitions
        }
        if (managed.length >= PERSON_EXPORT_MAX_COMPETITIONS) break;
    }
    if (!managed.length) {
        throw new HttpsError('permission-denied', 'Du administrerar ingen tävling.');
    }

    const competitions = [];
    for (const competition of managed) {
        const found = new Map();
        for (const search of PERSON_SEARCH) {
            const collectionRef = competition.ref.collection(search.collection);
            const snaps = await Promise.all([
                ...search.fields.map((field) => collectionRef.where(field, '==', email).get().then((s) => s.docs)),
                search.byId ? collectionRef.doc(email).get().then((d) => (d.exists ? [d] : [])) : Promise.resolve([])
            ]);
            const docs = snaps.flat().filter((d) => search.byId && d.id === email ? true : matchesPerson(d.data(), search.fields, email));
            for (const d of docs) {
                found.set(d.ref.path, d.data());
                const related = await Promise.all(search.related.map((name) => competition.ref.collection(name).doc(d.id).get()));
                related.filter((r) => r.exists).forEach((r) => found.set(r.ref.path, r.data()));
            }
        }
        competitions.push({
            id: competition.id,
            name: competition.data?.name || '',
            documents: [...found.entries()].map(([path, data]) => ({ path, data }))
        });
    }
    // The account itself, for a global admin (users are not listed otherwise)
    let user = null;
    const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (isGlobalAdminIdentity(request.auth.token || {}, callerSnap.exists ? callerSnap.data() : {})) {
        const usersSnap = await db.collection('users').where('email', '==', email).limit(5).get();
        if (!usersSnap.empty) user = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    }
    const result = buildPersonExport({ email, competitions, user, exportedBy: request.auth.uid });
    logger.info('Personuppgifter exporterade (registerutdrag)', {
        by: request.auth.uid,
        competitions: result.competitionCount,
        documents: result.documentCount
    });
    return result;
});

// --- E-MAIL ---
// All mail goes from one app address (serverSettings/email, server only) with
// "<Klubbnamn> via DriveLive" as the name and the club's checked address as
// Reply-To. Mails are queued per competition (mailQueue, private tree) and
// sent by onMailQueued; recipients are resolved here from the competition's
// own documents, never taken from a client. Pure parts: src/mail/mailCore.js;
// queue processing: src/mail/mailService.js; providers: src/mail/providers.js.
// Until a provider is configured, mails wait as 'not_configured'.

const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The fake provider only in the emulator: it records messages in mailFakeOutbox
function mailProviderFactory(settings) {
    if (settings?.provider === 'fake' && !IS_FUNCTIONS_EMULATOR) return null;
    return createMailProvider(settings, {
        fake: {
            sink: (message) => db.collection('mailFakeOutbox').add({
                from: message.from,
                replyTo: message.replyTo || null,
                to: message.to,
                subject: message.subject,
                text: message.text,
                headers: message.headers || {},
                at: Date.now()
            })
        }
    });
}

const mailContext = () => ({ db, FieldValue, logger, providerFactory: mailProviderFactory });

function mailHttpsError(error) {
    if (error instanceof MailError) return new HttpsError('invalid-argument', error.message);
    return error;
}

async function isSuperadminRequest(request) {
    const token = request.auth?.token || {};
    const roles = Array.isArray(token.roles) ? token.roles : [];
    if (token.superadmin === true || token.role === 'superadmin' || roles.includes('superadmin')) return true;
    const userSnap = await db.doc(`users/${request.auth.uid}`).get();
    const user = userSnap.exists ? userSnap.data() : {};
    return user.role === 'superadmin' || (Array.isArray(user.roles) && user.roles.includes('superadmin'));
}

async function assertSuperadmin(request) {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    if (!(await isSuperadminRequest(request))) {
        throw new HttpsError('permission-denied', 'Endast superadministratören får hantera e-postinställningarna.');
    }
}

async function loadMailCompetition(request) {
    const competitionId = String(request.data?.competitionId || '').trim();
    if (!isValidCompetitionId(competitionId)) throw new HttpsError('invalid-argument', 'Ogiltigt tävlings-ID.');
    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
    return { competitionId, competition };
}

/**
 * 'admin' for the competition's admins (the secretariat), 'td' for its
 * technical delegate when tdAllowed; else permission-denied.
 */
async function assertMailRole(request, competition, { tdAllowed = true } = {}) {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    try {
        await assertCanMaintainResults(request, competition);
        return 'admin';
    } catch (error) {
        if (!(error instanceof HttpsError) || error.code !== 'permission-denied') throw error;
    }
    if (tdAllowed) {
        const email = String(request.auth.token?.email || '').trim().toLowerCase();
        const verified = request.auth.token?.email_verified === true;
        const [adminSnap, roleEmailSnap] = await Promise.all([
            competition.ref.collection('admins').doc(request.auth.uid).get(),
            verified && email ? competition.ref.collection('roleEmails').doc(email).get() : Promise.resolve(null)
        ]);
        const rolesOf = (snap) => {
            const data = snap?.exists ? snap.data() : {};
            return [data.role, ...(Array.isArray(data.roles) ? data.roles : [])];
        };
        if ([...rolesOf(adminSnap), ...rolesOf(roleEmailSnap)].includes('td')) return 'td';
    }
    throw new HttpsError('permission-denied', tdAllowed
        ? 'Endast tävlingens administratörer, sekretariat eller TD får skicka e-post.'
        : 'Endast tävlingens administratörer får göra detta.');
}

// Fixed-window counters (rateLimits, private tree): all checked and counted
// together, or none
async function consumeMailRateLimits(appId, competitionId, checks, now) {
    const limitsRef = db.collection(`artifacts/${appId}/private/data/competitions/${competitionId}/rateLimits`);
    return db.runTransaction(async (tx) => {
        const refs = checks.map((check) => limitsRef.doc(check.id));
        const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
        const results = checks.map((check, i) => nextCounter(snaps[i].exists ? snaps[i].data() : null, now, check.limit, check.windowMs));
        if (results.some((result) => !result.allowed)) return false;
        results.forEach((result, i) => tx.set(refs[i], result.next));
        return true;
    });
}

// Bulk sends per user and per competition (whoever sends: a role code shared
// by several accounts does not multiply them)
async function assertMailQueueRate(appId, competitionId, uid, now) {
    const allowed = await consumeMailRateLimits(appId, competitionId, [
        { id: `mail_user_${uid}`, limit: MAIL_LIMITS.perUserHour, windowMs: HOUR_MS },
        { id: 'mail_queue_hour', limit: MAIL_LIMITS.perCompetitionHour, windowMs: HOUR_MS },
        { id: 'mail_queue_day', limit: MAIL_LIMITS.perCompetitionDay, windowMs: DAY_MS }
    ], now);
    if (!allowed) throw new HttpsError('resource-exhausted', 'För många utskick just nu. Försök igen senare.');
}

/**
 * Queues a mail to the competition's drivers and/or officials, or a test mail
 * to the caller. Admins, the secretariat and the TD.
 * { competitionId, kind: 'message'|'test', category?: 'info'|'essential',
 *   audience?: { drivers?, officials? } (not for 'test'), subject, text, html? }
 * -> { mailId, status: 'queued' }
 */
export const queueCompetitionMail = onCall({ maxInstances: 5 }, async (request) => {
    const { competitionId, competition } = await loadMailCompetition(request);
    const role = await assertMailRole(request, competition);
    const kind = String(request.data?.kind || 'message');
    if (!['message', 'test'].includes(kind)) throw new HttpsError('invalid-argument', 'Okänd typ av utskick.');
    let content;
    let audience = null;
    let to = null;
    const essential = kind === 'test' || request.data?.category === 'essential';
    let reason = null;
    try {
        // The competition's own message: its addresses may be links
        content = validateMailContent(request.data || {}, { linkify: kind === 'message' });
        // An essential message reaches those who opted out: who and why is logged
        if (kind === 'message' && essential) reason = normalizeEssentialReason(request.data?.reason);
        if (kind === 'test') {
            const email = String(request.auth.token?.email || '').trim().toLowerCase();
            if (!email || request.auth.token?.email_verified !== true) {
                throw new HttpsError('failed-precondition', 'Bekräfta din e-postadress för att skicka ett testmejl.');
            }
            to = [{ email, name: String(request.auth.token?.name || '') }];
        } else {
            audience = normalizeAudience(request.data?.audience);
        }
    } catch (error) {
        throw mailHttpsError(error);
    }
    const now = Date.now();
    await assertMailQueueRate(competition.appId, competitionId, request.auth.uid, now);
    const ref = await enqueueMail({
        db, FieldValue, appId: competition.appId, compId: competitionId, now,
        mail: {
            kind,
            category: essential ? 'essential' : 'info',
            ...content,
            audience,
            to,
            reason,
            createdBy: request.auth.uid,
            createdByRole: role
        }
    });
    logger.info('E-post köad', { competitionId, mailId: ref.id, kind, essential, reason, by: request.auth.uid, role });
    return { mailId: ref.id, status: 'queued' };
});

/**
 * The recipients an audience gives, without sending: counts only, plus the
 * entries without an address. { competitionId, audience, category? }
 * -> { recipientCount, optedOutCount, withoutEmail: [{ type, id }], unknownStartNumbers }
 */
export const previewMailAudience = onCall({ maxInstances: 5 }, async (request) => {
    const { competitionId, competition } = await loadMailCompetition(request);
    await assertMailRole(request, competition);
    let audience;
    try {
        audience = normalizeAudience(request.data?.audience);
    } catch (error) {
        throw mailHttpsError(error);
    }
    const resolved = await resolveMailRecipients(db, competition.appId, competitionId, { audience });
    const essential = request.data?.category === 'essential';
    const optedOut = essential ? new Set() : await readOptOuts(db, competition.appId, competitionId, resolved.recipients);
    const { recipients, skipped } = filterOptOuts(resolved.recipients, optedOut, essential);
    return {
        recipientCount: recipients.length,
        optedOutCount: skipped,
        withoutEmail: resolved.withoutEmail,
        unknownStartNumbers: resolved.unknownStartNumbers
    };
});

/**
 * Changed start times by e-mail, after the UI saved the published times: each
 * driver gets the lines of their own start numbers. Admins and the TD.
 * { competitionId, changes: [{ startNumber, text }], subject?, text? }
 * -> { mailId, status: 'queued' }
 */
export const queueStartTimeChangeMail = onCall({ maxInstances: 5 }, async (request) => {
    const { competitionId, competition } = await loadMailCompetition(request);
    const role = await assertMailRole(request, competition);
    let content;
    let personalTexts;
    try {
        personalTexts = normalizePersonalTexts(request.data?.changes);
        // Essential mail to every driver named: no web addresses, nothing linked
        const competitionName = stripLinks(String(competition.data?.name || '').trim());
        content = validateMailContent({
            subject: stripLinks(request.data?.subject) || `Ändrad starttid${competitionName ? ` – ${competitionName}` : ''}`,
            text: stripLinks(request.data?.text) || 'Din starttid har ändrats. Nya tider:'
        });
    } catch (error) {
        throw mailHttpsError(error);
    }
    const now = Date.now();
    await assertMailQueueRate(competition.appId, competitionId, request.auth.uid, now);
    const ref = await enqueueMail({
        db, FieldValue, appId: competition.appId, compId: competitionId, now,
        mail: {
            kind: 'startTimeChange',
            category: 'essential',
            ...content,
            audience: { drivers: { classes: [], startNumbers: Object.keys(personalTexts), includeWithdrawn: true } },
            personalTexts,
            reason: 'Ändrade starttider',
            createdBy: request.auth.uid,
            createdByRole: role
        }
    });
    logger.info('E-post om ändrade starttider köad', { competitionId, mailId: ref.id, equipages: Object.keys(personalTexts).length, by: request.auth.uid });
    return { mailId: ref.id, status: 'queued' };
});

/**
 * Sends a check link to the reply-to address in config/emailSettings; the
 * address is used as Reply-To once the link was confirmed (verifyReplyTo).
 * Competition admins. { competitionId } -> { mailId, address } or { alreadyVerified: true }
 */
export const requestReplyToVerification = onCall({ maxInstances: 3 }, async (request) => {
    const { competitionId, competition } = await loadMailCompetition(request);
    await assertMailRole(request, competition, { tdAllowed: false });
    const settingsSnap = await db.doc(emailSettingsPath(competition.appId, competitionId)).get();
    const settings = readEmailSettings(settingsSnap.exists ? settingsSnap.data() : {});
    if (!isValidMailAddress(settings.replyTo)) {
        throw new HttpsError('failed-precondition', 'Ange en giltig svarsadress i e-postinställningarna först.');
    }
    if (effectiveReplyTo(settings)) return { alreadyVerified: true, address: settings.replyTo };
    const now = Date.now();
    const allowed = await consumeMailRateLimits(competition.appId, competitionId, [
        { id: 'mail_replyto_day', limit: MAIL_LIMITS.replyToChecksPerDay, windowMs: DAY_MS }
    ], now);
    if (!allowed) throw new HttpsError('resource-exhausted', 'För många bekräftelser i dag. Försök igen i morgon.');
    const key = await getSigningKey(db);
    const token = signMailToken({ p: 'r', a: competition.appId, c: competitionId, e: settings.replyTo, x: now + MAIL_LIMITS.replyToTokenMs }, key);
    const linkBase = (await loadProviderSettings(db))?.linkBaseUrl || defaultLinkBaseUrl();
    const content = buildReplyToVerificationMail({ competitionName: competition.data?.name, verifyUrl: `${linkBase}/verifyReplyTo?t=${token}` });
    const ref = await enqueueMail({
        db, FieldValue, appId: competition.appId, compId: competitionId, now,
        mail: {
            kind: 'replyToVerification',
            category: 'essential',
            ...content,
            to: [{ email: settings.replyTo }],
            createdBy: request.auth.uid,
            createdByRole: 'admin'
        }
    });
    return { mailId: ref.id, address: settings.replyTo };
});

/**
 * E-mail status for the competition's mail page: provider configured and on,
 * the sender as recipients see it, the checked Reply-To, today's use.
 * Admins and the TD. { competitionId }
 */
export const getCompetitionMailStatus = onCall({ maxInstances: 5 }, async (request) => {
    const { competitionId, competition } = await loadMailCompetition(request);
    await assertMailRole(request, competition);
    const [providerSettings, settingsSnap, usage] = await Promise.all([
        loadProviderSettings(db),
        db.doc(emailSettingsPath(competition.appId, competitionId)).get(),
        readMailUsage(db, { appId: competition.appId, compId: competitionId })
    ]);
    const status = providerStatus(providerSettings);
    const settings = readEmailSettings(settingsSnap.exists ? settingsSnap.data() : {});
    const comp = competition.data || {};
    return {
        configured: status.configured,
        enabled: status.enabled,
        fromName: buildSenderName(settings.senderName || comp.organizerName || comp.club || comp.name),
        fromAddress: status.fromAddress,
        replyTo: settings.replyTo || null,
        replyToVerified: !!effectiveReplyTo(settings),
        dayKey: usage.dayKey,
        sentToday: usage.competition || 0,
        // The cap that applies (at most a share of the global one)
        dailyLimit: mailQuotaLimits({ kind: 'message' }, providerSettings || {}).competition
    };
});

/**
 * The provider settings (superadmin). { provider: 'brevo', apiKey?,
 * clearApiKey?, fromAddress, fromDomain?, dailyLimit?, competitionDailyLimit?,
 * enabled, linkBaseUrl? }. The API key is write-only: kept when left out,
 * never returned. -> the status as getEmailProviderStatus
 */
export const setEmailProviderSettings = onCall({ maxInstances: 2 }, async (request) => {
    await assertSuperadmin(request);
    const ref = db.doc(SERVER_EMAIL_SETTINGS);
    const existingSnap = await ref.get();
    let settings;
    try {
        settings = normalizeProviderSettings(request.data || {}, existingSnap.exists ? existingSnap.data() : {}, { allowFake: IS_FUNCTIONS_EMULATOR });
    } catch (error) {
        throw mailHttpsError(error);
    }
    await ref.set({ ...settings, updatedAt: Date.now(), updatedBy: request.auth.uid });
    logger.info('E-postinställningar ändrade', { provider: settings.provider, fromAddress: settings.fromAddress, enabled: settings.enabled, by: request.auth.uid });
    const status = providerStatus(settings);
    return { configured: status.configured, provider: status.provider, fromAddress: status.fromAddress, enabled: status.enabled };
});

/**
 * { configured, provider, fromAddress, enabled } plus fromDomain, hasApiKey,
 * the daily limits, today's use and the number of mails waiting for a
 * superadmin (retryQueuedMail). Superadmin.
 */
export const getEmailProviderStatus = onCall({ maxInstances: 2 }, async (request) => {
    await assertSuperadmin(request);
    const [settings, usage, waiting] = await Promise.all([
        loadProviderSettings(db),
        readMailUsage(db),
        listWaitingMail(db, { limit: 500 })
    ]);
    const status = providerStatus(settings);
    return {
        configured: status.configured,
        provider: status.provider,
        fromAddress: status.fromAddress,
        enabled: status.enabled,
        fromDomain: status.fromDomain,
        hasApiKey: status.hasApiKey,
        dailyLimit: status.dailyLimit,
        competitionDailyLimit: status.competitionDailyLimit,
        dayKey: usage.dayKey,
        sentToday: usage.global,
        waiting: {
            notConfigured: waiting.filter((w) => w.reason === 'not_configured').length,
            blocked: waiting.filter((w) => w.reason === 'blocked').length
        }
    };
});

/**
 * A test mail straight to the superadmin's own (verified) address, also while
 * sending is switched off, to check the provider and the domain.
 * {} -> { ok, messageId?, error? }
 */
export const sendTestEmail = onCall({ maxInstances: 2 }, async (request) => {
    await assertSuperadmin(request);
    const email = String(request.auth.token?.email || '').trim().toLowerCase();
    if (!email || request.auth.token?.email_verified !== true) {
        throw new HttpsError('failed-precondition', 'Bekräfta din e-postadress först.');
    }
    const settings = await loadProviderSettings(db);
    const provider = mailProviderFactory(settings ? { ...settings, enabled: true } : null);
    if (!provider || !providerStatus(settings).configured) {
        throw new HttpsError('failed-precondition', 'E-postleverantören är inte konfigurerad.');
    }
    const result = await provider.send({
        from: { email: settings.fromAddress, name: buildSenderName('Test') },
        replyTo: null,
        to: { email, name: '' },
        subject: 'Testmejl från DriveLive',
        text: 'Det här är ett testmejl från DriveLive. Kommer det fram fungerar e-postleverantören och avsändardomänen.',
        html: '<p>Det här är ett testmejl från DriveLive. Kommer det fram fungerar e-postleverantören och avsändardomänen.</p>',
        tags: ['test']
    });
    logger.info('Testmejl skickat', { ok: result.ok, error: result.error || null, by: request.auth.uid });
    return { ok: result.ok, messageId: result.messageId || null, error: result.error || null };
});

/**
 * Sends waiting mails again (superadmin): one mail ({ competitionId,
 * mailId }), or every mail waiting as not_configured or blocked (optionally
 * of one competition). Mails older than maxAgeDays (default 7) are closed as
 * failed instead. -> { results: [{ competitionId, mailId, status }] }
 */
export const retryQueuedMail = onCall({ timeoutSeconds: 540, maxInstances: 1 }, async (request) => {
    await assertSuperadmin(request);
    const maxAgeDays = Number(request.data?.maxAgeDays ?? 7);
    const maxAgeMs = Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays * DAY_MS : null;
    const competitionId = request.data?.competitionId ? String(request.data.competitionId).trim() : '';
    const mailId = request.data?.mailId ? String(request.data.mailId).trim() : '';
    if (competitionId && !isValidCompetitionId(competitionId)) throw new HttpsError('invalid-argument', 'Ogiltigt tävlings-ID.');
    if (mailId && !/^[A-Za-z0-9_-]{1,128}$/.test(mailId)) throw new HttpsError('invalid-argument', 'Ogiltigt mejl-ID.');
    let targets;
    if (mailId) {
        if (!competitionId) throw new HttpsError('invalid-argument', 'Tävlings-ID saknas.');
        const competition = await getCompetitionArtifactsDoc(competitionId);
        if (!competition) throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
        targets = [{ appId: competition.appId, compId: competitionId, mailId }];
    } else {
        targets = (await listWaitingMail(db, { limit: 200 })).filter((t) => !competitionId || t.compId === competitionId).slice(0, 50);
    }
    const results = [];
    for (const target of targets) {
        const result = await requeueMail({ ...mailContext(), ...target, now: Date.now(), maxAgeMs });
        results.push({ competitionId: target.compId, mailId: target.mailId, status: result.status });
    }
    logger.info('Köade mejl skickade igen', { count: results.length, by: request.auth.uid });
    return { results };
});

// Sends a queued mail. No Functions retry (a retry setting would make the
// next deploy need --force): failed deliveries get a retry time of their own
// (processMailRetries)
export const onMailQueued = onDocumentCreated(
    { document: "artifacts/{appId}/private/data/competitions/{compId}/mailQueue/{mailId}", timeoutSeconds: 300, maxInstances: 3 },
    async (event) => {
        if (!event.data) return;
        const { appId, compId } = event.params;
        await processMailDoc({ ...mailContext(), ref: event.data.ref, appId, compId, now: Date.now() });
    }
);

export const processMailRetries = onSchedule(
    { schedule: 'every 10 minutes', timeZone: 'Europe/Stockholm', timeoutSeconds: 300, maxInstances: 1 },
    async () => {
        const results = await processDueMailRetries({ ...mailContext(), now: Date.now() });
        if (results.length) logger.info('E-post: nya försök', { count: results.length });
    }
);

function sendMailPage(res, status, page) {
    res.set(MAIL_PAGE_HEADERS);
    res.status(status).send(renderMailPage(page));
}

const validLinkTarget = (payload) => !!payload
    && /^[A-Za-z0-9_-]{1,64}$/.test(String(payload.a || ''))
    && isValidCompetitionId(String(payload.c || ''));

/**
 * The unsubscribe link of information mail (also the List-Unsubscribe
 * header, one-click POST). GET shows a button; POST records the opt-out for
 * the competition (mailOptOuts, by address hash).
 */
export const unsubscribeEmail = onRequest({ maxInstances: 2 }, async (req, res) => {
    const token = String(req.query?.t || req.body?.t || '');
    const payload = verifyMailToken(token, await getSigningKey(db), 'u');
    if (!validLinkTarget(payload)) {
        sendMailPage(res, 400, { title: 'Ogiltig länk', message: 'Länken är ogiltig eller har gått ut.' });
        return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
        sendMailPage(res, 200, {
            title: 'Avsluta utskick',
            message: 'Vill du sluta få informationsutskick från den här tävlingen? Viktiga besked om din start, som ändrade starttider och veterinärbeslut, skickas ändå.',
            form: { action: '', token, button: 'Avsluta utskicken' }
        });
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('');
        return;
    }
    const done = await recordOptOut(db, { appId: payload.a, compId: payload.c, hash: payload.h });
    sendMailPage(res, done ? 200 : 404, done
        ? { title: 'Klart', message: 'Du får inte längre informationsutskick från den här tävlingen. Viktiga besked om din start skickas fortfarande.' }
        : { title: 'Tävlingen finns inte', message: 'Tävlingen finns inte längre, så inga fler utskick kommer därifrån.' });
});

/**
 * The link in the reply-to check (requestReplyToVerification). GET shows a
 * button; POST marks the address checked if it is still the one set.
 */
export const verifyReplyTo = onRequest({ maxInstances: 2 }, async (req, res) => {
    const token = String(req.query?.t || req.body?.t || '');
    const payload = verifyMailToken(token, await getSigningKey(db), 'r');
    if (!validLinkTarget(payload) || !isValidMailAddress(payload.e)) {
        sendMailPage(res, 400, { title: 'Ogiltig länk', message: 'Länken är ogiltig eller har gått ut. Be om en ny bekräftelse i e-postinställningarna.' });
        return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
        sendMailPage(res, 200, {
            title: 'Bekräfta svarsadress',
            message: `Bekräfta att ${payload.e} får användas som svarsadress för tävlingens e-post.`,
            form: { action: '', token, button: 'Bekräfta adressen' }
        });
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('');
        return;
    }
    const outcome = await markReplyToVerified(db, { appId: payload.a, compId: payload.c, address: payload.e });
    const pages = {
        verified: { title: 'Adressen är bekräftad', message: `Svar på tävlingens e-post går nu till ${payload.e}.` },
        changed: { title: 'Adressen har ändrats', message: 'Svarsadressen i inställningarna är inte längre den här adressen. Be om en ny bekräftelse.' },
        missing: { title: 'Inställningar saknas', message: 'Tävlingens e-postinställningar finns inte längre.' }
    };
    sendMailPage(res, outcome === 'verified' ? 200 : 409, pages[outcome]);
});

// --- PUSH NOTIFICATIONS (Firebase Cloud Messaging, web push) ---
// The same people as e-mail: audiences are resolved here from the
// competition's own documents and matched to the devices registered by
// signed-in accounts (drivers by their verified address, officials by their
// roles). Pure parts: src/push/pushCore.js; sending: src/push/pushService.js.
// Nothing is sent until a superadmin saved the public VAPID key and switched
// push on (setPushSettings -> appSettings/push). No Functions retry (a retry
// setting would make the next deploy need --force); triggers are idempotent
// by event id (pushLog).

let messagingClient = null;
function pushMessaging() {
    if (!messagingClient) messagingClient = getMessaging();
    return messagingClient;
}

// A push never fails the trigger or callable it rides on
async function safePush(label, send, context = {}) {
    try {
        const result = await send();
        if (result && !['disabled', 'no_tokens', 'no_targets', 'duplicate'].includes(result.status)) {
            logger.info('Push skickad', { label, ...context, status: result.status, sent: result.sent || 0, failed: result.failed || 0 });
        }
        return result;
    } catch (error) {
        logger.error('Push misslyckades', { label, ...context, error: String(error?.message || error) });
        return { status: 'error' };
    }
}

function pushHttpsError(error) {
    if (error instanceof PushError) return new HttpsError('invalid-argument', error.message);
    return error;
}

// Fixed-window counters per account (top-level rateLimits: the retention run
// removes stale ones)
async function consumeUserRateLimit(id, limit, windowMs) {
    const ref = db.collection('rateLimits').doc(id);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const result = nextCounter(snap.exists ? snap.data() : null, Date.now(), limit, windowMs);
        if (!result.allowed) return false;
        tx.set(ref, result.next);
        return true;
    });
}

async function optionalPushCompetition(request) {
    const competitionId = String(request.data?.competitionId || '').trim();
    if (!competitionId) return null;
    if (!isValidCompetitionId(competitionId)) throw new HttpsError('invalid-argument', 'Ogiltigt tävlings-ID.');
    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) throw new HttpsError('not-found', 'Tävlingen kunde inte hittas.');
    return { appId: competition.appId, compId: competitionId };
}

const pushSettingsView = (settings) => ({
    configured: !!settings?.vapidKey,
    enabled: pushAvailable(settings),
    vapidKey: settings?.vapidKey || null,
    appUrl: settings?.appUrl || null,
    competitionDailyLimit: Number(settings?.competitionDailyLimit) || PUSH_LIMITS.competitionDailyDefault
});

/**
 * The push settings (superadmin): { vapidKey?, clearVapidKey?, enabled?,
 * appUrl?, competitionDailyLimit? }. The VAPID key is the public key of the
 * Firebase project's Web Push certificate (not a secret: clients read it from
 * appSettings/push). Fields left out are kept.
 * -> { configured, enabled, vapidKey, appUrl, competitionDailyLimit }
 */
export const setPushSettings = onCall({ maxInstances: 2 }, async (request) => {
    await assertSuperadmin(request);
    let settings;
    try {
        settings = await savePushSettings(db, request.data || {}, { uid: request.auth.uid });
    } catch (error) {
        throw pushHttpsError(error);
    }
    logger.info('Push-inställningar ändrade', { configured: !!settings.vapidKey, enabled: settings.enabled, by: request.auth.uid });
    return pushSettingsView(settings);
});

/** The settings and the number of registered devices (superadmin) */
export const getPushAdminStatus = onCall({ maxInstances: 2 }, async (request) => {
    await assertSuperadmin(request);
    const [settings, countSnap] = await Promise.all([
        loadPushSettings(db),
        db.collection(PUSH_TOKENS).count().get()
    ]);
    return { ...pushSettingsView(settings), devices: countSnap.data().count };
});

/**
 * Registers this device's FCM token for the signed-in account, or updates its
 * topics and competitions. { token, topics?: PUSH_TOPICS subset (left out:
 * kept), competitionId? (follow that competition too), platform?, lang? }
 * -> { registered, topics, competitions: [competitionId], lang, lastSeenMs }
 * Called again when the app starts (refreshes lastSeenMs: unseen devices are
 * dropped after 60 days).
 */
export const registerPushToken = onCall({ maxInstances: 5 }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    const token = String(request.data?.token || '');
    if (!isValidPushToken(token)) throw new HttpsError('invalid-argument', 'Ogiltig push-token.');
    let topics = null;
    if (request.data?.topics !== undefined && request.data?.topics !== null) {
        try {
            topics = normalizeTopics(request.data.topics);
        } catch (error) {
            throw pushHttpsError(error);
        }
    }
    const competition = await optionalPushCompetition(request);
    if (!(await consumeUserRateLimit(`push_register_${request.auth.uid}`, PUSH_LIMITS.registerPerUserHour, HOUR_MS))) {
        throw new HttpsError('resource-exhausted', 'För många försök just nu. Försök igen senare.');
    }
    const verified = request.auth.token?.email_verified === true;
    return registerPushTokenIn(db, {
        uid: request.auth.uid,
        email: verified ? String(request.auth.token?.email || '').trim().toLowerCase() : '',
        token,
        // The browser renewed the token: the old one's topics and competitions carry over
        previousToken: isValidPushToken(String(request.data?.previousToken || '')) ? String(request.data.previousToken) : null,
        topics,
        platform: request.data?.platform,
        lang: request.data?.lang,
        competition,
        logger
    });
});

/**
 * Stops pushes to this device: from one competition ({ token, competitionId })
 * or altogether ({ token }). -> { removed, scope? }
 */
export const unregisterPushToken = onCall({ maxInstances: 5 }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    const token = String(request.data?.token || '');
    if (!isValidPushToken(token)) throw new HttpsError('invalid-argument', 'Ogiltig push-token.');
    const competition = await optionalPushCompetition(request);
    return unregisterPushTokenIn(db, FieldValue, { token, competition });
});

/**
 * This device's registration as the server has it. { token, competitionId? }
 * -> { registered, topics, competitions, lang, lastSeenMs, following? }
 */
export const getPushRegistration = onCall({ maxInstances: 5 }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    const token = String(request.data?.token || '');
    if (!isValidPushToken(token)) throw new HttpsError('invalid-argument', 'Ogiltig push-token.');
    const competition = await optionalPushCompetition(request);
    const registration = await readPushRegistration(db, { token, uid: request.auth.uid, appId: competition?.appId || null });
    return competition ? { ...registration, following: registration.competitions.includes(competition.compId) } : registration;
});

/** A test notification to the caller's own devices. {} -> { status, sent, failed } */
export const sendTestPush = onCall({ maxInstances: 2 }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inloggning krävs.');
    if (!(await consumeUserRateLimit(`push_test_${request.auth.uid}`, PUSH_LIMITS.testPerUserHour, HOUR_MS))) {
        throw new HttpsError('resource-exhausted', 'För många testnotiser just nu. Försök igen senare.');
    }
    const result = await sendPushToUser(db, pushMessaging(), {
        uid: request.auth.uid,
        title: { sv: 'Testnotis från DriveLive', en: 'Test notification from DriveLive' },
        body: { sv: 'Push-notiser fungerar på den här enheten.', en: 'Push notifications work on this device.' },
        url: '#hub',
        tag: 'test',
        logger
    });
    return { status: result.status, sent: result.sent || 0, failed: result.failed || 0 };
});

/**
 * Changed start times as push notices: each driver's devices get the lines of
 * their own start numbers (topic startTimes). Admins and the TD, after the UI
 * saved the published times (next to queueStartTimeChangeMail).
 * { competitionId, changes: [{ startNumber, text, textEn? }] }
 * -> { status, targeted, sent, failed }
 */
export const notifyStartTimeChange = onCall({ maxInstances: 5, timeoutSeconds: 300 }, async (request) => {
    const { competitionId, competition } = await loadMailCompetition(request);
    const role = await assertMailRole(request, competition);
    let texts;
    try {
        // The lines without web addresses (an essential notice to drivers)
        const changes = Array.isArray(request.data?.changes)
            ? request.data.changes.map((change) => (change && typeof change === 'object'
                ? {
                    ...change,
                    text: stripLinks(change.text),
                    ...(change.textEn !== undefined && change.textEn !== null ? { textEn: stripLinks(change.textEn) } : {})
                }
                : change))
            : request.data?.changes;
        texts = normalizeStartTimeChanges(changes);
    } catch (error) {
        throw pushHttpsError(error);
    }
    if (!(await consumeUserRateLimit(`push_notify_${request.auth.uid}`, PUSH_LIMITS.notifyPerUserHour, HOUR_MS))) {
        throw new HttpsError('resource-exhausted', 'För många utskick just nu. Försök igen senare.');
    }
    // Per competition too, whoever sends (as the start time mail)
    const competitionAllowed = await consumeMailRateLimits(competition.appId, competitionId, [
        { id: 'push_notify_hour', limit: MAIL_LIMITS.perCompetitionHour, windowMs: HOUR_MS },
        { id: 'push_notify_day', limit: MAIL_LIMITS.perCompetitionDay, windowMs: DAY_MS }
    ], Date.now());
    if (!competitionAllowed) {
        throw new HttpsError('resource-exhausted', 'För många utskick från tävlingen just nu. Försök igen senare.');
    }
    const startNumbers = Object.keys(texts);
    const result = await safePush('startTimes', () => sendPushToAudience(db, pushMessaging(), {
        appId: competition.appId,
        compId: competitionId,
        audience: { drivers: { classes: [], startNumbers, includeWithdrawn: true } },
        category: 'essential',
        topic: 'startTimes',
        content: (target, lang) => buildStartTimeContent(texts, target.startNumbers.filter((s) => startNumbers.includes(s)), lang),
        url: `#portal?id=${encodeURIComponent(competitionId)}`,
        tag: 'start-time',
        source: 'startTimeChange',
        createdBy: request.auth.uid,
        logger
    }), { competitionId, by: request.auth.uid, role, reason: 'Ändrade starttider' });
    return {
        status: result.status,
        targeted: result.targeted || 0,
        sent: result.sent || 0,
        failed: result.failed || 0
    };
});

// A competition message (admin → Kommunikation) as a push notice to its
// audience (topic messages). Not for messages written by the server for its
// own notices (vet decisions) or the start time offer (source
// 'startTimeChange': notifyStartTimeChange sends each driver their own
// times), nor for a message with push: false. category 'essential' reaches
// devices that switched messages off.
export const onCompetitionMessageCreated = onDocumentCreated(
    "artifacts/{appId}/public/data/competitions/{compId}/messages/{msgId}",
    async (event) => {
        const message = event.data?.data();
        if (!message || message.push === false) return;
        if (['vetDecision', 'startTimeChange'].includes(message.source)) return;
        const { appId, compId, msgId } = event.params;
        await safePush('messages', () => sendPushToAudience(db, pushMessaging(), {
            appId, compId,
            audience: messagePushAudience(message),
            category: message.category === 'essential' ? 'essential' : 'info',
            topic: 'messages',
            content: (_target, lang) => buildMessageContent(message, lang),
            tag: `msg-${msgId}`.slice(0, 64),
            source: 'message',
            dedupeKey: `msg-${event.id}`,
            logger
        }), { competitionId: compId, messageId: msgId });
    }
);

// A global pause started or ended (config/globalStatus.pauseLog): every
// official of the competition who follows pauses, urgently and short-lived
export const onGlobalPausePush = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/config/globalStatus",
    async (event) => {
        const transitions = pauseTransitions(beforeData(event)?.pauseLog, afterData(event)?.pauseLog);
        const { appId, compId } = event.params;
        for (const { kind, entry } of transitions) {
            await safePush('pause', () => sendPushToAudience(db, pushMessaging(), {
                appId, compId,
                audience: { officials: { all: true } },
                category: 'essential',
                topic: 'pause',
                content: (_target, lang) => buildPauseContent(kind, entry, lang),
                tag: 'pause',
                source: `pause-${kind}`,
                dedupeKey: `pause-${kind}-${String(entry.start)}`,
                logger
            }), { competitionId: compId, kind });
        }
    }
);

// A driver changed the declaration (staffNotifications, written by
// updateEquipageDeclaration): the secretariat, the TD and the vet
export const onStaffNotificationCreated = onDocumentCreated(
    "artifacts/{appId}/private/data/competitions/{compId}/staffNotifications/{noticeId}",
    async (event) => {
        const notice = event.data?.data();
        if (!notice || notice.kind !== 'declarationChange') return;
        const { appId, compId, noticeId } = event.params;
        await safePush('declarationChanges', () => sendPushToAudience(db, pushMessaging(), {
            appId, compId,
            audience: { officials: { roles: ['admin', 'td', 'vet'] } },
            category: 'info',
            topic: 'declarationChanges',
            content: (_target, lang) => buildDeclarationChangeContent(notice, lang),
            tag: `decl-${String(notice.startNumber || '')}`.slice(0, 64),
            source: 'declarationChange',
            dedupeKey: `decl-${noticeId}`,
            logger
        }), { competitionId: compId, noticeId });
    }
);
