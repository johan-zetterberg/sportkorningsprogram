// js/services/aggregateService.js
import { db, appId } from '../config/firebase-config.js';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// ✔️ Läs färdigräknade rader: artifacts/{appId}/public/data/competitions/{competitionId}/computed_equipages
export function listenForComputedEquipageResults(competitionId, cb) {
  const colRef = collection(
    db, 'artifacts', appId, 'public', 'data',
    'competitions', competitionId, 'computed_equipages'
  );
  return onSnapshot(colRef, snap => {
    const map = new Map();
    snap.forEach(d => map.set(String(d.id), d.data()));
    cb(map);
  });
}

// ✔️ Spara/merga en färdigräknad rad
export async function saveComputedEquipageResult(competitionId, startNumber, partial) {
  // bygg dokumentreferensen
  const ref = doc(
    db,
    'artifacts', appId, 'public', 'data',
    'competitions', competitionId, 'computed_equipages',
    String(startNumber)
  );

  // sprid partial korrekt (OBS: ...partial, inte .partial)
  const updatedAt =
    (typeof serverTimestamp === 'function') ? serverTimestamp() : new Date().toISOString();

  const payload = { version: 1, updatedAt, ...partial };

  await setDoc(ref, payload, { merge: true });
}

