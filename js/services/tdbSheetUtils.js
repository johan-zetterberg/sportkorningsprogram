// TDB-underlag: what to type into TDB (Svensk Ridsport "RESULTAT Tävling
// Sportkörning") for each result list. TDB has no file import for
// sportkörning, so this is only a helper that shows, prints and copies.
//
// Rules of the guide (2026-03-04):
//  - one row per ekipage that started, in the order of the competition; TDB
//    does not sort, so the placing is typed by hand
//  - placing code: utesluten / utgått / avstår / struken after the start = 99,
//    clear round passed = 1, not passed = 98, a list with one ekipage = 0,
//    otherwise the place (shared places allowed). Ekipage that never started
//    are left out
//  - result rows: one per moment driven (D, M, P) with its penalty, plus the
//    total; a moment that was not driven gets no row
//  - 0* classes: placings but no result rows (results are hidden publicly)
//  - a list without any starter is marked "Klassen har utgått" in TDB
//  - results go to SvRF within 5 days after the competition (TR I 134.4)

const MOMENTS = ['D', 'M', 'P'];
const DEADLINE_DAYS = 5;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Penalty text with 2 decimals as the PDFs ('' when there is none) */
export function formatTdbPenalty(value, { decimalSeparator = ',' } = {}) {
    if (!isNum(value)) return '';
    return value.toFixed(2).replace('.', decimalSeparator);
}

function isWithdrawn(row) {
    if (row.struken === true || row.withdrawn === true || row.scratched === true || row.isWithdrawn === true) return true;
    return /struken|withdrawn|scratched/i.test(String(row.status || ''));
}

function isRetired(row) {
    if (row.retired === true) return true;
    return /utg[åa]tt|utgick|retired|avst[åa]r|withdrew/i.test(String(row.status || ''));
}

// A 0* class (0*, "Klass 0*"): results are not shown publicly
export function isZeroStarClassName(name) {
    return /(^|[^\d])0\s*\*/.test(String(name || ''));
}

// The result of one moment: { moment, penalty (null when only eliminated), eliminated } or null when not driven
function momentResult(moment, part, penaltyValue) {
    const raw = penaltyValue;
    const eliminated = part?.eliminated === true || raw === Infinity;
    const penalty = isNum(raw) ? raw : null;
    if (penalty === null && !eliminated) return null;
    return { moment, penalty, eliminated };
}

function momentsOf(row) {
    return [
        momentResult('D', row.dressage, row.dressage?.penalty),
        momentResult('M', row.marathon, row.marathon?.totalPenalty),
        momentResult('P', row.precision, row.precision?.totalPenalty ?? row.precision?.pen)
    ].filter(Boolean);
}

function driverLicenceOf(row) {
    return String(row.licence ?? row.license ?? row.driverLicence ?? row.driverLicense ?? '').trim();
}

function horsesOf(row) {
    const list = Array.isArray(row.horses) ? row.horses : [];
    const mapped = list.map((h) => {
        if (typeof h === 'string') return { name: h, licence: '', regNo: '' };
        const regNo = String(h?.regNo ?? '').trim();
        return {
            name: String(h?.name ?? h?.horseName ?? h?.namn ?? '').trim(),
            licence: String(h?.license ?? h?.licence ?? '').trim() || regNo,
            regNo
        };
    }).filter((h) => h.name || h.licence || h.regNo);
    if (!mapped.length && row.horseName) mapped.push({ name: String(row.horseName).trim(), licence: '', regNo: '' });
    return mapped;
}

function placeOf(row) {
    const candidates = [row.archivedPlac, row.plac];
    for (const v of candidates) {
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function groupKeyOf(row) {
    return String(row._mergedKey || `CLASS:${row.className || '-'}`);
}

// The TDB classes a list covers (number + label), from the equipages' TDB fields
function tdbClassesOf(rows, knownClasses) {
    const known = new Map();
    (Array.isArray(knownClasses) ? knownClasses : []).forEach((c) => {
        const number = c?.number ?? c?.tdbClassNumber;
        if (number === null || number === undefined || number === '') return;
        known.set(String(number), String(c?.label ?? c?.tdbClassLabel ?? ''));
    });
    const out = new Map();
    rows.forEach((row) => {
        const raw = row.tdbClassNumber;
        const hasNumber = raw !== null && raw !== undefined && raw !== '';
        const number = hasNumber ? String(raw) : null;
        const label = String(row.tdbClassLabel || row.tdbOriginalXmlClassName || (number && known.get(number)) || row.className || '').trim();
        const key = number !== null ? `N:${number}` : `L:${label}`;
        if (!out.has(key)) out.set(key, { number, label });
    });
    return [...out.values()].sort((a, b) => {
        if (a.number !== null && b.number !== null) return Number(a.number) - Number(b.number) || a.label.localeCompare(b.label, 'sv');
        if (a.number !== null) return -1;
        if (b.number !== null) return 1;
        return a.label.localeCompare(b.label, 'sv');
    });
}

/**
 * The TDB sheet: one list per placing group (merged classes are one list).
 * rows: result rows as the reports page / total results build them (dressage,
 * marathon, precision, totalPenalty, isEliminated, plac, _mergedKey/_mergedLabel,
 * marathon.clearRoundApproved); for an archived competition the rows carry the
 * archived values (archivedPlac).
 * options: { classes, competition, isClearRoundClass(className), isZeroStarClass(label) }
 */
export function buildTdbSheet(rows = [], options = {}) {
    const { classes = [], isClearRoundClass = null, isZeroStarClass = isZeroStarClassName, decimalSeparator = ',' } = options;
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row) return;
        const key = groupKeyOf(row);
        if (!groups.has(key)) groups.set(key, { key, label: row._mergedLabel || row.className || '', rows: [] });
        groups.get(key).rows.push(row);
    });

    const lists = [...groups.values()].map((group) => {
        const tdbClasses = tdbClassesOf(group.rows, classes);
        const clearRound = group.rows.some((row) => row.isClearRound === true
            || row.marathon?.isClearRound === true
            || (typeof isClearRoundClass === 'function' && isClearRoundClass(row.className)));
        const zeroStar = [group.label, ...tdbClasses.map((c) => c.label), ...group.rows.map((r) => r.className)]
            .some((name) => isZeroStarClass(name));

        // Started ekipage in the order of the competition (start number)
        const started = [];
        group.rows.forEach((row) => {
            const moments = momentsOf(row);
            const withdrawn = isWithdrawn(row);
            const retired = isRetired(row);
            const eliminated = !withdrawn && (row.isEliminated === true || row.totalPenalty === Infinity
                || moments.some((m) => m.eliminated));
            const didStart = moments.length > 0 || eliminated;
            if (!didStart) return; // never started: left out of TDB
            started.push({ row, moments, withdrawn, retired, eliminated });
        });
        started.sort((a, b) => (Number(a.row.startNumber) || 0) - (Number(b.row.startNumber) || 0));
        const single = started.length === 1;

        const built = started.map(({ row, moments, withdrawn, retired, eliminated }) => {
            let placingCode;
            let reason;
            if (withdrawn || retired || eliminated) {
                placingCode = 99;
                reason = eliminated ? 'eliminated' : (withdrawn ? 'withdrawn' : 'retired');
            } else if (clearRound) {
                const approved = row.marathon?.clearRoundApproved === true || row.clearRoundApproved === true;
                placingCode = approved ? 1 : 98;
                reason = approved ? 'clearRoundPassed' : 'clearRoundFailed';
            } else if (single) {
                placingCode = 0;
                reason = 'single';
            } else {
                placingCode = placeOf(row);
                reason = placingCode === null ? 'missing' : 'place';
            }
            const total = (placingCode === 99 || !isNum(row.totalPenalty)) ? null : row.totalPenalty;
            const shownMoments = zeroStar ? [] : moments.map((m) => ({
                moment: m.moment,
                penalty: m.penalty,
                penaltyText: m.eliminated && m.penalty === null ? 'ELIM' : formatTdbPenalty(m.penalty, { decimalSeparator }),
                eliminated: m.eliminated
            }));
            return {
                placingCode,
                placingLabel: placingCode === null ? '' : String(placingCode),
                reason,
                startNumber: row.startNumber ?? '',
                driverName: String(row.driverName || '').trim(),
                driverLicence: driverLicenceOf(row),
                horses: horsesOf(row),
                moments: shownMoments,
                total: zeroStar ? null : total,
                totalText: zeroStar ? '' : formatTdbPenalty(total, { decimalSeparator })
            };
        });

        // Places ascending (shared places by start number), then 0, 98, 99
        const rank = (code) => (code === null ? 1000 : (code >= 1 && code < 98 ? code : (code === 0 ? 2000 : 3000 + code)));
        const entries = built
            .map((entry, i) => ({ entry, i }))
            .sort((a, b) => rank(a.entry.placingCode) - rank(b.entry.placingCode) || a.i - b.i)
            .map(({ entry }, index) => ({ order: index + 1, ...entry }));

        const list = {
            groupKey: group.key,
            groupLabel: group.label,
            tdbClasses,
            status: entries.length ? 'ok' : 'noResults',
            clearRound,
            entries
        };
        if (zeroStar) list.zeroStar = true;
        return list;
    });

    return lists.sort((a, b) => String(a.groupLabel).localeCompare(String(b.groupLabel), 'sv', { numeric: true, sensitivity: 'base' }));
}

/** The latest ISO date (YYYY-MM-DD) in a text like "2026-05-15 - 2026-05-17", or null */
export function lastCompetitionDate(competition = {}) {
    const text = [competition?.dates, competition?.date, competition?.endDate].filter(Boolean).join(' ');
    const found = (text.match(/\d{4}-\d{2}-\d{2}/g) || []).filter((iso) => {
        const d = new Date(`${iso}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
    });
    if (!found.length) return null;
    return found.sort()[found.length - 1];
}

/** Results go to SvRF within 5 days after the last competition day (TR I 134.4): ISO date, null if the dates are unknown */
export function deadlineFor(competition = {}) {
    const last = lastCompetitionDate(competition);
    if (!last) return null;
    const d = new Date(`${last}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + DEADLINE_DAYS);
    return d.toISOString().slice(0, 10);
}

/** Tab-separated text of one list for pasting (header row first) */
export function tdbListToText(list, { headers = {}, decimalSeparator = ',' } = {}) {
    const h = { place: 'Plac', driver: 'Kusk', driverLicence: 'Kusklicens', horses: 'Häst', horseLicences: 'Hästlicens/reg.nr', D: 'D', M: 'M', P: 'P', total: 'Totalt', ...headers };
    const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
    const lines = [[h.place, h.driver, h.driverLicence, h.horses, h.horseLicences, h.D, h.M, h.P, h.total].join('\t')];
    (list?.entries || []).forEach((e) => {
        const byMoment = Object.fromEntries((e.moments || []).map((m) => [m.moment, m]));
        const cell = (k) => (byMoment[k] ? clean(byMoment[k].penaltyText ?? formatTdbPenalty(byMoment[k].penalty, { decimalSeparator })) : '');
        lines.push([
            e.placingLabel,
            clean(e.driverName),
            clean(e.driverLicence),
            clean((e.horses || []).map((x) => x.name).join(' / ')),
            clean((e.horses || []).map((x) => x.licence || x.regNo).join(' / ')),
            cell('D'), cell('M'), cell('P'),
            clean(e.totalText ?? formatTdbPenalty(e.total, { decimalSeparator }))
        ].join('\t'));
    });
    return lines.join('\n');
}

export const TDB_MOMENTS = MOMENTS;
export const TDB_REPORT_URL = 'https://ridsport.se/tavling/arrangera-tavling/resultatrapportering';
