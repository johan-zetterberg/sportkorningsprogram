import { storage } from '../config/firebase-config.js';
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

/**
 * Uploads a document (PDF) for a specific competition.
 * @param {string} competitionId 
 * @param {File} file 
 * @returns {Promise<string>} Download URL
 */
// What storage.rules accept in documents/: the files are public by link, so
// no HTML, SVG or scripts
const DOCUMENT_TYPE_PATTERNS = [
    /^image\/(png|jpeg|webp|gif)$/,
    /^application\/pdf$/,
    /^text\/(plain|csv)$/,
    /^application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint)$/,
    /^application\/vnd\.openxmlformats-officedocument\./,
    /^application\/vnd\.oasis\.opendocument\./
];

export function isAllowedDocumentType(type) {
    return DOCUMENT_TYPE_PATTERNS.some(pattern => pattern.test(String(type || '')));
}

export async function uploadCompetitionDocument(competitionId, file) {
    if (!file) throw new Error("Ingen fil vald");
    if (!isAllowedDocumentType(file.type)) {
        throw new Error("Filtypen stöds inte. Använd PDF, bild (PNG/JPG/WebP/GIF), Word, Excel, PowerPoint eller text.");
    }

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

    // Images only, as for the competition logo: the folder is publicly
    // readable, so an HTML or SVG file there would be served from our domain
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        throw new Error("Loggan måste vara PNG, JPG eller WebP.");
    }
    if (file.size > 2 * 1024 * 1024) {
        throw new Error("Loggan får vara högst 2 MB.");
    }

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');

    // We ALWAYS use the competition folder because we know we can write there.
    // The "Globalness" comes from WHERE the link is saved in Firestore.
    const storagePath = `competitions/${competitionId}/assets/club-logos/${timestamp}_${safeName}`;

    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
}

export async function uploadCompetitionLogo(competitionId, file) {
    if (!file) throw new Error("Ingen fil vald");
    if (!competitionId) throw new Error("Competition ID required for upload");

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        throw new Error("Loggan måste vara PNG, JPG eller WebP.");
    }

    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
        throw new Error("Loggan är för stor. Välj en bild under 2 MB.");
    }

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    // Reuse the same storage area as club logos because existing storage rules
    // already allow that path for competition assets.
    const storagePath = `competitions/${competitionId}/assets/club-logos/competition_${timestamp}_${safeName}`;

    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
}
