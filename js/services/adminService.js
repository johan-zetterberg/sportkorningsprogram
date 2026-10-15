import { db, appId, functions, auth } from '../config/firebase-config.js';
import { collection, doc, getDocs, setDoc, onSnapshot, query, where, deleteDoc, getDoc, updateDoc, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { JUDGE_PRIVATE_FIELDS, OFFICIAL_PRIVATE_FIELDS, legacyPrivateFields, mergeOfficials, splitJudgeData, splitOfficialData } from './officialPrivacyUtils.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { trackWrite, getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

const OFFICIAL_SYSTEM_ROLES = ['admin', 'dressage', 'marathon', 'precision', 'speaker'];
const LEGACY_ROLE_EMAIL_FIELDS = {
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

function getRoleEmailDocRef(competitionId, email) {
  return getCompDocRef(competitionId, 'roleEmails', normalizeEmail(email));
}

function buildRoleEmailPayload(email, roles) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRoles = normalizeOfficialRoles({ roles });
  if (!normalizedEmail || normalizedRoles.length === 0) return null;

  return {
    email: normalizedEmail,
    roles: normalizedRoles,
    updatedAt: Date.now()
  };
}

function getOfficialsPrivateRef(competitionId) {
  return getCompCollectionRef(competitionId, 'officialsPrivate');
}

// The officials' contact details this user may read: all of them for admins,
// otherwise only their own (rules: officialsPrivate)
async function loadOfficialPrivateDocs(competitionId) {
  const toList = (snap) => snap.docs.map(d => ({ ...d.data(), id: d.id }));
  try {
    return toList(await getDocs(query(getOfficialsPrivateRef(competitionId))));
  } catch (_) {
    const email = normalizeEmail(auth?.currentUser?.email);
    if (!email) return [];
    try {
      return toList(await getDocs(query(getOfficialsPrivateRef(competitionId), where('email', '==', email))));
    } catch (__) {
      return [];
    }
  }
}

async function getOfficialsWithPrivate(competitionId) {
  const [publicSnap, privateDocs] = await Promise.all([
    getDocs(query(getCompCollectionRef(competitionId, 'officials'))),
    loadOfficialPrivateDocs(competitionId)
  ]);
  return mergeOfficials(publicSnap.docs.map(d => ({ ...d.data(), id: d.id })), privateDocs);
}

async function rebuildRoleEmailAccessDoc(competitionId, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  const mergedRoles = new Set();
  (await getOfficialsWithPrivate(competitionId)).forEach((data) => {
    if (normalizeEmail(data.email) !== normalizedEmail) return;
    normalizeOfficialRoles(data).forEach((role) => mergedRoles.add(role));
  });

  const targetRef = getRoleEmailDocRef(competitionId, normalizedEmail);
  if (mergedRoles.size === 0) {
    await deleteDoc(targetRef).catch(() => {});
    return;
  }

  const payload = buildRoleEmailPayload(normalizedEmail, Array.from(mergedRoles));
  if (payload) {
    await setDoc(targetRef, payload, { merge: true });
  }
}

export function listenForJudges(competitionId, callback) {
  const judgesRef = getCompCollectionRef(competitionId, 'judges');
  return onSnapshot(query(judgesRef), (snapshot) => {
    callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  }, buildSnapshotErrorHandler('listenForJudges', callback, []));
}

const getJudgesPrivateRef = (competitionId) => getCompCollectionRef(competitionId, 'judgesPrivate');

// Contact details and licence in judgesPrivate (admins, and the judge their
// own); name, roles and positions public to the competition's roles
export async function saveJudge(competitionId, judgeId, data) {
  return trackWrite(`Sparar domare ${data.name || judgeId}`, (async () => {
    const { publicData, privateData } = splitJudgeData(data || {});
    const batch = writeBatch(db);
    // Replaces the public document, which also removes contact fields stored there before
    batch.set(getCompDocRef(competitionId, 'judges', judgeId), publicData);
    if (Object.keys(privateData).length > 0) {
      batch.set(doc(getJudgesPrivateRef(competitionId), judgeId), privateData, { merge: true });
    }
    await batch.commit();
  })());
}

// Judges' contact details that the user may read (admins: all; a judge: their own)
async function loadJudgePrivateDocs(competitionId) {
  const toList = (snap) => snap.docs.map(d => ({ ...d.data(), id: d.id }));
  try {
    return toList(await getDocs(query(getJudgesPrivateRef(competitionId))));
  } catch (_) {
    const email = normalizeEmail(auth?.currentUser?.email);
    if (!email) return [];
    try {
      return toList(await getDocs(query(getJudgesPrivateRef(competitionId), where('email', '==', email))));
    } catch (__) {
      return [];
    }
  }
}

/** Moves judges' contact details left on the public documents to judgesPrivate (admin) */
export async function migrateJudgesPrivacy(competitionId) {
  if (!competitionId) return 0;
  const snapshot = await getDocs(query(getCompCollectionRef(competitionId, 'judges')));
  let moved = 0;
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() || {};
    const legacy = legacyPrivateFields(data, JUDGE_PRIVATE_FIELDS);
    if (!legacy.length) continue;
    const { privateData } = splitJudgeData(Object.fromEntries(legacy.map(key => [key, data[key]])));
    const batch = writeBatch(db);
    batch.set(doc(getJudgesPrivateRef(competitionId), docSnap.id), privateData, { merge: true });
    batch.update(docSnap.ref, Object.fromEntries(legacy.map(key => [key, deleteField()])));
    await batch.commit();
    moved += 1;
  }
  return moved;
}

export async function deleteJudge(competitionId, judgeId) {
  return trackWrite(`Tar bort domare ${judgeId}`, (async () => {
    const judgeRef = getCompDocRef(competitionId, 'judges', judgeId);
    const privateRef = doc(getJudgesPrivateRef(competitionId), judgeId);
    const batch = writeBatch(db);
    batch.delete(judgeRef);
    batch.delete(privateRef);
    await batch.commit();
  })());
}

// Officials with the contact details the user may read merged in (admins: all)
export function listenForOfficials(competitionId, callback) {
  const officialsRef = getCompCollectionRef(competitionId, 'officials');
  let publicList = null;
  let privateList = [];
  const emit = () => { if (publicList) callback(mergeOfficials(publicList, privateList)); };

  const unsubPublic = onSnapshot(query(officialsRef), (snapshot) => {
    publicList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    emit();
  }, buildSnapshotErrorHandler('listenForOfficials', callback, []));

  let unsubPrivate = () => { };
  unsubPrivate = onSnapshot(query(getOfficialsPrivateRef(competitionId)), (snapshot) => {
    privateList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    emit();
  }, () => {
    // Not an admin: only the user's own contact details
    loadOfficialPrivateDocs(competitionId).then((docs) => { privateList = docs; emit(); });
  });

  return () => {
    try { unsubPublic(); } catch (_) { }
    try { unsubPrivate(); } catch (_) { }
  };
}

export async function getOfficials(competitionId) {
  return getOfficialsWithPrivate(competitionId);
}

/**
 * Moves contact details still stored on officials/{id} (from before the
 * split) to officialsPrivate/{id}. Admins only; run when the officials page
 * opens. Returns the number of officials moved.
 */
export async function migrateOfficialsPrivacy(competitionId) {
  if (!competitionId) return 0;
  const snapshot = await getDocs(query(getCompCollectionRef(competitionId, 'officials')));
  let moved = 0;
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() || {};
    const legacy = legacyPrivateFields(data);
    if (!legacy.length) continue;
    const { privateData } = splitOfficialData(Object.fromEntries(legacy.map(key => [key, data[key]])));
    const batch = writeBatch(db);
    batch.set(doc(getOfficialsPrivateRef(competitionId), docSnap.id), privateData, { merge: true });
    batch.update(docSnap.ref, Object.fromEntries(legacy.map(key => [key, deleteField()])));
    await batch.commit();
    moved += 1;
  }
  return moved;
}

export async function getJudges(competitionId) {
  const judgesRef = getCompCollectionRef(competitionId, 'judges');
  const [snapshot, privateDocs] = await Promise.all([
    getDocs(query(judgesRef)),
    loadJudgePrivateDocs(competitionId)
  ]);
  return mergeOfficials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), privateDocs);
}

export async function saveOfficial(competitionId, data) {
  if (!competitionId) throw new Error("No competition ID");

  return trackWrite(`Sparar funktionar ${data.name}`, (async () => {
    const officialsRef = getCompCollectionRef(competitionId, 'officials');
    const officialId = data.id || doc(officialsRef).id;
    const officialRef = doc(officialsRef, officialId);
    const privateRef = doc(getOfficialsPrivateRef(competitionId), officialId);
    const roles = normalizeOfficialRoles(data);
    const email = normalizeEmail(data.email);

    let previousEmail = '';
    try {
      const [previousPrivate, previousPublic] = await Promise.all([getDoc(privateRef), getDoc(officialRef)]);
      previousEmail = normalizeEmail(previousPrivate.exists() ? previousPrivate.data().email : '')
        || normalizeEmail(previousPublic.exists() ? previousPublic.data().email : '');
    } catch (error) {
      console.warn('Kunde inte läsa funktionärens tidigare e-post:', error);
    }

    // Contact details in the private document, the rest public to the
    // competition's roles; any contact fields left on the public document
    // from before are removed
    const { publicData, privateData } = splitOfficialData({ ...data, id: officialId, email, roles, updatedAt: Date.now() });
    const batch = writeBatch(db);
    batch.set(officialRef, {
      ...publicData,
      ...Object.fromEntries(OFFICIAL_PRIVATE_FIELDS.map(key => [key, deleteField()]))
    }, { merge: true });
    batch.set(privateRef, { ...privateData, updatedAt: Date.now() }, { merge: true });
    await batch.commit();

    try {
      if (previousEmail && previousEmail !== email) {
        await rebuildRoleEmailAccessDoc(competitionId, previousEmail);
      }
      if (email) {
        await rebuildRoleEmailAccessDoc(competitionId, email);
      }
    } catch (e) {
      console.warn("Kunde inte synka privata funktionarsroller", e);
    }

    return officialId;
  })());
}

export async function deleteOfficial(competitionId, officialId) {
  return trackWrite(`Tar bort funktionar ${officialId}`, (async () => {
    const officialRef = getCompDocRef(competitionId, 'officials', officialId);
    const privateRef = doc(getOfficialsPrivateRef(competitionId), officialId);

    let emailToRemove = null;
    try {
      const [privateSnap, publicSnap] = await Promise.all([getDoc(privateRef), getDoc(officialRef)]);
      emailToRemove = normalizeEmail(privateSnap.exists() ? privateSnap.data().email : '')
        || normalizeEmail(publicSnap.exists() ? publicSnap.data().email : '')
        || null;
    } catch (error) {
      console.warn('Kunde inte läsa funktionärens e-post före borttagning:', error);
    }

    const batch = writeBatch(db);
    batch.delete(officialRef);
    batch.delete(privateRef);
    await batch.commit();

    if (emailToRemove) {
      try {
        await rebuildRoleEmailAccessDoc(competitionId, emailToRemove);
      } catch (e) {
        console.warn("Kunde inte synka borttagning av privata funktionarsroller", e);
      }
    }
  })());
}

export async function migrateLegacyCompetitionRoleEmails(competitionId) {
  if (!competitionId) throw new Error("Missing competitionId");

  return trackWrite('Migrerar rollmejl till privat lagring', (async () => {
    const competitionRef = doc(db, `artifacts/${appId}/public/data/competitions`, competitionId);
    const [competitionSnap, officialsList] = await Promise.all([
      getDoc(competitionRef),
      getOfficialsWithPrivate(competitionId)
    ]);

    const competitionData = competitionSnap.exists() ? competitionSnap.data() || {} : {};
    const roleMap = new Map();

    const addRole = (email, role) => {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !OFFICIAL_SYSTEM_ROLES.includes(role)) return;
      if (!roleMap.has(normalizedEmail)) roleMap.set(normalizedEmail, new Set());
      roleMap.get(normalizedEmail).add(role);
    };

    Object.entries(LEGACY_ROLE_EMAIL_FIELDS).forEach(([role, fields]) => {
      fields.forEach((field) => {
        const values = Array.isArray(competitionData[field]) ? competitionData[field] : [];
        values.forEach((email) => addRole(email, role));
      });
    });

    officialsList.forEach((data) => {
      const email = normalizeEmail(data.email);
      if (!email) return;
      normalizeOfficialRoles(data).forEach((role) => addRole(email, role));
    });

    const batch = writeBatch(db);
    let migratedEmails = 0;
    roleMap.forEach((roles, email) => {
      const payload = buildRoleEmailPayload(email, Array.from(roles));
      if (!payload) return;
      batch.set(getRoleEmailDocRef(competitionId, email), payload, { merge: true });
      migratedEmails += 1;
    });

    const clearPayload = {};
    Object.values(LEGACY_ROLE_EMAIL_FIELDS).flat().forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(competitionData, field)) {
        clearPayload[field] = deleteField();
      }
    });
    if (Object.keys(clearPayload).length > 0) {
      batch.update(competitionRef, clearPayload);
    }

    await batch.commit();
    return {
      migratedEmails,
      clearedFields: Object.keys(clearPayload).length
    };
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
  const callable = httpsCallable(functions, 'joinCompetitionAsOfficial');
  try {
    const result = await callable({
      competitionId,
      pinCode
    });
    const successfulRole = String(result?.data?.role || '').trim();
    if (!successfulRole) {
      throw new Error('Ogiltigt svar fran servern.');
    }
    return successfulRole;
  } catch (error) {
    const message = String(error?.message || '');
    if (error?.code === 'functions/permission-denied') {
      throw new Error("Kunde inte ansluta. Kontrollera att PIN-koden ar korrekt.");
    }
    if (error?.code === 'functions/unauthenticated') {
      throw new Error("Du maste vara inloggad for att ansluta.");
    }
    if (error?.code === 'functions/not-found') {
      throw new Error("Tavlingen kunde inte hittas.");
    }
    if (error?.code === 'functions/failed-precondition') {
      throw new Error("Kontot saknar e-postadress och kan inte ansluta.");
    }
    throw new Error(message || "Kunde inte ansluta funktionarsrollen just nu.");
  }
}
