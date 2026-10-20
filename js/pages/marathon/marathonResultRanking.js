import { isNum } from '../../utils/sharedUtils.js';
import { safeLower } from './marathonResultFormatters.js';
import { assignPlaces, compareMarathonRank, marathonRankKey } from '../../core-engine/ranking.js';
import { timeValueToMs } from '../../utils/timeValueUtils.js';
import { compareStartNumbers } from '../../utils/startNumberSort.js';

// The result list's sort menu: what each choice sorts by. "startorder" is the
// start-number order its label promises; "place" and "byclass" rank by place.
export function sortStateForViewMode(viewMode) {
  return viewMode === 'startorder'
    ? { key: 'startNumber', dir: 'asc' }
    : { key: 'place', dir: 'asc' };
}

export function isFinalizedMarathonDoc(d) {
  return d?.finalized === true || d?.status === 'finalized' || d?.isFinal === true;
}

export function matchesMarathonSearch(eq, searchQuery) {
  if (!searchQuery) return true;
  const q = safeLower(searchQuery);
  const sn = String(eq.startNumber);
  if (sn.includes(q)) return true;
  if (safeLower(eq.driverName).includes(q)) return true;
  if (safeLower(eq.className).includes(q)) return true;
  if (safeLower(eq._mergedLabel || '').includes(q)) return true;
  const horses = Array.isArray(eq.horses)
    ? eq.horses.map(h => h?.name || h).join(' ')
    : (eq.horse || '');
  return safeLower(horses).includes(q);
}

export function buildMarathonPlacementsByClass({
  equipages,
  marathonMap,
  timingDocFor,
  calculateResult
}) {
  const rows = equipages.map((eq) => {
    const sn = String(eq.startNumber);
    const d = marathonMap.get(sn) || {};
    const res = calculateResult(eq, d, timingDocFor(sn));
    // A finalized doc counts as finished even before status reaches 'Klar'
    const result = (isFinalizedMarathonDoc(d) && res.status !== 'Eliminerad') ? { ...res, status: 'Klar' } : res;
    return { sn, startNumber: eq.startNumber, groupKey: eq._mergedKey || `CLS:${eq.className || 'Ok\u00e4nd klass'}`, result };
  });

  return marathonPlaceMap(rows);
}

// TR 527.1: lowest total, then lowest B-section penalty, then shared place
export function marathonPlaceMap(rows) {
  const { placeOf } = assignPlaces(rows, {
    key: (row) => marathonRankKey(row.result),
    compare: compareMarathonRank,
    group: (row) => row.groupKey,
    outField: null
  });

  const map = new Map();
  rows.forEach((row) => {
    const place = placeOf.get(row);
    if (place != null) map.set(row.sn, place);
  });
  return map;
}

export function filterAndSortMarathonEquipages({
  equipages,
  searchQuery,
  activeClassFilters,
  showOnlyFinalized,
  showOnlyOnB,
  sortState,
  viewMode,
  marathonMap,
  isMarathonFinalized,
  calculateResult,
  timingDocFor,
  startTimeFor,
  placeMap
}) {
  let list = equipages.slice();

  list = list.filter(eq => matchesMarathonSearch(eq, searchQuery));

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e =>
      String(e.startNumber).includes(q) ||
      (e.driverName || '').toLowerCase().includes(q) ||
      (e.className || '').toLowerCase().includes(q)
    );
  }

  list = list.filter(e => {
    const s = String(e.status || '').toLowerCase();
    return !['struken', 'withdrawn', 'scratched'].includes(s) && !e.struken && !e.withdrawn;
  });

  if (activeClassFilters.size > 0) {
    list = list.filter(e => activeClassFilters.has(e._mergedLabel || e.className));
  }

  if (showOnlyFinalized) {
    list = list.filter(e => isMarathonFinalized(e.startNumber));
  } else if (showOnlyOnB) {
    list = list.filter(eq => {
      const sn = String(eq.startNumber);
      const d = marathonMap.get(sn) || {};
      const res = calculateResult(eq, d, timingDocFor(sn));
      return res.status === 'P\u00e5g\u00e5r' || d.running === true;
    });
  }

  const key = sortState.key;
  const dir = sortState.dir === 'asc' ? 1 : -1;

  const getVal = (eq, k) => {
    const sn = String(eq.startNumber);
    const d = marathonMap.get(sn) || {};
    const res = calculateResult(eq, d, timingDocFor(sn));

    if (k === 'place') return placeMap.get(sn) || 9999;
    if (k === 'startNumber') return Number(eq.startNumber) || 0;
    if (k === 'driverName') return (eq.driverName || '').toLowerCase();
    if (k === 'className') return (eq._mergedLabel || eq.className || '').toLowerCase();
    if (k === 'clubName') return (eq.clubName || '').toLowerCase();
    // Start times can be Firestore Timestamps or {seconds}: compare as ms
    if (k === 'startTime') return timeValueToMs(startTimeFor(sn)) ?? 9999999999999;
    if (k === 'eta') {
      const eta = timeValueToMs(res.eta.B || res.eta.A);
      return eta ?? 9999999999999;
    }
    if (k === 'live') return 0;
    if (k === 'obsSum') return isNum(res.obstacles.sum) ? res.obstacles.sum : 9999;
    if (k === 'otherPenalty') return isNum(res.otherPenalty) ? res.otherPenalty : 9999;
    if (k === 'totalPenalty') return (res.totalPenalty === Infinity) ? 99999 : (res.totalPenalty || 0);
    if (k === 'status') return res.status || '';

    if (k.startsWith('stage-')) {
      const st = k.split('stage-')[1];
      const p = res.stages[st]?.timePenalty;
      return isNum(p) ? p : 9999;
    }
    if (k.startsWith('obs-')) {
      const n = parseInt(k.split('obs-')[1]);
      const item = (res.obstacles.items || []).find(o => Number(o.number) === n);
      return (item && isNum(item.timeSec)) ? Number(item.timeSec) : 9999;
    }
    return 0;
  };

  list.sort((a, b) => {
    if (viewMode === 'byclass' && key === 'place') {
      const aLabel = safeLower(a._mergedLabel || a.className || '');
      const bLabel = safeLower(b._mergedLabel || b.className || '');
      const classCompare = aLabel.localeCompare(bLabel, 'sv');
      if (classCompare !== 0) return classCompare;
    }

    const va = getVal(a, key);
    const vb = getVal(b, key);

    if (typeof va === 'string' && typeof vb === 'string') {
      const cmp = va.localeCompare(vb, 'sv');
      if (cmp !== 0) return cmp * dir;
    } else {
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    // Ties (e.g. all unplaced rows) in numeric start-number order: 2 before 10
    return compareStartNumbers(a.startNumber, b.startNumber);
  });

  return list;
}
