import { db, appId } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, setDoc, onSnapshot, query, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef } from './firestoreService.js';;

export function listenForPrecisionResults(competitionId, callback) {
  if (!competitionId) throw new Error("listenForPrecisionResults: competitionId saknas");
  const colRef = getCompCollectionRef(competitionId, 'precision');
  const qRef = query(colRef);

  return onSnapshot(qRef, (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })); 
    try { callback(rows); } catch (e) { console.error("listenForPrecisionResults callback error:", e); }
  });
}

export async function getPrecisionResults(competitionId) {
  if (!competitionId) return [];
  const colRef = getCompCollectionRef(competitionId, 'precision');
  const snap = await getDocs(colRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function savePrecisionResult(competitionId, equipageId, data) {
  if (!competitionId) throw new Error('savePrecisionResult: competitionId saknas');
  if (equipageId == null) throw new Error('savePrecisionResult: equipageId saknas');

  const sn = String(equipageId).trim();
  const ref = doc(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/precision/${sn}`
  );

  const payload = {
    startNumber: Number(equipageId),
    className: data?.className ?? data?.klass ?? null,
    driverName: data?.driverName ?? data?.driver ?? data?.kusk ?? null,
    trackWidthCm: Number.isFinite(data?.trackWidthCm)
      ? data.trackWidthCm
      : (Number(data?.trackWidth) || null),
    knocks: Number(data?.knocks ?? data?.cones ?? 0),
    timeMs: Number(data?.timeMs ?? data?.ms ?? 0),
    overLimitPenalty: Number(data?.overLimitPenalty ?? data?.timePenalty ?? 0),
    penaltyOther: Number(data?.penaltyOther ?? data?.extraPenalty ?? 0),
    eliminated: !!data?.eliminated,
    disqualified: !!data?.disqualified,
    running: !!data?.running,
    finalized: !!data?.finalized,
    comment: data?.comment ?? '',
    updatedAt: serverTimestamp(),
  };

  return trackWrite(`Sparar precisionsresultat #${equipageId}`, (async () => {
    await runTransaction(db, async (transaction) => {
      const _ignored = await transaction.get(ref);
      transaction.set(ref, payload, { merge: true });
    });
    return { ok: true, path: ref.path };
  })());
}

export async function getPrecisionResultForEquipage(competitionId, equipageId) {
  if (!competitionId || !equipageId) return null;
  const sn = String(equipageId).trim();
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision/${sn}`);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}
