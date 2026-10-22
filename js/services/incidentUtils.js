// The incident / protest / ground jury decision log: entry checks, numbers,
// the CSV for the TD report and the links between corrections and entries.
// Pure helpers (see incidentService.js and pages/shared/incidents.js); the
// rules check the same shape (firestore.rules, isIncidentEntry).

export const INCIDENT_TYPES = Object.freeze(['protest', 'incident', 'groundJury', 'vet', 'other']);
export const INCIDENT_STATUSES = Object.freeze(['open', 'decided', 'closed']);
export const INCIDENT_DISCIPLINES = Object.freeze(['', 'general', 'dressage', 'marathon', 'precision']);

export const INCIDENT_TYPE_LABELS = Object.freeze({
    protest: { sv: 'Protest', en: 'Protest' },
    incident: { sv: 'Incident', en: 'Incident' },
    groundJury: { sv: 'Domarkollegiets beslut', en: 'Ground jury decision' },
    vet: { sv: 'Veterinärbeslut', en: 'Veterinary decision' },
    other: { sv: 'Övrigt', en: 'Other' }
});

export const INCIDENT_STATUS_LABELS = Object.freeze({
    open: { sv: 'Öppen', en: 'Open' },
    decided: { sv: 'Beslutad', en: 'Decided' },
    closed: { sv: 'Avslutad', en: 'Closed' }
});

export const INCIDENT_DISCIPLINE_LABELS = Object.freeze({
    '': { sv: '–', en: '–' },
    general: { sv: 'Allmänt', en: 'General' },
    dressage: { sv: 'Dressyr', en: 'Dressage' },
    marathon: { sv: 'Maraton', en: 'Marathon' },
    precision: { sv: 'Precision', en: 'Cones' }
});

export const INCIDENT_LIMITS = Object.freeze({
    description: 4000,
    decision: 4000,
    decidedBy: 200,
    startNumber: 20,
    obstacle: 100,
    receivedAt: 40
});

const text = (value, max) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function labelFor(labels, key, lang = 'sv') {
    const entry = labels[key] || labels[''] || null;
    if (!entry) return String(key ?? '');
    return lang === 'en' ? entry.en : entry.sv;
}

/** "2026-05-16T14:05" for a date (local time), the form's datetime-local value */
export function toLocalDateTimeValue(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Checks and cleans an entry from the form. Returns { ok, errors, entry }:
 * errors are dictionary keys (incident_error_*), entry has only the stored
 * fields (no number, writer or times: incidentService adds them).
 */
export function validateIncidentEntry(raw = {}) {
    const errors = [];
    const type = String(raw.type || '');
    const status = String(raw.status || 'open');
    const discipline = String(raw.discipline ?? '');
    const description = text(raw.description, INCIDENT_LIMITS.description + 1);
    const startNumber = oneLine(raw.startNumber, INCIDENT_LIMITS.startNumber + 1).replace(/^#/, '');
    const receivedAt = oneLine(raw.receivedAt, INCIDENT_LIMITS.receivedAt);
    const decision = text(raw.decision, INCIDENT_LIMITS.decision + 1);
    const decidedBy = oneLine(raw.decidedBy, INCIDENT_LIMITS.decidedBy);

    if (!INCIDENT_TYPES.includes(type)) errors.push('incident_error_type');
    if (!INCIDENT_STATUSES.includes(status)) errors.push('incident_error_status');
    if (!INCIDENT_DISCIPLINES.includes(discipline)) errors.push('incident_error_discipline');
    if (!description) errors.push('incident_error_description');
    if (description.length > INCIDENT_LIMITS.description || decision.length > INCIDENT_LIMITS.decision) errors.push('incident_error_too_long');
    if (startNumber.length > INCIDENT_LIMITS.startNumber || (startNumber && !/^[\w-]+$/.test(startNumber))) errors.push('incident_error_start_number');
    if (receivedAt && Number.isNaN(Date.parse(receivedAt))) errors.push('incident_error_received');
    // A decision needs its text and who decided
    if ((status === 'decided' || status === 'closed') && type !== 'other' && type !== 'incident' && !decision) {
        errors.push('incident_error_decision');
    }

    const entry = {
        type,
        status,
        receivedAt,
        startNumber,
        discipline,
        obstacle: oneLine(raw.obstacle, INCIDENT_LIMITS.obstacle),
        description,
        decision,
        decidedBy
    };
    return { ok: errors.length === 0, errors, entry };
}

/**
 * The fields of a checked entry (validateIncidentEntry) that differ from the
 * stored copy `before`: what an update writes, so a concurrent change of
 * another field is not overwritten with the old value. A field missing in
 * `before` counts as '' (the form's empty value).
 */
export function changedIncidentFields(before = {}, entry = {}) {
    const out = {};
    Object.entries(entry).forEach(([key, value]) => {
        const old = before?.[key] ?? '';
        if (String(old) !== String(value ?? '')) out[key] = value;
    });
    return out;
}

/** The next entry number (1, 2, ...): one above the highest so far */
export function nextIncidentNumber(incidents = []) {
    const max = (Array.isArray(incidents) ? incidents : [])
        .map((item) => Number(item?.number))
        .filter((n) => Number.isInteger(n) && n > 0)
        .reduce((a, b) => Math.max(a, b), 0);
    return max + 1;
}

/** Newest received first, then the highest number */
export function sortIncidents(incidents = []) {
    return [...(Array.isArray(incidents) ? incidents : [])].sort((a, b) => {
        const ta = Date.parse(a?.receivedAt || '') || 0;
        const tb = Date.parse(b?.receivedAt || '') || 0;
        if (tb !== ta) return tb - ta;
        return (Number(b?.number) || 0) - (Number(a?.number) || 0);
    });
}

export function filterIncidents(incidents = [], { type = '', status = '', startNumber = '', discipline = '' } = {}) {
    const sn = String(startNumber || '').trim().replace(/^#/, '');
    return (Array.isArray(incidents) ? incidents : []).filter((item) =>
        (!type || item?.type === type)
        && (!status || item?.status === status)
        && (!discipline || item?.discipline === discipline)
        && (!sn || String(item?.startNumber ?? '').trim() === sn));
}

// --- Corrections (the secretariat's auditLog) and the entries they name ---

/** The number a correction's reference names ("3", "Nr 3", "#3", "P-3" -> "3") */
export function referenceNumber(reference) {
    const value = String(reference?.value ?? '').trim();
    const match = value.match(/(\d+)/);
    return match ? match[1] : '';
}

/** The entry a correction's reference (protest no. / ground jury decision) names, or null */
export function matchIncidentForReference(incidents = [], reference = null) {
    if (!reference || !['protest', 'groundJury'].includes(reference.type)) return null;
    const number = referenceNumber(reference);
    if (!number) return null;
    const list = Array.isArray(incidents) ? incidents : [];
    const wantedType = reference.type === 'protest' ? 'protest' : 'groundJury';
    return list.find((item) => String(item?.number) === number && item?.type === wantedType)
        || list.find((item) => String(item?.number) === number)
        || null;
}

/** The corrections that name an entry */
export function correctionsForIncident(auditEntries = [], incident = null, incidents = []) {
    if (!incident) return [];
    const all = Array.isArray(incidents) && incidents.length ? incidents : [incident];
    return (Array.isArray(auditEntries) ? auditEntries : [])
        .filter((entry) => matchIncidentForReference(all, entry?.reference)?.id === incident.id);
}

export function filterAuditEntries(entries = [], { discipline = '', startNumber = '' } = {}) {
    const sn = String(startNumber || '').trim().replace(/^#/, '');
    return (Array.isArray(entries) ? entries : []).filter((entry) =>
        (!discipline || entry?.discipline === discipline)
        && (!sn || String(entry?.startNumber ?? '').trim() === sn));
}

/** A correction's changes as one line: "timeMs: 61000 → 60500; ..." */
export function summarizeAuditChanges(changes = []) {
    const list = Array.isArray(changes) ? changes : [];
    const fmt = (v) => (v === null || v === undefined || v === '' ? '–' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    return list.slice(0, 12)
        .map((c) => `${c?.field ?? '?'}: ${fmt(c?.oldValue)} → ${fmt(c?.newValue)}`)
        .join('; ');
}

// --- Export for the TD report ---

function csvCell(value) {
    const s = String(value ?? '');
    // Formulas are not run when the file is opened in a spreadsheet
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const INCIDENT_CSV_COLUMNS = Object.freeze([
    ['number', { sv: 'Nr', en: 'No.' }],
    ['type', { sv: 'Typ', en: 'Type' }],
    ['receivedAt', { sv: 'Mottagen', en: 'Received' }],
    ['startNumber', { sv: 'Startnr', en: 'Start no.' }],
    ['discipline', { sv: 'Gren', en: 'Discipline' }],
    ['obstacle', { sv: 'Hinder/moment', en: 'Obstacle/phase' }],
    ['description', { sv: 'Beskrivning', en: 'Description' }],
    ['decision', { sv: 'Beslut', en: 'Decision' }],
    ['decidedBy', { sv: 'Beslutat av', en: 'Decided by' }],
    ['status', { sv: 'Status', en: 'Status' }]
]);

/** The values of one entry as printed (labels, not codes) */
export function incidentDisplayRow(item = {}, lang = 'sv') {
    return {
        number: item.number ?? '',
        type: labelFor(INCIDENT_TYPE_LABELS, item.type, lang),
        receivedAt: String(item.receivedAt || '').replace('T', ' '),
        startNumber: item.startNumber ? `#${item.startNumber}` : '',
        discipline: item.discipline ? labelFor(INCIDENT_DISCIPLINE_LABELS, item.discipline, lang) : '',
        obstacle: item.obstacle || '',
        description: item.description || '',
        decision: item.decision || '',
        decidedBy: item.decidedBy || '',
        status: labelFor(INCIDENT_STATUS_LABELS, item.status, lang)
    };
}

/** CSV (semicolon separated, as the other exports) in number order */
export function incidentsToCsv(incidents = [], { lang = 'sv' } = {}) {
    const rows = [...(Array.isArray(incidents) ? incidents : [])]
        .sort((a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0));
    const header = INCIDENT_CSV_COLUMNS.map(([, label]) => csvCell(lang === 'en' ? label.en : label.sv)).join(';');
    const lines = rows.map((item) => {
        const row = incidentDisplayRow(item, lang);
        return INCIDENT_CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(';');
    });
    return [header, ...lines].join('\r\n');
}
