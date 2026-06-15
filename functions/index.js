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
import { dressagePrograms } from "./src/data/dressagePrograms.js";
import { competitionClasses } from "./src/data/competitionData.js";
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

// Helper to load context (Configs) efficiently
async function getContext(competitionId) {
    const compRef = db.collection('artifacts').doc('combined-driving').collection('public').doc('data').collection('competitions').doc(competitionId);

    // FIX: Match frontend paths
    const [marCfgSn, precCfgSn] = await Promise.all([
        compRef.collection('config').doc('maratonConfig').get(),
        compRef.collection('config').doc('precisionConfig').get()
    ]);

    return {
        allPrograms: dressagePrograms,
        judges: [], 
        marathonConfig: marCfgSn.exists ? marCfgSn.data() : {},
        precisionConfig: precCfgSn.exists ? precCfgSn.data() : {}
    };
}

async function recalculateEquipage(competitionId, startNumber) {
    const compPath = `artifacts/combined-driving/public/data/competitions/${competitionId}`;
    const eqKey = String(startNumber);

    const eqDocRef = db.doc(`${compPath}/equipages/${eqKey}`);
    const dressColRef = db.collection(`${compPath}/dressage/${eqKey}/protocols`);
    const marDocRef = db.doc(`${compPath}/maraton/${eqKey}`);
    const timingDocRef = db.doc(`${compPath}/maraton-timing/${eqKey}`); // FIX: Correct timing path
    const precDocRef = db.doc(`${compPath}/precision/${eqKey}`);

    const [eqSnap, dressSnap, marSnap, timingSnap, precSnap] = await Promise.all([
        eqDocRef.get(),
        dressColRef.get(),
        marDocRef.get(),
        timingDocRef.get(),
        precDocRef.get()
    ]);

    if (!eqSnap.exists) {
        return;
    }

    const equipage = eqSnap.data();
    
    let errorPoints = 0;
    const dressProtocols = dressSnap.docs.map(d => {
        const docData = d.data();
        if (d.id === 'general') {
            errorPoints = docData.errorPoints || 0;
        }
        return { id: d.id, ...docData };
    });

    // Merge errorPoints into equipage so buildCompetitionState finds it
    equipage.errorPoints = errorPoints;

    const timingData = timingSnap.exists ? timingSnap.data() : {};
    let marData = marSnap.exists ? marSnap.data() : {};
    
    // Use the obstacles array directly from the maraton document
    if (!Array.isArray(marData.obstacles)) {
        marData.obstacles = [];
    }

    const precData = precSnap.exists ? precSnap.data() : {};

    const context = await getContext(competitionId);

    const state = buildCompetitionState(
        equipage,
        dressProtocols,
        marData,
        timingData,
        precData,
        context
    );
    const result = calculateTotalResult(state);

    const targetRef = db.doc(`${compPath}/computed_equipages/${eqKey}`);
    await targetRef.set({
        ...result,
        updatedAt: new Date().toISOString(),
        calculatedBy: 'server-function'
    }, { merge: true });

}

// --- TRIGGERS ---

// 1. Dressage Changes
export const onDressageProtocolWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/dressage/{startNo}/protocols/{protoId}",
    async (event) => {
        const { compId, startNo } = event.params;
        await recalculateEquipage(compId, startNo);
    }
);

// 2. Marathon Changes
export const onMarathonResultWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/maraton/{startNo}",
    async (event) => {
        const { compId, startNo } = event.params;
        await recalculateEquipage(compId, startNo);
    }
);
// FIX: Add missing trigger for timing
export const onMarathonTimingWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/maraton-timing/{startNo}",
    async (event) => {
        const { compId, startNo } = event.params;
        await recalculateEquipage(compId, startNo);
    }
);

// 3. Precision Changes
export const onPrecisionResultWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/precision/{startNo}",
    async (event) => {
        const { compId, startNo } = event.params;
        await recalculateEquipage(compId, startNo);
    }
);

// 4. Equipage Static Data Changes
export const onEquipageUpdate = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/equipages/{startNo}",
    async (event) => {
        const { compId, startNo } = event.params;
        await recalculateEquipage(compId, startNo);
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
