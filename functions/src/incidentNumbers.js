// The incident log's entry numbers (1, 2, ...), unique per competition. A
// device numbers a new entry from the entries it has (incidentService
// createIncident: also offline), so two devices, or one offline, can pick the
// same number. The onIncidentNumbered trigger gives each new entry its final
// number from a counter (private counters/incidents), in a transaction: the
// device's number stands when it is the next one, otherwise the entry gets
// the next free number. Each entry once (the counter remembers the ids it
// numbered), so a re-delivered trigger changes nothing.

export const INCIDENT_COUNTER = 'counters/incidents';
export const INCIDENT_NUMBER_MAX = 100000;

export const incidentsPath = (appId, compId) => `artifacts/${appId}/private/data/competitions/${compId}/incidents`;
export const incidentCounterPath = (appId, compId) => `artifacts/${appId}/private/data/competitions/${compId}/${INCIDENT_COUNTER}`;

const validNumber = (n) => Number.isInteger(n) && n > 0 && n <= INCIDENT_NUMBER_MAX;

/**
 * The final number of a new entry. counter: the counter doc ({ last,
 * assigned: { [incidentId]: number } }) or null (first use: started from the
 * highest number among the other entries, otherNumbers). provisional: the
 * device's number. -> { number, counter, changed } or null (numbered already)
 */
export function assignIncidentNumber(counter, incidentId, provisional, otherNumbers = []) {
    const assigned = counter && typeof counter.assigned === 'object' && counter.assigned ? counter.assigned : {};
    if (Object.prototype.hasOwnProperty.call(assigned, incidentId)) return null;
    const wanted = Number(provisional);
    // First use: entries with the same number are (most likely) the other
    // device's not yet numbered, so they do not count as taken
    const last = counter
        ? (Number.isInteger(Number(counter.last)) ? Number(counter.last) : 0)
        : Math.max(0, ...otherNumbers.map(Number).filter((n) => validNumber(n) && n !== wanted));
    const number = validNumber(wanted) && wanted === last + 1 ? wanted : last + 1;
    return {
        number,
        changed: number !== wanted,
        counter: { last: number, assigned: { ...assigned, [incidentId]: number } }
    };
}

/** Numbers a new entry (the trigger). -> { number, changed } or null */
export async function numberIncident(db, { appId, compId, incidentId, now = Date.now() }) {
    const incidentRef = db.doc(`${incidentsPath(appId, compId)}/${incidentId}`);
    const counterRef = db.doc(incidentCounterPath(appId, compId));
    return db.runTransaction(async (tx) => {
        const [incidentSnap, counterSnap] = await Promise.all([tx.get(incidentRef), tx.get(counterRef)]);
        if (!incidentSnap.exists) return null;
        let otherNumbers = [];
        if (!counterSnap.exists) {
            // First use (or entries from before the counter): from the highest so far
            const all = await tx.get(db.collection(incidentsPath(appId, compId)));
            otherNumbers = all.docs.filter((d) => d.id !== incidentId).map((d) => d.data()?.number);
        }
        const result = assignIncidentNumber(counterSnap.exists ? counterSnap.data() : null, incidentId, incidentSnap.data()?.number, otherNumbers);
        if (!result) return null;
        tx.set(counterRef, { ...result.counter, updatedAtMs: now });
        if (result.changed) tx.update(incidentRef, { number: result.number });
        return { number: result.number, changed: result.changed };
    });
}
