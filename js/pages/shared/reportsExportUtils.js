export function getReportDisplayClass(row = {}) {
  return row._mergedLabel || row.mergedTestLabel || row.className || '';
}

export function getReportClassOptions(rows = []) {
  return [...new Set(rows.map(getReportDisplayClass).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'sv'));
}

export function filterReportData({ rows = [], equipages = [], filterClass = '' } = {}) {
  const sourceRows = rows.length ? rows : equipages;
  if (!filterClass) return { rows: sourceRows, eqs: sourceRows };

  const filteredRows = sourceRows.filter(row => getReportDisplayClass(row) === filterClass);
  if (rows.length) return { rows: filteredRows, eqs: filteredRows };

  return {
    rows: filteredRows,
    eqs: equipages.filter(row => getReportDisplayClass(row) === filterClass)
  };
}

export function getReportHorseNames(row = {}) {
  if (Array.isArray(row.horses)) {
    return row.horses
      .map(horse => typeof horse === 'string' ? horse : (horse?.name || horse?.horseName || horse?.namn || ''))
      .filter(Boolean)
      .join(', ');
  }
  if (Array.isArray(row.horseNames)) return row.horseNames.filter(Boolean).join(', ');
  return row.horseName || row.horse || '';
}

export function formatReportCsvPenalty(value, {
  eliminated = false,
  empty = '',
  decimals = 2
} = {}) {
  if (eliminated || value === Infinity) return 'ELIM';
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(decimals).replace('.', ',');
  return empty;
}

export function formatReportCsvPercent(value, { eliminated = false, empty = '' } = {}) {
  if (eliminated) return 'ELIM';
  if (typeof value === 'number' && Number.isFinite(value)) return `${value.toFixed(2).replace('.', ',')}%`;
  return empty;
}
