import { getCompDocRef, trackWrite } from './firestoreService.js';
import { doc, getDoc, setDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from '../config/firebase-config.js';
import { getGlobalState } from '../main.js';
import { isStillRunning } from './secretariatPatchUtils.js';

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

// A result still being timed must not be locked: the judge's next write would
// be refused and the official result would be the half-finished one
async function assertNotRunning(ref, startNumber) {
  const snap = await getDoc(ref);
  if (isStillRunning(snap.exists() ? snap.data() : {})) {
    throw new Error(`#${startNumber} kör just nu. Vänta tills tiden är stoppad innan du finaliserar.`);
  }
}

// --- MARATHON ---
export async function finalizeMarathon(competitionId, startNumber) {
  return trackWrite(`Finaliserar maraton #${startNumber}`, (async () => {
    // Marathon sets status directly on the live document
    const ref = getCompDocRef(competitionId, 'maraton', String(startNumber));
    await assertNotRunning(ref, startNumber);

    // Result and lock document (which activates the security rules) in one
    // batch: never finalized-but-unlocked or the other way round
    const lockRef = doc(db, `competitions/${competitionId}/marathonFinalization/${String(startNumber)}`);
    const batch = writeBatch(db);
    batch.set(ref, {
      finalized: true,
      status: 'Klar',
      updatedAt: serverTimestamp(),
      finalizedBy: getUid()
    }, { merge: true });
    batch.set(lockRef, {
      finalized: true,
      finalizedAt: Date.now(),
      finalizedBy: getUid()
    }, { merge: true });
    await batch.commit();
  })());
}

export async function unfinalizeMarathon(competitionId, startNumber) {
  return trackWrite(`Ångrar finalisering maraton #${startNumber}`, (async () => {
    // Lock and result in one batch, like finalizing: a network error between
    // two writes left an unlocked result still marked finalized (the rules
    // accept the result write because the lock is open after the batch)
    const lockRef = doc(db, `competitions/${competitionId}/marathonFinalization/${String(startNumber)}`);
    const ref = getCompDocRef(competitionId, 'maraton', String(startNumber));
    const batch = writeBatch(db);
    batch.set(lockRef, {
      finalized: false,
      unfinalizedAt: Date.now(),
      unfinalizedBy: getUid()
    }, { merge: true });
    batch.set(ref, {
      finalized: false,
      status: 'Pågår',
      updatedAt: serverTimestamp(),
      unfinalizedBy: getUid()
    }, { merge: true });
    await batch.commit();
  })());
}

// --- PRECISION ---
export async function finalizePrecision(competitionId, startNumber) {
  return trackWrite(`Finaliserar precision #${startNumber}`, (async () => {
    // Precision sets finalized on the precision document
    const ref = getCompDocRef(competitionId, 'precision', String(startNumber));
    await assertNotRunning(ref, startNumber);

    // Result and lock document in one batch (see finalizeMarathon).
    // prioritized: true forces sorting if needed
    const lockRef = doc(db, `competitions/${competitionId}/precisionFinalization/${String(startNumber)}`);
    const batch = writeBatch(db);
    batch.set(ref, {
      prioritized: true,
      finalized: true,
      finalizedAt: Date.now(),
      finalizedBy: getUid()
    }, { merge: true });
    batch.set(lockRef, {
      finalized: true,
      finalizedAt: Date.now(),
      finalizedBy: getUid()
    }, { merge: true });
    await batch.commit();
  })());
}

export async function unfinalizePrecision(competitionId, startNumber) {
  return trackWrite(`Ångrar finalisering precision #${startNumber}`, (async () => {
    // Lock and result in one batch (see unfinalizeMarathon)
    const lockRef = doc(db, `competitions/${competitionId}/precisionFinalization/${String(startNumber)}`);
    const ref = getCompDocRef(competitionId, 'precision', String(startNumber));
    const batch = writeBatch(db);
    batch.set(lockRef, {
      finalized: false,
      unfinalizedAt: Date.now(),
      unfinalizedBy: getUid()
    }, { merge: true });
    batch.set(ref, {
      finalized: false,
      unfinalizedAt: Date.now(),
      unfinalizedBy: getUid()
    }, { merge: true });
    await batch.commit();
  })());
}
