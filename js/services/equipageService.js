import { db, appId } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, onSnapshot, query, runTransaction, deleteDoc, writeBatch, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

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

export async function getEquipages(competitionId) {
  const equipagesRef = getCompCollectionRef(competitionId, 'equipages');
  const snapshot = await getDocs(equipagesRef);

  const results = snapshot.docs.map(doc => {
    const data = doc.data();
    return { id: doc.id, ...data }; 
  });
  return results;
}

export function listenForEquipages(competitionId, callback) {
  const equipagesRef = getCompCollectionRef(competitionId, 'equipages');
  return onSnapshot(query(equipagesRef), (snapshot) => {
    const equipages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); 
    callback(equipages);
  }, buildSnapshotErrorHandler('listenForEquipages', callback, []));
}

export async function updateEquipage(competitionId, equipageId, data) {
  const safeCompetitionId = normalizeDocumentId(competitionId, 'Competition ID');
  const safeEquipageId = normalizeDocumentId(equipageId, 'Equipage ID');
  const safeData = cleanFirestoreData(data || {});
  try {
    return await trackWrite(`Uppdaterar ekipage ${equipageId}`, (async () => {
      const ref = doc(db, `artifacts/${appId}/public/data/competitions/${safeCompetitionId}/equipages/${safeEquipageId}`);
      await runTransaction(db, async (transaction) => {
        const fresh = await transaction.get(ref);
        if (!fresh.exists()) throw new Error("Equipage does not exist!");
        transaction.update(ref, safeData);
      });
    })());
  } catch (error) {
    throw mapEquipageWriteError(error);
  }
}

export async function saveEquipage(competitionId, startNumber, equipageData) {
  const safeCompetitionId = normalizeDocumentId(competitionId, 'Competition ID');
  const safeStartNumber = normalizeDocumentId(startNumber, 'Startnummer');
  const safeData = cleanFirestoreData(equipageData || {});
  try {
    return await trackWrite(`Sparar ekipage #${startNumber}`, (async () => {
      const equipageRef = getCompDocRef(safeCompetitionId, 'equipages', safeStartNumber);
      await setDoc(equipageRef, safeData, { merge: true });
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
    await deleteDoc(equipageRef);
  })());
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
    const colRef = getCompCollectionRef(competitionId, 'equipages');
    const snap = await getDocs(colRef);
    if (snap.empty) return 0;

    const { writeBatch } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  })());
}
