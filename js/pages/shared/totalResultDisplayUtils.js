export function formatTotalResultPenalty(value, {
  eliminated = false,
  empty = '—',
  suffix = ''
} = {}) {
  if (eliminated || value === Infinity) return `ELIM${suffix}`;
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : empty;
}

export function formatTotalResultPercent(value, { empty = '' } = {}) {
  return typeof value === 'number' && Number.isFinite(value) ? ` <div class="res-pos">(${value.toFixed(2)}%)</div>` : empty;
}

export function isTotalDisciplineEliminated(row = {}, discipline) {
  if (!discipline || !row?.[discipline]) return false;
  return row[discipline].eliminated === true || row[discipline].totalPenalty === Infinity || row[discipline].pen === Infinity;
}
