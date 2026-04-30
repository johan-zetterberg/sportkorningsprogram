import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDocs, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompCollectionRef } from './firestoreService.js';;

export async function getCompetitionMessages(competitionId) {
  if (!competitionId) return [];
  try {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/messages`);
    const q = query(colRef, orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Could not fetch messages:', err);
    return [];
  }
}

export function listenForCompetitionMessages(competitionId, callback) {
  const col = getCompCollectionRef(competitionId, 'messages');
  return onSnapshot(query(col, orderBy('timestamp', 'desc')), (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(msgs);
  });
}

export async function saveCompetitionMessage(competitionId, msgData) {
  if (!competitionId) throw new Error("Missing competitionId");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/messages`);
  const payload = {
    ...msgData,
    timestamp: serverTimestamp()
  };
  await addDoc(colRef, payload);
}

export async function deleteCompetitionMessage(competitionId, messageId) {
  if (!competitionId || !messageId) throw new Error("Missing params");
  const docRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/messages`, messageId);
  await deleteDoc(docRef);
}

export async function getCompetitionDocuments(competitionId) {
  if (!competitionId) return [];
  try {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/documents`);
    const q = query(colRef, orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Could not fetch documents:', err);
    return [];
  }
}

export async function saveCompetitionDocument(competitionId, docData) {
  if (!competitionId) throw new Error("Missing competitionId");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/documents`);
  const payload = {
    ...docData,
    timestamp: serverTimestamp()
  };
  await addDoc(colRef, payload);
}

export async function deleteCompetitionDocument(competitionId, docId) {
  if (!competitionId || !docId) throw new Error("Missing params");
  const docRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/documents`, docId);
  await deleteDoc(docRef);
}
