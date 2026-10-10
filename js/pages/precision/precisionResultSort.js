const STATUS_ORDER = {
  'Pågår': 1,
  'Klar': 2,
  'Ej startat': 3,
  'Struken': 4
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function getPrecisionSortValue(column, rowData, context = {}) {
  switch (column) {
    case 'place':
      return rowData.place || Infinity;
    case 'penalty':
      return isFiniteNumber(rowData.totalPenalty) ? rowData.totalPenalty : Infinity;
    case 'time':
      return rowData.timeMs ?? Infinity;
    case 'knocks':
      return rowData.knocksCount ?? 0;
    case 'obstacle':
      return isFiniteNumber(rowData.obstaclePenalty) ? rowData.obstaclePenalty : Infinity;
    case 'timePenalty':
      return isFiniteNumber(rowData.timePenalty) ? rowData.timePenalty : Infinity;
    case 'extra':
      return isFiniteNumber(rowData.extraPenalty) ? rowData.extraPenalty : Infinity;
    case 'overall':
      return context.getOverallValue ? context.getOverallValue(rowData.eq) : Infinity;
    case 'status':
      return STATUS_ORDER[rowData.status] ?? 3;
    case 'portWidth':
      return isFiniteNumber(rowData.display?.portWidth) ? rowData.display.portWidth : Infinity;
    case 'startTime':
      return context.getStartTime ? context.getStartTime(rowData.eq) : 'ZZZZ';
    case 'className':
      return rowData.eq?._mergedLabel || rowData.eq?.className || '';
    case 'driverName':
      return rowData.eq?.driverName || '';
    case 'startNumber':
    default:
      return rowData.eq?.startNumber || 0;
  }
}

export function sortPrecisionEquipages(equipages = [], options = {}) {
  const {
    sort = { col: 'startNumber', dir: 'asc' },
    viewMode = 'startorder',
    getRowData,
    getOverallValue,
    getStartTime
  } = options;

  const column = sort?.col || 'startNumber';
  const direction = sort?.dir === 'desc' ? -1 : 1;
  const list = (equipages || []).slice();

  list.sort((a, b) => {
    if (viewMode === 'byclass') {
      const classA = a._mergedLabel || a.className || '';
      const classB = b._mergedLabel || b.className || '';
      if (classA !== classB) {
        return classA.localeCompare(classB, 'sv') * direction;
      }
    }

    const dataA = getRowData ? getRowData(a) : { eq: a };
    const dataB = getRowData ? getRowData(b) : { eq: b };
    const context = { getOverallValue, getStartTime };
    const valueA = getPrecisionSortValue(column, dataA, context);
    const valueB = getPrecisionSortValue(column, dataB, context);

    if (valueA < valueB) return -1 * direction;
    if (valueA > valueB) return 1 * direction;

    if (column === 'penalty' || column === 'place') {
      // TR Mom 530.1.2 & FEI Art 977: Vid lika straff vinner snabbast tid (lägst timeMs)
      const timeA = isFiniteNumber(dataA.timeMs) ? dataA.timeMs : Infinity;
      const timeB = isFiniteNumber(dataB.timeMs) ? dataB.timeMs : Infinity;
      if (Math.abs(timeA - timeB) > 1e-3) {
        return (timeA - timeB) * direction;
      }
    }

    return (a.startNumber || 0) - (b.startNumber || 0);
  });

  return list;
}
