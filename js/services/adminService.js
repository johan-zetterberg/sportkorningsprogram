import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDocs, setDoc, onSnapshot, query, deleteDoc, getDoc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

const OFFICIAL_SYSTEM_ROLES = ['admin', 'dressage', 'marathon', 'precision', 'speaker'];
const ROLE_EMAIL_FIELDS = {
  admin: ['adminEmails', 'officialEmails'],
  dressage: ['dressageEmails'],
  marathon: ['marathonEmails'],
  precision: ['precisionEmails'],
  speaker: ['speakerEmails']
};

function normalizeEmail(email) {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

function normalizeOfficialRoles(data = {}) {
  const roleValues = Array.isArray(data.roles) ? [...data.roles] : [];
  if (OFFICIAL_SYSTEM_ROLES.includes(data.role)) roleValues.push(data.role);
  return Array.from(new Set(roleValues.filter(role => OFFICIAL_SYSTEM_ROLES.includes(role))));
}

function buildOfficialEmailSyncUpdate(email, roles) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const selected = new Set(roles);
  return OFFICIAL_SYSTEM_ROLES.reduce((patch, role) => {
    ROLE_EMAIL_FIELDS[role].forEach(field => {
      patch[field] = selected.has(role) ? arrayUnion(normalizedEmail) : arrayRemove(normalizedEmail);
    });
    return patch;
  }, {});
}

function buildOfficialEmailRemoveUpdate(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  return Object.values(ROLE_EMAIL_FIELDS).flat().reduce((patch, field) => {
    patch[field] = arrayRemove(normalizedEmail);
    return patch;
  }, {});
}

export function listenForJudges(competitionId, callback) {
  const judgesRef = getCompCollectionRef(competitionId, 'judges');
  return onSnapshot(query(judgesRef), (snapshot) => {
    callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  }, buildSnapshotErrorHandler('listenForJudges', callback, []));
}

export async function saveJudge(competitionId, judgeId, data) {
  return trackWrite(`Sparar domare ${data.name || judgeId}`, (async () => {
    const judgeRef = getCompDocRef(competitionId, 'judges', judgeId);
    await setDoc(judgeRef, data);
  })());
}

export async function deleteJudge(competitionId, judgeId) {
  return trackWrite(`Tar bort domare ${judgeId}`, (async () => {
    const judgeRef = getCompDocRef(competitionId, 'judges', judgeId);
    await deleteDoc(judgeRef);
  })());
}

export function listenForOfficials(competitionId, callback) {
  const officialsRef = getCompCollectionRef(competitionId, 'officials');
  return onSnapshot(query(officialsRef), (snapshot) => {
    const officials = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    callback(officials);
  }, buildSnapshotErrorHandler('listenForOfficials', callback, []));
}

export async function getOfficials(competitionId) {
  const officialsRef = getCompCollectionRef(competitionId, 'officials');
  const snapshot = await getDocs(query(officialsRef));
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}

export async function getJudges(competitionId) {
  const judgesRef = getCompCollectionRef(competitionId, 'judges');
  const snapshot = await getDocs(query(judgesRef));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function saveOfficial(competitionId, data) {
  if (!competitionId) throw new Error("No competition ID");

  return trackWrite(`Sparar funktionar ${data.name}`, (async () => {
    const officialsRef = getCompCollectionRef(competitionId, 'officials');
    const officialId = data.id || doc(officialsRef).id;
    const officialRef = doc(officialsRef, officialId);
    const roles = normalizeOfficialRoles(data);
    const email = normalizeEmail(data.email);

    let previousEmail = '';
    try {
      const previousSnap = await getDoc(officialRef);
      if (previousSnap.exists()) {
        previousEmail = normalizeEmail(previousSnap.data().email);
      }
    } catch (_) { }

    await setDoc(officialRef, {
      ...data,
      id: officialId,
      email,
      roles,
      updatedAt: Date.now()
    }, { merge: true });

    const competitionRef = doc(db, `artifacts/${appId}/public/data/competitions`, competitionId);
    try {
      if (previousEmail && previousEmail !== email) {
        const removeOldEmailPatch = buildOfficialEmailRemoveUpdate(previousEmail);
        if (removeOldEmailPatch) await updateDoc(competitionRef, removeOldEmailPatch);
      }

      const currentEmailPatch = email
        ? buildOfficialEmailSyncUpdate(email, roles)
        : buildOfficialEmailRemoveUpdate(previousEmail);
      if (currentEmailPatch) await updateDoc(competitionRef, currentEmailPatch);
    } catch (e) {
      console.warn("Kunde inte synka official email", e);
    }

    return officialId;
  })());
}

export async function deleteOfficial(competitionId, officialId) {
  return trackWrite(`Tar bort funktionar ${officialId}`, (async () => {
    const officialRef = getCompDocRef(competitionId, 'officials', officialId);

    let emailToRemove = null;
    try {
      const snap = await getDoc(officialRef);
      if (snap.exists() && snap.data().email) {
        emailToRemove = normalizeEmail(snap.data().email);
      }
    } catch (_) { }

    await deleteDoc(officialRef);

    if (emailToRemove) {
      try {
        await updateDoc(
          doc(db, `artifacts/${appId}/public/data/competitions`, competitionId),
          buildOfficialEmailRemoveUpdate(emailToRemove)
        );
      } catch (e) {
        console.warn("Kunde inte synka borttagning av official email", e);
      }
    }
  })());
}

export async function getSecretConfig(competitionId) {
  if (!competitionId) return {};
  const ref = getCompDocRef(competitionId, 'config', 'secrets');
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : {};
}

export async function saveSecretConfig(competitionId, data) {
  if (!competitionId) throw new Error("Missing competitionId");
  return trackWrite(`Sparar hemlig konfiguration`, (async () => {
    const ref = getCompDocRef(competitionId, 'config', 'secrets');
    await setDoc(ref, data, { merge: true });
  })());
}

export function listenForCompetitionAdmins(competitionId, callback) {
  if (!competitionId) return () => {};
  const ref = getCompCollectionRef(competitionId, 'admins');
  return onSnapshot(ref, (snap) => {
    const list = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    callback(list);
  }, buildSnapshotErrorHandler('listenForCompetitionAdmins', callback, []));
}

export async function deleteCompetitionAdmin(competitionId, uid) {
  if (!competitionId || !uid) throw new Error("Missing params");
  return trackWrite(`Tar bort admin ${uid}`, (async () => {
    const ref = getCompDocRef(competitionId, 'admins', uid);
    await deleteDoc(ref);
  })());
}

export async function joinCompetitionAsAdmin(competitionId, pinCode, user) {
  if (!competitionId || !pinCode || !user) throw new Error("Missing params");

  const docRef = getCompDocRef(competitionId, 'admins', user.uid);
  const rolesToTry = ['admin', 'dressage', 'marathon', 'precision', 'speaker'];
  let successfulRole = null;

  let existingRoles = [];
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.roles)) existingRoles = data.roles;
      else if (data.role) existingRoles = [data.role];
    }
  } catch (_) {}

  for (const role of rolesToTry) {
    try {
      const newRoles = [...new Set([...existingRoles, role])];
      await setDoc(docRef, {
        accessCode: pinCode,
        email: user.email,
        joinedAt: Date.now(),
        roles: newRoles,
        role
      }, { merge: true });
      successfulRole = role;
      break;
    } catch (_) {
      // Try next role. Firestore rules validate which role the PIN grants.
    }
  }

  if (!successfulRole) {
    throw new Error("Kunde inte ansluta. Kontrollera att PIN-koden ar korrekt.");
  }

  return successfulRole;
}
