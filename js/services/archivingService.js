import { db, appId, auth } from '../config/firebase-config.js';
import { setCompetitionSetting } from './competitionSettingsStore.js';
import { mergeCompetitionPrograms } from '../utils/dressageUtils.js';
import {
    doc,
    collection,
    serverTimestamp,
    deleteField,
    getDocFromServer,
    getDocsFromServer,
    updateDoc,
    waitForPendingWrites,
    writeBatch,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { RESULT_ENGINE_VERSION } from '../core-engine/version.js';
import { getEquipages } from './equipageService.js';
import { getJudges } from './adminService.js';
import { getConfig } from './competitionService.js';
import { getAllDressageProtocols } from './dressageService.js';
import { getMarathonTimingData, getMarathonStateDocuments, getMarathonResults } from './marathonService.js';
import { getPrecisionResults } from './precisionService.js';
import { setPauseWindows } from '../utils/marathonUtils.js';
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
// Config documents the archive reads (besides the merge sources)
const ARCHIVE_CONFIG_DOCS = ['maratonConfig', 'precisionConfig', 'competitionMeta', 'dressageJudgeMapping',
    'dressagePrograms', 'dressyrProgramMapping', 'dressyrClassConfig', 'globalStatus'];
// Collections with one document per equipage the archive reads
const ARCHIVE_COLLECTIONS = ['equipages', 'precision', 'maraton', 'maraton-timing', 'maratonResults', 'judges'];
const SERVER_STEP_TIMEOUT_MS = 20000;
const OFFLINE_MESSAGE = 'Ingen anslutning till servern. Arkivering kräver nätverk så att arkivet bygger på all sparad data, inte på kopian i enheten. Försök igen när anslutningen är stabil.';

function assertOnline() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(OFFLINE_MESSAGE);
    }
}

function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        })
    ]);
}

function serverReadError(what, error) {
    const wrapped = new Error(`Arkiveringen avbröts: ${what} kunde inte läsas från servern (${error?.code || error?.message || error}). Inget arkiverades.`);
    wrapped.cause = error;
    return wrapped;
}

/**
 * Reads everything the archive is built from directly from the server: a
 * plain read answers from the device's copy on poor Wi-Fi, without saying so,
 * and the archive would miss results. Any failed read stops the archiving.
 * The reads also refresh the device's copy, so the shared loaders used by
 * buildArchiveRows return the same data. Returns what was read, to check the
 * loaders' results against.
 */
async function readArchiveInputsFromServer(competitionId) {
    const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
    const readDocs = (path, what) => getDocsFromServer(collection(db, path)).catch((error) => { throw serverReadError(what, error); });
    const readDoc = (path, what) => getDocFromServer(doc(db, path)).catch((error) => { throw serverReadError(what, error); });

    const [collections, configs] = await Promise.all([
        Promise.all(ARCHIVE_COLLECTIONS.map(name => readDocs(`${base}/${name}`, name))),
        Promise.all([...ARCHIVE_CONFIG_DOCS, ...MERGE_SOURCE_KEYS].map(name => readDoc(`${base}/config/${name}`, `config/${name}`)))
    ]);
    const byName = Object.fromEntries(ARCHIVE_COLLECTIONS.map((name, i) => [name, collections[i]]));
    const configByName = Object.fromEntries([...ARCHIVE_CONFIG_DOCS, ...MERGE_SOURCE_KEYS]
        .map((name, i) => [name, configs[i].exists() ? configs[i].data() : null]));

    // Per equipage: dressage protocols and obstacle results (also for result
    // documents left without an equipage, which the loaders read as well)
    const startNumbers = [...new Set([
        ...byName.equipages.docs.map(d => d.id),
        ...byName.maratonResults.docs.map(d => d.id)
    ])];
    const chunkSize = 10;
    for (let i = 0; i < startNumbers.length; i += chunkSize) {
        await Promise.all(startNumbers.slice(i, i + chunkSize).flatMap(sn => [
            readDocs(`${base}/dressage/${sn}/protocols`, `dressyrprotokoll #${sn}`),
            readDocs(`${base}/maratonResults/${sn}/obstacles`, `hinderresultat #${sn}`)
        ]));
    }

    return {
        counts: {
            equipages: byName.equipages.size,
            timing: byName['maraton-timing'].size,
            state: byName.maraton.size,
            precision: byName.precision.size
        },
        configs: configByName
    };
}

async function buildArchiveRows(competitionId) {
    const server = await readArchiveInputsFromServer(competitionId);

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
        getJudges(competitionId),
        // Clear round per class (TR V 509.3): no placings in the archive
        getConfig(competitionId, 'dressyrClassConfig', true),
        // Merged classes are placed as one class, as on the live result pages
        ...MERGE_SOURCE_KEYS.map(key => getConfig(competitionId, key, true))
    ]);

    // Some loaders answer an error with an empty list: what they return must
    // match what the server returned above
    const mismatch = [
        ['ekipage', equipages.length, server.counts.equipages],
        ['maratontider', marathonTimingMap.size, server.counts.timing],
        ['maratonresultat', marathonStateMap.size, server.counts.state],
        ['precisionsresultat', precisionRows.length, server.counts.precision]
    ].filter(([, loaded, expected]) => loaded !== expected);
    if (mismatch.length) {
        throw new Error(`Arkiveringen avbröts: alla data kunde inte läsas (${mismatch.map(([what, loaded, expected]) => `${what}: ${loaded} av ${expected}`).join(', ')}). Inget arkiverades; försök igen.`);
    }

    const mergeSource = pickMergeSource(Object.fromEntries(MERGE_SOURCE_KEYS.map((key, i) => [key, mergeSources[i]])));

    // The official archive: pauses subtracted from stage times, as on the
    // server (the pause log as read from the server above)
    const pauseLog = server.configs.globalStatus?.pauseLog;
    setPauseWindows(Array.isArray(pauseLog) ? pauseLog : []);
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

const CLEAR_FINALIZING = {
    finalizing: deleteField(),
    finalizingAt: deleteField(),
    finalizingBy: deleteField()
};

/**
 * Archives the competition: refuses while equipages lack a final result
 * (error.code 'archive-incomplete') unless allowIncomplete, saves the result
 * list as an unchangeable snapshot and locks the competition, in one batch.
 *
 * Refuses without a connection. The competition is marked `finalizing` before
 * the results are read (the rules then refuse result writes), so nothing can
 * change between reading and locking; the mark is removed with the lock, or
 * when the archiving fails.
 */
export async function finalizeCompetition(competitionId, { allowIncomplete = false } = {}) {
    if (!competitionId) throw new Error('Competition ID required');
    assertOnline();
    const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
    const compRef = doc(db, base);
    const metaRef = doc(db, `${base}/config/competitionMeta`);

    let markedFinalizing = false;
    try {
        const compSnap = await getDocFromServer(compRef).catch((error) => {
            throw serverReadError('tävlingen', error);
        });
        if (!compSnap.exists()) throw new Error('Tavlingen hittades inte och kan inte arkiveras.');
        const compData = compSnap.data() || {};
        if (compData.locked === true || compData.status === 'completed') {
            throw new Error('Tävlingen är redan arkiverad.');
        }

        // This device's own queued writes first, so they are in the archive
        await withTimeout(waitForPendingWrites(db), SERVER_STEP_TIMEOUT_MS,
            'Arkiveringen avbröts: ändringar sparade på den här enheten har inte nått servern än. Kontrollera anslutningen och försök igen.');

        // Stop result writes while the archive is read and saved (cleared
        // below on failure, also when this write only went slowly)
        markedFinalizing = true;
        await withTimeout(updateDoc(compRef, {
            finalizing: true,
            finalizingAt: serverTimestamp(),
            finalizingBy: auth.currentUser?.uid || null
        }), SERVER_STEP_TIMEOUT_MS, OFFLINE_MESSAGE);

        const metaSnap = await getDocFromServer(metaRef).catch((error) => {
            throw serverReadError('config/competitionMeta', error);
        });
        const archiveData = await buildArchiveRows(competitionId);

        assertArchiveCanFinalize({
            competitionId,
            competitionExists: true,
            rows: archiveData.rows,
            allowIncomplete
        });

        const competition = buildArchiveCompetition(compData, archiveData.competitionMeta);

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
        batch.update(compRef, {
            ...buildFinalizeCompetitionPatch(serverTimestamp()),
            ...CLEAR_FINALIZING,
            archiveSnapshotId: snapshotId,
            // Reopening puts the driver portal's lock back as it was
            manualLockdownBeforeArchive: metaSnap.exists() && metaSnap.data()?.manualLockdown === true
        });
        batch.set(metaRef, { manualLockdown: true }, { merge: true });
        await withTimeout(batch.commit(), SERVER_STEP_TIMEOUT_MS * 3,
            'Arkiveringen fick inget svar från servern. Kontrollera om tävlingen blev arkiverad innan du försöker igen.');
        markedFinalizing = false;

        return { success: true, rows: archiveData.rows.length, snapshotId };
    } catch (err) {
        console.error("Finalize Failed:", err);
        if (markedFinalizing) {
            // Results may be written again
            try {
                await withTimeout(updateDoc(compRef, CLEAR_FINALIZING), SERVER_STEP_TIMEOUT_MS, 'timeout');
            } catch (clearError) {
                console.warn('Kunde inte ta bort arkiveringsmarkeringen (den slutar gälla efter 15 minuter):', clearError);
            }
        }
        throw err;
    }
}

export async function reopenCompetition(competitionId) {
    if (!competitionId) throw new Error("Competition ID required");
    assertOnline();

    try {
        // Reopening is the only way to change an archived competition; who
        // did it and when is kept on the competition (the snapshot stays)
        const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
        const metaRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/config/competitionMeta`);
        const compSnap = await getDocFromServer(compRef);
        const previousLockdown = compSnap.exists() ? compSnap.data()?.manualLockdownBeforeArchive : undefined;
        const batch = writeBatch(db);
        batch.update(compRef, {
            ...buildReopenCompetitionPatch(),
            ...CLEAR_FINALIZING,
            manualLockdownBeforeArchive: deleteField(),
            reopenHistory: arrayUnion({ at: Date.now(), by: auth.currentUser?.uid || null })
        });
        // The driver portal's lock as it was before archiving. Archived before
        // that was recorded: left locked, the admin opens it when wanted
        if (typeof previousLockdown === 'boolean') {
            batch.set(metaRef, { manualLockdown: previousLockdown }, { merge: true });
        }
        await batch.commit();

        return { success: true, manualLockdownRestored: typeof previousLockdown === 'boolean' };
    } catch (err) {
        console.error("Reopen Failed:", err);
        throw err;
    }
}
