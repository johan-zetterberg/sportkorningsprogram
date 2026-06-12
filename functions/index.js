/**
 * Cloud Functions for Combined Driving
 * Defines triggers to recalculate results on data changes.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
