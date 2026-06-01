import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDoc, getDocs, setDoc, onSnapshot, query, serverTimestamp, runTransaction, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { getConfig, listenForConfig } from './competitionService.js';
import { auth } from '../config/firebase-config.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

export function listenForMarathonObstacles(competitionId, callback) {
  const obstaclesRef = getCompCollectionRef(competitionId, 'maratonObstacles');
  return onSnapshot(query(obstaclesRef), (snapshot) => {
    callback(snapshot.docs.map(d => d.data()).sort((a, b) => a.number - b.number));
  }, buildSnapshotErrorHandler('listenForMarathonObstacles', callback, []));
}

export async function saveMarathonObstacle(competitionId, number, data) {
  return trackWrite(`Sparar maratonhinder ${number}`, (async () => {
    const obstacleRef = getCompDocRef(competitionId, 'maratonObstacles', number.toString());
    await setDoc(obstacleRef, data);
  })());
}

export async function deleteMarathonObstacle(competitionId, obstacleNumber) {
  if (!competitionId || obstacleNumber == null) {
    throw new Error("Competition ID och hindernummer krävs för att kunna radera.");
  }
  return trackWrite(`Tar bort maratonhinder ${obstacleNumber}`, (async () => {
    const obstacleRef = getCompDocRef(competitionId, 'maratonObstacles', String(obstacleNumber));
    await deleteDoc(obstacleRef);
  })());
}

export async function getMarathonObstacleResults(competitionId, equipageId) {
  if (!competitionId || equipageId == null) return [];
  const eid = String(equipageId).trim();
  const colRef = collection(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/maratonResults/${eid}/obstacles`
  );
  const snap = await getDocs(colRef);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.obstacleNumber || 0) - (b.obstacleNumber || 0));
}

export async function getMarathonLiveDocument(competitionId, equipageId) {
  if (!competitionId || !equipageId) return null;
  const sn = String(equipageId).trim();
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`, sn);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export function listenForMarathonObstacleResults(competitionId, equipageId, callback) {
  if (!competitionId || !equipageId) return () => { };
  const eid = String(equipageId).trim();
  const colRef = collection(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/maratonResults/${eid}/obstacles`
  );
  return onSnapshot(query(colRef), (snapshot) => {
    callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  }, buildSnapshotErrorHandler(`listenForMarathonObstacleResults:${eid}`, callback, []));
}

export async function getMarathonResults(competitionId) {
  if (!competitionId) throw new Error("getMarathonResults: competitionId saknas");
  const baseCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maratonResults`);
  const equipageDocs = await getDocs(baseCol);
  const out = [];

  for (const d of equipageDocs.docs) {
    const equipageId = d.id; 
    const obstaclesCol = collection(db, `${baseCol.path}/${equipageId}/obstacles`);
    const obsSnap = await getDocs(obstaclesCol);
    obsSnap.forEach(o => {
      const data = o.data() || {};
      out.push({
        equipageId,
        obstacleNumber: Number(data.obstacleNumber ?? o.id),
        timeInSeconds: Number(data.timeInSeconds || 0),
        penalty: Number(data.penalty || 0),
        eliminated: !!data.eliminated,
        comment: data.comment || '',
        routeString: data.routeString || '',
        updatedAt: data.updatedAt || null,
      });
    });
  }

  out.sort((a, b) => {
    const ea = String(a.equipageId).localeCompare(String(b.equipageId));
    if (ea !== 0) return ea;
    return (a.obstacleNumber || 0) - (b.obstacleNumber || 0);
  });

  return out;
}

export async function saveMarathonObstacleResult(competitionId, equipageId, obstacleNumber, data) {
  if (!competitionId) throw new Error("saveMarathonObstacleResult: competitionId saknas");
  if (equipageId == null) throw new Error("saveMarathonObstacleResult: equipageId saknas");
  if (obstacleNumber == null) throw new Error("saveMarathonObstacleResult: obstacleNumber saknas");

  const eid = String(equipageId).trim();
  const on = Number(obstacleNumber);
  if (!Number.isFinite(on)) throw new Error("saveMarathonObstacleResult: ogiltigt hindernummer");
  const timeInSec = Number(data?.timeInSeconds || data?.timeSeconds || 0);
  const timeMs = Number.isFinite(Number(data?.timeMs)) ? Number(data.timeMs) : timeInSec * 1000;
  
  const resultData = {
    number: on,
    timeInSeconds: timeInSec,
    timeSeconds: timeInSec,
    timeMs,
    timePenalty: Number(data?.timePenalty || 0),
    knockdowns: Number(data?.knockdowns || 0),
    knockdownPenalty: Number(data?.knockdownPenalty || data?.knockDownPenalty || 0),
    otherPenalty: Number(data?.otherPenalty || 0),
    penalty: Number(data?.penalty || 0),
    comment: data?.comment || '', 
    eliminated: !!data?.eliminated,
    holdTimeSec: Number(data?.holdTimeSec || 0),
    routeString: data?.routeString || '',
    gateSplits: data?.gateSplits || [],
    enteredAt: data?.enteredAt || new Date().toISOString()
  };

  const summaryDocRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`, eid);

  return trackWrite(`Sparar hinderresultat #${eid} Hinder ${on}`, (async () => {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(summaryDocRef);
      const existingData = snap.exists() ? snap.data() : {};
      const obstacles = (existingData.obstacles || []).filter(o => Number(o.number) !== on);
      obstacles.push(resultData);
      obstacles.sort((a, b) => a.number - b.number);

      transaction.set(summaryDocRef, {
        ...existingData,
        obstacles,
        updatedAt: serverTimestamp(),
        currentObstacle: null,
        running: false,
        inProgress: false,
        liveObstacleTimeMs: 0,
        liveObstacleStartAt: null,
        live_staticStartAt: null,
        live_routeString: '',
        live_knockdowns: '0',
        live_otherPenalty: '0',
        live_holdTimeSec: '',
        live_gateSplits: []
      }, { merge: true });
    });
    return { ok: true, path: summaryDocRef.path };
  })());
}

export async function getMarathonTimingForEquipage(competitionId, startNumber) {
  if (!competitionId || !startNumber) return null;
  const sn = String(startNumber).trim();
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton-timing`, sn);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function getStartTimes(competitionId) {
  const doc = await getConfig(competitionId, 'startTimes');
  return doc?.times || {};
}

export function listenForMarathonConfig(competitionId, callback) {
  if (!competitionId) return () => {};
  return listenForConfig(competitionId, 'maratonConfig', callback);
}

export async function saveMarathonTimingData(competitionId, equipageId, data) {
  if (!competitionId) throw new Error("saveMarathonTimingData: competitionId saknas");
  if (equipageId == null) throw new Error("saveMarathonTimingData: equipageId saknas");

  const id = String(equipageId).trim();

  const clean = (obj) => {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v === undefined) return;
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      out[k] = v;
    });
    return out;
  };

  const payload = clean({
    startNumber: Number(id) || null,
    className: data?.className ?? data?.klass ?? null,
    start_A: data?.start_A ?? data?.startA ?? null,
    finish_A: data?.finish_A ?? data?.finishA ?? null,
    start_B: data?.start_B ?? data?.startB ?? null,
    finish_B: data?.finish_B ?? data?.finishB ?? null,
    duration_A: Number.isFinite(data?.duration_A) ? Number(data.duration_A) : undefined,
    duration_B: Number.isFinite(data?.duration_B) ? Number(data.duration_B) : undefined,
    updatedBy: (auth?.currentUser?.uid ?? null),
    updatedAt: serverTimestamp()
  });

  return trackWrite(`Sparar maratontid #${id}`, (async () => {
    const ref = getCompDocRef(competitionId, 'maraton-timing', id);
    await setDoc(ref, payload, { merge: true });
    return { ok: true, path: ref.path, id };
  })());
}

export async function getMarathonTimingData(competitionId) {
  if (!competitionId) return new Map();
  try {
    const timingRef = getCompCollectionRef(competitionId, 'maraton-timing');
    const snapshot = await getDocs(query(timingRef));
    const map = new Map();
    snapshot.forEach(d => map.set(String(d.id), d.data() || {}));
    return map;
  } catch (e) {
    console.warn('Error fetching marathon timing:', e);
    return new Map();
  }
}

export async function getMarathonStateDocuments(competitionId) {
  if (!competitionId) return new Map();
  try {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
    const snap = await getDocs(colRef);
    const map = new Map();
    snap.forEach(d => map.set(String(d.id), d.data() || {}));
    return map;
  } catch (e) {
    console.warn('Error fetching marathon state docs:', e);
    return new Map();
  }
}

export function listenForMarathonStateCollectionGroup(competitionId, equipagesOrStartNumbers, callback) {
  if (!competitionId) throw new Error("listenForMarathonStateCollectionGroup: competitionId saknas");
  const sns = equipagesOrStartNumbers.map(e => String(e.startNumber ?? e.id ?? e).trim());
  if (sns.length === 0) {
    callback([]);
    return () => {};
  }
  
  const map = new Map();
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
  
  return onSnapshot(colRef, (snap) => {
    snap.docChanges().forEach(change => {
      const sn = change.doc.id;
      if (!sns.includes(sn)) return; 
      
      if (change.type === 'removed') {
        map.delete(sn);
      } else {
        map.set(sn, { id: sn, ...change.doc.data() });
      }
    });
    callback(Array.from(map.values()));
  }, buildSnapshotErrorHandler('listenForMarathonStateCollectionGroup', callback, []));
}

export function listenForMarathonTimingUpdates(competitionId, callback) {
  if (!competitionId) throw new Error("listenForMarathonTimingUpdates: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton-timing`);
  const qRef = query(colRef);
  return onSnapshot(
    qRef,
    (snap) => {
      try { callback(snap.docs); } catch (e) { console.error("listenForMarathonTimingUpdates callback error:", e); }
    },
    buildSnapshotErrorHandler('listenForMarathonTimingUpdates', callback, [])
  );
}

export function listenForMaratonCollection(competitionId, callback) {
  if (!competitionId) throw new Error("listenForMaratonCollection: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
  return onSnapshot(query(colRef), (snapshot) => {
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(docs);
  }, buildSnapshotErrorHandler('listenForMaratonCollection', callback, []));
}
