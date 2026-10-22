// The competition's global pause (config/globalStatus): "PAUSA TÄVLINGEN"
// stops every marathon clock, and the pause log is subtracted from the stage
// times (core-engine marathon.js). Each public entry records when, why and
// where in language-neutral codes; the text is made in the viewer's
// language. Who pressed and the free-text note are private (pauseDetails/
// {pauseDetailsId(start)} in the competition's private tree, read by the
// staff only): the public, the drivers and the monitors see time and reason.
// Pure: used by the observer page, the secretariat's marathon page (route
// banner) and the monitors. The rules (isPauseEntry, isPauseDetails) check
// the same shapes.

export const PAUSE_REASONS = Object.freeze(['accident', 'vet', 'course', 'weather', 'other']);
export const PAUSE_NOTE_MAX = 200;
const NAME_MAX = 80;

const trimTo = (value, max) => String(value ?? '').trim().slice(0, max);

/** { uid, name, role } of whoever pressed the button (no e-mail: the document is public) */
export function pauseActor({ uid = '', name = '', role = '' } = {}) {
    const actor = { uid: trimTo(uid, 128) };
    const n = trimTo(name, NAME_MAX);
    if (n) actor.name = n;
    const r = trimTo(role, 40);
    if (r) actor.role = r;
    return actor;
}

/**
 * A "where" code: 'obstacle:3', 'section:B', 'secretariat' (or ''). Shown
 * with describePauseWhere in the viewer's language.
 */
export function pauseWhere({ obstacle = null, section = '', place = '' } = {}) {
    if (Number.isInteger(Number(obstacle)) && Number(obstacle) > 0) return `obstacle:${Number(obstacle)}`;
    if (section) return `section:${trimTo(section, 20)}`;
    return trimTo(place, 40);
}

/** A new open pause entry (public: no note, no who) */
export function buildPauseEntry(nowIso, { reason = 'other', where = '' } = {}) {
    const entry = { start: String(nowIso), end: null, durationSec: null };
    entry.reason = PAUSE_REASONS.includes(reason) ? reason : 'other';
    const w = trimTo(where, 60);
    if (w) entry.where = w;
    return entry;
}

/** The id of a pause's private details: from its start ('p' + epoch ms), or '' */
export function pauseDetailsId(start) {
    const ms = new Date(start).getTime();
    return Number.isFinite(ms) && ms > 0 ? `p${ms}` : '';
}

/**
 * The private details of a press (pauseDetails/{id}): { start, note?, by? }
 * for a pause, { endedBy } for a resume; null when there is nothing to keep.
 */
export function buildPauseDetails(startIso, { note = '', by = null } = {}, { resume = false } = {}) {
    const actor = by && by.uid ? pauseActor(by) : null;
    if (resume) return actor ? { endedBy: actor } : null;
    const details = { start: String(startIso) };
    const n = trimTo(note, PAUSE_NOTE_MAX);
    if (n) details.note = n;
    if (actor) details.by = actor;
    return details.note || details.by ? details : null;
}

/** The open entry closed at nowIso (the reason and where kept) */
export function closePauseEntry(entry, nowIso) {
    const closed = { ...entry, end: String(nowIso) };
    const startMs = new Date(entry?.start).getTime();
    const endMs = new Date(nowIso).getTime();
    closed.durationSec = Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, Math.round((endMs - startMs) / 1000))
        : null;
    return closed;
}

/**
 * The next pause log, or null when nothing changes (pausing while paused,
 * resuming without an open pause). Earlier entries are kept as they are.
 */
export function nextPauseLog(log, isPaused, nowIso, details = {}) {
    const pauseLog = (Array.isArray(log) ? log : []).map(p => ({ ...p }));
    const openIndex = pauseLog.findIndex(p => p && p.end == null);
    if (isPaused) {
        if (openIndex !== -1) return null;
        pauseLog.push(buildPauseEntry(nowIso, details));
        return pauseLog;
    }
    if (openIndex === -1) return null;
    pauseLog[openIndex] = closePauseEntry(pauseLog[openIndex], nowIso);
    return pauseLog;
}

/** The open pause in a log, or null */
export function openPause(log) {
    return (Array.isArray(log) ? log : []).find(p => p && p.end == null && p.start) || null;
}

/** "Hinder 3" / "Sträcka B" / "Sekretariatet" in the viewer's language */
export function describePauseWhere(where, translate = (key) => key) {
    const value = String(where || '');
    if (!value) return '';
    const [kind, rest] = value.split(':');
    if (kind === 'obstacle') return translate('pause_where_obstacle').replace('{n}', rest || '');
    if (kind === 'section') return translate('pause_where_section').replace('{s}', rest === 'transport' ? 'Transport' : (rest || ''));
    if (kind === 'secretariat') return translate('pause_where_secretariat');
    return value;
}

function clock(iso, locale) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * The entry as text in the viewer's language: "Olycka – häst omkullkörd ·
 * Anna (Observatör) vid Sträcka B". translate(key) gives the dictionary text.
 * options.details: the private details (staff); options.publicView: the
 * reason only (the public, the drivers, the monitors), also for older
 * entries that still hold a note or a name.
 */
export function describePauseEntry(entry, translate = (key) => key, { details = null, publicView = false } = {}) {
    if (!entry) return '';
    const reason = entry.reason ? translate(`pause_reason_${entry.reason}`) : '';
    if (publicView) return reason;
    const parts = [];
    const note = String(details?.note ?? entry.note ?? '').trim();
    if (reason || note) parts.push([reason, note].filter(Boolean).join(' – '));
    const by = details?.by || entry.by;
    const roleLabel = by?.role ? translate(`role_${by.role}`) : '';
    const name = String(by?.name || '').trim();
    const who = name && roleLabel ? `${name} (${roleLabel})` : (name || roleLabel);
    const where = describePauseWhere(entry.where, translate);
    if (who && where) parts.push(translate('pause_by_at').replace('{who}', who).replace('{where}', where));
    else if (who) parts.push(translate('pause_by').replace('{who}', who));
    else if (where) parts.push(translate('pause_at').replace('{where}', where));
    return parts.join(' · ');
}

/**
 * A late offline press left for review (functions/src/pauseEvents.js
 * 'needs-review'): "Sen paus från Observatör kl 10:05 behöver granskas"
 */
export function describePauseReview(event, translate = (key) => key, locale = 'sv-SE') {
    const role = event?.by?.role ? translate(`role_${event.by.role}`) : translate('pause_review_unknown_role');
    const key = event?.type === 'end' ? 'pause_late_end_review' : 'pause_late_start_review';
    return translate(key).replace('{role}', role).replace('{time}', clock(event?.at, locale));
}

/** The banner's headline: "TÄVLINGEN PAUSAD SEDAN 10:05" */
export function pauseHeadline(entry, translate = (key) => key, locale = 'sv-SE') {
    const time = entry?.start ? clock(entry.start, locale) : '';
    return time
        ? translate('pause_banner_since').replace('{time}', time)
        : translate('paused_banner');
}

/** One line of the pause history: "Paus 2: 10:05 – 10:20 (15 min) · Olycka" */
export function formatPauseLogLine(entry, index, translate = (key) => key, locale = 'sv-SE', options = {}) {
    const start = clock(entry?.start, locale);
    const end = entry?.end ? clock(entry.end, locale) : translate('observer_ongoing');
    const sec = Math.round(Number(entry?.durationSec));
    const duration = Number.isFinite(sec) && sec > 0
        ? (sec >= 120 ? translate('pause_minutes').replace('{min}', String(Math.round(sec / 60))) : translate('observer_seconds').replace('{sec}', String(sec)))
        : '-';
    const head = translate('observer_pause_log_item')
        .replace('{index}', String(index + 1))
        .replace('{startTime}', start)
        .replace('{endTime}', end)
        .replace('{duration}', duration);
    const detail = describePauseEntry(entry, translate, options);
    return detail ? `${head} · ${detail}` : head;
}
