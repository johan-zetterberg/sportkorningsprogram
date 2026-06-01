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
