/**
 * Cloud Functions for Combined Driving
 * Defines triggers to recalculate results on data changes.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { calculateTotalResult } from "./src/logic/calculation.js";
import { dressagePrograms } from "./src/data/dressagePrograms.js";
import { competitionClasses } from "./src/data/competitionData.js";

setGlobalOptions({ region: 'europe-west1' });

initializeApp();
const db = getFirestore();

// Helper to load context (Configs) efficiently
// In a real app we might cache this or read from Firestore config docs on every run
async function getContext(competitionId) {
    // Fetch configs from DB
    // e.g. artifacts/appId/public/data/competitions/ID/config/marathon
    // For now, using defaults or minimal mocked configs to demonstrate structure
    // We ideally need to read them from Firestore.

    // Note: Assuming standard paths used in client
    const compRef = db.collection('artifacts').doc('combined-driving').collection('public').doc('data').collection('competitions').doc(competitionId);

    const [marCfgSn, precCfgSn] = await Promise.all([
        compRef.collection('config').doc('marathon').get(),
        compRef.collection('config').doc('precision').get()
    ]);

    return {
        allPrograms: dressagePrograms,
        judges: [], // Would fetch judge config if needed for rigorous checks
        marathonConfig: marCfgSn.exists ? marCfgSn.data() : {},
        precisionConfig: precCfgSn.exists ? precCfgSn.data() : {}
    };
}

async function recalculateEquipage(competitionId, startNumber) {
    const compPath = `artifacts/combined-driving/public/data/competitions/${competitionId}`;
    const eqKey = String(startNumber);

    // 1. Fetch all data for this equipage
    // We need: Equipage Object, Dressage Protocols, Marathon Doc, Timing Doc, Precision Doc

    const eqDocRef = db.doc(`${compPath}/equipages/${eqKey}`);
    const dressColRef = db.collection(`${compPath}/dressage/${eqKey}/protocols`);
    const marDocRef = db.doc(`${compPath}/maratonResults/${eqKey}`);
    const timingDocRef = db.doc(`${compPath}/maratonTiming/1`); // Single timing doc for whole comp usually? Or per equipage?
    // Client uses: collectionGroup for timing or fetches specifically.
    // Actually marathonUtils.calculateMarathonResult uses 'timingDoc'. 
    // Usually timing is stored in `maratonResults/${eqKey}` or a separate collection.
    // Based on audit, timing implies 'timing' field or separate doc.
    // Let's assume the Marathon Result Doc *contains* the timing data or we fetch the global timing doc.
    // But `stageStartTS` looks at `t.timing` or `t.stages`. 
    // Let's fetch the specific result doc which usually has updated times.

    const precDocRef = db.doc(`${compPath}/precision/${eqKey}`);

    const [eqSnap, dressSnap, marSnap, precSnap] = await Promise.all([
        eqDocRef.get(),
        dressColRef.get(),
        marDocRef.get(),
        precDocRef.get()
    ]);

    if (!eqSnap.exists) {
        console.log(`Equipage ${eqKey} not found.`);
        return;
    }

    const equipage = eqSnap.data();
    const dressProtocols = dressSnap.docs.map(d => d.data());
    const splitTimesDoc = await db.doc(`${compPath}/maratonTiming/1`).get(); // Global timing if used
    const marData = marSnap.exists ? marSnap.data() : {};
    const timingData = splitTimesDoc.exists ? splitTimesDoc.data() : {}; // Or merged
    // Actually marData might contain local timing overrides.

    const precData = precSnap.exists ? precSnap.data() : {};

    // 2. Context
    const context = await getContext(competitionId);

    // 3. Calculate
    const result = calculateTotalResult(
        equipage,
        dressProtocols,
        marData,
        timingData, // Pass global timing or merged
        precData,
        context
    );

    // 4. Write
    const targetRef = db.doc(`${compPath}/computed_equipages/${eqKey}`);
    await targetRef.set({
        ...result,
        updatedAt: new Date().toISOString(),
        calculatedBy: 'server-function'
    }, { merge: true });

    console.log(`Updated computed_equipages/${eqKey} with Total: ${result.totalPenalty}`);
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
    "artifacts/{appId}/public/data/competitions/{compId}/maratonResults/{startNo}",
    async (event) => {
        const { compId, startNo } = event.params;
        await recalculateEquipage(compId, startNo);
    }
);
// Note: Also listing to obstacles subcollection if separate?
export const onMarathonObstacleWrite = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/maratonResults/{startNo}/obstacles/{obsId}",
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

// 4. Equipage Static Data Changes (e.g. category change)
export const onEquipageUpdate = onDocumentWritten(
    "artifacts/{appId}/public/data/competitions/{compId}/equipages/{startNo}",
    async (event) => {
        const { compId, startNo } = event.params;
        // Check if data actually changed to avoid loop? 
        // Computed result is in separate collection 'computed_equipages', so no loop risk here.
        await recalculateEquipage(compId, startNo);
    }
);
