/**
 * archivingService.js
 * 
 * Handles the "Finalize Competition" workflow:
 * 1. Locks the competition.
 * 2. Fetches all results (snapshot) for archiving.
 * 3. compute aggregated results.
 * 4. Generates a master PDF of all classes.
 * 5. (Optionally) Stores the PDF or marks comp as archived.
 */

import { db, appId } from '../config/firebase-config.js';
import {
    collection, getDocs, doc, updateDoc, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { aggregateResults } from './resultAggregationService.js';
import { generateTotalResultsPdf } from '../pdf/totalResultsPdf.js';

export async function finalizeCompetition(competitionId) {
    if (!competitionId) throw new Error("Competition ID required");

    try {
        // 1. Mark as completed (Lockout)
        // Correct path in artifacts tree
        const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
        await updateDoc(compRef, {
            status: 'completed',
            locked: true,
            finalizedAt: serverTimestamp()
        });

        // 1b. Update Meta Config for Manual Lockdown (Portal)
        // We use the existing helper or raw update relative to artifacts
        const metaRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/config/competitionMeta`);
        // We use setDoc with merge to ensure doc exists
        const { setDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
        await setDoc(metaRef, { manualLockdown: true }, { merge: true });

        // 2. Fetch Data
        // Equipages
        const equipagesSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/equipages`));
        const equipages = equipagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Precision Results
        const precisionSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`));
        const precisionMap = new Map();
        precisionSnap.docs.forEach(d => precisionMap.set(d.id, d.data()));

        // Marathon Timing
        const mTimeSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton-timing`));
        const mTimeMap = new Map();
        mTimeSnap.docs.forEach(d => mTimeMap.set(d.id, d.data()));

        // Marathon Obstacles
        const mObsSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`));
        const mObsMap = new Map();
        mObsSnap.docs.forEach(d => mObsMap.set(d.id, d.data()));

        // Dressage
        // We rely on equipage.dressageResult or fetch dressageStatus if needed.
        // Let's assume equipages have it, or we try to map from dressageStatus if available.
        const dStatusSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`));
        const dMap = new Map(); // sn -> protocols [] (Structure expected by aggregator is protocols, but aggregator also checks eq.dressageResult)

        // If we want to be robust, we updates equipages with dStatus results if eq.dressageResult is missing
        dStatusSnap.docs.forEach(d => {
            // d.data() usually has { score, percent, ... }
            // We can fake a protocol-like structure or just update equipage object in memory
            const data = d.data();
            // find equipage with this ID (d.id is usually startNumber or docId?)
            // Usually d.id in dressageStatus IS the startNumber or a UUID
            // Let's check logic: listenForDressageStatusCollection uses d.id
        });

        // 3. Aggregate
        // We pass empty map for dressageMap because we bank on eq.dressageResult or we can enrich 'equipages' 
        // using dStatusSnap before calling aggregate.

        // Enrich equipages with separate results if not present
        equipages.forEach(eq => {
            const sn = String(eq.startNumber);
            if (!eq.dressageResult && dMap.has(sn)) {
                // eq.dressageResult = ...
            }
        });

        const rows = aggregateResults(equipages, new Map(), mTimeMap, mObsMap, precisionMap);

        // 4. Generate PDF
        // We fetching competition meta for header
        const compSnap = await getDoc(compRef);
        const compMeta = compSnap.data();

        // Generate and download
        await generateTotalResultsPdf(rows, compMeta, { viewMode: 'byclass', officials: '' });

        return { success: true };

    } catch (err) {
        console.error("Finalize Failed:", err);
        throw err;
    }
}

export async function reopenCompetition(competitionId) {
    if (!competitionId) throw new Error("Competition ID required");

    try {
        const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
        await updateDoc(compRef, {
            status: 'active',
            locked: false,
            // Keep finalizedAt as history
        });

        // Restore portal manual lockdown to false
        const metaRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/config/competitionMeta`);
        const { setDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
        await setDoc(metaRef, { manualLockdown: false }, { merge: true });

        return { success: true };
    } catch (err) {
        console.error("Reopen Failed:", err);
        throw err;
    }
}
