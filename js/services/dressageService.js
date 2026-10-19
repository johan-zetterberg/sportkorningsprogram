import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDoc, getDocs, setDoc, onSnapshot, serverTimestamp, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';
import { deriveDressageStatusState, judgeStatusKey, liveDocIdFor } from './dressageStatusUtils.js';
import { asPlainDressageProtocol, plainDressageProtocolsFromDocs, normalizeSavedScore } from './dressageProtocolDocs.js';

export async function setDressageStatus(competitionId, startNumber, {
  state,
  judgeId,
  judgeName,
  judgePosition,
  protocol,
  lastUpdate,
  finalJudgeScore,
  finalPercent,
  finalPoints,
  finalPenalty,
  errorPoints,
  errorPenalty,
  judgeDone,
  expectedPositions
}) {
  const ref = doc(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${String(startNumber)}`
  );

  const payload = {
    state,
    judgeId: judgeId || finalJudgeScore?.judgeId || null,
    judgeName: judgeName || null,
    judgePosition: judgePosition || finalJudgeScore?.judgePosition || null,
    updatedAt: serverTimestamp(),
  };
  if (state === 'ongoing') payload.startedAt = serverTimestamp();
  if (state === 'finished') payload.finishedAt = serverTimestamp();
  if (protocol !== undefined) payload.protocol = protocol;
  if (lastUpdate !== undefined) payload.lastUpdate = lastUpdate;
  if (finalJudgeScore !== undefined) payload.finalJudgeScore = finalJudgeScore;
  if (finalPercent !== undefined) payload.finalPercent = finalPercent;
  if (finalPoints !== undefined) payload.finalPoints = finalPoints;
  if (finalPenalty !== undefined) payload.finalPenalty = finalPenalty;
  if (errorPoints !== undefined) payload.errorPoints = errorPoints;
  if (errorPenalty !== undefined) payload.errorPenalty = errorPenalty;
  // Each judge marks only its own position (a merged map field): readers
  // derive "finished" from all positions, not from whoever saved last
  const key = judgeStatusKey(payload.judgePosition, payload.judgeId);
  if (judgeDone !== undefined && key) {
    payload.judgesDone = { [key]: !!judgeDone };
    if (finalJudgeScore !== undefined) payload.judgeScores = { [key]: finalJudgeScore };
  }
  if (Array.isArray(expectedPositions) && expectedPositions.length) {
    payload.expectedPositions = expectedPositions.map(p => String(p).toUpperCase());
  }

  // A plain merge write, not a transaction: a transaction needs the server, so
  // a judge without signal could not save (and it never used what it read)
  return trackWrite(`Ändrar dressyrstatus #${startNumber}`, setDoc(ref, payload, { merge: true }));
}

/**
 * A judge's live protocol, in its own document per position (judges no
 * longer overwrite each other), stamped with the server's time.
 */
export function writeDressageLive(competitionId, startNumber, judge, { protocol, lastUpdate }) {
  const id = liveDocIdFor(judge?.position || judge?._pos, judge?.id);
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${String(startNumber)}/live/${id}`);
  return setDoc(ref, {
    state: 'ongoing',
    protocol,
    lastUpdate,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function listenForDressageStatus(competitionId, startNumber, callback) {
  const ref = doc(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${String(startNumber)}`
  );

  return onSnapshot(ref, (docSnap) => {
    if (docSnap.exists()) {
      callback(deriveDressageStatusState(docSnap.data()));
    } else {
      callback(null);
    }
  }, buildSnapshotErrorHandler(`listenForDressageStatus:${startNumber}`, callback, null));
}

export async function getDressageResultsForEquipage(competitionId, startNumber) {
  if (!competitionId) throw new Error("getDressageResultsForEquipage: competitionId saknas");
  if (startNumber == null) throw new Error("getDressageResultsForEquipage: startNumber saknas");

  const sn = String(startNumber).trim();

  const primaryCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`);
  const legacyCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageResults/${sn}/protocols`);

  async function readCol(colRef) {
    const out = [];
    const snap = await getDocs(colRef);
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    try {
      const g = await getDoc(doc(colRef, "general"));
      if (g.exists() && !out.some(x => x.id === "general")) {
        out.push({ id: "general", ...g.data() });
      }
    } catch (_) { }
    return out;
  }
  let results = await readCol(primaryCol);
  if (!results || results.length === 0) {
    try { results = await readCol(legacyCol); } catch (_) { }
  }
  return Array.isArray(results) ? results : [];
}

export async function saveDressageJudgeProtocol(competitionId, startNumber, judgeId, data) {
  if (!competitionId) throw new Error("saveDressageJudgeProtocol: competitionId saknas");
  if (startNumber == null) throw new Error("saveDressageJudgeProtocol: startNumber saknas");
  if (judgeId == null) throw new Error("saveDressageJudgeProtocol: judgeId saknas");

  const sn = String(startNumber).trim();
  const jid = String(judgeId).trim();
  const docId = `judge_${jid}`;
  const judgePosition = String(data?.judgePosition || data?.position || '').trim().toUpperCase();
  const testKey = data?.testKey || data?.programKey || data?.testId || "";

  const safePayload = {
    startNumber: sn,
    judgeId: jid,
    judgeName: data?.judgeName || "",
    judgePosition,
    position: judgePosition,
    testKey,
    programKey: testKey,
    eliminated: !!data?.eliminated,
    movements: Array.isArray(data?.movements)
      ? data.movements.map((m, idx) => ({
        momentNo: m?.momentNo ?? m?.movementNo ?? (idx + 1),
        // An empty movement stays null (not scored), never 0
        score: normalizeSavedScore(m?.score),
        comment: m?.comment || ""
      }))
      : [],
    updatedAt: serverTimestamp()
  };

  return trackWrite(`Sparar dressyrprotokoll #${startNumber} (${judgeId})`, (async () => {
    const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`, docId);
    await setDoc(ref, safePayload, { merge: true });
    return { ok: true, path: ref.path };
  })());
}

export async function saveDressageGeneralData(competitionId, startNumber, data) {
  if (!competitionId) throw new Error("saveDressageGeneralData: competitionId saknas");
  if (startNumber == null) throw new Error("saveDressageGeneralData: startNumber saknas");

  const sn = String(startNumber).trim();
  const safePayload = {
    errorPoints: typeof data?.errorPoints === "number" ? data.errorPoints : Number(data?.errorPoints || 0),
    errorComment: data?.errorComment || "",
    updatedAt: serverTimestamp()
  };

  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`, "general");
  await setDoc(ref, safePayload, { merge: true });
  return { ok: true, path: ref.path };
}

export { asPlainDressageProtocol, plainDressageProtocolsFromDocs, normalizeSavedScore };

function createCoalescedMapEmitter(map, callback) {
  let timerId = null;

  function flush() {
    timerId = null;
    callback(Array.from(map.values()));
  }

  return {
    emit() {
      if (timerId !== null) return;
      timerId = setTimeout(flush, 0);
    },
    cancel() {
      if (timerId === null) return;
      clearTimeout(timerId);
      timerId = null;
    }
  };
}

function normalizeStartNumbers(equipagesOrStartNumbers) {
  if (!Array.isArray(equipagesOrStartNumbers)) return [];
  const seen = new Set();
  const startNumbers = [];

  equipagesOrStartNumbers.forEach(item => {
    const sn = String(item?.startNumber ?? item?.id ?? item ?? '').trim();
    if (!sn || seen.has(sn)) return;
    seen.add(sn);
    startNumbers.push(sn);
  });

  return startNumbers;
}

export function listenForDressageProtocols(competitionId, startNumber, callback) {
  if (!competitionId) throw new Error("listenForDressageProtocols: competitionId saknas");
  if (startNumber == null) throw new Error("listenForDressageProtocols: startNumber saknas");

  const sn = String(startNumber).trim();
  const colRef = collection(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`
  );

  // 'general' (error points from C) is kept: the result engine needs it
  return onSnapshot(colRef, (snapshot) => {
    callback(plainDressageProtocolsFromDocs(snapshot.docs.map(d => ({ id: d.id, data: d.data() })), startNumber));
  }, buildSnapshotErrorHandler(`listenForDressageProtocols:${sn}`, callback, []));
}

export function listenForDressageStatusCollection(competitionId, callback) {
  if (!competitionId) throw new Error("listenForDressageStatusCollection: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`);
  return onSnapshot(colRef, (snap) => {
    callback(snap.docs.map(d => deriveDressageStatusState({ id: d.id, ...d.data() })));
  }, buildSnapshotErrorHandler('listenForDressageStatusCollection', callback, []));
}

export async function getDressageStatusCollection(competitionId) {
  if (!competitionId) throw new Error("getDressageStatusCollection: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`);
  const snap = await getDocs(colRef);
  return snap.docs.map(d => deriveDressageStatusState({ id: d.id, ...d.data() }));
}

/**
 * One listener per start number on a sub-collection, emitted as one list.
 * The returned unsubscribe function has setStartNumbers(list): listeners are
 * added for new start numbers (an equipage added later) and removed for
 * dropped ones (e.g. a finished equipage's live data).
 */
function listenPerStartNumber(label, pathFor, equipagesOrStartNumbers, callback) {
  const map = new Map();
  const unsubs = new Map();
  const emitter = createCoalescedMapEmitter(map, callback);

  const listenTo = (sn) => {
    try {
      const unsub = onSnapshot(collection(db, pathFor(sn)), (snap) => {
        snap.docChanges().forEach(change => {
          const docId = change.doc.id;
          const fullId = `${sn}_${docId}`;
          if (change.type === 'removed') {
            map.delete(fullId);
          } else {
            // Pending server timestamps get the local estimate, not null
            const plain = asPlainDressageProtocol(change.doc.data({ serverTimestamps: 'estimate' }), docId, sn);
            if (plain) map.set(fullId, plain);
          }
        });
        emitter.emit();
      }, buildSnapshotErrorHandler(`${label}:${sn}`, callback, []));
      unsubs.set(sn, unsub);
    } catch (e) {
      console.warn(`${label} setup err`, sn, e);
    }
  };

  const setStartNumbers = (list) => {
    const wanted = new Set(normalizeStartNumbers(list));
    let removed = false;
    unsubs.forEach((unsub, sn) => {
      if (wanted.has(sn)) return;
      try { unsub(); } catch (_) { }
      unsubs.delete(sn);
      for (const key of map.keys()) {
        if (key.startsWith(`${sn}_`)) { map.delete(key); removed = true; }
      }
    });
    wanted.forEach(sn => { if (!unsubs.has(sn)) listenTo(sn); });
    if (removed) emitter.emit();
  };

  setStartNumbers(equipagesOrStartNumbers);
  if (unsubs.size === 0) callback([]);

  const unsubscribe = () => {
    emitter.cancel();
    unsubs.forEach(u => { try { u(); } catch (_) { } });
    unsubs.clear();
  };
  unsubscribe.setStartNumbers = setStartNumbers;
  return unsubscribe;
}

/** Live protocols (one document per judge position) of the given equipages */
export function listenForDressageLiveGroup(competitionId, equipagesOrStartNumbers, callback) {
  if (!competitionId) throw new Error("listenForDressageLiveGroup: competitionId saknas");
  return listenPerStartNumber(
    'listenForDressageLiveGroup',
    (sn) => `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${sn}/live`,
    equipagesOrStartNumbers,
    callback
  );
}

/** Saved protocols of the given equipages, the 'general' document (error points) included */
export function listenForDressageProtocolsCollectionGroup(competitionId, equipagesOrStartNumbers, callback) {
  if (!competitionId) throw new Error("listenForDressageProtocolsCollectionGroup: competitionId saknas");
  return listenPerStartNumber(
    'listenForDressageProtocolsCollectionGroup',
    (sn) => `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`,
    equipagesOrStartNumbers,
    callback
  );
}

export async function getAllDressageProtocols(competitionId, equipages) {
  if (!competitionId) throw new Error("getAllDressageProtocols: competitionId saknas");
  if (!equipages || equipages.length === 0) return new Map();

  const map = new Map();
  const chunkSize = 10;
  for (let i = 0; i < equipages.length; i += chunkSize) {
    const chunk = equipages.slice(i, i + chunkSize);
    const promises = chunk.map(async eq => {
      const sn = String(eq.startNumber ?? eq.id).trim();
      if (!sn) return { sn, protos: [] };
      const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`);
      try {
        const snap = await getDocs(colRef);
        // 'general' (error points from C) is kept for the result engine
        return { sn, protos: plainDressageProtocolsFromDocs(snap.docs.map(d => ({ id: d.id, data: d.data() })), sn) };
      } catch (e) {
        return { sn, protos: [] };
      }
    });
    const results = await Promise.all(promises);
    results.forEach(r => map.set(r.sn, r.protos));
  }
  return map;
}

export function listenForDressageFinalizationCollection(competitionId, callback) {
  if (!competitionId) throw new Error("listenForDressageFinalizationCollection: competitionId saknas");
  const colRef = collection(db, `competitions/${competitionId}/dressageFinalization`);
  return onSnapshot(query(colRef), (snapshot) => {
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(docs);
  }, buildSnapshotErrorHandler('listenForDressageFinalizationCollection', callback, []));
}
