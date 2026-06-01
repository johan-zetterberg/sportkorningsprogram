function sanitizeCsvFilenamePart(name) {
  if (!name) return 'namnlos';
  return String(name)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9_]/g, '');
}

function csvCell(value, delim = ';', localizeNumbers = true) {
  if (value == null) return '';
  let text = String(value);
  if (localizeNumbers && /^[-]?\d+\.\d+$/.test(text)) {
    text = text.replace('.', ',');
  }
  text = text.replace(/"/g, '""');
  return (text.includes(delim) || text.includes('"') || text.includes('\n'))
    ? `"${text}"`
    : text;
}

function downloadCsv(filename, headers, rows, delim = ';', localizeNumbers = true) {
  const lines = [headers.join(delim)];
  for (const row of rows) {
    lines.push(row.map((value) => csvCell(value, delim, localizeNumbers)).join(delim));
  }

  const csv = '\uFEFF' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 0);
}

function formatCsvNumber(value, { decimals = 2, eliminated = false } = {}) {
  if (eliminated || value === Infinity) return 'ELIM';
  return Number.isFinite(value) ? value.toFixed(decimals) : '';
}

export function buildTotalCsvExport({
  rows = [],
  equipages = [],
  competitionName = 'tavling',
  translate,
  date = new Date()
} = {}) {
  const t = typeof translate === 'function' ? translate : (key) => key;
  const headers = [
    t('startno'), t('driver'), t('class'), t('club'),
    `${t('dressage')} (${t('penalty')})`, `${t('dressage')} %`,
    `${t('marathon')} (${t('time')})`, `${t('marathon')} (${t('obs_penalty')})`, `${t('marathon')} (${t('total')})`,
    `${t('precision')} (${t('penalty')})`,
    t('total'), t('ranking'), t('elim')
  ];

  const equipageByStartNumber = new Map(
    (equipages || []).map((equipage) => [String(equipage.startNumber), equipage])
  );

  const exportRows = (rows || []).map((row) => {
    const equipage = equipageByStartNumber.get(String(row.startNumber)) || {};
    return [
      row.startNumber ?? '',
      row.driverName ?? '',
      row.className ?? '',
      equipage.clubName ?? '',
      formatCsvNumber(row?.dressage?.penalty, { eliminated: row?.dressage?.eliminated }),
      formatCsvNumber(row?.dressage?.percentAvg, { eliminated: row?.dressage?.eliminated }),
      formatCsvNumber(row?.marathon?.timePenalty, { eliminated: row?.marathon?.eliminated }),
      formatCsvNumber(row?.marathon?.obstaclePenalty, { eliminated: row?.marathon?.eliminated }),
      formatCsvNumber(row?.marathon?.totalPenalty, { eliminated: row?.marathon?.eliminated }),
      formatCsvNumber(row?.precision?.pen, { eliminated: row?.precision?.eliminated }),
      formatCsvNumber(row?.totalPenalty, { eliminated: row?.isEliminated }),
      row?.isEliminated ? '' : (row?.plac ?? ''),
      row?.isEliminated ? 'JA' : ''
    ];
  });

  const isoDate = date instanceof Date
    ? date.toISOString().split('T')[0]
    : String(date || '').split('T')[0];
  const filename = `total_resultat_${sanitizeCsvFilenamePart(competitionName || 'tavling')}_${isoDate}.csv`;

  return { filename, headers, rows: exportRows };
}

export function downloadTotalCsv(options = {}, delim = ';') {
  const csvExport = buildTotalCsvExport(options);
  downloadCsv(csvExport.filename, csvExport.headers, csvExport.rows, delim);
  return csvExport;
}
