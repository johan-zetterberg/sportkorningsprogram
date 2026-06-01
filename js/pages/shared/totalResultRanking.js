const fallbackClass = '-';
const fallbackNumber = 999999;
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function compareTotalTiebreak(a, b) {
  const marathonA = a.marathon?.totalPenalty ?? Infinity;
  const marathonB = b.marathon?.totalPenalty ?? Infinity;
  if (Math.abs(marathonA - marathonB) > 1e-6) return marathonA - marathonB;

  const dressageA = a.dressage?.penalty ?? Infinity;
  const dressageB = b.dressage?.penalty ?? Infinity;
  if (Math.abs(dressageA - dressageB) > 1e-6) return dressageA - dressageB;

  const marathonObstacleA = a.marathon?.obstaclePenaltySum ?? 0;
  const marathonObstacleB = b.marathon?.obstaclePenaltySum ?? 0;
  if (Math.abs(marathonObstacleA - marathonObstacleB) > 1e-6) return marathonObstacleA - marathonObstacleB;

  const timesA = a.marathon?.obstacleTimes || [];
  const timesB = b.marathon?.obstacleTimes || [];
  const maxTimes = Math.max(timesA.length, timesB.length);
  for (let index = 0; index < maxTimes; index += 1) {
    const timeA = timesA[index] || 0;
    const timeB = timesB[index] || 0;
    if (Math.abs(timeA - timeB) > 1e-6) return timeA - timeB;
  }

  const generalA = a.dressage?.generalImpressionsSum ?? 0;
  const generalB = b.dressage?.generalImpressionsSum ?? 0;
  if (Math.abs(generalA - generalB) > 1e-6) return generalB - generalA;

  const precisionA = a.precision?.pen ?? Infinity;
  const precisionB = b.precision?.pen ?? Infinity;
  if (Math.abs(precisionA - precisionB) > 1e-6) return precisionA - precisionB;

  const precisionDiffA = a.precision?.timeDiffFromAllowed ?? Infinity;
  const precisionDiffB = b.precision?.timeDiffFromAllowed ?? Infinity;
  if (Math.abs(precisionDiffA - precisionDiffB) > 1e-6) return precisionDiffA - precisionDiffB;

  return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
}

export function placeTotalRowsWithinClass(rows = []) {
  const byGroup = new Map();
  rows.forEach((row) => {
    const groupKey = row.displayGroupKey || `CLASS:${row.className || fallbackClass}`;
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, []);
    byGroup.get(groupKey).push(row);
  });

  const output = [];
  for (const groupRows of byGroup.values()) {
    groupRows.sort((a, b) => {
      const totalA = a.totalPenalty;
      const totalB = b.totalPenalty;
      if (a.isEliminated !== b.isEliminated) return a.isEliminated ? 1 : -1;
      if (totalA == null && totalB == null) return (Number(a.startNumber) || 0) - (Number(b.startNumber) || 0);
      if (totalA == null) return 1;
      if (totalB == null) return -1;
      if (totalA !== totalB) return totalA - totalB;
      return compareTotalTiebreak(a, b);
    });

    let place = 1;
    groupRows.forEach((row) => {
      row.plac = (!row.isEliminated && row.totalPenalty != null) ? place++ : null;
    });
    output.push(...groupRows);
  }

  return output;
}

export function rankTotalRowsWithinClass(rows = [], valuePicker, outField, higherIsBetter = false) {
  if (typeof valuePicker !== 'function' || !outField) return rows;

  const byClass = new Map();
  rows.forEach((row) => {
    const className = row.className || fallbackClass;
    if (!byClass.has(className)) byClass.set(className, []);
    byClass.get(className).push(row);
  });

  for (const classRows of byClass.values()) {
    const validRows = classRows
      .filter((row) => !row.isEliminated && Number.isFinite(valuePicker(row)))
      .sort((a, b) => {
        const valueA = valuePicker(a);
        const valueB = valuePicker(b);
        return higherIsBetter ? valueB - valueA : valueA - valueB;
      });

    validRows.forEach((row, index) => {
      row[outField] = index + 1;
    });
  }

  return rows;
}

export function applyTotalDisciplinePlacements(rows = []) {
  rankTotalRowsWithinClass(rows, (row) => row?.dressage?.penalty, 'posDress');
  rankTotalRowsWithinClass(rows, (row) => row?.marathon?.totalPenalty, 'posMar');
  rankTotalRowsWithinClass(rows, (row) => row?.precision?.pen, 'posPrec');
  return rows;
}

export function applyTotalResultDiffs(rows = []) {
  const byGroup = new Map();
  rows.forEach((row) => {
    const groupKey = row.displayGroupKey || `CLASS:${row.className || fallbackClass}`;
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, []);
    byGroup.get(groupKey).push(row);
  });

  byGroup.forEach((groupRows) => {
    const leader = groupRows.find((row) => !row.isEliminated && Number.isFinite(row.totalPenalty));
    groupRows.forEach((row) => {
      row.diffFromLeader = (!leader || row.isEliminated || !Number.isFinite(row.totalPenalty))
        ? null
        : round2(row.totalPenalty - leader.totalPenalty);
    });

    for (let index = 0; index < groupRows.length; index += 1) {
      const row = groupRows[index];
      if (row.isEliminated || !Number.isFinite(row.totalPenalty)) {
        row.diffFromNext = null;
        continue;
      }

      let previousIndex = index - 1;
      let previousFinished = null;
      while (previousIndex >= 0) {
        const candidate = groupRows[previousIndex];
        if (!candidate.isEliminated && Number.isFinite(candidate.totalPenalty)) {
          previousFinished = candidate;
          break;
        }
        previousIndex -= 1;
      }

      row.diffFromNext = previousFinished
        ? round2(row.totalPenalty - previousFinished.totalPenalty)
        : null;
    }
  });

  return rows;
}

export function buildBestDressageByGroup(rows = []) {
  const bestByGroup = new Map();

  rows.forEach((row) => {
    const groupKey = row.displayGroupKey || `CLASS:${row.className || fallbackClass}`;
    const percent = row.dressage?.percentAvg;
    if (typeof percent !== 'number') return;

    const currentBest = bestByGroup.get(groupKey);
    if (currentBest == null || percent > currentBest) {
      bestByGroup.set(groupKey, percent);
    }
  });

  return bestByGroup;
}

export function getTotalSortValue(row, sortKey) {
  switch (sortKey) {
    case 'plac': return row.plac ?? (row.isEliminated ? 999998 : fallbackNumber);
    case 'startNumber': return Number(row.startNumber) || 0;
    case 'driverName': return (row.driverName || '').toLowerCase();
    case 'className': return (row.className || '').toLowerCase();
    case 'club': return (row.clubName || '').toLowerCase();
    case 'dressage': return row.dressage?.penalty ?? fallbackNumber;
    case 'marathon': return row.marathon?.totalPenalty ?? fallbackNumber;
    case 'precision': return row.precision?.pen ?? fallbackNumber;
    case 'totalPenalty': return row.totalPenalty ?? fallbackNumber;
    default: return 0;
  }
}

export function filterTotalRows(rows = [], {
  activeClassFilters = new Set(),
  searchQuery = '',
  equipages = [],
  showOnlyCompleted = false,
  showOnlyOngoing = false
} = {}) {
  let list = rows.slice();

  if (activeClassFilters.size > 0) {
    list = list.filter((row) => activeClassFilters.has(row.displayGroupLabel || ''));
  }

  const query = String(searchQuery || '').trim().toLowerCase();
  if (query) {
    const equipageByStart = new Map((equipages || []).map((eq) => [String(eq.startNumber), eq]));
    list = list.filter((row) => {
      const equipage = equipageByStart.get(String(row.startNumber)) || {};
      const haystack = [
        row.startNumber,
        row.driverName || '',
        row.className || '',
        equipage.clubName || row.clubName || ''
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  if (showOnlyCompleted) {
    list = list.filter((row) => !row.isEliminated && row.totalPenalty != null);
  } else if (showOnlyOngoing) {
    list = list.filter((row) => !!row.isOngoing);
  }

  return list;
}

export function sortTotalRows(rows = [], sortConfig = { key: 'plac', direction: 'asc' }) {
  const sortKey = sortConfig.key || 'plac';
  const sortDir = sortConfig.direction === 'desc' ? -1 : 1;

  return rows.slice().sort((a, b) => {
    const valueA = getTotalSortValue(a, sortKey);
    const valueB = getTotalSortValue(b, sortKey);

    if (valueA < valueB) return -1 * sortDir;
    if (valueA > valueB) return 1 * sortDir;

    if (sortKey === 'totalPenalty' && valueA === valueB) {
      const marathonA = a.marathon?.totalPenalty ?? fallbackNumber;
      const marathonB = b.marathon?.totalPenalty ?? fallbackNumber;
      if (marathonA !== marathonB) return (marathonA - marathonB) * sortDir;
    }

    return ((Number(a.startNumber) || 0) - (Number(b.startNumber) || 0)) * sortDir;
  });
}

export function buildDisplayedTotalRows(rows = [], options = {}) {
  return sortTotalRows(filterTotalRows(rows, options), options.sortConfig);
}
