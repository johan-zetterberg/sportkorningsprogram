import { db, appId } from '../config/firebase-config.js';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  waitForPendingWrites
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { syncService } from './syncService.js';

// === GLOBAL SYNC LISTENER ===
window.addEventListener('online', async () => {
  try {
    await waitForPendingWrites(db);
    syncService.clearAll();
  } catch (e) {
    console.warn('Fel vid återsynk:', e);
  }
});

// === HJÄLPFUNKTION FÖR ATT WRAPPA SKRIVNINGAR ===
export async function trackWrite(description, promise) {
  const id = Date.now().toString() + Math.random().toString().slice(2, 6);
  syncService.add(id, description);
  try {
    const res = await promise;
    if (navigator.onLine) {
      syncService.remove(id);
    }
    return res;
  } catch (err) {
    syncService.remove(id);
    throw err;
  }
}

// === HJÄLPFUNKTION FÖR SÖKVÄGAR ===
export const getCompCollectionRef = (competitionId, collectionName) => {
  return collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/${collectionName}`);
};

export const getCompDocRef = (competitionId, collectionName, docId) => {
  return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/${collectionName}`, docId);
};

// =================================================================
// TÄVLINGSFUNKTIONER (Base)
// =================================================================

export async function getDocData(collectionName, docId) {
  if (!collectionName || !docId) return null;
  const ref = doc(db, `artifacts/${appId}/public/data/${collectionName}/${docId}`);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function setDocData(collectionName, docId, data, merge = true) {
  if (!collectionName || !docId) return;
  return trackWrite(`Sätter data ${collectionName}/${docId}`, (async () => {
    const p = `artifacts/${appId}/public/data/${collectionName}/${docId}`;
    const ref = doc(db, p);
    try {
      await setDoc(ref, data, { merge });
    } catch (e) {
      throw new Error(`Failed to write to [${p}]: ${e.message} (${e.code})`);
    }
    return { ok: true, path: ref.path };
  })());
}
