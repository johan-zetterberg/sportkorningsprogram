// Which pages and menu links a signed-in user may see. Used by the router
// (navigationService) and the menu (authService.updateUIVisibility); the
// database rules still decide what may be read and written.

// Specific official roles map to the general "funktionar" level
export const ROLE_HIERARCHY = Object.freeze({
    superadmin: ['superadmin', 'admin', 'funktionar', 'publik'],
    admin: ['admin', 'funktionar', 'publik'],
    dressage: ['dressage', 'funktionar', 'publik'],
    marathon: ['marathon', 'funktionar', 'publik'],
    precision: ['precision', 'funktionar', 'publik'],
    speaker: ['speaker', 'funktionar', 'publik'],
    // Limited: the vet page and public pages, not the general official pages
    vet: ['vet', 'publik'],
    // Technical delegate / ground jury: the official pages (secretariat read,
    // incident log, finalization approval), not the input pages
    td: ['td', 'funktionar', 'publik'],
    publik: ['publik']
});

/**
 * The user's global role and competition roles together. A global admin or
 * superadmin keeps that level when they also hold a competition role
 * (before, the competition roles replaced the global one in the menu).
 */
export function mergeUserRoles(user) {
    if (!user) return ['publik'];
    const roles = [];
    roles.push(user.role || 'publik');
    if (Array.isArray(user.roles) && user.roles.includes('superadmin')) roles.push('superadmin');
    if (Array.isArray(user.compRoles)) roles.push(...user.compRoles);
    const unique = [...new Set(roles.filter(Boolean).map(String))];
    // "publik" adds nothing next to another role
    return unique.length > 1 ? unique.filter(role => role !== 'publik') : unique;
}

/** Whether any of roles reaches one of requiredRoles (superadmin reaches all) */
export function hasRoleAccess(roles, requiredRoles) {
    const list = Array.isArray(roles) ? roles : [roles];
    if (list.includes('superadmin')) return true;
    const required = Array.isArray(requiredRoles) ? requiredRoles : [];
    return list.some((role) => {
        const expanded = ROLE_HIERARCHY[role] || [role, 'publik'];
        return required.some(req => expanded.includes(req));
    });
}
