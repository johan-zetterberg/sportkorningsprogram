import { getCompDocRef, trackWrite } from './firestoreService.js';
import { doc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from '../config/firebase-config.js';
import { getGlobalState } from '../main.js';

// =========================================================================
// FINALIZATION SERVICE
// -------------------------------------------------------------------------
// Centralizes logic for finalizing/unfinalizing results across all phases.
// =========================================================================

function getUid() {
  return getGlobalState('currentUser')?.uid || null;
}

// --- DRESSAGE ---
export async function finalizeDressage(competitionId, startNumber) {
  return trackWrite(`Finaliserar dressyr #${startNumber}`, (async () => {
    const ref = doc(db, `competitions/${competitionId}/dressageFinalization/${String(startNumber)}`);
    await setDoc(ref, {
      finalized: true,
      finalizedAt: Date.now(),
      finalizedBy: getUid()
    }, { merge: true });
  })());
}

export async function unfinalizeDressage(competitionId, startNumber) {
  return trackWrite(`Ångrar finalisering dressyr #${startNumber}`, (async () => {
    const ref = doc(db, `competitions/${competitionId}/dressageFinalization/${String(startNumber)}`);
    await setDoc(ref, {
      finalized: false,
      unfinalizedAt: Date.now(),
      unfinalizedBy: getUid()
    }, { merge: true });
  })());
}

// --- MARATHON ---
export async function finalizeMarathon(competitionId, startNumber) {
  return trackWrite(`Finaliserar maraton #${startNumber}`, (async () => {
    // Marathon sets status directly on the live document
    const ref = getCompDocRef(competitionId, 'maraton', String(startNumber));
    await setDoc(ref, { 
      finalized: true, 
      status: 'Klar', 
      updatedAt: serverTimestamp(),
      finalizedBy: getUid()
    }, { merge: true });

    // Also write to the lock document to activate Firestore security rules
    const lockRef = doc(db, `competitions/${competitionId}/marathonFinalization/${String(startNumber)}`);
    await setDoc(lockRef, {
      finalized: true,
      finalizedAt: Date.now(),
      finalizedBy: getUid()
    }, { merge: true });
  })());
}

export async function unfinalizeMarathon(competitionId, startNumber) {
  return trackWrite(`Ångrar finalisering maraton #${startNumber}`, (async () => {
    // Release the Firestore lock first, so the write to artifacts can succeed
    const lockRef = doc(db, `competitions/${competitionId}/marathonFinalization/${String(startNumber)}`);
    await setDoc(lockRef, {
      finalized: false,
      unfinalizedAt: Date.now(),
      unfinalizedBy: getUid()
    }, { merge: true });

    const ref = getCompDocRef(competitionId, 'maraton', String(startNumber));
    await setDoc(ref, { 
      finalized: false, 
      status: 'Pågår', 
      updatedAt: serverTimestamp(),
      unfinalizedBy: getUid()
    }, { merge: true });
  })());
}

// --- PRECISION ---
export async function finalizePrecision(competitionId, startNumber) {
  return trackWrite(`Finaliserar precision #${startNumber}`, (async () => {
    // Precision sets finalized on the precision document
    const ref = getCompDocRef(competitionId, 'precision', String(startNumber));
    // We include prioritized: true to force sorting if needed
    await setDoc(ref, { 
      prioritized: true, 
      finalized: true,
      finalizedAt: Date.now(),
      finalizedBy: getUid()
    }, { merge: true });

    // Also write to the lock document to activate Firestore security rules
    const lockRef = doc(db, `competitions/${competitionId}/precisionFinalization/${String(startNumber)}`);
    await setDoc(lockRef, {
      finalized: true,
      finalizedAt: Date.now(),
      finalizedBy: getUid()
    }, { merge: true });
  })());
}

export async function unfinalizePrecision(competitionId, startNumber) {
  return trackWrite(`Ångrar finalisering precision #${startNumber}`, (async () => {
    // Release the Firestore lock first, so the write to artifacts can succeed
    const lockRef = doc(db, `competitions/${competitionId}/precisionFinalization/${String(startNumber)}`);
    await setDoc(lockRef, {
      finalized: false,
      unfinalizedAt: Date.now(),
      unfinalizedBy: getUid()
    }, { merge: true });

    const ref = getCompDocRef(competitionId, 'precision', String(startNumber));
    await setDoc(ref, { 
      finalized: false,
      unfinalizedAt: Date.now(),
      unfinalizedBy: getUid()
    }, { merge: true });
  })());
}
