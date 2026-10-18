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
  // Numbers stored as text ("12.5") print too; null, '' and junk print empty
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number === 'number' && Number.isFinite(number)) return number.toFixed(decimals);
  return empty;
}

export function isWithdrawnStatus(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('struken') || normalized.includes('withdrawn') || normalized.includes('scratched');
}

// A result row withdrawn by its status or the archive's isWithdrawn
const isWithdrawnRow = (row = {}) => row.isWithdrawn === true || isWithdrawnStatus(row.status);

// labels: { withdrawnLabel } for an English PDF (default the Swedish STR)
export function formatTotalDisciplinePdfPenalty(row = {}, disciplineKey, labels = {}) {
  const withdrawn = isWithdrawnRow(row);
  const withdrawnLabel = labels.withdrawnLabel || 'STR';
  if (disciplineKey === 'dressage') {
    return formatPdfPenalty(row.dressage?.penalty, {
      eliminated: row.dressage?.eliminated,
      withdrawn,
      withdrawnLabel
    });
  }
  if (disciplineKey === 'marathon') {
    return formatPdfPenalty(row.marathon?.totalPenalty, {
      eliminated: row.marathon?.eliminated,
      withdrawn,
      withdrawnLabel
    });
  }
  if (disciplineKey === 'precision') {
    // The total page's rows carry pen, the report rows the engine's totalPenalty
    return formatPdfPenalty(row.precision?.pen ?? row.precision?.totalPenalty, {
      eliminated: row.precision?.eliminated,
      withdrawn,
      withdrawnLabel
    });
  }
  return '—';
}

// isEnglish: an English PDF (international competition) shows WD for withdrawn
export function formatTotalPdfPenalty(row = {}, isEnglish = false) {
  return formatPdfPenalty(row.totalPenalty, {
    eliminated: row.isEliminated,
    withdrawn: isWithdrawnRow(row),
    eliminatedLabel: 'ELIM',
    withdrawnLabel: isEnglish ? 'WD' : 'STR'
  });
}
