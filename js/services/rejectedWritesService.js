import { db, appId, auth } from '../config/firebase-config.js';
import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { buildRejectedWriteEntry } from './rejectedWritesUtils.js';

// Writes from the field that the server refused after they were queued
// offline (e.g. the result was finalized before the device got signal). The
// device records them here so the secretariat sees what never arrived.

function rejectedWritesRef(competitionId) {
  return collection(db, `artifacts/${appId}/private/data/competitions/${competitionId}/rejectedWrites`);
}

/**
 * Records a refused write. Call it from an onLateError callback:
 *
 *   reportRejectedWrite(compId, {
 *     discipline: 'marathon',          // 'dressage' | 'marathon' | 'precision'
 *     startNumber: 12,
 *     obstacle: 4,                     // optional, marathon obstacles
 *     payloadSummary: { timeInSeconds: 41.2, knockdowns: 1 }, // object or text
 *     error,                           // optional, the refusal (its code is kept)
 *     source: 'maraton-input'          // optional, the page
 *   });
 *
 * Best effort: never throws and never waits for the server (the promise
 * resolves with the document reference, or null when it could not be written).
 */
export function reportRejectedWrite(competitionId, details = {}) {
  try {
    if (!competitionId) return Promise.resolve(null);
    const uid = auth?.currentUser?.uid;
    if (!uid) return Promise.resolve(null);
    const entry = buildRejectedWriteEntry(details);
    return addDoc(rejectedWritesRef(competitionId), {
      ...entry,
      reportedBy: uid,
      reportedAt: serverTimestamp()
    }).catch((error) => {
      console.warn('Kunde inte registrera den nekade skrivningen:', error);
      return null;
    });
  } catch (error) {
    console.warn('Kunde inte registrera den nekade skrivningen:', error);
    return Promise.resolve(null);
  }
}

/** The refused writes, newest first (competition staff; see the rules) */
export async function listRejectedWrites(competitionId, { discipline = null, max = 100 } = {}) {
  if (!competitionId) return [];
  const snap = await getDocs(query(rejectedWritesRef(competitionId), orderBy('reportedAt', 'desc'), limit(max)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(entry => !discipline || entry.discipline === discipline);
}
