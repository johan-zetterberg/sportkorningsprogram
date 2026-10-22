// The driver's inbox message for a vet decision in the incident log
// (onIncidentWritten): the vet's strike when reported to the ground jury, the
// ground jury's decision (confirmed or overturned), and a strike the vet
// withdrew (approved the equipage again) before the decision. Written to the
// competition's messages in Swedish and English (titleEn/bodyEn: the portal,
// push and mail pick the reader's language), addressed to the equipage only
// (getDriverInbox delivers it to the driver; the public never sees it).

const PHASE_LABELS = {
    initial: { sv: 'första besiktningen', en: 'the first inspection' },
    harness: { sv: 'selningskontrollen', en: 'the harness check' },
    restArea: { sv: 'viloboxen', en: 'the rest area' },
    final: { sv: 'slutbesiktningen', en: 'the final inspection' }
};

// The outcomes a decided or withdrawn strike can have (incident vetStrike.outcome)
export const VET_NOTICE_OUTCOMES = Object.freeze(['confirmed', 'overturned', 'withdrawn']);

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The message for a write of an incident, or null when the driver gets none.
 * before/after: the incident document's data (null when created/deleted).
 */
export function buildVetDecisionDriverMessage(before, after) {
    if (!after || after.type !== 'vet') return null;
    // A start number only (no free text reaches the driver's mail or push)
    const startNumber = clean(after.startNumber, 20);
    if (!/^[\w-]{1,20}$/.test(startNumber)) return null;
    const phase = PHASE_LABELS[after.vetStrike?.phase] || { sv: 'veterinärbesiktningen', en: 'the vet inspection' };
    const base = {
        type: 'alert',
        category: 'essential',
        audience: { public: false, drivers: true },
        targetStartNumbers: [startNumber],
        source: 'vetDecision'
    };

    if (!before) {
        return {
            ...base,
            title: `Veterinärbeslut – ekipage #${startNumber}`,
            titleEn: `Vet decision – equipage #${startNumber}`,
            body: `Veterinären har inte godkänt ekipaget i ${phase.sv}. Beslutet har rapporterats till domarkollegiets ordförande, som prövar det. Du får besked här. Kontakta sekretariatet vid frågor.`,
            bodyEn: `The vet has not approved the equipage in ${phase.en}. The decision has been reported to the president of the ground jury, who will review it. You will be informed here. Contact the secretariat with any questions.`
        };
    }

    const outcomeBefore = before.vetStrike?.outcome || 'pending';
    const outcomeAfter = after.vetStrike?.outcome || 'pending';
    if (outcomeBefore === outcomeAfter) return null;
    // Only a pending strike can be withdrawn: after a decision it sends nothing
    if (outcomeAfter === 'withdrawn' && outcomeBefore !== 'pending') return null;
    // The ground jury's free-text decision stays in the incident log: the
    // driver gets fixed texts only (no user text in mail or push)
    if (outcomeAfter === 'confirmed') {
        return {
            ...base,
            title: `Domarkollegiets beslut – ekipage #${startNumber}`,
            titleEn: `Ground jury decision – equipage #${startNumber}`,
            body: 'Domarkollegiet har fastställt veterinärens beslut: ekipaget är struket. Kontakta sekretariatet vid frågor.',
            bodyEn: 'The ground jury has confirmed the vet\'s decision: the equipage is withdrawn. Contact the secretariat with any questions.'
        };
    }
    if (outcomeAfter === 'overturned') {
        return {
            ...base,
            type: 'info',
            title: `Domarkollegiets beslut – ekipage #${startNumber}`,
            titleEn: `Ground jury decision – equipage #${startNumber}`,
            body: 'Domarkollegiet har inte fastställt veterinärens beslut: ekipaget får fortsätta. Kontakta sekretariatet vid frågor.',
            bodyEn: 'The ground jury has not confirmed the vet\'s decision: the equipage may continue. Contact the secretariat with any questions.'
        };
    }
    if (outcomeAfter === 'withdrawn') {
        return {
            ...base,
            type: 'info',
            title: `Veterinärbeslutet har återkallats – ekipage #${startNumber}`,
            titleEn: `The vet decision has been withdrawn – equipage #${startNumber}`,
            body: `Veterinären har godkänt ekipaget i ${phase.sv} och återkallat beslutet. Ekipaget får fortsätta. Kontakta sekretariatet vid frågor.`,
            bodyEn: `The vet has approved the equipage in ${phase.en} and withdrawn the decision. The equipage may continue. Contact the secretariat with any questions.`
        };
    }
    return null;
}

/**
 * Which notice a write of a vet incident is: 'reported' (created) or the new
 * outcome ('confirmed', 'overturned', 'withdrawn'); null when none. One
 * notice per incident and key (onIncidentWritten uses it in its document ids).
 */
export function vetDecisionNoticeKey(before, after) {
    if (!buildVetDecisionDriverMessage(before, after)) return null;
    return before ? after.vetStrike.outcome : 'reported';
}

/**
 * Whether the writer's roles allow the notice: the vet's report, and its
 * withdrawal, by the vet, the TD or an admin; a decision by the TD or an
 * admin only.
 */
export function canSendVetNotice(key, roles = []) {
    const has = (role) => roles.includes(role);
    if (key === 'reported' || key === 'withdrawn') return has('vet') || has('td') || has('admin');
    return has('td') || has('admin');
}

/**
 * The e-mail of a driver notice: Swedish, then English (the driver's
 * language is not known for mail). -> { subject, text }
 */
export function vetDecisionMailContent(message = {}) {
    const subject = message.titleEn && message.titleEn !== message.title
        ? `${message.title} / ${message.titleEn}`
        : message.title;
    const text = message.bodyEn ? `${message.body}\n\n---\n\n${message.bodyEn}` : message.body;
    return { subject: clean(subject, 200), text };
}
