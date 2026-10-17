import { getCompDocRef, trackWrite } from './firestoreService.js';
import { doc, collection, getDoc, getDocs, query, orderBy, limit, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
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

/**
 * Sets the lock document and adds an entry to finalizationLog in the same
 * batch. The lock only keeps the latest change; the log keeps who finalized or
 * unlocked which result and when. The rules refuse a lock change whose
 * lastLogId does not name a log entry written in the same batch.
 */
function setLock(batch, competitionId, discipline, startNumber, finalized) {
  const user = getGlobalState('currentUser') || {};
  const logRef = doc(collection(db, `competitions/${competitionId}/finalizationLog`));
  batch.set(logRef, {
    discipline,
    action: finalized ? 'finalize' : 'unfinalize',
    startNumber: String(startNumber),
    by: user.uid || null,
    byName: user.displayName || user.email || null,
    at: serverTimestamp()
  });
  const lockRef = doc(db, `competitions/${competitionId}/${discipline}Finalization/${String(startNumber)}`);
  batch.set(lockRef, finalized
    ? { finalized: true, finalizedAt: Date.now(), finalizedBy: getUid(), lastLogId: logRef.id }
    : { finalized: false, unfinalizedAt: Date.now(), unfinalizedBy: getUid(), lastLogId: logRef.id },
  { merge: true });
}

/** The finalize/unlock history, newest first (admins only, see the rules) */
export async function getFinalizationLog(competitionId, max = 300) {
  const q = query(collection(db, `competitions/${competitionId}/finalizationLog`), orderBy('at', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- DRESSAGE ---
export async function finalizeDressage(competitionId, startNumber) {
  return trackWrite(`Finaliserar dressyr #${startNumber}`, (async () => {
    const batch = writeBatch(db);
    setLock(batch, competitionId, 'dressage', startNumber, true);
    await batch.commit();
  })());
}

export async function unfinalizeDressage(competitionId, startNumber) {
  return trackWrite(`Ångrar finalisering dressyr #${startNumber}`, (async () => {
    const batch = writeBatch(db);
    setLock(batch, competitionId, 'dressage', startNumber, false);
    await batch.commit();
  })());
}

// A result still being timed must not be locked: the judge's next write would
// be refused and the official result would be the half-finished one
async function assertNotRunning(ref, startNumber, { obstacleWork = false } = {}) {
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  if (isStillRunning(data)) {
    throw new Error(`#${startNumber} kör just nu. Vänta tills tiden är stoppad innan du finaliserar.`);
  }
  // Marathon: an obstacle time stopped but not saved yet is still being judged
  if (obstacleWork && data.inProgress === true && data.currentObstacle != null) {
    throw new Error(`#${startNumber} har en osparad hindertid i hinder ${data.currentObstacle}. Vänta tills hinderdomaren har sparat innan du finaliserar.`);
  }
}

// --- MARATHON ---
export async function finalizeMarathon(competitionId, startNumber) {
  return trackWrite(`Finaliserar maraton #${startNumber}`, (async () => {
    // Marathon sets status directly on the live document
    const ref = getCompDocRef(competitionId, 'maraton', String(startNumber));
    await assertNotRunning(ref, startNumber, { obstacleWork: true });

    // Result and lock document (which activates the security rules) in one
    // batch: never finalized-but-unlocked or the other way round
    const batch = writeBatch(db);
    batch.set(ref, {
      finalized: true,
      status: 'Klar',
      updatedAt: serverTimestamp(),
      finalizedBy: getUid()
    }, { merge: true });
    setLock(batch, competitionId, 'marathon', startNumber, true);
    await batch.commit();
  })());
}

export async function unfinalizeMarathon(competitionId, startNumber) {
  return trackWrite(`Ångrar finalisering maraton #${startNumber}`, (async () => {
    // Lock and result in one batch, like finalizing: a network error between
    // two writes left an unlocked result still marked finalized (the rules
    // accept the result write because the lock is open after the batch)
    const ref = getCompDocRef(competitionId, 'maraton', String(startNumber));
    const batch = writeBatch(db);
    setLock(batch, competitionId, 'marathon', startNumber, false);
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
    const batch = writeBatch(db);
    batch.set(ref, {
      prioritized: true,
      finalized: true,
      finalizedAt: Date.now(),
      finalizedBy: getUid()
    }, { merge: true });
    setLock(batch, competitionId, 'precision', startNumber, true);
    await batch.commit();
  })());
}

export async function unfinalizePrecision(competitionId, startNumber) {
  return trackWrite(`Ångrar finalisering precision #${startNumber}`, (async () => {
    // Lock and result in one batch (see unfinalizeMarathon)
    const ref = getCompDocRef(competitionId, 'precision', String(startNumber));
    const batch = writeBatch(db);
    setLock(batch, competitionId, 'precision', startNumber, false);
    batch.set(ref, {
      finalized: false,
      unfinalizedAt: Date.now(),
      unfinalizedBy: getUid()
    }, { merge: true });
    await batch.commit();
  })());
}
