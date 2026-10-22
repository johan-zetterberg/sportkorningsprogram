// Closing a vet strike's incident log entry on the server (onEquipageUpdate,
// onIncidentNumbered): the equipage is the source of truth. The ground jury's
// decision (vetStrikeDecision, written by the TD or an admin: firestore.rules)
// or the vet's renewed approval (vetStrikePending removed without a decision)
// closes the open entry with the matching vetStrike.outcome, so the driver's
// notice (onIncidentWritten) does not depend on a device finishing several
// writes. Pure functions.

// The closing texts in the incident log (Swedish, as the log)
export const VET_CLOSURE_TEXTS = Object.freeze({
    confirmed: 'Veterinärens beslut fastställt: ekipaget struket.',
    overturned: 'Veterinärens beslut inte fastställt: ekipaget får fortsätta.',
    withdrawn: 'Veterinären godkände ekipaget igen före domarkollegiets beslut. Ärendet avslutat utan beslut.'
});

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isMap = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const decisionOutcome = (decision) => (isMap(decision) && ['confirmed', 'overturned'].includes(decision.outcome) ? decision.outcome : null);
const sameDecision = (a, b) => isMap(a) && isMap(b)
    && a.outcome === b.outcome && a.at === b.at && a.incidentId === b.incidentId;

/**
 * The closure an equipage write implies, or null: vetStrikePending went from
 * set to null. A new decision naming the same entry (or none) gives its
 * outcome; no new decision means the vet withdrew the strike.
 * -> { incidentId, outcome, text, byName }
 */
export function closureFromEquipageChange(before, after) {
    const pending = before?.vetStrikePending;
    if (!isMap(pending) || !after || isMap(after.vetStrikePending)) return null;
    const incidentId = clean(pending.incidentId, 128);
    if (!incidentId || incidentId.includes('/')) return null;
    const decision = after.vetStrikeDecision;
    const outcome = decisionOutcome(decision);
    if (outcome && !sameDecision(decision, before?.vetStrikeDecision)
        && (!decision.incidentId || decision.incidentId === incidentId)) {
        return {
            incidentId,
            outcome,
            text: [clean(decision.text, 3000), VET_CLOSURE_TEXTS[outcome]].filter(Boolean).join(' '),
            byName: clean(decision.byName, 200)
        };
    }
    return { incidentId, outcome: 'withdrawn', text: VET_CLOSURE_TEXTS.withdrawn, byName: '' };
}

/**
 * For an incident entry created after the equipage changed (the vet's report
 * queued offline and synced late): the closure the equipage already implies,
 * or null while the strike is still pending on it.
 */
export function closureForNewIncident(incidentId, incident, equipage) {
    if (!incident || incident.type !== 'vet' || (incident.vetStrike?.outcome || 'pending') !== 'pending') return null;
    if (!equipage) return null;
    if (isMap(equipage.vetStrikePending) && equipage.vetStrikePending.incidentId === incidentId) return null;
    const decision = equipage.vetStrikeDecision;
    const outcome = decisionOutcome(decision);
    if (outcome && decision.incidentId === incidentId) {
        return {
            incidentId,
            outcome,
            text: [clean(decision.text, 3000), VET_CLOSURE_TEXTS[outcome]].filter(Boolean).join(' '),
            byName: clean(decision.byName, 200)
        };
    }
    // Never pending under this id any more and not decided: withdrawn. Only
    // when the equipage once had a strike (a decision, a pending one, or a
    // vet result) — not for an entry without any vet state
    const hadVetState = isMap(equipage.vetStrikePending) || isMap(decision)
        || Object.keys(equipage).some((key) => key.startsWith('vetInspection_'));
    if (!hadVetState) return null;
    return { incidentId, outcome: 'withdrawn', text: VET_CLOSURE_TEXTS.withdrawn, byName: '' };
}

/**
 * The incident update for a closure, or null when the entry is no longer an
 * open pending vet report (idempotent: a second run changes nothing).
 * updatedBy 'system': the rules let no client write that (updatedBy must be
 * the writer's uid), so onIncidentWritten trusts it.
 */
export function buildIncidentClosureUpdate(incident, closure, serverTimestamp) {
    if (!incident || !closure || incident.type !== 'vet' || incident.status !== 'open') return null;
    if ((incident.vetStrike?.outcome || 'pending') !== 'pending') return null;
    return {
        status: closure.outcome === 'withdrawn' ? 'closed' : 'decided',
        decision: closure.text.slice(0, 4000),
        decidedBy: clean(incident.decidedBy || closure.byName, 200),
        'vetStrike.outcome': closure.outcome,
        updatedBy: 'system',
        updatedByName: 'DriveLive',
        updatedAt: serverTimestamp
    };
}

export const SYSTEM_WRITER = 'system';
