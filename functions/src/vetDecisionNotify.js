// The driver's inbox message for a vet decision in the incident log
// (onIncidentWritten): the vet's strike when reported to the ground jury, and
// the ground jury's decision (confirmed or overturned). Written to the
// competition's messages, addressed to the equipage only (getDriverInbox
// delivers it to the driver; the public never sees it).

const PHASE_LABELS = {
    initial: 'första besiktningen',
    harness: 'selningskontrollen',
    restArea: 'viloboxen',
    final: 'slutbesiktningen'
};

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The message for a write of an incident, or null when the driver gets none.
 * before/after: the incident document's data (null when created/deleted).
 */
export function buildVetDecisionDriverMessage(before, after) {
    if (!after || after.type !== 'vet') return null;
    const startNumber = clean(after.startNumber, 20);
    if (!startNumber) return null;
    const phase = PHASE_LABELS[after.vetStrike?.phase] || 'veterinärbesiktningen';
    const base = {
        type: 'alert',
        audience: { public: false, drivers: true },
        targetStartNumbers: [startNumber],
        source: 'vetDecision'
    };

    if (!before) {
        return {
            ...base,
            title: `Veterinärbeslut – ekipage #${startNumber}`,
            body: `Veterinären har inte godkänt ekipaget i ${phase}. Beslutet har rapporterats till domarkollegiets ordförande, som prövar det. Du får besked här. Kontakta sekretariatet vid frågor.`
        };
    }

    const outcomeBefore = before.vetStrike?.outcome || 'pending';
    const outcomeAfter = after.vetStrike?.outcome || 'pending';
    if (outcomeBefore === outcomeAfter) return null;
    const decision = clean(after.decision, 1000);
    if (outcomeAfter === 'confirmed') {
        return {
            ...base,
            title: `Domarkollegiets beslut – ekipage #${startNumber}`,
            body: `Domarkollegiet har fastställt veterinärens beslut: ekipaget är struket.${decision ? ` ${decision}` : ''} Kontakta sekretariatet vid frågor.`
        };
    }
    if (outcomeAfter === 'overturned') {
        return {
            ...base,
            type: 'info',
            title: `Domarkollegiets beslut – ekipage #${startNumber}`,
            body: `Domarkollegiet har inte fastställt veterinärens beslut: ekipaget får fortsätta.${decision ? ` ${decision}` : ''}`
        };
    }
    return null;
}
