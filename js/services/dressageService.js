import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDoc, getDocs, setDoc, onSnapshot, serverTimestamp, runTransaction, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

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
  errorPenalty
}) {
  const ref = doc(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${String(startNumber)}`
  );

  return trackWrite(`Ändrar dressyrstatus #${startNumber}`, (async () => {
    await runTransaction(db, async (transaction) => {
      await transaction.get(ref);

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

      transaction.set(ref, payload, { merge: true });
    });
  })());
}

export function listenForDressageStatus(competitionId, startNumber, callback) {
  const ref = doc(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${String(startNumber)}`
  );

  return onSnapshot(ref, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data());
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
        score: typeof m?.score === "number" ? m.score : Number(m?.score || 0),
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

function asPlainDressageProtocol(data, docId, fallbackStartNumber) {
  if (!data) return null;
  const protocol = data.protocol && typeof data.protocol === 'object' ? data.protocol : data;
  const judgePosition = protocol.judgePosition ?? protocol.position ?? data.judgePosition ?? data.position ?? '';

  return {
    id: docId,
    startNumber: protocol.startNumber ?? data.startNumber ?? fallbackStartNumber,
    judgeId: protocol.judgeId ?? data.judgeId ?? (docId.startsWith('judge_') ? docId.replace('judge_', '') : docId),
    judgeName: protocol.judgeName ?? data.judgeName ?? '',
    judgePosition,
    position: judgePosition,
    testKey: protocol.testKey ?? protocol.programKey ?? data.testKey ?? data.programKey ?? '',
    programKey: protocol.programKey ?? protocol.testKey ?? data.programKey ?? data.testKey ?? '',
    movements: Array.isArray(protocol.movements) ? protocol.movements.map(m => ({ ...m })) : [],
    eliminated: !!(protocol.eliminated ?? data.eliminated),
    generalErrors: protocol.generalErrors ?? data.generalErrors ?? 0,
    lastUpdate: data.lastUpdate ?? null,
    state: data.state ?? null,
    updatedAt: data.updatedAt ?? protocol.updatedAt ?? null
  };
}

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

  return onSnapshot(colRef, (snapshot) => {
    const docs = snapshot.docs.map(d => asPlainDressageProtocol(d.data(), d.id, startNumber));
    callback(docs.filter(d => d.id !== 'general'));
  }, buildSnapshotErrorHandler(`listenForDressageProtocols:${sn}`, callback, []));
}

export function listenForDressageStatusCollection(competitionId, callback) {
  if (!competitionId) throw new Error("listenForDressageStatusCollection: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`);
  return onSnapshot(colRef, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, buildSnapshotErrorHandler('listenForDressageStatusCollection', callback, []));
}

export async function getDressageStatusCollection(competitionId) {
  if (!competitionId) throw new Error("getDressageStatusCollection: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`);
  const snap = await getDocs(colRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function listenForDressageLiveGroup(competitionId, equipagesOrStartNumbers, callback) {
  if (!competitionId) throw new Error("listenForDressageLiveGroup: competitionId saknas");
  
  const map = new Map();
  const unsubs = [];
  const emitter = createCoalescedMapEmitter(map, callback);

  const sns = normalizeStartNumbers(equipagesOrStartNumbers);
  if (sns.length === 0) {
    callback([]);
    return () => {};
  }

  sns.forEach(sn => {
    if (!sn) return;
    try {
      const liveRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${sn}/live`);
      const unsub = onSnapshot(liveRef, (snap) => {
        snap.docChanges().forEach(change => {
          const docId = change.doc.id;
          const fullId = `${sn}_${docId}`;
          if (change.type === 'removed') {
            map.delete(fullId);
          } else {
            const plain = asPlainDressageProtocol(change.doc.data(), docId, sn);
            if (plain) map.set(fullId, plain);
          }
        });
        emitter.emit();
      }, buildSnapshotErrorHandler(`listenForDressageLiveGroup:${sn}`, callback, []));
      unsubs.push(unsub);
    } catch (e) {
      console.warn("listenForDressageLiveGroup setup err", sn, e);
    }
  });

  return () => {
    emitter.cancel();
    unsubs.forEach(u => u());
  };
}

export function listenForDressageProtocolsCollectionGroup(competitionId, equipagesOrStartNumbers, callback) {
  if (!competitionId) throw new Error("listenForDressageProtocolsCollectionGroup: competitionId saknas");
  
  const map = new Map();
  const unsubs = [];
  const emitter = createCoalescedMapEmitter(map, callback);

  const sns = normalizeStartNumbers(equipagesOrStartNumbers);
  if (sns.length === 0) {
    callback([]);
    return () => {};
  }

  sns.forEach(sn => {
    if (!sn) return;
    try {
      const protoRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`);
      const unsub = onSnapshot(protoRef, (snap) => {
        snap.docChanges().forEach(change => {
          const docId = change.doc.id;
          if (docId === 'general') return;
          const fullId = `${sn}_${docId}`;
          if (change.type === 'removed') {
            map.delete(fullId);
          } else {
            const plain = asPlainDressageProtocol(change.doc.data(), docId, sn);
            if (plain) map.set(fullId, plain);
          }
        });
        emitter.emit();
      }, buildSnapshotErrorHandler(`listenForDressageProtocolsCollectionGroup:${sn}`, callback, []));
      unsubs.push(unsub);
    } catch (e) {
      console.warn("listenForDressageProtocolsCollectionGroup setup err", sn, e);
    }
  });

  return () => {
    emitter.cancel();
    unsubs.forEach(u => u());
  };
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
        const protos = snap.docs.map(d => asPlainDressageProtocol(d.data(), d.id, sn));
        return { sn, protos: protos.filter(p => p && p.id !== 'general') };
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
