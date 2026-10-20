// Changed start times on a published list (admin → Starttider): which times
// changed, the change stamps stored with them (config/startTimes.changes, the
// driver portal shows "ändrad HH:MM"), "skjut resten X minuter", and the
// message offered to the drivers concerned. Pure. Times are the page's local
// 'YYYY-MM-DDTHH:MM' strings.

const DISCIPLINES = ['dressage', 'marathon', 'precision'];
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DDTHH:MM' → 'HH:MM' ('' for anything else) */
export function clockOf(value) {
    const m = TIME_RE.exec(String(value || ''));
    return m ? `${m[4]}:${m[5]}` : '';
}

function parseLocal(value) {
    const m = TIME_RE.exec(String(value || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

function formatLocal(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A local time moved by minutes (null for a value that is not a time) */
export function addMinutes(value, minutes) {
    const date = parseLocal(value);
    if (!date) return null;
    date.setMinutes(date.getMinutes() + Math.round(Number(minutes) || 0));
    return formatLocal(date);
}

/**
 * The times that changed on published disciplines since the baseline:
 * [{ startNumber, discipline, from, to }]. A time set for the first time or
 * removed counts too (from/to ''), a draft discipline does not.
 */
export function detectPublishedTimeChanges(current = {}, baseline = {}, publishedFlags = {}) {
    const changes = [];
    const numbers = new Set([...Object.keys(current || {}), ...Object.keys(baseline || {})]);
    numbers.delete('published');
    [...numbers].sort((a, b) => a.localeCompare(b, 'sv', { numeric: true })).forEach((sn) => {
        DISCIPLINES.forEach((discipline) => {
            if (publishedFlags?.[discipline] !== true) return;
            const from = String(baseline?.[sn]?.[discipline] || '');
            const to = String(current?.[sn]?.[discipline] || '');
            if (from !== to) changes.push({ startNumber: sn, discipline, from, to });
        });
    });
    return changes;
}

/**
 * The stamps to merge into config/startTimes.changes:
 * { [sn]: { at, by, fields: { [discipline]: { from, to, at } } } }.
 * Merged per discipline, so an earlier change of another discipline stays.
 */
export function buildChangeStamps(changes = [], { at = Date.now(), by = '' } = {}) {
    const out = {};
    changes.forEach(({ startNumber, discipline, from, to }) => {
        const sn = String(startNumber);
        if (!out[sn]) out[sn] = { at, by: String(by || ''), fields: {} };
        out[sn].fields[discipline] = { from: String(from || ''), to: String(to || ''), at };
    });
    return out;
}

/**
 * "ändrad HH:MM" for the driver: the clock time of the latest change of a
 * published time, while the time shown is still the changed one. null when
 * the time was not changed after publishing.
 */
export function startTimeChangedAt(changesConfig = {}, startNumber, discipline, currentValue) {
    const field = changesConfig?.[String(startNumber)]?.fields?.[discipline];
    if (!field || !currentValue || String(field.to || '') !== String(currentValue)) return null;
    const at = Number(field.at);
    if (!Number.isFinite(at) || at <= 0) return null;
    const date = new Date(at);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * "Skjut resten X minuter": the times of one discipline (and class, when
 * given) from a start number or a time onwards, moved by minutes. Starts
 * already started (time before now) are left. Returns [{ startNumber, from,
 * to }] in start order; startTimes is not changed (applyTimeShift does).
 */
export function planTimeShift(startTimes = {}, equipages = [], {
    discipline,
    minutes,
    fromStartNumber = '',
    fromTime = '',
    className = '',
    now = new Date()
} = {}) {
    const shift = Math.round(Number(minutes));
    if (!DISCIPLINES.includes(discipline) || !Number.isFinite(shift) || shift === 0) return [];
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    const rows = (Array.isArray(equipages) ? equipages : [])
        .filter(e => !className || String(e?._mergedLabel || e?.className || '') === className)
        .map((e) => {
            const sn = String(e?.startNumber ?? '');
            const value = startTimes?.[sn]?.[discipline] || '';
            return { startNumber: sn, value, date: parseLocal(value) };
        })
        .filter(row => row.startNumber && row.date)
        .sort((a, b) => a.date - b.date || a.startNumber.localeCompare(b.startNumber, 'sv', { numeric: true }));

    let threshold = null;
    if (fromStartNumber !== '' && fromStartNumber != null) {
        const anchor = rows.find(row => row.startNumber === String(fromStartNumber).trim());
        if (!anchor) return [];
        threshold = anchor.date.getTime();
    } else if (fromTime) {
        const fromDate = parseLocal(fromTime);
        if (!fromDate) return [];
        threshold = fromDate.getTime();
    } else {
        return [];
    }

    return rows
        .filter(row => row.date.getTime() >= threshold)
        .filter(row => !Number.isFinite(nowMs) || row.date.getTime() > nowMs)
        .map(row => ({ startNumber: row.startNumber, from: row.value, to: addMinutes(row.value, shift) }));
}

/** Writes a planned shift into the page's startTimes (mutates it) */
export function applyTimeShift(startTimes = {}, plan = [], discipline) {
    plan.forEach(({ startNumber, to }) => {
        if (!startTimes[startNumber]) startTimes[startNumber] = {};
        startTimes[startNumber][discipline] = to;
    });
    return startTimes;
}

/**
 * The message offered to the drivers concerned (audience: chosen drivers):
 * { title, body, titleEn, bodyEn, startNumbers }. translateTo(key, lang)
 * gives the dictionary text (i18n.js).
 */
export function buildStartTimeChangeMessage(changes = [], equipages = [], translateTo = (key) => key) {
    const byNumber = new Map((Array.isArray(equipages) ? equipages : []).map(e => [String(e?.startNumber ?? ''), e]));
    const startNumbers = [...new Set(changes.map(c => String(c.startNumber)))];
    const lineFor = (lang) => (c) => {
        const eq = byNumber.get(String(c.startNumber));
        const who = `#${c.startNumber}${eq?.driverName ? ` ${eq.driverName}` : ''}`;
        const discipline = translateTo(`starttime_discipline_${c.discipline}`, lang);
        const from = clockOf(c.from) || translateTo('starttime_none', lang);
        const to = clockOf(c.to) || translateTo('starttime_none', lang);
        const day = c.to && c.from && String(c.to).slice(0, 10) !== String(c.from).slice(0, 10) ? ` (${String(c.to).slice(0, 10)})` : '';
        return `${who} – ${discipline}: ${from} → ${to}${day}`;
    };
    // The message has a size limit (rules: 10 000 characters)
    const MAX_LINES = 100;
    const body = (lang) => {
        const lines = changes.slice(0, MAX_LINES).map(lineFor(lang));
        if (changes.length > MAX_LINES) lines.push(translateTo('starttime_change_msg_more', lang).replace('{n}', String(changes.length - MAX_LINES)));
        return [translateTo('starttime_change_msg_intro', lang), ...lines].join('\n');
    };
    return {
        title: translateTo('starttime_change_msg_title', 'sv'),
        titleEn: translateTo('starttime_change_msg_title', 'en'),
        body: body('sv'),
        bodyEn: body('en'),
        startNumbers
    };
}
