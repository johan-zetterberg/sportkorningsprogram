import { db, appId } from '../../config/firebase-config.js';
import { doc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { saveEquipage } from '../../services/equipageService.js';
import { equipageIdentity, sameEquipageIdentity } from './adminParticipantIdentity.js';

// Saves from the participant import and the equipage form that never land on
// another driver: a new entry is created only if the start number is still
// free, an update only if the start number still belongs to the same driver.

function equipageRef(competitionId, startNumber) {
    return doc(db, `artifacts/${appId}/public/data/competitions/${competitionId}/equipages/${startNumber}`);
}

function codedError(message, code, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
}

/**
 * Creates a new equipage. The start number is claimed in a transaction that
 * fails when the document exists (error.code 'equipage-exists', with
 * error.existing), then the full entry is saved (public and private fields).
 */
export async function createEquipageIfNew(competitionId, startNumber, data = {}) {
    const sn = String(startNumber ?? '').trim();
    if (!sn) throw new Error('Startnummer saknas.');
    const ref = equipageRef(competitionId, sn);
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (snap.exists()) {
            const existing = snap.data() || {};
            throw codedError(`Startnummer #${sn} används redan av ${existing.driverName || 'ett annat ekipage'}.`, 'equipage-exists', { existing });
        }
        transaction.set(ref, {
            startNumber: Number.isFinite(Number(data.startNumber)) ? Number(data.startNumber) : sn,
            driverName: data.driverName || '',
            className: data.className || ''
        });
    });
    await saveEquipage(competitionId, sn, data);
}

/**
 * Updates an existing equipage if it still belongs to the driver the change
 * was made for (`expected`, from equipageIdentity of the loaded entry).
 * error.code 'equipage-missing' or 'equipage-changed' otherwise.
 */
export async function updateEquipageIfSame(competitionId, startNumber, patch = {}, expected = null) {
    const sn = String(startNumber ?? '').trim();
    if (!sn) throw new Error('Startnummer saknas.');
    const ref = equipageRef(competitionId, sn);
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists()) throw codedError(`Ekipage #${sn} finns inte längre.`, 'equipage-missing');
        if (!sameEquipageIdentity(snap.data(), expected)) {
            throw codedError(`Startnummer #${sn} tillhör nu ${snap.data()?.driverName || 'ett annat ekipage'}.`, 'equipage-changed', { existing: snap.data() });
        }
    });
    await saveEquipage(competitionId, sn, patch);
}

export { equipageIdentity };
