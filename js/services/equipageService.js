import { db, appId } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, onSnapshot, query, runTransaction, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef, getCompDocRef } from './firestoreService.js';;

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
  });
}

export async function updateEquipage(competitionId, equipageId, data) {
  return trackWrite(`Uppdaterar ekipage ${equipageId}`, (async () => {
    const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/equipages/${equipageId}`);
    await runTransaction(db, async (transaction) => {
      const fresh = await transaction.get(ref);
      if (!fresh.exists()) throw new Error("Equipage does not exist!");
      transaction.update(ref, data);
    });
  })());
}

export async function saveEquipage(competitionId, startNumber, equipageData) {
  return trackWrite(`Sparar ekipage #${startNumber}`, (async () => {
    const equipageRef = getCompDocRef(competitionId, 'equipages', startNumber.toString());
    await runTransaction(db, async (transaction) => {
      // eslint-disable-next-line no-unused-vars
      const _ignored = await transaction.get(equipageRef);
      transaction.set(equipageRef, equipageData, { merge: true });
    });
  })());
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
