import { storage } from '../config/firebase-config.js';
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

/**
 * Uploads a document (PDF) for a specific competition.
 * @param {string} competitionId 
 * @param {File} file 
 * @returns {Promise<string>} Download URL
 */
export async function uploadCompetitionDocument(competitionId, file) {
    if (!file) throw new Error("Ingen fil vald");

    // Create a reference to 'competitions/<compId>/documents/<timestamp>_<filename>'
    const timestamp = Date.now();
    // Sanitize filename
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `competitions/${competitionId}/documents/${timestamp}_${safeName}`;

    const storageRef = ref(storage, storagePath);

    // Upload
    const snapshot = await uploadBytes(storageRef, file);

    // Get URL
    const url = await getDownloadURL(snapshot.ref);
    return url;
}

/**
 * Uploads a club logo (default: Global).
 * 
 * NOTE: We ignore `isGlobal` for the storage path to avoid permission issues.
 * All logos are stored in the current competition's folder (where we have write access).
 * The *URL* is then saved to the global config by the caller, making it effectively global.
 * 
 * @param {string} competitionId 
 * @param {File} file 
 * @param {boolean} isGlobal - (Unused for path, kept for API compatibility)
 * @returns {Promise<string>} Download URL
 */
export async function uploadClubLogo(competitionId, file, isGlobal = true) {
    if (!file) throw new Error("Ingen fil vald");

    if (!competitionId) throw new Error("Competition ID required for upload");

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');

    // We ALWAYS use the competition folder because we know we can write there.
    // The "Globalness" comes from WHERE the link is saved in Firestore.
    const storagePath = `competitions/${competitionId}/assets/club-logos/${timestamp}_${safeName}`;

    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
}
