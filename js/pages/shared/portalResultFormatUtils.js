export function formatPortalPenalty(value, { empty = '—', eliminatedLabel = 'ELIM' } = {}) {
  if (value === Infinity) return eliminatedLabel;
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : empty;
}

// The total is the result engine's (computed_equipages.totalPenalty): it exists
// only when all three disciplines are finished. Without it the portal shows no
// total rather than a sum of the disciplines driven so far.
export function calculatePortalTotalPenaltyLabel(values = [], explicitTotal = null, { eliminated = false } = {}) {
  if (eliminated) return 'ELIM';
  if (explicitTotal != null) return formatPortalPenalty(explicitTotal);
  if (values.some(value => value === Infinity)) return 'ELIM';
  return '—';
}

export function getPortalPenaltyToneClass(value) {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0
    ? 'text-gray-900 dark:text-white'
    : 'text-gray-400 dark:text-gray-600';
}
