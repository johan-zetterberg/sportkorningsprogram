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
