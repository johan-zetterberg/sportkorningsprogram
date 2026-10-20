// A vet's strike as a ground jury matter (vetDecisionUtils.js): the vet's
// report (incident log entry + staff notification; the driver's inbox message
// is written by the server, onIncidentWritten) and the secretariat's / TD's
// decision on the equipage.
import { serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getGlobalState } from '../main.js';
import { getCompDocRef, trackWrite } from './firestoreService.js';
import { addStaffNotice, createIncident, getIncidents, updateIncident } from './incidentService.js';
import { buildVetStrikeDecisionPatch, buildVetStrikeIncident } from './vetDecisionUtils.js';
import { toLocalDateTimeValue } from './incidentUtils.js';

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
 * The ground jury's decision on a pending strike: 'confirm' (struken) or
 * 'overturn'. Updates the equipage, the incident entry (when found) and
 * notifies the staff.
 */
export async function decideVetStrike(competitionId, equipage = {}, action, { incident = null, decisionText = '' } = {}) {
    const user = getGlobalState('currentUser') || {};
    const name = user.displayName || user.email || '';
    const patch = buildVetStrikeDecisionPatch(equipage, action, {
        uid: user.uid || null,
        name,
        incidentId: incident?.id || equipage.vetStrikePending?.incidentId || ''
    });
    if (!patch) throw new Error('Inget veterinärbeslut väntar på beslut för ekipaget.');
    const startNumber = String(equipage.startNumber ?? equipage.id ?? '');
    await trackWrite(`Domarkollegiets beslut #${startNumber}`, updateDoc(getCompDocRef(competitionId, 'equipages', startNumber), {
        ...patch,
        updatedAt: serverTimestamp()
    }));

    const outcome = patch.vetStrikeDecision.outcome;
    const defaultText = outcome === 'confirmed'
        ? 'Veterinärens beslut fastställt: ekipaget struket.'
        : 'Veterinärens beslut inte fastställt: ekipaget får fortsätta.';
    if (incident?.id) {
        await updateIncident(competitionId, incident, {
            status: 'decided',
            decision: [decisionText, defaultText].filter(Boolean).join(' '),
            decidedBy: incident.decidedBy || name
        }, { vetStrike: { ...(incident.vetStrike || {}), outcome } }).catch((error) => {
            console.warn('Händelsen kunde inte uppdateras med beslutet:', error);
        });
    }
    addStaffNotice(competitionId, {
        kind: 'vetDecision',
        startNumber,
        phase: patch.vetStrikeDecision.phase,
        incidentId: incident?.id || '',
        summary: `#${startNumber} ${equipage.driverName || ''}: ${defaultText}`
    }).catch((error) => console.warn('Notisen om beslutet kunde inte sparas:', error));
    return outcome;
}
