// Whether a printed result list is provisional or official (pure helpers, see
// pdfResultStatus.js for the lookup and pdfBase.js for the printed lines).
//
// A list is official when every result on it is finalized (the lock documents
// competitions/{id}/{discipline}Finalization/{startNumber}) or when the
// competition is archived; otherwise it is provisional.

export const RESULT_STATUS = Object.freeze({ OFFICIAL: 'official', PROVISIONAL: 'provisional' });
export const RESULT_DISCIPLINES = Object.freeze(['dressage', 'marathon', 'precision']);

const isStatus = (value) => value === RESULT_STATUS.OFFICIAL || value === RESULT_STATUS.PROVISIONAL;
const cleanStartNumber = (value) => String(value ?? '').trim();

/** An archived competition (finalizeCompetition: locked, status 'completed') */
export function isCompetitionArchived(competition) {
    return !!competition && (competition.locked === true || competition.status === 'completed');
}

function hasStartNumber(set, startNumber) {
    if (set instanceof Set) return set.has(startNumber);
    if (Array.isArray(set)) return set.map(cleanStartNumber).includes(startNumber);
    return false;
}

/**
 * 'official' or 'provisional'.
 * required: [{ discipline, startNumber }] the results the list shows
 * finalized: { [discipline]: Set | string[] } the finalized start numbers
 * override: a status decided by the caller (the archive's PDF is official)
 * An empty list is provisional: nothing on it has been approved.
 */
export function decideResultStatus({ archived = false, override = null, required = [], finalized = {} } = {}) {
    if (isStatus(override)) return override;
    if (archived) return RESULT_STATUS.OFFICIAL;
    const list = (Array.isArray(required) ? required : [])
        .filter((item) => item && RESULT_DISCIPLINES.includes(item.discipline) && cleanStartNumber(item.startNumber));
    if (!list.length) return RESULT_STATUS.PROVISIONAL;
    const allFinalized = list.every(({ discipline, startNumber }) =>
        hasStartNumber(finalized?.[discipline], cleanStartNumber(startNumber)));
    return allFinalized ? RESULT_STATUS.OFFICIAL : RESULT_STATUS.PROVISIONAL;
}

/** One discipline's list: every start number on it */
export function requiredForDiscipline(discipline, startNumbers = []) {
    return (Array.isArray(startNumbers) ? startNumbers : [])
        .map(cleanStartNumber)
        .filter(Boolean)
        .map((startNumber) => ({ discipline, startNumber }));
}

const isWithdrawnRow = (row = {}) => row.isWithdrawn === true
    || /struken|withdrawn|scratched/i.test(String(row.status || ''));

/**
 * The total list (and the team list's members): a combined result is official
 * only when every phase of every row is finalized, also a phase no one has
 * started yet (else a list printed before the marathon would read official).
 * `disciplines` narrows it for a competition without some phase. Withdrawn
 * rows have no result to approve.
 */
export function requiredForTotalRows(rows = [], { disciplines = RESULT_DISCIPLINES } = {}) {
    const required = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row || isWithdrawnRow(row) || !cleanStartNumber(row.startNumber)) return;
        disciplines.forEach((discipline) => {
            required.push({ discipline, startNumber: cleanStartNumber(row.startNumber) });
        });
    });
    return required;
}

/** The printed time: "2026-05-16 14:05" (local time) */
export function formatPrintedAt(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The dictionary keys of the printed lines for a status */
export function resultStatusKeys(status) {
    const official = status === RESULT_STATUS.OFFICIAL;
    return {
        title: official ? 'pdf_status_official' : 'pdf_status_provisional',
        printed: official ? 'pdf_status_published_at' : 'pdf_status_printed_at',
        signature: official ? 'pdf_ground_jury_president' : null
    };
}
