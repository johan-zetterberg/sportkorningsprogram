export function formatPortalPenalty(value, { empty = '—', eliminatedLabel = 'ELIM' } = {}) {
  if (value === Infinity) return eliminatedLabel;
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : empty;
}

export function calculatePortalTotalPenaltyLabel(values = [], explicitTotal = null, { eliminated = false } = {}) {
  if (eliminated) return 'ELIM';
  if (explicitTotal != null) return formatPortalPenalty(explicitTotal);

  const numericValues = values.filter(value => typeof value === 'number');
  if (!numericValues.length) return '—';
  if (numericValues.some(value => value === Infinity)) return 'ELIM';

  const total = numericValues.reduce((sum, value) => (
    Number.isFinite(value) ? sum + value : sum
  ), 0);
  return total.toFixed(2);
}

export function getPortalPenaltyToneClass(value) {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0
    ? 'text-gray-900 dark:text-white'
    : 'text-gray-400 dark:text-gray-600';
}
