// Global admins (users/{uid}.role == 'admin'): may create competitions and
// administer every competition (firestore.rules getUserRole). Only the
// superadmin grants or removes the role, here, by the person's e-mail.
// The superadmin role itself is never changed from the app.

export class GlobalAdminError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAdminEmail(value) {
    const email = String(value ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
        throw new GlobalAdminError('invalid-argument', 'Ange en giltig e-postadress.');
    }
    return email;
}

export function isSuperadminUserDoc(data = {}) {
    return data?.role === 'superadmin' || (Array.isArray(data?.roles) && data.roles.includes('superadmin'));
}

/**
 * Grants (admin: true) or removes the global admin role.
 * deps: { db (firebase-admin Firestore), auth (firebase-admin Auth), now }
 * -> { uid, email, role, changed }
 */
export async function setGlobalAdminRole({ db, auth, now = () => new Date().toISOString() }, { email: rawEmail, admin }, { byUid } = {}) {
    const email = normalizeAdminEmail(rawEmail);
    if (typeof admin !== 'boolean') throw new GlobalAdminError('invalid-argument', 'Ange om rollen ska ges eller tas bort.');

    let user;
    try {
        user = await auth.getUserByEmail(email);
    } catch (error) {
        if (error?.code === 'auth/user-not-found') {
            throw new GlobalAdminError('not-found', 'Det finns inget konto med den e-postadressen. Be personen skapa ett konto i appen först.');
        }
        throw error;
    }
    if (user.uid === byUid) throw new GlobalAdminError('failed-precondition', 'Du kan inte ändra din egen roll.');
    // Anyone can register an account with someone else's address: the role
    // goes only to an account whose holder has confirmed the address
    if (admin && !user.emailVerified) {
        throw new GlobalAdminError('failed-precondition', 'Kontot har inte bekräftat sin e-postadress än. Be personen klicka på länken i bekräftelsemejlet och försök igen.');
    }

    const ref = db.doc(`users/${user.uid}`);
    const snap = await ref.get();
    const data = snap.exists ? (snap.data() || {}) : {};
    const claims = user.customClaims || {};
    if (isSuperadminUserDoc(data) || claims.superadmin === true || claims.role === 'superadmin') {
        throw new GlobalAdminError('failed-precondition', 'Kontot är superadministratör och ändras inte här.');
    }
    const role = admin ? 'admin' : 'publik';
    if (data.role === role) return { uid: user.uid, email, role, changed: false };

    const update = { role, roleChangedAt: now(), roleChangedBy: byUid || null };
    if (!snap.exists) {
        update.email = email;
        update.createdAt = now();
        update.claimedEquipages = [];
    }
    await ref.set(update, { merge: true });
    return { uid: user.uid, email, role, changed: true };
}

/** The global admins: [{ uid, email, role }] sorted by e-mail (superadmins included, marked) */
export async function listGlobalAdmins({ db }) {
    const snap = await db.collection('users').where('role', 'in', ['admin', 'superadmin']).get();
    return snap.docs
        .map(docSnap => {
            const data = docSnap.data() || {};
            return { uid: docSnap.id, email: String(data.email || ''), role: isSuperadminUserDoc(data) ? 'superadmin' : 'admin' };
        })
        .sort((a, b) => a.email.localeCompare(b.email));
}
