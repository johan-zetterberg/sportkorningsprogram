import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDocs, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompCollectionRef } from './firestoreService.js';;

function normalizeStartNumberList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v).trim()).filter(Boolean);
}

export function getMessageAudience(message) {
  if (message?.audience && typeof message.audience === 'object') {
    return {
      public: message.audience.public === true,
      drivers: message.audience.drivers !== false
    };
  }

  // Legacy behavior:
  // no target = shown to public and drivers
  // single target = driver-only private message
  return {
    public: !message?.targetStartNumber,
    drivers: true
  };
}

export function getMessageTargetStartNumbers(message) {
  const selected = normalizeStartNumberList(message?.targetStartNumbers);
  if (selected.length) return selected;
  if (message?.targetStartNumber != null && String(message.targetStartNumber).trim() !== '') {
    return [String(message.targetStartNumber).trim()];
  }
  return [];
}

export function isMessageVisibleToPublic(message) {
  const audience = getMessageAudience(message);
  return audience.public === true;
}

export function isMessageVisibleToDriver(message, startNumber) {
  const audience = getMessageAudience(message);
  if (!audience.drivers) return false;

  const targets = getMessageTargetStartNumbers(message);
  if (!targets.length) return true;
  return targets.includes(String(startNumber).trim());
}

export function getDocumentAudience(document) {
  if (document?.audience && typeof document.audience === 'object') {
    return {
      public: document.audience.public === true,
      drivers: document.audience.drivers !== false
    };
  }

  // Legacy behavior: existing documents are visible to both
  return {
    public: true,
    drivers: true
  };
}

export function isDocumentVisibleToPublic(document) {
  const audience = getDocumentAudience(document);
  return audience.public === true;
}

export function isDocumentVisibleToDriver(document) {
  const audience = getDocumentAudience(document);
  return audience.drivers === true;
}

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
    timestamp: serverTimestamp(),
    uploadedAt: serverTimestamp()
  };
  await addDoc(colRef, payload);
}

export async function deleteCompetitionDocument(competitionId, docId) {
  if (!competitionId || !docId) throw new Error("Missing params");
  const docRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/documents`, docId);
  await deleteDoc(docRef);
}
