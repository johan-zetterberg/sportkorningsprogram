export function buildArchiveCompetition(compData = {}, competitionMeta = {}) {
    return {
        ...(compData || {}),
        meta: competitionMeta || {}
    };
}

export function assertArchiveCanFinalize({
    competitionId,
    competitionExists = false,
    rows = []
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
