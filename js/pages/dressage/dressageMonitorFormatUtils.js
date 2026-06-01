export function isDressageMonitorEliminated(result = {}) {
  return result.eliminated === true || result.isEliminated === true || result.status === 'ELIM';
}

export function formatDressageMonitorScore(value, {
  eliminated = false,
  decimals = 1,
  suffix = '',
  empty = '—'
} = {}) {
  if (eliminated) return 'ELIM';
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(decimals)}${suffix}`
    : empty;
}

export function formatDressageMonitorPenalty(value, result = {}) {
  return formatDressageMonitorScore(value, {
    eliminated: isDressageMonitorEliminated(result),
    decimals: 2,
    suffix: ' p'
  });
}
