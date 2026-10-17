export function buildArchiveCompetition(compData = {}, competitionMeta = {}) {
    return {
        ...(compData || {}),
        meta: competitionMeta || {}
    };
}

const isWithdrawnRow = (row) => row?.isWithdrawn === true || /struken|withdrawn|scratched/i.test(String(row?.status || ''));

/**
 * Start numbers of equipages without a final result: no total, not
 * eliminated and not withdrawn. An archive made then would freeze them so.
 */
export function findIncompleteArchiveRows(rows = []) {
    return (rows || [])
        .filter((row) => !row?.isEliminated && !isWithdrawnRow(row)
            && !(Number.isFinite(row?.totalPenalty)))
        .map((row) => String(row?.startNumber ?? ''))
        .filter(Boolean);
}

export function assertArchiveCanFinalize({
    competitionId,
    competitionExists = false,
    rows = [],
    allowIncomplete = false
} = {}) {
    if (!competitionId) {
        throw new Error('Competition ID required');
    }

    if (!competitionExists) {
        throw new Error('Tavlingen hittades inte och kan inte arkiveras.');
    }

    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('Arkivering avbruten: inga resultat/ekipage hittades att arkivera.');
    }

    const incomplete = findIncompleteArchiveRows(rows);
    if (incomplete.length > 0 && !allowIncomplete) {
        const error = new Error(`${incomplete.length} ekipage saknar slutresultat: #${incomplete.join(', #')}.`);
        error.code = 'archive-incomplete';
        error.startNumbers = incomplete;
        throw error;
    }
}

/**
 * The archived result list as it was published, kept unchanged in its own
 * document: a later reopening and correction does not alter it.
 */
export function buildArchiveSnapshot(rows = [], { archivedAt, archivedBy = null, engineVersion = null, allowedIncomplete = [] } = {}) {
    const num = (value) => (Number.isFinite(value) ? value : null);
    const boolOrNull = (value) => (typeof value === 'boolean' ? value : null);
    return {
        archivedAt,
        archivedBy,
        engineVersion,
        incompleteAtArchive: allowedIncomplete,
        rows: (rows || []).map((row) => ({
            startNumber: String(row?.startNumber ?? ''),
            className: row?.className || '',
            driverName: row?.driverName || '',
            plac: row?.plac ?? '',
            dressagePenalty: num(row?.dressage?.penalty),
            dressagePlace: num(row?.posDress ?? row?.dressagePlace),
            dressageEliminated: boolOrNull(row?.dressage?.eliminated),
            dressageStatus: row?.dressage?.status || row?.dressageStatus || null,
            marathonPenalty: num(row?.marathon?.totalPenalty),
            marathonPlace: num(row?.posMar ?? row?.marathonPlace),
            marathonEliminated: boolOrNull(row?.marathon?.eliminated),
            marathonStatus: row?.marathon?.status || row?.marathonStatus || null,
            marathonBPenalty: num(row?.marathon?.bPenalty),
            precisionPenalty: num(row?.precision?.totalPenalty ?? row?.precision?.pen),
            precisionPlace: num(row?.posPrec ?? row?.precisionPlace),
            precisionEliminated: boolOrNull(row?.precision?.eliminated),
            precisionStatus: row?.precision?.status || row?.precisionStatus || null,
            precisionTimeMs: num(row?.precision?.timeMs),
            totalPenalty: num(row?.totalPenalty),
            isEliminated: !!row?.isEliminated,
            status: row?.status || null
        }))
    };
}

export function buildFinalizeCompetitionPatch(serverTimestampValue) {
    return {
        status: 'completed',
        locked: true,
        finalizedAt: serverTimestampValue
    };
}

export function buildReopenCompetitionPatch() {
    return {
        status: 'active',
        locked: false
    };
}
