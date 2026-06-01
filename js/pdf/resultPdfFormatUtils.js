export function formatPdfPenalty(value, {
  eliminated = false,
  withdrawn = false,
  empty = '—',
  eliminatedLabel = 'ELIM',
  withdrawnLabel = 'STR',
  decimals = 2
} = {}) {
  if (withdrawn) return withdrawnLabel;
  if (eliminated || value === Infinity) return eliminatedLabel;
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(decimals);
  return empty;
}

export function isWithdrawnStatus(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('struken') || normalized.includes('withdrawn');
}

export function formatTotalDisciplinePdfPenalty(row = {}, disciplineKey) {
  const withdrawn = isWithdrawnStatus(row.status);
  if (disciplineKey === 'dressage') {
    return formatPdfPenalty(row.dressage?.penalty, {
      eliminated: row.dressage?.eliminated,
      withdrawn
    });
  }
  if (disciplineKey === 'marathon') {
    return formatPdfPenalty(row.marathon?.totalPenalty, {
      eliminated: row.marathon?.eliminated,
      withdrawn
    });
  }
  if (disciplineKey === 'precision') {
    return formatPdfPenalty(row.precision?.pen, {
      eliminated: row.precision?.eliminated,
      withdrawn
    });
  }
  return '—';
}

export function formatTotalPdfPenalty(row = {}, isInternational = false) {
  const eliminatedLabel = isInternational ? 'ELIM' : 'ELIM';
  return formatPdfPenalty(row.totalPenalty, {
    eliminated: row.isEliminated,
    withdrawn: isWithdrawnStatus(row.status),
    eliminatedLabel
  });
}
