export function formatPrecisionMonitorPenalty(value, {
  eliminated = false,
  empty = '—',
  decimals = 2
} = {}) {
  if (eliminated || value === Infinity) return 'ELIM';
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : empty;
}

export function formatPrecisionMonitorPartPenalty(value, {
  eliminated = false,
  empty = '–',
  decimals = 2
} = {}) {
  if (eliminated) return empty;
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : empty;
}
