import { db, appId } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, onSnapshot, query, runTransaction, deleteDoc, writeBatch, setDoc, collection, where, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

const PRIVATE_EQUIPAGE_FIELDS = new Set([
  'address',
  'bornYear',
  'company',
  'contactEmail',
  'contactPhone',
  'email',
  'gender',
  'licence',
  'license',
  'licenseNo',
  'licenseYear',
  'mobile',
  'personnummer',
  'phone',
  'ssn'
]);

function normalizeDocumentId(value, label) {
  const id = String(value ?? '').trim();
  if (!id) throw new Error(`${label} saknas.`);
  if (id.includes('/')) throw new Error(`${label} får inte innehålla '/'.`);
  return id;
}

function cleanFirestoreString(value) {
  const text = String(value ?? '');
  let clean = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        clean += text[i] + text[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) continue;
    clean += text[i];
  }
  return clean;
}

function cleanFirestoreData(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return cleanFirestoreString(value);
  if (Array.isArray(value)) {
    return value.map(item => {
      const cleaned = cleanFirestoreData(item);
      return cleaned === undefined ? null : cleaned;
    });
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      const cleaned = cleanFirestoreData(item);
      if (cleaned !== undefined) out[key] = cleaned;
    });
    return out;
  }
  return value;
}

function mapEquipageWriteError(error) {
  if (!error) return error;
  if (error.code === 'permission-denied') {
    return new Error('Du saknar behörighet att ändra detta ekipage. Kontrollera att du är inloggad med samma e-postadress som anmälan eller kontakta sekretariatet.');
  }
  return error;
}

function getPrivateEquipageCollectionRef(competitionId) {
  return collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/equipagePrivate`);
}

function getPrivateEquipageDocRef(competitionId, equipageId) {
  return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/equipagePrivate/${equipageId}`);
}

function splitEquipageData(data = {}) {
  const publicData = {};
  const privateData = {};

  Object.entries(data).forEach(([key, value]) => {
    if (PRIVATE_EQUIPAGE_FIELDS.has(key)) {
      privateData[key] = (key === 'email' || key === 'contactEmail')
        ? String(value || '').trim().toLowerCase()
        : value;
    }
    else publicData[key] = value;
  });

  return { publicData, privateData };
}

function mergeEquipageMaps(publicDocs = [], privateDocs = []) {
  const merged = new Map();
  publicDocs.forEach(entry => merged.set(String(entry.id), { ...entry }));
  privateDocs.forEach(entry => {
    const id = String(entry.id);
    merged.set(id, { ...(merged.get(id) || { id }), ...entry });
  });
  return Array.from(merged.values());
}

export async function getEquipages(competitionId, options = {}) {
  const equipagesRef = getCompCollectionRef(competitionId, 'equipages');
  const snapshot = await getDocs(equipagesRef);

  const results = snapshot.docs.map(item => {
    const data = item.data();
    return { id: item.id, ...data };
  });

  if (!options.includePrivate) return results;

  try {
    const privateSnapshot = await getDocs(getPrivateEquipageCollectionRef(competitionId));
    const privateDocs = privateSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    return mergeEquipageMaps(results, privateDocs);
  } catch (error) {
    console.warn('Kunde inte ladda privata ekipageuppgifter:', error);
    return results;
  }
}

export function listenForEquipages(competitionId, callback, options = {}) {
  const equipagesRef = getCompCollectionRef(competitionId, 'equipages');

  if (!options.includePrivate) {
    return onSnapshot(query(equipagesRef), (snapshot) => {
      const equipages = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      callback(equipages);
    }, buildSnapshotErrorHandler('listenForEquipages', callback, []));
  }

  const publicMap = new Map();
  const privateMap = new Map();
  let hasPublicSnapshot = false;

  const emit = () => {
    if (!hasPublicSnapshot) return;
    callback(mergeEquipageMaps(Array.from(publicMap.values()), Array.from(privateMap.values())));
  };

  const syncMap = (targetMap, snapshot) => {
    targetMap.clear();
    snapshot.docs.forEach(item => {
      targetMap.set(String(item.id), { id: item.id, ...item.data() });
    });
  };

  const unsubPublic = onSnapshot(query(equipagesRef), (snapshot) => {
    hasPublicSnapshot = true;
    syncMap(publicMap, snapshot);
    emit();
  }, buildSnapshotErrorHandler('listenForEquipages', callback, []));

  const unsubPrivate = onSnapshot(query(getPrivateEquipageCollectionRef(competitionId)), (snapshot) => {
    syncMap(privateMap, snapshot);
    emit();
  }, (error) => {
    console.warn('Kunde inte lyssna på privata ekipageuppgifter:', error);
    privateMap.clear();
    emit();
  });

  return () => {
    try { unsubPublic(); } catch (_) { }
    try { unsubPrivate(); } catch (_) { }
  };
}

export async function updateEquipage(competitionId, equipageId, data) {
  const safeCompetitionId = normalizeDocumentId(competitionId, 'Competition ID');
  const safeEquipageId = normalizeDocumentId(equipageId, 'Equipage ID');
  const safeData = cleanFirestoreData(data || {});
  const { publicData, privateData } = splitEquipageData(safeData);
  try {
    return await trackWrite(`Uppdaterar ekipage ${equipageId}`, (async () => {
      const ref = doc(db, `artifacts/${appId}/public/data/competitions/${safeCompetitionId}/equipages/${safeEquipageId}`);
      await runTransaction(db, async (transaction) => {
        const fresh = await transaction.get(ref);
        if (!fresh.exists()) throw new Error("Equipage does not exist!");
        if (Object.keys(publicData).length > 0) transaction.update(ref, publicData);
      });
      if (Object.keys(privateData).length > 0) {
        await setDoc(getPrivateEquipageDocRef(safeCompetitionId, safeEquipageId), privateData, { merge: true });
      }
    })());
  } catch (error) {
    throw mapEquipageWriteError(error);
  }
}

export async function saveEquipage(competitionId, startNumber, equipageData) {
  const safeCompetitionId = normalizeDocumentId(competitionId, 'Competition ID');
  const safeStartNumber = normalizeDocumentId(startNumber, 'Startnummer');
  const safeData = cleanFirestoreData(equipageData || {});
  const { publicData, privateData } = splitEquipageData(safeData);
  try {
    return await trackWrite(`Sparar ekipage #${startNumber}`, (async () => {
      const equipageRef = getCompDocRef(safeCompetitionId, 'equipages', safeStartNumber);
      if (Object.keys(publicData).length > 0) {
        await setDoc(equipageRef, publicData, { merge: true });
      }
      if (Object.keys(privateData).length > 0) {
        await setDoc(getPrivateEquipageDocRef(safeCompetitionId, safeStartNumber), privateData, { merge: true });
      }
    })());
  } catch (error) {
    throw mapEquipageWriteError(error);
  }
}

export async function deleteEquipage(competitionId, equipageId) {
  if (!competitionId || !equipageId) {
    throw new Error("Competition ID och Equipage ID krävs för att kunna radera.");
  }
  return trackWrite(`Raderar ekipage ${equipageId}`, (async () => {
    const equipageRef = getCompDocRef(competitionId, 'equipages', String(equipageId));
    const privateRef = getPrivateEquipageDocRef(competitionId, String(equipageId));
    await deleteDoc(equipageRef);
    try {
      await deleteDoc(privateRef);
    } catch (_) { }
  })());
}

export async function migrateEquipagePrivacy(competitionId) {
  const safeCompetitionId = normalizeDocumentId(competitionId, 'Competition ID');
  return trackWrite('Migrerar privata ekipageuppgifter', (async () => {
    const equipagesRef = getCompCollectionRef(safeCompetitionId, 'equipages');
    const snapshot = await getDocs(equipagesRef);
    let migrated = 0;

    for (const item of snapshot.docs) {
      const { privateData } = splitEquipageData(cleanFirestoreData(item.data() || {}));
      if (Object.keys(privateData).length === 0) continue;

      const batch = writeBatch(db);
      batch.set(getPrivateEquipageDocRef(safeCompetitionId, item.id), privateData, { merge: true });

      const clearPayload = {};
      Object.keys(privateData).forEach((key) => {
        clearPayload[key] = deleteField();
      });
      batch.set(item.ref, clearPayload, { merge: true });

      await batch.commit();
      migrated += 1;
    }

    return { total: snapshot.size, migrated };
  })());
}

export async function getEquipagePrivateData(competitionId, equipageId) {
  if (!competitionId || !equipageId) return null;
  const ref = getPrivateEquipageDocRef(competitionId, String(equipageId).trim());
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function findClaimableEquipagesByEmail(competitionId, email) {
  if (!competitionId || !email) return [];
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!normalizedEmail) return [];

  const privateRef = getPrivateEquipageCollectionRef(competitionId);
  const privateQuery = query(privateRef, where('email', '==', normalizedEmail));
  const snapshot = await getDocs(privateQuery);
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function getComputedResultForEquipage(competitionId, equipageId) {
  if (!competitionId || !equipageId) return null;
  const sn = String(equipageId).trim();
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/computed_equipages/${sn}`);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function clearAllEquipages(competitionId) {
  return trackWrite(`Rensar alla ekipage`, (async () => {
    const publicRef = getCompCollectionRef(competitionId, 'equipages');
    const privateRef = getPrivateEquipageCollectionRef(competitionId);
    const [publicSnap, privateSnap] = await Promise.all([
      getDocs(publicRef),
      getDocs(privateRef)
    ]);
    if (publicSnap.empty && privateSnap.empty) return 0;

    const { writeBatch } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    const batch = writeBatch(db);
    publicSnap.forEach(d => batch.delete(d.ref));
    privateSnap.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return Math.max(publicSnap.size, privateSnap.size);
  })());
}
