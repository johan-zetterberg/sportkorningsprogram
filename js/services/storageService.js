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
