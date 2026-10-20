// A vet's "Ej godkänd / Struken" is a decision the ground jury confirms or
// overturns (TR: reported to the president of the ground jury at once). The
// vet's result per phase is recorded as before; the equipage's status is not
// set to 'struken' by the vet: it gets vetStrikePending until the secretariat
// or the TD decides. Pure helpers (see vetDecisionService.js).

export const VET_STRIKE_STATES = Object.freeze(['none', 'pending', 'confirmed', 'overturned']);

/**
 * The next state of a vet strike.
 * actions: 'vetStrike' (the vet marks it), 'vetClear' (the vet approves again
 * before the decision), 'confirm' / 'overturn' (the ground jury).
 * Returns the same state when the action does not apply.
 */
export function vetStrikeTransition(state = 'none', action = '') {
    const current = VET_STRIKE_STATES.includes(state) ? state : 'none';
    switch (action) {
        case 'vetStrike':
            // A confirmed strike stays confirmed; anything else waits again
            return current === 'confirmed' ? 'confirmed' : 'pending';
        case 'vetClear':
            return current === 'pending' ? 'none' : current;
        case 'confirm':
            return current === 'pending' ? 'confirmed' : current;
        case 'overturn':
            return current === 'pending' ? 'overturned' : current;
        default:
            return current;
    }
}

/** The state of an equipage: pending flag, or the recorded decision */
export function vetStrikeStateOf(equipage = {}) {
    if (equipage?.vetStrikePending && typeof equipage.vetStrikePending === 'object') return 'pending';
    const outcome = equipage?.vetStrikeDecision?.outcome;
    if (outcome === 'confirmed' || outcome === 'overturned') return outcome;
    return 'none';
}

/**
 * The vet's save (buildVetStatusUpdate's payload) with the strike held for
 * the ground jury: a 'struken' status is not written; vetStrikePending is.
 * Returns { payload, strike }: strike true when this save is a new strike.
 * The status stays as it was (a strike already confirmed: nothing changes).
 */
export function gateVetStrikePayload(payload = {}, { equipage = {}, phase = 'initial', uid = null, nowIso = new Date().toISOString(), horseKeys = null, incidentId = '' } = {}) {
    const out = { ...payload };
    const phaseField = `vetInspection_${phase}`;
    const phaseStatus = out[phaseField]?.status;
    const struck = out.status === 'struken' || phaseStatus === 'struken';
    const alreadyWithdrawn = String(equipage?.status || '').toLowerCase() === 'struken';
    if (out.status === 'struken') delete out.status;

    if (!struck || alreadyWithdrawn) {
        // Approved again before the ground jury decided: the strike is gone
        if (!struck && vetStrikeStateOf(equipage) === 'pending' && equipage?.vetStrikePending?.phase === phase) {
            out.vetStrikePending = null;
        }
        return { payload: out, strike: false };
    }
    const pending = equipage?.vetStrikePending;
    if (pending && pending.phase === phase) {
        // Already waiting for this phase: no second report
        return { payload: out, strike: false };
    }
    out.vetStrikePending = {
        phase,
        at: nowIso,
        by: uid || null,
        horseKeys: Array.isArray(horseKeys) ? horseKeys.map(String).slice(0, 12) : [],
        incidentId: String(incidentId || '')
    };
    return { payload: out, strike: true };
}

/** The incident log entry for a vet's strike (incidentService adds number and writer) */
export function buildVetStrikeIncident({ startNumber, driverName = '', phase = 'initial', phaseLabel = '', horseNames = [], note = '', receivedAt = '' } = {}) {
    const who = [`#${startNumber}`, String(driverName || '').trim()].filter(Boolean).join(' ');
    const horses = (Array.isArray(horseNames) ? horseNames : []).filter(Boolean);
    const description = [
        `Veterinären har inte godkänt ${who} (${phaseLabel || phase}).`,
        horses.length ? `Häst: ${horses.join(', ')}.` : '',
        note ? `Veterinärens notering: ${String(note).trim()}` : '',
        'Rapporterat till domarkollegiets ordförande för beslut.'
    ].filter(Boolean).join(' ').slice(0, 4000);
    return {
        type: 'vet',
        status: 'open',
        source: 'vet',
        receivedAt,
        startNumber: String(startNumber ?? ''),
        discipline: 'general',
        obstacle: String(phaseLabel || phase).slice(0, 100),
        description,
        decision: '',
        decidedBy: '',
        vetStrike: { phase, outcome: 'pending' }
    };
}

/**
 * The equipage update for the ground jury's decision on a pending strike:
 * confirm -> status 'struken'; overturn -> the pending flag removed. Both
 * record the decision. null when nothing is pending.
 */
export function buildVetStrikeDecisionPatch(equipage = {}, action, { uid = null, name = '', nowIso = new Date().toISOString(), incidentId = '' } = {}) {
    const state = vetStrikeStateOf(equipage);
    const next = vetStrikeTransition(state, action);
    if (state !== 'pending' || next === state) return null;
    const decision = {
        outcome: next,
        phase: equipage.vetStrikePending?.phase || '',
        at: nowIso,
        by: uid || null,
        byName: String(name || '').slice(0, 200),
        incidentId: String(incidentId || '')
    };
    const patch = { vetStrikePending: null, vetStrikeDecision: decision };
    if (next === 'confirmed') patch.status = 'struken';
    return patch;
}
