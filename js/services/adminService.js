import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDocs, setDoc, onSnapshot, query, deleteDoc, getDoc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

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
    const officials = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(officials);
  }, buildSnapshotErrorHandler('listenForOfficials', callback, []));
}

export async function getOfficials(competitionId) {
  const officialsRef = getCompCollectionRef(competitionId, 'officials');
  const snapshot = await getDocs(query(officialsRef));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

    await setDoc(officialRef, {
      ...data,
      updatedAt: Date.now()
    }, { merge: true });

    if (data.email) {
      try {
        const roleKey = data.role === 'admin' ? 'officialEmails' : `${data.role}Emails`;
        await updateDoc(doc(db, `artifacts/${appId}/public/data/competitions`, competitionId), {
          [roleKey]: arrayUnion(data.email.toLowerCase().trim())
        });
      } catch (e) {
        console.warn("Kunde inte synka official email", e);
      }
    }

    return officialId;
  })());
}

export async function deleteOfficial(competitionId, officialId) {
  return trackWrite(`Tar bort funktionar ${officialId}`, (async () => {
    const officialRef = getCompDocRef(competitionId, 'officials', officialId);

    let emailToRemove = null;
    let roleToRemove = 'admin';
    try {
      const snap = await getDoc(officialRef);
      if (snap.exists() && snap.data().email) {
        emailToRemove = snap.data().email.toLowerCase().trim();
        roleToRemove = snap.data().role || 'admin';
      }
    } catch (_) {}

    await deleteDoc(officialRef);

    if (emailToRemove) {
      try {
        const roleKey = roleToRemove === 'admin' ? 'officialEmails' : `${roleToRemove}Emails`;
        await updateDoc(doc(db, `artifacts/${appId}/public/data/competitions`, competitionId), {
          [roleKey]: arrayRemove(emailToRemove)
        });
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

  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists() || userSnap.data().role === 'publik' || !userSnap.data().role) {
      await setDoc(userRef, { role: 'funktionar' }, { merge: true });
    }
  } catch (e) {
    console.warn("Kunde inte uppgradera global roll", e);
  }

  return successfulRole;
}
