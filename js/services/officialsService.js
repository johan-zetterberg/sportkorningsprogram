import { db, appId } from '../config/firebase-config.js';
import {
    collection,
    doc,
    setDoc,
    deleteDoc,
    updateDoc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    listenForOfficials as listenForOfficialsCore,
    saveOfficial as saveOfficialCore,
    deleteOfficial as deleteOfficialCore
} from './adminService.js';

export { serverTimestamp };

const getBasePath = (compId) => `artifacts/${appId}/public/data/competitions/${compId}`;

// Legacy compatibility layer:
// officials CRUD now lives in adminService. This module still exports the same
// surface for pages that have not been migrated yet.

export function listenForOfficials(competitionId, callback) {
    if (!competitionId) return () => { };
    return listenForOfficialsCore(competitionId, callback);
}

export async function saveOfficial(competitionId, official) {
    return saveOfficialCore(competitionId, official);
}

export async function updateOfficialStatus(competitionId, officialId, updates) {
    if (!competitionId || !officialId) return;
    const ref = doc(db, `${getBasePath(competitionId)}/officials`, officialId);
    await updateDoc(ref, updates);
}

export async function deleteOfficial(competitionId, officialId) {
    return deleteOfficialCore(competitionId, officialId);
}

export function listenForVolunteerSignups(competitionId, callback) {
    if (!competitionId) return () => { };
    const q = query(
        collection(db, `${getBasePath(competitionId)}/volunteerSignups`),
        orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
        const list = [];
        snapshot.forEach((docSnap) => list.push({ id: docSnap.id, ...docSnap.data() }));
        callback(list);
    }, (err) => console.error("Error listening for signups:", err));
}

export async function saveVolunteerSignup(competitionId, data) {
    if (!competitionId) throw new Error("Competition ID required");
    const ref = doc(collection(db, `${getBasePath(competitionId)}/volunteerSignups`));
    await setDoc(ref, {
        ...data,
        createdAt: Date.now()
    });
    return ref.id;
}

export async function approveVolunteer(competitionId, signupId, officialData) {
    if (!competitionId || !signupId) return;
    await saveOfficialCore(competitionId, officialData);
    await deleteDoc(doc(db, `${getBasePath(competitionId)}/volunteerSignups`, signupId));
}

export async function rejectVolunteer(competitionId, signupId) {
    if (!competitionId || !signupId) return;
    await deleteDoc(doc(db, `${getBasePath(competitionId)}/volunteerSignups`, signupId));
}

export function listenForAssignments(competitionId, callback) {
    if (!competitionId) return () => { };
    const q = query(collection(db, `${getBasePath(competitionId)}/assignments`));

    return onSnapshot(q, (snapshot) => {
        const assignments = [];
        snapshot.forEach((docSnap) => {
            assignments.push({ id: docSnap.id, ...docSnap.data() });
        });
        callback(assignments);
    }, (error) => {
        console.error("Error listening for assignments:", error);
    });
}

export async function saveAssignment(competitionId, assignment) {
    if (!competitionId) throw new Error("No competition ID");

    const id = assignment.id || doc(collection(db, `${getBasePath(competitionId)}/assignments`)).id;

    const data = {
        officialId: assignment.officialId,
        role: assignment.role,
        roleLabel: assignment.roleLabel || assignment.role,
        locationType: assignment.locationType,
        locationId: assignment.locationId,
        locationLabel: assignment.locationLabel || assignment.locationId,
        moment: assignment.moment || 'all',
        shift: assignment.shift || 'all',
        startTime: assignment.startTime || '',
        endTime: assignment.endTime || '',
        dateString: assignment.dateString || '',
        updatedAt: Date.now()
    };

    await setDoc(doc(db, `${getBasePath(competitionId)}/assignments`, id), data);
    return id;
}

export async function deleteAssignment(competitionId, assignmentId) {
    if (!competitionId || !assignmentId) return;
    await deleteDoc(doc(db, `${getBasePath(competitionId)}/assignments`, assignmentId));
}

export function listenForLocations(competitionId, callback) {
    if (!competitionId) return () => { };
    const docRef = doc(db, `${getBasePath(competitionId)}/config/locations`);

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(docSnap.data().locations || []);
        } else {
            callback([]);
        }
    }, (error) => console.error(error));
}

export async function saveLocations(competitionId, locations) {
    if (!competitionId) return;
    await setDoc(doc(db, `${getBasePath(competitionId)}/config/locations`), {
        locations,
        updatedAt: Date.now()
    });
}

export function listenForRoles(competitionId, callback) {
    if (!competitionId) return () => { };
    const docRef = doc(db, `${getBasePath(competitionId)}/config/roles`);

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(docSnap.data().roles || []);
        } else {
            callback([]);
        }
    }, (error) => console.error(error));
}

export async function saveRoles(competitionId, roles) {
    if (!competitionId) return;
    await setDoc(doc(db, `${getBasePath(competitionId)}/config/roles`), {
        roles,
        updatedAt: Date.now()
    });
}
