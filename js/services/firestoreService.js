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
// The list of unsent writes is kept in memory, but Firestore's own queue is
// persisted: writes made offline before a reload are still waiting. At start
// the list shows "unknown number waiting" until Firestore says those writes
// reached the server. Entries are cleared when Firestore confirms the writes
// made before the check, on 'online' and every SYNC_CHECK_MS while the list
// is not empty (the 'online' event is not reliable on every device).
const RESTORED_QUEUE_ID = 'restored-queue';
const RESTORED_QUEUE_DELAY_MS = 1500;
const SYNC_CHECK_MS = 30000;

let startupSettled = false;
waitForPendingWrites(db)
  .catch((e) => console.warn('Kunde inte läsa väntande skrivningar:', e))
  .finally(() => {
    startupSettled = true;
    syncService.remove(RESTORED_QUEUE_ID);
  });
// Resolved at once when nothing waits: only a slow answer shows the marker
setTimeout(() => {
  if (!startupSettled) syncService.add(RESTORED_QUEUE_ID, 'Okänt antal ändringar från tidigare väntar på uppladdning');
}, RESTORED_QUEUE_DELAY_MS);

let syncCheckRunning = false;
async function confirmSyncedWrites() {
  if (syncCheckRunning || navigator.onLine === false) return;
  syncCheckRunning = true;
  const cutoff = Date.now();
  try {
    await waitForPendingWrites(db);
    syncService.removeOlderThan(cutoff, [RESTORED_QUEUE_ID]);
  } catch (e) {
    console.warn('Fel vid återsynk:', e);
  } finally {
    syncCheckRunning = false;
  }
}
window.addEventListener('online', confirmSyncedWrites);
setInterval(() => {
  if (syncService.count > 0) confirmSyncedWrites();
}, SYNC_CHECK_MS);

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
