import { db, appId } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, setDoc, onSnapshot, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

export function listenForPrecisionResults(competitionId, callback) {
  if (!competitionId) throw new Error("listenForPrecisionResults: competitionId saknas");
  const colRef = getCompCollectionRef(competitionId, 'precision');
  const qRef = query(colRef);

  return onSnapshot(qRef, (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })); 
    try { callback(rows); } catch (e) { console.error("listenForPrecisionResults callback error:", e); }
  }, buildSnapshotErrorHandler('listenForPrecisionResults', callback, []));
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

  const knocks = Array.isArray(data?.knocks)
    ? data.knocks.map((knock) => String(knock))
    : [];
  const toNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };
  const knockdownPenalty = toNumber(data?.knockdownPenalty, 3);
  const legacyKnockCount = toNumber(data?.knocks ?? data?.cones, 0);
  const inferredObstaclePenalty = knocks.length > 0
    ? knocks.length * knockdownPenalty
    : (legacyKnockCount > 0 ? legacyKnockCount * knockdownPenalty : 0);
  const timePenalty = toNumber(data?.timePenalty ?? data?.overLimitPenalty ?? data?.liveTimePenalty, 0);
  const extraPenalty = toNumber(data?.extraPenalty ?? data?.penaltyOther, 0);
  const obstaclePenalty = toNumber(data?.obstaclePenalty ?? data?.liveObstaclePenalty, inferredObstaclePenalty);
  const running = !!data?.running;
  const finalized = !!data?.finalized;
  const hasPerformance = running
    || finalized
    || !!data?.eliminated
    || toNumber(data?.timeMs ?? data?.ms ?? data?.liveTimeMs, 0) > 0
    || obstaclePenalty > 0
    || timePenalty > 0
    || extraPenalty !== 0;
  const calculatedTotalPenalty = obstaclePenalty + timePenalty + extraPenalty;
  const totalPenalty = hasPerformance
    ? toNumber(data?.totalPenalty ?? data?.liveTotalPenalty, calculatedTotalPenalty)
    : null;

  const payload = {
    startNumber: Number(equipageId),
    className: data?.className ?? data?.klass ?? null,
    driverName: data?.driverName ?? data?.driver ?? data?.kusk ?? null,
    trackWidthCm: Number.isFinite(Number(data?.trackWidthCm))
      ? data.trackWidthCm
      : (toNumber(data?.trackWidth, 0) || null),
    knocks,
    knockDownTimes: data?.knockDownTimes && typeof data.knockDownTimes === 'object'
      ? data.knockDownTimes
      : {},
    timeMs: toNumber(data?.timeMs ?? data?.ms, 0),
    liveTimeMs: toNumber(data?.liveTimeMs ?? data?.timeMs ?? data?.ms, 0),
    liveStartEpoch: data?.liveStartEpoch ?? null,
    livePausedMs: toNumber(data?.livePausedMs, 0),
    obstaclePenalty,
    timePenalty,
    extraPenalty,
    totalPenalty,
    liveObstaclePenalty: hasPerformance ? toNumber(data?.liveObstaclePenalty, obstaclePenalty) : null,
    liveTimePenalty: hasPerformance ? toNumber(data?.liveTimePenalty, timePenalty) : null,
    liveTotalPenalty: hasPerformance ? toNumber(data?.liveTotalPenalty, totalPenalty) : null,
    eliminated: !!data?.eliminated,
    disqualified: !!data?.disqualified,
    running,
    inProgress: !!data?.inProgress || running,
    finalized,
    status: data?.status ?? (finalized ? 'Klar' : (running ? 'Pågår' : 'Ej startat')),
    comment: data?.comment ?? '',
    updatedAt: Date.now(),
  };

  return trackWrite(`Sparar precisionsresultat #${equipageId}`, (async () => {
    await setDoc(ref, payload, { merge: true });
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
