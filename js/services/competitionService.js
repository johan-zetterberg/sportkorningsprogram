import { db, appId } from '../config/firebase-config.js';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, orderBy, limit, addDoc, serverTimestamp, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompDocRef, getCompCollectionRef } from './firestoreService.js';
import { auth } from '../config/firebase-config.js';
import { getExpectedDressageJudgePositions, isDressageReadyToFinalize } from './competitionStatusService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

const CONFIG_CACHE_PREFIX = 'configCache:';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme

export async function createCompetition(data) {
  const user = auth?.currentUser || null;

  const comp = {
    name: data.name?.trim() || '',
    place: data.place?.trim() || '',
    dates: data.dates?.trim() || '',
    club: data.club?.trim() || '',
    competitionMode: 'live',
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    published: false, // Default to unpublished (Draft)
    ruleSettings: {
      marathonObstaclePenaltyRate: 0.25,
      precisionTimePenaltyRate: 0.5
    }
  };

  return trackWrite(`Skapar tävling ${comp.name}`, (async () => {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions`);
    const docRef = await addDoc(colRef, comp);
    const newId = docRef.id;

    if (data.importFrom) {
      const sourceId = data.importFrom;

      try {
        const configsToCopy = [
          'maratonConfig',
          'precisionConfig',
          'competitionMeta',
          'map' 
        ];

        const copyConfig = async (cfgName) => {
          try {
            const srcRef = doc(db, `artifacts/${appId}/public/data/competitions/${sourceId}/config`, cfgName);
            const snap = await getDoc(srcRef);
            if (snap.exists()) {
              const cfgData = snap.data();
              const destRef = doc(db, `artifacts/${appId}/public/data/competitions/${newId}/config`, cfgName);
              await setDoc(destRef, cfgData); 
            }
          } catch (err) {
            console.warn(`Failed to copy config ${cfgName} from ${sourceId}`, err);
          }
        };

        const copyCollection = async (colName) => {
          try {
            const srcColRef = collection(db, `artifacts/${appId}/public/data/competitions/${sourceId}/${colName}`);
            const snap = await getDocs(srcColRef);
            if (snap.empty) return;

            const destColPath = `artifacts/${appId}/public/data/competitions/${newId}/${colName}`;
            const batch = writeBatch(db);

            let count = 0;
            for (const d of snap.docs) {
              const destRef = doc(db, destColPath, d.id);
              batch.set(destRef, d.data());
              count++;
              if (count >= 490) { 
                await batch.commit();
                count = 0;
              }
            }
            if (count > 0) await batch.commit();
          } catch (err) {
            console.warn(`Failed to copy collection ${colName} from ${sourceId}`, err);
          }
        };

        await Promise.all([
          ...configsToCopy.map(name => copyConfig(name)),
          copyCollection('maratonObstacles')
        ]);

      } catch (importErr) {
        console.error('[createCompetition] Generic import error:', importErr);
      }
    }

    return docRef;
  })());
}

export function listenForCompetitions(callback) {
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions`);
  const q = query(colRef, orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(items);
  }, buildSnapshotErrorHandler('listenForCompetitions', callback, []));
}

export async function getCompetitionById(competitionId) {
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: competitionId, ...snap.data() } : null;
}

export function listenForCompetition(competitionId, callback) {
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, buildSnapshotErrorHandler('listenForCompetition', callback, null));
}

export async function updateCompetition(competitionId, data) {
  return trackWrite(`Uppdaterar tävling ${competitionId}`, (async () => {
    const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    });
  })());
}

export async function deleteCompetition(competitionId) {
  if (!competitionId) throw new Error("deleteCompetition: competitionId saknas");

  const deleteQueryBatch = async (queryRef) => {
    const snapshot = await getDocs(queryRef);
    if (snapshot.empty) return 0;
    const batch = writeBatch(db);
    snapshot.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snapshot.size;
  };

  const simpleCollections = [
    'equipages',
    'equipagePrivate',
    'judges',
    'officials',
    'roleEmails',
    'maratonObstacles',
    'config',
    'maraton-timing',
    'precision',
    'dressageStatus',
    'messages',
    'documents',
    'computed_equipages'
  ];

  for (const colName of simpleCollections) {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/${colName}`);
    await deleteQueryBatch(query(colRef));
  }

  const privateCollections = [
    'auditLog'
  ];

  for (const colName of privateCollections) {
    const colRef = collection(db, `artifacts/${appId}/private/data/competitions/${competitionId}/${colName}`);
    await deleteQueryBatch(query(colRef));
  }

  const marResCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maratonResults`);
  const marResSnap = await getDocs(marResCol);
  for (const d of marResSnap.docs) {
    const obsCol = collection(db, `${marResCol.path}/${d.id}/obstacles`);
    await deleteQueryBatch(query(obsCol));
    await deleteDoc(d.ref); 
  }

  const dressCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage`);
  const dressSnap = await getDocs(dressCol);
  for (const d of dressSnap.docs) {
    const protCol = collection(db, `${dressCol.path}/${d.id}/protocols`);
    await deleteQueryBatch(query(protCol));
    await deleteDoc(d.ref);
  }

  const dressResCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageResults`);
  const dressResSnap = await getDocs(dressResCol);
  for (const d of dressResSnap.docs) {
    const protCol = collection(db, `${dressResCol.path}/${d.id}/protocols`);
    await deleteQueryBatch(query(protCol));
    await deleteDoc(d.ref);
  }

  const marLiveCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
  await deleteQueryBatch(query(marLiveCol));

  const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
  await deleteDoc(compRef);
}

export async function getConfig(competitionId, configName, forceRefresh = false) {
  if (!competitionId || !configName) return {};

  const cacheKey = `${CONFIG_CACHE_PREFIX}${competitionId}:${configName}`;

  if (!forceRefresh) {
    try {
      const cachedRaw = localStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        const age = Date.now() - (cached.ts || 0);
        if (age < CACHE_TTL_MS) {
          return cached.data;
        }
      }
    } catch (e) { console.warn('Config cache read error', e); }
  }

  const configRef = getCompDocRef(competitionId, 'config', configName);
  const docSnap = await getDoc(configRef);
  const data = docSnap.exists() ? docSnap.data() : {};

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) {
    console.warn('Could not cache config', e);
  }

  return data;
}

export async function saveConfig(competitionId, configName, data) {
  return trackWrite(`Sparar config ${configName}`, (async () => {
    const configRef = getCompDocRef(competitionId, 'config', configName);
    await setDoc(configRef, data, { merge: true });

    try {
      const cacheKey = `${CONFIG_CACHE_PREFIX}${competitionId}:${configName}`;
      localStorage.removeItem(cacheKey);
    } catch (e) { }
  })());
}

export async function replaceConfig(competitionId, configName, data) {
  return trackWrite(`Ersätter config ${configName}`, (async () => {
    const configRef = getCompDocRef(competitionId, 'config', configName);
    await setDoc(configRef, data || {});

    try {
      const cacheKey = `${CONFIG_CACHE_PREFIX}${competitionId}:${configName}`;
      localStorage.removeItem(cacheKey);
    } catch (e) { }
  })());
}

export function listenForConfig(competitionId, configName, callback) {
  if (!competitionId || !configName) return () => { };
  const configRef = getCompDocRef(competitionId, 'config', configName);
  return onSnapshot(configRef, (docSnap) => {
    callback(docSnap.exists() ? docSnap.data() : {});
  }, buildSnapshotErrorHandler(`listenForConfig:${configName}`, callback, {}));
}

export async function getCompetitionStatistics(competitionId) {
  if (!competitionId) return { dressage: 0, marathon: 0, precision: 0 };

  let dressagePending = 0;
  try {
    const statusCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`);
    const equipagesCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/equipages`);
    const judgesCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/judges`);
    const judgeMapRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/config`, 'dressageJudgeMapping');

    const [statusSnap, equipagesSnap, judgesSnap, judgeMapSnap] = await Promise.all([
      getDocs(statusCol),
      getDocs(equipagesCol),
      getDocs(judgesCol),
      getDoc(judgeMapRef)
    ]);

    const statusBySn = new Map(statusSnap.docs.map(d => [String(d.id), d.data() || {}]));
    const judgeMappingRaw = judgeMapSnap.exists() ? (judgeMapSnap.data()?.mapping || judgeMapSnap.data() || {}) : {};
    const judges = judgesSnap.docs.map(d => d.data() || {});

    const protocolCounts = new Map();
    await Promise.all(equipagesSnap.docs.map(async (eqDoc) => {
      const sn = String(eqDoc.id);
      const primaryCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`);
      const legacyCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageResults/${sn}/protocols`);

      let snap = await getDocs(primaryCol);
      if (snap.empty) {
        snap = await getDocs(legacyCol);
      }

      const countedJudges = new Set();
      snap.docs.forEach(docSnap => {
        if (docSnap.id === 'general') return;
        const data = docSnap.data() || {};
        if (data.eliminated) return;
        const key = String(data.judgePosition || data.judgeId || docSnap.id.replace(/^judge_/, '')).toUpperCase();
        if (key) countedJudges.add(key);
      });
      protocolCounts.set(sn, countedJudges);
    }));

    const checks = equipagesSnap.docs.map(async (eqDoc) => {
      const sn = String(eqDoc.id);
      const equipage = eqDoc.data() || {};
      const status = statusBySn.get(sn) || {};
      const expectedPositions = getExpectedDressageJudgePositions(equipage.className, judgeMappingRaw, judges);
      const countedJudges = protocolCounts.get(sn) || new Set();

      const finRef = doc(db, `competitions/${competitionId}/dressageFinalization/${sn}`);
      const finSnap = await getDoc(finRef);
      const isFinal = finSnap.exists() && finSnap.data().finalized === true;
      return isDressageReadyToFinalize({
        status,
        countedJudgePositions: countedJudges,
        expectedJudgePositions: expectedPositions,
        finalized: isFinal
      }) ? 1 : 0;
    });

    const results = await Promise.all(checks);
    dressagePending = results.reduce((a, b) => a + b, 0);
  } catch (e) {
    console.warn('Error fetching dressage stats:', e);
  }

  let marathonPending = 0;
  try {
    const marCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
    const marSnap = await getDocs(marCol);
    marSnap.forEach(d => {
      const data = d.data();
      const hasData =
        data.currentPhase ||
        data.startTime ||
        data.finish_A ||
        data.finish_B ||
        (Array.isArray(data.obstacles) && data.obstacles.length > 0) ||
        data.totalPenalty != null ||
        data.status === 'finished' ||
        data.status === 'Klar' ||
        data.eliminated;
      if (hasData && !data.finalized) {
        marathonPending++;
      }
    });
  } catch (e) {
    console.warn('Error fetching marathon stats:', e);
  }

  let precisionPending = 0;
  try {
    const precCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
    const precSnap = await getDocs(precCol);
    precSnap.forEach(d => {
      const data = d.data();
      const hasData = data.running || data.timeMs || data.knocks || data.eliminated || data.status === 'finished' || data.finalized;
      if (hasData && !data.finalized) {
        precisionPending++;
      }
    });
  } catch (e) {
    console.warn('Error fetching precision stats:', e);
  }

  return {
    dressage: dressagePending,
    marathon: marathonPending,
    precision: precisionPending
  };
}
