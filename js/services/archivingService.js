import { db, appId } from '../config/firebase-config.js';
import {
    doc,
    updateDoc,
    serverTimestamp,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getEquipages } from './equipageService.js';
import { getConfig } from './competitionService.js';
import { getAllDressageProtocols } from './dressageService.js';
import { getMarathonTimingData, getMarathonStateDocuments, getMarathonResults } from './marathonService.js';
import { getPrecisionResults } from './precisionService.js';
import { generateTotalResultsPdf } from '../pdf/totalResultsPdf.js';
import { buildArchiveRowsFromData } from './archiveRowBuilder.js';
import {
    assertArchiveCanFinalize,
    buildArchiveCompetition,
    buildFinalizeCompetitionPatch,
    buildReopenCompetitionPatch
} from './archivingUtils.js';

async function buildArchiveRows(competitionId) {
    const equipages = await getEquipages(competitionId);
    const [
        dressageProtocols,
        marathonTimingMap,
        marathonStateMap,
        marathonObstacleRows,
        precisionRows,
        marathonConfig,
        precisionConfig,
        competitionMeta
    ] = await Promise.all([
        getAllDressageProtocols(competitionId, equipages),
        getMarathonTimingData(competitionId),
        getMarathonStateDocuments(competitionId),
        getMarathonResults(competitionId),
        getPrecisionResults(competitionId),
        getConfig(competitionId, 'maratonConfig').catch(() => ({})),
        getConfig(competitionId, 'precisionConfig').catch(() => ({})),
        getConfig(competitionId, 'competitionMeta').catch(() => ({}))
    ]);

    const rows = buildArchiveRowsFromData({
        equipages,
        dressageProtocols,
        marathonTimingMap,
        marathonStateMap,
        marathonObstacleRows,
        precisionRows,
        marathonConfig,
        precisionConfig
    });

    return {
        rows,
        competitionMeta
    };
}

export async function finalizeCompetition(competitionId) {
    try {
        const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
        const metaRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/config/competitionMeta`);

        const [compSnap, archiveData] = await Promise.all([
            getDoc(compRef),
            buildArchiveRows(competitionId)
        ]);

        assertArchiveCanFinalize({
            competitionId,
            competitionExists: compSnap.exists(),
            rows: archiveData.rows
        });

        const competition = buildArchiveCompetition(compSnap.data(), archiveData.competitionMeta);

        await generateTotalResultsPdf(archiveData.rows, competition, {
            viewMode: 'byclass',
            officials: '',
            throwOnMissingPdfLib: true
        });

        await updateDoc(compRef, buildFinalizeCompetitionPatch(serverTimestamp()));

        await setDoc(metaRef, { manualLockdown: true }, { merge: true });

        return { success: true, rows: archiveData.rows.length };
    } catch (err) {
        console.error("Finalize Failed:", err);
        throw err;
    }
}

export async function reopenCompetition(competitionId) {
    if (!competitionId) throw new Error("Competition ID required");

    try {
        const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
        await updateDoc(compRef, buildReopenCompetitionPatch());

        const metaRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/config/competitionMeta`);
        await setDoc(metaRef, { manualLockdown: false }, { merge: true });

        return { success: true };
    } catch (err) {
        console.error("Reopen Failed:", err);
        throw err;
    }
}
