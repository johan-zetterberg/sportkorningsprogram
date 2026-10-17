import { db } from '../config/firebase-config.js';
import { deleteField, FieldPath, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';

// Horse temperatures are health data: they live in their own collection
// (horseTemperatures/{startNumber}, same id as the equipage), readable only by
// the driver, the competition's officials and admins (firestore.rules), not on
// the public equipage document.
const COLLECTION = 'horseTemperatures';

function temperatureDocRef(competitionId, startNumber) {
    return getCompDocRef(competitionId, COLLECTION, String(startNumber).trim());
}

/** The equipage's temperature map ({ [horseKey]: { [slotId]: record } }), {} when none. */
export async function getHorseTemperatures(competitionId, startNumber) {
    if (!competitionId || startNumber == null || startNumber === '') return {};
    const snap = await getDoc(temperatureDocRef(competitionId, startNumber));
    return (snap.exists() && snap.data()?.horseTemperatures) || {};
}

/**
 * All temperature maps of the competition by start number (officials and
 * admins only: a driver cannot list the collection). Returns the unsubscribe.
 */
export function listenForHorseTemperatures(competitionId, callback) {
    return onSnapshot(getCompCollectionRef(competitionId, COLLECTION), (snapshot) => {
        const byStartNumber = new Map();
        snapshot.docs.forEach(item => byStartNumber.set(String(item.id), item.data()?.horseTemperatures || {}));
        callback(byStartNumber);
    }, buildSnapshotErrorHandler('listenForHorseTemperatures', callback, new Map()));
}

/**
 * Writes single slots or whole horse keys: `changes` is a list of
 * { horseKey, slotId?, record } where record null removes it. Each goes by its
 * own field path, so values someone else saved in other slots stay.
 */
export async function saveHorseTemperatureChanges(competitionId, startNumber, changes = []) {
    if (!changes.length) return;
    const ref = temperatureDocRef(competitionId, startNumber);
    const pathArgs = [];
    changes.forEach(c => {
        const path = c.slotId != null
            ? new FieldPath('horseTemperatures', String(c.horseKey), String(c.slotId))
            : new FieldPath('horseTemperatures', String(c.horseKey));
        pathArgs.push(path, c.record || deleteField());
    });
    pathArgs.push('updatedAt', serverTimestamp());

    try {
        await updateDoc(ref, pathArgs[0], pathArgs[1], ...pathArgs.slice(2));
    } catch (error) {
        if (error?.code !== 'not-found') throw error;
        // First temperatures for the equipage: updateDoc needs an existing
        // document. Merge, in case another device created it meanwhile
        const horseTemperatures = {};
        changes.forEach(c => {
            if (!c.record) return; // nothing to remove yet
            const key = String(c.horseKey);
            if (c.slotId != null) {
                horseTemperatures[key] ||= {};
                horseTemperatures[key][String(c.slotId)] = c.record;
            } else {
                horseTemperatures[key] = c.record;
            }
        });
        await setDoc(ref, { horseTemperatures, updatedAt: serverTimestamp() }, { merge: true });
    }
}
