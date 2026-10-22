// A vet's strike as a ground jury matter (vetDecisionUtils.js): the vet's
// report (incident log entry + staff notification; the driver's inbox message
// is written by the server, onIncidentWritten) and the secretariat's / TD's
// decision on the equipage.
import { runTransaction, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from '../config/firebase-config.js';
import { getGlobalState } from '../main.js';
import { getCompDocRef, trackWrite } from './firestoreService.js';
import { addStaffNotice, createIncident, getIncidents } from './incidentService.js';
import { buildVetStrikeDecisionPatch, buildVetStrikeIncident } from './vetDecisionUtils.js';
import { toLocalDateTimeValue } from './incidentUtils.js';
import { awaitWriteOrQueue } from '../utils/offlineWrite.js';

const NOT_PENDING = 'Inget veterinärbeslut väntar på beslut för ekipaget.';

/**
 * Reports a vet's strike to the ground jury: the incident log entry (with the
 * id named in vetStrikePending) and a staff notification. Best effort after
 * the vet's save: a failure is returned, not thrown, so the save stands.
 */
export async function reportVetStrike(competitionId, { incidentId, equipage = {}, phase, phaseLabel, horseNames = [], note = '' } = {}) {
    const startNumber = String(equipage.startNumber ?? equipage.id ?? '');
    try {
        let existing = [];
        try { existing = await getIncidents(competitionId); } catch (_) { /* offline: number from 1 */ }
        const entry = buildVetStrikeIncident({
            startNumber,
            driverName: equipage.driverName,
            phase,
            phaseLabel,
            horseNames,
            note,
            receivedAt: toLocalDateTimeValue(new Date())
        });
        const { vetStrike, source, ...form } = entry;
        const created = await createIncident(competitionId, form, existing, { vetStrike, source }, { id: incidentId });
        created.write.catch((error) => console.warn('Veterinärbeslutet kunde inte loggas:', error));
        addStaffNotice(competitionId, {
            kind: 'vetStrike',
            startNumber,
            phase,
            incidentId: created.id,
            summary: `#${startNumber} ${equipage.driverName || ''}: veterinären har inte godkänt ekipaget (${phaseLabel || phase}). Väntar på domarkollegiets beslut (händelse nr ${created.number}).`
        }).catch((error) => console.warn('Notisen om veterinärbeslutet kunde inte sparas:', error));
        return { ok: true, number: created.number };
    } catch (error) {
        console.warn('Veterinärbeslutet kunde inte rapporteras:', error);
        return { ok: false, error };
    }
}

/**
 * The vet approved the equipage again before the ground jury decided
 * (gateVetStrikePayload's withdrawn). The vet's save removed vetStrikePending
 * on the equipage; the server closes the report in the incident log with
 * vetStrike.outcome 'withdrawn' from that write (onEquipageUpdate,
 * functions/src/vetStrikeClosure.js), tells the driver and acknowledges the
 * staff notice (onIncidentWritten). Nothing more to write here, so it works
 * the same offline: { ok, skipped? }.
 */
export async function withdrawVetStrike(competitionId, { incidentId } = {}) {
    if (!competitionId || !incidentId) return { ok: false, skipped: true };
    return { ok: true, server: true };
}

/**
 * The ground jury's decision on a pending strike: 'confirm' (struken) or
 * 'overturn'. Only the equipage is written (queued offline): the server
 * closes the incident entry from that write and notifies the driver
 * (onEquipageUpdate -> onIncidentWritten). A staff notice tells the others.
 * Returns { outcome, state: 'saved' | 'queued' }.
 */
export async function decideVetStrike(competitionId, equipage = {}, action, { incident = null } = {}) {
    const user = getGlobalState('currentUser') || {};
    const name = user.displayName || user.email || '';
    const patchFor = (current) => buildVetStrikeDecisionPatch(current, action, {
        uid: user.uid || null,
        name,
        incidentId: incident?.id || current.vetStrikePending?.incidentId || ''
    });
    let patch = patchFor(equipage);
    if (!patch) throw new Error(NOT_PENDING);
    const startNumber = String(equipage.startNumber ?? equipage.id ?? '');
    const ref = getCompDocRef(competitionId, 'equipages', startNumber);
    let state = 'saved';
    if (navigator.onLine === false) {
        // Offline (transactions need the network): from the device's copy,
        // queued; the caller is told it waits for the network
        state = await awaitWriteOrQueue(trackWrite(`Domarkollegiets beslut #${startNumber}`, updateDoc(ref, { ...patch, updatedAt: serverTimestamp() })), {
            onLateError: (error) => console.error('Domarkollegiets beslut nekades när det skickades:', error)
        });
    } else {
        // Only while the strike is still pending on the server: two officials
        // deciding at once, or a decision made elsewhere, are not overwritten
        patch = await trackWrite(`Domarkollegiets beslut #${startNumber}`, runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error(NOT_PENDING);
            const current = patchFor({ ...snap.data(), startNumber });
            if (!current) throw new Error(NOT_PENDING);
            tx.update(ref, { ...current, updatedAt: serverTimestamp() });
            return current;
        }));
    }

    const outcome = patch.vetStrikeDecision.outcome;
    const defaultText = outcome === 'confirmed'
        ? 'Veterinärens beslut fastställt: ekipaget struket.'
        : 'Veterinärens beslut inte fastställt: ekipaget får fortsätta.';
    // Not awaited: offline it waits in the local cache
    addStaffNotice(competitionId, {
        kind: 'vetDecision',
        startNumber,
        phase: patch.vetStrikeDecision.phase,
        incidentId: incident?.id || '',
        summary: `#${startNumber} ${equipage.driverName || ''}: ${defaultText}`
    }).catch((error) => console.warn('Notisen om beslutet kunde inte sparas:', error));
    return { outcome, state };
}
