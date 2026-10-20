export function isFiniteSpeakerNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

export function formatSpeakerPenalty(value, { eliminated = false, empty = '—', decimals = 2 } = {}) {
    if (eliminated || value === Infinity) return 'ELIM';
    return isFiniteSpeakerNumber(value) ? value.toFixed(decimals) : empty;
}

export function formatSpeakerPercent(value, { empty = '—', decimals = 1 } = {}) {
    return isFiniteSpeakerNumber(value) ? `${value.toFixed(decimals)}%` : empty;
}

/**
 * Leaderboard positions for rows in ranking order ({ total, isWithdrawn }):
 * only a row with a result (finite total, not withdrawn) gets a position;
 * rows without a result, eliminated (Infinity) and withdrawn rows get null.
 * The ranking's order already holds the tie-breaks, so positions run 1, 2, 3.
 */
export function speakerLeaderboardRanks(rows = []) {
    let counted = 0;
    return rows.map((row) => {
        if (!row || row.isWithdrawn || !isFiniteSpeakerNumber(row.total)) return null;
        counted += 1;
        return counted;
    });
}

export function getSpeakerPenaltyOrNull(value) {
    return isFiniteSpeakerNumber(value) ? value : null;
}

// Mirrors the equipages rules: the competition's admins and its speaker may
// write the speaker notes (drivers write their own from the portal)
export function canEditSpeakerNotes(user, comp) {
    if (!user?.uid) return false;
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (user.superadmin === true || user.role === 'admin' || user.role === 'superadmin'
        || roles.includes('admin') || roles.includes('superadmin')) return true;
    if (comp && (comp.createdBy === user.uid || comp.ownerId === user.uid)) return true;
    if (Array.isArray(comp?.admins) && comp.admins.includes(user.uid)) return true;
    const compRoles = Array.isArray(user.compRoles) ? user.compRoles : [];
    return compRoles.includes('admin') || compRoles.includes('speaker');
}
