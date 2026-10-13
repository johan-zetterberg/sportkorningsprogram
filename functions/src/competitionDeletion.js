const GLOBAL_ADMIN_ROLES = new Set(['admin', 'superadmin']);

function hasGlobalAdminRole(identity = {}) {
    const roles = Array.isArray(identity.roles) ? identity.roles : [];
    return identity.superadmin === true
        || GLOBAL_ADMIN_ROLES.has(identity.role)
        || roles.some((role) => GLOBAL_ADMIN_ROLES.has(role));
}

export function isGlobalAdminIdentity(authToken = {}, user = {}) {
    return hasGlobalAdminRole(authToken) || hasGlobalAdminRole(user);
}

export function canResumeCompetitionDeletion(uid, authToken = {}, user = {}, tombstone = {}) {
    if (!uid) return false;
    return tombstone.deletedBy === uid || isGlobalAdminIdentity(authToken, user);
}

export function buildCompetitionDeletionPlan(competitionId, competition, tombstone = null) {
    if (competition) {
        return {
            appId: competition.appId,
            publicPath: competition.ref.path,
            competitionData: competition.data || {},
            hasCompetitionDocument: true,
            alreadyDone: false
        };
    }

    const appId = String(tombstone?.appId || '').trim();
    if (!appId) return null;

    return {
        appId,
        publicPath: `artifacts/${appId}/public/data/competitions/${competitionId}`,
        competitionData: tombstone || {},
        hasCompetitionDocument: false,
        alreadyDone: tombstone?.status === 'done'
    };
}
