import { getCurrentLanguage, t } from '../../utils/i18n.js';
// An archived competition shows the results it was archived with: the result
// pages recalculate from raw data, so a later change of the calculation rules
// would otherwise alter results that were already published as final.

export function isArchivedCompetition(competition = {}) {
    return competition?.locked === true || competition?.status === 'completed';
}

/**
 * Puts the archived values (archive snapshot rows, by start number) on result
 * rows built by the result pages: discipline penalties, total and elimination.
 * Placings are then made from these values. Rows without a snapshot row (none
 * in the archive) are left as calculated. Returns the number of rows changed.
 */
export function applyArchivedSnapshot(rows = [], snapshot = null) {
    if (!snapshot || !Array.isArray(snapshot.rows)) return 0;
    const bySn = new Map(snapshot.rows.map((row) => [String(row.startNumber), row]));
    let changed = 0;
    rows.forEach((row) => {
        const archived = bySn.get(String(row?.startNumber));
        if (!archived) return;
        row.dressage = {
            ...(row.dressage || {}),
            penalty: archived.dressagePenalty,
            ...(typeof archived.dressageEliminated === 'boolean' ? { eliminated: archived.dressageEliminated } : {}),
            ...(archived.dressageStatus ? { status: archived.dressageStatus } : {})
        };
        row.marathon = {
            ...(row.marathon || {}),
            totalPenalty: archived.marathonPenalty,
            ...(typeof archived.marathonEliminated === 'boolean' ? { eliminated: archived.marathonEliminated } : {}),
            ...(archived.marathonStatus ? { status: archived.marathonStatus } : {}),
            ...(Number.isFinite(archived.marathonBPenalty) ? { bPenalty: archived.marathonBPenalty } : {})
        };
        row.precision = {
            ...(row.precision || {}),
            pen: archived.precisionPenalty,
            totalPenalty: archived.precisionPenalty,
            ...(typeof archived.precisionEliminated === 'boolean' ? { eliminated: archived.precisionEliminated } : {}),
            ...(archived.precisionStatus ? { status: archived.precisionStatus } : {}),
            ...(Number.isFinite(archived.precisionTimeMs) ? { timeMs: archived.precisionTimeMs } : {})
        };
        if (archived.plac !== undefined && archived.plac !== null) {
            row.archivedPlac = archived.plac;
        }
        if (archived.dressagePlace !== undefined) {
            row.archivedDressagePlace = archived.dressagePlace;
            row.posDress = archived.dressagePlace;
        }
        if (archived.marathonPlace !== undefined) {
            row.archivedMarathonPlace = archived.marathonPlace;
            row.posMar = archived.marathonPlace;
        }
        if (archived.precisionPlace !== undefined) {
            row.archivedPrecisionPlace = archived.precisionPlace;
            row.posPrec = archived.precisionPlace;
        }
        row.totalPenalty = archived.totalPenalty;
        row.isEliminated = archived.isEliminated === true;
        row.isOngoing = false;
        row.fromArchive = true;
        changed++;
    });
    return changed;
}

const DISCIPLINE_PENALTY_FIELD = {
    dressage: 'dressagePenalty',
    marathon: 'marathonPenalty',
    precision: 'precisionPenalty',
    total: 'totalPenalty'
};

const DISCIPLINE_ELIM_FIELD = {
    dressage: 'dressageEliminated',
    marathon: 'marathonEliminated',
    precision: 'precisionEliminated',
    total: 'isEliminated'
};

const DISCIPLINE_PLACE_FIELD = {
    dressage: 'dressagePlace',
    marathon: 'marathonPlace',
    precision: 'precisionPlace',
    total: 'plac'
};

const DISCIPLINE_STATUS_FIELD = {
    dressage: 'dressageStatus',
    marathon: 'marathonStatus',
    precision: 'precisionStatus',
    total: 'status'
};

/**
 * The archived penalty of one discipline ('dressage' | 'marathon' |
 * 'precision', or 'total') for a start number, for the discipline result
 * pages. found is false when the snapshot has no row for it (the row stays as
 * calculated). Newer snapshots store per-discipline elimination explicitly;
 * older snapshots only have the competition-level elimination: isEliminated
 * is false for a row that is not eliminated and null for an eliminated one
 * (the discipline cannot be told), so the page keeps its own.
 */
export function archivedDisciplinePenalty(snapshot, startNumber, discipline) {
    const field = DISCIPLINE_PENALTY_FIELD[discipline];
    const none = { found: false, penalty: null, isEliminated: false };
    if (!field || !snapshot || !Array.isArray(snapshot.rows) || startNumber == null) return none;
    const archived = snapshot.rows.find((row) => String(row?.startNumber) === String(startNumber));
    if (!archived) return none;
    const value = archived[field];
    const penalty = (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) ? null : Number(value);
    const elimField = DISCIPLINE_ELIM_FIELD[discipline];
    let isEliminated = false;
    if (elimField && typeof archived[elimField] === 'boolean' && discipline !== 'total') {
        isEliminated = archived[elimField];
    } else if (archived.isEliminated === true) {
        // Older snapshot (no per-discipline field): only the total is known to
        // be eliminated. For a discipline it may have been another one, or this
        // one never started: null, so the page shows its own calculation.
        isEliminated = discipline === 'total' ? true : null;
    }
    return { found: true, penalty, isEliminated };
}

export function archivedDisciplineDetails(snapshot, startNumber, discipline) {
    const base = archivedDisciplinePenalty(snapshot, startNumber, discipline);
    if (!base.found) {
        return { ...base, place: null, status: null, bPenalty: null, timeMs: null };
    }
    const archived = snapshot.rows.find((row) => String(row?.startNumber) === String(startNumber)) || {};
    const placeField = DISCIPLINE_PLACE_FIELD[discipline];
    const statusField = DISCIPLINE_STATUS_FIELD[discipline];
    const rawPlace = placeField ? archived[placeField] : null;
    const place = (rawPlace === null || rawPlace === undefined || rawPlace === '' || !Number.isFinite(Number(rawPlace)))
        ? null
        : Number(rawPlace);
    return {
        ...base,
        place,
        status: (statusField && archived[statusField]) || null,
        bPenalty: Number.isFinite(Number(archived.marathonBPenalty)) && archived.marathonBPenalty !== null ? Number(archived.marathonBPenalty) : null,
        timeMs: Number.isFinite(Number(archived.precisionTimeMs)) && archived.precisionTimeMs !== null ? Number(archived.precisionTimeMs) : null
    };
}

/** The notice an archived result page shows above its results */
export function archivedNoticeText(snapshot) {
    const archivedAt = Number(snapshot?.archivedAt);
    // The page's language (Swedish where it cannot be read, e.g. without storage)
    let lang = 'sv';
    try { lang = getCurrentLanguage(); } catch { }
    const date = Number.isFinite(archivedAt) && archivedAt > 0
        ? ` (${new Date(archivedAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'sv-SE')})`
        : '';
    let template = 'Arkiverat resultat{date}: placeringar och poäng visas som när tävlingen avslutades.';
    try { template = t('archived_result_notice'); } catch { }
    return template.replace('{date}', date);
}

/** The same notice as markup (amber box, as on the total results), '' without a snapshot */
export function archivedNoticeHtml(snapshot, extraClass = 'mb-3') {
    if (!snapshot) return '';
    // The text is built from a date only: nothing to escape
    return `<div data-archived-notice class="${extraClass} p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200">${archivedNoticeText(snapshot)}</div>`;
}

/** The snapshot the competition was archived with, or null */
export async function loadArchiveSnapshot(competition) {
    if (!isArchivedCompetition(competition) || !competition?.archiveSnapshotId || !competition?.id) return null;
    try {
        const [{ db, appId }, { doc, getDoc }] = await Promise.all([
            import('../../config/firebase-config.js'),
            import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js')
        ]);
        const snap = await getDoc(doc(db, `artifacts/${appId}/public/data/competitions/${competition.id}/archive/${competition.archiveSnapshotId}`));
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        console.warn('Kunde inte läsa arkivresultatet; resultaten räknas fram.', error);
        return null;
    }
}
