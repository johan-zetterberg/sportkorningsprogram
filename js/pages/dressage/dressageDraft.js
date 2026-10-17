// Unsaved dressage protocol kept on the device while the judge enters scores:
// in field mode nothing is written until Save, so a reload or a killed tab
// would otherwise lose the whole protocol.

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** One draft per competition, start number and judge position (judge id without a position) */
export function dressageDraftKey(competitionId, startNumber, judge) {
  if (!competitionId || startNumber == null || startNumber === '' || !judge) return null;
  // _pos is the normalized position the input page sets on its judges
  const pos = String(judge._pos ?? judge.position ?? '').trim().toUpperCase();
  const slot = pos || (judge.id != null ? `J${judge.id}` : '');
  if (!slot) return null;
  return `draft_${competitionId}_dre_${String(startNumber).trim()}_${slot}`;
}

export function readDressageDraft(key) {
  const ls = storage();
  if (!key || !ls) return null;
  try {
    const parsed = JSON.parse(ls.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Could not read dressage draft', key, error);
    return null;
  }
}

export function writeDressageDraft(key, draft) {
  const ls = storage();
  if (!key || !ls || !draft) return false;
  try {
    ls.setItem(key, JSON.stringify(draft));
    return true;
  } catch (error) {
    console.warn('Could not write dressage draft', key, error);
    return false;
  }
}

export function clearDressageDraft(key) {
  const ls = storage();
  if (!key || !ls) return;
  try {
    ls.removeItem(key);
  } catch (error) {
    console.warn('Could not clear dressage draft', key, error);
  }
}

/** True when nothing has been entered: no draft is worth keeping */
export function isEmptyDressageDraft(draft) {
  if (!draft) return true;
  const movements = Array.isArray(draft.movements) ? draft.movements : [];
  const hasMovement = movements.some((m) => String(m?.score ?? '').trim() !== '' || String(m?.comment ?? '').trim() !== '');
  return !hasMovement && !draft.eliminated && !draft.generalDirty;
}

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether the draft should replace the saved protocol in the form: it must
 * belong to the same judge, and be newer than the saved protocol. A saved
 * protocol without a known time (pending or legacy) loses, since a successful
 * save clears the draft.
 */
export function shouldRestoreDressageDraft(draft, savedProtocol, judgeId) {
  if (!draft || isEmptyDressageDraft(draft)) return false;
  if (judgeId != null && draft.judgeId != null && String(draft.judgeId) !== String(judgeId)) return false;
  if (!savedProtocol) return true;
  const savedMs = toMillis(savedProtocol.updatedAt);
  if (savedMs == null) return true;
  return Number(draft.ts) > savedMs;
}
