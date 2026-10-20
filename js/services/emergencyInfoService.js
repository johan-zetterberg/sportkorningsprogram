// Emergency information (emergencyInfoUtils.js): the public part in
// config/emergencyInfo, the phone numbers of named persons in the private
// emergencyPrivate/contacts (staff and the competition's drivers).
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from '../config/firebase-config.js';
import { getConfig, saveConfig } from './competitionService.js';
import { splitEmergencyInfo } from './emergencyInfoUtils.js';

const privateRef = (competitionId) => doc(db, `artifacts/${appId}/private/data/competitions/${competitionId}/emergencyPrivate/contacts`);

export async function getEmergencyPublic(competitionId) {
    if (!competitionId) return {};
    try {
        return (await getConfig(competitionId, 'emergencyInfo')) || {};
    } catch (error) {
        console.warn('Nödinformationen kunde inte läsas:', error);
        return {};
    }
}

/** The phone numbers, or null without access (the public) */
export async function getEmergencyPrivate(competitionId) {
    if (!competitionId) return null;
    try {
        const snap = await getDoc(privateRef(competitionId));
        return snap.exists() ? snap.data() : {};
    } catch (error) {
        if (error?.code !== 'permission-denied') console.warn('Nödnumren kunde inte läsas:', error);
        return null;
    }
}

/** Saves the admin form (both documents) */
export async function saveEmergencyInfo(competitionId, form) {
    const { publicDoc, privateDoc } = splitEmergencyInfo(form);
    await Promise.all([
        saveConfig(competitionId, 'emergencyInfo', { ...publicDoc, updatedAt: Date.now() }),
        setDoc(privateRef(competitionId), { ...privateDoc, updatedAt: serverTimestamp() })
    ]);
}
