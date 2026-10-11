/**
 * Cloud Functions for Combined Driving
 * Defines triggers to recalculate results on data changes.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

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
    const record = await calculateEquipageRecord(compRef, startNumber, context);
    if (!record) return;

    const recalculatedAt = new Date().toISOString();
    await writeIfSettingsUnchanged(compRef, context.settingsFingerprint, [record], {
        engineVersion: RESULT_ENGINE_VERSION,
        recalculatedAt,
        triggerType: 'automatic'
    });
}

function storedResultDoc(record, audit) {
    return {
        ...toStoredResult(record.result),
        updatedAt: audit.recalculatedAt,
        calculatedBy: 'server-function',
        calculationAudit: audit
    };
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
async function writeIfSettingsUnchanged(compRef, settingsFingerprint, records, audit) {
    const target = (record) => compRef.collection('computed_equipages').doc(record.startNumber);

    if (records.length <= MAX_TRANSACTION_WRITES) {
        const written = await db.runTransaction(async (tx) => {
            const current = await getContext(compRef, (ref) => tx.get(ref));
            if (current.settingsFingerprint !== settingsFingerprint) return false;
            records.forEach((record) => tx.set(target(record), storedResultDoc(record, audit), { merge: true }));
            return true;
        });
        if (!written) logger.info('Inställningarna ändrades under beräkningen; en nyare omräkning skriver resultaten.', { competition: compRef.id, triggerType: audit.triggerType });
        return written;
    }

    // Larger competitions: check, then write in batches (a small window remains)
    const current = await getContext(compRef);
    if (current.settingsFingerprint !== settingsFingerprint) {
        logger.info('Inställningarna ändrades under beräkningen; en nyare omräkning skriver resultaten.', { competition: compRef.id, triggerType: audit.triggerType });
        return false;
    }
    for (let offset = 0; offset < records.length; offset += 400) {
        const batch = db.batch();
        records.slice(offset, offset + 400).forEach((record) => batch.set(target(record), storedResultDoc(record, audit), { merge: true }));
        await batch.commit();
    }
    return true;
}

// Every equipage of the competition, after a change to settings all results depend on
async function recalculateWholeCompetition(appId, competitionId, triggerType) {
    const compRef = db.doc(`artifacts/${appId}/public/data/competitions/${competitionId}`);
    const context = await getContext(compRef);
    const equipagesSnapshot = await compRef.collection('equipages').get();
    const records = [];
    for (const equipageSnapshot of equipagesSnapshot.docs) {
        try {
            const record = await calculateEquipageRecord(compRef, equipageSnapshot.id, context, equipageSnapshot);
            if (record) records.push(record);
        } catch (error) {
            // One broken equipage must not keep the others stale
            logger.error(`Omräkning av #${equipageSnapshot.id} misslyckades`, { competitionId, error: String(error?.message || error) });
        }
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
        await recalculateEquipage(appId, compId, startNo);
    }
);

// 4. Equipage Static Data Changes
export const onEquipageUpdate = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/equipages/{startNo}",
    async (event) => {
        const { appId, compId, startNo } = event.params;
        await recalculateEquipage(appId, compId, startNo);
    }
);

async function assertCanMaintainResults(request, competition) {
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
        throw new HttpsError('permission-denied', 'Endast tävlingsägare eller full administratör får räkna om resultat.');
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
            engineVersion: RESULT_ENGINE_VERSION
        };
    }
);

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

        const recalculatedAt = new Date().toISOString();
        const initiatedBy = {
            uid: request.auth.uid,
            email: String(request.auth.token?.email || '').trim().toLowerCase() || null
        };
        const audit = {
            engineVersion: RESULT_ENGINE_VERSION,
            recalculatedAt,
            initiatedBy,
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
            ...audit
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

    const competition = await getCompetitionArtifactsDoc(competitionId);
    if (!competition) {
        throw new HttpsError('not-found', 'Tavlingen kunde inte hittas.');
    }

    const secretsSnap = await competition.ref.collection('config').doc('secrets').get();
    const secrets = secretsSnap.exists ? secretsSnap.data() : {};
    const matchedRole = resolveJoinRoleForPin(pinCode, secrets);
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

    const userRecord = await adminAuth.getUser(request.auth.uid);
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

export const submitVolunteerSignup = onCall(async (request) => {
    const competitionId = String(request.data?.competitionId || '').trim();
    const honeypot = String(request.data?.website || '').trim();

    if (!competitionId) {
        throw new HttpsError('invalid-argument', 'Competition ID saknas.');
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

    if (duplicateExists) {
        return {
            accepted: true,
            duplicate: true
        };
    }

    await signupRef.add(payload);
    return {
        accepted: true,
        duplicate: false
    };
});
