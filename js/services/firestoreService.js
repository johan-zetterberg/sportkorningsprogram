import { db, appId } from '../config/firebase-config.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  serverTimestamp,
  addDoc,
  orderBy,
  deleteDoc,

  collectionGroup,
  limit,
  runTransaction,
  writeBatch,
  where,
  waitForPendingWrites
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { auth } from '../config/firebase-config.js';
import { syncService } from './syncService.js';

// === GLOBAL SYNC LISTENER ===
// Lyssna på när vi får tillbaka nätverket.
// Då väntar vi på att Firestore synkar allt, och rensar sedan kön.
window.addEventListener('online', async () => {
  try {
    // waitForPendingWrites commitar lokala ändringar till servern
    await waitForPendingWrites(db);
    syncService.clearAll();
  } catch (e) {
    console.warn('Fel vid återsynk:', e);
  }
});

// === HJÄLPFUNKTION FÖR ATT WRAPPA SKRIVNINGAR ===
export async function trackWrite(description, promise) {
  const id = Date.now().toString() + Math.random().toString().slice(2, 6);
  syncService.add(id, description);
  try {
    const res = await promise;

    // Om vi är online: operationen är klar och synkad -> ta bort direkt.
    // Om vi är offline: operationen är "klar" lokalt, men inte synkad -> behåll i listan.
    if (navigator.onLine) {
      syncService.remove(id);
    }
    return res;
  } catch (err) {
    // Om det felar på riktigt (undantag), ta bort den så den inte ligger kvar och ser "pending" ut för alltid.
    syncService.remove(id);
    throw err;
  }
}



// === HJÄLPFUNKTION FÖR SÖKVÄGAR ===
const getCompCollectionRef = (competitionId, collectionName) => {
  return collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/${collectionName}`);
};
const getCompDocRef = (competitionId, collectionName, docId) => {
  return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/${collectionName}`, docId);
};

// =================================================================
// TÄVLINGSFUNKTIONER
// =================================================================

/**
 * Generic helper to get data from a document in the public artifacts tree.
 * @param {string} collectionName - e.g. 'config', 'competitions'
 * @param {string} docId 
 * @returns {Promise<Object|null>}
 */
export async function getDocData(collectionName, docId) {
  if (!collectionName || !docId) return null;
  const ref = doc(db, `artifacts/${appId}/public/data/${collectionName}/${docId}`);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/**
 * Generic helper to set data to a document in the public artifacts tree.
 * @param {string} collectionName 
 * @param {string} docId 
 * @param {Object} data 
 * @param {boolean} merge 
 */
export async function setDocData(collectionName, docId, data, merge = true) {
  if (!collectionName || !docId) return;
  return trackWrite(`Sätter data ${collectionName}/${docId}`, (async () => {
    const p = `artifacts/${appId}/public/data/${collectionName}/${docId}`;
    const ref = doc(db, p);
    try {
      await setDoc(ref, data, { merge });
    } catch (e) {
      throw new Error(`Failed to write to [${p}]: ${e.message} (${e.code})`);
    }
    return { ok: true, path: ref.path };
  })());
}

// Status-dokument per ekipage (globalt, inte per domare), men med fält som anger vem som påbörjade.
export async function setDressageStatus(competitionId, startNumber, { state, judgeId, judgeName }) {
  const ref = doc(db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${String(startNumber)}/meta`,
    'status'
  );

  return trackWrite(`Ändrar dressyrstatus #${startNumber}`, (async () => {
    await runTransaction(db, async (transaction) => {
      // Vi läser dokumentet (behövs egentligen inte för merge, men bra sed i transaktion om vi vill validera)
      // Här kör vi direct set med merge, men inom transaktionen garanteras ordningen
      // eslint-disable-next-line no-unused-vars
      const sfDoc = await transaction.get(ref);

      const payload = {
        state,               // 'ongoing' | 'finished'
        judgeId: judgeId || null,
        judgeName: judgeName || null,
        updatedAt: serverTimestamp(),
      };
      if (state === 'ongoing') payload.startedAt = serverTimestamp();
      if (state === 'finished') payload.finishedAt = serverTimestamp();

      transaction.set(ref, payload, { merge: true });
    });
  })());
}
/**
 * Lyssnar i realtid på status-dokumentet för ett specifikt ekipage i dressyren.
 * Anropas av starttider.js för att visa "Pågår" och "Klart".
 */
export function listenForDressageStatus(competitionId, startNumber, callback) {
  const ref = doc(db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${String(startNumber)}/meta`,
    'status'
  );

  return onSnapshot(ref, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data());
    } else {
      callback(null);
    }
  }, (err) => {
    console.error(`Fel vid lyssning på dressyrstatus för startnr ${startNumber}:`, err);
    callback(null); // Skicka null vid fel för att undvika att sidan låser sig
  });
}

/**
 * Skapar en ny tävling i:
 * artifacts/{appId}/public/data/competitions
 */
export async function createCompetition(data) {
  const user = auth?.currentUser || null;

  const comp = {
    name: data.name?.trim() || '',
    place: data.place?.trim() || '',
    dates: data.dates?.trim() || '',
    club: data.club?.trim() || '',
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    published: false, // Default to unpublished (Draft)
    ruleSettings: {
      marathonObstaclePenaltyRate: 0.25,
      precisionTimePenaltyRate: 0.5
    }
  };

  return trackWrite(`Skapar tävling ${comp.name}`, (async () => {
    // Pathen matchar dina regler:
    // match /artifacts/{appId}/public/data/competitions/{compId} { allow create if admin ... }
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions`);
    const docRef = await addDoc(colRef, comp);
    const newId = docRef.id;

    // --- IMPORT SETTINGS LOGIC ---
    if (data.importFrom) {
      const sourceId = data.importFrom;

      try {
        // List of configs to copy
        const configsToCopy = [
          'maratonConfig',
          'precisionConfig',
          'competitionMeta',
          'map' // Includes coordinates/bounds but NOT the image itself if hosted externally, but URL is in maratonConfig usually? 
          // Wait, admin-settings.js saves map bounds/image in 'maratonConfig' OR 'map'?
          // 'maratonConfig' has 'mapSettings' (image, bounds).
          // 'map' has 'coordinates' (GPS).
          // We copy both.
        ];

        // Helper to read-then-write
        const copyConfig = async (cfgName) => {
          try {
            // We can use the exported getConfig/saveConfig but they use cache/trackWrite which is fine.
            // But let's do direct Firestore to be robust in this specialized flow?
            // Actually, verify getConfig export execution.
            // getConfig uses cache. We definitely want to force refresh or just direct read.
            const srcRef = doc(db, `artifacts/${appId}/public/data/competitions/${sourceId}/config`, cfgName);
            const snap = await getDoc(srcRef);
            if (snap.exists()) {
              const cfgData = snap.data();
              const destRef = doc(db, `artifacts/${appId}/public/data/competitions/${newId}/config`, cfgName);
              await setDoc(destRef, cfgData); // Direct set to avoid 'trackWrite' spam for background ops? Or use saveConfig?
              // existing saveConfig uses setDoc with merge: true.
              // We can use setDoc directly.
            }
          } catch (err) {
            console.warn(`Failed to copy config ${cfgName} from ${sourceId}`, err);
          }
        };

        // Helper to copy a collection (e.g. maratonObstacles)
        const copyCollection = async (colName) => {
          try {
            const srcColRef = collection(db, `artifacts/${appId}/public/data/competitions/${sourceId}/${colName}`);
            const snap = await getDocs(srcColRef);
            if (snap.empty) return;

            const destColPath = `artifacts/${appId}/public/data/competitions/${newId}/${colName}`;
            const batch = writeBatch(db); // Use batch for atomicity (limit 500 ops)

            let count = 0;
            for (const d of snap.docs) {
              const destRef = doc(db, destColPath, d.id);
              // We copy the exact data, including IDs
              batch.set(destRef, d.data());
              count++;
              if (count >= 490) { // Safety margin for batch limit
                await batch.commit();
                count = 0;
              }
            }
            if (count > 0) await batch.commit();
          } catch (err) {
            console.warn(`Failed to copy collection ${colName} from ${sourceId}`, err);
          }
        };

        // Run configs in parallel
        await Promise.all([
          ...configsToCopy.map(name => copyConfig(name)),
          copyCollection('maratonObstacles') // <-- Copy obstacles
        ]);

      } catch (importErr) {
        console.error('[createCompetition] Generic import error:', importErr);
        // We do NOT fail the creation itself, just the import.
      }
    }

    return docRef;
  })());
}

/**
 * Realtidslyssnare som matar ut alla tävlingar till en callback.
 * Callback får en array av { id, ...data }
 */
export function listenForCompetitions(callback) {
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions`);

  // Restored efficient query with orderBy and limit
  const q = query(colRef, orderBy('createdAt', 'desc'), limit(50));

  return onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(items);
  }, (err) => {
    console.error('listenForCompetitions error:', err);
    callback([]);
  });
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
  });
}

// NYTT: Uppdatera tävlingens root-dokument (t.ex. published-status)
export async function updateCompetition(competitionId, data) {
  return trackWrite(`Uppdaterar tävling ${competitionId}`, (async () => {
    const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    });
  })());
}

// =================================================================
// EKIPAGE- & DELTAGARFUNKTIONER
// =================================================================
// --- ÄNDRA getEquipages ---
export async function getEquipages(competitionId) {
  const equipagesRef = getCompCollectionRef(competitionId, 'equipages');
  const snapshot = await getDocs(equipagesRef);

  const results = snapshot.docs.map(doc => {
    const data = doc.data();
    return { id: doc.id, ...data }; // Behåll den korrekta returneringen
  });
  return results;
}

export function listenForEquipages(competitionId, callback) {
  const equipagesRef = getCompCollectionRef(competitionId, 'equipages');
  return onSnapshot(query(equipagesRef), (snapshot) => {
    const equipages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); // ÄNDRING HÄR
    callback(equipages);
  });
}
export async function updateEquipage(competitionId, equipageId, data) {
  return trackWrite(`Uppdaterar ekipage ${equipageId}`, (async () => {
    const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/equipages/${equipageId}`);
    await runTransaction(db, async (transaction) => {
      const fresh = await transaction.get(ref);
      if (!fresh.exists()) throw new Error("Equipage does not exist!");
      transaction.update(ref, data);
    });
  })());
}

export async function saveEquipage(competitionId, startNumber, equipageData) {
  return trackWrite(`Sparar ekipage #${startNumber}`, (async () => {
    const equipageRef = getCompDocRef(competitionId, 'equipages', startNumber.toString());
    await runTransaction(db, async (transaction) => {
      // eslint-disable-next-line no-unused-vars
      const _ignored = await transaction.get(equipageRef);
      transaction.set(equipageRef, equipageData, { merge: true });
    });
  })());
}
/**
 * Raderar ett specifikt ekipage från en tävling.
 * @param {string} competitionId - ID för tävlingen.
 * @param {string} equipageId - ID för ekipaget som ska raderas.
 */
export async function deleteEquipage(competitionId, equipageId) {
  if (!competitionId || !equipageId) {
    throw new Error("Competition ID och Equipage ID krävs för att kunna radera.");
  }
  return trackWrite(`Raderar ekipage ${equipageId}`, (async () => {
    // VIKTIGT: använd samma baspath som övrigt (helpers)
    const equipageRef = getCompDocRef(competitionId, 'equipages', String(equipageId));
    await deleteDoc(equipageRef);
  })());
}

export async function clearAllEquipages(competitionId) {
  return trackWrite(`Rensar alla ekipage`, (async () => {
    const colRef = getCompCollectionRef(competitionId, 'equipages');
    const snap = await getDocs(colRef);
    if (snap.empty) return 0;

    // batch-radering
    const { writeBatch } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  })());
}

// =================================================================
// ADMIN- & KONFIGURATIONSFUNKTIONER
// =================================================================
// Cache-konstanter
const CONFIG_CACHE_PREFIX = 'configCache:';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme

export async function getConfig(competitionId, configName, forceRefresh = false) {
  if (!competitionId || !configName) return {};

  const cacheKey = `${CONFIG_CACHE_PREFIX}${competitionId}:${configName}`;

  // 1. Försök läsa från cache om vi inte tvingar refresh
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

  // 2. Hämta från Firestore
  const configRef = getCompDocRef(competitionId, 'config', configName);
  const docSnap = await getDoc(configRef);
  const data = docSnap.exists() ? docSnap.data() : {};

  // 3. Spara till cache
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) {
    // Förmodligen QuotaExceeded om localStorage är full
    console.warn('Could not cache config', e);
  }

  return data;
}
export async function saveConfig(competitionId, configName, data) {
  return trackWrite(`Sparar config ${configName}`, (async () => {
    const configRef = getCompDocRef(competitionId, 'config', configName);
    await setDoc(configRef, data, { merge: true });

    // Invalidate cache so next read fetches fresh data
    try {
      const cacheKey = `${CONFIG_CACHE_PREFIX}${competitionId}:${configName}`;
      localStorage.removeItem(cacheKey);
    } catch (e) { /* ignore */ }
  })());
}

export function listenForConfig(competitionId, configName, callback) {
  if (!competitionId || !configName) return () => { };
  const configRef = getCompDocRef(competitionId, 'config', configName);
  return onSnapshot(configRef, (docSnap) => {
    callback(docSnap.exists() ? docSnap.data() : {});
  });
}

// --- Funktionärer & Domare ---
export function listenForJudges(competitionId, callback) {
  const judgesRef = getCompCollectionRef(competitionId, 'judges');
  return onSnapshot(query(judgesRef), (snapshot) => {
    callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  });
}
export async function saveJudge(competitionId, judgeId, data) {
  return trackWrite(`Sparar domare ${data.name || judgeId}`, (async () => {
    const judgeRef = getCompDocRef(competitionId, 'judges', judgeId);
    await setDoc(judgeRef, data);
  })());
}
/**
 * Tar bort en specifik domare.
 * @param {string} competitionId - Tävlingens ID.
 * @param {string} judgeId - ID på domaren som ska tas bort.
 */
export async function deleteJudge(competitionId, judgeId) {
  return trackWrite(`Tar bort domare ${judgeId}`, (async () => {
    const judgeRef = getCompDocRef(competitionId, 'judges', judgeId);
    await deleteDoc(judgeRef);
  })());
}
/**
 * Sätter upp en realtids-lyssnare för FUNKTIONÄRS-LISTAN.
 * Läser nu från en collection istället för ett enskilt dokument.
 */
export function listenForOfficials(competitionId, callback) {
  const officialsRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/officials`);
  return onSnapshot(query(officialsRef), (snapshot) => {
    const officials = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(officials);
  });
}

// NYTT: Engångshämtning av officials
export async function getOfficials(competitionId) {
  const officialsRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/officials`);
  const snapshot = await getDocs(query(officialsRef));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// NYTT: Engångshämtning av judges (legacy collection men används av dressyr)
export async function getJudges(competitionId) {
  const judgesRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/judges`);
  const snapshot = await getDocs(query(judgesRef));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Sparar en NY funktionär i listan med ett auto-genererat ID.
 */
export async function saveOfficial(competitionId, data) {
  return trackWrite(`Sparar funktionär ${data.name}`, (async () => {
    const officialsRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/officials`);
    await addDoc(officialsRef, data);
  })());
}

/**
 * Tar bort en specifik funktionär.
 * @param {string} competitionId - Tävlingens ID.
 * @param {string} officialId - ID på funktionären som ska tas bort.
 */
export async function deleteOfficial(competitionId, officialId) {
  return trackWrite(`Tar bort funktionär ${officialId}`, (async () => {
    const officialRef = getCompDocRef(competitionId, 'officials', officialId);
    await deleteDoc(officialRef);
  })());
}

// --- Maratonhinder ---
export function listenForMarathonObstacles(competitionId, callback) {
  const obstaclesRef = getCompCollectionRef(competitionId, 'maratonObstacles');
  return onSnapshot(query(obstaclesRef), (snapshot) => {
    callback(snapshot.docs.map(d => d.data()).sort((a, b) => a.number - b.number));
  });
}
export async function saveMarathonObstacle(competitionId, number, data) {
  return trackWrite(`Sparar maratonhinder ${number}`, (async () => {
    const obstacleRef = getCompDocRef(competitionId, 'maratonObstacles', number.toString());
    await setDoc(obstacleRef, data);
  })());
}
/**
 * Tar bort ett specifikt maratonhinder från en tävling.
 * @param {string} competitionId - ID för tävlingen.
 * @param {number|string} obstacleNumber - Numret på hindret som ska raderas.
 */
export async function deleteMarathonObstacle(competitionId, obstacleNumber) {
  if (!competitionId || obstacleNumber == null) {
    throw new Error("Competition ID och hindernummer krävs för att kunna radera.");
  }
  return trackWrite(`Tar bort maratonhinder ${obstacleNumber}`, (async () => {
    const obstacleRef = getCompDocRef(competitionId, 'maratonObstacles', String(obstacleNumber));
    await deleteDoc(obstacleRef);
  })());
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

  const safePayload = {
    testKey: data?.testKey || data?.programKey || data?.testId || "",
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
  });
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
export async function getMarathonResults(competitionId) {
  if (!competitionId) throw new Error("getMarathonResults: competitionId saknas");

  // /maratonResults/{equipageId}/obstacles/{obstacleNumber}
  const baseCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maratonResults`);

  const equipageDocs = await getDocs(baseCol);
  const out = [];

  for (const d of equipageDocs.docs) {
    const equipageId = d.id; // startNumber som sträng
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

  // Modern structure format:
  // Note: seed_test passes 'timeSeconds', but the function previously expected 'data.timeInSeconds'. We support both.
  const timeInSec = Number(data?.timeInSeconds || data?.timeSeconds || 0);
  
  const resultData = {
    number: on,
    timeInSeconds: timeInSec,
    timeSeconds: timeInSec, // Added for compatibility with core engine marathon.js
    timeMs: timeInSec * 1000,
    timePenalty: 0, // Ignored by calculation engine anyway since it recalculates it
    knockdowns: 0, 
    knockdownPenalty: 0, 
    otherPenalty: Number(data?.penalty || 0),
    penalty: 0, // recalculated
    comment: data?.comment || '', 
    eliminated: !!data?.eliminated,
    routeString: data?.routeString || '',
    gateSplits: data?.gateSplits || [],
    enteredAt: new Date().toISOString()
  };

  const summaryDocRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`, eid);

  return trackWrite(`Sparar hinderresultat #${eid} Hinder ${on}`, (async () => {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(summaryDocRef);
      const existingData = snap.exists() ? snap.data() : {};
      const obstacles = (existingData.obstacles || []).filter(o => o.number !== on);
      obstacles.push(resultData);
      obstacles.sort((a, b) => a.number - b.number);

      transaction.set(summaryDocRef, {
        ...existingData,
        obstacles,
        updatedAt: serverTimestamp()
      }, { merge: true });
    });
    return { ok: true, path: summaryDocRef.path };
  })());
}

// (Removed redundant getMarathonTimingData - moved/unified above)

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

export async function saveMarathonTimingData(competitionId, equipageId, data) {
  if (!competitionId) throw new Error("saveMarathonTimingData: competitionId saknas");
  if (equipageId == null) throw new Error("saveMarathonTimingData: equipageId saknas");

  const id = String(equipageId).trim();

  // hjälp: rensa bort undefined/NaN (Firestore ogillar det)
  const clean = (obj) => {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v === undefined) return;
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      out[k] = v;
    });
    return out;
  };

  // vi accepterar Date/sträng/Timestamp – frontend kan formatera dessa
  const payload = clean({
    startNumber: Number(id) || null,
    className: data?.className ?? data?.klass ?? null,

    // tider (kan vara Date, Firestore Timestamp eller "YYYY-MM-DDTHH:mm" / "HH:mm")
    start_A: data?.start_A ?? data?.startA ?? null,
    finish_A: data?.finish_A ?? data?.finishA ?? null,
    start_B: data?.start_B ?? data?.startB ?? null,
    finish_B: data?.finish_B ?? data?.finishB ?? null,

    // varaktigheter i SEKUNDER om du skickar in dem – skrivs som nummer
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

export function listenForPrecisionResults(competitionId, callback) {
  if (!competitionId) throw new Error("listenForPrecisionResults: competitionId saknas");
  const colRef = getCompCollectionRef(competitionId, 'precision');
  const qRef = query(colRef);

  return onSnapshot(qRef, (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })); // <— FIX
    try { callback(rows); } catch (e) { console.error("listenForPrecisionResults callback error:", e); }
  });
}

export async function getPrecisionResults(competitionId) {
  if (!competitionId) return [];
  const colRef = getCompCollectionRef(competitionId, 'precision');
  const snap = await getDocs(colRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}



// --- PRECISION: spara (live/final) resultat för ett ekipage ---
export async function savePrecisionResult(competitionId, equipageId, data) {
  if (!competitionId) throw new Error('savePrecisionResult: competitionId saknas');
  if (equipageId == null) throw new Error('savePrecisionResult: equipageId saknas');

  const sn = String(equipageId).trim();
  const ref = doc(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/precision/${sn}`
  );

  // Normalisera/typsäkra – fälten används både av input och resultatvyn
  const payload = {
    startNumber: Number(equipageId),
    className: data?.className ?? data?.klass ?? null,
    driverName: data?.driverName ?? data?.driver ?? data?.kusk ?? null,

    // Portbredd / vagnbredd om ni skickar in det
    trackWidthCm: Number.isFinite(data?.trackWidthCm)
      ? data.trackWidthCm
      : (Number(data?.trackWidth) || null),

    // Resultatdelar
    knocks: Number(data?.knocks ?? data?.cones ?? 0),
    timeMs: Number(data?.timeMs ?? data?.ms ?? 0),
    overLimitPenalty: Number(data?.overLimitPenalty ?? data?.timePenalty ?? 0),
    penaltyOther: Number(data?.penaltyOther ?? data?.extraPenalty ?? 0),

    eliminated: !!data?.eliminated,
    disqualified: !!data?.disqualified,

    // Statusflaggor (vyn visar "Pågår" om running = true, "Klar" om finalized = true)
    running: !!data?.running,
    finalized: !!data?.finalized,

    comment: data?.comment ?? '',
    updatedAt: serverTimestamp(),
  };

  return trackWrite(`Sparar precisionsresultat #${equipageId}`, (async () => {
    await runTransaction(db, async (transaction) => {
      // eslint-disable-next-line no-unused-vars
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

/**
 * Realtids-lyssnare på alla dokument under:
 * artifacts/{appId}/public/data/competitions/{competitionId}/dressage/{startNumber}/protocols/*
 * Returnerar en unsubscribe-funktion precis som övriga lyssnare.
 */
export function listenForDressageProtocols(competitionId, startNumber, callback) {
  if (!competitionId) throw new Error("listenForDressageProtocols: competitionId saknas");
  if (startNumber == null) throw new Error("listenForDressageProtocols: startNumber saknas");

  const sn = String(startNumber).trim();
  const colRef = collection(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`
  );

  return onSnapshot(query(colRef), (snapshot) => {
    // UPDATED: use normalization
    const docs = snapshot.docs.map(d => asPlainDressageProtocol(d.data(), d.id, startNumber));
    callback(docs);
  });
}

/**
 * Felsökning: lista dokument-ID:n i protocols för att se vad som faktiskt finns sparat.
 * Använd i dev-konsolen:
 *   debugListDressageDocIds("compId", 1).then(console.log)
 */
export async function debugListDressageDocIds(competitionId, startNumber) {
  const docs = await getDressageResultsForEquipage(competitionId, startNumber);
  return (Array.isArray(docs) ? docs : []).map(d => d.id);
}

/**
 * HÄMTAR TIMING-DATA (STANDARD)
 * Returnerar Map<startNumber, data>
 */
export async function getMarathonTimingData(competitionId) {
  if (!competitionId) return new Map();
  try {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton-timing`);
    const snap = await getDocs(colRef);
    const map = new Map();
    snap.forEach(d => map.set(String(d.id), d.data() || {}));
    return map;
  } catch (e) {
    console.warn('Error fetching marathon timing:', e);
    return new Map();
  }
}

/**
 * HÄMTAR MARATON-DOKUMENT (MANUELLA TIDER OSV)
 * Returnerar Map<startNumber, data>
 */
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

// Realtidslyssnare för maraton-tidtagning (samling: /maraton-timing)
// Realtidslyssnare för maraton-tidtagning (samling: /maraton-timing)
export function listenForMarathonTimingUpdates(competitionId, callback) {
  if (!competitionId) throw new Error("listenForMarathonTimingUpdates: competitionId saknas");

  const colRef = collection(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/maraton-timing`
  );

  const qRef = query(colRef /*, orderBy('startNumber', 'asc') */);

  return onSnapshot(
    qRef,
    (snap) => {
      // Returnera docs array för lyssnare, de kan hantera det
      try { callback(snap.docs); } catch (e) { console.error("listenForMarathonTimingUpdates callback error:", e); }
    },
    (err) => {
      console.error("listenForMarathonTimingUpdates error:", err);
      try { callback([]); } catch (_) { }
    }
  );
}

export function listenForMaratonCollection(competitionId, callback) {
  if (!competitionId) throw new Error("listenForMaratonCollection: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
  return onSnapshot(query(colRef), (snapshot) => {
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(docs);
  });
}

export function listenForDressageFinalizationCollection(competitionId, callback) {
  if (!competitionId) throw new Error("listenForDressageFinalizationCollection: competitionId saknas");
  const colRef = collection(db, `competitions/${competitionId}/dressageFinalization`);
  return onSnapshot(query(colRef), (snapshot) => {
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(docs);
  });
}

/**
 * Lyssnar på det faktiska LIVE-dokumentet per ekipage (används av maraton-input).
 * Path: competitions/{id}/maraton/{startNumber} (fält: obstacles: [])
 */
export function listenForMarathonResult(competitionId, equipageId, callback) {
  if (!competitionId || !equipageId) return () => { };
  const sn = String(equipageId).trim();

  // OBS: maraton-input skriver till 'maraton' (inte 'maratonResults') och använder startNumber som ID.
  const docRef = doc(
    db,
    `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`,
    sn
  );
  return onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      // Returnera obstacles-arrayen
      callback(docSnap.data().obstacles || []);
    } else {
      callback([]);
    }
  });
}

export async function getComputedResultForEquipage(competitionId, startNumber) {
  if (!competitionId || !startNumber) return null;
  const sn = String(startNumber).trim();
  const ref = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/computed_equipages/${sn}`);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}


// =================================================================
// MESSAGING & DOCUMENTS
// =================================================================

export async function getCompetitionMessages(competitionId) {
  if (!competitionId) return [];
  try {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/messages`);
    const q = query(colRef, orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Could not fetch messages:', err);
    return [];
  }
}

export function listenForCompetitionMessages(competitionId, callback) {
  const col = getCompCollectionRef(competitionId, 'messages');
  return onSnapshot(query(col, orderBy('timestamp', 'desc')), (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(msgs);
  });
}

export async function saveCompetitionMessage(competitionId, msgData) {
  if (!competitionId) throw new Error("Missing competitionId");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/messages`);
  const payload = {
    ...msgData,
    timestamp: serverTimestamp()
  };
  await addDoc(colRef, payload);
}

export async function deleteCompetitionMessage(competitionId, messageId) {
  if (!competitionId || !messageId) throw new Error("Missing params");
  const docRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/messages`, messageId);
  await deleteDoc(docRef);
}

// --- Documents ---

export async function getCompetitionDocuments(competitionId) {
  if (!competitionId) return [];
  try {
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/documents`);
    const q = query(colRef, orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Could not fetch documents:', err);
    return [];
  }
}

export async function saveCompetitionDocument(competitionId, docData) {
  if (!competitionId) throw new Error("Missing competitionId");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/documents`);

  // docData should contain: title, category, type ('url' | 'html' | 'file'?), content
  const payload = {
    ...docData,
    timestamp: serverTimestamp()
  };
  await addDoc(colRef, payload);
}

export async function deleteCompetitionDocument(competitionId, docId) {
  if (!competitionId || !docId) throw new Error("Missing params");
  const docRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/documents`, docId);
  await deleteDoc(docRef);
}

// --- Dressage Collection Listeners ---

// === Normalization Helper (Single Source of Truth) ===
function normJudgeId(id) {
  return String(id || '').replace(/^judge_/i, '');
}

function asPlainDressageProtocol(data, docId, fallbackStartNumber) {
  // 1. Determine startNumber (prioritize data, then fallback)
  let sn = Number(data.startNumber ?? data.startNo ?? data.sn ?? fallbackStartNumber);

  // 2. Determine judgeId (prioritize data.judgeId, then jid, then docId)
  // Clean up 'judge_' prefix from whatever source we pick
  const rawJid = data.judgeId || data.jid || docId;
  const jID = normJudgeId(rawJid);

  const plain = {
    ...data,
    id: docId,
    startNumber: Number.isFinite(sn) ? sn : null,
    judgeId: jID,
    // Ensure we don't have conflicting fields
    jid: jID
  };

  return plain;
}

/**
 * Lyssnar på HELA dressageStatus-kollektionen för en tävling.
 * Ersätter N separata lyssnare i resultatlistor och monitorer.
 */
export function listenForDressageStatusCollection(competitionId, callback) {
  if (!competitionId) throw new Error("listenForDressageStatusCollection: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`);
  return onSnapshot(query(colRef), (snapshot) => {
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(docs);
  });
}

export async function getDressageStatusCollection(competitionId) {
  if (!competitionId) throw new Error("getDressageStatusCollection: competitionId saknas");
  const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`);
  const snap = await getDocs(colRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lyssnar på ALLA live-dokument i en tävlings dressyrstatus via Collection Group.
 * Används för att optimera dressyr-monitorn.
 */
// --- FAKE COLLECTION GROUP LISTENERS (Workaround for Security Rules) ---

/**
 * Ersätter collectionGroup('live') genom att lyssna på status-kollektionen
 * och därefter lyssna på 'live' för VARJE aktivt ekipage.
 * Detta simulerar en collectionGroup-query utan att bryta mot säkerhetsreglerna.
 */
export function listenForDressageLiveGroup(competitionId, equipagesOrStartNumbers, callback) {
  if (!competitionId) throw new Error("listenForDressageLiveGroup: competitionId saknas");

  let activeUnsubs = new Map(); // sn -> unsubscribe
  let currentDocsMap = new Map(); // id -> docData

  // Intern städning
  const cleanup = () => {
    activeUnsubs.forEach(unsub => unsub && unsub());
    activeUnsubs.clear();
  };

  const presentStartNumbers = new Set();
  const snList = (Array.isArray(equipagesOrStartNumbers) ? equipagesOrStartNumbers : [])
    .map(e => (typeof e === 'object' ? e.startNumber : e))
    .filter(n => n != null)
    .map(String);

  snList.forEach(sn => {
    presentStartNumbers.add(sn);
    // Om vi inte redan lyssnar på live för detta ekipage, gör det nu
    if (!activeUnsubs.has(sn)) {
      const liveRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${sn}/live`);

      // Lyssna på live-kollektionen för detta ekipage (oftast bara 1 dok)
      const unsub = onSnapshot(liveRef, (snap) => {
        snap.docChanges().forEach(change => {
          const data = change.doc.data();
          const docId = change.doc.id;
          const compositeKey = `${sn}_${docId}`;
          if (change.type === 'removed') {
            currentDocsMap.delete(compositeKey);
          } else {
            // UPDATED: use normalization
            const plain = asPlainDressageProtocol(change.doc.data(), docId, sn);
            currentDocsMap.set(compositeKey, plain);
          }
        });
        // Skicka uppdaterad lista
        callback(Array.from(currentDocsMap.values()));
      });
      activeUnsubs.set(sn, unsub);
    }
  });

  // Vi behöver inte lyssna på status-kollektionen längre för discovery,
  // men om vi vill ha status, kan vi göra det separat.
  // Den här funktionen ska bara leverera LIVE-protokoll.

  // Returnera en funktion som stänger ALLT
  return () => {
    cleanup();
  };
}

/**
 * Samma strategi för protocols. Ersätter collectionGroup('protocols').
 * Lyssnar endast på protokoll för ekipage som faktiskt finns i dressageStatus.
 */
export function listenForDressageProtocolsCollectionGroup(competitionId, equipagesOrStartNumbers, callback) {
  if (!competitionId) throw new Error("listenForDressageProtocolsCollectionGroup: competitionId saknas");

  let activeUnsubs = new Map(); // sn -> unsubscribe
  let currentDocsMap = new Map(); // id -> docData

  const cleanup = () => {
    activeUnsubs.forEach(unsub => unsub && unsub());
    activeUnsubs.clear();
  };

  const snList = (Array.isArray(equipagesOrStartNumbers) ? equipagesOrStartNumbers : [])
    .map(e => (typeof e === 'object' ? e.startNumber : e))
    .filter(n => n != null)
    .map(String);

  snList.forEach(sn => {
    if (!activeUnsubs.has(sn)) {
      // CORRECTION: Saved protocols are in 'dressage', not 'dressageStatus'
      const protoRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${sn}/protocols`);
      const unsub = onSnapshot(protoRef, (snap) => {
        snap.docChanges().forEach(change => {
          const docId = change.doc.id;
          const compositeKey = `${sn}_${docId}`;
          if (change.type === 'removed') {
            currentDocsMap.delete(compositeKey);
          } else {
            // UPDATED: use normalization
            const plain = asPlainDressageProtocol(change.doc.data(), docId, sn);
            currentDocsMap.set(compositeKey, plain);
          }
        });
        callback(Array.from(currentDocsMap.values()));
      });
      activeUnsubs.set(sn, unsub);
    }
  });

  return () => {
    cleanup();
  };
  return () => {
    cleanup();
  };
}

export async function getAllDressageProtocols(competitionId, equipages) {
  if (!competitionId) throw new Error("getAllDressageProtocols: competitionId saknas");

  const snList = (Array.isArray(equipages) ? equipages : [])
    .map(e => e.startNumber)
    .filter(n => n != null);

  // Use a Map to store results: startNumber (string) -> protocols[]
  const results = new Map();

  // Fetch in parallel (could be throttled if >100, but usually fine)
  const promises = snList.map(async (sn) => {
    const snStr = String(sn);
    const colRef = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage/${snStr}/protocols`);
    const snap = await getDocs(colRef);

    const protos = snap.docs.map(d => asPlainDressageProtocol(d.data(), d.id, sn));
    if (protos.length > 0) {
      results.set(snStr, protos);
    }
  });

  await Promise.all(promises);
  return results;
}

// =================================================================
// DELETION LOGIC (DANGER ZONE)
// =================================================================

/**
 * Raderar en hel tävling rekursivt (inklusive underkollektioner).
 * Detta är en destruktiv operation och bör bekräftas noga!
 * 
 * @param {string} competitionId 
 */
export async function deleteCompetition(competitionId) {
  if (!competitionId) throw new Error("deleteCompetition: competitionId saknas");


  // Helper för att radera i batchar
  const deleteQueryBatch = async (queryRef) => {
    const snapshot = await getDocs(queryRef);
    if (snapshot.empty) return 0;

    // Använd writeBatch från import
    const batch = writeBatch(db);
    snapshot.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snapshot.size;
  };

  // 1. Enkla underkollektioner (platta)
  const simpleCollections = [
    'equipages',
    'judges',
    'officials',
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

  // 2. Nestade kollektioner: Maratonresultat
  // maratonResults/{sn}/obstacles
  const marResCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maratonResults`);
  const marResSnap = await getDocs(marResCol);
  for (const d of marResSnap.docs) {
    const obsCol = collection(db, `${marResCol.path}/${d.id}/obstacles`);
    await deleteQueryBatch(query(obsCol)); // Radera obstacles
    await deleteDoc(d.ref); // Radera själva resultatdokumentet
  }

  // 3. Nestade kollektioner: Dressyrprotokoll
  // dressage/{sn}/protocols
  const dressCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressage`);
  const dressSnap = await getDocs(dressCol);
  for (const d of dressSnap.docs) {
    const protCol = collection(db, `${dressCol.path}/${d.id}/protocols`);
    await deleteQueryBatch(query(protCol));
    await deleteDoc(d.ref);
  }

  // 4. Nestade kollektioner: Legacy Dressyrresultat
  // dressageResults/{sn}/protocols
  const dressResCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageResults`);
  const dressResSnap = await getDocs(dressResCol);
  for (const d of dressResSnap.docs) {
    const protCol = collection(db, `${dressResCol.path}/${d.id}/protocols`);
    await deleteQueryBatch(query(protCol));
    await deleteDoc(d.ref);
  }

  // 5. Maraton input (live-dokument) - en kollektion av dokument med obstacles-array
  const marLiveCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton`);
  await deleteQueryBatch(query(marLiveCol));

  // 6. Till sist: Radera själva tävlingsdokumentet
  const compRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}`);
  await deleteDoc(compRef);

}


export async function getCompetitionStatistics(competitionId) {
  if (!competitionId) return { dressage: 0, marathon: 0, precision: 0 };

  // 1. DRESSYR: Hitta alla som har någon status (ej strikt 'finished'), kolla sedan 'finalization' sub-doc
  let dressagePending = 0;
  try {
    const statusCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus`);
    const statusSnap = await getDocs(statusCol);

    const checks = statusSnap.docs.map(async (d) => {
      const sn = d.id;
      const data = d.data();

      // Ignorera de som är helt nya/ospårade (state='upcoming' och ingen starttid/domare)
      if (data.state === 'upcoming' && !data.startedAt && !data.judgeId) return 0;

      const metaRef = doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/dressageStatus/${sn}/meta/finalization`);
      const metaSnap = await getDoc(metaRef);
      const isFinal = metaSnap.exists() && metaSnap.data().finalized === true;
      return isFinal ? 0 : 1;
    });

    const results = await Promise.all(checks);
    dressagePending = results.reduce((a, b) => a + b, 0);

  } catch (e) {
    console.warn('Error fetching dressage stats:', e);
  }

  // 2. MARATON: Kolla 'maraton-timing' collection
  let marathonPending = 0;
  try {
    const marCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/maraton-timing`);
    const marSnap = await getDocs(marCol);
    marSnap.forEach(d => {
      const data = d.data();
      // Om de har data som tyder på att de startat/är klara
      const hasData = data.currentPhase || data.startTime || (data.times && Object.keys(data.times).length > 0) || data.totalPenalty || data.status === 'finished';
      if (hasData && !data.finalized) {
        marathonPending++;
      }
    });
  } catch (e) { console.warn('Error fetching marathon stats:', e); }

  // 3. PRECISION: Kolla 'precision' collection
  let precisionPending = 0;
  try {
    const precCol = collection(db, `artifacts/${appId}/public/data/competitions/${competitionId}/precision`);
    const precSnap = await getDocs(precCol);
    precSnap.forEach(d => {
      const data = d.data();
      // Om de har data
      const hasData = data.running || data.timeMs || data.knocks || data.eliminated || data.status === 'finished';
      if (hasData && !data.finalized) {
        precisionPending++;
      }
    });
  } catch (e) { console.warn('Error fetching precision stats:', e); }

  return {
    dressage: dressagePending,
    marathon: marathonPending,
    precision: precisionPending
  };
}

// =================================================================
// LAGTÄVLING (TEAMS)
// =================================================================
export function listenForTeams(competitionId, callback) {
  const teamsRef = getCompCollectionRef(competitionId, 'teams');
  return onSnapshot(query(teamsRef), (snapshot) => {
    const teams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(teams);
  });
}

export async function getTeams(competitionId) {
  const teamsRef = getCompCollectionRef(competitionId, 'teams');
  const snapshot = await getDocs(query(teamsRef));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function saveTeam(competitionId, teamData) {
  // Om ID saknas, skapa nytt (addDoc), annars spara (setDoc)
  const isNew = !teamData.id;
  const description = isNew ? `Skapar lag ${teamData.name}` : `Sparar lag ${teamData.name}`;

  return trackWrite(description, (async () => {
    if (isNew) {
      const colRef = getCompCollectionRef(competitionId, 'teams');
      await addDoc(colRef, teamData);
    } else {
      const docRef = getCompDocRef(competitionId, 'teams', teamData.id);
      await setDoc(docRef, teamData, { merge: true });
    }
  })());
}

export async function deleteTeam(competitionId, teamId) {
  return trackWrite(`Tar bort lag ${teamId}`, (async () => {
    const docRef = getCompDocRef(competitionId, 'teams', teamId);
    await deleteDoc(docRef);
  })());
}

export function listenForMarathonConfig(competitionId, callback) {
  const docRef = getCompDocRef(competitionId, 'config', 'maratonConfig');
  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data());
    }
  });
}

// =================================================================
// MULTI-TENANT & RBAC (PIN-CODE ADMINS)
// =================================================================

export async function getSecretConfig(competitionId) {
  if (!competitionId) return null;
  try {
    const docRef = getCompDocRef(competitionId, 'config', 'secrets');
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('getSecretConfig failed:', e);
    return null;
  }
}

export async function saveSecretConfig(competitionId, data) {
  if (!competitionId) return;
  const docRef = getCompDocRef(competitionId, 'config', 'secrets');
  await setDoc(docRef, data, { merge: true });
}

export async function joinCompetitionAsAdmin(competitionId, pinCode, user) {
  if (!competitionId || !pinCode || !user) throw new Error("Missing parameters for joinCompetitionAsAdmin");
  
  // Vi sparar PIN-koden till admins/{uid}. Reglerna i Firestore tillåter detta 
  // ENDAST om pinCode stämmer överens med den hemliga koden.
  const docRef = getCompDocRef(competitionId, 'admins', user.uid);
  const rolesToTry = ['admin', 'dressage', 'marathon', 'precision', 'speaker'];
  let successfulRole = null;

  // Hämta befintliga roller för att inte skriva över
  let existingRoles = [];
  try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.roles)) existingRoles = data.roles;
          else if (data.role) existingRoles = [data.role];
      }
  } catch (e) {}

  for (const role of rolesToTry) {
    try {
      const newRoles = [...new Set([...existingRoles, role])];
      await setDoc(docRef, {
        accessCode: pinCode,
        email: user.email,
        joinedAt: Date.now(),
        roles: newRoles,
        role: role // Viktigt: Sätt till den Nya rollen så att Firestore-reglerna kan verifiera PIN-koden mot just denna roll!
      }, { merge: true });
      successfulRole = role;
      break; // Success! We found the matching role.
    } catch (e) {
      // Failed (permission denied because PIN doesn't match this role). Try next.
    }
  }

  if (!successfulRole) {
    throw new Error("Kunde inte ansluta. Kontrollera att PIN-koden är korrekt.");
  }

  try {
    // Uppgradera användarens roll till funktionär så att UI/Navigations-menyerna låses upp
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists() || userSnap.data().role === 'publik' || !userSnap.data().role) {
      await setDoc(userRef, { role: 'funktionar' }, { merge: true });
    }
  } catch (e) {
    console.warn("Kunde inte uppgradera global roll", e);
  }

  return successfulRole;
}

export function listenForCompetitionAdmins(competitionId, callback) {
  if (!competitionId) return () => {};
  const colRef = getCompCollectionRef(competitionId, 'admins');
  return onSnapshot(query(colRef), (snap) => {
    const admins = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    callback(admins);
  }, (err) => {
    console.warn("Could not listen for admins (not authorized or other error):", err);
    callback([]);
  });
}

export async function deleteCompetitionAdmin(competitionId, uid) {
  if (!competitionId || !uid) return;
  const docRef = getCompDocRef(competitionId, 'admins', uid);
  await deleteDoc(docRef);
}
