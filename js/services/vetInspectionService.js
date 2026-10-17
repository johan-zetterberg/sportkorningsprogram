import { getDoc, onSnapshot, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getCompCollectionRef, getCompDocRef } from './firestoreService.js';
import { buildSnapshotErrorHandler } from './listenerErrorUtils.js';
import { awaitWriteOrQueue } from '../utils/offlineWrite.js';

// The vet's clinical findings (pulse, respiration, mucosa, bit/harness checks)
// are health data: they live in vetInspections/{startNumber} (same id as the
// equipage), readable by the vet, admins and the driver, writable by the vet
// and admins (firestore.rules). The public equipage only has each phase's
// result (vetInspection_<phase>, see vetCheckUtils).
// The vet's free-text notes are in vetNotes/{startNumber}: vet and admins only.
const INSPECTIONS = 'vetInspections';
const NOTES = 'vetNotes';

function docRef(competitionId, collectionName, startNumber) {
    return getCompDocRef(competitionId, collectionName, String(startNumber).trim());
}

/** All clinical findings of the competition by start number ({ [horseKey]: { [phase]: findings } }). Returns the unsubscribe. */
export function listenForVetInspections(competitionId, callback) {
    return onSnapshot(getCompCollectionRef(competitionId, INSPECTIONS), (snapshot) => {
        const byStartNumber = new Map();
        snapshot.docs.forEach(item => byStartNumber.set(String(item.id), item.data()?.horses || {}));
        callback(byStartNumber);
    }, buildSnapshotErrorHandler('listenForVetInspections', callback, new Map()));
}

/** One equipage's clinical findings (e.g. for its driver), {} when none */
export async function getVetInspection(competitionId, startNumber) {
    if (!competitionId || startNumber == null || startNumber === '') return {};
    const snap = await getDoc(docRef(competitionId, INSPECTIONS, startNumber));
    return (snap.exists() && snap.data()?.horses) || {};
}

/**
 * Saves clinical findings: `changes` is a list of { horseKey, phase, fields }.
 * A merge write sets only the fields given, so two vets saving different
 * horses do not overwrite each other, and it works offline (queued on the
 * device). Resolves 'saved' or 'queued'.
 */
export async function saveVetClinicalFindings(competitionId, startNumber, changes = []) {
    const list = changes.filter(change => change?.horseKey && change?.phase && change.fields && Object.keys(change.fields).length);
    if (!competitionId || !list.length) return 'saved';
    const checkedAt = new Date().toISOString();
    const horses = {};
    list.forEach(({ horseKey, phase, fields }) => {
        const key = String(horseKey);
        horses[key] ||= {};
        horses[key][phase] = { ...(horses[key][phase] || {}), ...fields, checkedAt };
    });
    return awaitWriteOrQueue(setDoc(docRef(competitionId, INSPECTIONS, startNumber), {
        horses,
        updatedAt: serverTimestamp()
    }, { merge: true }));
}

/** All vet notes by start number ({ [phase]: text }). Returns the unsubscribe. */
export function listenForVetNotes(competitionId, callback) {
    return onSnapshot(getCompCollectionRef(competitionId, NOTES), (snapshot) => {
        const byStartNumber = new Map();
        snapshot.docs.forEach(item => byStartNumber.set(String(item.id), item.data()?.notes || {}));
        callback(byStartNumber);
    }, buildSnapshotErrorHandler('listenForVetNotes', callback, new Map()));
}

/** Saves the vet's note for one phase. Resolves 'saved' or 'queued'. */
export async function saveVetNote(competitionId, startNumber, phase, text) {
    const note = String(text ?? '').slice(0, 4000);
    return awaitWriteOrQueue(setDoc(docRef(competitionId, NOTES, startNumber), {
        notes: { [phase]: note },
        updatedAt: serverTimestamp()
    }, { merge: true }));
}
