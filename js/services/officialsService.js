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
    serverTimestamp,
    arrayUnion,
    arrayRemove,
    getDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export { serverTimestamp };

// Helper for paths
const getBasePath = (compId) => `artifacts/${appId}/public/data/competitions/${compId}`;

// --- Officials (Personer) ---

export function listenForOfficials(competitionId, callback) {
    if (!competitionId) return () => { };

    const q = query(
        collection(db, `${getBasePath(competitionId)}/officials`),
        orderBy('name', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
        const officials = [];
        snapshot.forEach((doc) => {
            officials.push({ id: doc.id, ...doc.data() });
        });
        callback(officials);
    }, (error) => {
        console.error("Error listening for officials:", error);
    });
}

export async function saveOfficial(competitionId, official) {
    if (!competitionId) throw new Error("No competition ID");

    // Använd befintligt ID eller skapa nytt
    const id = official.id || doc(collection(db, `${getBasePath(competitionId)}/officials`)).id;

    const data = {
        name: official.name || '',
        phone: official.phone || '',
        email: official.email || '',
        iceName: official.iceName || '', // ICE
        icePhone: official.icePhone || '', // ICE
        diet: official.diet || '', // Diet
        shirtSize: official.shirtSize || '', // Shirt
        role: official.role || '',
        rank: official.rank || '',
        club: official.club || '',
        notes: official.notes || '',
        role: official.role || 'admin',
        isActive: official.isActive !== undefined ? official.isActive : true,
        updatedAt: Date.now()
    };

    await setDoc(doc(db, `${getBasePath(competitionId)}/officials`, id), data);

    // Sync email to root document for Auto-login permissions
    if (data.email) {
        try {
            const roleKey = data.role === 'admin' ? 'officialEmails' : `${data.role}Emails`;
            await updateDoc(doc(db, `artifacts/${appId}/public/data/competitions`, competitionId), {
                [roleKey]: arrayUnion(data.email.toLowerCase().trim())
            });
        } catch (e) {
            console.warn("Kunde inte synka official email (kanske saknar behörighet på root-dokumentet)", e);
        }
    }

    return id;
}

export async function updateOfficialStatus(competitionId, officialId, updates) {
    if (!competitionId || !officialId) return;
    const ref = doc(db, `${getBasePath(competitionId)}/officials`, officialId);
    await updateDoc(ref, updates);
}

export async function deleteOfficial(competitionId, officialId) {
    if (!competitionId || !officialId) return;

    // Hämta e-posten först så vi kan ta bort den från behörighetslistan
    let emailToRemove = null;
    let roleToRemove = 'admin';
    try {
        const snap = await getDoc(doc(db, `${getBasePath(competitionId)}/officials`, officialId));
        if (snap.exists() && snap.data().email) {
            emailToRemove = snap.data().email.toLowerCase().trim();
            roleToRemove = snap.data().role || 'admin';
        }
    } catch (e) { }

    await deleteDoc(doc(db, `${getBasePath(competitionId)}/officials`, officialId));

    if (emailToRemove) {
        try {
            const roleKey = roleToRemove === 'admin' ? 'officialEmails' : `${roleToRemove}Emails`;
            await updateDoc(doc(db, `artifacts/${appId}/public/data/competitions`, competitionId), {
                [roleKey]: arrayRemove(emailToRemove)
            });
        } catch (e) {
            console.warn("Kunde inte synka borttagning av official email", e);
        }
    }
}

// --- Volunteer Signups (Anmälningar) ---

export function listenForVolunteerSignups(competitionId, callback) {
    if (!competitionId) return () => { };
    const q = query(
        collection(db, `${getBasePath(competitionId)}/volunteerSignups`),
        orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
        const list = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        callback(list);
    }, (err) => console.error("Error listening for signups:", err));
}

export async function saveVolunteerSignup(competitionId, data) {
    if (!competitionId) throw new Error("Competition ID required");
    // Public write, random ID
    const ref = doc(collection(db, `${getBasePath(competitionId)}/volunteerSignups`));
    await setDoc(ref, {
        ...data,
        createdAt: Date.now()
    });
    return ref.id;
}

export async function approveVolunteer(competitionId, signupId, officialData) {
    if (!competitionId || !signupId) return;

    // 1. Save as Official
    await saveOfficial(competitionId, officialData);

    // 2. Delete from Signups
    await deleteDoc(doc(db, `${getBasePath(competitionId)}/volunteerSignups`, signupId));
}

export async function rejectVolunteer(competitionId, signupId) {
    if (!competitionId || !signupId) return;
    await deleteDoc(doc(db, `${getBasePath(competitionId)}/volunteerSignups`, signupId));
}

// --- Assignments (Tilldelningar) ---

export function listenForAssignments(competitionId, callback) {
    if (!competitionId) return () => { };

    const q = query(collection(db, `${getBasePath(competitionId)}/assignments`));

    return onSnapshot(q, (snapshot) => {
        const assignments = [];
        snapshot.forEach((doc) => {
            assignments.push({ id: doc.id, ...doc.data() });
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
        roleLabel: assignment.roleLabel || assignment.role, // För enklare visning
        locationType: assignment.locationType,
        locationId: assignment.locationId,
        locationLabel: assignment.locationLabel || assignment.locationId,
        moment: assignment.moment || 'all', // dressage, station, etc.
        shift: assignment.shift || 'all',
        startTime: assignment.startTime || '',
        endTime: assignment.endTime || '',
        dateString: assignment.dateString || '', // Added date persistence
        updatedAt: Date.now()
    };

    await setDoc(doc(db, `${getBasePath(competitionId)}/assignments`, id), data);
    return id;
}

export async function deleteAssignment(competitionId, assignmentId) {
    if (!competitionId || !assignmentId) return;
    await deleteDoc(doc(db, `${getBasePath(competitionId)}/assignments`, assignmentId));
}

// --- Locations (Platser - om vi vill spara dem, annars genereras de on-the-fly) ---
// Vi kan spara en "locationsCatalog" för att minnas custom-platser.

export function listenForLocations(competitionId, callback) {
    if (!competitionId) return () => { };
    const docRef = doc(db, `${getBasePath(competitionId)}/config/locations`);

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(docSnap.data().locations || []);
        } else {
            callback([]); // Inga sparade platser än
        }
    }, (error) => console.error(error));
}

export async function saveLocations(competitionId, locations) {
    if (!competitionId) return;
    await setDoc(doc(db, `${getBasePath(competitionId)}/config/locations`), {
        locations: locations,
        updatedAt: Date.now()
    });
}

// --- Roles (Save custom roles) ---

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
        roles: roles,
        updatedAt: Date.now()
    });
}
