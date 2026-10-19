// Pure helpers for the dressage status and live documents (no Firebase here,
// so they can be tested in Node).

/** Key of a judge in judgesDone / judgeScores: the position, else the id */
export function judgeStatusKey(judgePosition, judgeId) {
  const pos = String(judgePosition || '').trim().toUpperCase();
  if (pos) return pos;
  const id = String(judgeId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return id ? `ID_${id}` : '';
}

/** Id of a judge's own live document (dressageStatus/{sn}/live/{id}) */
export function liveDocIdFor(judgePosition, judgeId) {
  return judgeStatusKey(judgePosition, judgeId) || 'data';
}

/** Milliseconds from a Firestore Timestamp, Date, number or ISO string; null if none */
export function timestampToMs(value) {
  if (value == null || value === '') return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && Number.isFinite(value.seconds)) {
    return value.seconds * 1000 + Math.floor((Number(value.nanoseconds) || 0) / 1e6);
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when a live document is older than maxAgeMs. `nowMs` should be server
 * time (serverNow) and the document stamped by the server, so a judge tablet
 * with a wrong clock does not hide its marks. Undated documents are not stale.
 */
export function isLiveDocStale(liveDoc, nowMs, maxAgeMs = 120000) {
  const ts = timestampToMs(liveDoc?.updatedAtMs ?? liveDoc?.updatedAt);
  if (ts == null) return false;
  return nowMs - ts > maxAgeMs;
}

const DERIVABLE_STATES = new Set(['', 'ongoing', 'finished', 'not-started']);

/**
 * The status as readers should see it. Every judge marks its own position in
 * judgesDone ({ C: true, E: false }); the equipage is finished when all
 * expected positions are done, whoever saved last. Documents without
 * judgesDone (older data) keep their stored state, as do other states
 * (e.g. withdrawn) set elsewhere.
 */
export function deriveDressageStatusState(status) {
  if (!status || typeof status !== 'object') return status;
  const done = (status.judgesDone && typeof status.judgesDone === 'object') ? status.judgesDone : null;
  if (!done) return status;
  const stored = String(status.state || '');
  if (!DERIVABLE_STATES.has(stored)) return status;

  const expected = Array.isArray(status.expectedPositions)
    ? status.expectedPositions.map(p => String(p || '').trim().toUpperCase()).filter(Boolean)
    : [];
  const keys = expected.length ? expected : Object.keys(done);
  const finished = keys.length > 0 && keys.every(k => done[k] === true);
  const started = Object.keys(done).length > 0;
  const state = finished ? 'finished' : (started || stored === 'finished' ? 'ongoing' : stored || null);
  return state === status.state ? status : { ...status, state };
}

/**
 * Positions expected to judge a class: the class's judge mapping, else the
 * positions of all dressage judges.
 */
export function expectedDressagePositions(className, judgeMapping, judgePositions = []) {
  const mapping = (judgeMapping?.mapping && typeof judgeMapping.mapping === 'object') ? judgeMapping.mapping : (judgeMapping || {});
  let assigned = mapping[className];
  if (!assigned || typeof assigned !== 'object') {
    const wanted = String(className || '').toLowerCase().replace(/\s+/g, '');
    const key = wanted ? Object.keys(mapping).find(k => k.toLowerCase().replace(/\s+/g, '') === wanted) : null;
    assigned = key ? mapping[key] : null;
  }
  const fromMapping = (assigned && typeof assigned === 'object')
    ? Object.keys(assigned).filter(k => assigned[k] && String(assigned[k]).trim() !== '')
    : [];
  const list = fromMapping.length ? fromMapping : (judgePositions || []);
  return [...new Set(list.map(p => String(p || '').trim().toUpperCase()).filter(Boolean))];
}
