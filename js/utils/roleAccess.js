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

// Who may open each page (the router; the bottom navigation bar offers only
// pages the user may open)
export const PAGE_PERMISSIONS = Object.freeze({
    'page-hub': ['publik', 'funktionar', 'domare', 'admin'],
    'page-admin': ['admin'],
    'page-ekipage': ['admin'],
    'page-deltagare': ['publik', 'funktionar', 'domare', 'admin'],
    'page-hastar': ['publik', 'funktionar', 'domare', 'admin'],
    'page-starttider': ['publik', 'funktionar', 'domare', 'admin'],

    'page-maraton-tider': ['publik', 'funktionar', 'domare', 'admin'],
    'page-dressyr-input': ['dressage', 'domare', 'admin'],
    'page-dressyr-results': ['publik', 'funktionar', 'domare', 'admin'],
    'page-maraton-stages': ['marathon', 'domare', 'admin'],
    'page-maraton-input': ['marathon', 'domare', 'admin'],
    'page-observator-input': ['marathon', 'domare', 'admin'],
    'page-maraton-monitor': ['publik', 'funktionar', 'domare', 'admin'],
    'page-maraton-results': ['publik', 'funktionar', 'domare', 'admin'],
    'page-precision-monitor': ['publik', 'funktionar', 'domare', 'admin'],
    'page-precision-input': ['precision', 'domare', 'admin'],
    'page-precision-split-input': ['precision', 'domare', 'admin'],
    'page-precision-results': ['publik', 'funktionar', 'domare', 'admin'],
    'page-precision-admin': ['admin'],
    // The TD / ground jury reads the secretariat pages (the rules decide writes)
    'page-sekretariat-precision': ['admin', 'precision', 'td'],
    'page-sekretariat-maraton': ['admin', 'marathon', 'td'],
    'page-sekretariat-dressyr': ['admin', 'dressage', 'td'],
    // Incident / protest / ground jury log, corrections, field devices
    'page-incidents': ['admin', 'td', 'dressage', 'marathon', 'precision', 'vet'],
    'page-dressyr-monitor': ['publik', 'funktionar', 'domare', 'admin'],
    'page-dressyr-admin': ['admin'],
    'page-maraton-admin': ['admin'],
    // Carriage width decides the cone width in precision: measured by the
    // precision officials (and the technical delegate / ground jury), not by
    // every official. The rules let the precision role write only these fields
    'page-vagnbredd': ['precision', 'domare', 'admin'],
    'page-total-resultat': ['publik', 'funktionar', 'domare', 'admin'],
    'page-portal': ['publik', 'funktionar', 'domare', 'admin'], // Tillåt publik, men sidan kollar inloggningsstatus
    'page-competition-center': ['publik', 'funktionar', 'domare', 'admin'],
    'page-speaker': ['speaker', 'domare', 'admin'],
    'page-prize-giving': ['speaker', 'funktionar', 'domare', 'admin'],
    'page-reports': ['funktionar', 'domare', 'admin'],
    // Clinical data (vetInspections, vetNotes): the vet and admins only
    'page-vet-check': ['vet', 'admin'],
    'page-manual': ['publik', 'funktionar', 'domare', 'admin'],
    'page-official': ['funktionar', 'domare', 'admin'],
    // The privacy notice: readable by everyone, signed in or not
    'page-privacy': ['publik', 'funktionar', 'domare', 'admin'],
});

/** Whether roles may open the page with this key ('admin', 'official', ...) */
export function canOpenPage(pageKey, roles) {
    return hasRoleAccess(roles, PAGE_PERMISSIONS[`page-${pageKey}`] || []);
}
