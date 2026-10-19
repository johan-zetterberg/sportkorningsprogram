import { storage } from '../config/firebase-config.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

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

// Storage folder for a document's audience (storage.rules): public/ is
// readable while the competition is visible, drivers/ only by its drivers
// and staff
export function documentFolderForAudience(audience) {
    return audience?.public === false ? 'drivers' : 'public';
}

function buildDocumentPath(competitionId, file, folder) {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `competitions/${competitionId}/documents/${folder}/${timestamp}_${safeName}`;
}

/**
 * Uploads a competition document to documents/public/ (default) or
 * documents/drivers/. Returns the download URL (public folder) for callers
 * that only need a link.
 */
export async function uploadCompetitionDocument(competitionId, file, folder = 'public') {
    const { url } = await uploadCompetitionDocumentFile(competitionId, file, folder);
    return url;
}

/**
 * As uploadCompetitionDocument, with the storage path. For drivers/ no URL is
 * fetched: its token would bypass the rules, so only the path is saved and a
 * URL is asked for when the document is shown (resolveDocumentUrls)
 */
export async function uploadCompetitionDocumentFile(competitionId, file, folder = 'public') {
    if (!file) throw new Error("Ingen fil vald");
    if (!isAllowedDocumentType(file.type)) {
        throw new Error("Filtypen stöds inte. Använd PDF, bild (PNG/JPG/WebP/GIF), Word, Excel, PowerPoint eller text.");
    }
    if (folder !== 'public' && folder !== 'drivers') throw new Error('Okänd dokumentmapp');

    const storagePath = buildDocumentPath(competitionId, file, folder);
    const snapshot = await uploadBytes(ref(storage, storagePath), file);
    const url = folder === 'public' ? await getDownloadURL(snapshot.ref) : null;
    return { url, storagePath, folder };
}

// A download URL for a stored driver-only document, asked for when shown
// (the rules decide); null when the user may not read it
export async function getStoredDocumentUrl(storagePath) {
    if (!storagePath) return null;
    try {
        return await getDownloadURL(ref(storage, storagePath));
    } catch (err) {
        console.warn('Could not get document URL:', err?.code || err);
        return null;
    }
}

// Documents saved with a storage path but no URL get one for this view
export async function resolveDocumentUrls(documents = []) {
    return Promise.all((documents || []).map(async (document) => {
        if (!document || document.url || !document.storagePath) return document;
        return { ...document, url: await getStoredDocumentUrl(document.storagePath) };
    }));
}

// Removing a document's file; a missing file is fine
export async function deleteStoredDocument(storagePath) {
    if (!storagePath || !String(storagePath).includes('/documents/')) return;
    try {
        await deleteObject(ref(storage, storagePath));
    } catch (err) {
        if (err?.code !== 'storage/object-not-found') throw err;
    }
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
