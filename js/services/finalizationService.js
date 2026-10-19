import { getCompCollectionRef, getCompDocRef, trackWrite } from './firestoreService.js';
import { doc, collection, getDoc, getDocs, getDocFromServer, getDocsFromServer, query, orderBy, limit, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { getGlobalState } from '../main.js';
import { isStillRunning } from './secretariatPatchUtils.js';
import { normalizeMarathonDoc } from '../core-engine/stateSelector.js';
import { finalizeConfirmMessage, findDressageGaps, findMarathonGaps, findPrecisionGaps } from './finalizeCompletenessUtils.js';

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

// --- COMPLETENESS BEFORE FINALIZING ---

// The server's copy when there is signal; offline the device's copy (noted)
async function readDocFresh(ref, notes) {
  try {
    return await getDocFromServer(ref);
  } catch {
    notes.offline = true;
    return getDoc(ref);
  }
}

async function readDocsFresh(ref, notes) {
  try {
    return await getDocsFromServer(ref);
  } catch {
    notes.offline = true;
    return getDocs(ref);
  }
}

const dataOf = (snap) => (snap?.exists() ? snap.data() : null);

/**
 * What is missing for one result before it is finalized: expected data
 * (obstacles of the class's course, stage times, observer log; a precision
 * time; a protocol per assigned dressage judge) compared with what came in.
 * Returns Swedish lines for the confirmation (empty: nothing missing).
 */
export async function findFinalizeGaps(competitionId, discipline, startNumber) {
  const sn = String(startNumber);
  const notes = { offline: false };
  const equipage = dataOf(await readDocFresh(getCompDocRef(competitionId, 'equipages', sn), notes)) || { startNumber: sn };
  let gaps = [];
  if (discipline === 'marathon') {
    const base = `artifacts/${appId}/public/data/competitions/${competitionId}`;
    const [summarySnap, timingSnap, obstaclesSnap, configSnap] = await Promise.all([
      readDocFresh(getCompDocRef(competitionId, 'maraton', sn), notes),
      readDocFresh(getCompDocRef(competitionId, 'maraton-timing', sn), notes),
      readDocsFresh(collection(db, `${base}/maratonResults/${sn}/obstacles`), notes),
      readDocFresh(getCompDocRef(competitionId, 'config', 'maratonConfig'), notes),
    ]);
    gaps = findMarathonGaps({
      equipage,
      summary: dataOf(summarySnap),
      timing: dataOf(timingSnap),
      savedObstacles: obstaclesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      marathonConfig: dataOf(configSnap) || {},
    });
  } else if (discipline === 'precision') {
    gaps = findPrecisionGaps({ equipage, result: dataOf(await readDocFresh(getCompDocRef(competitionId, 'precision', sn), notes)) });
  } else if (discipline === 'dressage') {
    const [protocolsSnap, mappingSnap] = await Promise.all([
      readDocsFresh(getCompCollectionRef(competitionId, `dressage/${sn}/protocols`), notes),
      readDocFresh(getCompDocRef(competitionId, 'config', 'dressageJudgeMapping'), notes),
    ]);
    gaps = findDressageGaps({
      equipage,
      protocols: protocolsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      judgeMapping: dataOf(mappingSnap) || {},
    });
  }
  if (notes.offline) gaps.push('Ingen kontakt med servern: kontrollen bygger på data som finns på enheten.');
  return gaps;
}

/**
 * Asks before finalizing, listing what is missing (finalizing locks the
 * result: later writes from the field are refused). Resolves true to go on.
 * A failed check is shown too, it does not stop the finalizing on its own.
 */
export async function confirmFinalizeWithGaps(competitionId, discipline, startNumber) {
  let gaps;
  try {
    gaps = await findFinalizeGaps(competitionId, discipline, startNumber);
  } catch (error) {
    console.warn('Kontrollen före finalisering misslyckades:', error);
    gaps = ['Kontrollen av inkomna data kunde inte göras.'];
  }
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
  return window.confirm(finalizeConfirmMessage(discipline, startNumber, gaps));
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
  // Marathon: the obstacle clocks are per obstacle (obstacleLive.{n}); the
  // normalized document shows the one running or with unsaved work
  const raw = snap.exists() ? snap.data() : {};
  const data = obstacleWork ? normalizeMarathonDoc(raw) : raw;
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
