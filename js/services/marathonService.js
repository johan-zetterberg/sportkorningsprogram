import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDoc, getDocs, setDoc, onSnapshot, query, serverTimestamp, runTransaction, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { getConfig, listenForConfig, saveConfig } from './competitionService.js';
import { auth } from '../config/firebase-config.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';
import { setPauseWindows } from '../utils/marathonUtils.js';
import { awaitWriteOrQueue } from '../utils/offlineWrite.js';

/**
 * Loads the competition's global pause log (config/globalStatus) into the
 * marathon result engine, so stage times have the pauses subtracted as on the
 * server. Pages that calculate marathon results call it once on load; pages
 * that follow the pause live listen to globalStatus instead. Read directly, not
 * through the cached getConfig, since pauses change during the competition.
 */
export async function loadPauseWindows(competitionId) {
  if (!competitionId) return [];
  try {
    const snap = await getDoc(getCompDocRef(competitionId, 'config', 'globalStatus'));
    const pauseLog = snap.exists() && Array.isArray(snap.data()?.pauseLog) ? snap.data().pauseLog : [];
    setPauseWindows(pauseLog);
    return pauseLog;
  } catch (error) {
    console.warn('Kunde inte läsa pausloggen:', error);
    setPauseWindows([]);
    return [];
  }
}

// With { withSource: true } the callback also gets where the list comes from:
// only a list confirmed by the server ({ fromCache: false, hasPendingWrites:
// false }) is the real obstacle list; on a listener error the list is empty and
// `error` is set. Without it the callback gets the list only, as before.
export function listenForMarathonObstacles(competitionId, callback, { withSource = false } = {}) {
  const obstaclesRef = getCompCollectionRef(competitionId, 'maratonObstacles');
  const toList = (snapshot) => snapshot.docs.map(d => d.data()).sort((a, b) => a.number - b.number);
  if (!withSource) {
    return onSnapshot(query(obstaclesRef), (snapshot) => {
      callback(toList(snapshot));
    }, buildSnapshotErrorHandler('listenForMarathonObstacles', callback, []));
  }
  const onError = buildSnapshotErrorHandler('listenForMarathonObstacles', (list) => callback(list, { error: true }), []);
  return onSnapshot(query(obstaclesRef), { includeMetadataChanges: true }, (snapshot) => {
    callback(toList(snapshot), { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites });
  }, onError);
}

/**
 * Keeps maratonConfig.obstacleNumbers equal to the competition's obstacles.
 * The result engine reads the course from it (a class without "körda hinder"
 * drives all of them), and maratonConfig is what every result page and the
 * Cloud Function already load. Writes only when the list differs.
 */
export async function syncMarathonObstacleNumbers(competitionId, obstacles = null) {
  if (!competitionId) return;
  const list = Array.isArray(obstacles)
    ? obstacles
    : (await getDocs(getCompCollectionRef(competitionId, 'maratonObstacles'))).docs.map(d => d.data());
  const numbers = [...new Set(list.map(o => Number(o?.number ?? o?.obstacleNumber))
    .filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const cfg = await getConfig(competitionId, 'maratonConfig', true) || {};
  const current = Array.isArray(cfg.obstacleNumbers) ? cfg.obstacleNumbers.map(Number) : null;
  if (current && current.length === numbers.length && current.every((n, i) => n === numbers[i])) return;
  await saveConfig(competitionId, 'maratonConfig', { obstacleNumbers: numbers });
}

export async function saveMarathonObstacle(competitionId, number, data) {
  return trackWrite(`Sparar maratonhinder ${number}`, (async () => {
    const obstacleRef = getCompDocRef(competitionId, 'maratonObstacles', number.toString());
    await setDoc(obstacleRef, data);
    await syncMarathonObstacleNumbers(competitionId);
  })());
}

export async function deleteMarathonObstacle(competitionId, obstacleNumber) {
  if (!competitionId || obstacleNumber == null) {
    throw new Error("Competition ID och hindernummer krävs för att kunna radera.");
  }
  return trackWrite(`Tar bort maratonhinder ${obstacleNumber}`, (async () => {
    const obstacleRef = getCompDocRef(competitionId, 'maratonObstacles', String(obstacleNumber));
    await deleteDoc(obstacleRef);
    await syncMarathonObstacleNumbers(competitionId);
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

function normalizeObstacleResultRow(equipageId, data = {}, fallbackId = '') {
  const obstacleNumber = Number(data.obstacleNumber ?? data.number ?? fallbackId);
  const timeRaw = data.timeSec ?? data.timeInSeconds ?? data.timeSeconds ?? data.seconds ?? (Number.isFinite(data.timeMs) ? data.timeMs / 1000 : null);
  const timeSec = timeRaw != null && Number.isFinite(Number(timeRaw)) ? Number(timeRaw) : 0;
  const num = Number.isFinite(obstacleNumber) ? obstacleNumber : 0;
  return {
    equipageId: String(equipageId),
    obstacleNumber: num,
    number: num,
    timeSec,
    timeInSeconds: timeSec,
    timeSeconds: timeSec,
    penalty: Number(data.penalty || 0),
    holdTimeSec: Number(data.holdTimeSec ?? data.holdTimeSeconds ?? 0),
    knockdownPenalty: Number(data.knockdownPenalty || data.knockDownPenalty || 0),
    otherPenalty: Number(data.otherPenalty || 0),
    ballsDown: Number(data.ballsDown || 0),
    eliminated: !!data.eliminated,
    comment: data.comment || '',
    routeString: data.routeString || '',
    updatedAt: data.updatedAt || null
  };
}

export async function getMarathonResults(competitionId) {
  if (!competitionId) throw new Error("getMarathonResults: competitionId saknas");
  const baseCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maratonResults`);
  const equipageDocs = await getDocs(baseCol);
  const byObstacleKey = new Map();

  for (const d of equipageDocs.docs) {
    const equipageId = d.id; 
    const obstaclesCol = collection(db, `${baseCol.path}/${equipageId}/obstacles`);
    const obsSnap = await getDocs(obstaclesCol);
    obsSnap.forEach(o => {
      const row = normalizeObstacleResultRow(equipageId, o.data() || {}, o.id);
      byObstacleKey.set(`${row.equipageId}:${row.obstacleNumber}`, row);
    });
  }

  // Fallback: summary docs in `maraton/{startnr}` also contain the current obstacle array.
  const stateCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
  const stateSnap = await getDocs(stateCol);
  stateSnap.forEach(docSnap => {
    const equipageId = String(docSnap.id);
    const obstacles = Array.isArray(docSnap.data()?.obstacles) ? docSnap.data().obstacles : [];
    obstacles.forEach((obstacle, index) => {
      const row = normalizeObstacleResultRow(equipageId, obstacle, obstacle?.number ?? index + 1);
      const key = `${row.equipageId}:${row.obstacleNumber}`;
      if (!byObstacleKey.has(key)) byObstacleKey.set(key, row);
    });
  });

  const out = Array.from(byObstacleKey.values());

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
    // A save without them (the secretariat's correction) keeps the judge's
    gateSplits: Array.isArray(data?.gateSplits) ? data.gateSplits : null,
    enteredAt: data?.enteredAt || null
  };

  const summaryDocRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`, eid);

  // Only the fields this save owns: the obstacle list and, when they belong to
  // this obstacle, the shared live fields. Never the whole document back (a
  // stale copy would overwrite e.g. stage times saved meanwhile)
  const buildSummaryUpdate = (existingData = {}) => {
    const previous = (existingData.obstacles || []).find(o => Number(o.number) === on) || {};
    const entry = {
      ...resultData,
      gateSplits: resultData.gateSplits ?? previous.gateSplits ?? [],
      enteredAt: resultData.enteredAt ?? previous.enteredAt ?? new Date().toISOString()
    };
    const obstacles = (existingData.obstacles || []).filter(o => Number(o.number) !== on);
    obstacles.push(entry);
    obstacles.sort((a, b) => a.number - b.number);

    // The live fields are shared by all obstacles: clear them only when they
    // belong to this obstacle, not while the equipage is timed at another one
    const liveBelongsHere = existingData.running !== true
      || existingData.currentObstacle == null
      || Number(existingData.currentObstacle) === on;
    return {
      entry,
      update: {
        obstacles,
        updatedAt: serverTimestamp(),
        ...(liveBelongsHere ? {
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
        } : {})
      }
    };
  };

  return trackWrite(`Sparar hinderresultat #${eid} Hinder ${on}`, (async () => {
    let entry = null;
    let summaryWrite = null;
    // With signal: a transaction, so two obstacles saving the same equipage at
    // once can't drop each other's entry. Without signal Firestore can't run
    // one, so the list is built from the copy on the device (the input page
    // listens to this document) and a plain write is queued
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        await withTimeout(runTransaction(db, async (transaction) => {
          const snap = await transaction.get(summaryDocRef);
          const built = buildSummaryUpdate(snap.exists() ? snap.data() : {});
          entry = built.entry;
          transaction.set(summaryDocRef, built.update, { merge: true });
        }), OBSTACLE_TRANSACTION_TIMEOUT_MS);
        summaryWrite = Promise.resolve();
      } catch (error) {
        if (!isConnectionError(error)) throw error;
      }
    }
    if (!summaryWrite) {
      let cached;
      try {
        const snap = await getDoc(summaryDocRef);
        cached = snap.exists() ? snap.data() : {};
      } catch (error) {
        // Not on the device either: a write from an empty list would erase
        // the other obstacles' results when it reaches the server
        throw new Error(`Ekipage #${eid} finns inte sparat på enheten och nätet saknas. Försök igen när det finns täckning.`);
      }
      const built = buildSummaryUpdate(cached);
      entry = built.entry;
      summaryWrite = setDoc(summaryDocRef, built.update, { merge: true });
    }

    const obstacleDocRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maratonResults/${eid}/obstacles/${on}`);
    const obstacleWrite = setDoc(obstacleDocRef, {
      ...entry,
      obstacleNumber: on,
      updatedAt: serverTimestamp()
    }, { merge: true });

    const status = await awaitWriteOrQueue(Promise.all([summaryWrite, obstacleWrite]));
    return { ok: true, path: summaryDocRef.path, status };
  })());
}

const OBSTACLE_TRANSACTION_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms);
    })
  ]);
}

// No (usable) connection, as opposed to a refusal such as permission-denied
function isConnectionError(error) {
  return ['unavailable', 'deadline-exceeded', 'failed-precondition'].includes(error?.code)
    || /offline|network/i.test(String(error?.message || ''));
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
