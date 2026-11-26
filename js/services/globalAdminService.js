// Global admins (superadmin only): may create competitions and administer
// every competition. The server finds the account by e-mail (functions/src/globalAdmins.js).
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { functions } from '../config/firebase-config.js';

async function call(name, data) {
    const result = await httpsCallable(functions, name)(data || {});
    return result?.data || {};
}

/** -> [{ uid, email, role: 'admin'|'superadmin' }] */
export async function getGlobalAdmins() {
    return (await call('getGlobalAdmins')).admins || [];
}

/** -> { uid, email, role, changed } */
export function setGlobalAdmin(email, admin) {
    return call('setGlobalAdmin', { email, admin: !!admin });
}
