// The incident / protest / ground jury decision log, the secretariat's
// correction log (read only here) and the staff notifications, all in the
// competition's private tree (firestore.rules: incidents, auditLog,
// staffNotifications).
import { db, appId, auth } from '../config/firebase-config.js';
import {
    addDoc, collection, doc, getDocs, limit, onSnapshot, orderBy, query,
    serverTimestamp, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getGlobalState } from '../main.js';
import { trackWrite } from './firestoreService.js';
import { changedIncidentFields, nextIncidentNumber, validateIncidentEntry } from './incidentUtils.js';

const privateBase = (competitionId) => `artifacts/${appId}/private/data/competitions/${competitionId}`;
const incidentsRef = (competitionId) => collection(db, `${privateBase(competitionId)}/incidents`);
const auditRef = (competitionId) => collection(db, `${privateBase(competitionId)}/auditLog`);
const noticesRef = (competitionId) => collection(db, `${privateBase(competitionId)}/staffNotifications`);

function currentWriter() {
    const user = getGlobalState('currentUser') || {};
    return {
        uid: auth?.currentUser?.uid || user.uid || null,
        name: String(user.displayName || user.email || '').slice(0, 200)
    };
}

const withId = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/** Live list of the log's entries; onError gets permission and network errors */
export function listenForIncidents(competitionId, onData, onError) {
    if (!competitionId) return () => { };
    return onSnapshot(incidentsRef(competitionId), (snap) => onData(withId(snap)), (error) => {
        console.warn('Händelseloggen kunde inte läsas:', error);
        onError?.(error);
    });
}

export async function getIncidents(competitionId) {
    if (!competitionId) return [];
    return withId(await getDocs(incidentsRef(competitionId)));
}

/** An id for an entry made later (the vet names it on the equipage first) */
export function newIncidentId(competitionId) {
    return doc(incidentsRef(competitionId)).id;
}

/**
 * A new entry from the form values (validateIncidentEntry). `existing`: the
 * entries already loaded, for the next number. The number is the device's
 * proposal: the server keeps it when it is the next free one and otherwise
 * renumbers the entry (functions/src/incidentNumbers.js, two devices or one
 * offline may pick the same number). Returns { id, number, write }
 * (write: the server's acknowledgement, pending while offline).
 * extra: fields checked by the caller (vetStrike, source); options.id: a
 * chosen document id (newIncidentId).
 */
export async function createIncident(competitionId, raw, existing = [], extra = {}, options = {}) {
    const { ok, errors, entry } = validateIncidentEntry(raw);
    if (!ok) {
        const error = new Error(errors[0]);
        error.validationErrors = errors;
        throw error;
    }
    const writer = currentWriter();
    const payload = {
        ...entry,
        ...extra,
        number: nextIncidentNumber(existing),
        createdBy: writer.uid,
        createdByName: writer.name,
        createdAt: serverTimestamp()
    };
    const ref = options.id ? doc(incidentsRef(competitionId), options.id) : doc(incidentsRef(competitionId));
    // Not awaited for the server offline: the entry is in the local cache at once
    const write = trackWrite(`Händelselogg nr ${payload.number}`, setDoc(ref, payload));
    return { id: ref.id, number: payload.number, write };
}

/**
 * Saves changed fields of an entry (status, decision ...) in the writer's
 * name. Only the fields that differ from `incident` (the caller's copy) are
 * written, so another official's change to other fields at the same time
 * stands. extra: written as given (dotted paths allowed).
 */
export function updateIncident(competitionId, incident, raw, extra = {}) {
    const { ok, errors, entry } = validateIncidentEntry({ ...incident, ...raw });
    if (!ok) {
        const error = new Error(errors[0]);
        error.validationErrors = errors;
        return Promise.reject(error);
    }
    const writer = currentWriter();
    return trackWrite(`Händelselogg nr ${incident.number}`, updateDoc(doc(incidentsRef(competitionId), incident.id), {
        ...changedIncidentFields(incident, entry),
        ...extra,
        updatedBy: writer.uid,
        updatedByName: writer.name,
        updatedAt: serverTimestamp()
    }));
}

/** The secretariat's corrections, newest first (admins and the TD, see the rules) */
export async function getCorrectionLog(competitionId, max = 500) {
    if (!competitionId) return [];
    const snap = await getDocs(query(auditRef(competitionId), orderBy('editedAt', 'desc'), limit(max)));
    return withId(snap);
}

// --- Staff notifications ---

/** Live list of the notifications, newest first */
export function listenForStaffNotices(competitionId, onData, onError) {
    if (!competitionId) return () => { };
    const q = query(noticesRef(competitionId), orderBy('createdAt', 'desc'), limit(200));
    return onSnapshot(q, (snap) => onData(withId(snap)), (error) => {
        console.warn('Notiserna kunde inte läsas:', error);
        onError?.(error);
    });
}

/** A notification from this device (vetStrike, vetDecision) */
export function addStaffNotice(competitionId, notice = {}) {
    const writer = currentWriter();
    return trackWrite('Notis till sekretariatet', addDoc(noticesRef(competitionId), {
        kind: notice.kind,
        startNumber: String(notice.startNumber ?? '').slice(0, 20),
        summary: String(notice.summary || '').slice(0, 500),
        ...(notice.phase ? { phase: String(notice.phase).slice(0, 40) } : {}),
        ...(notice.incidentId ? { incidentId: String(notice.incidentId).slice(0, 128) } : {}),
        createdAt: serverTimestamp(),
        createdBy: writer.uid,
        createdByName: writer.name
    }));
}

/** Marks a notification as seen by the signed-in official */
export function acknowledgeStaffNotice(competitionId, noticeId) {
    const writer = currentWriter();
    return trackWrite('Kvitterar notis', updateDoc(doc(noticesRef(competitionId), noticeId), {
        ackAt: serverTimestamp(),
        ackBy: writer.uid,
        ackByName: writer.name
    }));
}
