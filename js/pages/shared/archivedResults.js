// An archived competition shows the results it was archived with: the result
// pages recalculate from raw data, so a later change of the calculation rules
// would otherwise alter results that were already published as final.

export function isArchivedCompetition(competition = {}) {
    return competition?.locked === true || competition?.status === 'completed';
}

/**
 * Puts the archived values (archive snapshot rows, by start number) on result
 * rows built by the result pages: discipline penalties, total and elimination.
 * Placings are then made from these values. Rows without a snapshot row (none
 * in the archive) are left as calculated. Returns the number of rows changed.
 */
export function applyArchivedSnapshot(rows = [], snapshot = null) {
    if (!snapshot || !Array.isArray(snapshot.rows)) return 0;
    const bySn = new Map(snapshot.rows.map((row) => [String(row.startNumber), row]));
    let changed = 0;
    rows.forEach((row) => {
        const archived = bySn.get(String(row?.startNumber));
        if (!archived) return;
        row.dressage = { ...(row.dressage || {}), penalty: archived.dressagePenalty };
        row.marathon = { ...(row.marathon || {}), totalPenalty: archived.marathonPenalty };
        row.precision = { ...(row.precision || {}), pen: archived.precisionPenalty, totalPenalty: archived.precisionPenalty };
        row.totalPenalty = archived.totalPenalty;
        row.isEliminated = archived.isEliminated === true;
        row.isOngoing = false;
        row.fromArchive = true;
        changed++;
    });
    return changed;
}

/** The snapshot the competition was archived with, or null */
export async function loadArchiveSnapshot(competition) {
    if (!isArchivedCompetition(competition) || !competition?.archiveSnapshotId || !competition?.id) return null;
    try {
        const [{ db, appId }, { doc, getDoc }] = await Promise.all([
            import('../../config/firebase-config.js'),
            import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js')
        ]);
        const snap = await getDoc(doc(db, `artifacts/${appId}/public/data/competitions/${competition.id}/archive/${competition.archiveSnapshotId}`));
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        console.warn('Kunde inte läsa arkivresultatet; resultaten räknas fram.', error);
        return null;
    }
}
