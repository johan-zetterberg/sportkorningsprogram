import { db, appId, auth } from '../config/firebase-config.js';
import { setCompetitionSetting } from './competitionSettingsStore.js';
import { mergeCompetitionPrograms } from '../utils/dressageUtils.js';
import {
    doc,
    serverTimestamp,
    getDoc,
    writeBatch,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { RESULT_ENGINE_VERSION } from '../core-engine/version.js';
import { getEquipages } from './equipageService.js';
import { getJudges } from './adminService.js';
import { getConfig } from './competitionService.js';
import { getAllDressageProtocols } from './dressageService.js';
import { getMarathonTimingData, getMarathonStateDocuments, getMarathonResults, loadPauseWindows } from './marathonService.js';
import { getPrecisionResults } from './precisionService.js';
import { generateTotalResultsPdf } from '../pdf/totalResultsPdf.js';
import { buildArchiveRowsFromData } from './archiveRowBuilder.js';
import { pickMergeSource } from './mergeConfigService.js';
import {
    assertArchiveCanFinalize,
    buildArchiveCompetition,
    buildArchiveSnapshot,
    findIncompleteArchiveRows,
    buildFinalizeCompetitionPatch,
    buildReopenCompetitionPatch
} from './archivingUtils.js';

// The config documents a merge of classes may be saved in (mergeConfigService)
const MERGE_SOURCE_KEYS = ['tdbMergeGroups', 'classMergeMap', 'tdbMergeMap', 'display'];

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
        competitionMeta,
        dressageJudgeMapping,
        programOverrides,
        programMapping,
        judges,
        dressyrClassConfig,
        ...mergeSources
    ] = await Promise.all([
        getAllDressageProtocols(competitionId, equipages),
        getMarathonTimingData(competitionId),
        getMarathonStateDocuments(competitionId),
        getMarathonResults(competitionId),
        getPrecisionResults(competitionId),
        // The official archive: the settings as on the server now, not the
        // device's copy (kept up to an hour), and the same inputs as the
        // server's results (the competition's own programs and class mapping)
        getConfig(competitionId, 'maratonConfig', true),
        getConfig(competitionId, 'precisionConfig', true),
        getConfig(competitionId, 'competitionMeta', true),
        getConfig(competitionId, 'dressageJudgeMapping', true),
        getConfig(competitionId, 'dressagePrograms', true),
        getConfig(competitionId, 'dressyrProgramMapping', true),
        getJudges(competitionId).catch(() => []),
        // Clear round per class (TR V 509.3): no placings in the archive
        getConfig(competitionId, 'dressyrClassConfig', true).catch(() => ({})),
        // Merged classes are placed as one class, as on the live result pages
        ...MERGE_SOURCE_KEYS.map(key => getConfig(competitionId, key, true).catch(() => null))
    ]);
    const mergeSource = pickMergeSource(Object.fromEntries(MERGE_SOURCE_KEYS.map((key, i) => [key, mergeSources[i]])));

    // The official archive: pauses subtracted from stage times, as on the server
    await loadPauseWindows(competitionId);
    setCompetitionSetting(competitionId, 'klassProgramMapping',
        (programMapping && typeof programMapping === 'object') ? programMapping : {});

    const rows = buildArchiveRowsFromData({
        equipages,
        dressageProtocols,
        marathonTimingMap,
        marathonStateMap,
        marathonObstacleRows,
        precisionRows,
        marathonConfig,
        precisionConfig,
        allPrograms: mergeCompetitionPrograms(programOverrides),
        dressageJudgeMapping,
        judges,
        dressyrClassConfig,
        mergeSource
    });

    return {
        rows,
        competitionMeta
    };
}

/**
 * Archives the competition: refuses while equipages lack a final result
 * (error.code 'archive-incomplete') unless allowIncomplete, saves the result
 * list as an unchangeable snapshot and locks the competition, in one batch.
 */
export async function finalizeCompetition(competitionId, { allowIncomplete = false } = {}) {
    try {
        const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
        const compRef = doc(db, base);
        const metaRef = doc(db, `${base}/config/competitionMeta`);

        const [compSnap, archiveData] = await Promise.all([
            getDoc(compRef),
            buildArchiveRows(competitionId)
        ]);

        assertArchiveCanFinalize({
            competitionId,
            competitionExists: compSnap.exists(),
            rows: archiveData.rows,
            allowIncomplete
        });

        const competition = buildArchiveCompetition(compSnap.data(), archiveData.competitionMeta);

        await generateTotalResultsPdf(archiveData.rows, competition, {
            viewMode: 'byclass',
            officials: '',
            throwOnMissingPdfLib: true
        });

        // Snapshot, lock and declaration lock together: never locked without
        // its snapshot or the other way round
        const archivedAt = Date.now();
        const snapshotId = `snapshot_${archivedAt}`;
        const batch = writeBatch(db);
        batch.set(doc(db, `${base}/archive/${snapshotId}`), buildArchiveSnapshot(archiveData.rows, {
            archivedAt,
            archivedBy: auth.currentUser?.uid || null,
            engineVersion: RESULT_ENGINE_VERSION,
            allowedIncomplete: findIncompleteArchiveRows(archiveData.rows)
        }));
        batch.update(compRef, { ...buildFinalizeCompetitionPatch(serverTimestamp()), archiveSnapshotId: snapshotId });
        batch.set(metaRef, { manualLockdown: true }, { merge: true });
        await batch.commit();

        return { success: true, rows: archiveData.rows.length, snapshotId };
    } catch (err) {
        console.error("Finalize Failed:", err);
        throw err;
    }
}

export async function reopenCompetition(competitionId) {
    if (!competitionId) throw new Error("Competition ID required");

    try {
        // Reopening is the only way to change an archived competition; who
        // did it and when is kept on the competition (the snapshot stays)
        const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
        const metaRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/config/competitionMeta`);
        const batch = writeBatch(db);
        batch.update(compRef, {
            ...buildReopenCompetitionPatch(),
            reopenHistory: arrayUnion({ at: Date.now(), by: auth.currentUser?.uid || null })
        });
        batch.set(metaRef, { manualLockdown: false }, { merge: true });
        await batch.commit();

        return { success: true };
    } catch (err) {
        console.error("Reopen Failed:", err);
        throw err;
    }
}
