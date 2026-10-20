import { rankDressageRows } from '../dressage/dressageResultRanking.js';
import {
  assignPlaces,
  compareTotalRank,
  compareMarathonRank,
  comparePrecisionRank,
  totalRankKey,
  marathonRankKey,
  precisionGroupContext
} from '../../core-engine/ranking.js';
import { compareStartNumbers } from '../../utils/startNumberSort.js';

const fallbackClass = '-';
const fallbackNumber = 999999;
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const groupKeyOf = (row) => row.displayGroupKey || `CLASS:${row.className || fallbackClass}`;
const startNumberOf = (row) => Number(row.startNumber) || 0;

// Clear round is set for the whole class (TR V 509.3, isClearRoundClass): any
// phase saying so leaves the row without a place in the total and every phase
export function isClearRoundRow(row) {
  return row?.isClearRound === true
    || row?.dressage?.isClearRound === true
    || row?.marathon?.isClearRound === true
    || row?.precision?.isClearRound === true;
}

function totalRowRankKey(row) {
  return totalRankKey({
    totalPenalty: row.totalPenalty,
    isEliminated: row.isEliminated,
    marathonPenalty: row.marathon?.totalPenalty,
    dressagePenalty: row.dressage?.penalty,
    isClearRound: isClearRoundRow(row)
  });
}

// Tie-break for equal totals: marathon, then dressage (TR V Mom 533.3, FEI Art 904)
export function compareTotalTiebreak(a, b) {
  return compareTotalRank(
    { penalty: 0, marathon: a.marathon?.totalPenalty, dressage: a.dressage?.penalty },
    { penalty: 0, marathon: b.marathon?.totalPenalty, dressage: b.dressage?.penalty }
  );
}

// Sets row.plac per display group. Returns rows per group: placed rows in
// ranking order, then rows without a result, then eliminated rows.
export function placeTotalRowsWithinClass(rows = []) {
  const { ranked } = assignPlaces(rows, {
    key: totalRowRankKey,
    compare: compareTotalRank,
    group: groupKeyOf
  });

  // The archived place is per class: only where the list is grouped by the
  // class itself. In a merged display group it would give 1, 1, 2, 2…; the
  // place then comes from the frozen penalties above.
  rows.forEach((row) => {
    const plainClassGroup = groupKeyOf(row) === `CLASS:${row.className || fallbackClass}`;
    if (plainClassGroup && row.fromArchive && row.archivedPlac !== undefined && row.archivedPlac !== null && row.archivedPlac !== '') {
      const numPlac = Number(row.archivedPlac);
      if (Number.isFinite(numPlac)) row.plac = numPlac;
    }
  });

  const rankedByGroup = new Map();
  ranked.forEach((row) => {
    const g = groupKeyOf(row);
    if (!rankedByGroup.has(g)) rankedByGroup.set(g, []);
    rankedByGroup.get(g).push(row);
  });

  const groups = new Map();
  rows.forEach((row) => {
    const g = groupKeyOf(row);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(row);
  });

  // Every row not in the ranking (not only those without a place: an archived
  // place on a row the ranking left out would otherwise drop it from the list)
  const rankedRows = new Set(ranked);
  const output = [];
  groups.forEach((groupRows, g) => {
    const unplaced = groupRows
      .filter((row) => !rankedRows.has(row))
      .sort((a, b) => (a.isEliminated === b.isEliminated ? 0 : (a.isEliminated ? 1 : -1)) || (startNumberOf(a) - startNumberOf(b)));
    output.push(...(rankedByGroup.get(g) || []), ...unplaced);
  });
  return output;
}

// Generic per-class position on a single value, equal values share the place
export function rankTotalRowsWithinClass(rows = [], valuePicker, outField, higherIsBetter = false) {
  if (typeof valuePicker !== 'function' || !outField) return rows;
  assignPlaces(rows, {
    key: (row) => {
      const value = valuePicker(row);
      if (row.isEliminated || !Number.isFinite(value)) return null;
      return { penalty: higherIsBetter ? -value : value };
    },
    compare: compareTotalRank,
    group: groupKeyOf,
    outField
  });
  return rows;
}

// Discipline placings within the display group (a merged class is placed as
// one class, as the total and the discipline pages do)
export function applyTotalDisciplinePlacements(rows = []) {
  const byClass = groupKeyOf;

  rankDressageRows(rows, {
    penaltyPicker: row => (isClearRoundRow(row) ? null : row?.dressage?.penalty),
    eliminatedPicker: row => !!(row?.dressage?.eliminated || (row?.isEliminated && row?.dressage?.penalty == null)),
    groupPicker: byClass,
    outputField: 'posDress'
  });
  assignPlaces(rows, {
    key: (row) => ((isClearRoundRow(row) || row?.marathon?.eliminated || (row.isEliminated && row.marathon?.totalPenalty == null)) ? null : marathonRankKey(row.marathon, { requireFinished: false })),
    compare: compareMarathonRank,
    group: byClass,
    outField: 'posMar'
  });
  // Two phases / drive-off: tiers and the drive-off qualifiers per group
  const precisionCtx = precisionGroupContext(rows, (row) => ({
    ...row.precision,
    totalPenalty: row.precision?.pen ?? row.precision?.totalPenalty
  }), byClass);
  assignPlaces(rows, {
    key: (row) => ((isClearRoundRow(row) || row?.precision?.eliminated || (row.isEliminated && (row.precision?.pen ?? row.precision?.totalPenalty) == null)) ? null : precisionCtx.rankKey(row)),
    compare: comparePrecisionRank,
    group: byClass,
    outField: 'posPrec'
  });

  rows.forEach((row) => {
    if (!row.fromArchive) return;
    // An archived place is per class: only where the list groups by the class
    if (groupKeyOf(row) !== `CLASS:${row.className || fallbackClass}`) return;
    if (Number.isFinite(row.archivedDressagePlace)) row.posDress = row.archivedDressagePlace;
    if (Number.isFinite(row.archivedMarathonPlace)) row.posMar = row.archivedMarathonPlace;
    if (Number.isFinite(row.archivedPrecisionPlace)) row.posPrec = row.archivedPrecisionPlace;
  });

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

// The sort menu: "startorder" sorts by start number as its label says,
// "place" (Placering) and "byclass" by place
export function totalSortConfigForMode(viewMode) {
  return viewMode === 'startorder'
    ? { key: 'startNumber', direction: 'asc' }
    : { key: 'plac', direction: 'asc' };
}

export function sortTotalRows(rows = [], sortConfig = { key: 'plac', direction: 'asc' }) {
  const sortKey = sortConfig.key || 'plac';
  const sortDir = sortConfig.direction === 'desc' ? -1 : 1;

  return rows.slice().sort((a, b) => {
    if (sortKey === 'startNumber') return compareStartNumbers(a.startNumber, b.startNumber) * sortDir;
    const valueA = getTotalSortValue(a, sortKey);
    const valueB = getTotalSortValue(b, sortKey);

    if (valueA < valueB) return -1 * sortDir;
    if (valueA > valueB) return 1 * sortDir;

    if (sortKey === 'totalPenalty' && valueA === valueB) {
      const tiebreak = compareTotalTiebreak(a, b);
      if (tiebreak !== 0) return tiebreak * sortDir;
    }

    return compareStartNumbers(a.startNumber, b.startNumber) * sortDir;
  });
}

export function buildDisplayedTotalRows(rows = [], options = {}) {
  return sortTotalRows(filterTotalRows(rows, options), options.sortConfig);
}
