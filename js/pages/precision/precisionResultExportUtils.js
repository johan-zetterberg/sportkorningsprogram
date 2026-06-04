export function formatPrecisionCsvPenalty(value, {
  eliminated = false,
  empty = '-',
  zeroWhenEmpty = false
} = {}) {
  if (eliminated || value === Infinity) return 'ELIM';
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  return zeroWhenEmpty ? '0.00' : empty;
}

export function formatPrecisionCsvText(value, empty = '-') {
  return value == null || value === '' ? empty : value;
}

export function formatPrecisionTimeSeconds(timeMs, { empty = '-' } = {}) {
  if (timeMs == null || timeMs === '') return empty;
  const value = Number(timeMs);
  if (!Number.isFinite(value) || value < 0) return empty;
  return (value / 1000).toFixed(2);
}
