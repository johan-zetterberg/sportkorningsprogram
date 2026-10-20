import { archivedDisciplinePenalty } from './archivedResults.js';

export function isPrizeGivingScore(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatPrizeGivingScore(value, empty = '—') {
  return isPrizeGivingScore(value) ? value.toFixed(2) : empty;
}

export function getPrizeGivingStatus(row = {}) {
  if (row.isEliminated || row.score === Infinity) return 'ELIM';
  return isPrizeGivingScore(row.score) ? '' : 'Ej Start';
}

/**
 * The "N placeras" badge text, or '' while no one has a placing yet (a
 * "1 PLACERADE" badge next to "no approved results yet" was contradictory).
 * template holds {n}.
 */
export function prizeGivingPlacedBadgeText(numPlaced, placedRows, template = '{n} placeras') {
  if (!(Number(placedRows) > 0) || !(Number(numPlaced) > 0)) return '';
  return String(template).replace('{n}', String(numPlaced));
}

/** The speaker's line for the winner; template holds {name} */
export function prizeGivingSpeakerScript(template, winnerName) {
  const name = String(winnerName || '').trim() || '…';
  return String(template || '').replace('{name}', name);
}

/**
 * An archived competition: puts the penalties it was archived with on a
 * prize-giving row (discipline 'total' | 'dressage' | 'marathon' |
 * 'precision'), before the placings are made. A row without an archived row,
 * or without a snapshot, is returned as calculated.
 */
export function applyArchivedPrizeGivingRow(row = {}, snapshot = null, discipline = 'total') {
  if (!snapshot) return row;
  const archived = (which) => archivedDisciplinePenalty(snapshot, row.startNumber, which);
  const total = archived('total');
  if (!total.found) return row;
  const dressage = archived('dressage');
  const marathon = archived('marathon');
  const precision = archived('precision');
  const active = { dressage, marathon, precision }[discipline] || total;
  const isEliminated = active.isEliminated === null ? !!row.isEliminated : active.isEliminated;
  // The rank keys read the engine results: give them the archived penalty
  const withPenalty = (res, value) => (res ? {
    ...res,
    totalPenalty: value.penalty,
    eliminated: value.isEliminated === null ? !!res.eliminated : value.isEliminated
  } : res);
  return {
    ...row,
    dPen: dressage.penalty,
    mPen: marathon.penalty,
    pPen: precision.penalty,
    mRes: withPenalty(row.mRes, marathon),
    pCalc: withPenalty(row.pCalc, precision),
    score: isEliminated ? null : active.penalty,
    isEliminated,
    fromArchive: true
  };
}
