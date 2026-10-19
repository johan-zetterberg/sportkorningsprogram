import { db } from '../config/firebase-config.js';
import { deleteField, FieldPath, getDoc, onSnapshot, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';
import { awaitWriteOrQueue } from '../utils/offlineWrite.js';

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
export function listenForHorseTemperatures(competitionId, callback, onError = null) {
    return onSnapshot(getCompCollectionRef(competitionId, COLLECTION), (snapshot) => {
        const byStartNumber = new Map();
        snapshot.docs.forEach(item => byStartNumber.set(String(item.id), item.data()?.horseTemperatures || {}));
        callback(byStartNumber);
    }, buildSnapshotErrorHandler('listenForHorseTemperatures', callback, new Map(), onError));
}

/**
 * The merge write for `changes` (a list of { horseKey, slotId?, record },
 * record null removes it): { data, mergeFields }. Each change replaces exactly
 * its own field path, so values someone else saved in other slots stay, and
 * the document is created when it does not exist yet.
 */
export function buildHorseTemperatureWrite(changes = [], updatedAt = null) {
    const horseTemperatures = {};
    // Field paths as segment lists (a horse key may contain a dot)
    const mergeFields = [];
    const wholeKeys = new Set();
    changes.forEach(c => {
        if (!c || c.horseKey == null || c.horseKey === '') return;
        const key = String(c.horseKey);
        const value = c.record || deleteField();
        if (c.slotId != null) {
            // A whole horse key in the same write already covers the slot
            if (wholeKeys.has(key)) return;
            const slot = String(c.slotId);
            if (!horseTemperatures[key] || typeof horseTemperatures[key] !== 'object') horseTemperatures[key] = {};
            horseTemperatures[key][slot] = value;
            mergeFields.push(['horseTemperatures', key, slot]);
        } else {
            // The horse key replaces any slot of it given earlier in the list
            for (let i = mergeFields.length - 1; i >= 0; i--) {
                if (mergeFields[i][1] === key) mergeFields.splice(i, 1);
            }
            wholeKeys.add(key);
            horseTemperatures[key] = value;
            mergeFields.push(['horseTemperatures', key]);
        }
    });
    return { data: { horseTemperatures, updatedAt }, mergeFields };
}

/**
 * Writes single slots or whole horse keys (see buildHorseTemperatureWrite).
 * Works without signal: resolves 'saved' or 'queued' after a short wait, a
 * refusal after that goes to onLateError.
 */
export async function saveHorseTemperatureChanges(competitionId, startNumber, changes = [], { onLateError = null } = {}) {
    if (!changes.length) return 'saved';
    const ref = temperatureDocRef(competitionId, startNumber);
    const { data, mergeFields } = buildHorseTemperatureWrite(changes, serverTimestamp());
    if (!mergeFields.length) return 'saved';
    const paths = mergeFields.map(segments => new FieldPath(...segments));
    return awaitWriteOrQueue(
        setDoc(ref, data, { mergeFields: [...paths, 'updatedAt'] }),
        { onLateError }
    );
}