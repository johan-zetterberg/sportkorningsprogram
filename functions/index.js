/**
 * Cloud Functions for Combined Driving
 * Defines triggers to recalculate results on data changes.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { calculateTotalResult } from "./src/core-engine/calculation.js";
import { buildCompetitionState } from "./src/core-engine/stateSelector.js";
import { RESULT_ENGINE_VERSION } from "./src/core-engine/version.js";
import { dressagePrograms } from "./src/data/dressagePrograms.js";
import { buildRecalculationValidation } from "./src/resultRecalculationUtils.js";
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
async function getContext(compRef) {
    const [compSnap, marCfgSn, precCfgSn, programsSnap, mappingSnap, statusSnap] = await Promise.all([
        compRef.get(),
        compRef.collection('config').doc('maratonConfig').get(),
        compRef.collection('config').doc('precisionConfig').get(),
        compRef.collection('config').doc('dressagePrograms').get(),
        compRef.collection('config').doc('dressyrProgramMapping').get(),
        compRef.collection('config').doc('globalStatus').get()
    ]);
    const pauseLog = statusSnap.exists ? statusSnap.data()?.pauseLog : null;

    return {
        allPrograms: {
            ...dressagePrograms,
            ...(programsSnap.exists ? programsSnap.data() : {})
        },
        dressageProgramMapping: mappingSnap.exists ? mappingSnap.data() : {},
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

    const timingData = timingSnap.exists ? timingSnap.data() : {};
    let marData = marSnap.exists ? marSnap.data() : {};
    
    // Use the obstacles array directly from the maraton document
    if (!Array.isArray(marData.obstacles)) {
        marData.obstacles = [];
    }

    const precData = precSnap.exists ? precSnap.data() : {};

    const state = buildCompetitionState(
        equipage,
        dressProtocols,
        marData,
        timingData,
        precData,
        context
    );
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

    const targetRef = compRef.collection('computed_equipages').doc(record.startNumber);
    await targetRef.set({
        ...toStoredResult(record.result),
        updatedAt: new Date().toISOString(),
        calculatedBy: 'server-function',
        calculationAudit: {
            engineVersion: RESULT_ENGINE_VERSION,
            recalculatedAt: new Date().toISOString(),
            triggerType: 'automatic'
        }
    }, { merge: true });
}

// --- TRIGGERS ---

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
        const { records, validation } = await buildCompetitionRecalculationPreview(competition);
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

        for (let offset = 0; offset < records.length; offset += 400) {
            const batch = db.batch();
            records.slice(offset, offset + 400).forEach((record) => {
                const targetRef = competition.ref.collection('computed_equipages').doc(record.startNumber);
                batch.set(targetRef, {
                    ...toStoredResult(record.result),
                    updatedAt: recalculatedAt,
                    calculatedBy: 'server-function',
                    calculationAudit: audit
                }, { merge: true });
            });
            await batch.commit();
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
