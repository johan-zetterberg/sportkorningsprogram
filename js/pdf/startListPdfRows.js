export function formatPdfStartTime(value, empty = '—') {
  if (!value) return empty;
  const text = String(value);
  return text.includes('T') ? (text.split('T')[1]?.slice(0, 5) || text) : text;
}

function horseLabelForPdf(eq) {
  if (!eq || typeof eq !== 'object') return '—';

  const found = [];
  const take = (value) => {
    if (!value) return;
    if (typeof value === 'string' && value.trim()) found.push(value.trim());
    else if (Array.isArray(value)) value.forEach(take);
    else if (typeof value === 'object') {
      ['name', 'namn', 'horse', 'horseName', 'häst', 'hästnamn', 'hast', 'hastnamn']
        .forEach(key => take(value[key]));
    }
  };

  ['horses', 'horseNames', 'horseName', 'horse', 'horse1Name', 'horse2Name', 'horse3Name', 'hästnamn', 'hastName']
    .forEach(key => take(eq[key]));

  const unique = [...new Set(found
    .join(' / ')
    .split(/[\/,&+]|(?:\s*&\s*)/)
    .map(value => value.trim())
    .filter(Boolean))];

  return unique.length ? unique.slice(0, 3).join(' & ') : '—';
}

export function getPdfDisplayClass(row = {}) {
  return row._mergedLabel || row.className || '';
}

export function buildStartListPdfBody(rows = [], type, options = {}) {
  const body = [];
  const rowSources = [];
  let lastClass = null;

  rows.forEach(rowData => {
    if (type === 'horselist') {
      const lineage = [rowData.sire, rowData.dam].filter(value => value && value !== '-').join(' x ');
      body.push([
        rowData.name || '',
        rowData.breed || '',
        rowData.gender || '',
        rowData.age || '',
        rowData.category || (rowData.height ? '?' : ''),
        rowData.lineage || lineage || '',
        rowData.owner || '',
        rowData.driverName || ''
      ]);
      rowSources.push(rowData);
      return;
    }

    if (options.viewMode === 'byclass' || options.viewMode === 'class') {
      const currentClass = getPdfDisplayClass(rowData) || 'Okänd klass';
      if (currentClass !== lastClass) {
        body.push([
          {
            content: currentClass,
            colSpan: type === 'participants' ? 4 : 5,
            styles: { fillColor: [240, 240, 240], fontStyle: 'bold' }
          }
        ]);
        rowSources.push(null);
        lastClass = currentClass;
      }
    }

    const tableRow = [];
    if (type !== 'participants') {
      tableRow.push({ content: formatPdfStartTime(rowData.startTime), styles: { fontStyle: 'bold', halign: 'center' } });
    }

    tableRow.push(rowData.startNumber || '');
    tableRow.push(`${rowData.driverName || ''}\n${horseLabelForPdf(rowData)}`);
    tableRow.push(getPdfDisplayClass(rowData));
    tableRow.push(rowData.clubName || '');

    body.push(tableRow);
    rowSources.push(rowData);
  });

  return { body, rowSources };
}
