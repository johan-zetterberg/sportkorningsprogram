import { db, appId, functions } from '../config/firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where, orderBy, limit, addDoc, serverTimestamp, writeBatch, deleteDoc, deleteField, FieldPath } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { trackWrite, getCompDocRef, getCompCollectionRef } from './firestoreService.js';
import { auth } from '../config/firebase-config.js';
import { getExpectedDressageJudgePositions, isDressageReadyToFinalize } from './competitionStatusService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

const CONFIG_CACHE_PREFIX = 'configCache:';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme

export async function createCompetition(data) {
  const user = auth?.currentUser || null;
  const competitionMode = data.competitionMode === 'field' ? 'field' : 'live';

  const comp = {
    name: data.name?.trim() || '',
    place: data.place?.trim() || '',
    dates: data.dates?.trim() || '',
    club: data.club?.trim() || '',
    competitionMode,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    admins: [],
    staffUids: [],
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
          'display',
          'dressyrProgramMapping',
          'dressyrClassConfig',
          'dressageJudgeMapping',
          'horseTemperature',
          'competitionMeta',
          'map' 
        ];

        const copyConfig = async (cfgName) => {
          try {
            const srcRef = doc(db, `artifacts/${appId}/public/data/competitions/${sourceId}/config`, cfgName);
            const snap = await getDoc(srcRef);
            if (snap.exists()) {
              const cfgData = snap.data();
              // The source's lock (set by hand or by archiving) is not a
              // setting: the new competition starts open
              if (cfgName === 'competitionMeta') cfgData.manualLockdown = false;
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
            let batch = writeBatch(db);

            let count = 0;
            for (const d of snap.docs) {
              const destRef = doc(db, destColPath, d.id);
              batch.set(destRef, d.data());
              count++;
              if (count >= 490) { 
                await batch.commit();
                batch = writeBatch(db);
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

// As the rules decide it (getUserRole() reads the role field; superadmin also
// the roles list): roles may hold competition roles, which give no global list
export function isGlobalCompetitionAdmin(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return user?.role === 'admin' || user?.role === 'superadmin' || roles.includes('superadmin');
}

function getCachedCompetitionIdsForUser(uid) {
  const ids = new Set();
  try {
    const lastId = localStorage.getItem('lastCompetitionId');
    if (lastId) ids.add(lastId);
    if (uid) {
      // rememberRoles('comp|<compId>|<uid>|<email>') in main.js
      const prefix = 'roleCache:comp|';
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const [compId, keyUid] = key.slice(prefix.length).split('|');
        if (!compId || keyUid !== uid) continue;
        let roles = null;
        try { roles = JSON.parse(localStorage.getItem(key) || 'null'); } catch { roles = null; }
        if (Array.isArray(roles) && roles.length) ids.add(compId);
      }
    }
  } catch { /* ignore storage errors */ }
  return ids;
}

function extractCompetitionIdFromStaffDocPath(path = '') {
  const segments = String(path || '').split('/');
  const compIdx = segments.indexOf('competitions');
  if (compIdx !== -1 && segments[compIdx + 1]) {
    return segments[compIdx + 1];
  }
  return null;
}

/**
 * Drafts (published: false) are readable only by their staff, so a list query
 * must say which competitions it asks for: global admins list everything; others
 * get the published ones plus the drafts they created, administer, or have staff roles in.
 */
export function listenForCompetitions(callback, max = 50, user = null) {
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions`);
  const uid = user?.uid || null;
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  const isGlobalAdmin = isGlobalCompetitionAdmin(user);
  const scopedQueries = () => ({
    published: query(colRef, where('published', '==', true), orderBy('createdAt', 'desc'), limit(max)),
    ...(uid ? {
      created: query(colRef, where('createdBy', '==', uid)),
      administered: query(colRef, where('admins', 'array-contains', uid)),
      staff: query(colRef, where('staffUids', 'array-contains', uid))
    } : {})
  });
  const queries = isGlobalAdmin
    ? { all: query(colRef, orderBy('createdAt', 'desc'), limit(max)) }
    : scopedQueries();

  const parts = {};
  // The list is shown once every query has answered (or failed): showing the
  // first answer alone flickered a partial list
  const awaiting = new Set(Object.keys(queries));
  const emit = () => {
    if (awaiting.size) return;
    const byId = new Map();
    Object.values(parts).flat().forEach(item => {
      if (item && item.id) byId.set(item.id, item);
    });
    const items = [...byId.values()].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    callback(items);
  };
  const unsubs = [];
  const docListeners = new Map();

  const listenCompetitionDoc = (compId) => {
    if (!compId || docListeners.has(compId)) return;
    const key = `doc:${compId}`;
    const unsub = onSnapshot(doc(colRef, compId), (snap) => {
      parts[key] = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
      emit();
    }, () => {
      parts[key] = [];
      emit();
    });
    docListeners.set(compId, unsub);
    unsubs.push(unsub);
  };

  const listen = (key, q) => unsubs.push(onSnapshot(q, (snap) => {
    parts[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    awaiting.delete(key);
    emit();
  }, (err) => {
    // The published query needs a composite index (published + createdAt);
    // while it is still being built, list without the order (sorted above)
    if (key === 'published' && err?.code === 'failed-precondition') {
      listen(key, query(colRef, where('published', '==', true), limit(max)));
      return;
    }
    // The whole list refused (the role in the app and in the rules differ):
    // list what this user may see instead of nothing
    if (key === 'all' && err?.code === 'permission-denied') {
      awaiting.delete(key);
      Object.entries(scopedQueries()).forEach(([k, scoped]) => { awaiting.add(k); listen(k, scoped); });
      return;
    }
    // One refused or failing query must not empty the others
    console.warn(`[listenForCompetitions:${key}]`, err?.code || err);
    parts[key] = [];
    awaiting.delete(key);
    emit();
  }));
  Object.entries(queries).forEach(([key, q]) => listen(key, q));

  if (!isGlobalAdmin && uid) {
    getCachedCompetitionIdsForUser(uid).forEach(compId => listenCompetitionDoc(compId));

    if (email) {
      const watchStaffCollectionGroup = (groupName) => {
        try {
          const cgQuery = query(collectionGroup(db, groupName), where('email', '==', email));
          unsubs.push(onSnapshot(cgQuery, (snap) => {
            snap.docs.forEach(d => {
              const compId = extractCompetitionIdFromStaffDocPath(d.ref.path);
              if (compId) listenCompetitionDoc(compId);
            });
          }, (err) => {
            // Needs the collection-group index on email (firestore.indexes.json)
            console.warn(`[listenForCompetitions:${groupName}]`, err?.code || err);
          }));
        } catch { /* ignore */ }
      };
      watchStaffCollectionGroup('roleEmails');
      watchStaffCollectionGroup('admins');
    }
  }

  return () => unsubs.forEach(unsub => unsub());
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

// Deleting runs on the server (deleteCompetitionData): only there can all of
// a competition go at once, including the finalization locks under
// /competitions/{id} and its files in Storage
export async function deleteCompetition(competitionId) {
  if (!competitionId) throw new Error("deleteCompetition: competitionId saknas");
  const callable = httpsCallable(functions, 'deleteCompetitionData');
  const result = await callable({ competitionId });
  return result?.data || { deleted: true };
}

// The device copy of a config (getConfig keeps it up to an hour). Cleared
// before a write, so a read while the write is not yet confirmed (offline)
// gets the new value from Firestore's own cache
function clearConfigCache(competitionId, configName) {
  try {
    localStorage.removeItem(`${CONFIG_CACHE_PREFIX}${competitionId}:${configName}`);
  } catch (e) { }
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
    clearConfigCache(competitionId, configName);
    const configRef = getCompDocRef(competitionId, 'config', configName);
    await setDoc(configRef, data, { merge: true });
  })());
}

/**
 * Sets (or with undefined removes) single top-level entries of a config
 * document, e.g. one class in a per-class mapping. The rest of the document is
 * left as it is on the server: saving from a page loaded earlier does not undo
 * what someone else saved for other classes meanwhile.
 */
export async function updateConfigEntries(competitionId, configName, entries = {}) {
  const keys = Object.keys(entries);
  if (!keys.length) return;
  return trackWrite(`Sparar config ${configName}`, (async () => {
    clearConfigCache(competitionId, configName);
    const configRef = getCompDocRef(competitionId, 'config', configName);
    const args = [];
    keys.forEach((key) => {
      args.push(new FieldPath(key), entries[key] === undefined ? deleteField() : entries[key]);
    });
    try {
      await updateDoc(configRef, ...args);
    } catch (error) {
      if (error?.code !== 'not-found') throw error;
      // First save: the document does not exist yet
      const data = {};
      keys.forEach((key) => { if (entries[key] !== undefined) data[key] = entries[key]; });
      await setDoc(configRef, data, { merge: true });
    }
  })());
}

/**
 * Renames keys of a map in a config document (e.g. a class's entry after the
 * class is renamed), read fresh from the server. parentPath is the map's field
 * path ([] for the document itself). A new name that already has an entry is
 * left as it is. Returns the number of keys moved.
 */
export async function renameConfigMapKeys(competitionId, configName, parentPath, renames = []) {
  const data = await getConfig(competitionId, configName, true);
  const map = parentPath.reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), data);
  if (!map || typeof map !== 'object') return 0;
  const args = [];
  let moved = 0;
  renames.forEach(({ oldName, newName }) => {
    if (!(oldName in map) || (newName in map)) return;
    args.push(new FieldPath(...parentPath, newName), map[oldName]);
    args.push(new FieldPath(...parentPath, oldName), deleteField());
    moved++;
  });
  if (!args.length) return 0;
  clearConfigCache(competitionId, configName);
  await trackWrite(`Flyttar klassinställningar i ${configName}`,
    updateDoc(getCompDocRef(competitionId, 'config', configName), ...args));
  return moved;
}

export async function replaceConfig(competitionId, configName, data) {
  return trackWrite(`Ersätter config ${configName}`, (async () => {
    clearConfigCache(competitionId, configName);
    const configRef = getCompDocRef(competitionId, 'config', configName);
    await setDoc(configRef, data || {});
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
    const judgeMapRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/config`, 'dressageJudgeMapping');

    const [statusSnap, equipagesSnap, judgeMapSnap] = await Promise.all([
      getDocs(statusCol),
      getDocs(equipagesCol),
      getDoc(judgeMapRef)
    ]);

    const statusBySn = new Map(statusSnap.docs.map(d => [String(d.id), d.data() || {}]));
    const judgeMappingRaw = judgeMapSnap.exists() ? (judgeMapSnap.data()?.mapping || judgeMapSnap.data() || {}) : {};

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
      const expectedPositions = getExpectedDressageJudgePositions(equipage.className, judgeMappingRaw);
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

/**
 * Downloads a complete copy of the competition as a JSON file (exportCompetition:
 * every document, private ones too, but no access PINs; personal identity
 * numbers only with includePersonalNumbers). Returns the number of documents.
 */
export async function downloadCompetitionExport(competitionId, competitionName = '', { includePersonalNumbers = false } = {}) {
  const callable = httpsCallable(functions, 'exportCompetition', { timeout: 300000 });
  const { data } = await callable({ competitionId, includePersonalNumbers: includePersonalNumbers === true });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const safeName = String(competitionName || competitionId).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sakerhetskopia_${safeName}_${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freed late: a slow device may still be saving the file
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return data?.documentCount ?? 0;
}
